/**
 * What consents still owe, on /review, with the press that pays it.
 *
 * A consent records everything it owes beyond recognition in its own commit
 * (drizzle/0210) and pays it straight after. A row shows here when that payment
 * did not go through: the village had not started its Game, the ledger refused
 * it for good, or the process stopped between the two. Pressing pay runs the same
 * payment again, and it cannot pay twice (server/repos/questOwedPostings.ts), so
 * the button is safe whenever it shows, and a second press finds nothing owed.
 *
 * A row the ledger refused for good carries its reason and no button. No press
 * can pay it, and a person has to look at the rule or the key.
 *
 * A FAILED READ IS NEVER AN EMPTY LIST, the page's own rule. Refused renders
 * nothing, failed says what it could not read, and an answer with no rows
 * renders nothing either: a steward has no use for a card saying all is paid.
 */
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { formatTokenAmount } from "@/lib/tokenAmount";

/** One row of `GET /api/admin/quest-claims/owed`. */
export interface OwedPostingView {
  key: string;
  claimId: string;
  questTitle: string | null;
  holder: string | null;
  tokenSlug: string;
  units: number;
  decimals: number;
  state: "owed" | "posted" | "refused";
  refusalReason: string | null;
  lastError: string | null;
  attempts: number;
  createdAt: number;
}

/** What a refusal means, in words a steward can act on. */
function reasonWords(reason: string | null): string {
  switch (reason) {
    case "not_launched":
      return "the village has not started its Game, so nothing may issue yet";
    case "issuance_cap":
      return "the village's issuance cap stops it for now";
    case "key_clash":
      return "its ledger key collides with a different posting";
    case "rule":
      return "the ledger refused it";
    default:
      return "it has not been paid yet";
  }
}

function amountWords(row: OwedPostingView): string {
  const amount = formatTokenAmount(row.units, row.decimals);
  if (row.tokenSlug === "stay-credit") return `${amount} ${amount === "1" ? "stay credit" : "stay credits"}`;
  return `${amount} ${row.tokenSlug.replace(/-/g, " ")}`;
}

function rowWords(row: OwedPostingView): string {
  if (row.state === "refused") {
    return `${amountWords(row)}: refused for good, because ${reasonWords(row.refusalReason)}${row.lastError ? ` (${row.lastError})` : ""}.`;
  }
  return row.refusalReason
    ? `${amountWords(row)}: still owed, because ${reasonWords(row.refusalReason)}.`
    : `${amountWords(row)}: still owed.`;
}

const STATES: ReadonlyArray<OwedPostingView["state"]> = ["owed", "posted", "refused"];

/** Whether one row of an answer has the shape this section renders. */
function isOwedPostingView(v: unknown): v is OwedPostingView {
  const r = v as Partial<OwedPostingView> | null;
  return (
    !!r &&
    typeof r.key === "string" &&
    typeof r.claimId === "string" &&
    typeof r.tokenSlug === "string" &&
    Number.isFinite(r.units) &&
    Number.isFinite(r.decimals) &&
    STATES.includes(r.state as OwedPostingView["state"])
  );
}

/**
 * The owed postings read, with the page's three states: refused, failed and
 * answered. `rows` stays null until it answers.
 */
export function useOwedPostings(headers: () => Record<string, string>) {
  const [rows, setRows] = useState<OwedPostingView[] | null>(null);
  const [refused, setRefused] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/admin/quest-claims/owed", { headers: headers() });
      if (r.status === 401 || r.status === 403 || r.status === 409) {
        setRefused(true);
        setError(null);
        setRows(null);
        return;
      }
      const d = await r.json().catch(() => null);
      if (!r.ok || !Array.isArray(d)) {
        setRefused(false);
        setError((d as { error?: string } | null)?.error ?? "Could not read what consents still owe");
        return;
      }
      // An answer this section cannot render is a failure, never an empty list and never a crash.
      if (!d.every(isOwedPostingView)) {
        setRefused(false);
        setError("The answer about what consents still owe could not be read");
        return;
      }
      setRefused(false);
      setError(null);
      setRows(d);
    } catch {
      setRefused(false);
      setError("Could not reach the server");
    }
  }, [headers]);
  return { rows, refused, error, load };
}

export default function OwedPostings({ headers }: { headers: () => Record<string, string> }) {
  const { rows, refused, error, load } = useOwedPostings(headers);
  const [busy, setBusy] = useState<string | null>(null);
  const card = "bg-card border border-border rounded-xl p-5";

  useEffect(() => {
    void load();
  }, [load]);

  if (refused) return null;

  if (error) {
    return (
      <div className={card}>
        <h2 className="font-semibold text-foreground">What consents still owe did not load</h2>
        <p className="text-sm text-muted-foreground mt-2">
          {error}. A member may be waiting for a payment, and this page cannot see it right now.
        </p>
        <button onClick={() => void load()} className="text-xs border border-border rounded-lg px-3 py-2 mt-4 min-h-[44px]">
          Try again
        </button>
      </div>
    );
  }

  if (!rows || rows.length === 0) return null;

  const groups: Array<{ claimId: string; questTitle: string | null; holder: string | null; items: OwedPostingView[] }> = [];
  for (const row of rows) {
    const group = groups.find((g) => g.claimId === row.claimId);
    if (group) group.items.push(row);
    else groups.push({ claimId: row.claimId, questTitle: row.questTitle, holder: row.holder, items: [row] });
  }

  const pay = async (claimId: string) => {
    setBusy(claimId);
    try {
      // The Response is held before anything says a payment landed, which is
      // what `check-save-honesty.mjs` asks of every control that reports success.
      const res = await fetch(`/api/admin/quest-claims/${claimId}/owed/pay`, {
        method: "POST",
        headers: headers(),
      }).catch(() => null);
      const d = res ? await res.json().catch(() => ({})) : {};
      if (!res || !res.ok) {
        toast.error((d as { error?: string })?.error ?? "That did not go through");
        if (res) await load();
        return;
      }
      const outcomes = ((d as { outcomes?: Array<{ outcome: string }> }).outcomes ?? []).map((o) => o.outcome);
      const unpaid = outcomes.filter((o) => o === "still_owed" || o === "refused").length;
      if (unpaid > 0) toast.error("Some of it could not be paid. The list says why.");
      else if (outcomes.some((o) => o === "posted" || o === "duplicate")) toast.success("Paid.");
      else toast.success("Nothing is owed on this claim any more.");
      await load();
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="space-y-4" aria-labelledby="owed-heading">
      <div>
        <h2 id="owed-heading" className="text-lg font-semibold text-foreground">
          Consented work still owed a payment
        </h2>
        <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
          A consent pays these straight after it lands, and these have not gone through yet. Paying again cannot pay
          anything twice.
        </p>
      </div>

      {groups.map((g) => (
        <div key={g.claimId} className={card}>
          <h3 className="font-semibold text-foreground">{g.questTitle ?? "A quest no longer on the board"}</h3>
          {g.holder && <p className="text-sm text-foreground mt-1">{g.holder}</p>}
          <ul className="text-sm text-muted-foreground mt-2 space-y-1">
            {g.items.map((row) => (
              <li key={row.key}>{rowWords(row)}</li>
            ))}
          </ul>
          {g.items.some((row) => row.state === "owed") && (
            <button
              disabled={busy === g.claimId}
              onClick={() => void pay(g.claimId)}
              className="text-sm bg-teal-deep text-white rounded-lg px-3 py-2 min-h-[44px] font-medium disabled:opacity-40 mt-4"
            >
              Pay what is owed
            </button>
          )}
        </div>
      ))}
    </section>
  );
}
