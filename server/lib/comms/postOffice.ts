/**
 * THE POST OFFICE: every email any part of the platform sends goes through
 * `post()`, which writes the ledger row first and sends second, and `drain()`,
 * which sends what is waiting (the comms build spec 5.1).
 *
 * ── THE QUESTIONS, ASKED WHEN A ROW IS WRITTEN AND AGAIN WHEN IT IS SENT ───
 *
 * In this order, and the first one that answers decides:
 *
 *   1. Is the address one anybody can write to? No: `skipped:bad_address`.
 *   2. Has its moment passed (`expiresAt`)? Yes: `expired`.
 *   3. Can this village send at all (a provider key and a sender)? No, when
 *      the row is written: `skipped:not_configured`, and the caller is told
 *      which half is missing. No, when the drain runs: the row WAITS, because
 *      a key being changed in Admin is a gap of minutes and nobody's email
 *      should be thrown away over it.
 *   4. Essential mail stops asking here and goes. The person just asked for
 *      it, so it reaches even an address that asked to stop everything.
 *   5. For gathering, path and letter emails, the comms module's lifecycle
 *      (5.16): off means `skipped:module_off`.
 *   6. The suppression list: `skipped:suppressed`.
 *   7. Permission (`permissionFor`, the people lane's): `skipped:no_permission`.
 *   8. Pause all, for gathering, path and letter emails: the row WAITS in the
 *      queue, and may expire there. Notices go on through a pause.
 *   9. The daily cap, for path emails and letters only: over it, the row waits
 *      for the next window. It is never dropped.
 *  10. Rehearsal, while the module is in preview: gathering, path and letter
 *      emails go to the rehearsal inbox instead of the person, marked, and the
 *      row says `rehearsed` and where it really went.
 *
 * ── TWO DEPENDENCIES ARE INJECTED, AND EACH HAS A DEFAULT ─────────────────
 *
 *   mode()           the setup lane's `commsMode()`: the module's lifecycle,
 *                    Pause all, and the rehearsal inbox. The default reads the
 *                    lifecycle, is never paused, and rehearses to the admins.
 *   permissionFor()  the people lane's reading of who said yes to what. The
 *                    default allows every kind. Suppression is NOT inside it:
 *                    the post office asks the suppression list itself, before
 *                    permission, so a suppressed address skips whatever
 *                    permission reader is plugged in.
 *
 * ── THE URGENT PATH ─────────────────────────────────────────────────────────
 *
 * An urgent row (all essential mail, and confirmations) is written already
 * claimed, as `sending`, and sent inside the request that asked for it, within
 * the transport's ten seconds. No drain can take it in the meantime. If the
 * provider says "try later", a row whose words are kept goes back in the queue
 * with the drain's backoff; an essential row cannot (its words are not kept)
 * and is marked failed with the provider's words.
 *
 * ── THE DRAIN ───────────────────────────────────────────────────────────────
 *
 * Puts a row stuck in `sending` for ten minutes back in the queue, expires what
 * is late, then claims each due row one at a time (one UPDATE that exactly one
 * drain can win), asks the questions again, and sends at
 * `comms.send_rate_per_second`. A retryable failure (no answer, 429, 5xx) is
 * tried again after 1 minute, 5, 30, 2 hours and 6 hours, and then the row is
 * `failed`. Any other refusal is `failed` at once with the provider's words.
 * The row id rides to the provider as the Idempotency-Key every time, so a
 * second attempt at an email the provider already took is one delivery.
 *
 * A LEDGER FAULT NEVER LOCKS A PERSON OUT. If writing the row throws for an
 * essential email (a password link, a set-password claim), the fault is logged
 * loudly and the send is attempted anyway. Every other email is refused when it
 * cannot be recorded.
 *
 * AN ESSENTIAL EMAIL'S WORDS ARE NOT KEPT. Its row records who, when, the
 * subject and what became of it, and stores no body: most essential mail
 * carries a link that acts for the person, and a ledger holding those would be
 * a table any reader of a backup could sign in with.
 *
 * NEVER A THROW. Every path answers a `PostResult`.
 */
import crypto from "node:crypto";
import type { Pool } from "mysql2/promise";
import { addressOfSender, addressProblem, emailKeyOf } from "../../../shared/comms/address";
import type { OutgoingEmail, PostResult } from "../../../shared/comms/contracts";
import { SKIP_REASONS, type EmailKind, type MessageStatus, type SkipReason } from "../../../shared/comms/kinds";
import type { ModuleLifecycle } from "../../../shared/modules";
import { upsertContact } from "../../repos/commsContacts";
import {
  cappedSendsInWindow,
  claimMessage,
  deferMessage,
  dueMessageIds,
  expireDue,
  failStaleEssential,
  insertMessage,
  markExpired,
  markFailed,
  markSent,
  markSkipped,
  recoverStaleSending,
  releaseClaim,
  scheduleRetry,
  type OutboundRow,
} from "../../repos/commsMessages";
import { effectiveLifecycle } from "../modules";
import { numberVar } from "../variables";
import { signLink } from "./links";
import { isSuppressed } from "./suppressions";
import type { Transport, TransportMessage, TransportResult } from "./transport";

// ── What the post office is handed ──────────────────────────────────────────

/** Rehearsal, Pause all and the module's lifecycle, read together (5.16). */
export interface CommsMode {
  lifecycle: ModuleLifecycle;
  paused: boolean;
  /** Who receives every gathering, path and letter email while the village rehearses. */
  rehearsalTo: string[];
}

/** One answer from a permission reader. A `reason` from SKIP_REASONS is kept; any other reads as no permission. */
export interface PermissionAnswer {
  allowed: boolean;
  reason?: string;
}

/** The comms dials the post office reads. */
export type PostOfficeDial = "comms.daily_cap" | "comms.send_rate_per_second" | "comms.notice_expiry_minutes";

export interface PostOfficeDeps {
  getPool(): Pool;
  transport: Transport;
  /** The From: line every message leaves under. Empty means no sender is configured. */
  sender(): string;
  /** True when the provider's key is set. */
  hasApiKey(): boolean;
  /** This village's absolute origin, for the one-click links in each email's headers. */
  origin(): string;
  /** The setup lane's `commsMode()`. Absent: `defaultMode` below. */
  mode?(): Promise<CommsMode>;
  /** The people lane's `permissionFor()`. Absent: every kind is allowed. */
  permissionFor?(emailKey: string, kind: EmailKind, contactId: string | null): Promise<PermissionAnswer>;
  /** Every admin's address: where the default mode rehearses to. */
  adminEmails?(): Promise<string[]>;
  /** A dial's value. Absent: the game variable. Tests pass their own. */
  dial?(key: PostOfficeDial): number;
}

/**
 * What one drain did. `requeued` counts every row it put back in the queue:
 * stale claims, retries, holds and deferrals. A type and not an interface, so
 * it reads as the `Record<string, number>` the "run now" route answers with.
 */
export type DrainSummary = {
  sent: number;
  rehearsed: number;
  failed: number;
  skipped: number;
  expired: number;
  requeued: number;
};

// ── The rules, as values ────────────────────────────────────────────────────

/** Gathering, path and letter emails: the kinds the module's lifecycle, Pause all and rehearsal govern. */
export const AUTOMATED_KINDS: ReadonlySet<EmailKind> = new Set<EmailKind>(["events", "paths", "letters"]);

/** The kinds the daily cap counts (5.1). Gathering reminders, notices and essential mail do not count. */
export const CAPPED_KINDS: ReadonlySet<EmailKind> = new Set<EmailKind>(["paths", "letters"]);

/** After a retryable failure, wait this long before the next try: 1m, 5m, 30m, 2h, 6h. Then `failed`. */
export const RETRY_BACKOFF_SECONDS: readonly number[] = [60, 5 * 60, 30 * 60, 2 * 3600, 6 * 3600];

/** A claim older than this belonged to a drain that died. */
export const STALE_SENDING_MINUTES = 10;

export const DEFAULT_DRAIN_LIMIT = 200;
export const DEFAULT_DRAIN_BUDGET_MS = 120_000;

/** The scheduler job that runs the drain (registered in server/routes/comms.ts). */
export const POST_OFFICE_JOB = "comms-post-office";
export const POST_OFFICE_EVERY_MS = 60_000;

/** How long an unsubscribe link in a header stays good: a year, because mail is read late. */
const UNSUBSCRIBE_LINK_DAYS = 365;

/** What an essential row left behind by a crash is marked with. */
const STALE_ESSENTIAL =
  "The send was interrupted before the provider's answer was recorded, and the words of essential mail are never kept, so it was not tried again. A delivery report will correct this if the email did arrive.";

const NO_REHEARSAL_INBOX = "The village is rehearsing and there is no rehearsal inbox to send to.";
const NO_WORDS = "The words of this email are no longer kept, so it cannot be sent.";

// ── Small helpers ───────────────────────────────────────────────────────────

/** A ledger key: the caller's key when it fits the index, its SHA-256 when it does not. */
export function ledgerKey(idempotencyKey: string): string {
  const k = String(idempotencyKey ?? "");
  return k.length <= 191 ? k : crypto.createHash("sha256").update(k).digest("hex");
}

const newMessageId = (): string => `msg_${crypto.randomBytes(12).toString("hex")}`;
const newContactId = (): string => `ct_${crypto.randomBytes(12).toString("hex")}`;

const epochSeconds = (d: Date | null | undefined): number | null =>
  d instanceof Date && Number.isFinite(d.getTime()) ? Math.floor(d.getTime() / 1000) : null;

const nowSeconds = (): number => Math.floor(Date.now() / 1000);

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const escapeHtml = (s: string): string =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const dialOf = (deps: PostOfficeDeps, key: PostOfficeDial): number => {
  const v = deps.dial ? deps.dial(key) : numberVar(key);
  return Number.isFinite(v) ? v : 0;
};

/** Why this deployment cannot send at all right now, or null when it can. */
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

/** Addresses trimmed, deduplicated, and only the ones that can be written to. */
function inboxOf(list: readonly string[] | null | undefined): string[] {
  const out: string[] = [];
  for (const raw of list ?? []) {
    const a = String(raw ?? "").trim();
    if (a && addressProblem(a) === null && !out.some((o) => emailKeyOf(o) === emailKeyOf(a))) out.push(a);
  }
  return out;
}

/**
 * THE DEFAULT MODE, until the setup lane's `commsMode()` is plugged in: the
 * module's own lifecycle, never paused, and rehearsing to every admin. The
 * admins are only read while the module is in preview.
 */
export async function defaultMode(deps: Pick<PostOfficeDeps, "adminEmails">): Promise<CommsMode> {
  const lifecycle = effectiveLifecycle("comms");
  const rehearsalTo = lifecycle === "preview" && deps.adminEmails ? await deps.adminEmails() : [];
  return { lifecycle, paused: false, rehearsalTo };
}

/**
 * The mode, read. A reader that throws HOLDS every gathering, path and letter
 * email (it reads as paused), because sending one live while the village might
 * be rehearsing or paused is the worse of the two mistakes.
 */
async function readMode(deps: PostOfficeDeps): Promise<CommsMode> {
  try {
    return deps.mode ? await deps.mode() : await defaultMode(deps);
  } catch (err) {
    console.error("[comms] the comms mode could not be read, so gathering, path and letter emails wait", err);
    return { lifecycle: "members", paused: true, rehearsalTo: [] };
  }
}

// ── The decision ────────────────────────────────────────────────────────────

type Decision =
  | { act: "send"; rehearse: string[] | null }
  | { act: "hold"; reason: "paused" | "unavailable" }
  | { act: "defer"; until: number }
  | { act: "skip"; reason: SkipReason; gap?: "no_api_key" | "no_sender"; detail?: string }
  | { act: "expire" };

interface Subject {
  kind: EmailKind;
  emailKey: string;
  contactId: string | null;
  /** The row being sent, so the cap does not count it against itself. */
  rowId: string | null;
  expiresAt: number | null;
  bypassCap: boolean;
}

/**
 * The questions in the header, asked of one email. `phase` is when they are
 * asked: `insert` is `post()` writing the row, `send` is a drain about to send
 * it. `mode` is handed in by a drain that read it once for the whole run.
 */
async function decide(deps: PostOfficeDeps, s: Subject, phase: "insert" | "send", known?: CommsMode): Promise<Decision> {
  const essential = s.kind === "essential";
  if (!essential && s.expiresAt != null && s.expiresAt <= nowSeconds()) return { act: "expire" };
  const gap = notConfigured(deps, deps.sender());
  if (gap) return phase === "insert" ? { act: "skip", reason: "not_configured", gap } : { act: "hold", reason: "unavailable" };
  if (essential) return { act: "send", rehearse: null };

  const automated = AUTOMATED_KINDS.has(s.kind);
  const mode = automated ? known ?? (await readMode(deps)) : null;
  if (mode && mode.lifecycle === "off") return { act: "skip", reason: "module_off" };

  const pool = deps.getPool();
  try {
    if (await isSuppressed(pool, s.emailKey)) return { act: "skip", reason: "suppressed" };
    const answer = deps.permissionFor ? await deps.permissionFor(s.emailKey, s.kind, s.contactId) : { allowed: true };
    if (!answer.allowed) {
      const reason = (SKIP_REASONS as readonly string[]).includes(String(answer.reason)) ? (answer.reason as SkipReason) : "no_permission";
      return { act: "skip", reason };
    }
  } catch (err) {
    // A question that could not be answered is not a yes. The row waits.
    console.error(`[comms] suppression or permission could not be read for a ${s.kind} email, so it waits`, err);
    return { act: "hold", reason: "unavailable" };
  }

  if (mode?.paused) return { act: "hold", reason: "paused" };

  if (CAPPED_KINDS.has(s.kind) && !s.bypassCap && s.contactId) {
    const cap = Math.max(1, Math.trunc(dialOf(deps, "comms.daily_cap")));
    const window = await cappedSendsInWindow(pool, s.contactId, s.rowId);
    if (window.count >= cap) {
      // The oldest send leaving the window opens the next one. A window held
      // only by sends still in flight opens again in ten minutes, when they
      // have resolved one way or the other.
      return { act: "defer", until: window.nextWindowAt ?? window.now + STALE_SENDING_MINUTES * 60 };
    }
  }

  if (mode?.lifecycle === "preview") {
    const inbox = inboxOf(mode.rehearsalTo);
    if (!inbox.length) return { act: "skip", reason: "not_configured", detail: NO_REHEARSAL_INBOX };
    return { act: "send", rehearse: inbox };
  }
  return { act: "send", rehearse: null };
}

// ── Sending one row ─────────────────────────────────────────────────────────

/** The line a rehearsed email opens with, naming who it would have reached. */
function rehearsalLine(address: string): string {
  return `Rehearsal: this email would have gone to ${address}. The village is rehearsing, so it came to you instead.`;
}

/**
 * One row to the provider, and the ledger told what happened. `rehearse` is
 * the rehearsal inbox when the village is rehearsing and this kind rehearses.
 */
async function sendRow(deps: PostOfficeDeps, row: OutboundRow, rehearse: string[] | null, inLedger = true): Promise<PostResult> {
  const pool = deps.getPool();
  const messageId = inLedger ? row.id : null;
  const from = deps.sender();
  const gap = notConfigured(deps, from);
  if (gap) {
    if (inLedger) await record(`a skip for ${row.id}`, () => markSkipped(pool, row.id, "not_configured"));
    console.log(`[comms] ${gap === "no_api_key" ? "no provider key is set" : "no sender address is configured"}, so the email was recorded and not sent`);
    return { status: "skipped", messageId, reason: gap };
  }
  const essential = row.kind === "essential";
  const rehearsing = !essential && rehearse !== null && rehearse.length > 0;
  const mailto = addressOfSender(from);
  /*
   * NO UNSUBSCRIBE LINK ON A REHEARSAL. The link is signed for the person the
   * email was written to, and it would land in an admin's inbox, where a mail
   * client's own one-click button would unsubscribe somebody else.
   */
  const listUnsubscribe =
    !essential && !rehearsing && row.contactId
      ? {
          url: `${deps.origin().replace(/\/$/, "")}/api/comms/unsubscribe?t=${encodeURIComponent(
            signLink("unsubscribe", { c: row.contactId, k: row.kind }, UNSUBSCRIBE_LINK_DAYS),
          )}`,
          mailto: mailto || null,
        }
      : null;
  const html = row.html ?? "";
  const text = row.text ?? "";
  const message: TransportMessage = {
    id: row.id,
    kind: row.kind,
    from,
    to: rehearsing ? (rehearse as string[]) : row.address,
    subject: rehearsing ? `Rehearsal: ${row.subject}` : row.subject,
    html: rehearsing
      ? `<div style="background:#fef3c7;color:#78350f;padding:12px 16px;font-family:sans-serif;font-size:14px;border-bottom:1px solid #fcd34d">${escapeHtml(rehearsalLine(row.address))}</div>${html}`
      : html,
    text: rehearsing ? `${rehearsalLine(row.address)}\n\n${text}` : text,
    replyTo: row.replyTo,
    attachments: row.attachments ?? undefined,
    listUnsubscribe,
  };
  let result: TransportResult;
  try {
    result = await deps.transport.send(message);
  } catch (err) {
    // A transport is written never to throw. If one does, that is a refusal
    // to report, not a reason to fail the caller's request.
    result = { ok: false, retryable: true, error: String((err as Error)?.message ?? err) };
  }
  const provider = deps.transport.name;
  if (result.ok) {
    const providerMessageId = result.providerId;
    if (inLedger) {
      await record(`a send for ${row.id}`, () =>
        markSent(pool, row.id, {
          provider,
          providerMessageId,
          status: rehearsing ? "rehearsed" : "sent",
          rehearsalTo: rehearsing ? (rehearse as string[]).join(", ") : null,
        }),
      );
    }
    return { status: rehearsing ? "rehearsed" : "sent", messageId };
  }
  if (result.error === "no_api_key") {
    // The key vanished between the check above and the send.
    if (inLedger) await record(`a skip for ${row.id}`, () => markSkipped(pool, row.id, "not_configured"));
    return { status: "skipped", messageId, reason: "no_api_key" };
  }
  const error = result.error;
  // An essential row has no words to try again with, and an unrecorded send
  // has no row to try again from.
  const delay = result.retryable && !essential && inLedger ? RETRY_BACKOFF_SECONDS[row.attempts] : undefined;
  if (delay !== undefined) {
    console.warn(`[comms] the provider did not take ${row.id} this time, so it waits ${Math.round(delay / 60)} minute(s): ${error}`);
    await record(`a retry for ${row.id}`, () => scheduleRetry(pool, row.id, { provider, error, delaySeconds: delay }));
    return { status: "queued", messageId, reason: "retrying" };
  }
  console.error(`[comms] the provider did not take ${inLedger ? row.id : "an unrecorded email"}: ${error}`);
  if (inLedger) await record(`a failure for ${row.id}`, () => markFailed(pool, row.id, { provider, error }));
  return { status: "failed", messageId, reason: result.status ? "rejected" : "failed" };
}

// ── post() ──────────────────────────────────────────────────────────────────

/**
 * Record one email and, when it is urgent and may go now, send it now.
 *
 * Answers `queued` for an email left for the drain (with `paused` or `over_cap`
 * as the reason when it is waiting for one of those), `sent`, `rehearsed`,
 * `failed` or `skipped` for an urgent one, `skipped` with the reason when one
 * of the questions said no, `expired` when it was already too late, and
 * `duplicate` with the first row's id for a key already used.
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
  const expiresAt = epochSeconds(email.expiresAt);

  let contactId: string | null = email.to?.contactId ?? null;
  let decision: Decision;
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
    decision = bad
      ? { act: "skip", reason: "bad_address" }
      : await decide(deps, { kind: email.kind, emailKey, contactId, rowId: null, expiresAt, bypassCap: email.bypassCap === true }, "insert");
    const status: "queued" | "sending" | "skipped" | "expired" =
      decision.act === "skip" ? "skipped" : decision.act === "expire" ? "expired" : decision.act === "send" && urgent ? "sending" : "queued";
    const sendAfter = decision.act === "defer" ? decision.until : decision.act === "send" && urgent ? null : epochSeconds(email.sendAfter);
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
      status,
      skipReason: decision.act === "skip" ? decision.reason : decision.act === "expire" ? "expired" : null,
      lastError: decision.act === "skip" ? decision.detail ?? null : null,
      sendAfter,
      expiresAt,
    });
  } catch (err) {
    if (essential && !bad) {
      console.error(
        `[comms] LEDGER FAULT: the row for an essential email (${email.origin}) could not be written. ` +
          "Sending it anyway, because a person asking to get back in must not be locked out by a table.",
        err,
      );
      return sendRow(deps, outboundOf(id, email, address, emailKey, contactId), null, false);
    }
    console.error(`[comms] the ledger could not record an email (${email.origin}), so it was not sent`, err);
    return { status: "failed", messageId: null, reason: "ledger_unavailable" };
  }

  if (!inserted.inserted) return { status: "duplicate", messageId: inserted.existingId };
  switch (decision.act) {
    case "skip":
      return { status: "skipped", messageId: id, reason: decision.gap ?? decision.reason };
    case "expire":
      return { status: "expired", messageId: id, reason: "expired" };
    case "hold":
      return { status: "queued", messageId: id, reason: decision.reason };
    case "defer":
      return { status: "queued", messageId: id, reason: "over_cap" };
    case "send":
      if (!urgent) return { status: "queued", messageId: id };
      return sendRow(deps, outboundOf(id, email, address, emailKey, contactId), decision.rehearse);
  }
}

/** The row `post()` just wrote, in the shape a send reads, without reading it back. */
function outboundOf(id: string, email: OutgoingEmail, address: string, emailKey: string, contactId: string | null): OutboundRow {
  return {
    id,
    kind: email.kind,
    contactId,
    userId: email.to?.userId ?? null,
    address,
    emailKey,
    subject: email.subject,
    html: email.html,
    text: email.text,
    replyTo: email.replyTo ?? null,
    attachments: email.attachments?.length ? email.attachments : null,
    attempts: 0,
    expiresAt: epochSeconds(email.expiresAt),
  };
}

// ── drain() ─────────────────────────────────────────────────────────────────

/**
 * Send what is due, oldest first, until `limit` rows (default 200) or
 * `budgetMs` (default two minutes) runs out. Safe to run twice at once: each
 * row is claimed by one drain only.
 */
export async function drain(deps: PostOfficeDeps, opts: { limit?: number; budgetMs?: number } = {}): Promise<DrainSummary> {
  const limit = Math.max(1, Math.min(1000, Math.trunc(opts.limit ?? DEFAULT_DRAIN_LIMIT)));
  const budgetMs = Math.max(0, opts.budgetMs ?? DEFAULT_DRAIN_BUDGET_MS);
  const started = Date.now();
  const pool = deps.getPool();
  const summary: DrainSummary = { sent: 0, rehearsed: 0, failed: 0, skipped: 0, expired: 0, requeued: 0 };

  summary.requeued += await recoverStaleSending(pool, STALE_SENDING_MINUTES);
  summary.failed += await failStaleEssential(pool, STALE_SENDING_MINUTES, STALE_ESSENTIAL);
  summary.expired += await expireDue(pool);
  // Unconfigured: everything waits for the key or the sender (header, question 3).
  if (notConfigured(deps, deps.sender())) return summary;

  // Read once for the whole run. While paused, only notices are even listed.
  const mode = await readMode(deps);
  const ids = await dueMessageIds(pool, { limit, onlyKinds: mode.paused ? ["notices"] : null });
  const rate = Math.max(1, Math.min(50, dialOf(deps, "comms.send_rate_per_second") || 1));
  const gapMs = 1000 / rate;
  let lastSendAt = 0;

  for (const id of ids) {
    if (Date.now() - started >= budgetMs) break;
    const row = await claimMessage(pool, id);
    if (!row) continue; // another drain won it, or it stopped being due
    const decision = await decide(
      deps,
      { kind: row.kind, emailKey: row.emailKey, contactId: row.contactId, rowId: row.id, expiresAt: row.expiresAt, bypassCap: false },
      "send",
      mode,
    );
    if (decision.act === "expire") {
      await record(`an expiry for ${row.id}`, () => markExpired(pool, row.id));
      summary.expired += 1;
      continue;
    }
    if (decision.act === "skip") {
      await record(`a skip for ${row.id}`, () => markSkipped(pool, row.id, decision.reason, decision.detail ?? null));
      summary.skipped += 1;
      continue;
    }
    if (decision.act === "hold") {
      await record(`a hold for ${row.id}`, () => releaseClaim(pool, row.id));
      summary.requeued += 1;
      continue;
    }
    if (decision.act === "defer") {
      await record(`a deferral for ${row.id}`, () => deferMessage(pool, row.id, decision.until));
      summary.requeued += 1;
      continue;
    }
    if (row.html == null) {
      await record(`a failure for ${row.id}`, () => markFailed(pool, row.id, { provider: deps.transport.name, error: NO_WORDS }));
      summary.failed += 1;
      continue;
    }
    const wait = lastSendAt + gapMs - Date.now();
    if (wait > 0) await sleep(wait);
    lastSendAt = Date.now();
    const result = await sendRow(deps, row, decision.rehearse);
    tally(summary, result.status);
  }
  return summary;
}

function tally(summary: DrainSummary, status: MessageStatus | "duplicate"): void {
  if (status === "sent") summary.sent += 1;
  else if (status === "rehearsed") summary.rehearsed += 1;
  else if (status === "queued") summary.requeued += 1;
  else if (status === "failed") summary.failed += 1;
  else if (status === "skipped") summary.skipped += 1;
}

/**
 * The scheduler's job: the drain, or a sentence saying why there is nothing to
 * do. Unconfigured, it returns at once and touches no row, so queued email
 * waits for the key and the sender instead of being thrown away.
 */
export async function runPostOfficeJob(deps: PostOfficeDeps): Promise<string> {
  const gap = notConfigured(deps, deps.sender());
  if (gap === "no_api_key") return "nothing sent: no provider key is set";
  if (gap === "no_sender") return "nothing sent: no sender address is configured";
  const s = await drain(deps);
  return `sent ${s.sent}, rehearsed ${s.rehearsed}, failed ${s.failed}, skipped ${s.skipped}, expired ${s.expired}, requeued ${s.requeued}`;
}
