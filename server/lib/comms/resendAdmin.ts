/**
 * SETTING UP THE PROVIDER FROM COMMS SETTINGS: the sending domain and the
 * delivery-report webhook, through Resend's own API (the comms build spec
 * 5.2 and 5.15). Rye, 2026-10-02: a founder does all of it from Admin, in
 * plain words, with no other dashboard open unless their key cannot do it.
 *
 *   listDomains     GET  /domains               to adopt a domain already added
 *   createDomain    POST /domains               { name }
 *   getDomain       GET  /domains/:id           its status and its DNS records
 *   verifyDomain    POST /domains/:id/verify    ask the provider to look again
 *   createWebhook   POST /webhooks              our address and the seven events,
 *                                               answering the signing secret
 *
 * THIS FILE NEVER SENDS AN EMAIL. Sending is ./transport.ts and nothing else;
 * this one manages the account the sending happens under. It reaches the same
 * provider the same way: `resendApiBase()` from the transport, so a test that
 * points `RESEND_API_BASE` at the fake provider reaches the fake here too, and
 * a base that is neither https nor loopback is never handed the key.
 *
 * A KEY WITHOUT THE RIGHTS IS AN ANSWER, NEVER AN ERROR. Resend lets a founder
 * make a key that can only send. That key cannot read domains or make a
 * webhook, and it is a sensible key to hold. So that refusal comes back as
 * `no_rights`, and the screen shows the same setup as steps done by hand in
 * Resend's dashboard (`manualDomainSteps`, `manualWebhookSteps`).
 *
 * A RESULT, NEVER A THROW, for the reason the transport gives.
 */
import { resendApiBase } from "./transport";

/** What the webhook is told to report (5.2). */
export const DELIVERY_REPORT_EVENTS = [
  "email.sent",
  "email.delivered",
  "email.delivery_delayed",
  "email.bounced",
  "email.complained",
  "email.failed",
  "email.suppressed",
] as const;

/** Where delivery reports arrive (server/routes/commsWebhook.ts). */
export const WEBHOOK_PATH = "/api/comms/webhooks/resend";

/** The address the provider is given for delivery reports, or "" when this server does not know its own. */
export function webhookUrl(origin: string): string {
  const o = String(origin ?? "").trim().replace(/\/+$/, "");
  return o ? `${o}${WEBHOOK_PATH}` : "";
}

export interface DnsRecord {
  /** What the record is for, as the provider names it: `SPF`, `DKIM`, `DMARC`. */
  record: string;
  type: string;
  name: string;
  value: string;
  ttl: string;
  priority: number | null;
  /** The provider's word for whether it has seen this record yet. */
  status: string;
}

export interface ProviderDomain {
  id: string;
  name: string;
  status: string;
  records: DnsRecord[];
}

export type AdminRefusal =
  /** No provider key is set. */
  | "no_key"
  /** The provider did not accept the key at all. */
  | "bad_key"
  /** The key is real and may not do this (a sending-only key). */
  | "no_rights"
  | "not_found"
  /** The provider read the request and said no; `error` carries its words. */
  | "refused"
  /** Busy or failing on the provider's side; trying again later may work. */
  | "unavailable"
  /** The provider could not be reached at all. */
  | "unreachable";

export type AdminAnswer<T> = { ok: true; value: T } | { ok: false; refusal: AdminRefusal; status?: number; error: string };

export interface ResendAdminOptions {
  /** The provider key, read at each call so a key saved a moment ago is used. */
  apiKey: () => string;
  /** Where Resend lives. Defaults to `resendApiBase()`, read at each call. */
  baseUrl?: () => string;
  timeoutMs?: number;
  /** For tests that want to answer the call themselves. Defaults to the global fetch. */
  fetchImpl?: typeof fetch;
}

export interface ResendAdmin {
  listDomains(): Promise<AdminAnswer<Array<{ id: string; name: string; status: string }>>>;
  createDomain(name: string): Promise<AdminAnswer<ProviderDomain>>;
  getDomain(id: string): Promise<AdminAnswer<ProviderDomain>>;
  verifyDomain(id: string): Promise<AdminAnswer<{ id: string }>>;
  createWebhook(endpoint: string, events: readonly string[]): Promise<AdminAnswer<{ id: string; signingSecret: string }>>;
}

const clip = (v: unknown, max: number): string => (v == null ? "" : String(v)).slice(0, max);

function readRecord(r: any): DnsRecord {
  const priority = Number(r?.priority);
  return {
    record: clip(r?.record, 32),
    type: clip(r?.type, 16),
    name: clip(r?.name, 253),
    value: clip(r?.value, 2048),
    ttl: clip(r?.ttl, 16),
    priority: Number.isFinite(priority) && r?.priority != null ? priority : null,
    status: clip(r?.status, 32),
  };
}

function readDomain(d: any): ProviderDomain | null {
  if (!d || typeof d !== "object" || typeof d.id !== "string" || !d.id) return null;
  return {
    id: clip(d.id, 128),
    name: clip(d.name, 253).toLowerCase(),
    status: clip(d.status, 32) || "unknown",
    records: Array.isArray(d.records) ? d.records.slice(0, 20).map(readRecord) : [],
  };
}

/** The provider's own words for a refusal, and which kind of refusal it is. */
function classify(status: number, body: string): { refusal: AdminRefusal; error: string } {
  let name = "";
  let said = body;
  try {
    const parsed = JSON.parse(body);
    name = String(parsed?.name ?? "");
    said = String(parsed?.message ?? parsed?.error ?? name ?? body);
  } catch {
    /* the body was not JSON; keep it as text */
  }
  const words = `Resend answered ${status}${said ? `: ${said}` : ""}`.slice(0, 500);
  if (status === 401 || status === 403) {
    const restricted = name === "restricted_api_key" || /restrict|permission|not allowed|only send/i.test(said);
    return { refusal: restricted ? "no_rights" : "bad_key", error: words };
  }
  if (status === 404) return { refusal: "not_found", error: words };
  if (status === 429 || status >= 500) return { refusal: "unavailable", error: words };
  return { refusal: "refused", error: words };
}

/** The Resend account-management client. */
export function resendAdmin(opts: ResendAdminOptions): ResendAdmin {
  const timeoutMs = opts.timeoutMs ?? 10_000;

  async function call<T>(method: "GET" | "POST", path: string, body: unknown, read: (json: any) => T | null): Promise<AdminAnswer<T>> {
    const key = opts.apiKey();
    if (!key) return { ok: false, refusal: "no_key", error: "No Resend key is set yet." };
    const url = `${(opts.baseUrl ?? resendApiBase)()}${path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const init: RequestInit = {
        method,
        headers: { Authorization: `Bearer ${key}`, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: controller.signal,
      };
      const res = opts.fetchImpl
        ? await opts.fetchImpl(url, init)
        : await fetch(url, init); // module-review-ok: the provider's account API, through the transport's own base (https, or loopback for the test provider that guardedFetchJson's pinned-IP refusal would shut out)
      const text = await res.text();
      if (!res.ok) return { ok: false, status: res.status, ...classify(res.status, text) };
      let json: unknown = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        return { ok: false, status: res.status, refusal: "refused", error: "Resend answered with something that is not JSON." };
      }
      const value = read(json);
      if (value === null) return { ok: false, status: res.status, refusal: "refused", error: "Resend answered without what was asked for." };
      return { ok: true, value };
    } catch (err) {
      return {
        ok: false,
        refusal: "unreachable",
        error: controller.signal.aborted
          ? `Resend did not answer within ${Math.round(timeoutMs / 1000)} seconds.`
          : `Resend could not be reached: ${String((err as Error)?.message ?? err).slice(0, 300)}`,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    listDomains: () =>
      call("GET", "/domains", undefined, (json) => {
        const data = Array.isArray(json?.data) ? json.data : Array.isArray(json) ? json : null;
        if (!data) return null;
        return data
          .filter((d: any) => d && typeof d.id === "string")
          .map((d: any) => ({ id: clip(d.id, 128), name: clip(d.name, 253).toLowerCase(), status: clip(d.status, 32) || "unknown" }));
      }),
    createDomain: (name) => call("POST", "/domains", { name }, readDomain),
    getDomain: (id) => call("GET", `/domains/${encodeURIComponent(id)}`, undefined, readDomain),
    verifyDomain: (id) =>
      call("POST", `/domains/${encodeURIComponent(id)}/verify`, undefined, (json) => ({ id: clip(json?.id ?? id, 128) })),
    createWebhook: (endpoint, events) =>
      call("POST", "/webhooks", { endpoint, events: [...events] }, (json) => {
        const secret = typeof json?.signing_secret === "string" ? json.signing_secret.trim() : "";
        if (!secret) return null;
        return { id: clip(json?.id, 128), signingSecret: secret };
      }),
  };
}

// ── The same setup, by hand ─────────────────────────────────────────────────

/** Adding the sending domain in Resend's dashboard, for a key that can only send. */
export function manualDomainSteps(domain: string): string[] {
  const d = String(domain ?? "").trim() || "your domain";
  return [
    `Open resend.com/domains and add ${d}.`,
    "Resend shows a few DNS records. Add each one wherever your domain's DNS is managed.",
    "Press Verify in Resend and wait until it says Verified. It can take a few minutes, sometimes a few hours.",
    "Come back here and press \"Resend says it is verified\".",
    "Or make a key with full access at resend.com/api-keys and paste it above, and this screen does all of this for you.",
  ];
}

/** Connecting delivery reports in Resend's dashboard, for a key that can only send. */
export function manualWebhookSteps(url: string, events: readonly string[] = DELIVERY_REPORT_EVENTS): string[] {
  return [
    "Open resend.com/webhooks and add an endpoint.",
    `Paste this address as the endpoint: ${url || "the address shown on this screen"}`,
    `Tick these events: ${events.join(", ")}.`,
    "Save it, copy the signing secret Resend shows (it starts with whsec_), and paste it below.",
  ];
}
