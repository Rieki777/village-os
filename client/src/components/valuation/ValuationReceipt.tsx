/**
 * "HOW THIS WAS WORKED OUT": the receipt for one suggested figure (spec 3.3).
 *
 * Folded, it is the reward, the likely range in words and two numbers, and
 * what it is paid as. Unfolded, it is every line from the estimated effort to
 * the reward, each with what it came to, adding up top to bottom. The lines are
 * the engine's own (shared/valuationEngine.ts), so this renders and decides
 * nothing: no hourly figure ever reaches it (II.10, II.11), and hours appear
 * only when the village has turned them on.
 *
 * A token is named by its live name (II.17), and Earned Equity owed while its
 * meaning is unwritten says so (C4). Cash shows only when there is some, never
 * as a zero (II.13).
 */
import { useState } from "react";
import { wholeMoney, type PayeeSuggestion } from "@shared/valuationEngine";

const WIDTH_WORDS = { narrow: "Narrow range", medium: "Medium range", wide: "Wide range" } as const;

export default function ValuationReceipt({
  suggestion,
  currency,
  tokenName,
  setLine,
}: {
  suggestion: PayeeSuggestion;
  currency: string;
  tokenName: (slug: string) => string;
  /** "Set at ₡X by Treasurer (Rick): reason", only when a person set a figure away from the suggestion. */
  setLine?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const s = suggestion;
  const money = (m: number) => wholeMoney(m, currency);
  const paid = s.paidAs
    .map((p) => (p.token === "cash" ? `${money(p.amount)} cash` : `${p.amount.toLocaleString("en")} ${tokenName(p.token)}${p.owed ? " (owed)" : ""}`))
    .join(", ");

  return (
    <div data-valuation-receipt className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-foreground">
      <div className="flex items-baseline justify-between gap-3">
        <span className="font-semibold">Reward</span>
        <span className="font-semibold tabular-nums">{money(s.expected.totalMinor)}</span>
      </div>
      {setLine && <p className="mt-1 text-foreground">{setLine}</p>}
      <p className="mt-1 text-muted-foreground">
        Likely {money(s.range.lowTotalMinor)} to {money(s.range.highTotalMinor)}. {WIDTH_WORDS[s.range.width]}: {s.range.why.join(", ")}.
      </p>
      {paid && <p className="mt-1 text-muted-foreground">Paid as {paid}.</p>}
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="mt-1 min-h-[44px] text-sm font-medium text-foreground underline underline-offset-2"
      >
        {open ? "Hide how this was worked out" : "How this was worked out"}
      </button>
      {open && (
        <dl className="mt-1 divide-y divide-gray-100">
          {s.receipt.unfolded.map((l) => (
            <div key={l.key} className="flex items-baseline justify-between gap-3 py-1.5">
              <dt className="min-w-0 text-foreground">{l.label}</dt>
              <dd className="shrink-0 tabular-nums text-foreground">{l.result}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}
