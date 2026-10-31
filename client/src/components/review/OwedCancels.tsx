/**
 * The recurring payments a departed member's erasure could not cancel, on
 * /review, with the two ways to settle them (round 4, finding 2).
 *
 * With no Stripe key, or a Stripe that failed, the erasure and the renewal
 * gate hand each cancel to a person and write that on the audit trail, and
 * that row is the obligation (server/lib/owedCancels.ts). This card counts
 * them, naming nobody, like the two erasure cards beside it:
 *
 *   - Finish them runs the same retry as the other erasure cards, which with
 *     Stripe connected cancels each one and settles it;
 *   - "I cancelled these by hand" is for a person who cancelled them in the
 *     Stripe dashboard. It sends back the `asOf` the card was read with, so a
 *     hand-off that landed after the card was read stays owed.
 *
 * The subscription ids stay on the admins' bell and in the audit trail: the
 * dashboard search starts there, and this screen never names who left.
 */
import { useState } from "react";
import { toast } from "sonner";

/** `subscriptions` on `GET /api/review/erasure`. */
export interface OwedCancelsSummary {
  count: number;
  oldestSince: string | null;
  asOf: string | null;
}

/** `cancels` on `POST /api/review/erasure/retry`: what Finish did about them. */
export interface OwedCancelPass {
  owed: number;
  cleared: number;
  connected: boolean;
}

/** What Finish says about the owed cancels: their own work, said on its own. */
export function announceOwedCancels(pass: OwedCancelPass | undefined): void {
  if (!pass?.owed) return;
  toast.success(
    !pass.connected
      ? "Stripe is not connected, so the owed cancels still need a person in the Stripe dashboard."
      : `${pass.cleared} of ${pass.owed} owed recurring payments are now cancelled in Stripe.`,
  );
}

export default function OwedCancels({
  summary,
  aged,
  busy,
  onFinish,
  headers,
  onChanged,
}: {
  summary: OwedCancelsSummary | undefined;
  /** ", the oldest 3 days ago", as the page words an age. */
  aged: string;
  busy: boolean;
  onFinish: () => void;
  headers: () => Record<string, string>;
  onChanged: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  if (!summary || summary.count <= 0) return null;

  const confirm = async () => {
    setConfirming(true);
    try {
      const r = await fetch("/api/review/erasure/subscriptions-cancelled", {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ asOf: summary.asOf }),
      });
      const d = (await r.json().catch(() => ({}))) as { cleared?: number; error?: string };
      if (r.status === 409) toast.error("More arrived since this card was read. Check the new count and confirm again.");
      else if (!r.ok) toast.error(d?.error ?? "That did not go through");
      else toast.success(d.cleared === 1 ? "Recorded as cancelled by hand." : `${d.cleared ?? 0} recorded as cancelled by hand.`);
    } catch {
      toast.error("Could not reach the server");
    } finally {
      setConfirming(false);
      onChanged();
    }
  };

  return (
    <div data-owed-cancels="" className="bg-card border border-border rounded-xl p-5">
      <h2 className="text-sm font-semibold text-foreground">
        {summary.count === 1
          ? "A departed member's recurring payment still needs cancelling in Stripe"
          : `${summary.count} departed members' recurring payments still need cancelling in Stripe`}
      </h2>
      <p className="text-sm text-muted-foreground mt-2">
        Their erasure, or their exit as a former member, could not cancel it, because Stripe was not connected or did not answer{aged}. The admins'
        notices list each subscription id. With Stripe connected, Finish them cancels each one here. If you
        cancelled them in the Stripe dashboard yourself, say so and the village stops asking.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          className="text-sm bg-teal-deep text-white rounded-lg px-3 py-2 font-medium disabled:opacity-40"
          disabled={busy || confirming}
          onClick={onFinish}
        >
          {busy ? "Finishing" : "Finish them"}
        </button>
        <button
          className="text-sm border border-border rounded-lg px-3 py-2 font-medium disabled:opacity-40"
          disabled={busy || confirming || !summary.asOf}
          onClick={() => void confirm()}
        >
          {confirming ? "Recording" : "I cancelled these by hand"}
        </button>
      </div>
    </div>
  );
}
