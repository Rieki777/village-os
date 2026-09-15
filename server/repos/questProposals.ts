/**
 * `quest_proposals`, as the public Propose a Quest form, the member export and
 * erasure need it.
 *
 * server/lib/questProposals.ts is the table's home and holds its other reads and
 * writes. These statements live under server/repos because the raw-SQL register
 * outside it may only shrink (scripts/module-sql-pending.json).
 *
 * WHAT ERASURE DOES HERE, AND WHY NOT MORE. A member's quest idea keeps its words
 * and loses its author's id, in the spirit of the sweep's rule for the submission
 * it came from ("the proposal content itself stays part of the village record",
 * server/lib/erasure.ts). The idea holds no name or contact details to scrub:
 * name and email never leave the submission, an idea carrying an email address
 * is held back, and its batch id names the submission, never the member
 * (server/lib/publicForms.ts).
 */
import type { Pool, PoolConnection } from "mysql2/promise";
import { PROPOSE_QUEST_MODULE } from "../../shared/questIdeas";

type Queryable = Pool | PoolConnection;

/**
 * The batch prefixes a form idea is filed under, followed by its submission id.
 * A member's open ideas are counted on `proposed_by`, and the visitors' on this
 * prefix, which is what keeps a departed member's open ideas, whose author
 * erasure cleared, out of the visitors' count.
 */
export const MEMBER_BATCH_PREFIX = `${PROPOSE_QUEST_MODULE}:member:`;
export const VISITOR_BATCH_PREFIX = `${PROPOSE_QUEST_MODULE}:visitor:`;

/** The form's one named lock, joined to the schema name so schemas sharing a server never share it. */
const LOCK_SUFFIX = `:${PROPOSE_QUEST_MODULE}`;

/** Clear a departing member from every quest idea they proposed. Returns how many rows changed. */
export async function forgetProposer(pool: Pool, userId: string): Promise<number> {
  const [res]: any = await pool.query("UPDATE quest_proposals SET proposed_by = NULL WHERE proposed_by = ?", [userId]);
  return Number(res?.affectedRows ?? 0);
}

/** How many ideas from the form still wait for a steward: one member's, or every visitor's together. */
export async function openIdeas(db: Queryable, from: { member: string } | "visitors"): Promise<number> {
  const [rows]: any =
    from === "visitors"
      ? await db.query("SELECT COUNT(*) AS n FROM quest_proposals WHERE batch_id LIKE ? AND status = 'proposed'", [
          `${VISITOR_BATCH_PREFIX}%`,
        ])
      : await db.query(
          "SELECT COUNT(*) AS n FROM quest_proposals WHERE module_id = ? AND proposed_by = ? AND status = 'proposed'",
          [PROPOSE_QUEST_MODULE, from.member],
        );
  return Number(rows?.[0]?.n ?? 0);
}

/**
 * Every quest idea a member proposed, for the member export: what they wrote,
 * and what a steward decided about it. Never who decided, which is a fact about
 * the steward.
 */
export async function ideasProposedBy(pool: Pool, userId: string): Promise<Array<Record<string, unknown>>> {
  const [rows]: any = await pool.query(
    "SELECT id, title, description, rationale, status, received_at, decided_at, decided_note, created_ref " +
      "FROM quest_proposals WHERE proposed_by = ? ORDER BY received_at, id",
    [userId],
  );
  return rows as Array<Record<string, unknown>>;
}

/**
 * Run `fn` holding the form's named lock, on the connection that holds it.
 *
 * Counting open ideas and inserting one are two statements, and two requests
 * arriving together would both count the same number and both insert, so an
 * allowance could be passed by the size of a burst. Under this lock they run one
 * after another. `fn` is handed the locking connection and does its reads and its
 * insert on it: a callback that took more connections from the pool while this
 * one held the lock could empty a small pool under a burst, leaving every waiter
 * holding a connection the lock holder needs.
 *
 * `GET_LOCK` names are server wide and one test server holds many schemas, so the
 * name hashes this schema's name with the form's: 40 characters, inside MySQL's
 * 64. A lock that is not free within ten seconds throws, and the caller keeps the
 * idea in the inbox.
 */
export async function withIdeaLock<T>(pool: Pool, fn: (conn: PoolConnection) => Promise<T>): Promise<T> {
  const conn = await pool.getConnection();
  try {
    const [[got]]: any = await conn.query("SELECT GET_LOCK(SHA1(CONCAT(DATABASE(), ?)), 10) AS ok", [LOCK_SUFFIX]);
    if (Number(got?.ok) !== 1) throw new Error("Another quest idea held the queue's lock for ten seconds.");
    try {
      return await fn(conn);
    } finally {
      await conn.query("SELECT RELEASE_LOCK(SHA1(CONCAT(DATABASE(), ?)))", [LOCK_SUFFIX]);
    }
  } finally {
    conn.release();
  }
}
