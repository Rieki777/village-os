/**
 * DELIVERY REPORTS: proving one came from the provider, reading what it says,
 * and applying it to the email it is about (the comms build spec 5.3 and 8.1).
 *
 * ── APPLYING A REPORT ──────────────────────────────────────────────────────
 *
 * The route stores each report once, by its Svix id, and then applies it from
 * the stored row (`processStoredReport`). A report is applied ONCE: a stored
 * report already processed is left alone when the provider delivers it again,
 * and one stored but never processed (the server died between the two, or the
 * apply failed and the route answered 500) is applied when it comes back.
 *
 * WHICH ROW: the provider's id for the email first, then our own row id from
 * the `msg` tag every send carries, and nothing else. A report that matches
 * neither is recorded as unmatched and changes nothing. A guess is how a
 * bounce would suppress the wrong person.
 *
 * WHAT EACH REPORT DOES:
 *
 *   email.sent              the row is `sent` (correcting one a crash left
 *                           `sending`, or an essential row marked failed by
 *                           the drain's stale sweep).
 *   email.delivered         `delivered`.
 *   email.delivery_delayed  a note on the row; nothing moves.
 *   email.bounced           `bounced`. A permanent bounce, or one whose type
 *                           the provider could not tell, suppresses the
 *                           address. A temporary one does not.
 *   email.complained        `complained`, and the address is suppressed.
 *   email.failed            `failed`, in the provider's words.
 *   email.suppressed        the provider held the address on its own list:
 *                           `failed`, and the address is suppressed as bounced.
 *
 * A STATUS ONLY MOVES FORWARD. Each report moves a row only from the statuses
 * it may follow, so a `delivered` arriving after a `complained` never undoes
 * it, whatever order the provider sends them in.
 *
 * A REHEARSED ROW IS NOTED AND NEVER MOVED. It went to the rehearsal inbox, so
 * a bounce or a complaint about it is about an admin's address and says
 * nothing about the person the row names, who is never suppressed for it.
 *
 * THE PROOF IS SVIX'S, because that is what Resend signs with:
 *
 *   svix-id          the delivery's own id. It is also the dedupe key: the
 *                    provider retries until it hears a 2xx, and a retried
 *                    delivery carries the same id.
 *   svix-timestamp   epoch seconds. A delivery older or newer than five
 *                    minutes is refused, so a captured one cannot be replayed
 *                    later.
 *   svix-signature   one or more `v1,<base64>` separated by spaces, each an
 *                    HMAC-SHA256 of `id.timestamp.body` under the key that is
 *                    the base64 after `whsec_` in the signing secret. One
 *                    match is enough, because the provider signs with the old
 *                    and the new secret while a secret is being rotated.
 *
 * The body is hashed exactly as it arrived. A parsed and re-serialised body
 * is not the bytes that were signed, which is why the route that calls this
 * is mounted before `express.json()` (server/routes/commsWebhook.ts).
 */
import crypto from "node:crypto";
import type { Pool } from "mysql2/promise";
import type { MessageStatus } from "../../../shared/comms/kinds";
import {
  applyReportStatus,
  markProviderEventProcessed,
  providerEventById,
  reportTarget,
  stampReport,
  type ReportStamp,
} from "../../repos/commsMessages";
import { addSuppression } from "./suppressions";

/** How far a delivery's timestamp may sit from this server's clock. */
export const SVIX_TOLERANCE_SECONDS = 5 * 60;

export type SvixVerdict =
  | { ok: true; id: string }
  | { ok: false; reason: "no_secret" | "missing_headers" | "stale" | "bad_signature" };

/**
 * Is this delivery the provider's? Answers which way it failed for the log,
 * and the route answers every failure the same to the caller.
 */
export function verifySvix(input: {
  secret: string;
  id: string | undefined;
  timestamp: string | undefined;
  signature: string | undefined;
  body: Buffer;
  /** Epoch seconds; tests only. */
  now?: number;
}): SvixVerdict {
  const secret = String(input.secret ?? "").trim();
  if (!secret) return { ok: false, reason: "no_secret" };
  const id = String(input.id ?? "").trim();
  const timestamp = String(input.timestamp ?? "").trim();
  const signature = String(input.signature ?? "").trim();
  if (!id || !timestamp || !signature) return { ok: false, reason: "missing_headers" };
  if (!/^\d{1,12}$/.test(timestamp)) return { ok: false, reason: "stale" };
  const now = input.now ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - Number(timestamp)) > SVIX_TOLERANCE_SECONDS) return { ok: false, reason: "stale" };

  const key = Buffer.from(secret.startsWith("whsec_") ? secret.slice("whsec_".length) : secret, "base64");
  if (!key.length) return { ok: false, reason: "no_secret" };
  const expected = Buffer.from(
    crypto
      .createHmac("sha256", key)
      .update(Buffer.concat([Buffer.from(`${id}.${timestamp}.`, "utf8"), input.body]))
      .digest("base64"),
  );
  for (const part of signature.split(" ")) {
    const [version, value] = part.split(",", 2);
    if (version !== "v1" || !value) continue;
    const offered = Buffer.from(value);
    // Lengths first: timingSafeEqual throws on unequal BYTE lengths, and a
    // throw out of an unauthenticated route is a 500 where a 401 belongs.
    if (offered.length === expected.length && crypto.timingSafeEqual(offered, expected)) return { ok: true, id };
  }
  return { ok: false, reason: "bad_signature" };
}

export interface DeliveryReport {
  /** `email.delivered`, `email.bounced` and the rest, as the provider names them. */
  type: string;
  /** The provider's id for the email. */
  providerMessageId: string | null;
  /** Our ledger row's id, from the `msg` tag every send carries, when it came back. */
  messageId: string | null;
}

/**
 * What a verified report is about. Tags come back as an object in a delivery
 * report and went out as a list, so both shapes are read.
 */
export function readDeliveryReport(payload: unknown): DeliveryReport | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as Record<string, any>;
  const type = typeof p.type === "string" ? p.type.slice(0, 64) : "";
  if (!type) return null;
  const data = p.data && typeof p.data === "object" ? p.data : {};
  const providerMessageId = typeof data.email_id === "string" && data.email_id ? String(data.email_id).slice(0, 128) : null;
  let messageId: string | null = null;
  const tags = data.tags;
  if (Array.isArray(tags)) {
    const msg = tags.find((t: any) => t?.name === "msg");
    if (typeof msg?.value === "string") messageId = msg.value;
  } else if (tags && typeof tags === "object" && typeof tags.msg === "string") {
    messageId = tags.msg;
  }
  if (messageId && !/^[A-Za-z0-9_-]{1,64}$/.test(messageId)) messageId = null;
  return { type, providerMessageId, messageId };
}

// ── Applying a report ───────────────────────────────────────────────────────

/** What applying one report did, in a word or two, for `comms_provider_events.outcome`. */
export interface ReportOutcome {
  outcome: string;
  /** Our row it was about, or null when it matched none. */
  messageId: string | null;
}

/** The statuses each report may move a row FROM. A status only moves forward. */
const MAY_FOLLOW: Record<"sent" | "delivered" | "bounced" | "complained" | "failed", readonly MessageStatus[]> = {
  // `failed` included: the provider saying it sent the email outranks a
  // send the drain had to give up on without hearing the answer.
  sent: ["queued", "sending", "failed"],
  delivered: ["queued", "sending", "sent", "failed"],
  bounced: ["queued", "sending", "sent", "delivered", "failed"],
  complained: ["queued", "sending", "sent", "delivered", "bounced", "failed"],
  failed: ["queued", "sending", "sent"],
};

const text = (v: unknown): string => (typeof v === "string" ? v.trim().slice(0, 300) : "");

/**
 * Apply one verified report to the row it names, and write the suppression it
 * calls for. Safe to run twice: every status move is conditional and a
 * suppression of an already suppressed address keeps the stronger reason.
 */
export async function applyDeliveryReport(
  pool: Pool,
  report: DeliveryReport & { payload: unknown },
): Promise<ReportOutcome> {
  const target = await reportTarget(pool, { providerMessageId: report.providerMessageId, messageId: report.messageId });
  if (!target) return { outcome: "unmatched", messageId: null };
  const data = (report.payload as { data?: Record<string, any> } | null)?.data ?? {};
  const id = target.id;
  const providerMessageId = report.providerMessageId;
  const move = (status: keyof typeof MAY_FOLLOW, stamp: ReportStamp | null, lastError: string | null) =>
    applyReportStatus(pool, id, { status, from: MAY_FOLLOW[status], stamp, lastError, providerMessageId });
  const note = (stamp: ReportStamp | null, lastError: string | null) => stampReport(pool, id, { stamp, lastError, providerMessageId });
  const rehearsal = target.status === "rehearsed";
  /** A report about a rehearsal: noted on the row, and nothing else. */
  const rehearsed = async (stamp: ReportStamp | null, why: string | null): Promise<ReportOutcome> => {
    await note(stamp, why);
    return { outcome: "noted_rehearsal", messageId: id };
  };
  const suppress = (reason: "bounced" | "complained", detail: string) =>
    addSuppression(pool, { emailKey: target.emailKey, reason, detail, createdBy: "provider" });

  switch (report.type) {
    case "email.sent": {
      if (rehearsal) return rehearsed("sent_at", null);
      return { outcome: (await move("sent", "sent_at", null)) ? "sent" : "unchanged", messageId: id };
    }
    case "email.delivered": {
      if (rehearsal) return rehearsed("delivered_at", null);
      return { outcome: (await move("delivered", "delivered_at", null)) ? "delivered" : "unchanged", messageId: id };
    }
    case "email.delivery_delayed": {
      await note(null, "The provider reported that delivery is delayed, and it is still trying.");
      return { outcome: "delayed", messageId: id };
    }
    case "email.bounced": {
      const bounce = data.bounce && typeof data.bounce === "object" ? data.bounce : {};
      // Permanent, or a type the provider could not tell: the address is
      // treated as dead. Only a bounce it calls temporary leaves it open.
      const temporary = /^(transient|temporary|soft)$/i.test(text(bounce.type));
      const said = text(bounce.message);
      const why = `The provider reported a ${temporary ? "temporary" : "permanent"} bounce${said ? `: ${said}` : "."}`;
      if (rehearsal) return rehearsed("bounced_at", why);
      await move("bounced", "bounced_at", why);
      if (temporary) return { outcome: "bounced_temporary", messageId: id };
      await suppress("bounced", why);
      return { outcome: "bounced_suppressed", messageId: id };
    }
    case "email.complained": {
      const why = "The person marked this email as spam.";
      if (rehearsal) return rehearsed("complained_at", why);
      await move("complained", "complained_at", why);
      await suppress("complained", why);
      return { outcome: "complained_suppressed", messageId: id };
    }
    case "email.failed": {
      const said = text(data.failed?.reason ?? data.reason);
      const why = `The provider could not send this email${said ? `: ${said}` : "."}`;
      if (rehearsal) return rehearsed(null, why);
      return { outcome: (await move("failed", null, why)) ? "failed" : "unchanged", messageId: id };
    }
    case "email.suppressed": {
      const why = "The provider holds this address on its own suppression list, so it did not send to it.";
      if (rehearsal) return rehearsed(null, why);
      await move("failed", null, why);
      await suppress("bounced", why);
      return { outcome: "suppressed", messageId: id };
    }
    default:
      // Opens and clicks are not tracked (5.12), and anything else the
      // provider adds later changes nothing until somebody decides it should.
      return { outcome: "ignored", messageId: id };
  }
}

/**
 * Apply one STORED report, once. Answers whether this call applied it, and
 * the outcome either way. A report already processed is left alone; one that
 * was stored and never processed is applied now. A throw here is the route's
 * cue to answer 500, so the provider delivers it again and this runs again.
 */
export async function processStoredReport(pool: Pool, svixId: string): Promise<{ applied: boolean; outcome: string | null }> {
  const event = await providerEventById(pool, svixId);
  if (!event) return { applied: false, outcome: null };
  if (event.processedAt != null) return { applied: false, outcome: event.outcome };
  const report = readDeliveryReport(event.payload);
  const result = report ? await applyDeliveryReport(pool, { ...report, payload: event.payload }) : { outcome: "unreadable", messageId: null };
  await markProviderEventProcessed(pool, svixId, { messageId: result.messageId, outcome: result.outcome });
  return { applied: true, outcome: result.outcome };
}
