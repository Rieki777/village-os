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
import type { Express } from "express";
import type { AppDeps } from "../lib/appDeps";
import { requireModule } from "../lib/modules";
import { recordEvent } from "../lib/events";
import { readConfigDocument, writeConfigDocument } from "../repos/appConfigDocs";
import { insertReviewEvent } from "../repos/moonRecaps";
import {
  MOON_REVIEW_MODULE, PAYERS_DOC_KEY, SETTINGS_DOC_KEY, SETUP_GAP_WORDS, parseMoonReviewSettings, parsePayers, payerGapKeys, payersChanges,
  settingsChanges, settingsGapKeys, EMPTY_PAYERS, EMPTY_SETTINGS, type PayersDoc, type MoonReviewSettings, type ReviewEventKind,
} from "../../shared/moonRecap";
import { EMPTY_RHYTHM, RHYTHM_DOC_KEY, parseRhythm, rhythmChanges, type RhythmDoc } from "../../shared/moonRhythm";

type Deps = Pick<AppDeps, "authedUser" | "getPool" | "guardCapability" | "overLimit">;

export const SETTINGS_ROUTES = ["/api/moon-review/payers", "/api/moon-review/settings", "/api/moon-review/rhythm"] as const;

/** The note a change event carries: the old and new value of each field that moved, capped to fit the column. */
export function changeNote(changes: readonly unknown[]): string {
  const text = JSON.stringify(changes);
  return text.length > 60_000 ? `${text.slice(0, 60_000)}…` : text;
}

interface DocSpec<T> {
  path: string;
  key: string;
  empty: T;
  parse: (raw: unknown) => { ok: true; value: T } | { ok: false; field: string; error: string };
  changes: (before: T, after: T) => unknown[];
  event: ReviewEventKind;
}

export function register(app: Express, deps: Deps): void {
  const { authedUser, getPool, guardCapability, overLimit } = deps;

  for (const p of SETTINGS_ROUTES) app.use(p, requireModule(MOON_REVIEW_MODULE));

  /** The stored document, read through its parser; a stored value that no longer parses reads as empty. */
  async function read<T>(spec: DocSpec<T>): Promise<T> {
    const raw = await readConfigDocument(getPool(), spec.key);
    const parsed = spec.parse(raw ?? undefined);
    return parsed.ok ? parsed.value : spec.empty;
  }

  function mount<T>(spec: DocSpec<T>, extra: (doc: T) => Record<string, unknown> = () => ({})): void {
    app.get(spec.path, async (req, res) => {
      if (!(await guardCapability(req, res, "cash.pay"))) return;
      const doc = await read(spec);
      res.json({ document: doc, ...extra(doc) });
    });

    app.put(spec.path, async (req, res) => {
      if (!(await guardCapability(req, res, "cash.pay"))) return;
      const actor = await authedUser(req);
      if (!actor) return res.status(401).json({ error: "auth_required" });
      if (await overLimit(`moon-settings:${actor.id}`, 60, 60 * 60 * 1000)) {
        return res.status(429).json({ error: "Too many saves at once. Try again in a while." });
      }
      const parsed = spec.parse(req.body?.document ?? req.body);
      if (!parsed.ok) return res.status(400).json({ error: parsed.error, field: parsed.field });
      const before = await read(spec);
      const changes = spec.changes(before, parsed.value);
      if (changes.length > 0) {
        await writeConfigDocument(getPool(), spec.key, parsed.value as unknown as Record<string, unknown>);
        await insertReviewEvent(getPool(), {
          recapId: null, invoiceId: null, userId: null, kind: spec.event, actorUserId: String(actor.id), actorRole: null,
          amountMinor: null, currency: null, hash: null, note: changeNote(changes),
        });
        void recordEvent(getPool(), {
          kind: "audit", text: `moon-review:${spec.event}:${changes.length}`, actorUserId: actor.id,
          entityType: "app_config", entityRef: spec.key, audience: "admin",
        });
      }
      res.json({ document: parsed.value, changed: changes.length, ...extra(parsed.value) });
    });
  }

  const payers: DocSpec<PayersDoc> = { path: SETTINGS_ROUTES[0], key: PAYERS_DOC_KEY, empty: EMPTY_PAYERS, parse: parsePayers, changes: payersChanges, event: "payers_changed" };
  const settings: DocSpec<MoonReviewSettings> = { path: SETTINGS_ROUTES[1], key: SETTINGS_DOC_KEY, empty: EMPTY_SETTINGS, parse: parseMoonReviewSettings, changes: settingsChanges, event: "settings_changed" };
  const rhythm: DocSpec<RhythmDoc> = { path: SETTINGS_ROUTES[2], key: RHYTHM_DOC_KEY, empty: EMPTY_RHYTHM, parse: parseRhythm, changes: rhythmChanges, event: "rhythm_changed" };

  // Each answer carries what this document still has to name, so the desk can say it.
  const words = (keys: readonly (keyof typeof SETUP_GAP_WORDS)[]) => keys.map((k) => ({ key: k, words: SETUP_GAP_WORDS[k] }));
  mount(payers, (doc) => ({ gaps: words(payerGapKeys(doc)) }));
  mount(settings, (doc) => ({ gaps: words(settingsGapKeys(doc)) }));
  mount(rhythm);
}
