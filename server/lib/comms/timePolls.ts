/**
 * THE LIVE TIME VOTE (the comms build spec 5.10; Rye, 2026-10-02).
 *
 * A host gives a gathering a vote on its time. People tick every time they can
 * make, and the time that is winning IS the gathering's time: on the calendar,
 * on the gathering's card, in the feed. The rules that decide which time that
 * is live in shared/comms/timePoll.ts; this file carries them out.
 *
 * ── EVERY MOVE IS AN ORDINARY EDIT ─────────────────────────────────────────
 *
 * The gathering moves through `updateGathering` (server/lib/gatherings.ts),
 * so seat fees, the queue and the comms sink see exactly what a host's edit
 * would show them. The edit carries `cause: "time_vote"`, so the event email
 * lane's "changed" email stays quiet for it: the vote sends its own words.
 * Each move also bumps the gathering's calendar SEQUENCE and asks the next
 * journey tick to re-plan the gathering's reminders.
 *
 * ── A WEEKLY SERIES MOVES EVENING BY EVENING, AND ITS RULE STAYS ───────────
 *
 * An evening of a series is keyed by the date its own rule gives it, and
 * every answer, seat fee, queue place, attendance mark and journey is written
 * against that key. Rewriting the rule's weekday would give every later
 * evening a NEW key, and everything written against the old keys would point
 * at evenings that no longer exist: a paid seat would sit in escrow for an
 * evening nobody can reach. So a vote moves each evening with a per-evening
 * override (the calendar's own `recurrence.overrides`, which the .ics feed
 * already writes out as RECURRENCE-ID events) and keys never change.
 * Evenings are kept on the vote's time for `WEEKLY_HORIZON_DAYS` ahead, and
 * the job carries that window forward as the days pass, for as long as the
 * series has its vote.
 *
 * ── ONE CLOCK, ONE WRITER AT A TIME ────────────────────────────────────────
 *
 * Every rule is measured on the database's clock, the one that stamps
 * `leader_since`. Reading the votes, recording the leader, moving the
 * gathering and locking happen under a named lock per poll, because two
 * votes landing together would otherwise each read a different tally and the
 * slower one would write a stale leader over the faster one.
 *
 * ── WHAT IT SENDS ───────────────────────────────────────────────────────────
 *
 *   poll.invite   to the people who said yes or maybe or wait in the queue,
 *                 with a one-click link per time; and, through the
 *                 notification spine (type `time_poll_open`), to the members
 *                 a host picks, so their own preferences apply.
 *   poll.locked   once per lock, with a calendar file, to everyone who voted
 *                 or answered.
 *   poll.moved    weekly only, once per move, to everyone who answered an
 *                 upcoming evening and everyone who voted. A one-off vote
 *                 sends nothing while it moves: everyone was told the time
 *                 would follow the vote.
 */
import crypto from "node:crypto";
import type { Pool } from "mysql2/promise";
import { contactIdOfGuestKey } from "../../../shared/comms/kinds";
import { gatheringWhen, type MergeValues } from "../../../shared/comms/mergeFields";
import {
  cleanOptions,
  finalOption,
  liveOptions,
  lockAt,
  optionLabel,
  overridesWithMoves,
  planWeeklyMoves,
  resolvePoll,
  slotOf,
  weeklyLabel,
  weeklyLabelIn,
  WEEKLY_HORIZON_DAYS,
  type OptionInput,
  type PollMode,
  type PollOption,
  type PollOptionView,
  type PollView,
  type WeeklySlot,
} from "../../../shared/comms/timePoll";
import type { Recurrence } from "../../../shared/gatherings";
import { civilParts, zonedTimeToUtc } from "../../../shared/lunar";
import { contactById } from "../../repos/commsContacts";
import { withNamedLock } from "../../repos/namedLock";
import {
  answeredKeys,
  approvalsOf,
  bumpIcsSequence,
  contactNames,
  databaseNowMs,
  deletePollRows,
  existingEventIds,
  insertOptions,
  insertPoll,
  lockPollRow,
  memberNames,
  pollById,
  pollForEvent,
  pollOptions,
  pollsForJob,
  pollVotes,
  recordApplied,
  recordLeader,
  removeOption,
  reopenPollRow,
  setPinned,
  updatePollSettings,
  voterKeys,
  writeApprovals,
  type PollRow,
} from "../../repos/timePolls";
import { expandOccurrences, getCalendarRow, type CalendarRow } from "../calendar";
import { updateGathering } from "../gatherings";
import { icsEscape, icsFold, icsUtc } from "../icsFeed";
import type { NotifyInput, NotifyResult } from "../notify";
import { numberVar } from "../variables";
import { villageTimezone } from "../villageReaders";
import type { ActionHandler, ActResult } from "./actions";
import { ensureContact } from "./contacts";
import { touch } from "./journeys";
import { signLink, type LinkPayload } from "./links";
import { post, type PostOfficeDeps } from "./postOffice";
import { loadEmailVillage, renderTemplate, type EmailVillage } from "./render";
import { toPollOption } from "./timePollSummary";

// ── What the vote is handed ─────────────────────────────────────────────────

export interface TimePollDeps {
  getPool(): Pool;
  postOffice: PostOfficeDeps;
  /** Members by id, for the vote's emails. */
  members: { byId(id: string): Promise<any | null> };
  /** The notification spine's producer, for inviting members. Absent: no member invitations. */
  notify?(input: NotifyInput): Promise<NotifyResult>;
  /** The village's IANA zone. Absent: the zone the readers are wired with. */
  timezone?(): string;
  /** A dial's value. Absent: the game variable. Tests pass their own. */
  dial?(key: "comms.time_poll_settle_minutes" | "comms.time_poll_freeze_hours"): number;
}

export type PollResult<T> = { ok: true; value: T } | { ok: false; status: number; error: string };

const DAY = 86_400_000;
const MINUTE = 60_000;

/** How long a one-click vote link in an email keeps working. A weekly vote stays open a long time. */
export const TIME_VOTE_LINK_DAYS = 120;

const zoneOf = (deps: TimePollDeps): string => (deps.timezone ? deps.timezone() : villageTimezone()) || "UTC";
const dialOf = (deps: TimePollDeps, key: "comms.time_poll_settle_minutes" | "comms.time_poll_freeze_hours"): number => {
  const v = deps.dial ? deps.dial(key) : numberVar(key);
  return Number.isFinite(v) ? v : 0;
};
const originOf = (deps: TimePollDeps): string => String(deps.postOffice.origin() ?? "").replace(/\/+$/, "");
const refuse = (status: number, error: string): { ok: false; status: number; error: string } => ({ ok: false, status, error });

const newPollId = (): string => `tp_${crypto.randomBytes(12).toString("hex")}`;
const newOptionId = (): string => `tpo_${crypto.randomBytes(12).toString("hex")}`;

/** The settle and freeze dials' bounds, the game variables' own (shared/gameVariables.ts). */
const SETTLE_MAX = 1440;
const FREEZE_MAX = 336;

/** A poll with its options as the pure rules read them. */
interface Loaded {
  poll: PollRow;
  options: PollOption[];
}

async function load(pool: Pool, poll: PollRow | null): Promise<Loaded | null> {
  if (!poll) return null;
  return { poll, options: (await pollOptions(pool, poll.id)).map(toPollOption) };
}

/** The one weekday a weekly series meets on, or null for a gathering a weekly vote cannot steer. */
function seriesWeekday(row: CalendarRow): number | null {
  const r = row.recurrence;
  return r && r.freq === "weekly" && r.byWeekday.length === 1 ? r.byWeekday[0] : null;
}

/** Why a gathering cannot take a vote of this mode, or null. */
function gatheringProblem(row: CalendarRow | null, mode: PollMode): { status: number; error: string } | null {
  if (!row || row.removedAt) return { status: 404, error: "No such gathering." };
  if (row.kind !== "gathering" && row.kind !== "festival") return { status: 409, error: "Only a gathering or a festival can vote on its time." };
  if (row.status === "cancelled") return { status: 409, error: "This gathering is cancelled." };
  if (mode === "once" && row.recurrence) return { status: 409, error: "This gathering repeats. Use a weekly vote for a series." };
  if (mode === "weekly" && seriesWeekday(row) === null) {
    return { status: 409, error: "A weekly vote needs a gathering that repeats every week on one day." };
  }
  return null;
}

// ── Making a poll ───────────────────────────────────────────────────────────

export interface CreatePollInput {
  eventId: string;
  mode: PollMode;
  options: OptionInput[];
  /** A one-off vote's own close, ISO. Absent or null: the freeze before its earliest time. */
  closesAt?: string | null;
  settleMinutes?: number | null;
  freezeHours?: number | null;
  showNames?: boolean;
  createdBy: string;
}

function boundedWhole(v: unknown, max: number): number | null | "bad" {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 && n <= max ? n : "bad";
}

/** A one-off vote's close, checked against its times: in the future, and before the earliest of them. */
function closeProblem(closesAtMs: number, options: readonly PollOption[], nowMs: number): string | null {
  if (closesAtMs <= nowMs) return "The vote has to close in the future.";
  const earliest = lockAt("once", null, options, 0);
  if (earliest !== null && closesAtMs > earliest) return "The vote has to close before the earliest time on offer.";
  return null;
}

/**
 * Give a gathering a vote on its time. The first time listed leads until
 * somebody votes, so the gathering moves to it at once when the settle time
 * is zero.
 */
export async function createPoll(deps: TimePollDeps, input: CreatePollInput): Promise<PollResult<PollView>> {
  const pool = deps.getPool();
  if (input.mode !== "once" && input.mode !== "weekly") return refuse(400, "Choose a one-off vote or a weekly vote.");
  const row = await getCalendarRow(pool, input.eventId);
  const problem = gatheringProblem(row, input.mode);
  if (problem) return refuse(problem.status, problem.error);
  const nowMs = await databaseNowMs(pool);
  const cleaned = cleanOptions(input.mode, Array.isArray(input.options) ? input.options : [], nowMs);
  if (!cleaned.ok) return refuse(400, cleaned.error);
  const settle = boundedWhole(input.settleMinutes, SETTLE_MAX);
  const freeze = boundedWhole(input.freezeHours, FREEZE_MAX);
  if (settle === "bad") return refuse(400, `The settle time is 0 to ${SETTLE_MAX} minutes.`);
  if (freeze === "bad") return refuse(400, `The freeze is 0 to ${FREEZE_MAX} hours.`);
  const options = cleaned.options.map((o, i) => ({
    id: newOptionId(),
    position: i,
    startsAt: o.startsAt ? new Date(o.startsAt) : null,
    weekday: o.weekday,
    startMinute: o.startMinute,
    durationMinutes: o.durationMinutes,
  }));
  let closesAt: number | null = null;
  if (input.mode === "once" && input.closesAt) {
    const ms = Date.parse(input.closesAt);
    if (!Number.isFinite(ms)) return refuse(400, "The close time is not a time.");
    const pure = options.map((o) => ({ ...o, startsAt: o.startsAt ? o.startsAt.toISOString() : null, removed: false }));
    const bad = closeProblem(ms, pure, nowMs);
    if (bad) return refuse(400, bad);
    closesAt = Math.floor(ms / 1000);
  }
  const id = newPollId();
  const written = await insertPoll(
    pool,
    {
      id,
      eventId: input.eventId,
      mode: input.mode,
      closesAt,
      settleMinutes: settle ?? Math.max(0, Math.trunc(dialOf(deps, "comms.time_poll_settle_minutes"))),
      freezeHours: freeze ?? Math.max(0, Math.trunc(dialOf(deps, "comms.time_poll_freeze_hours"))),
      showNames: input.showNames !== false,
      createdBy: input.createdBy,
    },
    options,
  );
  if (!written.ok) return refuse(409, "This gathering already has a vote on its time.");
  await settlePoll(deps, id);
  const view = await pollView(deps, input.eventId, { personKey: null, signedIn: true, canManage: true });
  return view ? { ok: true, value: view } : refuse(500, "The vote was made and could not be read back.");
}

// ── The host's controls ─────────────────────────────────────────────────────

async function pollOfEvent(deps: TimePollDeps, eventId: string): Promise<Loaded | null> {
  return load(deps.getPool(), await pollForEvent(deps.getPool(), eventId));
}

const noPoll = refuse(404, "This gathering has no vote on its time.");

/** Offer more times. */
export async function addPollOptions(deps: TimePollDeps, eventId: string, raw: OptionInput[]): Promise<PollResult<null>> {
  const pool = deps.getPool();
  const loaded = await pollOfEvent(deps, eventId);
  if (!loaded) return noPoll;
  const live = liveOptions(loaded.options);
  const cleaned = cleanOptions(loaded.poll.mode, Array.isArray(raw) ? raw : [], await databaseNowMs(pool), live);
  if (!cleaned.ok) return refuse(400, cleaned.error);
  const next = Math.max(-1, ...loaded.options.map((o) => o.position)) + 1;
  await insertOptions(
    pool,
    loaded.poll.id,
    cleaned.options.map((o, i) => ({
      id: newOptionId(),
      position: next + i,
      startsAt: o.startsAt ? new Date(o.startsAt) : null,
      weekday: o.weekday,
      startMinute: o.startMinute,
      durationMinutes: o.durationMinutes,
    })),
  );
  await settlePoll(deps, loaded.poll.id);
  return { ok: true, value: null };
}

/** Take a time off the vote. Its votes stay on record and count for nothing. Two times always remain. */
export async function removePollOption(deps: TimePollDeps, eventId: string, optionId: string): Promise<PollResult<null>> {
  const loaded = await pollOfEvent(deps, eventId);
  if (!loaded) return noPoll;
  const live = liveOptions(loaded.options);
  if (!live.some((o) => o.id === optionId)) return refuse(404, "That time is not on the vote.");
  if (live.length <= 2) return refuse(409, "A vote needs at least 2 times. Add one before removing this one.");
  await removeOption(deps.getPool(), loaded.poll.id, optionId);
  await settlePoll(deps, loaded.poll.id);
  return { ok: true, value: null };
}

/** Change the host's dials: the close time, the settle time, the freeze, and whether names show. */
export async function updatePoll(
  deps: TimePollDeps,
  eventId: string,
  input: { closesAt?: string | null; settleMinutes?: unknown; freezeHours?: unknown; showNames?: unknown },
): Promise<PollResult<null>> {
  const pool = deps.getPool();
  const loaded = await pollOfEvent(deps, eventId);
  if (!loaded) return noPoll;
  const change: { closesAt?: number | null; settleMinutes?: number; freezeHours?: number; showNames?: boolean } = {};
  if (input.settleMinutes !== undefined) {
    const s = boundedWhole(input.settleMinutes, SETTLE_MAX);
    if (s === "bad" || s === null) return refuse(400, `The settle time is 0 to ${SETTLE_MAX} minutes.`);
    change.settleMinutes = s;
  }
  if (input.freezeHours !== undefined) {
    const f = boundedWhole(input.freezeHours, FREEZE_MAX);
    if (f === "bad" || f === null) return refuse(400, `The freeze is 0 to ${FREEZE_MAX} hours.`);
    change.freezeHours = f;
  }
  if (input.showNames !== undefined) {
    if (typeof input.showNames !== "boolean") return refuse(400, "Say whether names show with true or false.");
    change.showNames = input.showNames;
  }
  if (input.closesAt !== undefined) {
    if (loaded.poll.mode !== "once") return refuse(400, "A weekly vote stays open, so it has no close time.");
    if (input.closesAt === null || input.closesAt === "") change.closesAt = null;
    else {
      const ms = Date.parse(String(input.closesAt));
      if (!Number.isFinite(ms)) return refuse(400, "The close time is not a time.");
      const bad = closeProblem(ms, loaded.options, await databaseNowMs(pool));
      if (bad) return refuse(400, bad);
      change.closesAt = Math.floor(ms / 1000);
    }
  }
  await updatePollSettings(pool, loaded.poll.id, change);
  await settlePoll(deps, loaded.poll.id);
  return { ok: true, value: null };
}

/** Pin a time, which beats the vote, or clear the pin with null. The gathering moves at once. */
export async function pinPollOption(deps: TimePollDeps, eventId: string, optionId: string | null): Promise<PollResult<null>> {
  const loaded = await pollOfEvent(deps, eventId);
  if (!loaded) return noPoll;
  if (optionId !== null && !liveOptions(loaded.options).some((o) => o.id === optionId)) return refuse(404, "That time is not on the vote.");
  await setPinned(deps.getPool(), loaded.poll.id, optionId);
  await settlePoll(deps, loaded.poll.id);
  return { ok: true, value: null };
}

/** End the vote now: the pin, else the leader, becomes the time, and "the time is set" goes out once. */
export async function lockNow(deps: TimePollDeps, eventId: string): Promise<PollResult<null>> {
  const loaded = await pollOfEvent(deps, eventId);
  if (!loaded) return noPoll;
  if (loaded.poll.state !== "open") return refuse(409, "The vote is already locked.");
  await settlePoll(deps, loaded.poll.id, { lock: true });
  return { ok: true, value: null };
}

/**
 * Open a locked vote again. A one-off vote whose close time has passed needs a
 * new one, or it would lock again within the minute.
 */
export async function reopenPoll(deps: TimePollDeps, eventId: string, closesAtIso?: string | null): Promise<PollResult<null>> {
  const pool = deps.getPool();
  const loaded = await pollOfEvent(deps, eventId);
  if (!loaded) return noPoll;
  if (loaded.poll.state !== "locked") return refuse(409, "The vote is already open.");
  const nowMs = await databaseNowMs(pool);
  let closesAt: number | null | undefined;
  if (loaded.poll.mode === "once") {
    if (closesAtIso) {
      const ms = Date.parse(closesAtIso);
      if (!Number.isFinite(ms)) return refuse(400, "The close time is not a time.");
      const bad = closeProblem(ms, loaded.options, nowMs);
      if (bad) return refuse(400, bad);
      closesAt = Math.floor(ms / 1000);
    } else {
      const lock = lockAt("once", null, loaded.options, loaded.poll.freezeHours);
      if (lock === null || lock <= nowMs) {
        return refuse(409, "The earliest time is inside the freeze, so the vote would close at once. Give it a later close time.");
      }
      closesAt = null;
    }
  }
  await reopenPollRow(pool, loaded.poll.id, closesAt);
  await settlePoll(deps, loaded.poll.id);
  return { ok: true, value: null };
}

/**
 * Remove the vote. The gathering keeps the time it has now, and the votes go
 * with it. A weekly series keeps the vote's time on the evenings already
 * planned (`WEEKLY_HORIZON_DAYS` ahead); later evenings follow the series' own
 * day and time, which the host edits in the gathering editor.
 */
export async function closePoll(deps: TimePollDeps, eventId: string): Promise<PollResult<null>> {
  const pool = deps.getPool();
  const poll = await pollForEvent(pool, eventId);
  if (!poll) return noPoll;
  await withPollLock(pool, poll.id, () => deletePollRows(pool, poll.id));
  return { ok: true, value: null };
}

// ── Voting ──────────────────────────────────────────────────────────────────

export type VoteChange = { set: string[] } | { add: string } | { remove: string };

/**
 * Change one person's approvals, then let the gathering follow the vote at
 * once. A member is their user id; a guest is `guest:<contactId>`.
 */
export async function vote(deps: TimePollDeps, pollId: string, personKey: string, change: VoteChange): Promise<PollResult<string[]>> {
  if (!personKey || personKey.length > 100) return refuse(400, "That vote has nobody behind it.");
  const written = await writeApprovals(deps.getPool(), pollId, personKey, change);
  if (!written.ok) {
    if (written.reason === "not_found") return noPoll;
    if (written.reason === "closed") return refuse(409, "Voting has closed. The time is set.");
    return refuse(400, "That time is not on the vote.");
  }
  await settlePoll(deps, pollId);
  return { ok: true, value: written.approvals };
}

// ── The settle: votes in, the gathering moves ───────────────────────────────

/**
 * Run `fn` holding the poll's named lock, waiting up to about five seconds
 * for a caller already inside. Null when the lock never came free: the job
 * picks the poll up within the minute.
 */
async function withPollLock<T>(pool: Pool, pollId: string, fn: () => Promise<T>): Promise<T | null> {
  for (let attempt = 0; attempt < 35; attempt++) {
    const run = await withNamedLock(pool, `time-poll:${pollId}`, fn);
    if (run.ran) return run.value;
    await new Promise((r) => setTimeout(r, 150));
  }
  console.warn(`[comms] the time vote ${pollId} was busy, so this change waits for the next run`);
  return null;
}

export interface SettleSummary {
  moved: boolean;
  locked: boolean;
  /** Evenings of a weekly series moved by this run, housekeeping included. */
  evenings: number;
  notified: number;
}

const NOTHING: SettleSummary = { moved: false, locked: false, evenings: 0, notified: 0 };

/**
 * Read the vote, record the leader, move the gathering when the applied time
 * changed, keep a weekly series on its time as the days pass, and lock a
 * one-off vote whose time has come (or when `lock` asks). Idempotent: run
 * twice, it moves and sends nothing the second time.
 */
export async function settlePoll(deps: TimePollDeps, pollId: string, opts: { lock?: boolean } = {}): Promise<SettleSummary> {
  const pool = deps.getPool();
  const done = await withPollLock(pool, pollId, async (): Promise<SettleSummary> => {
    const loaded = await load(pool, await pollById(pool, pollId));
    if (!loaded) return NOTHING;
    const { poll, options } = loaded;
    const row = await getCalendarRow(pool, poll.eventId);
    // A gathering that is gone, cancelled or taken off the calendar does not move.
    if (!row || row.removedAt || row.status === "cancelled") return NOTHING;
    const nowMs = await databaseNowMs(pool);
    const votes = await pollVotes(pool, poll.id);
    const r = resolvePoll(
      {
        mode: poll.mode,
        state: poll.state,
        closesAtMs: poll.closesAt == null ? null : poll.closesAt * 1000,
        settleMinutes: poll.settleMinutes,
        freezeHours: poll.freezeHours,
        pinnedId: poll.pinnedOptionId,
        leaderId: poll.leaderOptionId,
        leaderSinceMs: poll.leaderSince == null ? null : poll.leaderSince * 1000,
        appliedId: poll.appliedOptionId,
      },
      options,
      votes,
      nowMs,
    );
    if (r.leaderChanged) {
      await recordLeader(pool, poll.id, r.leaderId, r.leaderSinceMs == null ? null : Math.floor(r.leaderSinceMs / 1000));
    }
    const summary: SettleSummary = { ...NOTHING };
    const tz = zoneOf(deps);
    const lockingNow = poll.state === "open" && (opts.lock === true || r.dueToLock);
    // At the lock the vote is in: the pin, else whatever leads, whatever the settle time.
    const target = lockingNow ? finalOption(poll.pinnedOptionId, r.leaderId, options) ?? r.appliedId : r.appliedId;
    const option = target ? options.find((o) => o.id === target) ?? null : null;
    if (option && !option.removed) {
      const moved = await moveTo(deps, poll, row, option, options, nowMs, tz, target !== poll.appliedOptionId && poll.state === "open");
      summary.moved = moved.moved;
      summary.evenings = moved.evenings;
      summary.notified += moved.notified;
      if (target !== poll.appliedOptionId) await recordApplied(pool, poll.id, target);
    }
    if (lockingNow && (await lockPollRow(pool, poll.id))) {
      summary.locked = true;
      // The journey condition `time_still_being_voted` turns false here, so
      // the confirmation and reminders that waited are planned on the next
      // tick, whether or not the lock moved the gathering.
      await touch({ getPool: deps.getPool }, `event:${poll.eventId}`);
      summary.notified += await sendLocked(deps, poll.id);
    }
    return summary;
  });
  return done ?? NOTHING;
}

/**
 * Put the gathering on `option`. A one-off gathering gets the option's start
 * and end. A weekly series gets each evening beyond the freeze moved onto the
 * option's slot (see the header). Writes nothing when the gathering is
 * already there, so the job can call this every minute.
 *
 * `announce` is true when the vote's time changed (not housekeeping): a weekly
 * move then sends "new time" to the people it affects.
 */
async function moveTo(
  deps: TimePollDeps,
  poll: PollRow,
  row: CalendarRow,
  option: PollOption,
  options: readonly PollOption[],
  nowMs: number,
  tz: string,
  announce: boolean,
): Promise<{ moved: boolean; evenings: number; notified: number }> {
  const pool = deps.getPool();
  if (poll.mode === "once") {
    if (!option.startsAt) return { moved: false, evenings: 0, notified: 0 };
    const start = new Date(option.startsAt);
    const end = new Date(start.getTime() + option.durationMinutes * MINUTE);
    if (row.startsAt.getTime() === start.getTime() && (row.endsAt?.getTime() ?? null) === end.getTime()) {
      return { moved: false, evenings: 0, notified: 0 };
    }
    await updateGathering(pool, poll.eventId, { startsAt: start.toISOString(), endsAt: end.toISOString() }, { cause: "time_vote" });
    await afterMove(deps, poll.eventId);
    return { moved: true, evenings: 1, notified: 0 };
  }
  const slot = slotOf(option);
  if (!slot || !row.recurrence || row.recurrence.freq !== "weekly") return { moved: false, evenings: 0, notified: 0 };
  const plan = planSeries(row, options, slot, nowMs, tz, poll.freezeHours);
  if (!plan.moves.length) return { moved: false, evenings: 0, notified: 0 };
  const recurrence = { ...row.recurrence, overrides: overridesWithMoves(row.recurrence.overrides, plan.moves, plan.ruleOf) } as Recurrence;
  await updateGathering(pool, poll.eventId, { recurrence }, { cause: "time_vote" });
  const sequence = await afterMove(deps, poll.eventId);
  const notified = announce ? await sendMoved(deps, poll, row, slot, plan.upcomingKeys, plan.moves[0].to, sequence) : 0;
  return { moved: true, evenings: plan.moves.length, notified };
}

/** What every move does after the write: a new calendar SEQUENCE, and reminders re-planned on the next tick. */
async function afterMove(deps: TimePollDeps, eventId: string): Promise<number> {
  const pool = deps.getPool();
  const sequence = await bumpIcsSequence(pool, eventId);
  await touch({ getPool: deps.getPool }, `event:${eventId}`);
  return sequence;
}

/** A weekly series' evenings for the planner, where its rule puts each, and which keys are still ahead. */
function planSeries(row: CalendarRow, options: readonly PollOption[], target: WeeklySlot, nowMs: number, tz: string, freezeHours: number) {
  const base = civilParts(row.startsAt, tz);
  const durationMs = row.endsAt ? row.endsAt.getTime() - row.startsAt.getTime() : null;
  const ruleOf = (key: string) => {
    const [y, m, d] = key.split("-").map(Number);
    const startsAt = zonedTimeToUtc(y, m, d, base.hour, base.minute, tz);
    return { startsAt, endsAt: durationMs === null ? null : new Date(startsAt.getTime() + durationMs) };
  };
  // A week back, so an evening whose rule date has passed but which the vote
  // moved later in its week is still seen.
  const evenings = expandOccurrences(row, new Date(nowMs - 7 * DAY), new Date(nowMs + WEEKLY_HORIZON_DAYS * DAY), tz);
  const occurrences = evenings.map((o) => ({ key: o.occurrenceKey, startsAt: o.startsAt, ruleStartsAt: ruleOf(o.occurrenceKey).startsAt, cancelled: o.cancelled }));
  const known = options.map(slotOf).filter((s): s is WeeklySlot => s !== null);
  const moves = planWeeklyMoves({ occurrences, target, known, nowMs, freezeHours, timeZone: tz });
  const upcomingKeys = evenings.filter((o) => o.startsAt.getTime() > nowMs && !o.cancelled).map((o) => o.occurrenceKey);
  return { moves, ruleOf, upcomingKeys };
}

// ── The job ─────────────────────────────────────────────────────────────────

export const TIME_POLLS_JOB = "comms-time-polls";
export const TIME_POLLS_EVERY_MS = 60_000;

export interface TimePollJobSummary {
  [key: string]: number;
  locked: number;
  applied: number;
  evenings: number;
  notified: number;
  cleared: number;
}

/**
 * Lock the one-off votes whose time has come, move gatherings onto leaders
 * that have settled, keep weekly series on their time as the days pass, and
 * clear the votes of gatherings that were deleted. "Run now" drives it in the
 * e2e suites, which run with the scheduler off.
 */
export async function runTimePollJob(deps: TimePollDeps, opts: { limit?: number } = {}): Promise<TimePollJobSummary> {
  const pool = deps.getPool();
  const out: TimePollJobSummary = { locked: 0, applied: 0, evenings: 0, notified: 0, cleared: 0 };
  const polls = await pollsForJob(pool, opts.limit ?? 200);
  const existing = await existingEventIds(pool, polls.map((p) => p.eventId));
  for (const poll of polls) {
    try {
      if (!existing.has(poll.eventId)) {
        await deletePollRows(pool, poll.id);
        out.cleared += 1;
        continue;
      }
      const s = await settlePoll(deps, poll.id);
      if (s.locked) out.locked += 1;
      if (s.moved) out.applied += 1;
      out.evenings += s.evenings;
      out.notified += s.notified;
    } catch (err) {
      // One vote's fault never stops the others.
      console.error(`[comms] the time vote ${poll.id} could not be settled`, err);
    }
  }
  return out;
}

// ── What the gathering page and the editor read ─────────────────────────────

/** "Sam", from "Sam Rivera"; "Someone" when there is no name. */
const firstNameOf = (name: string | null | undefined): string => String(name ?? "").trim().split(/\s+/)[0] || "Someone";

export interface PollViewer {
  /** The person's key when they may vote: a member's user id, or a guest's key from their link. */
  personKey: string | null;
  signedIn: boolean;
  /** Holds `event.manage`: sees names whatever the setting. */
  canManage: boolean;
}

/**
 * The vote as a page shows it. Counts for everyone who can see the gathering;
 * first names only to a signed-in viewer while the host shows names, and
 * always to the host. Names are left out of the answer, never hidden by the
 * page, so a public reader's response carries no person at all.
 */
export async function pollView(deps: TimePollDeps, eventId: string, viewer: PollViewer): Promise<PollView | null> {
  const pool = deps.getPool();
  const loaded = await pollOfEvent(deps, eventId);
  if (!loaded) return null;
  const { poll, options } = loaded;
  const tz = zoneOf(deps);
  const votes = await pollVotes(pool, poll.id);
  const live = liveOptions(options);
  const liveIds = new Set(live.map((o) => o.id));
  const counts = new Map<string, number>();
  const voters = new Set<string>();
  for (const v of votes) {
    if (!liveIds.has(v.optionId)) continue;
    counts.set(v.optionId, (counts.get(v.optionId) ?? 0) + 1);
    voters.add(v.personKey);
  }
  const namesShown = viewer.canManage || (viewer.signedIn && poll.showNames);
  let nameOf: (key: string) => string = () => "";
  if (namesShown) {
    const keys = Array.from(voters);
    const guests = keys.map((k) => contactIdOfGuestKey(k)).filter((c): c is string => c !== null);
    const members = keys.filter((k) => contactIdOfGuestKey(k) === null);
    const [m, g] = await Promise.all([memberNames(pool, members), contactNames(pool, guests)]);
    nameOf = (key) => {
      const contact = contactIdOfGuestKey(key);
      return contact ? `${firstNameOf(g.get(contact))} (guest)` : firstNameOf(m.get(key));
    };
  }
  const lock = lockAt(poll.mode, poll.closesAt == null ? null : poll.closesAt * 1000, options, poll.freezeHours);
  const leader = live.find((o) => o.id === poll.leaderOptionId) ?? null;
  const applied = options.find((o) => o.id === poll.appliedOptionId) ?? null;
  const views: PollOptionView[] = live.map((o) => ({
    id: o.id,
    label: optionLabel(o, tz),
    startsAt: o.startsAt,
    weekday: o.weekday,
    startMinute: o.startMinute,
    durationMinutes: o.durationMinutes,
    count: counts.get(o.id) ?? 0,
    ...(namesShown ? { names: votes.filter((v) => v.optionId === o.id).map((v) => nameOf(v.personKey)) } : {}),
    leading: o.id === poll.leaderOptionId,
    applied: o.id === poll.appliedOptionId,
    pinned: o.id === poll.pinnedOptionId,
  }));
  const mine = viewer.personKey ? await approvalsOf(pool, poll.id, viewer.personKey) : null;
  return {
    id: poll.id,
    eventId: poll.eventId,
    mode: poll.mode,
    state: poll.state,
    closesAt: lock == null ? null : new Date(lock).toISOString(),
    closesAtSet: poll.closesAt != null,
    settleMinutes: poll.settleMinutes,
    freezeHours: poll.freezeHours,
    showNames: poll.showNames,
    lockedAt: poll.lockedAt == null ? null : new Date(poll.lockedAt * 1000).toISOString(),
    options: views,
    voters: voters.size,
    leadingLabel: leader ? optionLabel(leader, tz) : null,
    appliedLabel: applied ? optionLabel(applied, tz) : null,
    mine,
    canVote: poll.state === "open" && viewer.personKey !== null,
    canManage: viewer.canManage,
    namesShown,
  };
}

// ── The emails ──────────────────────────────────────────────────────────────

interface Recipient {
  personKey: string;
  email: string;
  name: string | null;
  userId: string | null;
  contactId: string;
  timezone: string | null;
}

/** Who a person key reaches by email: a guest's contact, or a member's account. Null when nobody can be written to. */
async function recipientFor(deps: TimePollDeps, personKey: string): Promise<Recipient | null> {
  const pool = deps.getPool();
  const guest = contactIdOfGuestKey(personKey);
  if (guest) {
    const c = await contactById(pool, guest);
    return c ? { personKey, email: c.email, name: c.name, userId: null, contactId: c.id, timezone: c.timezone } : null;
  }
  const m = await deps.members.byId(personKey);
  if (!m || m.isExample || typeof m.email !== "string" || !m.email.trim()) return null;
  const contact = await ensureContact({ getPool: deps.getPool }, { email: m.email, name: m.name ?? null, userId: m.id, source: "account" });
  if (!contact) return null;
  const row = await contactById(pool, contact.id);
  return { personKey, email: m.email, name: m.name ?? null, userId: String(m.id), contactId: contact.id, timezone: row?.timezone ?? null };
}

/** The one-click link for one person and one time. Ids only: the poll, the time, the person and their contact. */
export function timeVoteLink(origin: string, pollId: string, optionId: string, personKey: string, contactId: string | null): string {
  const payload: LinkPayload = { p: pollId, o: optionId, k: personKey };
  if (contactId) payload.c = contactId;
  return `${origin}/email/a?t=${encodeURIComponent(signLink("time_vote", payload, TIME_VOTE_LINK_DAYS))}`;
}

/**
 * The gathering's facts every vote email carries. A weekly series says its
 * slot ("Tuesdays at 6:00 PM"); a one-off says its day and time, in village
 * time and in the reader's own zone when it differs.
 */
function gatheringVars(deps: TimePollDeps, row: CalendarRow, r: Recipient, when: { start: Date; weekly: WeeklySlot | null }): MergeValues {
  const tz = zoneOf(deps);
  const origin = originOf(deps);
  let phrase: { when: string; whenLocal: string };
  if (when.weekly) {
    const village = weeklyLabel(when.weekly);
    const local = r.timezone && r.timezone !== tz ? weeklyLabelIn(when.start, r.timezone) : "";
    phrase = { when: village, whenLocal: local && local !== village ? local : "" };
  } else {
    phrase = gatheringWhen(when.start, tz, r.timezone);
  }
  return {
    "person.firstName": r.name ? firstNameOf(r.name) : null,
    "person.name": r.name,
    "gathering.title": row.title,
    "gathering.when": phrase.when,
    "gathering.whenLocal": phrase.whenLocal,
    "gathering.where": row.locationText,
    "gathering.url": origin ? `${origin}/events` : null,
  };
}

/** Render one vote email for one person and hand it to the post office. True when it was taken. */
async function sendOne(
  deps: TimePollDeps,
  village: EmailVillage,
  /**
   * `messageKey` is the email's idempotency key in the post office's ledger.
   * Named apart from `idempotencyKey` on purpose: the economics doc's reader
   * takes every `idempotencyKey` property that is not on an email object as a
   * ledger posting, and this object is not an email yet.
   */
  input: { templateKey: "poll.invite" | "poll.locked" | "poll.moved"; recipient: Recipient; vars: MergeValues; messageKey: string; ics?: string | null },
): Promise<boolean> {
  try {
    const email = await renderTemplate(input.templateKey, input.vars, { getPool: deps.getPool, village, contactId: input.recipient.contactId, kind: "events" });
    const result = await post(deps.postOffice, {
      idempotencyKey: input.messageKey,
      kind: "events",
      origin: input.templateKey,
      to: { email: input.recipient.email, name: input.recipient.name, userId: input.recipient.userId, contactId: input.recipient.contactId },
      subject: email.subject,
      html: email.html,
      text: email.text,
      preheader: email.preheader,
      attachments: input.ics
        ? [{ filename: "gathering.ics", contentType: "text/calendar; charset=utf-8; method=REQUEST", contentBase64: Buffer.from(input.ics, "utf8").toString("base64") }]
        : undefined,
      source: { templateKey: input.templateKey, templateVersion: email.version ?? undefined },
    });
    return result.status !== "skipped" && result.status !== "failed" && result.status !== "duplicate";
  } catch (err) {
    console.error(`[comms] a ${input.templateKey} email could not be posted`, err);
    return false;
  }
}

/**
 * One calendar entry for one evening, METHOD:REQUEST, with the UID the event
 * email lane uses (`<eventId>-<occurrenceKey>@<host>`) so a calendar app that
 * already holds the gathering updates it in place, and the gathering's own
 * SEQUENCE so the update wins. Built with the feed's own RFC 5545 helpers.
 */
export function buildEveningIcs(input: {
  eventId: string;
  occurrenceKey: string;
  host: string;
  start: Date;
  end: Date | null;
  title: string;
  location: string | null;
  url: string | null;
  sequence: number;
  now: Date;
}): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//village calendar//time vote//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:REQUEST",
    "BEGIN:VEVENT",
    `UID:${input.eventId}-${input.occurrenceKey}@${input.host}`,
    `DTSTAMP:${icsUtc(input.now)}`,
    `SEQUENCE:${Math.max(0, Math.trunc(input.sequence))}`,
    `DTSTART:${icsUtc(input.start)}`,
    ...(input.end ? [`DTEND:${icsUtc(input.end)}`] : []),
    `SUMMARY:${icsEscape(input.title)}`,
    ...(input.location ? [`LOCATION:${icsEscape(input.location)}`] : []),
    ...(input.url && /^https?:\/\/[^\s]+$/.test(input.url) ? [`URL:${input.url}`] : []),
    "STATUS:CONFIRMED",
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.map(icsFold).join("\r\n") + "\r\n";
}

const hostOf = (origin: string): string => {
  try {
    return new URL(origin).host || "village.local";
  } catch {
    return "village.local";
  }
};

/** People to tell, deduplicated, in a stable order. */
const everyone = (...lists: string[][]): string[] => Array.from(new Set(lists.flat())).sort();

/** "The time is set", once per lock, to everyone who voted or answered. */
async function sendLocked(deps: TimePollDeps, pollId: string): Promise<number> {
  const pool = deps.getPool();
  const loaded = await load(pool, await pollById(pool, pollId));
  const row = loaded ? await getCalendarRow(pool, loaded.poll.eventId) : null;
  if (!loaded || !row) return 0;
  const { poll, options } = loaded;
  const tz = zoneOf(deps);
  const nowMs = await databaseNowMs(pool);
  const applied = options.find((o) => o.id === poll.appliedOptionId) ?? null;
  const slot = applied ? slotOf(applied) : null;
  // The evening the calendar file names: the one-off itself, or the next evening of the series.
  let occurrenceKey = "";
  let start = row.startsAt;
  let end = row.endsAt;
  let upcoming: string[] | null = null;
  if (poll.mode === "weekly") {
    const evenings = expandOccurrences(row, new Date(nowMs), new Date(nowMs + WEEKLY_HORIZON_DAYS * DAY), tz).filter((o) => !o.cancelled);
    if (!evenings.length) return 0;
    occurrenceKey = evenings[0].occurrenceKey;
    start = evenings[0].startsAt;
    end = evenings[0].endsAt;
    upcoming = evenings.map((o) => o.occurrenceKey);
  }
  const people = everyone(await voterKeys(pool, poll.id), await answeredKeys(pool, poll.eventId, upcoming));
  if (!people.length) return 0;
  const origin = originOf(deps);
  const village = await loadEmailVillage(pool, origin);
  const ics = buildEveningIcs({
    eventId: poll.eventId,
    occurrenceKey,
    host: hostOf(origin),
    start,
    end,
    title: row.title,
    location: row.locationText,
    url: origin ? `${origin}/events` : null,
    sequence: await bumpIcsSequence(pool, poll.eventId),
    now: new Date(nowMs),
  });
  let sent = 0;
  for (const key of people) {
    const r = await recipientFor(deps, key);
    if (!r) continue;
    const vars = gatheringVars(deps, row, r, { start, weekly: slot });
    if (await sendOne(deps, village, { templateKey: "poll.locked", recipient: r, vars, messageKey: `poll:${poll.id}:locked:${poll.lockedAt ?? nowMs}:${key}`, ics })) sent += 1;
  }
  return sent;
}

/** "New time", once per weekly move, to everyone who answered an upcoming evening and everyone who voted. */
async function sendMoved(
  deps: TimePollDeps,
  poll: PollRow,
  row: CalendarRow,
  slot: WeeklySlot,
  upcomingKeys: string[],
  firstMoved: Date,
  sequence: number,
): Promise<number> {
  const pool = deps.getPool();
  const people = everyone(await voterKeys(pool, poll.id), await answeredKeys(pool, poll.eventId, upcomingKeys));
  if (!people.length) return 0;
  const village = await loadEmailVillage(pool, originOf(deps));
  let sent = 0;
  for (const key of people) {
    const r = await recipientFor(deps, key);
    if (!r) continue;
    const vars = gatheringVars(deps, row, r, { start: firstMoved, weekly: slot });
    if (await sendOne(deps, village, { templateKey: "poll.moved", recipient: r, vars, messageKey: `poll:${poll.id}:moved:${sequence}:${key}` })) sent += 1;
  }
  return sent;
}

export interface InviteInput {
  /** Email everyone who said yes or maybe, or waits in the queue. */
  answered: boolean;
  /** Members to notify through the spine: their user ids. */
  members: string[];
}

/**
 * Ask people to vote. The people who answered get `poll.invite` with a
 * one-click link per time; members the host picks get a `time_poll_open`
 * notification, which emails them or not by their own preferences. Each
 * person is asked once per vote, however often the host presses.
 */
export async function invite(deps: TimePollDeps, eventId: string, input: InviteInput): Promise<PollResult<{ emailed: number; notified: number }>> {
  const pool = deps.getPool();
  const loaded = await pollOfEvent(deps, eventId);
  if (!loaded) return noPoll;
  const { poll, options } = loaded;
  if (poll.state !== "open") return refuse(409, "The vote is locked. Reopen it to invite people.");
  const row = await getCalendarRow(pool, eventId);
  if (!row) return refuse(404, "No such gathering.");
  const tz = zoneOf(deps);
  const origin = originOf(deps);
  const live = liveOptions(options);
  const lock = lockAt(poll.mode, poll.closesAt == null ? null : poll.closesAt * 1000, options, poll.freezeHours);
  const leader = live.find((o) => o.id === poll.leaderOptionId) ?? null;
  let emailed = 0;
  if (input.answered) {
    const nowMs = await databaseNowMs(pool);
    const upcoming =
      poll.mode === "weekly"
        ? expandOccurrences(row, new Date(nowMs), new Date(nowMs + WEEKLY_HORIZON_DAYS * DAY), tz).map((o) => o.occurrenceKey)
        : null;
    const village = await loadEmailVillage(pool, origin);
    for (const key of await answeredKeys(pool, eventId, upcoming)) {
      const r = await recipientFor(deps, key);
      if (!r) continue;
      const vars: MergeValues = {
        ...gatheringVars(deps, row, r, { start: row.startsAt, weekly: null }),
        "poll.options": { links: live.map((o) => ({ label: optionLabel(o, tz), href: timeVoteLink(origin, poll.id, o.id, key, r.contactId) })) },
        "poll.closesAt": lock == null ? null : gatheringWhen(new Date(lock), tz, r.timezone).when,
        "poll.leading": leader ? optionLabel(leader, tz) : null,
      };
      if (await sendOne(deps, village, { templateKey: "poll.invite", recipient: r, vars, messageKey: `poll:${poll.id}:invite:${key}` })) emailed += 1;
    }
  }
  let notified = 0;
  if (deps.notify) {
    for (const userId of Array.from(new Set(input.members))) {
      const m = await deps.members.byId(userId);
      if (!m || m.isExample) continue;
      const result = await deps.notify({
        userId,
        type: "time_poll_open",
        title: `Pick a time for ${row.title}`.slice(0, 200),
        body: leader ? `Leading now: ${optionLabel(leader, tz)}.` : null,
        link: "/events",
        dedupeKey: `time_poll_open:${poll.id}:${userId}`,
      });
      if (result.fresh) notified += 1;
    }
  }
  return { ok: true, value: { emailed, notified } };
}

// ── The one-click answer from an email ──────────────────────────────────────

const pollIdOf = (p: LinkPayload): string | null => (typeof p.p === "string" && p.p ? p.p : null);
const personOf = (p: LinkPayload): string | null => (typeof p.k === "string" && p.k ? p.k : null);

/**
 * `time_vote`: the link a vote email carries for one time. The page shows the
 * live tally, the person's own picks, and a button per time to pick it or
 * take it back. Nothing happens until a press (5.4): mail scanners open every
 * link in an email.
 */
export function timeVoteAction(deps: TimePollDeps): ActionHandler {
  async function describe(payload: LinkPayload) {
    const pollId = pollIdOf(payload);
    const personKey = personOf(payload);
    const poll = pollId ? await pollById(deps.getPool(), pollId) : null;
    if (!poll || !personKey) return null;
    const row = await getCalendarRow(deps.getPool(), poll.eventId);
    const view = await pollView(deps, poll.eventId, { personKey, signedIn: false, canManage: false });
    if (!view || !row) return null;
    const mine = new Set(view.mine ?? []);
    const lines = view.options.map((o) => `${o.label}: ${o.count} can come${o.leading ? ", leading" : ""}.`);
    if (view.state !== "open") {
      return {
        purpose: "time_vote" as const,
        title: `${row.title} is set`,
        paragraphs: [view.appliedLabel ? `${view.appliedLabel}.` : "The time is set.", ...lines],
        choices: [],
        current: null,
        input: null,
      };
    }
    const linked = typeof payload.o === "string" ? payload.o : null;
    const ordered = [...view.options].sort((a, b) => (a.id === linked ? -1 : b.id === linked ? 1 : 0));
    return {
      purpose: "time_vote" as const,
      title: `Pick the times you can make`,
      paragraphs: [
        `${row.title}. The time with the most picks becomes the gathering's time.`,
        ...lines,
        mine.size ? `Your picks: ${view.options.filter((o) => mine.has(o.id)).map((o) => o.label).join("; ")}.` : "No picks from you yet.",
      ],
      choices: ordered.map((o) =>
        mine.has(o.id)
          ? { value: `no:${o.id}`, label: `Take back ${o.label}` }
          : { value: `yes:${o.id}`, label: `I can make ${o.label}`, primary: o.id === linked },
      ),
      current: null,
      input: null,
    };
  }

  return {
    purpose: "time_vote",
    describe: (payload) => describe(payload),
    async act(payload, body): Promise<ActResult> {
      const pollId = pollIdOf(payload);
      const personKey = personOf(payload);
      if (!pollId || !personKey) return { ok: false, status: 404, error: "This vote is gone." };
      const m = typeof body.choice === "string" ? body.choice.match(/^(yes|no):([A-Za-z0-9_]{1,64})$/) : null;
      if (!m) return { ok: false, status: 400, error: "Pick a time." };
      const result = await vote(deps, pollId, personKey, m[1] === "yes" ? { add: m[2] } : { remove: m[2] });
      if (!result.ok) return { ok: false, status: result.status, error: result.error };
      return {
        ok: true,
        outcome: { ok: true, title: "Vote saved", paragraphs: [], description: await describe(payload) },
      };
    },
  };
}
