/**
 * The member's own token balances, on their own profile.
 *
 * The nav regroup split one overloaded word in two: the village's token
 * economy and its buy-only exchange keep a page of their own at /tokens, and
 * "Wallet" now means the half of it that is nobody else's business. This is
 * that half. It reads the same /api/exchange payload the Tokens page does, so
 * there is no second endpoint to keep honest.
 *
 * Renders NOTHING when the exchange module is off, which is the default for a
 * fresh fork. An empty "what you hold" card on a village with no token economy
 * reads as a promise the village never made.
 *
 * "Loading", "loaded and genuinely empty" and "the request failed" are three
 * different facts, kept apart here for the same reason they are kept apart on
 * the Tokens page: collapsing them rendered a dropped connection as "nothing
 * yet", which tells a member who holds tokens that they hold none, in one of
 * the two places they come to check.
 */
import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { useModule } from "@/modules/ModuleProvider";
import { useAuth } from "@/contexts/AuthContext";
import { authToken } from "@/lib/gameApi";
import { ArrowRight, Wallet as WalletIcon } from "lucide-react";
import { decimalsOf, formatTokenAmount } from "@/lib/tokenAmount";

const headers = (): Record<string, string> => {
  const t = authToken();
  return t ? { Authorization: `Bearer ${t}`, "Content-Type": "application/json" } : { "Content-Type": "application/json" };
};

export default function WalletCard() {
  const exchangeModule = useModule("exchange");
  const { user } = useAuth();
  const [balances, setBalances] = useState<Record<string, number>>({});
  /** The registry's display name per slug, so a rename reaches this card too. */
  const [tokenNames, setTokenNames] = useState<Record<string, string>>({});
  /**
   * And the registry's SCALE per slug. `balances` is the ledger's INT column,
   * so it is MINOR units and a member holding 10 Village Voice arrives here as
   * 10000. This card sits an inch below the Standing chips on the same page,
   * and those divide. Two numbers for one balance, side by side, is the defect
   * this map closes. See client/src/lib/tokenAmount.ts.
   */
  const [tokenDecimals, setTokenDecimals] = useState<Record<string, number>>({});
  const [status, setStatus] = useState<"loading" | "ready" | "failed">("loading");
  const section = useRef<HTMLDivElement>(null);

  const load = () => {
    setStatus("loading");
    fetch("/api/exchange", { headers: headers() })
      .then((r) => {
        if (!r.ok) throw new Error(`exchange ${r.status}`);
        return r.json();
      })
      .then((d) => {
        setBalances(d?.mine?.balances ?? {});
        setTokenNames(d?.mine?.tokenNames ?? {});
        setTokenDecimals(d?.mine?.tokenDecimals ?? {});
        setStatus("ready");
      })
      .catch(() => setStatus("failed"));
  };

  useEffect(() => {
    if (exchangeModule && user) load();
  }, [exchangeModule?.id, user?.id]);

  // The account menu links straight here with /profile#wallet. A browser only
  // honours that hash against markup that already exists, and this card mounts
  // after its fetch resolves, so the jump has to be re-run by hand. The
  // hashchange listener covers the second case: a member already ON the
  // profile page picking Wallet from the menu changes the hash with no
  // remount at all.
  useEffect(() => {
    const jump = () => {
      if (window.location.hash === "#wallet") {
        section.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    };
    jump();
    window.addEventListener("hashchange", jump);
    return () => window.removeEventListener("hashchange", jump);
  }, [status]);

  if (!exchangeModule || !user) return null;

  return (
    <div id="wallet" ref={section} className="bg-card rounded-2xl shadow-lg p-8 scroll-mt-24">
      <div className="flex items-center justify-between gap-4 mb-6">
        <h3 className="text-xl font-display font-bold text-card-foreground flex items-center gap-2">
          <WalletIcon className="w-6 h-6" />
          Wallet
        </h3>
        <Link
          href="/tokens"
          className="text-sm font-medium text-foreground hover:underline flex items-center gap-1 shrink-0"
        >
          The Exchange
          <ArrowRight className="w-4 h-4" />
        </Link>
      </div>

      {status === "loading" ? (
        <p className="text-sm text-muted-foreground">Loading your balances…</p>
      ) : status === "failed" ? (
        <p className="text-sm text-muted-foreground">
          Couldn't load your balances.{" "}
          <button type="button" onClick={load} className="text-foreground font-medium hover:underline">
            Retry
          </button>
        </p>
      ) : Object.keys(balances).length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing yet. Contribution is where value starts.</p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {Object.entries(balances).map(([slug, bal]) => (
            <div key={slug} className="border border-border rounded-lg px-3 py-2">
              <p className={`text-lg font-bold ${Number(bal) < 0 ? "text-destructive" : "text-card-foreground"}`}>
                {formatTokenAmount(Number(bal), decimalsOf(tokenDecimals, slug))}
              </p>
              <p className="text-xs text-muted-foreground">{tokenNames[slug] ?? slug}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
