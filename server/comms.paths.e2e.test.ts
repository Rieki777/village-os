/**
 * VILLAGE COMMS, THE PATHS, DRIVEN THROUGH THE BUILT SERVER (the paths lane's
 * e2e; the comms build spec 5.11 and section 8).
 *
 * Boots `dist/index.js` against a scratch schema with the scheduler off and
 * `RESEND_API_BASE` pointed at the fake provider (server/testkit/fakeResend.ts),
 * so not one email leaves this machine. Everything a person does goes through
 * the real public routes (the forms, the housing request, the investor
 * packet, sign-up, the profile); time is driven the way the spec says, "run
 * now" for the tick and the drain, and anchors moved in SQL. The reader's
 * zone is set in SQL to one where it is day, or night, at the moment the test
 * runs, so the daytime rule is proven whatever hour the suite runs at.
 *
 *   - the consent words are served while the module is on, and not while off;
 *   - a public form with the box ticked enrolls and posts the welcome;
 *   - with it unticked, only the acknowledgement;
 *   - day 2 lands inside daytime hours in the reader's zone;
 *   - day 21 notifies the path contact;
 *   - leaving the path stops it;
 *   - reserving housing stops the resident journey;
 *   - admission stops the joining journey;
 *   - backfilled members get nothing, until an admin includes them;
 *   - the investor journey sends only the welcome and the hand-off until its
 *     words are reviewed.
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
import { usersRepo } from "./repos/users";
import { startFakeResend, type FakeResend } from "./testkit/fakeResend";

const DB_CONFIGURED = testDbConfigured();
if (!DB_CONFIGURED) {
  console.warn("[comms.paths] TEST_DATABASE_URL not set - DB-backed tests SKIPPED.");
}

const DIST = path.resolve(process.cwd(), "dist/index.js");
// Its window is checked by scripts/check-e2e-ports.mjs, not claimed here.
const PORT = 3600 + (process.pid % 50);
const BASE = `http://localhost:${PORT}`;
const ADMIN = "comms-paths-admin";
const PASSWORD = "CommsPaths123!";
const FOUNDER_EMAIL = `founder-${PORT}@example.test`;
/** Short on purpose: a test key, never a credential, and the intake scan reads lengths. */
const PROVIDER_KEY = "re_test_lane_d1";
const SENDER = "Test Village <hello@village.example.test>";
const J = "/api/admin/comms/journeys";

const DAY_S = 86_400;

let child: ChildProcess | undefined;
let testDb: TestDb | undefined;
let fake: FakeResend | undefined;
let dataDir = "";
let pool: Pool;
const logs: string[] = [];

let founderToken = "";
let founderId = "";
/** A member already on the steward path when the server first booted. */
const early = { id: `paths-early-${PORT}`, email: `early-${PORT}@example.test` };
const rowan = { email: `rowan-${PORT}@example.test`, contactId: "", enrollmentId: "" };

let ipSeq = 0;
async function call(method: string, route: string, opts: { body?: unknown; token?: string | null } = {}): Promise<{ status: number; json: any }> {
  const token = opts.token === undefined ? founderToken : opts.token;
  const res = await fetch(BASE + route, { // module-review-ok: the test client dialling the built server on localhost, as every e2e suite does
    method,
    headers: {
      "Content-Type": "application/json",
      "X-Forwarded-For": `10.61.${Math.floor(++ipSeq / 250)}.${ipSeq % 250}`,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

const run = (job: "journeys" | "drain") => call("POST", "/api/admin/comms/run", { body: { job } });

async function rows(sql: string, params: unknown[] = []): Promise<RowDataPacket[]> {
  const [r] = await pool.query<RowDataPacket[]>(sql, params); // module-review-ok: reading back the scratch schema this suite provisioned
  return r;
}

/** Poll until `probe` answers something truthy: the sink runs after the response. */
async function waitFor<T>(what: string, probe: () => Promise<T | null | undefined | false>, ms = 8000): Promise<T> {
  const until = Date.now() + ms;
  for (;;) {
    const got = await probe();
    if (got) return got as T;
    if (Date.now() > until) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

/** One person's enrollment on one journey, by address. */
async function enrollment(email: string, journeyKey: string): Promise<RowDataPacket | null> {
  const r = await rows(
    "SELECT e.id, e.state, e.stop_reason, e.subject_ref, e.contact_id, UNIX_TIMESTAMP(e.next_check_at) AS next_at " +
      "FROM comms_enrollments e JOIN comms_contacts c ON c.id = e.contact_id WHERE c.email_key = ? AND e.journey_key = ?",
    [email.toLowerCase(), journeyKey],
  );
  return r[0] ?? null;
}

/** The steps posted for one enrollment, with what became of each. */
async function stepsPosted(enrollmentId: string): Promise<Record<string, string>> {
  const r = await rows("SELECT step_key, status FROM comms_messages WHERE enrollment_id = ?", [enrollmentId]);
  return Object.fromEntries(r.map((x) => [String(x.step_key), String(x.status)]));
}

/** A zone where it is now about `hour` o'clock, from the fixed-offset zones. */
function zoneAtLocalHour(hour: number): string {
  let k = (((hour - new Date().getUTCHours()) % 24) + 24) % 24;
  if (k > 14) k -= 24;
  return k === 0 ? "Etc/UTC" : `Etc/GMT${k > 0 ? "-" : "+"}${Math.abs(k)}`;
}

const hourIn = (epochSeconds: number, zone: string): number =>
  Number(new Intl.DateTimeFormat("en-GB", { timeZone: zone, hour: "2-digit", hourCycle: "h23" }).format(new Date(epochSeconds * 1000)));

async function setZone(contactId: string, zone: string): Promise<void> {
  await pool.query("UPDATE comms_contacts SET timezone = ? WHERE id = ?", [zone, contactId]); // module-review-ok: setting the reader's zone in the scratch schema
}

/** Date one enrollment back by `days` (plus a minute) and ask for a look now. */
async function startedDaysAgo(enrollmentId: string, days: number): Promise<void> {
  await pool.query( // module-review-ok: moving an anchor in the scratch schema, the way the spec's suites drive time
    "UPDATE comms_enrollments SET enrolled_at = CURRENT_TIMESTAMP - INTERVAL ? SECOND, next_check_at = CURRENT_TIMESTAMP - INTERVAL 1 SECOND WHERE id = ?",
    [days * DAY_S + 60, enrollmentId],
  );
}

async function lookNow(enrollmentId: string): Promise<void> {
  await pool.query("UPDATE comms_enrollments SET next_check_at = CURRENT_TIMESTAMP - INTERVAL 1 SECOND WHERE id = ?", [enrollmentId]); // module-review-ok: asking for a look in the scratch schema
}

beforeAll(async () => {
  if (!DB_CONFIGURED) return;
  if (!fs.existsSync(DIST)) {
    throw new Error(`${DIST} is missing. Run \`pnpm build\` before the comms paths test.`);
  }
  fake = await startFakeResend({ apiKey: PROVIDER_KEY });
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "village-comms-paths-"));
  testDb = await provisionTestDb();
  pool = testPool(testDb, { connectionLimit: 4 });
  // On the steward path before the server ever ran: the boot's backfill finds them.
  await usersRepo(pool).add({ id: early.id, name: "Ember Early", email: early.email, passwordHash: "x", paths: ["steward"], prefs: {} });

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
      AUTH_TOKEN_SECRET: "comms-d1-token",
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

  const boot = await call("POST", "/api/admin/bootstrap", { body: { password: ADMIN, email: FOUNDER_EMAIL, name: "Paths Founder" }, token: null });
  if (boot.status !== 200) throw new Error(`bootstrap: ${JSON.stringify(boot.json)}`);
  const claim = decodeURIComponent(String(boot.json?.claimUrl ?? "").match(/token=([^&]+)/)?.[1] ?? "");
  const setPw = await call("POST", "/api/auth/set-password", { body: { token: claim, password: PASSWORD }, token: null });
  founderToken = String(setPw.json?.token ?? "");
  if (!founderToken) throw new Error("the founder holds no session");
  founderId = String((await rows("SELECT id FROM users WHERE email = ?", [FOUNDER_EMAIL]))[0]?.id ?? "");
});

afterAll(async () => {
  child?.kill();
  await pool?.end();
  await fake?.close();
  if (dataDir && fs.existsSync(dataDir)) fs.rmSync(dataDir, { recursive: true, force: true });
  await testDb?.drop();
});

describe.skipIf(!DB_CONFIGURED)("Village Comms, the paths", () => {
  it("draws no consent box while the module is off, and the village's words once it is on", async () => {
    const off = await call("GET", "/api/comms/consent", { token: null });
    expect(off.status, JSON.stringify(off.json)).toBe(200);
    expect(off.json).toEqual({ show: false, text: "" });

    const on = await call("PUT", "/api/admin/modules/comms/lifecycle", { body: { lifecycle: "members", examples: false } });
    expect(on.status, JSON.stringify(on.json)).toBe(200);
    const shown = await call("GET", "/api/comms/consent", { token: null });
    expect(shown.json.show).toBe(true);
    expect(shown.json.text).toMatch(/^Walk me through the next steps by email\./);

    for (const key of ["path.steward", "path.resident", "path.investor", "joining.request"]) {
      const turned = await call("POST", `${J}/${key}/state`, { body: { state: "on" } });
      expect(turned.status, `${key}: ${JSON.stringify(turned.json)}`).toBe(200);
    }
  });

  it("a public form with the box ticked enrolls and posts the welcome", async () => {
    const sent = await call("POST", "/api/forms/submit", {
      body: { type: "steward-interest", data: { name: "Rowan Ticker", email: rowan.email, gifts: "", question: "", commsConsent: true } },
      token: null,
    });
    expect(sent.status, JSON.stringify(sent.json)).toBe(200);
    const e = await waitFor("the steward journey", () => enrollment(rowan.email, "path.steward"));
    expect(e).toMatchObject({ state: "active", subject_ref: "path:steward" });
    rowan.contactId = String(e.contact_id);
    rowan.enrollmentId = String(e.id);
    const [perm] = await rows("SELECT state, basis, evidence FROM comms_permissions WHERE contact_id = ? AND kind = 'paths'", [rowan.contactId]);
    expect(perm).toMatchObject({ state: "yes", basis: "asked" });
    expect(JSON.stringify(perm.evidence)).toContain("steward-interest");

    await setZone(rowan.contactId, zoneAtLocalHour(12));
    const tick = await run("journeys");
    expect(tick.status, JSON.stringify(tick.json)).toBe(200);
    await run("drain");
    expect(await stepsPosted(rowan.enrollmentId)).toEqual({ welcome: "sent" });
    const [msg] = await rows("SELECT id, subject FROM comms_messages WHERE enrollment_id = ? AND step_key = 'welcome'", [rowan.enrollmentId]);
    expect(fake!.emails().filter((m) => m.idempotencyKey === msg.id)).toHaveLength(1);
    expect(String(msg.subject)).toContain("Village Steward");
  });

  it("with the box unticked, sends only the acknowledgement", async () => {
    const email = `quiet-${PORT}@example.test`;
    const sent = await call("POST", "/api/forms/submit", {
      body: { type: "work-with-us", data: { name: "Quinn Quiet", email, commsConsent: false } },
      token: null,
    });
    expect(sent.status, JSON.stringify(sent.json)).toBe(200);
    const ack = await waitFor("the acknowledgement", async () =>
      (await rows("SELECT origin, kind FROM comms_messages WHERE to_email = ?", [email]))[0],
    );
    expect(ack).toMatchObject({ origin: "forms.ack", kind: "essential" });
    await new Promise((r) => setTimeout(r, 300));
    expect(await rows("SELECT e.id FROM comms_enrollments e JOIN comms_contacts c ON c.id = e.contact_id WHERE c.email_key = ?", [email])).toHaveLength(0);
    expect(await rows("SELECT p.kind FROM comms_permissions p JOIN comms_contacts c ON c.id = p.contact_id WHERE c.email_key = ? AND p.kind = 'paths'", [email])).toHaveLength(0);
    expect(await rows("SELECT id FROM path_enrollments WHERE source = 'work-with-us'")).toHaveLength(0);
    expect((await rows("SELECT origin FROM comms_messages WHERE to_email = ?", [email])).map((r) => r.origin)).toEqual(["forms.ack"]);
  });

  it("day 2 lands inside daytime hours in the reader's zone", async () => {
    const night = zoneAtLocalHour(3);
    await setZone(rowan.contactId, night);
    await startedDaysAgo(rowan.enrollmentId, 2);
    await run("journeys");
    expect(await stepsPosted(rowan.enrollmentId)).toEqual({ welcome: "sent" });
    const waiting = await enrollment(rowan.email, "path.steward");
    // It waits for the morning where they are: the start of the quiet hours dial.
    expect(hourIn(Number(waiting!.next_at), night)).toBe(8);

    const day = zoneAtLocalHour(12);
    await setZone(rowan.contactId, day);
    await lookNow(rowan.enrollmentId);
    await run("journeys");
    expect(await stepsPosted(rowan.enrollmentId)).toEqual({ welcome: "sent", first_step: "queued" });
    const [row] = await rows("SELECT UNIX_TIMESTAMP(created_at) AS at FROM comms_messages WHERE enrollment_id = ? AND step_key = 'first_step'", [rowan.enrollmentId]);
    const hour = hourIn(Number(row.at), day);
    expect(hour).toBeGreaterThanOrEqual(8);
    expect(hour).toBeLessThan(20);
  });

  it("day 21 notifies the path contact by first name, with a link to People", async () => {
    const set = await call("PUT", "/api/admin/comms/settings", { body: { pathContacts: { steward: founderId } } });
    expect(set.status, JSON.stringify(set.json)).toBe(200);
    await startedDaysAgo(rowan.enrollmentId, 21);
    await run("journeys");
    expect((await stepsPosted(rowan.enrollmentId)).check_in).toBeDefined();
    const notes = await rows("SELECT type, title, link, dedupe_key FROM notifications WHERE user_id = ? AND type = 'comms_path_handoff'", [founderId]);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({
      link: `/admin?tab=comms-people&person=${rowan.contactId}`,
      dedupe_key: `comms_path_handoff:${rowan.enrollmentId}`,
    });
    expect(String(notes[0].title)).toBe("Rowan has been on the Village Steward path for three weeks. Write to them.");
    expect((await enrollment(rowan.email, "path.steward"))!.state).toBe("finished");
  });

  it("leaving the path stops its journey", async () => {
    const email = `leaver-${PORT}@example.test`;
    const reg = await call("POST", "/api/auth/register", {
      body: { name: "Lee Leaver", email, password: "LeaverPass123!", paths: ["resident"] },
      token: null,
    });
    expect(reg.status, JSON.stringify(reg.json)).toBe(200);
    const token = String(reg.json?.token ?? "");
    await waitFor("the resident journey", () => enrollment(email, "path.resident"));
    const moved = await call("PUT", "/api/profile", { body: { paths: ["steward"] }, token });
    expect(moved.status, JSON.stringify(moved.json)).toBe(200);
    const stopped = await waitFor("the stop", async () => {
      const e = await enrollment(email, "path.resident");
      return e?.state === "stopped" ? e : null;
    });
    expect(stopped.stop_reason).toBe("left_path");
    const [row] = await rows("SELECT state, left_at FROM path_enrollments WHERE path_id = 'resident' AND user_id = (SELECT id FROM users WHERE email = ?)", [email]);
    expect(row.state).toBe("left");
    expect(row.left_at).not.toBeNull();
    expect(await waitFor("the steward journey", () => enrollment(email, "path.steward"))).toMatchObject({ state: "active" });
  });

  it("reserving housing stops the resident journey", async () => {
    const email = `home-${PORT}@example.test`;
    const asked = await call("POST", "/api/housing/reservations", {
      body: { homeType: "casita", name: "Hana Home", email, commsConsent: true },
      token: null,
    });
    expect(asked.status, JSON.stringify(asked.json)).toBe(200);
    await waitFor("the resident journey", () => enrollment(email, "path.resident"));
    const [res] = await rows("SELECT id FROM housing_reservations WHERE email = ?", [email]);
    const reserved = await call("PUT", `/api/housing/reservations/${res.id}/status`, { body: { status: "reserved" } });
    expect(reserved.status, JSON.stringify(reserved.json)).toBe(200);
    const stopped = await waitFor("the stop", async () => {
      const e = await enrollment(email, "path.resident");
      return e?.state === "stopped" ? e : null;
    });
    expect(stopped.stop_reason).toBe("resident_reserved");
    const [row] = await rows("SELECT state, done_at FROM path_enrollments WHERE path_id = 'resident' AND contact_id = ?", [stopped.contact_id]);
    expect(row.state).toBe("done");
    expect(row.done_at).not.toBeNull();
  });

  it("admission stops the joining journey", async () => {
    const email = `asker-${PORT}@example.test`;
    const asked = await call("POST", "/api/forms/submit", {
      body: { type: "membership-request", data: { name: "Ash Asker", email, why: "The gardens", commsConsent: true } },
      token: null,
    });
    expect(asked.status, JSON.stringify(asked.json)).toBe(200);
    const joining = await waitFor("the joining journey", () => enrollment(email, "joining.request"));
    expect(joining.subject_ref).toBe(`form:${asked.json.id}`);

    const reg = await call("POST", "/api/auth/register", { body: { name: "Ash Asker", email, password: "AskerPass123!", paths: [] }, token: null });
    expect(reg.status, JSON.stringify(reg.json)).toBe(200);
    const letter = await call("POST", "/api/forms/submit", {
      body: { type: "membership-508", data: { name: "Ash Asker", email } },
      token: String(reg.json?.token ?? ""),
    });
    expect(letter.status, JSON.stringify(letter.json)).toBe(200);
    const accepted = await call("PUT", `/api/admin/submissions/${letter.json.id}/status`, { body: { status: "accepted" } });
    expect(accepted.status, JSON.stringify(accepted.json)).toBe(200);
    const stopped = await waitFor("the stop", async () => {
      const e = await enrollment(email, "joining.request");
      return e?.state === "stopped" ? e : null;
    });
    expect(stopped.stop_reason).toBe("joining_admitted");
  });

  it("backfilled members get nothing, until an admin includes them", async () => {
    const [row] = await rows("SELECT source, state FROM path_enrollments WHERE user_id = ? AND path_id = 'steward'", [early.id]);
    expect(row).toMatchObject({ source: "backfill", state: "active" });
    expect(await enrollment(early.email, "path.steward")).toBeNull();
    await run("journeys");
    await run("drain");
    expect(await rows("SELECT id FROM comms_messages WHERE to_email = ?", [early.email])).toHaveLength(0);

    const panel = await call("GET", "/api/admin/comms/paths/path.steward");
    expect(panel.status, JSON.stringify(panel.json)).toBe(200);
    expect(panel.json).toMatchObject({ includeExisting: false, rungEmails: false, held: null });
    expect(panel.json.people.backfilled).toBe(1);

    const included = await call("PUT", "/api/admin/comms/paths/path.steward", { body: { includeExisting: true } });
    expect(included.status, JSON.stringify(included.json)).toBe(200);
    expect(included.json).toMatchObject({ includeExisting: true, started: 1 });
    const e = await enrollment(early.email, "path.steward");
    expect(e).toMatchObject({ state: "active" });
    await setZone(String(e!.contact_id), zoneAtLocalHour(12));
    await run("journeys");
    expect(await stepsPosted(String(e!.id))).toEqual({ welcome: "queued" });
  });

  it("the investor journey sends only the welcome and the hand-off until its words are reviewed", async () => {
    const email = `ivy-${PORT}@example.test`;
    const asked = await call("POST", "/api/investor-docs/request", { body: { name: "Ivy Investor", email, accredited: true, commsConsent: true }, token: null });
    expect(asked.status, JSON.stringify(asked.json)).toBe(200);
    const e = await waitFor("the investor journey", () => enrollment(email, "path.investor"));
    await setZone(String(e.contact_id), zoneAtLocalHour(12));

    const panel = await call("GET", "/api/admin/comms/paths/path.investor");
    expect(String(panel.json.held)).toContain("only the welcome and the day 21 hand-off");

    await run("journeys");
    expect(await stepsPosted(String(e.id))).toEqual({ welcome: "queued" });
    const walk = await call("POST", `${J}/path.investor/walk`, { body: { enrollmentId: e.id } });
    expect(walk.status, JSON.stringify(walk.json)).toBe(200);
    expect(walk.json.steps.map((s: any) => [s.key, s.outcome])).toEqual([
      ["welcome", "sent"],
      ["first_step", "skipped"],
      ["meet_us", "skipped"],
      ["stories", "skipped"],
      ["check_in", "sent"],
    ]);
    expect(walk.json.steps.find((s: any) => s.key === "stories").condition).toBe("investor_words_unreviewed");

    await startedDaysAgo(String(e.id), 10);
    await run("journeys");
    expect(await stepsPosted(String(e.id))).toEqual({ welcome: "queued" });

    const reviewed = await call("PUT", "/api/admin/comms/settings", { body: { investorWordsReviewed: true } });
    expect(reviewed.status, JSON.stringify(reviewed.json)).toBe(200);
    expect((await call("GET", "/api/admin/comms/paths/path.investor")).json.held).toBeNull();
    await lookNow(String(e.id));
    await run("journeys");
    expect(await stepsPosted(String(e.id))).toEqual({ welcome: "queued", stories: "queued" });
  });
});
