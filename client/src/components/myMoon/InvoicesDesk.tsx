/**
 * INVOICES, the Finance view inside the admin Cash payouts desk (decision 16:
 * approve one at a time or in bulk). It loads as its own chunk; CashPayoutsTab
 * only mounts it.
 *
 * It reads the same queue door as the work approvers, which hands a `cash.pay`
 * holder each recap's invoice. The rows waiting on the invoice stage carry a
 * checkbox; Approve selected sends `POST /api/moon-review/invoices/approve`
 * with the expected payment date, and each invoice runs every check on its
 * own: one that fails stays out with its sentence, the rest pass. Return
 * with a note sends one back to the member.
 *
 * Each row reads FIRST (the A4 reading), then the numbers: the lines, the
 * total, Bill to, the route check, the tax form, the payer authority note and
 * the queue note. A self-approval carries its mark. Nothing here decides
 * permission: a refusal from the server draws its sentence.
 */
import { useCallback, useEffect, useState } from "react";
import { FLAG_WORDS, SERA_STATUS_WORDS, type FlagKind, type SeraInvoiceStatus } from "@shared/invoiceTrack";
import { InvoiceTrack, type TrackRow } from "../TreasurySync";
import {
  LINE_BASIS_WORDS,
  MOON_WORDS,
  MY_MOON_WORDS,
  QUEUE_WORDS,
  SELF_APPROVED_WORDS,
  type BulkApproveResponse,
} from "@shared/moonRecap";
import * as api from "./moonApi";
import type { QueueData, QueueRowView } from "./moonApi";
import { ReadingFirst, RowHead } from "./ReviewQueue";
import { Amount, ERROR, INPUT, LABEL, MUTED, SMALL_BTN, SMALL_BTN_ON } from "./moonUi";

const todayIso = () => new Date().toISOString().slice(0, 10);

function InvoiceRow({ row, picked, onPick, init, onDone }: {
  row: QueueRowView;
  picked: boolean;
  onPick: (on: boolean) => void;
  init: RequestInit;
  onDone: () => Promise<unknown>;
}) {
  const inv = row.invoice;
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  if (!inv) return null;
  const waiting = row.waitingOn === "invoice";

  const returnIt = async () => {
    if (!note.trim()) return;
    setError(null);
    const r = await api.returnRecap(row.recapId, { stage: "invoice", note: note.trim() }, init);
    if (!r.ok) return setError(r.error);
    await onDone();
  };

  return (
    <li className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4" data-testid="invoice-row">
      <div className="flex items-start gap-3">
        {waiting ? (
          <input type="checkbox" className="mt-1" aria-label={`${QUEUE_WORDS.approve} ${row.name}`} checked={picked} disabled={!inv.hash} onChange={(e) => onPick(e.target.checked)} />
        ) : null}
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <RowHead row={row} />
          {inv.selfApproved && !row.selfApproved ? <p className="m-0 text-xs font-semibold text-destructive">{SELF_APPROVED_WORDS}</p> : null}
          <ReadingFirst reading={row.taskReading} />
          <p className="m-0 text-sm text-foreground">{inv.statusLine}</p>
          <p className="m-0 flex justify-between text-sm font-semibold text-foreground">
            <span>{MOON_WORDS.total}</span>
            <span><Amount minor={inv.totalMinor} currency={inv.currency} /></span>
          </p>
        </div>
      </div>
      <button type="button" className={`${SMALL_BTN} self-start`} aria-expanded={open} onClick={() => setOpen((v) => !v)}>{open ? QUEUE_WORDS.close : QUEUE_WORDS.open}</button>
      {open ? (
        <div className="flex flex-col gap-2 text-sm text-foreground">
          <ul className="m-0 flex list-none flex-col gap-1 p-0">
            {inv.lines.map((l) => (
              <li key={l.key} className="flex flex-wrap justify-between gap-2 border-b border-border py-1">
                <span>{l.roleNames.join(", ")} <span className="text-xs text-muted-foreground">{LINE_BASIS_WORDS[l.basis]}. {l.basisLine}</span></span>
                <Amount minor={l.amountMinor} currency={l.currency} />
              </li>
            ))}
          </ul>
          {inv.billTo ? <p className="m-0"><span className="font-medium">{MOON_WORDS.billTo}:</span> {inv.billTo.legalName}</p> : null}
          {inv.memberNumber ? <p className="m-0"><span className="font-medium">{MOON_WORDS.memberNumber}:</span> {inv.memberNumber}</p> : null}
          {inv.externalInvoiceKey ? <p className="m-0"><span className="font-medium">{MOON_WORDS.externalKey}:</span> {inv.externalInvoiceKey}</p> : null}
          {inv.routeCheck ? <p className="m-0"><span className="font-medium">{QUEUE_WORDS.routeCheck}:</span> {inv.routeCheck}</p> : null}
          <p className="m-0">{inv.taxFormValid ? QUEUE_WORDS.taxFormValid : QUEUE_WORDS.taxFormMissing}</p>
          {inv.authorityNote ? <p className="m-0"><span className="font-medium">{QUEUE_WORDS.authority}:</span> {inv.authorityNote}</p> : null}
          {inv.queueNote ? <p className="m-0 text-muted-foreground">{inv.queueNote}</p> : null}
          {inv.workSummary ? <pre className="m-0 whitespace-pre-wrap rounded-lg bg-muted p-2 text-xs text-foreground">{inv.workSummary}</pre> : null}
          <p className="m-0 text-xs text-muted-foreground">{QUEUE_WORDS.approvers(row.invoiceApprovers)}</p>
          {waiting ? (
            <>
              <label className={LABEL}>
                {QUEUE_WORDS.note}
                <textarea value={note} rows={2} onChange={(e) => setNote(e.target.value)} className={INPUT} />
              </label>
              <button type="button" className={`${SMALL_BTN} self-start`} disabled={!note.trim()} onClick={returnIt}>{QUEUE_WORDS.returnIt}</button>
            </>
          ) : null}
          {error ? <p role="alert" className={ERROR}>{error}</p> : null}
        </div>
      ) : null}
    </li>
  );
}

export function InvoicesDeskView({ data, init, reload }: { data: QueueData; init: RequestInit; reload: () => Promise<unknown> }) {
  const rows = data.rows.filter((r) => r.invoice);
  const ready = rows.filter((r) => r.waitingOn === "invoice" && r.invoice?.hash);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [expectedOn, setExpectedOn] = useState(todayIso());
  const [result, setResult] = useState<BulkApproveResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const pick = (id: string, on: boolean) => {
    const next = new Set(picked);
    if (on) next.add(id);
    else next.delete(id);
    setPicked(next);
  };
  const approve = async () => {
    setBusy(true);
    setError(null);
    setResult(null);
    const invoices = ready.filter((r) => picked.has(r.recapId)).map((r) => ({ id: r.invoice!.id as string, hash: r.invoice!.hash as string, expectedOn }));
    const r = await api.approveInvoices({ invoices }, init);
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setResult(r.data);
    setPicked(new Set());
    await reload();
  };
  const nameOf = (invoiceId: string) => rows.find((r) => r.invoice?.id === invoiceId)?.name ?? invoiceId;

  return (
    <div className="flex flex-col gap-4" data-testid="invoices-desk">
      {rows.length === 0 ? <p className={MUTED}>{QUEUE_WORDS.empty}</p> : null}
      {ready.length > 0 ? (
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex items-center gap-2 text-sm text-foreground">
            <input type="checkbox" checked={picked.size === ready.length} onChange={(e) => setPicked(e.target.checked ? new Set(ready.map((r) => r.recapId)) : new Set())} />
            {QUEUE_WORDS.selectAll}
          </label>
          <label className={LABEL}>
            {QUEUE_WORDS.expectedOn}
            <input type="date" value={expectedOn} min={todayIso()} onChange={(e) => setExpectedOn(e.target.value)} className={INPUT} />
          </label>
          <button type="button" className={SMALL_BTN_ON} disabled={busy || picked.size === 0 || !expectedOn} onClick={approve}>{QUEUE_WORDS.approveSelected}</button>
        </div>
      ) : null}
      {result ? (
        <div className="flex flex-col gap-1 text-sm text-foreground" aria-live="polite">
          <p className="m-0 font-medium">{QUEUE_WORDS.result(result.approved.length, result.refused.length, result.held.length)}</p>
          {[...result.refused, ...result.held].map((x) => <p key={x.id} className="m-0 text-muted-foreground">{nameOf(x.id)}: {x.reason}</p>)}
        </div>
      ) : null}
      {error ? <p role="alert" className={ERROR}>{error}</p> : null}
      <ul className="m-0 flex list-none flex-col gap-3 p-0">
        {rows.map((r) => <InvoiceRow key={r.recapId} row={r} picked={picked.has(r.recapId)} onPick={(on) => pick(r.recapId, on)} init={init} onDone={reload} />)}
      </ul>
    </div>
  );
}

/** What `GET /api/cash-owed/invoice-track` answers (invoice rails). */
export interface RailsData {
  tracks: Array<TrackRow & { userId: string; memberName: string | null }>;
  flags: Array<{ id: string; userId: string | null; memberName: string | null; kind: FlagKind; subject: string; village: string; other: string; firstSeenAt: string }>;
  unmatched: Array<{ seraId: string; reference: string | null; currency: string; amountMinor: number; status: SeraInvoiceStatus; receivedAt: string }>;
}

/**
 * Every live invoice from sent to paid, and every disagreement a sync found,
 * for the Treasurer. A difference is shown as both figures, never resolved
 * here: the village's own approval and the bank transfer stay the record.
 */
export function RailsPanel({ data, nameOf }: { data: RailsData; nameOf: (userId: string | null) => string }) {
  return (
    <div className="flex flex-col gap-4" data-testid="invoice-rails">
      {data.flags.length > 0 ? (
        <section aria-labelledby="rails-flags" className="flex flex-col gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3">
          <h4 id="rails-flags" className="m-0 text-sm font-semibold text-foreground">Sources that disagree ({data.flags.length})</h4>
          <ul className="m-0 flex list-none flex-col gap-1 p-0 text-sm text-foreground">
            {data.flags.map((f) => (
              <li key={f.id} className="break-words">
                {FLAG_WORDS[f.kind]}: {f.subject}{f.userId ? `, ${f.memberName ?? nameOf(f.userId)}` : ""}. Here: {f.village}. There: {f.other}.
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {data.unmatched.length > 0 ? (
        <section aria-labelledby="rails-unmatched" className="flex flex-col gap-1 text-sm text-foreground">
          <h4 id="rails-unmatched" className="m-0 text-sm font-semibold">Sera records that name no invoice here</h4>
          <ul className="m-0 flex list-none flex-col gap-1 p-0">
            {data.unmatched.map((u) => (
              <li key={u.seraId} className="break-words text-muted-foreground">
                {u.reference ?? "No reference"}: <Amount minor={u.amountMinor} currency={u.currency} />, {SERA_STATUS_WORDS[u.status]}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <section aria-labelledby="rails-tracks" className="flex flex-col gap-2">
        <h4 id="rails-tracks" className="m-0 text-sm font-semibold text-foreground">Every invoice, sent to paid</h4>
        {data.tracks.length === 0 ? <p className={MUTED}>No invoice has been sent yet.</p> : null}
        <ul className="m-0 flex list-none flex-col gap-3 p-0">
          {data.tracks.map((t) => (
            <li key={t.invoiceId} className="rounded-lg border border-border p-3">
              <p className="m-0 flex flex-wrap justify-between gap-2 text-sm font-medium text-foreground">
                <span className="break-all">{t.memberName ?? nameOf(t.userId)}, {t.ref}</span>
                <Amount minor={t.totalMinor} currency={t.currency} />
              </p>
              <InvoiceTrack row={t} />
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

/** The loader, with the admin desk's session header. Draws the refusal's sentence, never a code. */
function InvoicesDeskLoader({ password }: { password: string }) {
  const [data, setData] = useState<QueueData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const init: RequestInit = { headers: { Authorization: `Bearer ${password}` } };
  const load = useCallback(async () => {
    const r = await api.fetchQueue(null, { headers: { Authorization: `Bearer ${password}` } });
    if (r.ok) {
      setData(r.data);
      setError(null);
    } else {
      setData(null);
      setError(r.status === 404 ? MY_MOON_WORDS.notOn : r.error);
    }
  }, [password]);
  useEffect(() => { void load(); }, [load]);
  const [rails, setRails] = useState<RailsData | null>(null);
  useEffect(() => {
    fetch("/api/cash-owed/invoice-track", { headers: { Authorization: `Bearer ${password}` } })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setRails(d && Array.isArray(d.tracks) ? (d as RailsData) : null))
      .catch(() => setRails(null));
  }, [password, data]);
  if (error) return <p role="alert" className={ERROR}>{error}</p>;
  if (!data) return <p className={MUTED}>{QUEUE_WORDS.loading}</p>;
  const nameOf = (userId: string | null) => data.rows.find((r) => r.userId === userId)?.name ?? "a member";
  return (
    <>
      <InvoicesDeskView data={data} init={init} reload={load} />
      {rails ? <RailsPanel data={rails} nameOf={nameOf} /> : null}
    </>
  );
}

/** The Invoices view on the desk: closed until opened, so the desk reads no queue it was not asked for. */
export default function InvoicesDesk({ password }: { password: string }) {
  const [open, setOpen] = useState(false);
  return (
    <section aria-label={QUEUE_WORDS.invoicesView} className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="m-0 text-lg font-semibold text-foreground">{QUEUE_WORDS.invoicesView}</h3>
        <button type="button" className={SMALL_BTN} aria-expanded={open} onClick={() => setOpen((v) => !v)}>{open ? QUEUE_WORDS.close : QUEUE_WORDS.open}</button>
      </div>
      {open ? <InvoicesDeskLoader password={password} /> : null}
    </section>
  );
}
