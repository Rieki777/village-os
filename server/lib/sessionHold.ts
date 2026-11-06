/**
 * Writing for a session only while it still holds (adversarial round 2,
 * finding 15; rounds 3 and 4).
 *
 * WHY THIS IS ITS OWN FILE. It sits under every door a member's session can
 * write through, the vote delegation among them, and `server/lib/ballots.ts`
 * imports the delegation. Living in server/lib/agentTokens.ts, it pulled that
 * file's whole import graph (the circle calendar, the live sessions, and from
 * there the role settings model) under every module that opens a ballot, and
 * shared/seatSettings.boundary.test.ts refuses exactly that for the modules
 * that move value. So this file imports two small things and nothing else: the
 * locking read in server/repos/users.ts and the tombstone test in
 * server/lib/oauthAccounts.ts. Keep it that way.
 */
import type { Pool, PoolConnection } from "mysql2/promise";
import { lockSessionFieldsForUpdate } from "../repos/users";
import { isTombstone } from "./oauthAccounts";

/**
 * Whether a token's holder can still be acted for. "The row exists" is not the
 * test: an erasure keeps the member row as a tombstone (server/lib/erasure.ts),
 * and the resolver mints a fresh session from whatever row it finds, so without
 * this an erased member's agent read the village as them until the token ran out.
 */
export function holderStands<T extends { email?: unknown }>(user: T | null | undefined): user is T {
  return !!user && !isTombstone({ email: String(user.email ?? "") });
}

/**
 * Why `whileSessionHolds` wrote nothing. `holder_gone`: no member row, or an
 * erasure's tombstone. `session_ended`: the member stands, and the session
 * that asked was signed at a tokenVersion the row no longer has.
 */
export type SessionHoldRefusal = "holder_gone" | "session_ended";

/**
 * Run `write` on one connection, in a transaction that holds the member's row
 * FOR UPDATE, and only while that row is still the session's: it stands
 * (`holderStands`) and its tokenVersion is `sessionVersion`, the one the
 * request's session was checked at (adversarial round 2, finding 15).
 *
 * WHY UNDER THE LOCK. A request checks its session once, at the start, and the
 * inbox and key writes then wait on a DNS lookup whose length the member's
 * own nameserver sets. A new password, an admin's revoke sessions, signing out
 * and the erasure's tombstone all change this row, and each of those waits
 * for the lock or has committed before it is taken. So either the write lands
 * first, and the end that follows the bump (`withAgentReachEnded`, or the
 * revoke's `endAgentReach`, both in server/lib/agentTokens.ts) or the
 * erasure's sweep after the tombstone removes it; or the change landed first,
 * and this refuses before anything is written. A refusal touches nothing, so a
 * session that ended cannot replace what the member set since with the
 * session that replaced it.
 *
 * The same window stood in front of three more writes the end after the
 * bump reaches: an invitation link (`makeInvite`, server/routes/invites.ts),
 * the circle calendar address (`makeAddress`, server/lib/sessionCalendar.ts)
 * and the delegation the member gives (`setDelegation`,
 * server/lib/delegation.ts). Each writes through this too (adversarial
 * round 3). So do the two mints the end has always reached: a `vat_` agent
 * token (`mintToken`, server/lib/agentTokens.ts) and the private calendar
 * feed address (`mintFeedToken`, server/lib/icsFeed.ts) (adversarial
 * round 4).
 *
 * Profile saves ask the same question under the same lock
 * (`sessionGone`, server/routes/profile.ts).
 */
export async function whileSessionHolds<T>(
  pool: Pool,
  userId: string,
  sessionVersion: number,
  write: (conn: PoolConnection) => Promise<T>,
): Promise<{ ok: true; value: T } | { ok: false; refusal: SessionHoldRefusal }> {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const row = await lockSessionFieldsForUpdate(conn, userId);
    const refusal: SessionHoldRefusal | null = !holderStands(row)
      ? "holder_gone"
      : row.tokenVersion !== sessionVersion
        ? "session_ended"
        : null;
    if (refusal) {
      await conn.rollback();
      return { ok: false, refusal };
    }
    const value = await write(conn);
    await conn.commit();
    return { ok: true, value };
  } catch (err) {
    await conn.rollback().catch(() => undefined);
    throw err;
  } finally {
    conn.release();
  }
}
