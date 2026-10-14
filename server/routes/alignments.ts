/**
 * ALIGNING, ONE CLICK FROM YOUR OWN ACCOUNT (seat settings PR5).
 *
 *   POST /api/profile/alignments               align with a text {textId, contentHash},
 *                                              or with an application written before
 *                                              PR5 {applicationId, words}
 *   GET  /api/profile/alignments               what you have aligned with, and what waits on you
 *   GET  /api/profile/alignments/confirm       whether aligning with money terms asks you to confirm now
 *   POST /api/profile/alignments/confirm       confirm it is you (password, or a fresh Google sign-in)
 *   GET  /api/profile/alignments/:id/receipt   your receipt for one text
 *   GET  /api/alignments?party=<handle>        what another member has aligned with (terms.read)
 *   GET  /api/aligned?q=&kind=&offset=          the village's register, every text and version (terms.read, PR6)
 *   POST /api/profile/alignments/:id/notice     give notice on terms you are a party to (PR8)
 *   POST /api/profile/alignments/:id/end-by-agreement
 *                                              ask to end them by agreement (PR8)
 *   POST /api/profile/alignments/:id/endings/:endingId/take-back
 *                                              take a notice or an ask back before it takes effect (PR8)
 *
 * ── ONE CLICK, NO TYPED NAME ───────────────────────────────────────────────
 *
 * Rye, 2026-10-01: "We don't have to Type our names, just click that we sign
 * from our account powers." The click binds to a text's hash, which the page
 * showing the words hands back. A hash that is not the text's is refused, and
 * so is anybody who is not a party to it.
 *
 * ── MONEY ASKS ONCE MORE ───────────────────────────────────────────────────
 *
 * Decision 3 (2026-10-09): aligning with terms that carry pay, allowance or
 * bonus asks the village's existing identity re-confirm, a password or a fresh
 * Google sign-in (server/lib/identityConfirm.ts), when the last one is older
 * than fifteen minutes. A stolen session alone then cannot align anybody to
 * money. Every other text stays one click. The confirm route sits under
 * /api/profile because the Google confirmation's cookie is scoped there. This
 * village has no passkeys, so password or Google is the whole of "existing".
 *
 * ── WHO READS WHAT ─────────────────────────────────────────────────────────
 *
 * Your own list is yours, with the hash and a receipt. Another member's list
 * is for a reader holding `terms.read` (the member rung), without hash or
 * salt. Visitors and guests get 401. Nothing here is public, and nothing here
 * calls `recordEvent`.
 *
 * ── ENDING TERMS (PR8) ─────────────────────────────────────────────────────
 *
 * A party gives notice, asks to end by agreement, or takes either back
 * (server/lib/alignmentEndings.ts writes the rows). A member acts for their
 * own party. `{"as": "village"}` acts for the village, under the adoption
 * rule exactly: a live holder of org.seat who is not the candidate. When the
 * village holds that power, or nobody holds it live, ending for the village
 * needs a vote, and that vote is not built: the route refuses in a sentence
 * that says so, and either party can still give notice through the other
 * door. Notice never unseats anybody.
 *
 * REGISTERED from server/index.ts with one exempt line, beside the seat
 * application door.
 */
import type { Express } from "express";
import { ALIGN_WORDS, carriesMoney, ENDING_ID, HASH, RECONFIRM_FRESH_MS, TEXT_ID, intentSentence, userParty, VILLAGE_PARTY } from "../../shared/alignments";
import { ADOPTING_POWER, adoptRefusal, APPLICATION_ID, OPEN_STATUSES, seatList } from "../../shared/seatApplications";
import { isVillageHeld, type Capability, type CapabilityCtx } from "../../shared/capabilities";
import { whoMayPutHandToVillage } from "../../shared/powerHands";
import { askToEnd, giveNotice, takeBack, type EndingAct } from "../lib/alignmentEndings";
import { civilDateKey } from "../../shared/lunar";
import type { SeatCalendar } from "../../shared/seatTerms";
import type { AppDeps } from "../lib/appDeps";
import {
  ensureApplicationText,
  presentView,
  tellParties,
  recordAlignment,
  seatNamesFor,
  seatTermsWords,
  settleAll,
  settleText,
  viewText,
  viewTexts,
  type SettleDeps,
} from "../lib/alignmentSubjects";
import { confirmedUntil, confirmWithFor, stampConfirmed, type GateOutcome } from "../lib/identityConfirm";
import { userIdForHandle } from "../lib/profile";
import { registerJob } from "../lib/scheduler";
import { alignmentsByUser, partiesOf, readText, registerTexts, sealsOf, textsForParty } from "../repos/alignments";
import { readableKinds, registerRow, searchRegister } from "../lib/alignedRegister";
import {
  REGISTER_KINDS,
  REGISTER_PAGE,
  REGISTER_PAGE_MAX,
  REGISTER_QUERY_MAX,
  REGISTER_SEARCH_HITS,
  REGISTER_SEARCH_READS,
  type RegisterPage,
} from "../../shared/alignedRegister";
import { inApplicationTransaction, readApplication } from "../repos/seatApplications";
import { publicKeyBlock, signingKey } from "../lib/villageExport";

/** The sweep that seals texts once the key is there, and tells parties of terms that came into force by any door. */
export const ALIGNMENT_SWEEP_JOB = "alignment-seal-sweep";
const SWEEP_EVERY_MS = 60 * 60 * 1000;

/** Ten aligns, and ten confirmations, in ten minutes per member: a confirmation takes a password. */
const ASKS = 10;
const WINDOW_MS = 10 * 60 * 1000;

type Deps = Pick<AppDeps, "authedUser" | "guardCapability" | "getPool" | "notify" | "notifyAdmins" | "overLimit" | "members"> & {
  /** The identity gate exit and delete use (`makeIdentityGate`). */
  confirmIdentity(req: any, res: any, user: any, action: "align"): Promise<GateOutcome>;
  googleAvailable(): boolean;
  authSecret: string;
  seatCalendar(): SeatCalendar;
  /** Tests hand in a fixed instant. */
  now?: () => Date;
  /** A member's id from their handle. Defaults to the users table (server/lib/profile.ts); tests hand in their own. */
  idForHandle?: (handle: string) => Promise<string | null>;
  /**
   * Who may act for the village on ending terms (PR8): the viewer's
   * capability context and who holds org.seat live, the two the adoption
   * rule reads. Absent, nobody may act for the village here.
   */
  capabilityCtx?: (user: any) => Promise<CapabilityCtx>;
  liveHoldersOf?: (capability: string) => Promise<string[]>;
};

const MEMBERS_ONLY = { error: "auth_required", message: "Members read what other members have aligned with." };
const REGISTER_MEMBERS_ONLY = { error: "auth_required", message: "Members read what the village has aligned with." };

/** What a refused act for the village says (PR8). */
const VILLAGE_ACT_REFUSED = "Ending terms for the village is for a live holder of the power that seats people.";
const VILLAGE_OWN_TERMS = "Your own terms are ended for the village by another holder, or by a vote.";
const VILLAGE_NEEDS_VOTE =
  "Nobody holds the power that seats people live, so ending these terms for the village needs a vote of the village, and that vote is not built yet. Either party can still give notice.";

/** Thirty searches in ten minutes per member: each one indexes up to a thousand texts. */
const SEARCHES = 30;

/** Everything a member downloads about their alignments, for /api/profile/export. Counterparties as name and capacity only. */
export async function alignmentsForExport(pool: any, userId: string, nameOf: (id: string) => Promise<string | null>) {
  const texts = await textsForParty(pool, userId);
  const ids = texts.map((t) => t.id);
  const [parties, seals] = await Promise.all([partiesOf(pool, ids), sealsOf(pool, ids)]);
  const me = userParty(userId);
  const out = [];
  for (const t of texts) {
    const counterparties = [];
    for (const p of parties.filter((x) => x.textId === t.id && x.partyKey !== me)) {
      counterparties.push({ name: p.userId ? ((await nameOf(p.userId)) ?? "A former member") : "The village", capacity: p.capacity });
    }
    out.push({
      textId: t.id,
      subjectType: t.subjectType,
      version: t.version,
      title: t.title,
      body: t.body,
      settings: t.settings,
      salt: t.salt,
      contentHash: t.contentHash,
      effectiveFrom: t.effectiveFrom,
      effectiveTo: t.effectiveTo,
      createdAt: t.createdAt ? t.createdAt.toISOString() : null,
      redactedAt: t.redactedAt ? t.redactedAt.toISOString() : null,
      yourCapacity: parties.find((x) => x.textId === t.id && x.partyKey === me)?.capacity ?? null,
      counterparties,
    });
  }
  const own = (await alignmentsByUser(pool, userId)).map((a) => ({
    textId: a.textId,
    partyKey: a.partyKey,
    contentHash: a.contentHash,
    intentText: a.intentText,
    method: a.method,
    authorityRef: a.authorityRef,
    at: a.at.toISOString(),
  }));
  return { texts: out, alignments: own, receipts: seals.map((s) => ({ textId: s.textId, receipt: s.receipt, at: s.at.toISOString() })) };
}

export function register(app: Express, deps: Deps): void {
  const { authedUser, guardCapability, getPool, notify, notifyAdmins, overLimit, members } = deps;
  const now = () => (deps.now ? deps.now() : new Date());
  const tz = () => deps.seatCalendar().timezone || "UTC";
  const today = () => civilDateKey(now(), tz());
  const settleDeps: SettleDeps = { getPool, notify, notifyAdmins, today, now, timezone: tz };
  const nameOf = async (id: string) => {
    const m = await members.byId(id);
    return m ? String(m.name ?? "") || null : null;
  };

  // The pool is read when the job runs, never when it is registered.
  registerJob(ALIGNMENT_SWEEP_JOB, SWEEP_EVERY_MS, () => settleAll(settleDeps));

  /** Whether aligning with money terms asks this member to confirm now, and with what. */
  const confirmState = (user: any) => {
    const until = confirmedUntil(user, RECONFIRM_FRESH_MS);
    return {
      fresh: until !== null && now().getTime() <= until,
      freshUntil: until !== null && now().getTime() <= until ? new Date(until).toISOString() : null,
      confirmWith: confirmWithFor(user, deps.authSecret, deps.googleAvailable()),
    };
  };

  /** The refusal money terms answer with when the last confirmation is stale, or null. */
  const moneyRefusal = (user: any) => {
    const s = confirmState(user);
    if (s.fresh) return null;
    return { error: "reconfirm_required", message: ALIGN_WORDS.reconfirmLine, confirmWith: s.confirmWith };
  };

  // ── Confirm ───────────────────────────────────────────────────────────────
  app.get("/api/profile/alignments/confirm", async (req, res) => {
    const user = await authedUser(req);
    if (!user) return res.status(401).json({ error: "auth_required" });
    res.json(confirmState(user));
  });

  app.post("/api/profile/alignments/confirm", async (req, res) => {
    const user = await authedUser(req);
    if (!user) return res.status(401).json({ error: "auth_required" });
    if (await overLimit(`align-confirm:${String(user.id)}`, ASKS, WINDOW_MS)) {
      return res.status(429).json({ error: "too_many_asks", message: "Too many tries. Wait a few minutes and try again." });
    }
    const gate = await deps.confirmIdentity(req, res, user, "align");
    if (!gate.ok) return res.status(403).json({ ...gate.body, message: gate.body.error });
    const at = now().getTime();
    const saved = await members.update(String(user.id), (m: any) => stampConfirmed(m, at));
    if (!saved) return res.status(409).json({ error: "This account cannot be confirmed right now." });
    res.json({ success: true, via: gate.via, ...confirmState(saved) });
  });

  // ── Align ─────────────────────────────────────────────────────────────────
  app.post("/api/profile/alignments", async (req, res) => {
    const user = await authedUser(req);
    if (!user) return res.status(401).json({ error: "auth_required", message: "Sign in to align." });
    const userId = String(user.id);
    if (await overLimit(`align:${userId}`, ASKS, WINDOW_MS)) {
      return res.status(429).json({ error: "too_many_asks", message: "That is a lot of aligning in a few minutes. Wait a little and try again." });
    }
    const pool = getPool();
    const body = (req.body ?? {}) as Record<string, unknown>;
    const me = userParty(userId);

    // An application written before PR5: the candidate aligns with words rendered from its stored terms.
    if (body.applicationId !== undefined) {
      const id = String(body.applicationId ?? "");
      const a = APPLICATION_ID.test(id) ? await readApplication(pool, id) : null;
      if (!a) return res.status(404).json({ error: "There is no application by that id." });
      if (a.candidateUserId !== userId) return res.status(403).json({ error: "not_a_party", message: "Only the member who applied aligns with an application's terms here." });
      if (a.status === "withdrawn" || a.status === "not-adopted") {
        return res.status(409).json({ error: "closed", message: "This application is closed, so there is nothing to align with." });
      }
      const names = await seatNamesFor(pool, a.seatIds);
      const words = seatTermsWords(names, a.settings);
      if (typeof body.words !== "string" || body.words !== words.body) {
        return res.status(409).json({ error: "words_changed", message: ALIGN_WORDS.wordsChanged });
      }
      if (carriesMoney(a.settings)) {
        const refusal = moneyRefusal(user);
        if (refusal) return res.status(403).json(refusal);
      }
      const textId = await inApplicationTransaction(pool, async (conn) => {
        const fresh = (await readApplication(conn, a.id, true))!;
        const text = await ensureApplicationText(conn, fresh, userId, deps.seatCalendar().timezone);
        await recordAlignment(conn, {
          textId: text.id,
          partyKey: me,
          userId,
          contentHash: text.contentHash,
          intent: intentSentence(names),
          method: "click",
          authorityRef: null,
        });
        return text.id;
      });
      const v = await settleText(settleDeps, textId);
      return res.status(201).json({ success: true, textId, alignment: v ? await presentView(v, userId, nameOf, true) : null });
    }

    const textId = String(body.textId ?? "");
    const hash = String(body.contentHash ?? "");
    if (!TEXT_ID.test(textId) || !HASH.test(hash)) {
      return res.status(400).json({ error: "Name the text and the hash of the words you read." });
    }
    const v = await viewText(pool, textId, today(), tz(), now());
    if (!v) return res.status(404).json({ error: "There is no text by that id." });
    const party = v.parties.find((p) => p.partyKey === me);
    if (!party) return res.status(403).json({ error: "not_a_party", message: "You are not a party to these terms, so there is nothing for you to align with." });
    if (hash !== v.text.contentHash) return res.status(409).json({ error: "hash_mismatch", message: ALIGN_WORDS.wordsChanged });
    if (v.derived.state === "ended") return res.status(409).json({ error: "ended", message: v.derived.why ?? "These terms have ended." });
    if (v.application && !OPEN_STATUSES.includes(v.application.status) && v.application.status !== "adopted" && v.application.status !== "held-full") {
      return res.status(409).json({ error: "closed", message: "This application is closed, so there is nothing to align with." });
    }
    if (carriesMoney(v.text.settings)) {
      const refusal = moneyRefusal(user);
      if (refusal) return res.status(403).json(refusal);
    }
    const landed = await recordAlignment(pool, {
      textId,
      partyKey: me,
      userId,
      contentHash: v.text.contentHash,
      intent: intentSentence(v.seatNames),
      method: "click",
      authorityRef: null,
    });
    const after = await settleText(settleDeps, textId);
    res.status(landed ? 201 : 200).json({ success: true, already: !landed, alignment: after ? await presentView(after, userId, nameOf, true) : null });
  });

  // ── Read your own ─────────────────────────────────────────────────────────
  app.get("/api/profile/alignments", async (req, res) => {
    const user = await authedUser(req);
    if (!user) return res.status(401).json({ error: "auth_required" });
    const pool = getPool();
    const views = await viewTexts(pool, await textsForParty(pool, String(user.id)), today(), tz(), now());
    res.json({ alignments: await Promise.all(views.map((v) => presentView(v, String(user.id), nameOf, true))) });
  });

  app.get("/api/profile/alignments/:id/receipt", async (req, res) => {
    const user = await authedUser(req);
    if (!user) return res.status(401).json({ error: "auth_required" });
    const id = String(req.params.id ?? "");
    const pool = getPool();
    const text = TEXT_ID.test(id) ? await readText(pool, id) : null;
    if (!text) return res.status(404).json({ error: "There is no text by that id." });
    const parties = await partiesOf(pool, [text.id]);
    if (!parties.some((p) => p.partyKey === userParty(String(user.id)))) {
      return res.status(403).json({ error: "not_a_party", message: "A receipt is for the parties to the terms." });
    }
    const [seal] = await sealsOf(pool, [text.id]);
    let publicKey: ReturnType<typeof publicKeyBlock> | null = null;
    try {
      publicKey = publicKeyBlock(signingKey());
    } catch {
      publicKey = null;
    }
    res.setHeader("Content-Disposition", `attachment; filename="aligned-${text.id}.json"`);
    res.json({
      sealed: !!seal,
      // The signed receipt: the hash and who aligned, never the words.
      receipt: seal?.receipt ?? null,
      publicKey,
      // Your own copy of the words, with the salt, so the hash can be recomputed from them.
      copy: {
        textId: text.id,
        subjectType: text.subjectType,
        subjectRef: text.subjectRef,
        version: text.version,
        title: text.title,
        body: text.body,
        settings: text.settings,
        salt: text.salt,
        contentHash: text.contentHash,
        parties: parties.map((p) => ({ partyKey: p.partyKey, capacity: p.capacity, required: p.required })),
      },
    });
  });

  // ── Another member's ──────────────────────────────────────────────────────
  app.get("/api/alignments", async (req, res) => {
    if (!(await guardCapability(req, res, "terms.read", { status: 401, body: MEMBERS_ONLY }))) return;
    const viewer = await authedUser(req);
    if (!viewer) return res.status(401).json(MEMBERS_ONLY);
    const handle = typeof req.query.party === "string" ? req.query.party.trim().replace(/^@/, "") : "";
    if (!handle) return res.status(400).json({ error: "Name the member by their handle." });
    const pool = getPool();
    const userId = deps.idForHandle ? await deps.idForHandle(handle) : await userIdForHandle(pool, handle);
    if (!userId) return res.json({ alignments: [] });
    const views = await viewTexts(pool, await textsForParty(pool, userId), today(), tz(), now());
    const served = await Promise.all(views.map((v) => presentView(v, String(viewer.id), nameOf, false)));
    // Another member's list carries no hash and no salt. Their terms are open book to members, words included.
    res.json({ alignments: served.map((s) => ({ ...s, contentHash: null })) });
  });

  // ── The register (PR6) ────────────────────────────────────────────────────
  /*
   * Every text of a kind the viewer may read, every version, newest first, or
   * a search over them. Members only: a visitor and a signed-in guest get 401
   * before the database is read. No count, ever: `more` says a full page came
   * back, which is all paging needs (R55).
   *
   * THE KINDS A VIEWER READS. Every kind today names `terms.read`, the gate
   * this route passes first, so `passed` holds it. A kind that names another
   * capability joins `passed` through its own gate here before it can show.
   */
  app.get("/api/aligned", async (req, res) => {
    if (!(await guardCapability(req, res, "terms.read", { status: 401, body: REGISTER_MEMBERS_ONLY }))) return;
    const viewer = await authedUser(req);
    if (!viewer) return res.status(401).json(REGISTER_MEMBERS_ONLY);
    const viewerId = String(viewer.id);
    const passed = new Set<Capability>(["terms.read"]);
    const kinds = readableKinds((c) => passed.has(c));
    const wanted = typeof req.query.kind === "string" && req.query.kind ? req.query.kind : null;
    if (wanted && !REGISTER_KINDS.some((k) => k.id === wanted)) return res.status(400).json({ error: "There is no kind of terms by that name." });
    const subjectTypes = kinds.filter((k) => !wanted || k.id === wanted).map((k) => k.id);
    const q = typeof req.query.q === "string" ? req.query.q.trim().slice(0, REGISTER_QUERY_MAX) : "";
    const tz = deps.seatCalendar().timezone || "UTC";
    const pool = getPool();
    const kindList = kinds.map((k) => ({ id: k.id, label: k.label }));

    if (q) {
      if (await overLimit(`aligned-search:${viewerId}`, SEARCHES, WINDOW_MS)) {
        return res.status(429).json({ error: "too_many_asks", message: "That is a lot of searching in a few minutes. Wait a little and try again." });
      }
      const texts = await registerTexts(pool, { subjectTypes, limit: REGISTER_SEARCH_READS, offset: 0 });
      const views = await viewTexts(pool, texts, today(), tz, now());
      const rows = await Promise.all(views.map((v) => registerRow(v, viewerId, nameOf, tz)));
      const page: RegisterPage = { kinds: kindList, rows: searchRegister(rows, q, REGISTER_SEARCH_HITS), more: false, query: q };
      return res.json(page);
    }

    const asked = Number(req.query.limit);
    const limit = Number.isFinite(asked) && asked > 0 ? Math.min(REGISTER_PAGE_MAX, Math.floor(asked)) : REGISTER_PAGE;
    const offsetAsked = Number(req.query.offset);
    const offset = Number.isFinite(offsetAsked) && offsetAsked > 0 ? Math.floor(offsetAsked) : 0;
    // One more than the page, so `more` is a fact and never a guess.
    const texts = await registerTexts(pool, { subjectTypes, limit: limit + 1, offset });
    const views = await viewTexts(pool, texts.slice(0, limit), today(), tz, now());
    const rows = await Promise.all(views.map((v) => registerRow(v, viewerId, nameOf, tz)));
    const page: RegisterPage = { kinds: kindList, rows, more: texts.length > limit, query: null };
    res.json(page);
  });

  // ── Ending terms (PR8) ────────────────────────────────────────────────────
  /**
   * The party this member acts for on a text, or a refusal. Their own party
   * by default; the village's with `as: "village"`, under the adoption rule:
   * a live holder of org.seat who is not the candidate. With no live holder,
   * ending for the village needs a vote, which this village cannot open yet.
   */
  async function actingParty(user: any, textId: string, as: unknown): Promise<{ ok: true; partyKey: string } | { ok: false; status: number; body: Record<string, unknown> }> {
    const userId = String(user.id);
    if (as !== "village") return { ok: true, partyKey: userParty(userId) };
    if (!deps.capabilityCtx || !deps.liveHoldersOf) {
      return { ok: false, status: 403, body: { error: "not_a_holder", message: VILLAGE_ACT_REFUSED } };
    }
    const ctx = await deps.capabilityCtx(user);
    const rule = whoMayPutHandToVillage(isVillageHeld(ADOPTING_POWER as Capability, ctx.villageHeld), await deps.liveHoldersOf(ADOPTING_POWER));
    if (rule.who !== "live-holders") return { ok: false, status: 409, body: { error: "needs_vote", message: VILLAGE_NEEDS_VOTE } };
    const parties = await partiesOf(getPool(), [textId]);
    const candidate = parties.find((p) => p.partyKey !== VILLAGE_PARTY && p.userId)?.userId ?? "";
    const refusal = adoptRefusal(rule, userId, candidate);
    if (refusal) {
      return { ok: false, status: refusal.status, body: { error: refusal.error, message: refusal.error === "own_terms" ? VILLAGE_OWN_TERMS : VILLAGE_ACT_REFUSED } };
    }
    return { ok: true, partyKey: VILLAGE_PARTY };
  }

  type EndingInput = { textId: string; partyKey: string; actorId: string; now: Date; timezone: string; endingId: string };

  /** The three acts, what the other parties hear about each, and the key it is told under. */
  const ENDING_ACTS: Record<"notice" | "ask" | "take-back", { act: (pool: any, input: EndingInput) => Promise<EndingAct>; tell: (seats: string) => string }> = {
    notice: { act: giveNotice, tell: (seats) => `Notice given on the terms for ${seats}` },
    ask: { act: askToEnd, tell: (seats) => `Asked to end by agreement: the terms for ${seats}` },
    "take-back": { act: takeBack, tell: (seats) => `Taken back: a notice or an ask on the terms for ${seats}` },
  };

  /** The common door: sign-in, the limit, the ids, the acting party, then the act and what the other parties hear. */
  async function endingRoute(req: any, res: any, keySuffix: keyof typeof ENDING_ACTS) {
    const { act, tell } = ENDING_ACTS[keySuffix];
    const user = await authedUser(req);
    if (!user) return res.status(401).json({ error: "auth_required", message: "Sign in to act on your terms." });
    const userId = String(user.id);
    if (await overLimit(`align-end:${userId}`, ASKS, WINDOW_MS)) {
      return res.status(429).json({ error: "too_many_asks", message: "That is a lot in a few minutes. Wait a little and try again." });
    }
    const textId = String(req.params.id ?? "");
    const endingId = String(req.params.endingId ?? "");
    if (!TEXT_ID.test(textId)) return res.status(400).json({ error: "Name the text by its id." });
    if (req.params.endingId !== undefined && !ENDING_ID.test(endingId)) return res.status(400).json({ error: "Name the notice or the ask by its id." });
    const party = await actingParty(user, textId, req.body?.as);
    if (!party.ok) return res.status(party.status).json(party.body);
    const out = await act(getPool(), { textId, partyKey: party.partyKey, actorId: userId, now: now(), timezone: tz(), endingId });
    if (!out.ok) return res.status(out.status).json({ error: out.error, message: out.message });
    const after = await viewText(getPool(), textId, today(), tz(), now());
    // The other parties hear, with the seat names and a link only. Agreement completed says so instead.
    const done = after?.derived.endedBy === "ending" && after.derived.ending?.kind === "mutual";
    await tellParties(
      settleDeps,
      after ?? out.view,
      done ? `Ended by agreement: the terms for ${seatList(out.view.seatNames)}` : tell(seatList(out.view.seatNames)),
      done ? "ended-by-agreement" : `${keySuffix}:${out.endingId}`,
      done ? null : userId,
    );
    res.status(201).json({
      success: true,
      endingId: out.endingId,
      effectiveAt: out.effectiveAt.toISOString(),
      alignment: after ? await presentView(after, userId, nameOf, true, { actsForVillage: party.partyKey === VILLAGE_PARTY }) : null,
    });
  }

  app.post("/api/profile/alignments/:id/notice", (req, res) => endingRoute(req, res, "notice"));
  app.post("/api/profile/alignments/:id/end-by-agreement", (req, res) => endingRoute(req, res, "ask"));
  app.post("/api/profile/alignments/:id/endings/:endingId/take-back", (req, res) => endingRoute(req, res, "take-back"));
}
