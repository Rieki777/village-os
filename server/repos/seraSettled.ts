/**
 * `saberra_settled` and `saberra_links` (0350): how each difference from the
 * outside service was answered, and the page ids a person tied to our circles
 * and roles.
 *
 * Hashes and ids only, never the words (spec R6). The writes run on the
 * connection of the answer's own transaction (server/lib/seraAnswer.ts), so
 * every function that writes takes a connection, and each read that locks
 * says so in its name. The draft's status is read beside each answer, because
 * the draft's own status is what says whether a take waits, is live, or is
 * open again (shared/seraSettle.ts, R13).
 *
 * The actor's user id is the only personal datum, and `forgetSeraActor` is the
 * erasure's step for both tables.
 */
import type { Pool, PoolConnection, RowDataPacket } from "mysql2/promise";
import { ANSWERS, ANSWER_DOORS, type Answer, type AnswerDoor, type SettledRow } from "../../shared/seraSettle";

type Db = Pool | PoolConnection;

const SELECT_ANSWERS =
  "SELECT s.difference_key, s.sera_hash, s.ours_hash, s.answer, s.door, s.draft_id, s.came_with, s.draft_change_id, d.status AS draft_status, d.title AS draft_title " +
  "FROM saberra_settled s LEFT JOIN org_drafts d ON d.id = s.draft_id";

export interface AnswerRow extends SettledRow {
  draftChangeId: string | null;
}

function toRow(r: RowDataPacket): AnswerRow {
  const answer = String(r.answer) as Answer;
  const door = String(r.door) as AnswerDoor;
  return {
    key: String(r.difference_key),
    seraHash: String(r.sera_hash),
    oursHash: String(r.ours_hash),
    // A value this build does not know reads as undone, so it settles nothing.
    answer: ANSWERS.includes(answer) ? answer : "undone",
    door: ANSWER_DOORS.includes(door) ? door : "moderator",
    draftId: r.draft_id ? String(r.draft_id) : null,
    draftStatus: r.draft_status ? String(r.draft_status) : null,
    draftTitle: r.draft_title ? String(r.draft_title) : null,
    cameWith: r.came_with ? String(r.came_with) : null,
    draftChangeId: r.draft_change_id ? String(r.draft_change_id) : null,
  };
}

/** Every answer, by its difference key, with its draft's status. One row per difference, so the read is bounded by the chart. */
export async function answersFor(pool: Db): Promise<Map<string, AnswerRow>> {
  const [rows] = await pool.query<RowDataPacket[]>(SELECT_ANSWERS);
  return new Map(rows.map((r) => [String(r.difference_key), toRow(r)]));
}

/**
 * The answers to these keys and every answer that came with them, locked for
 * this transaction with the drafts they name (R14): a publish of that draft
 * waits until this commits.
 */
export async function lockAnswers(conn: PoolConnection, keys: readonly string[]): Promise<Map<string, AnswerRow>> {
  if (keys.length === 0) return new Map();
  const holes = keys.map(() => "?").join(",");
  const [rows] = await conn.query<RowDataPacket[]>(`${SELECT_ANSWERS} WHERE s.difference_key IN (${holes}) OR s.came_with IN (${holes}) FOR UPDATE`, [...keys, ...keys]);
  return new Map(rows.map((r) => [String(r.difference_key), toRow(r)]));
}

/**
 * The newest stored read of the service, locked for shared use until this
 * transaction ends (R14). The gap after it is locked too, so the sync's next
 * read waits to be kept until the answer has committed, and the service's
 * side cannot move under a check that already passed. Null with no read.
 */
export async function lockNewestRead(conn: PoolConnection): Promise<number | null> {
  const [rows] = await conn.query<RowDataPacket[]>("SELECT seq FROM saberra_snapshots ORDER BY seq DESC LIMIT 1 LOCK IN SHARE MODE");
  return rows[0] ? Number(rows[0].seq) : null;
}

/** Our roles and circles an answer is about, locked until it commits, so our side cannot move under the check either (R14). */
export async function lockChartRows(conn: PoolConnection, roleIds: readonly string[], circleIds: readonly string[]): Promise<void> {
  if (roleIds.length) await conn.query(`SELECT id FROM org_roles WHERE id IN (${roleIds.map(() => "?").join(",")}) FOR UPDATE`, [...roleIds]);
  if (circleIds.length) await conn.query(`SELECT id FROM circles WHERE id IN (${circleIds.map(() => "?").join(",")}) FOR UPDATE`, [...circleIds]);
}

export interface AnswerWrite {
  key: string;
  seraHash: string;
  oursHash: string;
  answer: Answer;
  door: AnswerDoor;
  byRoleId: string | null;
  actorUserId: string | null;
  draftId: string | null;
  draftChangeId: string | null;
  cameWith: string | null;
}

/** Write one answer, over whatever answered the same difference before. */
export async function writeAnswer(conn: PoolConnection, a: AnswerWrite): Promise<void> {
  await conn.query(
    "INSERT INTO saberra_settled (difference_key, sera_hash, ours_hash, answer, door, by_role_id, actor_user_id, draft_id, draft_change_id, came_with, answered_at) " +
      "VALUES (?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP) ON DUPLICATE KEY UPDATE sera_hash = VALUES(sera_hash), ours_hash = VALUES(ours_hash), " +
      "answer = VALUES(answer), door = VALUES(door), by_role_id = VALUES(by_role_id), actor_user_id = VALUES(actor_user_id), " +
      "draft_id = VALUES(draft_id), draft_change_id = VALUES(draft_change_id), came_with = VALUES(came_with), answered_at = CURRENT_TIMESTAMP",
    [a.key, a.seraHash, a.oursHash, a.answer, a.door, a.byRoleId, a.actorUserId, a.draftId, a.draftChangeId, a.cameWith],
  );
}

/** Take these answers back: each difference waits again. The row stays, as the record that it was answered and undone. */
export async function markUndone(conn: PoolConnection, keys: readonly string[], actorUserId: string | null): Promise<void> {
  if (keys.length === 0) return;
  await conn.query(
    `UPDATE saberra_settled SET answer = 'undone', actor_user_id = ?, answered_at = CURRENT_TIMESTAMP WHERE difference_key IN (${keys.map(() => "?").join(",")})`,
    [actorUserId, ...keys],
  );
}

/**
 * Remove changes an answer put in a draft, only while that draft is still
 * open (R15): a published or withdrawn draft is a record and is never edited.
 * Says how many went.
 */
export async function removeDraftChanges(conn: PoolConnection, draftId: string, changeIds: readonly string[]): Promise<number> {
  if (changeIds.length === 0) return 0;
  const [res] = await conn.query<any>(
    `DELETE c FROM org_draft_changes c JOIN org_drafts d ON d.id = c.draft_id WHERE d.id = ? AND d.status = 'open' AND c.id IN (${changeIds.map(() => "?").join(",")})`,
    [draftId, ...changeIds],
  );
  return Number(res?.affectedRows ?? 0);
}

/** How many changes a draft holds. */
export async function draftChangeCount(pool: Db, draftId: string): Promise<number> {
  const [rows] = await pool.query<RowDataPacket[]>("SELECT COUNT(*) AS n FROM org_draft_changes WHERE draft_id = ?", [draftId]);
  return Number(rows[0]?.n ?? 0);
}

/** The circles an open draft makes for the service's new circles, by the service's page key, so a new role can be put in one. */
export async function draftCirclesOf(pool: Db, draftId: string): Promise<Map<string, string>> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT s.difference_key, c.org_role_id FROM saberra_settled s JOIN org_draft_changes c ON c.id = s.draft_change_id " +
      "WHERE s.draft_id = ? AND s.answer IN ('taken','edited') AND c.op = 'create_circle'",
    [draftId],
  );
  const out = new Map<string, string>();
  for (const r of rows) {
    const key = String(r.difference_key);
    const pk = key.startsWith("circle:") ? key.split(":")[1] ?? "" : "";
    const id = String(r.org_role_id);
    if (pk) out.set(pk, id.startsWith("circle:") ? id.slice("circle:".length) : id);
  }
  return out;
}

// ── The links (R1) ──────────────────────────────────────────────────────────

/** Every stored link, as the differences read them: page key to our id, per kind. */
export async function linksFor(pool: Db): Promise<{ circles: Record<string, string>; roles: Record<string, string> }> {
  const [rows] = await pool.query<RowDataPacket[]>("SELECT subject_kind, page_key, our_id FROM saberra_links");
  const out = { circles: {} as Record<string, string>, roles: {} as Record<string, string> };
  for (const r of rows) {
    if (String(r.subject_kind) === "circle") out.circles[String(r.page_key)] = String(r.our_id);
    else if (String(r.subject_kind) === "role") out.roles[String(r.page_key)] = String(r.our_id);
  }
  return out;
}

/**
 * Tie a page id to one of ours, the first time a person answers about it (R1).
 * Never over an existing link, and never when another page id is already tied
 * to the same one of ours: something two records claim is never matched.
 */
export async function writeLink(
  conn: PoolConnection,
  link: { kind: "circle" | "role"; pageKey: string; ourId: string; setBy: "take" | "keep"; actorUserId: string | null },
): Promise<boolean> {
  const [taken] = await conn.query<RowDataPacket[]>(
    "SELECT page_key FROM saberra_links WHERE subject_kind = ? AND our_id = ? AND page_key <> ? LIMIT 1",
    [link.kind, link.ourId, link.pageKey],
  );
  if (taken.length) return false;
  const [res] = await conn.query<any>(
    "INSERT IGNORE INTO saberra_links (subject_kind, page_key, our_id, set_by, actor_user_id) VALUES (?,?,?,?,?)",
    [link.kind, link.pageKey, link.ourId, link.setBy, link.actorUserId],
  );
  return Number(res?.affectedRows ?? 0) > 0;
}

// ── Erasure ─────────────────────────────────────────────────────────────────

/** The erasure's step: the answers and links stay as the village's record, and no longer say who gave them. */
export async function forgetSeraActor(pool: Db, userId: string): Promise<number> {
  const [a] = await pool.query<any>("UPDATE saberra_settled SET actor_user_id = NULL WHERE actor_user_id = ?", [userId]);
  const [b] = await pool.query<any>("UPDATE saberra_links SET actor_user_id = NULL WHERE actor_user_id = ?", [userId]);
  return Number(a?.affectedRows ?? 0) + Number(b?.affectedRows ?? 0);
}

// ── When our side last changed (the conflict's subtitle) ────────────────────

/**
 * The published changes that set a role's name or words, newest first, with
 * when each went live. Read for the conflicts only, so the page can say when
 * somebody here rewrote a field, and only where the change is what stands now.
 */
export async function publishedRoleChanges(
  pool: Db,
  roleIds: readonly string[],
): Promise<Array<{ orgRoleId: string; op: string; payload: Record<string, unknown>; at: number }>> {
  if (roleIds.length === 0) return [];
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT c.org_role_id, c.op, c.payload, UNIX_TIMESTAMP(d.published_at) AS at FROM org_draft_changes c JOIN org_drafts d ON d.id = c.draft_id " +
      `WHERE d.status = 'published' AND c.op IN ('create_seat','update_seat') AND c.org_role_id IN (${roleIds.map(() => "?").join(",")}) ` +
      "ORDER BY d.published_at DESC, c.sort_order DESC LIMIT 500",
    [...roleIds],
  );
  return rows.map((r) => {
    let payload: unknown = r.payload;
    if (typeof payload === "string") {
      try {
        payload = JSON.parse(payload);
      } catch {
        payload = null;
      }
    }
    return {
      orgRoleId: String(r.org_role_id),
      op: String(r.op),
      payload: payload && typeof payload === "object" && !Array.isArray(payload) ? (payload as Record<string, unknown>) : {},
      at: Number(r.at ?? 0),
    };
  });
}
