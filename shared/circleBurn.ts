/**
 * WHAT A CIRCLE HAS LEFT, AND WHETHER IT CAN KEEP GOING.
 *
 * A circle budget has been a declared envelope since 0084 and nothing ever
 * decremented it: `drizzle/0084_resources.sql` says so in its own header, and
 * `docs/modules/how-resources-flow.md` repeats it. This file is the meter for
 * the spent side. It stores nothing. Every figure here is derived from the
 * ledger at the instant it is asked for, for the same reason the member
 * allowance is (`server/lib/economy.ts`, "A stored counter is the bug"): a
 * counter drifts, it survives a reversal that should have refunded it, and two
 * readers disagree about the same moment.
 *
 * ── TWO CAPS, AND BOTH OF THEM BIND ────────────────────────────────────────
 *
 * A circle holds a right to ISSUE, capped, and it is capped twice: once per
 * cycle and once per season. Either can run out first. A circle can burn a
 * whole season inside one busy cycle, and a circle that paces itself perfectly
 * across the season can still be stopped in a single week. That is a different
 * shape from one cap, and every reading here reports both.
 *
 * ── THE READING TAKES AN INSTANT, AND IT IS NEVER "NOW" ────────────────────
 *
 * `burnFor` takes `at`. A proposal does not spend when a member reads it. It
 * spends when it LANDS, and the landing instant comes off the ballot's frozen
 * close (`landingFor` in shared/cycleClock.ts): a Game change lands at the
 * later of the next cycle boundary after the close and the close plus the veto
 * window. So a ballot closing late in a cycle lands in the NEXT one, against a
 * cycle cap that has reset by then.
 *
 * Both directions of that are real. An ask that would exhaust this cycle's
 * room can be entirely feasible, because the cycle is over before it lands,
 * and reporting it infeasible is a FALSE WARNING. False warnings are the worse
 * failure here: warnings ride a ballot for stewards to act on, and a village
 * trained to click past false ones will click past the true one. The reverse
 * is equally real: an ask that fits comfortably today can be infeasible at
 * landing because other proposals land first.
 *
 * A reading that only answered "now" would force the ballot surface to shift
 * the window itself, which is a second copy of this arithmetic.
 *
 * ── THE UNGOVERNED CASE IS NOT AN EMPTY STATE ──────────────────────────────
 *
 * Three of the readings below are honest absences: the module is off, the
 * window holds no spend yet, the room is used up. A circle with NO BUDGET ROW
 * is different in kind. Rendered as a zero it reads as reassuring, and it
 * means the opposite: nothing caps what this circle may issue, so the ask is
 * UNGOVERNED. It therefore gets its own member of the union and not a fourth
 * entry in a list of blanks, so a caller cannot reach it through the same
 * branch that renders an absence. A promise audit in this repository already
 * found five member-facing pages conflating exactly this class.
 *
 * ── NOTHING HERE PERSISTS ──────────────────────────────────────────────────
 *
 * The reading is live and stamped with the instant it answers for. A ballot
 * that wants the warning to survive review writes its own record with its own
 * instant and its own numbers; that record belongs to the ballot. This file
 * writes nothing anywhere.
 */

// ── The windows a cap is taken over ─────────────────────────────────────────

export type CapScope = "cycle" | "season";

/** A window, as instants. Ids are the clock's own or the season's own. */
export interface WindowRef {
  id: string;
  startsAt: string;
  endsAt: string;
}

/**
 * What one cap says at one instant.
 *
 * `state` is the discriminant a renderer branches on. The three absences
 * (`no_cap`, `no_window`, `unspent`) and the refusal (`exhausted`) each carry
 * a different fact and must not share a sentence.
 */
export type CapState =
  /** The village set no cap for this window. Nothing here constrains. */
  | "no_cap"
  /** No window of this scope covers the instant. A season can simply run out. */
  | "no_window"
  /**
   * A real cap this build cannot count against.
   *
   * An envelope denominated in a currency has its spent side in `fiat_charges`
   * and this meter reads `token_ledger`. Reporting zero would be a claim that
   * nothing has been spent, which nobody here checked.
   */
  | "unmeasurable"
  /** A real cap, a real window, and no spend inside it. The rate is UNKNOWN. */
  | "unspent"
  /** A real cap with spend under it, and room left. */
  | "burning"
  /** Spend has reached the cap. Zero room, and a cap of 0 lands here at once. */
  | "exhausted";

export interface CapReading {
  scope: CapScope;
  state: CapState;
  /** Null when `state` is `no_cap` or `no_window`. */
  window: WindowRef | null;
  capMinor: number | null;
  spentMinor: number | null;
  remainingMinor: number | null;
  /**
   * Minor units per day so far in this window.
   *
   * NULL IS NOT ZERO AND THE DIFFERENCE IS THE POINT. Zero says "this circle
   * is not spending", which is a claim. Null says "nothing has been spent, so
   * there is nothing to take a rate over", which is the truth when a window
   * has no rows in it. A surface that renders null as 0.0/day has invented a
   * fact.
   */
  perDayMinor: number | null;
  /** Where this rate lands by the window's end. Null whenever the rate is. */
  projectedMinor: number | null;
  /** When the rate reaches the cap, if that falls inside the window. */
  exhaustsAt: string | null;
  /** `spent + ask <= cap`. Null when there is no cap to test it against. */
  askFits: boolean | null;
  /** `(spent + ask) / cap`. Null when there is no cap, or the cap is zero. */
  askShare: number | null;
}

// ── The reading ─────────────────────────────────────────────────────────────

/** The module is off. An absence, and an honest one. */
export interface ModuleOffReading {
  kind: "module_off";
}

/**
 * No envelope exists for this circle in this unit.
 *
 * ITS OWN MEMBER OF THE UNION ON PURPOSE. The distinction from an absence
 * lives in the type, so the ballot surface cannot render it with the branch
 * that renders "nothing spent yet". See the file header.
 */
export interface UngovernedReading {
  kind: "ungoverned";
  circleId: string;
  unit: string;
  takenAt: string;
}

export interface MeteredReading {
  kind: "metered";
  circleId: string;
  unit: string;
  /** The instant this answers for. Not the instant it was computed. */
  takenAt: string;
  /** The ask being tested, in the unit's minor units. 0 asks where we stand. */
  askMinor: number;
  cycle: CapReading;
  season: CapReading;
  /**
   * The cap with the least proportional room left once the ask is counted.
   *
   * Two percentages side by side tell a circle nothing. Which one runs out
   * first tells it what to do. Ties go to the window that ENDS LATER, because
   * equal pressure on the longer window is the harder constraint: the cycle's
   * room comes back sooner.
   */
  binds: CapScope | null;
  /** True when the ask fits under every cap that applies at `takenAt`. */
  fits: boolean;
}

export type CircleBurnReading = ModuleOffReading | UngovernedReading | MeteredReading;

/** True for the one reading that means the spend is uncapped, not empty. */
export function isUngoverned(r: CircleBurnReading): r is UngovernedReading {
  return r.kind === "ungoverned";
}

// ── The rate ────────────────────────────────────────────────────────────────

const DAY_MS = 86_400_000;

export interface RateInput {
  scope: CapScope;
  window: WindowRef | null;
  capMinor: number | null;
  spentMinor: number;
  atMs: number;
  askMinor: number;
  /**
   * False when the spent side of this unit is somewhere this meter does not
   * read. Defaults to true. A false here never produces a zero.
   */
  measurable?: boolean;
}

/**
 * One cap's whole answer, from four numbers and a window.
 *
 * WHY THE RATE IS TAKEN OVER THE WINDOW'S OWN ELAPSED TIME and not over a
 * trailing seven days. The thing the rate predicts is a cap that RESETS at the
 * window boundary. A trailing rate answers a question about calendar time; the
 * cap asks a question about window time, and the two disagree by exactly the
 * amount that matters. Taking the rate from the window's start means the rate
 * and the cap share a denominator, so "at this rate the room runs out on the
 * 20th" is a claim about the same clock the cap resets on. It also means the
 * cycle rate and the season rate are the same arithmetic over different
 * windows, which is why they can disagree about which cap binds.
 */
export function readCap(input: RateInput): CapReading {
  const { scope, window, capMinor, spentMinor, atMs, askMinor } = input;

  if (!window) {
    return blankCap(scope, "no_window");
  }
  if (capMinor === null || capMinor === undefined) {
    return { ...blankCap(scope, "no_cap"), window };
  }
  if (input.measurable === false) {
    return {
      ...blankCap(scope, "unmeasurable"),
      window,
      capMinor: Math.max(0, Math.trunc(capMinor)),
    };
  }

  const cap = Math.max(0, Math.trunc(capMinor));
  const spent = Math.max(0, Math.trunc(spentMinor));
  const remaining = Math.max(0, cap - spent);
  const askFits = spent + askMinor <= cap;
  const askShare = cap > 0 ? (spent + askMinor) / cap : null;

  const startMs = Date.parse(window.startsAt);
  const endMs = Date.parse(window.endsAt);
  const elapsedMs = Math.min(atMs, endMs) - startMs;

  /*
   * THE RATE IS UNKNOWN, AND UNKNOWN IS NOT ZERO.
   *
   * Two separate reasons produce a null rate and both are honest. No spend
   * means there is nothing to take a rate over. No elapsed time means the
   * denominator is zero, which happens exactly at a window boundary and is
   * the instant a `next_moon` landing is most likely to be asked about.
   */
  const measurable = spent > 0 && elapsedMs > 0;
  const perDay = measurable ? spent / (elapsedMs / DAY_MS) : null;
  const projected =
    perDay === null ? null : Math.round(perDay * ((endMs - startMs) / DAY_MS));

  let exhaustsAt: string | null = null;
  if (perDay !== null && perDay > 0 && spent < cap) {
    const hitMs = startMs + (cap / perDay) * DAY_MS;
    if (hitMs < endMs) exhaustsAt = new Date(Math.round(hitMs)).toISOString();
  }

  const state: CapState = spent >= cap ? "exhausted" : spent === 0 ? "unspent" : "burning";

  return {
    scope,
    state,
    window,
    capMinor: cap,
    spentMinor: spent,
    remainingMinor: remaining,
    perDayMinor: perDay,
    projectedMinor: projected,
    exhaustsAt,
    askFits,
    askShare,
  };
}

function blankCap(scope: CapScope, state: CapState): CapReading {
  return {
    scope,
    state,
    window: null,
    capMinor: null,
    spentMinor: null,
    remainingMinor: null,
    perDayMinor: null,
    projectedMinor: null,
    exhaustsAt: null,
    askFits: null,
    askShare: null,
  };
}

/**
 * Which cap runs out first, by proportional room once the ask is counted.
 *
 * A cap of zero admits nothing, so any ask against it is infinite pressure:
 * "Caps fail closed: 0 means zero, never unlimited" is the ledger's rule and
 * it holds here. `askShare` is null in that case because a ratio over zero is
 * not a number a surface can print, so the pressure is computed separately.
 */
export function bindingCap(cycle: CapReading, season: CapReading): CapScope | null {
  /*
   * A cap this build cannot measure is not a candidate. It has a real
   * ceiling and no spend figure, so any pressure computed for it would be a
   * number nobody read off anything, and it would win or lose the comparison
   * on that invented value.
   */
  const live = [cycle, season].filter(
    (c) => c.capMinor !== null && c.window !== null && c.state !== "unmeasurable",
  );
  if (live.length === 0) return null;
  if (live.length === 1) return live[0]!.scope;

  const pressure = (c: CapReading): number => {
    if (c.askShare !== null) return c.askShare;
    const spent = c.spentMinor ?? 0;
    return spent > 0 || (c.capMinor ?? 0) === 0 ? Number.POSITIVE_INFINITY : 0;
  };
  const pc = pressure(cycle);
  const ps = pressure(season);
  if (pc === ps) {
    const endOf = (c: CapReading) => (c.window ? Date.parse(c.window.endsAt) : 0);
    return endOf(season) >= endOf(cycle) ? "season" : "cycle";
  }
  return pc > ps ? "cycle" : "season";
}

// ── The sentences ───────────────────────────────────────────────────────────

/**
 * How a surface spells an amount and names a circle. Injected so the sentence
 * is one string in one place while the words stay the village's own: a token
 * called Seeds must not be printed as `token:seeds` here.
 */
export interface BurnWords {
  circleName: (circleId: string) => string;
  amount: (minor: number, unit: string) => string;
}

const SCOPE_WORD: Readonly<Record<CapScope, string>> = {
  cycle: "cycle",
  season: "season",
};

/**
 * ONE SENTENCE PER READING, AND FOUR THAT MUST NEVER MATCH.
 *
 * The module being off, no envelope existing, an envelope with nothing spent
 * against it, and an envelope fully spent are four different facts about a
 * village. Five member-facing pages have already shipped in this repository
 * with one sentence covering a class like this one, so these are written apart
 * and tested apart.
 */
export function burnSentence(reading: CircleBurnReading, words: BurnWords): string {
  if (reading.kind === "module_off") {
    return (
      "This village is not keeping circle budgets. Nothing here says what a circle may " +
      "issue, so an ask is measured against nothing."
    );
  }
  if (reading.kind === "ungoverned") {
    return (
      `No envelope has been set for ${words.circleName(reading.circleId)}, so this ask is ` +
      "ungoverned. Nothing caps what this circle may issue, and a zero here would say the " +
      "opposite of what is true. Set a budget before reading a burn rate."
    );
  }
  return meteredSentence(reading, words);
}

function meteredSentence(reading: MeteredReading, words: BurnWords): string {
  const name = words.circleName(reading.circleId);
  const binds = reading.binds;
  const bound = binds === "cycle" ? reading.cycle : binds === "season" ? reading.season : null;

  if (!bound) {
    const unmeasured = [reading.cycle, reading.season].find((c) => c.state === "unmeasurable");
    if (unmeasured) {
      return (
        `${name} has a declared envelope in ${reading.unit}, and this meter reads the token ` +
        "ledger, so what has been spent against it is not counted here. Treat the room as " +
        "unknown."
      );
    }
    return `${name} has no cap on what it may issue in this cycle or this season.`;
  }

  const scope = SCOPE_WORD[bound.scope];
  const cap = words.amount(bound.capMinor ?? 0, reading.unit);

  if (bound.state === "exhausted") {
    const until = bound.window ? shortInstant(bound.window.endsAt) : "the window turns";
    return (
      `${name} has used all ${cap} of its ${scope} room. It can issue nothing more until ` +
      `${until}.`
    );
  }

  if (bound.state === "unspent") {
    const room = words.amount(bound.remainingMinor ?? 0, reading.unit);
    const ask = reading.askMinor > 0 ? ` This ask would take ${askWords(bound)} of it.` : "";
    return (
      `${name} has issued nothing this ${scope}. Its room is the whole ${room}, and there is ` +
      `no burn rate yet, because a rate needs a spend to measure.${ask}`
    );
  }

  const other = bound.scope === "cycle" ? reading.season : reading.cycle;
  const spent = words.amount(bound.spentMinor ?? 0, reading.unit);
  const room = words.amount(bound.remainingMinor ?? 0, reading.unit);

  if (reading.askMinor > 0) {
    const head = `This would use ${askWords(bound)} of the ${scope}'s room`;
    const tail = comparable(other)
      ? `, which runs out before the ${SCOPE_WORD[other.scope]}'s.`
      : ".";
    const verdict = reading.fits ? "" : ` The ask does not fit: ${room} is left.`;
    return `${head}${tail}${verdict}`;
  }

  const rate = bound.perDayMinor === null ? "" : ` It is issuing ${words.amount(Math.round(bound.perDayMinor), reading.unit)} a day`;
  const runsOut = bound.exhaustsAt ? `, which uses the room up around ${shortInstant(bound.exhaustsAt)}.` : rate ? ", which stays inside the room." : "";
  return `${name} has issued ${spent} of its ${cap} ${scope} room, with ${room} left.${rate}${runsOut}`;
}

/** A percentage when the cap admits one, and plain words when it is zero. */
function askWords(cap: CapReading): string {
  if (cap.askShare === null) return "more than a cap of zero allows";
  return `${Math.round(cap.askShare * 100)}%`;
}

/** True when the other cap is a real cap that a sentence may point at. */
function comparable(other: CapReading): boolean {
  return other.capMinor !== null && other.window !== null;
}

/** A date a member can read, in UTC, with no invented clock. */
export function shortInstant(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toISOString().slice(0, 10);
}
