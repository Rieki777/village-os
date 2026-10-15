/**
 * THE VILLAGE ECONOMICS VIEW (S48), for the founders.
 *
 * Founder economics in one read: the settlement report, module health, the
 * consent queue, milestones going quiet, and the ledger's own invariants.
 * Read-and-steer: every action lives on its existing surface.
 *
 * IT LIVES HERE AND NOT IN client/src/pages/ProjectHistory.tsx (2026-09-26).
 * That page is a shopfront page (scripts/check-brand-refs.mjs, SHOPFRONT): a
 * fork replaces it wholesale, and Journey to Launch rendering a piece of it
 * meant every village's launch page imported one project's tracker. The
 * tracker still renders this view, and still exports it under its old name.
 */
import { useEffect, useState } from "react";
import { Link } from "wouter";
import { useCatalyst } from "@/lib/gameApi";
import { useTokenName, useTokenNameLower } from "@/hooks/useTokenNames";
import { villageMoonLabel } from "@shared/villageMoon";

export function EconomicsView({ headers }: { headers: (extra?: Record<string, string>) => Record<string, string> }) {
  const catalyst = useCatalyst();
  // The recognition token by the name this village gave it, never a literal.
  const tokenName = useTokenName("Recognition");
  const tokenLower = useTokenNameLower();
  const [data, setData] = useState<any>(null);
  const [failed, setFailed] = useState(false);
  const [copiedCycle, setCopiedCycle] = useState<number | null>(null);

  useEffect(() => {
    fetch("/api/admin/command-centre", { headers: headers() })
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then(setData)
      .catch(() => setFailed(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const copyForHypha = (cycle: any) => {
    const lines = [
      `${villageMoonLabel(cycle.moon)} settlement (closed ${cycle.closedAt ? new Date(cycle.closedAt).toLocaleDateString() : "date not recorded"})`,
      ...cycle.totals.map((t: any) =>
        `${t.name}: ${t.received} received (${t.receivedHearts} ${tokenLower} + ${t.receivedAcks} acknowledgments) from ${t.distinctSenders} member(s)` +
        (t.credited ? ` → ${t.credited} ${cycle.poolToken ?? ""} credited` : ""),
      ),
      `Pool released: ${cycle.poolCredited} ${cycle.poolToken ?? ""}`,
    ];
    navigator.clipboard?.writeText(lines.join("\n"));
    setCopiedCycle(cycle.cycleNumber);
    setTimeout(() => setCopiedCycle(null), 2000);
  };

  if (failed || !data) return <p className="text-sm text-stone-400 italic py-6 text-center">{failed ? `Could not load. Are you signed in as ${catalyst.aName}?` : "Loading…"}</p>;

  const invariantsOk = !!data.reconciliation?.invariants?.ok;
  /*
   * "Copy for Hypha" is for a village that takes its settlements to a Hypha
   * space, so it shows only when one is set. The server names the space on
   * this same read (`hyphaSpace`, from `economy.hypha_space` or
   * `hypha.space_id`); a village with neither never sees the button, and a
   * server too old to send the field reads as no space set.
   */
  const hyphaSpace = typeof data.hyphaSpace === "string" && data.hyphaSpace.trim() ? data.hyphaSpace.trim() : null;

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Ledger invariants: the same checks boot enforces, on the desk. */}
      <div className={`rounded-xl border px-5 py-4 ${invariantsOk ? "bg-emerald-50 border-emerald-200" : "bg-red-50 border-red-300"}`}>
        <p className="text-sm font-semibold text-stone-700">
          {invariantsOk
            ? "The economy conserves: every token sums to zero, no drift, no illegal negatives."
            : "LEDGER INVARIANTS BROKEN. The next deploy will refuse to boot:"}
        </p>
        {!invariantsOk && (
          <ul className="mt-2 text-xs text-red-700 list-disc pl-5">
            {(data.reconciliation.invariants.problems ?? []).map((p: string, i: number) => <li key={i}>{p}</li>)}
          </ul>
        )}
      </div>

      {/* The settlement report, which a village on Hypha carries there. */}
      <div className="bg-white rounded-xl border border-stone-200 shadow-sm p-5">
        <h3 className="text-sm font-bold text-stone-700 uppercase tracking-wide mb-1">Cycle settlement report</h3>
        <p className="text-xs text-stone-400 mb-4">
          Closed lunations only. A member's share of the open cycle is unknowable before close, on purpose.
          {tokenName} and written acknowledgments are never blended into one number.
        </p>
        {data.settlement.length === 0 && <p className="text-sm text-stone-400 italic">No cycle has closed yet.</p>}
        <div className="space-y-5">
          {data.settlement.map((c: any) => (
            <div key={c.cycleId}>
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 mb-2">
                <p className="text-sm font-semibold text-stone-700">{villageMoonLabel(c.moon)}
                  <span className="text-stone-400 font-normal"> · closed {c.closedAt ? new Date(c.closedAt).toLocaleDateString() : "date not recorded"}</span>
                  {c.poolCredited > 0 && <span className="text-teal-deep font-normal"> · pool released {c.poolCredited} {c.poolToken}</span>}
                </p>
                {hyphaSpace && (
                  <button
                    onClick={() => copyForHypha(c)}
                    title={`Copies this settlement as text, to paste into the Hypha space ${hyphaSpace}`}
                    className="text-xs text-teal-deep font-medium hover:underline"
                  >
                    {copiedCycle === c.cycleNumber ? "Copied ✓" : "Copy for Hypha"}
                  </button>
                )}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="text-left text-xs text-stone-400">
                    <th className="py-1 pr-3">Member</th><th className="py-1 pr-3">Received</th>
                    <th className="py-1 pr-3">{tokenName}</th><th className="py-1 pr-3">Acks</th>
                    <th className="py-1 pr-3">From</th><th className="py-1 pr-3">Credited</th>
                  </tr></thead>
                  <tbody>
                    {c.totals.map((t: any) => (
                      <tr key={t.userId} className="border-t border-stone-100">
                        <td className="py-1.5 pr-3 font-medium text-stone-700">{t.name}</td>
                        <td className="py-1.5 pr-3">{t.received}</td>
                        <td className="py-1.5 pr-3 text-rose-500">{t.receivedHearts}</td>
                        <td className="py-1.5 pr-3 text-teal-deep">{t.receivedAcks}</td>
                        <td className="py-1.5 pr-3 text-stone-500">{t.distinctSenders}</td>
                        <td className="py-1.5 pr-3">{t.credited > 0 ? `${t.credited} ${c.poolToken ?? ""}` : "none"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        {/* Module health */}
        <div className="bg-white rounded-xl border border-stone-200 shadow-sm p-5">
          <h3 className="text-sm font-bold text-stone-700 uppercase tracking-wide mb-1">Module health</h3>
          <p className="text-xs text-stone-400 mb-3">
            Turn modules on in{" "}
            <Link href="/admin?tab=modules" className="text-teal-deep underline">Admin → Module Library</Link>.
          </p>
          <div className="space-y-1.5">
            {data.modules.map((m: any) => (
              <div key={m.id}>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-stone-600">{m.name}{m.core && <span className="text-[10px] text-stone-400 ml-1">core</span>}</span>
                  <span>
                    {m.demotedBecause ? (
                      <span className="text-xs text-red-600 font-semibold">serving OFF, needs {m.demotedBecause.join(", ")}</span>
                    ) : (
                      <span className={`text-xs px-2 py-0.5 rounded-full ${m.served === "off" ? "bg-stone-100 text-stone-400" : m.served === "public" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>
                        {m.served}
                      </span>
                    )}
                  </span>
                </div>
                {/* Who answers for this one. This is the screen a founder opens
                    when something is dark, so it is where "whose problem is
                    this" has to be legible without a second click. */}
                {m.support?.party === "vendor" && (
                  <p className="text-[11px] text-stone-400 mt-0.5">
                    {m.support.vendorName} answers for the service.{" "}
                    <a href={m.support.supportUrl} target="_blank" rel="noopener noreferrer" className="text-teal-deep underline">Support</a>
                    {m.credentialPresent === false ? " · no key set, so this module answers 503" : ""}
                  </p>
                )}
                {m.tier === "managed" && (
                  <p className="text-[11px] text-stone-400 mt-0.5">
                    Whoever runs this deployment answers for this one.
                    {m.credentialPresent === false ? " The platform key is not provisioned here yet, so it answers 503." : ""}
                  </p>
                )}
                {(m.health ?? []).map((h: any) => (
                  <p key={h.operation} className={`text-[11px] mt-0.5 ${h.verdict === "failing" || h.verdict === "stale" ? "text-red-600" : "text-stone-400"}`}>
                    {h.operation}: {h.detail}
                  </p>
                ))}
              </div>
            ))}
          </div>
        </div>

        {/* Pending consents */}
        <div className="bg-white rounded-xl border border-stone-200 shadow-sm p-5">
          <h3 className="text-sm font-bold text-stone-700 uppercase tracking-wide mb-1">Waiting on consent</h3>
          <p className="text-xs text-stone-400 mb-3">Submitted work waiting for the human gate. Act in Admin → Quest Claims.</p>
          {data.pendingConsents.length === 0 ? (
            <p className="text-sm text-stone-400 italic">Nothing waiting.</p>
          ) : (
            <div className="space-y-1.5">
              {data.pendingConsents.map((p: any) => (
                <p key={p.id} className="text-sm text-stone-600">
                  <span className="font-medium text-stone-700">{p.userName}</span> · {p.questTitle}
                  {p.submittedAt && <span className="text-xs text-stone-400"> · {new Date(p.submittedAt).toLocaleDateString()}</span>}
                </p>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Stale milestones */}
      <div className="bg-white rounded-xl border border-stone-200 shadow-sm p-5">
        <h3 className="text-sm font-bold text-stone-700 uppercase tracking-wide mb-1">Milestones going quiet</h3>
        <p className="text-xs text-stone-400 mb-3">Not completed and untouched for 14+ days. Update them in Admin → Build Progress.</p>
        {data.staleMilestones.length === 0 ? (
          <p className="text-sm text-stone-400 italic">Everything has been touched recently.</p>
        ) : (
          <div className="space-y-1.5">
            {data.staleMilestones.map((m: any) => (
              <div key={m.id} className="flex items-center justify-between text-sm">
                <span className="text-stone-600">{m.title} <span className="text-xs text-stone-400">({m.status})</span></span>
                <span className="text-xs text-amber-700 font-semibold">{m.daysStale}d quiet</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
