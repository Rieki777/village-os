import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool, RowDataPacket } from "mysql2/promise";
import { provisionTestDb, testDbConfigured, testPool, type TestDb } from "../../db/testDb";
import { civilDateKey } from "../../../shared/lunar";
import { listCalendarItems } from "../calendar";
import { createGathering, getGathering, rsvp } from "../gatherings";
import { enroll } from "./journeys";
import type { CommsMode, PostOfficeDeps } from "./postOffice";
import type { Transport } from "./transport";
import {
  closePoll,
  createPoll,
  lockNow,
  pinPollOption,
  pollView,
  removePollOption,
  runTimePollJob,
  settlePoll,
  timeVoteAction,
  updatePoll,
  vote,
  type TimePollDeps,
} from "./timePolls";
import { timeStillBeingVoted } from "./timePollSummary";
import { pollForEvent } from "../../repos/timePolls";

/**
 * The live time vote against a real schema (the comms build spec 5.10), with
 * the post office writing its ledger and a transport that records instead of
 * sending. Each case is one of the lane's acceptance rules, at the layer that
 * carries it out: the gathering moves through `updateGathering`, so what is
 * asserted is the gathering as the calendar serves it.
 */

const configured = testDbConfigured();
let db: TestDb;
let pool: Pool;

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const LIVE: CommsMode = { lifecycle: "members", paused: false, rehearsalTo: [] };

const transport: Transport = { name: "resend", send: async () => ({ ok: true, providerId: `prov_${Math.random().toString(36).slice(2)}` }) };
const office = (): PostOfficeDeps => ({
  getPool: () => pool,
  transport,
  sender: () => "Village <hello@village.example.test>",
  hasApiKey: () => true,
  origin: () => "https://village.example.test",
  mode: async () => LIVE,
  dial: (k) => ({ "comms.daily_cap": 2, "comms.send_rate_per_second": 50, "comms.notice_expiry_minutes": 120 })[k],
});

/** Members the vote can write to: an address and a name each. */
const people: Record<string, { id: string; email: string; name: string }> = {};
for (const id of ["u-1", "u-2", "u-3", "u-4", "u-5", "u-9"]) people[id] = { id, email: `${id}@village.example.test`, name: `Person ${id}` };

const deps = (): TimePollDeps => ({
  getPool: () => pool,
  postOffice: office(),
  members: { byId: async (id: string) => people[id] ?? null },
  timezone: () => "UTC",
  dial: (k) => (k === "comms.time_poll_settle_minutes" ? 0 : 48),
});

/** An instant N hours from now, whole minutes, as ISO. */
const inHours = (h: number) => new Date(Math.floor((Date.now() + h * HOUR) / 60_000) * 60_000).toISOString();

async function messages(origin: string, eventTitle?: string): Promise<RowDataPacket[]> {
  const [rows] = await pool.query<RowDataPacket[]>( // module-review-ok: reading back the scratch schema this suite provisioned
    "SELECT id, to_email, subject, idempotency_key, attachments FROM comms_messages WHERE origin = ? ORDER BY created_at, id",
    [origin],
  );
  return eventTitle ? rows.filter((r) => String(r.subject).includes(eventTitle)) : rows;
}

const startOf = async (eventId: string) => (await getGathering(pool, eventId))!.startsAt;

beforeAll(async () => {
  if (!configured) return;
  db = await provisionTestDb();
  pool = testPool(db, { connectionLimit: 8 });
});

afterAll(async () => {
  await pool?.end();
  await db?.drop();
});

describe.skipIf(!configured)("a one-off gathering's live time vote", () => {
  let eventId = "";
  const A = inHours(5 * 24);
  const B = inHours(6 * 24);
  const C = inHours(7 * 24);

  it("puts the gathering on the first time at once, and votes move the gathering's time live with settle 0", async () => {
    const g = await createGathering(pool, { title: "Soup night", startsAt: inHours(10 * 24), status: "scheduled", layer: "village" }, "u-host");
    eventId = g.id;
    const made = await createPoll(deps(), { eventId, mode: "once", options: [{ startsAt: A }, { startsAt: B, durationMinutes: 90 }, { startsAt: C }], createdBy: "u-host" });
    expect(made.ok, JSON.stringify(made)).toBe(true);
    expect(await startOf(eventId)).toBe(A);

    expect(await vote(deps(), (await pollForEvent(pool, eventId))!.id, "u-1", { set: [] })).toMatchObject({ ok: true });
    const poll = (await pollForEvent(pool, eventId))!;
    const [, b] = (await pollView(deps(), eventId, { personKey: null, signedIn: false, canManage: false }))!.options;
    expect(await vote(deps(), poll.id, "u-1", { set: [b.id] })).toEqual({ ok: true, value: [b.id] });
    // Live: the vote's own request moved it, with the time's own length.
    const moved = await getGathering(pool, eventId);
    expect(moved!.startsAt).toBe(B);
    expect(moved!.endsAt).toBe(new Date(Date.parse(B) + 90 * 60_000).toISOString());
    // A one-off vote sends nothing while it moves.
    expect(await messages("poll.moved")).toEqual([]);
    expect(await messages("poll.locked")).toEqual([]);
  });

  it("keeps the current leader through a tie", async () => {
    const poll = (await pollForEvent(pool, eventId))!;
    const [, , c] = (await pollView(deps(), eventId, { personKey: null, signedIn: false, canManage: false }))!.options;
    await vote(deps(), poll.id, "u-2", { add: c.id });
    expect(await startOf(eventId)).toBe(B);
    expect((await pollForEvent(pool, eventId))!.leaderOptionId).toBe(poll.leaderOptionId);
  });

  it("waits the settle time before moving to a new leader: settle 60 waits an hour", async () => {
    expect(await updatePoll(deps(), eventId, { settleMinutes: 60 })).toEqual({ ok: true, value: null });
    const poll = (await pollForEvent(pool, eventId))!;
    const [, , c] = (await pollView(deps(), eventId, { personKey: null, signedIn: false, canManage: false }))!.options;
    await vote(deps(), poll.id, "u-3", { add: c.id });
    const led = (await pollForEvent(pool, eventId))!;
    expect(led.leaderOptionId).toBe(c.id);
    expect(await startOf(eventId)).toBe(B);
    await settlePoll(deps(), poll.id);
    expect(await startOf(eventId)).toBe(B);
    // Fifty-nine minutes in: still waiting.
    await pool.query("UPDATE event_time_polls SET leader_since = leader_since - INTERVAL 59 MINUTE WHERE id = ?", [poll.id]); // module-review-ok: moving the clock in the scratch schema this suite provisioned
    await settlePoll(deps(), poll.id);
    expect(await startOf(eventId)).toBe(B);
    await pool.query("UPDATE event_time_polls SET leader_since = leader_since - INTERVAL 2 MINUTE WHERE id = ?", [poll.id]); // module-review-ok: moving the clock in the scratch schema this suite provisioned
    await settlePoll(deps(), poll.id);
    expect(await startOf(eventId)).toBe(C);
  });

  it("lets the pin beat the vote, and the vote steers again when the pin is cleared", async () => {
    const [a] = (await pollView(deps(), eventId, { personKey: null, signedIn: false, canManage: false }))!.options;
    expect(await pinPollOption(deps(), eventId, a.id)).toEqual({ ok: true, value: null });
    expect(await startOf(eventId)).toBe(A);
    expect(await pinPollOption(deps(), eventId, null)).toEqual({ ok: true, value: null });
    expect(await startOf(eventId)).toBe(C);
  });

  it("refuses to drop below two times", async () => {
    const [a, b] = (await pollView(deps(), eventId, { personKey: null, signedIn: false, canManage: false }))!.options;
    expect(await removePollOption(deps(), eventId, a.id)).toEqual({ ok: true, value: null });
    expect(await removePollOption(deps(), eventId, b.id)).toMatchObject({ ok: false, status: 409 });
  });

  it("holds the gathering's journey while voting, and the lock sends 'time is set' once with a calendar file and starts the reminders", async () => {
    expect(await timeStillBeingVoted(pool, { eventId })).toBe(true);
    expect((await rsvp(pool, eventId, "u-9", "going")).ok).toBe(true);
    const { enrollmentId } = await enroll({ getPool: () => pool }, { journeyKey: "gathering.going", contactId: "ct-u9", subjectRef: `event:${eventId}:` });
    await pool.query("UPDATE comms_enrollments SET next_check_at = CURRENT_TIMESTAMP + INTERVAL 30 DAY WHERE id = ?", [enrollmentId]); // module-review-ok: parking the enrollment in the scratch schema this suite provisioned

    expect(await lockNow(deps(), eventId)).toEqual({ ok: true, value: null });
    expect(await lockNow(deps(), eventId)).toMatchObject({ ok: false, status: 409 });
    await settlePoll(deps(), (await pollForEvent(pool, eventId))!.id);
    await runTimePollJob(deps());

    const locked = await messages("poll.locked", "Soup night");
    // Everyone who voted (u-1, u-2, u-3) and everyone who answered (u-9), once each.
    expect(locked.map((r) => r.to_email).sort()).toEqual(["u-1", "u-2", "u-3", "u-9"].map((u) => `${u}@village.example.test`));
    const files = locked.map((r) => (typeof r.attachments === "string" ? JSON.parse(r.attachments) : r.attachments));
    const ics = Buffer.from(files[0][0].contentBase64, "base64").toString("utf8");
    expect(ics).toContain("METHOD:REQUEST");
    expect(ics).toContain(`UID:${eventId}-@village.example.test`);
    expect(ics).toContain(`DTSTART:${C.replace(/[-:]/g, "").replace(/\.\d{3}/, "")}`);
    expect(ics).toMatch(/SEQUENCE:\d+/);

    expect(await timeStillBeingVoted(pool, { eventId })).toBe(false);
    const [row] = await pool.query<RowDataPacket[]>( // module-review-ok: reading back the scratch schema this suite provisioned
      "SELECT next_check_at <= CURRENT_TIMESTAMP AS due FROM comms_enrollments WHERE id = ?",
      [enrollmentId],
    );
    expect(Number(row[0].due), "the reminders re-plan on the next tick").toBe(1);
    // A vote on a locked poll changes nothing.
    expect(await vote(deps(), (await pollForEvent(pool, eventId))!.id, "u-4", { set: [] })).toMatchObject({ ok: false, status: 409 });
  });

  it("locks a one-off vote by itself once its close time comes", async () => {
    const g = await createGathering(pool, { title: "Seed swap", startsAt: inHours(9 * 24), status: "scheduled", layer: "village" }, "u-host");
    await createPoll(deps(), { eventId: g.id, mode: "once", options: [{ startsAt: inHours(4 * 24) }, { startsAt: inHours(5 * 24) }], createdBy: "u-host" });
    expect((await runTimePollJob(deps())).locked).toBe(0);
    // Its earliest time drifts inside the freeze: the default close has passed.
    await pool.query("UPDATE event_time_poll_options o JOIN event_time_polls p ON p.id = o.poll_id SET o.starts_at = o.starts_at - INTERVAL 3 DAY WHERE p.event_id = ?", [g.id]); // module-review-ok: moving the clock in the scratch schema this suite provisioned
    const run = await runTimePollJob(deps());
    expect(run.locked).toBe(1);
    expect((await pollForEvent(pool, g.id))!.state).toBe("locked");
  });
});

describe.skipIf(!configured)("a weekly series' live time vote", () => {
  let eventId = "";
  let keys: string[] = [];
  /** The series' first evening is a day out: inside the 48-hour freeze. */
  const first = new Date(inHours(24));
  const weekday = first.getUTCDay();
  const minute = first.getUTCHours() * 60 + first.getUTCMinutes();
  const later = { weekday: (weekday + 1) % 7, startMinute: (minute + 60) % 1440 };

  it("never moves an evening inside the freeze, keeps every evening's key, and sends one 'moved' per person per move", async () => {
    const g = await createGathering(
      pool,
      { title: "Community session", startsAt: first.toISOString(), endsAt: new Date(first.getTime() + HOUR).toISOString(), status: "scheduled", layer: "village", recurrence: { freq: "weekly", byWeekday: [weekday] } },
      "u-host",
    );
    eventId = g.id;
    keys = [0, 7, 14].map((d) => civilDateKey(new Date(first.getTime() + d * DAY), "UTC"));
    const made = await createPoll(deps(), { eventId, mode: "weekly", options: [{ weekday, startMinute: minute }, later], createdBy: "u-host" });
    expect(made.ok, JSON.stringify(made)).toBe(true);
    // The first time is the series' own, so nothing moved and nobody heard.
    expect(await messages("poll.moved")).toEqual([]);
    expect((await rsvp(pool, eventId, "u-1", "going", undefined, keys[0])).ok).toBe(true);
    expect((await rsvp(pool, eventId, "u-1", "going", undefined, keys[1])).ok).toBe(true);

    const poll = (await pollForEvent(pool, eventId))!;
    const [, b] = (await pollView(deps(), eventId, { personKey: null, signedIn: false, canManage: false }))!.options;
    await vote(deps(), poll.id, "u-2", { add: b.id });

    const items = await listCalendarItems(pool, {
      from: new Date(Date.now() - DAY), to: new Date(Date.now() + 20 * DAY), viewer: { userId: "u-1", isAdmin: false }, timezone: "UTC",
    });
    const mine = items.filter((i) => i.id === eventId);
    expect(mine.map((i) => i.occurrenceKey)).toEqual(keys);
    // Inside the freeze: where it was. Beyond it: on the winning slot, under its old key.
    expect(mine[0].startsAt).toBe(first.toISOString());
    for (const i of mine.slice(1)) {
      expect(new Date(i.startsAt).getUTCDay()).toBe(later.weekday);
      expect(new Date(i.startsAt).getUTCHours() * 60 + new Date(i.startsAt).getUTCMinutes()).toBe(later.startMinute);
    }
    // u-1's yes on the second evening still names it.
    expect(mine[1].myRsvp).toBe("going");
    expect(mine[0].timePoll).toMatchObject({ state: "open", mode: "weekly", stillVoting: false });
    expect(mine[1].timePoll).toMatchObject({ stillVoting: true });

    const moved = await messages("poll.moved", "Community session");
    expect(moved.map((r) => r.to_email).sort()).toEqual(["u-1@village.example.test", "u-2@village.example.test"]);
  });

  it("sends nothing more when nothing moves, and once more per person on the next move", async () => {
    const poll = (await pollForEvent(pool, eventId))!;
    await settlePoll(deps(), poll.id);
    await runTimePollJob(deps());
    const [a, b] = (await pollView(deps(), eventId, { personKey: null, signedIn: false, canManage: false }))!.options;
    await vote(deps(), poll.id, "u-3", { add: b.id });
    expect(await messages("poll.moved", "Community session")).toHaveLength(2);

    for (const u of ["u-4", "u-5", "u-1"]) await vote(deps(), poll.id, u, { add: a.id });
    const moved = await messages("poll.moved", "Community session");
    const perPerson = new Map<string, number>();
    for (const r of moved) perPerson.set(String(r.to_email), (perPerson.get(String(r.to_email)) ?? 0) + 1);
    expect(Object.fromEntries(perPerson)).toEqual({
      "u-1@village.example.test": 2,
      "u-2@village.example.test": 2,
      "u-3@village.example.test": 1,
      "u-4@village.example.test": 1,
      "u-5@village.example.test": 1,
    });
    const back = (await listCalendarItems(pool, {
      from: new Date(Date.now() - DAY), to: new Date(Date.now() + 20 * DAY), viewer: { userId: null, isAdmin: false }, timezone: "UTC",
    })).filter((i) => i.id === eventId);
    expect(back.map((i) => i.startsAt)).toEqual(keys.map((_, n) => new Date(first.getTime() + n * 7 * DAY).toISOString()));
  });
});

describe.skipIf(!configured)("a guest's vote from a signed link", () => {
  it("shows the tally and the guest's picks, and a second press of the same time holds one vote", async () => {
    const g = await createGathering(pool, { title: "Bread day", startsAt: inHours(12 * 24), status: "scheduled", layer: "public" }, "u-host");
    await createPoll(deps(), { eventId: g.id, mode: "once", options: [{ startsAt: inHours(8 * 24) }, { startsAt: inHours(9 * 24) }], createdBy: "u-host" });
    const poll = (await pollForEvent(pool, g.id))!;
    const [, b] = (await pollView(deps(), g.id, { personKey: null, signedIn: false, canManage: false }))!.options;
    const action = timeVoteAction(deps());
    const payload = { p: poll.id, o: b.id, k: "guest:ct_guest1" };
    const before = await action.describe(payload, { village: "the village" });
    expect(before?.choices[0]).toMatchObject({ value: `yes:${b.id}`, primary: true });
    const first = await action.act(payload, { choice: `yes:${b.id}` }, { village: "the village" });
    expect(first.ok).toBe(true);
    const again = await action.act(payload, { choice: `yes:${b.id}` }, { village: "the village" });
    expect(again.ok).toBe(true);
    const [rows] = await pool.query<RowDataPacket[]>( // module-review-ok: reading back the scratch schema this suite provisioned
      "SELECT COUNT(*) AS n FROM event_time_poll_votes WHERE poll_id = ? AND person_key = 'guest:ct_guest1'",
      [poll.id],
    );
    expect(Number(rows[0].n)).toBe(1);
    expect(await startOf(g.id), "the guest's pick moved the gathering live").toBe((await pollView(deps(), g.id, { personKey: null, signedIn: false, canManage: false }))!.options[1].startsAt);
    if (!again.ok) throw new Error("unreachable");
    expect(again.outcome.description?.choices.find((c) => c.value.endsWith(b.id))?.value).toBe(`no:${b.id}`);
    expect(await action.act(payload, { choice: "maybe" }, { village: "the village" })).toMatchObject({ ok: false, status: 400 });
  });

  it("removes a vote and keeps the gathering's time", async () => {
    const g = await createGathering(pool, { title: "Kiln firing", startsAt: inHours(12 * 24), status: "scheduled", layer: "village" }, "u-host");
    await createPoll(deps(), { eventId: g.id, mode: "once", options: [{ startsAt: inHours(8 * 24) }, { startsAt: inHours(9 * 24) }], createdBy: "u-host" });
    const at = await startOf(g.id);
    expect(await closePoll(deps(), g.id)).toEqual({ ok: true, value: null });
    expect(await pollForEvent(pool, g.id)).toBeNull();
    expect(await startOf(g.id)).toBe(at);
    expect((await listCalendarItems(pool, { from: new Date(), to: new Date(Date.now() + 20 * DAY), viewer: { userId: null, isAdmin: false }, timezone: "UTC" })).find((i) => i.id === g.id)?.timePoll).toBeUndefined();
  });
});
