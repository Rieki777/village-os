import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool, RowDataPacket } from "mysql2/promise";
import { defaultTemplate } from "../../../shared/comms/defaults/templates";
import { provisionTestDb, testDbConfigured, testPool, type TestDb } from "../../db/testDb";
import { upsertContact } from "../../repos/commsContacts";
import { enrollmentById } from "../../repos/commsJourneys";
import { saveJourneyStep, setJourneyState } from "./journeyDefinitions";
import { enroll, tick, touch, walkThrough, type TickDeps } from "./journeys";
import type { CommsMode, PostOfficeDeps } from "./postOffice";
import type { Transport, TransportMessage } from "./transport";

/**
 * THE JOURNEY ENGINE AGAINST A REAL SCHEMA (the comms build spec 5.6): the
 * tick posting each step once, a moved gathering re-planned by `touch`, a
 * journey turned off and on again, the stop and wait rules, turning on
 * adopting the words, an edit making a version that existing people do not
 * follow, and "Walk someone through it" agreeing with what the tick then
 * sends. The clock is handed in, so a day passes in a line.
 *
 * The cases share one schema and run in order; each makes its own gathering
 * and people and reads only their rows. The edit case runs last because it
 * changes the journey every later enrollment would start on.
 */

const configured = testDbConfigured();
let db: TestDb;
let pool: Pool;

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const LIVE: CommsMode = { lifecycle: "members", paused: false, rehearsalTo: [] };

const sent: TransportMessage[] = [];
const transport: Transport = {
  name: "resend",
  async send(m) {
    sent.push(m);
    return { ok: true, providerId: `prov_${Math.random().toString(36).slice(2)}` };
  },
};

const office: PostOfficeDeps = {
  getPool: () => pool,
  transport,
  sender: () => "Village <hello@village.example.test>",
  hasApiKey: () => true,
  origin: () => "https://village.example.test",
  mode: async () => LIVE,
  dial: (k) => ({ "comms.daily_cap": 2, "comms.send_rate_per_second": 50, "comms.notice_expiry_minutes": 120 })[k],
};

let clock = 0;
const deps = (over: Partial<TickDeps> = {}): TickDeps => ({
  getPool: () => pool,
  postOffice: office,
  lifecycle: () => "members",
  villageZone: () => "UTC",
  quietHours: () => ({ start: 8, end: 20 }),
  reminderDials: () => ({ reminderMinutes: null, hostNudgeMinutes: null }),
  now: () => new Date(clock),
  ...over,
});

/** A fresh start for one case: a minute ahead of the database's own clock, so every row written now is due. */
const freshClock = () => {
  clock = Math.floor(Date.now() / 1000) * 1000 + MIN;
  return clock;
};

let seq = 0;
/** A gathering starting `inMs` from the clock, and a guest who said yes to it, enrolled now. */
async function gatheringWithGuest(inMs: number, opts: { enrollNow?: boolean } = {}) {
  const n = ++seq;
  const eventId = `ev-journeys-${n}`;
  const starts = new Date(clock + inMs);
  await pool.query( // module-review-ok: seeding the scratch schema this suite provisioned
    "INSERT INTO events (id, title, starts_at, ends_at, status) VALUES (?, ?, ?, ?, 'scheduled')",
    [eventId, `Supper ${n}`, starts, new Date(starts.getTime() + 2 * HOUR)],
  );
  const contact = await upsertContact(pool, {
    id: `ct_journeys_${n}`,
    emailKey: `guest-${n}@example.test`,
    email: `guest-${n}@example.test`,
    name: `Guest ${n}`,
    userId: null,
    source: "test",
    timezone: null,
  });
  const personKey = `guest:${contact.id}`;
  await pool.query( // module-review-ok: seeding the scratch schema this suite provisioned
    "INSERT INTO event_rsvps (id, event_id, user_id, status, idempotency_key, occurrence_key) VALUES (?, ?, ?, 'going', ?, '')",
    [`rs-journeys-${n}`, eventId, personKey, `rsvp:${eventId}:${personKey}`],
  );
  const subjectRef = `event:${eventId}:`;
  const enrollment =
    opts.enrollNow === false
      ? null
      : await enroll({ getPool: () => pool }, { journeyKey: "gathering.going", contactId: contact.id, subjectRef, facts: { personKey }, anchorAt: new Date(clock) });
  return { eventId, starts, contactId: contact.id, personKey, subjectRef, enrollmentId: enrollment?.enrollmentId ?? "" };
}

/**
 * The steps posted for one enrollment, in the order the journey sends them.
 * `created_at` has one-second grain and ids are random, so neither orders rows
 * written by one run; the journey's own order does.
 */
const STEP_ORDER = ["confirm", "day", "soon"];
async function stepsPosted(enrollmentId: string): Promise<Array<{ step: string; status: string; subject: string }>> {
  const [rows] = await pool.query<RowDataPacket[]>( // module-review-ok: reading back the scratch schema this suite provisioned
    "SELECT step_key, status, subject FROM comms_messages WHERE enrollment_id = ?",
    [enrollmentId],
  );
  return rows
    .map((r) => ({ step: String(r.step_key), status: String(r.status), subject: String(r.subject) }))
    .sort((x, y) => STEP_ORDER.indexOf(x.step) - STEP_ORDER.indexOf(y.step));
}

const keysPosted = async (id: string) => (await stepsPosted(id)).map((s) => s.step);

beforeAll(async () => {
  if (!configured) return;
  db = await provisionTestDb();
  pool = testPool(db, { connectionLimit: 6 });
});

afterAll(async () => {
  await pool?.end();
  await db?.drop();
});

describe.skipIf(!configured)("the journey engine", () => {
  it("turning a journey on adopts the words of every email it sends", async () => {
    freshClock();
    const [before] = await pool.query<RowDataPacket[]>( // module-review-ok: reading back the scratch schema this suite provisioned
      "SELECT template_key FROM comms_templates WHERE template_key LIKE 'gathering.%'",
    );
    expect(before).toEqual([]);
    const on = await setJourneyState(deps(), "gathering.going", "on", "u-admin");
    expect(on?.status.state).toBe("on");
    expect([...(on?.adopted ?? [])].sort()).toEqual(["gathering.confirm", "gathering.reminder_day", "gathering.reminder_soon"]);
    const [rows] = await pool.query<RowDataPacket[]>( // module-review-ok: reading back the scratch schema this suite provisioned
      "SELECT template_key, state, platform_version, edited_by FROM comms_templates WHERE template_key LIKE 'gathering.%' ORDER BY template_key",
    );
    expect(rows.map((r) => [r.template_key, r.state, Number(r.platform_version), r.edited_by])).toEqual([
      // Each copy remembers the platform version it was taken from.
      ["gathering.confirm", "live", defaultTemplate("gathering.confirm")!.version, "u-admin"],
      ["gathering.reminder_day", "live", defaultTemplate("gathering.reminder_day")!.version, "u-admin"],
      ["gathering.reminder_soon", "live", defaultTemplate("gathering.reminder_soon")!.version, "u-admin"],
    ]);
    // Turning it on again copies nothing twice.
    expect((await setJourneyState(deps(), "gathering.going", "on", "u-admin"))?.adopted).toEqual([]);
  });

  it("a tick run twice posts each step once, and two ticks at once do too", async () => {
    freshClock();
    const g = await gatheringWithGuest(4 * DAY);
    await tick(deps());
    await tick(deps());
    // The gathering's own values (its title, its time) arrive with the event email lane's vars builder;
    // until then the words render their fallbacks.
    expect(await stepsPosted(g.enrollmentId)).toEqual([{ step: "confirm", status: "sent", subject: expect.stringContaining("You're coming to") }]);

    const h = await gatheringWithGuest(4 * DAY);
    await Promise.all([tick(deps()), tick(deps())]);
    expect(await keysPosted(h.enrollmentId)).toEqual(["confirm"]);
    // The next look is the day-before reminder.
    expect((await enrollmentById(pool, h.enrollmentId))?.nextCheckAt).toBe(Math.floor((h.starts.getTime() - DAY) / 1000));
  });

  it("touch() makes a moved gathering re-plan on the next tick", async () => {
    const t0 = freshClock();
    const g = await gatheringWithGuest(4 * DAY);
    await tick(deps());
    expect(await keysPosted(g.enrollmentId)).toEqual(["confirm"]);
    // The gathering moves two days earlier: the day-before reminder is now a day from the start of this case.
    await pool.query( // module-review-ok: moving an anchor in the scratch schema, the way the spec's suites drive time
      "UPDATE events SET starts_at = ?, ends_at = ? WHERE id = ?",
      [new Date(t0 + 2 * DAY), new Date(t0 + 2 * DAY + 2 * HOUR), g.eventId],
    );
    clock = t0 + DAY + 10 * MIN;
    await tick(deps());
    expect(await keysPosted(g.enrollmentId), "untouched, the tick still waits for the old time").toEqual(["confirm"]);
    expect(await touch({ getPool: () => pool }, `event:${g.eventId}`)).toBe(1);
    await tick(deps());
    expect(await keysPosted(g.enrollmentId)).toEqual(["confirm", "day"]);
  });

  it("a journey turned off posts nothing and resumes with catch-up applied", async () => {
    const t0 = freshClock();
    await setJourneyState(deps(), "gathering.going", "off", "u-admin");
    const g = await gatheringWithGuest(4 * DAY);
    await tick(deps());
    expect(await keysPosted(g.enrollmentId)).toEqual([]);
    clock = t0 + 3 * DAY + 2 * HOUR;
    await tick(deps());
    expect(await keysPosted(g.enrollmentId), "still nothing while it is off").toEqual([]);
    expect((await enrollmentById(pool, g.enrollmentId))?.state).toBe("active");

    const on = await setJourneyState(deps(), "gathering.going", "on", "u-admin");
    expect(on?.touched).toBeGreaterThanOrEqual(1);
    await tick(deps());
    // The confirmation is three days late, past its lateness; the day-before reminder is two hours late and goes.
    expect(await keysPosted(g.enrollmentId)).toEqual(["day"]);
    const walk = await walkThrough(deps(), "gathering.going", { enrollmentId: g.enrollmentId });
    if ("missing" in walk) throw new Error(walk.missing);
    expect(walk.steps.find((s) => s.key === "confirm")).toMatchObject({ outcome: "skipped", reason: "too_late" });
  });

  it("stops for good when the person takes their yes back, or the gathering is called off", async () => {
    freshClock();
    const withdrew = await gatheringWithGuest(4 * DAY);
    const cancelled = await gatheringWithGuest(4 * DAY);
    await pool.query("DELETE FROM event_rsvps WHERE event_id = ?", [withdrew.eventId]); // module-review-ok: a withdrawal, in the scratch schema this suite provisioned
    await pool.query("UPDATE events SET status = 'cancelled' WHERE id = ?", [cancelled.eventId]); // module-review-ok: a cancellation, in the scratch schema this suite provisioned
    await tick(deps());
    expect(await enrollmentById(pool, withdrew.enrollmentId)).toMatchObject({ state: "stopped", stopReason: "withdrew" });
    expect(await enrollmentById(pool, cancelled.enrollmentId)).toMatchObject({ state: "stopped", stopReason: "gathering_cancelled" });
    expect(await keysPosted(withdrew.enrollmentId)).toEqual([]);
    expect(await keysPosted(cancelled.enrollmentId)).toEqual([]);
  });

  it("waits while the time is still being voted, and sends the confirmation once the vote locks", async () => {
    const t0 = freshClock();
    const g = await gatheringWithGuest(4 * DAY);
    await pool.query( // module-review-ok: seeding the scratch schema this suite provisioned
      "INSERT INTO event_time_polls (id, event_id, mode, state, created_by) VALUES (?, ?, 'once', 'open', 'u-host')",
      [`poll-${g.eventId}`, g.eventId],
    );
    await tick(deps());
    expect(await keysPosted(g.enrollmentId)).toEqual([]);
    await pool.query("UPDATE event_time_polls SET state = 'locked' WHERE event_id = ?", [g.eventId]); // module-review-ok: locking the vote in the scratch schema
    clock = t0 + 20 * MIN;
    await tick(deps());
    expect(await keysPosted(g.enrollmentId)).toEqual(["confirm"]);
  });

  it("Walk someone through it shows the same steps the tick then sends", async () => {
    const t0 = freshClock();
    const g = await gatheringWithGuest(4 * DAY);
    const walk = await walkThrough(deps(), "gathering.going", { enrollmentId: g.enrollmentId });
    if ("missing" in walk) throw new Error(walk.missing);
    const planned = walk.steps.filter((s) => s.outcome === "sent");
    expect(planned.map((s) => [s.key, s.sendsAt])).toEqual([
      ["confirm", new Date(t0).toISOString()],
      ["day", new Date(g.starts.getTime() - DAY).toISOString()],
      ["soon", new Date(g.starts.getTime() - 2 * HOUR).toISOString()],
    ]);
    for (const s of planned) {
      clock = new Date(s.sendsAt as string).getTime() + 2 * MIN;
      await tick(deps());
    }
    const posted = await stepsPosted(g.enrollmentId);
    expect(posted.map((p) => p.step)).toEqual(planned.map((s) => s.key));
    expect(posted.map((p) => p.subject)).toEqual(planned.map((s) => s.subject));
    expect((await enrollmentById(pool, g.enrollmentId))?.state).toBe("finished");

    // A made-up person, a day before a gathering, is told the same rule a real one is.
    clock = t0;
    const made = await walkThrough(deps(), "gathering.going", { madeUp: { name: "Robin Example", startsAt: new Date(t0 + 20 * HOUR) } });
    if ("missing" in made) throw new Error(made.missing);
    expect(made.steps.map((s) => [s.key, s.outcome])).toEqual([
      ["day", "skipped"],
      ["confirm", "sent"],
      ["soon", "sent"],
    ]);
    expect(made.person).toMatchObject({ name: "Robin Example", email: null, madeUp: true });
  });

  it("does nothing while the comms module is off", async () => {
    freshClock();
    const g = await gatheringWithGuest(4 * DAY);
    expect(await tick(deps({ lifecycle: () => "off" }))).toEqual({ checked: 0, posted: 0, stopped: 0, finished: 0, waiting: 0, failed: 0 });
    expect(await tick(deps({ lifecycle: undefined }))).toMatchObject({ checked: 0 });
    expect(await keysPosted(g.enrollmentId)).toEqual([]);
  });

  it("an edit makes a version, and an existing enrollment keeps its old one", async () => {
    const t0 = freshClock();
    const before = await gatheringWithGuest(4 * DAY);
    await tick(deps());
    const saved = await saveJourneyStep(deps(), "gathering.going", "day", { offsetMinutes: -2 * 24 * 60 }, "u-admin");
    if (!saved || "problems" in saved) throw new Error("the edit was refused");
    expect(saved.version).toBe(2);
    expect(saved.status.own).toBe(true);
    const [versions] = await pool.query<RowDataPacket[]>( // module-review-ok: reading back the scratch schema this suite provisioned
      "SELECT version, created_by FROM comms_journey_versions WHERE journey_key = 'gathering.going' ORDER BY version",
    );
    expect(versions.map((v) => [Number(v.version), v.created_by])).toEqual([
      [1, null],
      [2, "u-admin"],
    ]);

    const after = await gatheringWithGuest(4 * DAY);
    expect((await enrollmentById(pool, before.enrollmentId))?.journeyVersion).toBe(1);
    expect((await enrollmentById(pool, after.enrollmentId))?.journeyVersion).toBe(2);
    await tick(deps());

    clock = t0 + 2 * DAY + 10 * MIN;
    await tick(deps());
    expect(await keysPosted(after.enrollmentId), "the new version's reminder goes two days before").toEqual(["confirm", "day"]);
    expect(await keysPosted(before.enrollmentId), "the old version still waits for one day before").toEqual(["confirm"]);
    clock = t0 + 3 * DAY + 10 * MIN;
    await tick(deps());
    expect(await keysPosted(before.enrollmentId)).toEqual(["confirm", "day"]);
  });
});
