/**
 * ACCEPTING A WORK WITH US PROPOSAL WITH THE CASH IT PAYS (0285).
 *
 * Rye, 2026-10-23: "roles and quests and more can be paid in cash, tokens
 * (equity, credits, etc), and voice (governance)... these all need to be
 * available for all contribution types." A proposal carries no value of its
 * own until it is accepted, so the cash is typed here, at the moment of the
 * yes, and the server records it as owed to the proposer once the acceptance's
 * token payment goes through. The status select beside this still accepts with
 * no cash.
 *
 * Shown only for a Work With Us proposal not yet accepted. Light-only, like
 * the rest of this folder.
 */
import { useState } from "react";
import { toast } from "sonner";
import { usePayOptions } from "@/components/WorkValueEditor";
import { currencyExponent } from "@/lib/workPay";
import { putSubmissionStatus } from "./submissionStatus";

export default function ProposalAcceptCash({
  password,
  submission,
  onDone,
}: {
  password: string;
  submission: { id: string; type?: string; status?: string };
  onDone: () => void;
}) {
  const options = usePayOptions();
  const currency = options?.currency || "";
  const [cash, setCash] = useState("");
  const [busy, setBusy] = useState(false);
  if (submission.type !== "work-with-us" || submission.status === "accepted") return null;

  const accept = async () => {
    const raw = cash.replace(/,/g, "").trim();
    const major = raw === "" ? 0 : Number(raw);
    if (!Number.isFinite(major) || major < 0) {
      toast.error("Cash is a number, zero or more.");
      return;
    }
    setBusy(true);
    const ok = await putSubmissionStatus(password, submission.id, "accepted", "work-with-us", {
      cashMinor: Math.round(major * 10 ** currencyExponent(currency || "USD")),
    });
    setBusy(false);
    if (ok) {
      setCash("");
      onDone();
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="text-xs font-medium text-gray-500" htmlFor={`proposal-cash-${submission.id}`}>
        Cash it pays{currency ? `, in ${currency}` : ""}
      </label>
      <input
        id={`proposal-cash-${submission.id}`}
        inputMode="decimal"
        value={cash}
        onChange={(e) => setCash(e.target.value)}
        placeholder="0"
        className="w-28 text-sm border border-gray-200 rounded-lg px-2 py-1.5 bg-white"
      />
      <button
        type="button"
        onClick={accept}
        disabled={busy || cash.trim() === ""}
        className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 bg-white disabled:opacity-40"
      >
        Accept with this cash
      </button>
    </div>
  );
}
