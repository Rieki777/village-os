/**
 * THE ONE DOOR OUT: the email provider, over HTTPS, per
 * the comms build spec 5.2.
 *
 * Every email the village sends leaves through `send` here and through no
 * other call. The post office decides WHETHER and WHEN; this file only knows
 * HOW to hand one message to Resend and how to read the answer.
 *
 * A RESULT, NEVER A THROW. A provider outage, a refused key, a timeout and a
 * malformed answer all come back as `{ ok: false }` with whether a retry could
 * help, because the caller is the post office writing a ledger row and a
 * throw would leave that row saying nothing about what happened.
 *
 *   retryable  a network failure, a timeout, a 429 or a 5xx. The same message
 *              may succeed later, and the Idempotency-Key below makes trying
 *              again safe.
 *   not        any other 4xx. The provider read the message and refused it,
 *              and sending it again would be refused again.
 *
 * EVERY SEND CARRIES, per 5.2:
 *
 *   Idempotency-Key  the ledger row's id, so a send retried after a crash is
 *                    one delivery and never two.
 *   tags             `msg` (the row id) and `kind`, which come back on every
 *                    delivery report and tie it to its row.
 *   List-Unsubscribe and List-Unsubscribe-Post, for every kind but essential:
 *                    the one-click link (RFC 8058) and a mailto fallback.
 *
 * THE ENDPOINT. `RESEND_API_BASE` when it is set (tests point it at the fake
 * provider in server/testkit/fakeResend.ts), the real API otherwise. A base
 * that is not https is honoured only on loopback, so a mistyped value can
 * never send the village's key across a network in the clear.
 *
 * THE ONE DOOR IS FOR SENDING. `scripts/check-one-mail-door.mjs` fails any
 * other file that sends an email through the provider. Setting up a sending
 * domain and connecting delivery reports also talk to the provider (the comms
 * build spec 5.2, server/lib/comms/resendAdmin.ts), and they are not sends:
 * `resendApi` below offers them the same base, timeout and reading of a
 * refusal that a send gets, and refuses the send path itself.
 *
 * NO BATCH SENDS, on purpose, though the provider offers one. A batch carries
 * one Idempotency-Key for up to a hundred emails, and the row id riding as
 * each email's own key is what makes a send retried after a crash one
 * delivery and never two. The post office sends one row per call and paces
 * the calls instead (`comms.send_rate_per_second`).
 */
import type { EmailKind } from "../../../shared/comms/kinds";

export interface TransportMessage {
  /** The ledger row's id: the Idempotency-Key and the `msg` tag. */
  id: string;
  kind: EmailKind;
  /** `addr@dom.tld` or `Name <addr@dom.tld>`. */
  from: string;
  /**
   * One address: the ledger is per person. A list only while the village
   * rehearses, when one row goes to every address in the rehearsal inbox.
   */
  to: string | string[];
  subject: string;
  html: string;
  /** The plain-text part. Empty sends none. */
  text?: string | null;
  replyTo?: string | null;
  attachments?: Array<{ filename: string; contentType: string; contentBase64: string }>;
  /** Every kind but essential carries these. */
  listUnsubscribe?: { url: string; mailto: string | null } | null;
}

export type TransportResult =
  | { ok: true; providerId: string }
  | { ok: false; retryable: boolean; status?: number; error: string };

export interface Transport {
  name: string;
  send(m: TransportMessage): Promise<TransportResult>;
}

export const RESEND_DEFAULT_BASE = "https://api.resend.com";

/** Ten seconds, the most a person waits on a send made inside their own request. */
export const DEFAULT_SEND_TIMEOUT_MS = 10_000;

const LOOPBACK_HTTP = /^http:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?(\/\S*)?$/;

let warnedAboutBase = "";

/**
 * Where Resend lives for this process. `RESEND_API_BASE` wins when it is an
 * https address or a loopback one, and is ignored, loudly and once, otherwise.
 */
export function resendApiBase(env: NodeJS.ProcessEnv = process.env): string {
  const raw = String(env.RESEND_API_BASE ?? "").trim().replace(/\/+$/, "");
  if (!raw) return RESEND_DEFAULT_BASE;
  if (/^https:\/\/\S+$/.test(raw) || LOOPBACK_HTTP.test(raw)) return raw;
  if (warnedAboutBase !== raw) {
    warnedAboutBase = raw;
    console.error(`[comms] RESEND_API_BASE "${raw}" is neither https nor loopback, so it is ignored and the real provider is used`);
  }
  return RESEND_DEFAULT_BASE;
}

/** A tag value Resend accepts: ASCII letters, digits, underscores and dashes. */
const tagValue = (v: string): string => v.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 256);

/**
 * The JSON body one message becomes. Pure, so what is sent can be read
 * without a network.
 */
export function resendPayload(m: TransportMessage): Record<string, unknown> {
  const headers: Record<string, string> = {};
  if (m.kind !== "essential" && m.listUnsubscribe?.url) {
    const parts = [`<${m.listUnsubscribe.url}>`];
    if (m.listUnsubscribe.mailto) parts.push(`<mailto:${m.listUnsubscribe.mailto}?subject=unsubscribe>`);
    headers["List-Unsubscribe"] = parts.join(", ");
    headers["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click";
  }
  return {
    from: m.from,
    to: Array.isArray(m.to) ? m.to.slice() : [m.to],
    subject: m.subject,
    html: m.html,
    ...(m.text ? { text: m.text } : {}),
    ...(m.replyTo ? { reply_to: m.replyTo } : {}),
    ...(m.attachments?.length
      ? {
          attachments: m.attachments.map((a) => ({
            filename: a.filename,
            content: a.contentBase64,
            content_type: a.contentType,
          })),
        }
      : {}),
    ...(Object.keys(headers).length ? { headers } : {}),
    tags: [
      { name: "msg", value: tagValue(m.id) },
      { name: "kind", value: tagValue(m.kind) },
    ],
  };
}

/** The provider's own words for a refusal, short enough for `last_error`. */
function refusalText(status: number, body: string): string {
  let said = body;
  try {
    const parsed = JSON.parse(body);
    said = String(parsed?.message ?? parsed?.error ?? parsed?.name ?? body);
  } catch {
    /* the body was not JSON; keep it as text */
  }
  return `Resend answered ${status}${said ? `: ${said}` : ""}`.slice(0, 500);
}

export interface ResendTransportOptions {
  /** The provider key, read at each send so a key typed in Admin applies at once. */
  apiKey: () => string;
  /** Where Resend lives. Defaults to `resendApiBase()`, read at each send. */
  baseUrl?: () => string;
  timeoutMs?: number;
  /** For tests that want to watch the call. Defaults to the global fetch. */
  fetchImpl?: typeof fetch;
}

/** What one HTTP call to the provider came back with. Never a throw. */
type ProviderAnswer =
  | { ok: true; status: number; body: string }
  | { ok: false; retryable: boolean; status?: number; body: string; error: string };

/**
 * ONE CALL TO THE PROVIDER, and the only `fetch` in the platform that reaches
 * it. Both the send below and `resendApi` come through here, so the base, the
 * timeout and the reading of a refusal are written once.
 */
async function callResend(input: {
  method: string;
  path: string;
  key: string;
  base: string;
  body?: unknown;
  headers?: Record<string, string>;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
}): Promise<ProviderAnswer> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), input.timeoutMs);
  try {
    const url = `${input.base}${input.path}`;
    const init: RequestInit = {
      method: input.method,
      headers: {
        Authorization: `Bearer ${input.key}`,
        ...(input.body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(input.headers ?? {}),
      },
      ...(input.body === undefined ? {} : { body: JSON.stringify(input.body) }),
      signal: controller.signal,
    };
    const res = input.fetchImpl
      ? await input.fetchImpl(url, init)
      : await fetch(url, init); // module-review-ok: the one mail door; the base is https or loopback only, and loopback is the test provider that guardedFetchJson's pinned-IP refusal would shut out
    const body = await res.text();
    if (res.ok) return { ok: true, status: res.status, body };
    const retryable = res.status === 429 || res.status >= 500;
    return { ok: false, retryable, status: res.status, body, error: refusalText(res.status, body) };
  } catch (err) {
    const aborted = controller.signal.aborted;
    return {
      ok: false,
      retryable: true,
      body: "",
      error: aborted
        ? `Resend did not answer within ${Math.round(input.timeoutMs / 1000)} seconds`
        : `Resend could not be reached: ${String((err as Error)?.message ?? err).slice(0, 300)}`,
    };
  } finally {
    clearTimeout(timer);
  }
}

/** The Resend transport. */
export function resendTransport(opts: ResendTransportOptions): Transport {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_SEND_TIMEOUT_MS;
  return {
    name: "resend",
    async send(m: TransportMessage): Promise<TransportResult> {
      const key = opts.apiKey();
      if (!key) return { ok: false, retryable: false, error: "no_api_key" };
      const answer = await callResend({
        method: "POST",
        path: "/emails",
        key,
        base: (opts.baseUrl ?? resendApiBase)(),
        body: resendPayload(m),
        headers: { "Idempotency-Key": m.id },
        timeoutMs,
        fetchImpl: opts.fetchImpl,
      });
      if (!answer.ok) {
        return { ok: false, retryable: answer.retryable, ...(answer.status ? { status: answer.status } : {}), error: answer.error };
      }
      let providerId = "";
      try {
        providerId = String(JSON.parse(answer.body)?.id ?? "");
      } catch {
        /* an accepted send with an unreadable body still went */
      }
      // Accepted with no id is still accepted. The row records it, and the
      // delivery report finds it by the `msg` tag instead of the id.
      return { ok: true, providerId };
    },
  };
}

// ── The provider's other endpoints ──────────────────────────────────────────

export interface ResendApiRequest {
  method: "GET" | "POST" | "PATCH" | "DELETE";
  /** `/domains`, `/domains/<id>/verify`, `/webhooks` and the like. Never `/emails`. */
  path: string;
  /** The village's key. Pass it in; this function reads no store. */
  apiKey: string;
  body?: unknown;
  timeoutMs?: number;
  /** Defaults to `resendApiBase()`. */
  baseUrl?: string;
  /** For tests that want to watch the call. Defaults to the global fetch. */
  fetchImpl?: typeof fetch;
}

export type ResendApiResult =
  | { ok: true; status: number; json: any }
  | { ok: false; retryable: boolean; status?: number; error: string; json: any };

/**
 * Any provider endpoint that is not a send: the sending domain, its DNS
 * records and their verification, and the delivery-report webhook (5.2). The
 * comms setup lane reaches the provider through this and through nothing else.
 *
 * SENDING IS REFUSED HERE, by path. An email goes out through the post office,
 * which writes its row first; a send through this function would be a second
 * door with no ledger behind it.
 *
 * A result, never a throw, the same as a send: `json` is the provider's
 * answer parsed, or null when it was not JSON, on success and on refusal
 * alike, because a refusal's body is where the provider says what to fix.
 */
export async function resendApi(req: ResendApiRequest): Promise<ResendApiResult> {
  const path = `/${String(req.path ?? "").replace(/^\/+/, "")}`;
  if (/^\/emails(\/|$|\?)/.test(path)) {
    return { ok: false, retryable: false, error: "Emails are sent through the post office, never through resendApi.", json: null };
  }
  if (!req.apiKey) return { ok: false, retryable: false, error: "no_api_key", json: null };
  const answer = await callResend({
    method: req.method,
    path,
    key: req.apiKey,
    base: (req.baseUrl ?? resendApiBase()).replace(/\/+$/, ""),
    body: req.body,
    timeoutMs: req.timeoutMs ?? DEFAULT_SEND_TIMEOUT_MS,
    fetchImpl: req.fetchImpl,
  });
  let json: any = null;
  try {
    json = answer.body ? JSON.parse(answer.body) : null;
  } catch {
    /* not JSON; `json` stays null and a refusal still carries its words in `error` */
  }
  return answer.ok
    ? { ok: true, status: answer.status, json }
    : { ok: false, retryable: answer.retryable, ...(answer.status ? { status: answer.status } : {}), error: answer.error, json };
}
