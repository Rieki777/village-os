/**
 * THE MOON REVIEW'S VILLAGE SETTINGS, over HTTP (decision 22, 3 November).
 *
 *   GET / PUT /api/moon-review/payers    the `payers` document
 *   GET / PUT /api/moon-review/settings  the `moon-review-settings` document
 *   GET / PUT /api/moon-review/rhythm    the `moon_rhythm` document
 *
 * Every value one village decides lives in these three documents, never in
 * code: who it pays and how to reach them, the host country and its rates,
 * the tax forms it keeps, the pilot acknowledgement, and the moon's moved
 * days and guide link. Each ships EMPTY; until a payer, the host country and
 * the acknowledgement are set, an invoice is refused with "Name who you pay
 * first" (`setupGaps`, shared/moonRecap.ts) and a recap still sends.
 *
 * ONE KEY FOR ALL THREE: `cash.pay`. Payers carry legal names and tax numbers
 * and the settings carry the village's tax and rate rules, which are the
 * Finance role's to keep; the rhythm sits beside them on the same desk and no
 * part of the spec names another key for it. The gate is `guardCapability`,
 * so a village that hands the key to nobody falls through to admin there and
 * nowhere else.
 *
 * EVERY CHANGE IS RECORDED. A PUT validates with the contract's own parser,
 * writes the whole document, and writes a `moon_review_events` row naming
 * who changed it and carrying the old and new value of every field that
 * moved. A PUT that changes nothing writes no event.
 *
 * Mounted behind `requireModule("moon-review")` here, in the module, the way
 * server/routes/badges.ts mounts its prefixes. All SQL is in server/repos.
 */
import type { Express, RequestHandler } from "express";
import type { AppDeps } from "../lib/appDeps";
import { requireModule } from "../lib/modules";
import { recordEvent } from "../lib/events";
import { readConfigDocument, writeConfigDocument } from "../repos/appConfigDocs";
import { insertReviewEvent } from "../repos/moonRecaps";
import {
  MOON_REVIEW_MODULE, PAYERS_DOC_KEY, SETTINGS_DOC_KEY, SETUP_GAP_WORDS, parseMoonReviewSettings, parsePayers, payerGapKeys, payersChanges,
  settingsChanges, settingsGapKeys, EMPTY_PAYERS, EMPTY_SETTINGS, type PayersDoc, type MoonReviewSettings, type ReviewEventKind,
} from "../../shared/moonRecap";
import { cancelInboxChange, confirmInboxChange, decideInbox, pendingInbox, type InboxDeps } from "../lib/seraInboxChange";
import { EMPTY_RHYTHM, RHYTHM_DOC_KEY, parseRhythm, rhythmChanges, type RhythmDoc } from "../../shared/moonRhythm";

type Deps = Pick<AppDeps, "authedUser" | "getPool" | "guardCapability" | "overLimit" | "members" | "notify"> & {
  /** Who may sign a change of Sera's inbox: live holders of cash.pay and of steward.veto (C7). */
  inboxSigners: () => Promise<string[]>;
};

/** Where a member is told Sera's inbox changed. */
const SERA_INBOX_NOTICE = "moon_review";

export const SETTINGS_ROUTES = ["/api/moon-review/payers", "/api/moon-review/settings", "/api/moon-review/rhythm"] as const;

/** The note a change event carries: the old and new value of each field that moved, capped to fit the column. */
export function changeNote(changes: readonly unknown[]): string {
  const text = JSON.stringify(changes);
  return text.length > 60_000 ? `${text.slice(0, 60_000)}…` : text;
}

interface DocSpec<T> {
  key: string;
  empty: T;
  parse: (raw: unknown) => { ok: true; value: T } | { ok: false; field: string; error: string };
  changes: (before: T, after: T) => unknown[];
  event: ReviewEventKind;
  /** A last say over a parsed save before it is written (Sera's inbox waits for a second signer, C7). */
  adjust?: (before: T, after: T, actorUserId: string) => Promise<T>;
}

export function register(app: Express, deps: Deps): void {
  const { authedUser, getPool, guardCapability, overLimit } = deps;

  const inbox: InboxDeps = {
    getPool,
    signers: async () => Array.from(new Set(await deps.inboxSigners())),
    notifyAll: async (address, actorUserId) => {
      let told = 0;
      for (const m of await deps.members.all()) {
        const u = m as unknown as { id: unknown; isExample?: boolean; departedAt?: unknown };
        if (u.isExample || u.departedAt) continue;
        await deps.notify({
          userId: String(u.id), type: SERA_INBOX_NOTICE, title: "Invoices now go to a new Sera inbox",
          body: `When you send an invoice for approval, the village now emails it to ${address}.`, link: "/profile",
          actorUserId, dedupeKey: `sera-inbox:${address}:${String(u.id)}`.slice(0, 190),
        }).then(() => told++).catch(() => undefined);
      }
      return told;
    },
    audit: async (text, actorUserId) => {
      await recordEvent(getPool(), { kind: "audit", text, actorUserId, entityType: "app_config", entityRef: SETTINGS_DOC_KEY, audience: "admin" });
    },
    now: () => new Date(),
  };

  for (const p of SETTINGS_ROUTES) app.use(p, requireModule(MOON_REVIEW_MODULE));

  /** The stored document, read through its parser; a stored value that no longer parses reads as empty. */
  async function read<T>(spec: DocSpec<T>): Promise<T> {
    const raw = await readConfigDocument(getPool(), spec.key);
    const parsed = spec.parse(raw ?? undefined);
    return parsed.ok ? parsed.value : spec.empty;
  }

  /**
   * The two bodies for one document. Each route below is registered with its
   * literal path and asks the cash key on its own line, so the route walkers
   * (the PII walk and the route-limit check) can read both from the source.
   */
  function handlers<T>(spec: DocSpec<T>, extra: (doc: T) => Record<string, unknown> | Promise<Record<string, unknown>> = () => ({})) {
    const get: RequestHandler = async (_req, res) => {
      const doc = await read(spec);
      res.json({ document: doc, ...(await extra(doc)) });
    };

    const put: RequestHandler = async (req, res) => {
      const actor = await authedUser(req);
      if (!actor) return res.status(401).json({ error: "auth_required" });
      if (await overLimit(`moon-settings:${actor.id}`, 60, 60 * 60 * 1000)) {
        return res.status(429).json({ error: "Too many saves at once. Try again in a while." });
      }
      const parsed = spec.parse(req.body?.document ?? req.body);
      if (!parsed.ok) return res.status(400).json({ error: parsed.error, field: parsed.field });
      const before = await read(spec);
      const value = spec.adjust ? await spec.adjust(before, parsed.value, String(actor.id)) : parsed.value;
      const changes = spec.changes(before, value);
      if (changes.length > 0) {
        await writeConfigDocument(getPool(), spec.key, value as unknown as Record<string, unknown>);
        await insertReviewEvent(getPool(), {
          recapId: null, invoiceId: null, userId: null, kind: spec.event, actorUserId: String(actor.id), actorRole: null,
          amountMinor: null, currency: null, hash: null, note: changeNote(changes),
        });
        void recordEvent(getPool(), {
          kind: "audit", text: `moon-review:${spec.event}:${changes.length}`, actorUserId: actor.id,
          entityType: "app_config", entityRef: spec.key, audience: "admin",
        });
      }
      res.json({ document: value, changed: changes.length, ...(await extra(value)) });
    };
    return { get, put };
  }

  const payers: DocSpec<PayersDoc> = { key: PAYERS_DOC_KEY, empty: EMPTY_PAYERS, parse: parsePayers, changes: payersChanges, event: "payers_changed" };
  const settings: DocSpec<MoonReviewSettings> = {
    key: SETTINGS_DOC_KEY, empty: EMPTY_SETTINGS, parse: parseMoonReviewSettings, changes: settingsChanges, event: "settings_changed",
    adjust: async (before, after, actorUserId) => ({ ...after, seraInbox: (await decideInbox(inbox, before.seraInbox, after.seraInbox, actorUserId)).apply }),
  };
  const rhythm: DocSpec<RhythmDoc> = { key: RHYTHM_DOC_KEY, empty: EMPTY_RHYTHM, parse: parseRhythm, changes: rhythmChanges, event: "rhythm_changed" };

  // Each answer carries what this document still has to name, so the desk can say it.
  const words = (keys: readonly (keyof typeof SETUP_GAP_WORDS)[]) => keys.map((k) => ({ key: k, words: SETUP_GAP_WORDS[k] }));
  const payersDoor = handlers(payers, (doc) => ({ gaps: words(payerGapKeys(doc)) }));
  const settingsDoor = handlers(settings, async (doc) => ({ gaps: words(settingsGapKeys(doc)), pendingSeraInbox: await pendingInbox(getPool()) }));
  const rhythmDoor = handlers(rhythm);
  app.get("/api/moon-review/payers", async (req, res, next) => {
    if (!(await guardCapability(req, res, "cash.pay"))) return;
    return payersDoor.get(req, res, next);
  });
  app.put("/api/moon-review/payers", async (req, res, next) => {
    if (!(await guardCapability(req, res, "cash.pay"))) return;
    return payersDoor.put(req, res, next);
  });
  app.get("/api/moon-review/settings", async (req, res, next) => {
    if (!(await guardCapability(req, res, "cash.pay"))) return;
    return settingsDoor.get(req, res, next);
  });
  app.put("/api/moon-review/settings", async (req, res, next) => {
    if (!(await guardCapability(req, res, "cash.pay"))) return;
    return settingsDoor.put(req, res, next);
  });
  // C7: a waiting change of Sera's inbox, confirmed or cancelled by a signer. The signer check is inside.
  app.post("/api/moon-review/settings/sera-inbox/confirm", async (req, res) => {
    const actor = await authedUser(req);
    if (!actor) return res.status(401).json({ error: "auth_required" });
    if (await overLimit(`sera-inbox:${actor.id}`, 20, 60 * 60 * 1000)) return res.status(429).json({ error: "Too many tries. Try again in a while." });
    const out = await confirmInboxChange(inbox, String(actor.id));
    return out.ok ? res.json(out) : res.status(out.status).json({ error: out.error });
  });
  app.post("/api/moon-review/settings/sera-inbox/cancel", async (req, res) => {
    const actor = await authedUser(req);
    if (!actor) return res.status(401).json({ error: "auth_required" });
    if (await overLimit(`sera-inbox:${actor.id}`, 20, 60 * 60 * 1000)) return res.status(429).json({ error: "Too many tries. Try again in a while." });
    const out = await cancelInboxChange(inbox, String(actor.id));
    return out.ok ? res.json(out) : res.status(out.status).json({ error: out.error });
  });
  app.get("/api/moon-review/rhythm", async (req, res, next) => {
    if (!(await guardCapability(req, res, "cash.pay"))) return;
    return rhythmDoor.get(req, res, next);
  });
  app.put("/api/moon-review/rhythm", async (req, res, next) => {
    if (!(await guardCapability(req, res, "cash.pay"))) return;
    return rhythmDoor.put(req, res, next);
  });
}
