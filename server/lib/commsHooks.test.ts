import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Pool, RowDataPacket } from "mysql2/promise";
import type { CommsTrigger } from "../../shared/comms/contracts";
import { provisionTestDb, testDbConfigured, testPool, type TestDb } from "../db/testDb";
import { joinWaitlist } from "./calendarCommunity";
import { commsSink } from "./commsSink";
import { createGathering, deleteGathering, rsvp, updateGathering, withdrawRsvp } from "./gatherings";

/**
 * The gathering hooks of the comms build spec section 7, driven through
 * the real functions against a scratch schema: each fires its trigger, after
 * the change it reports is written, and an edit reports what changed rather
 * than what the editor resent.
 */

const configured = testDbConfigured();
let db: TestDb;
let pool: Pool;
const fired: CommsTrigger[] = [];

const settle = async () => {
  await new Promise<void>((r) => setImmediate(r));
  await new Promise<void>((r) => setImmediate(r));
};
/** Everything fired since the last call, once the handler has had its turn. */
const take = async (): Promise<CommsTrigger[]> => {
  await settle();
  return fired.splice(0);
};
const inDays = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString();
/** Wait for a handler that does its own I/O, by what it did and never by a guess at how long. */
const until = async (done: () => boolean, ms = 5000) => {
  const deadline = Date.now() + ms;
  while (!done()) {
    if (Date.now() > deadline) throw new Error("the handler never finished");
    await new Promise<void>((r) => setTimeout(r, 10));
  }
};

describe.skipIf(!configured)("the comms hooks on gatherings", () => {
  beforeAll(async () => {
    db = await provisionTestDb();
    pool = testPool(db, { connectionLimit: 6 });
  });

  afterAll(async () => {
    commsSink.register(async () => undefined);
    await pool?.end();
    await db?.drop();
  });

  beforeEach(() => {
    fired.length = 0;
    commsSink.register(async (t) => {
      fired.push(t);
    });
  });

  it("says a gathering was published when it goes out scheduled, and says nothing of a draft", async () => {
    const draft = await createGathering(pool, { title: "Supper", startsAt: inDays(3) }, null);
    expect(await take()).toEqual([]);
    const live = await createGathering(pool, { title: "Seed swap", startsAt: inDays(3), status: "scheduled" }, null);
    expect(await take()).toEqual([{ type: "gathering_published", eventId: live.id }]);
    // A draft edited and left a draft has told nobody anything, and publishing it is news.
    await updateGathering(pool, draft.id, { title: "Supper together" });
    expect(await take()).toEqual([]);
    await updateGathering(pool, draft.id, { status: "scheduled" });
    expect(await take()).toEqual([{ type: "gathering_published", eventId: draft.id }]);
  });

  it("fires an RSVP after the seat is written, and a withdrawal after it is given back", async () => {
    const g = await createGathering(pool, { title: "Pond day", startsAt: inDays(4), status: "scheduled" }, null);
    await take();
    // The handler reads the table: the answer it is told about is already there.
    const seenInTable: string[] = [];
    commsSink.register(async (t) => {
      fired.push(t);
      if (t.type === "rsvp_changed") {
        const [rows] = await pool.query<RowDataPacket[]>( // module-review-ok: reading back the scratch schema this suite provisioned
          "SELECT status FROM event_rsvps WHERE event_id = ? AND user_id = ?",
          [t.eventId, t.personKey],
        );
        seenInTable.push(rows[0] ? String(rows[0].status) : "gone");
      }
    });
    expect((await rsvp(pool, g.id, "u-ana", "going")).ok).toBe(true);
    await until(() => seenInTable.length === 1);
    expect(fired.splice(0)).toEqual([{ type: "rsvp_changed", eventId: g.id, occurrenceKey: "", personKey: "u-ana", status: "going" }]);
    expect(await withdrawRsvp(pool, g.id, "u-ana")).toBe(true);
    await until(() => seenInTable.length === 2);
    expect(fired.splice(0)).toEqual([{ type: "rsvp_changed", eventId: g.id, occurrenceKey: "", personKey: "u-ana", status: "withdrawn" }]);
    expect(seenInTable).toEqual(["going", "gone"]);
    // Taking back an answer nobody gave reports nothing.
    expect(await withdrawRsvp(pool, g.id, "u-nobody")).toBe(false);
    expect(await take()).toEqual([]);
  });

  it("reports joining the queue, and the promotion when a seat frees", async () => {
    const g = await createGathering(pool, { title: "Kiln firing", startsAt: inDays(5), status: "scheduled", capacity: 1 }, null);
    await rsvp(pool, g.id, "u-bo", "going");
    await take();
    expect((await joinWaitlist(pool, g.id, "u-cy")).ok).toBe(true);
    expect(await take()).toEqual([{ type: "waitlist_joined", eventId: g.id, occurrenceKey: "", personKey: "u-cy" }]);
    // Queuing again holds the same place and is not news.
    await joinWaitlist(pool, g.id, "u-cy");
    expect(await take()).toEqual([]);
    await withdrawRsvp(pool, g.id, "u-bo");
    expect(await take()).toEqual([
      { type: "waitlist_promoted", eventId: g.id, occurrenceKey: "", personKey: "u-cy" },
      { type: "rsvp_changed", eventId: g.id, occurrenceKey: "", personKey: "u-bo", status: "withdrawn" },
    ]);
  });

  it("reports what an edit changed, and nothing for a field resent as it was", async () => {
    const g = await createGathering(pool, { title: "Seed swap", startsAt: inDays(6), status: "scheduled", locationText: "The barn" }, null);
    await take();
    await updateGathering(pool, g.id, { title: "Seed swap", locationText: "The barn", description: "Bring jars" });
    expect(await take(), "a description is not news to people already going").toEqual([]);
    await updateGathering(pool, g.id, { startsAt: inDays(7) });
    expect(await take()).toEqual([{ type: "gathering_changed", eventId: g.id, fields: ["time"] }]);
    await updateGathering(pool, g.id, { locationText: "The orchard", title: "Seed and plant swap" });
    expect(await take()).toEqual([{ type: "gathering_changed", eventId: g.id, fields: ["place", "title"] }]);
    await updateGathering(pool, g.id, { status: "cancelled" });
    expect(await take()).toEqual([{ type: "gathering_cancelled", eventId: g.id }]);
  });

  it("reports a deleted gathering as cancelled, once", async () => {
    const g = await createGathering(pool, { title: "Moon walk", startsAt: inDays(8), status: "scheduled" }, null);
    await take();
    expect(await deleteGathering(pool, g.id)).toBe(true);
    expect(await take()).toEqual([{ type: "gathering_cancelled", eventId: g.id }]);
    expect(await deleteGathering(pool, g.id)).toBe(false);
    expect(await take()).toEqual([]);
  });
});
