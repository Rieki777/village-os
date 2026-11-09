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
import { Trans, useLingui } from "@lingui/react/macro";

export function EconomicsView({ headers }: { headers: (extra?: Record<string, string>) => Record<string, string> }) {
  const { t } = useLingui();
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

  // Its own message, outside the sentences that print it: the build's English
  // precompile cannot read a message nested inside another's values.
  const closedOn = (at: string | null | undefined): string =>
    at ? new Date(at).toLocaleDateString() : t({ message: "date not recorded", context: "settlement close date missing" });

  const copyForHypha = (cycle: any) => {
    const closed = closedOn(cycle.closedAt);
    const lines = [
      t({ message: `${villageMoonLabel(cycle.moon)} settlement (closed ${closed})`, context: "settlement text copied for Hypha" }),
      ...cycle.totals.map((row: any) =>
        t`${row.name}: ${row.received} received (${row.receivedHearts} ${tokenLower} + ${row.receivedAcks} acknowledgments) from ${row.distinctSenders} member(s)` +
        (row.credited ? t({ message: ` → ${row.credited} ${cycle.poolToken ?? ""} credited`, context: "settlement text copied for Hypha" }) : ""),
      ),
      t({ message: `Pool released: ${cycle.poolCredited} ${cycle.poolToken ?? ""}`, context: "settlement text copied for Hypha" }),
    ];
    navigator.clipboard?.writeText(lines.join("\n"));
    setCopiedCycle(cycle.cycleNumber);
    setTimeout(() => setCopiedCycle(null), 2000);
  };

  if (failed || !data) return <p className="text-sm text-stone-400 italic py-6 text-center">{failed ? t`Could not load. Are you signed in as ${catalyst.aName}?` : t({ message: "Loading…", context: "economics view loading" })}</p>;

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
            ? t`The economy conserves: every token sums to zero, no drift, no illegal negatives.`
            : t`LEDGER INVARIANTS BROKEN. The next deploy will refuse to boot:`}
        </p>
        {!invariantsOk && (
          <ul className="mt-2 text-xs text-red-700 list-disc pl-5">
            {(data.reconciliation.invariants.problems ?? []).map((p: string, i: number) => <li key={i}>{p}</li>)}
          </ul>
        )}
      </div>

      {/* The settlement report, which a village on Hypha carries there. */}
      <div className="bg-white rounded-xl border border-stone-200 shadow-sm p-5">
        <h3 className="text-sm font-bold text-stone-700 uppercase tracking-wide mb-1"><Trans context="economics view heading">Cycle settlement report</Trans></h3>
        <p className="text-xs text-stone-400 mb-4">
          <Trans>
            Closed lunations only. A member's share of the open cycle is unknowable before close, on purpose.
            {tokenName} and written acknowledgments are never blended into one number.
          </Trans>
        </p>
        {data.settlement.length === 0 && <p className="text-sm text-stone-400 italic"><Trans>No cycle has closed yet.</Trans></p>}
        <div className="space-y-5">
          {data.settlement.map((c: any) => { const closed = closedOn(c.closedAt); return (
            <div key={c.cycleId}>
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 mb-2">
                <p className="text-sm font-semibold text-stone-700">{villageMoonLabel(c.moon)}
                  <span className="text-stone-400 font-normal">{" "}<Trans context="settlement report cycle line">· closed {closed}</Trans></span>
                  {c.poolCredited > 0 && <span className="text-teal-deep font-normal">{" "}<Trans context="settlement report cycle line">· pool released {c.poolCredited} {c.poolToken}</Trans></span>}
                </p>
                {hyphaSpace && (
                  <button
                    onClick={() => copyForHypha(c)}
                    title={t`Copies this settlement as text, to paste into the Hypha space ${hyphaSpace}`}
                    className="text-xs text-teal-deep font-medium hover:underline"
                  >
                    {copiedCycle === c.cycleNumber ? t({ message: "Copied ✓", context: "copy settlement button, done" }) : t({ message: "Copy for Hypha", context: "copy settlement button" })}
                  </button>
                )}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="text-left text-xs text-stone-400">
                    <th className="py-1 pr-3"><Trans context="settlement table column">Member</Trans></th><th className="py-1 pr-3"><Trans context="settlement table column">Received</Trans></th>
                    <th className="py-1 pr-3">{tokenName}</th><th className="py-1 pr-3"><Trans context="settlement table column">Acks</Trans></th>
                    <th className="py-1 pr-3"><Trans context="settlement table column">From</Trans></th><th className="py-1 pr-3"><Trans context="settlement table column">Credited</Trans></th>
                  </tr></thead>
                  <tbody>
                    {c.totals.map((row: any) => (
                      <tr key={row.userId} className="border-t border-stone-100">
                        <td className="py-1.5 pr-3 font-medium text-stone-700">{row.name}</td>
                        <td className="py-1.5 pr-3">{row.received}</td>
                        <td className="py-1.5 pr-3 text-rose-500">{row.receivedHearts}</td>
                        <td className="py-1.5 pr-3 text-teal-deep">{row.receivedAcks}</td>
                        <td className="py-1.5 pr-3 text-stone-500">{row.distinctSenders}</td>
                        <td className="py-1.5 pr-3">{row.credited > 0 ? `${row.credited} ${c.poolToken ?? ""}` : t({ message: "none", context: "nothing credited" })}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ); })}
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        {/* Module health */}
        <div className="bg-white rounded-xl border border-stone-200 shadow-sm p-5">
          <h3 className="text-sm font-bold text-stone-700 uppercase tracking-wide mb-1"><Trans context="economics view heading">Module health</Trans></h3>
          <p className="text-xs text-stone-400 mb-3">
            <Trans>
              Turn modules on in{" "}
              <Link href="/modules" className="text-teal-deep underline">the Module Library</Link>.
            </Trans>
          </p>
          <div className="space-y-1.5">
            {data.modules.map((m: any) => (
              <div key={m.id}>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-stone-600">{m.name}{m.core && <span className="text-[10px] text-stone-400 ml-1"><Trans context="module tag">core</Trans></span>}</span>
                  <span>
                    {m.demotedBecause ? (
                      <span className="text-xs text-red-600 font-semibold"><Trans context="module health, demoted module">serving OFF, needs {m.demotedBecause.join(", ")}</Trans></span>
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
                    <Trans>{m.support.vendorName} answers for the service.</Trans>{" "}
                    <a href={m.support.supportUrl} target="_blank" rel="noopener noreferrer" className="text-teal-deep underline"><Trans context="vendor support link">Support</Trans></a>
                    {m.credentialPresent === false ? t` · no key set, so this module answers 503` : ""}
                  </p>
                )}
                {m.tier === "managed" && (
                  <p className="text-[11px] text-stone-400 mt-0.5">
                    <Trans>Whoever runs this deployment answers for this one.</Trans>
                    {m.credentialPresent === false ? t` The platform key is not provisioned here yet, so it answers 503.` : ""}
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
          <h3 className="text-sm font-bold text-stone-700 uppercase tracking-wide mb-1"><Trans context="economics view heading">Waiting on consent</Trans></h3>
          <p className="text-xs text-stone-400 mb-3"><Trans>Submitted work waiting for the human gate. Act in Admin → Quest Claims.</Trans></p>
          {data.pendingConsents.length === 0 ? (
            <p className="text-sm text-stone-400 italic"><Trans context="consent queue empty">Nothing waiting.</Trans></p>
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
        <h3 className="text-sm font-bold text-stone-700 uppercase tracking-wide mb-1"><Trans context="economics view heading">Milestones going quiet</Trans></h3>
        <p className="text-xs text-stone-400 mb-3"><Trans>Not completed and untouched for 14+ days. Update them in Admin → Build Progress.</Trans></p>
        {data.staleMilestones.length === 0 ? (
          <p className="text-sm text-stone-400 italic"><Trans>Everything has been touched recently.</Trans></p>
        ) : (
          <div className="space-y-1.5">
            {data.staleMilestones.map((m: any) => (
              <div key={m.id} className="flex items-center justify-between text-sm">
                <span className="text-stone-600">{m.title} <span className="text-xs text-stone-400">({m.status})</span></span>
                <span className="text-xs text-amber-700 font-semibold"><Trans context="days since a milestone was touched">{m.daysStale}d quiet</Trans></span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
