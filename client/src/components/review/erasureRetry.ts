/**
 * What the "Ask again" press on /review says, from the answer of
 * POST /api/review/erasure/retry (server/routes/erasureQueue.ts).
 *
 * The local sweeps and the outside stores are reported separately because
 * they are separate work: folding a finished local sweep into the vendor
 * count would say a store confirmed something no store was ever asked about.
 * A press that found nothing to do still says so. A silent button is one a
 * steward presses again, and again.
 */
import { toast } from "sonner";
import { announceOwedCancels, type OwedCancelPass } from "./OwedCancels";

/** The retry route's answer. */
export interface ErasureRetryAnswer {
  asked?: number;
  finished?: number;
  resumed?: number;
  swept?: number;
  /** Sweeps still stopped after this press. */
  stillStuck?: number;
  /** Members whose exit was cancelled, so their deletions were ended (round 4). */
  stayed?: number;
  /** The owed Stripe cancels this press tried (round 4). */
  cancels?: OwedCancelPass;
  error?: string;
}

export function announceErasureRetry(d: ErasureRetryAnswer): void {
  const finished = d.finished ?? 0;
  const swept = d.swept ?? 0;
  if (d.resumed) {
    toast.success(
      swept > 0
        ? `${swept} of ${d.resumed} unfinished sweeps completed here.`
        : d.stillStuck === 0 && d.stayed
          ? `${d.stayed} of these members stayed, so their deletions were ended.`
          : `${d.stillStuck ?? d.resumed} unfinished sweeps are still stuck. The queue says which step.`,
    );
  }
  if (d.asked) {
    toast.success(
      finished > 0
        ? `${finished} of ${d.asked} finished. The rest have still not confirmed.`
        : `Asked about ${d.asked}. None of them confirmed yet.`,
    );
  }
  announceOwedCancels(d.cancels);
  if (!d.resumed && !d.asked && !d.cancels?.owed) toast.success("Nothing was outstanding.");
}
