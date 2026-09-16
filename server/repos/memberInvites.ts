/**
 * The readers and writers for `member_invites`.
 *
 * NO TOKEN EVER REACHES THIS FILE. Every lookup is by the token's hash, which
 * `server/lib/invites.ts` computes, so nothing here can leak one.
 *
 * EXPIRY IS THE DATABASE'S ANSWER, everywhere. Each read carries `expired` and
 * `seconds_left` computed against CURRENT_TIMESTAMP in the same query, and each
 * write that depends on expiry compares in SQL. The app pool pins UTC and a
 * test pool does not, so a JavaScript Date on one side of the comparison and
 * the database's clock on the other would disagree by the host's offset.
 */
import type { Pool, ResultSetHeader, RowDataPacket } from "mysql2/promise";

const VILLAGE = "local";

export interface InviteRow {
  id: string;
  inviterUserId: string;
  createdAt: unknown;
  usedAt: unknown;
  usedByUserId: string | null;
  revokedAt: unknown;
  /** The database's own answer to whether it has expired. A NULL expiry reads as expired. */
  expired: boolean;
  /** Seconds until it expires, by the database's clock. Negative once it has. */
  secondsLeft: number;
}

const COLUMNS =
  "id, inviter_user_id, created_at, used_at, used_by_user_id, revoked_at, " +
  "(expires_at IS NULL OR expires_at <= CURRENT_TIMESTAMP) AS expired, " +
  "COALESCE(TIMESTAMPDIFF(SECOND, CURRENT_TIMESTAMP, expires_at), 0) AS seconds_left";

const toRow = (r: RowDataPacket): InviteRow => ({
  id: String(r.id),
  inviterUserId: String(r.inviter_user_id),
  createdAt: r.created_at,
  usedAt: r.used_at ?? null,
  usedByUserId: r.used_by_user_id == null ? null : String(r.used_by_user_id),
  revokedAt: r.revoked_at ?? null,
  expired: Number(r.expired) === 1,
  secondsLeft: Number(r.seconds_left ?? 0),
});

/** One new link. The expiry is set by the database's clock. */
export async function createInvite(
  pool: Pool,
  input: { id: string; tokenHash: string; inviterUserId: string; days: number },
): Promise<void> {
  await pool.query( // module-review-ok: one table, one row, no cache above it
    "INSERT INTO member_invites (id, village_id, token_hash, inviter_user_id, expires_at) " +
      "VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP + INTERVAL ? DAY)",
    [input.id, VILLAGE, input.tokenHash, input.inviterUserId, Math.max(1, Math.trunc(input.days))],
  );
}

/** The link a token's hash names, whatever became of it. */
export async function inviteByHash(pool: Pool, tokenHash: string): Promise<InviteRow | null> {
  const [rows] = await pool.query<RowDataPacket[]>( // module-review-ok: one table, no cache above it
    `SELECT ${COLUMNS} FROM member_invites WHERE village_id = ? AND token_hash = ? LIMIT 1`,
    [VILLAGE, tokenHash],
  );
  return rows[0] ? toRow(rows[0]) : null;
}

/** The links one person made, newest first. Capped, because this is a list a person reads. */
export async function invitesBy(pool: Pool, inviterUserId: string, limit = 50): Promise<InviteRow[]> {
  const [rows] = await pool.query<RowDataPacket[]>( // module-review-ok: one table, no cache above it
    `SELECT ${COLUMNS} FROM member_invites WHERE village_id = ? AND inviter_user_id = ? ` +
      "ORDER BY created_at DESC, id DESC LIMIT ?",
    [VILLAGE, inviterUserId, Math.max(1, Math.min(200, Math.trunc(limit)))],
  );
  return rows.map(toRow);
}

/** How many of one person's links could still be used. */
export async function openInviteCount(pool: Pool, inviterUserId: string): Promise<number> {
  const [rows] = await pool.query<RowDataPacket[]>( // module-review-ok: one table, no cache above it
    "SELECT COUNT(*) AS n FROM member_invites WHERE village_id = ? AND inviter_user_id = ? " +
      "AND used_at IS NULL AND revoked_at IS NULL AND expires_at > CURRENT_TIMESTAMP",
    [VILLAGE, inviterUserId],
  );
  return Number(rows[0]?.n ?? 0);
}

/**
 * Take an open link for one new account, and say who sent it.
 *
 * The UPDATE matches only an unused, unrevoked, unexpired row, so of two
 * sign-ups racing for the same link exactly one gets an inviter back and the
 * other gets null. The inviter is read after the take, by the account that
 * took it, so a null can never be mistaken for a success.
 */
export async function claimInvite(pool: Pool, inviteId: string, userId: string): Promise<string | null> {
  const [result] = await pool.query<ResultSetHeader>( // module-review-ok: one table, one row, no cache above it
    "UPDATE member_invites SET used_at = CURRENT_TIMESTAMP, used_by_user_id = ? " +
      "WHERE id = ? AND village_id = ? AND used_at IS NULL AND revoked_at IS NULL AND expires_at > CURRENT_TIMESTAMP",
    [userId, inviteId, VILLAGE],
  );
  if (Number(result.affectedRows ?? 0) !== 1) return null;
  const [rows] = await pool.query<RowDataPacket[]>( // module-review-ok: one table, no cache above it
    "SELECT inviter_user_id FROM member_invites WHERE id = ? AND village_id = ? AND used_by_user_id = ?",
    [inviteId, VILLAGE, userId],
  );
  return rows[0] ? String(rows[0].inviter_user_id) : null;
}

/** Give a link back when the account it was taken for was never made. Only that account's take is undone. */
export async function releaseInvite(pool: Pool, inviteId: string, userId: string): Promise<void> {
  await pool.query( // module-review-ok: one table, one row, no cache above it
    "UPDATE member_invites SET used_at = NULL, used_by_user_id = NULL WHERE id = ? AND village_id = ? AND used_by_user_id = ?",
    [inviteId, VILLAGE, userId],
  );
}

/** Withdraw a link nobody has used. Only the person who made it may, and only once. */
export async function revokeInvite(pool: Pool, inviteId: string, inviterUserId: string): Promise<boolean> {
  const [result] = await pool.query<ResultSetHeader>( // module-review-ok: one table, one row, no cache above it
    "UPDATE member_invites SET revoked_at = CURRENT_TIMESTAMP " +
      "WHERE id = ? AND village_id = ? AND inviter_user_id = ? AND used_at IS NULL AND revoked_at IS NULL",
    [inviteId, VILLAGE, inviterUserId],
  );
  return Number(result.affectedRows ?? 0) === 1;
}
