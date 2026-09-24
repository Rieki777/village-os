/**
 * THE ECONOMICS HALF OF THE DRY RUN: what one cycle does to balances.
 *
 * ── WHAT THIS IS FOR ───────────────────────────────────────────────────────
 *
 * A founder standing up a village today cannot see a season before thirteen
 * people are depending on it. This model runs the season on paper. It is pure
 * arithmetic over the snapshot, it holds no connection, and it answers the one
 * question a founder cannot otherwise ask: if we set the dials here, who ends
 * up holding what, and what breaks.
 *
 * ── THE CARDINAL RULE, AS AN IMPORT GRAPH ──────────────────────────────────
 *
 * Nothing in `shared/dryRun/` imports anything under `server/`. This file
 * therefore MIRRORS the engine and never calls it: the faucet map, the
 * allow-negative set, the sink map and the mint order below are copies, each
 * one carrying the file and the function it was copied from. A copy can drift,
 * and the answer to that is `economicsModel.test.ts`, which derives every
 * expected number from the real code by reading it, and which walks this
 * file's import graph and fails if anything under `server/` or `mysql2` ever
 * becomes reachable from here.
 *
 * The one arithmetic this file does NOT mirror is the share of the whole that
 * one member holds. That lives in `shared/governanceShare.ts`, it is imported,
 * and a second implementation of it here is exactly what that file was split
 * out to prevent.
 *
 * ── IT DESCRIBES WHAT THE CODE DOES, NOT WHAT ANYONE INTENDED ──────────────
 *
 * Three places where those differ, all of them found by reading and all of
 * them modelled the way the code actually behaves:
 *
 *   1. THE CEILING BOUNDS ONE OCCURRENCE, never a cycle and never a member.
 *      `mint_rules.amount` and `mint_rules.ceiling` are both `decimal(18,4)`
 *      on the same row, so the clamp is in the rule's own human units and it
 *      happens BEFORE `toLedgerUnits`. A fixed-amount rule pays
 *      `min(amount, ceiling)`; a from_source rule pays `min(posted, ceiling)`;
 *      exactly at the ceiling pays; a ceiling of zero REFUSES, out loud, into
 *      the same `unpayable` list `ruleCannotPay` feeds; an amount of zero with
 *      a positive ceiling pays zero in silence, because that one is the
 *      village's own off switch.
 *      Eleven quests at 25 under a ceiling of 250 therefore issue 275, and
 *      that is correct: the cap is on the occurrence.
 *      `ceilingOutcome` (server/lib/economy.ts:590) is the one pure function
 *      that decides it, and this file MIRRORS it by table instead of importing
 *      it, because nothing here may name anything under `server/`. The table
 *      is in `economicsModel.test.ts` and it is the same eight rows that
 *      function's own test asserts.
 *   2. `runSettlement` (server/lib/economy.ts:1297) does NOTHING with the
 *      cycle pool. It pays `role.cycle` rules to seat holders and stops. The
 *      value pool is released by `POST /api/admin/cycles/close`
 *      (server/index.ts:21349), which is a human pressing a button. A village
 *      that never presses it never distributes a token, so the release is an
 *      assumption here and it says so out loud.
 *   3. the claim pricing skips the recognition token and ignores the
 *      rule's `recipient` column: it always pays the claimant. Both are
 *      modelled as written.
 *
 * ── WHO OWNS WHAT ON THE STATE ─────────────────────────────────────────────
 *
 * THE ENGINE OWNS `atIso` AND `cycle`. `runPass` stamps the cycle's own start
 * before a model steps and re-stamps it afterwards, so a model that advanced
 * the instant would be writing a value the engine discards. This model reads
 * the clock to say what cycle it is running and where the next boundary falls,
 * and it writes neither field.
 *
 * THE MODEL OWNS `models.economics`. That is the bag the contract gives each
 * model for what it remembers, keyed by model name so two models cannot
 * collide. `cloneState` shallow copies the bag per recorded cycle, so this
 * model REPLACES its entry every cycle and never edits one in place.
 *
 * ── MINOR UNITS AND bigint ─────────────────────────────────────────────────
 *
 * Every amount here is a `bigint` in minor units, because the ledger stores
 * integers and a preview of somebody's money that is close is worse than no
 * preview. `BigInt("...")` throughout, never a `123n` literal, which the build
 * target refuses (CLAUDE.md, House traps).
 *
 * ── WAVE 2 ─────────────────────────────────────────────────────────────────
 *
 * DECAY is still absent and there is still no hook for it, because there is no
 * setting in the variables registry to read. It belongs to the wave that adds
 * one.
 */
import { clockFor } from "../cycleClock";
import { VARIABLES_BY_KEY, parseVariable } from "../gameVariables";
import { shareOfTotal, topShares } from "../governanceShare";
import type {
  DomainModel,
  Flag,
  MemberSpec,
  MintRuleSpec,
  QuestsSummary,
  Rng,
  SimState,
  TokenSpec,
  Violation,
} from "./types";
import {
  DEFAULT_ECONOMICS_ASSUMPTIONS,
  describeAssumptions,
  parseEconomicsAssumptions,
  type EconomicsAssumptions,
} from "./economicsAssumptions";

// ── What the engine knows, mirrored by name ─────────────────────────────────

/** The key this model keeps its memo and its assumptions under. */
export const ECONOMICS_KEY = "economics";

/**
 * The only sources that may drive a NON-FAUCET account below zero.
 *
 * MIRRORED FROM `ALLOW_NEGATIVE_SOURCES`, declared at server/lib/ledger.ts:266,
 * spelt out here because this file may not import anything under `server/`. In
 * the SAME ORDER the keystone declares it, so a comparison can be exact.
 *
 * IT HELD TWO OF THREE AND THAT WAS A REAL DEFECT. `reversal` is every clawback
 * `reverse()` posts, and the keystone's own comment says why it is in the set:
 * a clawback has to be able to FINISH against a member who already spent what
 * it takes back. A mirror missing it called a lawful negative a broken ledger.
 * The keystone is static ON PURPOSE ("extending it is a one-line reviewed
 * change to the keystone, not a runtime registration"), so this copy is checked
 * against the real one by `server/dryRunMirror.test.ts`, which may import both
 * sides. That test is the only place the two can be compared, and it compares
 * them member for member and in order.
 */
export const ALLOW_NEGATIVE_SOURCES = ["stay_night", "payment_reversal", "reversal"];

/** The recognition token's slug (`HEARTS`, server/lib/economy.ts:78). */
export const RECOGNITION_SLUG = "gratitude";

/** The village's own voice token (`VILLAGE_VOICE`, economy.ts:80). */
export const VOICE_SLUG = "village-voice";

/** The trigger a confirmed quest fires (server/lib/economy.ts:1141). */
export const QUEST_TRIGGER = "quest.completed";

/** The trigger a cycle close fires for seat holders (economy.ts:1309). */
export const ROLE_TRIGGER = "role.cycle";

/**
 * Where a spent token lands, mirrored from `spendSinkFor`
 * (server/lib/spending.ts:139). Stay credits retire into the faucet that
 * issued them; everything else lands in the treasury, which is an ordinary
 * account the village can spend from.
 */
export const TREASURY = "sys:treasury";
export const STAY_CREDIT_SLUG = "stay-credit";
export const MINT_FAUCET = "sys:mint";

export function spendSinkFor(tokenSlug: string): string {
  return tokenSlug === STAY_CREDIT_SLUG ? MINT_FAUCET : TREASURY;
}

/**
 * WHAT THE CEILING LETS ONE OCCURRENCE POST.
 *
 * A MIRROR BY TABLE, never by import. `ceilingOutcome` in
 * server/lib/economy.ts:590 is the one pure function that decides this, and
 * `shared/dryRun/` may not name anything under `server/`, so this copy is held
 * to the engine's by the same eight rows its own test asserts. The table lives
 * in `economicsModel.test.ts`, and a drift between the two shows up there
 * rather than in a comment.
 *
 * WHAT IT BOUNDS, and this is the part that is easy to get wrong: ONE
 * OCCURRENCE. Not a cycle, not a member, no running total, no window.
 * `mint_rules.amount` and `mint_rules.ceiling` are both `decimal(18,4)` on the
 * same row, so the clamp is in the rule's own human units and it lands before
 * `toLedgerUnits`. Eleven quests at 25 under a ceiling of 250 legitimately
 * issue 275.
 */
export interface CeilingRuleLike {
  /** The fixed amount, or null when the amount rides on the source. */
  amount: number | null;
  /** The most one occurrence may pay. */
  ceiling: number;
  /** The token, for the refusal's sentence. */
  tokenSlug: string;
}

/** What the ceiling lets one occurrence post, and why it let it post nothing. */
export interface CeilingOutcome {
  /** What may be posted, in the rule's own human units. 0 posts nothing. */
  paid: number;
  /** Why the CEILING stopped it, in a founder's words, or null. */
  refusal: string | null;
}

/** Mirrors `clampToCeiling` (server/lib/economy.ts:534). */
export function clampToCeiling(posted: number, rule: CeilingRuleLike): number {
  const asked = rule.amount !== null ? Number(rule.amount) : Number(posted);
  if (!Number.isFinite(asked) || asked <= 0) return 0;
  const ceiling = Number(rule.ceiling);
  if (!Number.isFinite(ceiling) || ceiling < 0) return 0;
  return Math.min(asked, ceiling);
}

/** Mirrors `ceilingOutcome` (server/lib/economy.ts:590), row for row. */
export function ceilingOutcome(rule: CeilingRuleLike, posted: number, tokenName?: string): CeilingOutcome {
  const name = tokenName ?? rule.tokenSlug;
  const ceiling = Number(rule.ceiling);
  // The CEILING alone decides the refusal, never the clamp's answer: a
  // from_source rule's payable amount depends on what the work posted, so
  // reading a clamped zero as a broken ceiling would call every from_source
  // rule broken on every occurrence that posted nothing.
  if (!Number.isFinite(ceiling) || ceiling <= 0) {
    return {
      paid: 0,
      refusal:
        `this rule's ceiling is ${rule.ceiling}, so it can pay no ${name} at all. ` +
        "Raise the ceiling or pause the rule",
    };
  }
  return { paid: clampToCeiling(posted, rule), refusal: null };
}

/**
 * THE CEILING AS THE VILLAGE WROTE IT, with the rounded number as a fallback.
 *
 * `ceilingRaw` is the `decimal(18,4)` column's own text and the only unrounded
 * copy of the cap in the simulation. It is what the refusal is decided on.
 *
 * THE FALLBACK IS FOR A MALFORMED SPEC AND NOTHING ELSE. A conforming reader
 * pairs an empty `ceilingRaw` with `ceiling: null`, and the two together mean
 * no cap, which the caller handles before ever reaching here. The economy
 * snapshot reader keys both fields off one null check, so it cannot emit a real
 * cap beside empty text at all. If one arrives anyway, the old reading off
 * `ceiling` is the safest answer available with no text: a cap that rounded to
 * nothing is treated as a cap of nothing, which stops a payout rather than
 * letting one through.
 */
export function writtenCeiling(rule: MintRuleSpec, decimals: number): WrittenAmount {
  const fromText = writtenAmount(rule.ceilingRaw, decimals);
  if (fromText) return fromText;
  const minor = rule.ceiling ?? BigInt(0);
  return {
    raw: humanUnits(minor, decimals),
    exact: true,
    rounded: minor,
    floored: minor,
    positive: minor > BigInt(0),
  };
}

/**
 * The same decision in MINOR UNITS, which is what a `MintRuleSpec` carries.
 *
 * Clamping in minor units and clamping in human units answer the same number,
 * because `toLedgerUnits` is `Math.round(human * 10 ** decimals)` and rounding
 * is monotone: `round(min(a, c) * s)` equals `min(round(a * s), round(c * s))`.
 * So the model may clamp on the bigints it already holds and still be the
 * engine's answer.
 *
 * THE REFUSAL IS DECIDED ON `ceilingRaw`, NOT ON THE ROUNDED NUMBER, and that
 * is the whole reason the contract carries the text. Two different villages
 * arrive here holding `ceiling: BigInt(0)`:
 *
 *   ceilingRaw "0.0000"  a cap of nothing. `ceilingOutcome` refuses, out loud,
 *                        and the rule pays nobody on purpose.
 *   ceilingRaw "0.0004"  a cap a village typed below the token's own
 *                        resolution. The ENGINE reads 0.0004, finds it above
 *                        zero, and CLAMPS: `min(amount, 0.0004)` is 0.0004,
 *                        which `toLedgerUnits` then rounds to nothing and the
 *                        engine reports as smaller than the token can hold.
 *
 * Reading the second as the first would turn a fat-fingered cap into a total
 * stop and report a village nobody voted for. So the refusal asks the text.
 *
 * `ceiling: null` with an empty `ceilingRaw` means NO CAP, a shape the engine
 * cannot produce (the column is NOT NULL), so it clamps nothing and refuses
 * nothing. A snapshot that filled no text at all falls back to the rounded
 * number, which is the old reading and the safest one available without it.
 */
export function ceilingOutcomeMinor(
  rule: MintRuleSpec,
  postedMinor: bigint,
  decimals: number,
): { paid: bigint; refusal: string | null } {
  const asked = rule.amount !== null ? rule.amount : postedMinor;
  if (rule.ceiling === null) return { paid: asked > BigInt(0) ? asked : BigInt(0), refusal: null };
  const written = writtenCeiling(rule, decimals);
  // Above zero as the village WROTE it means the engine clamps, whatever the
  // rounded number says. Below or at zero as written means the engine refuses.
  if (!written.positive) {
    // The engine quotes the column's own human figure, and `Number` drops the
    // trailing zeros a whole number carries, so "0.0000" reads as the "0" the
    // engine prints.
    const quoted = String(Number(written.raw));
    return {
      paid: BigInt(0),
      refusal:
        `this rule's ceiling is ${quoted}, so it can pay no ${rule.tokenSlug} at all. ` +
        "Raise the ceiling or pause the rule",
    };
  }
  if (asked <= BigInt(0)) return { paid: BigInt(0), refusal: null };
  // The FLOORED reading, not `rule.ceiling`, and not the rounded one. The reader
  // scales the column the way a payment scales, which rounds half up, so a cap of
  // 0.5 on a whole-unit token arrived here as 1 and the model previewed twice the
  // cap the village wrote. The engine floors a bound in `ceilingAtScale`; this is
  // the same decision, so the preview and the run answer alike.
  const cap = written.floored;
  return { paid: asked < cap ? asked : cap, refusal: null };
}

/**
 * The share of the village's Voice above which the concentration flag speaks.
 *
 * A third, because a third of the weight is the point at which one holder can
 * block anything needing two thirds, and because a number a reader can check
 * beats a number tuned to look calm. There is no variable for this in the
 * registry, so the threshold is stated in the sentence the flag raises and a
 * founder can argue with it.
 *
 * The flag is a WARNING and it never blocks. The founder's ruling is that
 * transparency is the protection: a preview that refused to run because one
 * person held too much would be a preview that hid the fact.
 */
export const CONCENTRATION_THRESHOLD = 1 / 3;

// ── The memo the model keeps between step and flags ─────────────────────────

/** One rule's activity in one cycle, so the ceiling flags have something to read. */
export interface RuleActivity {
  ruleId: string;
  tokenSlug: string;
  minted: bigint;
  ceiling: bigint | null;
  fired: number;
  /** What the ceiling took off this cycle, summed over the occurrences. */
  clampedAway: bigint;
}

/** A rule that was enabled, in force, and paid nobody. Mirrors `ruleCannotPay`. */
export interface UnpayableRule {
  ruleId: string;
  tokenSlug: string;
  reason: string;
}

/** One member's share of the village's Voice, after the cycle. */
export interface VoiceShare {
  memberId: string;
  minor: bigint;
  share: number;
}

/**
 * WHAT THE MODEL REMEMBERS ABOUT THE CYCLE IT JUST RAN.
 *
 * Kept under `state.models.economics`, which is the bag the contract gives
 * each model. Replaced whole every cycle and never edited in place, because
 * `cloneState` copies the bag and cannot copy what is inside it.
 */
export interface EconomicsMemo {
  /** Which cycle this memo describes. */
  cycle: number;
  /** The village's own id for the cycle, from `clock.idFor`. */
  cycleId: string;
  /** The cycle's own bounds, from `clock.boundsFor`. */
  startsAt: string;
  endsAt: string;
  /** Where the next cycle begins, from `clock.nextBoundaryAfter`. The ENGINE
   *  moves the instant; this is here so a reader can see the boundary. */
  nextBoundaryAt: string;
  /** The assumptions this cycle actually ran under, resolved and printable. */
  assumptions: EconomicsAssumptions;
  /** What the village was measured doing, carried for the same reason. */
  quests: QuestsSummary;
  /** Whether the village may issue at all, from `SimState.launched`. */
  launched: boolean;
  /** How many two-account moves this cycle made. */
  postings: number;
  /** Quests confirmed this cycle, after the rate multiplier. */
  questsConfirmed: number;
  /**
   * Allowance granted this cycle, summed over the roll, IN HUMAN UNITS.
   *
   * Human because the engine's is: `allowanceFor` (server/lib/economy.ts:851)
   * returns a human total and reports human `spent` and `remaining`. The one
   * conversion on the giving path is at the posting. See `allowanceScale`.
   */
  allowanceTotal: bigint;
  /** Recognition actually given this cycle, in human units, as `gratitude_log` holds it. */
  gratitudeGiven: bigint;
  /** Allowance that expired unused this cycle, in human units (founder ruling R9). */
  gratitudeExpired: bigint;
  /** The token the value pool pays, and its size as the dial reads it. */
  poolToken: string;
  poolSize: bigint;
  /** What the pool actually released, and what its floors left behind. */
  poolDistributed: bigint;
  poolRemainder: bigint;
  /** Whether the pool close ran at all this cycle. */
  poolClosed: boolean;
  /** Per rule, what fired and what it paid. */
  rules: RuleActivity[];
  /** Rules that promised something the engine could not deliver. */
  unpayable: UnpayableRule[];
  /**
   * ALLOW-NEGATIVE DEBITS, summed, keyed by ACCOUNT AND TOKEN.
   *
   * Keyed by both because a negative is a fact about one account's holding of
   * ONE token. A memo keyed by the account alone let a `stay_night` debit of
   * credits exempt a negative in recognition, and made the verdict on two
   * identical balances depend on whichever debit happened to come last.
   *
   * SUMMED rather than remembered, because the bound is the honest reading:
   * the most a lawful negative can be is what the allow-negative postings
   * actually took out. `checkLedgerInvariants` (server/lib/ledger.ts:886)
   * exempts an account with ANY such debit today; the keystone lane is
   * bounding that, and this mirror is bounded from the start.
   */
  allowNegativeDebits: Record<string, bigint>;
  /** Faucet postings the closed-Game gate refused. */
  issuanceRefusals: number;
  /** Member stages with no `progression.multiplier.<stage>` in the registry. */
  stagesWithoutMultiplier: string[];
  /** Voice minted against each seat, cumulative over the run. */
  seatVoice: Record<string, bigint>;
  /** Every member's share of the village's Voice after this cycle. */
  voiceShares: VoiceShare[];
  /** The total Voice held across the roll, in minor units. */
  voiceTotal: bigint;
}

/** The memo on this state, or null when nothing has stepped it yet. */
export function readEconomicsMemo(state: SimState): EconomicsMemo | null {
  const bag = state.models;
  if (!bag || typeof bag !== "object") return null;
  const memo = bag[ECONOMICS_KEY];
  return memo && typeof memo === "object" ? (memo as EconomicsMemo) : null;
}

/**
 * The assumptions a state's run is using.
 *
 * `SimState.assumptions` is the one place an activity assumption lives and the
 * engine hands every state the same object the caller wrote. `fallback` is
 * what the model's own constructor was given, so a caller supplying half an
 * object gets the model's numbers for the other half.
 */
export function assumptionsFor(state: SimState, fallback: EconomicsAssumptions): EconomicsAssumptions {
  const bag = state.assumptions;
  const mine = bag && typeof bag === "object" ? bag[ECONOMICS_KEY] : undefined;
  return parseEconomicsAssumptions(mine, fallback);
}

// ── Reading the registry the way the server reads it ────────────────────────

/**
 * A variable's value, mirroring `variable()` in server/lib/variables.ts:38.
 *
 * The DEFINITION decides whether the key exists at all, and the snapshot's map
 * supplies only the village's overrides. That order matters and it is the
 * server's: `variable()` throws on a key with no definition WHETHER OR NOT the
 * village stored a value for it. Null here is that throw, made answerable.
 */
function variableValue(state: SimState, key: string): number | boolean | string | null {
  const def = VARIABLES_BY_KEY[key];
  if (!def) return null;
  return parseVariable(def, state.variables[key]);
}

/** `numberVar`, with null where the server would throw on an unknown key. */
function numberVariable(state: SimState, key: string): number | null {
  const v = variableValue(state, key);
  if (v === null) return null;
  return typeof v === "number" ? v : Number(v) || 0;
}

/** `stringVar`, with null where the server would throw on an unknown key. */
function stringVariable(state: SimState, key: string): string | null {
  const v = variableValue(state, key);
  return v === null ? null : String(v);
}

// ── The book: every posting is two legs and conservation is checked ─────────

interface Book {
  balances: Record<string, Record<string, bigint>>;
  faucets: Record<string, true>;
  allowNegativeDebits: Record<string, bigint>;
  postings: number;
  issuanceRefusals: number;
  launched: boolean;
}

/** The key an allow-negative bound is held under: one account, one token. */
export function negativeKey(account: string, slug: string): string {
  return `${account}|${slug}`;
}

function balanceOf(book: Book, account: string, slug: string): bigint {
  const row = book.balances[account];
  const held = row ? row[slug] : undefined;
  return held === undefined ? BigInt(0) : held;
}

function setBalance(book: Book, account: string, slug: string, value: bigint): void {
  const row = book.balances[account] ?? {};
  row[slug] = value;
  book.balances[account] = row;
}

/** Ten to the power n as a bigint. Written as a loop because the build target
 *  refuses the exponent operator on a bigint (TS2791). */
function powTen(n: number): bigint {
  let out = BigInt(1);
  const places = Math.max(0, Math.trunc(n));
  for (let i = 0; i < places; i += 1) out *= BigInt(10);
  return out;
}

/**
 * The one check that has to hold after EVERY posting, not only at the end.
 *
 * A run that summed to zero at the end could still have passed through a state
 * it could never have reached, and a preview derived from an impossible state
 * is worse than no preview. It throws, because a broken posting is a defect in
 * this model and never news about the village.
 */
export function assertConserved(
  balances: Record<string, Record<string, bigint>>,
  slug: string,
  context: string,
): void {
  let sum = BigInt(0);
  const accounts = Object.keys(balances);
  for (let i = 0; i < accounts.length; i += 1) {
    const row = balances[accounts[i]] ?? {};
    const held = row[slug];
    if (held !== undefined) sum += held;
  }
  if (sum !== BigInt(0)) {
    throw new Error(
      `economics.conservation broke on "${slug}" after ${context}: the balances over every account sum to ${String(sum)} and every token must sum to zero.`,
    );
  }
}

/**
 * One two-account move in minor units, with the ledger's own refusals.
 *
 * Mirrors `validateLeg` and `postTransfer` (server/lib/ledger.ts:243 and 368):
 * a positive amount, two different accounts, issuance closed until the village
 * starts its Game (`issuanceRefusal`, server/lib/gameStart.ts:150, asked on
 * every faucet leg at ledger.ts:416), and no non-faucet account below zero
 * unless the source is in the allow-negative set. Returns false when the
 * ledger would have refused, which is what makes an unaffordable spend a
 * smaller spend instead of a lie.
 */
function post(
  book: Book,
  from: string,
  to: string,
  slug: string,
  amount: bigint,
  source: string,
): boolean {
  if (amount <= BigInt(0)) return false;
  if (!from || !to || from === to) return false;
  const fromIsFaucet = book.faucets[from] === true;
  if (fromIsFaucet && !book.launched) {
    book.issuanceRefusals += 1;
    return false;
  }
  const after = balanceOf(book, from, slug) - amount;
  const negativeAllowed = ALLOW_NEGATIVE_SOURCES.indexOf(source) >= 0;
  if (!fromIsFaucet && after < BigInt(0) && !negativeAllowed) return false;
  setBalance(book, from, slug, after);
  setBalance(book, to, slug, balanceOf(book, to, slug) + amount);
  // Only an ALLOW-NEGATIVE debit raises the bound, and it is recorded against
  // the account AND the token it moved. Every other debit records nothing,
  // because it can never make a negative lawful.
  if (ALLOW_NEGATIVE_SOURCES.indexOf(source) >= 0) {
    const key = negativeKey(from, slug);
    book.allowNegativeDebits[key] = (book.allowNegativeDebits[key] ?? BigInt(0)) + amount;
  }
  book.postings += 1;
  assertConserved(book.balances, slug, `${source} of ${String(amount)} from ${from} to ${to}`);
  return true;
}

// ── Mirrors of the engine's refusals ────────────────────────────────────────

function tokenBySlug(tokens: TokenSpec[], slug: string): TokenSpec | null {
  for (let i = 0; i < tokens.length; i += 1) {
    if (tokens[i].slug === slug) return tokens[i];
  }
  return null;
}

/**
 * Why this rule cannot pay, or null when it can.
 *
 * All four of the engine's refusals, in the order `ruleCannotPay`
 * (server/lib/economy.ts:1059) hits them: a slug that is in no registry, a
 * token governed somewhere else, a token retired from the registry, and a
 * token with no faucet. `TokenSpec` now carries `governance` and `active`, so
 * the mirror is complete and a preview can no longer promise a payout the
 * engine would refuse.
 */
export function ruleCannotPay(tokens: TokenSpec[], slug: string): string | null {
  const def = tokenBySlug(tokens, slug);
  if (!def) return `there is no token called "${slug}" in this village's registry`;
  if (def.governance !== "platform") {
    return `${slug} is governed on Hypha and only mirrored here, so this village cannot issue it`;
  }
  if (!def.active) return `${slug} has been retired from the registry`;
  if (!def.faucet) return `${slug} has no faucet, so the engine has nowhere to issue it from`;
  return null;
}

// ── The written amount, against the amount that pays ────────────────────────

/** What a rule was written as, and what the ledger can actually carry. */
export interface WrittenAmount {
  /** The decimal text the column holds, trimmed. Empty when the column is NULL. */
  raw: string;
  /** True when the written figure is a whole number of this token's minor units. */
  exact: boolean;
  /** The written figure in minor units, rounded the way `toLedgerUnits` rounds. */
  rounded: bigint;
  /**
   * The written figure in minor units, ROUNDED TOWARD ZERO.
   *
   * For a BOUND rather than a payment. An amount rounds, because the nearest
   * payable figure is what a payment means; a bound may only ever fall, because
   * a bound rounded up is a bound nobody voted for. The engine settled this in
   * `ceilingAtScale` (server/lib/economy.ts) and the model has to answer the
   * same way or the preview promises what the run refuses.
   */
  floored: bigint;
  /** True when the written figure is above zero. */
  positive: boolean;
}

/**
 * Read `mint_rules.amount` exactly, from its own text.
 *
 * `amount` on the spec is already in minor units and cannot say whether the
 * village wrote a deliberate zero or wrote 0.0004 and watched it round away.
 * `amountRaw` is the `decimal(18,4)` column's own text and can. The scaling is
 * done on the STRING, never through a double, because reading a money column
 * through IEEE is the defect this whole file is careful about.
 *
 * The rounding mirrors `toLedgerUnits` (server/lib/economy.ts:154), which is
 * `Math.round(human * 10 ** decimals)`: half goes up.
 */
export function writtenAmount(raw: string, decimals: number): WrittenAmount | null {
  const text = String(raw ?? "").trim();
  if (!/^-?[0-9]*(\.[0-9]*)?$/.test(text) || text === "" || text === "." || text === "-") return null;
  const negative = text.charAt(0) === "-";
  const body = negative ? text.slice(1) : text;
  const dot = body.indexOf(".");
  const whole = dot < 0 ? body : body.slice(0, dot);
  const frac = dot < 0 ? "" : body.slice(dot + 1);
  const places = Math.max(0, Math.trunc(decimals));
  const kept = (frac + "0000000000000000000000").slice(0, places);
  const extra = frac.slice(places);
  const truncated = BigInt(whole === "" ? "0" : whole) * powTen(places) + BigInt(kept === "" ? "0" : kept);
  const exact = /^0*$/.test(extra);
  let scaled = truncated;
  if (!exact && extra.charAt(0) >= "5") scaled += BigInt(1);
  const positive = !negative && /[1-9]/.test(body);
  return {
    raw: text,
    exact,
    rounded: negative ? -scaled : scaled,
    // Toward zero on both sides of zero, which is what the string already gives:
    // the digits past the scale are dropped and the sign is applied after.
    floored: negative ? -truncated : truncated,
    positive,
  };
}

// ── Copying a state without structuredClone ─────────────────────────────────

/**
 * A whole copy, written out by hand.
 *
 * `structuredClone` does not carry a bigint in every runtime this build runs
 * on, and a clone that silently dropped a balance would be the worst possible
 * defect in a preview of somebody's money. So the copy is explicit.
 */
function copyBalances(source: Record<string, Record<string, bigint>>): Record<string, Record<string, bigint>> {
  const out: Record<string, Record<string, bigint>> = {};
  const accounts = Object.keys(source);
  for (let i = 0; i < accounts.length; i += 1) {
    const inner: Record<string, bigint> = {};
    const from = source[accounts[i]] ?? {};
    const slugs = Object.keys(from);
    for (let j = 0; j < slugs.length; j += 1) inner[slugs[j]] = from[slugs[j]];
    out[accounts[i]] = inner;
  }
  return out;
}

function faucetIndex(tokens: TokenSpec[]): Record<string, true> {
  const out: Record<string, true> = {};
  for (let i = 0; i < tokens.length; i += 1) {
    const faucet = tokens[i].faucet;
    if (faucet) out[faucet] = true;
  }
  return out;
}

// ── The step ────────────────────────────────────────────────────────────────

function rulesForTrigger(rules: MintRuleSpec[], trigger: string): MintRuleSpec[] {
  const out: MintRuleSpec[] = [];
  for (let i = 0; i < rules.length; i += 1) {
    if (rules[i].trigger === trigger && rules[i].enabled) out.push(rules[i]);
  }
  return out;
}

function activityFor(list: RuleActivity[], rule: MintRuleSpec): RuleActivity {
  for (let i = 0; i < list.length; i += 1) {
    if (list[i].ruleId === rule.id) return list[i];
  }
  const fresh: RuleActivity = {
    ruleId: rule.id,
    tokenSlug: rule.tokenSlug,
    minted: BigInt(0),
    ceiling: rule.ceiling,
    fired: 0,
    clampedAway: BigInt(0),
  };
  list.push(fresh);
  return fresh;
}

function noteUnpayable(list: UnpayableRule[], rule: MintRuleSpec, reason: string): void {
  for (let i = 0; i < list.length; i += 1) {
    if (list[i].ruleId === rule.id) return;
  }
  list.push({ ruleId: rule.id, tokenSlug: rule.tokenSlug, reason });
}

/**
 * How many quests the village confirms this cycle.
 *
 * The OBSERVED rate (`QuestsSummary.confirmedPerCycle`, read off the tables at
 * the snapshot instant) multiplied by the one thing the snapshot cannot say,
 * which is whether that rate holds. A fractional result is resolved by the
 * engine's own seeded generator, so half a quest a cycle is an honest half and
 * the same seed answers the same thing.
 */
function confirmationsThisCycle(quests: QuestsSummary, multiplier: number, rng: Rng): number {
  const projected = Math.max(0, Number(quests.confirmedPerCycle) || 0) * Math.max(0, multiplier);
  if (!Number.isFinite(projected)) return 0;
  const whole = Math.floor(projected);
  const fraction = projected - whole;
  if (fraction <= 0) return whole;
  return rng.next() < fraction ? whole + 1 : whole;
}

/**
 * WHAT THE ENGINE CONVERTS A GIFT BY, AT THE POSTING AND NOWHERE ELSE.
 *
 * The gratitude sweep measured the shipped path and it is human end to end
 * until the ledger: `allowanceFor` (server/lib/economy.ts:851) returns
 * `Math.round(numberVar("gratitude.base_budget") * stageMultiplier)`, its
 * `spent` and `remaining` are human, `shareCapFor` (economy.ts:956) floors at
 * ONE WHOLE recognition token, `checkGive` weighs a human amount, and
 * `gratitude_log.amount` stores a human number. The ONE conversion is
 * `toLedgerUnits(HEARTS, amount)` at the `postTransferOn` call inside `give`
 * (economy.ts:1425), which is `Math.round(human * 10 ** decimals)`. Going the
 * other way, `allowanceFor` divides the reversal SUM back down with
 * `fromLedgerUnits` (economy.ts:905), because that sum came out of the ledger.
 *
 * SO THIS SCALE IS APPLIED AT THE POST AND NEVER TO THE ALLOWANCE ITSELF, and
 * the sweep named three things that break if it is applied earlier, each a real
 * defect rather than a matter of taste:
 *
 *   1. `shareCapFor`'s floor of 1 becomes 0.0001 of a token where the engine's
 *      is a whole one, so a village with a small allowance previews a cap the
 *      engine would never allow;
 *   2. the expired-allowance figure this model reports (`allowanceTotal` minus
 *      what was given) silently becomes minor, where the engine's `remaining`
 *      is human, so R9's underutilisation number reads ten thousand times too
 *      big;
 *   3. the received-this-cycle figure has to stay human, because it mirrors the
 *      settlement's own read of `gratitude_log`.
 *
 * The pool-share ratio is unit-free either way, so it is the one figure that
 * does not care.
 *
 * ONE FUNCTION, read by two callers, which is what makes the two agree: the
 * post below converts through it, and the `econ_allowance_unscaled` flag asks
 * it whether to speak. The flag's condition never changed; it simply goes quiet
 * now, which is the outcome it was built for.
 */
function allowanceScale(recognition: TokenSpec | null): bigint {
  return powTen(recognition ? recognition.decimals : 0);
}

/**
 * The allowance a member may give this cycle, IN HUMAN UNITS.
 *
 * `Math.round(numberVar("gratitude.base_budget") * stageMultiplier)`
 * (`allowanceFor`, server/lib/economy.ts:851), with the multiplier from
 * `numberVar("progression.multiplier.<stage>")` (server/index.ts:3922). No
 * conversion here, because the engine does none here: see `allowanceScale`.
 */
function allowanceFor(state: SimState, member: MemberSpec, recognition: TokenSpec | null): bigint {
  void recognition;
  const base = numberVariable(state, "gratitude.base_budget");
  const multiplier = numberVariable(state, `progression.multiplier.${member.stage}`);
  if (base === null || multiplier === null) return BigInt(0);
  const whole = Math.round(base * Math.max(0, multiplier));
  if (!(whole > 0)) return BigInt(0);
  return BigInt(whole);
}

/**
 * The most one member may put on ONE other member this cycle.
 *
 * Mirrors `shareCapFor` in server/lib/economy.ts: the allowance divided by
 * `gratitude.full_sends_per_cycle`, floored, never below 1, and zero when the
 * allowance itself is zero. #217 replaced the percentage this used to read,
 * `gratitude.max_share_per_recipient`, with that count and removed the key, so a
 * model still reading it got null from the registry and previewed a cap the
 * product no longer has. The floor of 1 is the engine's and it is a bound, never
 * a guess: a small allowance and a large count would otherwise refuse every send.
 *
 * HUMAN IN, HUMAN OUT, and the floor is ONE WHOLE RECOGNITION TOKEN. Handing
 * this a scaled allowance would make that floor 0.0001 of a token at four
 * decimal places, which is a cap the engine has never allowed.
 */
function shareCapFor(state: SimState, allowanceTotal: bigint): bigint {
  if (allowanceTotal <= BigInt(0)) return BigInt(0);
  const sends = numberVariable(state, "gratitude.full_sends_per_cycle");
  if (sends === null) return BigInt(0);
  const capped = allowanceTotal / BigInt(Math.max(1, Math.floor(sends)));
  return capped < BigInt(1) ? BigInt(1) : capped;
}

/**
 * WHO HOLDS THE VILLAGE'S VOICE, after a representative's seat is attributed.
 *
 * Voice is minted to the member who HOLDS a seat (`runSettlement` pays
 * `seat.user_id`, server/lib/economy.ts:1355). `MemberSpec` says separately
 * that somebody answers on a seat's behalf, and a preview of concentration
 * that ignored that would understate what a representative actually carries
 * into a room. So the Voice a seat has accrued over the run moves from the
 * holder to the representative, bounded by what the holder still has.
 *
 * The share arithmetic itself is `shareOfTotal` from
 * `shared/governanceShare.ts`, imported and never restated. A second copy of
 * that division is exactly what that file was split out to prevent.
 */
function voiceWeights(
  members: MemberSpec[],
  balances: Record<string, Record<string, bigint>>,
  seatVoice: Record<string, bigint>,
): Map<string, bigint> {
  const held = new Map<string, bigint>();
  const holderOfSeat: Record<string, string> = {};
  for (let i = 0; i < members.length; i += 1) {
    const m = members[i];
    const row = balances[m.accountId] ?? {};
    const own = row[VOICE_SLUG];
    held.set(m.id, own === undefined ? BigInt(0) : own);
    const seats = m.seats ?? [];
    for (let s = 0; s < seats.length; s += 1) holderOfSeat[seats[s]] = m.id;
  }
  for (let i = 0; i < members.length; i += 1) {
    const rep = members[i];
    if (rep.isRepresentative !== true || !rep.representsSeatId) continue;
    const holderId = holderOfSeat[rep.representsSeatId];
    if (!holderId || holderId === rep.id) continue;
    const accrued = seatVoice[rep.representsSeatId] ?? BigInt(0);
    const holderHas = held.get(holderId) ?? BigInt(0);
    const moved = accrued < holderHas ? accrued : holderHas;
    if (moved <= BigInt(0)) continue;
    held.set(holderId, holderHas - moved);
    held.set(rep.id, (held.get(rep.id) ?? BigInt(0)) + moved);
  }
  return held;
}

/**
 * ONE CYCLE, in the order the engine does it.
 *
 * Pure. It reads the state it is handed, mutates nothing in it, and returns a
 * new one. Conservation is re-proven after every single posting inside `post`,
 * so a cycle that returns at all is a cycle that held together the whole way
 * through.
 */
function stepCycle(
  state: SimState,
  cycle: number,
  rng: Rng,
  fallback: EconomicsAssumptions,
): SimState {
  const assumptions = assumptionsFor(state, fallback);
  const clock = clockFor(state.clock ? state.clock.mode : "lunar");
  const at = new Date(state.atIso);
  const bounds = clock.boundsFor(at);
  const nextBoundary = clock.nextBoundaryAfter(at);

  const tokens = state.tokens ?? [];
  const members = state.members ?? [];
  const recognition = tokenBySlug(tokens, RECOGNITION_SLUG);
  const previous = readEconomicsMemo(state);

  const book: Book = {
    balances: copyBalances(state.balances ?? {}),
    faucets: faucetIndex(tokens),
    allowNegativeDebits: {},
    postings: 0,
    issuanceRefusals: 0,
    // `SimState.launched` and no assumption. `issuanceRefusal`
    // (server/lib/gameStart.ts:150) refuses every faucet posting until the
    // launch vote carries, and the snapshot now carries that fact.
    launched: state.launched === true,
  };

  const ruleActivity: RuleActivity[] = [];
  const unpayable: UnpayableRule[] = [];
  const stagesWithoutMultiplier: string[] = [];
  const seatVoice: Record<string, bigint> = {};
  if (previous) {
    const seats = Object.keys(previous.seatVoice ?? {});
    for (let i = 0; i < seats.length; i += 1) seatVoice[seats[i]] = previous.seatVoice[seats[i]];
  }

  // ── 1. Confirmed quests fire the quest.completed rules ────────────────────
  //
  // the claim pricing in server/lib/economy.ts, guard for guard and
  // in its order. It skips recognition (the consent route already minted it),
  // it refuses a from_source rule outright because a quest posts no amount in
  // any token but recognition, it stays quiet about a rule set to zero, it
  // reports a rule the engine cannot honour, and it pays the CLAIMANT whatever
  // the rule's `recipient` column says.
  //
  // HOW MANY, AND FOR WHOM. The count is the observed rate times the assumed
  // multiple. WHO confirmed them is a fact the snapshot does not carry, so the
  // confirmations are spread evenly over the roll, which is the least-assuming
  // distribution there is and is said here rather than buried.
  const questRules = rulesForTrigger(state.mintRules ?? [], QUEST_TRIGGER);
  const questsConfirmed = confirmationsThisCycle(state.quests, assumptions.questRateMultiplier, rng);
  const perQuestRecognition = state.quests ? state.quests.gratitudePerConfirmation : BigInt(0);
  for (let q = 0; q < questsConfirmed && members.length > 0; q += 1) {
    const member = members[q % members.length];
    // The recognition a confirmed quest pays, observed as an average off the
    // tables. `server/index.ts:20616` posts it as a bare `postTransfer` with
    // no `gratitude_log` row, which is why it never reaches the pool split
    // below.
    if (perQuestRecognition > BigInt(0) && recognition && recognition.faucet) {
      post(book, recognition.faucet, member.accountId, RECOGNITION_SLUG, perQuestRecognition, "quest_consent");
    }
    for (let r = 0; r < questRules.length; r += 1) {
      const rule = questRules[r];
      if (rule.tokenSlug === RECOGNITION_SLUG) continue;
      const activity = activityFor(ruleActivity, rule);
      if (rule.amount === null) {
        noteUnpayable(
          unpayable,
          rule,
          "this rule reads its amount from the work, and a quest posts no amount in this token",
        );
        continue;
      }
      if (rule.amount <= BigInt(0)) continue;
      const problem = ruleCannotPay(tokens, rule.tokenSlug);
      if (problem) {
        noteUnpayable(unpayable, rule, problem);
        continue;
      }
      // THE CEILING BINDS HERE, per occurrence, exactly where
      // the claim pricing binds it (server/lib/economy.ts). A
      // ceiling of zero refuses into the same `unpayable` list, and every
      // other ceiling clamps.
      const ruleDecimals = decimalsOf(tokens, rule.tokenSlug);
      const capped = ceilingOutcomeMinor(rule, rule.amount, ruleDecimals);
      if (capped.refusal) {
        noteUnpayable(unpayable, rule, capped.refusal);
        continue;
      }
      if (capped.paid < rule.amount) activity.clampedAway += rule.amount - capped.paid;
      if (capped.paid <= BigInt(0)) {
        // The cap was written above zero and still clamps to nothing, which is
        // a cap below the token's own resolution. The engine reports exactly
        // this, in these words (server/lib/economy.ts:1377).
        noteUnpayable(
          unpayable,
          rule,
          `${writtenCeiling(rule, ruleDecimals).raw} is smaller than the smallest amount this token can hold`,
        );
        continue;
      }
      const faucet = tokenBySlug(tokens, rule.tokenSlug)!.faucet!;
      if (post(book, faucet, member.accountId, rule.tokenSlug, capped.paid, "quest_consent")) {
        activity.minted += capped.paid;
        activity.fired += 1;
      }
    }
  }

  // ── 2. Gratitude, given from the allowance, within the per-person share ───
  //
  // `give` (server/lib/economy.ts:934) mints fresh recognition from the
  // recognition faucet to the RECEIVER and takes nothing from the giver, so
  // the allowance is the only thing bounding it. `checkGive` refuses a gift to
  // yourself, which is why a village of one gives nothing at all.
  let allowanceTotal = BigInt(0);
  let gratitudeGiven = BigInt(0);
  // Recognition RECEIVED THIS CYCLE THROUGH A GIFT, keyed by account. It is
  // this figure and never the account's balance that the cycle close splits
  // the pool by, and the difference is load-bearing twice over. A balance
  // carries every earlier cycle's recognition, and the close reads
  // `gratitude_log` rows inside the cycle window (`settleCycle`,
  // server/lib/gratitude-cycles.ts:202 by way of server/index.ts:21399). And
  // ONLY THE GIVING PATH WRITES THAT TABLE: `writeGratitudeRow` is called from
  // `give` (economy.ts:954) and `sendGratitude` (gratitude.ts:144) and from
  // nowhere else, so the recognition a confirmed quest mints never reaches the
  // split. A village whose recognition comes mostly from quests routes almost
  // none of its value pool.
  const receivedThisCycle: Record<string, bigint> = {};
  for (let m = 0; m < members.length; m += 1) {
    const giver = members[m];
    if (VARIABLES_BY_KEY[`progression.multiplier.${giver.stage}`] === undefined) {
      if (stagesWithoutMultiplier.indexOf(giver.stage) < 0) stagesWithoutMultiplier.push(giver.stage);
    }
    const total = allowanceFor(state, giver, recognition);
    allowanceTotal += total;
    if (total <= BigInt(0)) continue;
    if (!(assumptions.gratitudeAllowanceGivenShare > 0)) continue;
    if (!recognition || !recognition.faucet) continue;
    const cap = shareCapFor(state, total);
    if (cap <= BigInt(0)) continue;
    const intended =
      (total * BigInt(Math.round(assumptions.gratitudeAllowanceGivenShare * 10000))) / BigInt(10000);
    let left = intended;
    const scale = allowanceScale(recognition);
    for (let r = 0; r < members.length && left > BigInt(0); r += 1) {
      const receiver = members[r];
      if (receiver.id === giver.id) continue;
      // HUMAN, all the way to the ledger's door. `checkGive` weighs this
      // number, `gratitude_log.amount` stores it, and the refusals print it.
      const amount = left < cap ? left : cap;
      // THE ONE CONVERSION ON THIS PATH, at the post and nowhere earlier,
      // exactly where `give` puts it (server/lib/economy.ts:1425).
      if (post(book, recognition.faucet, receiver.accountId, RECOGNITION_SLUG, amount * scale, "gratitude_received")) {
        left -= amount;
        gratitudeGiven += amount;
        receivedThisCycle[receiver.accountId] = (receivedThisCycle[receiver.accountId] ?? BigInt(0)) + amount;
      }
    }
  }

  // ── 3. Sinks ──────────────────────────────────────────────────────────────
  //
  // `spendSinkFor` (server/lib/spending.ts:139) decides where a spent token
  // lands. A member can only spend what they hold, because `postTransfer`
  // refuses to drive a non-faucet account below zero, so `post` returns false
  // and the smaller truth is what the preview shows.
  const poolTokenSlug = stringVariable(state, "gratitude.pool_token") ?? "";
  if (assumptions.sinkSpendPerMemberPerCycle > BigInt(0) && poolTokenSlug) {
    const sink = spendSinkFor(poolTokenSlug);
    for (let m = 0; m < members.length; m += 1) {
      const member = members[m];
      const held = balanceOf(book, member.accountId, poolTokenSlug);
      const asked = assumptions.sinkSpendPerMemberPerCycle;
      const amount = held < asked ? held : asked;
      post(book, member.accountId, sink, poolTokenSlug, amount, "spend");
    }
  }

  // ── 4a. The cycle closes: runSettlement pays the seats ────────────────────
  //
  // `runSettlement` (server/lib/economy.ts:1297) reads the `role.cycle` rules,
  // names the unpayable ones ONCE, and then pays every payable rule to every
  // live seat holder, once per SEAT. A member holding no seat is paid nothing,
  // which is the whole of what the code does for them.
  const roleRules = rulesForTrigger(state.mintRules ?? [], ROLE_TRIGGER);
  const payableRoleRules: MintRuleSpec[] = [];
  for (let r = 0; r < roleRules.length; r += 1) {
    const rule = roleRules[r];
    activityFor(ruleActivity, rule);
    const problem = ruleCannotPay(tokens, rule.tokenSlug);
    if (problem) {
      noteUnpayable(unpayable, rule, problem);
      continue;
    }
    // A ceiling of zero is reported ONCE for the whole rule and never once per
    // seat, exactly as `runSettlement` reports it (server/lib/economy.ts:1515),
    // and only when the rule claims to pay something.
    const capped = ceilingOutcomeMinor(rule, rule.amount ?? BigInt(0), decimalsOf(tokens, rule.tokenSlug));
    if ((rule.amount ?? BigInt(0)) > BigInt(0) && capped.refusal) {
      noteUnpayable(unpayable, rule, capped.refusal);
      continue;
    }
    payableRoleRules.push(rule);
  }
  for (let m = 0; m < members.length; m += 1) {
    const member = members[m];
    const seats = member.seats ?? [];
    for (let s = 0; s < seats.length; s += 1) {
      const seatId = seats[s];
      for (let r = 0; r < payableRoleRules.length; r += 1) {
        const rule = payableRoleRules[r];
        if (rule.amount === null || rule.amount <= BigInt(0)) continue;
        const activity = activityFor(ruleActivity, rule);
        // Clamped per seat, like the quest path and for the same reason: the
        // ceiling is what the village voted on and the amount is what it typed
        // first (server/lib/economy.ts:1560).
        const paid = ceilingOutcomeMinor(rule, rule.amount, decimalsOf(tokens, rule.tokenSlug)).paid;
        if (paid < rule.amount) activity.clampedAway += rule.amount - paid;
        if (paid <= BigInt(0)) continue;
        const faucet = tokenBySlug(tokens, rule.tokenSlug)!.faucet!;
        if (post(book, faucet, member.accountId, rule.tokenSlug, paid, "role_cycle")) {
          activity.minted += paid;
          activity.fired += 1;
          // What this SEAT has accrued, so a representative's attribution has
          // something to move. Cumulative over the run.
          if (rule.tokenSlug === VOICE_SLUG) {
            seatVoice[seatId] = (seatVoice[seatId] ?? BigInt(0)) + paid;
          }
        }
      }
    }
  }

  // ── 4b. The cycle closes: the value pool, if a human presses the button ───
  //
  // `POST /api/admin/cycles/close` (server/index.ts:21349) splits
  // `gratitude.pool_per_cycle` among the people who received recognition this
  // cycle, in proportion to it, with `Math.floor` keeping every remainder in
  // the pool. The amount it hands `postTransfer` is the dial's own number,
  // which the ledger reads as MINOR UNITS, so a pool paying a token with
  // decimals releases a thousandth of what the dial says. See the
  // `econ_pool_in_whole_tokens` flag.
  const poolSizeRaw = numberVariable(state, "gratitude.pool_per_cycle") ?? 0;
  const poolSize = poolSizeRaw > 0 ? BigInt(Math.trunc(poolSizeRaw)) : BigInt(0);
  let poolDistributed = BigInt(0);
  const poolClosed = assumptions.poolClosedEachCycle;
  if (poolClosed && poolSize > BigInt(0) && gratitudeGiven > BigInt(0) && poolTokenSlug) {
    const poolToken = tokenBySlug(tokens, poolTokenSlug);
    const poolFaucet = poolToken ? poolToken.faucet : null;
    if (poolFaucet && poolTokenSlug !== RECOGNITION_SLUG) {
      for (let m = 0; m < members.length; m += 1) {
        const member = members[m];
        const received = receivedThisCycle[member.accountId] ?? BigInt(0);
        if (received <= BigInt(0)) continue;
        const share = (received * poolSize) / gratitudeGiven;
        if (post(book, poolFaucet, member.accountId, poolTokenSlug, share, "gratitude_pool")) {
          poolDistributed += share;
        }
      }
    }
  }

  // ── 5. Unspent allowance expires ──────────────────────────────────────────
  //
  // Founder ruling R9: show underutilisation. Nothing is posted, because
  // nothing was ever stored: `allowanceFor` computes the figure from what was
  // given, so an allowance nobody spent simply stops existing at the boundary.
  // The number is kept here so the flag can report it.
  const gratitudeExpired = allowanceTotal - gratitudeGiven;

  // ── 6. Who holds the Voice ────────────────────────────────────────────────
  const weights = voiceWeights(members, book.balances, seatVoice);
  const shares = shareOfTotal(weights);
  const voiceShares: VoiceShare[] = [];
  let voiceTotal = BigInt(0);
  weights.forEach((minor, memberId) => {
    voiceTotal += minor;
    voiceShares.push({ memberId, minor, share: shares.get(memberId) ?? 0 });
  });
  voiceShares.sort((a, b) => (a.memberId < b.memberId ? -1 : a.memberId > b.memberId ? 1 : 0));

  const memo: EconomicsMemo = {
    cycle,
    cycleId: bounds.id,
    startsAt: bounds.startsAt.toISOString(),
    endsAt: bounds.endsAt.toISOString(),
    nextBoundaryAt: nextBoundary.toISOString(),
    assumptions,
    quests: { ...state.quests },
    launched: book.launched,
    postings: book.postings,
    questsConfirmed,
    allowanceTotal,
    gratitudeGiven,
    gratitudeExpired: gratitudeExpired > BigInt(0) ? gratitudeExpired : BigInt(0),
    poolToken: poolTokenSlug,
    poolSize,
    poolDistributed,
    poolRemainder: poolClosed ? poolSize - poolDistributed : BigInt(0),
    poolClosed,
    rules: ruleActivity,
    unpayable,
    allowNegativeDebits: book.allowNegativeDebits,
    issuanceRefusals: book.issuanceRefusals,
    stagesWithoutMultiplier,
    seatVoice,
    voiceShares,
    voiceTotal,
  };

  // THE ENGINE OWNS `atIso` AND `cycle`, so neither moves here. The memo is a
  // WHOLE NEW OBJECT under a WHOLE NEW bag, because `cloneState` copies the
  // bag and cannot copy what is inside it: editing a memo in place would
  // rewrite a cycle that was already recorded.
  return {
    atIso: state.atIso,
    cycle: state.cycle,
    launched: state.launched,
    quests: { ...state.quests },
    clock: { mode: state.clock.mode, timezone: state.clock.timezone },
    tokens: tokens.map((t) => ({ ...t, sinks: (t.sinks ?? []).slice() })),
    balances: book.balances,
    mintRules: (state.mintRules ?? []).map((r) => ({ ...r })),
    variables: { ...(state.variables ?? {}) },
    members: members.map((m) => ({ ...m, seats: (m.seats ?? []).slice() })),
    modules: { ...(state.modules ?? {}) },
    governance: {
      cyclesElapsed: state.governance.cyclesElapsed,
      landedPaths: state.governance.landedPaths.slice(),
      revertedPaths: state.governance.revertedPaths.slice(),
    },
    models: { ...state.models, [ECONOMICS_KEY]: memo },
    assumptions: state.assumptions,
  };
}

// ── Invariants ──────────────────────────────────────────────────────────────

/** Every token slug that appears anywhere in this state. */
function allSlugs(state: SimState): string[] {
  const seen: Record<string, true> = {};
  const tokens = state.tokens ?? [];
  for (let i = 0; i < tokens.length; i += 1) seen[tokens[i].slug] = true;
  const accounts = Object.keys(state.balances ?? {});
  for (let i = 0; i < accounts.length; i += 1) {
    const row = state.balances[accounts[i]] ?? {};
    const slugs = Object.keys(row);
    for (let j = 0; j < slugs.length; j += 1) seen[slugs[j]] = true;
  }
  return Object.keys(seen).sort();
}

function invariantsOf(state: SimState): Violation[] {
  const out: Violation[] = [];
  const faucets = faucetIndex(state.tokens ?? []);
  const memo = readEconomicsMemo(state);
  const accounts = Object.keys(state.balances ?? {}).sort();
  const slugs = allSlugs(state);

  for (let i = 0; i < slugs.length; i += 1) {
    const slug = slugs[i];
    let sum = BigInt(0);
    for (let a = 0; a < accounts.length; a += 1) {
      const row = state.balances[accounts[a]] ?? {};
      const held = row[slug];
      if (held !== undefined) sum += held;
    }
    if (sum !== BigInt(0)) {
      out.push({
        invariant: "ledger.conservation",
        cycle: state.cycle,
        detail: `${slug}: the balances over all ${accounts.length} account(s), faucets included, sum to ${String(sum)} and every token must sum to 0.`,
      });
    }
  }

  for (let a = 0; a < accounts.length; a += 1) {
    const account = accounts[a];
    if (faucets[account] === true) continue;
    const row = state.balances[account] ?? {};
    const held = Object.keys(row);
    for (let j = 0; j < held.length; j += 1) {
      const slug = held[j];
      const value = row[slug];
      if (value >= BigInt(0)) continue;
      // BOUNDED, and keyed by account AND token. A lawful negative is at most
      // what the allow-negative postings against THIS account in THIS token
      // actually took out. Anything past that is value that never existed.
      const allowed = memo ? (memo.allowNegativeDebits[negativeKey(account, slug)] ?? BigInt(0)) : BigInt(0);
      const owed = -value;
      if (allowed > BigInt(0) && owed <= allowed) continue;
      out.push({
        invariant: "ledger.no_negative_non_faucet",
        cycle: state.cycle,
        detail:
          `${account} holds ${String(value)} ${slug} on an ordinary account, and only a faucet may go below zero. ` +
          `Postings from ${ALLOW_NEGATIVE_SOURCES.join(", ")} took ${String(allowed)} ${slug} out of it, ` +
          `which is the most of that a negative may lawfully be, and it is short by ${String(owed - allowed)}.`,
      });
    }
  }

  return out;
}

// ── Flags ───────────────────────────────────────────────────────────────────

function humanUnits(minor: bigint, decimals: number): string {
  const places = Math.max(0, Math.trunc(decimals));
  if (places === 0) return String(minor);
  const scale = powTen(places);
  const whole = minor / scale;
  const rest = minor < BigInt(0) ? -(minor % scale) : minor % scale;
  return `${String(whole)}.${String(rest).padStart(places, "0")}`;
}

function decimalsOf(tokens: TokenSpec[], slug: string): number {
  const def = tokenBySlug(tokens, slug);
  return def ? Math.max(0, Math.trunc(def.decimals)) : 0;
}

function percent(share: number): string {
  return `${(share * 100).toFixed(1)}%`;
}

function flagsOf(state: SimState, cycle: number, fallback: EconomicsAssumptions): Flag[] {
  const out: Flag[] = [];
  const tokens = state.tokens ?? [];
  const memo = readEconomicsMemo(state);
  const members = state.members ?? [];
  const assumptions = assumptionsFor(state, fallback);

  // (g) A faucet account the snapshot holds no row for. An absent account and
  // a zero balance are the same number and a different fact: the ledger
  // refuses a posting out of a system account that does not exist.
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (!token.faucet) continue;
    if (state.balances && state.balances[token.faucet] !== undefined) continue;
    out.push({
      code: "econ_faucet_account_missing",
      severity: "danger",
      cycle,
      sentence: `${token.slug} says it is issued from ${token.faucet}, and this village's ledger holds no such account.`,
      actionable: `Create ${token.faucet} before anything tries to issue ${token.slug}. Until it exists every posting out of it is refused.`,
    });
  }

  // (a) A rule that can never pay, and (b) an amount that pays something other
  // than what was written. Both are read off the rules themselves, so they
  // answer even before a cycle has run.
  const rules = state.mintRules ?? [];
  for (let i = 0; i < rules.length; i += 1) {
    const rule = rules[i];
    if (!rule.enabled) continue;
    const problem = ruleCannotPay(tokens, rule.tokenSlug);
    if (problem) {
      out.push({
        code: "econ_rule_cannot_pay",
        severity: "warning",
        cycle,
        sentence: `The rule on ${rule.trigger} promises ${rule.tokenSlug} and pays nobody, because ${problem}.`,
        actionable: `Turn this rule off, or give ${rule.tokenSlug} a faucet the village can issue from. Every surface in the village currently advertises a payout that never arrives.`,
      });
      continue;
    }
    if (rule.amount === null && rule.trigger === QUEST_TRIGGER) {
      out.push({
        code: "econ_rule_cannot_pay",
        severity: "warning",
        cycle,
        sentence: `The rule on ${rule.trigger} reads its amount from the work, and a quest posts no amount in ${rule.tokenSlug}, so it can never pay on any quest.`,
        actionable: "Give this rule a fixed amount, or turn it off. Only the recognition a quest advertises rides on the work itself.",
      });
      continue;
    }
    // (b) EXACT, from `amountRaw`. `amount` alone cannot tell a village that
    // wrote a deliberate zero from one that wrote 0.0004 and watched it round
    // away, and those are different facts. The column's own text can.
    const decimals = decimalsOf(tokens, rule.tokenSlug);
    const written = writtenAmount(rule.amountRaw, decimals);
    if (written && written.positive && !written.exact) {
      const pays = rule.amount === null ? written.rounded : rule.amount;
      out.push({
        code: "econ_amount_rounds_away",
        severity: pays <= BigInt(0) ? "warning" : "notice",
        cycle,
        sentence: `The rule on ${rule.trigger} is written as ${written.raw} ${rule.tokenSlug}, and ${rule.tokenSlug} holds ${decimals} decimal place(s), so what actually pays is ${humanUnits(pays, decimals)}.`,
        actionable:
          pays <= BigInt(0)
            ? `This rule is enabled and pays nobody. Write an amount of at least ${humanUnits(BigInt(1), decimals)}, or turn the rule off.`
            : `Write the amount the token can hold, so the rule says what it pays. The column keeps four decimal places and ${rule.tokenSlug} keeps ${decimals}.`,
      });
    }
  }

  // (l) THE GRATITUDE ALLOWANCE IS POSTED WITHOUT CONVERSION.
  //
  // Asked of `allowanceScale`, which is the same function `allowanceFor` posts
  // through, so this flag cannot disagree with the number above it and goes
  // quiet the moment the engine starts scaling.
  const recognitionToken = tokenBySlug(tokens, RECOGNITION_SLUG);
  const recognitionDecimals = recognitionToken ? Math.max(0, Math.trunc(recognitionToken.decimals)) : 0;
  if (recognitionDecimals > 0 && allowanceScale(recognitionToken) === BigInt(1)) {
    out.push({
      code: "econ_allowance_unscaled",
      severity: "danger",
      cycle,
      sentence: `${RECOGNITION_SLUG} holds ${recognitionDecimals} decimal place(s), and the gratitude allowance is posted as minor units with no conversion, so every gift in this village is ${String(powTen(recognitionDecimals))} times smaller than the allowance says.`,
      actionable: "The decimals sweep lane F fixes give and allowanceFor together. Until it lands, a village whose recognition token holds decimal places cannot give what its dial promises.",
    });
  }

  // (i) The Game has not started. Nothing can be minted at all until the
  // launch vote carries, so a preview of a village in that state is a preview
  // of nothing. Read off the snapshot now, never assumed.
  if (state.launched !== true) {
    out.push({
      code: "econ_issuance_closed",
      severity: "warning",
      cycle,
      sentence: "This village has not started its Game, so every posting out of a faucet is refused and no token is issued at all.",
      actionable: "Carry the launch vote. Until it does, quest rewards, seat payouts and the value pool all pay nothing.",
    });
  }

  // (h) A member whose stage has no allowance multiplier in the registry. The
  // server throws on this key, so it is not a quiet zero anywhere real.
  if (memo) {
    for (let i = 0; i < memo.stagesWithoutMultiplier.length; i += 1) {
      const stage = memo.stagesWithoutMultiplier[i];
      out.push({
        code: "econ_stage_no_multiplier",
        severity: "danger",
        cycle,
        sentence: `Somebody in this village is at the "${stage}" stage, and there is no progression.multiplier.${stage} in the variables registry.`,
        actionable: `Add "${stage}" to the ladder or move the member to a stage that is on it. The server reads this key on every gift and refuses an unknown one, so nobody at this stage can give anything.`,
      });
    }
  }

  // (j) The village was measured confirming quests that pay no recognition.
  if (memo && memo.questsConfirmed > 0 && memo.quests.gratitudePerConfirmation === BigInt(0)) {
    out.push({
      code: "econ_quest_recognition_unmodelled",
      severity: "notice",
      cycle,
      sentence: `${memo.questsConfirmed} quest(s) were confirmed this cycle and none of them paid any recognition, because the village was measured paying nothing per confirmation.`,
      actionable: "Check what this village's quests advertise. Recognition is what routes the value pool, so quests that pay none route none of it.",
    });
  }

  // (d) Founder ruling R9: show underutilisation, with the amount.
  if (memo && memo.cycle === cycle && memo.gratitudeExpired > BigInt(0)) {
    // PRINTED RAW, because both figures are already human: the engine's
    // `remaining` is human and this mirrors it. Running them through
    // `humanUnits` would divide a human number a second time.
    out.push({
      code: "econ_gratitude_expired",
      severity: "notice",
      cycle,
      sentence: `${String(memo.gratitudeExpired)} of the ${String(memo.allowanceTotal)} recognition this village could have given expired unused at the end of this cycle.`,
      actionable:
        members.length <= 1
          ? "One member cannot give recognition to anybody, because a member may not thank themselves. The allowance means nothing until a second person joins."
          : "Allowance does not roll over. Lower the base allowance, or give people more reason to use it.",
    });
  }

  // (c) The pool against what the village can route through it.
  if (memo && memo.cycle === cycle && memo.poolSize > BigInt(0)) {
    const poolDecimals = decimalsOf(tokens, memo.poolToken);
    if (memo.allowanceTotal > memo.poolSize) {
      out.push({
        code: "econ_pool_exhausts",
        severity: "warning",
        cycle,
        sentence: `This village can route ${String(memo.allowanceTotal)} recognition through a pool of ${String(memo.poolSize)} ${memo.poolToken} a cycle, so from cycle ${cycle} one unit of recognition is worth less than one minor unit of ${memo.poolToken} and every small share floors to nothing.`,
        actionable: `Raise gratitude.pool_per_cycle above ${String(memo.allowanceTotal)}, or lower gratitude.base_budget, so a unit of recognition is still worth something as the roll grows.`,
      });
    }
    if (memo.poolClosed && memo.poolRemainder > BigInt(0)) {
      out.push({
        code: "econ_pool_exhausts",
        severity: "notice",
        cycle,
        sentence: `The value pool released ${humanUnits(memo.poolDistributed, poolDecimals)} of its ${humanUnits(memo.poolSize, poolDecimals)} ${memo.poolToken} this cycle and the remaining ${humanUnits(memo.poolRemainder, poolDecimals)} stayed unissued.`,
        actionable: "Shares round down and the remainder never leaves the faucet. A pool that keeps most of itself back every cycle is sized for a bigger village than this one.",
      });
    }
    // The dial says tokens and the ledger reads minor units.
    if (poolDecimals > 0) {
      out.push({
        code: "econ_pool_in_whole_tokens",
        severity: "danger",
        cycle,
        sentence: `The value pool is set to ${String(memo.poolSize)} ${memo.poolToken}, and ${memo.poolToken} holds ${poolDecimals} decimal places, so the close releases ${humanUnits(memo.poolSize, poolDecimals)} of it and never ${String(memo.poolSize)}.`,
        actionable: `Point gratitude.pool_token at a token with no decimal places, or set gratitude.pool_per_cycle to ${String(memo.poolSize * powTen(poolDecimals))} to release what the dial reads.`,
      });
    }
  }

  // (f) THE CEILING, read the way the schema means it: one occurrence.
  //
  // The flag that used to live here measured a CYCLE TOTAL against the ceiling
  // and called a rule broken when the total passed it. That reading was wrong.
  // `ceilingOutcome` (server/lib/economy.ts:590) bounds one occurrence, so
  // eleven quests at 25 under a ceiling of 250 legitimately issue 275 and there
  // is nothing to say about it. What IS worth saying is when the row
  // contradicts itself, and there are exactly two ways it can.
  //
  // `econ_ceiling_never_reached` went with it. Per occurrence a ceiling either
  // bites or it does not, and a ceiling comfortably above the amount is the
  // ordinary healthy case, so a flag about it would be noise.
  for (let i = 0; i < rules.length; i += 1) {
    const rule = rules[i];
    if (!rule.enabled) continue;
    if (ruleCannotPay(tokens, rule.tokenSlug)) continue;
    const decimals = decimalsOf(tokens, rule.tokenSlug);
    /*
     * TWO DIFFERENT VILLAGES ARRIVE HERE HOLDING `ceiling: BigInt(0)`, and
     * telling them apart is what `ceilingRaw` is for.
     *
     * A cap WRITTEN as zero is a decision, and the engine refuses every
     * occurrence of it in words this flag quotes verbatim, so the founder reads
     * the same sentence in the preview and in the Mint panel.
     *
     * A cap written BELOW THE TOKEN'S RESOLUTION is a typo. The engine reads
     * 0.0004, finds it above zero, clamps to it, and then reports the clamped
     * figure as smaller than the token can hold. Calling that a cap of nothing
     * would turn a fat-fingered number into a policy the village never voted
     * for, so it gets its own sentence and its own code.
     */
    if (rule.ceiling !== null) {
      const cap = writtenCeiling(rule, decimals);
      if (!cap.positive) {
        const refusal = ceilingOutcomeMinor(rule, rule.amount ?? BigInt(0), decimals).refusal;
        out.push({
          code: "econ_rule_ceiling_zero",
          severity: "warning",
          cycle,
          sentence: `The rule on ${rule.trigger} is enabled and pays nobody: ${refusal}.`,
          actionable: "Raise the ceiling on this rule above zero, or turn the rule off. A ceiling of zero means zero, and the engine refuses every occurrence of it.",
        });
        continue;
      }
      // Floored, for the same reason the clamp is: a cap the token cannot hold
      // arrives as nothing, and reading it as one would warn about nothing while
      // the engine refuses.
      if (cap.floored <= BigInt(0)) {
        out.push({
          code: "econ_ceiling_rounds_away",
          severity: "warning",
          cycle,
          sentence: `The rule on ${rule.trigger} caps one occurrence at ${cap.raw} ${rule.tokenSlug}, and ${rule.tokenSlug} holds ${decimals} decimal place(s), so the cap arrives as nothing and the rule pays nobody.`,
          actionable: `Write a ceiling of at least ${humanUnits(BigInt(1), decimals)}, which is the smallest amount ${rule.tokenSlug} can hold. The column keeps four decimal places and the token keeps ${decimals}, so a cap below that is a number the ledger cannot carry.`,
        });
        continue;
      }
    }
    // The row says it pays one number and caps at a smaller one, so every
    // occurrence pays the cap. That is the shape a ballot leaves behind when it
    // lowers only the ceiling.
    if (rule.amount !== null && rule.ceiling !== null && rule.amount > rule.ceiling) {
      out.push({
        code: "econ_rule_contradicts_ceiling",
        severity: "warning",
        cycle,
        sentence: `The rule on ${rule.trigger} says it pays ${humanUnits(rule.amount, decimals)} ${rule.tokenSlug} and caps one occurrence at ${humanUnits(rule.ceiling, decimals)}, so every occurrence pays ${humanUnits(rule.ceiling, decimals)}.`,
        actionable: `Raise the ceiling to ${humanUnits(rule.amount, decimals)}, or lower the amount to ${humanUnits(rule.ceiling, decimals)}, so the row says what it pays.`,
      });
    }
  }

  // (k) CONCENTRATION. Who holds the village's Voice, and how much of it.
  //
  // The founder's ruling is that transparency is the protection, so this is a
  // warning and it never blocks: the preview says the number and the village
  // decides. The shares come from `shareOfTotal` in shared/governanceShare.ts,
  // never from a second copy of that division living here.
  if (memo && memo.cycle === cycle && memo.voiceTotal > BigInt(0)) {
    const weights = new Map<string, bigint>();
    for (let i = 0; i < memo.voiceShares.length; i += 1) {
      weights.set(memo.voiceShares[i].memberId, memo.voiceShares[i].minor);
    }
    const top = topShares(weights, 3);
    if (top.length > 0 && top[0].share >= CONCENTRATION_THRESHOLD) {
      const decimals = decimalsOf(tokens, VOICE_SLUG);
      const named = top
        .map((h) => `${h.id} holds ${percent(h.share)}`)
        .join(", ");
      const weightMode = stringVariable(state, "governance.weight_mode") ?? "equal";
      const weightToken = stringVariable(state, "governance.weight_token") ?? "";
      const alsoVotes = weightMode === "token" && weightToken === VOICE_SLUG;
      out.push({
        code: "econ_voice_concentration",
        severity: "warning",
        cycle,
        sentence: `${top[0].id} holds ${percent(top[0].share)} of this village's ${VOICE_SLUG} after cycle ${cycle}, which is above the third of the whole this preview calls out. The three largest holders are ${named}, out of ${humanUnits(memo.voiceTotal, decimals)} held across the roll.`,
        actionable: alsoVotes
          ? `The weight mode is token and the weight token is ${VOICE_SLUG}, so this share is also voting power. Spread the seats, lower the seat payout, or move governance.weight_mode off token.`
          : `Nothing here blocks, and nothing here is wrong on its own. Watch it: spread the seats the role.cycle rules pay, or lower what a seat pays, if the village wants Voice spread wider.`,
      });
    }
  }

  // (e) A negative balance on an account that is not a faucet.
  const violations = invariantsOf(state);
  for (let i = 0; i < violations.length; i += 1) {
    if (violations[i].invariant !== "ledger.no_negative_non_faucet") continue;
    out.push({
      code: "econ_negative_balance",
      severity: "danger",
      cycle,
      sentence: `An account that is not a faucet is holding a negative balance. ${violations[i].detail}`,
      actionable: "Only a faucet may go below zero, and its negative balance is that token's issued supply. A negative anywhere else means value was moved that never existed.",
    });
  }

  // Nothing to do with `assumptions` beyond reading them, and reading them is
  // what keeps `flags` and `step` answering about the same run.
  void assumptions;
  return out;
}

// ── The model ───────────────────────────────────────────────────────────────

/** The economics model, plus the assumptions it ran under, for printing. */
export interface EconomicsModel extends DomainModel {
  name: "economics";
  /** The assumptions this model was constructed with, which are the fallback. */
  assumptions: EconomicsAssumptions;
  /**
   * One plain sentence per assumption, for printing beside the seed.
   *
   * WITH A STATE it prints what that run ACTUALLY used, resolved from
   * `state.assumptions.economics` over this model's own numbers, and adds the
   * observations the run started from. Without one it prints the fallback.
   */
  describeAssumptions(state?: SimState): string[];
}

/**
 * The economics model, ready to hand to `simulate` beside the governance one.
 *
 * `assumptions` is optional. Whatever it is given becomes the PER-FIELD
 * FALLBACK, and `SimInput.assumptions.economics` beats it field by field, so a
 * caller supplying half an object gets this model's numbers for the other half
 * and the result echoes exactly what was supplied.
 */
export function economicsModel(assumptions?: Partial<EconomicsAssumptions>): EconomicsModel {
  const settled: EconomicsAssumptions = { ...DEFAULT_ECONOMICS_ASSUMPTIONS, ...(assumptions ?? {}) };
  return {
    name: "economics",
    assumptions: settled,
    describeAssumptions(state?: SimState): string[] {
      if (!state) return describeAssumptions(settled);
      const memo = readEconomicsMemo(state);
      const used = memo ? memo.assumptions : assumptionsFor(state, settled);
      return describeAssumptions(used, memo ? memo.quests : state.quests, state.launched);
    },
    step(state: SimState, cycle: number, rng: Rng): SimState {
      return stepCycle(state, cycle, rng, settled);
    },
    flags(state: SimState, cycle: number): Flag[] {
      return flagsOf(state, cycle, settled);
    },
    invariants(state: SimState): Violation[] {
      return invariantsOf(state);
    },
  };
}
