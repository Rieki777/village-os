/**
 * CASH TO PAY OUT, THE TREASURER'S DESK IN ADMIN (0285, 2026-10-30).
 *
 * Rye, 2026-10-30: "in admin for the finance roles we have a whole list of
 * cash that's yet to be paid out, so when a bank transfer is sent to pay out
 * that role we redeem their cash credits."
 *
 * The platform never pays fiat. Each line is the village's record of cash it
 * owes one member for one piece of work. The treasurer pays off-platform, then
 * records the bank transfer here: some or all of one member's lines, the date
 * it went out and its reference. Those lines become paid together, the member
 * is told, and the record is checkable later. Amounts are read off the lines
 * and can never be edited here.
 *
 * WHO SEES IT is the server's one gate (`cash.pay` in shared/capabilities.ts):
 * every read and write here asks `guardCapability`, and this panel renders the
 * refusal it gets back. Nothing in this file decides permission.
 *
 * A REFUSAL IS A SENTENCE, NEVER A CODE (E7, 2026-10-31). /cash-payouts showed
 * a member the raw "auth_required". Now a 401 is a session that is missing or
 * ran out, and asks for a sign-in that comes back here. A 403 is the key, and
 * shows the server's sentence naming who pays cash out, with a way to write
 * to them. Neither ever prints `error`, which is the machine's word.
 *
 * Light-only, like the rest of this folder.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { HandCoins } from "lucide-react";
import { API_BASE, authHeaders, refusal } from "@/components/admin/adminApi";
import { formatMoney } from "@shared/money";
import {
  CASH_REFERENCE_MAX,
  CASH_WORK_WORDS,
  cashTotalsByCurrency,
  type CashQueueEntry,
} from "@shared/cashOwed";

type View = "unpaid" | "paid";
type ClaimFilter = "all" | "claimed" | "unclaimed";

const day = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "";

const today = () => new Date().toISOString().slice(0, 10);

const totalsText = (rows: ReadonlyArray<{ amountMinor: number; currency: string }>) =>
  cashTotalsByCurrency(rows).map((t) => formatMoney(t.minor, t.currency)).join(" + ") || formatMoney(0, "USD");

interface Group {
  userId: string;
  name: string;
  rows: CashQueueEntry[];
}

function groupByMember(rows: CashQueueEntry[]): Group[] {
  const map = new Map<string, Group>();
  for (const r of rows) {
    const g = map.get(r.userId) ?? { userId: r.userId, name: r.memberName, rows: [] };
    g.rows.push(r);
    map.set(r.userId, g);
  }
  return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
}

const SIGN_IN_WORDS = "Sign in to read the cash the village owes.";
/** What did not happen, once the sign-in ran out mid-page. */
const sessionEndedWords = (what: string) => `Your sign-in has run out, so ${what}.`;
const NO_KEY_WORDS = "Paying cash out needs the treasurer's key, and this account does not hold it.";

/** Back to this very page after signing in, inside the admin panel or out of it. */
const signInHref = () => `/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`;

/** A 403 from the key: its sentence when it carries one, never its code. */
const keyWords = (body: { message?: unknown } | null | undefined) => {
  const text = typeof body?.message === "string" ? body.message.trim() : "";
  return text || NO_KEY_WORDS;
};

type Refused = { kind: "signed-out" } | { kind: "no-key"; text: string } | { kind: "failed"; text: string };

export default function CashPayoutsTab({ password, asPage = false }: {
  password: string;
  /** On its own page the title is the page's h1; inside the admin panel, which owns the h1, it is an h2. */
  asPage?: boolean;
}) {
  const Heading = asPage ? "h1" : "h2";
  const [data, setData] = useState<{ unpaid: CashQueueEntry[]; paid: CashQueueEntry[] } | null>(null);
  const [refused, setRefused] = useState<Refused | null>(null);
  const [sessionEnded, setSessionEnded] = useState(false);
  const [view, setView] = useState<View>("unpaid");
  const [claimFilter, setClaimFilter] = useState<ClaimFilter>("all");
  const [currency, setCurrency] = useState("all");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [payingFor, setPayingFor] = useState<string | null>(null);
  const [transferDate, setTransferDate] = useState(today());
  const [reference, setReference] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  /** The list closes and the refusal takes its place. */
  const shut = (why: Refused) => {
    setData(null);
    setRefused(why);
  };

  const load = useCallback(async () => {
    if (!password) {
      shut({ kind: "signed-out" });
      return;
    }
    try {
      const res = await fetch(`${API_BASE}/cash-owed/queue?history=1`, { headers: authHeaders(password) });
      const body = await res.json().catch(() => ({}));
      if (res.status === 401) return shut({ kind: "signed-out" });
      if (res.status === 403) return shut({ kind: "no-key", text: keyWords(body) });
      if (!res.ok) {
        shut({ kind: "failed", text: refusal(body, "Only a holder of the treasurer's key can read the cash the village owes.") });
        return;
      }
      setRefused(null);
      setData({ unpaid: body.unpaid ?? [], paid: body.paid ?? [] });
    } catch {
      setRefused({ kind: "failed", text: "The list did not load. Try again in a moment." });
    }
  }, [password]);
  useEffect(() => { void load(); }, [load]);

  const rows = view === "unpaid" ? data?.unpaid ?? [] : data?.paid ?? [];
  const currencies = useMemo(
    () => Array.from(new Set([...(data?.unpaid ?? []), ...(data?.paid ?? [])].map((r) => r.currency))).sort(),
    [data],
  );
  const shown = rows.filter((r) =>
    (currency === "all" || r.currency === currency)
    && (view === "paid" || claimFilter === "all" || (claimFilter === "claimed" ? r.state === "claimed" : r.state === "owed")),
  );
  const groups = groupByMember(shown);

  const startTransfer = (g: Group) => {
    setPayingFor(g.userId);
    setPicked(new Set(g.rows.map((r) => r.id)));
    setTransferDate(today());
    setReference("");
    setConfirming(false);
    setError("");
    setSessionEnded(false);
    setNotice("");
  };
  /**
   * A write the session or the key refused. A session that ran out keeps the
   * form as it was typed and asks for a sign-in; a key taken away while the
   * page was open closes the list, because nothing on it can be done now.
   */
  const refusedWrite = (status: number, body: unknown, what: string): boolean => {
    if (status === 401) {
      setError(sessionEndedWords(what));
      setSessionEnded(true);
      return true;
    }
    if (status === 403) {
      shut({ kind: "no-key", text: keyWords(body as { message?: unknown }) });
      return true;
    }
    return false;
  };
  const cancelTransfer = () => {
    setPayingFor(null);
    setPicked(new Set());
    setConfirming(false);
  };
  const toggle = (id: string) => {
    const next = new Set(picked);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setPicked(next);
    setConfirming(false);
  };

  const submit = async (g: Group) => {
    if (busy) return;
    setBusy(true);
    setError("");
    setSessionEnded(false);
    try {
      const res = await fetch(`${API_BASE}/cash-owed/transfers`, {
        method: "POST",
        headers: authHeaders(password, { "Content-Type": "application/json" }),
        body: JSON.stringify({ userId: g.userId, ids: Array.from(picked), transferDate, reference }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setConfirming(false);
        if (refusedWrite(res.status, body, "the transfer was not recorded")) return;
        setError(refusal(body, "The transfer was not recorded."));
        if (res.status === 409) await load();
        return;
      }
      setNotice(`Recorded. ${body.paid} ${body.paid === 1 ? "line is" : "lines are"} paid, and ${g.name} has been told.`);
      cancelTransfer();
      await load();
    } catch {
      setError("The transfer was not recorded. Try again in a moment.");
    } finally {
      setBusy(false);
    }
  };

  const exportCsv = async () => {
    setError("");
    setSessionEnded(false);
    try {
      const res = await fetch(`${API_BASE}/cash-owed/export.csv`, { headers: authHeaders(password) });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        if (refusedWrite(res.status, body, "the export did not download")) return;
        setError(refusal(body, "The export did not download."));
        return;
      }
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = `cash-owed-${today()}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setError("The export did not download.");
    }
  };

  if (refused) {
    const link = "inline-flex min-h-[44px] items-center font-medium text-teal-deep underline";
    return (
      <div className="rounded-xl border border-border bg-white p-6">
        <Heading className="text-xl font-semibold text-foreground">Cash to pay out</Heading>
        {refused.kind === "signed-out" ? (
          <>
            <p className="mt-2 text-sm text-muted-foreground">{SIGN_IN_WORDS}</p>
            <a href={signInHref()} className={`${link} text-sm`}>Sign in</a>
          </>
        ) : (
          <>
            <p role="alert" className="mt-2 text-sm text-muted-foreground">{refused.text}</p>
            {refused.kind === "no-key" && <a href="/messages?new=1" className={`${link} text-sm`}>Write a message</a>}
          </>
        )}
      </div>
    );
  }
  if (!data) return <p className="text-sm text-muted-foreground">Loading the cash the village owes.</p>;

  const pickedRows = (g: Group) => g.rows.filter((r) => picked.has(r.id));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Heading className="flex items-center gap-2 text-xl font-semibold text-foreground">
            <HandCoins className="h-5 w-5" aria-hidden="true" />
            Cash to pay out
          </Heading>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            What the village owes each member in cash, for their roles, quests and accepted proposals. The village pays
            by bank transfer itself. Record each transfer here and its lines become paid.
          </p>
        </div>
        <button
          type="button"
          onClick={exportCsv}
          className="min-h-9 rounded-lg border border-border bg-white px-3 py-1.5 text-sm font-medium text-foreground"
        >
          Export CSV
        </button>
      </div>

      <section aria-label="Totals" className="rounded-xl border border-border bg-white p-4">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {view === "unpaid" ? "Still to pay" : "Paid"}
        </p>
        <ul className="mt-1 flex flex-wrap gap-x-6 gap-y-1">
          {cashTotalsByCurrency(shown).map((t) => (
            <li key={t.currency} data-testid={`total-${t.currency}`} className="text-lg font-semibold text-foreground">
              {formatMoney(t.minor, t.currency)}
            </li>
          ))}
          {shown.length === 0 && <li className="text-lg font-semibold text-foreground">Nothing</li>}
        </ul>
      </section>

      <div className="flex flex-wrap items-end gap-3">
        <div role="tablist" aria-label="Which lines" className="flex rounded-lg border border-border bg-white p-0.5">
          {(["unpaid", "paid"] as const).map((v) => (
            <button
              key={v}
              type="button"
              role="tab"
              aria-selected={view === v}
              onClick={() => { setView(v); cancelTransfer(); }}
              className={`min-h-9 rounded-md px-3 py-1.5 text-sm font-medium ${view === v ? "bg-teal-deep text-white" : "text-foreground"}`}
            >
              {v === "unpaid" ? `To pay (${data.unpaid.length})` : "Paid"}
            </button>
          ))}
        </div>
        {view === "unpaid" && (
          <label className="text-xs font-medium text-muted-foreground">
            Claimed
            <select
              value={claimFilter}
              onChange={(e) => setClaimFilter(e.target.value as ClaimFilter)}
              className="mt-1 block rounded-lg border border-border bg-white px-2 py-1.5 text-sm text-foreground"
            >
              <option value="all">All lines</option>
              <option value="claimed">Claimed by the member</option>
              <option value="unclaimed">Not claimed yet</option>
            </select>
          </label>
        )}
        <label className="text-xs font-medium text-muted-foreground">
          Currency
          <select
            value={currency}
            onChange={(e) => setCurrency(e.target.value)}
            className="mt-1 block rounded-lg border border-border bg-white px-2 py-1.5 text-sm text-foreground"
          >
            <option value="all">Every currency</option>
            {currencies.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
      </div>

      {notice && <p className="text-sm text-foreground">{notice}</p>}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
          {sessionEnded && <> <a href={signInHref()} className="font-medium underline">Sign in again</a></>}
        </p>
      )}

      {groups.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {view === "unpaid" ? "Nothing here is waiting to be paid." : "No payments recorded yet."}
        </p>
      ) : (
        <ul className="space-y-4">
          {groups.map((g) => {
            const paying = payingFor === g.userId;
            const chosen = pickedRows(g);
            return (
              <li key={g.userId} className="rounded-xl border border-border bg-white p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h3 className="font-semibold text-foreground">{g.name}</h3>
                  <p className="text-sm font-semibold text-foreground">
                    {view === "unpaid" ? "Owed " : "Paid "}{totalsText(g.rows)}
                  </p>
                </div>
                <ul className="mt-3 divide-y divide-border">
                  {g.rows.map((r) => (
                    <li key={r.id} className="flex flex-wrap items-start gap-3 py-2 text-sm">
                      {paying && (
                        <input
                          type="checkbox"
                          aria-label={`Include ${r.workTitle}`}
                          checked={picked.has(r.id)}
                          onChange={() => toggle(r.id)}
                          className="mt-1"
                        />
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="text-foreground">
                          {CASH_WORK_WORDS[r.workKind]}: {r.workTitle}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Owed {day(r.owedAt)}
                          {view === "unpaid"
                            ? r.state === "claimed" ? `. Claimed ${day(r.claimedAt)}` : ". Not claimed yet"
                            : `. Recorded paid ${day(r.paidAt)}${r.paidByName ? ` by ${r.paidByName}` : ""}`}
                        </p>
                        {view === "paid" && r.paidNote && <p className="text-xs text-muted-foreground">{r.paidNote}</p>}
                      </div>
                      <p className="font-medium text-foreground">{formatMoney(r.amountMinor, r.currency)}</p>
                    </li>
                  ))}
                </ul>

                {view === "unpaid" && !paying && (
                  <button
                    type="button"
                    onClick={() => startTransfer(g)}
                    className="mt-3 min-h-9 rounded-lg bg-teal-deep px-3 py-1.5 text-sm font-medium text-white"
                  >
                    Record a bank transfer
                  </button>
                )}

                {paying && (
                  <div className="mt-3 space-y-3 rounded-lg bg-gray-50 p-3">
                    <div className="flex flex-wrap gap-3 text-xs">
                      <button type="button" onClick={() => setPicked(new Set(g.rows.map((r) => r.id)))} className="underline text-foreground">
                        Pick every line
                      </button>
                      <button type="button" onClick={() => setPicked(new Set())} className="underline text-foreground">
                        Clear
                      </button>
                    </div>
                    <div className="flex flex-wrap gap-3">
                      <label className="text-xs font-medium text-muted-foreground">
                        Day the transfer went out
                        <input
                          type="date"
                          value={transferDate}
                          max={today()}
                          onChange={(e) => { setTransferDate(e.target.value); setConfirming(false); }}
                          className="mt-1 block rounded-lg border border-border bg-white px-2 py-1.5 text-sm text-foreground"
                        />
                      </label>
                      <label className="min-w-[14rem] flex-1 text-xs font-medium text-muted-foreground">
                        Bank reference or note
                        <input
                          value={reference}
                          maxLength={CASH_REFERENCE_MAX}
                          onChange={(e) => { setReference(e.target.value); setConfirming(false); }}
                          placeholder="The reference on the bank transfer"
                          className="mt-1 block w-full rounded-lg border border-border bg-white px-2 py-1.5 text-sm text-foreground"
                        />
                      </label>
                    </div>
                    {confirming ? (
                      <div className="space-y-2">
                        <p className="text-sm text-foreground">
                          Record {chosen.length} {chosen.length === 1 ? "line" : "lines"}, {totalsText(chosen)}, paid to {g.name} by
                          bank transfer on {transferDate}? This cannot be undone.
                        </p>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => submit(g)}
                            className="min-h-9 rounded-lg bg-teal-deep px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
                          >
                            Yes, record it
                          </button>
                          <button type="button" onClick={() => setConfirming(false)} className="min-h-9 rounded-lg border border-border px-3 py-1.5 text-sm text-foreground">
                            Back
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex gap-2">
                        <button
                          type="button"
                          disabled={chosen.length === 0 || !reference.trim() || !transferDate}
                          onClick={() => setConfirming(true)}
                          className="min-h-9 rounded-lg bg-teal-deep px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
                        >
                          Review the transfer
                        </button>
                        <button type="button" onClick={cancelTransfer} className="min-h-9 rounded-lg border border-border px-3 py-1.5 text-sm text-foreground">
                          Cancel
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
