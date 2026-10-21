/**
 * The founder's planning basket, drawn above the shelves before launch.
 * The arithmetic and the guild-seed seam are in `planBasket.ts`; this is the
 * panel. It renders nothing until a module has been added from its page or a
 * starter set, so a founder who never plans never sees it.
 */
import { Link } from "wouter";
import { ClipboardList } from "lucide-react";
import TurnOnAction from "./TurnOnAction";
import { planSummary, useBasket, writeBasket, type BasketModule } from "./planBasket";
import type { LibraryViewer } from "@shared/moduleSwitch";

const money = (amount: number, currency: string) => {
  try {
    const fmt = new Intl.NumberFormat("en", { style: "currency", currency });
    const digits = fmt.resolvedOptions().maximumFractionDigits ?? 2;
    return fmt.format(amount / Math.pow(10, digits));
  } catch {
    return `${amount} ${currency}`;
  }
};

export default function PlanBasketPanel({ all, viewer }: { all: BasketModule[]; viewer: LibraryViewer }) {
  const ids = useBasket();
  if (!viewer.canSwitch || viewer.launched || ids.length === 0) return null;
  const s = planSummary(ids, all);
  const pickedNames = ids.map((id) => all.find((m) => m.id === id)?.name ?? id);
  return (
    <section aria-labelledby="plan-basket" className="mb-8 rounded-xl border border-teal-deep/30 bg-teal-deep/5 p-4 sm:p-5">
      <h2 id="plan-basket" className="flex items-center gap-2 font-semibold text-foreground">
        <ClipboardList className="w-5 h-5 text-teal-deep" aria-hidden="true" />
        Your plan
      </h2>
      <ul className="mt-2 flex flex-wrap gap-2">
        {ids.map((id, i) => (
          <li key={id} className="inline-flex items-center gap-1 rounded-full border border-border bg-background pl-3 text-sm">
            <Link href={`/modules/${id}`} className="underline">{pickedNames[i]}</Link>
            <button
              type="button"
              onClick={() => writeBasket(ids.filter((x) => x !== id))}
              aria-label={`Take ${pickedNames[i]} out of the plan`}
              className="min-h-[36px] min-w-[36px] text-muted-foreground"
            >
              ×
            </button>
          </li>
        ))}
      </ul>
      <div className="mt-3 space-y-1 text-sm text-muted-foreground">
        {s.pulledIn.length > 0 && <p>Also turns on, because the plan needs them: {s.pulledIn.map((m) => m.name).join(", ")}.</p>}
        {s.prices.length === 0 ? (
          <p>No extra charge.</p>
        ) : (
          <>
            {s.prices.map((p) => (
              <p key={p.name}>{p.name}: {p.line}</p>
            ))}
            {s.monthly && <p className="font-medium text-foreground">Together: {money(s.monthly.amount, s.monthly.currency)} a month.</p>}
          </>
        )}
        {s.fundsCard.length > 0 && (
          <p>{s.fundsCard.map((m) => m.name).join(", ")} touch money, so you read the funds conditions before they turn on.</p>
        )}
        {s.blocked.map((b) => (
          <p key={b.name}>{b.name} {b.why}.</p>
        ))}
        {s.needs.length > 0 && (
          <div>
            <p className="font-medium text-foreground">What you will need</p>
            <ul className="list-disc pl-5">
              {s.needs.map((n, i) => (
                <li key={`${n.moduleId}-${i}`}>{n.text}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
      <div className="mt-3 flex flex-wrap items-start gap-3">
        <TurnOnAction
          ids={ids}
          all={all}
          viewer={viewer}
          label="the plan"
          onDone={() => writeBasket([])}
        />
        <button
          type="button"
          onClick={() => writeBasket([])}
          className="min-h-[44px] px-4 rounded-lg border border-border bg-background text-sm font-medium"
        >
          Clear the plan
        </button>
      </div>
    </section>
  );
}
