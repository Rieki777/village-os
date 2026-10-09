/**
 * VILLAGE COMMS, THE JOURNEYS, DRIVEN THROUGH THE BUILT SERVER (the journeys
 * lane's e2e; the comms build spec 5.6 and section 8).
 *
 * Boots `dist/index.js` against a scratch schema with the scheduler off and
 * `RESEND_API_BASE` pointed at the fake provider (server/testkit/fakeResend.ts),
 * so not one email leaves this machine. Time is driven the way the spec says:
 * "run now" for the tick and the drain, and anchors moved in SQL.
 *
 *   - the Journeys routes answer the comms module's 404 while it is off;
 *   - every default journey is listed, off, with its count;
 *   - a journey that is off posts nothing on "run now";
 *   - turning it on adopts its words, and the next run posts the confirmation
 *     once, however often it runs;
 *   - a step edit makes version 2 while the person already on it keeps 1;
 *   - "Walk someone through it" names the emails the tick then sends, with
 *     the same subjects, at the moments it said;
 *   - Send me a test reaches the admin; Stop ends one person's journey;
 *   - a member who does not run comms is refused.
 *
 * The gathering and the person on it are seeded in SQL and enrolled through
 * the engine's own `enroll` from this process, against the same schema: the
 * triggers that enroll people belong to the event email lane.
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
import { enroll } from "./lib/comms/journeys";
import { upsertContact } from "./repos/commsContacts";
import { startFakeResend, type FakeResend } from "./testkit/fakeResend";

const DB_CONFIGURED = testDbConfigured();
if (!DB_CONFIGURED) {
  console.warn("[comms.journeys] TEST_DATABASE_URL not set - DB-backed tests SKIPPED.");
}

const DIST = path.resolve(process.cwd(), "dist/index.js");
// Its window is checked by scripts/check-e2e-ports.mjs, not claimed here.
const PORT = 1100 + (process.pid % 100);
const BASE = `http://localhost:${PORT}`;
const ADMIN = "comms-journeys-admin";
const PASSWORD = "CommsJourneys123!";
const FOUNDER_EMAIL = `founder-${PORT}@example.test`;
/** Short on purpose: a test key, never a credential, and the intake scan reads lengths. */
const PROVIDER_KEY = "re_test_lane_c1";
const SENDER = "Test Village <hello@village.example.test>";
const J = "/api/admin/comms/journeys";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

let child: ChildProcess | undefined;
let testDb: TestDb | undefined;
let fake: FakeResend | undefined;
let dataDir = "";
let pool: Pool;
const logs: string[] = [];

let founderToken = "";
let member = { token: "" };
const guest = { contactId: "", email: `guest-${PORT}@example.test`, enrollmentId: "", eventId: `ev-journeys-${PORT}` };
/** The walk-through taken before the reminders went, which the tick is held to. */
let walked: any = null;

interface Answer {
  status: number;
  json: any;
}

let ipSeq = 0;
async function call(method: string, route: string, opts: { body?: unknown; token?: string | null } = {}): Promise<Answer> {
  const token = opts.token === undefined ? founderToken : opts.token;
  const res = await fetch(BASE + route, { // module-review-ok: the test client dialling the built server on localhost, as every e2e suite does
    method,
    headers: {
      "Content-Type": "application/json",
      "X-Forwarded-For": `10.52.${Math.floor(++ipSeq / 250)}.${ipSeq % 250}`,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

const run = (job: "journeys" | "drain") => call("POST", "/api/admin/comms/run", { body: { job } });

/** The steps posted for the guest's enrollment, with what became of each. */
async function posted(): Promise<Array<{ step: string; status: string; subject: string; id: string }>> {
  const [rows] = await pool.query<RowDataPacket[]>( // module-review-ok: reading back the scratch schema this suite provisioned
    "SELECT id, step_key, status, subject FROM comms_messages WHERE enrollment_id = ?",
    [guest.enrollmentId],
  );
  const order = ["confirm", "day", "soon"];
  return rows
    .map((r) => ({ id: String(r.id), step: String(r.step_key), status: String(r.status), subject: String(r.subject) }))
    .sort((a, b) => order.indexOf(a.step) - order.indexOf(b.step));
}

/**
 * Move the gathering and the enrollment back by `ms`, which is the same as
 * moving the clock forward, and ask for a look now.
 */
async function shiftBack(ms: number): Promise<void> {
  const secs = Math.round(ms / 1000);
  await pool.query( // module-review-ok: moving an anchor in the scratch schema, the way the spec's suites drive time
    "UPDATE events SET starts_at = starts_at - INTERVAL ? SECOND, ends_at = ends_at - INTERVAL ? SECOND WHERE id = ?",
    [secs, secs, guest.eventId],
  );
  await pool.query( // module-review-ok: moving an anchor in the scratch schema, the way the spec's suites drive time
    "UPDATE comms_enrollments SET enrolled_at = enrolled_at - INTERVAL ? SECOND, next_check_at = CURRENT_TIMESTAMP - INTERVAL 1 SECOND WHERE id = ?",
    [secs, guest.enrollmentId],
  );
}

beforeAll(async () => {
  if (!DB_CONFIGURED) return;
  if (!fs.existsSync(DIST)) {
    throw new Error(`${DIST} is missing. Run \`pnpm build\` before the comms journeys test.`);
  }
  fake = await startFakeResend({ apiKey: PROVIDER_KEY });
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "village-comms-journeys-"));
  testDb = await provisionTestDb();
  pool = testPool(testDb, { connectionLimit: 4 });

  await waitForPortFree(PORT);
  child = spawn(process.execPath, [DIST], {
    env: {
      ...process.env,
      NODE_ENV: "production",
      PORT: String(PORT),
      // No background scheduler: "run now" drives the journeys here.
      SCHEDULER_ENABLED: "0",
      DATA_DIR: dataDir,
      DATABASE_URL: testDb.url,
      ADMIN_PASSWORD: ADMIN,
      // Short on purpose: a throwaway test value, and the intake scan reads lengths.
      AUTH_TOKEN_SECRET: "comms-c1-token",
      // The fake provider stands in for the real one. Nothing here can reach it.
      RESEND_API_BASE: fake.url,
      RESEND_API_KEY: PROVIDER_KEY,
      EMAIL_FROM: SENDER,
      ANTHROPIC_API_KEY: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.on("data", (d) => logs.push(String(d)));
  child.stderr?.on("data", (d) => logs.push(String(d)));
  await waitForHealth({ base: BASE, logs, child });

  const boot = await call("POST", "/api/admin/bootstrap", { body: { password: ADMIN, email: FOUNDER_EMAIL, name: "Journeys Founder" }, token: null });
  if (boot.status !== 200) throw new Error(`bootstrap: ${JSON.stringify(boot.json)}`);
  const claim = decodeURIComponent(String(boot.json?.claimUrl ?? "").match(/token=([^&]+)/)?.[1] ?? "");
  const setPw = await call("POST", "/api/auth/set-password", { body: { token: claim, password: PASSWORD }, token: null });
  founderToken = String(setPw.json?.token ?? "");
  if (!founderToken) throw new Error("the founder holds no session");
});

afterAll(async () => {
  child?.kill();
  await pool?.end();
  await fake?.close();
  if (dataDir && fs.existsSync(dataDir)) fs.rmSync(dataDir, { recursive: true, force: true });
  await testDb?.drop();
});

describe.skipIf(!DB_CONFIGURED)("Village Comms, the journeys", () => {
  it("answers the comms module's 404 on the Journeys routes while the module is off, and run now checks nothing", async () => {
    const off = await call("GET", J);
    expect(off.status, JSON.stringify(off.json)).toBe(404);
    expect(off.json).toMatchObject({ error: "module_disabled", module: "comms" });
    expect((await call("POST", `${J}/gathering.going/state`, { body: { state: "on" } })).status).toBe(404);
    const idle = await run("journeys");
    expect(idle.status, JSON.stringify(idle.json)).toBe(200);
    expect(idle.json.summary).toMatchObject({ checked: 0, posted: 0 });

    const on = await call("PUT", "/api/admin/modules/comms/lifecycle", { body: { lifecycle: "members", examples: false } });
    expect(on.status, JSON.stringify(on.json)).toBe(200);
  });

  it("lists every default journey, each off, with how many are on it", async () => {
    const list = await call("GET", J);
    expect(list.status, JSON.stringify(list.json)).toBe(200);
    const keys = list.json.journeys.map((j: any) => j.key);
    expect(keys).toEqual(expect.arrayContaining(["gathering.going", "gathering.host", "member.welcome", "joining.request", "path.resident", "path.investor"]));
    expect(list.json.journeys.every((j: any) => j.state === "off" && j.active === 0)).toBe(true);
    const going = list.json.journeys.find((j: any) => j.key === "gathering.going");
    expect(going.steps.map((s: any) => s.timing)).toEqual(["When they say yes", "1 day before it starts", "2 hours before it starts"]);
  });

  it("refuses a member who does not run comms, and somebody signed out", async () => {
    const reg = await call("POST", "/api/auth/register", {
      body: { name: "Mira Member", email: `mira-${PORT}@example.test`, password: "MemberPass123!", paths: ["resident"] },
      token: null,
    });
    expect(reg.status, JSON.stringify(reg.json)).toBe(200);
    member = { token: String(reg.json?.token ?? "") };
    expect((await call("GET", J, { token: member.token })).status).toBe(403);
    expect((await call("POST", `${J}/gathering.going/state`, { body: { state: "on" }, token: member.token })).status).toBe(403);
    expect((await call("GET", J, { token: null })).status).toBe(401);
  });

  it("posts nothing for a journey that is off, then on Turn on adopts its words and sends the confirmation once", async () => {
    const starts = new Date(Date.now() + 4 * DAY);
    await pool.query( // module-review-ok: seeding the scratch schema this suite provisioned
      "INSERT INTO events (id, title, starts_at, ends_at, status) VALUES (?, 'Seed swap', ?, ?, 'scheduled')",
      [guest.eventId, starts, new Date(starts.getTime() + 2 * HOUR)],
    );
    const contact = await upsertContact(pool, { id: `ct_journeys_${PORT}`, emailKey: guest.email, email: guest.email, name: "Gale Guest", userId: null, source: "test", timezone: null });
    guest.contactId = contact.id;
    const personKey = `guest:${contact.id}`;
    await pool.query( // module-review-ok: seeding the scratch schema this suite provisioned
      "INSERT INTO event_rsvps (id, event_id, user_id, status, idempotency_key, occurrence_key) VALUES (?, ?, ?, 'going', ?, '')",
      [`rs-journeys-${PORT}`, guest.eventId, personKey, `rsvp:${guest.eventId}:${personKey}`],
    );
    guest.enrollmentId = (await enroll({ getPool: () => pool }, { journeyKey: "gathering.going", contactId: contact.id, subjectRef: `event:${guest.eventId}:`, facts: { personKey } })).enrollmentId;

    const detail = await call("GET", `${J}/gathering.going`);
    expect(detail.status, JSON.stringify(detail.json)).toBe(200);
    expect(detail.json).toMatchObject({ state: "off", active: 1, followsDials: true });
    expect(detail.json.enrollments[0]).toMatchObject({ id: guest.enrollmentId, email: guest.email });

    const offRun = await run("journeys");
    expect(offRun.json.summary).toMatchObject({ checked: 1, posted: 0, waiting: 1 });
    expect(await posted()).toEqual([]);

    const on = await call("POST", `${J}/gathering.going/state`, { body: { state: "on" } });
    expect(on.status, JSON.stringify(on.json)).toBe(200);
    expect([...on.json.adopted].sort()).toEqual(["gathering.confirm", "gathering.reminder_day", "gathering.reminder_soon"]);
    const [words] = await pool.query<RowDataPacket[]>( // module-review-ok: reading back the scratch schema this suite provisioned
      "SELECT COUNT(*) AS n FROM comms_templates WHERE template_key LIKE 'gathering.%' AND state = 'live' AND platform_version = 1",
    );
    expect(Number(words[0].n)).toBe(3);

    const first = await run("journeys");
    expect(first.json.summary).toMatchObject({ posted: 1 });
    const second = await run("journeys");
    expect(second.json.summary).toMatchObject({ posted: 0 });
    const rows = await posted();
    expect(rows.map((r) => [r.step, r.status])).toEqual([["confirm", "sent"]]);
    expect(fake!.emails().filter((e) => e.idempotencyKey === rows[0].id)).toHaveLength(1);
  });

  it("an edit makes version 2, and the person already on it keeps version 1", async () => {
    const edit = await call("PUT", `${J}/gathering.going/steps/day`, { body: { offsetMinutes: -2880 } });
    expect(edit.status, JSON.stringify(edit.json)).toBe(200);
    expect(edit.json.version).toBe(2);
    const refused = await call("PUT", `${J}/gathering.going/steps/day`, { body: { audience: "came" } });
    expect(refused.status).toBe(400);
    expect(String(refused.json.error)).toContain("after a gathering ends");

    const detail = await call("GET", `${J}/gathering.going`);
    expect(detail.json).toMatchObject({ version: 2, own: true, followsDials: false });
    expect(detail.json.versions.map((v: any) => [v.version, v.active])).toEqual([
      [2, 0],
      [1, 1],
    ]);
    expect(detail.json.enrollments[0].version).toBe(1);
  });

  it("Walk someone through it names the emails the tick then sends, with the same subjects", async () => {
    const walk = await call("POST", `${J}/gathering.going/walk`, { body: { enrollmentId: guest.enrollmentId } });
    expect(walk.status, JSON.stringify(walk.json)).toBe(200);
    walked = walk.json;
    expect(walked.version).toBe(1);
    const plan = walked.steps.map((s: any) => [s.key, s.outcome, s.alreadySent]);
    expect(plan).toEqual([
      ["confirm", "sent", true],
      ["day", "sent", false],
      ["soon", "sent", false],
    ]);
    // Version 1's day-before reminder, not the edited two days before.
    const [ev] = await pool.query<RowDataPacket[]>( // module-review-ok: reading back the scratch schema this suite provisioned
      "SELECT UNIX_TIMESTAMP(starts_at) AS s FROM events WHERE id = ?",
      [guest.eventId],
    );
    const start = Number(ev[0].s) * 1000;
    const day = walked.steps.find((s: any) => s.key === "day");
    expect(new Date(day.sendsAt).getTime()).toBe(start - DAY);

    for (const key of ["day", "soon"]) {
      const step = walked.steps.find((s: any) => s.key === key);
      // The step's moment relative to the start, then the start as it stands now.
      const offset = new Date(step.sendsAt).getTime() - start;
      const [now] = await pool.query<RowDataPacket[]>( // module-review-ok: reading back the scratch schema this suite provisioned
        "SELECT UNIX_TIMESTAMP(starts_at) AS s FROM events WHERE id = ?",
        [guest.eventId],
      );
      // Move everything back until the step's moment is two minutes past, then run the tick and the drain.
      await shiftBack(Number(now[0].s) * 1000 + offset - Date.now() + 2 * 60_000);
      const tick = await run("journeys");
      expect(tick.json.summary, `${key} posted`).toMatchObject({ posted: 1 });
      await run("drain");
    }
    const rows = await posted();
    expect(rows.map((r) => r.step)).toEqual(walked.steps.map((s: any) => s.key));
    expect(rows.map((r) => r.subject)).toEqual(walked.steps.map((s: any) => s.subject));
    expect(rows.map((r) => r.status)).toEqual(["sent", "sent", "sent"]);
    const [state] = await pool.query<RowDataPacket[]>( // module-review-ok: reading back the scratch schema this suite provisioned
      "SELECT state FROM comms_enrollments WHERE id = ?",
      [guest.enrollmentId],
    );
    expect(state[0].state).toBe("finished");
  });

  it("walks a made-up person through a journey, and a real address with no journey yet", async () => {
    const made = await call("POST", `${J}/member.welcome/walk`, { body: { madeUp: { name: "Robin Example", timezone: "Asia/Tokyo" } } });
    expect(made.status, JSON.stringify(made.json)).toBe(200);
    expect(made.json.zone).toBe("Asia/Tokyo");
    expect(made.json.person).toMatchObject({ name: "Robin Example", email: null, madeUp: true });
    expect(made.json.steps.map((s: any) => s.key)).toEqual(["day0", "first_quest", "meet_us", "check_in"]);
    expect(made.json.steps.every((s: any) => s.outcome === "sent" && typeof s.subject === "string")).toBe(true);

    const real = await call("POST", `${J}/gathering.going/walk`, { body: { email: guest.email, subjectRef: `event:${guest.eventId}:` } });
    expect(real.status, JSON.stringify(real.json)).toBe(200);
    expect((await call("POST", `${J}/gathering.going/walk`, { body: { email: `nobody-${PORT}@example.test`, subjectRef: "event:x:" } })).status).toBe(404);
  });

  it("sends a step's test to the admin, and stops one person's journey", async () => {
    const test = await call("POST", `${J}/gathering.going/steps/confirm/test`, { body: {} });
    expect(test.status, JSON.stringify(test.json)).toBe(200);
    expect(test.json).toMatchObject({ status: "sent", sentTo: FOUNDER_EMAIL });
    const [row] = await pool.query<RowDataPacket[]>( // module-review-ok: reading back the scratch schema this suite provisioned
      "SELECT kind, origin, journey_key, step_key FROM comms_messages WHERE id = ?",
      [test.json.messageId],
    );
    expect(row[0]).toMatchObject({ kind: "essential", origin: "comms.test", journey_key: "gathering.going", step_key: "confirm" });

    const contact = await upsertContact(pool, { id: `ct_journeys_b_${PORT}`, emailKey: `second-${PORT}@example.test`, email: `second-${PORT}@example.test`, name: "Sam Second", userId: null, source: "test", timezone: null });
    const other = await enroll({ getPool: () => pool }, { journeyKey: "member.welcome", contactId: contact.id, subjectRef: "account" });
    const stop = await call("POST", `${J}/enrollments/${other.enrollmentId}/stop`, { body: {} });
    expect(stop.status, JSON.stringify(stop.json)).toBe(200);
    expect((await call("POST", `${J}/enrollments/${other.enrollmentId}/stop`, { body: {} })).status).toBe(404);
    const [stopped] = await pool.query<RowDataPacket[]>( // module-review-ok: reading back the scratch schema this suite provisioned
      "SELECT state, stop_reason FROM comms_enrollments WHERE id = ?",
      [other.enrollmentId],
    );
    expect(stopped[0]).toMatchObject({ state: "stopped", stop_reason: "stopped_by_admin" });
  });
});
