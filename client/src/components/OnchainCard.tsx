/**
 * The economics section (S47): on-chain Amora/Voice holdings on the member's
 * own profile. Read-only by constitution — the platform never mints, moves
 * or prices what Hypha governs; governance actions deep-link out.
 *
 * Renders NOTHING unless the village turned the section on
 * (tokens.show_economics_section). Balances render only against a VERIFIED
 * wallet binding; a failed chain read shows the last known value with when
 * it was true — never a zero the chain didn't say.
 */
import { useEffect, useState } from "react";
import { authToken } from "@/lib/gameApi";
import { ExternalLink, Link2, ShieldCheck } from "lucide-react";

const headers = (): Record<string, string> => {
  const t = authToken();
  return t ? { Authorization: `Bearer ${t}`, "Content-Type": "application/json" } : { "Content-Type": "application/json" };
};

/**
 * What each slot IS, in platform words. The token's own name comes from the
 * chain when the Hypha Bridge module is on, and this is what a village that has
 * not turned it on reads instead. The old version of this line carried the
 * first tenant's token names in platform code, which is the debt the
 * white-label ratchet exists to shrink.
 */
const TOKEN_ROLE: Record<string, string> = { equity: "Equity", voice: "Governance" };

/**
 * One village-level figure, with the null-never-zero rule carried all the way
 * to the screen.
 *
 * Three states and each is a different sentence, because collapsing them is
 * exactly the misstatement the rule exists to prevent. A number the chain gave
 * just now is a number. A number the chain gave earlier is shown with the date
 * it was true. Nothing at all is what a village sees when the chain has never
 * answered, and it is deliberately not a zero: a zero total supply reads as a
 * statement that the DAO issued nothing.
 */
function VillageFigure({ label, figure }: { label: string; figure: any }) {
  return (
    <div className="mt-2 first:mt-0">
      <p className="text-xs text-muted-foreground">{label}</p>
      {figure ? (
        <>
          <p className="text-lg font-semibold text-card-foreground">{figure.formatted}</p>
          {figure.stale && (
            <p className="text-xs text-notice">
              as of {new Date(figure.fetchedAt).toLocaleString()}. Base didn't answer just now, so this is the last true figure
            </p>
          )}
        </>
      ) : (
        <p className="text-sm text-muted-foreground">not readable right now. Nothing is shown instead of a wrong number</p>
      )}
    </div>
  );
}

export default function OnchainCard() {
  const [data, setData] = useState<any>(null);
  const [village, setVillage] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = () => {
    fetch("/api/wallet", { headers: headers() })
      .then((r) => (r.ok ? r.json() : null))
      .then(setData)
      .catch(() => {});
    /*
     * The village's own numbers, from the Hypha Bridge module. A 404 is the
     * module answering that it is off, which is a state and not a fault: the
     * section below simply does not appear, exactly the way a blank DHO address
     * hides every Hypha link.
     */
    fetch("/api/hypha", { headers: headers() })
      .then((r) => (r.ok ? r.json() : null))
      .then(setVillage)
      .catch(() => {});
  };
  useEffect(load, []);

  /** The chain's own name for a slot, when a contract has been confirmed. */
  const chainToken = (slug: string) =>
    (village?.tokens ?? []).find((t: any) => t.slug === slug) ?? null;

  if (!data?.economicsEnabled) return null;

  const verify = async () => {
    setError("");
    const eth = (window as any).ethereum;
    if (!eth) {
      setError("No wallet extension found. Install one (e.g. Coinbase Wallet or MetaMask), then try again.");
      return;
    }
    setBusy(true);
    try {
      const [address] = await eth.request({ method: "eth_requestAccounts" });
      /*
       * THE STATUS DECIDES, never the shape of the body.
       *
       * This read `if (!ch.message)` to mean "the challenge failed", which was
       * true only while a refusal had no `message` of its own. A 401 now
       * carries its sentence there, and `message` is also the field a
       * challenge puts its text in, so the old guard would have seen "Sign in
       * first" as a perfectly good challenge and asked the member's wallet to
       * sign those two words. A signature over a refusal is not a login.
       */
      const chRes = await fetch("/api/wallet/challenge", { method: "POST", headers: headers(), body: "{}" });
      const ch = await chRes.json().catch(() => ({}));
      if (!chRes.ok) throw new Error(ch.message ?? ch.error ?? "Could not create a challenge");
      if (!ch.message) throw new Error("Could not create a challenge");
      const signature = await eth.request({ method: "personal_sign", params: [ch.message, address] });
      const v = await fetch("/api/wallet/verify", {
        method: "POST", headers: headers(), body: JSON.stringify({ address, signature }),
      }).then(async (r) => ({ ok: r.ok, body: await r.json() }));
      if (!v.ok) throw new Error(v.body.message ?? v.body.error ?? "Verification failed");
      load();
    } catch (e: any) {
      setError(e?.message || "Verification failed");
    } finally {
      setBusy(false);
    }
  };

  const verified = !!data?.wallet?.verifiedAt;

  return (
    <div className="bg-card rounded-2xl shadow-lg p-8">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <h2 className="text-2xl font-display font-bold text-card-foreground">On-chain holdings</h2>
        {verified ? (
          <span className="inline-flex items-center gap-1.5 text-xs bg-open/10 text-open px-2 py-1 rounded-full">
            <ShieldCheck className="w-3.5 h-3.5" />
            {String(data.wallet.address).slice(0, 6)}…{String(data.wallet.address).slice(-4)} verified
          </span>
        ) : (
          <button onClick={verify} disabled={busy}
            className="inline-flex items-center gap-1.5 text-sm bg-teal-deep text-white rounded-lg px-4 py-2 font-medium disabled:opacity-50">
            <Link2 className="w-4 h-4" /> {busy ? "Waiting for your wallet…" : "Verify my wallet"}
          </button>
        )}
      </div>
      {error && <p role="alert" className="text-sm text-destructive bg-destructive/10 rounded-lg px-3 py-2 mb-3">{error}</p>}

      {!verified ? (
        <p className="text-sm text-muted-foreground">
          Equity and governance tokens live on Base and are shown here only
          against a wallet you have PROVEN you control: one free signature,
          no transaction, no cost.
        </p>
      ) : (
        <div className="grid sm:grid-cols-2 gap-4">
          {["equity", "voice"].map((slug) => {
            const b = data?.onchain?.[slug];
            const chain = chainToken(slug);
            return (
              <div key={slug} className="border border-border rounded-xl p-4">
                <p className="text-xs text-muted-foreground mb-1">
                  {chain ? `${chain.name} (${chain.symbol})` : TOKEN_ROLE[slug]}
                </p>
                {b ? (
                  <>
                    <p className="text-2xl font-bold text-card-foreground">{b.formatted}</p>
                    {b.stale && (
                      <p className="text-xs text-notice mt-1">
                        as of {new Date(b.fetchedAt).toLocaleString()}. The chain
                        didn't answer just now, so this is the last true value
                      </p>
                    )}
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    {slug === "equity" || slug === "voice" ? "not readable right now. Nothing is shown instead of a wrong number" : ""}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/*
        THE VILLAGE, NOT ONLY THE MEMBER. Every chain number this platform held
        was keyed to one person's wallet, so "see our data from Base" resolved to
        your own balance and a link out. Total supply and what the treasury holds
        are facts about the village, and they show whether or not the viewer has
        ever bound a wallet.

        Same rule as everything else here: a figure that failed to read shows
        the last true value with when it was true, and a figure that has never
        been read shows nothing. Never a zero the chain did not say.
      */}
      {(village?.tokens ?? []).length > 0 && (
        <div className="mt-6 pt-5 border-t border-border">
          <h3 className="text-sm font-semibold text-card-foreground">The village on Base</h3>
          <div className="grid sm:grid-cols-2 gap-4 mt-3">
            {village.tokens.map((t: any) => (
              <div key={t.slug} className="border border-border rounded-xl p-4">
                <p className="text-xs text-muted-foreground mb-1">
                  {t.name} ({t.symbol})
                </p>
                <VillageFigure label="Total supply" figure={t.totalSupply} />
                {village.treasuryConfigured && <VillageFigure label="Treasury holds" figure={t.treasuryBalance} />}
              </div>
            ))}
          </div>
        </div>
      )}

      {data?.hypha?.configured && (
        <a href={data.hypha.links?.treasury} target="_blank" rel="noreferrer"
          className="inline-flex items-center gap-1.5 text-sm text-foreground font-medium hover:underline mt-4">
          Govern and move these on Hypha <ExternalLink className="w-3.5 h-3.5" />
        </a>
      )}
    </div>
  );
}
