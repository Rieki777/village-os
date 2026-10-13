/**
 * THE SEASON TURN FOR SEAT APPLICATIONS: `season-plan-turn` (season plans RC2).
 *
 * An application adopted for later (next season's seats) and an application
 * held because a seat was full both wait for a day nobody clicks on. Before
 * this job nothing seated either (red team G2): `seatFromApplication` had no
 * caller. Hourly, and on every save of the Season tab, this sweep:
 *
 *   1. finds an application still `voting` whose ballot already ended (red
 *      team D4). An older image marks a `role_application` ballot applied with
 *      no closer to run, and the application then waits on a vote forever and
 *      blocks the member applying again. A vote that passed and LANDED runs the
 *      closer's execute; one that failed, was withdrawn, or passed and never
 *      landed (vetoed, expired) closes the application the way the closer
 *      would have. Every step is guarded on the status it expects, so a sweep
 *      racing the real closer changes nothing twice. A vote still inside its
 *      window is left alone.
 *   2. seats every adopted application whose first day has come and that no
 *      seating ever took up, and retries every held one, through
 *      `seatFromApplication`: the same locked count adoption makes, renewals
 *      included (an existing seating ends and the member is seated afresh on
 *      the new terms).
 *
 * The member hears the outcome through the closer's own notices, keyed so an
 * hourly retry of a held application says nothing new. No public event.
 *
 * A gap of up to an hour after the turn is real: the Season tab's save runs
 * the sweep at once (`seasonSaved`), which closes it whenever a founder moves
 * the calendar.
 */
import type { Pool } from "mysql2/promise";
import type { SubjectCloser } from "./applyDue";
import { ballotById } from "./ballots";
import { seatFromApplication, settleDepsOf, tellOutcome, type NoticeDeps } from "./seatApplicationCloser";
import type { LapseContext } from "./orgChart";
import { settleText } from "./alignmentSubjects";
import type { SeatCalendar } from "../../shared/seatTerms";
import { applicationsToSeat, latestBallotsFor, votingApplications } from "../repos/seatApplications";

export const SEASON_TURN_JOB = "season-plan-turn";
export const SEASON_TURN_EVERY_MS = 60 * 60 * 1000;

export interface SeasonTurnDeps extends NoticeDeps {
  closer: SubjectCloser;
  lapse: () => LapseContext;
  calendar: () => SeatCalendar;
  now?: () => Date;
}

/** Landing states that mean a passed vote will never land now. */
const NEVER_LANDS = new Set(["vetoed", "not_applicable", "expired"]);

export async function runSeasonTurn(deps: SeasonTurnDeps): Promise<string> {
  const pool: Pool = deps.getPool();
  const now = deps.now?.() ?? new Date();
  let healed = 0;

  // 1. A vote that ended without its closer running.
  const voting = await votingApplications(pool);
  const ballots = await latestBallotsFor(pool, voting.map((a) => a.id));
  for (const app of voting) {
    const latest = ballots.get(app.id);
    if (!latest || latest.status === "open") continue;
    const b = await ballotById(pool, latest.id);
    if (!b) continue;
    if (latest.status === "passed") {
      if (latest.landingStatus === "applied" && deps.closer.execute) {
        await deps.closer.execute(b, "governance");
        healed += 1;
      } else if (latest.landingStatus && NEVER_LANDS.has(latest.landingStatus) && deps.closer.onUnlanded) {
        await deps.closer.onUnlanded(b, latest.landingStatus === "vetoed" ? "vetoed" : "written_off");
        healed += 1;
      }
      continue;
    }
    if (latest.status === "withdrawn") {
      if (deps.closer.onWithdraw) await deps.closer.onWithdraw(b);
    } else {
      await deps.closer.settle(b, latest.status === "no_quorum" ? "no_quorum" : "failed", b.outcomeNote ?? "", "governance");
    }
    healed += 1;
  }

  // 2. Seat what is due, retry what was held.
  let seated = 0;
  let held = 0;
  for (const app of await applicationsToSeat(pool, now)) {
    const { outcome, app: stored } = await seatFromApplication(pool, app.id, { now, lapse: { ...deps.lapse(), now }, calendar: deps.calendar() });
    if (!stored) continue;
    if (outcome.kind === "seated" || outcome.kind === "cannot") {
      await tellOutcome(deps, stored, outcome, "turn", null);
      if (stored.textId) await settleText(settleDepsOf(deps, () => now), stored.textId);
      if (outcome.kind === "seated") seated += 1;
    } else if (outcome.kind === "held-full") {
      held += 1;
      // A newly held application (it was adopted for later, and its seat is
      // full on the day) is told once; a held one retried hourly is not.
      if (stored.status === "adopted") await tellOutcome(deps, stored, outcome, "turn", null);
    }
  }
  if (!healed && !seated && !held) return "";
  return `${seated} seated, ${held} still held, ${healed} ended vote(s) closed`;
}

/*
 * THE SEASON TAB'S SAVE RUNS THE SWEEP. The seasons route and the seat
 * application route are separate modules registered from server/index.ts, so
 * the second hands its sweep to this list and the first calls it, the way the
 * scheduler's `registerJob` keeps its jobs. A failure is logged and never
 * fails the save: the hourly job runs the same sweep.
 */
const onSaved: Array<() => Promise<unknown>> = [];

export function whenSeasonsSaved(fn: () => Promise<unknown>): void {
  onSaved.push(fn);
}

export async function seasonSaved(): Promise<void> {
  for (const fn of onSaved) {
    try {
      await fn();
    } catch (e: any) {
      console.error("[season-turn] the sweep after a season save failed:", e?.message ?? e);
    }
  }
}
