/**
 * THE TREASURY SYNC AND THE INVOICE TRACK, on the member's Cash card
 * (invoice rails, Rye 2026-11-06).
 *
 * Two parts:
 *
 *   Your invoices   each live invoice's track: Sent, Received by Sera,
 *                   Approved, Paid, each with its date and who acted
 *   Your numbers    one reconciled table: every token and cash figure with
 *                   where it came from and when it was last read, and a mark
 *                   on any row whose sources disagree. Sync reads them again.
 *
 * Sync is read-only and says so. It never moves money or tokens; a
 * difference goes to the Treasurer and is shown here as it is.
 *
 * The saved view loads without calling any source (`GET /api/me/treasury`),
 * so opening the profile costs nothing. The button is the only thing that
 * reads the sources, once a minute at most.
 */
import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { authToken } from "@/lib/gameApi";
import { formatMoney } from "@shared/money";
import { INVOICE_STATUS_WORDS } from "@shared/moonRecap";
import {
  SERA_STATE_WORDS,
  SERA_STATUS_WORDS,
  SOURCE_WORDS,
  TRACK_ACTOR_WORDS,
  TRACK_STEP_WORDS,
  TRACK_WAITING_WORDS,
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

/** One invoice's four steps, as an ordered list a screen reader reads in order. */
export function InvoiceTrack({ row }: { row: TrackRow }) {
  return (
    <ol className="mt-2 grid grid-cols-1 gap-1.5 sm:grid-cols-4" aria-label={`Invoice ${row.ref}`}>
      {row.track.map((s) => (
        <li key={s.step} className={`rounded-lg border px-3 py-2 text-sm ${s.done ? "border-teal-deep/40 bg-teal-deep/5" : "border-border"}`}>
          <p className="font-medium text-card-foreground">
            <span aria-hidden="true">{s.done ? "✓ " : "○ "}</span>
            {s.done ? TRACK_STEP_WORDS[s.step] : TRACK_WAITING_WORDS[s.step]}
          </p>
          {s.done && (
            <p className="text-xs text-muted-foreground">
              {when(s.at)}
              {s.by ? `, by ${TRACK_ACTOR_WORDS[s.by]}` : ""}
              {s.note ? `. Reference ${s.note}` : ""}
            </p>
          )}
          {s.step === "sent" && s.done && (
            <p className="text-xs text-muted-foreground">{s.emailedAt ? `Emailed to Sera ${when(s.emailedAt)}` : "Not emailed to Sera yet"}</p>
          )}
        </li>
      ))}
    </ol>
  );
}

function SourceLine({ name, state, readAt }: { name: SyncSourceName; state: string; readAt: string | null }) {
  const said = state === "read" ? `read ${instant(readAt)}` : state === "not_offered" ? "not offered" : readAt ? `not read this time (last ${instant(readAt)})` : "not read";
  return (
    <li className="flex flex-wrap justify-between gap-x-3 text-xs">
      <span className="font-medium text-card-foreground">{SOURCE_WORDS[name]}</span>
      <span className="text-muted-foreground">{said}</span>
    </li>
  );
}

export default function TreasurySync({ tracks }: { tracks: TrackRow[] }) {
  const [view, setView] = useState<View | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/me/treasury", { headers: headers() })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setView(d?.view ?? null))
      .catch(() => setView(null));
  }, []);

  const sync = async () => {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/me/treasury/sync", { method: "POST", headers: headers() });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(res.status === 429 ? "You synced a moment ago. Try again in a minute." : res.status === 401 ? "Your sign-in has run out. Sign in again and try once more." : "The sync did not finish. Try again in a moment.");
        return;
      }
      setView(out.view ?? null);
    } catch {
      setError("The sync did not finish. Try again in a moment.");
    } finally {
      setBusy(false);
    }
  };

  const differs = view ? view.tokens.some((t) => t.disagree) || view.invoices.some((i) => i.disagree) : false;

  return (
    <div className="space-y-5">
      {tracks.length > 0 && (
        <section aria-labelledby="invoice-tracks" className="space-y-3">
          <h4 id="invoice-tracks" className="font-semibold text-card-foreground">Your invoices</h4>
          <ul className="space-y-3">
            {tracks.map((t) => (
              <li key={t.invoiceId} className="rounded-xl border border-border p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="font-semibold text-card-foreground">{formatMoney(t.totalMinor, t.currency)}</p>
                  <p className="text-xs text-muted-foreground">Reference {t.ref}</p>
                </div>
                <InvoiceTrack row={t} />
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="treasury-numbers" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h4 id="treasury-numbers" className="font-semibold text-card-foreground">Your numbers, from every source</h4>
          <button
            type="button"
            onClick={() => void sync()}
            disabled={busy}
            aria-describedby="treasury-sync-note"
            className="inline-flex min-h-[44px] items-center gap-2 rounded-full border border-border px-4 text-sm font-medium text-foreground hover:bg-muted disabled:opacity-40"
          >
            <RefreshCw className={`h-4 w-4 ${busy ? "animate-spin" : ""}`} aria-hidden="true" />
            {busy ? "Syncing" : "Sync"}
          </button>
        </div>
        <p id="treasury-sync-note" className="text-sm text-muted-foreground">
          Sync reads this village's records, the Base chain and Sera again. It only reads: nothing is paid or moved. Any difference goes to the Treasurer.
        </p>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}

        {!view ? (
          <p className="text-sm text-muted-foreground">Not synced yet. Press Sync to read every source.</p>
        ) : (
          <div className="space-y-3" aria-live="polite">
            <p className="text-xs text-muted-foreground">Last synced {instant(view.syncedAt)}</p>
            <ul className="space-y-1 rounded-xl border border-border p-3">
              {(["amora", "chain", "sera"] as const).map((s) => (
                <SourceLine key={s} name={s} state={view.sources[s].state} readAt={view.sources[s].readAt} />
              ))}
            </ul>
            {SERA_STATE_WORDS[view.sera] && <p className="text-sm text-muted-foreground">{SERA_STATE_WORDS[view.sera]}</p>}
            {differs && (
              <p role="status" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-foreground">
                Some sources disagree. The rows are marked below, and the Treasurer has been shown each one.
              </p>
            )}

            {view.tokens.length > 0 && (
              <table className="w-full table-fixed text-sm">
                <caption className="sr-only">Tokens, by source</caption>
                <thead>
                  <tr className="text-left text-xs text-muted-foreground">
                    <th scope="col" className="pb-1 font-medium">Token</th>
                    <th scope="col" className="pb-1 font-medium">{SOURCE_WORDS.amora}</th>
                    <th scope="col" className="pb-1 font-medium">{SOURCE_WORDS.chain}</th>
                  </tr>
                </thead>
                <tbody>
                  {view.tokens.map((t) => (
                    <tr key={t.slug} className={`border-t border-border ${t.disagree ? "bg-amber-50" : ""}`}>
                      <th scope="row" className="break-words py-2 pr-2 text-left font-medium text-card-foreground">
                        {t.name}
                        {t.disagree && <span className="block text-xs font-normal text-foreground">Differs</span>}
                      </th>
                      <td className="break-all py-2 pr-2 tabular-nums">{t.amora}</td>
                      <td className="break-all py-2 tabular-nums">
                        {t.chain ?? <span className="text-muted-foreground">Not on chain</span>}
                        {t.chain && t.chainStale && <span className="block text-xs text-muted-foreground">as of {instant(t.chainReadAt)}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {view.cash.length > 0 && (
              <p className="text-sm text-card-foreground">
                Cash still owed to you, from {SOURCE_WORDS.amora.toLowerCase()}: {view.cash.map((c) => formatMoney(c.owedMinor, c.currency)).join(", ")}
              </p>
            )}

            {view.invoices.length > 0 && (
              <table className="w-full table-fixed text-sm">
                <caption className="sr-only">Invoices, by source</caption>
                <thead>
                  <tr className="text-left text-xs text-muted-foreground">
                    <th scope="col" className="pb-1 font-medium">Invoice</th>
                    <th scope="col" className="pb-1 font-medium">{SOURCE_WORDS.amora}</th>
                    <th scope="col" className="pb-1 font-medium">{SOURCE_WORDS.sera}</th>
                  </tr>
                </thead>
                <tbody>
                  {view.invoices.map((i) => (
                    <tr key={i.ref} className={`border-t border-border ${i.disagree ? "bg-amber-50" : ""}`}>
                      <th scope="row" className="break-all py-2 pr-2 text-left font-medium text-card-foreground">
                        {i.ref}
                        {i.disagree && <span className="block text-xs font-normal text-foreground">Differs</span>}
                      </th>
                      <td className="py-2 pr-2">{formatMoney(i.amoraMinor, i.currency)}<span className="block text-xs text-muted-foreground">{INVOICE_STATUS_WORDS[i.status]}</span></td>
                      <td className="py-2">
                        {i.seraMinor === null ? <span className="text-muted-foreground">No record</span> : (
                          <>{formatMoney(i.seraMinor, i.seraCurrency ?? i.currency)}<span className="block text-xs text-muted-foreground">{i.seraStatus ? SERA_STATUS_WORDS[i.seraStatus] : ""}</span></>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
