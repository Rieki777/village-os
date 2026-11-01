/**
 * The `member_asks` table (0299), one member asking another.
 *
 * Raw SQL only, never `dbCollection`: its `replaceAll` resets every column a
 * caller leaves out, and a status change here touches two columns of one row.
 * Every status change is a compare-and-set on the row's current status, so a
 * second tap, or the asker withdrawing while the asked member marks it done,
 * finds the row already moved and changes nothing.
 *
 * Rows are only ever read by one of the two member ids on them. Nothing here
 * lists asks between other people.
 */
import type { Pool, PoolConnection, RowDataPacket } from "mysql2/promise";
import type { AskStatus } from "../../shared/memberAsks";

type Db = Pool | PoolConnection;

export interface StoredAsk {
  id: string;
  askerUserId: string;
  askedUserId: string;
  link: string;
  why: string;
  dueOn: string | null;
  blocking: boolean;
  status: AskStatus;
  handBackNote: string | null;
  createdAt: Date;
  closedAt: Date | null;
}

const COLUMNS =
  "id, asker_user_id, asked_user_id, link, why, DATE_FORMAT(due_on, '%Y-%m-%d') AS due_on, blocking, status, hand_back_note, created_at, closed_at";

function rowToAsk(r: RowDataPacket): StoredAsk {
  return {
    id: String(r.id),
    askerUserId: String(r.asker_user_id),
    askedUserId: String(r.asked_user_id),
    link: String(r.link),
    why: String(r.why),
    dueOn: r.due_on ? String(r.due_on) : null,
    blocking: Number(r.blocking) === 1,
    status: String(r.status) as AskStatus,
    handBackNote: r.hand_back_note == null ? null : String(r.hand_back_note),
    createdAt: new Date(r.created_at),
    closedAt: r.closed_at ? new Date(r.closed_at) : null,
  };
}

export interface NewAsk {
  id: string;
  askerUserId: string;
  askedUserId: string;
  link: string;
  why: string;
  dueOn: string | null;
  blocking: boolean;
}

export async function insertAsk(db: Db, a: NewAsk): Promise<void> {
  await db.query(
    "INSERT INTO member_asks (id, asker_user_id, asked_user_id, link, why, due_on, blocking, status) VALUES (?,?,?,?,?,?,?,'open')",
    [a.id, a.askerUserId, a.askedUserId, a.link, a.why, a.dueOn, a.blocking ? 1 : 0],
  );
}

/** One ask, or null. */
export async function readAsk(db: Db, id: string): Promise<StoredAsk | null> {
  const [rows] = await db.query<RowDataPacket[]>(`SELECT ${COLUMNS} FROM member_asks WHERE id = ?`, [id]);
  return rows[0] ? rowToAsk(rows[0]) : null;
}

/** The open asks waiting on one member. */
export async function openAsksFor(db: Db, askedUserId: string): Promise<StoredAsk[]> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT ${COLUMNS} FROM member_asks WHERE asked_user_id = ? AND status = 'open' ORDER BY created_at, id`,
    [askedUserId],
  );
  return rows.map(rowToAsk);
}

/** One member's own asks: every open one, then the most recent closed ones. */
export async function asksBy(db: Db, askerUserId: string, closedLimit = 10): Promise<StoredAsk[]> {
  const [open] = await db.query<RowDataPacket[]>(
    `SELECT ${COLUMNS} FROM member_asks WHERE asker_user_id = ? AND status = 'open' ORDER BY created_at, id`,
    [askerUserId],
  );
  const [closed] = await db.query<RowDataPacket[]>(
    `SELECT ${COLUMNS} FROM member_asks WHERE asker_user_id = ? AND status <> 'open' ORDER BY closed_at DESC, id LIMIT ?`,
    [askerUserId, Math.max(0, Math.floor(closedLimit))],
  );
  return [...open.map(rowToAsk), ...closed.map(rowToAsk)];
}

/** How many open blocking asks one member has out. */
export async function openBlockingCount(db: Db, askerUserId: string): Promise<number> {
  const [rows] = await db.query<RowDataPacket[]>(
    "SELECT COUNT(*) AS n FROM member_asks WHERE asker_user_id = ? AND status = 'open' AND blocking = 1",
    [askerUserId],
  );
  return Number(rows[0]?.n ?? 0);
}

/** Whether this member already handed this link back to this asker. */
export async function handedBackBefore(db: Db, askerUserId: string, askedUserId: string, link: string): Promise<boolean> {
  const [rows] = await db.query<RowDataPacket[]>(
    "SELECT 1 FROM member_asks WHERE asker_user_id = ? AND asked_user_id = ? AND link = ? AND status = 'handed_back' LIMIT 1",
    [askerUserId, askedUserId, link],
  );
  return rows.length > 0;
}

/** Close an open ask. False when it was no longer open, which is how a second door learns the first one won. */
export async function closeAsk(db: Db, id: string, to: Exclude<AskStatus, "open">, handBackNote: string | null = null): Promise<boolean> {
  const [r]: any = await db.query(
    "UPDATE member_asks SET status = ?, hand_back_note = ?, closed_at = UTC_TIMESTAMP() WHERE id = ? AND status = 'open'",
    [to, handBackNote, id],
  );
  return Number(r?.affectedRows ?? 0) > 0;
}

/**
 * The erasure sweep's step (server/lib/erasure.ts, "member-asks"). A row is the
 * two members on it and nobody else, so every row either of them is on goes.
 */
export async function forgetAsksForMember(db: Db, userId: string): Promise<void> {
  await db.query("DELETE FROM member_asks WHERE asker_user_id = ? OR asked_user_id = ?", [userId, userId]);
}
