/**
 * THE GRANTS THAT WAIT FOR A SECOND SIGNATURE (`admin_mint_requests`, 0106).
 *
 * Moved out of the two admin routes in server/index.ts when a village vote
 * became the second way to decide one (vote-path gap 8). The decisions live in
 * server/lib/mintRequests.ts; this file holds the statements, so the one
 * question "who else writes this table" has one place to be answered.
 *
 * EVERY DECISION IS A GUARDED CLAIM. Each write carries `status = 'pending'` in
 * its WHERE, so two deciders pressing at once (two stewards, or a steward and
 * a landing vote) both pass their read and only one wins the row. The caller
 * reads the affected-rows count and tells the loser.
 */
import type { Pool, RowDataPacket } from "mysql2/promise";

export interface MintRequestRow {
  id: string;
  tokenSlug: string;
  toUserId: string;
  amount: number;
  reason: string;
  requestedBy: string;
  requestedAt: string | null;
  status: string;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
}

const COLUMNS =
  "id, token_slug, to_user_id, amount, reason, requested_by, requested_at, status, decided_by, decided_at, decision_note";

export function mintRequestRow(r: any): MintRequestRow {
  return {
    id: String(r.id),
    tokenSlug: String(r.token_slug),
    toUserId: String(r.to_user_id),
    amount: Number(r.amount),
    reason: String(r.reason ?? ""),
    requestedBy: String(r.requested_by),
    requestedAt: r.requested_at instanceof Date ? r.requested_at.toISOString() : r.requested_at ?? null,
    status: String(r.status),
    decidedBy: r.decided_by ?? null,
    decidedAt: r.decided_at instanceof Date ? r.decided_at.toISOString() : r.decided_at ?? null,
    decisionNote: r.decision_note ?? null,
  };
}

export async function mintRequestById(pool: Pool, id: string): Promise<MintRequestRow | null> {
  const [rows] = await pool.query<RowDataPacket[]>(`SELECT ${COLUMNS} FROM admin_mint_requests WHERE id = ?`, [id]);
  return rows[0] ? mintRequestRow(rows[0]) : null;
}

/** The admin list: pending first, then the newest, a hundred at most. */
export async function recentMintRequests(pool: Pool): Promise<MintRequestRow[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT ${COLUMNS} FROM admin_mint_requests ORDER BY (status = 'pending') DESC, requested_at DESC LIMIT 100`,
  );
  return rows.map(mintRequestRow);
}

/** Take the row for an approval. True when this call won it. */
export async function claimForApproval(pool: Pool, id: string, decidedBy: string, note: string | null): Promise<boolean> {
  const [res]: any = await pool.query(
    "UPDATE admin_mint_requests SET status = 'approved', decided_by = ?, decided_at = NOW(), decision_note = ? " +
      "WHERE id = ? AND status = 'pending'",
    [decidedBy, note, id],
  );
  return Number(res?.affectedRows ?? 0) > 0;
}

/** Put a claim back after the transfer refused, so the grant can be decided again. */
export async function releaseApprovalClaim(pool: Pool, id: string): Promise<void> {
  await pool.query(
    "UPDATE admin_mint_requests SET status = 'pending', decided_by = NULL, decided_at = NULL, decision_note = NULL " +
      "WHERE id = ? AND status = 'approved'",
    [id],
  );
}

/** Decline it. True when this call won the row. */
export async function claimForDecline(pool: Pool, id: string, decidedBy: string, note: string | null): Promise<boolean> {
  const [res]: any = await pool.query(
    "UPDATE admin_mint_requests SET status = 'declined', decided_by = ?, decided_at = NOW(), decision_note = ? " +
      "WHERE id = ? AND status = 'pending'",
    [decidedBy, note, id],
  );
  return Number(res?.affectedRows ?? 0) > 0;
}
