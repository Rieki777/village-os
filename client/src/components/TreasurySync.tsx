/**
 * THE TREASURY SYNC AND THE INVOICE TRACK, on the member's Cash card
 * (invoice rails, Rye 2026-11-06).
 *
 * Two parts:
 *
 *   Your invoices   each live invoice's track: Sent, Received by Sera,
 *                   Approved, Paid, each with its date and who acted. A paid
 *                   invoice folds to one line; an open one shows its steps.
 *   Your numbers    one reconciled view: every token and cash figure with
 *                   where it came from and when it was last read, and a mark
 *                   on any row whose sources disagree. Sync reads them again.
 *
 * Sync is read-only and says so. It never moves money or tokens; a
 * difference goes to the Treasurer and is shown here as it is.
 *
 * The saved view loads without calling any source (`GET /api/me/treasury`),
 * so opening the profile costs nothing. The button is the only thing that
 * reads the sources, once a minute at most, and it says so.
 *
 * THE CARD IS A DARK SURFACE on the profile, so a disagreement is never a
 * light fill under theme text: it is an amber edge and a pill with its own
 * fixed colours (the 2026-11-06 UX pass measured 1.1:1 otherwise).
 */
import { useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { authToken } from "@/lib/gameApi";
import { formatMoney } from "@shared/money";
import { INVOICE_STATUS_WORDS, type InvoiceStatus } from "@shared/moonRecap";
import {
  SERA_STATE_WORDS,
  SERA_STATUS_WORDS,
  SOURCE_SHORT_WORDS,
  SOURCE_WORDS,
  TRACK_ACTOR_WORDS,
  TRACK_STEP_WORDS,
  TRACK_STOPPED_WORDS,
  TRACK_WAITING_WORDS,
  groupDecimal,
  type ReconciledView,
  type SyncSourceName,
  type TrackStep,
} from "@shared/invoiceTrack";

export interface TrackRow {
  invoiceId: string;
  ref: string;
  cycleId: string;
  status: string;
  currency: string;
  totalMinor: number;
  track: TrackStep[];
}

type View = ReconciledView & { syncedAt: string; sera: keyof typeof SERA_STATE_WORDS };

const COOLDOWN_S = 60;

const headers = (): Record<string, string> => {
  const t = authToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
};

const when = (at: string | null) => {
  if (!at) return "";
  const d = /^\d{4}-\d{2}-\d{2}$/.test(at) ? new Date(`${at}T12:00:00Z`) : new Date(at);
  return Number.isNaN(d.getTime()) ? at : d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
};
const instant = (at: string | null) => (at ? new Date(at).toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "");

/** The pill a differing row carries: fixed colours, readable on the dark card and the light desk alike. */
export function DiffersPill({ detail }: { detail: string }) {
  return (
    <span className="mt-1 inline-block rounded-full bg-amber-200 px-2 py-0.5 text-xs font-semibold text-amber-950">
      Differs<span className="sr-only">: {detail}</span>
    </span>
  );
}

/**
 * One invoice's four steps, as an ordered list a screen reader reads in
 * order, labelled with its amount and how far it got. `own` says "you" on the
 * member's own surfaces.
 */
export function InvoiceTrack({ row, own = false }: { row: TrackRow; own?: boolean }) {
  const doneCount = row.track.filter((s) => s.done).length;
  const current = row.track.find((s) => !s.done)?.step ?? null;
  return (
    <ol
      className="mt-2 grid grid-cols-1 gap-1.5 sm:grid-cols-4"
      aria-label={`Invoice ${row.ref}, ${formatMoney(row.totalMinor, row.currency)}, ${doneCount} of 4 steps done`}
    >
      {row.track.map((s) => {
        const stopped = !s.done && s.stopped ? TRACK_STOPPED_WORDS[s.stopped] : null;
        return (
          <li
            key={s.step}
            aria-current={s.step === current ? "step" : undefined}
            className={`rounded-lg border px-3 py-2 text-sm ${s.done ? "border-teal-deep/50" : stopped ? "border-amber-400" : "border-dashed border-border"}`}
          >
            <p className={`font-medium ${s.done ? "text-card-foreground" : "text-muted-foreground"}`}>
              <span aria-hidden="true">{s.done ? "✓ " : stopped ? "! " : ""}</span>
              {s.done ? TRACK_STEP_WORDS[s.step] : stopped ?? TRACK_WAITING_WORDS[s.step]}
            </p>
            {s.done && (
              <p className="text-xs text-muted-foreground">
                {when(s.at)}
                {s.by ? `, by ${own && s.by === "member" ? "you" : TRACK_ACTOR_WORDS[s.by]}` : ""}
                {s.note ? `. Bank reference ${s.note}` : ""}
              </p>
            )}
            {s.step === "sent" && s.done && (
              <p className="text-xs text-muted-foreground">{s.emailedAt ? `Emailed to Sera ${when(s.emailedAt)}` : "Not emailed to Sera yet"}</p>
            )}
          </li>
        );
      })}
    </ol>
  );
}

function SourceLine({ name, state, readAt, syncedAt }: { name: SyncSourceName; state: string; readAt: string | null; syncedAt: string }) {
  const said =
    state === "read" ? (readAt === syncedAt ? "read" : `read ${instant(readAt)}`)
      : state === "not_offered" ? "not offered"
        : readAt ? `not read this time (last ${instant(readAt)})` : "not read";
  return (
    <li className="flex flex-wrap justify-between gap-x-3 text-xs">
      <span className="font-medium text-card-foreground">{SOURCE_WORDS[name]}</span>
      <span className="text-muted-foreground">{said}</span>
    </li>
  );
}

/** A figure beside the village's, on one line a phone can hold. */
function Pair({ label, value, muted = false }: { label: string; value: string; muted?: boolean }) {
  return (
    <p className="flex justify-between gap-3 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className={`text-right tabular-nums ${muted ? "text-muted-foreground" : "text-card-foreground"}`}>{value}</span>
    </p>
  );
}

function OpenOrPaid({ t }: { t: TrackRow }) {
  const paid = t.track.find((s) => s.step === "paid");
  if (paid?.done) {
    return (
      <details className="rounded-xl border border-border p-4">
        <summary className="flex min-h-[44px] cursor-pointer flex-wrap items-center justify-between gap-2">
          <span className="font-semibold text-card-foreground">{formatMoney(t.totalMinor, t.currency)}</span>
          <span className="text-sm text-muted-foreground">Paid {when(paid.at)}</span>
        </summary>
        <p className="mt-1 text-xs text-muted-foreground">Invoice {t.ref}</p>
        <InvoiceTrack row={t} own />
      </details>
    );
  }
  return (
    <div className="rounded-xl border border-border p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-semibold text-card-foreground">{formatMoney(t.totalMinor, t.currency)}</p>
        <p className="text-xs text-muted-foreground">Invoice {t.ref}</p>
      </div>
      <InvoiceTrack row={t} own />
    </div>
  );
}

type Load = "loading" | "failed" | "ready";

export default function TreasurySync({ tracks }: { tracks: TrackRow[] }) {
  const [view, setView] = useState<View | null>(null);
  const [load, setLoad] = useState<Load>("loading");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [cooldown, setCooldown] = useState(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const readSaved = () => {
    setLoad("loading");
    fetch("/api/me/treasury", { headers: headers() })
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((d) => {
        setView(d?.view ?? null);
        setLoad("ready");
      })
      .catch(() => setLoad("failed"));
  };
  useEffect(readSaved, []);
  useEffect(() => () => { if (timer.current) clearInterval(timer.current); }, []);

  const startCooldown = () => {
    setCooldown(COOLDOWN_S);
    if (timer.current) clearInterval(timer.current);
    timer.current = setInterval(() => setCooldown((n) => {
      if (n <= 1 && timer.current) clearInterval(timer.current);
      return Math.max(0, n - 1);
    }), 1000);
  };

  const sync = async () => {
    setBusy(true);
    setError("");
    setStatus("");
    try {
      const res = await fetch("/api/me/treasury/sync", { method: "POST", headers: headers() });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 429) startCooldown();
        setError(res.status === 429 ? "You synced a moment ago. Try again in a minute." : res.status === 401 ? "Your sign-in has run out. Sign in again and try once more." : "The sync did not finish. Try again in a moment.");
        return;
      }
      const v = (out.view ?? null) as View | null;
      setView(v);
      setLoad("ready");
      startCooldown();
      const n = v ? v.tokens.filter((t) => t.disagree).length + v.invoices.filter((i) => i.disagree).length : 0;
      setStatus(n === 0 ? "Synced. Every source that was read agrees." : `Synced. ${n} ${n === 1 ? "row differs" : "rows differ"}, and the Treasurer can see ${n === 1 ? "it" : "them"}.`);
    } catch {
      setError("The sync did not finish. Try again in a moment.");
    } finally {
      setBusy(false);
    }
  };

  const differs = view ? view.tokens.filter((t) => t.disagree).length + view.invoices.filter((i) => i.disagree).length : 0;
  const seraRead = view?.sources.sera.state === "read";

  return (
    <div className="space-y-5">
      {differs > 0 && (
        <p className="rounded-lg border-l-4 border-amber-400 bg-amber-100 p-3 text-sm font-medium text-amber-950">
          {differs === 1 ? "One of your numbers differs" : `${differs} of your numbers differ`} between sources. The Treasurer has been shown {differs === 1 ? "it" : "each one"}.
        </p>
      )}

      {tracks.length > 0 && (
        <section aria-labelledby="invoice-tracks" className="space-y-3">
          <h4 id="invoice-tracks" className="font-semibold text-card-foreground">Your invoices</h4>
          <ul className="space-y-3">
            {tracks.map((t) => <li key={t.invoiceId}><OpenOrPaid t={t} /></li>)}
          </ul>
        </section>
      )}

      <section aria-labelledby="treasury-numbers" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h4 id="treasury-numbers" className="font-semibold text-card-foreground">Your numbers, from every source</h4>
          <button
            type="button"
            onClick={() => void sync()}
            disabled={busy || cooldown > 0}
            aria-describedby="treasury-sync-note"
            className="inline-flex min-h-[44px] items-center gap-2 rounded-full border border-border px-4 text-sm font-medium text-foreground hover:bg-muted disabled:opacity-40"
          >
            <RefreshCw className={`h-4 w-4 ${busy ? "animate-spin" : ""}`} aria-hidden="true" />
            {busy ? "Syncing" : cooldown > 0 ? `Sync again in ${cooldown}s` : "Sync"}
          </button>
        </div>
        <p id="treasury-sync-note" className="text-sm text-muted-foreground">
          Sync reads three sources again: this village's records, the Base chain (the public ledger some tokens live on) and Sera
          (the village's record keeper). It only reads, so nothing is paid or moved. Any difference goes to the Treasurer. You can
          sync once a minute.
        </p>
        <p role="status" className="text-sm text-card-foreground">{status}</p>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}

        {load === "loading" && !view ? (
          <p className="text-sm text-muted-foreground">Reading your saved numbers.</p>
        ) : load === "failed" && !view ? (
          <div className="space-y-2 text-sm text-muted-foreground">
            <p>Your saved numbers did not load.</p>
            <button type="button" onClick={readSaved} className="min-h-[44px] rounded-full border border-border px-4 text-sm font-medium text-foreground">Try again</button>
          </div>
        ) : !view ? (
          <p className="text-sm text-muted-foreground">Not synced yet. Press Sync to read every source.</p>
        ) : (
          <div className="space-y-4">
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Last synced {instant(view.syncedAt)}</p>
              <ul className="space-y-1 rounded-xl border border-border p-3">
                {(["village", "chain", "sera"] as const).map((s) => (
                  <SourceLine key={s} name={s} state={view.sources[s].state} readAt={view.sources[s].readAt} syncedAt={view.syncedAt} />
                ))}
              </ul>
              {SERA_STATE_WORDS[view.sera] && <p className="text-sm text-muted-foreground">{SERA_STATE_WORDS[view.sera]}</p>}
            </div>

            {view.tokens.length > 0 && (
              <section aria-label="Tokens, by source" className="space-y-2">
                {view.tokens.map((t) => (
                  <div key={t.slug} className={`rounded-lg border p-3 ${t.disagree ? "border-l-4 border-amber-400" : "border-border"}`}>
                    <p className="font-medium text-card-foreground">{t.name}</p>
                    <Pair label={SOURCE_SHORT_WORDS.village} value={groupDecimal(t.village)} />
                    <Pair
                      label={SOURCE_SHORT_WORDS.chain}
                      value={t.chain === null ? "Not on chain" : `${groupDecimal(t.chain)}${t.chainStale ? ` (as of ${instant(t.chainReadAt)})` : ""}`}
                      muted={t.chain === null}
                    />
                    {t.disagree && <DiffersPill detail={`this village's records say ${t.village}, the chain says ${t.chain ?? "nothing"}`} />}
                  </div>
                ))}
              </section>
            )}

            {view.cash.length > 0 && (
              <p className="text-sm text-card-foreground">
                Cash still owed to you, from this village's records: {view.cash.map((c) => formatMoney(c.owedMinor, c.currency)).join(", ")}
              </p>
            )}

            {view.invoices.length > 0 && (
              <section aria-label="Invoices, by source" className="space-y-2">
                {view.invoices.map((i) => (
                  <div key={i.ref} className={`rounded-lg border p-3 ${i.disagree ? "border-l-4 border-amber-400" : "border-border"}`}>
                    <p className="font-medium text-card-foreground">Invoice {i.ref}</p>
                    <Pair label={SOURCE_SHORT_WORDS.village} value={`${formatMoney(i.villageMinor, i.currency)}, ${INVOICE_STATUS_WORDS[i.status as InvoiceStatus] ?? i.status}`} />
                    <Pair
                      label={SOURCE_SHORT_WORDS.sera}
                      value={!seraRead ? "Not read" : i.seraMinor === null ? "No record" : `${formatMoney(i.seraMinor, i.seraCurrency ?? i.currency)}, ${i.seraStatus ? SERA_STATUS_WORDS[i.seraStatus] : ""}`}
                      muted={!seraRead || i.seraMinor === null}
                    />
                    {i.disagree && <DiffersPill detail={`Sera's record differs from this village's for invoice ${i.ref}`} />}
                  </div>
                ))}
              </section>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
