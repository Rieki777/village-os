/**
 * The village economy: one guarded write path, and the rules that guard it.
 *
 * Every mint, refund and claim in this build goes through `mint()`,
 * `reverse()` and `requestVoiceClaim()` here, and every one of them ends up in
 * `postTransfer` (server/lib/ledger.ts). This module adds no ledger of its own.
 * That is deliberate and it is the load-bearing decision of the whole build:
 * `token_ledger` is double-entry with conservation re-proven at every boot, and
 * a second append-only table minting from NULL would sit outside
 * `checkLedgerInvariants` and give one deployment two sets of books. The
 * doctrine this file enforces says one ledger, every token, so the doctrine
 * lands ON the ledger that already exists.
 *
 * What this module is, then: the rules between an event in the village and a
 * ledger post. Which trigger mints which token. How much, and up to what
 * ceiling. Who is allowed to witness whose work. What a giving allowance is
 * when nobody is allowed to store it. Which confirmations are history and
 * which are owed.
 *
 * Every rule below was a live exploit in review. None of them is polish.
 *
 * THE TOKENS, and the naming, which has moved once and must not move again by
 * accident.
 *
 *   GRATITUDE     the `gratitude` token, and the name of the whole recognition
 *                 system. Given, never paid, and never spent: standing is held.
 *                 Mints from the recognition faucet at the moment of giving.
 *                 "Hearts" was an earlier working name for this and is RETIRED:
 *                 if you find it in user-facing copy it is a leftover, not a
 *                 second concept. The heart TAP on a feed post is a different
 *                 thing and keeps its own name.
 *   Stay credits  `stay-credit`. A real thing you spend on a real night.
 *   Library       `library-credit`. Spendable, backed by shelves.
 *   Voice         `village-voice`. Earned only from confirmed contribution,
 *                 accrued here, claimed to Hypha.
 *
 * The constant is still called HEARTS because renaming an exported symbol
 * touches every call site for no behavioural gain, and the string it holds,
 * "gratitude", was always the truth. The COPY is what a member reads and the
 * copy says Gratitude.
 *
 * `amora` is NONE of these. It is the village's equity token, it is governed by
 * Hypha, it lives on Base, and this platform is forbidden from minting or
 * moving it (`governance: 'hypha'`, refused by `validateLeg`). Gratitude is
 * recognition and Amora is equity. Nothing here may ever quietly turn one into
 * the other, and no surface should let a member read one number as the other.
 */
import type { Pool, PoolConnection, RowDataPacket } from "mysql2/promise";
import {
  mintRuleValueNumber,
  mintRuleValueProblem,
  parseMintRuleKey,
  type MintRuleField,
} from "../../shared/mintRuleKeys";
import type { VillageMoon } from "../../shared/villageMoon";
import { issuanceRefusal } from "./gameStart";
import { currentCycle, currentCycleNumber, cycleIdFor, parseCycleId } from "./gratitude-cycles";
import { moonOneCycle, villageMoonFor } from "./villageMoon";
import { numberVar } from "./variables";
import {
  memberAccount,
  postTransfer,
  postTransferOn,
  registerToken,
  tokenDef,
  CYCLE_POOL_FAUCET,
  MINT_FAUCET,
  RECOGNITION_FAUCET,
  type TransferResult,
} from "./ledger";
// The one definition of "this gratitude row has been undone". It lives in the
// repo because that is where queries live, and it is imported rather than
// restated because the settlement reads it too: see its header.
import { REVERSED_GRATITUDE_FROM } from "../repos/gratitude";

/** Seeded by 0024. Named here rather than imported so this module does not
 *  depend on the library module being present. */
export const LIBRARY_MINT = "sys:library-mint";

// ── The tokens this build knows ─────────────────────────────────────────────

/** The recognition token, live since 0006. Reads as Gratitude everywhere a
 *  member can see it; the symbol keeps its old name to spare every call site. */
export const HEARTS = "gratitude";
/** The village's own voice token. Accrues here, settles on Hypha. */
export const VILLAGE_VOICE = "village-voice";
/**
 * The village's spendable value token, seeded by 0007 and the default the
 * cycle pool pays out. Named here for the same reason HEARTS is: a slug typed
 * as a bare string in four files is a slug that gets misspelled in a fifth,
 * and the ledger's repeat protection carries the SLUG, so a misspelling does
 * not fail loudly, it mints a token nobody has heard of.
 */
export const CREDITS = "credits";

/**
 * The village's word for the recognition token, for anything a member reads.
 *
 * THE REGISTRY IS THE SOURCE (Rye, 2026-08-14), the same rule `mergedConfig()`
 * follows on the way out to the client, so a rename in Admin then Tokens
 * reaches a refusal message and a ledger row description as well as a page.
 * Reading `HEARTS` (the slug) here would be wrong twice over: the slug never
 * moves, and a slug is not a word a member should be shown.
 *
 * The fallback is a generic noun and never the platform default word. A
 * missing registry entry means the load has not happened, and a village that
 * renamed its token to Seeds must not be told "Gratitude" on the way to being
 * told why its gift was refused.
 */
export function recognitionName(): string {
  return tokenDef(HEARTS)?.name?.trim() || "Recognition";
}

/** Faucets. A faucet's negative balance is that token's issued supply. */
export const VOICE_MINT = "sys:voice-mint";
/** Not a faucet: voice held against an open claim came from a member. */
export const VOICE_BRIDGE = "sys:voice-bridge";

/**
 * The village voice token, registered at boot the way stays and library
 * register theirs. `governance: 'platform'` is required and is the whole
 * reason this is a separate token from the `voice` row seeded in 0006: that
 * one is `governance: 'hypha'`, which `validateLeg` refuses to move and which
 * a boot invariant requires to have zero ledger rows. Voice has to ACCRUE
 * somewhere before it can be claimed, and a Hypha-governed mirror is by
 * definition not that place.
 */
export async function ensureVoiceToken(pool: Pool, displayName?: string): Promise<void> {
  const existing = tokenDef(VILLAGE_VOICE);
  if (existing) return;
  await registerToken(pool, {
    slug: VILLAGE_VOICE,
    // The founder's word for it. Village data, so the seed supplies it and a
    // fork that never chose one still gets something honest on the chip.
    name: displayName || "Village Voice",
    kind: "voice",
    governance: "platform",
    transferable: false,
    decimals: VOICE_DECIMALS,
  });
}

/**
 * Voice rides in thousandths, and every other token in whole units.
 *
 * `token_ledger.amount` is an INT with a CHECK that it is positive, and
 * `postTransfer` runs `Math.trunc` over what it is handed. A rule that mints
 * 0.1 voice therefore posts ZERO: not an error, not a refusal, just a member
 * who was never paid and a ledger that looks fine. The registry has carried a
 * `decimals` column since 0006 for exactly this, so voice stores 100 and
 * displays 0.1, the way the payments module has always handled money.
 *
 * Doing it the other way, widening the ledger's amount to a decimal, would
 * change the keystone every other module posts through and every invariant
 * proved over it. Minor units are the cheaper truth.
 */
export const VOICE_DECIMALS = 3;

/**
 * How finely this token is held, in one place.
 *
 * The fallback matters: the registry is loaded from the database, and voice is
 * the one token whose decimals a caller can reach before that load has
 * happened. Written out twice, the save-time guard in `queueRuleChange` could
 * have said "whole units" about a token the poster below scales by a thousand,
 * and refused a founder an amount that was perfectly payable.
 */
function decimalsOf(tokenSlug: string): number {
  return tokenDef(tokenSlug)?.decimals ?? (tokenSlug === VILLAGE_VOICE ? VOICE_DECIMALS : 0);
}

/** Human amount to ledger units. Rounds, because 0.1 * 1000 is not 100 in binary. */
/**
 * A number a human typed or set, into what the ledger stores.
 *
 * THE TWO HAND-MINT DIALS GO THROUGH HERE, and until 2026-09-04 they did not.
 * `ledger.admin_mint_cycle_cap` and `ledger.admin_mint_cosign_over` were
 * compared straight against a ledger amount. Every token in the registry but
 * Village Voice carries 0 decimals, where a whole token and a ledger unit are
 * the same number, so nothing looked wrong; Voice carries 3, so a cap of 10000
 * was enforcing 10 Voice per lunar cycle while the dial's own description said
 * "the most any admins can mint by hand". A founder reading the dial and a
 * founder hitting its refusal were reading two different quantities.
 */
export function toLedgerUnits(tokenSlug: string, human: number): number {
  return Math.round(Number(human) * 10 ** decimalsOf(tokenSlug));
}

/** Ledger units back to the number a member reads on their chip. */
export function fromLedgerUnits(tokenSlug: string, units: number): number {
  return Number(units) / 10 ** decimalsOf(tokenSlug);
}

// ── Village scope ───────────────────────────────────────────────────────────

/**
 * This deployment is one village. The constant exists so every idempotency key
 * and every economy query carries the scope from the first day: adding it later
 * means rewriting keys that have already minted value, which is the migration
 * nobody wants to write. `villageId()` is the ONE reader, so a real multi-
 * village build changes this file and not eighty call sites.
 */
export const LOCAL_VILLAGE = "local";
export function villageId(): string {
  return LOCAL_VILLAGE;
}

// ── Occurrence-scoped idempotency keys ──────────────────────────────────────

/**
 * A key names an OCCURRENCE, never a thing.
 *
 * `quest.completed:<quest>` would mint once per quest for all time: a weekly
 * quest pays its first week and nothing after, and eight people on a build day
 * share one payout. The claim row is the occurrence, so the claim id is in the
 * key, and the profile is in it too because two claimants are two mints.
 *
 * Every key carries the village. Two villages running the same seeded quest
 * must not collide on a UNIQUE index, and they would.
 */
/**
 * `token_ledger.idempotency_key` is varchar(191), and 191 is not a style
 * choice: it is what keeps the UNIQUE index inside utf8mb4's 767-byte prefix
 * limit (0009). An occurrence key built from three varchar(64) ids can exceed
 * that, and MySQL outside strict mode would TRUNCATE it, which is the worst
 * possible failure here: two different occurrences would truncate to the same
 * string, the second would read as a duplicate, and somebody would simply not
 * be paid. Real ids run 20 to 30 characters so this never fires in practice,
 * which is exactly why it has to be checked rather than assumed.
 */
export const MAX_KEY = 191;
/** `source_ref` is varchar(120). Prefix, so a LIKE on a key prefix still matches. */
export const MAX_SOURCE_REF = 120;

function keyTooLong(key: string): string | null {
  return key.length > MAX_KEY
    ? `occurrence key is ${key.length} characters and the ledger allows ${MAX_KEY}: ${key.slice(0, 60)}...`
    : null;
}

export const keys = {
  questCompleted: (v: string, questId: string, claimId: string, userId: string) =>
    `quest.completed:${v}:${questId}:${claimId}:${userId}`,
  gratitudeGiven: (v: string, noteId: string) => `gratitude.given:${v}:${noteId}`,
  /**
   * `cycleKey` is the canonical cycle id, and CHANGING ITS SPELLING PAYS
   * EVERY SEAT AGAIN. This key is what tells the ledger a seat has already
   * been thanked for this lunation; the settlement job asks hourly and relies
   * on the duplicate. When this file stopped writing `moon-329` and started
   * writing `lunar-000329`, every already-paid seat in the open lunation
   * would have looked unpaid, so `drizzle/0105_one_cycle_one_name.sql`
   * renames the historical keys in the same change. A future edit to this
   * format needs the same treatment or it mints value out of a rename.
   */
  roleCycle: (v: string, cycleKey: string, seatId: string, userId: string) =>
    `role.cycle:${v}:${cycleKey}:${seatId}:${userId}`,
  journeyStage: (v: string, journeyId: string, stage: string, userId: string) =>
    `journey.stage_reached:${v}:${journeyId}:${stage}:${userId}`,
  welcomeAboard: (v: string, questNo: number | string, userId: string) =>
    `welcome_aboard.quest:${v}:${questNo}:${userId}`,
  transfer: (v: string, transferRowId: string) => `transfer:${v}:${transferRowId}`,
  reversal: (v: string, eventKey: string) => `reversal:${v}:${eventKey}`,
  voiceClaim: (v: string, claimRowId: string) => `voice-claim:${v}:${claimRowId}`,
};

// ── The cycle ───────────────────────────────────────────────────────────────

/**
 * The lunation a moment falls in. The site owns this, and the map reads it.
 *
 * THIS FILE NO LONGER FORMATS A CYCLE ID. It used to, as `moon-329`, while
 * `server/lib/gratitude-cycles.ts` wrote `lunar-000329` for the same lunation
 * into the same `gratitude_log.cycle_id` column. Neither knew about the other,
 * so `give` below wrote one spelling, the acknowledgement flow's budget read
 * the other, and one member moved 130 in a moon whose two allowances were 100
 * and 30. The settlement, which only matches `lunar-`, then read 100 of those
 * 130 and told nobody about the rest.
 *
 * One function makes this string now, and it lives with the settlement that
 * has to read it back. Adding a second one here is the whole defect, so
 * `server/cycleId.test.ts` fails the moment `cycleWindow().key` and
 * `cycleIdFor()` stop being the same string.
 */
export function cycleKeyFor(at: Date = new Date()): string {
  return cycleIdFor(at);
}

export function cycleWindow(at: Date = new Date()): { startsAt: Date; endsAt: Date; key: string } {
  const c = currentCycle(at);
  return { startsAt: new Date(c.startsAt), endsAt: new Date(c.endsAt), key: c.id };
}

// ── The epoch ───────────────────────────────────────────────────────────────

/**
 * Confirmations recorded before the engine was switched on are HISTORY.
 *
 * Without this, the day the `economy` flag flips, every quest ever consented in
 * this village becomes an unpaid mint sitting in a source query, and the first
 * settlement pays out years of backlog at once. Nobody decided that; it would
 * simply be what the query returned.
 *
 * So every source query filters `confirmedAt >= economyEpoch`, and honouring
 * pre-epoch work is a deliberate, audited, keyed one-shot backfill an admin
 * runs on purpose. The default is the moment the epoch is first read and
 * written, which means "from now", which is the only safe default.
 */
let epochCache: Date | null = null;

/**
 * Start the engine's clock, once, and return where it stands.
 *
 * Kept separate from reading it because for one release the SAME call did
 * both, and the only caller was the mint. A brand new village therefore
 * confirmed its first quest, the mint asked for the epoch, the epoch did not
 * exist yet, so the mint stamped it at `now` and then measured the claim
 * against it. The claim had resolved twenty milliseconds earlier. It lost.
 *
 * That is once per village, forever, deterministically, on the FIRST piece of
 * work anybody in that village ever completes: the moment a founder is
 * watching hardest, the ledger showed Gratitude and no Village Credits and no
 * Village Voice, and the server said "confirmed before the economy epoch",
 * which is true and reads like a policy rather than the bug it was. Every
 * later quest paid correctly, so it never looked like a defect in the engine.
 *
 * `at` is the moment the clock should start FROM when it has not been started.
 * The mint passes the claim in hand, because a claim that finds no epoch is by
 * construction the first economic act this engine has seen, and the first act
 * starts the clock rather than being ruled out by it. Boot passes nothing and
 * gets `now`, which is what "the engine came up" means and is why in
 * production the mint never reaches its own fallback.
 *
 * Already stamped is the normal case and never moves. The stamp is the one
 * value in this module that must be write-once.
 */
export async function startEconomyEpoch(pool: Pool, at?: Date): Promise<Date> {
  if (epochCache) return epochCache;
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT `value` FROM `app_config` WHERE `config_key` = 'economy-state' LIMIT 1",
  );
  // `app_config.value` is a JSON column, so mysql2 has already parsed it and
  // hands back an object. `JSON.parse(String(obj))` parses "[object Object]",
  // throws, and lands in the catch, which re-stamps the epoch on EVERY read:
  // the one value that must never move would move every time it was asked for,
  // and pre-epoch work would drift back into scope moment by moment.
  let doc: any = {};
  const raw = rows[0]?.value;
  if (raw && typeof raw === "object") {
    doc = raw;
  } else if (typeof raw === "string" && raw) {
    try {
      doc = JSON.parse(raw);
    } catch {
      doc = {};
    }
  }
  if (doc.economyEpoch) {
    epochCache = new Date(doc.economyEpoch);
    return epochCache;
  }
  // Never later than now: a caller handing us a future `confirmedAt` from a
  // skewed clock must not push the epoch forward and rule out real work
  // between now and then.
  const now = new Date();
  const start = at && at < now ? at : now;
  doc.economyEpoch = start.toISOString();
  await pool.query(
    "INSERT INTO `app_config` (`config_key`, `value`) VALUES ('economy-state', ?) " +
      "ON DUPLICATE KEY UPDATE `value` = VALUES(`value`)",
    [JSON.stringify(doc)],
  );
  epochCache = start;
  return start;
}

/**
 * Where the clock stands, starting it at `now` if it has never been started.
 *
 * The historical name and the historical behaviour, kept because callers that
 * only want to READ an already-running engine are correct to use it. Anything
 * that also decides whether a specific piece of work counts must call
 * `startEconomyEpoch` with that work's moment instead. See above.
 */
export async function economyEpoch(pool: Pool): Promise<Date> {
  return startEconomyEpoch(pool);
}

/** Tests and the admin backfill reset the cache after writing the document. */
export function forgetEpoch(): void {
  epochCache = null;
}

// ── The flag, and why a boolean is not enough ───────────────────────────────

/**
 * The `economy` flag being on is NOT sufficient to mint.
 *
 * A village whose flag is on but whose token types and mint rules were never
 * seeded has an engine that reads every rule as absent. Every trigger then
 * silently mints nothing, the village believes the economy is running, and the
 * failure only surfaces as an absence, which is the hardest kind to notice.
 * So the write paths ask for BOTH: the flag, and the seeds it needs.
 */
export async function economyReady(pool: Pool): Promise<{ ready: boolean; reason?: string }> {
  const [rules] = await pool.query<RowDataPacket[]>(
    "SELECT COUNT(*) AS n FROM `mint_rules` WHERE `village_id` = ? AND `enabled` = 1",
    [villageId()],
  );
  if (Number(rules[0]?.n ?? 0) === 0) {
    return { ready: false, reason: "no enabled mint rules are seeded for this village" };
  }
  if (!tokenDef(HEARTS)) {
    return { ready: false, reason: "the recognition token is not registered" };
  }
  return { ready: true };
}

// ── Rules ───────────────────────────────────────────────────────────────────

export interface MintRule {
  id: string;
  trigger: string;
  tokenSlug: string;
  /** null means "read it from the source", clamped to `ceiling`. */
  amount: number | null;
  ceiling: number;
  recipient: string;
  enabled: boolean;
  effectiveFromCycle: number;
}

function rowToRule(r: RowDataPacket): MintRule {
  return {
    id: String(r.id),
    trigger: String(r.trigger),
    tokenSlug: String(r.token_slug),
    amount: r.amount === null || r.amount === undefined ? null : Number(r.amount),
    ceiling: Number(r.ceiling ?? 0),
    recipient: String(r.recipient ?? "claimant"),
    enabled: !!r.enabled,
    effectiveFromCycle: Number(r.effective_from_cycle ?? 0),
  };
}

/**
 * The rules for one trigger, as of a cycle.
 *
 * `effective_from_cycle` is what stops a rule being raised, paid against, and
 * lowered again around a settlement. A settlement closing cycle N reads the
 * rules that were already in force at N, so an edit made during N applies to
 * N+1 and the closing cycle settles under the rules it ran under.
 */
export async function rulesFor(pool: Pool, trigger: string, atCycle?: number): Promise<MintRule[]> {
  const cycle = atCycle ?? currentCycleNumber(new Date());
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT * FROM `mint_rules` WHERE `village_id` = ? AND `trigger` = ? AND `enabled` = 1 " +
      "AND `effective_from_cycle` <= ?",
    [villageId(), trigger, cycle],
  );
  return rows.map(rowToRule);
}

// ── The one guarded write ───────────────────────────────────────────────────

export interface MintInput {
  /** Who receives it. */
  toUserId: string;
  tokenSlug: string;
  amount: number;
  /** The faucet this token issues from. */
  from: string;
  /** Machine-readable origin, e.g. "quest_consent". */
  source: string;
  sourceRef?: string;
  description?: string;
  /** Occurrence-scoped, from `keys`. */
  idempotencyKey: string;
}

export type MintOutcome =
  | { ok: true; duplicate: boolean; balance: number }
  | { ok: false; error: string };

/**
 * Mint, once, with every guard applied.
 *
 * A duplicate key is SUCCESS, not an error: it means this occurrence already
 * paid, which is exactly what the caller wanted to be true. Reporting it as a
 * failure teaches retries to do something worse.
 */
export async function mint(pool: Pool, input: MintInput): Promise<MintOutcome> {
  const amount = Number(input.amount);

  // Amount > 0 for every non-reversal. A negative "gift" is an attack: it
  // would debit the person being thanked. Zero is a no-op wearing a ledger row.
  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, error: "amount must be greater than zero" };
  }
  const def = tokenDef(input.tokenSlug);
  if (!def) {
    return { ok: false, error: `unknown token "${input.tokenSlug}"` };
  }
  if (def.governance !== "platform") {
    return { ok: false, error: `${input.tokenSlug} is governed on Hypha and is only mirrored here` };
  }
  if (!input.idempotencyKey) {
    return { ok: false, error: "an occurrence key is required" };
  }
  const tooLong = keyTooLong(input.idempotencyKey);
  if (tooLong) return { ok: false, error: tooLong };

  const res: TransferResult = await postTransfer(pool, {
    from: input.from,
    to: memberAccount(input.toUserId),
    tokenType: input.tokenSlug,
    amount,
    source: input.source,
    sourceRef: input.sourceRef,
    description: input.description,
    idempotencyKey: input.idempotencyKey,
  });
  if (!res.ok && !res.duplicate) return { ok: false, error: res.error ?? "the ledger refused the post" };
  return { ok: true, duplicate: res.duplicate, balance: res.toBalance };
}

/**
 * Clamp a from_source amount to its rule's ceiling.
 *
 * A rule that mints a number somebody else typed, with no ceiling, is an open
 * faucet with a form in front of it. The ceiling is not advisory and it is not
 * nullable-as-unlimited: 0 means zero, which is the same fail-closed reading
 * the swap caps use.
 */
export function clampToCeiling(posted: number, rule: MintRule): number {
  const asked = Number(posted);
  if (!Number.isFinite(asked) || asked <= 0) return 0;
  if (rule.amount !== null) return rule.amount;
  return Math.min(asked, rule.ceiling);
}

// ── Reversal ────────────────────────────────────────────────────────────────

/**
 * Undo one posting with a mirror that has its own key.
 *
 * Three rules, each of which is a way this goes wrong:
 *
 *  - a reversal carries its OWN idempotency key, so reversing twice writes one
 *    mirror and the second call is a duplicate rather than a second refund;
 *  - a reversal may not be reversed, or two calls alternate forever and each
 *    one looks locally reasonable;
 *  - an already-reversed posting may not be reversed again.
 *
 * Refunds are always reversals. Never a fresh mint: a mint would inherit none
 * of these guards and would be a way to make the token it claims to return.
 *
 * ── THE MIRROR IS READ OFF THE ORIGINAL ROW, NEVER TAKEN FROM THE CALLER ──
 *
 * This used to take `from`, `to`, `tokenSlug` and `amount` from its caller and
 * check only that SOME row carried the original key. So it would reverse a
 * 25-credit posting as a 1,000,000-credit payment to the same member, in a
 * different token, in either direction, and nothing would notice: conservation
 * still balances, because a mirror is two legs, and the audit reads "reversal
 * of <key>" and believes it. An audit did exactly that and every invariant
 * stayed green.
 *
 * Money that can be created has to be correctable. But a correction that can
 * invent its own amount is not a correction, it is a mint with a nicer name.
 * So the four numbers are DERIVED from the row the key names — amount, token,
 * and both accounts, swapped — and a caller value that disagrees is refused
 * rather than quietly overridden. Refused, because a caller passing a
 * different amount believes something false about what it is undoing, and
 * correcting it silently would leave that belief in place.
 *
 * The caller's fields are therefore OPTIONAL and are only ever an assertion.
 * Callers that pass them get them checked; callers that pass nothing get the
 * true mirror.
 */
export async function reverse(
  pool: Pool,
  originalKey: string,
  opts: { from?: string; to?: string; tokenSlug?: string; amount?: number; note?: string } = {},
): Promise<MintOutcome> {
  if (originalKey.startsWith("reversal:")) {
    return { ok: false, error: "a reversal cannot itself be reversed" };
  }
  const mirrorKey = keys.reversal(villageId(), originalKey);
  const tooLong = keyTooLong(mirrorKey);
  if (tooLong) return { ok: false, error: tooLong };

  // The row, not its existence. Everything the mirror posts comes from here.
  const [orig] = await pool.query<RowDataPacket[]>(
    "SELECT `from_account`, `to_account`, `token_type`, `amount` FROM `token_ledger` " +
      "WHERE `idempotency_key` = ? LIMIT 1",
    [originalKey],
  );
  if (!orig.length) {
    return { ok: false, error: "there is no such posting to reverse" };
  }

  // The mirror runs the opposite way: what the original credited, this debits.
  const from = String(orig[0].to_account);
  const to = String(orig[0].from_account);
  const tokenSlug = String(orig[0].token_type);
  const amount = Number(orig[0].amount);

  const disagreement =
    opts.amount !== undefined && Number(opts.amount) !== amount
      ? `this posting moved ${amount} and a reversal of ${Number(opts.amount)} was asked for`
      : opts.tokenSlug !== undefined && opts.tokenSlug !== tokenSlug
        ? `this posting moved ${tokenSlug} and a reversal in ${opts.tokenSlug} was asked for`
        : opts.from !== undefined && opts.from !== from
          ? `this posting credited ${from} and a reversal out of ${opts.from} was asked for`
          : opts.to !== undefined && opts.to !== to
            ? `this posting was sent by ${to} and a reversal back to ${opts.to} was asked for`
            : null;
  if (disagreement) {
    return { ok: false, error: `a reversal undoes exactly what was posted: ${disagreement}` };
  }

  const res = await postTransfer(pool, {
    from,
    to,
    tokenType: tokenSlug,
    amount,
    source: "reversal",
    /*
     * A CLAWBACK OF ALREADY-SPENT VALUE MUST BE ABLE TO COMPLETE.
     *
     * The account this debits may have spent what it was wrongly given.
     * Without this the overdraft check refuses the whole correction, the
     * mistaken credit stands, and the only remaining repair is a hand-written
     * ledger row. With it, the correction lands and the member's balance goes
     * negative by whatever they had already spent — which is the true
     * statement of what they hold, is carried in the balance every surface
     * reads rather than in a suspense account beside it, and clears itself as
     * they earn. `reversal` is in ALLOW_NEGATIVE_SOURCES for exactly this;
     * see the note on that set.
     */
    allowNegative: true,
    /*
     * THE KEY THIS UNDOES, clipped only because `source_ref` is varchar(120)
     * and a quest occurrence key can run past it (`idempotency_key` allows
     * 191). The whole key also rides in the description below, so a human
     * reading the row can find what was undone even when it was clipped.
     *
     * IT IS ALSO A JOIN COLUMN NOW. `REVERSED_GRATITUDE_FROM`
     * (server/repos/gratitude.ts) walks from this mirror back to the posting
     * it undoes by matching this against that posting's `idempotency_key`, so
     * a key long enough to be clipped here is a key that walk cannot follow.
     * Every gratitude key is under 50 characters and its own test holds that
     * shut; nothing over 120 has ever been reversed. A future key that could
     * exceed it needs the walk keyed on something else, not a wider slice.
     */
    sourceRef: originalKey.slice(0, MAX_SOURCE_REF),
    description: opts.note ? `${opts.note} (${originalKey})` : originalKey,
    idempotencyKey: mirrorKey,
  });
  if (!res.ok && !res.duplicate) return { ok: false, error: res.error ?? "the ledger refused the reversal" };
  return { ok: true, duplicate: res.duplicate, balance: res.toBalance };
}

/** Has this posting already been mirrored? */
export async function isReversed(pool: Pool, originalKey: string): Promise<boolean> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT 1 FROM `token_ledger` WHERE `idempotency_key` = ? LIMIT 1",
    [keys.reversal(villageId(), originalKey)],
  );
  return rows.length > 0;
}

// ── Gratitude, and the allowance that is never stored ───────────────────────

export interface Allowance {
  total: number;
  spent: number;
  remaining: number;
  cycleKey: string;
}

/**
 * How much a member's stage multiplies the base allowance.
 *
 * Injected, and REQUIRED, because the stage rules live in the host: they read
 * in-memory training and membership repos and a MySQL quest count, none of
 * which this module can see. A default of 1 here would be a fallback inventing
 * an allowance for a member whose stage nobody looked up, and every caller of
 * `give` already holds what it takes to answer honestly.
 */
export type StageMultiplierFor = (userId: string) => Promise<number>;

/**
 * What a member may still give this moon, COMPUTED from what they have given.
 *
 * A stored counter is the bug. It drifts, it survives a reversal that should
 * have refunded it, and two concurrent gives both read the same stale number
 * and both pass. The sum of this cycle's gifts, minus this cycle's reversals of
 * those gifts, is the only figure that is true by construction: reversing a
 * gift refunds the allowance because the subtraction stops counting it, with
 * nothing to remember to do.
 *
 * `conn` is not optional in the write path. Read this OUTSIDE the mint's
 * transaction and five simultaneous gives all read the same remaining balance
 * and all commit. It has to be read under the same lock that writes.
 */
export async function allowanceFor(
  conn: Pool | PoolConnection,
  userId: string,
  stageMultiplier: number,
  at: Date = new Date(),
): Promise<Allowance> {
  const { startsAt, endsAt, key } = cycleWindow(at);
  // ONE ALLOWANCE (R73). This read the engine's own flat
  // `economy.giving_allowance_per_moon` (30) while the acknowledgement flow
  // read `gratitude.base_budget` times the giver's stage multiplier (100 and
  // up). Both sum their spending out of the same `gratitude_log` rows, so the
  // two totals were two answers to one question and the stricter one silently
  // won for anyone who used that door.
  //
  // The multiplier is a NUMBER the caller has already resolved, never a
  // resolver this function calls: `give` reads it before it opens its
  // SERIALIZABLE transaction, so nothing here reaches for a second pooled
  // connection while holding a lock on the first.
  const total = Math.round(numberVar("gratitude.base_budget") * stageMultiplier);

  const [rows] = await conn.query<RowDataPacket[]>(
    "SELECT COALESCE(SUM(`amount`), 0) AS given FROM `gratitude_log` " +
      "WHERE `village_id` = ? AND `from_id` = ? AND `at` >= ? AND `at` < ?",
    [villageId(), userId, startsAt, endsAt],
  );
  const given = Number(rows[0]?.given ?? 0);

  /*
   * ── WHAT A REVERSAL HANDS BACK, AND TO WHOM, AND IN WHICH CYCLE ──────────
   *
   * The same rows as the sum above, narrowed to the ones that have been
   * undone. That is the whole shape of the fix: `back` is now a subset of
   * `given` by construction, so the subtraction can only ever cancel gifts
   * this member actually made in this window.
   *
   * IT USED TO BE A SEPARATE SUM OVER `token_ledger`, and it filtered on
   * neither the giver nor the gift. Any reversal anywhere in the village
   * reduced the computed spend of EVERY member for the window, so one
   * correction handed every other member a refund of somebody else's gift.
   * Two members, one reversal, and the second member's allowance moved:
   * `server/lib/economy.allowance.test.ts` drives exactly that.
   *
   * ── AND IT WAS WINDOWED ON THE REVERSAL'S OWN TIMESTAMP, WHICH IS A CHOICE
   *
   * `t.at` was the mirror posting's `at`, so reversing a gift made three moons
   * ago refunded allowance in the CURRENT moon — allowance that had never been
   * spent here — and reversing this moon's gift a day after the boundary
   * refunded nothing at all. Both readings cannot be right, so this picks one
   * and says which:
   *
   *   AN ALLOWANCE IS SPENT IN THE CYCLE THE GIFT WAS MADE, SO A REFUND
   *   BELONGS TO THAT CYCLE TOO.
   *
   * The allowance is a per-cycle budget and the note row is what charges it
   * (`writeGratitudeRow` computes this sum and writes that row under one
   * lock). A correction says the charge should not have happened, so it
   * unwinds the charge where the charge landed. The window is therefore
   * `g.at`, the GIFT's timestamp, and the mirror's own timestamp is not read
   * at all — undoing a gift from a closed moon correctly changes nothing
   * about this one, and undoing this moon's gift returns this moon's budget
   * the moment it happens, however long the correction took to arrive.
   *
   * The reading it rejects — refund in the cycle the correction lands in —
   * would let a village hand out allowance that no cycle had ever budgeted,
   * by reversing old gifts, and would make a member's remaining budget depend
   * on when an administrator got round to fixing something.
   *
   * `REVERSED_GRATITUDE_FROM` is shared with the settlement so the two cannot
   * drift about what "reversed" means; its own header carries why it walks
   * mirror → posting → note instead of matching a key prefix.
   */
  const [reversed] = await conn.query<RowDataPacket[]>(
    "SELECT COALESCE(SUM(g.`amount`), 0) AS back " +
      REVERSED_GRATITUDE_FROM +
      " AND g.`village_id` = ? AND g.`from_id` = ? AND g.`at` >= ? AND g.`at` < ?",
    [villageId(), userId, startsAt, endsAt],
  );
  const back = Number(reversed[0]?.back ?? 0);

  // The floor is now belt and braces rather than the load-bearing thing it
  // was: both sums run over the same window, the same village and the same
  // giver, so `back` cannot exceed `given`. It used to be the only reason a
  // village-wide reversal did not report a NEGATIVE spend, which is exactly
  // how a defect this large stayed invisible: it clamped to a plausible
  // number instead of an impossible one.
  const spent = Math.max(0, given - back);
  return { total, spent, remaining: Math.max(0, total - spent), cycleKey: key };
}

export interface GiveInput {
  fromUserId: string;
  toUserId: string;
  amount: number;
  note?: string;
  tag?: string;
  structureKey?: string;
  /** A quiet gift shows publicly as "someone, quietly". */
  quiet?: boolean;
  /** The client's key for one tap of the give button. */
  clientNonce?: string;
}

/**
 * The most one member may put on ONE other member this cycle (R73).
 *
 * A fraction of the giver's own allowance, so it means the same thing at 105
 * and at 525 and a village that doubles `gratitude.base_budget` does not
 * silently double how much of one person's standing can come from one
 * relationship.
 *
 * THE DIAL IS THE COUNT NOW, and this comment used to argue for it before the
 * registry caught up: "a cap of 1/N is the sentence 'at least N people' written
 * as one number." It was carrying a percentage and dividing it back out, which
 * is the same arithmetic with a worse unit on the founder's screen. 25% and
 * "4 people" are the same rule, and only one of them is a sentence anybody
 * says out loud. `gratitude.full_sends_per_cycle` is N directly, so the
 * division happens once, here, and the hearts a member sees on the wall are
 * this same N rather than a second figure that could drift from it.
 *
 * Sending to MORE than N people stays allowed, because this bounds the amount
 * one person may receive and never the number of sends. Past N the allowance
 * is simply spread thinner, which is the honest shape of a wider circle.
 *
 * The floor of 1 is a bound, never a guess: an allowance of 5 across 7 sends
 * rounds to zero, and a zero here would refuse every send in the village while
 * both dials still read as sane numbers. It is stated on the dial itself.
 *
 * LIVES HERE, not in `server/lib/gratitude.ts`, as of the concurrency fix
 * below: this file is the guarded engine both gratitude doors write through
 * now, and `gratitude.ts` re-exports this symbol so nothing importing it from
 * there (server/lib/dryRun.ts among them) had to change. Two channels, one
 * ceiling, computed in one place so they cannot drift apart the way the caps
 * they replaced did.
 */
export function shareCapFor(allowanceTotal: number): number {
  if (allowanceTotal <= 0) return 0;
  // Guarded rather than trusted: the dial's own min is 1, and a village that
  // reaches the column some other way must not divide by zero and hand every
  // member an Infinity ceiling, which reads as "no limit" and is the one
  // failure this function exists to prevent.
  const fullSends = Math.max(1, Math.floor(numberVar("gratitude.full_sends_per_cycle")));
  return Math.max(1, Math.floor(allowanceTotal / fullSends));
}

/**
 * How many full-strength gifts this allowance holds, which is what the wall
 * draws as hearts.
 *
 * Derived from the cap rather than read off the dial, and that is the whole
 * point. `shareCapFor` floors, so an allowance of 100 across 7 sends gives a
 * ceiling of 14 and SEVEN of those is 98: the dial says 7 and the allowance
 * genuinely holds 7. But an allowance of 5 across 7 sends floors the ceiling
 * to the bound of 1, and five 1s is all there is, so the honest answer is 5
 * and not the 7 on the dial. Reading the dial directly would have drawn two
 * hearts a member could never fill, which is the displayed-number-versus-
 * actual-behaviour defect this codebase keeps finding.
 *
 * ── IT IS NOT `spreadsAcross`, AND THEY MUST NOT BE RECONCILED ───────────
 *
 * server/lib/dryRun.ts computes `ceil(allowance / cap)` and calls it
 * `spreadsAcross`. The two disagree whenever the allowance does not divide
 * evenly, and both are right, because they answer different questions:
 *
 *   fullSendsIn    how many FULL-STRENGTH gifts the allowance holds.
 *                  100 across 7 is 7, each of 14, and 2 are left over.
 *   spreadsAcross  how many PEOPLE it takes to spend the allowance to zero.
 *                  100 across 7 is 8, because somebody has to take the last 2.
 *
 * The wall draws this one as hearts, because the dial is named after full
 * sends and a heart is one of them. A future reader finding the mismatch
 * should not make them agree; they should check that neither is wearing the
 * other's words, which is the bug that actually shipped once: the hearts row
 * borrowed "the fewest who can take your whole allowance" and was false in six
 * of ten plausible dial settings.
 */
export function fullSendsIn(allowanceTotal: number): number {
  const cap = shareCapFor(allowanceTotal);
  if (cap <= 0) return 0;
  return Math.min(
    Math.max(1, Math.floor(numberVar("gratitude.full_sends_per_cycle"))),
    Math.floor(allowanceTotal / cap),
  );
}

/**
 * The refusals a gift can meet, in the order they are checked.
 *
 * Order is part of the contract: the most specific and most private reason
 * wins, so a member is told the useful thing rather than the first thing.
 */
export function checkGive(
  input: GiveInput,
  allowance: Allowance,
  alreadyToThisPerson: number,
): { ok: true } | { ok: false; error: string } {
  const amount = Number(input.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, error: `Give ${recognitionName()} in whole positive hearts` };
  }
  // Self-gratitude is blocked, and it is blocked HERE rather than at the route,
  // so every future caller inherits it. Thanking yourself mints standing out of
  // nothing, which is the cheapest possible attack on a reputation number.
  if (input.fromUserId === input.toUserId) {
    return { ok: false, error: `Send ${recognitionName()} to others` };
  }
  if (amount > allowance.remaining) {
    return { ok: false, error: `You can still give ${allowance.remaining} this moon` };
  }
  // THE SAME per-recipient rule the acknowledgement flow applies, computed by
  // the same function (R73). This used to read the engine's own
  // `economy.hearts_per_recipient_per_moon`, a flat 10 that meant one thing at
  // an allowance of 30 and something else entirely at 500. A share is
  // stage-proof and edit-proof.
  const cap = shareCapFor(allowance.total);
  if (alreadyToThisPerson + amount > cap) {
    const left = Math.max(0, cap - alreadyToThisPerson);
    return {
      ok: false,
      error:
        `${cap} is the most you can give one person this moon, and you have given them ` +
        `${alreadyToThisPerson}. That leaves ${left} for them`,
    };
  }
  return { ok: true };
}

// ── The one lock every gratitude write holds ────────────────────────────────

export interface GratitudeRowInput {
  fromUserId: string;
  toUserId: string;
  amount: number;
  /** 'gratitude' (default: a budgeted acknowledgment) or 'heart' (D5: a tap
   *  on content). Anything else is carried as given; only these two are read
   *  anywhere else in the build today. */
  kind?: string;
  message?: string;
  fromName?: string | null;
  toName?: string | null;
  contextType?: string | null;
  contextRef?: string | null;
  tag?: string | null;
  structureKey?: string | null;
  quiet?: boolean;
  clientNonce?: string | null;
}

/**
 * Runs INSIDE the lock, after the allowance and the running per-recipient
 * total are read and before anything is written, so a caller's OWN rules
 * (a value cap, a per-kind tap count, whatever it needs) ride the same
 * transaction the write does. Receives the open connection so it may run
 * further reads of its own without leaving the lock to do it.
 */
export type GratitudeRowGuard = (
  conn: PoolConnection,
  allowance: Allowance,
  alreadyToThisPerson: number,
) => Promise<{ ok: true } | { ok: false; error: string; status?: number }>;

/**
 * THE DELIVERY, run INSIDE the note's own transaction.
 *
 * A gratitude note is the CHARGE — the allowance is a SUM over
 * `gratitude_log`, so writing the row spends the budget — and the ledger
 * posting is the DELIVERY. Handing this in makes the two one commit: both, or
 * neither, and no window between them for anything to fail in. Return a
 * refusal and the note is rolled back with it, so a member is never charged
 * for a gift that did not arrive.
 *
 * Optional, because the acknowledgement door (`sendGratitude`) still posts
 * after this returns. Its window is documented at its own call site.
 */
export type GratitudeRowPost = (
  conn: PoolConnection,
  noteId: string,
) => Promise<{ ok: true; duplicate?: boolean; balance?: number } | { ok: false; error: string; status?: number }>;

export type GratitudeRowResult =
  | {
      ok: true;
      noteId: string;
      allowance: Allowance;
      /** What `post` reported, when one was supplied. */
      posted?: { duplicate: boolean; balance: number };
    }
  | { ok: false; error: string; duplicate?: boolean; allowance?: Allowance; status?: number };

/**
 * What a member is told when the driver speaks instead of the engine.
 *
 * Before this, `writeGratitudeRow`'s catch returned `String(err.message)`
 * straight to the route, and the route returned it to the browser. Two members
 * pressing "thank" at the same moment were handed "Deadlock found when trying
 * to get lock; try restarting transaction" as a 400 — the storage engine's
 * words, in a village, about a gift. Anything the engine did not decide gets
 * one written sentence, and the real error goes to the log where it is useful.
 */
function unwritableGratitude(err: unknown): string {
  const code = String((err as any)?.code ?? "");
  console.error("[gratitude] the write failed:", err);
  if (code === "ER_LOCK_DEADLOCK" || code === "ER_LOCK_WAIT_TIMEOUT") {
    return "The village was busy for a moment, so your thanks did not go through. Nothing was charged. Send it again.";
  }
  return "Your thanks could not be recorded, and nothing was charged. Try again in a moment.";
}

/** Deadlocks and lock-wait timeouts: the two an identical retry can heal. */
function isLockContention(err: unknown): boolean {
  const code = String((err as any)?.code ?? "");
  return code === "ER_LOCK_DEADLOCK" || code === "ER_LOCK_WAIT_TIMEOUT";
}

/**
 * THE ONE LOCK. Both gratitude doors write through here now: `give()` below
 * (the Hearts economy, `/api/gratitude`), and `sendGratitude()`
 * (server/lib/gratitude.ts: the acknowledgment flow at
 * `/api/game/gratitude/send`, and D5's forum hearts).
 *
 * Before this, the two doors ran the identical SHAPE of check (read the
 * allowance, read the per-recipient total, write the row) as three separate
 * statements each, in two files that had to be kept in step by hand. This
 * door's own `FOR UPDATE` already made IT safe; the other door had nothing
 * holding the giver's row between its reads and its write, so five
 * acknowledgments arriving together could each read the same "nothing spent
 * yet" snapshot and each commit, moving more value than the cycle's allowance
 * ever promised, and doing the identical thing to the per-recipient
 * concentration cap. Teaching the second door to grow its own lock would have
 * been a second implementation to keep in step, forever, which is exactly the
 * shape of bug R73 already spent a round closing for the LIMITS these two
 * doors apply. So there is one lock, imported, not one lock, copied.
 *
 * A row that does not exist cannot be locked, and `FOR UPDATE` over an empty
 * result takes nothing while looking exactly like success. That would make
 * every guard advisory for an unknown giver, so the absence is a refusal
 * rather than a quiet pass.
 */
export async function writeGratitudeRow(
  pool: Pool,
  input: GratitudeRowInput,
  stageMultiplier: number,
  guard: GratitudeRowGuard,
  post?: GratitudeRowPost,
): Promise<GratitudeRowResult> {
  /*
   * THE RETRY. A rolled-back transaction wrote nothing at all — no note, no
   * ledger row, no nonce — so running it again is the same act arriving a
   * moment later, not a second gift. Three attempts, because a case that
   * needs a fourth is a real problem and should be seen rather than absorbed
   * as latency. Same shape and same reason as `postTransferPair`'s.
   */
  for (let attempt = 1; ; attempt++) {
    try {
      return await writeGratitudeRowOnce(pool, input, stageMultiplier, guard, post);
    } catch (err) {
      if (!isLockContention(err) || attempt >= 3) {
        return { ok: false, error: unwritableGratitude(err) };
      }
      await new Promise((r) => setTimeout(r, 25 * attempt + Math.floor(Math.random() * 25)));
    }
  }
}

async function writeGratitudeRowOnce(
  pool: Pool,
  input: GratitudeRowInput,
  stageMultiplier: number,
  guard: GratitudeRowGuard,
  post?: GratitudeRowPost,
): Promise<GratitudeRowResult> {
  const conn = await pool.getConnection();
  try {
    /*
     * REPEATABLE READ, AND THE `FOR UPDATE` BELOW IS WHAT MAKES IT SAFE.
     *
     * This ran at SERIALIZABLE, which is not a stronger version of the lock
     * on the next line — it is a different mechanism with a different reach.
     * SERIALIZABLE turns every plain SELECT into a locking read, so the two
     * SUMs below took gap locks across a RANGE of `gratitude_log`, and the
     * range every giver in the village reads overlaps. Two members thanking
     * somebody at the same moment each held a range the other needed to
     * insert into, and InnoDB killed one of them. Measured: at 12 concurrent
     * givers, 10 failed, and the member was shown the driver's own words.
     *
     * The lock that actually matters is the row lock on the GIVER, taken
     * immediately below. Every write that can move this giver's spending goes
     * through this function and must hold that row first, so a giver is still
     * perfectly serialised against themselves and the allowance is still
     * exactly enforced. What SERIALIZABLE added on top of that was not
     * safety, it was every OTHER member's gift.
     *
     * The read view is established by the first consistent read AFTER the
     * `FOR UPDATE` returns, so the SUMs see every gift committed before this
     * transaction got the giver's row — which is every gift that could
     * possibly count against it.
     *
     * `server/economy.test.ts` holds both halves: 12 different members all
     * land, and one member firing 40 gives against a 100 allowance spends
     * exactly 100.
     */
    await conn.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ"); // module-review-ok: a session isolation setting, not a table read. It has no rows and no repo it could live in, and it must run on THIS connection immediately before this transaction opens.
    await conn.beginTransaction();

    // The lock. Everything after this reads a world nobody else can move.
    const [giver] = await conn.query<RowDataPacket[]>(
      "SELECT `id` FROM `users` WHERE `id` = ? FOR UPDATE",
      [input.fromUserId],
    );
    if (!giver.length) {
      await conn.rollback();
      return { ok: false, error: "no such member" };
    }

    const allowance = await allowanceFor(conn, input.fromUserId, stageMultiplier);
    const { startsAt, endsAt, key } = cycleWindow();
    const [pair] = await conn.query<RowDataPacket[]>(
      "SELECT COALESCE(SUM(`amount`), 0) AS n FROM `gratitude_log` " +
        "WHERE `village_id` = ? AND `from_id` = ? AND `to_id` = ? AND `at` >= ? AND `at` < ?",
      [villageId(), input.fromUserId, input.toUserId, startsAt, endsAt],
    );
    const alreadyToThisPerson = Number(pair[0]?.n ?? 0);

    const verdict = await guard(conn, allowance, alreadyToThisPerson);
    if (!verdict.ok) {
      await conn.rollback();
      return { ok: false, error: verdict.error, allowance, status: verdict.status };
    }

    const noteId = `grat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    try {
      await conn.query(
        "INSERT INTO `gratitude_log` " +
          "(`id`, `village_id`, `kind`, `from_id`, `from_name`, `to_id`, `to_name`, `amount`, `message`, " +
          " `context_type`, `context_ref`, `cycle_id`, `cycle_number`, `tag`, `structure_key`, `quiet`, `client_nonce`) " +
          "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        [
          noteId,
          villageId(),
          input.kind ?? "gratitude",
          input.fromUserId,
          input.fromName ?? null,
          input.toUserId,
          input.toName ?? null,
          input.amount,
          input.message ?? "",
          input.contextType ?? null,
          input.contextRef ?? null,
          key,
          parseCycleId(key),
          input.tag ?? null,
          input.structureKey ?? null,
          input.quiet ? 1 : 0,
          input.clientNonce ?? null,
        ],
      );
    } catch (err: any) {
      await conn.rollback();
      // Either unique index can speak here: the client-nonce dedupe (give's
      // door) or the one-heart-per-sender-per-content index (D5's tap). Which
      // one fired is unambiguous per caller: each caller writes into exactly
      // one of the two column pairs the two indexes key on, never both, so
      // the caller already knows which message belongs to its own duplicate.
      if (String(err?.code) === "ER_DUP_ENTRY") {
        return { ok: false, error: "duplicate", duplicate: true, allowance };
      }
      throw err;
    }

    /*
     * THE DELIVERY, BEFORE THE COMMIT.
     *
     * The row above is the charge. If the credit that pays for it is posted
     * after this transaction commits — which is what `give()` used to do — a
     * failure there leaves the allowance spent and nothing delivered, and no
     * surface in the product can see it, because nothing was written out of
     * balance. Nothing was written at all.
     *
     * Running it here makes charge and delivery one commit. A refusal rolls
     * back the note with it: the member keeps their budget and is told why,
     * which is a worse minute and a better outcome than a gift that silently
     * never lands.
     */
    let posted: { duplicate: boolean; balance: number } | undefined;
    if (post) {
      const delivered = await post(conn, noteId);
      if (!delivered.ok) {
        await conn.rollback();
        return { ok: false, error: delivered.error, allowance, status: delivered.status };
      }
      posted = { duplicate: !!delivered.duplicate, balance: Number(delivered.balance ?? 0) };
    }

    await conn.commit();
    return { ok: true, noteId, allowance, posted };
  } catch (err: any) {
    try {
      await conn.rollback();
    } catch {
      /* the transaction is already gone */
    }
    // Lock contention is the retry wrapper's to decide about, so it is
    // rethrown rather than turned into a refusal here. Everything else has
    // already failed for good, and the member gets a sentence rather than
    // whatever the driver happened to say.
    if (isLockContention(err)) throw err;
    return { ok: false, error: unwritableGratitude(err) };
  } finally {
    conn.release();
  }
}

/**
 * Give, with the allowance read AND the note written under one lock.
 *
 * The note row is what the allowance is computed from, so writing it inside
 * the locked transaction is the whole mechanism. Five simultaneous gives
 * serialise on the giver's row: each one reads an allowance that already
 * counts the gifts committed before it, so the fifth is refused by arithmetic
 * rather than by luck. Reading the allowance and writing the note in separate
 * transactions would let all five read the same remaining balance and all five
 * commit, which is the bug this shape exists to make impossible.
 *
 * Since the concurrency fix above, the lock itself lives in
 * `writeGratitudeRow` and this function is the Hearts economy's caller of it:
 * `checkGive` supplies the guard, `kind` is always `'gratitude'`, and no
 * context is ever carried. `sendGratitude` (server/lib/gratitude.ts) is the
 * other caller.
 *
 * The ledger post happens AFTER the commit, on purpose, and the order is the
 * conservative one. The note row consumes the allowance, so a crash between
 * the two leaves an allowance spent and no hearts minted, which is visible and
 * keyed. The other order would mint hearts that no allowance had paid for,
 * which is the failure that costs something.
 *
 * ── A RETRY DOES NOT HEAL IT, AND THIS COMMENT USED TO SAY IT DID ───────────
 *
 * The claim was "healed by a retry, because the mint is idempotent on the note
 * id". The mint IS idempotent on the note id, and that is not the same
 * sentence: a retry runs this function again and mints a NEW note id, so it is
 * a new key, a new row and a second charge against the allowance. Nothing in
 * this product ever re-posts an existing note (`keys.gratitudeGiven` has one
 * call site, below), so the orphaned row stays orphaned.
 *
 * ── WHICH TURNED A CRASH WINDOW INTO AN EVERY-TIME BUG ──────────────────────
 *
 * `postTransfer` refuses every faucet posting until the village's launch vote
 * carries (R67, `issuanceRefusal`), and the route above this gates on
 * `economyReady` rather than on that. So for a founder setting up their Game,
 * which is EVERY village until it launches, the post was not unlikely to fail.
 * It failed every time: the note committed, the allowance was spent, the
 * recipient got nothing, and the record said a gift had been given.
 *
 * So the question is asked BEFORE the note is taken. Refusing the whole act
 * with the gate's own sentence is better than unwinding afterwards, because a
 * note is something somebody wrote and losing their words to a ledger refusal
 * is its own kind of wrong. Found by Lane TESTRUN, round 7.
 *
 * WHAT THIS DOES NOT CLOSE, said plainly: the crash window above is still
 * there, and so is any other reason the ledger might refuse. This closes the
 * one refusal that is knowable in advance and was firing on every give in
 * every un-launched village.
 */
export async function give(
  pool: Pool,
  input: GiveInput,
  stageMultiplier: StageMultiplierFor,
): Promise<MintOutcome & { noteId?: string }> {
  const amount = Number(input.amount);
  /*
   * Can this village issue at all? Asked before anything is written, for the
   * reason in this function's header. The answer only ever moves one way, from
   * closed to open, so a village that launches between this line and the post
   * below costs somebody one refused give and never a lost note.
   */
  const closed = await issuanceRefusal(pool);
  if (closed) return { ok: false, error: closed };
  // Resolved BEFORE the transaction opens. The stage a member has reached is
  // not what these gives race over, the spending is, and asking for it from
  // inside a SERIALIZABLE transaction would take a second pooled connection
  // while holding a lock on the first.
  const multiplier = await stageMultiplier(input.fromUserId);

  const result = await writeGratitudeRow(
    pool,
    {
      fromUserId: input.fromUserId,
      toUserId: input.toUserId,
      amount,
      kind: "gratitude",
      message: input.note ?? "",
      tag: input.tag ?? null,
      structureKey: input.structureKey ?? null,
      quiet: input.quiet,
      clientNonce: input.clientNonce ?? null,
    },
    multiplier,
    // checkGive IS the guard, unchanged: same messages, same order, same
    // amount/self-gratitude/allowance/share checks it has always run, just
    // run under the shared lock instead of this function's own copy of it.
    async (_conn, allowance, alreadyToThisPerson) => checkGive(input, allowance, alreadyToThisPerson),
    /*
     * INSIDE THE LOCK, keyed on the note, on the note's own connection. This
     * used to run after the commit above returned, in a transaction of its
     * own, and the header of this function used to argue that the order was
     * the conservative one: a crash between the two spends an allowance and
     * mints nothing, which is visible and keyed.
     *
     * It was not visible. Nothing keyed it, nothing swept it, and no surface
     * could see it, because a charge with no delivery leaves the books
     * perfectly balanced — there is no row to be out of balance with. It was
     * also not a crash window. Under ordinary contention the post deadlocked
     * and THREW: 18 of 40 gives from one member, 36 units of a 100-unit
     * allowance, gone in one measured run, with one of them a 500 rather than
     * a refusal.
     *
     * Both, or neither. `postTransferOn` does everything `postTransfer` does
     * except own the transaction, so the note and its credit commit together
     * and a ledger refusal takes the note down with it. The member keeps
     * their budget and hears the ledger's own reason.
     */
    async (conn, noteId) => {
      const res = await postTransferOn(conn, {
        from: RECOGNITION_FAUCET,
        to: memberAccount(input.toUserId),
        tokenType: HEARTS,
        amount,
        source: "gratitude_received",
        sourceRef: noteId,
        description: input.note,
        idempotencyKey: keys.gratitudeGiven(villageId(), noteId),
      });
      if (!res.ok) return { ok: false, error: res.error ?? "the ledger refused the credit" };
      return { ok: true, duplicate: res.duplicate, balance: res.toBalance };
    },
  );

  if (!result.ok) {
    // The nonce index spoke: this is the same tap arriving twice.
    if (result.duplicate) return { ok: false, error: "That thanks is already sent" };
    return { ok: false, error: result.error };
  }

  return {
    ok: true,
    duplicate: !!result.posted?.duplicate,
    balance: result.posted?.balance ?? 0,
    noteId: result.noteId,
  };
}

// ── Sources: what a confirmed claim mints ───────────────────────────────────

/**
 * Which faucet issues a token.
 *
 * Explicit, and it returns null for anything it does not know rather than
 * guessing a default. A wrong faucet is not a cosmetic error: each faucet's
 * negative balance IS that token's issued supply, so issuing stay credits out
 * of the recognition faucet would misreport two supplies at once and the boot
 * invariant would still pass, because conservation holds either way.
 *
 * CREDITS ISSUE FROM THE CYCLE POOL, and that is the whole reason a quest can
 * pay them at all. Until this line existed the switch returned null for
 * `credits`, both mint paths did `if (!faucet) continue`, and a village that
 * enabled a credits rule watched `publicRules` publish it as "25 Village
 * Credits when a steward confirms finished work" while it paid nobody, with no
 * error in any log and no refusal on any surface. The rule looked live because
 * every surface reads the rules table and no surface asked whether the engine
 * could honour it. `dryRun` was the single exception and said so correctly,
 * which is why this was findable in a simulated moon and invisible in a real
 * one.
 *
 * `sys:cycle-pool` and not `sys:mint`, because the doctrine on that account is
 * already written and already true: its negative balance means CREDITS
 * RELEASED TO DATE (see the header of ledger.ts, and the reason
 * `spendSinkFor("credits")` retires spends into the treasury instead of back
 * here). A quest releasing credits is a release, so it belongs on the same
 * counter as a cycle-close release. Splitting issuance across two faucets
 * would mean no single number answered "how many credits exist".
 */
export function faucetFor(tokenSlug: string): string | null {
  switch (tokenSlug) {
    case HEARTS:
      return RECOGNITION_FAUCET;
    case VILLAGE_VOICE:
      return VOICE_MINT;
    case CREDITS:
      return CYCLE_POOL_FAUCET;
    case "stay-credit":
      return MINT_FAUCET;
    case "library-credit":
      return LIBRARY_MINT;
    default:
      return null;
  }
}

/**
 * Why this rule cannot pay, or null when it can.
 *
 * ONE PLACE ANSWERS IT, because the question is asked in four: the two mint
 * paths that would otherwise skip in silence, the settlement preview that
 * would otherwise promise a payout that is not coming, and the admin rules
 * list. Before this, each of those decided for itself, and three of them
 * decided wrong: the preview multiplied an unpayable rule by the seat count
 * and printed the total.
 *
 * The reasons are the engine's real refusals, in the order the engine hits
 * them, phrased for the founder reading the Mint panel rather than for the
 * log.
 */
export function ruleCannotPay(tokenSlug: string): string | null {
  const def = tokenDef(tokenSlug);
  if (!def) return `there is no token called "${tokenSlug}" in this village's registry`;
  if (def.governance !== "platform") {
    return `${def.name} is governed on Hypha and only mirrored here, so this village cannot issue it`;
  }
  if (!def.active) return `${def.name} has been retired from the registry`;
  if (!faucetFor(tokenSlug)) {
    return `${def.name} has no faucet, so the engine has nowhere to issue it from`;
  }
  return null;
}

/**
 * Say it out loud, from the engine rather than from the caller.
 *
 * The reporting lives HERE and not in the consent route on purpose. Every
 * caller of a mint path would otherwise have to remember to log this, and the
 * one that forgot would be indistinguishable from a village whose rules all
 * work. `server/index.ts` is also under a size ratchet that only turns down,
 * so pushing this into the route would have cost seven lines of the one file
 * the architecture is trying to shrink, to duplicate a sentence the engine
 * already knows.
 *
 * `console.error` and not `.log`, because an enabled rule that pays nobody is
 * a promise the village is making and the engine is not keeping. It is the
 * kind of thing somebody should find while grepping for what went wrong.
 */
function reportUnpayable(context: string, unpayable: Array<{ token: string; reason: string }>): void {
  for (const u of unpayable) {
    console.error(`[economy] ${context}: the rule on "${u.token}" paid nobody: ${u.reason}`);
  }
}

/**
 * Everything a confirmed quest claim mints BEYOND the recognition the consent
 * route has always posted.
 *
 * Hearts are not minted here. The consent route has minted them since S7, with
 * a reward range, a consent cap, a standing multiplier and a claim-keyed
 * ledger post, and re-minting them from a rule would pay twice for one piece of
 * work. This adds what the rules table describes and the route never knew
 * about, which today is the village's voice token.
 *
 * Three guards, and each one is the reason the function exists rather than a
 * loop over rules at the call site:
 *
 *  - the epoch, so flipping the flag does not turn every quest ever consented
 *    into a payable backlog;
 *  - the readiness check, so a village with the flag on and no seeded rules
 *    mints nothing rather than believing it is running;
 *  - the occurrence key, so a re-consent after a wrong reversal pays once for
 *    each real occurrence and never twice for one.
 *
 * It never throws into the consent route. A quest that was witnessed and
 * credited must not fail because a secondary mint had a bad day, so the
 * failure is returned and logged and the claim stands.
 */
export async function mintForConfirmedClaim(
  pool: Pool,
  claim: { id: string; questId: string; userId: string; confirmedAt?: Date | string | null },
): Promise<{
  /**
   * What was posted, in the token's own MINOR UNITS — the number that went
   * into the ledger row, not the human figure the rule was read as. Voice
   * rides in thousandths, so a rule of 0.1 posts 100 and this says 100. It
   * used to say 0.1 while the ledger said 100, which made the log and the
   * ledger two different accounts of the same payment and left nothing to
   * reconcile them against. `runSettlement` already reports units; this is the
   * same field, spelled the same way, so the two mint paths agree.
   */
  minted: Array<{ token: string; units: number }>;
  skipped?: string;
  /**
   * Rules that were enabled, in force, and could not pay. An empty array is
   * the normal case; a non-empty one is a village promising something its
   * engine cannot deliver. Already logged by `reportUnpayable` before this
   * returns, so a caller that ignores the field still cannot make the failure
   * silent. Returned as well so tests can assert on it and a route can act.
   * See `ruleCannotPay`.
   */
  unpayable: Array<{ token: string; reason: string }>;
}> {
  const ready = await economyReady(pool);
  if (!ready.ready) return { minted: [], unpayable: [], skipped: ready.reason };

  // The claim's own moment, not `now`. If this is the first confirmed work
  // this engine has ever seen, it STARTS the clock rather than losing to it by
  // the milliseconds between resolving and being read. In production the boot
  // has already stamped the epoch, so this argument is ignored and a genuinely
  // old re-consented claim is still correctly history.
  const at = claim.confirmedAt ? new Date(claim.confirmedAt) : new Date();
  const epoch = await startEconomyEpoch(pool, at);
  if (at < epoch) {
    // History, not backlog. Honouring pre-epoch work is an explicit, audited,
    // keyed admin backfill and never a side effect of reading a table.
    return { minted: [], unpayable: [], skipped: "confirmed before the economy epoch" };
  }

  const rules = await rulesFor(pool, "quest.completed");
  const minted: Array<{ token: string; units: number }> = [];
  const unpayable: Array<{ token: string; reason: string }> = [];
  for (const r of rules) {
    // Recognition is the consent route's job. See above.
    if (r.tokenSlug === HEARTS) continue;
    if (r.amount === null) {
      // "Read the amount from whatever posted the work" has nothing to read
      // here. The only amount a quest posts is its Gratitude range, which the
      // consent route already spends, and reading it for a second token would
      // pay a credit figure somebody wrote meaning recognition. So a
      // from_source rule on any other token can never pay, on any quest, ever.
      // An admin can set one (`queueRuleChange` accepts a null amount), so it
      // has to be answerable rather than merely impossible.
      unpayable.push({
        token: r.tokenSlug,
        reason: "this rule reads its amount from the work, and a quest posts no amount in this token",
      });
      continue;
    }
    const human = r.amount;
    // Zero is a decision and stays quiet. A village that sets a rule to 0 has
    // said "not this one, not now", and shouting about it every consent would
    // bury the rules that are genuinely broken.
    if (human <= 0) continue;
    // A rule the engine cannot honour is REPORTED, not skipped. This used to
    // be `if (!faucet) continue`, which is how a village could enable a
    // credits rule, watch the Mint panel say it pays, and find out a moon
    // later that nobody had ever been paid by it.
    const problem = ruleCannotPay(r.tokenSlug);
    if (problem) {
      unpayable.push({ token: r.tokenSlug, reason: problem });
      continue;
    }
    // The ledger takes integers. A rule of 0.1 voice posts 100 thousandths,
    // because posting 0.1 posts nothing at all.
    const amount = toLedgerUnits(r.tokenSlug, human);
    if (amount <= 0) {
      // Below the token's own resolution. Also a promise that cannot be kept,
      // and the founder can only fix it if somebody says so.
      unpayable.push({
        token: r.tokenSlug,
        reason: `${human} is smaller than the smallest amount this token can hold`,
      });
      continue;
    }
    const faucet = faucetFor(r.tokenSlug)!;
    const res = await mint(pool, {
      toUserId: claim.userId,
      tokenSlug: r.tokenSlug,
      amount,
      from: faucet,
      source: "quest_consent",
      sourceRef: claim.id,
      description: `Confirmed contribution: ${claim.questId}`,
      // The token belongs in the key. One occurrence can mint more than one
      // token, and each is its own ledger row: without this segment the second
      // rule collides with the first, reads as a duplicate, and the member is
      // quietly paid in one token instead of two.
      idempotencyKey: `${keys.questCompleted(villageId(), claim.questId, claim.id, claim.userId)}:${r.tokenSlug}`,
    });
    // UNITS, which is what `mint` was handed and what the ledger row holds.
    if (res.ok && !res.duplicate) minted.push({ token: r.tokenSlug, units: amount });
    // A refusal from the ledger itself is the same class of news as a rule the
    // engine cannot honour, and it was equally silent before: the ledger's own
    // sentence went into a variable nobody read.
    if (!res.ok) unpayable.push({ token: r.tokenSlug, reason: res.error });
  }
  reportUnpayable(`claim ${claim.id}`, unpayable);
  return { minted, unpayable };
}

/**
 * A steward saw this person here. Badge progress only, never currency.
 *
 * Attendance is the one thing in this economy that pays nothing, and that is
 * the design: counting an RSVP as attendance hands a badge to anyone willing
 * to tap a button, and paying for attendance rewards turning up over doing
 * something. So the check-in is a separate table from `event_rsvps`, it needs
 * a steward, and it mints nothing at all.
 *
 * The confirmer may not be the attendee, for the same reason a steward cannot
 * witness their own quest: a badge somebody can award themselves is not earned,
 * and Wall-Raiser is three build days.
 */
export async function checkIn(
  pool: Pool,
  input: { eventId: string; userId: string; confirmedBy: string; note?: string },
): Promise<{ ok: true; duplicate: boolean } | { ok: false; error: string }> {
  const witness = canConfirm(input.userId, input.confirmedBy);
  if (!witness.ok) {
    return { ok: false, error: "Someone else checks you in. Ask a steward." };
  }
  const key = `event.checkin:${villageId()}:${input.eventId}:${input.userId}`;
  const id = `chk-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  try {
    const [res]: any = await pool.query(
      "INSERT IGNORE INTO `event_checkins` " +
        "(`id`, `village_id`, `event_id`, `user_id`, `confirmed_by`, `note`, `idempotency_key`) " +
        "VALUES (?,?,?,?,?,?,?)",
      [id, villageId(), input.eventId, input.userId, input.confirmedBy, input.note ?? null, key],
    );
    // INSERT IGNORE over the one-per-person unique key: a steward tapping twice
    // is not an error, it is the same fact arriving twice.
    return { ok: true, duplicate: Number(res?.affectedRows ?? 0) === 0 };
  } catch (err: any) {
    return { ok: false, error: String(err?.message ?? err) };
  }
}

/** How many confirmed check-ins this member has, which is what badges count. */
export async function checkinCount(pool: Pool, userId: string): Promise<number> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT COUNT(*) AS n FROM `event_checkins` WHERE `village_id` = ? AND `user_id` = ?",
    [villageId(), userId],
  );
  return Number(rows[0]?.n ?? 0);
}

// ── Settlement: the moon closes the books ───────────────────────────────────

export interface SettlementResult {
  cycleKey: string;
  stewardsThanked: number;
  minted: Array<{ token: string; units: number }>;
  alreadyRun: boolean;
  /**
   * Enabled `role.cycle` rules the engine could not honour, once each rather
   * than once per seat. A settlement that quietly paid two of three promised
   * tokens used to be indistinguishable from one that paid all three.
   */
  unpayable: Array<{ token: string; reason: string }>;
}

/**
 * Close one lunation.
 *
 * What it does: thanks everyone holding a seat, per the `role.cycle` rules.
 * What it deliberately does NOT do: reset an allowance, which needs no reset
 * because it was never stored, and close a gratitude cycle, which the
 * scheduler has been forbidden from doing since it was written. Settlement
 * releasing value is a human act; this job only pays what the rules already
 * promised for work already held.
 *
 * A re-run is a no-op and a resumed partial run finishes, both for the same
 * reason: every mint is keyed on (cycle, seat, holder), so the ledger itself
 * remembers what was paid. There is no "has this cycle run" flag to get out of
 * step with what actually happened.
 */
export async function runSettlement(pool: Pool, at: Date = new Date()): Promise<SettlementResult> {
  const { key: cycleKey } = cycleWindow(at);
  const out: SettlementResult = { cycleKey, stewardsThanked: 0, minted: [], alreadyRun: false, unpayable: [] };

  const ready = await economyReady(pool);
  if (!ready.ready) return out;

  // Promote queued dial changes FIRST. A change stamped for this cycle is
  // meant to govern this settlement; reading the rules before promoting would
  // pay the old rate and then apply the new one a moon late, which is the
  // deferral working backwards.
  await applyPendingRules(pool, at);

  const rules = await rulesFor(pool, "role.cycle", currentCycleNumber(at));
  if (!rules.length) return out;

  // Asked ONCE, before the seat loop, and not once per seat: an unpayable rule
  // is a fact about the rule, and reporting it per seat would turn one
  // misconfiguration into forty identical lines. Payable rules go on to the
  // loop; the rest are named here and never reach a mint call.
  const payable = rules.filter((r) => {
    const problem = ruleCannotPay(r.tokenSlug);
    if (problem) {
      out.unpayable.push({ token: r.tokenSlug, reason: problem });
      return false;
    }
    // An amount that rounds to nothing in this token's minor units is the
    // other way a rule pays nobody while looking alive. Same class, same
    // report: a rule of 0.1 on a whole-unit token posts zero.
    const human = r.amount ?? 0;
    if (human > 0 && toLedgerUnits(r.tokenSlug, human) <= 0) {
      out.unpayable.push({
        token: r.tokenSlug,
        reason: `${human} is smaller than the smallest amount this token can hold`,
      });
      return false;
    }
    return true;
  });
  reportUnpayable(`settlement ${cycleKey}`, out.unpayable);

  // Live seatings held by real accounts. `active_holder_key` is NULL once a
  // seating ends, and examples are not people.
  //
  // AGENTS ARE ALREADY EXCLUDED HERE (0142) and no clause was added for them.
  // An agent is `holder_kind = 'documented'` with no `user_id`, so it fails
  // two of the four conditions below. THIS IS THE POINT: the exclusion is
  // INHERITED rather than invented, and an inherited exclusion cannot drift
  // away from the thing it protects the way a second guard beside it could.
  // If this filter is ever loosened, that is the moment an agent starts being
  // paid, and it is the only such moment in the codebase.
  const [seats] = await pool.query<RowDataPacket[]>(
    "SELECT `id`, `org_role_id`, `user_id` FROM `org_role_assignments` " +
      "WHERE `active_holder_key` IS NOT NULL AND `holder_kind` = 'member' " +
      "AND `user_id` IS NOT NULL AND `is_example` = 0",
  );

  const paid = new Set<string>();
  for (const seat of seats) {
    const userId = String(seat.user_id);
    const seatId = String(seat.id);
    for (const r of payable) {
      const human = r.amount ?? 0;
      if (human <= 0) continue;
      const units = toLedgerUnits(r.tokenSlug, human);
      const faucet = faucetFor(r.tokenSlug)!;
      if (units <= 0) continue;
      const res = await mint(pool, {
        toUserId: userId,
        tokenSlug: r.tokenSlug,
        amount: units,
        from: faucet,
        source: "role_cycle",
        sourceRef: seatId,
        description: `Thanks for holding a seat through ${cycleKey}`,
        // Two seats are two thanks, and the same seat next moon is another.
        idempotencyKey: `${keys.roleCycle(villageId(), cycleKey, seatId, userId)}:${r.tokenSlug}`,
      });
      if (res.ok && !res.duplicate) {
        paid.add(userId);
        out.minted.push({ token: r.tokenSlug, units });
      }
    }
  }
  out.stewardsThanked = paid.size;
  // Nothing new to pay means this cycle was already settled, which is the only
  // honest way to know: the ledger is the record, not a flag beside it.
  //
  // Unless nothing COULD be paid. A run where every rule was unpayable also
  // mints nothing, and calling that "already settled" would report a
  // misconfiguration as a completed moon, which is the reading that stops
  // anybody looking.
  out.alreadyRun = out.minted.length === 0 && payable.length > 0;
  return out;
}

// ── Two-party consent ───────────────────────────────────────────────────────

/**
 * A steward may not witness their own work.
 *
 * Confirming releases value, so it must be structurally impossible to do it for
 * yourself, admin included. This is the same posture `quest.consent` already
 * takes in the capability gate, restated where the mint happens so a new caller
 * cannot route around it.
 */
export function canConfirm(claimantUserId: string, confirmerUserId: string): { ok: boolean; error?: string } {
  if (!confirmerUserId) return { ok: false, error: "a confirmation needs a named steward" };
  if (claimantUserId === confirmerUserId) {
    return { ok: false, error: "Someone else witnesses your work. Ask another steward." };
  }
  return { ok: true };
}

/**
 * Pairs who confirmed each other this moon. Surfaced in the audit, never
 * blocked: two people who genuinely worked together will confirm each other,
 * and refusing that would break the honest case to inconvenience the dishonest
 * one. A village that can SEE it can ask about it.
 */
export async function reciprocalConfirms(pool: Pool, at: Date = new Date()) {
  const { startsAt, endsAt } = cycleWindow(at);
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT a.`user_id` AS one, a.`consented_by` AS two, COUNT(*) AS n " +
      "FROM `quest_claims` a " +
      "JOIN `quest_claims` b ON b.`user_id` = a.`consented_by` AND b.`consented_by` = a.`user_id` " +
      "WHERE a.`village_id` = ? AND a.`status` = 'consented' " +
      "AND a.`consented_at` >= ? AND a.`consented_at` < ? " +
      "AND b.`consented_at` >= ? AND b.`consented_at` < ? " +
      "AND a.`user_id` < a.`consented_by` " +
      "GROUP BY a.`user_id`, a.`consented_by`",
    [villageId(), startsAt, endsAt, startsAt, endsAt],
  );
  return rows.map((r) => ({ one: String(r.one), two: String(r.two), count: Number(r.n) }));
}

// ── Voice claims ────────────────────────────────────────────────────────────

export type ClaimState = "requested" | "confirmed" | "canceled" | "stale" | "rejected";

/** Confirmed is terminal. So is rejected. Nothing reopens a settled claim. */
const TERMINAL: ReadonlySet<ClaimState> = new Set<ClaimState>([
  "confirmed",
  "canceled",
  "stale",
  "rejected",
]);

export function canSettleClaim(from: ClaimState, to: ClaimState): { ok: boolean; error?: string } {
  if (from === "confirmed") {
    // The one that would cost real value: a cancel arriving after a confirm
    // would refund voice the member has also already received on Hypha.
    return { ok: false, error: "this claim is confirmed and cannot be canceled or refunded" };
  }
  if (TERMINAL.has(from)) {
    return { ok: false, error: `this claim is already ${from}` };
  }
  if (to === "requested") {
    return { ok: false, error: "a claim cannot go back to requested" };
  }
  return { ok: true };
}

/** Refunds go back through `reverse`, so they inherit every guard the debit passed. */
export function claimRefunds(state: ClaimState): boolean {
  return state === "canceled" || state === "stale" || state === "rejected";
}

// ── The Mint's public feeds ─────────────────────────────────────────────────

/**
 * What the village promises, in its own words.
 *
 * ENABLED rules only, and only fields chosen one at a time. A rules feed is a
 * public statement of what the village pays for, so it must not leak a rule
 * somebody turned off while deciding, and it must not carry the internal id,
 * the cycle stamp, or anything else nobody asked to publish. Whitelisted by
 * construction: the object is BUILT, never a row with fields deleted.
 */
export async function publicRules(pool: Pool): Promise<Array<{ trigger: string; token: string; says: string }>> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT r.`trigger`, r.`token_slug`, r.`amount`, r.`ceiling`, r.`recipient`, " +
      "t.`name` AS token_name, t.`decimals` " +
      "FROM `mint_rules` r JOIN `tokens` t ON t.`slug` = r.`token_slug` " +
      "WHERE r.`village_id` = ? AND r.`enabled` = 1 AND t.`active` = 1 " +
      "ORDER BY r.`trigger`, r.`token_slug`",
    [villageId()],
  );
  return rows.map((r) => {
    const name = String(r.token_name ?? r.token_slug);
    const amount = r.amount === null ? null : Number(r.amount);
    const ceiling = Number(r.ceiling ?? 0);
    // Plain sentences, not a table dump. Somebody reading this is asking what
    // the village does, and "quest.completed / 0.1 / 1 / claimant" answers a
    // different question than they asked.
    const what =
      amount === null
        ? `up to ${ceiling} ${name}, as much as the work was posted for`
        : `${amount} ${name}`;
    const when: Record<string, string> = {
      "quest.completed": "when a steward confirms finished work",
      "gratitude.given": "when a member thanks another",
      "role.cycle": "each moon, to everyone holding a seat",
      "journey.stage_reached": "on reaching a stage of the journey",
      "welcome_aboard.quest": "on a welcome quest",
      "library.contributed": "on lending something to the library",
      "stay.work_exchange": "on a work exchange for a stay",
    };
    return {
      trigger: String(r.trigger),
      token: name,
      says: `${what} ${when[String(r.trigger)] ?? "when the village says so"}`,
    };
  });
}

/**
 * How much of each token exists, and nothing finer.
 *
 * VILLAGE TOTALS ONLY, per token, per moon. The admin dashboard breaks supply
 * down by source; this feed deliberately cannot, because at small N a
 * per-source public series deanonymises individual holdings. Six members and a
 * "role.cycle: 40 Hearts" line is two people's balances, and a member who set
 * showHearts false has just had them published by arithmetic.
 *
 * Each faucet's NEGATIVE balance is that token's issued supply, which is why
 * conservation being provable is what makes this feed possible at all.
 */
export async function publicSupply(
  pool: Pool,
): Promise<{ cycleKey: string; tokens: Array<{ token: string; issued: number; decimals: number }> }> {
  const { key } = cycleWindow();
  // `sys:cycle-pool` belongs here and was missing. It is the faucet every
  // village credit has ever come out of, so leaving it off meant the public
  // supply feed reported four tokens and silently omitted the one members
  // actually spend. That was already wrong for cycle-close distributions; a
  // quest that pays credits would have made it wrong on a daily basis.
  const faucets = [RECOGNITION_FAUCET, VOICE_MINT, MINT_FAUCET, LIBRARY_MINT, CYCLE_POOL_FAUCET];
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT b.`token_type` AS slug, t.`name`, t.`decimals`, SUM(-b.`balance`) AS issued " +
      `FROM \`token_balances\` b JOIN \`tokens\` t ON t.\`slug\` = b.\`token_type\` ` +
      `WHERE b.\`account_id\` IN (${faucets.map(() => "?").join(",")}) AND t.\`active\` = 1 ` +
      "GROUP BY b.`token_type`, t.`name`, t.`decimals` HAVING issued > 0 ORDER BY t.`sort_order`, t.`slug`",
    faucets,
  );
  return {
    cycleKey: key,
    tokens: rows.map((r) => ({
      token: String(r.name ?? r.slug),
      issued: Number(r.issued ?? 0),
      decimals: Number(r.decimals ?? 0),
    })),
  };
}

// ── The Mint, admin side ────────────────────────────────────────────────────

/**
 * Queue a change to a rule. It lands at the NEXT cycle, never this one.
 *
 * The live numbers are untouched, so the village keeps paying what it promised
 * for the cycle it is in. That is the whole point of the deferral: a rule
 * cannot be raised, paid against, and lowered again around a settlement, and
 * an admin cannot accidentally change what a member was already owed.
 *
 * Queueing over a queued change REPLACES it rather than stacking, because two
 * pending amounts for one rule have no defined meaning and somebody would have
 * to invent one.
 */
export async function queueRuleChange(
  pool: Pool,
  ruleId: string,
  change: { amount?: number | null; ceiling?: number; enabled?: boolean },
  actorUserId: string,
  /**
   * The cycle the caller PROMISED the village, when it has one.
   *
   * Governance stamps a landing instant on a carried decision and shows it to
   * the village days before it lands. Working the cycle out here from
   * `new Date()` at the moment of apply made the rule land a whole lunation
   * after the date on the page whenever the two instants sat either side of a
   * new moon. So the caller that made the promise passes it in, and the
   * fallback stays exactly what it was for every caller with nothing to promise.
   */
  intendedFromCycle?: number,
): Promise<{ ok: true; fromCycle: number } | { ok: false; error: string }> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT * FROM `mint_rules` WHERE `id` = ? AND `village_id` = ?",
    [ruleId, villageId()],
  );
  const rule = rows[0];
  if (!rule) return { ok: false, error: "no such rule" };

  if (change.ceiling !== undefined && (!Number.isFinite(change.ceiling) || change.ceiling < 0)) {
    return { ok: false, error: "a ceiling is zero or more, and zero means zero" };
  }
  if (change.amount !== undefined && change.amount !== null) {
    if (!Number.isFinite(change.amount) || change.amount <= 0) {
      return { ok: false, error: "an amount is greater than zero, or null to read it from the source" };
    }
    // A fixed amount above its own ceiling is a rule that contradicts itself.
    const ceiling = change.ceiling ?? Number(rule.ceiling ?? 0);
    if (ceiling > 0 && change.amount > ceiling) {
      return { ok: false, error: `${change.amount} is above this rule's ceiling of ${ceiling}` };
    }
    /*
     * ── AN AMOUNT THAT ROUNDS AWAY IS REFUSED AT SAVE TIME ────────────────
     *
     * `mint_rules.amount` is decimal(18,4) and most tokens here have decimals
     * 0, so a founder could save 0.4 Village Credits, watch the form accept
     * it, watch the Mint panel publish the rule as live, and have it pay
     * nothing for the rest of the village's life. Both mint paths already
     * report it — `mintForConfirmedClaim` and `runSettlement` name it as
     * unpayable — but only once somebody has already been promised it and
     * gone unpaid, in a log the founder is not reading.
     *
     * The column can hold it, the token cannot, and the honest place to say so
     * is the moment it is typed. The refusal names the smallest amount this
     * token CAN hold so the founder knows what to type instead.
     */
    const slug = String(rule.token_slug);
    const step = 1 / 10 ** decimalsOf(slug);
    /*
     * A TOLERANCE, BECAUSE THE SCALING ITSELF DRIFTS. 1.001 is a whole number
     * of Voice's thousandths and `1.001 * 1000` is 1000.9999999999999 in
     * binary, so an exact whole-number test would refuse a perfectly payable
     * amount — 175 of them below 10 in that token alone, measured. The test
     * "accepts a fraction the token can actually hold" pins 1.001 for this.
     *
     * The number this comment used to carry, `0.3 * 1000`, is exactly 300 and
     * proves nothing. It arrived from the lane this was ported from and was
     * never checked.
     */
    const scaled = Number(change.amount) * 10 ** decimalsOf(slug);
    const drift = Math.abs(scaled - Math.round(scaled));
    if (drift > 1e-6 * Math.max(1, Math.abs(scaled))) {
      return {
        ok: false,
        error:
          `${change.amount} is not a whole number of this token's smallest unit. ` +
          `${slug} is held in steps of ${step}, so round to the nearest one.`,
      };
    }
    if (toLedgerUnits(slug, change.amount) <= 0) {
      return {
        ok: false,
        error:
          `${change.amount} is smaller than the smallest amount ${slug} can hold, ` +
          `which is ${step}. A rule saved at this amount would pay nobody.`,
      };
    }
  }

  const fromCycle = Number.isFinite(intendedFromCycle) ? Number(intendedFromCycle) : currentCycleNumber(new Date()) + 1;
  await pool.query(
    "UPDATE `mint_rules` SET `pending_amount` = ?, `pending_ceiling` = ?, `pending_enabled` = ?, " +
      "`pending_from_cycle` = ?, `pending_by` = ?, `pending_at` = CURRENT_TIMESTAMP " +
      "WHERE `id` = ? AND `village_id` = ?",
    [
      change.amount === undefined ? rule.amount : change.amount,
      change.ceiling === undefined ? rule.ceiling : change.ceiling,
      change.enabled === undefined ? rule.enabled : change.enabled ? 1 : 0,
      fromCycle,
      actorUserId,
      ruleId,
      villageId(),
    ],
  );
  return { ok: true, fromCycle };
}

/**
 * The rules a change set names, by id, village-scoped like every other read
 * here. Absent ids are simply absent from the map: a rule this village does
 * not have is a real answer, and inventing a row for it would let a ballot
 * decide a payment nobody could make.
 */
export async function mintRulesByIds(pool: Pool, ruleIds: string[]): Promise<Map<string, MintRule>> {
  const ids = Array.from(new Set(ruleIds.filter((id) => !!id)));
  const out = new Map<string, MintRule>();
  if (ids.length === 0) return out;
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT * FROM \`mint_rules\` WHERE \`village_id\` = ? AND \`id\` IN (${ids.map(() => "?").join(",")})`,
    [villageId(), ...ids],
  );
  for (const r of rows) {
    const rule = rowToRule(r);
    out.set(rule.id, rule);
  }
  return out;
}

export interface MintRuleQueueResult {
  /** Each key that reached the rule, with the moon it lands on. */
  queued: Array<{ key: string; ruleId: string; field: MintRuleField; from: string; to: string; fromCycle: number }>;
  failed: Array<{ key: string; problem: string }>;
}

/**
 * APPLY A CARRIED BALLOT'S MINTING CHANGES (R81, R84).
 *
 * The village's decision lands through `queueRuleChange`, which is the same
 * writer the admin route uses. One writer, one deferral, one shape of pending
 * row, whoever decided it.
 *
 * ── ONE CALL PER RULE, AND THAT IS THE WHOLE REASON THIS EXISTS ─────────────
 *
 * `queueRuleChange` writes all four pending columns every time, filling the
 * ones it was not given from the rule's LIVE values. So a set moving an amount
 * and a ceiling on the same rule, applied as two calls, would have the second
 * call overwrite the first one's pending amount with the live one, and the
 * village would get half of what it voted for with nothing to show that
 * anything went wrong. Grouping by rule is what makes the write whole.
 *
 * ── VALIDATED AGAIN HERE, ON PURPOSE ────────────────────────────────────────
 *
 * Every value was checked when the proposal was raised. It is checked again on
 * the way in, and `queueRuleChange` checks the row's own bounds a third time
 * against the row as it stands now. A rule can be edited, disabled or removed
 * between a vote opening and closing, and a refusal that says so is worth more
 * than a write that half lands.
 *
 * ── IDEMPOTENT ─────────────────────────────────────────────────────────────
 *
 * `closeBallot` takes one guarded transition, so a second close never reaches
 * an executor at all. Beyond that, this writes the same pending values from
 * the same change set, so a run that did reach here twice leaves the rule in
 * exactly the state the first run left it.
 */
export async function applyMintRuleChanges(
  pool: Pool,
  changes: Array<{ key: string; from: string; to: string }>,
  actorUserId: string,
  /** The cycle the decision promised, passed through to `queueRuleChange`. */
  intendedFromCycle?: number,
): Promise<MintRuleQueueResult> {
  const queued: MintRuleQueueResult["queued"] = [];
  const failed: MintRuleQueueResult["failed"] = [];
  const byRule = new Map<string, Array<{ key: string; field: MintRuleField; from: string; to: string }>>();

  for (const c of changes) {
    const parsed = parseMintRuleKey(c.key);
    if (!parsed) {
      failed.push({ key: c.key, problem: "This build cannot read that as one of the village's minting rules" });
      continue;
    }
    const fields = byRule.get(parsed.ruleId) ?? [];
    fields.push({ key: c.key, field: parsed.field, from: c.from, to: c.to });
    byRule.set(parsed.ruleId, fields);
  }

  for (const [ruleId, fields] of Array.from(byRule.entries())) {
    const rules = await mintRulesByIds(pool, [ruleId]);
    if (!rules.has(ruleId)) {
      for (const f of fields) {
        failed.push({ key: f.key, problem: "This village no longer has a minting rule by that name" });
      }
      continue;
    }
    const change: { amount?: number | null; ceiling?: number; enabled?: boolean } = {};
    let refused: string | null = null;
    for (const f of fields) {
      const invalid = mintRuleValueProblem(f.field, f.to);
      if (invalid) {
        refused = invalid;
        break;
      }
      if (f.field === "amount") change.amount = mintRuleValueNumber("amount", f.to);
      else if (f.field === "ceiling") change.ceiling = Number(f.to);
      else change.enabled = f.to === "true";
    }
    /*
     * A rule is refused WHOLE. Queueing the half that still validates would
     * write a pending row nobody voted for, which is a worse outcome than a
     * refusal the decision page shows.
     */
    if (refused) {
      for (const f of fields) failed.push({ key: f.key, problem: refused });
      continue;
    }
    const out = await queueRuleChange(pool, ruleId, change, actorUserId, intendedFromCycle);
    if (!out.ok) {
      for (const f of fields) failed.push({ key: f.key, problem: out.error });
      continue;
    }
    for (const f of fields) {
      queued.push({ key: f.key, ruleId, field: f.field, from: f.from, to: f.to, fromCycle: out.fromCycle });
    }
  }
  return { queued, failed };
}

/**
 * Promote every queued change whose moon has come. Called by settlement.
 *
 * One statement, so a run interrupted between rules cannot promote half a
 * governance decision, and the same four columns are cleared in the same write
 * that applies them: there is no window where a rule carries both a new value
 * and a stale pending copy of it.
 */
export async function applyPendingRules(pool: Pool, at: Date = new Date()): Promise<number> {
  const cycle = currentCycleNumber(at);
  const [res]: any = await pool.query(
    "UPDATE `mint_rules` SET " +
      "`amount` = `pending_amount`, `ceiling` = `pending_ceiling`, `enabled` = `pending_enabled`, " +
      "`effective_from_cycle` = `pending_from_cycle`, " +
      "`pending_amount` = NULL, `pending_ceiling` = NULL, `pending_enabled` = NULL, " +
      "`pending_from_cycle` = NULL, `pending_by` = NULL, `pending_at` = NULL " +
      "WHERE `village_id` = ? AND `pending_from_cycle` IS NOT NULL AND `pending_from_cycle` <= ?",
    [villageId(), cycle],
  );
  return Number(res?.affectedRows ?? 0);
}

export interface MintView {
  /**
   * The stored cycle id. It stays here because it is the key every mint rule's
   * `effective_from_cycle` is compared against, and the panel stopped printing
   * it: `moon` below is what an admin now reads.
   */
  cycleKey: string;
  /** The village's own moon, worked out on read and never stored. */
  moon: VillageMoon;
  rules: Array<{
    id: string;
    trigger: string;
    token: string;
    tokenName: string;
    amount: number | null;
    ceiling: number;
    recipient: string;
    enabled: boolean;
    /**
     * Null when the engine can honour this rule, and the founder's sentence
     * when it cannot. An enabled rule with a `problem` is the village
     * promising something nobody will ever receive.
     *
     * SERVED BUT NOT YET RENDERED. `client/src/pages/Mint.tsx` declares its
     * own `Rule` interface and does not carry this field, so the panel still
     * shows an unpayable rule with the same green "Paying" badge as a working
     * one. The engine refuses it, `console.error` records it and this feed
     * reports it; the last surface is a client change and is written up rather
     * than done here. Adding `problem: string | null` to that interface and
     * branching the badge on it is the whole of it.
     */
    problem: string | null;
    pending: null | { amount: number | null; ceiling: number; enabled: boolean; fromCycle: number };
  }>;
  /** Per token per SOURCE. Admin only: the public feed is totals-only. */
  supply: Array<{ token: string; source: string; issued: number }>;
  settlementPreview: { seats: number; mints: Array<{ token: string; units: number }> };
}

/** Everything the Mint panel shows, in one read. */
export async function mintView(pool: Pool): Promise<MintView> {
  // ONE instant for both. Two `new Date()` calls either side of a new moon
  // would put the id and the label on different lunations, and this panel's
  // whole job is that a rule's effective-from and the moon a founder reads are
  // the same moon.
  const at = new Date();
  const { key } = cycleWindow(at);
  const moon = villageMoonFor(at, await moonOneCycle(pool));
  const [rules] = await pool.query<RowDataPacket[]>(
    "SELECT r.*, t.`name` AS token_name FROM `mint_rules` r " +
      "LEFT JOIN `tokens` t ON t.`slug` = r.`token_slug` " +
      "WHERE r.`village_id` = ? ORDER BY r.`trigger`, r.`token_slug`",
    [villageId()],
  );
  // Per-source detail lives HERE and never on the public feed, because at small
  // N a public per-source series deanonymises individual holdings.
  const [supply] = await pool.query<RowDataPacket[]>(
    "SELECT `token_type` AS token, `source`, SUM(`amount`) AS issued FROM `token_ledger` " +
      "WHERE `from_account` IN (?,?,?,?,?) GROUP BY `token_type`, `source` ORDER BY `token_type`, `source`",
    // The cycle pool, for the same reason `publicSupply` now names it: without
    // it the admin's own per-source breakdown could not see a single credit
    // this village has ever issued.
    [RECOGNITION_FAUCET, VOICE_MINT, MINT_FAUCET, LIBRARY_MINT, CYCLE_POOL_FAUCET],
  );

  // The mint PREVIEW, and it must agree exactly with the settlement filter
  // above or the preview promises a payout the run will not make. Agents are
  // excluded by the same inherited clauses and for the same reason (0142).
  const [seats] = await pool.query<RowDataPacket[]>(
    "SELECT COUNT(*) AS n FROM `org_role_assignments` " +
      "WHERE `active_holder_key` IS NOT NULL AND `holder_kind` = 'member' AND `user_id` IS NOT NULL AND `is_example` = 0",
  );
  const seatCount = Number(seats[0]?.n ?? 0);
  const cycleRules = await rulesFor(pool, "role.cycle");

  return {
    cycleKey: key,
    moon,
    rules: rules.map((r) => ({
      id: String(r.id),
      trigger: String(r.trigger),
      token: String(r.token_slug),
      tokenName: String(r.token_name ?? r.token_slug),
      amount: r.amount === null ? null : Number(r.amount),
      ceiling: Number(r.ceiling ?? 0),
      recipient: String(r.recipient ?? "claimant"),
      enabled: !!r.enabled,
      problem: ruleCannotPay(String(r.token_slug)),
      pending:
        r.pending_from_cycle === null || r.pending_from_cycle === undefined
          ? null
          : {
              amount: r.pending_amount === null ? null : Number(r.pending_amount),
              ceiling: Number(r.pending_ceiling ?? 0),
              enabled: !!r.pending_enabled,
              fromCycle: Number(r.pending_from_cycle),
            },
    })),
    supply: supply.map((s) => ({
      token: String(s.token),
      source: String(s.source),
      issued: Number(s.issued ?? 0),
    })),
    // What the next settlement WOULD pay, from the rules in force now. A
    // preview computed from pending numbers would show a moon that is not the
    // one about to close.
    //
    // And only what it CAN pay. This used to multiply every enabled rule by
    // the seat count, unpayable ones included, so a village with a credits
    // rule the engine could not honour read a confident "600 Village Credits
    // next moon" off a preview that had never asked whether a single one of
    // them would move. A forecast that cannot fail is not a forecast.
    settlementPreview: {
      seats: seatCount,
      mints: cycleRules
        .filter((r) => (r.amount ?? 0) > 0 && !ruleCannotPay(r.tokenSlug))
        .map((r) => ({ token: r.tokenSlug, units: toLedgerUnits(r.tokenSlug, (r.amount ?? 0) * seatCount) })),
    },
  };
}
