import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool, RowDataPacket } from "mysql2/promise";
import { provisionTestDb, testDbConfigured, testPool, type TestDb } from "../db/testDb";
import {
  answeredKeys,
  approvalsOf,
  bumpIcsSequence,
  databaseNowMs,
  deletePollRows,
  icsSequenceOf,
  insertPoll,
  lockPollRow,
  pollForEvent,
  pollOptions,
  pollsWithOptionsFor,
  pollVotes,
  removeOption,
  reopenPollRow,
  setPinned,
  voterKeys,
  writeApprovals,
} from "./timePolls";

/**
 * The time vote's tables against a real schema (drizzle/0229): one poll per
 * gathering, one approval per person per time, a vote refused once the poll
 * locks, a lock claimed by exactly one caller, a removed time's votes kept,
 * and the reads the emails and the calendar make.
 */

const configured = testDbConfigured();
let db: TestDb;
let pool: Pool;

const opts = (pollId: string) => [
  { id: `${pollId}-a`, startsAt: new Date("2030-01-10T18:00:00Z"), weekday: null, startMinute: null, durationMinutes: 60, position: 0 },
  { id: `${pollId}-b`, startsAt: new Date("2030-01-11T18:00:00Z"), weekday: null, startMinute: null, durationMinutes: 90, position: 1 },
  { id: `${pollId}-c`, startsAt: new Date("2030-01-12T18:00:00Z"), weekday: null, startMinute: null, durationMinutes: 60, position: 2 },
];

async function makePoll(pollId: string, eventId: string): Promise<void> {
  const made = await insertPoll(
    pool,
    { id: pollId, eventId, mode: "once", closesAt: null, settleMinutes: 0, freezeHours: 48, showNames: true, createdBy: "u-host" },
    opts(pollId),
  );
  expect(made).toEqual({ ok: true });
}

beforeAll(async () => {
  if (!configured) return;
  db = await provisionTestDb();
  pool = testPool(db, { connectionLimit: 6 });
});

afterAll(async () => {
  await pool?.end();
  await db?.drop();
});

describe.skipIf(!configured)("the time vote tables", () => {
  it("holds one poll per gathering by its key, and writes the options with their DATETIME starts intact", async () => {
    await makePoll("tp-1", "ev-1");
    const again = await insertPoll(
      pool,
      { id: "tp-1b", eventId: "ev-1", mode: "once", closesAt: null, settleMinutes: 0, freezeHours: 48, showNames: true, createdBy: "u" },
      opts("tp-1b"),
    );
    expect(again).toEqual({ ok: false, reason: "exists" });
    // The refused poll left no options behind.
    expect(await pollOptions(pool, "tp-1b")).toEqual([]);
    const options = await pollOptions(pool, "tp-1");
    expect(options.map((o) => [o.id, o.startsAt?.toISOString(), o.durationMinutes])).toEqual([
      ["tp-1-a", "2030-01-10T18:00:00.000Z", 60],
      ["tp-1-b", "2030-01-11T18:00:00.000Z", 90],
      ["tp-1-c", "2030-01-12T18:00:00.000Z", 60],
    ]);
    expect(await pollForEvent(pool, "ev-1")).toMatchObject({ id: "tp-1", mode: "once", state: "open", showNames: true, closesAt: null });
  });

  it("keeps one approval per person per time however often it is pressed", async () => {
    expect(await writeApprovals(pool, "tp-1", "guest:ct_1", { add: "tp-1-b" })).toEqual({ ok: true, approvals: ["tp-1-b"] });
    expect(await writeApprovals(pool, "tp-1", "guest:ct_1", { add: "tp-1-b" })).toEqual({ ok: true, approvals: ["tp-1-b"] });
    const [rows] = await pool.query<RowDataPacket[]>( // module-review-ok: reading back the scratch schema this suite provisioned
      "SELECT COUNT(*) AS n FROM event_time_poll_votes WHERE poll_id = 'tp-1' AND person_key = 'guest:ct_1' AND option_id = 'tp-1-b'",
    );
    expect(Number(rows[0].n)).toBe(1);
  });

  it("replaces a person's picks with a set, and refuses a time the poll does not offer", async () => {
    expect(await writeApprovals(pool, "tp-1", "u-1", { set: ["tp-1-a", "tp-1-c"] })).toMatchObject({ ok: true });
    expect((await approvalsOf(pool, "tp-1", "u-1")).sort()).toEqual(["tp-1-a", "tp-1-c"]);
    expect(await writeApprovals(pool, "tp-1", "u-1", { set: ["tp-1-c"] })).toMatchObject({ ok: true, approvals: ["tp-1-c"] });
    expect(await writeApprovals(pool, "tp-1", "u-1", { set: ["nope"] })).toEqual({ ok: false, reason: "bad_option" });
    expect(await approvalsOf(pool, "tp-1", "u-1")).toEqual(["tp-1-c"]);
    expect(await writeApprovals(pool, "tp-missing", "u-1", { add: "x" })).toEqual({ ok: false, reason: "not_found" });
  });

  it("keeps the votes of a time taken off the poll, clears a pin on it, and leaves them out of the voter list", async () => {
    await writeApprovals(pool, "tp-1", "u-2", { set: ["tp-1-a"] });
    await setPinned(pool, "tp-1", "tp-1-a");
    expect(await removeOption(pool, "tp-1", "tp-1-a")).toBe(true);
    expect(await removeOption(pool, "tp-1", "tp-1-a")).toBe(false);
    expect((await pollForEvent(pool, "ev-1"))?.pinnedOptionId).toBeNull();
    expect((await pollVotes(pool, "tp-1")).filter((v) => v.optionId === "tp-1-a").map((v) => v.personKey)).toEqual(["u-2"]);
    // u-2 picked only the removed time, so they are no longer a voter; a set on the live times leaves the record alone.
    expect(await voterKeys(pool, "tp-1")).toEqual(["guest:ct_1", "u-1"]);
    await writeApprovals(pool, "tp-1", "u-2", { set: ["tp-1-b"] });
    expect((await pollVotes(pool, "tp-1")).some((v) => v.optionId === "tp-1-a" && v.personKey === "u-2")).toBe(true);
  });

  it("lets exactly one caller lock an open poll, and refuses votes once it is locked", async () => {
    const claims = await Promise.all([lockPollRow(pool, "tp-1"), lockPollRow(pool, "tp-1"), lockPollRow(pool, "tp-1")]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    expect(await writeApprovals(pool, "tp-1", "u-3", { add: "tp-1-b" })).toEqual({ ok: false, reason: "closed" });
    expect(await reopenPollRow(pool, "tp-1", Math.floor(Date.parse("2030-01-01T00:00:00Z") / 1000))).toBe(true);
    expect(await reopenPollRow(pool, "tp-1")).toBe(false);
    const reopened = await pollForEvent(pool, "ev-1");
    expect(reopened).toMatchObject({ state: "open", lockedAt: null, closesAt: Math.floor(Date.parse("2030-01-01T00:00:00Z") / 1000) });
  });

  it("reads the polls and live options of a whole calendar page in one go", async () => {
    await makePoll("tp-2", "ev-2");
    const read = await pollsWithOptionsFor(pool, ["ev-1", "ev-2", "ev-none"]);
    expect(read.map((r) => [r.poll.eventId, r.options.map((o) => o.id)])).toEqual([
      ["ev-1", ["tp-1-b", "tp-1-c"]],
      ["ev-2", ["tp-2-a", "tp-2-b", "tp-2-c"]],
    ]);
    expect(await pollsWithOptionsFor(pool, [])).toEqual([]);
  });

  it("names everybody who answered yes or maybe or waits in the queue, for the evenings asked", async () => {
    const rsvp = (id: string, user: string, status: string, occ: string) =>
      pool.query( // module-review-ok: seeding the scratch schema this suite provisioned
        "INSERT INTO event_rsvps (id, event_id, user_id, status, idempotency_key, occurrence_key) VALUES (?, 'ev-3', ?, ?, ?, ?)",
        [id, user, status, `k-${id}`, occ],
      );
    await rsvp("r1", "u-going", "going", "2030-01-08");
    await rsvp("r2", "u-maybe", "maybe", "2030-01-15");
    await rsvp("r3", "u-no", "declined", "2030-01-08");
    await rsvp("r4", "guest:ct_9", "going", "2030-01-22");
    await pool.query( // module-review-ok: seeding the scratch schema this suite provisioned
      "INSERT INTO event_waitlist (id, event_id, user_id, occurrence_key) VALUES ('w1', 'ev-3', 'u-queue', '2030-01-08'), ('w2', 'ev-3', 'u-left', '2030-01-08')",
    );
    await pool.query("UPDATE event_waitlist SET left_at = CURRENT_TIMESTAMP WHERE id = 'w2'"); // module-review-ok: seeding the scratch schema this suite provisioned
    expect((await answeredKeys(pool, "ev-3", null)).sort()).toEqual(["guest:ct_9", "u-going", "u-maybe", "u-queue"]);
    expect((await answeredKeys(pool, "ev-3", ["2030-01-08"])).sort()).toEqual(["u-going", "u-queue"]);
    expect(await answeredKeys(pool, "ev-3", [])).toEqual([]);
  });

  it("bumps a gathering's calendar sequence from nothing, and again", async () => {
    expect(await icsSequenceOf(pool, "ev-4")).toBe(0);
    expect(await bumpIcsSequence(pool, "ev-4")).toBe(1);
    expect(await bumpIcsSequence(pool, "ev-4")).toBe(2);
  });

  it("reads the database's own clock, and removes a poll with everything under it", async () => {
    const now = await databaseNowMs(pool);
    expect(Math.abs(now - Date.now())).toBeLessThan(5 * 60_000);
    expect(await deletePollRows(pool, "tp-1")).toBe(true);
    expect(await pollForEvent(pool, "ev-1")).toBeNull();
    expect(await pollOptions(pool, "tp-1")).toEqual([]);
    expect(await pollVotes(pool, "tp-1")).toEqual([]);
  });
});
