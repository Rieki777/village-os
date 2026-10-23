/**
 * The agenda library's two tables (0264): `live_session_library`, one row per
 * item a member brought with where it stands now, and
 * `live_session_library_takes`, one row per time a session took it. Every
 * statement server/lib/sessionLibrary.ts and server/lib/liveSessions.ts run
 * against them, one function each.
 *
 * Each function hands back what the driver handed back: rows, an insert id,
 * a count, or nothing. Mapping into the shapes in shared/sessionLibrary.ts,
 * every right and every refusal stay in the lib beside the rules they keep,
 * the split server/repos/liveSessions.ts makes for the same reason.
 *
 * ── ONE FUNCTION PER MOVE, AND IT WRITES BOTH TABLES ─────────────────────
 *
 * The invariants are the migration's: a waiting row has no session and no open
 * take; a row on an agenda names its open session and item, and exactly one
 * take with no outcome names the same pair; a taken-up row keeps its link until
 * the record is deleted. `takeOnto`, `settleTake`, `releaseFromSession`,
 * `unlinkDeletedSession` and `bringAgain` each move one item from one of those
 * states to another, and every one of them writes the row and its takes
 * together, inside the caller's transaction. `deleteItems` (withdraw, and the
 * erasure) removes the row and leaves its takes: a take holds no words, and it
 * is what keeps an agenda item from being offered again under "From last time".
 *
 * ── LOCKS ────────────────────────────────────────────────────────────────
 *
 * A write that also holds a session row (opening a room, bringing items into
 * one, the close, a discard) takes the session row first and the library rows
 * after it, by primary key in id order (`rowsByIds(..., true)`), so two rooms
 * that want the same item wait for each other in one direction only. Rows a
 * session holds are found with a plain read of their ids first and locked by
 * primary key after: a locking read through `session_id` would take next-key
 * locks on that index and hold up takes into a neighbouring session. The doors
 * that only change an item (bring, change, withdraw, bring again) never touch a
 * session row, so they cannot close a cycle with the room.
 *
 * Every UPDATE sets `updated_at`: the column has no ON UPDATE.
 */
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import type { Queryable } from "./liveSessions";

const rowsOf = async (q: Queryable, sql: string, params: unknown[] = []): Promise<RowDataPacket[]> => {
  const [rows] = await q.query<RowDataPacket[]>(sql, params);
  return rows;
};

const affected = async (q: Queryable, sql: string, params: unknown[]): Promise<number> => {
  const [r] = await q.query<any>(sql, params);
  return Number(r.affectedRows ?? 0);
};

/** `IN (?)` with an empty list is a syntax error, so an empty list reads nothing. */
const none = <T>(list: readonly T[]): boolean => list.length === 0;

const LIBRARY_COLUMNS =
  "`id`, `circle_id`, `title`, `aim`, `note`, `note_by_no`, `brought_by_no`, `status`, `session_id`, `session_item_id`, " +
  "`edited_by_no`, `created_at`, `updated_at`, `settled_at`";

// ── One item ────────────────────────────────────────────────────────────────

export async function insertItemRow(
  q: Queryable,
  row: { circleId: string | null; title: string; aim: string | null; note: string | null; broughtByNo: number; now: Date },
): Promise<number> {
  const [r] = await q.query<any>(
    "INSERT INTO `live_session_library` (`circle_id`, `title`, `aim`, `note`, `note_by_no`, `brought_by_no`, `status`, `session_id`, " +
      "`session_item_id`, `edited_by_no`, `created_at`, `updated_at`, `settled_at`) VALUES (?, ?, ?, ?, NULL, ?, 'waiting', NULL, NULL, NULL, ?, ?, NULL)",
    [row.circleId, row.title, row.aim, row.note, row.broughtByNo, row.now, row.now],
  );
  return Number(r.insertId);
}

// ── Where an item came from (0279) ──────────────────────────────────────────

/**
 * Remember where an item came from. The unique key on (kind, ref) refuses a
 * second item from the same tension: the caller reads ER_DUP_ENTRY as "sent
 * already".
 */
export async function insertSource(q: Queryable, row: { libraryId: number; kind: string; ref: string; label: string; now: Date }): Promise<void> {
  await q.query(
    "INSERT INTO `live_session_library_sources` (`library_id`, `kind`, `ref`, `label`, `created_at`) VALUES (?, ?, ?, ?, ?)",
    [row.libraryId, row.kind, row.ref, row.label.slice(0, 120), row.now],
  );
}

/** Where some items came from. */
export async function sourceRows(q: Queryable, libraryIds: readonly number[]): Promise<RowDataPacket[]> {
  if (none(libraryIds)) return [];
  return rowsOf(q, "SELECT `library_id`, `kind`, `ref`, `label` FROM `live_session_library_sources` WHERE `library_id` IN (?)", [libraryIds]);
}

/** Which of some tensions of one kind were sent on already, with the item each became. */
export async function sentRows(q: Queryable, kind: string, refs: readonly string[]): Promise<RowDataPacket[]> {
  if (none(refs)) return [];
  return rowsOf(
    q,
    "SELECT s.`ref`, s.`library_id`, l.`circle_id` FROM `live_session_library_sources` s JOIN `live_session_library` l ON l.`id` = s.`library_id` " +
      "WHERE s.`kind` = ? AND s.`ref` IN (?)",
    [kind, refs],
  );
}

/** One item. `lock` takes the row for the rest of the transaction. */
export async function itemRow(q: Queryable, id: number, lock = false): Promise<RowDataPacket[]> {
  return rowsOf(q, `SELECT ${LIBRARY_COLUMNS} FROM \`live_session_library\` WHERE \`id\` = ? LIMIT 1${lock ? " FOR UPDATE" : ""}`, [id]);
}

/** Several items in id order. `lock` takes them all, in that order. */
export async function rowsByIds(q: Queryable, ids: readonly number[], lock = false): Promise<RowDataPacket[]> {
  if (none(ids)) return [];
  return rowsOf(q, `SELECT ${LIBRARY_COLUMNS} FROM \`live_session_library\` WHERE \`id\` IN (?) ORDER BY \`id\`${lock ? " FOR UPDATE" : ""}`, [ids]);
}

/** How many items one member has waiting. */
export async function waitingCountBy(q: Queryable, no: number): Promise<number> {
  const rows = await rowsOf(q, "SELECT COUNT(*) AS `n` FROM `live_session_library` WHERE `brought_by_no` = ? AND `status` = 'waiting'", [no]);
  return Number(rows[0]?.n ?? 0);
}

/**
 * New words for a waiting item, written whole from the row the caller holds
 * locked and merged. The WHERE asks again that it waits. Hands back 1 or 0.
 */
export async function writeWords(
  q: Queryable,
  id: number,
  row: { title: string; aim: string | null; note: string | null; noteByNo: number | null; circleId: string | null; editedByNo: number | null; now: Date },
): Promise<number> {
  return affected(
    q,
    "UPDATE `live_session_library` SET `title` = ?, `aim` = ?, `note` = ?, `note_by_no` = ?, `circle_id` = ?, `edited_by_no` = ?, " +
      "`updated_at` = ? WHERE `id` = ? AND `status` = 'waiting'",
    [row.title, row.aim, row.note, row.noteByNo, row.circleId, row.editedByNo, row.now, id],
  );
}

/**
 * Withdraw: the items go. Their takes stay: a take holds no words, and it is
 * what keeps "From last time" from offering the agenda item it became a
 * second time (`libraryItemIdsFor`). The agenda items stay as recorded.
 */
export async function deleteItems(q: Queryable, ids: readonly number[]): Promise<void> {
  if (none(ids)) return;
  await q.query("DELETE FROM `live_session_library` WHERE `id` IN (?)", [ids]);
}

/** A taken-up item waits again. Its takes stay as history. Hands back 1 or 0. */
export async function bringAgain(q: Queryable, id: number, now: Date): Promise<number> {
  return affected(
    q,
    "UPDATE `live_session_library` SET `status` = 'waiting', `session_id` = NULL, `session_item_id` = NULL, `settled_at` = NULL, " +
      "`updated_at` = ? WHERE `id` = ? AND `status` = 'taken_up'",
    [now, id],
  );
}

// ── The list ────────────────────────────────────────────────────────────────

/**
 * What waits or sits on an open agenda, as this viewer may see it, with the
 * visibility in the SQL so a limit never hides a card the viewer may read:
 * everything for an admin; otherwise the items for no circle, the items of
 * the circles they have standing in, and their own.
 */
export async function liveRows(
  q: Queryable,
  v: { admin: boolean; no: number | null; standing: readonly string[]; limit: number },
): Promise<RowDataPacket[]> {
  const base = `SELECT ${LIBRARY_COLUMNS} FROM \`live_session_library\` WHERE \`status\` IN ('waiting', 'on_agenda')`;
  if (v.admin) return rowsOf(q, `${base} ORDER BY \`created_at\`, \`id\` LIMIT ?`, [v.limit]);
  const clauses = ["`circle_id` IS NULL"];
  const params: unknown[] = [];
  if (!none(v.standing)) {
    clauses.push("`circle_id` IN (?)");
    params.push(v.standing);
  }
  if (v.no != null && v.no > 0) {
    clauses.push("`brought_by_no` = ?");
    params.push(v.no);
  }
  return rowsOf(q, `${base} AND (${clauses.join(" OR ")}) ORDER BY \`created_at\`, \`id\` LIMIT ?`, [...params, v.limit]);
}

/**
 * What a session took up since `since`, newest first, as this viewer may see
 * it: everything for an admin; otherwise what they brought, and what was taken
 * up in a session they were in. A record opens to its people and its admins,
 * and so does what it took up.
 */
export async function takenUpRows(q: Queryable, v: { admin: boolean; no: number | null; since: Date; limit: number }): Promise<RowDataPacket[]> {
  const base = `SELECT ${LIBRARY_COLUMNS} FROM \`live_session_library\` WHERE \`status\` = 'taken_up' AND \`settled_at\` >= ?`;
  if (v.admin) return rowsOf(q, `${base} ORDER BY \`settled_at\` DESC, \`id\` DESC LIMIT ?`, [v.since, v.limit]);
  if (v.no == null || v.no <= 0) return [];
  return rowsOf(
    q,
    `${base} AND (\`brought_by_no\` = ? OR \`session_id\` IN (SELECT \`session_id\` FROM \`live_session_people\` WHERE \`member_no\` = ?)) ` +
      "ORDER BY `settled_at` DESC, `id` DESC LIMIT ?",
    [v.since, v.no, v.no, v.limit],
  );
}

/**
 * Every settled take of some items, newest first, for the "back for next
 * time" line: the newest one says how the item last left a session, and only a
 * `back` there means it came back on its own.
 */
export async function settledTakeRows(q: Queryable, libraryIds: readonly number[]): Promise<RowDataPacket[]> {
  if (none(libraryIds)) return [];
  return rowsOf(
    q,
    "SELECT `library_id`, `outcome`, `settled_at` FROM `live_session_library_takes` " +
      "WHERE `library_id` IN (?) AND `settled_at` IS NOT NULL ORDER BY `settled_at` DESC, `id` DESC",
    [libraryIds],
  );
}

/** The title and status of the sessions some cards name. */
export async function sessionTitleRows(q: Queryable, sessionIds: readonly number[]): Promise<RowDataPacket[]> {
  if (none(sessionIds)) return [];
  return rowsOf(q, "SELECT `id`, `title`, `status` FROM `live_sessions` WHERE `id` IN (?)", [sessionIds]);
}

// ── Taking, settling, releasing ─────────────────────────────────────────────

/**
 * One item goes onto one session's agenda: the row says where, and a take with
 * no outcome says the same. The caller holds the session row and this item's
 * row, and has checked it waits.
 */
export async function takeOnto(
  q: PoolConnection,
  t: { libraryId: number; sessionId: number; itemId: number; takenByNo: number; now: Date },
): Promise<number> {
  await q.query(
    "UPDATE `live_session_library` SET `status` = 'on_agenda', `session_id` = ?, `session_item_id` = ?, `updated_at` = ? WHERE `id` = ?",
    [t.sessionId, t.itemId, t.now, t.libraryId],
  );
  const [r] = await q.query<any>(
    "INSERT INTO `live_session_library_takes` (`library_id`, `session_id`, `item_id`, `taken_by_no`, `taken_at`, `outcome`, `settled_at`) " +
      "VALUES (?, ?, ?, ?, ?, NULL, NULL)",
    [t.libraryId, t.sessionId, t.itemId, t.takenByNo, t.now],
  );
  return Number(r.insertId);
}

/** One session's takes, every outcome. A plain read: the caller locks what it will write. */
export async function takesForSession(q: Queryable, sessionId: number): Promise<RowDataPacket[]> {
  return rowsOf(
    q,
    "SELECT `id`, `library_id`, `session_id`, `item_id`, `taken_by_no`, `outcome` FROM `live_session_library_takes` WHERE `session_id` = ? ORDER BY `id`",
    [sessionId],
  );
}

/** The items a session took from the library, with who brought each, for the room's "Brought by" line. */
export async function broughtForSession(q: Queryable, sessionId: number): Promise<RowDataPacket[]> {
  return rowsOf(
    q,
    "SELECT `t`.`item_id`, `t`.`library_id`, `l`.`brought_by_no` FROM `live_session_library_takes` `t` " +
      "JOIN `live_session_library` `l` ON `l`.`id` = `t`.`library_id` WHERE `t`.`session_id` = ?",
    [sessionId],
  );
}

/**
 * A take leaves its session: taken up for good, or back to wait. The row moves
 * only while it still names this session and sits on its agenda, so a row
 * withdrawn or settled in between is left as it is.
 */
export async function settleTake(
  q: PoolConnection,
  s: { takeId: number; libraryId: number; sessionId: number; outcome: "taken_up" | "back"; now: Date },
): Promise<number> {
  await q.query("UPDATE `live_session_library_takes` SET `outcome` = ?, `settled_at` = ? WHERE `id` = ? AND `outcome` IS NULL", [
    s.outcome,
    s.now,
    s.takeId,
  ]);
  if (s.outcome === "taken_up") {
    return affected(
      q,
      "UPDATE `live_session_library` SET `status` = 'taken_up', `settled_at` = ?, `updated_at` = ? " +
        "WHERE `id` = ? AND `session_id` = ? AND `status` = 'on_agenda'",
      [s.now, s.now, s.libraryId, s.sessionId],
    );
  }
  return affected(
    q,
    "UPDATE `live_session_library` SET `status` = 'waiting', `session_id` = NULL, `session_item_id` = NULL, `updated_at` = ? " +
      "WHERE `id` = ? AND `session_id` = ? AND `status` = 'on_agenda'",
    [s.now, s.libraryId, s.sessionId],
  );
}

/**
 * A session is discarded while open: what it held waits again, and its takes
 * go, because the session is meant never to have been.
 */
export async function releaseFromSession(q: PoolConnection, sessionId: number, libraryIds: readonly number[], now: Date): Promise<void> {
  if (!none(libraryIds)) {
    await q.query(
      "UPDATE `live_session_library` SET `status` = 'waiting', `session_id` = NULL, `session_item_id` = NULL, `updated_at` = ? " +
        "WHERE `id` IN (?) AND `session_id` = ? AND `status` = 'on_agenda'",
      [now, libraryIds, sessionId],
    );
  }
  await q.query("DELETE FROM `live_session_library_takes` WHERE `session_id` = ?", [sessionId]);
}

/**
 * A closed record is deleted: what it took up keeps its status and loses the
 * link, the way an item brought over from it keeps its words. Its takes go
 * with the session they name.
 */
export async function unlinkDeletedSession(q: PoolConnection, sessionId: number, libraryIds: readonly number[], now: Date): Promise<void> {
  if (!none(libraryIds)) {
    await q.query(
      "UPDATE `live_session_library` SET `session_id` = NULL, `session_item_id` = NULL, `updated_at` = ? WHERE `id` IN (?) AND `session_id` = ?",
      [now, libraryIds, sessionId],
    );
  }
  await q.query("DELETE FROM `live_session_library_takes` WHERE `session_id` = ?", [sessionId]);
}

/** The ids of the items that name a session now. A plain read, for the caller to lock by primary key. */
export async function itemIdsNaming(q: Queryable, sessionId: number): Promise<number[]> {
  const rows = await rowsOf(q, "SELECT `id` FROM `live_session_library` WHERE `session_id` = ?", [sessionId]);
  return rows.map((r) => Number(r.id));
}

/**
 * Items left on an agenda whose session closed or went without settling them:
 * a release from before the library, or a step that failed. The status index
 * narrows the read to items on an agenda, which is a handful.
 */
export async function strandedRows(q: Queryable, limit: number): Promise<RowDataPacket[]> {
  return rowsOf(
    q,
    "SELECT `l`.`id`, `l`.`session_id`, `l`.`session_item_id`, `s`.`status` AS `session_status`, `i`.`status` AS `item_status` " +
      "FROM `live_session_library` `l` LEFT JOIN `live_sessions` `s` ON `s`.`id` = `l`.`session_id` " +
      "LEFT JOIN `live_session_items` `i` ON `i`.`id` = `l`.`session_item_id` " +
      "WHERE `l`.`status` = 'on_agenda' AND (`s`.`id` IS NULL OR `s`.`status` <> 'open') LIMIT ?",
    [limit],
  );
}

/** The open take of one item, if it has one. */
export async function openTakeRow(q: Queryable, libraryId: number): Promise<RowDataPacket[]> {
  return rowsOf(
    q,
    "SELECT `id`, `session_id`, `item_id` FROM `live_session_library_takes` WHERE `library_id` = ? AND `outcome` IS NULL ORDER BY `id` DESC LIMIT 1",
    [libraryId],
  );
}

/**
 * A stranded item whose session is gone waits again. Its open takes, which
 * name a session that no longer exists, go with it.
 */
export async function strandedBackToWaiting(q: PoolConnection, libraryId: number, sessionId: number | null, now: Date): Promise<number> {
  const moved = await affected(
    q,
    "UPDATE `live_session_library` SET `status` = 'waiting', `session_id` = NULL, `session_item_id` = NULL, `updated_at` = ? " +
      "WHERE `id` = ? AND `status` = 'on_agenda'",
    [now, libraryId],
  );
  if (sessionId != null) await q.query("DELETE FROM `live_session_library_takes` WHERE `library_id` = ? AND `session_id` = ?", [libraryId, sessionId]);
  return moved;
}

// ── One member: the export and the erasure ──────────────────────────────────

/** Everything this member brought. */
export async function memberRows(q: Queryable, no: number): Promise<RowDataPacket[]> {
  return rowsOf(q, `SELECT ${LIBRARY_COLUMNS} FROM \`live_session_library\` WHERE \`brought_by_no\` = ? ORDER BY \`id\``, [no]);
}

/** The notes this member wrote on items somebody else brought: their words, and nothing else of the item. */
export async function memberNoteRows(q: Queryable, no: number): Promise<RowDataPacket[]> {
  return rowsOf(q, "SELECT `id`, `note` FROM `live_session_library` WHERE `note_by_no` = ? AND `brought_by_no` <> ? ORDER BY `id`", [no, no]);
}

/** Every time this member put an item on an agenda. */
export async function memberTakeRows(q: Queryable, no: number): Promise<RowDataPacket[]> {
  return rowsOf(
    q,
    "SELECT `library_id`, `session_id`, `taken_at`, `outcome`, `settled_at` FROM `live_session_library_takes` WHERE `taken_by_no` = ? ORDER BY `id`",
    [no],
  );
}

/**
 * The member leaves the library. Their items go (their takes stay, holding no
 * words, `deleteItems`); where they put somebody else's item on an agenda the
 * take says 0; where they last changed somebody else's words the row says
 * nobody; and a note they wrote on somebody else's item goes, because those
 * were their words. The ids are read first with a plain read and written by
 * primary key, so nothing here scans and locks the whole table for the rest
 * of the erasure.
 */
export async function forgetMember(q: PoolConnection, no: number): Promise<void> {
  const own = (await rowsOf(q, "SELECT `id` FROM `live_session_library` WHERE `brought_by_no` = ?", [no])).map((r) => Number(r.id));
  await deleteItems(q, own);
  const took = (await rowsOf(q, "SELECT `id` FROM `live_session_library_takes` WHERE `taken_by_no` = ?", [no])).map((r) => Number(r.id));
  if (!none(took)) await q.query("UPDATE `live_session_library_takes` SET `taken_by_no` = 0 WHERE `id` IN (?)", [took]);
  const edited = (await rowsOf(q, "SELECT `id` FROM `live_session_library` WHERE `edited_by_no` = ?", [no])).map((r) => Number(r.id));
  if (!none(edited)) await q.query("UPDATE `live_session_library` SET `edited_by_no` = NULL WHERE `id` IN (?)", [edited]);
  const noted = (await rowsOf(q, "SELECT `id` FROM `live_session_library` WHERE `note_by_no` = ?", [no])).map((r) => Number(r.id));
  if (!none(noted)) await q.query("UPDATE `live_session_library` SET `note` = NULL, `note_by_no` = NULL WHERE `id` IN (?)", [noted]);
}
