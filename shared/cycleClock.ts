/**
 * THE CYCLE CLOCK: one seam every consumer of village time reads through.
 *
 * ── WHY THIS FILE EXISTS ───────────────────────────────────────────────────
 *
 * `gratitude.cycle_mode` used to offer a village "lunar" or "calendar month".
 * It was live in the admin panel, it was reported to every client, and one
 * branch inside `currentCycleId()` was the only line of code that ever read
 * it. A village could switch its whole rhythm and the settlement, the
 * budgets, the caps and the allowance windows all carried on lunar. Migration
 * `0108` retired the dial rather than wiring it.
 *
 * The founder reopened the question on 2026-09-02 ("Yes the cycle structure
 * can be changed"), so the dial comes back. It comes back behind a seam,
 * because the defect `0108` deleted was never the dial. It was ten consumers
 * each importing lunar arithmetic directly, so a setting could be shown that
 * nothing read. `cycleSettingsProblem` at the bottom of this file is the
 * guard that stops that shape returning, called at boot by
 * `assertCycleSettingsRead` in `server/lib/gratitude-cycles.ts`: a rhythm
 * setting with no reader is a boot failure now, not a panel that lies.
 *
 * ── THE TWO CLOCKS ─────────────────────────────────────────────────────────
 *
 *   LUNAR (default, and the only clock any village has ever run). Exactly
 *   today's `shared/lunar.ts` arithmetic, called through, never re-derived:
 *   the checked-in table of true new moons from cycle 330 on, the mean
 *   29.53-day formula before it, and THE PAST IS FROZEN. Ids are
 *   `lunar-NNNNNN`.
 *
 *   CALENDAR. A UTC calendar month. Ids are `month-YYYY-MM`.
 *
 * ── WHY `month-` AND NOT THE OLD `YYYY-MM` ─────────────────────────────────
 *
 * The scheme before the lunar one was a bare `YYYY-MM`. Those rows still
 * exist in villages that ran it, `0105` decided they are never remapped
 * because there is no honest way to compute a lunation from a calendar month,
 * and `unreadableCycleProblem` REFUSES them at settlement out loud rather
 * than dropping them. A new calendar clock that minted `2026-09` again would
 * turn that loud refusal into a silently wrong total: the settlement would
 * start reading rows it is meant to stop on, and two eras of a village's
 * money would be added together under one id. So the new clock takes a prefix
 * of its own. `parseId` below recognises the legacy shape by name and gives
 * it no number, so the settlement still answers "unreadable" and the refusal
 * stays exactly as loud as it was.
 *
 * ── NUMBERING, AND WHY THE CALENDAR STARTS AT A MILLION ────────────────────
 *
 * `gratitude_cycles.cycle_number` is UNIQUE, so two clocks numbering from
 * zero would collide the moment a village that switched reached a month
 * number a lunation had already used (lunar 700 falls in the 2050s, calendar
 * month 700 in 2028). The calendar clock therefore numbers from
 * `CALENDAR_CYCLE_BASE`, and the number itself says which clock made it.
 * `formatCycleIdForNumber` and `boundsForNumber` dispatch on that, so every
 * existing call site holding a lunar number keeps its exact behaviour.
 *
 * ── THE SEAM WHEN A VILLAGE SWITCHES ───────────────────────────────────────
 *
 * A true new moon and the first of a UTC month never coincide. "Land the
 * switch at an instant that is a boundary under both clocks" is therefore
 * unsatisfiable read literally, and a precondition nothing can meet is a
 * feature nobody can use. What the rule is protecting is real: no cycle cut
 * in half, no gap, no overlap, nothing unsettled left keyed to a clock that
 * stopped running. `joiningCycle` gives all four. The switch lands at a
 * boundary of the clock being LEFT, and the first cycle under the clock being
 * ENTERED runs from that instant to the incoming clock's own next boundary.
 * One short cycle at the seam, carrying the incoming clock's id, and
 * `cycleModeSwitchProblem` refuses the landing until the outgoing clock has
 * nothing unsettled behind it.
 *
 * Every cycle closed before a switch keeps the id and the bounds it closed
 * under. Nothing in this file recomputes a closed cycle, and the settlement
 * row records which clock closed it.
 *
 * ── GOVERNANCE INSTANTS ────────────────────────────────────────────────────
 *
 * The veto window and the countdown a member watches are the same
 * arithmetic, exported once at the bottom of this file so they cannot drift
 * apart. THREE DAYS MEANS 72 HOURS. Not three civil days in the village
 * timezone, not three sleeps: 72 hours of UTC instants, so a daylight change
 * or a village that moves timezone cannot lengthen or shorten a steward's
 * window. The rendering is the viewer's own zone; the arithmetic is UTC.
 */
import {
  cycleBoundsByNumber,
  cycleBoundsFor,
  cycleStartMs,
} from "./lunar";

// ── Modes and ids ───────────────────────────────────────────────────────────

export const CLOCK_MODES = ["lunar", "calendar"] as const;
export type ClockMode = (typeof CLOCK_MODES)[number];

export const LUNAR_ID_PREFIX = "lunar-";
export const CALENDAR_ID_PREFIX = "month-";

/**
 * Where calendar cycle numbers begin. See the header: `cycle_number` is a
 * UNIQUE column shared by both clocks, and the base is what keeps a village
 * that switched from ever colliding one clock's number with the other's.
 */
export const CALENDAR_CYCLE_BASE = 1_000_000;

/** Calendar month 0 is January 1970, so a number is months since the epoch. */
const CALENDAR_EPOCH_YEAR = 1970;

export interface CycleBounds {
  clock: ClockMode;
  /** Whole cycles since this clock's own reference point. */
  cycleNumber: number;
  id: string;
  startsAt: Date;
  endsAt: Date;
}

/**
 * What a cycle id turns out to be. `clock` is `legacy_month` for the bare
 * `YYYY-MM` ids of the scheme before the lunar one: recognised by name so a
 * caller can say what it is looking at, and carrying no number, because there
 * is no honest lunation for a calendar month.
 */
export interface ParsedCycleId {
  id: string;
  clock: ClockMode | "legacy_month";
  cycleNumber: number | null;
}

export interface CycleClock {
  readonly mode: ClockMode;
  readonly idPrefix: string;
  /** The cycle containing `at`. */
  boundsFor(at: Date): CycleBounds;
  /** The id of the cycle containing `at`. */
  idFor(at: Date): string;
  /** Total over every id shape a village has ever written. */
  parseId(id: string): ParsedCycleId | null;
  /** The instant cycle `n` begins. */
  startOf(n: number): Date;
  /** The first cycle boundary strictly after `at`. */
  nextBoundaryAfter(at: Date): Date;
  /** The number of the cycle containing `at`. */
  cycleNumberAt(at: Date): number;
}

// ── The lunar clock ─────────────────────────────────────────────────────────

/**
 * Today's clock, unchanged in behaviour. Every method delegates to
 * `shared/lunar.ts` rather than restating its arithmetic, so the frozen past
 * has exactly one definition and this seam cannot drift from it.
 */
export const LUNAR_CLOCK: CycleClock = {
  mode: "lunar",
  idPrefix: LUNAR_ID_PREFIX,
  boundsFor(at: Date): CycleBounds {
    const b = cycleBoundsFor(at);
    return {
      clock: "lunar",
      cycleNumber: b.cycleNumber,
      id: formatLunarCycleId(b.cycleNumber),
      startsAt: b.startsAt,
      endsAt: b.endsAt,
    };
  },
  idFor(at: Date): string {
    return formatLunarCycleId(cycleBoundsFor(at).cycleNumber);
  },
  parseId,
  startOf(n: number): Date {
    return new Date(cycleStartMs(n));
  },
  nextBoundaryAfter(at: Date): Date {
    const b = cycleBoundsFor(at);
    if (b.endsAt.getTime() > at.getTime()) return b.endsAt;
    /*
     * STRICTLY AFTER, and this branch is load-bearing rather than defensive.
     *
     * Below TRUE_CLOCK_FROM_CYCLE a boundary is `REF + k * 29.53058867 days`,
     * a FRACTIONAL millisecond, and `new Date` truncates it down. Handed that
     * truncated instant back, `cycleBoundsFor` compares against the float,
     * decides the instant is still inside cycle k, and returns the same
     * truncated end. A caller walking boundaries forward then never moves.
     * That is exactly what happened to the calendar's cycle-close recurrence
     * the first time it was routed through this seam: one occurrence, and a
     * hundred thousand identical loop turns to find it.
     */
    let k = b.cycleNumber + 1;
    while (k < b.cycleNumber + 4 && Math.trunc(cycleStartMs(k)) <= at.getTime()) k += 1;
    return new Date(cycleStartMs(k));
  },
  cycleNumberAt(at: Date): number {
    return cycleBoundsFor(at).cycleNumber;
  },
};

/**
 * Whole days left of a cycle, rounded up and never negative.
 *
 * ONE DEFINITION, because three surfaces show this number: the ring on the
 * cycle clock, the profile payload and `/api/game/cycle`. They used to call
 * `daysRemainingInCycle` in `shared/lunar.ts`, which counts to the next new
 * moon whatever the village keeps time by, so a village on calendar months
 * would have watched a countdown to a boundary its settlement no longer uses.
 * The bounds come from the clock; only the subtraction lives here.
 */
export function daysRemainingIn(bounds: CycleBounds, at: Date): number {
  return Math.max(0, Math.ceil((bounds.endsAt.getTime() - at.getTime()) / 86_400_000));
}

export function formatLunarCycleId(cycleNumber: number): string {
  return `${LUNAR_ID_PREFIX}${String(cycleNumber).padStart(6, "0")}`;
}

// ── The calendar clock ──────────────────────────────────────────────────────

/** Months since January 1970, in UTC. */
function monthsSinceEpoch(at: Date): number {
  return (at.getUTCFullYear() - CALENDAR_EPOCH_YEAR) * 12 + at.getUTCMonth();
}

function calendarStartMs(n: number): number {
  const months = n - CALENDAR_CYCLE_BASE;
  const year = CALENDAR_EPOCH_YEAR + Math.floor(months / 12);
  const month = ((months % 12) + 12) % 12;
  return Date.UTC(year, month, 1);
}

export function formatCalendarCycleId(cycleNumber: number): string {
  const months = cycleNumber - CALENDAR_CYCLE_BASE;
  const year = CALENDAR_EPOCH_YEAR + Math.floor(months / 12);
  const month = ((months % 12) + 12) % 12;
  return `${CALENDAR_ID_PREFIX}${String(year).padStart(4, "0")}-${String(month + 1).padStart(2, "0")}`;
}

/**
 * A UTC calendar month. UTC and not the village zone on purpose: cycle
 * boundaries have always been UTC instants here, the settlement reads them as
 * instants, and a village that changes its timezone must not thereby move a
 * boundary a cycle was already settled against.
 */
export const CALENDAR_CLOCK: CycleClock = {
  mode: "calendar",
  idPrefix: CALENDAR_ID_PREFIX,
  boundsFor(at: Date): CycleBounds {
    const n = CALENDAR_CYCLE_BASE + monthsSinceEpoch(at);
    return {
      clock: "calendar",
      cycleNumber: n,
      id: formatCalendarCycleId(n),
      startsAt: new Date(calendarStartMs(n)),
      endsAt: new Date(calendarStartMs(n + 1)),
    };
  },
  idFor(at: Date): string {
    return formatCalendarCycleId(CALENDAR_CYCLE_BASE + monthsSinceEpoch(at));
  },
  parseId,
  startOf(n: number): Date {
    return new Date(calendarStartMs(n));
  },
  nextBoundaryAfter(at: Date): Date {
    return new Date(calendarStartMs(CALENDAR_CYCLE_BASE + monthsSinceEpoch(at) + 1));
  },
  cycleNumberAt(at: Date): number {
    return CALENDAR_CYCLE_BASE + monthsSinceEpoch(at);
  },
};

export function clockFor(mode: string | null | undefined): CycleClock {
  return String(mode ?? "") === "calendar" ? CALENDAR_CLOCK : LUNAR_CLOCK;
}

/** Which clock a cycle NUMBER belongs to. The number carries its own clock. */
export function clockOfNumber(cycleNumber: number): ClockMode {
  return cycleNumber >= CALENDAR_CYCLE_BASE ? "calendar" : "lunar";
}

/** The id for a cycle number under whichever clock made that number. */
export function formatCycleIdForNumber(cycleNumber: number): string {
  return clockOfNumber(cycleNumber) === "calendar"
    ? formatCalendarCycleId(cycleNumber)
    : formatLunarCycleId(cycleNumber);
}

/** The bounds of a cycle number under whichever clock made that number. */
export function boundsForNumber(cycleNumber: number): CycleBounds {
  if (clockOfNumber(cycleNumber) === "calendar") {
    return {
      clock: "calendar",
      cycleNumber,
      id: formatCalendarCycleId(cycleNumber),
      startsAt: new Date(calendarStartMs(cycleNumber)),
      endsAt: new Date(calendarStartMs(cycleNumber + 1)),
    };
  }
  const b = cycleBoundsByNumber(cycleNumber);
  return {
    clock: "lunar",
    cycleNumber,
    id: formatLunarCycleId(cycleNumber),
    startsAt: b.startsAt,
    endsAt: b.endsAt,
  };
}

// ── Reading an id, totally ──────────────────────────────────────────────────

const LEGACY_MONTH_ID = /^(\d{4})-(\d{2})$/;
const LUNAR_ID = /^lunar-(\d{1,9})$/;
const CALENDAR_ID = /^month-(\d{4})-(\d{2})$/;

/**
 * TOTAL OVER EVERY PREFIX A VILLAGE HAS EVER USED, which is the property that
 * matters: a village that ran calendar months in 2025, lunar cycles in 2026
 * and calendar months again after a vote has three id shapes in one column,
 * and a reader that recognises two of them prices the village wrong and says
 * nothing. Anything it does not recognise returns null and the caller refuses
 * out loud (`unreadableCycleProblem`), which is the same door the legacy ids
 * already go through.
 */
export function parseId(id: string): ParsedCycleId | null {
  const raw = String(id ?? "");
  const lunar = LUNAR_ID.exec(raw);
  if (lunar) return { id: raw, clock: "lunar", cycleNumber: Number(lunar[1]) };
  const cal = CALENDAR_ID.exec(raw);
  if (cal) {
    const year = Number(cal[1]);
    const month = Number(cal[2]);
    if (month < 1 || month > 12) return null;
    return {
      id: raw,
      clock: "calendar",
      cycleNumber: CALENDAR_CYCLE_BASE + (year - CALENDAR_EPOCH_YEAR) * 12 + (month - 1),
    };
  }
  const legacy = LEGACY_MONTH_ID.exec(raw);
  if (legacy) {
    const month = Number(legacy[2]);
    if (month < 1 || month > 12) return null;
    return { id: raw, clock: "legacy_month", cycleNumber: null };
  }
  return null;
}

// ── The seam: switching a village's clock ───────────────────────────────────

/**
 * The cycle that joins two clocks. It begins at the landing instant, which is
 * a boundary of the outgoing clock, and ends at the incoming clock's own next
 * boundary, so no instant belongs to two cycles and none belongs to neither.
 * It carries the incoming clock's id and number for the cycle it ends in,
 * because that is the cycle a member is living through.
 */
export function joiningCycle(from: CycleClock, to: CycleClock, landsAt: Date): CycleBounds {
  const endsAt = to.nextBoundaryAfter(landsAt);
  const n = to.cycleNumberAt(landsAt);
  return {
    clock: to.mode,
    cycleNumber: n,
    id: to.mode === "calendar" ? formatCalendarCycleId(n) : formatLunarCycleId(n),
    startsAt: new Date(landsAt.getTime()),
    endsAt,
  };
}

export interface CycleModeSwitchState {
  /** The clock running now. */
  from: ClockMode;
  /** The clock the village voted for. */
  to: ClockMode;
  /** The instant the change is due to land. */
  landsAt: Date;
  /**
   * Cycle numbers of every cycle that has ENDED under the outgoing clock and
   * has not been recorded closed. "The open cycle settled first" is this
   * list being empty.
   */
  unsettledCycleNumbers: readonly number[];
}

/**
 * Why this switch cannot land yet, in words, or null when it can.
 *
 * A precondition on a ROUTE and on the landing path both, so the same three
 * sentences answer a member reading the proposal page and the job that would
 * otherwise apply it.
 */
export function cycleModeSwitchProblem(state: CycleModeSwitchState): string | null {
  if (state.from === state.to) {
    return `This village already keeps time by the ${clockName(state.to)}. Nothing would change.`;
  }
  const fromClock = clockFor(state.from);
  const boundary = fromClock.startOf(fromClock.cycleNumberAt(state.landsAt));
  if (boundary.getTime() !== state.landsAt.getTime()) {
    return (
      `A change of rhythm can only land where a cycle ends. ` +
      `${state.landsAt.toISOString()} sits inside the cycle that began ` +
      `${boundary.toISOString()}, so landing there would cut that cycle in half and ` +
      `settle it against two different clocks. The next instant that works is ` +
      `${fromClock.nextBoundaryAfter(state.landsAt).toISOString()}.`
    );
  }
  if (state.unsettledCycleNumbers.length > 0) {
    const shown = state.unsettledCycleNumbers.slice(0, 5).map(formatCycleIdForNumber).join(", ");
    const more =
      state.unsettledCycleNumbers.length > 5
        ? `, and ${state.unsettledCycleNumbers.length - 5} more`
        : "";
    return (
      `${state.unsettledCycleNumbers.length} cycle(s) have ended and are not settled yet: ` +
      `${shown}${more}. Settle them under the clock they were played on, then this change lands. ` +
      `A cycle settled under a clock it was never played on prices the village wrong.`
    );
  }
  return null;
}

function clockName(mode: ClockMode): string {
  return mode === "calendar" ? "calendar month" : "moon";
}

/**
 * The rhythm setting and the function that reads it. Every entry here is a
 * promise that a value shown in the Game Mechanics section reaches the
 * engine, and `cycleSettingsProblem` is where the promise is kept.
 */
export const CYCLE_SETTING_READERS: Readonly<Record<string, (raw: string) => unknown>> = {
  "cycle.mode": (raw: string) => clockFor(raw),
};

/**
 * THE GUARD `0108` WAS RETIRED FOR. A rhythm setting the panel shows and no
 * consumer reads is the exact defect that cost the old dial its life: a
 * founder switched the village's whole rhythm and the settlement, the
 * budgets and the allowance windows all carried on regardless.
 *
 * Called at boot, AFTER the variables load. Pass the keys the registry
 * actually publishes and the readers this build actually has; a key with no
 * reader, or a reader that cannot resolve its value, refuses the boot instead
 * of serving a panel that lies.
 */
export function cycleSettingsProblem(
  publishedKeys: readonly string[],
  readers: Readonly<Record<string, (raw: string) => unknown>>,
  valueOf: (key: string) => string,
): string | null {
  const orphans: string[] = [];
  for (const key of publishedKeys) {
    const read = readers[key];
    if (!read) {
      orphans.push(`${key} is shown to every village and nothing in this build reads it`);
      continue;
    }
    let resolved: unknown;
    try {
      resolved = read(valueOf(key));
    } catch (err) {
      orphans.push(`${key} has a reader that threw: ${(err as Error).message}`);
      continue;
    }
    if (resolved === undefined || resolved === null) {
      orphans.push(`${key} has a reader that resolved to nothing`);
    }
  }
  if (orphans.length === 0) return null;
  return (
    `${orphans.length} cycle setting(s) would be shown without being read: ${orphans.join("; ")}. ` +
    `Migration 0108 retired the last dial that had this shape. Wire the reader or drop the setting.`
  );
}

// ── Governance instants ─────────────────────────────────────────────────────

/**
 * THREE DAYS MEANS 72 HOURS.
 *
 * The founder's words were "a steward is given 3 days minimum" and later "72
 * hours from close and a countdown on it". Those are the same rule stated
 * twice, and the build keeps the second wording because it is the one that
 * cannot drift: three civil days is 71, 72 or 73 hours depending on where a
 * village keeps its clocks and whether daylight saving fell inside the
 * window, and a steward's right to object must not be shorter in March than
 * it is in June.
 *
 * The floor is the same number. A village may give its stewards longer and
 * can never give them less.
 */
export const VETO_HOURS_DEFAULT = 72;
export const VETO_HOURS_FLOOR = 72;

const HOUR_MS = 3_600_000;

/** The window a village actually gets, whatever it typed. */
export function effectiveVetoHours(configured: number | null | undefined): number {
  const n = Number(configured);
  if (!Number.isFinite(n)) return VETO_HOURS_DEFAULT;
  return Math.max(VETO_HOURS_FLOOR, Math.floor(n));
}

/** When the veto window on a ballot that closed at `closesAt` shuts. */
export function vetoClosesAt(closesAt: Date, vetoHours: number = VETO_HOURS_DEFAULT): Date {
  return new Date(closesAt.getTime() + effectiveVetoHours(vetoHours) * HOUR_MS);
}

/**
 * WHEN A PROPOSAL CARRIES ITS CHOICE, per 19F. Every proposal picks one, and
 * the default is `next_moon` "to carry a pattern of new activities starting
 * then".
 *
 * THE UNION STAYS HERE while the landing arithmetic below does not, and the
 * split is deliberate. `shared/dryRun/` may name exactly one module outside its
 * own directory, this one, and a guard in `types.test.ts` pins that import list
 * exactly. Moving the union would have forced the dry-run contract to reach
 * into `governanceKinds`, which is a far larger surface than the seam is
 * allowed to depend on. `governanceKinds` imports it FROM here instead, so
 * there is one definition and the seam keeps its small door.
 */
export const PROPOSAL_TIMINGS = ["at_acceptance", "next_moon"] as const;
export type ProposalTiming = (typeof PROPOSAL_TIMINGS)[number];
export const DEFAULT_PROPOSAL_TIMING: ProposalTiming = "next_moon";

/*
 * THE LANDING ARITHMETIC USED TO BE DUPLICATED HERE, and it is deleted rather
 * than documented, because a second copy that nobody calls is only harmless
 * until somebody finds it.
 *
 * `landingFor`, `LandingInput`, `Landing`, `PROPOSAL_TIMINGS`,
 * `ProposalTiming` and `DEFAULT_PROPOSAL_TIMING` lived here with ZERO
 * production callers: the two real ones, `server/lib/applyDue.ts` and
 * `server/lib/proposalDryRun.ts`, both import them from
 * `shared/governanceKinds.ts`, which is the one the engine actually lands on.
 *
 * It was deleted the day another lane cited this copy as the source of the
 * landing instant for the circle burn card. The two are NOT interchangeable:
 * this one had no `snapToBoundary`, so a financial ask bundled with a
 * cycle-timed element would have been projected at an instant EARLIER than the
 * engine uses and therefore against the wrong window; it took `isGameChange` as
 * a boolean, so every caller had to re-derive the bundle rule that a set with
 * any Game-change element is wholly a Game change, which would have been a
 * third copy; and its `vetoHours` was unfloored, so a village that had typed a
 * short window would read one instant here and another in production.
 *
 * THE LANDING INSTANT COMES FROM `shared/governanceKinds.ts`. There is one.
 */


/**
 * Milliseconds left on a window, never negative. The member's countdown and
 * the server's "is this due" question read this same number, so a page can
 * never show time remaining on a window the server has already shut.
 */
export function msRemaining(now: Date, until: Date): number {
  return Math.max(0, until.getTime() - now.getTime());
}

/** True once an instant has arrived. The only "is it due" test in the build. */
export function hasArrived(now: Date, instant: Date): boolean {
  return now.getTime() >= instant.getTime();
}

// ── Terms, counted in cycles ────────────────────────────────────────────────

/**
 * The instant a term of `cycles` cycles beginning at `at` ends.
 *
 * A term is counted in CYCLES and stamped as an instant, which is the fix for
 * a term that hung on the season list: the shipped seasons both ended
 * 2026-12-21, so every village after that date had no current season, nothing
 * lapsed, and a seat that was supposed to turn over never came due. A cycle
 * boundary always exists and always arrives.
 *
 * The term ends at the boundary that opens the cycle `cycles` after the one
 * `at` falls in, so a seat taken up mid-cycle serves out that cycle and then
 * the full number voted for.
 */
export function termEndAfter(at: Date, cycles: number, clock: CycleClock = LUNAR_CLOCK): Date {
  const n = Math.max(1, Math.floor(cycles));
  return clock.startOf(clock.cycleNumberAt(at) + n);
}

/** How many whole cycles remain of a term, floored at zero. */
export function cyclesRemaining(now: Date, termEndsAt: Date, clock: CycleClock = LUNAR_CLOCK): number {
  if (now.getTime() >= termEndsAt.getTime()) return 0;
  return Math.max(0, clock.cycleNumberAt(termEndsAt) - clock.cycleNumberAt(now));
}
