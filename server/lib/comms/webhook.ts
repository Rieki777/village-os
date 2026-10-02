/**
 * DELIVERY REPORTS: proving one came from the provider, and reading what it
 * says (docs/comms/BUILD_SPEC.md 5.3 and 8.1).
 *
 * The foundation lane built the proof and the reading. Applying a report to
 * its message (delivered, bounced, complained, and the suppressions those
 * write) is the post office lane's (B1), and lands here beside them.
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
