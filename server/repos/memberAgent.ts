/**
 * A member's own agent: its inbox, its queued deliveries, its drafts, and the
 * third-party key it speaks with.
 *
 * ── WHY THESE TABLES ARE IN ONE MODULE ──────────────────────────────────────
 *
 * The house rule is one table per repo, and this breaks it on purpose. These
 * are one member's agent, and the reason they travel together is that
 * deleting any one without the others leaves a live thing behind:
 *
 *   agent_inboxes      the webhook the village DELIVERS TO. Left standing, a
 *                      24-hour job (`agent-week-ahead`) selected
 *                      `WHERE enabled = 1` with NO JOIN to users, so a departed
 *                      member's endpoint kept receiving the village's payloads.
 *                      The delivery chain now asks who holds an inbox
 *                      (`holderListens`, server/lib/agentInbox.ts), and the
 *                      row still goes: it is the departed member's own URL.
 *   agent_deliveries   what is queued for that inbox. Keyed on `inbox_id` and
 *                      NOT on the member, and carrying no foreign key, so
 *                      removing the inbox alone ORPHANS them rather than
 *                      collecting them.
 *   member_llm_keys    the member's own API key, AES-256-GCM at rest. A stored
 *                      credential belonging to somebody who asked to be
 *                      forgotten is the sharpest row in this set.
 *   member_drafts      what their agent wrote for them and they never sent.
 *   agent_tokens       the `vat_` tokens they minted. A token is not a session,
 *                      so the tombstone's tokenVersion bump never reached it:
 *                      the resolver mints a fresh session from the row, and an
 *                      erased member's agent went on reading the calendar and
 *                      the directory as them until the token expired.
 *   agent_profiles     the member's own note to their agent, and what they said
 *                      the assistant got wrong.
 *   assistant_statements  sentences the assistant wrote ABOUT the member, built
 *                      from that note.
 *
 * A module per table would put the ORDER these have to come out in nowhere, and
 * the order is the load-bearing part: deliveries before the inbox they point at.
 *
 * ── WHY THESE WERE MISSED, WHICH IS WORTH MORE THAN THE FIX ──────────────────
 *
 * The erasure sweep was rewritten on 2026-09-10 into a named, resumable step
 * list, and it enumerated exactly the tables the findings that prompted it had
 * named. Turning a sweep into an enumerable list makes it look complete, and
 * these four were absent from the list and from the argument for it. A reviewer
 * found them by asking what a member OWNS rather than by reading the list, which
 * is the only question that finds a row nobody wrote down.
 *
 * So: when a table gains a member-keyed column, it belongs here or beside here.
 * `server/lib/erasure.ts`'s step list is the enumerable answer to "what does
 * this village hold about me", and a table missing from it is invisible to
 * every other check in the repository.
 */
import type { Pool, RowDataPacket } from "mysql2/promise";

/** How many rows a sweep step removed, for the record it writes. */
export interface AgentSweepCounts {
  deliveries: number;
  inboxes: number;
  keys: number;
  drafts: number;
  tokens: number;
  profiles: number;
  statements: number;
}

const affected = (res: unknown): number => Number((res as { affectedRows?: number })?.affectedRows ?? 0);

/**
 * Remove one member's inbox and everything queued for it, deliveries first.
 *
 * The erasure sweep calls this through `forgetAgentForMember`. The inbox code
 * in server/lib/agentInbox.ts calls it on its own when it finds an inbox whose
 * holder no longer stands: a request that passed its session check before the
 * tombstone can land its write after the sweep's last delete, and the
 * delivery chain is where that row is caught.
 */
export async function forgetInboxOf(pool: Pool, userId: string): Promise<{ deliveries: number; inboxes: number }> {
  const [deliveries] = await pool.query(
    "DELETE FROM `agent_deliveries` WHERE `inbox_id` IN (SELECT `id` FROM `agent_inboxes` WHERE `user_id` = ?)",
    [userId],
  );
  const [inboxes] = await pool.query("DELETE FROM `agent_inboxes` WHERE `user_id` = ?", [userId]);
  return { deliveries: affected(deliveries), inboxes: affected(inboxes) };
}

/** The holder of every enabled inbox, for the daily week-ahead job. */
export async function enabledInboxUserIds(pool: Pool): Promise<string[]> {
  const [rows] = await pool.query<RowDataPacket[]>("SELECT `user_id` FROM `agent_inboxes` WHERE `enabled` = 1");
  return rows.map((r) => String(r.user_id));
}

/**
 * Remove one member's agent entirely.
 *
 * DELIVERIES FIRST, and that ordering is the whole reason this is one function.
 * `agent_deliveries` is keyed on `inbox_id` with no foreign key, so deleting the
 * inbox first leaves rows referencing an inbox that no longer exists, which no
 * later sweep collects because nothing joins them back to a member.
 *
 * Idempotent by construction: every statement is a DELETE keyed on the member
 * (or on their inbox), so a second run matches nothing. That matters because the
 * sweep this belongs to is resumable and a step may be re-entered after a
 * failure part way through.
 */
export async function forgetAgentForMember(pool: Pool, userId: string): Promise<AgentSweepCounts> {
  const inbox = await forgetInboxOf(pool, userId);
  const [keys] = await pool.query("DELETE FROM `member_llm_keys` WHERE `user_id` = ?", [userId]);
  const [drafts] = await pool.query("DELETE FROM `member_drafts` WHERE `user_id` = ?", [userId]);
  // Deleted rather than revoked: the row carries the member's own label for
  // the token, and nothing joins back to it once its holder is gone.
  const [tokens] = await pool.query("DELETE FROM `agent_tokens` WHERE `user_id` = ?", [userId]);
  const [profiles] = await pool.query("DELETE FROM `agent_profiles` WHERE `user_id` = ?", [userId]);
  const [statements] = await pool.query("DELETE FROM `assistant_statements` WHERE `subject_user_id` = ?", [userId]);
  return {
    deliveries: inbox.deliveries,
    inboxes: inbox.inboxes,
    keys: affected(keys),
    drafts: affected(drafts),
    tokens: affected(tokens),
    profiles: affected(profiles),
    statements: affected(statements),
  };
}

/**
 * Whether anything of this member's agent is still on record.
 *
 * Exists so a test can assert the erasure is COMPLETE rather than that it ran.
 * "The step did not throw" is what the sweep already told us before these
 * tables were in it.
 */
export async function agentRowsRemaining(pool: Pool, userId: string): Promise<AgentSweepCounts> {
  const one = async (sql: string): Promise<number> => {
    const [rows] = await pool.query<Array<{ n: number }> & import("mysql2/promise").RowDataPacket[]>(sql, [userId]);
    return Number(rows[0]?.n ?? 0);
  };
  return {
    deliveries: await one(
      "SELECT COUNT(*) AS n FROM `agent_deliveries` WHERE `inbox_id` IN (SELECT `id` FROM `agent_inboxes` WHERE `user_id` = ?)",
    ),
    inboxes: await one("SELECT COUNT(*) AS n FROM `agent_inboxes` WHERE `user_id` = ?"),
    keys: await one("SELECT COUNT(*) AS n FROM `member_llm_keys` WHERE `user_id` = ?"),
    drafts: await one("SELECT COUNT(*) AS n FROM `member_drafts` WHERE `user_id` = ?"),
    tokens: await one("SELECT COUNT(*) AS n FROM `agent_tokens` WHERE `user_id` = ?"),
    profiles: await one("SELECT COUNT(*) AS n FROM `agent_profiles` WHERE `user_id` = ?"),
    statements: await one("SELECT COUNT(*) AS n FROM `assistant_statements` WHERE `subject_user_id` = ?"),
  };
}
