/**
 * WHAT THE REST OF THE PLATFORM ASKS ABOUT A GATHERING'S TIME VOTE, without
 * reaching into how the vote works (the comms build spec 5.10).
 *
 * Two questions, kept in their own file so that the calendar read
 * (server/lib/calendar.ts) and the journey engine's conditions can import
 * them without importing server/lib/comms/timePolls.ts, which moves
 * gatherings through server/lib/gatherings.ts and so imports the calendar
 * itself. This file reaches only the vote's repository and the pure rules.
 *
 *   pollSummariesFor      the `timePoll` every served calendar item carries:
 *                         read ONCE for a whole list (two queries), never per
 *                         item.
 *   timeStillBeingVoted   the answer to the journey condition
 *                         `time_still_being_voted` (the integrator registers
 *                         it under that key): while it is true, a gathering's
 *                         confirmation and reminders wait.
 */
import type { Pool } from "mysql2/promise";
import {
  liveOptions,
  lockAt,
  optionLabel,
  stillBeingVoted,
  type PollOption,
  type TimePollSummary,
} from "../../../shared/comms/timePoll";
import { pollForEvent, pollsWithOptionsFor, type OptionRow } from "../../repos/timePolls";

/** A stored option as the pure rules read it. */
export function toPollOption(o: OptionRow): PollOption {
  return {
    id: o.id,
    position: o.position,
    startsAt: o.startsAt ? o.startsAt.toISOString() : null,
    weekday: o.weekday,
    startMinute: o.startMinute,
    durationMinutes: o.durationMinutes,
    removed: o.removedAt != null,
  };
}

/** One gathering's vote, ready to be laid on each of its evenings. */
export interface PollSummaryBase {
  summary: Omit<TimePollSummary, "stillVoting">;
  freezeHours: number;
}

/**
 * The vote on each of these gatherings, by event id. Gatherings with no vote
 * are absent. `closesAt` is when a one-off vote closes as it stands now (its
 * own close, else the freeze before its earliest time), and `leadingLabel`
 * names the stored leader in village time.
 */
export async function pollSummariesFor(pool: Pool, eventIds: readonly string[], timeZone: string): Promise<Map<string, PollSummaryBase>> {
  const out = new Map<string, PollSummaryBase>();
  for (const { poll, options } of await pollsWithOptionsFor(pool, eventIds)) {
    const opts = options.map(toPollOption);
    const lock = lockAt(poll.mode, poll.closesAt == null ? null : poll.closesAt * 1000, opts, poll.freezeHours);
    const leader = liveOptions(opts).find((o) => o.id === poll.leaderOptionId) ?? null;
    out.set(poll.eventId, {
      summary: {
        state: poll.state,
        mode: poll.mode,
        closesAt: lock == null ? null : new Date(lock).toISOString(),
        leadingLabel: leader ? optionLabel(leader, timeZone) || null : null,
      },
      freezeHours: poll.freezeHours,
    });
  }
  return out;
}

/** One evening's `timePoll`: the gathering's summary, and whether THIS evening can still move. */
export function summaryForEvening(base: PollSummaryBase, startsAtMs: number, nowMs: number): TimePollSummary {
  return {
    ...base.summary,
    stillVoting: stillBeingVoted({ state: base.summary.state, mode: base.summary.mode, freezeHours: base.freezeHours }, startsAtMs, nowMs),
  };
}

/**
 * Whether a gathering's time is still being voted, for one evening when its
 * start is given: the journey engine's `time_still_being_voted`. A one-off
 * gathering waits while its vote is open; a weekly evening waits until it is
 * inside the freeze, where it can no longer move. No vote at all is false.
 */
export async function timeStillBeingVoted(pool: Pool, input: { eventId: string; startsAt?: Date | null; now?: Date }): Promise<boolean> {
  const poll = await pollForEvent(pool, input.eventId);
  const start = input.startsAt instanceof Date && Number.isFinite(input.startsAt.getTime()) ? input.startsAt.getTime() : null;
  return stillBeingVoted(poll, start, (input.now ?? new Date()).getTime());
}
