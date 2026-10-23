/**
 * `role_proposals` and `role_proposal_comments` (0273).
 *
 * Every statement role proposals run lives here, so the tables' readers and
 * writers stay enumerable: the route (server/routes/roleProposals.ts), the
 * member door's adopt check (server/routes/seatApplications.ts) and the
 * erasure step call these and hold no SQL of their own. The contract is
 * shared/roleProposals.ts.
 *
 * WHAT IS WRITTEN AFTER INSERT. A draft's body and target are rewritten while
 * it is a draft, guarded on `status = 'draft'`, so a save that loses a race
 * with the submit changes nothing. Submitting stamps `submitted_at` and
 * `application_id` once, under the same guard. The share columns move when
 * the owner turns the link on, off or makes a new one. Erasure clears what a
 * departed member wrote.
 *
 * Instants are written from Node's clock and read back with UNIX_TIMESTAMP, so
 * the database's own zone never moves one. Raw SQL only, never `dbCollection`.
 */
import type { Pool, PoolConnection, RowDataPacket } from "mysql2/promise";
import { bodyOf, type ProposalBody, type ProposalStatus, type ShareAudience } from "../../shared/roleProposals";
import type { ConsentAnswer } from "../../shared/roleProposalConsent";

type Db = Pool | PoolConnection;

export interface StoredProposal {
  id: string;
  userId: string;
  status: ProposalStatus;
  targetSeasonId: string | null;
  body: ProposalBody;
  shareToken: string | null;
  shareAudience: ShareAudience;
  applicationId: string | null;
  createdAt: Date;
  updatedAt: Date;
  submittedAt: Date | null;
  /** The decision record in words, once adopted (0276). */
  decidedWords: string | null;
}

const COLUMNS =
  "id, user_id, status, target_season_id, body_json, share_token, share_audience, application_id, " +
  "UNIX_TIMESTAMP(created_at) AS created_s, UNIX_TIMESTAMP(updated_at) AS updated_s, UNIX_TIMESTAMP(submitted_at) AS submitted_s, decided_words";

const json = (v: unknown): unknown => {
  if (v === null || v === undefined) return null;
  if (typeof v === "string") {
    try {
      return JSON.parse(v);
    } catch {
      return null;
    }
  }
  return v;
};

const fromSeconds = (v: unknown): Date | null => (v === null || v === undefined ? null : new Date(Number(v) * 1000));

function rowToProposal(r: any): StoredProposal {
  return {
    id: String(r.id),
    userId: String(r.user_id),
    status: r.status === "submitted" ? "submitted" : "draft",
    targetSeasonId: r.target_season_id ?? null,
    body: bodyOf(json(r.body_json)),
    shareToken: r.share_token ?? null,
    shareAudience: r.share_audience === "anyone" ? "anyone" : "members",
    applicationId: r.application_id ?? null,
    createdAt: fromSeconds(r.created_s) as Date,
    updatedAt: fromSeconds(r.updated_s) as Date,
    submittedAt: fromSeconds(r.submitted_s),
    decidedWords: r.decided_words ?? null,
  };
}

export async function insertProposal(db: Db, p: { id: string; userId: string; targetSeasonId: string | null; body: ProposalBody; now: Date }): Promise<void> {
  await db.query(
    "INSERT INTO role_proposals (id, user_id, status, target_season_id, body_json, share_audience, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)",
    [p.id, p.userId, "draft", p.targetSeasonId, JSON.stringify(p.body), "members", p.now, p.now],
  );
}

/** One proposal, or null. Pass a transaction's connection and `lock` to hold its row until commit. */
export async function readProposal(db: Db, id: string, lock = false): Promise<StoredProposal | null> {
  const [rows] = await db.query<RowDataPacket[]>(`SELECT ${COLUMNS} FROM role_proposals WHERE id = ?${lock ? " FOR UPDATE" : ""}`, [id]);
  return rows[0] ? rowToProposal(rows[0]) : null;
}

/** Every proposal one member wrote, newest first. */
export async function proposalsOf(db: Db, userId: string): Promise<StoredProposal[]> {
  const [rows] = await db.query<RowDataPacket[]>(`SELECT ${COLUMNS} FROM role_proposals WHERE user_id = ? ORDER BY created_at DESC, id DESC`, [userId]);
  return rows.map(rowToProposal);
}

/** The member's open draft, or null. A member keeps one draft at a time. */
export async function draftOf(db: Db, userId: string): Promise<StoredProposal | null> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT ${COLUMNS} FROM role_proposals WHERE user_id = ? AND status = 'draft' ORDER BY created_at DESC, id DESC LIMIT 1`,
    [userId],
  );
  return rows[0] ? rowToProposal(rows[0]) : null;
}

/** The proposal a share token opens, or null. */
export async function proposalByShareToken(db: Db, token: string): Promise<StoredProposal | null> {
  const [rows] = await db.query<RowDataPacket[]>(`SELECT ${COLUMNS} FROM role_proposals WHERE share_token = ?`, [token]);
  return rows[0] ? rowToProposal(rows[0]) : null;
}

/** Several proposals by id, in one read. */
export async function proposalsByIds(db: Db, ids: readonly string[]): Promise<StoredProposal[]> {
  if (!ids.length) return [];
  const [rows] = await db.query<RowDataPacket[]>(`SELECT ${COLUMNS} FROM role_proposals WHERE id IN (?)`, [[...ids]]);
  return rows.map(rowToProposal);
}

/** The proposals these applications came from, by application id, in one read. */
export async function proposalsForApplications(db: Db, applicationIds: readonly string[]): Promise<Map<string, StoredProposal>> {
  const out = new Map<string, StoredProposal>();
  if (!applicationIds.length) return out;
  const [rows] = await db.query<RowDataPacket[]>(`SELECT ${COLUMNS} FROM role_proposals WHERE application_id IN (?)`, [[...applicationIds]]);
  for (const r of rows) {
    const p = rowToProposal(r);
    if (p.applicationId) out.set(p.applicationId, p);
  }
  return out;
}

/** Rewrite a draft's body and target. False when it is no longer a draft. */
export async function writeDraft(db: Db, id: string, body: ProposalBody, targetSeasonId: string | null, now: Date): Promise<boolean> {
  const [r]: any = await db.query(
    "UPDATE role_proposals SET body_json = ?, target_season_id = ?, updated_at = ? WHERE id = ? AND status = 'draft'",
    [JSON.stringify(body), targetSeasonId, now, id],
  );
  return Number(r?.affectedRows ?? 0) > 0;
}

/** Set a draft's target season when it had none. False when it already had one or is not a draft. */
export async function settleTarget(db: Db, id: string, targetSeasonId: string): Promise<boolean> {
  const [r]: any = await db.query(
    "UPDATE role_proposals SET target_season_id = ? WHERE id = ? AND status = 'draft' AND target_season_id IS NULL",
    [targetSeasonId, id],
  );
  return Number(r?.affectedRows ?? 0) > 0;
}

/** Delete a draft and the feedback on it. The owner's act only; a submitted proposal stays. */
export async function deleteDraft(db: Db, id: string, userId: string): Promise<boolean> {
  const [r]: any = await db.query("DELETE FROM role_proposals WHERE id = ? AND user_id = ? AND status = 'draft'", [id, userId]);
  const gone = Number(r?.affectedRows ?? 0) > 0;
  if (gone) await db.query("DELETE FROM role_proposal_comments WHERE proposal_id = ?", [id]);
  return gone;
}

/** Turn the link on with this token, off with null, and set who it opens to. */
export async function setShare(db: Db, id: string, token: string | null, audience: ShareAudience): Promise<void> {
  await db.query("UPDATE role_proposals SET share_token = ?, share_audience = ? WHERE id = ?", [token, audience, id]);
}

/** Stamp a draft submitted, inside the transaction that wrote its application. False when it was not a draft. */
export async function markSubmitted(db: Db, id: string, applicationId: string, now: Date): Promise<boolean> {
  const [r]: any = await db.query(
    "UPDATE role_proposals SET status = 'submitted', application_id = ?, submitted_at = ?, updated_at = ? WHERE id = ? AND status = 'draft'",
    [applicationId, now, now, id],
  );
  return Number(r?.affectedRows ?? 0) > 0;
}

/**
 * The village's circles, its own and never the standing examples, with
 * whether each is live. A new role is proposed into a live circle only.
 */
export async function villageCircles(db: Db): Promise<Array<{ id: string; name: string; live: boolean }>> {
  const [rows] = await db.query<RowDataPacket[]>("SELECT id, name, status FROM circles WHERE is_example = 0 ORDER BY name, id");
  return rows.map((r: any) => ({ id: String(r.id), name: String(r.name ?? r.id), live: String(r.status ?? "active") !== "dormant" }));
}

// ── Comments ────────────────────────────────────────────────────────────────

export interface StoredComment {
  id: string;
  proposalId: string;
  authorId: string | null;
  body: string;
  createdAt: Date;
}

const toComment = (r: any): StoredComment => ({
  id: String(r.id),
  proposalId: String(r.proposal_id),
  authorId: r.author_id ?? null,
  body: String(r.body ?? ""),
  createdAt: fromSeconds(r.created_s) as Date,
});

export async function insertComment(db: Db, c: { id: string; proposalId: string; authorId: string; body: string; now: Date }): Promise<void> {
  await db.query("INSERT INTO role_proposal_comments (id, proposal_id, author_id, body, created_at) VALUES (?,?,?,?,?)", [
    c.id,
    c.proposalId,
    c.authorId,
    c.body,
    c.now,
  ]);
}

/** The feedback on a proposal, oldest first. With `authorId`, only that member's. */
export async function commentsOn(db: Db, proposalId: string, authorId?: string): Promise<StoredComment[]> {
  const [rows] = await db.query<RowDataPacket[]>(
    "SELECT id, proposal_id, author_id, body, UNIX_TIMESTAMP(created_at) AS created_s FROM role_proposal_comments " +
      `WHERE proposal_id = ?${authorId ? " AND author_id = ?" : ""} ORDER BY created_at, id`,
    authorId ? [proposalId, authorId] : [proposalId],
  );
  return rows.map(toComment);
}

// ── The circle's asks (0276) ────────────────────────────────────────────────

export interface StoredAsk {
  proposalId: string;
  userId: string;
  circleId: string;
  askedAt: Date;
  closesAt: Date;
  answer: ConsentAnswer | null;
  reason: string | null;
  answeredAt: Date | null;
  circleEntryId: number | null;
}

const ASK_COLUMNS =
  "proposal_id, user_id, circle_id, UNIX_TIMESTAMP(asked_at) AS asked_s, UNIX_TIMESTAMP(closes_at) AS closes_s, answer, reason, " +
  "UNIX_TIMESTAMP(answered_at) AS answered_s, circle_entry_id";

const toAsk = (r: any): StoredAsk => ({
  proposalId: String(r.proposal_id),
  userId: String(r.user_id),
  circleId: String(r.circle_id),
  askedAt: fromSeconds(r.asked_s) as Date,
  closesAt: fromSeconds(r.closes_s) as Date,
  answer: r.answer === "consent" || r.answer === "object" ? r.answer : null,
  reason: r.reason ?? null,
  answeredAt: fromSeconds(r.answered_s),
  circleEntryId: r.circle_entry_id === null || r.circle_entry_id === undefined ? null : Number(r.circle_entry_id),
});

/** Ask each holder once. Inside the submit's own transaction, so a proposal is never submitted half asked. */
export async function insertAsks(db: Db, rows: ReadonlyArray<{ proposalId: string; userId: string; circleId: string; askedAt: Date; closesAt: Date }>): Promise<void> {
  if (!rows.length) return;
  await db.query(
    `INSERT INTO role_proposal_asks (proposal_id, user_id, circle_id, asked_at, closes_at) VALUES ${rows.map(() => "(?,?,?,?,?)").join(",")}`,
    rows.flatMap((r) => [r.proposalId, r.userId, r.circleId, r.askedAt, r.closesAt]),
  );
}

/** Every ask on these proposals, by proposal id, in one read. */
export async function asksFor(db: Db, proposalIds: readonly string[]): Promise<Map<string, StoredAsk[]>> {
  const out = new Map<string, StoredAsk[]>();
  if (!proposalIds.length) return out;
  const [rows] = await db.query<RowDataPacket[]>(`SELECT ${ASK_COLUMNS} FROM role_proposal_asks WHERE proposal_id IN (?) ORDER BY asked_at, user_id`, [[...proposalIds]]);
  for (const r of rows) {
    const a = toAsk(r);
    const list = out.get(a.proposalId) ?? [];
    list.push(a);
    out.set(a.proposalId, list);
  }
  return out;
}

/** The asks a holder has not answered, oldest first. */
export async function openAsksOf(db: Db, userId: string): Promise<StoredAsk[]> {
  const [rows] = await db.query<RowDataPacket[]>(`SELECT ${ASK_COLUMNS} FROM role_proposal_asks WHERE user_id = ? AND answer IS NULL ORDER BY asked_at, proposal_id`, [userId]);
  return rows.map(toAsk);
}

/** One ask, locked when handed a transaction's connection. */
export async function readAsk(db: Db, proposalId: string, userId: string, lock = false): Promise<StoredAsk | null> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT ${ASK_COLUMNS} FROM role_proposal_asks WHERE proposal_id = ? AND user_id = ?${lock ? " FOR UPDATE" : ""}`,
    [proposalId, userId],
  );
  return rows[0] ? toAsk(rows[0]) : null;
}

/** Record an answer once. False when it was answered already. */
export async function writeAnswer(
  db: Db,
  a: { proposalId: string; userId: string; answer: ConsentAnswer; reason: string | null; circleEntryId: number | null; now: Date },
): Promise<boolean> {
  const [r]: any = await db.query(
    "UPDATE role_proposal_asks SET answer = ?, reason = ?, circle_entry_id = ?, answered_at = ? WHERE proposal_id = ? AND user_id = ? AND answer IS NULL",
    [a.answer, a.reason, a.circleEntryId, a.now, a.proposalId, a.userId],
  );
  return Number(r?.affectedRows ?? 0) > 0;
}

/** Write the decision record once, when the proposal is adopted. */
export async function setDecidedWords(db: Db, id: string, words: string): Promise<void> {
  await db.query("UPDATE role_proposals SET decided_words = ? WHERE id = ? AND decided_words IS NULL", [words.slice(0, 200), id]);
}

/** Every proposal's owner, status and season, for the nudge sweep. One read. */
export async function proposalSeasons(db: Db): Promise<Array<{ userId: string; status: ProposalStatus; targetSeasonId: string | null; applicationId: string | null; body: ProposalBody }>> {
  const [rows] = await db.query<RowDataPacket[]>("SELECT user_id, status, target_season_id, application_id, body_json FROM role_proposals");
  return rows.map((r: any) => ({
    userId: String(r.user_id),
    status: r.status === "submitted" ? "submitted" : "draft",
    targetSeasonId: r.target_season_id ?? null,
    applicationId: r.application_id ?? null,
    body: bodyOf(json(r.body_json)),
  }));
}

/**
 * The live member holders of the roles in these circles, each with the
 * circles they hold in. One read; examples and documented holders left out.
 */
export async function holdersInCircles(db: Db, circleIds: readonly string[]): Promise<Array<{ userId: string; circleId: string; roleId: string }>> {
  if (!circleIds.length) return [];
  const [rows] = await db.query<RowDataPacket[]>(
    "SELECT a.user_id, r.circle_id, a.org_role_id FROM org_role_assignments a JOIN org_roles r ON r.id = a.org_role_id " +
      "WHERE a.ended_at IS NULL AND a.holder_kind = 'member' AND a.is_example = 0 AND a.user_id IS NOT NULL AND r.is_example = 0 AND r.active = 1 AND r.circle_id IN (?) " +
      "ORDER BY a.started_at, a.id",
    [[...circleIds]],
  );
  return rows.map((r: any) => ({ userId: String(r.user_id), circleId: String(r.circle_id), roleId: String(r.org_role_id) }));
}

// ── Erasure ─────────────────────────────────────────────────────────────────

/**
 * A member who leaves the village: their drafts go, with the feedback on them;
 * the words of a proposal they submitted go too, since the application keeps
 * the record of what was decided; and every comment they left on somebody
 * else's proposal stays, naming nobody.
 */
export async function forgetMemberProposals(db: Db, userId: string): Promise<{ drafts: number; comments: number }> {
  await db.query("DELETE FROM role_proposal_comments WHERE proposal_id IN (SELECT id FROM role_proposals WHERE user_id = ? AND status = 'draft')", [userId]);
  const [d]: any = await db.query("DELETE FROM role_proposals WHERE user_id = ? AND status = 'draft'", [userId]);
  await db.query("UPDATE role_proposals SET body_json = NULL, share_token = NULL WHERE user_id = ?", [userId]);
  const [c]: any = await db.query("UPDATE role_proposal_comments SET author_id = NULL WHERE author_id = ?", [userId]);
  // Taken off every ask they held, their reasons with them (0276). A decision already reads in its words.
  await db.query("DELETE FROM role_proposal_asks WHERE user_id = ?", [userId]);
  return { drafts: Number(d?.affectedRows ?? 0), comments: Number(c?.affectedRows ?? 0) };
}
