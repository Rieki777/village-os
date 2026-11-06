/**
 * The calendar's community half (0088): the waitlist under concurrency, the
 * slot name tier, meet-me caps, and the who-is-here shape audit.
 *
 * The waitlist tests are the harm metric: capacity 1, two queued, concurrent
 * frees; going never exceeds capacity, exactly one promotion per freed seat,
 * promoted_at stamped once. Everything runs against a real scratch schema
 * because the whole point is SQL-level locking, and a mocked pool would only
 * prove the mock. Skips loudly without TEST_DATABASE_URL, like every DB
 * suite here.
 */
import mysql from "mysql2/promise";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { testPool, provisionTestDb, testDbConfigured, type TestDb } from "../db/testDb";
import { rsvp, updateGathering, withdrawRsvp } from "./gatherings";
import {
  MEET_ME_OPEN_CAP,
  attachWaitlistInfo,
  cancelMeetMe,
  createMeetMe,
  createSlot,
  joinWaitlist,
  leaveWaitlist,
  listMyMeetMe,
  listSlotsFor,
  promoteForCapacityChange,
  setPromotionSink,
  signupSlot,
  whoIsHere,
  withdrawSlotSignup,
  type PromotedEntry,
} from "./calendarCommunity";

const configured = testDbConfigured();

describe.skipIf(!configured)("the waitlist, against a real schema", () => {
  let db: TestDb;
  let pool: mysql.Pool;

  beforeAll(async () => {
    db = await provisionTestDb();
    pool = testPool(db, { connectionLimit: 6 });
  });

  afterAll(async () => {
    setPromotionSink(null);
    await pool?.end();
    await db?.drop();
  });

  beforeEach(async () => {
    setPromotionSink(null);
    await pool.query("DELETE FROM event_rsvps");
    await pool.query("DELETE FROM event_waitlist");
    await pool.query("DELETE FROM event_slot_signups");
    await pool.query("DELETE FROM event_slots");
    await pool.query("DELETE FROM events");
    await pool.query("DELETE FROM stays");
    await pool.query("DELETE FROM users");
  });

  const soon = () => new Date(Date.now() + 3 * 86_400_000);
  const addEvent = async (id: string, capacity: number | null, over: Record<string, unknown> = {}) => {
    await pool.query(
      "INSERT INTO events (id, title, starts_at, status, kind, layer, capacity) VALUES (?,?,?,?,?,?,?)",
      [id, over.title ?? "Supper", over.startsAt ?? soon(), over.status ?? "scheduled", over.kind ?? "gathering", over.layer ?? "village", capacity],
    );
  };

  const waitRows = async (eventId: string) =>
    (await pool.query<any[]>(
      "SELECT user_id, promoted_at, left_at FROM event_waitlist WHERE event_id = ? ORDER BY created_at, id",
      [eventId],
    ))[0] as any[];

  const goingCount = async (eventId: string, occ = "") => {
    const [[row]] = await pool.query<any[]>(
      "SELECT COUNT(*) AS n FROM event_rsvps WHERE event_id = ? AND status = 'going' AND occurrence_key = ?",
      [eventId, occ],
    );
    return Number(row.n);
  };

  it("refuses to queue anyone while a seat is still free, and an uncapped gathering never queues", async () => {
    await addEvent("ev-open", 2);
    expect((await rsvp(pool, "ev-open", "u1", "going")).ok).toBe(true);
    expect(await joinWaitlist(pool, "ev-open", "u2")).toEqual({ ok: false, reason: "not_full" });
    await addEvent("ev-un", null);
    expect(await joinWaitlist(pool, "ev-un", "u2")).toEqual({ ok: false, reason: "not_full" });
    // Somebody already seated cannot also queue.
    expect((await rsvp(pool, "ev-open", "u2", "going")).ok).toBe(true);
    expect(await joinWaitlist(pool, "ev-open", "u2")).toEqual({ ok: false, reason: "already_going" });
  });

  it("capacity 1, two queued, concurrent frees: one promotion per freed seat, promoted_at once, cap never broken", async () => {
    await addEvent("ev-1", 1);
    expect((await rsvp(pool, "ev-1", "alice", "going")).ok).toBe(true);
    const b = await joinWaitlist(pool, "ev-1", "bob");
    const c = await joinWaitlist(pool, "ev-1", "cara");
    expect(b).toMatchObject({ ok: true, position: 1, waiting: 1 });
    expect(c).toMatchObject({ ok: true, position: 2, waiting: 2 });

    const seen: PromotedEntry[] = [];
    setPromotionSink((p) => { seen.push(...p); });

    // The same withdrawal raced against itself: one seat frees, once.
    const [w1, w2] = await Promise.all([
      withdrawRsvp(pool, "ev-1", "alice"),
      withdrawRsvp(pool, "ev-1", "alice"),
    ]);
    expect([w1, w2].filter(Boolean)).toHaveLength(1);

    expect(await goingCount("ev-1")).toBe(1);
    const rows = await waitRows("ev-1");
    expect(rows.map((r) => [r.user_id, r.promoted_at !== null])).toEqual([
      ["bob", true],
      ["cara", false],
    ]);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ eventId: "ev-1", userId: "bob" });
    const [[bobRow]] = await pool.query<any[]>(
      "SELECT status, idempotency_key FROM event_rsvps WHERE event_id = 'ev-1' AND user_id = 'bob'",
    );
    expect(bobRow.status).toBe("going");
    expect(bobRow.idempotency_key).toBe("waitlist:ev-1:bob");

    // The second seat frees through an answer change; cara follows, once.
    expect((await rsvp(pool, "ev-1", "bob", "declined")).ok).toBe(true);
    expect(await goingCount("ev-1")).toBe(1);
    expect((await waitRows("ev-1")).map((r) => [r.user_id, r.promoted_at !== null])).toEqual([
      ["bob", true],
      ["cara", true],
    ]);
    expect(seen).toHaveLength(2);
    expect(seen[1]).toMatchObject({ userId: "cara" });
  });

  it("two seats freed at the same moment seat exactly the two oldest, in order", async () => {
    await addEvent("ev-2", 2);
    expect((await rsvp(pool, "ev-2", "a", "going")).ok).toBe(true);
    expect((await rsvp(pool, "ev-2", "b", "going")).ok).toBe(true);
    await joinWaitlist(pool, "ev-2", "c");
    await joinWaitlist(pool, "ev-2", "d");
    await joinWaitlist(pool, "ev-2", "e");

    await Promise.all([
      withdrawRsvp(pool, "ev-2", "a"),
      rsvp(pool, "ev-2", "b", "maybe"),
    ]);
    expect(await goingCount("ev-2")).toBe(2);
    const rows = await waitRows("ev-2");
    expect(rows.map((r) => [r.user_id, r.promoted_at !== null])).toEqual([
      ["c", true],
      ["d", true],
      ["e", false],
    ]);
  });

  it("someone re-confirming going frees nothing and promotes nobody", async () => {
    await addEvent("ev-3", 1);
    expect((await rsvp(pool, "ev-3", "a", "going")).ok).toBe(true);
    await joinWaitlist(pool, "ev-3", "b");
    expect((await rsvp(pool, "ev-3", "a", "going")).ok).toBe(true);
    expect(await goingCount("ev-3")).toBe(1);
    expect((await waitRows("ev-3"))[0].promoted_at).toBeNull();
  });

  it("leaving the queue is honoured and rejoining goes to the back", async () => {
    await addEvent("ev-4", 1);
    expect((await rsvp(pool, "ev-4", "a", "going")).ok).toBe(true);
    await joinWaitlist(pool, "ev-4", "b");
    await joinWaitlist(pool, "ev-4", "c");
    expect(await leaveWaitlist(pool, "ev-4", "b")).toBe(true);
    expect(await leaveWaitlist(pool, "ev-4", "b")).toBe(false);
    const rejoined = await joinWaitlist(pool, "ev-4", "b");
    expect(rejoined).toMatchObject({ ok: true, position: 2 });
    await withdrawRsvp(pool, "ev-4", "a");
    // c was ahead after b left and rejoined.
    expect((await waitRows("ev-4")).map((r) => [r.user_id, r.promoted_at !== null]).sort()).toEqual([
      ["b", false],
      ["c", true],
    ]);
  });

  it("a raised capacity seats the queue through updateGathering; a lowered one seats nobody", async () => {
    await addEvent("ev-5", 1);
    expect((await rsvp(pool, "ev-5", "a", "going")).ok).toBe(true);
    await joinWaitlist(pool, "ev-5", "b");
    await joinWaitlist(pool, "ev-5", "c");
    const seen: PromotedEntry[] = [];
    setPromotionSink((p) => { seen.push(...p); });
    await updateGathering(pool, "ev-5", { capacity: 2 });
    expect(await goingCount("ev-5")).toBe(2);
    expect(seen.map((p) => p.userId)).toEqual(["b"]);
    await updateGathering(pool, "ev-5", { capacity: 1 });
    expect(await goingCount("ev-5")).toBe(2);
    expect(seen).toHaveLength(1);
    // Uncapping seats everyone still waiting.
    await updateGathering(pool, "ev-5", { capacity: null });
    expect(await goingCount("ev-5")).toBe(3);
    expect(seen.map((p) => p.userId)).toEqual(["b", "c"]);
  });

  it("a cancelled gathering promotes nobody even when a seat frees", async () => {
    await addEvent("ev-6", 1);
    expect((await rsvp(pool, "ev-6", "a", "going")).ok).toBe(true);
    await joinWaitlist(pool, "ev-6", "b");
    await pool.query("UPDATE events SET status = 'cancelled' WHERE id = 'ev-6'");
    await withdrawRsvp(pool, "ev-6", "a");
    expect(await goingCount("ev-6")).toBe(0);
    expect((await waitRows("ev-6"))[0].promoted_at).toBeNull();
  });

  it("queues per evening of a recurring gathering and promotes only that evening", async () => {
    await pool.query(
      "INSERT INTO events (id, title, starts_at, status, kind, layer, capacity, recurrence) VALUES ('ev-r','Circle', ?, 'scheduled','gathering','village',1,?)",
      [soon(), JSON.stringify({ freq: "weekly", byWeekday: [2] })],
    );
    expect((await rsvp(pool, "ev-r", "a", "going", undefined, "2026-08-25")).ok).toBe(true);
    expect((await rsvp(pool, "ev-r", "a", "going", undefined, "2026-09-01")).ok).toBe(true);
    // No evening named: refused, exactly like rsvp().
    expect((await joinWaitlist(pool, "ev-r", "b")).ok).toBe(false);
    expect((await joinWaitlist(pool, "ev-r", "b", "2026-08-25")).ok).toBe(true);
    await withdrawRsvp(pool, "ev-r", "a", "2026-09-01");
    // The freed 09-01 seat does not seat the 08-25 queue.
    expect(await goingCount("ev-r", "2026-08-25")).toBe(1);
    expect(await goingCount("ev-r", "2026-09-01")).toBe(0);
    expect((await waitRows("ev-r"))[0].promoted_at).toBeNull();
    await withdrawRsvp(pool, "ev-r", "a", "2026-08-25");
    expect(await goingCount("ev-r", "2026-08-25")).toBe(1);
    expect((await waitRows("ev-r"))[0].promoted_at).not.toBeNull();
  });

  it("attachWaitlistInfo folds counts and the viewer's own place into items", async () => {
    await addEvent("ev-7", 1);
    expect((await rsvp(pool, "ev-7", "a", "going")).ok).toBe(true);
    await joinWaitlist(pool, "ev-7", "b");
    await joinWaitlist(pool, "ev-7", "c");
    const items: any[] = [{ id: "ev-7", occurrenceKey: "", capacity: 1 }];
    await attachWaitlistInfo(pool, items, "c");
    expect(items[0].waitlistCount).toBe(2);
    expect(items[0].myWaitlistPosition).toBe(2);
    const anonItems: any[] = [{ id: "ev-7", occurrenceKey: "", capacity: 1 }];
    await attachWaitlistInfo(pool, anonItems, null);
    expect(anonItems[0].waitlistCount).toBe(2);
    expect(anonItems[0].myWaitlistPosition).toBeUndefined();
  });

  it("slots: the cap holds under FOR UPDATE and names travel only to the going tier", async () => {
    await addEvent("ev-8", null);
    await pool.query("INSERT INTO users (id, name, email, password_hash) VALUES ('u-going','Going Greta','g@x.invalid','h'), ('u-slot','Slot Sam','s@x.invalid','h')");
    const slotId = await createSlot(pool, "ev-8", { kind: "dish", label: "A salad", needed: 1 });
    expect((await signupSlot(pool, "ev-8", slotId, "u-slot")).ok).toBe(true);
    const again = await signupSlot(pool, "ev-8", slotId, "u-slot");
    expect(again).toMatchObject({ ok: true, duplicate: true });
    expect(await signupSlot(pool, "ev-8", slotId, "u-late")).toEqual({ ok: false, reason: "full" });

    // Counts for a viewer who is not going; names for one who is.
    const outside = await listSlotsFor(pool, "ev-8", "", { userId: "u-going", withNames: false });
    expect(outside[0].takenCount).toBe(1);
    expect(outside[0].names).toBeUndefined();
    expect(JSON.stringify(outside)).not.toContain("Slot Sam");
    const going = await listSlotsFor(pool, "ev-8", "", { userId: "u-going", withNames: true });
    expect(going[0].names?.map((n) => n.name)).toEqual(["Slot Sam"]);
    // The signer sees their own mark either way.
    const mine = await listSlotsFor(pool, "ev-8", "", { userId: "u-slot", withNames: false });
    expect(mine[0].mine).toBe(true);

    expect(await withdrawSlotSignup(pool, "ev-8", slotId, "u-slot")).toBe(true);
    expect((await listSlotsFor(pool, "ev-8", "", { userId: null, withNames: false }))[0].takenCount).toBe(0);
  });

  it("meet-me windows: seven open at most, owner-only cancel, layer bounded", async () => {
    const base = Date.now() + 86_400_000;
    for (let i = 0; i < MEET_ME_OPEN_CAP; i++) {
      const r = await createMeetMe(pool, {
        userId: "u-m", firstName: "Mira Q", layer: i % 2 ? "private" : "village",
        startsAt: new Date(base + i * 3_600_000).toISOString(),
        endsAt: new Date(base + i * 3_600_000 + 1_800_000).toISOString(),
        place: "The commons",
      });
      expect(r.ok).toBe(true);
    }
    const eighth = await createMeetMe(pool, {
      userId: "u-m", firstName: "Mira", layer: "village",
      startsAt: new Date(base + 9 * 3_600_000).toISOString(),
      endsAt: new Date(base + 10 * 3_600_000).toISOString(),
    });
    expect(eighth).toEqual({ ok: false, reason: "too_many" });
    expect(await createMeetMe(pool, { userId: "u-m", firstName: "Mira", layer: "admin", startsAt: new Date(base).toISOString(), endsAt: new Date(base + 1).toISOString() })).toEqual({ ok: false, reason: "bad_layer" });
    expect((await createMeetMe(pool, { userId: "u-m", firstName: "Mira", layer: "village", startsAt: "junk", endsAt: "junk" })).ok).toBe(false);

    const mine = await listMyMeetMe(pool, "u-m");
    expect(mine).toHaveLength(MEET_ME_OPEN_CAP);
    expect(mine[0].title).toBe("Meet Mira");
    // Another member cannot cancel it; the owner can.
    expect(await cancelMeetMe(pool, mine[0].id, "somebody-else")).toBe(false);
    expect(await cancelMeetMe(pool, mine[0].id, "u-m")).toBe(true);
    expect(await listMyMeetMe(pool, "u-m")).toHaveLength(MEET_ME_OPEN_CAP - 1);
  });

  it("who-is-here: counts carry no name and no id key for the lower tier", async () => {
    await pool.query("INSERT INTO users (id, name, email, password_hash) VALUES ('u-a','Arriving Ana','a@x.invalid','h')");
    await pool.query(
      "INSERT INTO accommodations (id, name, capacity) VALUES ('acc-1','The loft', 2)",
    );
    await pool.query(
      "INSERT INTO stays (id, user_id, accommodation_id, status, arrive_on) VALUES " +
        "('st-1','u-a','acc-1','requested','2026-08-25')," +
        "('st-2','u-b','acc-1','active','2026-08-20')," +
        "('st-3','u-c','acc-1','ended','2026-08-01')",
    );
    await pool.query("UPDATE stays SET updated_at = '2026-08-24 10:00:00' WHERE id = 'st-3'");

    const counts = await whoIsHere(pool, { from: "2026-08-23", to: "2026-08-30" }, false);
    expect(counts.here.count).toBe(1);
    expect(counts.arrivals).toEqual([{ date: "2026-08-25", count: 1 }]);
    expect(counts.departures).toEqual([{ date: "2026-08-24", count: 1 }]);
    // The keys audit: nothing in the counts shape can carry a person.
    const flat = JSON.stringify(counts);
    expect(flat).not.toContain("name");
    expect(flat).not.toContain("user");
    expect(flat).not.toContain("u-a");
    expect(flat).not.toContain("Ana");

    const named = await whoIsHere(pool, { from: "2026-08-23", to: "2026-08-30" }, true);
    expect(named.arrivals[0].names).toEqual(["Arriving Ana"]);
    // A tombstoned account reads as a guest, never a null hole.
    expect(named.here.names).toEqual(["a guest"]);
  });

  it("promoteForCapacityChange is safe to call on an event with no queue", async () => {
    await addEvent("ev-9", 3);
    expect(await promoteForCapacityChange(pool, "ev-9")).toEqual([]);
  });
});
