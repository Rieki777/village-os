/**
 * THE LIVE TIME VOTE'S RULES, pure (the comms build spec 5.10).
 *
 * Rye, 2026-10-02: "build in the same system for being able to live vote on a
 * session time and have it dynamically change and shift based on what time is
 * winning (for example the community sessions can be done this way)."
 *
 * So the time that is winning IS the time on the calendar. These rules decide
 * which time that is, and when it may move. They are ReGen Civics' Season
 * Schedule (`shared/seasonSchedule.ts` on its main branch) made general:
 *
 *   tallySeasonVotes   -> tallyVotes      approvals per time on offer
 *   seasonLeader       -> pollLeader      most approvals; a tie keeps the
 *                                         current leader
 *   resolveSeasonSlot  -> appliedOption   the pin, else a leader that has led
 *                                         long enough, else the time last
 *                                         applied
 *   planSeasonMoves    -> planWeeklyMoves never inside the freeze, never a
 *                                         date somebody moved by hand
 *
 * What changed on the way over, and why:
 *
 *   - The unit is a PERSON, one approval per time each. The Season counted
 *     land projects; a village gathering counts the people who would come.
 *   - The settle time is the poll's own (`settle_minutes`, default the dial
 *     `comms.time_poll_settle_minutes`, 0), where the Season held a fixed 24
 *     hours. At 0 the vote is followed live, which is the whole request.
 *   - With no votes at all the FIRST option leads, so a new poll puts the
 *     gathering on the time the host listed first, and the gathering always
 *     has a time.
 *   - Two modes. `once` is one gathering choosing its start, and locks before
 *     the earliest time on offer. `weekly` is a series choosing its weekday and
 *     hour, stays open, and never moves an evening inside the freeze.
 *
 * THE CLOCK IS HANDED IN. Every function here takes `nowMs`, and the server
 * passes the DATABASE's clock (`UNIX_TIMESTAMP()`), so the settle rule, the
 * lock time and the freeze are all measured on the one clock that stamped
 * `leader_since` (the comms build spec section 1, rule 7).
 *
 * Pure and isomorphic: the server's job, its routes, the gathering page and
 * the host's editor read one copy of these rules and cannot drift apart.
 */
import { civilParts, zonedTimeToUtc } from "../lunar";
import { gatheringWhen } from "./mergeFields";

// ── The vocabulary ──────────────────────────────────────────────────────────

/**
 *   once    one gathering choosing its start from two to eight candidates.
 *   weekly  a weekly series choosing its weekday and hour (community sessions).
 */
export const POLL_MODES = ["once", "weekly"] as const;
export type PollMode = (typeof POLL_MODES)[number];

/**
 *   open    votes move the time.
 *   locked  the vote is in, and the time stays where it is. A host can reopen.
 */
export const POLL_STATES = ["open", "locked"] as const;
export type PollState = (typeof POLL_STATES)[number];

/** Two to eight times on offer (5.10). */
export const MIN_OPTIONS = 2;
export const MAX_OPTIONS = 8;

/** How long one candidate time runs. A quarter of an hour to a whole day. */
export const MIN_DURATION_MINUTES = 15;
export const MAX_DURATION_MINUTES = 24 * 60;
export const DEFAULT_DURATION_MINUTES = 60;

/**
 * How far ahead a weekly series is kept on the time its vote chose. The
 * calendar's year views read about fourteen months around the day they open
 * on, so 400 days covers every date a member can see. The job carries the
 * window forward as the days pass (see `planWeeklyMoves`).
 */
export const WEEKLY_HORIZON_DAYS = 400;

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

export const isPollMode = (v: unknown): v is PollMode => (POLL_MODES as readonly unknown[]).includes(v);
export const isPollState = (v: unknown): v is PollState => (POLL_STATES as readonly unknown[]).includes(v);

/** One time on offer. A `once` option has a start; a `weekly` option has a weekday and a minute. */
export interface PollOption {
  id: string;
  /** The host's order. The first live option leads a poll nobody has voted on. */
  position: number;
  /** `once`: the candidate start, an ISO instant. Null for a weekly option. */
  startsAt: string | null;
  /** `weekly`: 0 is Sunday and 6 is Saturday, in village time (shared/gatherings.ts uses the same numbers). */
  weekday: number | null;
  /** `weekly`: minutes after midnight, in village time. */
  startMinute: number | null;
  durationMinutes: number;
  /** Taken off the poll. Its votes stay as the record of what was asked, and count for nothing. */
  removed: boolean;
}

/** One approval: this person can make this time. A vote for three times is three of these. */
export interface PollVote {
  optionId: string;
  personKey: string;
}

/** The options still on offer, in the host's order. Ties on position break on the id, so the order is total. */
export function liveOptions(options: readonly PollOption[]): PollOption[] {
  return options
    .filter((o) => !o.removed)
    .slice()
    .sort((a, b) => a.position - b.position || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

// ── The tally ───────────────────────────────────────────────────────────────

export interface PollTally {
  /** Approvals per live option. Every live option is present, at zero when nobody picked it. */
  counts: Record<string, number>;
  /** People with at least one approval on a live option. */
  voters: number;
}

/**
 * Approvals per time on offer. A vote for a time no longer on offer counts for
 * nothing and is not deleted, so putting the time back restores it, the way
 * the Season's tally ignored a slot that was taken off the page. A person
 * counts once per time however many rows a race wrote; the table's primary key
 * already holds that, and this holds it again for a caller handing in rows
 * from anywhere.
 */
export function tallyVotes(options: readonly PollOption[], votes: readonly PollVote[]): PollTally {
  const live = new Set(liveOptions(options).map((o) => o.id));
  const counts: Record<string, number> = {};
  for (const id of Array.from(live)) counts[id] = 0;
  const seen = new Set<string>();
  const voters = new Set<string>();
  for (const v of votes) {
    if (!live.has(v.optionId) || !v.personKey) continue;
    const key = `${v.optionId}\u0000${v.personKey}`;
    if (seen.has(key)) continue;
    seen.add(key);
    counts[v.optionId] += 1;
    voters.add(v.personKey);
  }
  return { counts, voters: voters.size };
}

/**
 * The time with the most approvals.
 *
 * A TIE KEEPS THE CURRENT LEADER: an even split is no reason to move a
 * gathering people have already planned around, and a leader that flipped on
 * every tied vote would move the calendar back and forth for nothing. A tie
 * that does not include the current leader goes to the time the host listed
 * first. With no votes at all, the first time on offer leads, so a new poll
 * always has a time to show.
 *
 * Null only when nothing is on offer.
 */
export function pollLeader(counts: Readonly<Record<string, number>>, options: readonly PollOption[], current: string | null): string | null {
  const live = liveOptions(options);
  if (!live.length) return null;
  let top = 0;
  for (const o of live) top = Math.max(top, counts[o.id] ?? 0);
  if (top <= 0) return live[0].id;
  const tied = live.filter((o) => (counts[o.id] ?? 0) === top);
  if (current && tied.some((o) => o.id === current)) return current;
  return tied[0].id;
}

// ── Which time the gathering follows ────────────────────────────────────────

export interface AppliedInput {
  pinnedId: string | null;
  leaderId: string | null;
  /** When the current leader took the lead, epoch milliseconds. */
  leaderSinceMs: number | null;
  settleMinutes: number;
  /** The option last written to the gathering. */
  appliedId: string | null;
  nowMs: number;
  options: readonly PollOption[];
}

/**
 * The option the gathering should be on right now.
 *
 *   1. The host's pin, while it is still on offer. A pin beats the vote.
 *   2. The leader, once it has led for `settleMinutes`. At 0 that is at once,
 *      which is the live vote Rye asked for.
 *   3. Otherwise the time last applied, unchanged, even when that time has
 *      since been taken off the poll: nothing moves until a time on offer has
 *      earned it.
 */
export function appliedOption(i: AppliedInput): string | null {
  const live = new Set(liveOptions(i.options).map((o) => o.id));
  if (i.pinnedId && live.has(i.pinnedId)) return i.pinnedId;
  const settle = Math.max(0, Math.trunc(i.settleMinutes || 0)) * MINUTE;
  if (i.leaderId && live.has(i.leaderId) && i.leaderSinceMs != null && i.nowMs - i.leaderSinceMs >= settle) return i.leaderId;
  return i.appliedId;
}

/**
 * The time a vote ends on: the pin when there is one, else the leader. Settle
 * time is not asked for here, because a vote that has closed has no "for now"
 * left in it: whatever leads when it closes is the answer, the way the Season
 * took whatever led at its first decision.
 */
export function finalOption(pinnedId: string | null, leaderId: string | null, options: readonly PollOption[]): string | null {
  const live = new Set(liveOptions(options).map((o) => o.id));
  if (pinnedId && live.has(pinnedId)) return pinnedId;
  return leaderId && live.has(leaderId) ? leaderId : null;
}

/**
 * When a `once` poll locks: its own `closes_at` when the host set one, else
 * `freezeHours` before the earliest time still on offer, so the vote is over
 * before anybody is inside the window where a move would surprise them. A
 * weekly poll never locks by itself (it stays open, 5.10), so it answers null.
 */
export function lockAt(mode: PollMode, closesAtMs: number | null, options: readonly PollOption[], freezeHours: number): number | null {
  if (mode !== "once") return null;
  if (closesAtMs != null && Number.isFinite(closesAtMs)) return closesAtMs;
  const starts = liveOptions(options)
    .map((o) => (o.startsAt ? Date.parse(o.startsAt) : NaN))
    .filter((ms) => Number.isFinite(ms));
  if (!starts.length) return null;
  return Math.min(...starts) - Math.max(0, freezeHours) * HOUR;
}

/** What a poll looks like to the resolver: the stored row, reduced to what the rules read. */
export interface PollSnapshot {
  mode: PollMode;
  state: PollState;
  closesAtMs: number | null;
  settleMinutes: number;
  freezeHours: number;
  pinnedId: string | null;
  leaderId: string | null;
  leaderSinceMs: number | null;
  appliedId: string | null;
}

export interface PollResolution {
  tally: PollTally;
  leaderId: string | null;
  leaderSinceMs: number | null;
  /** The stored leader record needs writing: a new leader, or a first one. */
  leaderChanged: boolean;
  /** Where the gathering should be. For a locked poll, where it already is. */
  appliedId: string | null;
  appliedChanged: boolean;
  lockAtMs: number | null;
  /** An open `once` poll whose lock time has come. */
  dueToLock: boolean;
}

/**
 * Read the vote and say what follows from it, now. The server writes the
 * leader record this returns (so the settle rule has a start to count from,
 * which is how the Season's resolver worked), moves the gathering when
 * `appliedChanged`, and locks a poll that is `dueToLock`.
 *
 * A locked poll keeps its applied time whatever the votes say: the vote is in.
 */
export function resolvePoll(snapshot: PollSnapshot, options: readonly PollOption[], votes: readonly PollVote[], nowMs: number): PollResolution {
  const tally = tallyVotes(options, votes);
  const live = new Set(liveOptions(options).map((o) => o.id));
  const current = snapshot.leaderId && live.has(snapshot.leaderId) ? snapshot.leaderId : null;
  const leaderId = pollLeader(tally.counts, options, current);
  const sameLeader = leaderId !== null && leaderId === snapshot.leaderId;
  const leaderSinceMs = leaderId === null ? null : sameLeader ? snapshot.leaderSinceMs ?? nowMs : nowMs;
  const leaderChanged = leaderId !== snapshot.leaderId || leaderSinceMs !== snapshot.leaderSinceMs;
  const lockAtMs = lockAt(snapshot.mode, snapshot.closesAtMs, options, snapshot.freezeHours);
  if (snapshot.state !== "open") {
    return { tally, leaderId, leaderSinceMs, leaderChanged, appliedId: snapshot.appliedId, appliedChanged: false, lockAtMs, dueToLock: false };
  }
  const appliedId = appliedOption({
    pinnedId: snapshot.pinnedId,
    leaderId,
    leaderSinceMs,
    settleMinutes: snapshot.settleMinutes,
    appliedId: snapshot.appliedId,
    nowMs,
    options,
  });
  return {
    tally,
    leaderId,
    leaderSinceMs,
    leaderChanged,
    appliedId,
    appliedChanged: appliedId !== snapshot.appliedId,
    lockAtMs,
    dueToLock: snapshot.mode === "once" && lockAtMs !== null && nowMs >= lockAtMs,
  };
}

/**
 * Whether a gathering's time is still being voted: what the gathering page
 * marks, and the answer to the journey engine's `time_still_being_voted`, so
 * a confirmation or a reminder never names a time the vote can still change.
 *
 *   once    while the poll is open.
 *   weekly  while the poll is open AND this evening is beyond the freeze. An
 *           evening inside it can no longer move, so its reminders may go. With
 *           no evening named, a weekly poll that is open counts as voting.
 */
export function stillBeingVoted(
  poll: { state: PollState; mode: PollMode; freezeHours: number } | null,
  occurrenceStartMs: number | null,
  nowMs: number,
): boolean {
  if (!poll || poll.state !== "open") return false;
  if (poll.mode === "once") return true;
  if (occurrenceStartMs == null || !Number.isFinite(occurrenceStartMs)) return true;
  return occurrenceStartMs > nowMs + Math.max(0, poll.freezeHours) * HOUR;
}

// ── Weekly series ───────────────────────────────────────────────────────────

/** A weekly time: a weekday and a minute in village time, and how long it runs. */
export interface WeeklySlot {
  weekday: number;
  startMinute: number;
  durationMinutes: number;
}

/** A weekly option's slot, or null for an option that is not one. */
export function slotOf(option: PollOption): WeeklySlot | null {
  if (option.weekday == null || option.startMinute == null) return null;
  return { weekday: option.weekday, startMinute: option.startMinute, durationMinutes: option.durationMinutes };
}

/**
 * When a weekly slot falls for one evening of a series: the first day with the
 * slot's weekday ON OR AFTER the evening's own date, at the slot's minute, in
 * village time. "On or after" is the Season's rule ("either Saturday or
 * beyond"): an evening never moves to a day before the one it was announced
 * for, and a Tuesday series voted onto Wednesdays meets the Wednesday after
 * each Tuesday. Daylight changes are honoured, because the minute is village
 * wall-clock time.
 *
 * `dateKey` is the evening's occurrence key, `YYYY-MM-DD`.
 */
export function slotStartOnOrAfter(dateKey: string, slot: Pick<WeeklySlot, "weekday" | "startMinute">, timeZone: string): Date {
  const [y, m, d] = dateKey.split("-").map(Number);
  const noon = new Date(Date.UTC(y, m - 1, d, 12));
  const ahead = (((slot.weekday - noon.getUTCDay()) % 7) + 7) % 7;
  const day = new Date(Date.UTC(y, m - 1, d + ahead, 12));
  const minute = Math.min(24 * 60 - 1, Math.max(0, Math.trunc(slot.startMinute)));
  return zonedTimeToUtc(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), Math.floor(minute / 60), minute % 60, timeZone);
}

/**
 * Whether one evening may move from `fromMs` to `toMs`: only when BOTH are
 * beyond the freeze. People have planned around an evening that close, and an
 * evening must not be moved INTO the window either, which would hand somebody
 * a time two hours away (the Season's rule, kept).
 */
export function mayMove(fromMs: number, toMs: number, nowMs: number, freezeHours: number): boolean {
  const freezeUntil = nowMs + Math.max(0, freezeHours) * HOUR;
  return fromMs > freezeUntil && toMs > freezeUntil;
}

/** One evening of a weekly series, as the planner reads it. */
export interface SeriesOccurrence {
  /** The occurrence key: the village-time date the series' own rule puts it on. */
  key: string;
  /** Where it is now, after any move. */
  startsAt: Date;
  /** Where the series' own rule puts it. */
  ruleStartsAt: Date;
  cancelled: boolean;
}

export interface WeeklyMove {
  key: string;
  from: Date;
  to: Date;
  toEnd: Date;
}

/**
 * Which evenings of a weekly series move onto `target`, and to when.
 *
 * KEYS NEVER CHANGE. An evening keeps the key its own rule gave it, whatever
 * day it moves to, so every answer, seat fee, queue place, attendance mark
 * and reminder written against that key stays attached to the same evening
 * (server/lib/comms/timePolls.ts says why the series' rule itself is left
 * alone). That is why a move is computed from the KEY's date and not from
 * wherever the evening sits now: the same key always lands on the same day
 * for the same slot, so planning twice moves nothing twice.
 *
 * An evening stays where it is when:
 *   - it is cancelled;
 *   - it is already there;
 *   - it is inside the freeze, or the move would put it inside (`mayMove`);
 *   - somebody moved it by hand: it sits neither where its rule puts it nor
 *     where any time on this poll would put it, so a person chose that time
 *     and the vote leaves it alone (the Season's `manualOverride`).
 */
export function planWeeklyMoves(input: {
  occurrences: readonly SeriesOccurrence[];
  target: WeeklySlot;
  /** Every slot this poll has ever offered, removed ones included, for spotting a hand-made move. */
  known: readonly Pick<WeeklySlot, "weekday" | "startMinute">[];
  nowMs: number;
  freezeHours: number;
  timeZone: string;
}): WeeklyMove[] {
  const moves: WeeklyMove[] = [];
  for (const occ of input.occurrences) {
    if (occ.cancelled) continue;
    const at = occ.startsAt.getTime();
    const to = slotStartOnOrAfter(occ.key, input.target, input.timeZone);
    if (to.getTime() === at) continue;
    const byRule = at === occ.ruleStartsAt.getTime();
    const byVote = input.known.some((s) => slotStartOnOrAfter(occ.key, s, input.timeZone).getTime() === at);
    if (!byRule && !byVote) continue;
    if (!mayMove(at, to.getTime(), input.nowMs, input.freezeHours)) continue;
    moves.push({ key: occ.key, from: occ.startsAt, to, toEnd: new Date(to.getTime() + input.target.durationMinutes * MINUTE) });
  }
  return moves;
}

/** One evening's override as the series stores it (shared/gatherings.ts `OccurrenceOverride`). */
export interface OverrideLike {
  cancelled?: boolean;
  startsAt?: string;
  endsAt?: string | null;
  title?: string;
}

/**
 * The series' per-evening overrides with these moves written in. Only the
 * start and end of each moved evening change: a title or a cancellation a
 * host set on that evening is kept. An evening moved back onto exactly where
 * its own rule puts it loses its start and end, and an override left with
 * nothing in it goes, so the series carries no clutter.
 *
 * `ruleEndOf` answers where the rule ends an evening, for that clean-up.
 */
export function overridesWithMoves(
  existing: Readonly<Record<string, OverrideLike>> | null | undefined,
  moves: readonly WeeklyMove[],
  ruleOf: (key: string) => { startsAt: Date; endsAt: Date | null } | null,
): Record<string, OverrideLike> {
  const out: Record<string, OverrideLike> = {};
  for (const [k, v] of Object.entries(existing ?? {})) out[k] = { ...v };
  for (const move of moves) {
    const next: OverrideLike = { ...(out[move.key] ?? {}) };
    const rule = ruleOf(move.key);
    const backOnRule =
      rule !== null &&
      rule.startsAt.getTime() === move.to.getTime() &&
      (rule.endsAt === null ? false : rule.endsAt.getTime() === move.toEnd.getTime());
    if (backOnRule) {
      delete next.startsAt;
      delete next.endsAt;
    } else {
      next.startsAt = move.to.toISOString();
      next.endsAt = move.toEnd.toISOString();
    }
    if (Object.keys(next).length) out[move.key] = next;
    else delete out[move.key];
  }
  return out;
}

// ── Words ───────────────────────────────────────────────────────────────────

const WEEKDAYS_PLURAL = ["Sundays", "Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays"];
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/**
 * Newer ICU puts a narrow no-break space before "AM"; a plain-text part reads
 * better with an ordinary one. Built from code points, so this file carries no
 * invisible characters (the same rule `gatheringWhen` follows).
 */
const ODD_SPACES = new RegExp(`[${String.fromCharCode(0x202f, 0x00a0)}]`, "g");

/** "6:00 PM" for a minute of the day. */
export function clockLabel(startMinute: number, locale = "en-US"): string {
  const minute = Math.min(24 * 60 - 1, Math.max(0, Math.trunc(startMinute)));
  const at = new Date(Date.UTC(2000, 0, 2, Math.floor(minute / 60), minute % 60));
  return new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit", timeZone: "UTC" }).format(at).replace(ODD_SPACES, " ");
}

/** "Tuesdays at 6:00 PM". */
export function weeklyLabel(slot: Pick<WeeklySlot, "weekday" | "startMinute">, locale = "en-US"): string {
  const day = WEEKDAYS_PLURAL[((Math.trunc(slot.weekday) % 7) + 7) % 7];
  return `${day} at ${clockLabel(slot.startMinute, locale)}`;
}

/** The weekly phrase for an instant as one zone reads it: what "Tuesdays at 6:00 PM" is somewhere else. */
export function weeklyLabelIn(start: Date, timeZone: string, locale = "en-US"): string {
  try {
    const c = civilParts(start, timeZone);
    return weeklyLabel({ weekday: c.weekday, startMinute: c.hour * 60 + c.minute }, locale);
  } catch {
    return "";
  }
}

/**
 * One option in words: "Tuesday, October 7 at 6:00 PM" for a one-off, in
 * village time through the one formatter the emails use (`gatheringWhen`),
 * and "Tuesdays at 6:00 PM" for a weekly slot.
 */
export function optionLabel(option: PollOption, timeZone: string, locale = "en-US"): string {
  const slot = slotOf(option);
  if (slot) return weeklyLabel(slot, locale);
  const start = option.startsAt ? new Date(option.startsAt) : null;
  if (!start || Number.isNaN(start.getTime())) return "";
  return gatheringWhen(start, timeZone, null, locale).when;
}

/** The single day name of a weekday number, for an editor's picker. */
export function weekdayName(weekday: number): string {
  return WEEKDAYS[((Math.trunc(weekday) % 7) + 7) % 7];
}

// ── What the host may offer ─────────────────────────────────────────────────

/** One option as an editor or a request sends it, before it is checked. */
export interface OptionInput {
  startsAt?: unknown;
  weekday?: unknown;
  startMinute?: unknown;
  durationMinutes?: unknown;
}

/** A checked option, ready to store. */
export interface CleanOption {
  startsAt: string | null;
  weekday: number | null;
  startMinute: number | null;
  durationMinutes: number;
}

const wholeNumber = (v: unknown): number | null => {
  if (typeof v === "string" && !v.trim()) return null;
  const n = Number(v);
  return Number.isInteger(n) ? n : null;
};

/**
 * One time a host offers, checked, or the sentence saying what is wrong. The
 * server and the editor both run this, so the editor's refusal and the
 * server's are the same words.
 *
 * A one-off time must be in the future: a vote on a time already past would
 * move a gathering into history.
 */
export function cleanOption(mode: PollMode, raw: OptionInput, nowMs: number): { ok: true; option: CleanOption } | { ok: false; error: string } {
  const rawDuration = raw.durationMinutes === undefined || raw.durationMinutes === null || raw.durationMinutes === "" ? DEFAULT_DURATION_MINUTES : wholeNumber(raw.durationMinutes);
  if (rawDuration === null || rawDuration < MIN_DURATION_MINUTES || rawDuration > MAX_DURATION_MINUTES) {
    return { ok: false, error: `Each time runs between ${MIN_DURATION_MINUTES} minutes and ${MAX_DURATION_MINUTES / 60} hours.` };
  }
  if (mode === "once") {
    const start = typeof raw.startsAt === "string" ? new Date(raw.startsAt) : null;
    if (!start || Number.isNaN(start.getTime())) return { ok: false, error: "Each time needs a start date and hour." };
    if (start.getTime() <= nowMs) return { ok: false, error: "Each time has to be in the future." };
    return { ok: true, option: { startsAt: start.toISOString(), weekday: null, startMinute: null, durationMinutes: rawDuration } };
  }
  const weekday = wholeNumber(raw.weekday);
  if (weekday === null || weekday < 0 || weekday > 6) return { ok: false, error: "Each weekly time needs a day of the week." };
  const startMinute = wholeNumber(raw.startMinute);
  if (startMinute === null || startMinute < 0 || startMinute >= 24 * 60) return { ok: false, error: "Each weekly time needs an hour of the day." };
  return { ok: true, option: { startsAt: null, weekday, startMinute, durationMinutes: rawDuration } };
}

/** The identity of a time, for spotting the same one offered twice. */
export function sameTimeKey(o: Pick<CleanOption, "startsAt" | "weekday" | "startMinute">): string {
  return o.startsAt ? `at:${Date.parse(o.startsAt)}` : `slot:${o.weekday}:${o.startMinute}`;
}

/**
 * A whole list of times, checked together: each one on its own, then the
 * list's size, then no time offered twice. The first problem found is the
 * one reported, so the host fixes one thing at a time.
 */
export function cleanOptions(
  mode: PollMode,
  raw: readonly OptionInput[],
  nowMs: number,
  already: readonly Pick<CleanOption, "startsAt" | "weekday" | "startMinute">[] = [],
): { ok: true; options: CleanOption[] } | { ok: false; error: string } {
  const options: CleanOption[] = [];
  for (const r of raw) {
    const c = cleanOption(mode, r ?? {}, nowMs);
    if (!c.ok) return c;
    options.push(c.option);
  }
  const total = already.length + options.length;
  if (total < MIN_OPTIONS) return { ok: false, error: `Offer at least ${MIN_OPTIONS} times.` };
  if (total > MAX_OPTIONS) return { ok: false, error: `A vote can offer at most ${MAX_OPTIONS} times.` };
  const seen = new Set(already.map(sameTimeKey));
  for (const o of options) {
    const k = sameTimeKey(o);
    if (seen.has(k)) return { ok: false, error: "That time is already on the vote." };
    seen.add(k);
  }
  return { ok: true, options };
}

// ── What the gathering page and the editor read ─────────────────────────────

/** One time on the page: its words, its count, and who picked it when names may be shown. */
export interface PollOptionView {
  id: string;
  label: string;
  startsAt: string | null;
  weekday: number | null;
  startMinute: number | null;
  durationMinutes: number;
  count: number;
  /** First names, present only for a viewer allowed to see them. */
  names?: string[];
  leading: boolean;
  /** The time the gathering is on now. */
  applied: boolean;
  pinned: boolean;
}

/** A poll as the gathering page and the host's editor read it. */
export interface PollView {
  id: string;
  eventId: string;
  mode: PollMode;
  state: PollState;
  /** When a one-off vote closes, an ISO instant; null for a weekly vote. */
  closesAt: string | null;
  /** True when the host set the close time; false when it follows the earliest time. */
  closesAtSet: boolean;
  settleMinutes: number;
  freezeHours: number;
  showNames: boolean;
  lockedAt: string | null;
  options: PollOptionView[];
  voters: number;
  leadingLabel: string | null;
  appliedLabel: string | null;
  /** The viewer's own approvals, or null for a viewer who cannot vote. */
  mine: string[] | null;
  canVote: boolean;
  canManage: boolean;
  /** Whether names travelled in this answer. */
  namesShown: boolean;
}

/** What every served calendar item carries about its gathering's vote (shared/gatherings.ts). */
export interface TimePollSummary {
  state: PollState;
  mode: PollMode;
  /** When a one-off vote closes, an ISO instant; null for a weekly vote. */
  closesAt: string | null;
  /** The time ahead right now, in words. */
  leadingLabel: string | null;
  /** True while THIS evening's time can still change (`stillBeingVoted`). */
  stillVoting: boolean;
}
