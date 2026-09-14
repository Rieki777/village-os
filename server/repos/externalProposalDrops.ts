/**
 * `external_proposal_drops`: what was refused and never stored.
 *
 * ── WHY A COUNTER TABLE IS WORTH ITS OWN FILE ──────────────────────────────
 *
 * Without it a steward reading an empty vendor queue cannot tell "nothing
 * arrived" from "everything arrived and all of it was refused", and those are
 * opposite situations. That is the whole job, and it is why the table holds a
 * module id, a day, a reason and a number, and NO vendor content: a refusal
 * counted by storing the thing it refused would be the leak the refusal
 * existed to prevent. A record dropped for carrying an email address must not
 * leave that address in this table.
 *
 * Two statements, one writer and one reader, and they belong together because
 * the reader's arithmetic depends on the writer's grain. The write is one row
 * per (module, day, reason) and increments; the read SUMs over days. Splitting
 * those across two files is how a later change to one silently changes what the
 * other is reporting.
 *
 * ── THE WRITE MUST NEVER TURN A REFUSAL INTO SOMETHING ELSE ────────────────
 *
 * A counter that fails must not turn a refusal into an acceptance, and must not
 * turn one into a 500 either. That contract is the CALLER's and stays there,
 * beside the refusal it protects, for the same reason `recordEvent` keeps its
 * own: a swallow hidden in a repo is inherited by every later caller without
 * their knowing they took it on. This file simply writes, and throws if it
 * cannot.
 */
import { randomUUID } from "crypto";
import type { Pool, RowDataPacket } from "mysql2/promise";
import type { DropCount, DropReason } from "../lib/externalProposals";

/** A timestamp as an ISO instant, or null. An unreadable one is null, never a throw. */
const iso = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

/**
 * Count one refusal, against today.
 *
 * ON DUPLICATE KEY UPDATE, so the unique key on (module, day, reason) makes the
 * second refusal of the day an increment rather than a second row. The id is
 * minted here rather than by the caller because it is a surrogate nothing else
 * ever references: on every refusal after the first it is discarded by the
 * upsert, so a caller that held onto one would be holding an id for a row that
 * may not exist.
 *
 * `on_day` is CURRENT_DATE and `last_at` is CURRENT_TIMESTAMP, both the
 * database's clock, which is what they have always been. Nothing compares
 * either against a clock in this process; the day is the bucket a steward reads
 * and the timestamp is rendered, so there is nothing here for a zone to break.
 */
export async function countDropRow(
  pool: Pool,
  input: { villageId: string; moduleId: string; reason: DropReason },
): Promise<void> {
  await pool.query(
    "INSERT INTO external_proposal_drops (id, village_id, module_id, on_day, reason, dropped) " +
      "VALUES (?,?,?,CURRENT_DATE,?,1) " +
      "ON DUPLICATE KEY UPDATE dropped = dropped + 1, last_at = CURRENT_TIMESTAMP",
    [`xpdrop-${randomUUID().slice(0, 12)}`, input.villageId, input.moduleId, input.reason],
  );
}

/**
 * What was refused over the last `days`, worst first.
 *
 * Grouped by module and reason and summed across days, so a steward reads "this
 * integration has sent 40 records carrying an email address" rather than forty
 * daily rows. Ordered by the count because the question is which refusal is
 * worth acting on, and `MAX(last_at)` says whether it is still happening.
 *
 * The window is clamped here, with the statement it bounds: 1 at the least,
 * because a zero-day window returns nothing while looking like a query that
 * ran, and 365 at the most.
 */
export async function dropCountsSince(pool: Pool, days: number): Promise<DropCount[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT module_id, reason, SUM(dropped) AS dropped, MAX(last_at) AS last_at FROM external_proposal_drops " +
      "WHERE on_day >= DATE_SUB(CURRENT_DATE, INTERVAL ? DAY) GROUP BY module_id, reason ORDER BY dropped DESC",
    [Math.max(1, Math.min(365, days))],
  );
  return rows.map((r) => ({
    moduleId: String(r.module_id),
    reason: String(r.reason),
    dropped: Number(r.dropped ?? 0),
    lastAt: iso(r.last_at),
  }));
}
