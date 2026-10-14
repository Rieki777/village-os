import { useState } from "react";
import { toast } from "sonner";
import { API_BASE, authHeaders, refusal } from "@/components/admin/adminApi";

/**
 * The email guild's live check, on the Resend card under Admin, Integrations.
 *
 * A key being set is not a key that works. This asks the server to try one
 * real send to Resend's test address (`server/routes/emailProbe.ts`), then
 * calls `onDone` so the card reloads and its health lines show what the check
 * found. The path is a literal so the route guards can see this caller.
 */
export function EmailProbeButton({ password, onDone }: { password: string; onDone: () => void }) {
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setBusy(true);
    try {
      const res = await fetch(`${API_BASE}/admin/integrations/resend/probe`, {
        method: "POST",
        headers: authHeaders(password),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(refusal(d, "The check could not run"));
      if (d.ok) toast.success(d.detail ?? "Resend accepted the test send");
      else toast.error(d.detail ?? "The check failed");
      onDone();
    } catch (e: any) {
      toast.error(e?.message ?? "The check could not run");
    }
    setBusy(false);
  };

  return (
    <button
      type="button"
      onClick={run}
      disabled={busy}
      className="text-xs font-medium text-teal-deep border border-teal-deep/30 rounded-lg px-3 py-1.5 mb-3 hover:bg-teal-deep/5 disabled:opacity-50"
    >
      {busy ? "Sending a test…" : "Send a test to a test address"}
    </button>
  );
}
