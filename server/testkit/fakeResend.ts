/**
 * A FAKE RESEND, for tests and for nothing else (the comms build spec 8.1).
 *
 * Rule 13 of the build: never send a real email. Every suite that exercises
 * the post office points `RESEND_API_BASE` at one of these, and nothing in
 * this build calls the real provider from a test, a script or a probe.
 *
 * WHAT IT DOES:
 *
 *   - Answers `POST /emails`, `POST /emails/batch`, `GET /domains`,
 *     `POST /domains`, `GET /domains/:id`, `POST /domains/:id/verify` and
 *     `POST /webhooks` the way the real API does, closely enough for the post
 *     office, the setup screen and the webhook connector to be driven end to
 *     end.
 *   - Records every request it receives, headers and parsed body included.
 *   - Can be told to answer 429, 500 or 422 for the next N calls to `/emails`.
 *   - Answers a domain as `verified` or `pending`, as it is told.
 *   - Honours `Idempotency-Key`: a second send under a key it has already
 *     accepted answers the first id and records no second email, which is the
 *     real provider's promise the post office leans on.
 *   - Delivers signed webhooks in the Svix format the real provider uses
 *     (`svix-id`, `svix-timestamp`, `svix-signature: v1,<base64 hmac>` over
 *     `id.timestamp.body`, keyed by the base64 after `whsec_`) for the four
 *     reports that matter: delivered, bounced (permanent), complained, failed.
 *
 * NEVER IMPORTED BY SERVER CODE. Only tests import this file, so the bundle
 * esbuild builds from server/index.ts never reaches it. The foundation e2e
 * suite checks that by reading dist/index.js.
 */
import crypto from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";

export interface RecordedRequest {
  method: string;
  path: string;
  headers: http.IncomingHttpHeaders;
  /** The parsed JSON body, or the raw text when it was not JSON. */
  body: any;
  at: number;
}

export interface FakeDomain {
  id: string;
  name: string;
  status: "verified" | "pending";
  region: string;
  created_at: string;
  records: Array<{ record: string; name: string; type: string; value: string; ttl: string; status: string; priority?: number }>;
}

export type FakeReport = "delivered" | "bounced" | "complained" | "failed";

export interface FakeResend {
  /** The base URL to set as RESEND_API_BASE. */
  url: string;
  port: number;
  /** Every request, oldest first. */
  requests: RecordedRequest[];
  /** Every email accepted, one per recipient copy, oldest first. */
  emails(): Array<{ id: string; idempotencyKey: string | null; body: any }>;
  /** Answer the next `times` calls to /emails with this status. */
  failNext(status: 429 | 500 | 422, times?: number): void;
  /** How the next domain created or checked answers. */
  setDomainStatus(status: "verified" | "pending"): void;
  /** The signing secret the last `POST /webhooks` handed out, or the one set here. */
  webhookSecret(): string;
  /** Deliver one signed delivery report to `url`, as the real provider would. */
  deliverWebhook(
    url: string,
    report: FakeReport,
    input: { emailId: string; to?: string; secret?: string; svixId?: string },
  ): Promise<{ status: number; body: string; svixId: string }>;
  close(): Promise<void>;
}

/** A Svix secret in the shape the real provider issues: `whsec_` and a base64 key. */
export function makeWebhookSecret(): string {
  return `whsec_${crypto.randomBytes(24).toString("base64")}`;
}

/**
 * The three Svix headers for one body. Exported so a test can sign a body of
 * its own, or sign one wrongly on purpose.
 */
export function signSvix(
  secret: string,
  body: string,
  opts: { id?: string; timestamp?: number } = {},
): { "svix-id": string; "svix-timestamp": string; "svix-signature": string } {
  const id = opts.id ?? `msg_${crypto.randomBytes(12).toString("hex")}`;
  const timestamp = opts.timestamp ?? Math.floor(Date.now() / 1000);
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const signature = crypto.createHmac("sha256", key).update(`${id}.${timestamp}.${body}`).digest("base64");
  return { "svix-id": id, "svix-timestamp": String(timestamp), "svix-signature": `v1,${signature}` };
}

const json = (res: http.ServerResponse, status: number, body: unknown): void => {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
};

const refusal = (res: http.ServerResponse, status: number, name: string, message: string): void =>
  json(res, status, { statusCode: status, name, message });

function domainRecords(name: string): FakeDomain["records"] {
  return [
    { record: "SPF", name: `send.${name}`, type: "MX", value: "feedback-smtp.example.test", ttl: "Auto", status: "not_started", priority: 10 },
    { record: "SPF", name: `send.${name}`, type: "TXT", value: "v=spf1 include:example.test ~all", ttl: "Auto", status: "not_started" },
    { record: "DKIM", name: `resend._domainkey.${name}`, type: "TXT", value: "p=MIGfMA0GCSqGSIb3DQEB", ttl: "Auto", status: "not_started" },
  ];
}

/** Start a fake on a free loopback port. */
export async function startFakeResend(opts: { apiKey?: string; port?: number } = {}): Promise<FakeResend> {
  const requests: RecordedRequest[] = [];
  const accepted: Array<{ id: string; idempotencyKey: string | null; body: any }> = [];
  const byIdempotencyKey = new Map<string, string>();
  const domains = new Map<string, FakeDomain>();
  const failures: Array<429 | 500 | 422> = [];
  let domainStatus: "verified" | "pending" = "verified";
  let secret = makeWebhookSecret();
  let sequence = 0;

  const authorised = (req: http.IncomingMessage): boolean => {
    const header = String(req.headers.authorization ?? "");
    if (!header.startsWith("Bearer ") || header.length <= "Bearer ".length) return false;
    return opts.apiKey ? header === `Bearer ${opts.apiKey}` : true;
  };

  const acceptOne = (body: any, idempotencyKey: string | null): string => {
    const id = `fake_${(++sequence).toString().padStart(6, "0")}`;
    accepted.push({ id, idempotencyKey, body });
    return id;
  };

  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      let body: any = raw;
      try {
        body = raw ? JSON.parse(raw) : null;
      } catch {
        /* keep the raw text */
      }
      const url = new URL(req.url ?? "/", "http://fake.invalid");
      const path = url.pathname.replace(/\/+$/, "") || "/";
      const method = String(req.method ?? "GET").toUpperCase();
      requests.push({ method, path, headers: req.headers, body, at: Date.now() });

      if (!authorised(req)) return refusal(res, 401, "missing_api_key", "Missing or wrong API key.");

      if (method === "POST" && (path === "/emails" || path === "/emails/batch")) {
        const injected = failures.shift();
        if (injected === 429) return refusal(res, 429, "rate_limit_exceeded", "Too many requests.");
        if (injected === 500) return refusal(res, 500, "internal_server_error", "Something went wrong at the fake provider.");
        if (injected === 422) return refusal(res, 422, "validation_error", "The fake provider refused this email.");
        if (path === "/emails/batch") {
          const list = Array.isArray(body) ? body : [];
          if (list.some((e) => Array.isArray(e?.attachments) && e.attachments.length)) {
            return refusal(res, 422, "validation_error", "Attachments are not allowed in a batch.");
          }
          return json(res, 200, { data: list.map((e) => ({ id: acceptOne(e, null) })) });
        }
        const key = req.headers["idempotency-key"] ? String(req.headers["idempotency-key"]) : null;
        if (key && byIdempotencyKey.has(key)) return json(res, 200, { id: byIdempotencyKey.get(key) });
        const id = acceptOne(body, key);
        if (key) byIdempotencyKey.set(key, id);
        return json(res, 200, { id });
      }

      if (path === "/domains" && method === "GET") {
        return json(res, 200, { object: "list", data: Array.from(domains.values()) });
      }
      if (path === "/domains" && method === "POST") {
        const name = String(body?.name ?? "").trim().toLowerCase();
        if (!name) return refusal(res, 422, "validation_error", "A domain needs a name.");
        const domain: FakeDomain = {
          id: `dom_${(++sequence).toString().padStart(6, "0")}`,
          name,
          status: domainStatus,
          region: "us-east-1",
          created_at: new Date().toISOString(),
          records: domainRecords(name),
        };
        domains.set(domain.id, domain);
        return json(res, 200, domain);
      }
      const domainMatch = path.match(/^\/domains\/([^/]+)(\/verify)?$/);
      if (domainMatch) {
        const domain = domains.get(decodeURIComponent(domainMatch[1]));
        if (!domain) return refusal(res, 404, "not_found", "No such domain.");
        if (domainMatch[2] && method === "POST") {
          domain.status = domainStatus;
          return json(res, 200, { object: "domain", id: domain.id });
        }
        if (!domainMatch[2] && method === "GET") return json(res, 200, { object: "domain", ...domain });
      }

      if (path === "/webhooks" && method === "POST") {
        secret = makeWebhookSecret();
        return json(res, 200, {
          object: "webhook",
          id: `wh_${(++sequence).toString().padStart(6, "0")}`,
          endpoint: body?.endpoint ?? null,
          events: Array.isArray(body?.events) ? body.events : [],
          signing_secret: secret,
        });
      }

      return refusal(res, 404, "not_found", "The fake provider has no such route.");
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(opts.port ?? 0, "127.0.0.1", () => resolve());
  });
  const port = (server.address() as AddressInfo).port;

  return {
    url: `http://127.0.0.1:${port}`,
    port,
    requests,
    emails: () => accepted.slice(),
    failNext(status, times = 1) {
      for (let i = 0; i < times; i++) failures.push(status);
    },
    setDomainStatus(status) {
      domainStatus = status;
    },
    webhookSecret: () => secret,
    async deliverWebhook(url, report, input) {
      const sent = accepted.find((e) => e.id === input.emailId);
      const tags = Array.isArray(sent?.body?.tags)
        ? Object.fromEntries(sent.body.tags.map((t: { name: string; value: string }) => [t.name, t.value]))
        : {};
      const now = new Date().toISOString();
      const data: Record<string, unknown> = {
        email_id: input.emailId,
        from: sent?.body?.from ?? null,
        to: input.to ? [input.to] : sent?.body?.to ?? [],
        subject: sent?.body?.subject ?? null,
        created_at: now,
        tags,
      };
      if (report === "bounced") {
        data.bounce = { type: "Permanent", subType: "General", message: "The address does not exist." };
      }
      if (report === "failed") data.failed = { reason: "The fake provider could not send this email." };
      const body = JSON.stringify({ type: `email.${report}`, created_at: now, data });
      const headers = signSvix(input.secret ?? secret, body, input.svixId ? { id: input.svixId } : {});
      const res = await fetch(url, { // module-review-ok: the test-only fake provider delivering a signed report to the local test server
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body,
      });
      return { status: res.status, body: await res.text(), svixId: headers["svix-id"] };
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
  };
}
