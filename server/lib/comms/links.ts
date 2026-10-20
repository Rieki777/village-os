/**
 * SIGNED LINKS for every one-click action in an email (the comms build spec
 * 5.4): unsubscribe, preferences, a guest confirming, "can't make it", a time
 * vote, a recap answer, a letters confirmation, and saying yes to the next
 * gathering.
 *
 * THE FORMAT. `base64url(json).base64url(hmac)`, where the JSON is
 * `{ p: purpose, e: expiry in epoch seconds, d: payload }` and the HMAC is
 * SHA-256 over the first segment exactly as it appears in the link. The key is
 * derived with HKDF from `VILLAGE_SECRETS_KEY`, under its own label
 * (`comms-links-v1`), so a link key can be rotated by changing the label and a
 * leaked link key says nothing about the sealed secrets that share the root.
 *
 * WITH NO SECRETS KEY (development only) a random key is made for the life of
 * the process. Links signed by one process then fail in the next, which is
 * the safe direction: an unverifiable link does nothing.
 *
 * IDS ONLY. A payload carries ids and numbers, never an address and never a
 * name: a link is forwarded, logged by mail scanners and kept in inboxes for
 * years, and a token that held an address would hand that address to every
 * one of them. `signLink` refuses any value that is not id-shaped, so the rule
 * holds by construction instead of by review.
 *
 * `verifyLink` answers null on ANY mismatch: a tampered body, a tampered
 * signature, a link signed for another purpose, an expired link, or something
 * that is not a link at all. It never throws and never says which, because a
 * reason is an oracle for somebody forging one.
 *
 * NOTHING HERE ACTS. A verified link is permission to show a page that says
 * what will happen; the act is a POST from that page (5.4), because link
 * scanners GET every link in an email.
 */
import crypto from "node:crypto";
import { LINK_PURPOSES, type LinkPurpose } from "../../../shared/comms/kinds";
import { keyFromEnv } from "../sealedBox";

/** The HKDF label. Changing it retires every link already sent. */
export const LINK_KEY_LABEL = "comms-links-v1";

const SECRETS_ENV = "VILLAGE_SECRETS_KEY";

/** A payload value: an id-shaped string or a finite integer. */
export type LinkValue = string | number;
export type LinkPayload = Record<string, LinkValue>;

/** What an id looks like: letters, digits and `:` `_` `.` `-`, at most 191 of them. */
const ID_SHAPE = /^[A-Za-z0-9:_.-]{1,191}$/;
const KEY_SHAPE = /^[A-Za-z][A-Za-z0-9_]{0,31}$/;

let processKey: Buffer | null = null;
let warnedNoKey = false;

/**
 * The link key for an environment. Derived, never stored, and recomputed per
 * call because HKDF costs microseconds and a cached copy is one more thing to
 * keep in step with the environment.
 */
export function linkKey(env: NodeJS.ProcessEnv = process.env): Buffer {
  const root = keyFromEnv(SECRETS_ENV, env);
  if (root) return Buffer.from(crypto.hkdfSync("sha256", root, Buffer.alloc(0), LINK_KEY_LABEL, 32));
  if (!processKey) processKey = crypto.randomBytes(32);
  if (!warnedNoKey) {
    warnedNoKey = true;
    console.warn(
      `[comms] ${SECRETS_ENV} is not set, so email links are signed with a key that lasts only as long as this process. Fine in development; set it before any real email goes out.`,
    );
  }
  return processKey;
}

const b64url = (buf: Buffer): string => buf.toString("base64url");

function sign(key: Buffer, body: string): string {
  return b64url(crypto.createHmac("sha256", key).update(body).digest());
}

/** Refuse a payload that could carry somebody's address or name. Throws: this is a caller's bug. */
function assertIdsOnly(payload: LinkPayload): void {
  for (const [k, v] of Object.entries(payload)) {
    if (!KEY_SHAPE.test(k)) throw new TypeError(`signLink: "${k}" is not a payload key`);
    if (typeof v === "number") {
      if (!Number.isSafeInteger(v)) throw new TypeError(`signLink: "${k}" must be a whole number`);
      continue;
    }
    if (typeof v !== "string" || !ID_SHAPE.test(v)) {
      throw new TypeError(`signLink: "${k}" is not an id. A signed link carries ids only, never an address or a name.`);
    }
  }
}

/**
 * Sign a link for one purpose, valid for `ttlDays` days.
 *
 * `now` (epoch milliseconds) and `key` are for tests; production leaves both
 * out and gets the clock and the derived key.
 */
export function signLink(
  purpose: LinkPurpose,
  payload: LinkPayload,
  ttlDays: number,
  opts: { now?: number; key?: Buffer } = {},
): string {
  if (!(LINK_PURPOSES as readonly string[]).includes(purpose)) throw new TypeError(`signLink: unknown purpose "${purpose}"`);
  if (!(ttlDays > 0) || !Number.isFinite(ttlDays)) throw new RangeError("signLink: a link must live for some time");
  assertIdsOnly(payload);
  const nowSeconds = Math.floor((opts.now ?? Date.now()) / 1000);
  const body = b64url(Buffer.from(JSON.stringify({ p: purpose, e: nowSeconds + Math.round(ttlDays * 86_400), d: payload })));
  return `${body}.${sign(opts.key ?? linkKey(), body)}`;
}

/**
 * The payload of a link signed for this purpose, or null.
 *
 * The signature is checked before the body is parsed, and checked in constant
 * time, so a forged body never reaches JSON.parse and a near-miss signature
 * takes as long to refuse as a wild one.
 */
export function verifyLink(
  purpose: LinkPurpose,
  token: string,
  opts: { now?: number; key?: Buffer } = {},
): LinkPayload | null {
  try {
    if (typeof token !== "string" || token.length > 4096) return null;
    const parts = token.split(".");
    if (parts.length !== 2) return null;
    const [body, given] = parts;
    if (!body || !given) return null;
    const expected = Buffer.from(sign(opts.key ?? linkKey(), body));
    const offered = Buffer.from(given);
    if (expected.length !== offered.length || !crypto.timingSafeEqual(expected, offered)) return null;

    const parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (!parsed || typeof parsed !== "object") return null;
    if (parsed.p !== purpose) return null;
    if (typeof parsed.e !== "number" || !Number.isFinite(parsed.e)) return null;
    const nowSeconds = Math.floor((opts.now ?? Date.now()) / 1000);
    if (parsed.e <= nowSeconds) return null;
    const d = parsed.d;
    if (!d || typeof d !== "object" || Array.isArray(d)) return null;
    // The signature already vouches for the body; this keeps a payload that
    // was signed under an older, looser rule from reaching a caller.
    assertIdsOnly(d as LinkPayload);
    return d as LinkPayload;
  } catch {
    return null;
  }
}
