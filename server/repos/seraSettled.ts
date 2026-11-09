/**
 * `saberra_settled` and `saberra_links` (`a_sera_difference_is_answered`): how each difference from the
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
 * ── THE ORDER LOCKS ARE TAKEN IN ─────────────────────────────────────────
 *
 * Every answer and every undo takes, in this order: the newest stored read
 * (exclusive), the drafts it may write to, our roles and circles, then the
 * answers. `publishDraft` takes the draft before the roles it writes, so the
 * two never wait on each other in a circle.
 *
 * The newest read is locked EXCLUSIVELY on purpose. It is the one row every
 * answer touches, so answers are serialised with each other: two takes never
 * open two drafts side by side, and an undo never races a take of the same
 * draft. Before `came_with` was indexed, the answers' own lock scanned the
 * whole table and serialised them by accident; this says it out loud.
 *
 * The actor's user id is the only personal datum, and `forgetSeraActor` is the
 * erasure's step for both tables.
 */
import type { Pool, PoolConnection, RowDataPacket } from "mysql2/promise";
import { ANSWERS, ANSWER_DOORS, type Answer, type AnswerDoor, type SettledRow } from "../../shared/seraSettle";

type Db = Pool | PoolConnection;

const ANSWER_COLUMNS =
  "difference_key, sera_hash, ours_hash, answer, door, by_role_id, actor_user_id, draft_id, draft_change_id, came_with, link_made, lapsed_at";

export interface AnswerRow extends SettledRow {
  draftChangeId: string | null;
  linkMade: boolean;
}

function toRow(r: RowDataPacket, drafts: ReadonlyMap<string, { status: string; title: string | null }>): AnswerRow {
  const answer = String(r.answer) as Answer;
  const door = String(r.door) as AnswerDoor;
  const draftId = r.draft_id ? String(r.draft_id) : null;
  const draft = draftId ? drafts.get(draftId) : undefined;
  return {
    key: String(r.difference_key),
    seraHash: String(r.sera_hash),
    oursHash: String(r.ours_hash),
    // A value this build does not know reads as undone, so it settles nothing.
    answer: ANSWERS.includes(answer) ? answer : "undone",
    door: ANSWER_DOORS.includes(door) ? door : "moderator",
    draftId,
    draftStatus: draft?.status ?? null,
    draftTitle: draft?.title ?? null,
    cameWith: r.came_with ? String(r.came_with) : null,
    draftChangeId: r.draft_change_id ? String(r.draft_change_id) : null,
    linkMade: Number(r.link_made) === 1,
    lapsed: r.lapsed_at !== null && r.lapsed_at !== undefined,
    actorUserId: r.actor_user_id ? String(r.actor_user_id) : null,
    byRoleId: r.by_role_id ? String(r.by_role_id) : null,
  };
}

async function draftsOf(db: Db, ids: readonly string[], lock: boolean): Promise<Map<string, { status: string; title: string | null }>> {
  if (ids.length === 0) return new Map();
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT id, status, title FROM org_drafts WHERE id IN (${ids.map(() => "?").join(",")}) ORDER BY id${lock ? " FOR UPDATE" : ""}`,
    [...ids],
  );
  return new Map(rows.map((r) => [String(r.id), { status: String(r.status), title: r.title ? String(r.title) : null }]));
}

const draftIdsIn = (rows: readonly RowDataPacket[]): string[] => Array.from(new Set(rows.map((r) => (r.draft_id ? String(r.draft_id) : "")).filter(Boolean))).sort();

/** Every answer, by its difference key, with its draft's status. One row per difference, so the read is bounded by the chart. */
export async function answersFor(pool: Db): Promise<Map<string, AnswerRow>> {
  const [rows] = await pool.query<RowDataPacket[]>(`SELECT ${ANSWER_COLUMNS} FROM saberra_settled`);
  const drafts = await draftsOf(pool, draftIdsIn(rows), false);
  return new Map(rows.map((r) => [String(r.difference_key), toRow(r, drafts)]));
}

/**
 * The drafts an answer may write to, locked for this transaction in id order
 * (R13): a publish of one of them waits until the answer commits, and an answer
 * waits for a publish already under way. Answers each one's status and title.
 */
export async function lockDrafts(conn: PoolConnection, ids: readonly string[]): Promise<Map<string, { status: string; title: string | null }>> {
  return draftsOf(conn, Array.from(new Set(ids)).sort(), true);
}

/**
 * The answers to these keys and every answer that came with them, locked for
 * this transaction (R14). Their drafts' statuses are read with the drafts
 * locked, which the caller has already done for every draft it may write.
 */
export async function lockAnswers(conn: PoolConnection, keys: readonly string[]): Promise<Map<string, AnswerRow>> {
  if (keys.length === 0) return new Map();
  const holes = keys.map(() => "?").join(",");
  const [rows] = await conn.query<RowDataPacket[]>(
    `SELECT ${ANSWER_COLUMNS} FROM saberra_settled WHERE difference_key IN (${holes}) OR came_with IN (${holes}) FOR UPDATE`,
    [...keys, ...keys],
  );
  const drafts = await draftsOf(conn, draftIdsIn(rows), true);
  return new Map(rows.map((r) => [String(r.difference_key), toRow(r, drafts)]));
}

/**
 * The drafts the answers to these keys sit in: which drafts an undo locks
 * first. A LOCKING read, on purpose: a plain read here would fix the
 * transaction's snapshot before the draft locks are held, and a publish that
 * commits while the undo waits for its draft would then be a row changed after
 * the snapshot (MariaDB's snapshot isolation refuses that read outright).
 */
export async function draftIdsForKeys(conn: PoolConnection, keys: readonly string[]): Promise<string[]> {
  if (keys.length === 0) return [];
  const holes = keys.map(() => "?").join(",");
  const [rows] = await conn.query<RowDataPacket[]>(
    `SELECT difference_key, draft_id FROM saberra_settled WHERE (difference_key IN (${holes}) OR came_with IN (${holes})) FOR UPDATE`,
    [...keys, ...keys],
  );
  return Array.from(new Set(rows.map((r) => (r.draft_id ? String(r.draft_id) : "")).filter(Boolean)));
}

/** The answers written against one draft's changes, locked: what an undo of a new circle must take out with it. */
export async function lockAnswersInDraft(conn: PoolConnection, draftId: string): Promise<Map<string, AnswerRow>> {
  const [rows] = await conn.query<RowDataPacket[]>(`SELECT ${ANSWER_COLUMNS} FROM saberra_settled WHERE draft_id = ? FOR UPDATE`, [draftId]);
  const drafts = await draftsOf(conn, [draftId], true);
  return new Map(rows.map((r) => [String(r.difference_key), toRow(r, drafts)]));
}

/**
 * The newest stored read of the service, locked EXCLUSIVELY until this
 * transaction ends (R14). The gap after it is locked too, so the sync's next
 * read waits to be kept until the answer has committed, and answers are
 * serialised with each other (the header says why). Null with no read.
 */
export async function lockNewestRead(conn: PoolConnection): Promise<number | null> {
  const [rows] = await conn.query<RowDataPacket[]>("SELECT seq FROM saberra_snapshots ORDER BY seq DESC LIMIT 1 FOR UPDATE");
  return rows[0] ? Number(rows[0].seq) : null;
}

/** Our roles and circles an answer is about, locked until it commits, so our side cannot move under the check either (R14). */
export async function lockChartRows(conn: PoolConnection, roleIds: readonly string[], circleIds: readonly string[]): Promise<void> {
  if (roleIds.length) await conn.query(`SELECT id FROM org_roles WHERE id IN (${roleIds.map(() => "?").join(",")}) ORDER BY id FOR UPDATE`, [...roleIds]);
  if (circleIds.length) await conn.query(`SELECT id FROM circles WHERE id IN (${circleIds.map(() => "?").join(",")}) ORDER BY id FOR UPDATE`, [...circleIds]);
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
  linkMade: boolean;
}

/** Write one answer, over whatever answered the same difference before. A fresh answer has not lapsed. */
export async function writeAnswer(conn: PoolConnection, a: AnswerWrite): Promise<void> {
  await conn.query(
    "INSERT INTO saberra_settled (difference_key, sera_hash, ours_hash, answer, door, by_role_id, actor_user_id, draft_id, draft_change_id, came_with, link_made, lapsed_at, answered_at) " +
      "VALUES (?,?,?,?,?,?,?,?,?,?,?,NULL,CURRENT_TIMESTAMP) ON DUPLICATE KEY UPDATE sera_hash = VALUES(sera_hash), ours_hash = VALUES(ours_hash), " +
      "answer = VALUES(answer), door = VALUES(door), by_role_id = VALUES(by_role_id), actor_user_id = VALUES(actor_user_id), " +
      "draft_id = VALUES(draft_id), draft_change_id = VALUES(draft_change_id), came_with = VALUES(came_with), link_made = VALUES(link_made), " +
      "lapsed_at = NULL, answered_at = CURRENT_TIMESTAMP",
    [a.key, a.seraHash, a.oursHash, a.answer, a.door, a.byRoleId, a.actorUserId, a.draftId, a.draftChangeId, a.cameWith, a.linkMade ? 1 : 0],
  );
}

/**
 * Take these answers back: each difference waits again. The row stays, as the
 * record that it was answered and undone, and it names who undid it and
 * through which door (R26), never the person who gave the answer.
 */
export async function markUndone(conn: PoolConnection, keys: readonly string[], by: { actorUserId: string | null; door: AnswerDoor; byRoleId: string | null }): Promise<void> {
  if (keys.length === 0) return;
  await conn.query(
    `UPDATE saberra_settled SET answer = 'undone', actor_user_id = ?, door = ?, by_role_id = ?, link_made = 0, answered_at = CURRENT_TIMESTAMP WHERE difference_key IN (${keys.map(() => "?").join(",")})`,
    [by.actorUserId, by.door, by.byRoleId, ...keys],
  );
}

/**
 * The answers whose difference has left the list since (R16, review 7): the
 * value they answered is no longer what the service says, so the same value
 * coming back later is a new suggestion. Says how many lapsed.
 */
export async function lapseAnswers(pool: Db, keys: readonly string[]): Promise<number> {
  if (keys.length === 0) return 0;
  const [res] = await pool.query<any>(
    `UPDATE saberra_settled SET lapsed_at = CURRENT_TIMESTAMP WHERE lapsed_at IS NULL AND difference_key IN (${keys.map(() => "?").join(",")})`,
    [...keys],
  );
  return Number(res?.affectedRows ?? 0);
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

/** Withdraw a draft the answers left with nothing in it, inside the same transaction. Answers whether it withdrew. */
export async function withdrawEmptyDraft(conn: PoolConnection, draftId: string): Promise<boolean> {
  const [res] = await conn.query<any>(
    "UPDATE org_drafts SET status = 'withdrawn' WHERE id = ? AND status = 'open' AND NOT EXISTS (SELECT 1 FROM org_draft_changes WHERE draft_id = ?)",
    [draftId, draftId],
  );
  return Number(res?.affectedRows ?? 0) > 0;
}

/**
 * A draft that now holds a person's own words is no longer the agent's alone
 * (review 11): its title and rationale say so, and it is a person's draft.
 */
export async function markDraftWritten(conn: PoolConnection, draftId: string, title: string, rationale: string): Promise<void> {
  await conn.query("UPDATE org_drafts SET title = ?, rationale = ?, source_kind = 'human' WHERE id = ? AND status = 'open'", [title.slice(0, 200), rationale, draftId]);
}

export interface DraftChangeRow {
  id: string;
  draftId: string;
  op: string;
  orgRoleId: string;
  payload: Record<string, unknown>;
}

const objectOf = (raw: unknown): Record<string, unknown> => {
  let v = raw;
  if (typeof v === "string") {
    try {
      v = JSON.parse(v);
    } catch {
      v = null;
    }
  }
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
};

/** Every change in these drafts, in the order publish applies them: what the draft card counts and shows (review 3, 11). */
export async function changesOfDrafts(db: Db, draftIds: readonly string[]): Promise<DraftChangeRow[]> {
  if (draftIds.length === 0) return [];
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT id, draft_id, op, org_role_id, payload FROM org_draft_changes WHERE draft_id IN (${draftIds.map(() => "?").join(",")}) ORDER BY draft_id, sort_order, id`,
    [...draftIds],
  );
  return rows.map((r) => ({ id: String(r.id), draftId: String(r.draft_id), op: String(r.op), orgRoleId: String(r.org_role_id), payload: objectOf(r.payload) }));
}

/** The names of our roles and circles, for describing a change whose difference has gone. */
export async function chartNames(db: Db, roleIds: readonly string[], circleIds: readonly string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (roleIds.length) {
    const [rows] = await db.query<RowDataPacket[]>(`SELECT id, name FROM org_roles WHERE id IN (${roleIds.map(() => "?").join(",")})`, [...roleIds]);
    for (const r of rows) out.set(String(r.id), String(r.name ?? r.id));
  }
  if (circleIds.length) {
    const [rows] = await db.query<RowDataPacket[]>(`SELECT id, name FROM circles WHERE id IN (${circleIds.map(() => "?").join(",")})`, [...circleIds]);
    for (const r of rows) out.set(`circle:${String(r.id)}`, String(r.name ?? r.id));
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
 * Answers whether this call made the link, which its undo unties (review 9).
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

/**
 * Untie a link an undone answer made (review 9). The answer made it only if no
 * link stood for that page id before (`INSERT IGNORE`, first wins), so the
 * link for that page id is the one it made.
 */
export async function removeLink(conn: PoolConnection, link: { kind: string; pk: string }): Promise<void> {
  await conn.query("DELETE FROM saberra_links WHERE subject_kind = ? AND page_key = ?", [link.kind, link.pk]);
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
  return rows.map((r) => ({ orgRoleId: String(r.org_role_id), op: String(r.op), payload: objectOf(r.payload), at: Number(r.at ?? 0) }));
}
