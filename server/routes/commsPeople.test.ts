/**
 * THE ADDRESS BOOK'S ROUTES, OVER REAL HTTP, AGAINST A REAL DATABASE
 * (the comms build spec 5.3 and 5.4).
 *
 * The handlers are the real ones, registered on a bare express app the way
 * server/index.ts registers them; the gates and the rate limit are stand-ins
 * a case can flip, and the post office runs for real with a transport that
 * records instead of sending. Every claim is read back from rows: a GET is
 * proved not to act by counting what it could have written, before and after.
 *
 * No TEST_DATABASE_URL and the suite skips (harness rule).
 */
import http from "node:http";
import express from "express";
import mysql from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { provisionTestDb, testDbConfigured, type TestDb } from "../db/testDb";
import { ensureContact } from "../lib/comms/contacts";
import { enroll } from "../lib/comms/journeys";
import { signLink } from "../lib/comms/links";
import type { TransportMessage } from "../lib/comms/transport";
import { usersRepo } from "../repos/users";
import { BAD_LINK, csvCell, registerAdmin, registerPublic, type PublicDeps } from "./commsPeople";

const configured = testDbConfigured();

let db: TestDb;
let pool: mysql.Pool;
let server: http.Server;
let base = "";
let mayManage = true;
const sent: TransportMessage[] = [];
const MEMBER_TOKEN = "member-session";

async function q(sql: string, params: unknown[] = []): Promise<any[]> {
  const [rows] = await pool.query<any[]>(sql, params); // module-review-ok: seeding and reading back the scratch schema this suite provisioned, which is the assertion
  return rows;
}

interface Answer {
  status: number;
  body: any;
  text: string;
}

async function call(method: string, path: string, opts: { body?: unknown; form?: string; auth?: string } = {}): Promise<Answer> {
  const headers: Record<string, string> = {};
  if (opts.auth) headers.Authorization = `Bearer ${opts.auth}`;
  let body: string | undefined;
  if (opts.form !== undefined) {
    headers["Content-Type"] = "application/x-www-form-urlencoded";
    body = opts.form;
  } else if (opts.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(opts.body);
  }
  const res = await fetch(`${base}${path}`, { method, headers, body }); // module-review-ok: the test client dialling its own in-process server on 127.0.0.1
  const text = await res.text();
  let parsed: any = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = null;
  }
  return { status: res.status, body: parsed, text };
}

const t = (token: string) => `?t=${encodeURIComponent(token)}`;
/** Exactly what the post office signs into an email's List-Unsubscribe header. */
const unsubscribeLink = (contactId: string, kind: string) => signLink("unsubscribe", { c: contactId, k: kind }, 365);
const preferencesLink = (contactId: string) => signLink("preferences", { c: contactId }, 365);

/** Everything a GET could have changed, counted. */
async function footprint(contactId: string) {
  const [row] = await q(
    "SELECT (SELECT COUNT(*) FROM comms_permissions WHERE contact_id = ?) AS answers, " +
      "(SELECT COUNT(*) FROM comms_suppressions) AS suppressions, " +
      "(SELECT COUNT(*) FROM comms_enrollments WHERE contact_id = ? AND state = 'active') AS journeys, " +
      "(SELECT COUNT(*) FROM comms_messages) AS emails",
    [contactId, contactId],
  );
  return row;
}

let n = 0;
async function stranger(name: string | null = null): Promise<{ id: string; email: string }> {
  n += 1;
  const email = `route-guest-${n}@example.test`;
  const contact = await ensureContact({ getPool: () => pool }, { email, name, source: "resident" });
  return { id: contact!.id, email };
}

describe.skipIf(!configured)("the address book's routes", () => {
  beforeAll(async () => {
    db = await provisionTestDb();
    pool = mysql.createPool({ uri: db.url, timezone: "Z", connectionLimit: 4 }); // module-review-ok: the suite's own pool onto the scratch schema it provisioned
    const members = usersRepo(pool);
    await members.add({ id: "route-member", name: "Morgan Member", email: "morgan@example.test", passwordHash: "x", paths: ["resident"] });

    const office = {
      getPool: () => pool,
      transport: {
        name: "recording",
        async send(m: TransportMessage) {
          sent.push(m);
          return { ok: true as const, providerId: `prov-${sent.length}` };
        },
      },
      sender: () => "Test Village <hello@village.example.test>",
      hasApiKey: () => true,
      origin: () => "https://village.example.test",
    } as unknown as PublicDeps["commsPostOffice"];

    const app = express();
    app.use(express.json());
    registerPublic(app, {
      overLimit: async () => false,
      clientIp: () => "127.0.0.1",
      authedUser: async (req: any) => (req.headers.authorization === `Bearer ${MEMBER_TOKEN}` ? members.byId("route-member") : null),
      getPool: () => pool,
      members,
      commsPostOffice: office,
      deploymentOrigin: () => "https://village.example.test",
      projectName: () => "Test Village",
    } as PublicDeps);
    registerAdmin(app, {
      authedUser: async (req: any) => (req.headers.authorization ? { id: "admin-1" } : null),
      guardCapability: (async (_req: any, res: any) => {
        if (mayManage) return true;
        res.status(403).json({ error: "Running the village's email is an appointment" });
        return false;
      }) as any,
      mayStillSee: async () => mayManage,
      getPool: () => pool,
      members,
      adminActor: () => ({ id: "admin-1" }),
    });
    server = app.listen(0);
    await new Promise<void>((resolve) => server.once("listening", () => resolve()));
    base = `http://127.0.0.1:${(server.address() as any).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    await pool?.end();
    await db?.drop?.();
  });

  it("unsubscribes on the one-click POST with no sign-in, and never acts on a GET", async () => {
    const g = await stranger();
    const going = await enroll({ getPool: () => pool }, { journeyKey: "gathering.going", contactId: g.id, subjectRef: "event:ev-1:2026-10-09" });
    const link = unsubscribeLink(g.id, "events");

    const before = await footprint(g.id);
    for (let i = 0; i < 3; i++) {
      const look = await call("GET", `/api/comms/unsubscribe${t(link)}`);
      expect(look.status, look.text).toBe(200);
      expect(look.body.view).toMatchObject({ kind: "events", label: "Gathering reminders", done: false, village: "Test Village" });
    }
    expect((await call("GET", `/api/comms/preferences${t(preferencesLink(g.id))}`)).status).toBe(200);
    expect(await footprint(g.id), "a GET wrote nothing").toEqual(before);

    // Exactly what a mail app sends for RFC 8058: the form field, and no session.
    const stop = await call("POST", `/api/comms/unsubscribe${t(link)}`, { form: "List-Unsubscribe=One-Click" });
    expect(stop.status, stop.text).toBe(200);
    expect(stop.body).toMatchObject({ ok: true, kind: "events" });
    expect(String(stop.body.sentence)).toContain("gathering reminders");
    const answer = await q("SELECT state, basis, source FROM comms_permissions WHERE contact_id = ? AND kind = 'events'", [g.id]);
    expect(answer).toEqual([{ state: "no", basis: "asked", source: "unsubscribe" }]);
    expect((await q("SELECT state, stop_reason FROM comms_enrollments WHERE id = ?", [going.enrollmentId]))[0]).toEqual({
      state: "stopped",
      stop_reason: "unsubscribed",
    });
    expect((await call("GET", `/api/comms/unsubscribe${t(link)}`)).body.view.done).toBe(true);
  });

  it("stops everything from a link that names no kind", async () => {
    const g = await stranger();
    const link = signLink("unsubscribe", { c: g.id }, 365);
    expect((await call("GET", `/api/comms/unsubscribe${t(link)}`)).body.view).toMatchObject({ kind: "all", done: false });
    expect((await call("POST", `/api/comms/unsubscribe${t(link)}`, { form: "List-Unsubscribe=One-Click" })).status).toBe(200);
    expect(await q("SELECT reason FROM comms_suppressions WHERE email_key = ?", [g.email])).toEqual([{ reason: "unsubscribed_all" }]);
  });

  it("refuses a tampered, an expired and a wrong-purpose link, and writes nothing for any of them", async () => {
    const g = await stranger();
    const good = unsubscribeLink(g.id, "letters");
    const [body, sig] = good.split(".");
    const flip = (s: string) => (s[0] === "A" ? `B${s.slice(1)}` : `A${s.slice(1)}`);
    const otherBody = Buffer.from(JSON.stringify({ p: "unsubscribe", e: 9999999999, d: { c: g.id, k: "events" } })).toString("base64url");
    const expired = signLink("unsubscribe", { c: g.id, k: "letters" }, 365, { now: Date.now() - 400 * 86_400_000 });
    const wrongPurpose = preferencesLink(g.id);
    const noHandler = signLink("guest_confirm", { c: g.id }, 2);

    const before = await footprint(g.id);
    for (const bad of [`${body}.${flip(sig)}`, `${otherBody}.${sig}`, expired, wrongPurpose, "", "not-a-link"]) {
      for (const [method, path] of [
        ["GET", "/api/comms/unsubscribe"],
        ["POST", "/api/comms/unsubscribe"],
      ] as const) {
        const a = await call(method, `${path}${t(bad)}`, method === "POST" ? { form: "List-Unsubscribe=One-Click" } : {});
        expect(a.status, `${method} ${path} with ${bad.slice(0, 12)}`).toBe(400);
        expect(a.body.error).toBe(BAD_LINK);
      }
    }
    // A link signed for unsubscribing opens no preferences, and one for a purpose nothing answers opens no page.
    expect((await call("GET", `/api/comms/preferences${t(good)}`)).status).toBe(400);
    expect((await call("POST", `/api/comms/preferences${t(good)}`, { body: { kind: "letters", on: true } })).status).toBe(400);
    expect((await call("GET", `/api/comms/action${t(noHandler)}`)).status).toBe(400);
    expect((await call("POST", `/api/comms/action${t(good)}`, { body: { choice: "yes" } })).status).toBe(400);
    expect(await footprint(g.id)).toEqual(before);
  });

  it("works for an address with no account: switches, letters confirmed by email, a pause, stop and start again", async () => {
    const g = await stranger("Sam Stranger");
    const link = preferencesLink(g.id);
    const page = await call("GET", `/api/comms/preferences${t(link)}`);
    expect(page.status, page.text).toBe(200);
    expect(page.body.view.member).toBe(false);
    expect(page.body.view.kinds.map((k: any) => k.kind)).toEqual(["events", "paths", "letters"]);
    expect(page.body.view.addressHint).toBe(`r•••@example.test`);
    // Nothing person-shaped leaves on a link: no address and no name.
    expect(page.text).not.toContain(g.email);
    expect(page.text).not.toContain("Sam");

    const off = await call("POST", `/api/comms/preferences${t(link)}`, { body: { kind: "events", on: false } });
    expect(off.status, off.text).toBe(200);
    expect(off.body.view.kinds.find((k: any) => k.kind === "events").on).toBe(false);

    // Letters from a link: no yes is written, a confirmation email goes instead.
    const sentBefore = sent.length;
    const ask = await call("POST", `/api/comms/preferences${t(link)}`, { body: { kind: "letters", on: true } });
    expect(ask.status, ask.text).toBe(200);
    expect(ask.body.notice).toContain("We sent you an email");
    expect(ask.body.view.kinds.find((k: any) => k.kind === "letters").on).toBe(false);
    expect(await q("SELECT kind FROM comms_permissions WHERE contact_id = ? AND kind = 'letters'", [g.id])).toEqual([]);
    expect(sent.length).toBe(sentBefore + 1);
    const confirmation = sent[sent.length - 1];
    expect(confirmation).toMatchObject({ to: g.email, kind: "essential" });
    const confirmToken = decodeURIComponent(String(String(confirmation.text ?? "").match(/\/email\/a\?t=([^\s]+)/)?.[1] ?? ""));
    expect(confirmToken).toBeTruthy();

    const describe = await call("GET", `/api/comms/action${t(confirmToken)}`);
    expect(describe.status, describe.text).toBe(200);
    expect(describe.body.purpose).toBe("letters_confirm");
    expect(describe.body.description.choices.map((c: any) => c.value)).toEqual(["yes", "no"]);
    expect(await q("SELECT kind FROM comms_permissions WHERE contact_id = ? AND kind = 'letters'", [g.id])).toEqual([]);
    const yes = await call("POST", `/api/comms/action${t(confirmToken)}`, { body: { choice: "yes" } });
    expect(yes.status, yes.text).toBe(200);
    expect(yes.body.outcome.description.current).toBe("yes");
    const letters = await q("SELECT state, basis, source, evidence FROM comms_permissions WHERE contact_id = ? AND kind = 'letters'", [g.id]);
    expect(letters[0]).toMatchObject({ state: "yes", basis: "asked", source: "letters_confirm" });
    expect(JSON.stringify(letters[0].evidence)).toContain("Press the button and you will get letters from Test Village");

    const pause = await call("POST", `/api/comms/preferences${t(link)}`, { body: { pause: true } });
    expect(pause.body.view.pausedUntil).toBeTruthy();
    const resume = await call("POST", `/api/comms/preferences${t(link)}`, { body: { pause: false } });
    expect(resume.body.view.pausedUntil).toBeNull();

    const stop = await call("POST", `/api/comms/preferences${t(link)}`, { body: { stopEverything: true } });
    expect(stop.body.view.stopped).toBe(true);
    expect(await q("SELECT reason FROM comms_suppressions WHERE email_key = ?", [g.email])).toEqual([{ reason: "unsubscribed_all" }]);
    const refused = await call("POST", `/api/comms/preferences${t(link)}`, { body: { kind: "events", on: true } });
    expect(refused.status).toBe(409);
    const again = await call("POST", `/api/comms/preferences${t(link)}`, { body: { startAgain: true } });
    expect(again.body.view.stopped).toBe(false);
    expect(await q("SELECT reason FROM comms_suppressions WHERE email_key = ?", [g.email])).toEqual([]);
  });

  it("opens the whole preferences page from a preferences link on the action page", async () => {
    const g = await stranger();
    const page = await call("GET", `/api/comms/action${t(preferencesLink(g.id))}`);
    expect(page.status, page.text).toBe(200);
    expect(page.body.purpose).toBe("preferences");
    expect(page.body.description.data.view.kinds).toHaveLength(3);
    const change = await call("POST", `/api/comms/action${t(preferencesLink(g.id))}`, { body: { kind: "paths", on: true } });
    expect(change.status, change.text).toBe(200);
    expect(change.body.outcome.description.data.view.kinds.find((k: any) => k.kind === "paths").on).toBe(true);
  });

  it("lets a signed-in member change their own email from their account", async () => {
    expect((await call("GET", "/api/comms/me")).status).toBe(401);
    const mine = await call("GET", "/api/comms/me", { auth: MEMBER_TOKEN });
    expect(mine.status, mine.text).toBe(200);
    expect(mine.body.view.member).toBe(true);
    expect(mine.body.view.kinds.map((k: any) => k.kind)).toEqual(["events", "paths", "letters", "notices"]);
    // A path chosen in the account is a yes to its emails.
    expect(mine.body.view.kinds.find((k: any) => k.kind === "paths")).toMatchObject({ on: true, basis: "account" });

    const sentBefore = sent.length;
    const letters = await call("PUT", "/api/comms/me", { auth: MEMBER_TOKEN, body: { kind: "letters", on: true } });
    expect(letters.status, letters.text).toBe(200);
    // The account is the proof: no confirming email.
    expect(sent.length).toBe(sentBefore);
    expect(letters.body.view.kinds.find((k: any) => k.kind === "letters")).toMatchObject({ on: true, basis: "account", source: "profile" });
    // The link it hands back opens the same choices.
    const page = await call("GET", `/api/comms/preferences${t(mine.body.preferencesToken)}`);
    expect(page.body.view.kinds.find((k: any) => k.kind === "letters").on).toBe(true);
  });

  it("shows a person's every email on the People screen, and refuses somebody without the appointment", async () => {
    const g = await stranger("Pat Person");
    await call("POST", `/api/comms/preferences${t(preferencesLink(g.id))}`, { body: { kind: "letters", on: true } });

    const list = await call("GET", `/api/admin/comms/people?q=${encodeURIComponent(g.email.slice(0, 14))}`, { auth: "admin" });
    expect(list.status, list.text).toBe(200);
    expect(list.body.people.map((p: any) => p.id)).toContain(g.id);
    const person = await call("GET", `/api/admin/comms/people/${g.id}`, { auth: "admin" });
    expect(person.status, person.text).toBe(200);
    expect(person.body.person).toMatchObject({ id: g.id, email: g.email, name: "Pat Person" });
    expect(person.body.emails).toHaveLength(1);
    expect(person.body.emails[0]).toMatchObject({ kind: "essential", origin: "comms.letters_confirm", status: "sent" });
    expect(person.body.answers.map((a: any) => a.kind)).toEqual(["events", "paths", "letters", "notices"]);

    mayManage = false;
    try {
      expect((await call("GET", `/api/admin/comms/people/${g.id}`, { auth: "admin" })).status).toBe(403);
      expect((await call("GET", "/api/admin/comms/people", { auth: "admin" })).status).toBe(403);
      expect((await call("POST", `/api/admin/comms/people/${g.id}/suppress`, { auth: "admin", body: {} })).status).toBe(403);
    } finally {
      mayManage = true;
    }
    expect((await call("GET", "/api/admin/comms/people")).status).toBe(401);
  });

  it("suppresses by hand, and asks why before lifting a stop that came from a complaint", async () => {
    const g = await stranger();
    const going = await enroll({ getPool: () => pool }, { journeyKey: "gathering.going", contactId: g.id, subjectRef: "event:ev-2:" });
    const stop = await call("POST", `/api/admin/comms/people/${g.id}/suppress`, { auth: "admin", body: { detail: "Asked on the phone" } });
    expect(stop.status, stop.text).toBe(200);
    expect(stop.body.suppression).toMatchObject({ reason: "manual", detail: "Asked on the phone", createdBy: "admin-1" });
    expect((await q("SELECT state FROM comms_enrollments WHERE id = ?", [going.enrollmentId]))[0].state).toBe("stopped");
    expect((await call("POST", `/api/admin/comms/people/${g.id}/restore`, { auth: "admin", body: {} })).body).toMatchObject({ restored: true, was: "manual" });

    const spam = await stranger();
    await q("INSERT INTO comms_suppressions (email_key, reason) VALUES (?, 'complained')", [spam.email]);
    const bare = await call("POST", `/api/admin/comms/people/${spam.id}/restore`, { auth: "admin", body: { reason: "  " } });
    expect(bare.status).toBe(400);
    expect(await q("SELECT reason FROM comms_suppressions WHERE email_key = ?", [spam.email])).toEqual([{ reason: "complained" }]);
    const why = await call("POST", `/api/admin/comms/people/${spam.id}/restore`, { auth: "admin", body: { reason: "They wrote asking to come back" } });
    expect(why.status, why.text).toBe(200);
    expect(await q("SELECT reason FROM comms_suppressions WHERE email_key = ?", [spam.email])).toEqual([]);
    const audit = await q("SELECT text, actor_user_id, audience FROM health_events WHERE entity_ref = ?", [spam.id]);
    expect(audit).toEqual([
      { text: "comms:suppression-lifted:complained: They wrote asking to come back", actor_user_id: "admin-1", audience: "admin" },
    ]);
  });

  it("stops one journey for one person, and no journey of anybody else's", async () => {
    const a = await stranger();
    const b = await stranger();
    const mine = await enroll({ getPool: () => pool }, { journeyKey: "path.resident", contactId: a.id, subjectRef: "path:resident" });
    const theirs = await enroll({ getPool: () => pool }, { journeyKey: "path.resident", contactId: b.id, subjectRef: "path:resident" });
    expect((await call("POST", `/api/admin/comms/people/${a.id}/journeys/${theirs.enrollmentId}/stop`, { auth: "admin" })).status).toBe(404);
    const stop = await call("POST", `/api/admin/comms/people/${a.id}/journeys/${mine.enrollmentId}/stop`, { auth: "admin" });
    expect(stop.body).toEqual({ ok: true, stopped: 1 });
    const states = await q("SELECT id, state FROM comms_enrollments WHERE id IN (?)", [[mine.enrollmentId, theirs.enrollmentId]]);
    expect(Object.fromEntries(states.map((r) => [r.id, r.state]))).toEqual({ [mine.enrollmentId]: "stopped", [theirs.enrollmentId]: "active" });
  });

  it("downloads the address book as a CSV a spreadsheet cannot be tricked by, and writes down that it did", async () => {
    await stranger('=HYPERLINK("https://evil.example","click")');
    const csv = await call("GET", "/api/admin/comms/people-export", { auth: "admin" });
    expect(csv.status).toBe(200);
    expect(csv.text.split("\r\n")[0]).toBe("email,name,member,first_source,added,events,paths,letters,suppressed");
    expect(csv.text).toContain(`"'=HYPERLINK(""https://evil.example"",""click"")"`);
    expect(csv.text).not.toMatch(/(^|,)=HYPERLINK/m);
    expect(csvCell("+1 555")).toBe("'+1 555");
    expect(await q("SELECT text FROM health_events WHERE text LIKE 'comms:people-exported:%'")).toHaveLength(1);
  });
});
