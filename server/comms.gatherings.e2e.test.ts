/**
 * VILLAGE COMMS, THE GATHERING EMAILS, DRIVEN THROUGH THE BUILT SERVER (the
 * event email lane's e2e; the comms build spec 5.7 and section 8).
 *
 * Boots `dist/index.js` against a scratch schema with the scheduler off and
 * `RESEND_API_BASE` pointed at the fake provider, so not one email leaves this
 * machine. Then, through real routes and the triggers they fire:
 *
 *   - a yes posts the confirmation with an `.ics` whose UID and SEQUENCE are
 *     right, once however often the yes comes;
 *   - the join link redirects to the room the gathering has now;
 *   - moving the time posts "changed" once, SEQUENCE+1, and re-plans;
 *   - the waitlist notices fire, and "can't make it" from the email frees the
 *     seat and promotes the next person;
 *   - reminders off writes the skip every enrollment's planner reads;
 *   - cancelling posts one notice to everyone going or waiting, METHOD:CANCEL,
 *     and nothing after.
 *
 * WHAT THIS LANE CANNOT SHOW ALONE. The reminders themselves are posted by the
 * journey engine's tick (the journeys lane). Here "re-plans" is the touch that
 * makes the tick plan again, and "reminders off" is the skip written where the
 * planner reads it; the composed tree proves the tick honours both.
 *
 * Run `pnpm build` first: this boots the BUILT server. Skips loudly without
 * TEST_DATABASE_URL. The cases run IN ORDER and build on each other.
 */
import fs from "fs";
import os from "os";
import path from "path";
import ICAL from "ical.js";
import type { Pool, RowDataPacket } from "mysql2/promise";
import { spawn, type ChildProcess } from "child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { waitForHealth } from "./db/e2eBoot";
import { provisionTestDb, testDbConfigured, testPool, type TestDb, waitForPortFree } from "./db/testDb";
import { makeWebhookSecret, startFakeResend, type FakeResend } from "./testkit/fakeResend";

const DB_CONFIGURED = testDbConfigured();
if (!DB_CONFIGURED) {
  console.warn("[comms.gatherings] TEST_DATABASE_URL not set - DB-backed tests SKIPPED.");
}

const DIST = path.resolve(process.cwd(), "dist/index.js");
// Its window is checked by scripts/check-e2e-ports.mjs, not claimed here.
const PORT = 1100 + (process.pid % 100);
const BASE = `http://localhost:${PORT}`;
const HOST = `localhost:${PORT}`;
const ADMIN = "comms-gatherings-admin";
const PASSWORD = "CommsGatherings123!";
const FOUNDER_EMAIL = `founder-${PORT}@example.test`;
/** Short on purpose: a test key, never a credential, and the intake scan reads lengths. */
const PROVIDER_KEY = "re_test_lane_c2";
const SENDER = "Test Village <hello@village.example.test>";

let child: ChildProcess | undefined;
let testDb: TestDb | undefined;
let fake: FakeResend | undefined;
let dataDir = "";
let pool: Pool;
const logs: string[] = [];

let founderToken = "";
const people: Record<string, { token: string; id: string; email: string }> = {};
let supper = "";

interface Answer {
  status: number;
  json: any;
  location?: string | null;
}

let ipSeq = 0;
async function call(method: string, route: string, opts: { body?: unknown; token?: string | null } = {}): Promise<Answer> {
  const token = opts.token === undefined ? founderToken : opts.token;
  const res = await fetch(BASE + route, { // module-review-ok: the test client dialling the built server on localhost, as every e2e suite does
    method,
    redirect: "manual",
    headers: {
      "Content-Type": "application/json",
      "X-Forwarded-For": `10.52.${Math.floor(++ipSeq / 250)}.${ipSeq % 250}`,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  return { status: res.status, json: await res.json().catch(() => null), location: res.headers.get("location") };
}

const settle = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitUntil(what: string, ok: () => Promise<boolean> | boolean, ms = 15_000): Promise<void> {
  const deadline = Date.now() + ms;
  for (;;) {
    if (await ok()) return;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await settle(150);
  }
}

async function rowsFor(origin: string): Promise<RowDataPacket[]> {
  const [rows] = await pool.query<RowDataPacket[]>( // module-review-ok: reading back the scratch schema this suite provisioned
    "SELECT id, idempotency_key, to_email, status, step_key, enrollment_id FROM comms_messages WHERE origin = ? ORDER BY created_at, id",
    [origin],
  );
  return rows;
}

/** The emails the fake provider accepted for one address, with a subject matching. */
const mailTo = (email: string, subject: RegExp) => fake!.emails().filter((e) => (e.body.to as string[]).includes(email) && subject.test(String(e.body.subject)));

function icsOf(mail: { body: any } | undefined) {
  const a = mail?.body?.attachments?.[0];
  if (!a) return null;
  const cal = new ICAL.Component(ICAL.parse(Buffer.from(String(a.content), "base64").toString("utf8")));
  const ev = cal.getFirstSubcomponent("vevent")!;
  return { method: cal.getFirstPropertyValue("method"), uid: ev.getFirstPropertyValue("uid"), sequence: ev.getFirstPropertyValue("sequence"), type: a.content_type };
}

const inDays = (d: number, h = 0) => new Date(Date.now() + d * 86_400_000 + h * 3_600_000).toISOString();

async function register(key: string): Promise<void> {
  const email = `${key}-${PORT}@example.test`;
  const reg = await call("POST", "/api/auth/register", { body: { name: `${key[0].toUpperCase()}${key.slice(1)} Member`, email, password: "MemberPass123!", paths: ["resident"] }, token: null });
  expect(reg.status, JSON.stringify(reg.json)).toBe(200);
  people[key] = { token: String(reg.json?.token ?? ""), id: String(reg.json?.user?.id ?? ""), email };
}

async function gathering(over: Record<string, unknown> = {}): Promise<string> {
  const made = await call("POST", "/api/admin/events", {
    body: {
      title: "Community supper",
      startsAt: inDays(3),
      endsAt: inDays(3, 2),
      status: "scheduled",
      layer: "public",
      locationText: "The common house",
      attendanceMode: "mixed",
      onlineUrl: "https://meet.example.test/room-1",
      capacity: 1,
      ...over,
    },
  });
  expect(made.status, JSON.stringify(made.json)).toBe(200);
  return String(made.json.event.id);
}

beforeAll(async () => {
  if (!DB_CONFIGURED) return;
  if (!fs.existsSync(DIST)) {
    throw new Error(`${DIST} is missing. Run \`pnpm build\` before the comms gatherings test.`);
  }
  fake = await startFakeResend({ apiKey: PROVIDER_KEY });
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "village-comms-gatherings-"));
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
      AUTH_TOKEN_SECRET: "comms-c2-token",
      RESEND_API_BASE: fake.url,
      RESEND_API_KEY: PROVIDER_KEY,
      EMAIL_FROM: SENDER,
      RESEND_WEBHOOK_SECRET: makeWebhookSecret(),
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

describe.skipIf(!DB_CONFIGURED)("Village Comms, the gathering emails", () => {
  it("sets up a live village: a founder, the calendar open to everyone, comms live, and the gathering journey on", async () => {
    const boot = await call("POST", "/api/admin/bootstrap", { body: { password: ADMIN, email: FOUNDER_EMAIL, name: "Gathering Founder" }, token: null });
    expect(boot.status, JSON.stringify(boot.json)).toBe(200);
    const claim = decodeURIComponent(String(boot.json?.claimUrl ?? "").match(/token=([^&]+)/)?.[1] ?? "");
    const setPw = await call("POST", "/api/auth/set-password", { body: { token: claim, password: PASSWORD }, token: null });
    founderToken = String(setPw.json?.token ?? "");
    expect(founderToken).toBeTruthy();
    expect((await call("PUT", "/api/admin/modules/events/lifecycle", { body: { lifecycle: "public", examples: false } })).status).toBe(200);
    expect((await call("PUT", "/api/admin/modules/comms/lifecycle", { body: { lifecycle: "members", examples: false } })).status).toBe(200);
    // The Journeys screen's Turn on, which the journeys lane builds.
    await pool.query( // module-review-ok: seeding the scratch schema this suite provisioned
      "INSERT INTO comms_journeys (village_id, journey_key, state, version) VALUES ('local', 'gathering.going', 'on', 1)",
    );
    for (const key of ["ana", "ben", "cai", "dee"]) await register(key);
  });

  it("RSVP posts the confirmation with an .ics whose UID and SEQUENCE are right, and a retried trigger sends once", async () => {
    supper = await gathering();
    const yes = await call("POST", `/api/events/${supper}/rsvp`, { body: { status: "going" }, token: people.ana.token });
    expect(yes.status, JSON.stringify(yes.json)).toBe(200);
    await waitUntil("the confirmation", async () => (await rowsFor("journey")).some((r) => r.status === "sent"));
    const [row] = await rowsFor("journey");
    expect(row).toMatchObject({ to_email: people.ana.email, step_key: "confirm" });
    expect(row.idempotency_key).toBe(`j:gathering.going:confirm:${row.enrollment_id}`);
    const mail = mailTo(people.ana.email, /You're coming to Community supper/);
    expect(mail).toHaveLength(1);
    expect(icsOf(mail[0])).toMatchObject({ method: "REQUEST", uid: `${supper}-@${HOST}`, sequence: 0 });
    expect(String(mail[0].body.html)).toContain("calendar.google.com");
    expect(String(mail[0].body.html)).toContain(`/api/events/${supper}/join`);

    // The same yes again fires the same trigger again.
    expect((await call("POST", `/api/events/${supper}/rsvp`, { body: { status: "going" }, token: people.ana.token })).status).toBe(200);
    await settle(600);
    expect(await rowsFor("journey")).toHaveLength(1);
    expect(mailTo(people.ana.email, /You're coming to/)).toHaveLength(1);
  });

  it("the join link redirects to the current room", async () => {
    const first = await call("GET", `/api/events/${supper}/join`, { token: null });
    expect(first.status).toBe(302);
    expect(first.location).toBe("https://meet.example.test/room-1");
    expect((await call("PUT", `/api/admin/events/${supper}`, { body: { onlineUrl: "https://meet.example.test/room-2" } })).status).toBe(200);
    const moved = await call("GET", `/api/events/${supper}/join`, { token: null });
    expect(moved.location).toBe("https://meet.example.test/room-2");
    expect((await call("GET", "/api/events/ev-nothing/join", { token: null })).status).toBe(404);
  });

  it("changing the time posts changed once with SEQUENCE+1, and re-plans the reminders", async () => {
    await pool.query( // module-review-ok: the scratch schema: the tick has planned and will look again tomorrow
      "UPDATE comms_enrollments SET next_check_at = DATE_ADD(CURRENT_TIMESTAMP, INTERVAL 1 DAY) WHERE subject_ref LIKE ?",
      [`event:${supper}:%`],
    );
    expect((await call("PUT", `/api/admin/events/${supper}`, { body: { startsAt: inDays(4), endsAt: inDays(4, 2) } })).status).toBe(200);
    await waitUntil("the change notice", async () => (await rowsFor("event.changed")).length === 1);
    const replanned = await pool.query<RowDataPacket[]>( // module-review-ok: reading back the scratch schema
      "SELECT COUNT(*) AS n FROM comms_enrollments WHERE subject_ref LIKE ? AND state = 'active' AND next_check_at <= CURRENT_TIMESTAMP",
      [`event:${supper}:%`],
    );
    expect(Number(replanned[0][0].n), "the guest and the host plan again on the next tick").toBeGreaterThanOrEqual(2);
    expect((await call("POST", "/api/admin/comms/run", { body: { job: "drain" } })).status).toBe(200);
    const mail = mailTo(people.ana.email, /^Changed: Community supper/);
    expect(mail).toHaveLength(1);
    expect(icsOf(mail[0])).toMatchObject({ method: "REQUEST", uid: `${supper}-@${HOST}`, sequence: 1 });
    // Saving what is already there changes nothing.
    expect((await call("PUT", `/api/admin/events/${supper}`, { body: { title: "Community supper" } })).status).toBe(200);
    await settle(600);
    expect(await rowsFor("event.changed")).toHaveLength(1);
  });

  it("the waitlist notices fire, and can't make it frees the seat and promotes the next person", async () => {
    const queued = await call("POST", `/api/events/${supper}/waitlist`, { body: {}, token: people.ben.token });
    expect(queued.status, JSON.stringify(queued.json)).toBe(200);
    await waitUntil("the waitlist notice", () => mailTo(people.ben.email, /waitlist for Community supper/).length === 1);

    const [confirm] = mailTo(people.ana.email, /You're coming to/);
    const token = decodeURIComponent(/\/email\/a\?t=([^"&\s)]+)/.exec(String(confirm.body.html))?.[1] ?? "");
    expect(token, "the confirmation carries a can't make it link").toBeTruthy();
    const page = await call("GET", `/api/comms/action?t=${encodeURIComponent(token)}`, { token: null });
    expect(page.status, JSON.stringify(page.json)).toBe(200);
    expect(page.json).toMatchObject({ purpose: "cant_make_it", description: { title: "Can't make it to Community supper?" } });
    const pressed = await call("POST", `/api/comms/action?t=${encodeURIComponent(token)}`, { body: { choice: "cant" }, token: null });
    expect(pressed.status, JSON.stringify(pressed.json)).toBe(200);
    expect(pressed.json.outcome.title).toBe("Seat given back");

    await waitUntil("the promotion notice", () => mailTo(people.ben.email, /seat opened at Community supper/).length === 1);
    const promoted = mailTo(people.ben.email, /seat opened/)[0];
    expect(icsOf(promoted)).toMatchObject({ method: "REQUEST", uid: `${supper}-@${HOST}` });
    const [going] = await pool.query<RowDataPacket[]>( // module-review-ok: reading back the scratch schema
      "SELECT user_id FROM event_rsvps WHERE event_id = ? AND status = 'going'",
      [supper],
    );
    expect(going.map((r) => r.user_id)).toEqual([people.ben.id]);
    await settle(400);
    // The promotion was the confirmation: no second one follows it.
    expect(mailTo(people.ben.email, /You're coming to/)).toHaveLength(0);
  });

  it("reminders off writes the skip every enrollment's planner reads, and only an organiser may set it", async () => {
    expect((await call("PUT", `/api/events/${supper}/comms`, { body: { reminders: { mode: "off" } }, token: people.cai.token })).status).toBe(403);
    expect((await call("GET", `/api/events/${supper}/comms`, { token: null })).status).toBe(401);
    const off = await call("PUT", `/api/events/${supper}/comms`, { body: { reminders: { mode: "off" } } });
    expect(off.status, JSON.stringify(off.json)).toBe(200);
    expect(off.json.settings).toMatchObject({ reminders: { mode: "off" }, effective: { reminderMinutes: [] } });
    const [enrs] = await pool.query<RowDataPacket[]>( // module-review-ok: reading back the scratch schema
      "SELECT facts FROM comms_enrollments WHERE journey_key = 'gathering.going' AND subject_ref = ? AND state = 'active'",
      [`event:${supper}:`],
    );
    expect(enrs.length).toBe(1);
    const facts = typeof enrs[0].facts === "string" ? JSON.parse(enrs[0].facts) : enrs[0].facts;
    expect(facts.stepOverrides).toMatchObject({ day: { skip: true }, soon: { skip: true } });
    // The tick runs (the journeys lane's), then the drain: no reminder goes.
    await call("POST", "/api/admin/comms/run", { body: { job: "journeys" } });
    await call("POST", "/api/admin/comms/run", { body: { job: "drain" } });
    const reminders = (await rowsFor("journey")).filter((r) => r.step_key === "day" || r.step_key === "soon");
    expect(reminders).toEqual([]);
  });

  it("cancelling posts one notice with METHOD:CANCEL to going and waitlisted, and nothing after", async () => {
    const evening = await gathering({ title: "Seed swap" });
    expect((await call("POST", `/api/events/${evening}/rsvp`, { body: { status: "going" }, token: people.cai.token })).status).toBe(200);
    expect((await call("POST", `/api/events/${evening}/waitlist`, { body: {}, token: people.dee.token })).status).toBe(200);
    await waitUntil("the two first notices", () => mailTo(people.cai.email, /Seed swap/).length === 1 && mailTo(people.dee.email, /Seed swap/).length === 1);

    expect((await call("PUT", `/api/admin/events/${evening}`, { body: { status: "cancelled" } })).status).toBe(200);
    await waitUntil("two cancellation notices", async () => (await rowsFor("event.cancelled")).length === 2);
    await call("POST", "/api/admin/comms/run", { body: { job: "drain" } });
    for (const who of [people.cai.email, people.dee.email]) {
      const mail = mailTo(who, /^Cancelled: Seed swap/);
      expect(mail, who).toHaveLength(1);
      expect(icsOf(mail[0])).toMatchObject({ method: "CANCEL", uid: `${evening}-@${HOST}`, sequence: 1 });
    }
    const before = fake!.emails().length;
    await call("POST", "/api/admin/comms/run", { body: { job: "journeys" } });
    await call("POST", "/api/admin/comms/run", { body: { job: "drain" } });
    await settle(400);
    expect(fake!.emails().length, "nothing after the cancellation").toBe(before);
    const [states] = await pool.query<RowDataPacket[]>( // module-review-ok: reading back the scratch schema
      "SELECT DISTINCT state FROM comms_enrollments WHERE subject_ref = ?",
      [`event:${evening}:`],
    );
    expect(states.map((s) => s.state)).toEqual(["stopped"]);
  });
});
