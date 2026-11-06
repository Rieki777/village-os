/**
 * Leaving a conversation, and who runs a group after somebody leaves it.
 *
 * The membership rules live in server/lib/messaging.ts; these are the writes
 * that change who is in a thread and who owns it, moved here so the leave can
 * be ONE TRANSACTION and its statements sit where a table's writers are
 * enumerable.
 *
 * WHY ONE TRANSACTION. A leave is three writes: the leaver's row is marked
 * left and demoted, an heir is chosen, the heir is made owner. They used to be
 * three separate statements on the pool. A death after the first (a dropped
 * connection, a lock timeout, a deploy) left a group with members and no owner,
 * and nothing could ever see it again: the leaver's row was no longer live, so
 * a retry that reads live rows (the erasure's resume does) never visited the
 * group, and every owner-only door (add, remove, rename, hand on) answered to
 * nobody for good. Inside one transaction a death rolls all three back, the
 * leaver's row is live again, and the retry does the whole leave.
 *
 * THE HEIR IS SOMEBODY STILL HERE. The longest-standing live member whose
 * account is not a tombstone. A member erased before conversations were
 * swept still has a live row, and it can sort first, so a group handed to it
 * passed to nobody. A tombstone holding the owner's role holds it for nobody
 * either, so when a group has no living owner its tombstone owners are
 * demoted as the heir is made owner: one group, one owner who can act.
 *
 * Lock order: the conversation row first, then member rows, so two leaves of
 * one group queue behind each other and never both hand it on.
 */
import type { Pool, PoolConnection, RowDataPacket } from "mysql2/promise";

/** A row whose member is still here. The tombstone test oauthAccounts.ts makes, as SQL. */
const LIVING = "EXISTS (SELECT 1 FROM users u WHERE u.id = conversation_members.user_id AND u.email NOT LIKE '%@anonymized.invalid')";

async function inTransaction<T>(pool: Pool, fn: (conn: PoolConnection) => Promise<T>): Promise<T> {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const out = await fn(conn);
    await conn.commit();
    return out;
  } catch (err) {
    try { await conn.rollback(); } catch { /* the connection is already gone */ }
    throw err;
  } finally {
    conn.release();
  }
}

/**
 * Give a group a living owner when it has none and somebody living is still
 * in it. Inside the caller's transaction, after the conversation row's lock.
 * Returns the new owner, or null when nothing changed. A direct thread has no
 * owner by design and is never touched.
 */
async function handOnIfOwnerless(conn: PoolConnection, conversationId: string, kind: string): Promise<string | null> {
  if (kind === "direct") return null;
  const [owners] = await conn.query<RowDataPacket[]>(
    `SELECT user_id FROM conversation_members WHERE conversation_id = ? AND left_at IS NULL AND role = 'owner' AND ${LIVING} LIMIT 1`,
    [conversationId],
  );
  if (owners[0]) return null;
  const [heirs] = await conn.query<RowDataPacket[]>(
    `SELECT user_id FROM conversation_members WHERE conversation_id = ? AND left_at IS NULL AND ${LIVING} ORDER BY joined_at, user_id LIMIT 1 FOR UPDATE`,
    [conversationId],
  );
  const heir = heirs[0] ? String(heirs[0].user_id) : null;
  if (!heir) return null;
  // Owner is a property of active membership by a living person: a residue on
  // a departed row, or on a tombstone's, is cleared as the heir takes the role.
  await conn.query(
    `UPDATE conversation_members SET role = 'member' WHERE conversation_id = ? AND role = 'owner' AND (left_at IS NOT NULL OR NOT ${LIVING})`,
    [conversationId],
  );
  await conn.query("UPDATE conversation_members SET role = 'owner' WHERE conversation_id = ? AND user_id = ? AND left_at IS NULL", [
    conversationId,
    heir,
  ]);
  return heir;
}

/**
 * Leave one conversation, and when the leaver owned it, hand it on, as one
 * transaction. False when they were not in it, which is what a second call
 * meets.
 */
export async function leaveAndHandOn(pool: Pool, conversationId: string, userId: string): Promise<boolean> {
  return inTransaction(pool, async (conn) => {
    const [[conversation]] = await conn.query<any[]>("SELECT id, kind FROM conversations WHERE id = ? FOR UPDATE", [conversationId]);
    if (!conversation) return false;
    const [[mine]] = await conn.query<any[]>(
      "SELECT role FROM conversation_members WHERE conversation_id = ? AND user_id = ? AND left_at IS NULL FOR UPDATE",
      [conversationId, userId],
    );
    if (!mine) return false;
    // Demoted on the way out, always (server/lib/messaging.ts says why).
    await conn.query(
      "UPDATE conversation_members SET left_at = CURRENT_TIMESTAMP, role = 'member' WHERE conversation_id = ? AND user_id = ?",
      [conversationId, userId],
    );
    if (mine.role === "owner") await handOnIfOwnerless(conn, conversationId, String(conversation.kind));
    return true;
  });
}

/** Every conversation this member is still in, for the erasure's walk out of all of them. */
export async function liveConversationsOf(pool: Pool, userId: string): Promise<string[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT conversation_id FROM conversation_members WHERE user_id = ? AND left_at IS NULL ORDER BY conversation_id",
    [userId],
  );
  return rows.map((r) => String(r.conversation_id));
}

/**
 * Every group this member ever had a row in, left or not, so a pass after
 * they walk out can check each one still has a living owner.
 */
export async function groupsEverJoinedBy(pool: Pool, userId: string): Promise<string[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT DISTINCT m.conversation_id FROM conversation_members m JOIN conversations c ON c.id = m.conversation_id " +
      "WHERE m.user_id = ? AND c.kind <> 'direct' ORDER BY m.conversation_id",
    [userId],
  );
  return rows.map((r) => String(r.conversation_id));
}

/**
 * Give one group a living owner if it has none, under the conversation's lock.
 * The repair a leave that died half way used to need by hand, and the answer
 * for a group whose owner is a tombstone. Idempotent: a group with a living
 * owner, or with nobody living left in it, is left exactly as it is.
 */
export async function ensureLivingOwner(pool: Pool, conversationId: string): Promise<string | null> {
  return inTransaction(pool, async (conn) => {
    const [[conversation]] = await conn.query<any[]>("SELECT id, kind FROM conversations WHERE id = ? FOR UPDATE", [conversationId]);
    if (!conversation) return null;
    return handOnIfOwnerless(conn, conversationId, String(conversation.kind));
  });
}
