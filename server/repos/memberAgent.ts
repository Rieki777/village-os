/**
 * A member's own agent: its inbox, its queued deliveries, its drafts, and the
 * third-party key it speaks with.
 *
 * ── WHY FOUR TABLES IN ONE MODULE ────────────────────────────────────────────
 *
 * The house rule is one table per repo, and this breaks it on purpose. These
 * four are one member's agent, and the reason they travel together is that
 * deleting any one without the others leaves a live thing behind:
 *
 *   agent_inboxes      the webhook the village DELIVERS TO. Left standing, a
 *                      24-hour job (`agent-week-ahead`, server/index.ts) selects
 *                      `WHERE enabled = 1` with NO JOIN to users, so a departed
 *                      member's endpoint keeps receiving the village's payloads.
 *   agent_deliveries   what is queued for that inbox. Keyed on `inbox_id` and
 *                      NOT on the member, and carrying no foreign key, so
 *                      removing the inbox alone ORPHANS them rather than
 *                      collecting them.
 *   member_llm_keys    the member's own API key, AES-256-GCM at rest. A stored
 *                      credential belonging to somebody who asked to be
 *                      forgotten is the sharpest row in this set.
 *   member_drafts      what their agent wrote for them and they never sent.
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
import type { Pool } from "mysql2/promise";

/** How many rows a sweep step removed, for the record it writes. */
export interface AgentSweepCounts {
  deliveries: number;
  inboxes: number;
  keys: number;
  drafts: number;
}

const affected = (res: unknown): number => Number((res as { affectedRows?: number })?.affectedRows ?? 0);

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
  const [deliveries] = await pool.query(
    "DELETE FROM `agent_deliveries` WHERE `inbox_id` IN (SELECT `id` FROM `agent_inboxes` WHERE `user_id` = ?)",
    [userId],
  );
  const [inboxes] = await pool.query("DELETE FROM `agent_inboxes` WHERE `user_id` = ?", [userId]);
  const [keys] = await pool.query("DELETE FROM `member_llm_keys` WHERE `user_id` = ?", [userId]);
  const [drafts] = await pool.query("DELETE FROM `member_drafts` WHERE `user_id` = ?", [userId]);
  return {
    deliveries: affected(deliveries),
    inboxes: affected(inboxes),
    keys: affected(keys),
    drafts: affected(drafts),
  };
}

/**
 * Whether anything of this member's agent is still on record.
 *
 * Exists so a test can assert the erasure is COMPLETE rather than that it ran.
 * "The step did not throw" is what the sweep already told us before these four
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
  };
}
