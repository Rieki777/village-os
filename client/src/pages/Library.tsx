/**
 * The Material Library (S41-S46): borrow the village's shared tools and
 * goods on library credits. Donate an item to earn credits; a deposit sits
 * in escrow while something is out and comes back at return, minus wear.
 */
import Layout from "@/components/Layout";
import ModuleGate from "@/components/modules/ModuleGate";
import { useEffect, useState } from "react";
import { useModule, useModules } from "@/modules/ModuleProvider";
import { useAuth } from "@/contexts/AuthContext";
import { authToken } from "@/lib/gameApi";
import { Package, RotateCcw, Undo2, Wrench } from "lucide-react";
import { Image } from "@/components/Image";
import InfoTip from "@/components/InfoTip";
import { ExamplesBanner } from "@/components/ExamplesBanner";
import { ExampleRefusal, readRefusal } from "@/components/ExampleRefusal";
import { formatTokenAmount } from "@/lib/tokenAmount";

const headers = (): Record<string, string> => {
  const t = authToken();
  return t ? { Authorization: `Bearer ${t}`, "Content-Type": "application/json" } : { "Content-Type": "application/json" };
};

const STATUS_LABEL: Record<string, string> = {
  available: "available",
  checked_out: "out on loan",
  written_off: "retired",
};

export default function Library() {
  const modules = useModules();
  const libraryModule = useModule("library");
  const { user } = useAuth();
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  // The refusal, keyed to the row: the page-top error slot is a screen away
  // from the last item on the shelf. Declared with the other state, ABOVE the
  // early return below: a hook after a conditional return changes the hook
  // count between renders the moment the module catalogue loads.
  const [refusedItem, setRefusedItem] = useState<{ id: string; message: string } | null>(null);

  const load = () => {
    fetch("/api/library", { headers: headers() })
      .then((r) => (r.ok ? r.json() : null))
      .then(setData)
      .catch(() => {});
  };
  useEffect(() => { if (libraryModule) load(); }, [libraryModule?.id]);

  if (modules.loaded && !libraryModule) return <ModuleGate moduleId="library" name="Material Library" />;

  const call = (path: string, body?: any, itemId?: string) => {
    setError(""); setNotice(""); setRefusedItem(null);
    fetch(path, { method: "POST", headers: headers(), body: JSON.stringify(body ?? {}) })
      .then(async (r) => {
        const { ok, data: d, refusal } = await readRefusal(r);
        if (refusal && itemId) { setRefusedItem({ id: itemId, message: refusal }); return; }
        if (!ok) throw new Error(d?.error || "Request failed");
        if (d.escrow != null) setNotice(`Reserved. ${d.escrow} credit(s) set aside while you borrow.`);
        if (d.released != null) setNotice(`Cancelled. ${d.released} credit(s) released back to you.`);
        load();
      })
      .catch((e) => setError(e.message));
  };

  const visibleItems = (data?.items ?? []).filter((i: any) => i.status !== "written_off");
  const liveLoans = (data?.mine?.loans ?? []).filter((l: any) => !l.settledAt);
  const itemName = (id: string) => (data?.items ?? []).find((i: any) => i.id === id)?.name ?? id;

  return (
    <Layout>
      <section className="py-12 bg-gradient-to-b from-teal-deep/5 to-background">
        <div className="container text-center">
          <h1 className="font-display text-4xl font-bold text-foreground mb-3">Material Library</h1>
          {/* R46 enchant-first: the shelf image carries the surface; the
              lending mechanics live in the tooltip. */}
          <p className="text-muted-foreground max-w-xl mx-auto">
            One shelf, many hands. What you no longer need becomes what a
            neighbor was missing, and the shelf remembers every gift in{" "}
            <InfoTip tip="Library credits are earned by donating items and set aside as a deposit while you borrow. The deposit comes back at return, minus wear.">library credits</InfoTip>.
          </p>
          <ExamplesBanner moduleId="library" noun="donation" />
        </div>
      </section>

      <section className="py-8 bg-background">
        <div className="container max-w-3xl space-y-6">
          {notice && <p role="status" className="text-sm text-teal-deep bg-teal-deep/10 rounded-lg px-4 py-2.5">{notice}</p>}
          {error && <p role="alert" className="text-sm text-red-600 bg-red-50 rounded-lg px-4 py-2.5">{error}</p>}

          {user && data?.mine && (
            <div className="bg-card border border-border rounded-xl p-5">
              <p className="text-sm text-foreground">
                {/* Library credits are a credit token, so since the
                    2026-09-04 scale ruling they carry two decimals and this
                    number MUST be divided. It goes through the shared
                    formatter, which is what stops this surface and the
                    ledger disagreeing at any scale. See
                    client/src/lib/tokenAmount.ts. */}
                Your credits: <span className="font-bold">{formatTokenAmount(Number(data.mine.balance ?? 0), Number(data.mine.balanceDecimals ?? 0))}</span>
                {Number(data.mine.lockedUnits ?? 0) > 0 && (
                  <span className="text-muted-foreground">
                    {" "}to spend, {formatTokenAmount(Number(data.mine.totalUnits ?? 0), Number(data.mine.balanceDecimals ?? 0))} to your name
                  </span>
                )}
                {data.mine.strikes > 0 && (
                  <span className="text-xs text-amber-700 ml-2">({data.mine.strikes} no-show{data.mine.strikes > 1 ? "s" : ""} on record)</span>
                )}
              </p>
              {/* WHY THE TWO NUMBERS DIFFER, one line per thing holding a
                  deposit. The sentence is the founder's and the server builds
                  it, because the refusal a member meets at the Borrow button
                  has to say the same words as the balance above it and two
                  copies of a sentence are two sentences. */}
              {(data.mine.locks ?? []).length > 0 && (
                <ul className="mt-2 space-y-1">
                  {(data.mine.locks ?? []).map((l: any) => (
                    <li key={l.ref} className="text-sm text-muted-foreground">
                      {formatTokenAmount(Number(l.heldUnits ?? 0), Number(data.mine.balanceDecimals ?? 0))} {l.sentence}
                    </li>
                  ))}
                </ul>
              )}
              {liveLoans.length > 0 && (
                <div className="mt-3 space-y-2 border-t border-border pt-3">
                  {liveLoans.map((l: any) => (
                    <div key={l.id} className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">
                        <b className="text-foreground">{itemName(l.itemId)}</b> · {l.status.replace(/_/g, " ")}
                        {l.dueOn && <> · due {l.dueOn}</>} · {l.escrowCredits} set aside
                      </span>
                      <span className="space-x-3">
                        {(l.status === "reserved" || l.status === "pickup_pending") && (
                          <button onClick={() => call(`/api/library/loans/${l.id}/cancel`)}
                            className="text-xs text-muted-foreground hover:text-red-600 inline-flex items-center gap-1">
                            <Undo2 className="w-3 h-3" /> Cancel
                          </button>
                        )}
                        {l.status === "active" && (
                          <button onClick={() => call(`/api/library/loans/${l.id}/return`)}
                            className="text-xs text-teal-deep font-medium hover:underline inline-flex items-center gap-1">
                            <RotateCcw className="w-3 h-3" /> I returned it
                          </button>
                        )}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            {visibleItems.map((i: any) => {
              const eligible = data?.mine?.eligible?.[i.id] ?? true;
              return (
                <div key={i.id} className="bg-card border border-border rounded-xl p-4 flex flex-col">
                  {i.photoUrl && (
                    <Image src={i.photoUrl} alt={i.name} className="rounded-lg mb-3 h-36 w-full" />
                  )}
                  <div className="flex items-center gap-2 mb-1">
                    <Wrench className="w-4 h-4 text-teal-deep" />
                    <p className="font-semibold text-foreground text-sm">{i.name}</p>
                    {/* gray-500 on gray-100 measured 4.39:1 at 10px, under the
                        4.5 floor. gray-600 on the same chip is 6.86:1 and the
                        chip reads the same. */}
                    <span className={`ml-auto text-[10px] px-1.5 py-0.5 rounded-full ${i.status === "available" ? "bg-emerald-50 text-emerald-700" : "bg-gray-100 text-gray-600"}`}>
                      {STATUS_LABEL[i.status] ?? i.status}
                    </span>
                  </div>
                  {i.description && <p className="text-sm text-muted-foreground mb-2">{i.description}</p>}
                  <div className="mt-auto flex items-center justify-between">
                    <p className="text-xs text-muted-foreground">
                      value {i.creditValue} ·{" "}
                      <InfoTip tip="The deposit is set aside from your credits while the item is out and returns when it does, minus any wear.">deposit</InfoTip>{" "}
                      {i.escrow}
                      {i.minStage && (
                        <>
                          {" "}·{" "}
                          <InfoTip tip={`This item opens at the ${i.minStage} stage of the membership path. The ladder lives on your profile.`}>from {i.minStage}</InfoTip>
                        </>
                      )}
                    </p>
                    {user && i.status === "available" && (
                      <button
                        onClick={() => call(`/api/library/items/${i.id}/reserve`, undefined, i.id)}
                        disabled={!eligible}
                        title={eligible ? `Sets aside ${i.escrow} credit(s) while you borrow` : "Not open to you yet"}
                        className="text-sm bg-teal-deep text-white rounded-lg px-3 py-1.5 font-medium disabled:opacity-40"
                      >
                        Borrow
                      </button>
                    )}
                  </div>
                  {refusedItem && refusedItem.id === i.id && (
                    <ExampleRefusal message={refusedItem.message} className="mt-2" />
                  )}
                </div>
              );
            })}
          </div>
          {/* Gated on what's actually SHOWN: a shelf holding only retired
              items used to render a blank grid with no explanation. */}
          {data && visibleItems.length === 0 && (
            <p className="text-center text-sm text-muted-foreground py-12">
              <Package className="w-6 h-6 mx-auto mb-2 text-muted-foreground/50" />
              The shelves are waiting for their first donation.
            </p>
          )}
          {!user && <p className="text-center text-xs text-muted-foreground">Sign in to borrow. Donations are recorded with a steward.</p>}
        </div>
      </section>
    </Layout>
  );
}
