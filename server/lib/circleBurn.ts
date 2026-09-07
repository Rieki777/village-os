/**
 * THE METER FOR A CIRCLE'S ROOM. Reads the ledger, stores nothing, mints
 * nothing.
 *
 * `shared/circleBurn.ts` holds the shape of the answer, the rate arithmetic
 * and the sentences. This file holds the two things that need a database and
 * a village: the attribution key that says which circle a ledger row belongs
 * to, and the windows the two caps are taken over.
 *
 * ── THE ATTRIBUTION KEY, AND WHY IT CARRIES ONE ID AND NOT TWO ─────────────
 *
 * Attribution rides on `token_ledger.source_ref`, which is `varchar(120)`
 * (drizzle/0005, never widened; measured on a live schema at
 * `information_schema.COLUMNS`, and MariaDB here runs STRICT_TRANS_TABLES, so
 * an over-width value is a LOST ROW and not a truncated one).
 *
 * A design pass proposed composing the key from a circle id plus a season id
 * and warned that the pair reaches 136 characters against the 120 the column
 * allows. THE REAL FIGURE IS WORSE AND IT KILLS THE WHOLE IDEA. `circles.id`
 * is varchar(64) and `circle_budgets.season_id` is varchar(64), so the two ids
 * ALONE are 128 characters. With a single-byte separator and no prefix at all
 * the floor is 129. There is no prefix short enough and no separator cheap
 * enough: no encoding of both ids fits, so shortening the prefix is not a fix.
 *
 * So the key carries the circle and nothing else, `circle:<id>`, whose worst
 * case is 7 + 64 = 71 characters with 49 to spare. THE PERIOD IS NOT A LABEL,
 * IT IS A FUNCTION OF THE INSTANT: which cycle and which season a row falls in
 * is derived from `token_ledger.at`, which every row already carries. That is
 * strictly better than composing, for two reasons beyond the width.
 *
 *   A composite key freezes the period at WRITE time. A row written seconds
 *   before a boundary is attributed to whichever window the writer happened to
 *   compute, and two writers can disagree about the same instant.
 *
 *   `cycle.mode` is a live dial (shared/cycleClock.ts). A village that switches
 *   from lunar to calendar would be left with rows labelled under a clock that
 *   no longer runs, and the meter would be summing two eras into one figure.
 *   Deriving from `at` means the window has exactly one definition, the same
 *   one `server/lib/mintCap.ts` reads for the village-wide issuance cap.
 *
 * ── SPENT IS NET OF RETURNS, AND FLOORED AT ZERO ───────────────────────────
 *
 * The same decision `mintCap.ts` records and for the same reason. A row
 * attributed to a circle that LEAVES a faucet is issuance the circle made. A
 * row attributed to the circle that goes BACK into a faucet cancels issuance
 * this window made, and it can never manufacture room the window did not
 * have, so the subtraction has a floor of zero. The floor is a `Math.max` in
 * TypeScript where a reader meets it, not a `GREATEST` buried in the SQL.
 *
 * The faucet flag is joined from `ledger_accounts` and not hardcoded to
 * `sys:mint`, so a treasury given faucet standing later is counted with no
 * change here. Both `token_ledger.from_account` and `ledger_accounts.id`
 * inherit the database collation (0005 and 0009 pin no CHARSET), so this join
 * is not one of the cross-era joins that break off Railway.
 *
 * ── NOTHING IN THIS FILE MINTS ─────────────────────────────────────────────
 *
 * There is no tap here. `circleSpendRef` is exported so that whoever builds
 * one has a single definition of the key to post under, and
 * `circleSpendRefProblem` refuses an id that would not fit before a row is
 * ever offered to the database.
 */
import type { Pool, PoolConnection, RowDataPacket } from "mysql2/promise";
import { MAX_SOURCE_REF } from "./economy";
import { clockFor, type ClockMode, type CycleClock } from "../../shared/cycleClock";
import { civilDate, zonedTimeToUtc } from "../../shared/lunar";
import {
  bindingCap,
  readCap,
  type CapReading,
  type CircleBurnReading,
  type MeteredReading,
  type TreasuryReading,
  type WindowRef,
} from "../../shared/circleBurn";
import { modeAt, type BudgetMode, type PendingModeChange } from "../../shared/circleTreasury";
import type { CircleStatus } from "../../shared/draftKinds";
import { treasuryAccountProblem, treasuryHoldings } from "./circleTreasury";

// ── The attribution key ─────────────────────────────────────────────────────

/** Everything a circle's spend is keyed under. One prefix, seven characters. */
export const CIRCLE_REF_PREFIX = "circle:";

/**
 * Why this circle id cannot be attributed, in words, or null when it can.
 *
 * Called before a post, never after. `circles.id` is slugified and hard-capped
 * to 64 characters at both writers (`server/index.ts`, admin create and
 * org-draft accept), so this never fires against an id the platform made. It
 * fires against an id a fork's own migration invented, which is exactly the
 * case nobody tests and the one strict MySQL turns into a lost row.
 */
export function circleSpendRefProblem(circleId: string): string | null {
  const id = String(circleId ?? "");
  if (!id.trim()) return "a circle spend has to name a circle";
  const width = CIRCLE_REF_PREFIX.length + id.length;
  if (width > MAX_SOURCE_REF) {
    return (
      `attributing a spend to circle ${JSON.stringify(id.slice(0, 40))} needs ${width} ` +
      `characters of source_ref and the ledger column holds ${MAX_SOURCE_REF}. ` +
      `The row would be refused by strict MySQL and the spend would go uncounted`
    );
  }
  return null;
}

/** The one spelling of a circle's attribution key. Throws before it truncates. */
export function circleSpendRef(circleId: string): string {
  const problem = circleSpendRefProblem(circleId);
  if (problem) throw new Error(problem);
  return `${CIRCLE_REF_PREFIX}${circleId}`;
}

/** The circle a ledger row is attributed to, or null when it is attributed to none. */
export function circleIdFromSpendRef(sourceRef: string | null | undefined): string | null {
  const raw = String(sourceRef ?? "");
  if (!raw.startsWith(CIRCLE_REF_PREFIX)) return null;
  const id = raw.slice(CIRCLE_REF_PREFIX.length);
  return id.length > 0 ? id : null;
}

// ── The two windows ─────────────────────────────────────────────────────────

/** One dated season, as the brand document declares it. */
export interface SeasonSpan {
  id: string;
  /** ISO date, inclusive, read in the village's own zone. */
  startsOn: string;
  /** ISO date, exclusive. Empty or null means open ended. */
  endsOn?: string | null;
}

/** The cycle containing `at`, under whichever clock the village keeps. */
export function cycleWindowAt(at: Date, mode: ClockMode | string | null | undefined): WindowRef {
  const clock: CycleClock = clockFor(mode);
  const b = clock.boundsFor(at);
  return { id: b.id, startsAt: b.startsAt.toISOString(), endsAt: b.endsAt.toISOString() };
}

/**
 * The season containing `at`, or null when none does.
 *
 * NULL IS A REAL ANSWER AND IT MUST NOT READ AS UNLIMITED. A village whose
 * last configured season has ended has no season window at all, and
 * `seasonState().needsNextSeason` is the surface that already says so. A
 * season cap with no window is reported `no_window` and constrains nothing,
 * which is honest only because it is said out loud.
 *
 * A SEASON BOUNDARY AND A CYCLE BOUNDARY ARE DIFFERENT KINDS OF THING. A
 * season turns on a civil DATE in the village's own zone (`seasonState` reads
 * `todayInTz`); a cycle turns at a UTC INSTANT. They coincide by accident and
 * never by construction, so an instant can be in this cycle and the next
 * season, or the other way round. Both are converted to instants here through
 * `zonedTimeToUtc`, so the comparison happens once and in one unit.
 *
 * The season the village is IN is the latest one that has begun and has not
 * ended, which is `seasonState`'s own rule: taking the latest is what lets an
 * open-ended founding season hand over when the next one is queued.
 */
export function seasonWindowAt(
  at: Date,
  seasons: readonly SeasonSpan[],
  timeZone: string,
): WindowRef | null {
  const dated = seasons.filter((s) => s && s.startsOn);
  const sorted = [...dated].sort((a, b) => String(a.startsOn).localeCompare(String(b.startsOn)));

  let current: SeasonSpan | null = null;
  let startsAt: Date | null = null;
  for (const s of sorted) {
    const begins = civilDayStart(s.startsOn, timeZone);
    if (!begins || begins.getTime() > at.getTime()) continue;
    const ends = s.endsOn ? civilDayStart(s.endsOn, timeZone) : null;
    if (ends && ends.getTime() <= at.getTime()) continue;
    current = s;
    startsAt = begins;
  }
  if (!current || !startsAt) return null;

  const ends = current.endsOn ? civilDayStart(current.endsOn, timeZone) : null;
  return {
    id: String(current.id),
    startsAt: startsAt.toISOString(),
    /*
     * AN OPEN-ENDED SEASON STILL NEEDS AN END TO TAKE A RATE OVER. It ends
     * "when somebody starts the next one", which is not an instant, so the
     * projection would have no denominator. The next civil year-end in the
     * village's zone is used as the horizon and it is stated here so nobody
     * mistakes it for a declared date: the SPENT and REMAINING figures are
     * exact either way, and only the projection depends on it.
     */
    endsAt: (ends ?? openEndedHorizon(startsAt, timeZone)).toISOString(),
  };
}

/** Midnight at the start of a civil date in a zone, as an instant. */
function civilDayStart(isoDate: string, timeZone: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(isoDate ?? "").trim());
  if (!m) return null;
  return zonedTimeToUtc(Number(m[1]), Number(m[2]), Number(m[3]), 0, 0, timeZone);
}

/** One civil year after a season began, in the village's zone. */
function openEndedHorizon(startsAt: Date, timeZone: string): Date {
  const c = civilDate(startsAt, timeZone);
  return zonedTimeToUtc(c.year + 1, c.month, c.day, 0, 0, timeZone);
}

// ── What the ledger says a circle spent ─────────────────────────────────────

export interface CircleSpend {
  /** Attributed rows leaving a faucet: issuance this circle made. */
  issuedMinor: number;
  /** Attributed rows going back into a faucet inside the same window. */
  returnedMinor: number;
  /** `max(0, issued - returned)`. The figure a cap is compared against. */
  netMinor: number;
  /** How many attributed rows the window holds. Zero is a fact worth having. */
  rows: number;
}

/**
 * One round trip. Every figure comes out of `token_ledger`, none is stored.
 *
 * The window is half open, `at >= from` and `at < to`, so an instant belongs
 * to exactly one cycle and one season and a boundary is never counted twice.
 */
export async function circleSpendIn(
  conn: Pool | PoolConnection,
  circleId: string,
  tokenType: string,
  from: Date,
  to: Date,
): Promise<CircleSpend> {
  const problem = circleSpendRefProblem(circleId);
  if (problem) throw new Error(problem);
  const ref = circleSpendRef(circleId);

  const [rows] = await conn.query<RowDataPacket[]>(
    `SELECT
       COALESCE(SUM(CASE WHEN fa.faucet = 1 THEN t.amount ELSE 0 END), 0) AS issued,
       COALESCE(SUM(CASE WHEN ta.faucet = 1 THEN t.amount ELSE 0 END), 0) AS returned,
       COUNT(*) AS n
     FROM token_ledger t
     LEFT JOIN ledger_accounts fa ON fa.id = t.from_account
     LEFT JOIN ledger_accounts ta ON ta.id = t.to_account
     WHERE t.source_ref = ?
       AND t.token_type = ?
       AND t.at >= ?
       AND t.at < ?`,
    [ref, tokenType, from, to],
  );
  const r = (rows as any[])[0] ?? {};
  const issued = Number(r.issued ?? 0);
  const returned = Number(r.returned ?? 0);
  return {
    issuedMinor: issued,
    returnedMinor: returned,
    netMinor: Math.max(0, issued - returned),
    rows: Number(r.n ?? 0),
  };
}

// ── The reading ─────────────────────────────────────────────────────────────

/** The two caps a budget row carries. Either may be absent. */
export interface CircleEnvelope {
  circleId: string;
  unit: string;
  /** The season cap. Null when the row sets none. */
  seasonCapMinor: number | null;
  /** The cycle cap. Null when the village set none, which is the default. */
  cycleCapMinor: number | null;
  /** The season this row is tied to, or null for a standing envelope. */
  seasonId: string | null;
  /**
   * WHICH MODEL THIS CIRCLE RUNS ON (0181). Every row before 0181 is `cap`.
   *
   * The two caps above are read only under `cap`. Under `treasury` they are
   * not consulted at all, because a treasury has a balance and no ceiling, and
   * a reading that mixed them would report a persisting balance as a fraction
   * of a resetting cap.
   */
  mode: BudgetMode;
  /** A queued change to that model, or null. It has not happened yet. */
  pending: PendingModeChange | null;
  /**
   * What this treasury held when its circle last went dormant, or null.
   *
   * Rye ruled that a dormant circle's treasury goes to the master treasury or
   * is destroyed, so a dormant circle holds nothing and its balance of zero
   * needs this to be told apart from a treasury nobody ever funded.
   */
  dormant: { heldMinor: number; at: string; destination: string } | null;
}

export interface BurnQuery {
  circleId: string;
  /**
   * THE INSTANT THIS ANSWERS FOR, and never implicitly now. For a proposal
   * WHICH `landingFor`, BECAUSE THERE WERE TWO AND THE OTHER WAS WRONG FOR US.
   * A duplicate sat in shared/cycleClock.ts with ZERO production callers, and
   * this contract originally named it. The governance session removed it and
   * told us before we built against it. What the dead copy lacked is exactly
   * the failure this parameter exists to prevent, arriving through the
   * parameter itself: it had no `snapToBoundary`, so a financial ask bundled
   * with an element that moves a number the running cycle is settled against
   * would have been projected at an instant EARLIER than the engine uses, and
   * therefore measured against the WRONG WINDOW. It also returned an unfloored
   * veto window against a production path that floors at 72 hours, and exposed
   * `isGameChange` as a boolean so every caller re-derived the rule that a set
   * containing any Game-change element is wholly a Game change.
   *
   * The `ProposalTiming` union still comes from the clock, deliberately: the
   * dry-run seam may name exactly one module outside its own directory and that
   * module is the clock, so moving the union broke an import guard that was
   * right to complain. `governanceKinds` re-exports it, so there is still one
   * definition.
   *
   * this is the LANDING instant from `landingFor` in shared/governanceKinds.ts, not
   * the moment a member opened the page.
   */
  at: Date;
  /** The ask being tested, in the unit's minor units. Defaults to 0. */
  plus?: number;
  /** Which envelope. Defaults to the only one the circle has. */
  unit?: string;
}

export interface BurnDeps {
  conn: Pool | PoolConnection;
  /** True when the resources module is on for this reader. */
  moduleOn: boolean;
  /** Every envelope the village has declared, already read by the caller. */
  envelopes: readonly CircleEnvelope[];
  /** `cycle.mode`, read AFTER the stores initialise. */
  clockMode: ClockMode | string | null | undefined;
  seasons: readonly SeasonSpan[];
  /** The zone the village turns its seasons in. */
  timeZone: string;
  /** Which ledger token an envelope's unit is denominated in. */
  tokenTypeFor: (unit: string) => string | null;
  /**
   * A circle's lifecycle, read by the caller from the circles repo.
   *
   * `dormant` is reachable today (`circles.status`) and a dormant circle keeps
   * every token in its treasury, so the reading has to be able to say so. It
   * is REQUIRED rather than defaulted: a default of `active` would render a
   * dormant circle's held balance as a live one, which is the empty-state
   * confusion this module was written to avoid, one level up.
   */
  circleStatusFor: (circleId: string) => CircleStatus;
}

/**
 * WHAT A CIRCLE HAS LEFT AT ONE INSTANT, AGAINST BOTH CAPS.
 *
 * ── WHAT IT ANSWERS AT A CYCLE BOUNDARY ────────────────────────────────────
 *
 * `at` past the next cycle boundary puts the reading in the NEXT cycle's
 * window. That window holds no rows, because a ledger row cannot be stamped in
 * the future, so the cycle figure reads `unspent` with the full cap available
 * and NO rate. It does not smear: the sum is taken over `at >= start` and
 * `at < end` of the window containing `at`, so this cycle's spend is not
 * visible from next cycle's window and vice versa. That is the case that makes
 * a false infeasible warning impossible for a ballot landing next moon.
 *
 * ── WHAT IT ANSWERS AT A SEASON BOUNDARY ───────────────────────────────────
 *
 * The two boundaries are independent, and this is the half that surprises. A
 * season turns on a civil date in the village's zone and a cycle turns at a
 * UTC instant, so an instant can be in the next cycle and the same season, in
 * the same cycle and the next season, or across both. Each figure is read
 * against its own window and neither is inferred from the other:
 *
 *   Same cycle, same season: both figures live.
 *   Next cycle, same season: the cycle figure resets to zero and the season
 *     figure does not. The season is what binds, and it binds correctly.
 *   Same cycle, next season: the season figure resets and the cycle figure
 *     does not. The cycle is what binds.
 *   Past both: both are `unspent`, the ask fits under full caps, and neither
 *     carries a rate. Feasible, and no information about burn, which are two
 *     facts and are reported as two.
 *   Past the last configured season: the season cap reads `no_window` and
 *     constrains nothing. It never reads as unlimited room.
 */
export async function burnFor(q: BurnQuery, deps: BurnDeps): Promise<CircleBurnReading> {
  const takenAt = q.at.toISOString();
  if (!deps.moduleOn) return { kind: "module_off" };

  const ask = Math.max(0, Math.trunc(Number(q.plus ?? 0) || 0));
  const cycleWindow = cycleWindowAt(q.at, deps.clockMode);
  const seasonWindow = seasonWindowAt(q.at, deps.seasons, deps.timeZone);

  const envelope = envelopeAt(deps.envelopes, q.circleId, q.unit, seasonWindow);
  if (!envelope) {
    return { kind: "ungoverned", circleId: q.circleId, unit: q.unit ?? "", takenAt };
  }

  const tokenType = deps.tokenTypeFor(envelope.unit);

  /*
   * THE MODE IN FORCE AT `at`, WHICH IS NOT THE MODE IN THE COLUMN.
   *
   * A queued change that has not reached its boundary changes nothing here,
   * which is the whole of Rye's deferral ruling expressed as one call. A
   * ballot card asking about an instant NEXT season therefore reads the model
   * the circle will be on then, and a member reading today reads the one it is
   * on now, from the same row.
   */
  if (modeAt(envelope.mode, envelope.pending, q.at) === "treasury") {
    return treasuryReadingFor(deps.conn, envelope, {
      circleStatus: deps.circleStatusFor(envelope.circleId),
      tokenType,
      takenAt,
      ask,
      period: seasonWindow ?? cycleWindow,
    });
  }

  const cycle = await readOne(
    deps.conn, "cycle", envelope.circleId, tokenType, cycleWindow, envelope.cycleCapMinor, q.at, ask,
  );
  const season = await readOne(
    deps.conn, "season", envelope.circleId, tokenType, seasonWindow, envelope.seasonCapMinor, q.at, ask,
  );

  const binds = bindingCap(cycle, season);
  const fits = [cycle, season].every((c) => c.askFits !== false);

  const reading: MeteredReading = {
    kind: "metered",
    circleId: envelope.circleId,
    unit: envelope.unit,
    takenAt,
    askMinor: ask,
    cycle,
    season,
    binds,
    fits,
  };
  return reading;
}

/**
 * WHICH ENVELOPE GOVERNS THIS CIRCLE AT THIS INSTANT, AND WHY IT IS NOT
 * SIMPLY THE FIRST ROW.
 *
 * `circle_budgets.season_id` names the season a row belongs to, and NULL means
 * a standing envelope that applies whatever season it is. Taking `forCircle[0]`
 * ignored that column completely, so a circle whose only budget was written for
 * the summer season kept being metered against the summer cap all through the
 * autumn. The row is not for this period, and reporting a cap from a period
 * that has ended is worse than reporting none: it answers "does this fit" with
 * a number nobody voted for.
 *
 * The precedence is the season's own row first, then a standing row, then
 * NOTHING. That last step is the point Rye asked for out loud: a circle with no
 * budget for a new period reads as UNGOVERNED, which is its own member of the
 * union and its own sentence, and never as a zero. A zero would say "this
 * circle may issue nothing", and the truth is the opposite, that nothing caps
 * what it may issue.
 *
 * A village with no dated season at all has no season window, so only standing
 * rows apply, which is the same rule with the first step empty.
 */
export function envelopeAt(
  envelopes: readonly CircleEnvelope[],
  circleId: string,
  unit: string | undefined,
  seasonWindow: WindowRef | null,
): CircleEnvelope | null {
  const forCircle = envelopes.filter(
    (e) => e.circleId === circleId && (unit === undefined || e.unit === unit),
  );
  if (forCircle.length === 0) return null;
  const dated = seasonWindow
    ? forCircle.find((e) => e.seasonId !== null && e.seasonId === seasonWindow.id)
    : undefined;
  return dated ?? forCircle.find((e) => e.seasonId === null) ?? null;
}

/**
 * A TREASURY'S READING, AND NOT ONE FIELD OF IT IS A CAP.
 *
 * No `remainingMinor`, no `askShare`, no `exhaustsAt`. What this answers is
 * what the circle HOLDS, what was put there, and what has gone out, all read
 * from the ledger at the instant it is asked for, the same way the cap reading
 * derives everything and stores nothing.
 *
 * `fits` is a comparison against the balance and not against a ceiling. A
 * treasury with 400 in it can afford an ask of 400 and cannot afford 401, and
 * neither of those sentences involves a window.
 */
async function treasuryReadingFor(
  conn: Pool | PoolConnection,
  envelope: CircleEnvelope,
  ctx: {
    circleStatus: CircleStatus;
    tokenType: string | null;
    takenAt: string;
    ask: number;
    period: WindowRef | null;
  },
): Promise<TreasuryReading> {
  const base = {
    kind: "treasury" as const,
    circleId: envelope.circleId,
    unit: envelope.unit,
    takenAt: ctx.takenAt,
    askMinor: ctx.ask,
    circleStatus: ctx.circleStatus,
    pending: envelope.pending,
    // The record of the last dormancy sweep, carried straight through. It is
    // what keeps a swept zero apart from a never-funded one and a spent one.
    sweptOnDormancy: envelope.dormant,
    period: ctx.period,
  };

  /*
   * A UNIT THIS METER DOES NOT READ IS NOT A ZERO BALANCE. An envelope
   * denominated in a currency keeps its movements in `fiat_charges`, and a
   * treasury reported as holding nothing would be a claim about money nobody
   * here counted. Same decision as `unmeasurable` on the cap side.
   */
  if (ctx.tokenType === null || treasuryAccountProblem(envelope.circleId)) {
    return {
      ...base,
      account: "",
      balanceMinor: null,
      fundedMinor: null,
      spentMinor: null,
      returnedMinor: null,
      fits: null,
    };
  }

  const held = await treasuryHoldings(conn, envelope.circleId, ctx.tokenType);
  return {
    ...base,
    account: held.account,
    balanceMinor: held.balanceMinor,
    fundedMinor: held.fundedMinor,
    spentMinor: held.spentMinor,
    returnedMinor: held.returnedMinor,
    fits: held.balanceMinor >= ctx.ask,
  };
}

async function readOne(
  conn: Pool | PoolConnection,
  scope: "cycle" | "season",
  circleId: string,
  tokenType: string | null,
  window: WindowRef | null,
  capMinor: number | null,
  at: Date,
  ask: number,
): Promise<CapReading> {
  /*
   * NO WINDOW AND NO CAP ARE ANSWERED WITHOUT TOUCHING THE DATABASE, on
   * purpose: a sum over a window that does not exist is not a zero, and a
   * query that returns zero rows would be indistinguishable from one.
   */
  if (!window || capMinor === null) {
    return readCap({
      scope, window: window ?? null, capMinor: window ? capMinor : null,
      spentMinor: 0, atMs: at.getTime(), askMinor: ask,
    });
  }
  /*
   * A CAP IN A UNIT THIS METER DOES NOT READ IS NOT A ZERO. An envelope
   * denominated in a currency keeps its spent side in `fiat_charges`, and
   * summing an empty `token_ledger` slice for it would report "nothing spent"
   * about money that may well have moved.
   */
  if (tokenType === null) {
    return readCap({
      scope, window, capMinor, spentMinor: 0,
      atMs: at.getTime(), askMinor: ask, measurable: false,
    });
  }
  /*
   * THE SUM STOPS AT `at`, AND THE RATE'S DENOMINATOR STOPS THERE TOO.
   *
   * They have to be the same instant or the rate is wrong by whatever sits
   * between them. Reading a window that has not finished with the window's END
   * as the upper bound counts rows the reading instant has not reached, which
   * for a reading taken in the past means counting its own future, and divides
   * that by the time elapsed up to `at`. An adversarial pass on this file
   * found it: dropping the upper bound entirely changed no figure any test
   * asserted, because no test had put a row between the instant and the end.
   */
  const from = new Date(window.startsAt);
  const to = new Date(Math.min(at.getTime(), Date.parse(window.endsAt)));
  const spend = to.getTime() <= from.getTime()
    ? { issuedMinor: 0, returnedMinor: 0, netMinor: 0, rows: 0 }
    : await circleSpendIn(conn, circleId, tokenType, from, to);
  return readCap({ scope, window, capMinor, spentMinor: spend.netMinor, atMs: at.getTime(), askMinor: ask });
}
