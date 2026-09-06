/**
 * Contribute (S69): every way to pay the village, on one page.
 *
 * Products are admin-defined data — fees, donations, deposits, waitlist
 * seats, recurring memberships, token packs — and this page just renders
 * the catalog honestly: what it costs, whether it repeats, what it grants,
 * and which rail carries it. Stripe products go to checkout; Zeffy products
 * open the village's own Zeffy form (confirmed on reconciliation); manual
 * products show the instructions and record the intent.
 */
import Layout from "@/components/Layout";
import ModuleGate from "@/components/modules/ModuleGate";
import { useEffect, useState } from "react";
import { useModule, useModules } from "@/modules/ModuleProvider";
import { useAuth } from "@/contexts/AuthContext";
import { authToken } from "@/lib/gameApi";
import { CreditCard, ExternalLink, HeartHandshake, Loader2, Repeat } from "lucide-react";
import { ExamplesBanner } from "@/components/ExamplesBanner";
import { ExampleRefusal, readRefusal } from "@/components/ExampleRefusal";
import { formatTokenAmount } from "@/lib/tokenAmount";

const headers = (): Record<string, string> => {
  const t = authToken();
  return t ? { Authorization: `Bearer ${t}`, "Content-Type": "application/json" } : { "Content-Type": "application/json" };
};
const usd = (minor: number) => `$${(Number(minor || 0) / 100).toFixed(2)}`;

const KIND_LABEL: Record<string, string> = {
  fee: "Fee",
  donation: "Donation",
  deposit: "Deposit",
  waitlist: "Waitlist seat",
  membership: "Membership",
  token_pack: "Token pack",
};

export default function Contribute() {
  const modules = useModules();
  const commerce = useModule("commerce");
  const { user } = useAuth();
  const [data, setData] = useState<any>(null);
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [emails, setEmails] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [manual, setManual] = useState<{ name: string; text: string; receiptNo: number; url?: string } | null>(null);
  // The refusal, keyed to the product. Declared with the other state, ABOVE
  // the early return below: a hook after a conditional return changes the
  // hook count between renders the moment the module catalogue loads.
  const [refusedProduct, setRefusedProduct] = useState<{ id: string; message: string } | null>(null);

  useEffect(() => {
    if (!commerce) return;
    fetch("/api/products", { headers: headers() })
      .then((r) => (r.ok ? r.json() : null))
      .then(setData)
      .catch(() => {});
    const q = new URLSearchParams(window.location.search).get("paid");
    if (q === "success") setNotice("Payment received, thank you. Your receipt is on its way.");
    if (q === "cancelled") setNotice("Checkout cancelled. Nothing was charged.");
  }, [commerce?.id]);

  if (modules.loaded && !commerce) return <ModuleGate moduleId="commerce" name="Payments & Donations" />;

  const checkout = (p: any) => {
    setBusy(p.id);
    setError(""); setRefusedProduct(null);
    const body: any = {};
    if (p.amountMinor == null) body.amountMinor = Math.round((Number(amounts[p.id]) || 0) * 100);
    if (!user) body.email = emails[p.id] ?? "";
    fetch(`/api/products/${p.id}/checkout`, { method: "POST", headers: headers(), body: JSON.stringify(body) })
      .then(async (r) => {
        const { ok, data: d, refusal } = await readRefusal(r);
        if (refusal) { setRefusedProduct({ id: p.id, message: refusal }); return; }
        if (!ok) throw new Error(d?.error || "Could not start that");
        if (d.kind === "stripe") window.location.href = d.url;
        else if (d.kind === "zeffy") {
          // NOT window.open: this runs after a network round trip, outside
          // the click's task, and WebKit blocks that unconditionally — the
          // giver would tap "Give via Zeffy" and watch nothing happen. Show
          // the link instead, so it is always reachable and always visible.
          setManual({ name: p.name, text: d.note, receiptNo: d.receiptNo, url: d.url });
        } else setManual({ name: p.name, text: d.instructions, receiptNo: d.receiptNo });
      })
      .catch((e) => setError(e.message))
      .finally(() => setBusy(""));
  };

  return (
    <Layout>
      <section className="py-12 bg-gradient-to-b from-teal-deep/5 to-background">
        <div className="container text-center">
          <h1 className="font-display text-4xl font-bold text-foreground mb-3">Contribute</h1>
          <p className="text-muted-foreground max-w-xl mx-auto">
            Fees, gifts, deposits and memberships: every way money supports
            this village, in one honest list.
          </p>
          <ExamplesBanner moduleId="commerce" noun="product" />
        </div>
      </section>

      <section className="py-8 bg-background">
        <div className="container max-w-2xl space-y-4">
          {notice && <p role="status" className="text-sm text-teal-deep bg-teal-deep/10 rounded-lg px-4 py-2.5">{notice}</p>}
          {error && <p role="alert" className="text-sm text-red-600 bg-red-50 rounded-lg px-4 py-2.5">{error}</p>}
          {manual && (
            <div className="bg-card border border-teal-deep/30 rounded-xl p-5">
              <p className="font-semibold text-foreground text-sm mb-1">{manual.name}, receipt #{manual.receiptNo}</p>
              <p className="text-sm text-muted-foreground whitespace-pre-wrap">{manual.text}</p>
              {manual.url && (
                <a
                  href={manual.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="inline-flex items-center gap-1.5 mt-3 text-sm bg-teal-deep text-white rounded-lg px-4 py-2 font-medium"
                >
                  <ExternalLink className="w-3.5 h-3.5" /> Continue to Zeffy
                </a>
              )}
              <button onClick={() => setManual(null)} className="block text-xs text-teal-deep font-medium mt-3 hover:underline">Done</button>
            </div>
          )}

          {(data?.products ?? []).length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-8">Nothing is offered right now.</p>
          )}

          {(data?.products ?? []).map((p: any) => (
            <div key={p.id} className="bg-card border border-border rounded-xl p-5">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-teal-deep bg-teal-deep/10 rounded-full px-2 py-0.5">
                      {KIND_LABEL[p.kind] ?? p.kind}
                    </span>
                    {p.recurring !== "none" && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-violet-700 bg-violet-50 border border-violet-200 rounded-full px-2 py-0.5">
                        <Repeat className="w-3 h-3" /> {p.recurring}ly
                      </span>
                    )}
                  </div>
                  <p className="font-semibold text-foreground mt-1.5">{p.name}</p>
                  {p.description && <p className="text-sm text-muted-foreground mt-0.5">{p.description}</p>}
                  {p.grantsToken && (
                    <p className="text-xs text-emerald-700 mt-1">
                      {/* MINOR units, like every other ledger figure: a pack
                          of ten Village Credits stores 1000 once credits is at
                          its ruled two decimals, and this line said so out
                          loud. The scale could not be fixed here alone: the
                          products payload shipped the name and the amount and
                          no `decimals` at all, so the server sends it first. */}
                      Includes {formatTokenAmount(Number(p.grantsToken.amount ?? 0), Number(p.grantsToken.decimals ?? 0))} {p.grantsToken.name}
                      {p.recurring !== "none" ? " each period" : ""}
                    </p>
                  )}
                </div>
                <p className="text-lg font-bold text-foreground">
                  {p.amountMinor != null ? usd(p.amountMinor) : "you choose"}
                  {p.recurring !== "none" && <span className="text-xs text-muted-foreground font-normal">/{p.recurring}</span>}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2 mt-3">
                {/* aria-label rather than a <label for>: these two fields
                    repeat once per plan, so a fixed id would be duplicated
                    down the page. The plan's own name is what tells someone
                    which amount and which address they are filling in. */}
                {p.amountMinor == null && (
                  <input
                    type="number" min={p.minAmountMinor / 100} step="1" inputMode="decimal"
                    aria-label={`Amount to give toward ${p.name}`}
                    value={amounts[p.id] ?? ""}
                    onChange={(e) => setAmounts({ ...amounts, [p.id]: e.target.value })}
                    placeholder={`${(p.minAmountMinor / 100).toFixed(0)} or more`}
                    className="w-32 text-sm border border-border rounded-lg px-3 py-2"
                  />
                )}
                {!user && (
                  <input
                    type="email"
                    autoComplete="email"
                    aria-label={`Your email address for ${p.name}`}
                    value={emails[p.id] ?? ""}
                    onChange={(e) => setEmails({ ...emails, [p.id]: e.target.value })}
                    placeholder="you@example.org"
                    className="flex-1 min-w-[180px] text-sm border border-border rounded-lg px-3 py-2"
                  />
                )}
                <button
                  onClick={() => checkout(p)}
                  disabled={busy === p.id || (p.provider === "stripe" && !data?.stripeConfigured)}
                  className="inline-flex items-center gap-1.5 text-sm bg-teal-deep text-white rounded-lg px-4 py-2 font-medium disabled:opacity-40"
                >
                  {busy === p.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> :
                    p.provider === "zeffy" ? <ExternalLink className="w-3.5 h-3.5" /> :
                    p.provider === "manual" ? <HeartHandshake className="w-3.5 h-3.5" /> :
                    <CreditCard className="w-3.5 h-3.5" />}
                  {p.provider === "zeffy" ? "Give via Zeffy" : p.provider === "manual" ? "Arrange it" : p.recurring !== "none" ? "Subscribe" : "Pay"}
                </button>
                {p.provider === "stripe" && !data?.stripeConfigured && (
                  <span className="text-xs text-amber-700">Card payments aren't connected yet</span>
                )}
              </div>
              {refusedProduct && refusedProduct.id === p.id && (
                <ExampleRefusal message={refusedProduct.message} className="mt-2" />
              )}
            </div>
          ))}
        </div>
      </section>
    </Layout>
  );
}
