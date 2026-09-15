/**
 * Turning tokens into something real, from the member's side.
 *
 * A member says what they would like their tokens turned into, a steward says
 * yes or no, and the tokens are destroyed at yes. What this component has to
 * carry, above everything else, is that the agreement is the village's and the
 * software is only the witness. Every sentence below is written to that: it
 * never says the member has been paid, and it never promises anybody will pay.
 *
 * WHY THE HELD FIGURE IS ON THE SAME CARD AS THE ASK. Proposing moves the
 * tokens into a holding account, so the member's balance genuinely falls the
 * moment they ask. A balance that reads short with nothing on the page to
 * explain it is the single worst thing this panel could do, so the held amount
 * and the sentence that explains it sit above the form and not behind a tab.
 *
 * WHY THERE IS NO "cash out" ANYWHERE IN THIS FILE.
 * client/src/pages/valueTokenConversion.test.tsx guards the five brochure pages
 * against promising an on-platform redemption, and its two banned phrases are
 * "redeem it here" and "cash out". That guard is scoped to those pages and this
 * component does not trip it, and the phrase stays out anyway: what a member
 * does here is redeem, and the payment happens somewhere else. The founder's
 * own sentence about converting value lives in a runtime document only he
 * edits, and this lane changed nothing in it.
 */
import { useEffect, useState } from "react";
import { authToken } from "@/lib/gameApi";
import { formatHumanAmount } from "@/lib/tokenAmount";
import { HandCoins } from "lucide-react";

const headers = (): Record<string, string> => {
  const t = authToken();
  return t
    ? { Authorization: `Bearer ${t}`, "Content-Type": "application/json" }
    : { "Content-Type": "application/json" };
};

interface Redemption {
  id: string;
  token: string;
  tokenName: string;
  amount: number;
  askedFor: string;
  state: string;
  decisionNote: string | null;
  openedAt: string;
  expiresAt: string | null;
}

interface Payload {
  open: Redemption[];
  history: Redemption[];
  held: Record<string, number>;
  holds: boolean;
  confirmedBy: string;
  votePathBuilt: boolean;
  perCycle: number;
  openedThisCycle: number;
  tokens: Array<{ slug: string; name: string; decimals: number }>;
}

const day = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "long" });

/**
 * WHAT EACH ENDING SAYS, KEYED BY THE STATE THE SERVER SENDS.
 *
 * A `Record<string, string>` here would render an empty paragraph the day a
 * sixth state lands, with no error and no console line, which is the house trap
 * this map's shape exists to close. The union is the server's `RedemptionState`
 * and the compiler checks every member of it is answered.
 */
type EndingState = "confirmed" | "refused" | "withdrawn" | "expired";
const ENDING: Record<EndingState, string> = {
  confirmed: "Confirmed, and the tokens are gone",
  refused: "Not confirmed, and the tokens came back",
  withdrawn: "You took this one back",
  expired: "Nobody answered before it ran out of time, so the tokens came back",
};
const isEnding = (s: string): s is EndingState =>
  s === "confirmed" || s === "refused" || s === "withdrawn" || s === "expired";

export default function RedemptionPanel() {
  // "Loading", "loaded and genuinely empty" and "the request failed" are three
  // different facts, and collapsing them tells a member who has a redemption
  // open that they have none, in the one place they come to check.
  const [status, setStatus] = useState<"loading" | "ready" | "failed">("loading");
  const [data, setData] = useState<Payload | null>(null);
  const [token, setToken] = useState("");
  const [amount, setAmount] = useState("");
  const [askedFor, setAskedFor] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const load = () => {
    setStatus("loading");
    fetch("/api/redemptions", { headers: headers() })
      .then((r) => {
        if (!r.ok) throw new Error(`redemptions ${r.status}`);
        return r.json();
      })
      .then((d: Payload) => {
        setData(d);
        if (!token && d.tokens.length) setToken(d.tokens[0].slug);
        setStatus("ready");
      })
      .catch(() => setStatus("failed"));
  };
  useEffect(load, []);

  /*
   * THE RESPONSE IS HELD BEFORE ANYTHING SAYS IT LANDED. A control that reports
   * a save it did not wait for is what scripts/check-save-honesty.mjs exists to
   * refuse, and here it would tell a member their tokens are spoken for when
   * the ledger refused the hold.
   */
  const submit = async () => {
    setError("");
    setNotice("");
    setBusy(true);
    try {
      const res = await fetch("/api/redemptions", {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ token, amount: Number(amount), askedFor }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body?.error || "That did not go through.");
        return;
      }
      setNotice(
        body?.holds
          ? "Your redemption is open, and those tokens are held while it is."
          : "Your redemption is open.",
      );
      setAmount("");
      setAskedFor("");
      load();
    } catch {
      setError("That did not go through.");
    } finally {
      setBusy(false);
    }
  };

  const withdraw = async (id: string) => {
    setError("");
    setNotice("");
    setBusy(true);
    try {
      const res = await fetch(`/api/redemptions/${id}/withdraw`, { method: "POST", headers: headers() });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body?.error || "That did not go through.");
        return;
      }
      setNotice("You took that one back, and the tokens are in your wallet again.");
      load();
    } catch {
      setError("That did not go through.");
    } finally {
      setBusy(false);
    }
  };

  if (status === "loading") {
    return (
      <div className="bg-card border border-border rounded-xl p-5">
        <p className="text-sm text-muted-foreground">Loading your redemptions...</p>
      </div>
    );
  }
  if (status === "failed") {
    return (
      <div className="bg-card border border-border rounded-xl p-5">
        <p className="text-sm text-muted-foreground">
          Couldn't load your redemptions.{" "}
          <button type="button" onClick={load} className="text-teal-deep font-medium hover:underline">
            Retry
          </button>
        </p>
      </div>
    );
  }
  if (!data) return null;

  const closed = data.perCycle <= 0;
  const votePending = data.confirmedBy === "vote" && !data.votePathBuilt;
  const atCap = data.openedThisCycle >= data.perCycle;
  const decimalsFor = (slug: string) => data.tokens.find((t) => t.slug === slug)?.decimals ?? 0;

  return (
    <div className="bg-card border border-border rounded-xl p-5 space-y-4">
      <div className="flex items-center gap-2">
        <HandCoins className="w-4 h-4 text-teal-deep" />
        <p className="font-semibold text-foreground text-sm">Redeem</p>
      </div>

      <p className="text-sm text-muted-foreground">
        A redemption is an agreement between you and your village. You say what you would
        like your tokens turned into: cash, a service, a share, a bicycle. A steward says
        yes or no. The agreement is the village's to keep, and nothing in this software can
        make anyone pay you. What happens here is the other half of it. When a steward
        confirms that you have been paid, your tokens are destroyed, and they do not come back.
      </p>

      {Object.keys(data.held).length > 0 && (
        <div className="border border-border rounded-lg px-4 py-3">
          {Object.entries(data.held).map(([slug, held]) => (
            <p key={slug} className="text-sm text-foreground">
              <span className="font-semibold">
                {formatHumanAmount(held, decimalsFor(slug))}{" "}
                {data.tokens.find((t) => t.slug === slug)?.name ?? slug}
              </span>{" "}
              are held against a redemption you have open. They are yours until it is
              confirmed or refused. You cannot spend them while it is open.
            </p>
          ))}
        </div>
      )}

      {notice && (
        <p role="status" className="text-sm text-teal-deep bg-teal-deep/10 rounded-lg px-4 py-2.5">
          {notice}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-red-600 bg-red-50 rounded-lg px-4 py-2.5">
          {error}
        </p>
      )}

      {data.open.length > 0 && (
        <div className="space-y-2">
          {data.open.map((r) => (
            <div key={r.id} className="border border-border rounded-lg px-4 py-3">
              <p className="text-sm text-foreground">
                <span className="font-semibold">
                  {formatHumanAmount(r.amount, decimalsFor(r.token))} {r.tokenName}
                </span>{" "}
                for {r.askedFor}, opened {day(r.openedAt)}, waiting on a steward.
                {r.expiresAt ? ` It runs out on ${day(r.expiresAt)}.` : ""}
              </p>
              <button
                type="button"
                disabled={busy}
                onClick={() => withdraw(r.id)}
                className="mt-2 text-sm text-teal-deep font-medium hover:underline disabled:opacity-50"
              >
                Take this one back
              </button>
            </div>
          ))}
        </div>
      )}

      {closed ? (
        <p className="text-sm text-muted-foreground">
          This village is not taking redemptions just now. A steward can open them in the
          village's dials.
        </p>
      ) : votePending ? (
        <p className="text-sm text-muted-foreground">
          This village has chosen that redemptions go to a village vote, and that path is
          still being finished. A steward can move it back to a steward confirming in the
          village's dials.
        </p>
      ) : data.tokens.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          This village has no token it redeems yet. A steward chooses which ones in the
          village's dials.
        </p>
      ) : atCap ? (
        <p className="text-sm text-muted-foreground">
          You have opened {data.openedThisCycle} redemptions this moon, which is what this
          village allows. The count starts again at the new moon.
        </p>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-3">
            <label className="text-sm text-foreground">
              <span className="block text-xs text-muted-foreground mb-1">Token</span>
              <select
                value={token}
                onChange={(e) => setToken(e.target.value)}
                className="border border-border rounded-lg px-3 py-2 bg-background text-foreground"
              >
                {data.tokens.map((t) => (
                  <option key={t.slug} value={t.slug}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm text-foreground">
              <span className="block text-xs text-muted-foreground mb-1">How much</span>
              <input
                type="number"
                min="0"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="border border-border rounded-lg px-3 py-2 bg-background text-foreground w-32"
              />
            </label>
          </div>
          <label className="block text-sm text-foreground">
            <span className="block text-xs text-muted-foreground mb-1">
              What you would like these turned into
            </span>
            <input
              type="text"
              maxLength={500}
              value={askedFor}
              onChange={(e) => setAskedFor(e.target.value)}
              placeholder="A bicycle"
              className="border border-border rounded-lg px-3 py-2 bg-background text-foreground w-full"
            />
          </label>
          {data.holds && Number(amount) > 0 && (
            <p className="text-sm text-muted-foreground">
              <span className="font-semibold text-foreground">
                {amount} {data.tokens.find((t) => t.slug === token)?.name ?? token} will be held
              </span>{" "}
              while this is open. They stay yours and they stop being spendable. If your
              redemption is confirmed, they are destroyed. If it is refused, or if it
              expires, they come straight back.
            </p>
          )}
          <button
            type="button"
            disabled={busy || !amount || !askedFor.trim()}
            onClick={submit}
            className="bg-teal-deep text-white rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50"
          >
            Ask to redeem
          </button>
        </div>
      )}

      {data.history.filter((r) => r.state !== "requested").length > 0 && (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground uppercase tracking-wide">Before now</p>
          {data.history
            .filter((r) => r.state !== "requested")
            .map((r) => (
              <div key={r.id} className="border border-border rounded-lg px-4 py-2">
                <p className="text-sm text-foreground">
                  {formatHumanAmount(r.amount, decimalsFor(r.token))} {r.tokenName} for{" "}
                  {r.askedFor}. {isEnding(r.state) ? ENDING[r.state] : r.state}.
                </p>
                {r.state === "confirmed" && (
                  <p className="text-xs text-muted-foreground mt-1">
                    This says a steward agreed you were paid. It does not say the payment
                    arrived. If it has not, tell a steward: the record of what was agreed is
                    still here.
                  </p>
                )}
                {r.decisionNote && r.state === "refused" && (
                  <p className="text-xs text-muted-foreground mt-1">{r.decisionNote}</p>
                )}
              </div>
            ))}
        </div>
      )}
    </div>
  );
}
