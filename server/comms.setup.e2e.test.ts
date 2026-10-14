/**
 * VILLAGE COMMS SETUP, DRIVEN THROUGH THE BUILT SERVER (the comms build spec
 * 5.2, 5.15 and 5.16; the setup lane's acceptance list).
 *
 * Boots `dist/index.js` against a scratch schema with the scheduler off and
 * `RESEND_API_BASE` pointed at the fake provider (server/testkit/fakeResend.ts),
 * with NO email configured at all: no key, no sender, no webhook secret in the
 * environment. Then a founder completes Comms Settings through its own routes,
 * one item at a time, and the suite reads the module's readiness reader and
 * the launch journey after each:
 *
 *   - the key goes in through the existing secrets route;
 *   - the launch journey's sender row is red with a key and no sender;
 *   - the domain is added pending, then reads verified against the fake;
 *   - a sender off the domain is refused, and one on it becomes the From line;
 *   - one press connects delivery reports, stores the secret, and the
 *     webhook then accepts a signed event and refuses a forged one;
 *   - the postal address is saved;
 *   - the module is not ready until the test email to the founder is reported
 *     delivered, and then it is;
 *   - Pause all and the rehearsal inbox land in the stored document;
 *   - the Overview sums it up, and a stranger is refused everywhere.
 *
 * Run `pnpm build` first: this boots the BUILT server. Skips loudly without
 * TEST_DATABASE_URL. The cases run IN ORDER, each building on the last.
 */
import fs from "fs";
import os from "os";
import path from "path";
import type { Pool, RowDataPacket } from "mysql2/promise";
import { spawn, type ChildProcess } from "child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { provisionTestDb, testDbConfigured, testPool, type TestDb, E2E_BOOT_DEADLINE_MS, waitForPortFree } from "./db/testDb";
import { makeWebhookSecret, startFakeResend, type FakeResend } from "./testkit/fakeResend";

const DB_CONFIGURED = testDbConfigured();
if (!DB_CONFIGURED) {
  console.warn("[comms.setup] TEST_DATABASE_URL not set - DB-backed tests SKIPPED.");
}

const DIST = path.resolve(process.cwd(), "dist/index.js");
// Its window is checked by scripts/check-e2e-ports.mjs, not claimed here.
const PORT = 2500 + (process.pid % 100);
const BASE = `http://localhost:${PORT}`;
const ADMIN = "comms-setup-admin";
const PASSWORD = "CommsSetup123!";
const FOUNDER_EMAIL = `founder-${PORT}@example.test`;
/** Short on purpose: a test key, never a credential, and the intake scan reads lengths. */
const PROVIDER_KEY = "re_test_lane_b4";
const DOMAIN = "village.example.test";
const SENDER_LINE = `Test Village <hello@${DOMAIN}>`;

let child: ChildProcess | undefined;
let testDb: TestDb | undefined;
let fake: FakeResend | undefined;
let dataDir = "";
let pool: Pool;
const logs: string[] = [];

let founderToken = "";

interface Answer {
  status: number;
  json: any;
}

async function call(method: string, route: string, opts: { body?: unknown; token?: string | null } = {}): Promise<Answer> {
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

/** The checklist as the founder's screen reads it. */
async function checklist(): Promise<{ ready: boolean; done: Record<string, boolean>; body: any }> {
  const r = await call("GET", "/api/admin/comms/settings");
  expect(r.status, JSON.stringify(r.json)).toBe(200);
  return {
    ready: r.json.ready,
    done: Object.fromEntries((r.json.checklist as Array<{ key: string; done: boolean }>).map((i) => [i.key, i.done])),
    body: r.json,
  };
}

/** What the module's own readiness reader says, through the foundation's status route. */
async function moduleReady(): Promise<boolean> {
  const r = await call("GET", "/api/admin/comms/status");
  expect(r.status, JSON.stringify(r.json)).toBe(200);
  return r.json.module.ready;
}

async function launchRow(id: string): Promise<{ state: string; detail: string; checkKey: string }> {
  const r = await call("GET", "/api/admin/launch");
  expect(r.status, JSON.stringify(r.json)).toBe(200);
  const row = (r.json.items as any[]).find((i) => i.id === id);
  expect(row, `launch row ${id}`).toBeTruthy();
  return row;
}

beforeAll(async () => {
  if (!DB_CONFIGURED) return;
  if (!fs.existsSync(DIST)) {
    throw new Error(`${DIST} is missing. Run \`pnpm build\` before the comms setup test.`);
  }
  fake = await startFakeResend({ apiKey: PROVIDER_KEY });
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "village-comms-setup-"));
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
      AUTH_TOKEN_SECRET: "comms-setup-secret",
      VILLAGE_SECRETS_KEY: "1f".repeat(32), // module-review-ok: fixture sealing key, same as every e2e suite
      // The links in emails and the delivery-report address are built from this.
      FRONTEND_URL: BASE,
      // The fake provider stands in for the real one. Nothing here can reach it.
      RESEND_API_BASE: fake.url,
      // Nothing about email is configured by the host: every item is supplied
      // through Comms Settings, the way a founder does it.
      RESEND_API_KEY: "",
      EMAIL_FROM: "",
      RESEND_WEBHOOK_SECRET: "",
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
    } catch {
      /* not up yet */
    }
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

describe.skipIf(!DB_CONFIGURED)("Village Comms setup, every item through the founder's own routes", () => {
  it("starts with nothing configured: the checklist is open and the module is not ready", async () => {
    const boot = await call("POST", "/api/admin/bootstrap", {
      body: { password: ADMIN, email: FOUNDER_EMAIL, name: "Comms Founder" },
      token: null,
    });
    expect(boot.status, JSON.stringify(boot.json)).toBe(200);
    // No key yet, so the claim link is shown and not sent.
    expect(boot.json?.emailed).toBe(false);
    const claim = decodeURIComponent(String(boot.json?.claimUrl ?? "").match(/token=([^&]+)/)?.[1] ?? "");
    const setPw = await call("POST", "/api/auth/set-password", { body: { token: claim, password: PASSWORD }, token: null });
    founderToken = String(setPw.json?.token ?? "");
    expect(founderToken, "the founder holds a session").toBeTruthy();

    const c = await checklist();
    expect(c.ready).toBe(false);
    expect(Object.keys(c.done)).toHaveLength(13);
    for (const key of ["api-key", "domain", "sender", "delivery-reports", "postal-address", "test-email"]) {
      expect(c.done[key], key).toBe(false);
    }
    expect(c.body.key).toMatchObject({ configured: false });
    expect(c.body.webhook.url).toBe(WEBHOOK());
    expect(await moduleReady()).toBe(false);
  });

  it("refuses a stranger every read and every change", async () => {
    expect((await call("GET", "/api/admin/comms/settings", { token: null })).status).toBe(401);
    expect((await call("GET", "/api/admin/comms/overview", { token: null })).status).toBe(401);
    expect((await call("PUT", "/api/admin/comms/settings", { body: { paused: true }, token: null })).status).toBe(403);
    expect((await call("POST", "/api/admin/comms/settings/test", { body: {}, token: null })).status).toBe(403);
    expect((await call("POST", "/api/admin/comms/settings/webhook", { body: {}, token: null })).status).toBe(403);
  });

  it("takes the provider key through the existing secrets route, and item 1 turns green", async () => {
    const put = await call("PUT", "/api/admin/integrations/resend_api_key", { body: { value: PROVIDER_KEY } });
    expect(put.status, JSON.stringify(put.json)).toBe(200);
    const c = await checklist();
    expect(c.done["api-key"]).toBe(true);
    // Write-only: the screen sees the last four characters and never the key.
    expect(c.body.key).toMatchObject({ configured: true, source: "admin", last4: PROVIDER_KEY.slice(-4) });
    expect(JSON.stringify(c.body)).not.toContain(PROVIDER_KEY);
    expect(await moduleReady()).toBe(false);
  });

  it("turns the launch journey's sender row red with a key and no sender", async () => {
    expect((await launchRow("resend-key")).state).toBe("ok");
    const sender = await launchRow("email-sender");
    expect(sender).toMatchObject({ checkKey: "comms:sender", state: "missing" });
    expect(sender.detail).toBe("No sender yet. With none, nothing is sent.");
    expect((await launchRow("email-domain")).checkKey).toBe("comms:domain");
  });

  it("adds the sending domain pending, shows its DNS records, then reads it verified against the fake", async () => {
    fake!.setDomainStatus("pending");
    const added = await call("POST", "/api/admin/comms/settings/domain", { body: { name: `https://Village.Example.test/` } });
    expect(added.status, JSON.stringify(added.json)).toBe(200);
    expect(added.json.settings).toMatchObject({ domain: DOMAIN, domainStatus: "pending" });
    expect(added.json.settings.domainId).toMatch(/^dom_/);
    expect(added.json.domainPanel.records.length).toBeGreaterThan(0);
    expect(added.json.domainPanel.records[0].name).toContain(DOMAIN);
    expect(added.json.checklist.find((i: any) => i.key === "domain").done).toBe(false);
    expect((await launchRow("email-domain")).state).toBe("missing");

    // The panel reads the provider live, and the checklist agrees.
    const panel = await call("GET", "/api/admin/comms/settings/domain");
    expect(panel.json).toMatchObject({ domain: DOMAIN, status: "pending", byHand: false });

    fake!.setDomainStatus("verified");
    const checked = await call("POST", "/api/admin/comms/settings/domain/verify", { body: {} });
    expect(checked.status, JSON.stringify(checked.json)).toBe(200);
    expect(checked.json.settings.domainStatus).toBe("verified");
    expect((await checklist()).done.domain).toBe(true);
    expect((await launchRow("email-domain")).state).toBe("ok");
    // A key that can check the domain is not offered the by-hand vouch.
    expect((await call("POST", "/api/admin/comms/settings/domain/confirm", { body: { verified: true } })).status).toBe(409);
    expect(fake!.requests.some((r) => r.method === "POST" && r.path.endsWith("/verify"))).toBe(true);
    expect(await moduleReady()).toBe(false);
  });

  it("refuses a sender off the domain, and makes one on it the From line every email uses", async () => {
    const off = await call("PUT", "/api/admin/comms/settings/sender", { body: { name: "Test Village", address: "hello@elsewhere.test" } });
    expect(off.status).toBe(400);
    expect(off.json.error).toBe(`The address has to end in @${DOMAIN}, the domain this village sends from.`);

    const on = await call("PUT", "/api/admin/comms/settings/sender", { body: { name: "Test Village", address: `hello@${DOMAIN}` } });
    expect(on.status, JSON.stringify(on.json)).toBe(200);
    expect(on.json.sender).toMatchObject({ line: SENDER_LINE, source: "admin", name: "Test Village", address: `hello@${DOMAIN}` });
    expect(on.json.settings.senderName).toBe("Test Village");
    expect((await checklist()).done.sender).toBe(true);
    expect((await launchRow("email-sender")).state).toBe("ok");
    // The same email-config document the old Email Settings route reads.
    const config = await call("GET", "/api/admin/email-config");
    expect(config.json.sender).toBe(SENDER_LINE);
    expect(await moduleReady()).toBe(false);
  });

  it("connects delivery reports with one press, and the webhook then accepts a signed event", async () => {
    // Before connecting, a report has nothing to be checked against.
    const early = await fake!.deliverWebhook(WEBHOOK(), "delivered", { emailId: "fake_none", secret: makeWebhookSecret() });
    expect(early.status).toBe(503);

    const connected = await call("POST", "/api/admin/comms/settings/webhook", { body: {} });
    expect(connected.status, JSON.stringify(connected.json)).toBe(200);
    expect(connected.json.webhook).toMatchObject({ configured: true, source: "admin", connectedBy: "Comms Founder", byHand: false });
    expect(connected.json.settings.webhookId).toMatch(/^wh_/);
    const made = fake!.requests.filter((r) => r.method === "POST" && r.path === "/webhooks");
    expect(made).toHaveLength(1);
    expect(made[0].body).toEqual({
      endpoint: WEBHOOK(),
      events: ["email.sent", "email.delivered", "email.delivery_delayed", "email.bounced", "email.complained", "email.failed", "email.suppressed"],
    });
    // The secret went into the store and never back out to the browser.
    expect(JSON.stringify(connected.json)).not.toContain(fake!.webhookSecret());
    expect((await checklist()).done["delivery-reports"]).toBe(true);
    expect((await launchRow("email-delivery-reports")).state).toBe("ok");

    // The webhook now checks a report against the stored secret: forged refused, signed stored.
    const forged = await fake!.deliverWebhook(WEBHOOK(), "delivered", { emailId: "fake_none", secret: makeWebhookSecret() });
    expect(forged.status).toBe(401);
    const signed = await fake!.deliverWebhook(WEBHOOK(), "delivered", { emailId: "fake_none", svixId: "msg_setup_report_1" });
    expect(signed.status, signed.body).toBe(200);
    expect(JSON.parse(signed.body)).toEqual({ ok: true, stored: true });
    expect(await moduleReady()).toBe(false);
  });

  it("saves the postal address, and the module still waits for a delivered test email", async () => {
    const put = await call("PUT", "/api/admin/comms/settings", { body: { postalAddress: "1 Orchard Lane\nHill Valley" } });
    expect(put.status, JSON.stringify(put.json)).toBe(200);
    expect(put.json.changed).toEqual(["postalAddress"]);
    const c = await checklist();
    expect(c.done["postal-address"]).toBe(true);
    expect(c.ready).toBe(false);
    const open = (c.body.checklist as any[]).filter((i) => i.required && !i.done).map((i) => i.key);
    expect(open).toEqual(["test-email"]);
    expect(await moduleReady()).toBe(false);
  });

  it("sends the founder a test email through the post office, and the module is ready once it is reported delivered", async () => {
    const sent = await call("POST", "/api/admin/comms/settings/test", { body: {} });
    expect(sent.status, JSON.stringify(sent.json)).toBe(200);
    expect(sent.json.result.status).toBe("sent");

    const emails = fake!.emails();
    expect(emails, "the test is the first email the provider ever accepted here").toHaveLength(1);
    const email = emails[0];
    expect(email.body).toMatchObject({ from: SENDER_LINE, to: [FOUNDER_EMAIL] });
    expect(String(email.body.subject)).toMatch(/^A test email from /);
    expect(String(email.body.text)).toContain("This is the test email you asked for from Comms Settings.");
    expect(email.body.tags).toEqual([
      { name: "msg", value: sent.json.result.messageId },
      { name: "kind", value: "essential" },
    ]);

    const [rows] = await pool.query<RowDataPacket[]>( // module-review-ok: reading back the scratch schema this suite provisioned
      "SELECT origin, kind, status, body_html FROM comms_messages WHERE id = ?",
      [sent.json.result.messageId],
    );
    expect(rows[0]).toMatchObject({ origin: "comms.test", kind: "essential", status: "sent", body_html: null });

    // Accepted is not delivered.
    let c = await checklist();
    expect(c.done["test-email"]).toBe(false);
    expect(c.body.testEmail).toMatchObject({ status: "sent", toEmail: FOUNDER_EMAIL, delivered: false });
    expect(await moduleReady()).toBe(false);

    const report = await fake!.deliverWebhook(WEBHOOK(), "delivered", { emailId: email.id, svixId: "msg_setup_report_2" });
    expect(report.status, report.body).toBe(200);
    c = await checklist();
    expect(c.done["test-email"]).toBe(true);
    expect(c.ready).toBe(true);
    expect(await moduleReady(), "items 1 to 5 and 13 are green").toBe(true);
  });

  it("keeps Pause all and the rehearsal inbox in the stored document, and only what was changed", async () => {
    const put = await call("PUT", "/api/admin/comms/settings", { body: { paused: true, rehearsalTo: ["rehearse@example.test"] } });
    expect(put.status, JSON.stringify(put.json)).toBe(200);
    expect(put.json.settings).toMatchObject({ paused: true, rehearsalTo: ["rehearse@example.test"] });
    const [rows] = await pool.query<RowDataPacket[]>( // module-review-ok: reading back the scratch schema this suite provisioned
      "SELECT value FROM app_config WHERE config_key = 'comms-settings'",
    );
    const stored = typeof rows[0].value === "string" ? JSON.parse(rows[0].value) : rows[0].value;
    expect(stored).toMatchObject({ paused: true, rehearsalTo: ["rehearse@example.test"], postalAddress: "1 Orchard Lane\nHill Valley" });
    // Nobody touched the tick-box words, so the village still inherits the platform's.
    expect(stored.consentText).toBeUndefined();
    expect(stored.recapQuestions).toBeUndefined();

    const refused = await call("PUT", "/api/admin/comms/settings", { body: { paused: "yes" } });
    expect(refused.status).toBe(400);
  });

  it("sums it all up on the Overview", async () => {
    const r = await call("GET", "/api/admin/comms/overview");
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    expect(r.json.setup).toMatchObject({ ready: true, done: 6, total: 6, open: [] });
    expect(r.json.paused).toBe(true);
    expect(r.json.jobs).toEqual(["drain", "journeys", "polls", "letters"]);
    expect(r.json.numbers.days).toBe(30);
    expect(r.json.numbers.byKind.essential).toBeGreaterThanOrEqual(2);
    expect(r.json.journeys.map((j: any) => j.key)).toContain("gathering.going");
    expect(r.json.journeys.every((j: any) => j.state === "off")).toBe(true);
    expect(r.json.upcoming).toMatchObject({ days: 7, total: 0 });
  });
});
