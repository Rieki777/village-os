/**
 * MOON REVIEWS, the work approvers' queue on the profile's Roles tab.
 *
 * It reads `GET /api/moon-review/queue`, which asks the server's one gate
 * (`moon.approve`, or the keys `approvalDecision` reads). A member who holds
 * none of them gets a refusal and this draws nothing: nothing here decides
 * who may approve.
 *
 * Each recap shows its READING FIRST (A4: the band and its sentence), then
 * the numbers: roles with their item counts, items outside their roles, and
 * who can approve. Opening one lists its items with Approve or Return with a
 * note each, then Approve the work. The queue row carries no items or hash in
 * the contract yet (see moonApi.ts); until it does, the recap is returned
 * whole with a note and the page says where its items are read.
 */
import { useCallback, useEffect, useState } from "react";
import {
  MY_MOON_WORDS,
  QUEUE_STAGE_WORDS,
  QUEUE_WORDS,
  RECAP_STATUS_WORDS,
  SELF_APPROVED_WORDS,
  dayWords,
  type Reading,
} from "@shared/moonRecap";
import * as api from "./moonApi";
import type { QueueData, QueueRowView } from "./moonApi";
import { ERROR, H2, INPUT, KICKER, LABEL, MUTED, PANEL, SMALL_BTN, SMALL_BTN_ON } from "./moonUi";

/** A recap's reading, first: the band, its sentence, then its context lines. */
export function ReadingFirst({ reading }: { reading: Reading | null | undefined }) {
  if (!reading) return null;
  return (
    <div className="flex flex-col gap-1" data-testid="queue-reading">
      <p className="m-0 text-sm font-semibold text-foreground">{reading.label}</p>
      <p className="m-0 text-sm text-foreground">{reading.says}</p>
      {reading.lines.map((l) => <p key={l} className="m-0 text-xs text-muted-foreground">{l}</p>)}
    </div>
  );
}

/** Who sent it, where it waits, and the self-approved mark. */
export function RowHead({ row }: { row: QueueRowView }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h4 className="m-0 text-base font-semibold text-foreground">{row.name}</h4>
        <span className="text-xs text-muted-foreground">
          {row.waitingOn ? QUEUE_STAGE_WORDS[row.waitingOn] : RECAP_STATUS_WORDS[row.status]}
          {row.dueOn ? `, ${dayWords(row.dueOn)}` : ""}
        </span>
      </div>
      {row.selfApproved ? <p className="m-0 text-xs font-semibold text-destructive" data-testid="self-approved">{SELF_APPROVED_WORDS}</p> : null}
    </div>
  );
}

type ItemDecision = { review: "approved" | "returned"; note: string };

function WorkRow({ row, onDone, noEligible }: { row: QueueRowView; onDone: () => Promise<unknown>; noEligible: boolean }) {
  const [open, setOpen] = useState(false);
  const [decisions, setDecisions] = useState<Record<string, ItemDecision>>({});
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const items = (row.items ?? []).filter((i) => i.state === "kept");
  const decide = (id: string, patch: Partial<ItemDecision>) => setDecisions({ ...decisions, [id]: { review: decisions[id]?.review ?? "approved", note: decisions[id]?.note ?? "", ...patch } });

  const approve = async () => {
    if (!row.hash) return;
    setBusy(true);
    setError(null);
    const r = await api.reviewWork(row.recapId, {
      hash: row.hash,
      items: items.map((i) => ({ id: i.id, review: decisions[i.id]?.review ?? "approved", note: decisions[i.id]?.note.trim() || null })),
      note: note.trim() || null,
    });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    await onDone();
  };
  const returnIt = async () => {
    if (!note.trim()) return;
    setBusy(true);
    setError(null);
    const r = await api.returnRecap(row.recapId, { stage: "work", note: note.trim() });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    await onDone();
  };

  return (
    <li className="flex flex-col gap-3 rounded-[14px] border border-dash-edge bg-card p-3" data-testid="queue-row">
      <RowHead row={row} />
      <ReadingFirst reading={row.taskReading} />
      <ReadingFirst reading={row.seatReading} />
      <ul className="m-0 list-disc pl-5 text-sm text-foreground">
        {row.roles.map((r) => <li key={r.roleId}>{r.name}: {r.itemCount}</li>)}
      </ul>
      {row.outsideMyRoles > 0 ? <p className={MUTED}>{QUEUE_WORDS.outside(row.outsideMyRoles)}</p> : null}
      <p className="m-0 text-xs text-muted-foreground">{QUEUE_WORDS.approvers(row.workApprovers)}</p>
      {noEligible ? <p className="m-0 text-xs text-muted-foreground">{QUEUE_WORDS.noEligible}</p> : null}
      {row.waitingOn === "work" ? (
        <button type="button" className={`${SMALL_BTN} self-start`} aria-expanded={open} onClick={() => setOpen((v) => !v)}>{open ? QUEUE_WORDS.close : QUEUE_WORDS.open}</button>
      ) : null}
      {open ? (
        <div className="flex flex-col gap-3">
          {row.items ? (
            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              {items.map((i) => {
                const d = decisions[i.id];
                const returned = d?.review === "returned";
                return (
                  <li key={i.id} className="flex flex-col gap-2 rounded-lg border border-border p-2">
                    <p className="m-0 text-sm text-foreground">{i.text}</p>
                    {i.accountabilityWords ? <p className="m-0 text-xs text-muted-foreground">{i.accountabilityWords}</p> : null}
                    <div className="flex flex-wrap gap-2">
                      <button type="button" aria-pressed={!returned} className={!returned ? SMALL_BTN_ON : SMALL_BTN} onClick={() => decide(i.id, { review: "approved" })}>{QUEUE_WORDS.approve}</button>
                      <button type="button" aria-pressed={returned} className={returned ? SMALL_BTN_ON : SMALL_BTN} onClick={() => decide(i.id, { review: "returned" })}>{QUEUE_WORDS.returnIt}</button>
                    </div>
                    {returned ? <input aria-label={QUEUE_WORDS.note} placeholder={QUEUE_WORDS.note} value={d?.note ?? ""} onChange={(e) => decide(i.id, { note: e.target.value })} className={INPUT} /> : null}
                  </li>
                );
              })}
            </ul>
          ) : <p className={MUTED}>{QUEUE_WORDS.noItemsInQueue}</p>}
          <label className={LABEL}>
            {QUEUE_WORDS.note}
            <textarea value={note} rows={2} onChange={(e) => setNote(e.target.value)} className={INPUT} />
          </label>
          <div className="flex flex-wrap gap-2">
            {row.items && row.hash ? <button type="button" className={SMALL_BTN_ON} disabled={busy} onClick={approve}>{QUEUE_WORDS.approveWork}</button> : null}
            <button type="button" className={SMALL_BTN} disabled={busy || !note.trim()} onClick={returnIt}>{QUEUE_WORDS.returnIt}</button>
          </div>
          {error ? <p role="alert" className={ERROR}>{error}</p> : null}
        </div>
      ) : null}
    </li>
  );
}

export function ReviewQueueView({ data, reload }: { data: QueueData; reload: () => Promise<unknown> }) {
  const noEligible = new Set(data.noEligible.map((n) => n.recapId));
  return (
    <section aria-label={QUEUE_WORDS.heading} className={`${PANEL} flex flex-col gap-4 p-4 sm:p-6`} data-testid="moon-queue">
      <div>
        <p className={KICKER}>{data.moon.periodWords}</p>
        <h2 className={H2}>{QUEUE_WORDS.heading}</h2>
      </div>
      {data.rows.length === 0 ? <p className={MUTED}>{QUEUE_WORDS.empty}</p> : (
        <ul className="m-0 flex list-none flex-col gap-3 p-0">
          {data.rows.map((r) => <WorkRow key={r.recapId} row={r} onDone={reload} noEligible={noEligible.has(r.recapId)} />)}
        </ul>
      )}
      {data.rolesWithNoItems.length > 0 ? (
        <div className="flex flex-col gap-2">
          <h3 className="m-0 text-base font-semibold text-foreground">{QUEUE_WORDS.rolesWithNoItems}</h3>
          <ul className="m-0 list-disc pl-5 text-sm text-foreground">
            {data.rolesWithNoItems.map((r) => <li key={`${r.userId}:${r.roleId}`}>{r.name}</li>)}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

/** The loader. A refusal or an off module draws nothing. */
export default function ReviewQueue() {
  const [data, setData] = useState<QueueData | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const load = useCallback(async () => {
    const r = await api.fetchQueue(null);
    if (r.ok) {
      setData(r.data);
      setFailed(null);
    } else if (r.status >= 500 || r.status === 0) setFailed(r.error);
    else setData(null);
  }, []);
  useEffect(() => { void load(); }, [load]);
  if (failed) return <p className={ERROR}>{failed || MY_MOON_WORDS.failed}</p>;
  if (!data) return null;
  return <ReviewQueueView data={data} reload={load} />;
}
