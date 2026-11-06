/**
 * THE INVOICE TRACK AND THE TREASURY SYNC, the pure half (invoice rails).
 *
 * Rye, 2026-11-06: an invoice is tracked from sending to payment, on the
 * member's card and the Treasurer's queue, and a Sync on the treasury card
 * pulls token and cash numbers from Sera/Saberra, the Base chain and the
 * village's own records, showing each number's source and flagging every
 * disagreement to the Treasurer. Syncing never moves money or tokens.
 *
 * Every money rule of the lane lives here, with no pool, clock or network, so
 * one file answers "can this count twice" and "can this hide a difference":
 *
 *   - The REFERENCE is the invoice's bill ref (`billRef`, shared/moonRecap.ts),
 *     which a payer already checks approval against. It rides the email
 *     subject in one fixed form that `refInSubject` reads back exactly.
 *   - The TRACK is derived, never copied. Sent, approved and paid are read off
 *     the invoice row the village already keeps; received is read only off
 *     Sera's own report. Nothing here can mark a step done twice, because a
 *     step is a function of the row, not a counter.
 *   - Approved and paid are the village's own (constitution II.2: the cash.pay
 *     holder approves and marks paid). Sera's status is shown beside them and
 *     flagged when it differs; it never moves a step.
 *   - A MATCH attaches a Sera record to exactly one invoice or to none.
 *   - RECONCILE compares exact decimals as strings and integers; a source that
 *     could not be read is "not read", never zero.
 */
import type { InvoiceStatus } from "./moonRecap";

// ── The reference in the email ───────────────────────────────────────────────

const SUBJECT_TAG = /\[Invoice ([A-Za-z0-9][A-Za-z0-9._-]{0,79})\]/;

/** The subject of the email that carries an invoice to the village's Sera inbox. */
export function invoiceSubject(ref: string, updated: boolean): string {
  return `[Invoice ${ref}]${updated ? " updated" : ""} for approval`;
}

/** The reference a subject carries, or null. The inverse of `invoiceSubject`. */
export function refInSubject(subject: string): string | null {
  const m = SUBJECT_TAG.exec(subject);
  return m ? m[1] : null;
}

// ── The track ────────────────────────────────────────────────────────────────

export const TRACK_STEPS = ["sent", "received", "approved", "paid"] as const;
export type TrackStepName = (typeof TRACK_STEPS)[number];
/** Who acted, as a role word the client renders; never a person's name. */
export type TrackActor = "member" | "sera" | "finance" | "treasurer";

export interface TrackStep {
  step: TrackStepName;
  done: boolean;
  /** An instant (sent, received, approved) or a civil day (paid, the transfer's day). */
  at: string | null;
  by: TrackActor | null;
  /** The bank transfer's reference on the paid step. */
  note: string | null;
  /** On the sent step: when the email to the Sera inbox went out, if it did. */
  emailedAt?: string | null;
}

export interface TrackInput {
  invoice: { ref: string; status: InvoiceStatus; sentAt: string | null; approvedAt: string | null; paidOn: string | null };
  mail: { queuedAt: string; sentAt: string | null } | null;
  report: Pick<SeraInvoice, "receivedAt"> | null;
  paidReference?: string | null;
}

export function trackOf(input: TrackInput): TrackStep[] {
  const { invoice, mail, report } = input;
  const approved = (invoice.status === "approved" || invoice.status === "paid") && !!invoice.approvedAt;
  const paid = invoice.status === "paid" && !!invoice.paidOn;
  return [
    { step: "sent", done: !!invoice.sentAt, at: invoice.sentAt, by: invoice.sentAt ? "member" : null, note: null, emailedAt: mail?.sentAt ?? null },
    { step: "received", done: !!report, at: report?.receivedAt ?? null, by: report ? "sera" : null, note: null },
    { step: "approved", done: approved, at: approved ? invoice.approvedAt : null, by: approved ? "finance" : null, note: null },
    { step: "paid", done: paid, at: paid ? invoice.paidOn : null, by: paid ? "treasurer" : null, note: paid ? (input.paidReference ?? null) : null },
  ];
}

// ── Sera's invoice record (internal/SERA_INVOICE_CONTRACT.md) ────────────────

export const SERA_INVOICE_STATUSES = ["received", "approved", "rejected", "paid"] as const;
export type SeraInvoiceStatus = (typeof SERA_INVOICE_STATUSES)[number];

export interface SeraInvoice {
  id: string;
  reference: string | null;
  /** The member's bridge code-name, never a name or an address. */
  member: string | null;
  moon: string | null;
  currency: string;
  amountMinor: number;
  status: SeraInvoiceStatus;
  receivedAt: string;
  statusAt: string;
  changedAt: string;
}

const isInstant = (v: unknown): v is string => typeof v === "string" && v.length <= 40 && !Number.isNaN(Date.parse(v));
const shortText = (v: unknown, max: number): string | null => (typeof v === "string" && v.trim() && v.length <= max ? v.trim() : null);
const CODE_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const REF = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;

/**
 * One Sera record read into its typed fields, or null when it does not keep
 * the contract. Every field the contract does not name is dropped (VI.5:
 * typed fields only, never prose), and a `member` that is not code-name shaped
 * is dropped rather than stored.
 */
export function readSeraInvoice(raw: unknown): SeraInvoice | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = shortText(r.id, 120);
  const currency = typeof r.currency === "string" && /^[A-Z]{3}$/.test(r.currency) ? r.currency : null;
  const amount = r.amountMinor;
  const status = (SERA_INVOICE_STATUSES as readonly string[]).includes(String(r.status)) ? (r.status as SeraInvoiceStatus) : null;
  if (!id || !currency || !Number.isSafeInteger(amount) || (amount as number) < 0 || !status) return null;
  if (!isInstant(r.receivedAt)) return null;
  const statusAt = isInstant(r.statusAt) ? r.statusAt : r.receivedAt;
  const changedAt = isInstant(r.changedAt) ? r.changedAt : statusAt;
  const reference = typeof r.reference === "string" && REF.test(r.reference) ? r.reference : null;
  const member = typeof r.member === "string" && CODE_NAME.test(r.member) ? r.member : null;
  const moon = shortText(r.moon, 40);
  return { id, reference, member, moon, currency, amountMinor: amount as number, status, receivedAt: r.receivedAt, statusAt, changedAt };
}

// ── Matching ─────────────────────────────────────────────────────────────────

export interface MatchCandidate {
  invoiceId: string;
  ref: string;
  userId: string;
  codeName: string | null;
  moon: string;
  currency: string;
  totalMinor: number;
}

export type MatchResult =
  | { kind: "matched"; invoiceId: string; by: "reference" | "details" }
  | { kind: "ambiguous"; invoiceIds: string[] }
  | { kind: "unmatched" };

/**
 * A Sera record to exactly one invoice, or to none. By reference first; a
 * reference that names no invoice stays unmatched (a typo is the Treasurer's
 * to read, never a reason to guess by amount). With no reference, every one
 * of code-name, moon, currency and exact amount must agree, and a second
 * candidate makes it ambiguous, which attaches nothing.
 */
export function matchSeraReport(report: SeraInvoice, candidates: readonly MatchCandidate[]): MatchResult {
  if (report.reference) {
    const hit = candidates.find((c) => c.ref === report.reference);
    return hit ? { kind: "matched", invoiceId: hit.invoiceId, by: "reference" } : { kind: "unmatched" };
  }
  if (!report.member || !report.moon) return { kind: "unmatched" };
  const hits = candidates.filter(
    (c) => c.codeName === report.member && c.moon === report.moon && c.currency === report.currency && c.totalMinor === report.amountMinor,
  );
  if (hits.length === 1) return { kind: "matched", invoiceId: hits[0].invoiceId, by: "details" };
  if (hits.length > 1) return { kind: "ambiguous", invoiceIds: hits.map((h) => h.invoiceId).sort() };
  return { kind: "unmatched" };
}

// ── Exact decimals ───────────────────────────────────────────────────────────

const DECIMAL = /^(-)?(\d+)(?:\.(\d+))?$/;

/** -1, 0 or 1. Exact over any number of digits; throws on a malformed string. */
export function compareDecimal(a: string, b: string): -1 | 0 | 1 {
  const pa = DECIMAL.exec(a.trim());
  const pb = DECIMAL.exec(b.trim());
  if (!pa || !pb) throw new Error(`not a decimal: ${!pa ? a : b}`);
  const scale = Math.max((pa[3] ?? "").length, (pb[3] ?? "").length);
  const big = (p: RegExpExecArray) => {
    const v = BigInt((p[2] + (p[3] ?? "").padEnd(scale, "0")).replace(/^0+(?=\d)/, ""));
    return p[1] ? -v : v;
  };
  const x = big(pa);
  const y = big(pb);
  return x === y ? 0 : x < y ? -1 : 1;
}

// ── Reconcile ────────────────────────────────────────────────────────────────

export type SyncSourceName = "amora" | "chain" | "sera";
export type SourceState = "read" | "not_read" | "not_offered";

export interface ReconcileInput {
  readAt: string;
  ledger: { ok: boolean; readAt: string | null; tokens: Array<{ slug: string; name: string; amount: string }>; cash: Array<{ currency: string; owedMinor: number }> };
  chain: { ok: boolean; offered: boolean; readAt: string | null; tokens: Array<{ slug: string; formatted: string; readAt: string; stale: boolean }> };
  sera: { ok: boolean; offered: boolean; readAt: string | null };
  invoices: Array<{
    ref: string;
    status: InvoiceStatus;
    currency: string;
    totalMinor: number;
    sera: { status: SeraInvoiceStatus; currency: string; amountMinor: number; statusAt: string } | null;
  }>;
}

export type FlagKind = "chain_differs" | "sera_amount_differs" | "sera_status_differs";

export interface SyncFlag {
  kind: FlagKind;
  /** The token slug or the invoice reference. */
  subject: string;
  amora: string;
  other: string;
  /** Stable over syncs that see the same difference, so one difference is one flag. */
  dedupeKey: string;
}

export interface ReconciledView {
  readAt: string;
  sources: Record<SyncSourceName, { state: SourceState; readAt: string | null }>;
  tokens: Array<{ slug: string; name: string; amora: string; chain: string | null; chainReadAt: string | null; chainStale: boolean; disagree: boolean }>;
  cash: Array<{ currency: string; owedMinor: number }>;
  invoices: Array<{ ref: string; status: InvoiceStatus; currency: string; amoraMinor: number; seraStatus: SeraInvoiceStatus | null; seraMinor: number | null; seraAt: string | null; disagree: boolean }>;
  flags: SyncFlag[];
}

/**
 * Sera's status a village status would agree with. Received and rejected say
 * nothing against an invoice still waiting or returned; approved agrees with
 * approved; paid agrees only with paid.
 */
function statusAgrees(amora: InvoiceStatus, sera: SeraInvoiceStatus): boolean {
  if (sera === "received") return true;
  if (sera === "rejected") return amora === "returned" || amora === "void" || amora === "waiting";
  if (sera === "approved") return amora === "approved" || amora === "paid" || amora === "waiting";
  return amora === "paid";
}

const flagKey = (kind: FlagKind, subject: string, amora: string, other: string) => `${kind}:${subject}:${amora}:${other}`.slice(0, 190);

export function reconcile(input: ReconcileInput): ReconciledView {
  const flags: SyncFlag[] = [];
  const state = (s: { ok: boolean; offered?: boolean }): SourceState => (s.offered === false ? "not_offered" : s.ok ? "read" : "not_read");
  const chainBySlug = new Map(input.chain.ok ? input.chain.tokens.map((t) => [t.slug, t] as const) : []);

  const tokens = input.ledger.tokens.map((t) => {
    const c = chainBySlug.get(t.slug) ?? null;
    let disagree = false;
    if (c) {
      disagree = compareDecimal(t.amount, c.formatted) !== 0;
      if (disagree) flags.push({ kind: "chain_differs", subject: t.slug, amora: t.amount, other: c.formatted, dedupeKey: flagKey("chain_differs", t.slug, t.amount, c.formatted) });
    }
    return { slug: t.slug, name: t.name, amora: t.amount, chain: c?.formatted ?? null, chainReadAt: c?.readAt ?? null, chainStale: c?.stale ?? false, disagree };
  });

  const seraRead = input.sera.ok && input.sera.offered;
  const invoices = input.invoices.map((i) => {
    const s = seraRead ? i.sera : null;
    let disagree = false;
    if (s) {
      if (s.currency !== i.currency || s.amountMinor !== i.totalMinor) {
        disagree = true;
        const amora = `${i.totalMinor} ${i.currency}`;
        const other = `${s.amountMinor} ${s.currency}`;
        flags.push({ kind: "sera_amount_differs", subject: i.ref, amora, other, dedupeKey: flagKey("sera_amount_differs", i.ref, amora, other) });
      }
      if (!statusAgrees(i.status, s.status)) {
        disagree = true;
        flags.push({ kind: "sera_status_differs", subject: i.ref, amora: i.status, other: s.status, dedupeKey: flagKey("sera_status_differs", i.ref, i.status, s.status) });
      }
    }
    return { ref: i.ref, status: i.status, currency: i.currency, amoraMinor: i.totalMinor, seraStatus: s?.status ?? null, seraMinor: s?.amountMinor ?? null, seraAt: s?.statusAt ?? null, disagree };
  });

  return {
    readAt: input.readAt,
    sources: {
      amora: { state: state(input.ledger), readAt: input.ledger.readAt },
      chain: { state: state(input.chain), readAt: input.chain.readAt },
      sera: { state: state(input.sera), readAt: input.sera.readAt },
    },
    tokens,
    cash: input.ledger.ok ? input.ledger.cash : [],
    invoices,
    flags,
  };
}
