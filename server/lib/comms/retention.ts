/**
 * Village Comms' share of the daily retention sweep (the comms build spec
 * 5.17), called from `runRetentionSweep` in server/index.ts.
 *
 *   - The WORDS of every email are cleared after 30 days. The row stays, so
 *     the record of who was written to, when, and what became of it outlives
 *     the words. A row still waiting to go keeps its words until it goes.
 *   - The ROWS are deleted after `comms.retention_months` (18 by default),
 *     except a row still waiting to go.
 *   - The provider's raw delivery reports are deleted after 30 days. What they
 *     said is already on the rows they were applied to.
 *
 * Each pass is bounded per run, so a village switching this on over years of
 * mail catches up over a few nights instead of locking the table for one.
 *
 * NEVER A THROW. The sweep has other work to do after this, so a fault here is
 * logged and named in what the sweep reports, and the rest of it still runs.
 */
import type { Pool } from "mysql2/promise";
import { clearMessageBodies, deleteOldMessages, deleteOldProviderEvents } from "../../repos/commsMessages";

/** How long the words of an email are kept. Fixed by the spec, not a dial. */
export const BODY_RETENTION_DAYS = 30;
/** How long a raw delivery report is kept. Fixed by the spec, not a dial. */
export const PROVIDER_EVENT_RETENTION_DAYS = 30;

/** Run the three passes, and answer what each removed, in the sweep's own words. */
export async function sweepCommsRetention(pool: Pool, retentionMonths: number): Promise<string[]> {
  const parts: string[] = [];
  try {
    const bodies = await clearMessageBodies(pool, BODY_RETENTION_DAYS);
    if (bodies) parts.push(`${bodies} email body(ies)`);
    const rows = await deleteOldMessages(pool, Math.max(1, Math.trunc(retentionMonths) || 18));
    if (rows) parts.push(`${rows} email record(s)`);
    const reports = await deleteOldProviderEvents(pool, PROVIDER_EVENT_RETENTION_DAYS);
    if (reports) parts.push(`${reports} delivery report(s)`);
  } catch (err) {
    console.error("[retention] the email record could not be swept this run", err);
    parts.push("not the email record, which could not be read this run");
  }
  return parts;
}
