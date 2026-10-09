/**
 * VILLAGE COMMS, THE FOUNDATION, DRIVEN THROUGH THE BUILT SERVER
 * (the comms build spec section 8, the foundation lane's smoke).
 *
 * Boots `dist/index.js` against a scratch schema with the scheduler off and
 * `RESEND_API_BASE` pointed at the fake provider (server/testkit/fakeResend.ts),
 * so not one email leaves this machine. Then:
 *
 *   - the founder's set-password email reaches the fake provider, through the
 *     post office, and its ledger row says `sent` and keeps no words;
 *   - the comms status answers the founder and refuses a stranger;
 *   - the delivery-report webhook refuses a bad signature and stores a good
 *     report exactly once when it is delivered twice, which can only happen
 *     while the webhook is registered BEFORE express.json();
 *   - a comms route on a gathering answers the events module's 404 while that
 *     module is off, which can only happen while it is registered AFTER the
 *     module's gate; the same request answers once events is on;
 *   - the fake provider is not in the bundle.
 *
 * Run `pnpm build` first: this boots the BUILT server. Skips loudly without
 * TEST_DATABASE_URL. The cases run IN ORDER.
 */
import fs from "fs";
import os from "os";
import path from "path";
import type { Pool, RowDataPacket } from "mysql2/promise";
import { spawn, type ChildProcess } from "child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { provisionTestDb, testDbConfigured, testPool, type TestDb, E2E_BOOT_DEADLINE_MS, waitForPortFree } from "./db/testDb";
import { makeWebhookSecret, signSvix, startFakeResend, type FakeResend } from "./testkit/fakeResend";

const DB_CONFIGURED = testDbConfigured();
if (!DB_CONFIGURED) {
  console.warn("[comms.foundation] TEST_DATABASE_URL not set - DB-backed tests SKIPPED.");
}

const DIST = path.resolve(process.cwd(), "dist/index.js");
// Its window is checked by scripts/check-e2e-ports.mjs, not claimed here.
const PORT = 3100 + (process.pid % 200);
const BASE = `http://localhost:${PORT}`;
const ADMIN = "comms-admin";
const PASSWORD = "CommsFoundation123!";
const FOUNDER_EMAIL = `founder-${PORT}@example.test`;
/** Short on purpose: a test key, never a credential, and the intake scan reads lengths. */
const PROVIDER_KEY = "re_test_lane_f";
const SENDER = "Test Village <hello@village.example.test>";
const WEBHOOK_SECRET = makeWebhookSecret();

let child: ChildProcess | undefined;
let testDb: TestDb | undefined;
let fake: FakeResend | undefined;
let dataDir = "";
let pool: Pool;
const logs: string[] = [];

let founderToken = "";
/** The provider's id for the founder's email, which delivery reports name. */
let providerId = "";
/** Our ledger row's id for it. */
let messageId = "";

interface Answer { status: number; json: any }

async function call(
  method: string,
  route: string,
  opts: { body?: unknown; token?: string | null } = {},
): Promise<Answer> {
  const token = opts.token === undefined ? founderToken : opts.token;
  const res = await fetch(BASE + route, { // module-review-ok: the test client dialling the built server on localhost, as every e2e suite does
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

const settle = (ms: number) => new Promise((r) => setTimeout(r, ms));
const WEBHOOK = () => `${BASE}/api/comms/webhooks/resend`;

beforeAll(async () => {
  if (!DB_CONFIGURED) return;
  if (!fs.existsSync(DIST)) {
    throw new Error(`${DIST} is missing. Run \`pnpm build\` before the comms foundation test.`);
  }
  fake = await startFakeResend({ apiKey: PROVIDER_KEY });
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "village-comms-foundation-"));
  testDb = await provisionTestDb();
  pool = testPool(testDb, { connectionLimit: 4 });

  await waitForPortFree(PORT);
  child = spawn(process.execPath, [DIST], {
    env: {
      ...process.env,
      NODE_ENV: "production",
      PORT: String(PORT),
      // No background scheduler, for the reason selfMembership.routes.e2e.test.ts gives.
      SCHEDULER_ENABLED: "0",
      DATA_DIR: dataDir,
      DATABASE_URL: testDb.url,
      ADMIN_PASSWORD: ADMIN,
      AUTH_TOKEN_SECRET: "comms-secret",
      // The fake provider stands in for the real one. Nothing here can reach it.
      RESEND_API_BASE: fake.url,
      RESEND_API_KEY: PROVIDER_KEY,
      EMAIL_FROM: SENDER,
      RESEND_WEBHOOK_SECRET: WEBHOOK_SECRET,
      ANTHROPIC_API_KEY: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.on("data", (d) => logs.push(String(d)));
  child.stderr?.on("data", (d) => logs.push(String(d)));

  const deadline = Date.now() + E2E_BOOT_DEADLINE_MS;
  for (;;) {
    if (Date.now() > deadline) {
      throw new Error(`server did not start in ${E2E_BOOT_DEADLINE_MS / 1000}s. Output:\n${logs.join("")}`);
    }
    try {
      const res = await fetch(`${BASE}/health`); // module-review-ok: the boot poll against the local test server
      if (res.ok) break;
    } catch { /* not up yet */ }
    await settle(400);
  }
});

afterAll(async () => {
  child?.kill();
  await pool?.end();
  await fake?.close();
  if (dataDir && fs.existsSync(dataDir)) fs.rmSync(dataDir, { recursive: true, force: true });
  await testDb?.drop();
});

describe.skipIf(!DB_CONFIGURED)("Village Comms, the foundation", () => {
  it("posts the founder's set-password email through the post office to the provider, and records it sent", async () => {
    const boot = await call("POST", "/api/admin/bootstrap", {
      body: { password: ADMIN, email: FOUNDER_EMAIL, name: "Comms Founder" },
      token: null,
    });
    expect(boot.status, JSON.stringify(boot.json)).toBe(200);
    // The provider accepted it, so the operator is told it went.
    expect(boot.json?.emailed).toBe(true);
    expect(boot.json?.emailNote).toBeUndefined();

    const sends = fake!.requests.filter((r) => r.method === "POST" && r.path === "/emails");
    expect(sends, "exactly one email reached the provider").toHaveLength(1);
    const sent = sends[0];
    expect(sent.headers.authorization).toBe(`Bearer ${PROVIDER_KEY}`);
    expect(sent.body).toMatchObject({ from: SENDER, to: [FOUNDER_EMAIL], subject: "You are the founder admin. Set your password" });
    expect(String(sent.body.html)).toContain("set-password?token=");
    // A password link never offers to unsubscribe.
    expect(sent.body.headers).toBeUndefined();
    messageId = String(sent.headers["idempotency-key"] ?? "");
    expect(messageId).toMatch(/^msg_[0-9a-f]{24}$/);
    expect(sent.body.tags).toEqual([
      { name: "msg", value: messageId },
      { name: "kind", value: "essential" },
    ]);
    providerId = fake!.emails()[0].id;

    const [rows] = await pool.query<RowDataPacket[]>( // module-review-ok: reading back the scratch schema this suite provisioned
      "SELECT id, status, kind, provider_message_id, body_html, body_text, contact_id FROM comms_messages WHERE to_email = ?",
      [FOUNDER_EMAIL],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: messageId, status: "sent", kind: "essential", provider_message_id: providerId });
    // The link in it acts for the founder, so the ledger keeps who and when and never the words.
    expect(rows[0].body_html).toBeNull();
    expect(rows[0].body_text).toBeNull();
    const [contacts] = await pool.query<RowDataPacket[]>( // module-review-ok: reading back the scratch schema this suite provisioned
      "SELECT id FROM comms_contacts WHERE email_key = ?",
      [FOUNDER_EMAIL.toLowerCase()],
    );
    expect(contacts.map((c) => c.id)).toEqual([rows[0].contact_id]);

    // The founder finishes signing in, through the link the email carried.
    const claim = decodeURIComponent(String(boot.json?.claimUrl ?? "").match(/token=([^&]+)/)?.[1] ?? "");
    const setPw = await call("POST", "/api/auth/set-password", { body: { token: claim, password: PASSWORD }, token: null });
    founderToken = String(setPw.json?.token ?? "");
    expect(founderToken, "the founder holds a session").toBeTruthy();
  });

  it("answers the comms status to the founder, and refuses a stranger", async () => {
    const status = await call("GET", "/api/admin/comms/status");
    expect(status.status, JSON.stringify(status.json)).toBe(200);
    expect(status.json).toMatchObject({
      module: { lifecycle: "off", ready: false },
      provider: { keySet: true, senderSet: true },
      jobs: ["drain", "journeys", "polls"],
    });
    expect(status.json.messages.byStatus.sent).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(status.json), "no address and no key leave in a status").not.toContain("@");
    expect((await call("GET", "/api/admin/comms/status", { token: null })).status).toBe(401);
  });

  it("runs a comms job on demand and refuses a job it does not know", async () => {
    const run = await call("POST", "/api/admin/comms/run", { body: { job: "drain" } });
    expect(run.status, JSON.stringify(run.json)).toBe(200);
    expect(run.json).toMatchObject({ job: "drain", summary: { sent: 0, failed: 0, skipped: 0, expired: 0, requeued: 0 } });
    expect((await call("POST", "/api/admin/comms/run", { body: { job: "journeys" } })).json?.summary).toMatchObject({ checked: 0, posted: 0, stopped: 0 });
    expect((await call("POST", "/api/admin/comms/run", { body: { job: "everything" } })).status).toBe(400);
    expect((await call("POST", "/api/admin/comms/run", { body: { job: "drain" }, token: null })).status).toBe(403);
  });

  it("refuses a delivery report the provider did not sign, and stores a signed one exactly once", async () => {
    // Signed with somebody else's secret.
    const forged = await fake!.deliverWebhook(WEBHOOK(), "delivered", { emailId: providerId, secret: makeWebhookSecret() });
    expect(forged.status, forged.body).toBe(401);
    // Signed correctly, then changed on the way.
    const body = JSON.stringify({ type: "email.delivered", data: { email_id: providerId, tags: { msg: messageId } } });
    const headers = signSvix(WEBHOOK_SECRET, body);
    const tampered = await fetch(WEBHOOK(), { // module-review-ok: a hand-made delivery report to the local test server
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: body.replace("delivered", "complained"),
    });
    expect(tampered.status).toBe(401);

    const first = await fake!.deliverWebhook(WEBHOOK(), "delivered", { emailId: providerId, secret: WEBHOOK_SECRET, svixId: "msg_e2e_delivery_1" });
    expect(first.status, first.body).toBe(200);
    expect(JSON.parse(first.body)).toEqual({ ok: true, stored: true });
    // The provider retries until it hears a 2xx. A retry is the same delivery, and a success.
    const again = await fake!.deliverWebhook(WEBHOOK(), "delivered", { emailId: providerId, secret: WEBHOOK_SECRET, svixId: "msg_e2e_delivery_1" });
    expect(again.status, again.body).toBe(200);
    expect(JSON.parse(again.body)).toEqual({ ok: true, stored: false });

    const [stored] = await pool.query<RowDataPacket[]>( // module-review-ok: reading back the scratch schema this suite provisioned
      "SELECT id, type, provider_message_id, message_id, processed_at, outcome FROM comms_provider_events",
    );
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({
      id: "msg_e2e_delivery_1",
      type: "email.delivered",
      provider_message_id: providerId,
      // Tied to our own row by the tag every send carries.
      message_id: messageId,
      // Applied once, from the stored row (server/lib/comms/webhook.ts).
      outcome: "delivered",
    });
    expect(stored[0].processed_at).not.toBeNull();
    const [row] = await pool.query<RowDataPacket[]>( // module-review-ok: reading back the scratch schema this suite provisioned
      "SELECT status FROM comms_messages WHERE id = ?",
      [messageId],
    );
    expect(row[0]?.status).toBe("delivered");
  });

  it("answers the events module's 404 on a gathering's comms route while events is off, and the route once it is on", async () => {
    const off = await call("GET", "/api/events/ev-anything/comms");
    expect(off.status, "behind the events gate").toBe(404);
    const guest = await call("POST", "/api/events/ev-anything/guest-rsvp", { body: {}, token: null });
    expect(guest.status).toBe(404);

    const on = await call("PUT", "/api/admin/modules/events/lifecycle", { body: { lifecycle: "members", examples: false } });
    expect(on.status, JSON.stringify(on.json)).toBe(200);
    // The same request reaches the route itself now, which is still being built.
    const reached = await call("GET", "/api/events/ev-anything/comms");
    expect(reached.status, JSON.stringify(reached.json)).toBe(501);
    expect(String(reached.json?.error)).toContain("being built");
  });

  it("keeps the fake provider out of the bundle that ships", () => {
    const bundle = fs.readFileSync(DIST, "utf8");
    expect(bundle, "a control: the post office IS in the bundle").toContain("comms_messages");
    expect(bundle).not.toContain("startFakeResend");
    expect(bundle).not.toContain("The fake provider has no such route");
  });
});
