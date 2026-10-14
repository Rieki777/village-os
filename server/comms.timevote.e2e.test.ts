/**
 * VILLAGE COMMS, THE LIVE TIME VOTE, DRIVEN THROUGH THE BUILT SERVER (lane
 * C4's e2e; the comms build spec 5.10 and section 8).
 *
 * Rye, 2026-10-02: "live vote on a session time and have it dynamically
 * change and shift based on what time is winning". So every case here reads
 * the gathering's time back off the calendar itself, through `/api/events`.
 *
 * Boots `dist/index.js` against a scratch schema with the scheduler off and
 * `RESEND_API_BASE` pointed at the fake provider, so not one email leaves
 * this machine. Time is driven with "run now" and by moving `leader_since`
 * in SQL. The cases run IN ORDER and build on each other.
 *
 * Run `pnpm build` first: this boots the BUILT server. Skips loudly without
 * TEST_DATABASE_URL.
 */
import fs from "fs";
import os from "os";
import path from "path";
import type { Pool, RowDataPacket } from "mysql2/promise";
import { spawn, type ChildProcess } from "child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { waitForHealth } from "./db/e2eBoot";
import { provisionTestDb, testDbConfigured, testPool, type TestDb, waitForPortFree } from "./db/testDb";
import { startFakeResend, type FakeResend } from "./testkit/fakeResend";

const DB_CONFIGURED = testDbConfigured();
if (!DB_CONFIGURED) {
  console.warn("[comms.timevote] TEST_DATABASE_URL not set - DB-backed tests SKIPPED.");
}

const DIST = path.resolve(process.cwd(), "dist/index.js");
// Its window is checked by scripts/check-e2e-ports.mjs, not claimed here.
const PORT = 5000 + (process.pid % 50);
const BASE = `http://localhost:${PORT}`;
const ADMIN = "comms-timevote-admin";
const PASSWORD = "CommsTimeVote123!";
const FOUNDER_EMAIL = `founder-${PORT}@example.test`;
/** Short on purpose: a test key, never a credential, and the intake scan reads lengths. */
const PROVIDER_KEY = "re_test_lane_c4";
const SENDER = "Test Village <hello@village.example.test>";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

let child: ChildProcess | undefined;
let testDb: TestDb | undefined;
let fake: FakeResend | undefined;
let dataDir = "";
let pool: Pool;
const logs: string[] = [];

let founderToken = "";
const member = { a: { token: "", id: "", email: "" }, b: { token: "", id: "", email: "" } };
let onceId = "";
let options: Array<{ id: string; label: string }> = [];
const A = new Date(Math.floor((Date.now() + 5 * DAY) / 60_000) * 60_000).toISOString();
const B = new Date(Math.floor((Date.now() + 6 * DAY) / 60_000) * 60_000).toISOString();
const C = new Date(Math.floor((Date.now() + 7 * DAY) / 60_000) * 60_000).toISOString();

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
      "X-Forwarded-For": `10.54.${Math.floor(++ipSeq / 250)}.${ipSeq % 250}`,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

/** The gathering as the calendar serves it, one evening or a series' evenings. */
async function served(eventId: string, window?: { from: Date; to: Date }): Promise<any[]> {
  const q = window ? `?from=${encodeURIComponent(window.from.toISOString())}&to=${encodeURIComponent(window.to.toISOString())}` : "";
  const res = await call("GET", `/api/events${q}`, { token: null });
  expect(res.status, JSON.stringify(res.json)).toBe(200);
  return (res.json.events as any[]).filter((e) => e.id === eventId);
}
const startOf = async (eventId: string) => (await served(eventId))[0]?.startsAt;

/** The ledger rows one origin wrote. */
async function rowsFor(origin: string): Promise<RowDataPacket[]> {
  const [rows] = await pool.query<RowDataPacket[]>( // module-review-ok: reading back the scratch schema this suite provisioned
    "SELECT id, to_email, status, subject, idempotency_key FROM comms_messages WHERE origin = ? ORDER BY created_at, id",
    [origin],
  );
  return rows;
}

const run = async (job: "polls" | "drain") => {
  const r = await call("POST", "/api/admin/comms/run", { body: { job } });
  expect(r.status, JSON.stringify(r.json)).toBe(200);
  return r.json.summary;
};

async function register(name: string, email: string): Promise<{ token: string; id: string; email: string }> {
  const reg = await call("POST", "/api/auth/register", { body: { name, email, password: "MemberPass123!", paths: ["resident"] }, token: null });
  expect(reg.status, JSON.stringify(reg.json)).toBe(200);
  return { token: String(reg.json?.token ?? ""), id: String(reg.json?.user?.id ?? ""), email };
}

beforeAll(async () => {
  if (!DB_CONFIGURED) return;
  if (!fs.existsSync(DIST)) {
    throw new Error(`${DIST} is missing. Run \`pnpm build\` before the comms time vote test.`);
  }
  fake = await startFakeResend({ apiKey: PROVIDER_KEY });
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "village-comms-timevote-"));
  testDb = await provisionTestDb();
  pool = testPool(testDb, { connectionLimit: 4 });

  await waitForPortFree(PORT);
  child = spawn(process.execPath, [DIST], {
    env: {
      ...process.env,
      NODE_ENV: "production",
      PORT: String(PORT),
      // No background scheduler: "run now" drives the vote and the post office here.
      SCHEDULER_ENABLED: "0",
      DATA_DIR: dataDir,
      DATABASE_URL: testDb.url,
      ADMIN_PASSWORD: ADMIN,
      // Short on purpose: a throwaway test value, and the intake scan reads lengths.
      AUTH_TOKEN_SECRET: "comms-c4-token",
      // The fake provider stands in for the real one. Nothing here can reach it.
      RESEND_API_BASE: fake.url,
      RESEND_API_KEY: PROVIDER_KEY,
      EMAIL_FROM: SENDER,
      FRONTEND_URL: "https://village.example.test",
      ANTHROPIC_API_KEY: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.on("data", (d) => logs.push(String(d)));
  child.stderr?.on("data", (d) => logs.push(String(d)));
  await waitForHealth({ base: BASE, logs, child });

  const boot = await call("POST", "/api/admin/bootstrap", { body: { password: ADMIN, email: FOUNDER_EMAIL, name: "Tess Host" }, token: null });
  if (boot.status !== 200) throw new Error(`bootstrap failed: ${JSON.stringify(boot.json)}`);
  const claim = decodeURIComponent(String(boot.json?.claimUrl ?? "").match(/token=([^&]+)/)?.[1] ?? "");
  const setPw = await call("POST", "/api/auth/set-password", { body: { token: claim, password: PASSWORD }, token: null });
  founderToken = String(setPw.json?.token ?? "");
  if (!founderToken) throw new Error(`the founder holds no session: ${JSON.stringify(setPw.json)}`);
});

afterAll(async () => {
  child?.kill();
  await pool?.end();
  await fake?.close();
  if (dataDir && fs.existsSync(dataDir)) fs.rmSync(dataDir, { recursive: true, force: true });
  await testDb?.drop();
});

describe.skipIf(!DB_CONFIGURED)("Village Comms, the live time vote", () => {
  it("answers the calendar module's 404 on the vote while the calendar is off", async () => {
    const off = await call("GET", "/api/events/ev-anything/time-poll", { token: null });
    expect(off.status, JSON.stringify(off.json)).toBe(404);
    expect(off.json).toMatchObject({ error: "module_disabled", module: "events" });
    expect((await call("POST", "/api/events/ev-anything/time-poll", { body: {} })).json).toMatchObject({ error: "module_disabled" });

    expect((await call("PUT", "/api/admin/modules/events/lifecycle", { body: { lifecycle: "public", examples: false } })).status).toBe(200);
    expect((await call("PUT", "/api/admin/modules/comms/lifecycle", { body: { lifecycle: "members", examples: false } })).status).toBe(200);
    member.a = await register("Ana Member", `ana-${PORT}@example.test`);
    member.b = await register("Bo Member", `bo-${PORT}@example.test`);
  });

  it("votes move the gathering's time live with settle 0, and a one-off vote emails nothing while it moves", async () => {
    const made = await call("POST", "/api/admin/events", {
      body: { title: "Soup night", startsAt: new Date(Date.now() + 10 * DAY).toISOString(), status: "scheduled", layer: "public", kind: "gathering" },
    });
    expect(made.status, JSON.stringify(made.json)).toBe(200);
    onceId = made.json.event.id;
    const poll = await call("POST", `/api/events/${onceId}/time-poll`, {
      body: { mode: "once", options: [{ startsAt: A }, { startsAt: B, durationMinutes: 90 }, { startsAt: C }] },
    });
    expect(poll.status, JSON.stringify(poll.json)).toBe(200);
    options = poll.json.poll.options.map((o: any) => ({ id: o.id, label: o.label }));
    expect(poll.json.poll.settleMinutes).toBe(0);

    const [first] = await served(onceId);
    expect(first.startsAt).toBe(A);
    expect(first.timePoll).toMatchObject({ state: "open", mode: "once", stillVoting: true, leadingLabel: options[0].label });

    const voted = await call("PUT", `/api/events/${onceId}/time-poll/vote`, { body: { optionIds: [options[1].id] }, token: member.a.token });
    expect(voted.status, JSON.stringify(voted.json)).toBe(200);
    expect(voted.json.poll.mine).toEqual([options[1].id]);
    const [moved] = await served(onceId);
    expect(moved.startsAt).toBe(B);
    expect(moved.endsAt).toBe(new Date(Date.parse(B) + 90 * 60_000).toISOString());
    expect(moved.timePoll.leadingLabel).toBe(options[1].label);

    await run("drain");
    expect(await rowsFor("poll.moved")).toEqual([]);
    expect(await rowsFor("poll.locked")).toEqual([]);
    expect(fake!.emails().some((e) => /Soup night/.test(String(e.body?.subject))), "no email about the moves").toBe(false);
  });

  it("members see names and the public sees counts", async () => {
    const pub = await call("GET", `/api/events/${onceId}/time-poll`, { token: null });
    expect(pub.status).toBe(200);
    expect(pub.json.poll.options.map((o: any) => o.count)).toEqual([0, 1, 0]);
    expect(pub.json.poll.options.every((o: any) => o.names === undefined)).toBe(true);
    expect(JSON.stringify(pub.json), "nothing person-shaped reaches a signed-out reader").not.toMatch(/"names"|Ana Member|Bo Member|Tess Host/);
    expect(pub.json.poll.namesShown).toBe(false);

    const seen = await call("GET", `/api/events/${onceId}/time-poll`, { token: member.b.token });
    expect(seen.json.poll.options[1].names).toEqual(["Ana"]);
    expect(seen.json.poll.canVote).toBe(true);

    expect((await call("PUT", `/api/events/${onceId}/time-poll`, { body: { showNames: false } })).status).toBe(200);
    const hidden = await call("GET", `/api/events/${onceId}/time-poll`, { token: member.b.token });
    expect(hidden.json.poll.options[1].names).toBeUndefined();
    const host = await call("GET", `/api/events/${onceId}/time-poll`);
    expect(host.json.poll.options[1].names, "the host still sees who picked").toEqual(["Ana"]);
    expect((await call("PUT", `/api/events/${onceId}/time-poll`, { body: { showNames: true } })).status).toBe(200);
  });

  it("a tie keeps the current leader", async () => {
    // A tie with the time listed FIRST, so "the first listed wins" would move the gathering.
    expect((await call("PUT", `/api/events/${onceId}/time-poll/vote`, { body: { optionIds: [options[0].id] }, token: member.b.token })).status).toBe(200);
    expect(await startOf(onceId)).toBe(B);
    await run("polls");
    expect(await startOf(onceId)).toBe(B);
  });

  it("settle 60 waits an hour before moving", async () => {
    expect((await call("PUT", `/api/events/${onceId}/time-poll`, { body: { settleMinutes: 60 } })).status).toBe(200);
    expect((await call("PUT", `/api/events/${onceId}/time-poll/vote`, { body: { optionIds: [options[2].id] }, token: member.b.token })).status).toBe(200);
    expect((await call("PUT", `/api/events/${onceId}/time-poll/vote`, { body: { optionIds: [options[2].id] } })).status).toBe(200);
    const view = await call("GET", `/api/events/${onceId}/time-poll`);
    expect(view.json.poll.options[2]).toMatchObject({ count: 2, leading: true, applied: false });
    expect(await startOf(onceId)).toBe(B);
    await run("polls");
    expect(await startOf(onceId)).toBe(B);
    await pool.query("UPDATE event_time_polls SET leader_since = leader_since - INTERVAL 61 MINUTE WHERE event_id = ?", [onceId]); // module-review-ok: moving the clock in the scratch schema this suite provisioned
    await run("polls");
    expect(await startOf(onceId)).toBe(C);
  });

  it("pin beats the vote, and clearing the pin hands the time back to the vote", async () => {
    expect((await call("POST", `/api/events/${onceId}/time-poll/pin`, { body: { optionId: options[0].id } })).status).toBe(200);
    expect(await startOf(onceId)).toBe(A);
    await run("polls");
    expect(await startOf(onceId)).toBe(A);
    expect((await call("POST", `/api/events/${onceId}/time-poll/pin`, { body: { optionId: null } })).status).toBe(200);
    expect(await startOf(onceId)).toBe(C);
  });

  it("refuses the host's routes to a member who cannot manage the calendar", async () => {
    expect((await call("POST", `/api/events/${onceId}/time-poll/lock`, { body: {}, token: member.a.token })).status).toBe(403);
    expect((await call("PUT", `/api/events/${onceId}/time-poll`, { body: { settleMinutes: 0 }, token: member.a.token })).status).toBe(403);
    expect((await call("PUT", `/api/events/${onceId}/time-poll/vote`, { body: { optionIds: [] }, token: null })).status).toBe(401);
  });

  it("a guest votes from a signed link and cannot vote twice for the same option", async () => {
    const guestEmail = `gale-${PORT}@example.test`;
    await pool.query( // module-review-ok: seeding a guest in the scratch schema this suite provisioned
      "INSERT INTO comms_contacts (id, village_id, email_key, email, name, first_source) VALUES ('ct_gale_e2e', 'local', ?, ?, 'Gale Guest', 'guest')",
      [guestEmail, guestEmail],
    );
    await pool.query( // module-review-ok: seeding a guest's yes in the scratch schema this suite provisioned
      "INSERT INTO event_rsvps (id, event_id, user_id, status, idempotency_key, occurrence_key) VALUES ('rs-gale', ?, 'guest:ct_gale_e2e', 'going', 'rsvp-gale', '')",
      [onceId],
    );
    const invite = await call("POST", `/api/events/${onceId}/time-poll/invite`, { body: { answered: true, members: [member.b.id] } });
    expect(invite.status, JSON.stringify(invite.json)).toBe(200);
    expect(invite.json).toMatchObject({ emailed: 1, notified: 1 });
    // Pressed again: nobody is asked twice.
    expect((await call("POST", `/api/events/${onceId}/time-poll/invite`, { body: { answered: true, members: [member.b.id] } })).json).toMatchObject({ emailed: 0, notified: 0 });
    await run("drain");
    const inviteEmail = fake!.emails().find((e) => [].concat(e.body?.to ?? []).includes(guestEmail as never));
    expect(inviteEmail, "the guest's invitation reached the provider").toBeTruthy();
    const links = Array.from(String(inviteEmail!.body.html).matchAll(/href="([^"]*\/email\/a\?t=[^"]+)"/g)).map((m) => m[1].replace(/&amp;/g, "&"));
    expect(links).toHaveLength(3);
    const token = decodeURIComponent(new URL(links[1]).searchParams.get("t") ?? "");

    const page = await call("GET", `/api/comms/action?t=${encodeURIComponent(token)}`, { token: null });
    expect(page.status, JSON.stringify(page.json)).toBe(200);
    expect(page.json.purpose).toBe("time_vote");
    expect(page.json.description.choices[0]).toMatchObject({ value: `yes:${options[1].id}`, primary: true });
    for (let i = 0; i < 2; i++) {
      const press = await call("POST", `/api/comms/action?t=${encodeURIComponent(token)}`, { body: { choice: `yes:${options[1].id}` }, token: null });
      expect(press.status, JSON.stringify(press.json)).toBe(200);
      expect(press.json.outcome.title).toBe("Vote saved");
    }
    // The same link through the page's vote route: the guest's own picks, replaced.
    const viaRoute = await call("PUT", `/api/events/${onceId}/time-poll/vote`, { body: { t: token, optionIds: [options[1].id] }, token: null });
    expect(viaRoute.status, JSON.stringify(viaRoute.json)).toBe(200);
    expect(viaRoute.json.poll.mine).toEqual([options[1].id]);
    const [votes] = await pool.query<RowDataPacket[]>( // module-review-ok: reading back the scratch schema this suite provisioned
      "SELECT option_id FROM event_time_poll_votes WHERE person_key = 'guest:ct_gale_e2e'",
    );
    expect(votes.map((v) => v.option_id)).toEqual([options[1].id]);
    // A link signed for another gathering's vote, or nothing, gets nowhere.
    expect((await call("PUT", `/api/events/${onceId}/time-poll/vote`, { body: { t: "not.a-link", optionIds: [] }, token: null })).status).toBe(401);
  });

  it("lock sends 'time is set' once with an .ics and starts the reminders", async () => {
    expect((await call("POST", `/api/events/${onceId}/rsvp`, { body: { status: "going" }, token: member.a.token })).status).toBe(200);
    await pool.query( // module-review-ok: seeding a parked enrollment in the scratch schema this suite provisioned
      "INSERT INTO comms_enrollments (id, village_id, journey_key, journey_version, contact_id, subject_ref, state, next_check_at) " +
        "VALUES ('enr-e2e-lock', 'local', 'gathering.going', 1, 'ct-park', ?, 'active', CURRENT_TIMESTAMP + INTERVAL 30 DAY)",
      [`event:${onceId}:`],
    );
    const lock = await call("POST", `/api/events/${onceId}/time-poll/lock`, { body: {} });
    expect(lock.status, JSON.stringify(lock.json)).toBe(200);
    expect(lock.json.poll.state).toBe("locked");
    expect((await call("POST", `/api/events/${onceId}/time-poll/lock`, { body: {} })).status).toBe(409);
    await run("polls");
    await run("drain");

    const locked = await rowsFor("poll.locked");
    // Everyone who voted (Ana, Bo, the host, the guest), once each: Ana's yes does not count her twice.
    expect(locked.map((r) => r.to_email).sort()).toEqual([member.a.email, member.b.email, FOUNDER_EMAIL, `gale-${PORT}@example.test`].sort());
    expect(locked.every((r) => r.status === "sent")).toBe(true);
    const copy = fake!.emails().find((e) => e.idempotencyKey === locked[0].id)!;
    const ics = Buffer.from(String(copy.body.attachments?.[0]?.content ?? copy.body.attachments?.[0]?.contentBase64 ?? ""), "base64").toString("utf8");
    expect(ics).toContain("METHOD:REQUEST");
    expect(ics).toContain(`UID:${onceId}-@village.example.test`);
    expect(ics).toContain(`DTSTART:${C.replace(/[-:]/g, "").replace(/\.\d{3}/, "")}`);

    const [item] = await served(onceId);
    expect(item.startsAt).toBe(C);
    expect(item.timePoll).toMatchObject({ state: "locked", stillVoting: false });
    const [enr] = await pool.query<RowDataPacket[]>( // module-review-ok: reading back the scratch schema this suite provisioned
      "SELECT next_check_at <= CURRENT_TIMESTAMP AS due FROM comms_enrollments WHERE id = 'enr-e2e-lock'",
    );
    expect(Number(enr[0].due), "the reminders re-plan on the next tick").toBe(1);
    expect((await call("PUT", `/api/events/${onceId}/time-poll/vote`, { body: { optionIds: [] }, token: member.a.token })).status).toBe(409);
  });

  it("weekly never moves an occurrence inside the freeze and sends one 'moved' per move", async () => {
    const first = new Date(Math.floor((Date.now() + DAY) / 60_000) * 60_000);
    // Weekly slots are village wall-clock time, so read the series in the village's zone.
    const zone = String((await call("GET", "/api/events", { token: null })).json.timezone);
    const clock = (d: Date) => {
      const parts = new Intl.DateTimeFormat("en-US", { timeZone: zone, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(d);
      const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
      return [["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday")), Number(get("hour")) * 60 + Number(get("minute"))];
    };
    const [weekday, minute] = clock(first);
    const later = { weekday: (weekday + 1) % 7, startMinute: (minute + 60) % 1440 };
    const made = await call("POST", "/api/admin/events", {
      body: {
        title: "Community session",
        startsAt: first.toISOString(),
        endsAt: new Date(first.getTime() + HOUR).toISOString(),
        status: "scheduled",
        layer: "public",
        kind: "gathering",
        recurrence: { freq: "weekly", byWeekday: [weekday] },
      },
    });
    expect(made.status, JSON.stringify(made.json)).toBe(200);
    const seriesId = made.json.event.id;
    const window = { from: new Date(Date.now() - HOUR), to: new Date(Date.now() + 20 * DAY) };
    const before = await served(seriesId, window);
    const keys = before.map((e) => e.occurrenceKey);
    expect(keys).toHaveLength(3);
    for (const k of keys.slice(0, 2)) {
      expect((await call("POST", `/api/events/${seriesId}/rsvp`, { body: { status: "going", occurrenceKey: k }, token: member.a.token })).status).toBe(200);
    }
    const poll = await call("POST", `/api/events/${seriesId}/time-poll`, { body: { mode: "weekly", options: [{ weekday, startMinute: minute }, later] } });
    expect(poll.status, JSON.stringify(poll.json)).toBe(200);
    const [, slotB] = poll.json.poll.options;
    expect(slotB.label).toMatch(/s at /);

    expect((await call("PUT", `/api/events/${seriesId}/time-poll/vote`, { body: { optionIds: [slotB.id] }, token: member.b.token })).status).toBe(200);
    const after = await served(seriesId, window);
    expect(after.map((e) => e.occurrenceKey)).toEqual(keys);
    expect(after[0].startsAt, "inside the freeze: where it was").toBe(before[0].startsAt);
    for (const e of after.slice(1)) expect(clock(new Date(e.startsAt))).toEqual([later.weekday, later.startMinute]);
    expect(after[0].timePoll).toMatchObject({ state: "open", mode: "weekly", stillVoting: false });
    expect(after[1].timePoll).toMatchObject({ stillVoting: true });

    await run("polls");
    await run("drain");
    const moved = (await rowsFor("poll.moved")).filter((r) => String(r.subject).includes("Community session"));
    expect(moved.map((r) => r.to_email).sort()).toEqual([member.a.email, member.b.email].sort());
    expect(moved.every((r) => r.status === "sent")).toBe(true);

    // The next move tells everyone once more; a run with nothing to move tells nobody.
    expect((await call("PUT", `/api/events/${seriesId}/time-poll/vote`, { body: { optionIds: [poll.json.poll.options[0].id] }, token: member.a.token })).status).toBe(200);
    expect((await call("PUT", `/api/events/${seriesId}/time-poll/vote`, { body: { optionIds: [poll.json.poll.options[0].id] } })).status).toBe(200);
    await run("polls");
    await run("drain");
    const again = (await rowsFor("poll.moved")).filter((r) => String(r.subject).includes("Community session"));
    expect(again.map((r) => r.to_email).sort()).toEqual([member.a.email, member.a.email, member.b.email, member.b.email, FOUNDER_EMAIL].sort());
    expect((await served(seriesId, window)).map((e) => e.startsAt)).toEqual(before.map((e) => e.startsAt));
  });
});
