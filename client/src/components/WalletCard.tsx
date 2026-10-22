/**
 * The member's wallet, on their own profile.
 *
 * Every token the village has, one row each, and for each the three things the
 * founder asked a wallet to answer (Rye, 2026-10-21): what is held here in the
 * game, whether it can be claimed toward Hypha now (and exactly why not, and
 * when that changes), and what the read-only mirror says is on Base. Every
 * sentence comes from `GET /api/me/wallet`, which decides them in
 * `server/lib/wallet.ts`, so the card and the engine cannot word a refusal
 * differently.
 *
 * NO LONGER GATED ON THE EXCHANGE MODULE. It used to read `/api/exchange` and
 * render nothing while that module was off, which was right while the card was
 * "your exchange balances" and wrong for a wallet: credits arrive from the
 * cycle pool and voice and equity accrue from work with the exchange off, and a
 * member with all three was shown no wallet at all. The link to the exchange
 * still appears only when the exchange is on.
 *
 * WHAT IT NEVER PRINTS: a money figure the exchange did not post ("No price
 * set" is words, never $0), a price or a claim beside Gratitude, or a number
 * for Base the chain did not say. A module's token whose module is off is left
 * out unless the member holds some, the same rule the admin token page keeps
 * (`visibleTokens` in components/admin/tokenCatalog.ts).
 *
 * "Loading", "loaded" and "the request failed" are three different facts, kept
 * apart for the reason the old card kept them apart: collapsing them told a
 * member who holds tokens that they hold none.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "wouter";
import { useModule, useModules } from "@/modules/ModuleProvider";
import { useAuth } from "@/contexts/AuthContext";
import { authToken } from "@/lib/gameApi";
import { ArrowRight, Wallet as WalletIcon } from "lucide-react";
import { formatTokenAmount } from "@/lib/tokenAmount";
import { scrollBehavior } from "@/components/natural/scrollBehavior";
import { tokenModule } from "@/components/admin/tokenCatalog";
import { formatMoney } from "@shared/money";

const headers = (): Record<string, string> => {
  const t = authToken();
  return t ? { Authorization: `Bearer ${t}`, "Content-Type": "application/json" } : { "Content-Type": "application/json" };
};

/** The row as `GET /api/me/wallet` sends it. See `WalletRow` in server/lib/wallet.ts. */
interface WalletRow {
  token: string;
  name: string;
  kind: string;
  role: "claimable" | "village" | "gratitude";
  decimals: number;
  heldUnits: number;
  lockedUnits: number;
  locks: string[];
  claim: {
    claimable: boolean;
    says: string;
    opens: string;
    threshold: number;
    openClaim: { id: string; amount: number; since: string } | null;
    claimedToHypha: number;
  } | null;
  staysHere: string | null;
  onBase:
    | { state: "read"; mirror: string; mirrorName: string; formatted: string; fetchedAt: string; says: string }
    | { state: "unread" | "hidden"; mirror: string; mirrorName: string; says: string }
    | null;
  gratitude: { givingLeft: number; givingTotal: number; cycleKey: string; says: string } | null;
  price:
    | { state: "priced"; currency: string; perTokenMinor: number; heldValueMinor: number; since: string }
    | { state: "unset" | "never"; says: string };
}

const amount = (units: number, decimals: number) => formatTokenAmount(Number(units) || 0, Number(decimals) || 0);

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-3">
      <dt className="shrink-0 text-muted-foreground sm:w-44">{label}</dt>
      <dd className="min-w-0 text-card-foreground">{children}</dd>
    </div>
  );
}

function PriceFact({ row }: { row: WalletRow }) {
  const p = row.price;
  if (p.state !== "priced") return <Fact label="Price">{p.says}</Fact>;
  const each = formatMoney(p.perTokenMinor, p.currency);
  return (
    <Fact label="Price">
      {each} each at the exchange
      {row.heldUnits > 0 ? `, so yours come to ${formatMoney(p.heldValueMinor, p.currency)}` : ""}
    </Fact>
  );
}

export default function WalletCard() {
  const exchangeModule = useModule("exchange");
  const catalog = useModules();
  const { user } = useAuth();
  const [rows, setRows] = useState<WalletRow[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "failed">("loading");
  const [busy, setBusy] = useState("");
  const [note, setNote] = useState<{ token: string; text: string } | null>(null);
  const section = useRef<HTMLDivElement>(null);

  const load = () => {
    setStatus("loading");
    fetch("/api/me/wallet", { headers: headers() })
      .then((r) => {
        if (!r.ok) throw new Error(`wallet ${r.status}`);
        return r.json();
      })
      .then((d) => {
        setRows(Array.isArray(d?.rows) ? d.rows : []);
        setStatus("ready");
      })
      .catch(() => setStatus("failed"));
  };

  useEffect(() => {
    if (user) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  // The account menu links straight here with /profile#wallet. A browser only
  // honours that hash against markup that already exists, and this card mounts
  // after its fetch resolves, so the jump is re-run by hand, and again on a
  // hashchange for a member already on the page.
  useEffect(() => {
    const jump = () => {
      if (window.location.hash === "#wallet") {
        section.current?.scrollIntoView({ behavior: scrollBehavior(), block: "start" });
      }
    };
    jump();
    window.addEventListener("hashchange", jump);
    return () => window.removeEventListener("hashchange", jump);
  }, [status]);

  /** Ask the engine. Its answer, refusal sentence included, is what the row shows. */
  const claim = async (token: string) => {
    setBusy(token);
    setNote(null);
    try {
      const r = await fetch("/api/me/wallet/claim", { method: "POST", headers: headers(), body: JSON.stringify({ token }) });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) {
        setNote({ token, text: String(body?.error ?? "That claim did not go through.") });
        return;
      }
      load();
    } catch {
      setNote({ token, text: "That claim did not reach the village. Nothing was taken." });
    } finally {
      setBusy("");
    }
  };

  /** Take back an open claim. The cancel route settles a claim in any lane. */
  const withdraw = async (token: string, claimId: string) => {
    setBusy(token);
    setNote(null);
    try {
      const r = await fetch(`/api/me/voice-claim/${encodeURIComponent(claimId)}/cancel`, { method: "POST", headers: headers(), body: "{}" });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) {
        setNote({ token, text: String(body?.error ?? "That claim could not be withdrawn.") });
        return;
      }
      load();
    } catch {
      setNote({ token, text: "That did not reach the village. The claim is still open." });
    } finally {
      setBusy("");
    }
  };

  if (!user) return null;

  // A module's token goes dark while its module is off, unless the member holds
  // some. While the catalog is still loading nothing is hidden, so a slow link
  // shows the full wallet instead of flashing a short one.
  const visible = rows.filter((row) => {
    const moduleId = tokenModule(row.token);
    if (!moduleId || !catalog.loaded || catalog.failed) return true;
    const on = catalog.modules.some((m) => m.id === moduleId && m.lifecycle !== "off");
    return on || row.heldUnits > 0;
  });

  return (
    <div id="wallet" ref={section} className="scroll-mt-24 rounded-2xl bg-card p-6 shadow-lg sm:p-8">
      <div className="mb-2 flex items-center justify-between gap-4">
        <h3 className="flex items-center gap-2 font-display text-xl font-bold text-card-foreground">
          <WalletIcon className="h-6 w-6" aria-hidden="true" />
          Wallet
        </h3>
        {exchangeModule && (
          <Link href="/tokens" className="flex shrink-0 items-center gap-1 text-sm font-medium text-foreground hover:underline">
            The Exchange
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        )}
      </div>
      <p className="mb-6 text-sm text-muted-foreground">
        What you hold in the village, what you can carry across to Hypha, and what Base says you hold there. Only you
        can see this.
      </p>

      {status === "loading" ? (
        <p className="text-sm text-muted-foreground">Loading your wallet…</p>
      ) : status === "failed" ? (
        <p className="text-sm text-muted-foreground">
          Your wallet didn't load.{" "}
          <button type="button" onClick={load} className="font-medium text-foreground hover:underline">
            Retry
          </button>
        </p>
      ) : visible.length === 0 ? (
        <p className="text-sm text-muted-foreground">This village has no tokens yet.</p>
      ) : (
        <ul className="space-y-4">
          {visible.map((row) => (
            <li key={row.token} className="rounded-xl border border-border p-4">
              <h4 className="font-semibold text-card-foreground">{row.name}</h4>

              <dl className="mt-3 space-y-2 text-sm">
                {row.role === "gratitude" ? (
                  <>
                    <Fact label="Thanks received">
                      <span className="font-semibold">{amount(row.heldUnits, row.decimals)}</span>
                    </Fact>
                    {row.gratitude && <Fact label="Left to give">{row.gratitude.says}</Fact>}
                    {row.staysHere && <Fact label="Claim on Hypha">{row.staysHere}</Fact>}
                  </>
                ) : (
                  <>
                    <Fact label="Held in the village">
                      <span className={`font-semibold ${row.heldUnits < 0 ? "text-destructive" : ""}`}>
                        {amount(row.heldUnits, row.decimals)}
                      </span>
                      {row.lockedUnits > 0 && (
                        <span className="block text-muted-foreground">
                          {amount(row.lockedUnits, row.decimals)} of it is held: {row.locks.join("; ")}
                        </span>
                      )}
                    </Fact>
                    {row.claim ? (
                      <Fact label="Claim on Hypha">
                        {row.claim.says}
                        <span className="block text-muted-foreground">{row.claim.opens}</span>
                        {row.claim.claimedToHypha > 0 && (
                          <span className="block text-muted-foreground">
                            Claimed across so far: {row.claim.claimedToHypha}
                          </span>
                        )}
                      </Fact>
                    ) : (
                      row.staysHere && <Fact label="Claim on Hypha">{row.staysHere}</Fact>
                    )}
                    {row.onBase && (
                      <Fact label={`On Base, as ${row.onBase.mirrorName}`}>
                        {row.onBase.state === "read" ? (
                          <>
                            <span className="font-semibold">{row.onBase.formatted}</span>
                            <span className="block text-muted-foreground">{row.onBase.says}</span>
                          </>
                        ) : (
                          <span className="text-muted-foreground">{row.onBase.says}</span>
                        )}
                      </Fact>
                    )}
                  </>
                )}
                <PriceFact row={row} />
              </dl>

              {row.claim?.claimable && (
                <button
                  type="button"
                  onClick={() => void claim(row.token)}
                  disabled={busy === row.token}
                  className="mt-4 min-h-11 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
                >
                  {busy === row.token ? "Claiming…" : `Claim ${amount(row.heldUnits, row.decimals)} on Hypha`}
                </button>
              )}
              {row.claim?.openClaim && (
                <button
                  type="button"
                  onClick={() => void withdraw(row.token, row.claim!.openClaim!.id)}
                  disabled={busy === row.token}
                  className="mt-4 min-h-11 rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground disabled:opacity-50"
                >
                  {busy === row.token ? "Withdrawing…" : "Withdraw this claim"}
                </button>
              )}
              {note?.token === row.token && (
                <p role="alert" className="mt-2 text-sm text-destructive">
                  {note.text}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
