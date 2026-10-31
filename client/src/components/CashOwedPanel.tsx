/**
 * THE CASH THE VILLAGE OWES, ON THE MEMBER'S PROFILE (0285).
 *
 * Rye, 2026-10-23: "The Game wouldn't pay cash, but it would say what they are
 * owed and they can claim it when they're paid out so that the treasurer has a
 * record to check when sending or giving cash payments."
 *
 * Two halves in one card, because they are the two ends of one record:
 *
 *   what I am owed     every amount a quest, a role or an accepted proposal
 *                      left owing me, with a Claim button while it is owed
 *   what we owe        for whoever holds `cash.pay`, the treasurer's list:
 *                      everything unpaid, a note on how it was paid, and the
 *                      recent payments, so the record can be checked later
 *
 * ON THE PROFILE AND NOT ON /wallet, because that page sits behind the exchange
 * module and a village with the exchange off would have no door onto its own
 * cash. The treasurer's half asks for the queue only when the member route
 * says the viewer may hold the key (`mayPay`), so an ordinary member never
 * takes a refused request (ruling 28). The queue route still runs the gate.
 *
 * Renders nothing at all for a member who is owed nothing and keeps no books.
 */
import { useEffect, useState } from "react";
import { HandCoins } from "lucide-react";
import { authToken } from "@/lib/gameApi";
import { formatMoney } from "@shared/money";
import {
  CASH_PAID_NOTE_MAX,
  CASH_STATE_WORDS,
  CASH_WORK_WORDS,
  cashYearsPaid,
  type CashOwedEntry,
  type CashQueueEntry,
} from "@shared/cashOwed";

const headers = (): Record<string, string> => {
  const t = authToken();
  return t ? { Authorization: `Bearer ${t}`, "Content-Type": "application/json" } : { "Content-Type": "application/json" };
};

const day = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" }) : "";

export default function CashOwedPanel() {
  const [entries, setEntries] = useState<CashOwedEntry[] | null>(null);
  const [queue, setQueue] = useState<{ unpaid: CashQueueEntry[]; paid: CashQueueEntry[] } | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const load = () => {
    fetch("/api/me/cash-owed", { headers: headers() })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        setEntries(d ? d.entries : null);
        if (!d?.mayPay) return setQueue(null);
        return fetch("/api/cash-owed/queue", { headers: headers() })
          .then((r) => (r.ok ? r.json() : null))
          .then((q) => setQueue(q ? { unpaid: q.unpaid ?? [], paid: q.paid ?? [] } : null));
      })
      .catch(() => {
        setEntries(null);
        setQueue(null);
      });
  };
  useEffect(load, []);

  const act = async (path: string, body: unknown, done: string) => {
    setError("");
    setNotice("");
    setBusy(true);
    try {
      const res = await fetch(path, { method: "POST", headers: headers(), body: JSON.stringify(body) });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) {
        // A 401 or 403 is the session or the key, and its `error` is a code
        // (E7, 2026-10-31): only its sentence is shown. Other refusals here
        // carry their sentence in `error` and keep it.
        const said = typeof out?.message === "string" ? out.message.trim() : "";
        setError(
          res.status === 401 ? "Your sign-in has run out, so that did not go through. Sign in again and try once more."
            : said || (res.status === 403 ? "That did not go through: this account does not hold the key for it." : out?.error) || "That did not go through.",
        );
        return;
      }
      setNotice(done);
      load();
    } catch {
      setError("That did not go through.");
    } finally {
      setBusy(false);
    }
  };

  /* A member's own year, for their taxes or books (Rye, 2026-10-30). Fetched with the token, then saved. */
  const downloadYear = async (year: number) => {
    setError("");
    try {
      const res = await fetch(`/api/me/cash-owed/export.csv?year=${year}`, { headers: headers() });
      if (!res.ok) {
        setError("The file did not download. Try again in a moment.");
        return;
      }
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = `cash-received-${year}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setError("The file did not download. Try again in a moment.");
    }
  };

  const mine = entries ?? [];
  const paidYears = cashYearsPaid(mine);
  const keepsBooks = !!queue;
  if (mine.length === 0 && !keepsBooks) return null;

  return (
    <div id="cash-owed" className="scroll-mt-24 rounded-2xl bg-card p-6 shadow-lg sm:p-8 space-y-5">
      <div>
        <h3 className="flex items-center gap-2 font-display text-xl font-bold text-card-foreground">
          <HandCoins className="h-6 w-6" aria-hidden="true" />
          Cash
        </h3>
        <p className="mt-2 text-sm text-muted-foreground">
          The village pays cash itself. Each amount here was written down when the work was paid. Claim it when the
          village pays out, and whoever keeps the books marks it paid.
        </p>
      </div>

      {notice && <p className="text-sm text-foreground">{notice}</p>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}

      {mine.length > 0 && (
        <section aria-labelledby="cash-mine" className="space-y-3">
          <h4 id="cash-mine" className="font-semibold text-card-foreground">Owed to you</h4>
          <ul className="space-y-3">
            {mine.map((e) => (
              <li key={e.id} className="rounded-xl border border-border p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="font-semibold text-card-foreground">{formatMoney(e.amountMinor, e.currency)}</p>
                  <p className="text-xs text-muted-foreground">{CASH_STATE_WORDS[e.state]}</p>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  {CASH_WORK_WORDS[e.workKind]}: {e.workTitle}, owed since {day(e.owedAt)}
                </p>
                {e.state === "paid" && (
                  <p className="mt-1 text-sm text-muted-foreground">
                    Paid {day(e.paidAt)}{e.paidNote ? `: ${e.paidNote}` : ""}
                  </p>
                )}
                {e.state === "owed" && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => act(`/api/me/cash-owed/${e.id}/claim`, {}, "Claimed. Whoever keeps the books can see it now.")}
                    className="mt-3 min-h-9 rounded-full border border-border px-4 py-1.5 text-sm font-medium text-foreground disabled:opacity-40"
                  >
                    Claim
                  </button>
                )}
              </li>
            ))}
          </ul>
          {paidYears.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <p className="text-sm text-muted-foreground">For your taxes or books:</p>
              {paidYears.map((y) => (
                <button
                  key={y}
                  type="button"
                  onClick={() => void downloadYear(y)}
                  className="min-h-[44px] rounded-full border border-border px-4 text-sm font-medium text-foreground hover:bg-muted"
                >
                  Download cash received in {y}
                </button>
              ))}
            </div>
          )}
        </section>
      )}

      {keepsBooks && (
        <section aria-labelledby="cash-books" className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h4 id="cash-books" className="font-semibold text-card-foreground">What the village owes</h4>
            <a href="/cash-payouts" className="inline-flex min-h-[44px] items-center rounded-lg bg-teal-deep px-4 text-sm font-semibold text-white hover:bg-teal-deep-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-deep focus-visible:ring-offset-2">
              Record a bank transfer
            </a>
          </div>
          {queue!.unpaid.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing is waiting to be paid.</p>
          ) : (
            <ul className="space-y-3">
              {queue!.unpaid.map((e) => (
                <li key={e.id} className="rounded-xl border border-border p-4 space-y-2">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="font-semibold text-card-foreground">
                      {formatMoney(e.amountMinor, e.currency)} to {e.memberName}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {e.state === "claimed" ? `Claimed ${day(e.claimedAt)}` : `Owed since ${day(e.owedAt)}`}
                    </p>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {CASH_WORK_WORDS[e.workKind]}: {e.workTitle}
                  </p>
                  <label className="block text-xs font-medium text-muted-foreground">
                    How it was paid
                    <input
                      value={notes[e.id] ?? ""}
                      maxLength={CASH_PAID_NOTE_MAX}
                      onChange={(ev) => setNotes({ ...notes, [e.id]: ev.target.value })}
                      placeholder="Bank transfer, 24 October"
                      className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
                    />
                  </label>
                  <button
                    type="button"
                    disabled={busy || !(notes[e.id] ?? "").trim()}
                    onClick={() => act(`/api/cash-owed/${e.id}/paid`, { note: notes[e.id] ?? "" }, `Marked paid. ${e.memberName} has been told.`)}
                    className="min-h-9 rounded-full border border-border px-4 py-1.5 text-sm font-medium text-foreground disabled:opacity-40"
                  >
                    Mark paid
                  </button>
                </li>
              ))}
            </ul>
          )}
          {queue!.paid.length > 0 && (
            <details className="text-sm">
              <summary className="cursor-pointer text-muted-foreground">Recent payments</summary>
              <ul className="mt-2 space-y-1.5">
                {queue!.paid.map((e) => (
                  <li key={e.id} className="text-muted-foreground">
                    {formatMoney(e.amountMinor, e.currency)} to {e.memberName}, {e.workTitle}. Paid {day(e.paidAt)}
                    {e.paidByName ? ` by ${e.paidByName}` : ""}{e.paidNote ? `: ${e.paidNote}` : ""}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </section>
      )}
    </div>
  );
}
