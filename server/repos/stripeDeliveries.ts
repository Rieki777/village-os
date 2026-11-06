/**
 * WHAT STRIPE'S WEBHOOK HAS ACTUALLY DELIVERED, for the launch journey's
 * `stripe-webhook` row (server/lib/launchProofs.ts).
 *
 * `payments_log` is written only by `handleStripeEvent` in
 * server/lib/payments.ts, and every row it writes except `sig_fail` is written
 * after the signature verified. So the newest such row is the newest signed
 * delivery, whatever became of the event afterwards: settled, a duplicate, a
 * module with no handler. A `sig_fail` row carrying `SIGNED_REFUSAL` is a call
 * that came with a signature this village's secret did not verify.
 *
 * TEST MODE IS NOT LIVE MODE. Stripe signs test events with the test
 * endpoint's secret, and the seed's own nursery proves the webhook in test mode
 * first, so a test event says nothing about the live endpoint's secret. The
 * claim row (the one carrying the event id) records which mode the event came
 * from, and `verifiedLiveAt` reads claim rows only and skips test events. A
 * claim row written before the mode was recorded carries no tag and counts,
 * since nothing can say which it was.
 *
 * INSTANTS COME OUT AS EPOCH SECONDS through UNIX_TIMESTAMP, for the reason
 * server/repos/commsOverview.ts gives: a test pool does not pin UTC, and a Date
 * read through the driver shifts by the database host's offset.
 *
 * Three reads on `payments_log_at_idx`, newest first, one row each. The refusal
 * read looks back 90 days: an older refusal says nothing about today's secret.
 */
import type { Pool, RowDataPacket } from "mysql2/promise";

/** The `sig_fail` detail for a call that carried a signature, which did not verify. */
export const SIGNED_REFUSAL = "a signature that did not verify";
/** The `sig_fail` detail for a call with no signature header at all. Never Stripe. */
export const UNSIGNED_REFUSAL = "no signature";
/** The claim row's detail for an event Stripe sent in test mode, and in live mode. */
export const TEST_EVENT = "test mode";
export const LIVE_EVENT = "live mode";

const iso = (v: unknown): string | null => (v == null ? null : new Date(Number(v) * 1000).toISOString());

export interface StripeDeliveries {
  /** The newest delivery that passed the signature check, in either mode. */
  verifiedAt: string | null;
  /** The same, leaving out events Stripe sent in test mode. */
  verifiedLiveAt: string | null;
  /** The newest call carrying a signature that did not verify. */
  refusedAt: string | null;
}

export async function lastStripeDeliveries(pool: Pool): Promise<StripeDeliveries> {
  const [verified] = await pool.query<RowDataPacket[]>(
    "SELECT UNIX_TIMESTAMP(at) AS at_s FROM payments_log WHERE outcome <> 'sig_fail' ORDER BY at DESC LIMIT 1",
  );
  // Only the claim row carries the mode, so only claim rows (the ones with an
  // event id) are read here: a test event's later rows carry no tag at all.
  const [live] = await pool.query<RowDataPacket[]>(
    "SELECT UNIX_TIMESTAMP(at) AS at_s FROM payments_log WHERE stripe_event_id IS NOT NULL AND outcome <> 'sig_fail' " +
      "AND (detail IS NULL OR detail <> ?) ORDER BY at DESC LIMIT 1",
    [TEST_EVENT],
  );
  const [refused] = await pool.query<RowDataPacket[]>(
    "SELECT UNIX_TIMESTAMP(at) AS at_s FROM payments_log WHERE outcome = 'sig_fail' AND detail = ? " +
      "AND at >= CURRENT_TIMESTAMP - INTERVAL 90 DAY ORDER BY at DESC LIMIT 1",
    [SIGNED_REFUSAL],
  );
  return { verifiedAt: iso(verified[0]?.at_s), verifiedLiveAt: iso(live[0]?.at_s), refusedAt: iso(refused[0]?.at_s) };
}
