import ICAL from "ical.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool, RowDataPacket } from "mysql2/promise";
import type { CommsTrigger } from "../../../shared/comms/contracts";
import { defaultJourney } from "../../../shared/comms/defaults/journeys";
import { provisionTestDb, testDbConfigured, testPool, type TestDb } from "../../db/testDb";
import { insertMessage } from "../../repos/commsMessages";
import { usersRepo } from "../../repos/users";
import { resolveActionLink, registerAction } from "./actions";
import { cantMakeItAction } from "./cantMakeIt";
import { commsSink } from "../commsSink";
import { createGathering, deleteGathering, rsvp, updateGathering, withdrawRsvp } from "../gatherings";
import { joinWaitlist } from "../calendarCommunity";
import { ensureContact } from "./contacts";
import { afterSettingsChange, handleGatheringTrigger, isGatheringTrigger, type EventEmailDeps } from "./eventEmails";
import { gatheringFactsProvider, gatheringVarsBuilder } from "./gatheringJourney";
import { saveEventComms } from "../../repos/eventComms";
import { drain, type CommsMode, type PostOfficeDeps } from "./postOffice";
import type { Transport, TransportMessage } from "./transport";

/**
 * The event emails against a provisioned schema (the comms build spec 5.7):
 * real gatherings, real answers and a real waitlist, the triggers the domain
 * code fires caught at the sink and handed to the handlers, and a post office
 * whose provider records what it is handed.
 */

const configured = testDbConfigured();
let db: TestDb;
let pool: Pool;
const ORIGIN = "https://village.example.test";
const TZ = "America/Costa_Rica";
const LIVE: CommsMode = { lifecycle: "members", paused: false, rehearsalTo: [] };

const sent: TransportMessage[] = [];
const transport: Transport = {
  name: "resend",
  async send(m) {
    sent.push(m);
    return { ok: true, providerId: `prov_${sent.length}` };
  },
};

const office = (): PostOfficeDeps => ({
  getPool: () => pool,
  transport,
  sender: () => "Test Village <hello@village.example.test>",
  hasApiKey: () => true,
  origin: () => ORIGIN,
  mode: async () => LIVE,
  dial: (k) => (k === "comms.send_rate_per_second" ? 50 : k === "comms.daily_cap" ? 2 : 120),
});

const deps = (): EventEmailDeps => ({
  getPool: () => pool,
  postOffice: office(),
  timezone: () => TZ,
  reminderMinutes: () => [1440, 120],
});

/** Triggers the domain code fired, caught at the sink and handed over in order. */
const fired: CommsTrigger[] = [];
async function deliver(): Promise<unknown[]> {
  await new Promise((r) => setTimeout(r, 30));
  const batch = fired.splice(0);
  const out: unknown[] = [];
  for (const t of batch) if (isGatheringTrigger(t)) out.push(await handleGatheringTrigger(deps(), t));
  return out;
}

let n = 0;
async function member(name: string): Promise<{ id: string; email: string }> {
  n += 1;
  const id = `gath-member-${n}`;
  const email = `${id}@example.test`;
  await usersRepo(pool).add({ id, name, email, passwordHash: "x", paths: [], prefs: {} });
  return { id, email };
}

const inDays = (d: number, h = 0) => new Date(Date.now() + d * 86_400_000 + h * 3_600_000).toISOString();

async function gathering(over: Record<string, unknown> = {}): Promise<string> {
  const g = await createGathering(
    pool,
    { title: "Community supper", startsAt: inDays(3), endsAt: inDays(3, 2), status: "scheduled", locationText: "The common house", ...over } as any,
    "gath-host",
  );
  return g.id;
}

async function rows(sql: string, params: unknown[] = []): Promise<RowDataPacket[]> {
  const [r] = await pool.query<RowDataPacket[]>(sql, params); // module-review-ok: reading back the scratch schema this suite provisioned
  return r;
}

const messagesFor = (origin: string) =>
  rows("SELECT id, idempotency_key, to_email, status, kind, template_key, step_key, enrollment_id FROM comms_messages WHERE origin = ? ORDER BY created_at, id", [origin]);

function icsOf(m: TransportMessage | undefined) {
  const a = m?.attachments?.[0];
  if (!a) return null;
  const cal = new ICAL.Component(ICAL.parse(Buffer.from(a.contentBase64, "base64").toString("utf8")));
  const ev = cal.getFirstSubcomponent("vevent")!;
  return { method: cal.getFirstPropertyValue("method"), uid: ev.getFirstPropertyValue("uid"), sequence: ev.getFirstPropertyValue("sequence"), contentType: a.contentType };
}

const sentTo = (email: string, subject: RegExp) => sent.filter((m) => m.to === email && subject.test(m.subject));

beforeAll(async () => {
  if (!configured) return;
  db = await provisionTestDb();
  pool = testPool(db, { connectionLimit: 4 });
  commsSink.register(async (t) => {
    fired.push(t);
  });
  await usersRepo(pool).add({ id: "gath-host", name: "Hana Host", email: "gath-host@example.test", passwordHash: "x", paths: [], prefs: {} });
  // The village has turned the gathering journey on.
  await pool.query("INSERT INTO comms_journeys (village_id, journey_key, state, version) VALUES ('local', 'gathering.going', 'on', 1)"); // module-review-ok: seeding the scratch schema
});

afterAll(async () => {
  await pool?.end();
  await db?.drop();
});

describe.skipIf(!configured)("event emails", () => {
  let supper = "";
  let sam = { id: "", email: "" };
  let samEnrollment = "";

  it("RSVP posts the confirmation with an .ics whose UID and SEQUENCE are right, and a retried yes sends once", async () => {
    supper = await gathering({ capacity: 1 });
    await deliver();
    sam = await member("Sam Rivers");
    expect((await rsvp(pool, supper, sam.id, "going")).ok).toBe(true);
    await deliver();

    const confirms = await messagesFor("journey");
    expect(confirms).toHaveLength(1);
    expect(confirms[0]).toMatchObject({ to_email: sam.email, status: "sent", kind: "events", template_key: "gathering.confirm", step_key: "confirm" });
    samEnrollment = String(confirms[0].enrollment_id);
    expect(confirms[0].idempotency_key).toBe(`j:gathering.going:confirm:${samEnrollment}`);
    const ics = icsOf(sentTo(sam.email, /coming to Community supper/)[0]);
    expect(ics).toMatchObject({ method: "REQUEST", uid: `${supper}-@village.example.test`, sequence: 0 });
    expect(ics!.contentType).toContain("method=REQUEST");

    const [enr] = await rows("SELECT journey_key, subject_ref, state, facts FROM comms_enrollments WHERE id = ?", [samEnrollment]);
    const facts = typeof enr.facts === "string" ? JSON.parse(enr.facts) : enr.facts;
    expect(enr).toMatchObject({ journey_key: "gathering.going", subject_ref: `event:${supper}:`, state: "active" });
    expect(facts).toMatchObject({ eventId: supper, occurrenceKey: "", personKey: sam.id, told: { title: "Community supper", sequence: 0 } });
    expect(facts.stepOverrides).toEqual({ day: { skip: false }, soon: { skip: false } });

    // The same yes again fires the same trigger again: still one confirmation.
    await rsvp(pool, supper, sam.id, "going");
    await deliver();
    expect(await messagesFor("journey")).toHaveLength(1);
    expect(sentTo(sam.email, /coming to/)).toHaveLength(1);
  });

  it("puts the host on gathering.host for the evening people come to", async () => {
    const host = await rows("SELECT subject_ref, state FROM comms_enrollments WHERE journey_key = 'gathering.host' AND subject_ref = ?", [`event:${supper}:`]);
    expect(host).toEqual([{ subject_ref: `event:${supper}:`, state: "active" }]);
  });

  it("leaves the confirmation to the journey while it is off, and while the time is being voted", async () => {
    const quiet = await gathering();
    await pool.query("UPDATE comms_journeys SET state = 'off' WHERE journey_key = 'gathering.going'"); // module-review-ok: the scratch schema
    const ana = await member("Ana Off");
    await rsvp(pool, quiet, ana.id, "going");
    const offOutcome = ((await deliver()) as any[]).at(-1);
    expect(offOutcome).toMatchObject({ held: "journey_off", confirmation: null });
    expect(offOutcome.enrollmentId).toBeTruthy();
    await pool.query("UPDATE comms_journeys SET state = 'on' WHERE journey_key = 'gathering.going'"); // module-review-ok: the scratch schema

    await pool.query( // module-review-ok: seeding the scratch schema: an open time vote
      "INSERT INTO event_time_polls (id, event_id, mode, state, created_by) VALUES ('tp-1', ?, 'once', 'open', 'gath-host')",
      [quiet],
    );
    const ben = await member("Ben Voting");
    await rsvp(pool, quiet, ben.id, "going");
    const voteOutcome = ((await deliver()) as any[]).at(-1);
    expect(voteOutcome).toMatchObject({ held: "time_still_being_voted", confirmation: null });
    expect(sentTo(ana.email, /./).length + sentTo(ben.email, /./).length).toBe(0);
  });

  it("tells a waitlisted person, and once however often the trigger comes", async () => {
    const wren = await member("Wren Waiting");
    const queued = await joinWaitlist(pool, supper, wren.id);
    expect(queued.ok).toBe(true);
    await deliver();
    const waits = await messagesFor("event.waitlisted");
    expect(waits.map((r) => [r.to_email, r.status])).toEqual([[wren.email, "sent"]]);
    await handleGatheringTrigger(deps(), { type: "waitlist_joined", eventId: supper, occurrenceKey: "", personKey: wren.id });
    expect(await messagesFor("event.waitlisted")).toHaveLength(1);
  });

  it("can't make it frees the seat and promotes the next person, who is told the seat is theirs", async () => {
    const [confirm] = sentTo(sam.email, /coming to/);
    const link = /\/email\/a\?t=([^"\s)&]+)/.exec(confirm.html)?.[1];
    expect(link, "the confirmation carries a can't make it link").toBeTruthy();
    registerAction(cantMakeItAction({ getPool: () => pool, eventsOn: () => true, timezone: () => TZ }));
    const found = resolveActionLink(decodeURIComponent(link!));
    expect(found?.purpose).toBe("cant_make_it");
    const page = await found!.handler.describe(found!.payload, { village: "Test Village" });
    expect(page).toMatchObject({ title: "Can't make it to Community supper?", choices: [{ value: "cant" }] });

    const done = await found!.handler.act(found!.payload, { choice: "cant" }, { village: "Test Village" });
    expect(done).toMatchObject({ ok: true, outcome: { title: "Seat given back" } });
    await deliver();

    const [wrenRow] = await rows("SELECT user_id FROM event_rsvps WHERE event_id = ? AND status = 'going'", [supper]);
    expect(wrenRow.user_id).toMatch(/^gath-member-/);
    expect(wrenRow.user_id).not.toBe(sam.id);
    const promoted = await messagesFor("event.promoted");
    expect(promoted).toHaveLength(1);
    const wrenEmail = String(promoted[0].to_email);
    expect(icsOf(sentTo(wrenEmail, /seat opened/)[0])).toMatchObject({ method: "REQUEST", uid: `${supper}-@village.example.test` });
    // The promotion is their confirmation, so the journey's own is skipped.
    const [wrenEnr] = await rows("SELECT facts FROM comms_enrollments WHERE journey_key = 'gathering.going' AND id <> ? AND subject_ref = ? AND state = 'active'", [samEnrollment, `event:${supper}:`]);
    const wf = typeof wrenEnr.facts === "string" ? JSON.parse(wrenEnr.facts) : wrenEnr.facts;
    expect(wf).toMatchObject({ promoted: true, stepOverrides: { confirm: { skip: true } } });
    expect(sentTo(wrenEmail, /coming to/)).toHaveLength(0);
    // Sam's journey stopped when the seat went back.
    const [samEnr] = await rows("SELECT state, stop_reason FROM comms_enrollments WHERE id = ?", [samEnrollment]);
    expect(samEnr).toEqual({ state: "stopped", stop_reason: "withdrew" });

    // Pressed again: the seat is already free, and nothing else moves.
    expect(await found!.handler.act(found!.payload, { choice: "cant" }, { village: "Test Village" })).toMatchObject({ ok: true });
    await deliver();
    expect(await messagesFor("event.promoted")).toHaveLength(1);
  });

  it("a second yes after giving the seat back is a new round with its own confirmation", async () => {
    const evening = await gathering();
    const kim = await member("Kim Again");
    await rsvp(pool, evening, kim.id, "going");
    await deliver();
    await withdrawRsvp(pool, evening, kim.id);
    await deliver();
    await rsvp(pool, evening, kim.id, "going");
    await deliver();
    const keys = (await messagesFor("journey")).filter((r) => r.to_email === kim.email).map((r) => String(r.idempotency_key))
      // Two rows inside one second order by their random ids, so order them by what they say.
      .sort((x, y) => x.length - y.length);
    expect(keys).toHaveLength(2);
    expect(keys[1]).toBe(`${keys[0]}:r1`);
  });

  let moved = "";
  let ivy = { id: "", email: "" };
  it("changing the time posts changed once with SEQUENCE+1, re-plans the reminders, and a second delivery posts nothing", async () => {
    moved = await gathering();
    ivy = await member("Ivy Moved");
    const guestContact = await ensureContact({ getPool: () => pool }, { email: "guest-gill@example.test", name: "Gill Guest", source: "guest", timezone: "Europe/Lisbon" });
    await rsvp(pool, moved, ivy.id, "going");
    await rsvp(pool, moved, `guest:${guestContact!.id}`, "going");
    await deliver();
    await pool.query("UPDATE comms_enrollments SET next_check_at = DATE_ADD(CURRENT_TIMESTAMP, INTERVAL 1 DAY) WHERE subject_ref LIKE ?", [`event:${moved}:%`]); // module-review-ok: the scratch schema

    await updateGathering(pool, moved, { startsAt: inDays(4), endsAt: inDays(4, 2) });
    const [result] = (await deliver()) as any[];
    expect(result).toMatchObject({ changed: 2, cancelledEvenings: 0 });
    expect(result.touched).toBeGreaterThanOrEqual(2);
    const due = await rows("SELECT COUNT(*) AS n FROM comms_enrollments WHERE subject_ref LIKE ? AND state = 'active' AND next_check_at <= CURRENT_TIMESTAMP", [`event:${moved}:%`]);
    expect(Number(due[0].n), "every journey on it plans again on the next tick").toBeGreaterThanOrEqual(2);

    const changed = await messagesFor("event.changed");
    expect(changed.map((r) => r.to_email).sort()).toEqual(["guest-gill@example.test", ivy.email].sort());
    expect(changed.every((r) => r.status === "queued")).toBe(true);
    await drain(office());
    const ics = icsOf(sentTo(ivy.email, /Changed/)[0]);
    expect(ics).toMatchObject({ method: "REQUEST", uid: `${moved}-@village.example.test`, sequence: 1 });
    // The guest reads the time in their own zone too.
    expect(sentTo("guest-gill@example.test", /Changed/)[0].text).toContain("Your time:");

    // The same trigger again finds everybody told: no bump, no post.
    await handleGatheringTrigger(deps(), { type: "gathering_changed", eventId: moved, fields: ["time"] });
    expect(await messagesFor("event.changed")).toHaveLength(2);
    const [seq] = await rows("SELECT ics_sequence FROM event_comms WHERE event_id = ?", [moved]);
    expect(seq.ics_sequence).toBe(1);

    // A title alone is no news.
    await updateGathering(pool, moved, { title: "Community supper, moved" });
    await deliver();
    expect(await messagesFor("event.changed")).toHaveLength(2);
  });

  it("reminders off reaches every enrollment's planner as a skip, and re-plans them", async () => {
    await saveEventComms(pool, moved, { reminders: [] });
    const out = await afterSettingsChange(deps(), moved, { reminders: true, host: null });
    expect(out.refreshed).toBe(2);
    const enrs = await rows("SELECT facts FROM comms_enrollments WHERE journey_key = 'gathering.going' AND subject_ref = ?", [`event:${moved}:`]);
    for (const e of enrs) {
      const f = typeof e.facts === "string" ? JSON.parse(e.facts) : e.facts;
      expect(f.stepOverrides).toEqual({ day: { skip: true }, soon: { skip: true } });
      expect(f.extraSteps).toEqual([]);
    }
    // And the live provider says the same to the engine.
    const provide = gatheringFactsProvider({ getPool: () => pool, postOffice: office() });
    const answer = await provide({
      getPool: () => pool,
      now: new Date(),
      villageZone: TZ,
      enrollment: { id: "e", journeyKey: "gathering.going", contactId: "c", subjectRef: `event:${moved}:`, stored: { personKey: ivy.id } },
      contact: null,
      definition: defaultJourney("gathering.going")!,
    });
    expect(answer).toMatchObject({ stepOverrides: { day: { skip: true }, soon: { skip: true } }, extraSteps: [], personKey: ivy.id });
  });

  it("gives the journey engine every gathering field, and the .ics with the confirmation", async () => {
    const build = gatheringVarsBuilder({ getPool: () => pool, postOffice: office() });
    const ctx = {
      getPool: () => pool,
      now: new Date(),
      villageZone: TZ,
      enrollment: { id: "e", journeyKey: "gathering.going", contactId: "c", subjectRef: `event:${moved}:`, stored: {} },
      contact: { id: "c", email: ivy.email, name: "Ivy Moved", timezone: "Europe/Lisbon" },
      definition: defaultJourney("gathering.going")!,
      facts: { personKey: ivy.id },
      village: { name: "Test Village", url: ORIGIN, logoUrl: null, seed: null, character: null, postalAddress: "" },
    };
    const confirm = await build({ ...ctx, step: { key: "confirm", templateKey: "gathering.confirm" } });
    expect(confirm.vars).toMatchObject({ "gathering.title": "Community supper, moved", "gathering.where": "The common house", "gathering.url": `${ORIGIN}/events` });
    expect(String(confirm.vars?.["gathering.whenLocal"])).not.toBe("");
    expect(String(confirm.vars?.["gathering.cantMakeIt"])).toContain(`${ORIGIN}/email/a?t=`);
    expect(confirm.attachments?.[0].contentType).toContain("method=REQUEST");
    const reminder = await build({ ...ctx, step: { key: "soon", templateKey: "gathering.reminder_soon" } });
    expect(reminder.attachments).toBeUndefined();
    expect(await build({ ...ctx, enrollment: { ...ctx.enrollment, subjectRef: "path:resident" }, step: { key: "x", templateKey: "gathering.confirm" } })).toEqual({});
  });

  it("cancelling posts one notice with METHOD:CANCEL to going and waitlisted, stops every enrollment, withdraws queued reminders, and nothing after", async () => {
    const full = await gathering({ capacity: 1 });
    const goer = await member("Gus Going");
    const waiter = await member("Wes Waiting");
    await rsvp(pool, full, goer.id, "going");
    await joinWaitlist(pool, full, waiter.id);
    await deliver();
    const [enr] = await rows("SELECT id, contact_id FROM comms_enrollments WHERE journey_key = 'gathering.going' AND subject_ref = ?", [`event:${full}:`]);
    // A reminder the tick had already queued for later.
    await insertMessage(pool, {
      id: "msg_queued_reminder", idempotencyKey: `j:gathering.going:day:${enr.id}`, contactId: String(enr.contact_id), userId: goer.id,
      toEmail: goer.email, emailKey: goer.email, kind: "events", origin: "journey", subject: "Tomorrow", templateKey: "gathering.reminder_day",
      templateVersion: 1, journeyKey: "gathering.going", stepKey: "day", enrollmentId: String(enr.id), letterId: null,
      bodyHtml: "<p>x</p>", bodyText: "x", attachments: null, replyTo: null, status: "queued", skipReason: null, lastError: null,
      sendAfter: Math.floor(Date.now() / 1000) + 86_400, expiresAt: null,
    } as any);

    await updateGathering(pool, full, { status: "cancelled" });
    const [result] = (await deliver()) as any[];
    expect(result).toMatchObject({ notices: 2 });
    const notices = await messagesFor("event.cancelled");
    expect(notices.map((r) => r.to_email).sort()).toEqual([goer.email, waiter.email].sort());
    await drain(office());
    for (const who of [goer.email, waiter.email]) {
      const mail = sentTo(who, /Cancelled/);
      expect(mail, who).toHaveLength(1);
      expect(icsOf(mail[0])).toMatchObject({ method: "CANCEL", uid: `${full}-@village.example.test`, sequence: 1 });
    }
    const states = await rows("SELECT journey_key, state FROM comms_enrollments WHERE subject_ref = ? ORDER BY journey_key", [`event:${full}:`]);
    expect(states.every((s) => s.state === "stopped")).toBe(true);
    const [reminder] = await rows("SELECT status FROM comms_messages WHERE id = 'msg_queued_reminder'");
    expect(reminder.status).toBe("cancelled");

    // Delivered again: every key is used, and the SEQUENCE stays where it went out.
    await handleGatheringTrigger(deps(), { type: "gathering_cancelled", eventId: full });
    expect(await messagesFor("event.cancelled")).toHaveLength(2);
    const [seq] = await rows("SELECT ics_sequence FROM event_comms WHERE event_id = ?", [full]);
    expect(seq.ics_sequence).toBe(1);
  });

  it("writes a deleted gathering's cancellation from what each person was told", async () => {
    const doomed = await gathering({ title: "Seed swap" });
    const tom = await member("Tom Told");
    await rsvp(pool, doomed, tom.id, "going");
    await deliver();
    await deleteGathering(pool, doomed);
    const [result] = (await deliver()) as any[];
    expect(result).toMatchObject({ notices: 1 });
    await drain(office());
    const mail = sentTo(tom.email, /Cancelled: Seed swap/);
    expect(mail).toHaveLength(1);
    expect(icsOf(mail[0])).toMatchObject({ method: "CANCEL", uid: `${doomed}-@village.example.test` });
    const states = await rows("SELECT state, stop_reason FROM comms_enrollments WHERE subject_ref = ?", [`event:${doomed}:`]);
    expect(states.every((s) => s.state === "stopped" && s.stop_reason === "gathering_removed")).toBe(true);
  });
});
