/**
 * The advice process (0284): `live_session_advice_requests`, one row per
 * request, and `live_session_advice_asks`, one row per person asked. Every
 * statement server/lib/sessionAdvice.ts runs, one function each.
 *
 * Each function hands back what the driver handed back. Mapping, rights and
 * refusals stay in the lib, the split server/repos/liveSessions.ts makes.
 * Every UPDATE sets `updated_at` where the table has one: the column has no
 * ON UPDATE.
 */
import type { RowDataPacket } from "mysql2/promise";
import type { Queryable } from "./liveSessions";

const rowsOf = async (q: Queryable, sql: string, params: unknown[] = []): Promise<RowDataPacket[]> => {
  const [rows] = await q.query<RowDataPacket[]>(sql, params);
  return rows;
};

const none = <T>(list: readonly T[]): boolean => list.length === 0;

const REQUEST_COLS =
  "`id`, `circle_id`, `asker_no`, `intent`, `context`, `decide_by`, `status`, `decision`, `settled_at`, `created_at`";

/** One request, `lock` holding its row for the rest of the transaction. */
export async function requestRow(q: Queryable, id: number, lock = false): Promise<RowDataPacket[]> {
  return rowsOf(q, `SELECT ${REQUEST_COLS} FROM \`live_session_advice_requests\` WHERE \`id\` = ? LIMIT 1${lock ? " FOR UPDATE" : ""}`, [id]);
}

/** The requests one member made: every open one, then the newest settled ones. */
export async function requestsByAsker(q: Queryable, no: number, settledShown: number): Promise<RowDataPacket[]> {
  const open = await rowsOf(q, `SELECT ${REQUEST_COLS} FROM \`live_session_advice_requests\` WHERE \`asker_no\` = ? AND \`status\` = 'open' ORDER BY \`id\` DESC`, [no]);
  const settled = await rowsOf(
    q,
    `SELECT ${REQUEST_COLS} FROM \`live_session_advice_requests\` WHERE \`asker_no\` = ? AND \`status\` <> 'open' ORDER BY \`settled_at\` DESC, \`id\` DESC LIMIT ?`,
    [no, settledShown],
  );
  return [...open, ...settled];
}

/** The requests one member was asked about: every open one, then the newest settled ones. */
export async function requestsAskedOf(q: Queryable, no: number, settledShown: number): Promise<RowDataPacket[]> {
  const cols = REQUEST_COLS.split(", ").map((c) => `r.${c}`).join(", ");
  const from = "FROM `live_session_advice_requests` r JOIN `live_session_advice_asks` a ON a.`request_id` = r.`id` WHERE a.`member_no` = ?";
  const open = await rowsOf(q, `SELECT ${cols} ${from} AND r.\`status\` = 'open' ORDER BY r.\`id\` DESC`, [no]);
  const settled = await rowsOf(q, `SELECT ${cols} ${from} AND r.\`status\` <> 'open' ORDER BY r.\`settled_at\` DESC, r.\`id\` DESC LIMIT ?`, [no, settledShown]);
  return [...open, ...settled];
}

/** How many requests one member has open. */
export async function openCount(q: Queryable, no: number): Promise<number> {
  const [row] = await rowsOf(q, "SELECT COUNT(*) AS `n` FROM `live_session_advice_requests` WHERE `asker_no` = ? AND `status` = 'open'", [no]);
  return Number(row?.n ?? 0);
}

/** Everybody asked on some requests, with their advice. */
export async function askRows(q: Queryable, requestIds: readonly number[]): Promise<RowDataPacket[]> {
  if (none(requestIds)) return [];
  return rowsOf(
    q,
    "SELECT `request_id`, `member_no`, `advice`, `advised_at` FROM `live_session_advice_asks` WHERE `request_id` IN (?) ORDER BY `advised_at`, `member_no`",
    [requestIds],
  );
}

export async function insertRequest(
  q: Queryable,
  row: { circleId: string; askerNo: number; intent: string; context: string | null; decideBy: string; now: Date },
): Promise<number> {
  const [r] = await q.query<any>(
    "INSERT INTO `live_session_advice_requests` (`circle_id`, `asker_no`, `intent`, `context`, `decide_by`, `status`, `decision`, `settled_at`, `created_at`, `updated_at`) " +
      "VALUES (?, ?, ?, ?, ?, 'open', NULL, NULL, ?, ?)",
    [row.circleId, row.askerNo, row.intent, row.context, row.decideBy, row.now, row.now],
  );
  return Number(r.insertId);
}

/** The people asked on a new request, each once. */
export async function insertAsks(q: Queryable, requestId: number, nos: readonly number[], now: Date): Promise<void> {
  if (none(nos)) return;
  await q.query(
    "INSERT IGNORE INTO `live_session_advice_asks` (`request_id`, `member_no`, `advice`, `advised_at`, `created_at`) VALUES ?",
    [nos.map((no) => [requestId, no, null, null, now])],
  );
}

/**
 * One person's advice, given or changed, only while the request is open: the
 * status is read in the same statement, so a decision that lands first wins.
 * Hands back 1, or 0 when they were not asked or the request is settled.
 */
export async function putAdvice(q: Queryable, requestId: number, no: number, advice: string, now: Date): Promise<number> {
  const [r] = await q.query<any>(
    "UPDATE `live_session_advice_asks` a JOIN `live_session_advice_requests` r ON r.`id` = a.`request_id` " +
      "SET a.`advice` = ?, a.`advised_at` = ? WHERE a.`request_id` = ? AND a.`member_no` = ? AND r.`status` = 'open'",
    [advice, now, requestId, no],
  );
  return Number(r.affectedRows ?? 0);
}

/** An open request is decided or withdrawn. Hands back 1, or 0 when it was not open. */
export async function settleRequest(q: Queryable, id: number, status: "decided" | "withdrawn", decision: string | null, now: Date): Promise<number> {
  const [r] = await q.query<any>(
    "UPDATE `live_session_advice_requests` SET `status` = ?, `decision` = ?, `settled_at` = ?, `updated_at` = ? WHERE `id` = ? AND `status` = 'open'",
    [status, decision, now, now, id],
  );
  return Number(r.affectedRows ?? 0);
}

// ── One member: the export and the erasure ──────────────────────────────────

/** Every request this member made, for the export. */
export async function memberRequests(q: Queryable, no: number): Promise<RowDataPacket[]> {
  return rowsOf(q, `SELECT ${REQUEST_COLS} FROM \`live_session_advice_requests\` WHERE \`asker_no\` = ? ORDER BY \`id\``, [no]);
}

/** Every word of advice this member gave, for the export. */
export async function memberAdvice(q: Queryable, no: number): Promise<RowDataPacket[]> {
  return rowsOf(
    q,
    "SELECT `request_id`, `advice`, `advised_at` FROM `live_session_advice_asks` WHERE `member_no` = ? AND `advice` IS NOT NULL ORDER BY `request_id`",
    [no],
  );
}

/**
 * The member leaves: the requests they made go, with every ask and every word
 * of advice on them, since those answered their words; and every ask of
 * theirs goes, their advice with it.
 */
export async function forgetMember(q: Queryable, no: number): Promise<void> {
  const own = (await rowsOf(q, "SELECT `id` FROM `live_session_advice_requests` WHERE `asker_no` = ?", [no])).map((r) => Number(r.id));
  if (!none(own)) {
    await q.query("DELETE FROM `live_session_advice_asks` WHERE `request_id` IN (?)", [own]);
    await q.query("DELETE FROM `live_session_advice_requests` WHERE `id` IN (?)", [own]);
  }
  await q.query("DELETE FROM `live_session_advice_asks` WHERE `member_no` = ?", [no]);
}
