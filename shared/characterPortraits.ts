/**
 * THE FORGE BUDGET, AS ARITHMETIC. No database, no clock, no imports.
 *
 * Rye's rule, in full: three generations granted at profile setup, spendable
 * however the member likes (one each on three classes, or three attempts on
 * one). Then one more each moon. Unused setup grants BANK. The moon grant
 * accumulates to a ceiling of three, so nobody returns after a year with
 * twelve. An upload costs nothing and is always available.
 *
 * ── WHY TWO COUNTERS AND NOT ONE BALANCE ────────────────────────────────
 *
 * One number cannot hold that rule. A single balance capped at three eats the
 * setup grants a member deliberately saved; a single balance with no cap hands
 * back twelve after a year. The two halves have different rules, so they are
 * two fields, and the total a member reads is their sum.
 *
 * ── WHY THE CEILING IS APPLIED AT ACCRUAL AND NOT AT READ ───────────────
 *
 * `min(CEILING, held + elapsed)` is computed once when the lunation advances
 * and then stored. Computing it at read from "lunations since anchor minus
 * spent" would be a different rule wearing the same name: a member who spent
 * three in Moon 1 and came back in Moon 12 would find eleven waiting, because
 * the subtraction has no memory of the moons that passed while the counter was
 * already full. The whole point of the ceiling is that a full counter stops
 * counting.
 *
 * ── SPENDING TAKES THE MOON HALF FIRST, AND THAT IS FOR THE MEMBER ──────
 *
 * The moon half is capped and the setup half is not, so a grant sitting in the
 * moon half is a grant that blocks the next accrual. Spending it first keeps
 * the member's total higher over time: leave the moon half at three and next
 * moon's grant evaporates against the ceiling, spend it down and next moon's
 * grant lands. Nothing about this is visible in the UI, which shows one row of
 * tokens, and it should not be. It is simply the order that wastes least.
 */

/** Granted once, at profile setup. These bank and never expire. */
export const SETUP_GRANTS = 3;

/** How high the moon half can stack. The setup half has no ceiling. */
export const MOON_GRANT_CEILING = 3;

/** How many tokens the countdown draws. The most a member can ever hold at once. */
export const BUDGET_TOKEN_SLOTS = SETUP_GRANTS + MOON_GRANT_CEILING;

/**
 * Where a portrait came from. Closed here and closed again in the schema, and
 * it is the ONLY field that differs between an upload and a forge.
 */
export type PortraitSource = "forged" | "uploaded";

export function isPortraitSource(v: unknown): v is PortraitSource {
  return v === "forged" || v === "uploaded";
}

/** The two counters as they sit in `portrait_grants`. */
export interface GrantCounters {
  setupRemaining: number;
  moonRemaining: number;
  /** The lunation the moon half was last brought up to. Null means never read. */
  moonCycle: number | null;
  spent: number;
}

/** What a member can spend right now, and what the countdown says. */
export interface ForgeBudget extends GrantCounters {
  /** setupRemaining + moonRemaining. What the tokens count. */
  total: number;
  /**
   * True when the moon half is full, so waiting gains nothing until one is
   * spent. The UI says so instead of promising a grant that will not arrive.
   */
  moonAtCeiling: boolean;
  /** Whole days until this lunation closes and the next grant lands. */
  daysToNextGrant: number | null;
}

const whole = (v: unknown, fallback = 0): number => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
};

const clampMoon = (v: number): number => Math.min(MOON_GRANT_CEILING, Math.max(0, v));

/**
 * Bring the moon half up to the current lunation.
 *
 * Pure, and it takes the ABSOLUTE lunation number rather than a village
 * ordinal. A village that has not set its Moon 1 has no ordinal at all, and
 * its members are still owed their grant, so the accrual must never depend on
 * an anchor existing. `shared/villageMoon.ts` is where the ordinal lives and it
 * is a display concern only.
 *
 * A first read (`moonCycle` null) advances the marker and grants nothing. The
 * member already holds their setup grants, and granting one per lunation since
 * the epoch would hand a new member several thousand.
 *
 * Going backwards grants nothing either: `elapsed <= 0` returns what was held.
 * A clock that moved back is not a moon that turned.
 */
export function accrueMoonGrants(
  held: number,
  moonCycle: number | null,
  nowCycle: number,
): { moonRemaining: number; moonCycle: number; granted: number } {
  const have = clampMoon(whole(held));
  if (!Number.isFinite(nowCycle)) {
    return { moonRemaining: have, moonCycle: moonCycle ?? 0, granted: 0 };
  }
  const now = Math.trunc(nowCycle);
  if (moonCycle === null || !Number.isFinite(moonCycle)) {
    return { moonRemaining: have, moonCycle: now, granted: 0 };
  }
  const elapsed = now - Math.trunc(moonCycle);
  if (elapsed <= 0) return { moonRemaining: have, moonCycle: Math.trunc(moonCycle), granted: 0 };
  const after = clampMoon(have + elapsed);
  return { moonRemaining: after, moonCycle: now, granted: after - have };
}

/**
 * Whole days from `now` until the lunation closes, or null when the instant
 * cannot be read.
 *
 * Rounded UP, because a member reading "0 days" on a moon that has six hours
 * left has been told the grant is already here. Floored at zero for a window
 * that has closed, since a negative count is a fact about our clock and not
 * about their village.
 */
export function daysUntil(endsAt: string | Date | null | undefined, now: Date): number | null {
  if (endsAt === null || endsAt === undefined || endsAt === "") return null;
  const end = endsAt instanceof Date ? endsAt.getTime() : new Date(endsAt).getTime();
  const from = now.getTime();
  if (!Number.isFinite(end) || !Number.isFinite(from)) return null;
  return Math.max(0, Math.ceil((end - from) / 86_400_000));
}

/** Assemble the budget a member reads from the counters and the moon window. */
export function forgeBudget(counters: GrantCounters, endsAt: string | null, now: Date): ForgeBudget {
  const setupRemaining = Math.max(0, whole(counters.setupRemaining));
  const moonRemaining = clampMoon(whole(counters.moonRemaining));
  return {
    setupRemaining,
    moonRemaining,
    moonCycle: counters.moonCycle,
    spent: Math.max(0, whole(counters.spent)),
    total: setupRemaining + moonRemaining,
    moonAtCeiling: moonRemaining >= MOON_GRANT_CEILING,
    daysToNextGrant: daysUntil(endsAt, now),
  };
}

/**
 * Take one grant. Returns null when there is nothing to take.
 *
 * The moon half goes first, for the reason at the top of this file. Callers
 * apply the result with a conditional UPDATE and re-read on a miss, so the
 * decision being pure here does not make it unguarded there.
 */
export function spendOne(counters: GrantCounters): GrantCounters | null {
  const setupRemaining = Math.max(0, whole(counters.setupRemaining));
  const moonRemaining = clampMoon(whole(counters.moonRemaining));
  const spent = Math.max(0, whole(counters.spent)) + 1;
  if (moonRemaining > 0) return { ...counters, moonRemaining: moonRemaining - 1, setupRemaining, spent };
  if (setupRemaining > 0) return { ...counters, moonRemaining, setupRemaining: setupRemaining - 1, spent };
  return null;
}

// ── The words ──────────────────────────────────────────────────────────────

/**
 * What the countdown says under the tokens.
 *
 * Keyed by nothing and taking only what it prints, so the client and any test
 * read the same sentence. THREE cases, and the middle one is the one that
 * makes this function worth having:
 *
 *   - room to grow, and a window to name: say when the next one lands.
 *   - the moon half is full: say so. Promising a grant that the ceiling will
 *     swallow is a countdown to nothing.
 *   - no readable window: say only what is true, which is that the next one
 *     comes when the moon turns.
 *
 * At zero this still returns a sentence, and the caller keeps the stock art and
 * the upload option on screen. A dead disabled button with no explanation is
 * what this replaces.
 */
export function nextGrantSentence(budget: Pick<ForgeBudget, "moonAtCeiling" | "daysToNextGrant">): string {
  if (budget.moonAtCeiling) {
    return "Your moon gift is full at three. Spend one and the next moon adds another.";
  }
  const days = budget.daysToNextGrant;
  if (days === null) return "One more arrives when the moon turns.";
  if (days <= 0) return "One more arrives as this moon turns, today.";
  if (days === 1) return "One more arrives when the moon turns, tomorrow.";
  return `One more arrives when the moon turns, in ${days} days.`;
}

/** How many grants the member holds, said plainly. Used above the tokens. */
export function grantsHeldSentence(total: number): string {
  if (total <= 0) return "You have no forge gifts waiting.";
  if (total === 1) return "You have one forge gift waiting.";
  return `You have ${total} forge gifts waiting.`;
}
