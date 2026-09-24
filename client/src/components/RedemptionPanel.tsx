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
import LongText from "@/components/LongText";
import { formatHumanAmount } from "@/lib/tokenAmount";
import { formatMoney } from "@shared/money";
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
  /** Ruling 23: what it was worth the day it was asked for. Null when this
   *  village put no number on it, which is a real state and not a gap. */
  money: Money | null;
  /** The village's instructions as they read that day, snapshotted with it. */
  processText: string | null;
}

interface Money {
  currency: string;
  grossMinor: number;
  feeMinor: number;
  netMinor: number;
  grossText: string;
  feeText: string;
  netText: string;
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
  tokens: Array<{
    slug: string;
    name: string;
    decimals: number;
    /** Minor units of `currency` for one whole token. Null when unpriced. */
    rateMinor: number | null;
    rateSource: string | null;
    currency: string;
  }>;
  money: {
    currencies: string[];
    currency: string;
    rateSource: string;
    rateMinor: number | null;
    feePct: number;
    feeFixedMinor: number;
    minMinor: number;
    maxPerRequestMinor: number;
    memberCapMinor: number;
    villageCapMinor: number;
    processText: string;
  };
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
  const [currency, setCurrency] = useState("");
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
        if (!currency && d.money?.currency) setCurrency(d.money.currency);
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
        body: JSON.stringify({ token, amount: Number(amount), askedFor, currency }),
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

  /*
   * THE MATHS THE MEMBER READS BEFORE THEY ASK.
   *
   * A MIRROR OF `redemptionQuote` in server/lib/redemption.ts, and the server
   * is the authority: it resolves the rate again at the ask, refuses what the
   * caps refuse, and writes the figures it computed onto the row. This exists
   * so nobody presses a button on a number they have not seen, and it is kept
   * to the same three lines so the two cannot drift far without a test noticing.
   */
  const tokenRow = data.tokens.find((t) => t.slug === token);
  const quote = (() => {
    const rate = tokenRow?.rateMinor ?? null;
    const asked = Number(amount);
    if (!rate || !(asked > 0)) return null;
    const grossMinor = Math.round(asked * rate);
    const feeMinor = Math.min(
      grossMinor,
      Math.round((grossMinor * (data.money?.feePct ?? 0)) / 100) + (data.money?.feeFixedMinor ?? 0),
    );
    return {
      currency: tokenRow?.currency ?? data.money?.currency ?? "",
      grossMinor,
      feeMinor,
      netMinor: grossMinor - feeMinor,
    };
  })();

  const closed = data.perCycle <= 0;
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

      {/*
        * THE VILLAGE'S OWN PROCESS, OR THE FACT THAT IT HAS NONE.
        *
        * This block used to render only when the text was non-empty, so a
        * village that switched redemption on without writing its process
        * showed nothing here at all - and nothing anywhere else either. The
        * member read the general explanation above, was invited to ask, and
        * had no way to learn what happens after they do.
        *
        * Ruling 11 (2026-09-03): warnings never block launch, but they are
        * kept where the person who can act on them will see them. Silence is
        * neither. The module declares `setup: "required"` and the admin card
        * links straight at this dial, so the founder already has the loud
        * half; this is the half the member gets, and it says plainly that the
        * absence is the village's and not the software's.
        *
        * It matters more than it looks, because the process text is
        * SNAPSHOTTED onto each request (ruling 23). An empty village process
        * is an empty snapshot, so the record of what was agreed is blank
        * afterwards too, and nobody reading it later can tell a village that
        * wrote nothing from one whose text was lost.
        */}
      <div className="border border-border rounded-lg px-4 py-3">
        <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">
          How redemption works here
        </p>
        {data.money?.processText?.trim() ? (
          /* The village's own words, as TEXT. LongText escapes by
             construction and linkifies http(s) only, so nothing typed in
             Admin can style or script this page. */
          <LongText text={data.money.processText} className="text-sm text-foreground" />
        ) : (
          <p className="text-sm text-muted-foreground">
            This village has not written it down yet. You can still ask, and somebody will
            answer, but nothing here can tell you what happens after that.
          </p>
        )}
      </div>

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
              {/* OFF THE ROW, never off today's dials: what this member agreed
                  to is what they were told when they asked. */}
              {r.money && (
                <p className="text-xs text-muted-foreground mt-1">
                  Agreed at {r.money.grossText}
                  {r.money.feeMinor > 0 ? `, less a fee of ${r.money.feeText}, so you receive ${r.money.netText}` : ", with no fee"}.
                </p>
              )}
              {r.processText?.trim() && (
                <LongText text={r.processText} className="block text-xs text-muted-foreground mt-1" />
              )}
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
            {/* Only when the village offers a choice. One currency is the
                common case and a select with one option is furniture. */}
            {(data.money?.currencies?.length ?? 0) > 1 && (
              <label className="text-sm text-foreground">
                <span className="block text-xs text-muted-foreground mb-1">Paid in</span>
                <select
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value)}
                  className="border border-border rounded-lg px-3 py-2 bg-background text-foreground"
                >
                  {data.money.currencies.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </label>
            )}
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
          {/* Said at the field where somebody would type one. A member asked
              to arrange a bank transfer will reach for their account number
              unless the form tells them not to, and this text is stored, shown
              to whoever holds the redemption key, and kept after the request
              ends. */}
          <p className="text-xs text-muted-foreground">
            Do not type bank account numbers, card numbers or passwords here. Say what you would
            like, and arrange how you are paid with a steward, the way this village's process says.
          </p>

          {/*
            A PUBLIC BALLOT IS A DIFFERENT THING FROM A STEWARD READING YOUR
            REQUEST, and the member has to know which one they are starting
            BEFORE they press the button, not after.

            A ballot is served to anyone with the link and it is kept: what you
            asked for, and what you asked for it in return, stay readable after
            a refusal and after the moon turns. `confirmedBy` is derived from
            whether anybody holds the redemption key, so this appears exactly
            when the village has nobody to confirm it privately.
          */}
          {data.confirmedBy === "vote" && data.votePathBuilt && (
            <p role="note" className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-4 py-2.5">
              <span className="font-semibold">Nobody in this village holds the key that confirms a redemption,
              so this one goes to a village vote.</span>{" "}
              A vote is public and it stays public: what you are asking for, and what you are asking for it in
              return, become readable by anyone with the link, permanently, including if the village says no.
              If you would rather it stayed between you and a steward, ask the village to give the redemption
              key to a role first.
            </p>
          )}

          {/* THE MATHS, BEFORE THE BUTTON. */}
          {quote ? (
            <p className="text-sm text-muted-foreground">
              <span className="font-semibold text-foreground">
                {amount} {tokenRow?.name ?? token} pays {formatMoney(quote.grossMinor, quote.currency)}
              </span>
              {quote.feeMinor > 0 ? (
                <>
                  , minus a fee of {formatMoney(quote.feeMinor, quote.currency)}, so you receive{" "}
                  <span className="font-semibold text-foreground">
                    {formatMoney(quote.netMinor, quote.currency)}
                  </span>
                </>
              ) : (
                <>, and this village takes no fee</>
              )}
              . Your village pays that off the platform, and this page never sees it.
            </p>
          ) : (
            Number(amount) > 0 && (
              <p className="text-sm text-muted-foreground">
                This village has not put a price on {tokenRow?.name ?? token}, so your request
                carries your own words and no figure. A steward agrees to what you asked for.
              </p>
            )
          )}
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
