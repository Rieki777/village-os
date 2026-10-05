/**
 * VILLAGE COMMS, THE POST OFFICE, DRIVEN THROUGH THE BUILT SERVER (the post
 * office lane's e2e; the comms build spec 5.1 to 5.3 and section 8).
 *
 * Boots `dist/index.js` against a scratch schema with the scheduler off and
 * `RESEND_API_BASE` pointed at the fake provider (server/testkit/fakeResend.ts),
 * so not one email leaves this machine. Then, through real routes:
 *
 *   - every email the platform already sent, from a founder's claim link to a
 *     housing status move, is written to `comms_messages` under its own origin,
 *     and reaches the fake through the one door;
 *   - a member's notice waits in the queue, and "run now" sends it with the
 *     one-click unsubscribe pair on it;
 *   - Sent mail lists, filters and opens the record, tries a failed email
 *     again, cancels a queued one, and refuses a member who does not run comms;
 *   - a bounce reported by the provider suppresses the address, once however
 *     often it is delivered, and the next notice to it is skipped with the
 *     reason, while a complaint does the same.
 *
 * Run `pnpm build` first: this boots the BUILT server. Skips loudly without
 * TEST_DATABASE_URL. The cases run IN ORDER and build on each other.
 */
import fs from "fs";
import os from "os";
import path from "path";
import type { Pool, RowDataPacket } from "mysql2/promise";
import { spawn, type ChildProcess } from "child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { waitForHealth } from "./db/e2eBoot";
import { provisionTestDb, testDbConfigured, testPool, type TestDb, waitForPortFree } from "./db/testDb";
import { makeWebhookSecret, startFakeResend, type FakeResend } from "./testkit/fakeResend";

const DB_CONFIGURED = testDbConfigured();
if (!DB_CONFIGURED) {
  console.warn("[comms.postoffice] TEST_DATABASE_URL not set - DB-backed tests SKIPPED.");
}

const DIST = path.resolve(process.cwd(), "dist/index.js");
// Its window is checked by scripts/check-e2e-ports.mjs, not claimed here.
const PORT = 3500 + (process.pid % 100);
const BASE = `http://localhost:${PORT}`;
const ADMIN = "comms-postoffice-admin";
const PASSWORD = "CommsPostOffice123!";
const FOUNDER_EMAIL = `founder-${PORT}@example.test`;
/** Short on purpose: a test key, never a credential, and the intake scan reads lengths. */
const PROVIDER_KEY = "re_test_lane_b1";
const SENDER = "Test Village <hello@village.example.test>";
const WEBHOOK_SECRET = makeWebhookSecret();

/** The emails the platform sent before the post office existed, by the origin each now records. */
const EXISTING_ORIGINS = [
  "auth.reset",
  "auth.first_password",
  "auth.founder_claim",
  "auth.admin_password_link",
  "forms.ack",
  "forms.team_alert",
  "map.contact_relay",
  "investor.packet",
  "investor.team_alert",
  "housing.ack",
  "housing.team_alert",
  "housing.status",
];

let child: ChildProcess | undefined;
let testDb: TestDb | undefined;
let fake: FakeResend | undefined;
let dataDir = "";
let pool: Pool;
const logs: string[] = [];

let founderToken = "";
let founderId = "";
let member = { token: "", id: "", email: "" };
/** The notice "run now" sent, which later cases report on. */
let noticeId = "";

interface Answer {
  status: number;
  json: any;
}

let ipSeq = 0;
/** One call, from its own address, so no case spends another's rate-limit budget. */
async function call(method: string, route: string, opts: { body?: unknown; token?: string | null } = {}): Promise<Answer> {
  const token = opts.token === undefined ? founderToken : opts.token;
  const res = await fetch(BASE + route, { // module-review-ok: the test client dialling the built server on localhost, as every e2e suite does
    method,
    headers: {
      "Content-Type": "application/json",
      "X-Forwarded-For": `10.51.${Math.floor(++ipSeq / 250)}.${ipSeq % 250}`,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

const settle = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Poll a fire-and-forget effect into existence, or fail saying what was missing. */
async function waitUntil(what: string, ok: () => Promise<boolean> | boolean, ms = 15_000): Promise<void> {
  const deadline = Date.now() + ms;
  for (;;) {
    if (await ok()) return;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await settle(150);
  }
}

/** The ledger rows one origin wrote. */
async function rowsFor(origin: string): Promise<RowDataPacket[]> {
  const [rows] = await pool.query<RowDataPacket[]>( // module-review-ok: reading back the scratch schema this suite provisioned
    "SELECT id, kind, origin, status, skip_reason, to_email, provider_message_id, body_html FROM comms_messages WHERE origin = ? ORDER BY created_at, id",
    [origin],
  );
  return rows;
}

const WEBHOOK = () => `${BASE}/api/comms/webhooks/resend`;

beforeAll(async () => {
  if (!DB_CONFIGURED) return;
  if (!fs.existsSync(DIST)) {
    throw new Error(`${DIST} is missing. Run \`pnpm build\` before the comms post office test.`);
  }
  fake = await startFakeResend({ apiKey: PROVIDER_KEY });
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "village-comms-postoffice-"));
  testDb = await provisionTestDb();
  pool = testPool(testDb, { connectionLimit: 4 });

  await waitForPortFree(PORT);
  child = spawn(process.execPath, [DIST], {
    env: {
      ...process.env,
      NODE_ENV: "production",
      PORT: String(PORT),
      // No background scheduler: "run now" drives the post office here.
      SCHEDULER_ENABLED: "0",
      DATA_DIR: dataDir,
      DATABASE_URL: testDb.url,
      ADMIN_PASSWORD: ADMIN,
      // Short on purpose: a throwaway test value, and the intake scan reads lengths.
      AUTH_TOKEN_SECRET: "comms-b1-token",
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
  await waitForHealth({ base: BASE, logs, child });
});

afterAll(async () => {
  child?.kill();
  await pool?.end();
  await fake?.close();
  if (dataDir && fs.existsSync(dataDir)) fs.rmSync(dataDir, { recursive: true, force: true });
  await testDb?.drop();
});

describe.skipIf(!DB_CONFIGURED)("Village Comms, the post office", () => {
  it("records the founder's claim, a first password, a reset and an admin's link, each under its own origin", async () => {
    const boot = await call("POST", "/api/admin/bootstrap", {
      body: { password: ADMIN, email: FOUNDER_EMAIL, name: "Post Office Founder" },
      token: null,
    });
    expect(boot.status, JSON.stringify(boot.json)).toBe(200);
    expect(boot.json?.emailed).toBe(true);

    // No password yet, so recovery sends the letter that sets a first one.
    expect((await call("POST", "/api/auth/forgot-password", { body: { email: FOUNDER_EMAIL }, token: null })).status).toBe(200);
    const claim = decodeURIComponent(String(boot.json?.claimUrl ?? "").match(/token=([^&]+)/)?.[1] ?? "");
    const setPw = await call("POST", "/api/auth/set-password", { body: { token: claim, password: PASSWORD }, token: null });
    founderToken = String(setPw.json?.token ?? "");
    founderId = String(setPw.json?.user?.id ?? "");
    expect(founderToken, "the founder holds a session").toBeTruthy();

    // Now a password exists, so the same request sends the reset letter.
    expect((await call("POST", "/api/auth/forgot-password", { body: { email: FOUNDER_EMAIL }, token: null })).status).toBe(200);
    const link = await call("POST", `/api/admin/users/${founderId}/send-password-link`, { body: {} });
    expect(link.status, JSON.stringify(link.json)).toBe(200);
    // What the post office did: the provider took it.
    expect(link.json?.emailed).toBe(true);

    for (const origin of ["auth.founder_claim", "auth.first_password", "auth.reset", "auth.admin_password_link"]) {
      const rows = await rowsFor(origin);
      expect(rows.length, origin).toBeGreaterThanOrEqual(1);
      for (const r of rows) {
        expect(r, origin).toMatchObject({ kind: "essential", status: "sent", to_email: FOUNDER_EMAIL, body_html: null });
        expect(fake!.emails().some((e) => e.idempotencyKey === r.id), `${origin} reached the provider under its row id`).toBe(true);
      }
    }
  });

  it("records a form's two emails, a housing request and its move, and an investor packet under their own origins", async () => {
    const inboxes = await call("PUT", "/api/admin/email-config", {
      body: {
        prosperity: `team-${PORT}@example.test`,
        resident: `homes-${PORT}@example.test`,
        investor: `invest-${PORT}@example.test`,
      },
    });
    expect(inboxes.status, JSON.stringify(inboxes.json)).toBe(200);

    const form = await call("POST", "/api/forms/submit", {
      body: { type: "work-with-us", data: { name: "Wren Offer", email: `wren-${PORT}@example.test`, proposal: "Build a kiln" } },
      token: null,
    });
    expect(form.status, JSON.stringify(form.json)).toBe(200);

    const housing = await call("POST", "/api/housing/reservations", {
      body: { homeType: "casita", name: "Hal Home", email: `hal-${PORT}@example.test` },
      token: null,
    });
    expect(housing.status, JSON.stringify(housing.json)).toBe(200);
    // The two sends after the answer are fire-and-forget, and the move below
    // must find the request settled first.
    await waitUntil("the housing acknowledgement", async () => (await rowsFor("housing.ack")).length >= 1);
    const moved = await call("PUT", `/api/housing/reservations/${housing.json.id}/status`, { body: { status: "reserved" } });
    expect(moved.status, JSON.stringify(moved.json)).toBe(200);
    expect(moved.json?.notified).toBe(true);

    const investor = await call("POST", "/api/investor-docs/request", {
      body: { name: "Ivo Invest", email: `ivo-${PORT}@example.test`, accredited: false },
      token: null,
    });
    expect(investor.status, JSON.stringify(investor.json)).toBe(200);

    for (const origin of ["forms.team_alert", "forms.ack", "housing.team_alert", "housing.ack", "housing.status", "investor.packet", "investor.team_alert"]) {
      await waitUntil(`${origin} in the ledger`, async () => (await rowsFor(origin)).some((r) => r.status === "sent"));
    }
    expect((await rowsFor("housing.team_alert"))[0]).toMatchObject({ to_email: `homes-${PORT}@example.test` });
    expect((await rowsFor("forms.ack"))[0]).toMatchObject({ to_email: `wren-${PORT}@example.test` });
  });

  it("records the contact relay's email, and its email_status says what the post office did", async () => {
    expect((await call("PUT", "/api/admin/modules/map/lifecycle", { body: { lifecycle: "members", examples: false } })).status).toBe(200);
    const email = `mira-${PORT}@example.test`;
    const reg = await call("POST", "/api/auth/register", {
      body: { name: "Mira Member", email, password: "MemberPass123!", paths: ["resident"] },
      token: null,
    });
    expect(reg.status, JSON.stringify(reg.json)).toBe(200);
    member = { token: String(reg.json?.token ?? ""), id: String(reg.json?.user?.id ?? ""), email };

    const relay = await call("POST", "/api/map/contact", { body: { toUserId: member.id, message: "Would you like to meet?" } });
    expect(relay.status, JSON.stringify(relay.json)).toBe(200);
    const rows = await rowsFor("map.contact_relay");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "sent", to_email: email, kind: "essential" });
    const [requests] = await pool.query<RowDataPacket[]>( // module-review-ok: reading back the scratch schema this suite provisioned
      "SELECT email_status FROM contact_requests WHERE to_user_id = ?",
      [member.id],
    );
    expect(requests.map((r) => r.email_status)).toEqual(["sent"]);
  });

  it("queues a member's notice for the drain, and run now sends it with the one-click pair", async () => {
    // The founder sends something signed in, so a move on it is news for a member.
    const sub = await call("POST", "/api/forms/submit", {
      body: { type: "contact", data: { name: "Post Office Founder", email: FOUNDER_EMAIL, message: "A question" } },
    });
    expect(sub.status, JSON.stringify(sub.json)).toBe(200);
    const moved = await call("PUT", `/api/admin/submissions/${sub.json.id}/status`, { body: { status: "reviewing" } });
    expect(moved.status, JSON.stringify(moved.json)).toBe(200);
    expect(moved.json?.notified).toBe(true);

    const queued = (await rowsFor("notify.immediate")).filter((r) => r.to_email === FOUNDER_EMAIL);
    expect(queued).toHaveLength(1);
    expect(queued[0]).toMatchObject({ kind: "notices", status: "queued" });
    noticeId = String(queued[0].id);
    expect(fake!.emails().some((e) => e.idempotencyKey === noticeId), "nothing sent before the drain").toBe(false);

    const run = await call("POST", "/api/admin/comms/run", { body: { job: "drain" } });
    expect(run.status, JSON.stringify(run.json)).toBe(200);
    expect(run.json?.summary?.sent).toBeGreaterThanOrEqual(1);
    const [sent] = (await rowsFor("notify.immediate")).filter((r) => r.id === noticeId);
    expect(sent).toMatchObject({ status: "sent" });

    const request = fake!.requests.find((r) => r.path === "/emails" && r.headers["idempotency-key"] === noticeId)!;
    expect(request.body.tags).toEqual([
      { name: "msg", value: noticeId },
      { name: "kind", value: "notices" },
    ]);
    expect(String(request.body.headers?.["List-Unsubscribe"])).toMatch(/^<http:\/\/localhost:\d+\/api\/comms\/unsubscribe\?t=[^>]+>, <mailto:hello@village\.example\.test\?subject=unsubscribe>$/);
    expect(request.body.headers?.["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
  });

  it("records every email the platform already sent under its own origin", async () => {
    const [rows] = await pool.query<RowDataPacket[]>( // module-review-ok: reading back the scratch schema this suite provisioned
      "SELECT DISTINCT origin FROM comms_messages",
    );
    const origins = rows.map((r) => String(r.origin));
    for (const origin of [...EXISTING_ORIGINS, "notify.immediate"]) expect(origins, origin).toContain(origin);
    expect(origins, "no send went out unnamed").not.toContain("mail.direct");
  });

  it("lists, filters and opens the record in Sent mail, and refuses a member who does not run comms", async () => {
    const all = await call("GET", "/api/admin/comms/messages");
    expect(all.status, JSON.stringify(all.json)).toBe(200);
    expect(all.json.total).toBeGreaterThanOrEqual(EXISTING_ORIGINS.length);
    expect(all.json.origins.map((o: any) => o.origin)).toEqual(expect.arrayContaining(EXISTING_ORIGINS));

    const housing = await call("GET", "/api/admin/comms/messages?origin=housing.ack");
    expect(housing.json.messages.length).toBeGreaterThanOrEqual(1);
    expect(housing.json.messages.every((m: any) => m.origin === "housing.ack")).toBe(true);
    const search = await call("GET", `/api/admin/comms/messages?q=${encodeURIComponent(`ivo-${PORT}@`)}`);
    expect(search.json.messages.map((m: any) => m.origin)).toEqual(["investor.packet"]);
    const sentNotices = await call("GET", "/api/admin/comms/messages?kind=notices&status=sent");
    expect(sentNotices.json.messages.map((m: any) => m.id)).toContain(noticeId);
    // Whole days, in UTC. Yesterday to today holds everything written here, even
    // across midnight; a day long past holds nothing.
    const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
    const recent = await call("GET", `/api/admin/comms/messages?from=${day(-1)}&to=${day(0)}`);
    expect(recent.json.total).toBe(all.json.total);
    expect(recent.json.filters).toMatchObject({ from: day(-1), to: day(0) });
    expect((await call("GET", "/api/admin/comms/messages?to=2001-01-01")).json.total).toBe(0);
    // A day that does not exist is no filter at all, and never a wrong one.
    expect((await call("GET", "/api/admin/comms/messages?from=2026-02-31")).json.filters.from).toBeNull();

    const notice = await call("GET", `/api/admin/comms/messages/${noticeId}`);
    expect(notice.status).toBe(200);
    expect(String(notice.json.message.bodyHtml)).toContain("<");
    expect(notice.json.message.wordsNote).toBeNull();
    const [essential] = await rowsFor("auth.reset");
    const pw = await call("GET", `/api/admin/comms/messages/${essential.id}`);
    expect(pw.json.message.bodyHtml).toBeNull();
    expect(pw.json.message.wordsNote).toContain("never kept");
    expect(pw.json.canRetry).toBe(false);

    expect((await call("GET", "/api/admin/comms/messages", { token: null })).status).toBe(401);
    expect((await call("GET", "/api/admin/comms/messages", { token: member.token })).status).toBe(403);
    expect((await call("POST", `/api/admin/comms/messages/${noticeId}/cancel`, { body: {}, token: member.token })).status).toBe(403);
  });

  it("tries a failed email again from Sent mail, cancels a queued one, and says why it will not retry essential mail", async () => {
    const sub = await call("POST", "/api/forms/submit", {
      body: { type: "contact", data: { name: "Post Office Founder", email: FOUNDER_EMAIL, message: "A second question" } },
    });
    // Accepted, then declined: two notices for the founder, each waiting for the drain.
    expect((await call("PUT", `/api/admin/submissions/${sub.json.id}/status`, { body: { status: "accepted" } })).status).toBe(200);
    const [first] = (await rowsFor("notify.immediate")).filter((r) => r.status === "queued");
    // The one row waiting anywhere, so the refusal below can only land on it.
    const [waiting] = await pool.query<RowDataPacket[]>( // module-review-ok: reading back the scratch schema this suite provisioned
      "SELECT id FROM comms_messages WHERE status = 'queued'",
    );
    expect(waiting.map((r) => r.id)).toEqual([first.id]);
    fake!.failNext(422);
    await call("POST", "/api/admin/comms/run", { body: { job: "drain" } });
    expect((await rowsFor("notify.immediate")).find((r) => r.id === first.id)).toMatchObject({ status: "failed" });

    const retry = await call("POST", `/api/admin/comms/messages/${first.id}/retry`, { body: {} });
    expect(retry.status, JSON.stringify(retry.json)).toBe(200);
    expect((await rowsFor("notify.immediate")).find((r) => r.id === first.id)).toMatchObject({ status: "queued" });
    await call("POST", "/api/admin/comms/run", { body: { job: "drain" } });
    expect((await rowsFor("notify.immediate")).find((r) => r.id === first.id)).toMatchObject({ status: "sent" });

    expect((await call("PUT", `/api/admin/submissions/${sub.json.id}/status`, { body: { status: "declined" } })).status).toBe(200);
    const [second] = (await rowsFor("notify.immediate")).filter((r) => r.status === "queued");
    const cancel = await call("POST", `/api/admin/comms/messages/${second.id}/cancel`, { body: {} });
    expect(cancel.status, JSON.stringify(cancel.json)).toBe(200);
    await call("POST", "/api/admin/comms/run", { body: { job: "drain" } });
    expect((await rowsFor("notify.immediate")).find((r) => r.id === second.id)).toMatchObject({ status: "cancelled" });
    expect(fake!.emails().some((e) => e.idempotencyKey === second.id), "a cancelled email never reaches the provider").toBe(false);
    expect((await call("POST", `/api/admin/comms/messages/${second.id}/cancel`, { body: {} })).status, "once cancelled, nothing to cancel").toBe(409);

    const [essential] = await rowsFor("auth.reset");
    const refused = await call("POST", `/api/admin/comms/messages/${essential.id}/retry`, { body: {} });
    expect(refused.status).toBe(409);
    expect(String(refused.json?.error)).toContain("Only an email that failed");
  });

  it("suppresses an address a bounce report names, once however often it arrives, and skips the next notice to it with the reason", async () => {
    const [relay] = await rowsFor("map.contact_relay");
    const first = await fake!.deliverWebhook(WEBHOOK(), "bounced", { emailId: String(relay.provider_message_id), svixId: "svix_e2e_bounce", secret: WEBHOOK_SECRET });
    expect(first.status, first.body).toBe(200);
    expect(JSON.parse(first.body)).toEqual({ ok: true, stored: true });
    expect((await rowsFor("map.contact_relay"))[0]).toMatchObject({ status: "bounced" });
    const [suppressed] = await pool.query<RowDataPacket[]>( // module-review-ok: reading back the scratch schema this suite provisioned
      "SELECT reason, created_by, UNIX_TIMESTAMP(created_at) AS at FROM comms_suppressions WHERE email_key = ?",
      [member.email],
    );
    expect(suppressed).toHaveLength(1);
    expect(suppressed[0]).toMatchObject({ reason: "bounced", created_by: "provider" });

    // Delivered again, as the provider does when it did not hear us: stored once, applied once.
    const again = await fake!.deliverWebhook(WEBHOOK(), "bounced", { emailId: String(relay.provider_message_id), svixId: "svix_e2e_bounce", secret: WEBHOOK_SECRET });
    expect(JSON.parse(again.body)).toEqual({ ok: true, stored: false });
    const [still] = await pool.query<RowDataPacket[]>( // module-review-ok: reading back the scratch schema this suite provisioned
      "SELECT reason, UNIX_TIMESTAMP(created_at) AS at FROM comms_suppressions WHERE email_key = ?",
      [member.email],
    );
    expect(still).toEqual([{ reason: "bounced", at: suppressed[0].at }]);
    const [events] = await pool.query<RowDataPacket[]>( // module-review-ok: reading back the scratch schema this suite provisioned
      "SELECT outcome, message_id FROM comms_provider_events WHERE id = 'svix_e2e_bounce'",
    );
    expect(events).toEqual([{ outcome: "bounced_suppressed", message_id: relay.id }]);

    // The member sends something signed in, and a move on it would be a notice to them.
    const sub = await call("POST", "/api/forms/submit", {
      body: { type: "contact", data: { name: "Mira Member", email: member.email, message: "Hello" } },
      token: member.token,
    });
    expect((await call("PUT", `/api/admin/submissions/${sub.json.id}/status`, { body: { status: "reviewing" } })).status).toBe(200);
    const notice = (await rowsFor("notify.immediate")).filter((r) => r.to_email === member.email);
    expect(notice).toHaveLength(1);
    expect(notice[0]).toMatchObject({ status: "skipped", skip_reason: "suppressed" });
    const [stamp] = await pool.query<RowDataPacket[]>( // module-review-ok: reading back the scratch schema this suite provisioned
      "SELECT emailed_at FROM notifications WHERE user_id = ? AND type = 'submission_status'",
      [member.id],
    );
    expect(stamp[0].emailed_at, "a notice the post office refused is not stamped as emailed").toBeNull();

    // A complaint does the same, from the provider's report on a sent email.
    const [ack] = await rowsFor("housing.ack");
    const complaint = await fake!.deliverWebhook(WEBHOOK(), "complained", { emailId: String(ack.provider_message_id), secret: WEBHOOK_SECRET });
    expect(complaint.status, complaint.body).toBe(200);
    expect((await rowsFor("housing.ack"))[0]).toMatchObject({ status: "complained" });
    const [complained] = await pool.query<RowDataPacket[]>( // module-review-ok: reading back the scratch schema this suite provisioned
      "SELECT reason FROM comms_suppressions WHERE email_key = ?",
      [`hal-${PORT}@example.test`],
    );
    expect(complained).toEqual([{ reason: "complained" }]);

    // And a delivery report moves the founder's notice on, shown in Sent mail.
    const [delivered] = (await rowsFor("notify.immediate")).filter((r) => r.id === noticeId);
    const report = await fake!.deliverWebhook(WEBHOOK(), "delivered", { emailId: String(delivered.provider_message_id), secret: WEBHOOK_SECRET });
    expect(report.status, report.body).toBe(200);
    const detail = await call("GET", `/api/admin/comms/messages/${noticeId}`);
    expect(detail.json.message.status).toBe("delivered");
    expect(detail.json.reports.map((r: any) => r.type)).toContain("email.delivered");
  });
});
