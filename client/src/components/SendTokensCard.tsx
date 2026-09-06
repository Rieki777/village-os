/**
 * Send credits to another member. The farmers-market surface.
 *
 * Sits beside the wallet on a member's own profile, because that is where they
 * already come to read a balance, and the question "can I pass this to
 * someone" belongs next to the number it is about.
 *
 * NOT behind a module gate, on purpose. Sending needs no module: the token is
 * in the registry, the ledger is the platform's, and a village running only
 * the four core modules still has credits arriving from the cycle pool. Gating
 * this behind the exchange would have left the pool paying value into the same
 * dead end on every fresh fork, which is the defect it was built to close.
 *
 * The card renders NOTHING when the village has no sendable token, so a
 * deployment that has closed sending sees no form and no promise.
 */
import { useEffect, useState } from "react";
import { authToken } from "@/lib/gameApi";
import { useAuth } from "@/contexts/AuthContext";
import { Send } from "lucide-react";
import { formatTokenAmount, decimalsOf, toMinorUnits, smallestUnit } from "@/lib/tokenAmount";

const headers = (): Record<string, string> => {
  const t = authToken();
  return t ? { Authorization: `Bearer ${t}`, "Content-Type": "application/json" } : { "Content-Type": "application/json" };
};

interface Sendable { slug: string; name: string }

export default function SendTokensCard() {
  const { user } = useAuth();
  const [sendable, setSendable] = useState<Sendable[]>([]);
  const [balances, setBalances] = useState<Record<string, number>>({});
  /**
   * The scale of those balances, per token, from the same payload.
   *
   * `d.ledger` is MINOR units. Nothing sendable carries decimals today, since
   * Village Voice is non-transferable and never reaches this select, so the
   * line below has never been wrong. It would be wrong the first afternoon a
   * village makes a decimal token transferable, and it will be wrong for every
   * token on the day they all move to 4 decimals. See
   * client/src/lib/tokenAmount.ts.
   */
  const [tokenDecimals, setTokenDecimals] = useState<Record<string, number>>({});
  const [form, setForm] = useState({ toEmail: "", tokenType: "", amount: "", note: "" });
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  /**
   * ONE NONCE PER FILLED-IN FORM, minted when the form is cleared and never on
   * a retry. A key minted per REQUEST makes a retried send a second payment,
   * which is the exact failure the ledger's unique index exists to prevent. So
   * the button can be pressed twice, or pressed again after a dropped
   * connection, and exactly one movement lands.
   */
  const [nonce, setNonce] = useState(() => crypto.randomUUID());

  const load = () => {
    fetch("/api/wallet", { headers: headers() })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d) return;
        setSendable(Array.isArray(d.sendable) ? d.sendable : []);
        setBalances(d.ledger ?? {});
        setTokenDecimals(d.tokenDecimals ?? {});
        setForm((f) => (f.tokenType ? f : { ...f, tokenType: d.sendable?.[0]?.slug ?? "" }));
      })
      .catch(() => { /* the card simply does not appear */ });
  };

  useEffect(() => { if (user) load(); }, [user?.id]);

  if (!user || sendable.length === 0) return null;

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setResult(null);
    try {
      const r = await fetch("/api/wallet/send", {
        method: "POST",
        headers: headers(),
        // The member types what they would say out loud; the ledger stores minor
        // units. Converting HERE, next to the input that shows the same scale,
        // is what keeps the two halves of this card agreeing.
        body: JSON.stringify({
          ...form,
          amount: toMinorUnits(form.amount, decimalsOf(tokenDecimals, form.tokenType)),
          clientNonce: nonce,
        }),
      });
      const d = await r.json();
      if (!r.ok) {
        // The server's sentence, verbatim. It knows the token, the balance and
        // the rule; a message written here would only be vaguer.
        setResult({ ok: false, text: d?.error ?? "That send did not go through" });
      } else {
        setResult({
          ok: true,
          text: `Sent ${formatTokenAmount(d.sent, decimalsOf(tokenDecimals, form.tokenType))} ${d.tokenName}${d.to ? ` to ${d.to}` : ""}.`,
        });
        setForm({ toEmail: "", tokenType: form.tokenType, amount: "", note: "" });
        setNonce(crypto.randomUUID());
        load();
      }
    } catch {
      setResult({ ok: false, text: "That did not reach the village. Try again in a moment." });
    }
    setBusy(false);
  };

  const held = Number(balances[form.tokenType] ?? 0);

  return (
    <div className="bg-card rounded-2xl shadow-lg p-8">
      <h3 className="text-xl font-display font-bold text-card-foreground flex items-center gap-2 mb-2">
        <Send className="w-6 h-6" />
        Send credits
      </h3>
      <p className="text-sm text-muted-foreground mb-5">
        Pay someone for a jar of honey, a haircut, an afternoon of help. It moves on the
        village ledger, so both of you can see it later.
      </p>

      <form onSubmit={send} className="space-y-3">
        <label className="block">
          <span className="text-xs font-medium text-muted-foreground">Their email</span>
          <input
            type="email" required value={form.toEmail}
            onChange={(e) => setForm({ ...form, toEmail: e.target.value })}
            className="mt-1 w-full border border-border rounded-lg px-3 py-2 text-sm"
            placeholder="name@example.com"
          />
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="text-xs font-medium text-muted-foreground">Which token</span>
            <select
              value={form.tokenType}
              onChange={(e) => setForm({ ...form, tokenType: e.target.value })}
              className="mt-1 w-full border border-border rounded-lg px-3 py-2 text-sm bg-card"
            >
              {sendable.map((t) => (
                <option key={t.slug} value={t.slug}>{t.name}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-xs font-medium text-muted-foreground">How much</span>
            <input
              type="number"
              min={smallestUnit(decimalsOf(tokenDecimals, form.tokenType))}
              step={smallestUnit(decimalsOf(tokenDecimals, form.tokenType))}
              required value={form.amount}
              onChange={(e) => setForm({ ...form, amount: e.target.value })}
              className="mt-1 w-full border border-border rounded-lg px-3 py-2 text-sm"
            />
          </label>
        </div>

        <label className="block">
          <span className="text-xs font-medium text-muted-foreground">What it is for (optional)</span>
          <input
            type="text" maxLength={180} value={form.note}
            onChange={(e) => setForm({ ...form, note: e.target.value })}
            className="mt-1 w-full border border-border rounded-lg px-3 py-2 text-sm"
            placeholder="Two jars of honey"
          />
        </label>

        <div className="flex items-center justify-between gap-3 pt-1">
          <p className="text-xs text-muted-foreground">You hold {formatTokenAmount(held, decimalsOf(tokenDecimals, form.tokenType))}.</p>
          <button
            type="submit" disabled={busy || !form.toEmail || !form.amount}
            className="border border-notice/70 bg-teal-deep text-white text-sm font-medium rounded-lg px-4 py-2 disabled:opacity-50"
          >
            {busy ? "Sending…" : "Send"}
          </button>
        </div>
      </form>

      {result && (
        <p
          role={result.ok ? "status" : "alert"}
          className={`mt-3 text-sm rounded-lg px-3 py-2 ${result.ok ? "text-open bg-open/10" : "text-destructive bg-destructive/10"}`}
        >
          {result.text}
        </p>
      )}
    </div>
  );
}
