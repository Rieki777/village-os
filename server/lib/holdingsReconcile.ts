/**
 * THE TREASURY SYNC: one reconciled view of a member's tokens and cash, from
 * every source, each number with where it came from (invoice rails, S3, S5).
 *
 * Rye, 2026-11-06: a Sync on the member's treasury card pulls accurate token
 * and cash numbers from Sera/Saberra, the Base chain and the village's own
 * records, shows each number's source and when it was last synced, and flags
 * any disagreement to the Treasurer rather than hiding it.
 *
 * READ-ONLY. Syncing never moves money or tokens. This file imports no write
 * path of the ledger, the token balances or cash owed, and every number it is
 * handed comes through a reader; server/lib/holdingsReconcile.test.ts records every
 * statement a sync sends and fails on any write to those tables. What it
 * writes is its own: the member's last view, the disagreements, and Sera's
 * typed records.
 *
 * A SOURCE THAT COULD NOT BE READ IS "NOT READ", never zero, and it resolves
 * no flag: a difference is only marked resolved by a sync that read both
 * sides and no longer sees it.
 *
 * The figure that counts stays the village's (constitution II.2): the village's
 * Finance approval writes cash owed and the Treasurer marks it paid. Sera's
 * and the chain's figures are shown beside it and flagged when they differ.
 */
import type { Pool } from "mysql2/promise";
import { reconcile, trackOf, withActorLabels, type FlagKind, type ReconciledView, type TrackStep } from "../../shared/invoiceTrack";
import { billRef, type InvoiceStatus } from "../../shared/moonRecap";
import { invoicesByIds } from "../repos/moonRecaps";
import { invoiceIdsWithSeraReportsOf, liveInvoiceIdsOf, mailForInvoices, paidByOf, paidReferenceOf, saveSyncView, seraReportsForInvoices, syncViewOf, writeFlags } from "../repos/invoiceRails";
import { linesOf } from "./moonRecap";
import { readSeraInvoices, type SeraInvoiceClient, type SeraReadOutcome } from "./seraInvoices";

export type SyncTrigger = "manual" | "daily" | "notice";

export interface InvoiceTrackRow {
  invoiceId: string;
  ref: string;
  cycleId: string;
  status: InvoiceStatus;
  currency: string;
  totalMinor: number;
  track: TrackStep[];
}

export interface TreasuryView extends ReconciledView {
  syncedAt: string;
  trigger: SyncTrigger;
  tracks: InvoiceTrackRow[];
  /** Why Sera reads as it does, in a word the client turns into a sentence. */
  sera: SeraReadOutcome["state"];
}

export interface TreasuryDeps {
  getPool(): Pool;
  /** The member's ledger balances, as exact decimal strings, with each token's name. */
  ledgerTokens(userId: string): Promise<Array<{ slug: string; name: string; amount: string }>>;
  /** The cash still owed to the member, by currency. */
  cashOwed(userId: string): Promise<Array<{ currency: string; owedMinor: number }>>;
  /**
   * The member's on-chain balances for the tokens the village has a contract
   * for, read through `readOnchainBalance` (last known, marked stale, on an
   * RPC failure). `offered` is false with no verified wallet or no contract.
   */
  chain(userId: string): Promise<{ offered: boolean; tokens: Array<{ slug: string; formatted: string | null; readAt: string; stale: boolean }> }>;
  seraClient(): Promise<SeraInvoiceClient | null>;
  resolveCodeName(code: string): Promise<string | null>;
  now(): Date;
  newId(): string;
}

/**
 * The track of every live invoice of one member, newest first.
 *
 * `labelOf` names who acted as "Role (FirstName)" (Rye, 2026-10-30). Only a
 * door answering a signed-in reader passes it, at read time; the sync view
 * this file saves is built without it, so no stored copy carries a name.
 */
export async function invoiceTracksFor(pool: Pool, userId: string, labelOf?: (actorUserId: string) => Promise<string | null>): Promise<InvoiceTrackRow[]> {
  const invoices = await invoicesByIds(pool, await liveInvoiceIdsOf(pool, userId));
  const ids = invoices.map((i) => i.id);
  const [mail, reports] = await Promise.all([mailForInvoices(pool, ids), seraReportsForInvoices(pool, ids)]);
  const rows: InvoiceTrackRow[] = [];
  for (const i of invoices) {
    const ref = billRef(i.payerKey, i.billRefSeq);
    const sent = mail.filter((m) => m.invoiceId === i.id);
    const lastSent = [...sent].reverse().find((m) => m.status === "sent") ?? sent[sent.length - 1] ?? null;
    // `seraReportsForInvoices` answers newest first: the track reads Sera's latest word.
    const report = reports.find((r) => r.matchedInvoiceId === i.id) ?? null;
    const cashIds = linesOf(i).map((l) => l.cashOwedId).filter((x): x is string => !!x);
    const paidReference = i.status === "paid" ? await paidReferenceOf(pool, cashIds) : null;
    const track = trackOf({ invoice: { ref, status: i.status, sentAt: i.sentAt, approvedAt: i.approvedAt, paidOn: i.paidOn }, mail: lastSent ? { queuedAt: lastSent.queuedAt, sentAt: lastSent.sentAt } : null, report, paidReference });
    const paidBy = labelOf && i.status === "paid" ? await paidByOf(pool, cashIds) : null;
    rows.push({
      invoiceId: i.id, ref, cycleId: i.cycleId, status: i.status, currency: i.currency, totalMinor: i.totalMinor,
      track: labelOf
        ? withActorLabels(track, {
            approved: i.approvedBy ? await labelOf(i.approvedBy).catch(() => null) : null,
            paid: paidBy ? await labelOf(paidBy).catch(() => null) : null,
          })
        : track,
    });
  }
  return rows;
}

const SERA_KINDS: FlagKind[] = ["sera_amount_differs", "sera_status_differs", "sera_duplicate"];

/**
 * One sync for one member. `seraRead` lets the daily job read Sera once for
 * the whole village and hand the outcome to every member's sync.
 */
export async function syncTreasury(deps: TreasuryDeps, userId: string, trigger: SyncTrigger, seraRead?: SeraReadOutcome): Promise<TreasuryView> {
  const pool = deps.getPool();
  const at = deps.now().toISOString();
  const previous = (await syncViewOf(pool, userId))?.view as TreasuryView | undefined;

  const sera = seraRead ?? (await readSeraInvoices(pool, await deps.seraClient().catch(() => null), deps).catch((): SeraReadOutcome => ({ state: "failed", why: "threw" })));
  const [ledger, chain, tracks] = await Promise.all([
    Promise.all([deps.ledgerTokens(userId), deps.cashOwed(userId)]).then(([tokens, cash]) => ({ ok: true, tokens, cash })).catch(() => ({ ok: false, tokens: [], cash: [] })),
    deps.chain(userId).then((c) => ({ ok: true, ...c })).catch(() => ({ ok: false, offered: true, tokens: [] })),
    invoiceTracksFor(pool, userId),
  ]);
  // Compared: every live invoice, plus any other invoice of this member that
  // a Sera record is attached to (a void one included), so Sera approving or
  // paying an invoice the village voided is shown, never dropped.
  const extraIds = (await invoiceIdsWithSeraReportsOf(pool, userId)).filter((id) => !tracks.some((t) => t.invoiceId === id));
  const extra = (await invoicesByIds(pool, extraIds)).map((i) => ({ invoiceId: i.id, ref: billRef(i.payerKey, i.billRefSeq), status: i.status, currency: i.currency, totalMinor: i.totalMinor }));
  const comparedInvoices = [...tracks, ...extra];
  const reports = await seraReportsForInvoices(pool, comparedInvoices.map((t) => t.invoiceId));
  const seraOk = sera.state === "read";
  const seraOffered = sera.state !== "not_offered" && sera.state !== "not_connected";

  const view = reconcile({
    readAt: at,
    ledger: { ok: ledger.ok, readAt: ledger.ok ? at : (previous?.sources.village.readAt ?? null), tokens: ledger.tokens, cash: ledger.cash },
    chain: { ok: chain.ok, offered: chain.offered, readAt: chain.ok ? at : (previous?.sources.chain.readAt ?? null), tokens: chain.tokens },
    sera: { ok: seraOk, offered: seraOffered, readAt: seraOk ? at : (previous?.sources.sera.readAt ?? null) },
    invoices: comparedInvoices.map((t) => {
      const mine = reports.filter((x) => x.matchedInvoiceId === t.invoiceId);
      const r = mine[0];
      return { ref: t.ref, status: t.status, currency: t.currency, totalMinor: t.totalMinor, seraCount: mine.length, sera: r ? { status: r.status, currency: r.currency, amountMinor: r.amountMinor, statusAt: r.statusAt } : null };
    }),
  });

  // A flag is closed only for a subject compared on a fresh read of both
  // sides (`view.compared`): a token the chain could not read, a stale value,
  // or an invoice Sera was not read for keeps its flag open.
  const compared = [
    { kind: "chain_differs", subjects: view.compared.chain },
    ...SERA_KINDS.map((kind) => ({ kind, subjects: view.compared.sera })),
  ];
  await writeFlags(pool, userId, compared, view.flags, at, deps.newId);

  const out: TreasuryView = { ...view, syncedAt: at, trigger, tracks, sera: sera.state };
  await saveSyncView(pool, userId, out, at, trigger);
  return out;
}
