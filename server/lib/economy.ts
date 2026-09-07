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
  mintRuleNumberProblem,
  mintRuleValueNumber,
  mintRuleValueProblem,
  parseMintRuleKey,
  type MintRuleField,
} from "../../shared/mintRuleKeys";
import type { VillageMoon } from "../../shared/villageMoon";
import { issuanceRefusal, readGameStart } from "./gameStart";
import { currentCycle, currentCycleNumber, cycleIdFor, parseCycleId } from "./gratitude-cycles";
// The import runs both ways, the same shape `./exit` above already has: both
// modules only reach each other from inside functions, so nothing is read at
// module-init time and the cycle resolves.
import { applyPendingModes } from "./circleTreasury";
import { openExitFor } from "./exit";
import { moonOneCycle, villageMoonFor } from "./villageMoon";
import { numberVar, stringVar } from "./variables";
import {
  CLAWBACK_SOURCES,
  memberAccount,
  pairSiblingKey,
  postClawbackMirror,
  postClawbackMirrorPair,
  postTransfer,
  postTransferOn,
  postTransferPair,
  registerToken,
  tokenDef,
  CYCLE_POOL_FAUCET,
  MINT_FAUCET,
  RECOGNITION_FAUCET,
  type TransferResult,
} from "./ledger";

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
 * Where Voice goes when it wanes. Seeded by 0165, and NOT a faucet.
 *
 * A faucet's negative balance IS that token's issued supply, so a faucet flag
 * here would let this account go negative, and a negative balance here would
 * say the waning account had ISSUED Voice. This account only ever receives:
 * its balance is positive and rising and that number is all the Voice that has
 * waned in this village to date. The flag is also what `postTransfer` reads for
 * the launch gate (`server/lib/gameStart.ts`), and putting waning behind the
 * issuance gate would be backwards.
 *
 * Nothing spends it. What a village may later do with what has gathered here
 * is not ruled, and turning waning into a redistribution is a different
 * economy that needs the founder's word.
 */
export const VOICE_DECAY = "sys:voice-decay";

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
 * Voice rides in hundredths, and so does every token a village spends.
 *
 * `token_ledger.amount` is an INT with a CHECK that it is positive, and
 * `postTransfer` runs `Math.trunc` over what it is handed. A rule that mints
 * 0.1 voice therefore posts ZERO: not an error, not a refusal, just a member
 * who was never paid and a ledger that looks fine. The registry has carried a
 * `decimals` column since 0006 for exactly this, so voice stores 100 and
 * displays 1, the way the payments module has always handled money.
 *
 * Doing it the other way, widening the ledger's amount to a decimal, would
 * change the keystone every other module posts through and every invariant
 * proved over it. Minor units are the cheaper truth.
 *
 * BOTH NUMBERS LIVE IN `shared/tokenScale.ts` AND ARE ONLY RE-EXPORTED HERE, so
 * that the client surfaces and this engine cannot be handed different scales.
 * Read that file for why Voice keeps a scale at all, which is waning, and why it
 * came down from three to two, which is that two scales are fewer places a
 * display and an input can disagree than three.
 */
export { CURRENCY_DECIMALS, VOICE_DECIMALS } from "../../shared/tokenScale";
import { CURRENCY_DECIMALS, VOICE_DECIMALS, decayUnits } from "../../shared/tokenScale";

/**
 * THE ONE REGISTRY READ FOR A TOKEN'S SCALE.
 *
 * Every conversion in this file used to spell this out for itself, and R31
 * turns on the difference between a helper that LOOKS UP a scale and one that
 * is HANDED one: a function that can take a slug and read today's decimals
 * will silently use "now" for a number that was frozen under a different
 * scale. So the lookup is named, separate, and the pure arithmetic below takes
 * its scale as an argument. A caller with a historical figure passes the scale
 * that figure was written in and never comes through here.
 */
export function decimalsFor(tokenSlug: string): number {
  return tokenDef(tokenSlug)?.decimals ?? (tokenSlug === VILLAGE_VOICE ? VOICE_DECIMALS : 0);
}

/**
 * A human AMOUNT at a stated scale, in minor units. Rounds, because 0.1 * 1000
 * is not 100 in binary and because the nearest payable figure is what an
 * amount means.
 *
 * NOT for a bound. See `ceilingAtScale`, and read the paragraph there before
 * reaching for this one on a cap: the direction of the rounding is the whole
 * of the difference between a ceiling that holds and one that does not.
 */
export function unitsAtScale(human: number, decimals: number): number {
  return Math.round(Number(human) * 10 ** decimals);
}

/** Minor units at a stated scale, back to the number a member reads. */
export function humanAtScale(units: number, decimals: number): number {
  // Divide by a whole power of ten and never raise ten to a negative one:
  // `10 ** -4` is 0.0001 on V8 25 and 0.00009999999999999999 on V8 22, and CI
  // decides on 22. IEEE 754 division is correctly rounded and `10 ** decimals`
  // is an exact integer for every scale a token can carry.
  return Number(units) / 10 ** decimals;
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
  return unitsAtScale(human, decimalsFor(tokenSlug));
}

/** Ledger units back to the number a member reads on their chip. */
export function fromLedgerUnits(tokenSlug: string, units: number): number {
  return humanAtScale(units, decimalsFor(tokenSlug));
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

/**
 * ONE SEGMENT OF A KEY, ESCAPED SO IT CANNOT BE MISTAKEN FOR TWO.
 *
 * Two things collapse distinct occurrences into one key, and both were live:
 *
 *  - THE SEPARATOR. Every builder joins on `:`, and an id that contains a
 *    colon moves the boundary. `questCompleted(v, "q:1", "c", u)` and
 *    `questCompleted(v, "q", "1:c", u)` produced the byte-identical key, so
 *    the second occurrence read as a duplicate and that member was not paid
 *    while `mint` reported ok. `registerToken` does no slug validation, so a
 *    seed or a fork migration can put a colon in a token slug too.
 *  - THE CASE. `token_ledger.idempotency_key` is UNIQUE under a
 *    case-INSENSITIVE collation (`utf8mb4_uca1400_ai_ci` locally,
 *    `utf8mb4_0900_ai_ci` in CI), so `usr-aB1` and `usr-Ab1` are ONE row.
 *    Every id generator in this build is lowercase today, which makes this a
 *    fork hazard rather than a live one, and a fork is exactly who will hit
 *    it.
 *
 * So `:`, `%` and every uppercase letter are percent-encoded, with LOWERCASE
 * hex digits so the output itself contains no uppercase and the collation has
 * nothing left to fold. Escaping is not normalising: two ids that differ only
 * in case still produce two different keys, which is the point. `%` has to be
 * encoded or the escape is ambiguous with a literal one.
 *
 * The cost is length, and length is already checked: `keyTooLong` refuses
 * loudly at `MAX_KEY` rather than letting the database truncate. An id of all
 * capitals costs three characters each.
 */
const esc = (segment: string | number): string =>
  String(segment).replace(/[%:A-Z]/g, (c) => `%${c.charCodeAt(0).toString(16)}`);

export const keys = {
  /**
   * THE TOKEN SLUG IS PART OF THE KEY AND IS BUILT HERE.
   *
   * It used to be appended at the call site as `${keys.questCompleted(...)}:${slug}`,
   * which cost two things: the slug went in unescaped, so a colon in a slug
   * moved the boundary the same way a colon in an id did, and the generated
   * key table in `docs/ECONOMICS.md` printed a shape the ledger never holds,
   * because the generator reads this object and the suffix was not in it.
   * One rule pays one member one token, so the token belongs in the key.
   */
  questCompleted: (v: string, questId: string, claimId: string, userId: string, tokenSlug: string) =>
    `quest.completed:${esc(v)}:${esc(questId)}:${esc(claimId)}:${esc(userId)}:${esc(tokenSlug)}`,
  gratitudeGiven: (v: string, noteId: string) => `gratitude.given:${esc(v)}:${esc(noteId)}`,
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
  roleCycle: (v: string, cycleKey: string, seatId: string, userId: string, tokenSlug: string) =>
    `role.cycle:${esc(v)}:${esc(cycleKey)}:${esc(seatId)}:${esc(userId)}:${esc(tokenSlug)}`,
  journeyStage: (v: string, journeyId: string, stage: string, userId: string) =>
    `journey.stage_reached:${esc(v)}:${esc(journeyId)}:${esc(stage)}:${esc(userId)}`,
  welcomeAboard: (v: string, questNo: number | string, userId: string) =>
    `welcome_aboard.quest:${esc(v)}:${esc(questNo)}:${esc(userId)}`,
  /**
   * One member's Voice waning at one cycle close.
   *
   * THE CYCLE KEY IS WHAT MAKES AN HOURLY JOB TAKE ONCE A MOON, and it carries
   * the same warning `roleCycle` carries above: changing its spelling wanes
   * every balance a second time in an open cycle. Spell it with
   * `cycleWindow(at).key` and never a second formatter.
   *
   * The USER id and not the account id, because every other key here names a
   * user and `memberAccount()` derives from it.
   *
   * The TOKEN SLUG, even though only one token wanes today. One occurrence that
   * moves two tokens needs the segment or the second collides with the first
   * and reads as a duplicate, which is the lesson `mintForConfirmedClaim`
   * learned: a second waning token would otherwise silently wane only one.
   */
  voiceDecay: (v: string, cycleKey: string, userId: string, tokenSlug: string) =>
    `voice.decay:${esc(v)}:${esc(cycleKey)}:${esc(userId)}:${esc(tokenSlug)}`,
  transfer: (v: string, transferRowId: string) => `transfer:${esc(v)}:${esc(transferRowId)}`,
  /**
   * `eventKey` IS NOT ESCAPED, and that is deliberate. It is a whole
   * occurrence key, not a segment: it is already canonical, its colons are
   * its own structure, and escaping them would triple the length of every
   * mirror key against a ceiling `keyTooLong` already finds tight. There is
   * no injection to close here either, because the only two segments are the
   * village (a constant) and a key that the ledger already holds as unique.
   */
  reversal: (v: string, eventKey: string) => `reversal:${esc(v)}:${eventKey}`,
  voiceClaim: (v: string, claimRowId: string) => `voice-claim:${esc(v)}:${esc(claimRowId)}`,
  /**
   * The two postings one redemption can make, and they are built HERE.
   *
   * A redemption holds at request and burns at confirmation, so it owns two
   * keys and never one with a suffix appended at the call site. That suffix
   * form is what `questCompleted` above records as a live defect twice over:
   * the appended segment goes in unescaped, and the generated key table in
   * `docs/ECONOMICS.md` reads this object, so a key assembled elsewhere is a
   * shape the document cannot print.
   *
   * The redemption row id is the occurrence. Two redemptions by one member for
   * the same token and the same amount are two occurrences and must not
   * collide, which the row id gives for free.
   */
  redemptionHold: (v: string, redemptionId: string) => `redemption:${esc(v)}:${esc(redemptionId)}:hold`,
  redemptionBurn: (v: string, redemptionId: string) => `redemption:${esc(v)}:${esc(redemptionId)}:burn`,
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
  /**
   * MINOR UNITS, which is the contract `postTransfer` states, and `mint` hands
   * this straight through without touching it. Convert where the human number
   * LEAVES ITS SOURCE TABLE and never here: both production callers already do
   * (`mintForConfirmedClaim` and `runSettlement`, over `mint_rules.amount`, a
   * `decimal(18,4)` carrying the rule's own human figure), so a conversion
   * inside this function would multiply theirs a second time. Same wording as
   * `ReverseOpts.amount` above, which states the same contract for the same
   * reason: this file's primitives are minor-only on purpose.
   */
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

/**
 * `balance` is the recipient's balance in the token's MINOR units, straight off
 * the recompute `postTransfer` runs. A caller showing it to a member divides
 * with `fromLedgerUnits` first, and a caller weighing it against a game
 * variable has to know which unit that variable is declared in before it
 * compares anything: `governance.hypha_threshold` is declared in Gratitude, and
 * a threshold read against a raw minor balance is wrong by `10 ** decimals`.
 */
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
 * What one occurrence of a rule may post, clamped to that rule's ceiling.
 *
 * A rule that mints a number somebody else typed, with no ceiling, is an open
 * faucet with a form in front of it. The ceiling is not advisory and it is not
 * nullable-as-unlimited: 0 means zero, which is the same fail-closed reading
 * the swap caps use.
 *
 * ── WHAT THE CEILING BOUNDS, AND WHAT IT DOES NOT ──────────────────────────
 *
 * ONE OCCURRENCE. The rule row states it in its own human units and this
 * function ANSWERS IN THE TOKEN'S MINOR UNITS, which is the unit the payment
 * is actually made in and therefore the only unit the bound can be enforced
 * in. Read `ceilingAtScale` for why that distinction is the whole fix and why
 * moving the arithmetic alone would have changed nothing.
 *
 * Ten confirmed quests against
 * `amount 25, ceiling 250` issue 250 and an eleventh issues 25 more, and that
 * is the rule working: 25 is what the village promised per confirmed quest and
 * the ceiling says no single payment may exceed 250. This column is NOT a
 * per-cycle budget and reading it as one would stop the shipped default
 * `role.cycle credits, amount 25, ceiling 250` after the tenth seat, in every
 * village with more than ten seats, with nobody having decided that. The
 * per-cycle question is a real one and it needs its own column and a founder's
 * answer; see the report in docs/ECONOMICS.md section 4.
 *
 * The reading is the schema's own: drizzle/0071_economy_core.sql calls this
 * column "the hard cap on any from_source amount", `publicRules` and the Mint
 * panel both print it as "up to N, as much as the work was posted for", and
 * `queueRuleChange` refuses a single amount above it as "a rule that
 * contradicts itself".
 *
 * ── WHY A FIXED AMOUNT IS CLAMPED HERE TOO ────────────────────────────────
 *
 * This used to answer `rule.amount` for a fixed rule and never look at the
 * ceiling, on the reading that `queueRuleChange` had already refused an amount
 * above it. It has not: that check is skipped entirely when a change carries a
 * ceiling and no amount, so a village that lowers a rule from 25 to a ceiling
 * of 5 leaves the row at `amount 25, ceiling 5` and every later mint pays 25.
 * The governed field a village votes on is labelled "the most it can pay"
 * (shared/mintRuleKeys.ts), so the vote has to bind where the payment happens
 * rather than at the form somebody filled in first.
 */
/**
 * The three fields the ceiling decision reads, and it reads nothing else.
 *
 * A `MintRule` satisfies it, and so does a raw row a feed has already read for
 * other reasons. Named because `publicRules` reaches this decision from a
 * joined query and had no business fabricating an id, a trigger, a recipient
 * and a cycle stamp to ask one question. It is also the exact shape the dry-run
 * model mirrors (shared/dryRun/economicsModel.ts).
 */
export type CeilingRuleLike = Pick<MintRule, "amount" | "ceiling" | "tokenSlug">;

export function clampToCeiling(posted: number, rule: CeilingRuleLike, decimals: number): number {
  // A fixed amount ignores what the source posted, and always did. What it no
  // longer ignores is its own ceiling.
  const asked = rule.amount !== null ? Number(rule.amount) : Number(posted);
  if (!Number.isFinite(asked) || asked <= 0) return 0;
  const ceiling = Number(rule.ceiling);
  // A ceiling that is not a number fails closed rather than opening the
  // faucet. `mint_rules.ceiling` is NOT NULL, so this is the unreachable
  // branch that stays cheap to keep unreachable.
  if (!Number.isFinite(ceiling) || ceiling < 0) return 0;
  return Math.min(unitsAtScale(asked, decimals), ceilingAtScale(ceiling, decimals));
}

/**
 * A BOUND at a stated scale, in minor units, and it only ever goes DOWN.
 *
 * ── THE DEFECT THIS EXISTS TO CLOSE, AND WHY THE OBVIOUS FIX IS NOT IT ──────
 *
 * `mint_rules.ceiling` is `decimal(18,4)` and six of the seven shipped tokens
 * carry 0 decimals, so the column holds places the token cannot. Measured on
 * this build, read off the ledger: a rule at amount 0.6 under a ceiling of 0.5
 * at 0 decimals POSTED ONE WHOLE UNIT, which is two hundred percent of the
 * cap; amount 1.5 under a ceiling of 1.5 posted 2; at 3 decimals a ceiling of
 * 0.0005 posted a full thousandth. Reachable through the governed path,
 * because nothing refused the ceiling.
 *
 * MOVING THE CLAMP INTO MINOR UNITS DOES NOT FIX IT ON ITS OWN, and that is
 * worth stating because it is the obvious reading. Rounding is monotone, so
 * `round(min(a, c) * s)` and `min(round(a * s), round(c * s))` are the same
 * number for every input; converting first and clamping second answers exactly
 * what the old order answered. The unit was never the whole of it.
 *
 * WHAT FIXES IT IS THE DIRECTION. An AMOUNT rounds, because the nearest
 * payable figure is what a payment means. A BOUND may only ever fall, because
 * a bound rounded up is a bound the village never voted for, and "caps fail
 * closed" is this economy's oldest invariant. So a ceiling of 0.5 on a
 * whole-unit token allows nothing, and `ceilingOutcome` says so out loud
 * instead of paying one.
 *
 * FLOORING A DOUBLE NEEDS THE ULP GUARD BELOW. `0.29 * 100` is
 * 28.999999999999996, and a bare `Math.floor` would read a village's 29
 * hundredths as 28 and quietly lower a cap nobody moved. A scaled value within
 * a few units in the last place of a whole number IS that whole number: the
 * column keeps four decimal places, so the smallest real fraction any token
 * scale can produce here is a ten-thousandth, which is many orders of
 * magnitude above the tolerance.
 */
export function ceilingAtScale(ceiling: number, decimals: number): number {
  const scaled = Number(ceiling) * 10 ** decimals;
  if (!Number.isFinite(scaled)) return 0;
  const whole = Math.round(scaled);
  if (Math.abs(scaled - whole) <= Math.abs(scaled) * Number.EPSILON * 8) return whole;
  return Math.floor(scaled);
}

/** What the ceiling lets one occurrence post, and why it let it post nothing. */
export interface CeilingOutcome {
  /**
   * What may be posted, in the token's MINOR units, at the scale the caller
   * passed. 0 posts nothing.
   *
   * `units` and never `paid`, and the rename is load-bearing. This function
   * used to answer in the rule's HUMAN units and both callers then ran
   * `toLedgerUnits` over the answer, which rounded the comparison's result
   * back up past the ceiling it had just been compared against. Every reader
   * of this field has to know which unit it is in, and this file's own
   * convention is that `units` is minor and `amount` is human.
   */
  units: number;
  /** Why the CEILING stopped it, in a founder's words, or null. */
  refusal: string | null;
}

/**
 * THE WHOLE CEILING DECISION, in one pure function, for one occurrence.
 *
 * No pool, no clock, no registry: the rule row and the posted amount decide it
 * and nothing else does. That is what makes it the single thing to mirror. The
 * dry-run model (shared/dryRun/economicsModel.ts) is forbidden from importing
 * anything under `server/` and its own test walks the import graph to enforce
 * that, so it COPIES this arithmetic the way it copies the faucet map, and this
 * function is the one place to copy it from.
 *
 * There is deliberately no "issued so far this cycle" argument. The ceiling
 * bounds an occurrence and not a cycle, so a running total is not an input to
 * this decision and adding one would describe a rule the schema does not have.
 * See `clampToCeiling` for the four citations behind that reading.
 *
 * ── THE ANSWER IS IN MINOR UNITS AND THE SCALE IS AN ARGUMENT ──────────────
 *
 * `decimals` is passed in and never looked up, which is what keeps this pure
 * and what R31 asks of every money helper: a function that can read today's
 * scale off the registry will use "now" for a figure that was written under a
 * different one. The two mint paths pass `decimalsFor(slug)`; a caller holding
 * a frozen figure passes the scale that figure was frozen at.
 *
 * WHAT COMES BACK, and every case of it, at 0 decimals so `units` reads as the
 * human figure:
 *
 *   ceiling 250, amount 25   ->  { units: 25, refusal: null }   nothing changes
 *   ceiling 5,   amount 25   ->  { units: 5,  refusal: null }   the clamp bites
 *   ceiling 25,  amount 25   ->  { units: 25, refusal: null }   exactly at it pays
 *   ceiling 0,   amount 25   ->  { units: 0,  refusal: "..." }  fails closed, loudly
 *   ceiling 0.5, amount 25   ->  { units: 0,  refusal: "..." }  below what the token can hold
 *   ceiling 250, amount 0    ->  { units: 0,  refusal: null }   the village's own off switch
 *   ceiling 100, from_source ->  { units: min(posted, 100), refusal: null }
 *
 * The fifth row is the one this function grew for. A ceiling the column can
 * hold and the token cannot is a village that has capped a payment at a figure
 * no ledger row can express, and it needs the same sentence a ceiling of zero
 * gets, naming the same number to change.
 *
 * The refusal is worded for the founder reading the Mint panel, and it names
 * the number to change, because it lands in the same `unpayable` list
 * `ruleCannotPay` feeds and a village reading that list is working out which of
 * its own numbers is wrong.
 *
 * A ceiling of zero is a REAL ANSWER and not an empty one: `mint_rules.ceiling`
 * is NOT NULL DEFAULT 0 and `mintRuleValueProblem` tells a village in as many
 * words that "a ceiling is zero or more, and zero means zero". So it earns a
 * sentence, where an `amount` of zero gets silence, because that one is a
 * village saying "not this one, not now" about the payment itself.
 */
export function ceilingOutcome(
  rule: CeilingRuleLike,
  posted: number,
  decimals: number,
  tokenName?: string,
): CeilingOutcome {
  const name = tokenName ?? rule.tokenSlug;
  const ceiling = Number(rule.ceiling);
  // The CEILING alone decides the refusal, never the clamp's answer: a
  // from_source rule's payable amount depends on what the work posted, so
  // reading a clamped zero as a broken ceiling would call every from_source
  // rule broken on every occurrence that posted nothing.
  if (!Number.isFinite(ceiling) || ceiling <= 0) {
    return {
      units: 0,
      refusal:
        `this rule's ceiling is ${rule.ceiling}, so it can pay no ${name} at all. ` +
        `Raise the ceiling or pause the rule`,
    };
  }
  // A ceiling above zero that falls to nothing at this token's scale. The
  // village capped a payment at a figure the ledger has no row for, so the
  // rule pays nobody, and it is a ceiling fact and gets a ceiling's sentence:
  // an "amount too small" reading would send the founder to the wrong number.
  if (ceilingAtScale(ceiling, decimals) <= 0) {
    return {
      units: 0,
      refusal:
        `this rule's ceiling is ${rule.ceiling}, which is below the smallest amount of ${name} this ` +
        `village can post, so it can pay none at all. Raise the ceiling or pause the rule`,
    };
  }
  return { units: clampToCeiling(posted, rule, decimals), refusal: null };
}

// ── Reversal ────────────────────────────────────────────────────────────────

/**
 * What a caller BELIEVES it is undoing. Every field is checked, none decides.
 *
 * This used to be the instruction: `reverse()` took its direction, its token
 * and its amount from whoever called it, and checked only that SOME row with
 * the original key existed. An audit turned a 25 credit posting into a
 * 1,000,000 credit payment to the same member with every invariant green,
 * because a mirror that invents its own numbers still balances.
 *
 * So the numbers come off the original row now, and this interface is what a
 * caller may ASSERT about that row. A field that disagrees refuses the whole
 * reversal before anything is written, naming the field and both values.
 *
 * The keys stayed flat and stayed spelled as they were, which turned the two
 * call sites in `voiceClaim.ts` from commands into checks with no edit at all.
 * `undefined` is no claim; every other value is compared, ZERO AND THE EMPTY
 * STRING INCLUDED, because a caller that computed nothing and a caller that
 * passed nothing are different facts and only the first one is wrong.
 *
 * UNITS, WHICH IS THE OTHER WAY THIS FUNCTION COULD BE WRONG BY A THOUSAND.
 *
 * `token_ledger.amount` is ALREADY minor units, so the mirror posts the row's
 * own integer and converts nothing. A `toLedgerUnits` anywhere on that path
 * would be the thousand-times wallet bug wearing a reversal's clothes, which
 * is why the derivation below reads four columns and does arithmetic on none
 * of them. `opts.amount` is a CLAIM in those same minor units: it is compared
 * and then thrown away, never posted.
 *
 * The consequence for callers is the part worth saying out loud. A caller
 * holding a HUMAN figure has to convert before it claims, or its own correct
 * refund is refused as a mismatch. That is exactly what `voiceClaim.ts` does
 * at both its refund and its retry, because `voice_claims.amount` is a human
 * column and the ledger row is not.
 *
 * Measured by the gratitude sweep at four decimals: reversing a give of 5
 * posts a mirror of 50000 and refunds the allowance exactly 5. This function
 * needs no edit at any scale, because it does no scaling.
 */
export interface ReverseOpts {
  /** Expected debit side of the mirror: the original row's `to_account`. */
  from?: string;
  /** Expected credit side of the mirror: the original row's `from_account`. */
  to?: string;
  /** Expected token: the original row's `token_type`. */
  tokenSlug?: string;
  /** Expected size IN LEDGER MINOR UNITS, which is what the row already holds. */
  amount?: number;
  /** Free text carried into the mirror's description. Decides nothing either. */
  note?: string;
}

/** One caller claim about the original row, checked against the row. */
function reverseClaimProblem(
  field: string,
  claimed: string | number | undefined,
  actual: string | number,
): string | null {
  if (claimed === undefined) return null;
  const agrees = typeof actual === "number" ? Number(claimed) === actual : String(claimed) === actual;
  if (agrees) return null;
  return (
    `this reversal was asked for with ${field} ${JSON.stringify(claimed)}, ` +
    `and the posting it reverses has ${field} ${JSON.stringify(actual)}`
  );
}

/**
 * `token_ledger.description` is `varchar(500)` (0005), and MySQL runs strict.
 *
 * MySQL counts a varchar in CHARACTERS, which for utf8mb4 means CODE POINTS,
 * and JavaScript counts a string in UTF-16 code units. The two disagree by a
 * factor of two on every astral character, so the clamp below counts the
 * ledger's unit and not JavaScript's.
 */
const MAX_DESCRIPTION = 500;

/** How many characters MySQL will say this string is. */
const codePoints = (s: string): string[] => Array.from(s);

/** The first `n` CODE POINTS, so a clamp can never land inside a character. */
function clampToCodePoints(s: string, n: number): string {
  if (n <= 0) return "";
  const points = codePoints(s);
  return points.length <= n ? s : points.slice(0, n).join("");
}

/**
 * What the mirror row says, with the original key kept and the NOTE clipped.
 *
 * A 600-character note used to reach MySQL whole and THROW `ER_DATA_TOO_LONG`
 * out of a function typed `Promise<MintOutcome>`. `sourceRef` one line above
 * was already clamped and this was not. It matters most where it is worst to
 * throw: `settleClaim` compare-and-sets the claim to a TERMINAL state before
 * it calls this, so the exception escapes past the `if (!back.ok)` repair
 * branch, the "refund failed, voice still held" note is never written, and
 * the member loses the voice AND the record that says so. The Hypha webhook
 * clips its note to 280 against a `voice-claim:local:<id>` key, which leaves
 * about 26 characters of headroom: a thin margin is not a guard.
 *
 * THE KEY SURVIVES AND THE NOTE GIVES WAY, in that order, because the key is
 * what an auditor uses to find the posting that was undone and the note is
 * commentary. Clipping is marked so nobody reads a truncated sentence as the
 * whole one.
 *
 * IT USED TO CLIP BY UTF-16 CODE UNIT, WHICH IS THE WRONG UNIT TWICE OVER.
 * An emoji is two code units and one character, so a note of 400 emoji is
 * 800 to `String.prototype.slice` and 400 to the column: the old arithmetic
 * clipped a note that would have fitted whole. Worse, when the boundary
 * landed at an odd offset it cut a surrogate PAIR in half, and the lone
 * surrogate reached MySQL as `EF BF BD` - U+FFFD, the replacement character -
 * so the stored note ended in a black diamond that no member ever typed. A
 * closing proof measured both on a 400-emoji note.
 *
 * Counting code points fixes both at once: it is the unit the column counts,
 * so the clamp is neither early nor late, and a code point is by definition
 * never half a character.
 */
function reversalDescription(note: string | undefined, originalKey: string): string {
  if (!note) return clampToCodePoints(originalKey, MAX_DESCRIPTION);
  const tail = ` (${originalKey})`;
  const room = MAX_DESCRIPTION - codePoints(tail).length;
  if (room <= 0) return clampToCodePoints(originalKey, MAX_DESCRIPTION);
  const clipped = codePoints(note).length <= room ? note : `${clampToCodePoints(note, Math.max(0, room - 3))}...`;
  return `${clipped}${tail}`;
}

/*
 * `pairSiblingKey` and `CLAWBACK_SOURCES` LIVE IN THE LEDGER NOW.
 *
 * Both used to be declared here, and both are rules about what may be
 * WRITTEN. A rule about a write that lives in the module in front of the
 * writer is a rule with a door beside it, and a closing proof walked through
 * that door with plain `postTransfer` and reproduced this file's exact
 * losses. The definitions moved to `server/lib/ledger.ts`, where they are
 * asked inside the posting's own transaction; the two calls below are what is
 * left of them here, and they exist only to give a better message before any
 * transaction opens. The ledger decides, whatever this file asks.
 */

/**
 * Undo one posting with a mirror that has its own key.
 *
 * Four rules, each of which is a way this goes wrong:
 *
 *  - the mirror is DERIVED from the original row: same token, same size, the
 *    two accounts swapped. Nothing a caller passes can change any of them;
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
 *
 * A CLAWBACK OF VALUE ALREADY SPENT COMPLETES, AND THE BALANCE GOES NEGATIVE.
 * A member paid 25 who spent all 25 reads -25 once the payment is undone, and
 * that is the truthful state. Refusing the reversal instead would leave the
 * ledger insisting the payment stands, which is the one thing every party
 * knows is false. `reversal` is in `ALLOW_NEGATIVE_SOURCES` for this, and
 * `checkLedgerInvariants` reads the same set, so the negative balance is
 * lawful at boot rather than a refusal to serve.
 */
export async function reverse(
  pool: Pool,
  originalKey: string,
  opts: ReverseOpts = {},
): Promise<MintOutcome> {
  /*
   * THE STRING GUARD IS CASE-FOLDED NOW, AND IT IS NO LONGER THE GUARD.
   *
   * It used to be `originalKey.startsWith("reversal:")`, a byte-exact JS test
   * in front of a row lookup that runs under a case-INSENSITIVE collation.
   * `REVERSAL:local:X` failed the test and found the mirror row anyway, so a
   * reversal could be reversed: the value the clawback took came back, the
   * member who was paid twice kept both, and the derived mirror key
   * `reversal:local:REVERSAL:local:X` did not collide with anything, so the
   * UNIQUE index said nothing either. It chained to depth four, which lets
   * the attacker pick the final direction, and conservation stayed at zero
   * through every step because the faucet absorbs the difference.
   *
   * Folding the case closes that one spelling. It does not close the class,
   * because a string is a claim about a row and the row is the fact, so the
   * two tests below decide instead: the stored key must match BYTE for byte,
   * and the row's own `source` must not be a clawback.
   */
  if (originalKey.trim().toLowerCase().startsWith("reversal:")) {
    return { ok: false, error: "a reversal cannot itself be reversed" };
  }
  const mirrorKey = keys.reversal(villageId(), originalKey);
  const tooLong = keyTooLong(mirrorKey);
  if (tooLong) return { ok: false, error: tooLong };

  // Six columns rather than `SELECT 1`: the row IS the instruction now, and
  // the two extra ones are what stop a string standing in for it.
  const [orig] = await pool.query<RowDataPacket[]>(
    "SELECT `idempotency_key`, `source`, `from_account`, `to_account`, `token_type`, `amount` " +
      "FROM `token_ledger` WHERE `idempotency_key` = ? LIMIT 1",
    [originalKey],
  );
  const row = orig[0];
  if (!row) {
    return { ok: false, error: "there is no such posting to reverse" };
  }

  /*
   * THE KEY THE CALLER PASSED MUST BE THE KEY THE ROW HOLDS, byte for byte.
   *
   * `WHERE idempotency_key = ?` answers under the column's collation, which
   * folds case and ignores trailing spaces, so this lookup happily returns a
   * row whose key is NOT the one asked for. Reading it back and comparing in
   * JS is the only way to make the match as narrow as the caller believes it
   * is, and it needs no collation change: switching the column to `_bin`
   * would also change what the UNIQUE index calls a duplicate, which is the
   * thing that currently defeats the sequential and padded double-reversal
   * attacks. Narrow the READ, leave the index alone.
   */
  const storedKey = String(row.idempotency_key);
  if (storedKey !== originalKey) {
    return {
      ok: false,
      error:
        `no posting is keyed ${JSON.stringify(originalKey)}. The ledger's collation matched it to ` +
        `${JSON.stringify(storedKey)}, which is a different key, and a reversal is derived from an ` +
        "exact posting or from nothing",
    };
  }

  /*
   * A CLAWBACK MAY NOT BE CLAWED BACK, decided by the row's source.
   *
   * The rule was enforced only by the `reversal:` prefix on the key, and
   * EVERY REAL CLAWBACK IN THIS BUILD IS KEYED OUTSIDE THAT NAMESPACE:
   * `ord:<orderId>:reversal-leg1` and `pp:<purchaseId>:reversal:<periodKey>`
   * from the payment handlers, and the stays refund route. Each carries
   * source `payment_reversal`, each was reversible, and reversing one pays a
   * member back money the bank has already taken off the village.
   *
   * `stay_night` is deliberately NOT here: a grace-window burn is an ordinary
   * charge, not an undo, and a village that burnt a night wrongly has to be
   * able to give it back.
   */
  const source = String(row.source);
  if (CLAWBACK_SOURCES.has(source)) {
    return {
      ok: false,
      error:
        `that posting is itself a clawback (source "${source}"), and reversing one restores value ` +
        "that was already taken back. Post the correction as its own occurrence instead",
    };
  }

  const sibling = await pairSiblingKey(pool, storedKey, source);
  if (sibling) {
    return {
      ok: false,
      error:
        `that posting is one leg of an atomic pair whose other leg is keyed ${JSON.stringify(sibling)}. ` +
        "Reversing one leg alone dismantles the both-or-neither promise the pair exists for: " +
        "a member who paid for a swap would keep nothing. Use reversePair() with both keys",
    };
  }

  // The mirror runs the opposite way: what the original credited, this debits.
  // `token_ledger.amount` is already minor units, so nothing is converted here.
  // A conversion would be the 1000x wallet bug wearing a reversal's clothes.
  const mirror = {
    from: String(row.to_account),
    to: String(row.from_account),
    tokenType: String(row.token_type),
    amount: Number(row.amount),
  };

  const problem =
    reverseClaimProblem("from", opts.from, mirror.from) ??
    reverseClaimProblem("to", opts.to, mirror.to) ??
    reverseClaimProblem("tokenSlug", opts.tokenSlug, mirror.tokenType) ??
    reverseClaimProblem("amount", opts.amount, mirror.amount);
  // ONE SENTENCE, BOTH HALVES. The head states the law a caller broke and the
  // tail states the disagreement, so a refusal is readable without the source.
  // Two lanes wrote this refusal independently and asserted on different parts
  // of it; the sentence now carries what each of them was checking for.
  if (problem) return { ok: false, error: `a reversal undoes exactly what was posted: ${problem}` };

  const res = await postClawbackMirror(pool, {
    from: mirror.from,
    to: mirror.to,
    tokenType: mirror.tokenType,
    amount: mirror.amount,
    // THE SOURCE AND THE DEBT CAPABILITY ARE NO LONGER WRITTEN HERE.
    //
    // They used to be `source: "reversal"` and `allowNegative: CLAWBACK_DEBT`,
    // and the comment above them said this was the only function in the build
    // that could create clawback debt. It was not: `CLAWBACK_DEBT` was an
    // `export const`, so any module under `server/` could import it and post
    // the same debt, and a closing proof did exactly that to -990 with every
    // invariant green. The proof is module-private now and
    // `postClawbackMirror` supplies it, so the sentence is true for the first
    // time. What actually stops the debt, though, is not the door: it is the
    // law inside the ledger, which derives this row from the posting the key
    // names and refuses anything it did not derive.
    // Prefix, because source_ref is varchar(120) and a quest occurrence key can
    // run past it. A prefix is enough for the allowance query, which matches on
    // `gratitude.given:<village>:%`, and the whole key rides in the note so a
    // human reading the row can still find what was undone.
    sourceRef: originalKey.slice(0, MAX_SOURCE_REF),
    description: reversalDescription(opts.note, originalKey),
    idempotencyKey: mirrorKey,
  });
  if (!res.ok && !res.duplicate) return { ok: false, error: res.error ?? "the ledger refused the reversal" };
  return { ok: true, duplicate: res.duplicate, balance: res.toBalance };
}

/**
 * Undo BOTH legs of an atomic pair, in one transaction, or neither.
 *
 * `reverse()` mirrors one row, and one row is the wrong unit for a swap. A
 * pair exists because a member must never be debited without being credited,
 * and reversing leg2 alone did exactly that: the member paid 100 into the
 * treasury, the 40 they received went back, and they kept nothing. The
 * mirror even posted with `allowNegative` although `exchange_swap` is
 * deliberately outside the keystone set, because the mirror's own source is
 * `reversal`, which is inside it. Both invariants stayed green.
 *
 * So the pair is undone through the same primitive that made it. Two mirrors
 * in one `postTransferPair`, which brings three properties with it that a
 * pair of `reverse()` calls could never have:
 *
 *  - both or neither, under one transaction and one lock order;
 *  - NO DEBT. `postTransferPair` refuses `allowNegative` outright, so a
 *    member who has already spent what the swap gave them cannot have the
 *    swap undone behind their back: the whole thing refuses and a person
 *    settles it. That refusal is the honest one here, unlike a single
 *    clawback, where the negative IS the truth;
 *  - one duplicate answer for the pair, not two half-answers.
 *
 * Legs may be passed in either order. Each mirror carries the mirror key of
 * its own leg, so replaying is a duplicate rather than a second refund.
 */
export async function reversePair(
  pool: Pool,
  keyLeg1: string,
  keyLeg2: string,
  opts: { note?: string } = {},
): Promise<MintOutcome> {
  if (keyLeg1 === keyLeg2) {
    return { ok: false, error: "a pair needs two distinct keys, and these are the same one" };
  }
  for (const k of [keyLeg1, keyLeg2]) {
    if (k.trim().toLowerCase().startsWith("reversal:")) {
      return { ok: false, error: "a reversal cannot itself be reversed" };
    }
    const tooLong = keyTooLong(keys.reversal(villageId(), k));
    if (tooLong) return { ok: false, error: tooLong };
  }

  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT `idempotency_key`, `source`, `from_account`, `to_account`, `token_type`, `amount` " +
      "FROM `token_ledger` WHERE `idempotency_key` IN (?, ?)",
    [keyLeg1, keyLeg2],
  );
  // Byte-exact both times: the collation matches keys this caller did not ask for.
  const legs = [keyLeg1, keyLeg2].map((k) => rows.find((r) => String(r.idempotency_key) === k));
  for (let i = 0; i < 2; i++) {
    if (!legs[i]) {
      return { ok: false, error: `there is no posting keyed ${JSON.stringify([keyLeg1, keyLeg2][i])} to reverse` };
    }
  }
  const [a, b] = legs as [RowDataPacket, RowDataPacket];

  for (const r of [a, b]) {
    const source = String(r.source);
    if (CLAWBACK_SOURCES.has(source)) {
      return {
        ok: false,
        error: `${String(r.idempotency_key)} is itself a clawback (source "${source}") and may not be reversed`,
      };
    }
  }
  if (String(a.source) !== String(b.source)) {
    return {
      ok: false,
      error:
        `these two postings carry different sources ("${String(a.source)}" and "${String(b.source)}"), ` +
        "so they were never one pair",
    };
  }
  const sibling = await pairSiblingKey(pool, String(a.idempotency_key), String(a.source));
  if (sibling !== String(b.idempotency_key)) {
    return {
      ok: false,
      error:
        `${JSON.stringify(keyLeg1)} and ${JSON.stringify(keyLeg2)} are not the two legs of one pair: ` +
        "a pair is keyed <prefix>:leg1 and <prefix>:leg2 under one source",
    };
  }

  const res = await postClawbackMirrorPair(pool, [
    {
      from: String(a.to_account), to: String(a.from_account),
      tokenType: String(a.token_type), amount: Number(a.amount),
      sourceRef: String(a.idempotency_key).slice(0, MAX_SOURCE_REF),
      description: reversalDescription(opts.note, String(a.idempotency_key)),
      idempotencyKey: keys.reversal(villageId(), String(a.idempotency_key)),
    },
    {
      from: String(b.to_account), to: String(b.from_account),
      tokenType: String(b.token_type), amount: Number(b.amount),
      sourceRef: String(b.idempotency_key).slice(0, MAX_SOURCE_REF),
      description: reversalDescription(opts.note, String(b.idempotency_key)),
      idempotencyKey: keys.reversal(villageId(), String(b.idempotency_key)),
    },
  ]);
  if (!res.ok && !res.duplicate) return { ok: false, error: res.error ?? "the ledger refused the pair reversal" };
  return { ok: true, duplicate: res.duplicate, balance: 0 };
}

/**
 * Has this posting already been mirrored?
 *
 * IT USED TO MATCH ON THE MIRROR KEY ALONE — `SELECT 1 ... WHERE
 * idempotency_key = ?` — and never looked at `source`, at either account, or
 * at the amount. So anything at all written under `keys.reversal(v, K)`
 * answered yes: a one-unit mint to a third party made `isReversed(K)` true
 * with no reversal in existence, and `reverse(K)` then hit the UNIQUE index,
 * reported SUCCESS AS A DUPLICATE, and moved nothing. The victim kept the
 * money the village was trying to take back and every return value said the
 * clawback had happened.
 *
 * The namespace is reserved for source `reversal` at leg validation now, so
 * that squat is refused at the write. This is the reader's half of the same
 * rule: a mirror is a row that reverses THIS row, so it is compared to it —
 * exact key, source `reversal`, the two accounts swapped, same token, same
 * minor units. Anything else is not a reversal of this posting whatever it
 * is keyed.
 */
export async function isReversed(pool: Pool, originalKey: string): Promise<boolean> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT `idempotency_key`, `source`, `from_account`, `to_account`, `token_type`, `amount` " +
      "FROM `token_ledger` WHERE `idempotency_key` IN (?, ?)",
    [originalKey, keys.reversal(villageId(), originalKey)],
  );
  const original = rows.find((r) => String(r.idempotency_key) === originalKey);
  const mirror = rows.find((r) => String(r.idempotency_key) === keys.reversal(villageId(), originalKey));
  if (!original || !mirror) return false;
  return (
    String(mirror.source) === "reversal" &&
    String(mirror.from_account) === String(original.to_account) &&
    String(mirror.to_account) === String(original.from_account) &&
    String(mirror.token_type) === String(original.token_type) &&
    Number(mirror.amount) === Number(original.amount)
  );
}

// ── Gratitude, and the allowance that is never stored ───────────────────────

/**
 * HUMAN UNITS, all three numbers, the way a member reads them on the dial.
 *
 * `gratitude.base_budget` is declared in Gratitude (shared/gameVariables.ts),
 * `gratitude_log.amount` is an `int` holding what a member typed, and the
 * refusals in `checkGive` print these figures back to a person. Nothing here
 * is a ledger number: `give` converts once, at its posting, and nowhere else.
 */
export interface Allowance {
  /** The dial times the giver's stage multiplier. */
  total: number;
  /** This cycle's gifts, less this cycle's reversals of them. */
  spent: number;
  /** `total - spent`, floored at zero. */
  remaining: number;
  cycleKey: string;
}

/**
 * ONE GIVER'S GRATITUDE SPENDING FOR ONE CYCLE, GIFT BY GIFT.
 *
 * Both halves of the allowance come from here and both are keyed on the member
 * who gave: the notes THIS giver wrote inside the window, and the reversals of
 * THOSE notes.
 *
 * ── D30, WHICH THIS EXISTS TO CLOSE ────────────────────────────────────────
 *
 * The refund half used to be one SUM over `token_ledger` selected by
 * `source_ref LIKE 'gratitude.given:<village>:%'`. That predicate names the
 * GIFT and never the GIVER, so it summed every reversed gift in the village
 * and handed the whole of it back to everybody's allowance at once. It was
 * measured, not theorised: the gratitude units lane failed two cases at both
 * scales by exactly the five units a DIFFERENT member had reversed, and had to
 * run its reversal case last in each describe block to keep the rest green.
 *
 * ── HOW THE GIVER IS RECOVERED WITHOUT A COLUMN ────────────────────────────
 *
 * A reversal moves value between two accounts that name people, and neither of
 * them is the giver: the mirror debits the RECIPIENT and credits the faucet the
 * gift was minted from. What carries the giver is the NOTE. The mirror's
 * `source_ref` is the gift's own occurrence key, that key is built from the
 * note id, and `gratitude_log` holds `from_id` on the same row. So this builds
 * the keys THIS member's notes were posted under, with the same builder `give`
 * posts them under, and keeps only the mirrors that match one. Nothing is added
 * to any table and no migration is involved.
 *
 * ── WHY THE MATCH IS MADE HERE AND NOT IN THE PREDICATE ────────────────────
 *
 * `keys.gratitudeGiven` percent-escapes every segment (the keystone lane's
 * change), so the note id inside a key is not always the note id in the column,
 * and rebuilding that escape in SQL would be a second copy of it to keep in
 * step. The `LIKE` below is now only a NARROWING of the scan, and the exact map
 * is what decides; a village id that widened the pattern could no longer widen
 * the answer. The notes read is bounded by one member's own giving and the
 * mirror read by the village's reversals, which are an administrative act, so
 * neither side grows with the roster.
 */
interface CycleGiving {
  /** HUMAN units, the way `gratitude_log.amount` holds them: what was given. */
  given: number;
  /** HUMAN units: the part of `given` that has since been reversed. */
  back: number;
  /** The same two figures per recipient, which is what the share cap weighs. */
  byRecipient: Map<string, { given: number; back: number }>;
}

async function gratitudeGivenInCycle(
  conn: Pool | PoolConnection,
  userId: string,
  startsAt: Date,
  endsAt: Date,
): Promise<CycleGiving> {
  const v = villageId();
  const [notes] = await conn.query<RowDataPacket[]>(
    "SELECT `id`, `to_id`, `amount` FROM `gratitude_log` " +
      "WHERE `village_id` = ? AND `from_id` = ? AND `at` >= ? AND `at` < ?",
    [v, userId, startsAt, endsAt],
  );
  const out: CycleGiving = { given: 0, back: 0, byRecipient: new Map() };
  // AN EMPTY WINDOW AND A FULLY REVERSED ONE ARE DIFFERENT FACTS, and both
  // report a spend of zero. Leaving early here is about the second query
  // having nothing to match, never about the answer: a member who gave nothing
  // has no keys, so no mirror in the village can be theirs.
  if (!notes.length) return out;

  // The occurrence key each note was posted under, cut the way `reverse` cuts
  // it into `source_ref` (varchar(120), MAX_SOURCE_REF) so the two strings are
  // the same string, and lower-cased because that column answers under a
  // case-insensitive collation and `esc` already emits nothing but lower case.
  const mine = new Map<string, string>();
  for (const n of notes) {
    const toId = String(n.to_id);
    const amount = Number(n.amount);
    out.given += amount;
    const seat = out.byRecipient.get(toId) ?? { given: 0, back: 0 };
    seat.given += amount;
    out.byRecipient.set(toId, seat);
    mine.set(keys.gratitudeGiven(v, String(n.id)).slice(0, MAX_SOURCE_REF).toLowerCase(), toId);
  }

  const [mirrors] = await conn.query<RowDataPacket[]>(
    "SELECT t.`source_ref` AS ref, COALESCE(SUM(t.`amount`), 0) AS back FROM `token_ledger` t " +
      "WHERE t.`source` = 'reversal' AND t.`at` >= ? AND t.`at` < ? " +
      "AND t.`source_ref` LIKE ? GROUP BY t.`source_ref`",
    // Built by the key builder, so the village segment is escaped here exactly
    // as it is escaped in the keys stored. Spelt by hand, as it was, this put a
    // RAW village id in front of ESCAPED ones: a fork hazard and not a live bug,
    // because `villageId()` is "local" today and escapes to itself, and a fork
    // whose id carried a colon or a capital would have matched nothing at all.
    [startsAt, endsAt, `${keys.gratitudeGiven(v, "")}%`],
  );
  for (const m of mirrors) {
    const toId = mine.get(String(m.ref).toLowerCase());
    // Somebody else's reversed gift. It is in this result set and it is not in
    // this member's allowance, and that sentence is the whole of D30.
    if (toId === undefined) continue;
    // MINOR OUT OF THE LEDGER, HUMAN INTO THE SUBTRACTION (sweep lane F).
    // `given` above is `gratitude_log.amount`, the unit a member typed;
    // `token_ledger.amount` is minor. At decimals 0 the two coincide and this
    // call is the identity; at 4 they are ten thousand apart, and subtracting
    // raw would floor the spend at zero and refund the giver their whole moon.
    //
    // Converted PER MIRROR ROW and not once over the total, because the total
    // and the per-recipient figure are both made of it: one conversion feeding
    // both readers is one number they cannot come apart on.
    const undone = fromLedgerUnits(HEARTS, Number(m.back));
    out.back += undone;
    const seat = out.byRecipient.get(toId);
    if (seat) seat.back += undone;
  }
  return out;
}

/** The dial times the stage, which is the whole of `Allowance.total`. */
function allowanceTotalFor(stageMultiplier: number): number {
  // ONE ALLOWANCE (R73). This read the engine's own flat
  // `economy.giving_allowance_per_moon` (30) while the acknowledgement flow
  // read `gratitude.base_budget` times the giver's stage multiplier (100 and
  // up). Both sum their spending out of the same `gratitude_log` rows, so the
  // two totals were two answers to one question and the stricter one silently
  // won for anyone who used that door.
  //
  // The multiplier is a NUMBER the caller has already resolved, never a
  // resolver this function calls: `give` reads it before it opens its
  // transaction, so nothing here reaches for a second pooled connection while
  // holding a lock on the first.
  return Math.round(numberVar("gratitude.base_budget") * stageMultiplier);
}

/** The three numbers a member reads, assembled from one read of their giving. */
function allowanceFrom(total: number, cycleKey: string, giving: CycleGiving): Allowance {
  const spent = Math.max(0, giving.given - giving.back);
  return { total, spent, remaining: Math.max(0, total - spent), cycleKey };
}

/**
 * What one member has already put on ONE other member this cycle, NET.
 *
 * The share cap is weighed against this, and a reversal has to unwind it for
 * the same reason it unwinds the allowance: the value came back, so the
 * concentration it created is not there any more. Before this, reversing a gift
 * to somebody returned budget the giver then could not spend on the person they
 * had just taken it back from.
 */
function alreadyGivenTo(giving: CycleGiving, toUserId: string): number {
  const seat = giving.byRecipient.get(toUserId);
  return seat ? Math.max(0, seat.given - seat.back) : 0;
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
 * and both pass. The sum of THIS MEMBER's gifts this cycle, less the reversals
 * of THOSE SAME GIFTS, is the only figure that is true by construction:
 * reversing a gift refunds the giver's allowance because the subtraction stops
 * counting it, with nothing to remember to do.
 *
 * Both halves are read by `gratitudeGivenInCycle`, which is where the giver is
 * recovered from the note behind each reversal. Read its header before changing
 * either query: the refund used to be keyed on the gift alone (D30) and paid
 * every member in the village for one member's undo.
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
  const giving = await gratitudeGivenInCycle(conn, userId, startsAt, endsAt);
  return allowanceFrom(allowanceTotalFor(stageMultiplier), key, giving);
}

export interface GiveInput {
  fromUserId: string;
  toUserId: string;
  /**
   * HUMAN units, and a whole number: what the member tapped. It is weighed
   * against the allowance in this unit, written to `gratitude_log.amount` in
   * this unit, and converted to the token's minor units exactly once, at the
   * ledger posting inside `give`.
   */
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
 * A share of the giver's own allowance, so it means the same thing at 100 and
 * at 500 and a village that doubles `gratitude.base_budget` does not silently
 * double how much of one person's standing can come from one relationship. A
 * cap of 1/N is the sentence "at least N people" written as one number.
 *
 * The floor of 1 is a bound, never a guess: 1% of an allowance of 50 rounds to
 * zero, and a zero here would refuse every send in the village while both
 * dials still read as sane numbers. It is stated on the dial itself.
 *
 * LIVES HERE, not in `server/lib/gratitude.ts`, as of the concurrency fix
 * below: this file is the guarded engine both gratitude doors write through
 * now, and `gratitude.ts` re-exports this symbol so nothing importing it from
 * there (server/lib/dryRun.ts among them) had to change. Two channels, one
 * ceiling, computed in one place so they cannot drift apart the way the caps
 * they replaced did.
 *
 * HUMAN UNITS IN AND OUT. `allowanceTotal` is `Allowance.total`, and
 * `gratitude.max_share_per_recipient` is a percentage of it, so what this
 * returns is compared against a `gratitude_log` sum and printed to a member in
 * the unit they typed. The floor of 1 is ONE GRATITUDE and not one minor unit,
 * which is the distinction any mirror of this function has to keep: floored in
 * minor units it would be 0.0001 at four decimals and would bound nothing.
 */
export function shareCapFor(allowanceTotal: number): number {
  if (allowanceTotal <= 0) return 0;
  const share = numberVar("gratitude.max_share_per_recipient");
  return Math.max(1, Math.floor((allowanceTotal * share) / 100));
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
  // WHOLE, WHICH THIS MESSAGE HAS ALWAYS SAID AND NOTHING HAS EVER CHECKED.
  // `gratitude_log.amount` is an `int` (drizzle/0001_init.sql:85), so a
  // fractional tap is not carried: the column takes a rounded number while the
  // ledger posts the exact fraction in minor units, and the note the allowance
  // is summed from stops agreeing with the credit that was delivered. At 0
  // decimals both ends round together and the split is invisible; at 4 a give
  // of 5.5 posts 55000 and logs 6. A refusal in a sentence beats a silent
  // truncation of somebody's gift.
  if (!Number.isFinite(amount) || amount <= 0 || !Number.isInteger(amount)) {
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
  /**
   * HUMAN units. This is written verbatim into `gratitude_log.amount`, an
   * `int` column, and that column is what both allowance readers sum. The
   * ledger posting carries the CALLER's unit and is the caller's business:
   * `give` converts with `toLedgerUnits` inside the `post` it hands in, and
   * `sendGratitude` converts at its own posting after this returns.
   */
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

    /*
     * ONE READ OF THIS GIVER'S CYCLE, TWO LIMITS WEIGHED OFF IT.
     *
     * The allowance and the per-recipient share used to be three statements:
     * `allowanceFor` ran its own two, and a third summed the pair. They read
     * the same rows and they read them through two windows, because
     * `allowanceFor` called `cycleWindow()` for itself and the pair sum called
     * it again, so a give landing on a cycle boundary could be charged against
     * one cycle and capped against the other. One read now answers both, under
     * one window and one lock.
     *
     * THE SHARE IS NET OF REVERSALS TOO, which it was not before. It summed
     * `gratitude_log` for the pair and subtracted nothing, so a member whose
     * gift to somebody was reversed got their allowance back and could not
     * spend it on the person it came back from. The refund follows the GIVER
     * and it has to follow them all the way down.
     */
    const { startsAt, endsAt, key } = cycleWindow();
    const giving = await gratitudeGivenInCycle(conn, input.fromUserId, startsAt, endsAt);
    const allowance = allowanceFrom(allowanceTotalFor(stageMultiplier), key, giving);
    const alreadyToThisPerson = alreadyGivenTo(giving, input.toUserId);

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
        // THE ONE CONVERSION ON THIS PATH (sweep lane F). `amount` is human
        // everywhere above: weighed against the allowance by `checkGive`,
        // written to `gratitude_log.amount` by the row this post rides with,
        // and printed back to the member in every refusal. `postTransferOn`
        // takes MINOR units. Converting at the top of `give` instead would
        // corrupt all three of those readers at once; converting at the
        // boundary is what `mintForConfirmedClaim` already does.
        amount: toLedgerUnits(HEARTS, amount),
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
 *
 * UNITS, because the sweep points other callers at this function as the worked
 * example. The human number leaves `mint_rules.amount`, a `decimal(18,4)`;
 * `ceilingOutcome` converts it once, at a scale it is handed, and answers in
 * the token's minor units with the ceiling already applied to THAT integer;
 * and a rule whose amount rounds below the token's own resolution is refused
 * out loud instead of being paid as zero. Nothing below that line converts
 * again and nothing above it posts.
 *
 * THE DECIMALS SWEEP CALLED THIS PATH ALREADY RIGHT AND IT WAS NOT. The
 * conversion happened once, which is what the sweep checked, and it happened
 * AFTER the comparison the ceiling had just won: `min(0.6, 0.5)` rounded to 1
 * on a whole-unit token and posted twice the cap. The sweep's own sentence is
 * why it went unseen for a moon, so it is corrected here instead of removed.
 */
export async function mintForConfirmedClaim(
  pool: Pool,
  claim: { id: string; questId: string; userId: string; confirmedAt?: Date | string | null },
): Promise<{
  /**
   * WHAT THE LEDGER ROW HOLDS, and nothing derived from it.
   *
   * The integer in the token's minor units, the scale that integer is in, and
   * the slug it is of: R31's shape, from the one place that knows all three.
   * This used to report the clamp's answer in HUMAN units, taken before
   * `toLedgerUnits` ran, so a caller reading it was reading a number that
   * exists nowhere in the database. `SettlementResult.minted` now carries the
   * same three fields under the same names, so the two paths can finally be
   * read the same way; before this they differed by `10 ** decimals` and only
   * a field name said so.
   */
  minted: Array<{ token: string; units: number; decimals: number }>;
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
  const minted: Array<{ token: string; units: number; decimals: number }> = [];
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
    const asked = r.amount;
    // Zero is a decision and stays quiet. A village that sets a rule to 0 has
    // said "not this one, not now", and shouting about it every consent would
    // bury the rules that are genuinely broken.
    if (asked <= 0) continue;
    // A rule the engine cannot honour is REPORTED, not skipped. This used to
    // be `if (!faucet) continue`, which is how a village could enable a
    // credits rule, watch the Mint panel say it pays, and find out a moon
    // later that nobody had ever been paid by it.
    const problem = ruleCannotPay(r.tokenSlug);
    if (problem) {
      unpayable.push({ token: r.tokenSlug, reason: problem });
      continue;
    }
    // THE CEILING BINDS HERE, and until this line it bound nowhere at all:
    // `clampToCeiling` had no caller in the shipped server, so a rule left at
    // `amount 25, ceiling 5` by a ballot that lowered only the ceiling went on
    // paying 25 for ever.
    //
    // IT BINDS IN MINOR UNITS, and this line used to hand a human number to
    // `toLedgerUnits` on the next one. `mint_rules.ceiling` is `decimal(18,4)`
    // and this token may carry 0 decimals, so the comparison was exact and the
    // rounding after it was not bounded by anything: a ceiling of 0.5 paid one
    // whole unit. The scale is passed in rather than looked up inside, per R31.
    const decimals = decimalsFor(r.tokenSlug);
    const capped = ceilingOutcome(r, asked, decimals, tokenDef(r.tokenSlug)?.name ?? r.tokenSlug);
    if (capped.refusal) {
      unpayable.push({ token: r.tokenSlug, reason: capped.refusal });
      continue;
    }
    // Already the ledger's own integer. Nothing below this line converts.
    const amount = capped.units;
    // KEPT, NOT DELETED, and the sweep asked the question explicitly.
    // `mint_rules.amount` is `decimal(18,4)`, so the smallest non-zero human
    // figure a rule can carry is 0.0001, which at four decimals converts to 1
    // and never to 0. On a token at 4 or more decimals this branch is
    // therefore unreachable, and it goes quiet rather than red, which is the
    // dangerous way for a guard to die. It stays because it is a function of
    // the TOKEN's decimals and not of the ruling: `tokens.decimals` is an int
    // a village writes, `registerToken` takes whatever it is given, and any
    // token registered below four decimals re-arms this immediately. Deleting
    // a guard because today's data cannot reach it is how the `faucetFor`
    // credits defect shipped. It costs one comparison. (sweep lane F)
    //
    // IT NOW MEANS ONLY THE AMOUNT. A ceiling that falls to nothing at this
    // scale is refused above, by name, so reaching here with a zero means the
    // rule's own amount rounded away and `asked` is the number to quote.
    if (amount <= 0) {
      // Below the token's own resolution. Also a promise that cannot be kept,
      // and the founder can only fix it if somebody says so.
      unpayable.push({
        token: r.tokenSlug,
        reason: `${asked} is smaller than the smallest amount this token can hold`,
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
      idempotencyKey: keys.questCompleted(villageId(), claim.questId, claim.id, claim.userId, r.tokenSlug),
    });
    // THE ROW, not the number before it was rounded. This used to report the
    // human figure the clamp had answered, so a rule at 0.0015 on a token at
    // three decimals returned 0.0015 while the row held one thousandth: a
    // route logging the return value told the member a number no row in this
    // database holds. `units` plus `decimals` plus the slug is R31's shape.
    if (res.ok && !res.duplicate) minted.push({ token: r.tokenSlug, units: amount, decimals });
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
  /**
   * What each `role.cycle` rule paid: the integer the ledger row holds, the
   * scale it is in, and the slug it is of (R31). The conversion happens once,
   * inside `ceilingOutcome`, and the seat loop below posts its answer without
   * touching it again.
   *
   * `mintForConfirmedClaim` now reports the same three fields under the same
   * names. It used to report HUMAN units under the name `amount`, and the two
   * field names were the only thing telling the paths apart, so a reader
   * copying one call site's handling onto the other was wrong by
   * `10 ** decimals`. There is nothing left to copy wrong.
   */
  minted: Array<{ token: string; units: number; decimals: number }>;
  alreadyRun: boolean;
  /**
   * Enabled `role.cycle` rules the engine could not honour, once each rather
   * than once per seat. A settlement that quietly paid two of three promised
   * tokens used to be indistinguishable from one that paid all three.
   */
  unpayable: Array<{ token: string; reason: string }>;
  /**
   * What waned this cycle. ALWAYS PRESENT, zeros and all, never undefined.
   *
   * An optional field would let a reader mistake "waning did not run" for
   * "nothing waned", and those are two different facts about a village. Every
   * number is 0 when the dial is 0 AND when the engine never reached the step,
   * with `cycleKey` still naming the real lunation, so a reader gets a shape
   * they can print rather than a `decay?.holders` that renders as blank.
   *
   * `pct` is the one field that separates the cases it can separate: it is
   * whatever the dial said IF the step got as far as reading it, and 0 when it
   * did not (no enabled rules). It is not a substitute for reading the dial.
   */
  decay: VoiceDecaySummary;
}

/** What one cycle's waning did, in the token's own minor units. */
export interface VoiceDecaySummary {
  /** The token that wanes. `village-voice` today, and the only one. */
  slug: string;
  /** The rate this run read off the dial, as a percent. */
  pct: number;
  /** Units posted to the sink by this run, in minor units of `slug`. */
  total: number;
  /** Members whose Voice actually waned in this run. */
  holders: number;
  /** Members whose share of the rate floored to nothing at this precision. */
  skippedTooSmall: number;
  /** Members with an open exit, left alone until they have settled. */
  skippedExiting: number;
  /** The lunation this waning is keyed on. */
  cycleKey: string;
}

/**
 * WHAT WANES AT THE CLOSE OF A MOON (R3, R15).
 *
 * The founder's ruling: Voice can decay, it starts at 1 percent a lunar cycle,
 * a village may set any percent, and the waning is uniform over Voice that was
 * bought and Voice that was earned alike.
 *
 * IT IS A POSTING AND NEVER A REWRITE. Waning moves units from `mem:<user>` to
 * `sys:voice-decay` through `postTransfer` like every other movement in this
 * platform, so per token SUM(balance) is still 0 afterwards, a member can read
 * the row that took it, and a ballot's frozen weights read whatever the ledger
 * held when they opened. Editing a balance row would have broken all three at
 * once, and `token_balances` is a cache that is recomputed rather than
 * incremented in any case.
 *
 * THE ARITHMETIC IS IN MINOR UNITS AND IT FLOORS. `Math.floor(balanceUnits *
 * pct / 100)`, computed on the ledger's own integers. Floor and not round is
 * the load-bearing half: rounding up takes MORE than the dial says, and a
 * taking that exceeds its published rate is the one direction that must never
 * happen. Floor also makes "too small to wane" an explicit, counted fact
 * instead of a unit quietly costed to somebody. At VOICE_DECIMALS = 3 and 1
 * percent, 5 Voice is 5000 units and wanes 50; 0.05 Voice is 50 units and
 * wanes nothing at all. A zero posting is never attempted, because
 * `postTransfer` refuses it and a refusal inside a loop reads as an error.
 * That count is reported for the reason `reportUnpayable` exists: a rule that
 * reaches nobody while looking alive is the hardest failure to notice.
 *
 * WHO IS EXEMPT, and both exemptions are argued rather than convenient.
 *
 *  - Every system account, INHERITED from `kind = 'member'` and never written
 *    as a special case. `sys:voice-bridge` holds Voice against an open claim,
 *    debited from the member the moment they ask, and every ending that is not
 *    a confirmation gives it back by REVERSING that debit. Waning the bridge
 *    would change the amount arriving at the far end of a crossing that has
 *    already been quoted, and the later refund would then hand back a
 *    different number than was taken. `sys:voice-settled` is the same story.
 *  - A member with an open exit. Their balances are already on the way to
 *    `sys:exit-settlement` and a notice period has been quoted to them, so
 *    moving the number mid departure changes what they settle at after they
 *    were told. `openExitFor` is the reader, so this cannot drift from what
 *    the exit process itself calls open.
 *
 * AN ABSENT MEMBER WANES LIKE ANYBODY ELSE, and that is the entire mechanism.
 * There is no absent flag in this path and exempting absence would leave the
 * dial with nothing to do.
 *
 * ONE EDGE THIS DOES NOT SMOOTH, measured and named rather than discovered.
 * The settlement job asks hourly, and a member holding NOTHING when the moon's
 * first ask runs is not in the read at all, so no key is written for them. If
 * they are paid later in that same moon, the next hourly ask finds a positive
 * balance and wanes one percent of the payout they have only just received.
 * Everybody who already held Voice at the first ask wanes against the balance
 * they carried in, once, and is then locked by the key. The residue is one
 * percent of one cycle's earnings for somebody who started that cycle at zero,
 * it happens once in a member's life, and closing it would mean writing a
 * ledger row of zero, which `postTransfer` refuses for good reasons.
 *
 * NOBODY IS NAMED IN THE ROW. R65 and R66 rule that no party may strip
 * another's earned voice, and a row naming an admin would read as exactly that
 * act. The word is "waned" because the ruling turns on the distinction.
 */
export async function decayVoice(
  pool: Pool,
  at: Date = new Date(),
  /*
   * Where a refusal goes. `postTransfer` RETURNS `ok: false` for a missing
   * system account rather than throwing, so a village whose `sys:voice-decay`
   * row never landed would otherwise wane nothing, silently, forever. That
   * belongs in the settlement's own report beside an unpayable rule: it is the
   * same class of failure, a mechanism that looks alive and reaches nobody.
   *
   * NOT a boot invariant, deliberately. Refusing to start a village over a
   * report line is a worse outcome than the thing being reported, and the
   * account is seeded by a migration that a fresh village always runs.
   */
  unpayable: Array<{ token: string; reason: string }> = [],
): Promise<VoiceDecaySummary> {
  const { key: cycleKey } = cycleWindow(at);
  const out: VoiceDecaySummary = {
    slug: VILLAGE_VOICE,
    pct: 0,
    total: 0,
    holders: 0,
    skippedTooSmall: 0,
    skippedExiting: 0,
    cycleKey,
  };

  // A dial nobody has touched reads its DEFAULT of 1, and a dial somebody set
  // to 0 reads 0. `parseVariable` falls back to the def's default only when
  // there is no override row, so an unset dial and a real zero are different
  // facts here and neither is guessed.
  const pct = numberVar("economy.voice_decay_pct");
  out.pct = pct;
  if (!(pct > 0)) return out;

  /*
   * The basis dial ships with ONE value, and the reason is written into its
   * own description: a member's balance already IS their unspent Voice.
   * Voice leaves a member account through a voice claim and through an exit
   * sweep, and both have already taken it out of the balance by the time this
   * reads it, so there is no second number for an `unspent` basis to mean.
   *
   * Anything other than `all` therefore wanes NOTHING rather than guessing at
   * a rule nobody wrote. `validateVariable` cannot store an unknown value, so
   * the only way here is a hand-written row, and failing closed in the taking
   * direction is the only safe way to fail.
   */
  if (stringVar("economy.voice_decay_basis") !== "all") return out;

  /*
   * NOTHING WANES BEFORE THE VILLAGE VOTES ITS GAME INTO EXISTENCE, and this
   * guard is here because `economyReady` does NOT provide it.
   *
   * The design this was built from said a pre-launch village is protected by
   * `economyReady`, on the reasoning that it has no enabled rules yet. It has:
   * `seedEconomy` writes four of the five seeded rules with `enabled: 1` at
   * BOOT, months before any launch ballot, so `economyReady` is true for a
   * village that has never issued a token. The founding allocation the
   * birthing lane issues before launch would then have waned before the vote,
   * which is the opposite of what that screen promises a catalyst.
   *
   * `postTransfer`'s own launch gate does not cover it either, and cannot: the
   * gate reads `ledger_accounts.faucet` and waning moves member to sink, so no
   * faucet is involved and nothing there fires. Taking value in a village that
   * is not yet issuing any is not something anybody agreed to, so the fact is
   * read here, from the same row the gate reads.
   */
  if (!(await readGameStart(pool)).started) return out;

  /*
   * `kind = 'member'` is what exempts every system account, and writing the
   * read this way rather than listing the accounts to skip is the whole point:
   * a system account added later is exempt by construction instead of by
   * somebody remembering to add it to a list.
   */
  const [holders] = await pool.query<RowDataPacket[]>(
    "SELECT b.`account_id`, a.`user_id`, b.`balance` FROM `token_balances` b " +
      "JOIN `ledger_accounts` a ON a.`id` = b.`account_id` " +
      "WHERE b.`token_type` = ? AND a.`kind` = 'member' AND a.`user_id` IS NOT NULL " +
      "AND b.`balance` > 0",
    [VILLAGE_VOICE],
  );

  /*
   * Each DISTINCT refusal once, for the reason the seat loop gives two hundred
   * lines below: a missing sink account refuses every member in the village,
   * and four hundred identical lines in a settlement report is a report nobody
   * reads. The sentence names the account, because "the transfer failed" sends
   * a reader looking in the wrong place.
   */
  const problems = new Map<string, string>();
  const refuse = (reason: string) => problems.set(reason, reason);

  for (const row of holders) {
    const userId = String(row.user_id);
    const balanceUnits = Number(row.balance);

    /*
     * The exit is asked FIRST, ahead of the cheaper arithmetic, so that a
     * leaver holding dust is reported as a leaver. The two counts are read by
     * a human deciding whether a village's waning is working, and "2 members
     * are in the middle of leaving" is the sentence that answers them; folding
     * one of those into "too small" would undercount the exemption that was
     * actually argued for. One query per Voice-holding member per run is the
     * price, and it buys the exit process's own definition of open instead of
     * a second copy of the status list here.
     */
    if (await openExitFor(pool, userId)) {
      out.skippedExiting += 1;
      continue;
    }

    const units = decayUnits(balanceUnits, pct);
    if (units <= 0) {
      out.skippedTooSmall += 1;
      continue;
    }

    const key = keys.voiceDecay(villageId(), cycleKey, userId, VILLAGE_VOICE);
    const tooLong = keyTooLong(key);
    if (tooLong) {
      // Loud and skipped. A truncated key would collide with another
      // occurrence and read as a duplicate, and the member it belonged to
      // would simply never wane while the books said they had.
      refuse(`Voice could not wane into "${VOICE_DECAY}": ${tooLong}`);
      continue;
    }

    const res = await postTransfer(pool, {
      from: memberAccount(userId),
      to: VOICE_DECAY,
      tokenType: VILLAGE_VOICE,
      amount: units,
      source: "voice_decay",
      // NOT in ALLOW_NEGATIVE_SOURCES, and it must never be: a waning that
      // could drive a member below zero would be a debt nobody incurred.
      sourceRef: cycleKey,
      description: "Voice that waned this moon",
      idempotencyKey: key,
    });
    if (res.ok && !res.duplicate) {
      out.holders += 1;
      out.total += units;
    } else if (!res.ok) {
      refuse(`Voice could not wane into "${VOICE_DECAY}": ${res.error ?? "the ledger refused the posting"}`);
    }
  }

  for (const reason of Array.from(problems.values())) {
    unpayable.push({ token: VILLAGE_VOICE, reason });
    // `console.error` and not `.log`, for the reason `reportUnpayable` gives:
    // a published rate that reaches nobody is a promise the village is making
    // and the engine is not keeping, and somebody should find it while
    // grepping for what went wrong.
    console.error(`[economy] waning ${cycleKey}: ${reason}`);
  }

  return out;
}

/**
 * Close one lunation.
 *
 * What it does: wanes each member's Voice by `economy.voice_decay_pct` into
 * `sys:voice-decay`, and thanks everyone holding a seat per the `role.cycle`
 * rules.
 *
 * THE CONTRACT WIDENED WHEN WANING LANDED and this paragraph widened with it.
 * This function used to say it "only pays what the rules already promised for
 * work already held", and that is no longer the whole of it: waning TAKES.
 * What it still does not do is reset an allowance, which needs no reset
 * because it was never stored, or close a gratitude cycle, which the scheduler
 * has been forbidden from doing since it was written. Releasing value is a
 * human act; taking a published percentage of a balance is not a release and
 * must not wait on a human, or a village whose admin is away would silently
 * stop waning while its dial said otherwise.
 *
 * A re-run is a no-op and a resumed partial run finishes, both for the same
 * reason: every mint is keyed on (cycle, seat, holder) and every waning on
 * (cycle, member, token), so the ledger itself remembers what happened. There
 * is no "has this cycle run" flag to get out of step with what actually did.
 *
 * WANING SITS AHEAD OF THE NO-RULES EARLY RETURN AND BEHIND `economyReady`,
 * and the two are separate decisions. A village whose only rule is
 * `quest.completed` has no `role.cycle` rule to pay, and it must still wane or
 * its dial reads 1 percent and does nothing. A village with no enabled rules
 * at all has an engine that is not running.
 *
 * `economyReady` is NOT what keeps a pre-launch village from being taken from,
 * although the design said it was. `decayVoice` reads the launch fact itself,
 * for the reason written at that line: seeded rules are enabled at boot, so
 * `economyReady` is true long before any ballot carries.
 *
 * UNITS. Every seat payment starts HUMAN, out of `mint_rules.amount`, and is
 * converted once with `toLedgerUnits` per rule immediately before `mint`, which
 * converts nothing itself. The waning step needs no conversion at all: it takes
 * a percentage of a balance the ledger already holds, and a percentage of a
 * number is in that number's unit. NO BEHAVIOUR CHANGED HERE in the decimals
 * sweep; this paragraph records why nothing had to.
 */
export async function runSettlement(pool: Pool, at: Date = new Date()): Promise<SettlementResult> {
  const { key: cycleKey } = cycleWindow(at);
  const out: SettlementResult = {
    cycleKey,
    stewardsThanked: 0,
    minted: [],
    alreadyRun: false,
    unpayable: [],
    decay: {
      slug: VILLAGE_VOICE,
      pct: 0,
      total: 0,
      holders: 0,
      skippedTooSmall: 0,
      skippedExiting: 0,
      cycleKey,
    },
  };

  const ready = await economyReady(pool);
  if (!ready.ready) return out;

  // Promote queued dial changes FIRST. A change stamped for this cycle is
  // meant to govern this settlement; reading the rules before promoting would
  // pay the old rate and then apply the new one a moon late, which is the
  // deferral working backwards.
  await applyPendingRules(pool, at);

  /*
   * AND THE SAME FOR A CIRCLE'S BUDGET MODE (0181).
   *
   * A queued mode change lands on a SEASON boundary by default while this
   * runs on a CYCLE, so most settlements promote nothing and the one after a
   * season turns promotes whatever was waiting. That is correct: the sweep
   * compares stored instants and does not care how often it is asked.
   *
   * IT IS A TIDY-UP AND NOT THE RULE. `modeAt` in shared/circleTreasury.ts
   * decides which model a circle is running from the row itself, so a village
   * whose scheduler is off still reads correctly. Making the promotion the
   * rule would mean a missed settlement left every circle running last
   * season's model with nothing anywhere saying so.
   */
  await applyPendingModes(pool, at);

  /*
   * WANING GOES HERE, AHEAD OF THE RULES READ, AND THE POSITION IS THE POINT.
   *
   * Two lines below is `if (!rules.length) return out;`, and that return is
   * the trap. A village whose only enabled rule is `quest.completed` has no
   * seat to pay and every reason to wane, and waning written after that line
   * would leave its dial reading 1 percent while nothing ever moved: no error,
   * no log line, a mechanism that is simply not there.
   *
   * It also means THIS MOON'S SEAT PAYOUT DOES NOT WANE THIS MOON. A balance
   * wanes after it has sat through a cycle, which is what makes the published
   * arithmetic true: an accrual of `a` a moon against a rate `d` settles at
   * `a / d` and stands at `a * (1 - (1 - d)^n) / d` after n moons from zero.
   * Waning after the seat loop would settle at `a * (1 - d) / d` instead, one
   * whole cycle of accrual lower, and every ceiling a founder is shown beside
   * the dial would be wrong by that much.
   *
   * Any problem it hits rides home on `out.unpayable`, the same channel an
   * unpayable rule uses, because a missing sink account is a settlement
   * warning a village can read and act on. It is deliberately NOT a boot
   * invariant: taking a village offline over a report line is a worse failure
   * than the failure.
   */
  out.decay = await decayVoice(pool, at, out.unpayable);

  // main replaced the lunar-only helper with the clock-aware one; a village on
  // the calendar clock was being settled against a lunar cycle number.
  const rules = await rulesFor(pool, "role.cycle", currentCycleNumber(at));
  if (!rules.length) return out;

  // Asked ONCE, before the seat loop, and not once per seat: an unpayable rule
  // is a fact about the rule, and reporting it per seat would turn one
  // misconfiguration into forty identical lines. Payable rules go on to the
  // loop; the rest are named here and never reach a mint call.
  //
  // Collected into their OWN array rather than read back off `out.unpayable`,
  // which waning may already have written to: `reportUnpayable` prints "the
  // rule on X paid nobody", and a missing sink account is not a rule.
  const ruleProblems: Array<{ token: string; reason: string }> = [];
  const payable = rules.filter((r) => {
    const problem = ruleCannotPay(r.tokenSlug);
    if (problem) {
      ruleProblems.push({ token: r.tokenSlug, reason: problem });
      return false;
    }
    // A SEAT POSTS NO AMOUNT, so a rule that reads its amount from the work
    // can never pay one, on any moon, ever. This was silent: `r.amount ?? 0`
    // read null as zero, the ceiling check below was guarded on that zero
    // being positive, the rule sailed through this filter into `payable`, the
    // seat loop paid nothing, and `alreadyRun` then went true because
    // `payable.length > 0`. A misconfiguration was reported as a completed
    // moon, which is the reading that stops anybody looking. Named here, in
    // the same words `mintForConfirmedClaim` uses for the same shape.
    if (r.amount === null) {
      ruleProblems.push({
        token: r.tokenSlug,
        reason: "this rule reads its amount from the work, and a seat posts no amount in this token",
      });
      return false;
    }
    // A ceiling of zero is the third way, and the same class again: the row
    // says the rule pays 25 and says the most it may pay is nothing. Asked
    // ONCE here rather than once per seat, like every other reason in this
    // filter. See `clampToCeiling` for what the column bounds, and
    // `ceilingAtScale` for why the answer is in minor units.
    const decimals = decimalsFor(r.tokenSlug);
    const capped = ceilingOutcome(r, r.amount, decimals, tokenDef(r.tokenSlug)?.name ?? r.tokenSlug);
    if (r.amount > 0 && capped.refusal) {
      out.unpayable.push({ token: r.tokenSlug, reason: capped.refusal });
      return false;
    }
    // An amount that rounds to nothing in this token's minor units is the
    // other way a rule pays nobody while looking alive. Same class, same
    // report: a rule of 0.1 on a whole-unit token posts zero.
    const human = r.amount;
    // KEPT for the reason written at its twin in `mintForConfirmedClaim`: on a
    // token at four decimals this cannot fire, because `mint_rules.amount` is
    // `decimal(18,4)`, and it stays because the next token a village registers
    // may carry fewer. (sweep lane F)
    if (human > 0 && capped.units <= 0) {
      ruleProblems.push({
        token: r.tokenSlug,
        reason: `${human} is smaller than the smallest amount this token can hold`,
      });
      return false;
    }
    return true;
  });
  out.unpayable.push(...ruleProblems);
  reportUnpayable(`settlement ${cycleKey}`, ruleProblems);

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
      // Clamped, like the quest path, and for the same reason: the ceiling is
      // what the village voted on and the amount is what it typed first. The
      // filter above has already reported a ceiling of zero once for the whole
      // rule, so this loop only has to stop paying. The answer is already the
      // ledger's own integer, so nothing here converts it a second time.
      const decimals = decimalsFor(r.tokenSlug);
      const units = ceilingOutcome(r, r.amount ?? 0, decimals).units;
      if (units <= 0) continue;
      const faucet = faucetFor(r.tokenSlug)!;
      const res = await mint(pool, {
        toUserId: userId,
        tokenSlug: r.tokenSlug,
        amount: units,
        from: faucet,
        source: "role_cycle",
        sourceRef: seatId,
        description: `Thanks for holding a seat through ${cycleKey}`,
        // Two seats are two thanks, and the same seat next moon is another.
        idempotencyKey: keys.roleCycle(villageId(), cycleKey, seatId, userId, r.tokenSlug),
      });
      if (res.ok && !res.duplicate) {
        paid.add(userId);
        out.minted.push({ token: r.tokenSlug, units, decimals });
      }
    }
  }
  out.stewardsThanked = paid.size;
  /*
   * Nothing new to pay means this cycle was already settled, which is the only
   * honest way to know: the ledger is the record, not a flag beside it.
   *
   * Unless nothing COULD be paid. A run where every rule was unpayable also
   * mints nothing, and calling that "already settled" would report a
   * misconfiguration as a completed moon, which is the reading that stops
   * anybody looking.
   *
   * `payable.length > 0` WAS NOT THAT TEST, and the comment above it was
   * already the right sentence attached to the wrong condition. Two states
   * reached it with an empty ledger and no report at all:
   *
   *   a rule that survives every reason in the filter and still pays nothing,
   *   which was every `from_source` seat rule and every rule a village had set
   *   to zero;
   *
   *   a village with a working rule and nobody in a seat, where there was
   *   never anything to settle and no run could have paid it.
   *
   * So the condition asks what it means: was there a payment this run could
   * have made. `WOULD PAY` re-asks the clamp because a rule can be payable and
   * still answer zero, and the seat count because a payment needs somebody to
   * receive it. Both directions of the mistake are one-sided and this is the
   * safe side: reporting "not settled" when it was costs a log line the caller
   * already guards on `stewardsThanked`, and reporting "settled" when nothing
   * ever could be costs the village its only signal.
   */
  const wouldPay = payable.filter(
    (r) => ceilingOutcome(r, r.amount ?? 0, decimalsFor(r.tokenSlug)).units > 0,
  );
  out.alreadyRun = out.minted.length === 0 && wouldPay.length > 0 && seats.length > 0;
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
    /*
     * THE ENGINE'S NUMBER, THROUGH THE ENGINE'S OWN FUNCTION.
     *
     * This feed is unauthenticated and it is what a member reads before they
     * decide whether to do the work. It used to print `mint_rules.amount`
     * straight, and consult the ceiling only on the from_source branch, so a
     * rule at `amount 25, ceiling 5` published "25 Village Credits when a
     * steward confirms finished work" while the engine paid 5, and a rule at
     * ceiling 0 published 25 while the engine paid nothing at all.
     *
     * `decimals` comes off the same joined row as the name, so the sentence is
     * built at the scale the payment is actually made in and a token's scale
     * moving needs no change here.
     */
    const decimals = Number(r.decimals ?? 0);
    const decided = ceilingOutcome(
      { tokenSlug: String(r.token_slug), amount, ceiling },
      0,
      decimals,
      name,
    );
    const capUnits = ceilingAtScale(ceiling, decimals);
    // Plain sentences, not a table dump. Somebody reading this is asking what
    // the village does, and "quest.completed / 0.1 / 1 / claimant" answers a
    // different question than they asked.
    const what =
      amount === null
        ? capUnits > 0
          ? `up to ${humanAtScale(capUnits, decimals)} ${name}, as much as the work was posted for`
          : `no ${name}, because this rule's ceiling stops every payment`
        : decided.units > 0
          ? `${humanAtScale(decided.units, decimals)} ${name}`
          : `no ${name} at present`;
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
 * Every faucet account in this database, read from the flag that defines one.
 *
 * WHY THIS EXISTS. Two supply surfaces used to name five accounts by hand
 * (`publicSupply` below and the per-source breakdown inside `mintView`) while
 * `GET /api/admin/tokens` derived the same set from `ledger_accounts.faucet =
 * 1`. The three agreed, and nothing made them agree: the five hand-written ids
 * matched the five rows the migrations seed with the flag, so a sixth faucet
 * would have dropped silently out of both supply figures while the tokens
 * route kept counting it. Two published numbers would have stopped counting a
 * real source and no error would have said so anywhere.
 *
 * ONE HELPER RATHER THAN THE SAME SELECT TWICE, because spelling a derived
 * read twice is how the hand-kept list happened the first time: the sentence
 * explaining what a faucet is has one home, and the sixth faucet reaches both
 * surfaces on the day it is seeded rather than on the day somebody remembers
 * two more edits.
 *
 * THE FLAG IS THE DEFINITION, and it already governs more than reporting:
 * `postTransfer` reads it for the launch gate and for the issuance rules, and
 * each faucet's negative balance IS that token's issued supply. So a supply
 * figure derived from anything else is answering a different question from the
 * one the ledger enforces.
 *
 * AN EMPTY RESULT IS A REAL ANSWER AND NOT AN ERROR, and callers must tell it
 * from a zero. A database with no faucet row has not been migrated; it has not
 * issued nothing. Both callers below return an empty supply rather than
 * building `IN ()`, which is a MySQL syntax error and would take the public
 * feed down with a message about SQL.
 */
export async function faucetAccounts(pool: Pool): Promise<string[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT `id` FROM `ledger_accounts` WHERE `faucet` = 1 ORDER BY `id`",
  );
  return rows.map((r) => String(r.id));
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
 *
 * WHY `waned` IS HERE AND WHY `circulating` IS DERIVED FROM IT.
 *
 * `issued` counts what came OUT of a faucet, and nothing ever puts it back:
 * waning moves Voice from a member to `sys:voice-decay`, which is not a
 * faucet, so `issued` keeps climbing while every wallet in the village
 * shrinks. Reporting that number alone would have the public books saying
 * more Voice is out there every moon while members watched their own chips
 * fall, which is the reading that makes a village stop trusting its own
 * ledger. So the sink's balance is published beside the faucet's, and
 * `circulating` is the subtraction, done here once rather than by every
 * reader.
 *
 * `mintView` is deliberately left alone: it answers where Voice came FROM,
 * and waning is not a source.
 */
export async function publicSupply(pool: Pool): Promise<{
  cycleKey: string;
  tokens: Array<{ token: string; issued: number; waned: number; circulating: number; decimals: number }>;
}> {
  const { key } = cycleWindow();
  // DERIVED, NEVER TYPED (see `faucetAccounts`). This list used to be five
  // hand-written ids, and `sys:cycle-pool` had already been missing from it
  // once: the faucet every village credit has ever come out of, so the public
  // supply feed reported four tokens and silently omitted the one members
  // actually spend. The flag cannot forget a faucet the way a list can.
  const faucets = await faucetAccounts(pool);
  // No faucet row at all is an unmigrated database, not a village that has
  // issued nothing, and the two must not render the same. Returning here also
  // keeps `IN ()` off the wire, which MySQL refuses to parse.
  if (faucets.length === 0) return { cycleKey: key, tokens: [] };
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT b.`token_type` AS slug, t.`name`, t.`decimals`, SUM(-b.`balance`) AS issued " +
      `FROM \`token_balances\` b JOIN \`tokens\` t ON t.\`slug\` = b.\`token_type\` ` +
      `WHERE b.\`account_id\` IN (${faucets.map(() => "?").join(",")}) AND t.\`active\` = 1 ` +
      "GROUP BY b.`token_type`, t.`name`, t.`decimals` HAVING issued > 0 ORDER BY t.`sort_order`, t.`slug`",
    faucets,
  );

  // The sink, per token. One row today and the query does not assume it: a
  // second waning token later needs no change here.
  const [waned] = await pool.query<RowDataPacket[]>(
    "SELECT `token_type` AS slug, `balance` FROM `token_balances` WHERE `account_id` = ?",
    [VOICE_DECAY],
  );
  const wanedBySlug = new Map(waned.map((r) => [String(r.slug), Number(r.balance ?? 0)]));

  return {
    cycleKey: key,
    tokens: rows.map((r) => {
      const issued = Number(r.issued ?? 0);
      const gone = wanedBySlug.get(String(r.slug)) ?? 0;
      return {
        token: String(r.name ?? r.slug),
        issued,
        waned: gone,
        circulating: issued - gone,
        decimals: Number(r.decimals ?? 0),
      };
    }),
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

  // The SAME bound the ballot path checks at raise, from the same function, so
  // the two writers cannot come to disagree about what a village may vote for.
  // It covers what `decimal(18,4)` can hold and what it would round away: a
  // ceiling of 0.00001 used to store as 0.0000 and answer `ok`, which is a
  // refusing ceiling nobody asked for, and an amount of 0.00001 used to store
  // as 0.0000, which is a silent off switch. At 1e14 the column threw an
  // out-of-range error from inside the ballot executor after the vote carried.
  if (change.ceiling !== undefined) {
    if (!Number.isFinite(change.ceiling) || change.ceiling < 0) {
      return { ok: false, error: "a ceiling is zero or more, and zero means zero" };
    }
    const bad = mintRuleNumberProblem("ceiling", change.ceiling);
    if (bad) return { ok: false, error: bad };
  }
  if (change.amount !== undefined && change.amount !== null) {
    if (!Number.isFinite(change.amount) || change.amount <= 0) {
      return { ok: false, error: "an amount is greater than zero, or null to read it from the source" };
    }
    const bad = mintRuleNumberProblem("amount", change.amount);
    if (bad) return { ok: false, error: bad };
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
    const step = 1 / 10 ** decimalsFor(slug);
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
    const scaled = Number(change.amount) * 10 ** decimalsFor(slug);
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
     * IT NOW CARRIES THE CEILING'S REFUSAL TOO, folded in. A rule the engine
     * refuses because its ceiling is zero, or because its ceiling falls below
     * what the token can hold, is the same class of fact as a rule with no
     * faucet: enabled, printed, and paying nobody. One field, so the panel has
     * one thing to branch on and cannot show a green badge over half of them.
     */
    problem: string | null;
    /**
     * WHAT ONE OCCURRENCE ACTUALLY PAYS, in this token's minor units with the
     * scale beside it (R31).
     *
     * `units` is null for a rule that reads its amount from the work, whose
     * payment is whatever the work posted, capped at `ceilingUnits`.
     * `ceilingUnits` is the ceiling AS THE ENGINE ENFORCES IT, which is the
     * `ceiling` field above floored into minor units, and the two disagree
     * whenever the column carries places the token cannot: 0.5 on a whole-unit
     * token is a `ceiling` of 0.5 and a `ceilingUnits` of 0.
     *
     * The panel prints these and never `amount`. Printing `amount` is how the
     * Mint panel came to show a confident "25 Village Credits" over a rule the
     * engine paid 5 on, with no ceiling anywhere on the card.
     */
    pays: { units: number | null; ceilingUnits: number; decimals: number };
    pending: null | { amount: number | null; ceiling: number; enabled: boolean; fromCycle: number };
  }>;
  /** Per token per SOURCE. Admin only: the public feed is totals-only. */
  supply: Array<{ token: string; source: string; issued: number }>;
  /**
   * What the next settlement would pay, per token, over every seat.
   *
   * `units` is the integer the ledger rows would hold and `decimals` is the
   * scale it is in (R31). It used to be `units` alone, with no scale anywhere
   * in the payload, and `client/src/pages/Mint.tsx` printed it raw: 25 at 0
   * decimals and 250000 at 4, for the same 25 the village promised. A client
   * could not have converted it if it had tried.
   */
  settlementPreview: { seats: number; mints: Array<{ token: string; units: number; decimals: number }> };
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
  //
  // DERIVED, NEVER TYPED, from the same helper the public feed reads. The five
  // ids used to be written out here as well, and the cycle pool had already
  // been missing from both: without it the admin's own per-source breakdown
  // could not see a single credit this village had ever issued.
  const faucets = await faucetAccounts(pool);
  const [supply] = faucets.length
    ? await pool.query<RowDataPacket[]>(
        "SELECT `token_type` AS token, `source`, SUM(`amount`) AS issued FROM `token_ledger` " +
          `WHERE \`from_account\` IN (${faucets.map(() => "?").join(",")}) ` +
          "GROUP BY `token_type`, `source` ORDER BY `token_type`, `source`",
        faucets,
      )
    : // An unmigrated database, said as an empty breakdown rather than as a
      // SQL parse error on `IN ()`. Nothing here can tell it from a village
      // that has issued nothing, which is why `faucetAccounts` says so.
      [[] as RowDataPacket[]];

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
    rules: rules.map((r) => {
      const slug = String(r.token_slug);
      const amount = r.amount === null ? null : Number(r.amount);
      const ceiling = Number(r.ceiling ?? 0);
      const decimals = decimalsFor(slug);
      const name = String(r.token_name ?? slug);
      const decided = ceilingOutcome({ tokenSlug: slug, amount, ceiling }, 0, decimals, name);
      return {
      id: String(r.id),
      trigger: String(r.trigger),
      token: slug,
      tokenName: name,
      amount,
      ceiling,
      recipient: String(r.recipient ?? "claimant"),
      enabled: !!r.enabled,
      // The token's refusal first, because it is the one the engine hits
      // first: a rule on a token with no faucet never gets as far as its own
      // ceiling. Only a rule with a real amount can have a ceiling problem;
      // an amount of zero is a village's off switch and gets no sentence.
      problem: ruleCannotPay(slug) ?? ((amount ?? 0) > 0 ? decided.refusal : null),
      pays: {
        units: amount === null ? null : decided.units,
        ceilingUnits: ceilingAtScale(ceiling, decimals),
        decimals,
      },
      pending:
        r.pending_from_cycle === null || r.pending_from_cycle === undefined
          ? null
          : {
              amount: r.pending_amount === null ? null : Number(r.pending_amount),
              ceiling: Number(r.pending_ceiling ?? 0),
              enabled: !!r.pending_enabled,
              fromCycle: Number(r.pending_from_cycle),
            },
      };
    }),
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
    //
    // AND ONLY WHAT THE CEILING LETS IT PAY. The comment above this block says
    // the preview must agree exactly with the settlement filter, and it never
    // called `ceilingOutcome` at all: a rule at `amount 25, ceiling 5` was
    // previewed at 25 a seat and paid 5, and at a ceiling of 0 it was still
    // previewed at 25 and paid nothing. It also multiplied BEFORE converting,
    // which is a second disagreement with the engine: the engine converts once
    // per seat and posts a whole number of units each time, so 0.5 over three
    // seats is three postings of 1 at 0 decimals and never `round(1.5)`.
    settlementPreview: {
      seats: seatCount,
      mints: cycleRules
        .filter((r) => r.amount !== null && r.amount > 0 && !ruleCannotPay(r.tokenSlug))
        .map((r) => {
          const decimals = decimalsFor(r.tokenSlug);
          return {
            token: r.tokenSlug,
            units: ceilingOutcome(r, 0, decimals).units * seatCount,
            decimals,
          };
        })
        .filter((m) => m.units > 0),
    },
  };
}
