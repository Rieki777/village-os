/**
 * VILLAGE COMMS, GUESTS AND RECAPS, DRIVEN THROUGH THE BUILT SERVER (the
 * guests and recaps lane's e2e; the comms build spec 5.8, 5.9 and section 8).
 *
 * Boots `dist/index.js` against a scratch schema with the scheduler off and
 * `RESEND_API_BASE` pointed at the fake provider (server/testkit/fakeResend.ts),
 * so not one email leaves this machine. Then, through real routes only:
 *
 *   - a visitor asks for a seat at a public gathering and gets one email, and
 *     nothing else happens until they press its link: no seat, no reminder;
 *   - pressing it through `/api/comms/action` takes the seat, and an expired
 *     request cannot;
 *   - the organiser's list shows the guest's name, marked, with no address;
 *   - the host marks who came, sends the recap, and the came and missed
 *     versions reach the right inboxes; an answer from the email lands and
 *     shows in the host's panel; the next gathering is one press away;
 *   - the guest door refuses the eleventh request from one network and the
 *     eleventh for one address.
 *
 * Capacity under a concurrent burst is proven against the database directly,
 * in server/lib/comms/guests.db.test.ts, where the burst can be exact.
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
  console.warn("[comms.guests] TEST_DATABASE_URL not set - DB-backed tests SKIPPED.");
}

const DIST = path.resolve(process.cwd(), "dist/index.js");
// Its window is checked by scripts/check-e2e-ports.mjs, not claimed here.
const PORT = 2050 + (process.pid % 50);
const BASE = `http://localhost:${PORT}`;
const ADMIN = "comms-guests-admin";
const PASSWORD = "CommsGuests123!";
const FOUNDER_EMAIL = `founder-${PORT}@example.test`;
/** Short on purpose: a test key, never a credential, and the intake scan reads lengths. */
const PROVIDER_KEY = "re_test_lane_c3";
const SENDER = "Test Village <hello@village.example.test>";

let child: ChildProcess | undefined;
let testDb: TestDb | undefined;
let fake: FakeResend | undefined;
let dataDir = "";
let pool: Pool;
const logs: string[] = [];

let founderToken = "";
let gatheringId = "";
let nextId = "";
let rateId = "";
const ana = { id: "", email: `ana-${PORT}@example.test` };
const ben = { id: "", email: `ben-${PORT}@example.test` };
const GALE = `gale-${PORT}@example.test`;
let galeKey = "";

interface Answer {
  status: number;
  json: any;
}

let ipSeq = 0;
/** One call, from its own address unless one is named, so no case spends another's rate-limit budget. */
async function call(method: string, route: string, opts: { body?: unknown; token?: string | null; ip?: string } = {}): Promise<Answer> {
  const token = opts.token === undefined ? founderToken : opts.token;
  const res = await fetch(BASE + route, { // module-review-ok: the test client dialling the built server on localhost, as every e2e suite does
    method,
    headers: {
      "Content-Type": "application/json",
      "X-Forwarded-For": opts.ip ?? `10.63.${Math.floor(++ipSeq / 250)}.${ipSeq % 250}`,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

async function q(sql: string, params: unknown[] = []): Promise<RowDataPacket[]> {
  const [rows] = await pool.query<RowDataPacket[]>(sql, params); // module-review-ok: reading back the scratch schema this suite provisioned
  return rows;
}

/** What a signed link is for, read off its own first segment. */
const purposeOf = (token: string): string => {
  try {
    return String(JSON.parse(Buffer.from(token.split(".")[0], "base64url").toString("utf8")).p);
  } catch {
    return "";
  }
};

/** Every email the fake took for one address, oldest first. */
const emailsTo = (address: string) =>
  fake!.emails().filter((e) => (Array.isArray(e.body.to) ? e.body.to : [e.body.to]).includes(address));

/** The action-page tokens in an email, for one purpose, in the order they appear. */
function tokensIn(html: string, purpose: string): string[] {
  return Array.from(String(html).matchAll(/\/email\/a\?t=([^"&<\s]+)/g))
    .map((m) => decodeURIComponent(m[1]))
    .filter((t) => purposeOf(t) === purpose);
}

const action = (method: "GET" | "POST", token: string, body?: unknown) =>
  call(method, `/api/comms/action?t=${encodeURIComponent(token)}`, { body, token: null });

beforeAll(async () => {
  if (!DB_CONFIGURED) return;
  if (!fs.existsSync(DIST)) {
    throw new Error(`${DIST} is missing. Run \`pnpm build\` before the comms guests test.`);
  }
  fake = await startFakeResend({ apiKey: PROVIDER_KEY });
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "village-comms-guests-"));
  testDb = await provisionTestDb();
  pool = testPool(testDb, { connectionLimit: 4 });

  await waitForPortFree(PORT);
  child = spawn(process.execPath, [DIST], {
    env: {
      ...process.env,
      NODE_ENV: "production",
      PORT: String(PORT),
      // No background scheduler: "run now" drives the post office and the journeys here.
      SCHEDULER_ENABLED: "0",
      DATA_DIR: dataDir,
      DATABASE_URL: testDb.url,
      ADMIN_PASSWORD: ADMIN,
      // Short on purpose: a throwaway test value, and the intake scan reads lengths.
      AUTH_TOKEN_SECRET: "comms-c3-token",
      // The fake provider stands in for the real one. Nothing here can reach it.
      RESEND_API_BASE: fake.url,
      RESEND_API_KEY: PROVIDER_KEY,
      EMAIL_FROM: SENDER,
      RESEND_WEBHOOK_SECRET: makeWebhookSecret(),
      ANTHROPIC_API_KEY: "",
      // No assistant either, so "Draft it for me" answers the plain draft this suite reads word for word.
      PLATFORM_ASSISTANT_KEY: "",
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

const inDays = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString();

describe.skipIf(!DB_CONFIGURED)("Village Comms, guests and recaps", () => {
  it("sets the village up: a founder, the calendar and comms open to everyone, two gatherings and two members", async () => {
    const boot = await call("POST", "/api/admin/bootstrap", { body: { password: ADMIN, email: FOUNDER_EMAIL, name: "Guests Founder" }, token: null });
    expect(boot.status, JSON.stringify(boot.json)).toBe(200);
    const claim = decodeURIComponent(String(boot.json?.claimUrl ?? "").match(/token=([^&]+)/)?.[1] ?? "");
    const setPw = await call("POST", "/api/auth/set-password", { body: { token: claim, password: PASSWORD }, token: null });
    founderToken = String(setPw.json?.token ?? "");
    expect(founderToken, "the founder holds a session").toBeTruthy();

    for (const id of ["events", "comms"]) {
      const on = await call("PUT", `/api/admin/modules/${id}/lifecycle`, { body: { lifecycle: "public", examples: false } });
      expect(on.status, `${id}: ${JSON.stringify(on.json)}`).toBe(200);
    }
    const make = async (title: string, days: number, extra: Record<string, unknown> = {}) => {
      const made = await call("POST", "/api/admin/events", {
        body: { title, startsAt: inDays(days), endsAt: inDays(days + 0.1), status: "scheduled", layer: "public", kind: "gathering", ...extra },
      });
      expect(made.status, JSON.stringify(made.json)).toBe(200);
      return String(made.json.event.id);
    };
    gatheringId = await make("Seed swap", 3);
    nextId = await make("Soup night", 6);
    rateId = await make("Open day", 9);

    for (const m of [ana, ben]) {
      const reg = await call("POST", "/api/auth/register", {
        body: { name: m === ana ? "Ana Came" : "Ben Missed", email: m.email, password: "MemberPass123!", paths: ["resident"] },
        token: null,
      });
      expect(reg.status, JSON.stringify(reg.json)).toBe(200);
      m.id = String(reg.json?.user?.id ?? "");
      // Their answers are set-up here; the member RSVP route has its own suites.
      await q("INSERT INTO event_rsvps (id, event_id, user_id, status, idempotency_key, occurrence_key) VALUES (?, ?, ?, 'going', ?, '')", [
        `rs-${m.id}`,
        gatheringId,
        m.id,
        `rsvp:${gatheringId}:${m.id}`,
      ]);
    }
  });

  it("no reminder before confirmation: a visitor's request sends one email and holds nothing until its link is pressed", async () => {
    const door = await call("GET", `/api/events/${gatheringId}/guest-rsvp`, { token: null });
    expect(door.json).toEqual({ open: true, occurrenceKey: "" });

    const asked = await call("POST", `/api/events/${gatheringId}/guest-rsvp`, {
      body: { name: "Gale Guest", email: GALE, timezone: "America/Denver" },
      token: null,
    });
    expect(asked.status, JSON.stringify(asked.json)).toBe(200);
    expect(asked.json.message).toContain("Check your email");

    const [contact] = await q("SELECT id, timezone FROM comms_contacts WHERE email_key = ?", [GALE]);
    galeKey = `guest:${contact.id}`;
    expect(contact.timezone).toBe("America/Denver");
    // Time moves on: the journeys and the drain both run, and nothing more is sent.
    expect((await call("POST", "/api/admin/comms/run", { body: { job: "journeys" } })).status).toBe(200);
    expect((await call("POST", "/api/admin/comms/run", { body: { job: "drain" } })).status).toBe(200);
    const mail = emailsTo(GALE);
    expect(mail.map((e) => e.body.subject)).toEqual(["Confirm your place at Seed swap"]);
    expect(await q("SELECT * FROM event_rsvps WHERE user_id = ?", [galeKey])).toEqual([]);
    expect(await q("SELECT * FROM comms_enrollments WHERE contact_id = ?", [contact.id])).toEqual([]);
    const ledger = await q("SELECT kind, origin, status, body_html FROM comms_messages WHERE contact_id = ?", [contact.id]);
    expect(ledger).toEqual([{ kind: "essential", origin: "event.guest_confirm", status: "sent", body_html: null }]);

    const [token] = tokensIn(mail[0].body.html, "guest_confirm");
    const page = await action("GET", token);
    expect(page.status, JSON.stringify(page.json)).toBe(200);
    expect(page.json.description.title).toBe("Confirm your place at Seed swap");
    // A GET shows; it never acts, because mail scanners open every link.
    expect(await q("SELECT * FROM event_rsvps WHERE user_id = ?", [galeKey])).toEqual([]);

    const pressed = await action("POST", token, { choice: "confirm" });
    expect(pressed.status, JSON.stringify(pressed.json)).toBe(200);
    expect(pressed.json.outcome.title).toBe("You're in!");
    expect(await q("SELECT event_id, status FROM event_rsvps WHERE user_id = ?", [galeKey])).toEqual([{ event_id: gatheringId, status: "going" }]);
  });

  it("an expired request cannot confirm", async () => {
    const lou = `lou-${PORT}@example.test`;
    expect((await call("POST", `/api/events/${gatheringId}/guest-rsvp`, { body: { name: "Lou Late", email: lou }, token: null })).status).toBe(200);
    const [token] = tokensIn(emailsTo(lou)[0].body.html, "guest_confirm");
    const [contact] = await q("SELECT id FROM comms_contacts WHERE email_key = ?", [lou]);
    await q("UPDATE event_guest_requests SET expires_at = CURRENT_TIMESTAMP - INTERVAL 1 MINUTE WHERE contact_id = ?", [contact.id]);

    const late = await action("POST", token, { choice: "confirm" });
    expect(late.status, JSON.stringify(late.json)).toBe(410);
    expect(late.json.error).toContain("expired");
    expect(await q("SELECT * FROM event_rsvps WHERE user_id = ?", [`guest:${contact.id}`])).toEqual([]);
    expect((await action("GET", token)).json.description.title).toBe("Link expired");
  });

  it("the organiser list shows the guest's name with guest, and no address", async () => {
    const list = await call("GET", `/api/admin/events/${gatheringId}/rsvps`);
    expect(list.status, JSON.stringify(list.json)).toBe(200);
    const gale = list.json.rsvps.find((r: any) => r.userId === galeKey);
    expect(gale).toMatchObject({ name: "Gale Guest", guest: true, status: "going" });
    expect(list.json.rsvps.find((r: any) => r.userId === ana.id)).toMatchObject({ name: "Ana Came", guest: false });
    const text = JSON.stringify(list.json);
    for (const address of [GALE, ana.email, ben.email]) expect(text).not.toContain(address);
    expect(text).not.toContain("@");
  });

  it("recap versions reach the right people: came for who came, the missed version only for who the host marked missed", async () => {
    // A stranger's look at the host's tools learns nothing.
    expect((await call("GET", `/api/events/${gatheringId}/recap`, { token: null })).json).toEqual({ manage: false });
    expect((await call("POST", `/api/events/${gatheringId}/recap/send`, { body: {}, token: null })).status).toBe(401);
    // Marks open once it has begun.
    expect((await call("POST", `/api/events/${gatheringId}/attendance`, { body: { everyone: true } })).status).toBe(409);

    await q("UPDATE events SET starts_at = UTC_TIMESTAMP() - INTERVAL 3 HOUR, ends_at = UTC_TIMESTAMP() - INTERVAL 1 HOUR WHERE id = ?", [gatheringId]);
    const marked = await call("POST", `/api/events/${gatheringId}/attendance`, {
      body: {
        marks: [
          { personKey: ana.id, status: "came" },
          { personKey: ben.id, status: "missed" },
          { personKey: galeKey, status: "came" },
        ],
      },
    });
    expect(marked.status, JSON.stringify(marked.json)).toBe(200);
    expect(marked.json.people.find((p: any) => p.personKey === galeKey)).toMatchObject({ name: "Gale Guest", guest: true, mark: "came" });
    expect(JSON.stringify(marked.json)).not.toContain("@");

    const drafted = await call("POST", `/api/events/${gatheringId}/recap/draft`, { body: { notes: "We sorted the seed bank." } });
    expect(drafted.json.bodyMd).toMatch(/^2 of us came to Seed swap on \w+, \w+ \d+\.\n\nWe sorted the seed bank\.\n\nThank you to everyone who came\.$/);
    const saved = await call("POST", `/api/events/${gatheringId}/recap`, {
      body: { bodyMd: drafted.json.bodyMd, missedNoteMd: "Some seeds are set aside for you.", recordingUrl: "https://video.example.test/seed-swap" },
    });
    expect(saved.status, JSON.stringify(saved.json)).toBe(200);
    expect(saved.json.audience).toEqual({ came: 2, missed: 1 });
    expect(saved.json.next).toMatchObject({ title: "Soup night" });

    const sent = await call("POST", `/api/events/${gatheringId}/recap/send`, { body: {} });
    expect(sent.status, JSON.stringify(sent.json)).toBe(200);
    expect(sent.json).toEqual({ ok: true, came: 2, missed: 1, posted: 3, skipped: 0 });
    expect((await call("POST", `/api/admin/comms/run`, { body: { job: "drain" } })).json.summary.sent).toBe(3);

    const subjectOf = (address: string) => emailsTo(address).filter((e) => String(e.body.subject).startsWith("Seed swap")).map((e) => e.body.subject);
    expect(subjectOf(ana.email)).toEqual(["Seed swap: the recap"]);
    expect(subjectOf(GALE)).toEqual(["Seed swap: the recap"]);
    expect(subjectOf(ben.email)).toEqual(["Seed swap: what you missed"]);
    const benMail = emailsTo(ben.email).find((e) => e.body.subject === "Seed swap: what you missed")!;
    expect(benMail.body.html).toContain("Some seeds are set aside for you.");
    expect(emailsTo(ana.email).find((e) => e.body.subject === "Seed swap: the recap")!.body.html).not.toContain("Some seeds are set aside for you.");

    // Sent once: a second press sends nothing.
    const again = await call("POST", `/api/events/${gatheringId}/recap/send`, { body: {} });
    expect(again.status).toBe(409);
    expect(again.json.error).toBe("Already sent.");
  });

  it("an answer lands in event_feedback and shows to the host", async () => {
    const recap = emailsTo(GALE).find((e) => e.body.subject === "Seed swap: the recap")!;
    const [yes, , words] = tokensIn(recap.body.html, "recap_answer");
    const page = await action("GET", yes);
    expect(page.json.description.title).toBe("Would you come to the next one?");
    expect((await action("POST", yes, { choice: "yes" })).status).toBe(200);
    expect((await action("POST", words, { choice: null, text: "Longer, please." })).status).toBe(200);

    expect(await q("SELECT question_key, answer FROM event_feedback WHERE person_key = ? ORDER BY question_key", [galeKey])).toEqual([
      { question_key: "q1", answer: "yes" },
      { question_key: "q2", answer: "Longer, please." },
    ]);
    const panel = await call("GET", `/api/events/${gatheringId}/recap`);
    expect(panel.json.answers.map((a: any) => [a.name, a.guest, a.questionKey, a.answer])).toEqual([
      ["Gale Guest", true, "q1", "yes"],
      ["Gale Guest", true, "q2", "Longer, please."],
    ]);
    expect(panel.json.recap.state).toBe("sent");
  });

  it("rsvp_next confirms in one click, a guest's seat directly and a member's under their own id", async () => {
    const galeMail = emailsTo(GALE).find((e) => e.body.subject === "Seed swap: the recap")!;
    const [next] = tokensIn(galeMail.body.html, "rsvp_next");
    expect((await action("GET", next)).json.description.title).toBe("Save a seat at Soup night");
    const pressed = await action("POST", next, { choice: "going" });
    expect(pressed.status, JSON.stringify(pressed.json)).toBe(200);
    expect(pressed.json.outcome.title).toBe("You're in!");

    const anaMail = emailsTo(ana.email).find((e) => e.body.subject === "Seed swap: the recap")!;
    const [anaNext] = tokensIn(anaMail.body.html, "rsvp_next");
    expect((await action("POST", anaNext, { choice: "going" })).status).toBe(200);

    const seats = await q("SELECT user_id FROM event_rsvps WHERE event_id = ? AND status = 'going'", [nextId]);
    expect(seats.map((r) => r.user_id).sort()).toEqual([ana.id, galeKey].sort());
    // No confirmation email stood between the guest and the seat.
    expect(emailsTo(GALE).filter((e) => String(e.body.subject).includes("Soup night"))).toEqual([]);
  });

  it("the rate limits refuse the eleventh request, from one network and for one address", async () => {
    const ask = (email: string, ip: string) =>
      call("POST", `/api/events/${rateId}/guest-rsvp`, { body: { name: "Rae Rate", email }, token: null, ip });
    for (let i = 1; i <= 10; i++) expect((await ask(`net-${i}-${PORT}@example.test`, "10.99.0.1")).status, `request ${i}`).toBe(200);
    const eleventh = await ask(`net-11-${PORT}@example.test`, "10.99.0.1");
    expect(eleventh.status).toBe(429);
    expect(eleventh.json.error).toContain("Too many tries");

    const one = `one-${PORT}@example.test`;
    for (let i = 1; i <= 10; i++) expect((await ask(one, `10.98.0.${i}`)).status, `request ${i}`).toBe(200);
    expect((await ask(one, "10.98.0.11")).status).toBe(429);
    expect(emailsTo(one)).toHaveLength(10);
  });
});
