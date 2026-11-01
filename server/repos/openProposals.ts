/**
 * `open_role_proposals` and `open_proposal_links` (0305). Every statement
 * open proposals run lives here, so the tables' readers and writers stay
 * enumerable: the route (server/routes/openProposals.ts) and its tidy job call
 * these and hold no SQL of their own. The contract is shared/openProposals.ts.
 *
 * Instants are written from Node's clock and read back with UNIX_TIMESTAMP,
 * as server/repos/roleProposals.ts does, so the database's own zone never
 * moves one. Raw SQL only, never `dbCollection`.
 *
 * THE DECISION RIDES IN THE BODY (part B). An adoption is recorded in words
 * that name a role, and under the authority it was made by (`org.seat@<role
 * id>`), and the account the invitation later makes carries that authority.
 * Both are written once, with the status, as two plain keys of `body_json`
 * (`decidedWords`, `decidedAuthority`), so part B needs no migration. The
 * body's reader (`openBodyOf`) never sees them, and they name nobody, so the
 * tidy job's anonymising leaves them as they are.
 */
import type { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { openBodyOf, OPEN_PROPOSAL_STATUSES, type OpenProposalBody, type OpenProposalStatus } from "../../shared/openProposals";
import type { OpenDecision } from "../../shared/openProposalDecide";

type Db = Pool | PoolConnection;

export interface StoredOpenProposal {
  id: string;
  name: string | null;
  email: string | null;
  status: OpenProposalStatus;
  targetSeasonId: string | null;
  body: OpenProposalBody;
  linkId: string | null;
  createdAt: Date;
  confirmedAt: Date | null;
  decidedAt: Date | null;
  /** The decision in words and the authority it was made under, once decided (part B). */
  decision: OpenDecision;
}

const COLUMNS =
  "id, name, email, status, target_season_id, body_json, link_id, " +
  "UNIX_TIMESTAMP(created_at) AS created_s, UNIX_TIMESTAMP(confirmed_at) AS confirmed_s, UNIX_TIMESTAMP(decided_at) AS decided_s";

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

const textOr = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);

/** The decision kept in the body, whatever else the body holds. Never throws. */
function decisionOf(raw: unknown): OpenDecision {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return { words: textOr(o.decidedWords), authority: textOr(o.decidedAuthority) };
}

function rowOf(r: any): StoredOpenProposal {
  const status = (OPEN_PROPOSAL_STATUSES as readonly string[]).includes(String(r.status)) ? (r.status as OpenProposalStatus) : "unconfirmed";
  return {
    id: String(r.id),
    name: r.name ?? null,
    email: r.email ?? null,
    status,
    targetSeasonId: r.target_season_id ?? null,
    body: openBodyOf(json(r.body_json)),
    linkId: r.link_id ?? null,
    createdAt: fromSeconds(r.created_s) as Date,
    confirmedAt: fromSeconds(r.confirmed_s),
    decidedAt: fromSeconds(r.decided_s),
    decision: decisionOf(json(r.body_json)),
  };
}

export async function insertOpenProposal(
  db: Db,
  p: { id: string; name: string; email: string; emailKey: string; targetSeasonId: string | null; body: OpenProposalBody; confirmHash: string; linkId: string | null; now: Date },
): Promise<void> {
  await db.query(
    "INSERT INTO open_role_proposals (id, name, email, email_key, status, target_season_id, body_json, confirm_hash, link_id, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
    [p.id, p.name, p.email, p.emailKey, "unconfirmed", p.targetSeasonId, JSON.stringify(p.body), p.confirmHash, p.linkId, p.now],
  );
}

/** One proposal, or null. Pass a transaction's connection and `lock` to hold its row until commit. */
export async function readOpenProposal(db: Db, id: string, lock = false): Promise<StoredOpenProposal | null> {
  const [rows] = await db.query<RowDataPacket[]>(`SELECT ${COLUMNS} FROM open_role_proposals WHERE id = ? LIMIT 1${lock ? " FOR UPDATE" : ""}`, [id]);
  return rows[0] ? rowOf(rows[0]) : null;
}

/** Several proposals by id, in one read. */
export async function openProposalsByIds(db: Db, ids: readonly string[]): Promise<StoredOpenProposal[]> {
  if (!ids.length) return [];
  const [rows] = await db.query<RowDataPacket[]>(`SELECT ${COLUMNS} FROM open_role_proposals WHERE id IN (?)`, [[...ids]]);
  return rows.map(rowOf);
}

/**
 * DECIDE A CONFIRMED PROPOSAL, once (part B): adopted or declined, the moment
 * it was decided, and the decision kept in the body. Guarded on `confirmed`, so
 * of two deciders at once exactly one moves it. True when this call did.
 */
export async function decideOpenProposal(
  db: Db,
  id: string,
  to: "adopted" | "declined",
  decision: OpenDecision,
  now: Date,
): Promise<boolean> {
  const [result] = await db.query<ResultSetHeader>(
    "UPDATE open_role_proposals SET status = ?, decided_at = ?, " +
      "body_json = JSON_SET(COALESCE(body_json, JSON_OBJECT()), '$.decidedWords', ?, '$.decidedAuthority', ?) " +
      "WHERE id = ? AND status = 'confirmed'",
    [to, now, decision.words ?? "", decision.authority ?? "", id],
  );
  return Number(result.affectedRows ?? 0) === 1;
}

/**
 * Confirm the proposal a token's hash names: only an unconfirmed one made after
 * `notBefore`, and only once, because the hash is cleared as it is used. The
 * proposal it confirmed, or null.
 */
export async function confirmOpenProposal(db: Db, confirmHash: string, notBefore: Date, now: Date): Promise<StoredOpenProposal | null> {
  const [rows] = await db.query<RowDataPacket[]>(
    "SELECT id FROM open_role_proposals WHERE confirm_hash = ? AND status = 'unconfirmed' AND created_at > ? LIMIT 1",
    [confirmHash, notBefore],
  );
  const id = rows[0]?.id ? String(rows[0].id) : null;
  if (!id) return null;
  const [result] = await db.query<ResultSetHeader>(
    "UPDATE open_role_proposals SET status = 'confirmed', confirmed_at = ?, confirm_hash = NULL WHERE id = ? AND status = 'unconfirmed' AND confirm_hash = ?",
    [now, id, confirmHash],
  );
  if (Number(result.affectedRows ?? 0) !== 1) return null;
  return readOpenProposal(db, id);
}

/**
 * Put an adoption back, when the place it was to make could not be made: the
 * proposal waits on the village again, its decision cleared. Guarded on
 * `adopted`, and only ever called by the request that adopted it.
 */
export async function undoAdoption(db: Db, id: string): Promise<boolean> {
  const [result] = await db.query<ResultSetHeader>(
    "UPDATE open_role_proposals SET status = 'confirmed', decided_at = NULL, " +
      "body_json = JSON_REMOVE(COALESCE(body_json, JSON_OBJECT()), '$.decidedWords', '$.decidedAuthority') WHERE id = ? AND status = 'adopted'",
    [id],
  );
  return Number(result.affectedRows ?? 0) === 1;
}

/** The proposals waiting with the village, or in any one status, oldest first. */
export async function listOpenProposals(db: Db, statuses: readonly OpenProposalStatus[], limit = 200): Promise<StoredOpenProposal[]> {
  if (statuses.length === 0) return [];
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT ${COLUMNS} FROM open_role_proposals WHERE status IN (${statuses.map(() => "?").join(",")}) ORDER BY created_at, id LIMIT ?`,
    [...statuses, Math.max(1, Math.trunc(limit))],
  );
  return rows.map(rowOf);
}

/** Delete one proposal nobody could confirm, because its confirmation never went. Only while it is unconfirmed. */
export async function deleteOpenProposal(db: Db, id: string): Promise<void> {
  await db.query("DELETE FROM open_role_proposals WHERE id = ? AND status = 'unconfirmed'", [id]);
}

/** Delete every proposal still unconfirmed that was made before `before`. How many went. */
export async function deleteUnconfirmedBefore(db: Db, before: Date): Promise<number> {
  const [result] = await db.query<ResultSetHeader>("DELETE FROM open_role_proposals WHERE status = 'unconfirmed' AND created_at < ?", [before]);
  return Number(result.affectedRows ?? 0);
}

/** Take the name and address off every declined or withdrawn proposal decided before `before`. How many. */
export async function anonymiseDecidedBefore(db: Db, before: Date, now: Date): Promise<number> {
  const [result] = await db.query<ResultSetHeader>(
    "UPDATE open_role_proposals SET name = NULL, email = NULL, email_key = NULL, anonymised_at = ? " +
      "WHERE status IN ('declined', 'withdrawn') AND decided_at < ? AND anonymised_at IS NULL",
    [now, before],
  );
  return Number(result.affectedRows ?? 0);
}

// ── Links made for one person ───────────────────────────────────────────────

export interface StoredOpenLink {
  id: string;
  label: string;
  createdBy: string;
  createdAt: Date;
  revokedAt: Date | null;
}

const LINK_COLUMNS = "id, label, created_by, UNIX_TIMESTAMP(created_at) AS created_s, UNIX_TIMESTAMP(revoked_at) AS revoked_s";

const linkOf = (r: any): StoredOpenLink => ({
  id: String(r.id),
  label: String(r.label ?? ""),
  createdBy: String(r.created_by ?? ""),
  createdAt: fromSeconds(r.created_s) as Date,
  revokedAt: fromSeconds(r.revoked_s),
});

export async function insertOpenLink(db: Db, l: { id: string; tokenHash: string; label: string; createdBy: string; now: Date }): Promise<void> {
  await db.query("INSERT INTO open_proposal_links (id, token_hash, label, created_by, created_at) VALUES (?,?,?,?,?)", [l.id, l.tokenHash, l.label, l.createdBy, l.now]);
}

/** The link a token's hash names, only while it is switched on. */
export async function openLinkByHash(db: Db, tokenHash: string): Promise<StoredOpenLink | null> {
  const [rows] = await db.query<RowDataPacket[]>(`SELECT ${LINK_COLUMNS} FROM open_proposal_links WHERE token_hash = ? AND revoked_at IS NULL LIMIT 1`, [tokenHash]);
  return rows[0] ? linkOf(rows[0]) : null;
}

export async function listOpenLinks(db: Db, limit = 200): Promise<StoredOpenLink[]> {
  const [rows] = await db.query<RowDataPacket[]>(`SELECT ${LINK_COLUMNS} FROM open_proposal_links ORDER BY created_at DESC, id LIMIT ?`, [Math.max(1, Math.trunc(limit))]);
  return rows.map(linkOf);
}

/** Switch a link off. True when it was on. */
export async function revokeOpenLink(db: Db, id: string, now: Date): Promise<boolean> {
  const [result] = await db.query<ResultSetHeader>("UPDATE open_proposal_links SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL", [now, id]);
  return Number(result.affectedRows ?? 0) === 1;
}
