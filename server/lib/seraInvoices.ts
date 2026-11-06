/**
 * SERA'S OWN RECORD OF THE INVOICES IT RECEIVED, read back (invoice rails, S2).
 *
 * Measured 2026-11-06: Saberra's MCP offers `list_records` and `get_record`
 * for circles, roles and role assignments, and nothing for invoices. The read
 * here is written against the contract the village asked for
 * (`list_invoices`, internal note SERA_INVOICE_CONTRACT), and until the
 * service lists that tool it answers `not_offered`: a named state the card
 * shows as "Sera does not report invoices yet", never an error and never a
 * zero.
 *
 *   - READ ONLY. One tool, read-only by the contract. Nothing is sent to Sera.
 *   - TYPED FIELDS ONLY (constitution VI.5): each record goes through
 *     `readSeraInvoice`, which drops every field the contract does not name.
 *     A record that does not keep the contract is counted and skipped.
 *   - ATTACHED TO ONE INVOICE OR NONE (`matchSeraReport`). By reference; else by
 *     the member's code-name, resolved inside the village only, plus the moon,
 *     currency and exact amount. A record matched once keeps its match.
 *   - THE CREDENTIAL never leaves `preflight()`: this file is handed a client
 *     and logs only the failure's name, never its detail, which can echo the
 *     address it called.
 */
import type { Pool } from "mysql2/promise";
import { matchSeraReport, readSeraInvoice, type MatchCandidate, type SeraInvoice, type SyncFlag } from "../../shared/invoiceTrack";
import { billRef } from "../../shared/moonRecap";
import { invoicesByIds } from "../repos/moonRecaps";
import { invoiceIdByRef, liveInvoiceIdsOf, resolveFlag, seraReportsSince, storedFlagKey, unmatchedSeraReports, upsertSeraReport, writeFlags } from "../repos/invoiceRails";

export const SERA_INVOICE_TOOL = "list_invoices";
const MAX_RECORDS = 500;

/** The two calls this needs, bound by the caller to a live MCP session. */
export interface SeraInvoiceClient {
  toolNames(): Promise<{ ok: true; names: string[] } | { ok: false; why: string }>;
  list(args: Record<string, unknown>): Promise<{ ok: true; value: unknown } | { ok: false; why: string }>;
}

export type SeraReadOutcome =
  | { state: "not_connected" }
  | { state: "not_offered" }
  | { state: "failed"; why: string }
  | { state: "read"; read: number; skipped: number; matched: number; unmatched: number; ambiguous: number };

const recordsOf = (v: unknown): unknown[] | null => {
  if (Array.isArray(v)) return v;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    for (const k of ["invoices", "records", "results"]) if (Array.isArray(o[k])) return o[k] as unknown[];
  }
  return null;
};

async function candidatesFor(pool: Pool, r: SeraInvoice, resolve: (code: string) => Promise<string | null>): Promise<MatchCandidate[]> {
  let ids: string[] = [];
  let code: string | null = null;
  if (r.reference) {
    const id = await invoiceIdByRef(pool, r.reference);
    ids = id ? [id] : [];
  } else if (r.member) {
    const userId = await resolve(r.member);
    if (userId) {
      ids = await liveInvoiceIdsOf(pool, userId);
      code = r.member;
    }
  }
  const rows = await invoicesByIds(pool, ids);
  return rows
    .filter((i) => i.status !== "void")
    .map((i) => ({ invoiceId: i.id, ref: billRef(i.payerKey, i.billRefSeq), userId: i.userId, codeName: code, moon: i.cycleId, currency: i.currency, totalMinor: i.totalMinor }));
}

/**
 * Read every Sera invoice record changed since the last one seen, store each
 * typed, match it, and write a village-level flag for each record that names
 * no invoice or names more than one.
 */
export async function readSeraInvoices(
  pool: Pool,
  client: SeraInvoiceClient | null,
  deps: { resolveCodeName(code: string): Promise<string | null>; now(): Date; newId(): string },
): Promise<SeraReadOutcome> {
  if (!client) return { state: "not_connected" };
  const tools = await client.toolNames();
  if (!tools.ok) return { state: "failed", why: tools.why };
  if (!tools.names.includes(SERA_INVOICE_TOOL)) return { state: "not_offered" };
  const since = await seraReportsSince(pool);
  const answer = await client.list(since ? { since } : {});
  if (!answer.ok) return { state: "failed", why: answer.why };
  const raw = recordsOf(answer.value);
  if (!raw) return { state: "failed", why: "unreadable" };

  const at = deps.now().toISOString();
  const out = { read: 0, skipped: 0, matched: 0, unmatched: 0, ambiguous: 0 };
  const flags: SyncFlag[] = [];
  for (const item of raw.slice(0, MAX_RECORDS)) {
    const r = readSeraInvoice(item);
    if (!r) {
      out.skipped++;
      continue;
    }
    out.read++;
    const m = matchSeraReport(r, await candidatesFor(pool, r, deps.resolveCodeName));
    if (m.kind === "matched") {
      out.matched++;
      await upsertSeraReport(pool, r, { state: "matched", invoiceId: m.invoiceId, by: m.by }, at);
    } else {
      m.kind === "ambiguous" ? out.ambiguous++ : out.unmatched++;
      await upsertSeraReport(pool, r, { state: m.kind, invoiceId: null, by: null }, at);
      const amora = m.kind === "ambiguous" ? `${m.invoiceIds.length} invoices fit` : "no invoice fits";
      const other = `${r.amountMinor} ${r.currency}${r.reference ? ` ref ${r.reference}` : ""}`;
      flags.push({ kind: "sera_unmatched", subject: r.id, amora, other, dedupeKey: `sera_unmatched:${r.id}` });
    }
  }
  // Village-level flags (no member): an unmatched record stays flagged until it matches.
  if (flags.length) await writeFlags(pool, null, [], flags, at, deps.newId);

  // A record that named nothing may name an invoice sent since (a member who
  // emailed the inbox before sending in the app). Each is tried again; one that
  // now matches exactly one invoice is attached and its flag resolved.
  for (const r of await unmatchedSeraReports(pool)) {
    const m = matchSeraReport(r, await candidatesFor(pool, r, deps.resolveCodeName));
    if (m.kind !== "matched") continue;
    await upsertSeraReport(pool, r, { state: "matched", invoiceId: m.invoiceId, by: m.by }, at);
    await resolveFlag(pool, storedFlagKey(null, { dedupeKey: `sera_unmatched:${r.id}` }), at);
    out.matched++;
  }
  return { state: "read", ...out };
}
