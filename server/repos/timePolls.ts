/**
 * The readers and writers for a gathering's time vote (drizzle/0245):
 * `event_time_polls`, `event_time_poll_options` and `event_time_poll_votes`,
 * plus the reads its emails need from the gathering's own answers and queue,
 * the names a tally may show, and the one counter it bumps in `event_comms`.
 * One family: everything here is about one vote on one gathering's time.
 *
 * ONE POLL PER GATHERING, held by `event_time_polls_event`. A second poll on
 * the same gathering is refused by the key, never by a read-then-insert.
 *
 * ONE APPROVAL PER PERSON PER TIME, held by the votes table's primary key
 * (`poll_id`, `option_id`, `person_key`). Writes use INSERT IGNORE, so a
 * guest who presses "I can make this one" twice holds one approval.
 *
 * A VOTE IS ONE TRANSACTION under the poll row's lock (`SELECT ... FOR
 * UPDATE`), the smallest lock that makes "the poll is open" true at the
 * moment the votes land: a lock and a vote racing each other cannot leave a
 * vote written into a poll that had already closed.
 *
 * NO PERSON JOINS. Names are read with a second query by id (`users`,
 * `comms_contacts`), never by joining across the tables. The tables were
 * made in different eras, some with a pinned character set and some without,
 * and a join across that boundary throws on a database whose default
 * collation differs (the collation alignment in server/db/collation.ts says
 * more). Two small reads cannot.
 *
 * INSTANTS LEAVE AS EPOCH SECONDS through `UNIX_TIMESTAMP(col)` and arrive
 * through `FROM_UNIXTIME(?)`, the round trip the session zone cannot skew
 * (the comms build spec section 1, rule 7). The one exception is an option's
 * `starts_at`, a DATETIME in the calendar's convention, which goes in and
 * out as a JavaScript Date exactly as `events.starts_at` does in
 * server/lib/gatherings.ts.
 *
 * `event_comms` BELONGS TO THE EVENT EMAIL LANE. The one statement here that
 * touches it bumps `ics_sequence` on a move (5.10), with an upsert so a
 * gathering that has no settings row yet gets one. It is here only until the
 * integrator points it at that lane's repository.
 *
 * Raw SQL lives here and nowhere else. No cache sits above these tables.
 */
import type { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { isPollMode, isPollState, type PollMode, type PollState } from "../../shared/comms/timePoll";

// ── Shapes ──────────────────────────────────────────────────────────────────

export interface PollRow {
  id: string;
  eventId: string;
  mode: PollMode;
  state: PollState;
  /** Epoch seconds, or null when the vote follows its earliest time. */
  closesAt: number | null;
  settleMinutes: number;
  freezeHours: number;
  pinnedOptionId: string | null;
  leaderOptionId: string | null;
  /** Epoch seconds. */
  leaderSince: number | null;
  appliedOptionId: string | null;
  showNames: boolean;
  createdBy: string;
  /** Epoch seconds. */
  createdAt: number;
  /** Epoch seconds. */
  lockedAt: number | null;
}

export interface OptionRow {
  id: string;
  pollId: string;
  startsAt: Date | null;
  weekday: number | null;
  startMinute: number | null;
  durationMinutes: number;
  position: number;
  /** Epoch seconds, or null while the time is on offer. */
  removedAt: number | null;
}

export interface NewOption {
  id: string;
  startsAt: Date | null;
  weekday: number | null;
  startMinute: number | null;
  durationMinutes: number;
  position: number;
}

const POLL_COLS =
  "id, event_id, mode, state, UNIX_TIMESTAMP(closes_at) AS closes_at, settle_minutes, freeze_hours, " +
  "pinned_option_id, leader_option_id, UNIX_TIMESTAMP(leader_since) AS leader_since, applied_option_id, " +
  "show_names, created_by, UNIX_TIMESTAMP(created_at) AS created_at, UNIX_TIMESTAMP(locked_at) AS locked_at";

const OPTION_COLS = "id, poll_id, starts_at, weekday, start_minute, duration_minutes, position, UNIX_TIMESTAMP(removed_at) AS removed_at";

const num = (v: unknown): number | null => (v == null ? null : Number(v));
const str = (v: unknown): string | null => (v == null ? null : String(v));

function toPoll(r: RowDataPacket): PollRow {
  return {
    id: String(r.id),
    eventId: String(r.event_id),
    mode: isPollMode(r.mode) ? r.mode : "once",
    // An unknown state reads as locked: a row this code cannot read must not move a gathering.
    state: isPollState(r.state) ? r.state : "locked",
    closesAt: num(r.closes_at),
    settleMinutes: Math.max(0, Number(r.settle_minutes ?? 0)),
    freezeHours: Math.max(0, Number(r.freeze_hours ?? 0)),
    pinnedOptionId: str(r.pinned_option_id),
    leaderOptionId: str(r.leader_option_id),
    leaderSince: num(r.leader_since),
    appliedOptionId: str(r.applied_option_id),
    showNames: Number(r.show_names) === 1,
    createdBy: String(r.created_by),
    createdAt: Number(r.created_at),
    lockedAt: num(r.locked_at),
  };
}

function toOption(r: RowDataPacket): OptionRow {
  return {
    id: String(r.id),
    pollId: String(r.poll_id),
    startsAt: r.starts_at == null ? null : r.starts_at instanceof Date ? r.starts_at : new Date(r.starts_at),
    weekday: num(r.weekday),
    startMinute: num(r.start_minute),
    durationMinutes: Number(r.duration_minutes),
    position: Number(r.position),
    removedAt: num(r.removed_at),
  };
}

const marks = (n: number): string => Array.from({ length: n }, () => "?").join(",");

// ── The clock ───────────────────────────────────────────────────────────────

/** The database's clock, epoch milliseconds: the one clock every rule of the vote is measured on. */
export async function databaseNowMs(pool: Pool): Promise<number> {
  const [rows] = await pool.query<RowDataPacket[]>("SELECT UNIX_TIMESTAMP() AS now"); // module-review-ok: the vote's one clock, read from the server that stamps its rows
  return Number(rows[0]?.now ?? Math.floor(Date.now() / 1000)) * 1000;
}

// ── Reading one poll ────────────────────────────────────────────────────────

export async function pollForEvent(pool: Pool, eventId: string): Promise<PollRow | null> {
  const [rows] = await pool.query<RowDataPacket[]>(`SELECT ${POLL_COLS} FROM event_time_polls WHERE event_id = ? LIMIT 1`, [eventId]); // module-review-ok: the time vote tables, one poll by its gathering
  return rows[0] ? toPoll(rows[0]) : null;
}

export async function pollById(pool: Pool, pollId: string): Promise<PollRow | null> {
  const [rows] = await pool.query<RowDataPacket[]>(`SELECT ${POLL_COLS} FROM event_time_polls WHERE id = ? LIMIT 1`, [pollId]); // module-review-ok: the time vote tables, one poll by id
  return rows[0] ? toPoll(rows[0]) : null;
}

/** Every option a poll has offered, removed ones included, in the host's order. */
export async function pollOptions(pool: Pool, pollId: string): Promise<OptionRow[]> {
  const [rows] = await pool.query<RowDataPacket[]>( // module-review-ok: the time vote tables, one poll's options
    `SELECT ${OPTION_COLS} FROM event_time_poll_options WHERE poll_id = ? ORDER BY position, id`,
    [pollId],
  );
  return rows.map(toOption);
}

/** Every approval on a poll, removed times included (the tally ignores those). */
export async function pollVotes(pool: Pool, pollId: string): Promise<Array<{ optionId: string; personKey: string }>> {
  const [rows] = await pool.query<RowDataPacket[]>( // module-review-ok: the time vote tables, one poll's votes
    "SELECT option_id, person_key FROM event_time_poll_votes WHERE poll_id = ? ORDER BY created_at, option_id, person_key",
    [pollId],
  );
  return rows.map((r) => ({ optionId: String(r.option_id), personKey: String(r.person_key) }));
}

// ── Making and editing a poll ───────────────────────────────────────────────

const isDuplicate = (err: unknown): boolean => (err as { code?: string })?.code === "ER_DUP_ENTRY";

/**
 * Write a new poll and its options in one transaction. Answers `exists` when
 * the gathering already has a poll, which the unique key decides.
 */
export async function insertPoll(
  pool: Pool,
  poll: { id: string; eventId: string; mode: PollMode; closesAt: number | null; settleMinutes: number; freezeHours: number; showNames: boolean; createdBy: string },
  options: readonly NewOption[],
): Promise<{ ok: true } | { ok: false; reason: "exists" }> {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    try {
      await conn.query( // module-review-ok: the time vote tables' one writer of new polls
        "INSERT INTO event_time_polls (id, event_id, mode, state, closes_at, settle_minutes, freeze_hours, show_names, created_by) " +
          "VALUES (?, ?, ?, 'open', FROM_UNIXTIME(?), ?, ?, ?, ?)",
        [poll.id, poll.eventId, poll.mode, poll.closesAt, poll.settleMinutes, poll.freezeHours, poll.showNames ? 1 : 0, poll.createdBy],
      );
    } catch (err) {
      await conn.rollback();
      if (isDuplicate(err)) return { ok: false, reason: "exists" };
      throw err;
    }
    await insertOptionRows(conn, poll.id, options);
    await conn.commit();
    return { ok: true };
  } catch (err) {
    await conn.rollback().catch(() => undefined);
    throw err;
  } finally {
    conn.release();
  }
}

async function insertOptionRows(conn: Pool | PoolConnection, pollId: string, options: readonly NewOption[]): Promise<void> {
  if (!options.length) return;
  const values = options.map(() => "(?, ?, ?, ?, ?, ?, ?)").join(", ");
  const params: unknown[] = [];
  for (const o of options) params.push(o.id, pollId, o.startsAt, o.weekday, o.startMinute, o.durationMinutes, o.position);
  await conn.query( // module-review-ok: the time vote tables, one poll's new options
    `INSERT INTO event_time_poll_options (id, poll_id, starts_at, weekday, start_minute, duration_minutes, position) VALUES ${values}`,
    params,
  );
}

/** Offer more times on a poll that exists. */
export async function insertOptions(pool: Pool, pollId: string, options: readonly NewOption[]): Promise<void> {
  await insertOptionRows(pool, pollId, options);
}

/**
 * Take a time off the poll. Its votes stay as the record of what was asked.
 * A pin on it goes with it, so a poll is never pinned to a time it no longer
 * offers. True when a time on offer was removed.
 */
export async function removeOption(pool: Pool, pollId: string, optionId: string): Promise<boolean> {
  const [res] = await pool.query<ResultSetHeader>( // module-review-ok: the time vote tables, one option by id, only while on offer
    "UPDATE event_time_poll_options SET removed_at = CURRENT_TIMESTAMP WHERE poll_id = ? AND id = ? AND removed_at IS NULL",
    [pollId, optionId],
  );
  if (res.affectedRows > 0) {
    await pool.query( // module-review-ok: the time vote tables, the pin on the time just removed
      "UPDATE event_time_polls SET pinned_option_id = NULL WHERE id = ? AND pinned_option_id = ?",
      [pollId, optionId],
    );
  }
  return res.affectedRows > 0;
}

/** The host's dials for one poll. A key left out is left as it is. */
export async function updatePollSettings(
  pool: Pool,
  pollId: string,
  s: { closesAt?: number | null; settleMinutes?: number; freezeHours?: number; showNames?: boolean },
): Promise<void> {
  const sets: string[] = [];
  const params: unknown[] = [];
  if (s.closesAt !== undefined) {
    sets.push("closes_at = FROM_UNIXTIME(?)");
    params.push(s.closesAt);
  }
  if (s.settleMinutes !== undefined) {
    sets.push("settle_minutes = ?");
    params.push(s.settleMinutes);
  }
  if (s.freezeHours !== undefined) {
    sets.push("freeze_hours = ?");
    params.push(s.freezeHours);
  }
  if (s.showNames !== undefined) {
    sets.push("show_names = ?");
    params.push(s.showNames ? 1 : 0);
  }
  if (!sets.length) return;
  params.push(pollId);
  await pool.query(`UPDATE event_time_polls SET ${sets.join(", ")} WHERE id = ?`, params); // module-review-ok: the time vote tables, one poll's dials
}

/** Pin a time, or clear the pin with null. */
export async function setPinned(pool: Pool, pollId: string, optionId: string | null): Promise<void> {
  await pool.query("UPDATE event_time_polls SET pinned_option_id = ? WHERE id = ?", [optionId, pollId]); // module-review-ok: the time vote tables, one poll's pin
}

/** Record who leads and since when (epoch seconds), and optionally the time now on the gathering. */
export async function recordLeader(pool: Pool, pollId: string, leaderId: string | null, leaderSince: number | null): Promise<void> {
  await pool.query( // module-review-ok: the time vote tables, one poll's leader record
    "UPDATE event_time_polls SET leader_option_id = ?, leader_since = FROM_UNIXTIME(?) WHERE id = ?",
    [leaderId, leaderSince, pollId],
  );
}

/** Record the time written to the gathering. */
export async function recordApplied(pool: Pool, pollId: string, optionId: string | null): Promise<void> {
  await pool.query("UPDATE event_time_polls SET applied_option_id = ? WHERE id = ?", [optionId, pollId]); // module-review-ok: the time vote tables, one poll's applied time
}

/**
 * Lock an open poll. True only for the ONE caller whose update moved it from
 * open to locked: the job and a host pressing "lock now" in the same second
 * cannot both send "the time is set".
 */
export async function lockPollRow(pool: Pool, pollId: string): Promise<boolean> {
  const [res] = await pool.query<ResultSetHeader>( // module-review-ok: the time vote tables, the open-to-locked claim
    "UPDATE event_time_polls SET state = 'locked', locked_at = CURRENT_TIMESTAMP WHERE id = ? AND state = 'open'",
    [pollId],
  );
  return res.affectedRows === 1;
}

/** Open a locked poll again, with a new close time when one is given. True when it was locked. */
export async function reopenPollRow(pool: Pool, pollId: string, closesAt?: number | null): Promise<boolean> {
  const params: unknown[] = [];
  let closes = "";
  if (closesAt !== undefined) {
    closes = ", closes_at = FROM_UNIXTIME(?)";
    params.push(closesAt);
  }
  params.push(pollId);
  const [res] = await pool.query<ResultSetHeader>( // module-review-ok: the time vote tables, the locked-to-open move
    `UPDATE event_time_polls SET state = 'open', locked_at = NULL${closes} WHERE id = ? AND state = 'locked'`,
    params,
  );
  return res.affectedRows === 1;
}

/** Remove a poll with its options and votes. The gathering keeps whatever time it has. */
export async function deletePollRows(pool: Pool, pollId: string): Promise<boolean> {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query("DELETE FROM event_time_poll_votes WHERE poll_id = ?", [pollId]); // module-review-ok: the time vote tables, one poll's votes, with the poll
    await conn.query("DELETE FROM event_time_poll_options WHERE poll_id = ?", [pollId]); // module-review-ok: the time vote tables, one poll's options, with the poll
    const [res] = await conn.query<ResultSetHeader>("DELETE FROM event_time_polls WHERE id = ?", [pollId]); // module-review-ok: the time vote tables, one poll by id
    await conn.commit();
    return res.affectedRows > 0;
  } catch (err) {
    await conn.rollback().catch(() => undefined);
    throw err;
  } finally {
    conn.release();
  }
}

// ── Voting ──────────────────────────────────────────────────────────────────

export type VoteWrite = { ok: true; approvals: string[] } | { ok: false; reason: "not_found" | "closed" | "bad_option" };

/**
 * Change one person's approvals in one transaction, under the poll row's
 * lock. `set` replaces every approval the person holds on a time still on
 * offer with exactly `optionIds`; `add` and `remove` change one. Approvals on
 * a time taken off the poll are never touched: they are the record of what
 * was asked. Answers the person's approvals on live times afterwards.
 */
export async function writeApprovals(
  pool: Pool,
  pollId: string,
  personKey: string,
  change: { set: readonly string[] } | { add: string } | { remove: string },
): Promise<VoteWrite> {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [polls] = await conn.query<RowDataPacket[]>("SELECT state FROM event_time_polls WHERE id = ? FOR UPDATE", [pollId]); // module-review-ok: the time vote tables, the poll row a vote locks
    if (!polls[0]) {
      await conn.rollback();
      return { ok: false, reason: "not_found" };
    }
    if (String(polls[0].state) !== "open") {
      await conn.rollback();
      return { ok: false, reason: "closed" };
    }
    const [opts] = await conn.query<RowDataPacket[]>( // module-review-ok: the time vote tables, the times on offer, under the poll lock
      "SELECT id FROM event_time_poll_options WHERE poll_id = ? AND removed_at IS NULL",
      [pollId],
    );
    const live = new Set(opts.map((r) => String(r.id)));
    const asked = "set" in change ? Array.from(new Set(change.set)) : ["add" in change ? change.add : change.remove];
    if (asked.some((id) => !live.has(id))) {
      await conn.rollback();
      return { ok: false, reason: "bad_option" };
    }
    const drop = "set" in change ? Array.from(live).filter((id) => !asked.includes(id)) : "remove" in change ? asked : [];
    const keep = "remove" in change ? [] : asked;
    if (drop.length) {
      await conn.query( // module-review-ok: the time vote tables, one person's approvals on live times
        `DELETE FROM event_time_poll_votes WHERE poll_id = ? AND person_key = ? AND option_id IN (${marks(drop.length)})`,
        [pollId, personKey, ...drop],
      );
    }
    if (keep.length) {
      const params: unknown[] = [];
      for (const id of keep) params.push(pollId, id, personKey);
      await conn.query( // module-review-ok: the time vote tables, one person's approvals; the key keeps each once
        `INSERT IGNORE INTO event_time_poll_votes (poll_id, option_id, person_key) VALUES ${keep.map(() => "(?, ?, ?)").join(", ")}`,
        params,
      );
    }
    const [mine] = await conn.query<RowDataPacket[]>( // module-review-ok: the time vote tables, one person's approvals read back in the same transaction
      `SELECT option_id FROM event_time_poll_votes WHERE poll_id = ? AND person_key = ? AND option_id IN (${marks(live.size || 1)})`,
      [pollId, personKey, ...(live.size ? Array.from(live) : [""])],
    );
    await conn.commit();
    return { ok: true, approvals: mine.map((r) => String(r.option_id)) };
  } catch (err) {
    await conn.rollback().catch(() => undefined);
    throw err;
  } finally {
    conn.release();
  }
}

/** One person's approvals on the times still on offer. */
export async function approvalsOf(pool: Pool, pollId: string, personKey: string): Promise<string[]> {
  const [rows] = await pool.query<RowDataPacket[]>( // module-review-ok: the time vote tables, one person's approvals on live times
    "SELECT v.option_id FROM event_time_poll_votes v JOIN event_time_poll_options o ON o.id = v.option_id AND o.poll_id = v.poll_id " +
      "WHERE v.poll_id = ? AND v.person_key = ? AND o.removed_at IS NULL",
    [pollId, personKey],
  );
  return rows.map((r) => String(r.option_id));
}

// ── The job and the calendar ────────────────────────────────────────────────

/**
 * The polls the job looks at: every open poll, and every locked WEEKLY poll,
 * because a weekly series is kept on its chosen time as the days pass. Oldest
 * first, bounded.
 */
export async function pollsForJob(pool: Pool, limit = 200): Promise<PollRow[]> {
  const [rows] = await pool.query<RowDataPacket[]>( // module-review-ok: the time vote tables, the job's bounded worklist
    `SELECT ${POLL_COLS} FROM event_time_polls WHERE state = 'open' OR mode = 'weekly' ORDER BY created_at, id LIMIT ?`,
    [Math.max(1, Math.min(1000, Math.trunc(limit)))],
  );
  return rows.map(toPoll);
}

/** Which of these gatherings still exist. A poll whose gathering was deleted is cleared by the job. */
export async function existingEventIds(pool: Pool, eventIds: readonly string[]): Promise<Set<string>> {
  if (!eventIds.length) return new Set();
  const [rows] = await pool.query<RowDataPacket[]>( // module-review-ok: the calendar's ids, read to clear a vote whose gathering was deleted
    `SELECT id FROM events WHERE id IN (${marks(eventIds.length)})`,
    [...eventIds],
  );
  return new Set(rows.map((r) => String(r.id)));
}

/**
 * The polls and the live options of many gatherings at once, for the
 * calendar read: two queries for a whole list, never one per item.
 */
export async function pollsWithOptionsFor(pool: Pool, eventIds: readonly string[]): Promise<Array<{ poll: PollRow; options: OptionRow[] }>> {
  const ids = Array.from(new Set(eventIds));
  if (!ids.length) return [];
  const [polls] = await pool.query<RowDataPacket[]>( // module-review-ok: the time vote tables, the polls of one calendar page
    `SELECT ${POLL_COLS} FROM event_time_polls WHERE event_id IN (${marks(ids.length)})`,
    ids,
  );
  if (!polls.length) return [];
  const rows = polls.map(toPoll);
  const [opts] = await pool.query<RowDataPacket[]>( // module-review-ok: the time vote tables, the live options of one calendar page
    `SELECT ${OPTION_COLS} FROM event_time_poll_options WHERE poll_id IN (${marks(rows.length)}) AND removed_at IS NULL ORDER BY position, id`,
    rows.map((p) => p.id),
  );
  const options = opts.map(toOption);
  return rows.map((poll) => ({ poll, options: options.filter((o) => o.pollId === poll.id) }));
}

// ── Who hears about it ──────────────────────────────────────────────────────

/** Everybody with an approval on a time still on offer. */
export async function voterKeys(pool: Pool, pollId: string): Promise<string[]> {
  const [rows] = await pool.query<RowDataPacket[]>( // module-review-ok: the time vote tables, the people who voted
    "SELECT DISTINCT v.person_key FROM event_time_poll_votes v JOIN event_time_poll_options o ON o.id = v.option_id AND o.poll_id = v.poll_id " +
      "WHERE v.poll_id = ? AND o.removed_at IS NULL ORDER BY v.person_key",
    [pollId],
  );
  return rows.map((r) => String(r.person_key));
}

/**
 * Everybody who answered a gathering yes or maybe, or waits in its queue,
 * for the evenings named (all of them when `occurrenceKeys` is null). Read
 * from the gathering's own tables, so a guest's key arrives as it is stored.
 */
export async function answeredKeys(pool: Pool, eventId: string, occurrenceKeys: readonly string[] | null): Promise<string[]> {
  if (occurrenceKeys && !occurrenceKeys.length) return [];
  const occ = occurrenceKeys ? ` AND occurrence_key IN (${marks(occurrenceKeys.length)})` : "";
  const occParams = occurrenceKeys ? [...occurrenceKeys] : [];
  const [rsvps] = await pool.query<RowDataPacket[]>( // module-review-ok: a gathering's answers, read for who hears about its time
    `SELECT DISTINCT user_id FROM event_rsvps WHERE event_id = ? AND status IN ('going', 'maybe')${occ}`,
    [eventId, ...occParams],
  );
  const [queue] = await pool.query<RowDataPacket[]>( // module-review-ok: a gathering's queue, read for who hears about its time
    `SELECT DISTINCT user_id FROM event_waitlist WHERE event_id = ? AND promoted_at IS NULL AND left_at IS NULL${occ}`,
    [eventId, ...occParams],
  );
  return Array.from(new Set([...rsvps, ...queue].map((r) => String(r.user_id))));
}

/** Members' names by user id, for a tally that shows names. */
export async function memberNames(pool: Pool, userIds: readonly string[]): Promise<Map<string, string | null>> {
  const ids = Array.from(new Set(userIds));
  if (!ids.length) return new Map();
  const [rows] = await pool.query<RowDataPacket[]>(`SELECT id, name FROM users WHERE id IN (${marks(ids.length)})`, ids); // module-review-ok: names only, for a tally a signed-in member reads
  return new Map(rows.map((r) => [String(r.id), r.name == null ? null : String(r.name)]));
}

/** Guests' names by contact id, for a tally that shows names. Never an address. */
export async function contactNames(pool: Pool, contactIds: readonly string[]): Promise<Map<string, string | null>> {
  const ids = Array.from(new Set(contactIds));
  if (!ids.length) return new Map();
  const [rows] = await pool.query<RowDataPacket[]>(`SELECT id, name FROM comms_contacts WHERE id IN (${marks(ids.length)})`, ids); // module-review-ok: names only, for a tally a signed-in member reads
  return new Map(rows.map((r) => [String(r.id), r.name == null ? null : String(r.name)]));
}

// ── The calendar file's sequence ────────────────────────────────────────────

/**
 * Bump the gathering's calendar SEQUENCE and answer the new value, so a
 * calendar app replaces the entry it holds (5.7, 5.10). Upserted: a gathering
 * with no settings row gets one at 1.
 */
export async function bumpIcsSequence(pool: Pool, eventId: string): Promise<number> {
  await pool.query( // module-review-ok: event_comms' calendar counter, bumped on every move of the time (the event email lane owns the table)
    "INSERT INTO event_comms (event_id, ics_sequence) VALUES (?, 1) ON DUPLICATE KEY UPDATE ics_sequence = ics_sequence + 1, updated_at = CURRENT_TIMESTAMP",
    [eventId],
  );
  return icsSequenceOf(pool, eventId);
}

/** The gathering's calendar SEQUENCE, 0 when it has no settings row. */
export async function icsSequenceOf(pool: Pool, eventId: string): Promise<number> {
  const [rows] = await pool.query<RowDataPacket[]>("SELECT ics_sequence FROM event_comms WHERE event_id = ? LIMIT 1", [eventId]); // module-review-ok: event_comms' calendar counter, read for a calendar file
  return rows[0] ? Number(rows[0].ics_sequence) : 0;
}
