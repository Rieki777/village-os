/**
 * THE INVOICE, EMAILED TO THE VILLAGE'S SERA INBOX (invoice rails, S1).
 *
 * Rye, 2026-11-06: he emailed his invoice to the village's Sera inbox so Sera
 * would ingest it, and the village kept no record of it. So a member's own
 * "Send for approval" now also emails the invoice there for them, with its
 * PDF attached and its reference in the subject, and the village records that
 * it did.
 *
 *   - ON THE MEMBER'S OWN PRESS ONLY (constitution VIII.10): the only caller
 *     is the send route, after the send committed. Nothing here runs for a
 *     member who did not press it, except the daily retry of a send that
 *     already was pressed and did not go out.
 *   - ONE EMAIL PER REFERENCE AND CONTENT. The row is written first under a
 *     unique (reference, content hash); a second press of the same invoice
 *     finds the row and sends nothing. A take-back and a changed resend under
 *     the same reference is new content, so one more email, marked "updated".
 *   - NO BODY IS KEPT. It goes as essential mail, whose words and attachments
 *     the post office never stores; this table keeps who, where, when, and
 *     what became of it.
 *   - A FAILED EMAIL NEVER FAILS THE SEND. The invoice is the village's
 *     record; the email is a courtesy to Sera. The card reads "Not emailed
 *     yet" and the daily job tries again, three attempts in all.
 *   - NO INBOX, NO EMAIL. A blank `seraInbox` setting (the platform default)
 *     sends nothing and writes nothing.
 */
import crypto from "node:crypto";
import type { Pool } from "mysql2/promise";
import type { OutgoingEmail, PostResult } from "../../shared/comms/contracts";
import { invoiceSubject } from "../../shared/invoiceTrack";
import type { InvoiceView } from "../../shared/moonRecap";
import { claimMailAttempt, insertMail, mailForRef, settleMail, unsentMail, type InvoiceMailRow, type MailStatus } from "../repos/invoiceRails";
import { invoicePdf, moneyWords } from "./invoicePdf";

export const MAIL_MAX_ATTEMPTS = 3;

export interface InvoiceMailDeps {
  getPool(): Pool;
  /** The post office's `post`, bound to its deps. */
  post(email: OutgoingEmail): Promise<PostResult>;
  /** The village's Sera inbox from the moon-review settings, or null. */
  seraInbox(): Promise<string | null>;
  /** The village's name, for the email's words. */
  projectName(): string;
  audit(text: string, userId: string): Promise<void>;
  now?(): Date;
}

export type MailOutcome = "sent" | "queued" | "failed" | "duplicate" | "no_inbox" | "no_reference";

/**
 * What the content hash covers: every figure and party a reader of the invoice
 * would see change. The period and the basis words are left out: they follow
 * the cycle and the terms, and the daily retry rebuilds the PDF from the
 * stored row, which carries the cycle id where the send carried its words.
 */
export function contentHashOf(v: InvoiceView): string {
  const canon = JSON.stringify([
    v.billRef, v.memberNumber, v.currency, v.totalMinor, v.from?.legalName ?? null, v.from?.address ?? null, v.billTo?.legalName ?? null,
    v.lines.map((l) => [l.key, l.roleNames, l.amountMinor, l.currency, l.listedAs]),
  ]);
  return crypto.createHash("sha256").update(canon).digest("hex");
}

function emailOf(v: InvoiceView, ref: string, updated: boolean, to: string, key: string, userId: string, village: string): OutgoingEmail {
  const total = v.totalMinor !== null && v.currency ? moneyWords(v.totalMinor, v.currency) : "no amount";
  const lines = [
    `Invoice ${ref}${updated ? ", updated," : ""} sent for approval from ${village}, by the member at their own request.`,
    `Period: ${v.period}. Total: ${total}.`,
    "The invoice is attached as a PDF. Its reference is in the subject.",
  ];
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return {
    idempotencyKey: key,
    kind: "essential",
    origin: "invoice.sera",
    to: { email: to, userId: null },
    subject: invoiceSubject(ref, updated),
    html: lines.map((l) => `<p>${esc(l)}</p>`).join(""),
    text: lines.join("\n\n"),
    attachments: [{ filename: `invoice-${ref}.pdf`, contentType: "application/pdf", contentBase64: invoicePdf({ ...v, billRef: ref }).toString("base64") }],
    urgent: true,
    // `userId` stays off `to`: the inbox is the village's, not the member's.
    source: { templateKey: `invoice:${userId}` },
  };
}

const outcomeOf = (r: PostResult): { status: MailStatus; outcome: MailOutcome } =>
  r.status === "sent" || r.status === "delivered" || r.status === "rehearsed"
    ? { status: "sent", outcome: "sent" }
    : r.status === "queued" || r.status === "sending"
      ? { status: "queued", outcome: "queued" }
      : { status: "failed", outcome: "failed" };

async function attempt(deps: InvoiceMailDeps, row: InvoiceMailRow, v: InvoiceView, updated: boolean): Promise<MailOutcome> {
  const pool = deps.getPool();
  const n = await claimMailAttempt(pool, row.id, row.attempts);
  if (n === 0) return "duplicate";
  const key = `invoice-mail:${row.invoiceRef}:${row.contentHash.slice(0, 16)}:${n}`;
  let result: PostResult;
  try {
    result = await deps.post(emailOf(v, row.invoiceRef, updated, row.toEmail, key, row.userId, deps.projectName()));
  } catch {
    result = { status: "failed", messageId: null } as PostResult;
  }
  const { status, outcome } = outcomeOf(result);
  const at = (deps.now?.() ?? new Date()).toISOString();
  await settleMail(pool, row.id, { status, messageId: result.messageId ?? null, sentAt: status === "sent" ? at : null });
  await deps.audit(`invoice:emailed:${row.invoiceRef}:${outcome}:attempt-${n}`, row.userId).catch(() => undefined);
  return outcome;
}

/**
 * After a member's send committed: email the invoice to the Sera inbox once
 * for this content. Never throws, so the send's answer is never at risk.
 */
export async function emailInvoiceToSera(deps: InvoiceMailDeps, userId: string, v: InvoiceView): Promise<MailOutcome> {
  try {
    if (!v.id || !v.billRef) return "no_reference";
    const to = await deps.seraInbox();
    if (!to) return "no_inbox";
    const pool = deps.getPool();
    const hash = contentHashOf(v);
    const earlier = await mailForRef(pool, v.billRef);
    const same = earlier.find((m) => m.contentHash === hash);
    if (same) return same.status === "sent" ? "duplicate" : attempt(deps, same, v, earlier.some((m) => m.contentHash !== hash));
    const row: Omit<InvoiceMailRow, "status" | "messageId" | "sentAt" | "attempts"> = {
      id: `im-${crypto.randomUUID()}`, invoiceId: v.id, invoiceRef: v.billRef, userId, contentHash: hash, toEmail: to, queuedAt: (deps.now?.() ?? new Date()).toISOString(),
    };
    if (!(await insertMail(pool, row))) return "duplicate";
    return attempt(deps, { ...row, status: "queued", messageId: null, sentAt: null, attempts: 0 }, v, earlier.length > 0);
  } catch (e) {
    console.warn("[invoice-mail] could not email the invoice:", e instanceof Error ? e.message : String(e));
    return "failed";
  }
}

/**
 * The daily retry: every row that never went out and has attempts left is
 * tried again, with the invoice as it reads now. A row whose invoice changed
 * since is left: the member's next send writes the new content's row.
 */
export async function retryUnsentInvoiceMail(deps: InvoiceMailDeps, viewOf: (invoiceId: string, userId: string) => Promise<InvoiceView | null>): Promise<string> {
  const rows = await unsentMail(deps.getPool(), MAIL_MAX_ATTEMPTS, 50);
  let sent = 0;
  for (const r of rows) {
    const v = await viewOf(r.invoiceId, r.userId).catch(() => null);
    if (!v || contentHashOf(v) !== r.contentHash || v.status === "void") continue;
    if ((await attempt(deps, r, v, false)) === "sent") sent++;
  }
  return `invoice mail: ${sent} of ${rows.length} unsent sent`;
}
