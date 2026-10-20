/**
 * The readers and writers for `path_enrollments` (drizzle/0246): who walks
 * which path, how they came to it, whether they left, and whether they
 * reached its goal (the comms build spec 5.11).
 *
 * ONE ROW PER PERSON AND PATH, held by `path_enrollments_one`. Joining a path
 * again after leaving it picks the same row up again (`state` back to
 * `active`, the dates of the new walk), so a person's history on a path is one
 * row and never a pile of them.
 *
 * Person keys follow the rule in shared/comms/kinds.ts: a member is their user
 * id, somebody with no account is `guest:<contactId>`.
 *
 * Raw SQL lives here and nowhere else. No cache sits above this table.
 */
import type { Pool, ResultSetHeader, RowDataPacket } from "mysql2/promise";

const VILLAGE = "local";

export type PathState = "active" | "left" | "done";

export interface PathEnrollmentRow {
  id: string;
  personKey: string;
  userId: string | null;
  contactId: string | null;
  pathId: string;
  source: string;
  state: PathState;
  /** Epoch seconds. */
  joinedAt: number;
  leftAt: number | null;
  doneAt: number | null;
  lastRung: string | null;
}

const COLUMNS =
  "id, person_key, user_id, contact_id, path_id, source, state, UNIX_TIMESTAMP(joined_at) AS joined_at, " +
  "UNIX_TIMESTAMP(left_at) AS left_at, UNIX_TIMESTAMP(done_at) AS done_at, last_rung";

const str = (v: unknown): string | null => (v == null ? null : String(v));
const num = (v: unknown): number | null => (v == null ? null : Number(v));

const toRow = (r: RowDataPacket): PathEnrollmentRow => ({
  id: String(r.id),
  personKey: String(r.person_key),
  userId: str(r.user_id),
  contactId: str(r.contact_id),
  pathId: String(r.path_id),
  source: String(r.source),
  state: (["active", "left", "done"].includes(String(r.state)) ? String(r.state) : "active") as PathState,
  joinedAt: Number(r.joined_at ?? 0),
  leftAt: num(r.left_at),
  doneAt: num(r.done_at),
  lastRung: str(r.last_rung),
});

/** One person's row on one path, or null. */
export async function pathEnrollmentOf(pool: Pool, personKey: string, pathId: string): Promise<PathEnrollmentRow | null> {
  const [rows] = await pool.query<RowDataPacket[]>( // module-review-ok: one row by the unique key (person, path)
    `SELECT ${COLUMNS} FROM path_enrollments WHERE village_id = ? AND person_key = ? AND path_id = ? LIMIT 1`,
    [VILLAGE, personKey, pathId],
  );
  return rows[0] ? toRow(rows[0]) : null;
}

/**
 * Put a person on a path, or pick their row up again.
 *
 *   created      a new row, `active`, joined now
 *   reactivated  they had left the path (or reached its goal) and came back:
 *                the row is `active` again, joined now, with the new source
 *   already      they are on it; nothing changes beyond filling in a user or
 *                contact id the row did not know yet
 *
 * A backfill never reactivates: the members it records are on their paths
 * today, and a row that says otherwise was written by somebody acting since.
 */
export async function joinPathRow(
  pool: Pool,
  input: { id: string; personKey: string; userId: string | null; contactId: string | null; pathId: string; source: string },
): Promise<{ row: PathEnrollmentRow; outcome: "created" | "reactivated" | "already" }> {
  const source = input.source.slice(0, 64);
  const [ins] = await pool.query<ResultSetHeader>( // module-review-ok: the one writer of new path rows; the unique key refuses a second
    "INSERT IGNORE INTO path_enrollments (id, village_id, person_key, user_id, contact_id, path_id, source, state) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, 'active')",
    [input.id, VILLAGE, input.personKey, input.userId, input.contactId, input.pathId, source],
  );
  let outcome: "created" | "reactivated" | "already" = "created";
  if (ins.affectedRows === 0) {
    outcome = "already";
    if (source !== "backfill") {
      const [re] = await pool.query<ResultSetHeader>( // module-review-ok: one row by the unique key, only while it is not active
        "UPDATE path_enrollments SET state = 'active', joined_at = CURRENT_TIMESTAMP, left_at = NULL, done_at = NULL, " +
          "source = ?, updated_at = CURRENT_TIMESTAMP WHERE village_id = ? AND person_key = ? AND path_id = ? AND state <> 'active'",
        [source, VILLAGE, input.personKey, input.pathId],
      );
      if (re.affectedRows > 0) outcome = "reactivated";
    }
    await pool.query( // module-review-ok: one row by the unique key; fills in ids the row did not know, never replaces one
      "UPDATE path_enrollments SET user_id = COALESCE(user_id, ?), contact_id = COALESCE(contact_id, ?) " +
        "WHERE village_id = ? AND person_key = ? AND path_id = ? AND (user_id IS NULL OR contact_id IS NULL)",
      [input.userId, input.contactId, VILLAGE, input.personKey, input.pathId],
    );
  }
  const row = await pathEnrollmentOf(pool, input.personKey, input.pathId);
  if (!row) throw new Error("path_enrollments: a row just written could not be read back");
  return { row, outcome };
}

/** The person left the path. True when this call is what moved them. */
export async function leavePathRow(pool: Pool, personKey: string, pathId: string): Promise<boolean> {
  const [res] = await pool.query<ResultSetHeader>( // module-review-ok: one row by the unique key, only while it is not already left
    "UPDATE path_enrollments SET state = 'left', left_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP " +
      "WHERE village_id = ? AND person_key = ? AND path_id = ? AND state <> 'left'",
    [VILLAGE, personKey, pathId],
  );
  return res.affectedRows > 0;
}

/**
 * The person reached the path's goal. Matched by person key or by contact,
 * because the trigger that reports a goal (a reservation, an accepted
 * proposal) knows an address and not always an account. Only an active row
 * moves, and its first `done_at` stands.
 */
export async function markPathDone(
  pool: Pool,
  who: { personKey?: string | null; contactId?: string | null },
  pathId: string,
): Promise<number> {
  const keys: string[] = [];
  const params: unknown[] = [VILLAGE, pathId];
  if (who.personKey) {
    keys.push("person_key = ?");
    params.push(who.personKey);
  }
  if (who.contactId) {
    keys.push("contact_id = ?");
    params.push(who.contactId);
  }
  if (!keys.length) return 0;
  const [res] = await pool.query<ResultSetHeader>( // module-review-ok: rows of one person on one path, only while active
    "UPDATE path_enrollments SET state = 'done', done_at = COALESCE(done_at, CURRENT_TIMESTAMP), updated_at = CURRENT_TIMESTAMP " +
      `WHERE village_id = ? AND path_id = ? AND state = 'active' AND (${keys.join(" OR ")})`,
    params,
  );
  return res.affectedRows;
}

/** True when the person has left this path (by person key or by contact). */
export async function hasLeftPath(pool: Pool, who: { personKey?: string | null; contactId?: string | null }, pathId: string): Promise<boolean> {
  if (!who.personKey && !who.contactId) return false;
  const [rows] = await pool.query<RowDataPacket[]>( // module-review-ok: one person on one path, by the unique key or the contact
    "SELECT 1 FROM path_enrollments WHERE village_id = ? AND path_id = ? AND state = 'left' " +
      "AND (person_key = ? OR (? IS NOT NULL AND contact_id = ?)) LIMIT 1",
    [VILLAGE, pathId, who.personKey ?? "", who.contactId ?? null, who.contactId ?? null],
  );
  return rows.length > 0;
}

/** Record the rung of the path's ladder last seen for one row. */
export async function setLastRung(pool: Pool, id: string, rung: string | null): Promise<void> {
  await pool.query( // module-review-ok: one row by id
    "UPDATE path_enrollments SET last_rung = ?, updated_at = CURRENT_TIMESTAMP WHERE village_id = ? AND id = ?",
    [rung, VILLAGE, id],
  );
}

/**
 * Active rows on one path, oldest first, bounded. `source` narrows it (the
 * backfill's rows, for "include people already on this path"); `membersOnly`
 * keeps rows that know their account (a ladder is read by user id).
 */
export async function activePathRows(
  pool: Pool,
  pathId: string,
  opts: { source?: string; membersOnly?: boolean; limit: number },
): Promise<PathEnrollmentRow[]> {
  const clauses = ["village_id = ?", "path_id = ?", "state = 'active'"];
  const params: unknown[] = [VILLAGE, pathId];
  if (opts.source) {
    clauses.push("source = ?");
    params.push(opts.source);
  }
  if (opts.membersOnly) clauses.push("user_id IS NOT NULL");
  params.push(Math.max(1, Math.min(5000, Math.trunc(opts.limit))));
  const [rows] = await pool.query<RowDataPacket[]>( // module-review-ok: one path's active rows, bounded by the caller's limit
    `SELECT ${COLUMNS} FROM path_enrollments WHERE ${clauses.join(" AND ")} ORDER BY joined_at, id LIMIT ?`,
    params,
  );
  return rows.map(toRow);
}

/** How many are on each path now, and how many of them the backfill recorded. */
export async function pathCounts(pool: Pool, pathId: string): Promise<{ active: number; backfilled: number }> {
  const [rows] = await pool.query<RowDataPacket[]>( // module-review-ok: two counts over one path's rows
    "SELECT COUNT(*) AS active, COALESCE(SUM(source = 'backfill'), 0) AS backfilled FROM path_enrollments " +
      "WHERE village_id = ? AND path_id = ? AND state = 'active'",
    [VILLAGE, pathId],
  );
  return { active: Number(rows[0]?.active ?? 0), backfilled: Number(rows[0]?.backfilled ?? 0) };
}
