/**
 * THE POST OFFICE: every email any part of the platform sends goes through
 * `post()`, which writes the ledger row first and sends second
 * (the comms build spec 5.1).
 *
 * WHAT THIS FILE HOLDS TODAY, said plainly. The foundation lane built the
 * door and the urgent path: validate the address, make sure the contact has
 * its row, write the `comms_messages` row (a duplicate idempotency key answers
 * `duplicate` and names the first row), and for an urgent email send it now
 * and record `sent`, `failed` or `skipped:not_configured`. A row that is not
 * urgent waits `queued` for the drain, and `drain()` is a stub that answers
 * zeros until the post office lane (B1) builds it, with the permission,
 * suppression, pause, module and cap checks that 5.1 lists.
 *
 * A LEDGER FAULT NEVER LOCKS A PERSON OUT. If writing the row throws for an
 * urgent essential email (a password link, a set-password claim), the fault
 * is logged loudly and the send is attempted anyway. A person asking to get
 * back into their account must not be refused because a table could not be
 * written; the missing row is the lesser harm, and the log says it happened.
 *
 * AN ESSENTIAL EMAIL'S WORDS ARE NOT KEPT. Its row records who, when, the
 * subject and what became of it, and stores no body. Essential mail is the
 * mail a person just asked for, and most of it carries a link that acts for
 * them: a set-password link, a guest confirmation, a letters confirmation. A
 * ledger holding those would be a table any reader of a backup could sign in
 * with. Essential mail is always sent inside the request that asked for it,
 * so nothing ever needs its body again.
 *
 * NEVER A THROW. Every path answers a `PostResult`.
 */
import crypto from "node:crypto";
import type { Pool } from "mysql2/promise";
import { addressOfSender, addressProblem, emailKeyOf } from "../../../shared/comms/address";
import type { OutgoingEmail, PostResult } from "../../../shared/comms/contracts";
import type { SkipReason } from "../../../shared/comms/kinds";
import { upsertContact } from "../../repos/commsContacts";
import { insertMessage, markFailed, markSent, markSkipped } from "../../repos/commsMessages";
import { signLink } from "./links";
import type { Transport, TransportResult } from "./transport";

export interface PostOfficeDeps {
  getPool(): Pool;
  transport: Transport;
  /** The From: line every message leaves under. Empty means no sender is configured. */
  sender(): string;
  /** True when the provider's key is set. */
  hasApiKey(): boolean;
  /** This village's absolute origin, for the one-click links in each email's headers. */
  origin(): string;
}

/** How long an unsubscribe link in a header stays good: a year, because mail is read late. */
const UNSUBSCRIBE_LINK_DAYS = 365;

/** A ledger key: the caller's key when it fits the index, its SHA-256 when it does not. */
export function ledgerKey(idempotencyKey: string): string {
  const k = String(idempotencyKey ?? "");
  return k.length <= 191 ? k : crypto.createHash("sha256").update(k).digest("hex");
}

const newMessageId = (): string => `msg_${crypto.randomBytes(12).toString("hex")}`;
const newContactId = (): string => `ct_${crypto.randomBytes(12).toString("hex")}`;

const epochSeconds = (d: Date | null | undefined): number | null =>
  d instanceof Date && Number.isFinite(d.getTime()) ? Math.floor(d.getTime() / 1000) : null;

/**
 * Why this deployment cannot send at all right now, or null when it can. Takes
 * the sender already read, because reading it logs a malformed value and one
 * email should say so once.
 */
function notConfigured(deps: PostOfficeDeps, from: string): "no_api_key" | "no_sender" | null {
  if (!deps.hasApiKey()) return "no_api_key";
  if (!from) return "no_sender";
  return null;
}

/** Record a status move without letting a ledger fault change what the caller is told. */
async function record(what: string, write: () => Promise<unknown>): Promise<void> {
  try {
    await write();
  } catch (err) {
    console.error(`[comms] the ledger could not record ${what} (the send itself is unaffected)`, err);
  }
}

/** One message to the provider, and the ledger told what happened. */
async function sendNow(
  deps: PostOfficeDeps,
  email: OutgoingEmail,
  row: { id: string; contactId: string | null; address: string; inLedger: boolean },
): Promise<PostResult> {
  const pool = deps.getPool();
  const messageId = row.inLedger ? row.id : null;
  const from = deps.sender();
  const gap = notConfigured(deps, from);
  if (gap) {
    if (row.inLedger) await record(`a skip for ${row.id}`, () => markSkipped(pool, row.id, "not_configured"));
    console.log(`[comms] ${gap === "no_api_key" ? "no provider key is set" : "no sender address is configured"}, so the email was recorded and not sent`);
    return { status: "skipped", messageId, reason: gap };
  }
  const mailto = addressOfSender(from);
  const listUnsubscribe =
    email.kind !== "essential" && row.contactId
      ? {
          url: `${deps.origin().replace(/\/$/, "")}/api/comms/unsubscribe?t=${encodeURIComponent(
            signLink("unsubscribe", { c: row.contactId, k: email.kind }, UNSUBSCRIBE_LINK_DAYS),
          )}`,
          mailto: mailto || null,
        }
      : null;
  let result: TransportResult;
  try {
    result = await deps.transport.send({
      id: row.id,
      kind: email.kind,
      from,
      to: row.address,
      subject: email.subject,
      html: email.html,
      text: email.text,
      replyTo: email.replyTo ?? null,
      attachments: email.attachments,
      listUnsubscribe,
    });
  } catch (err) {
    // A transport is written never to throw. If one does, that is a refusal
    // to report, not a reason to fail the caller's request.
    result = { ok: false, retryable: true, error: String((err as Error)?.message ?? err) };
  }
  if (result.ok) {
    if (row.inLedger) {
      await record(`a send for ${row.id}`, () =>
        markSent(pool, row.id, { provider: deps.transport.name, providerMessageId: result.ok ? result.providerId : "" }),
      );
    }
    return { status: "sent", messageId };
  }
  if (result.error === "no_api_key") {
    // The key vanished between the check above and the send.
    if (row.inLedger) await record(`a skip for ${row.id}`, () => markSkipped(pool, row.id, "not_configured"));
    return { status: "skipped", messageId, reason: "no_api_key" };
  }
  console.error(`[comms] the provider did not take ${row.inLedger ? row.id : "an unrecorded email"}: ${result.error}`);
  if (row.inLedger) {
    const error = result.error;
    await record(`a failure for ${row.id}`, () => markFailed(pool, row.id, { provider: deps.transport.name, error }));
  }
  return { status: "failed", messageId, reason: result.status ? "rejected" : "failed" };
}

/**
 * Record one email and, when it is urgent, send it now.
 *
 * Answers `queued` for an email left for the drain, `sent` / `failed` /
 * `skipped` for an urgent one, `skipped` with `bad_address` for an address
 * nobody can write to, and `duplicate` with the first row's id for a key
 * already used.
 */
export async function post(deps: PostOfficeDeps, email: OutgoingEmail): Promise<PostResult> {
  const address = String(email.to?.email ?? "").trim();
  const emailKey = emailKeyOf(address);
  const bad = addressProblem(address) !== null;
  const essential = email.kind === "essential";
  // Essential mail is always sent inside the request that asked for it. Its
  // body is never stored, so a queued essential row would have nothing to send.
  const urgent = essential || email.urgent === true;
  const key = ledgerKey(email.idempotencyKey);
  const id = newMessageId();
  const pool = deps.getPool();

  let contactId: string | null = email.to?.contactId ?? null;
  let inserted: Awaited<ReturnType<typeof insertMessage>>;
  try {
    if (!bad && !contactId) {
      contactId = (
        await upsertContact(pool, {
          id: newContactId(),
          emailKey,
          email: address,
          name: email.to?.name ?? null,
          userId: email.to?.userId ?? null,
          source: email.origin,
          timezone: null,
        })
      ).id;
    }
    const skipReason: SkipReason | null = bad ? "bad_address" : null;
    inserted = await insertMessage(pool, {
      id,
      idempotencyKey: key,
      contactId: bad ? null : contactId,
      userId: email.to?.userId ?? null,
      toEmail: address || "(no address)",
      emailKey: emailKey || "(no address)",
      kind: email.kind,
      origin: email.origin,
      subject: email.subject,
      templateKey: email.source?.templateKey ?? null,
      templateVersion: email.source?.templateVersion ?? null,
      journeyKey: email.source?.journeyKey ?? null,
      stepKey: email.source?.stepKey ?? null,
      enrollmentId: email.source?.enrollmentId ?? null,
      letterId: email.source?.letterId ?? null,
      bodyHtml: essential ? null : email.html,
      bodyText: essential ? null : email.text || null,
      attachments: essential || !email.attachments?.length ? null : email.attachments,
      replyTo: email.replyTo ?? null,
      status: bad ? "skipped" : "queued",
      skipReason,
      sendAfter: epochSeconds(email.sendAfter),
      expiresAt: epochSeconds(email.expiresAt),
    });
  } catch (err) {
    if (essential && !bad) {
      console.error(
        `[comms] LEDGER FAULT: the row for an essential email (${email.origin}) could not be written. ` +
          "Sending it anyway, because a person asking to get back in must not be locked out by a table.",
        err,
      );
      return sendNow(deps, email, { id, contactId, address, inLedger: false });
    }
    console.error(`[comms] the ledger could not record an email (${email.origin}), so it was not sent`, err);
    return { status: "failed", messageId: null, reason: "ledger_unavailable" };
  }

  if (!inserted.inserted) return { status: "duplicate", messageId: inserted.existingId };
  if (bad) return { status: "skipped", messageId: id, reason: "bad_address" };
  if (!urgent) return { status: "queued", messageId: id };
  return sendNow(deps, email, { id, contactId, address, inLedger: true });
}

/**
 * Send what is due. A STUB until the post office lane (B1) builds it: claim
 * queued rows that are due, send at the configured rate, expire the late, back
 * off the retryable, and put a row stuck in `sending` back in the queue
 * (the comms build spec 5.1). It answers zeros so the admin "run now"
 * button and the scheduler can be wired to it today.
 */
export async function drain(
  _deps: PostOfficeDeps,
  _opts: { limit?: number; budgetMs?: number } = {},
): Promise<{ sent: number; failed: number; skipped: number; expired: number; requeued: number }> {
  return { sent: 0, failed: 0, skipped: 0, expired: 0, requeued: 0 };
}
