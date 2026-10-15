/**
 * The task layer's store against a real schema: drizzle/0255's three tables
 * and every statement in server/repos/sessionTasks.ts.
 *
 * The harness migrates the scratch schema, 0255 included, before the first
 * case, so the tables here are the ones the migration made. The backfill is
 * then run again by hand over sessions this file writes, the way an instance
 * that already holds closed sessions meets it at boot, and once more to show
 * a second run changes nothing.
 *
 * WHAT THIS PROVES THAT THE PURE TESTS CANNOT: that the backfill and the
 * close's seed pick the right actions and only those, that an empty seat list
 * reads nothing instead of failing, that an answer's four writes land in one
 * transaction and move the circle's open room, that a send number is taken
 * once, and that the erasure leaves no trace of the leaver in the three tables.
 *
 * No TEST_DATABASE_URL and the suite skips (harness rule).
 */
import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type mysql from "mysql2/promise";
import { provisionTestDb, testDbConfigured, testPool, type TestDb } from "./db/testDb";
import { MIGRATIONS_DIR, splitStatements } from "./db/migrate";
import { inTransaction, sessionIdsNaming } from "./repos/liveSessions";
import * as tasks from "./repos/sessionTasks";
import { applyAnswer, eventFor, type TaskState } from "../shared/sessionTasks";

const MIGRATION = "0255_a_task_keeps_going_after_the_call.sql";

/** A state row as the store hands it back, in the contract's names. */
const asState = (r: any): TaskState => ({
  entryId: Number(r.entry_id),
  sessionId: Number(r.session_id),
  circleId: r.circle_id == null ? null : String(r.circle_id),
  status: r.status,
  ownerNo: r.owner_no == null ? null : Number(r.owner_no),
  ownerSeatId: r.owner_seat_id == null ? null : String(r.owner_seat_id),
  dueOn: r.due_on == null ? null : String(r.due_on),
  latestKind: r.latest_kind,
  latestNote: r.latest_note == null ? null : String(r.latest_note),
  changedByNo: Number(r.changed_by_no),
  changedAt: new Date(r.changed_at).toISOString(),
  doneAt: r.done_at == null ? null : new Date(r.done_at).toISOString(),
  version: Number(r.version),
});

const configured = testDbConfigured();

describe.skipIf(!configured)("the task layer's store against a real schema", () => {
  let db: TestDb;
  let pool: mysql.Pool;
  const q = async (sql: string, params: unknown[] = []) => (await pool.query<any[]>(sql, params))[0]; // module-review-ok: fixture SQL against the S5 scratch schema this suite provisioned, never a production table

  const CLOSED_AT = new Date("2026-10-09T18:00:00.000Z");
  const ANA = 1;
  const BEN = 2;
  const CAI = 3;

  /** A session row. */
  const session = async (title: string, circleId: string | null, status: "open" | "closed", closedAt: Date | null): Promise<number> => {
    const r: any = await q(
      "INSERT INTO `live_sessions` (`title`, `circle_id`, `status`, `facilitator_no`, `secretary_no`, `created_by_no`, `duration_min`, " +
        "`state`, `version`, `stamp`, `created_at`, `closed_at`) VALUES (?, ?, ?, ?, NULL, ?, 60, '{}', 1, '{}', ?, ?)",
      [title, circleId, status, ANA, ANA, new Date("2026-10-09T17:00:00.000Z"), closedAt],
    );
    return Number(r.insertId);
  };

  /** An entry row. */
  const entry = async (
    sessionId: number,
    kind: string,
    text: string,
    status: string,
    ownerNo: number | null,
    ownerSeatId: string | null,
    dueOn: string | null = null,
  ): Promise<number> => {
    const r: any = await q(
      "INSERT INTO `live_session_entries` (`session_id`, `item_id`, `kind`, `text`, `status`, `author_no`, `owner_no`, `owner_seat_id`, `due_on`) " +
        "VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?)",
      [sessionId, kind, text, status, BEN, ownerNo, ownerSeatId, dueOn],
    );
    return Number(r.insertId);
  };

  /** The migration's backfill, run again by itself. */
  const backfill = async (): Promise<number> => {
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, MIGRATION), "utf8");
    const insert = splitStatements(sql).filter((s) => /^INSERT IGNORE/i.test(s));
    expect(insert, "the migration holds exactly one backfill").toHaveLength(1);
    const [r] = await pool.query<any>(insert[0]);
    return Number(r.affectedRows ?? 0);
  };

  // The story's ids, filled in as it goes.
  let closedGarden = 0;
  let openGarden = 0;
  let closedLoose = 0;
  let fixTank = 0;
  let orderSeed = 0;
  let unheld = 0;
  let parked = 0;
  let aNote = 0;
  let liveAction = 0;
  let mendHose = 0;

  beforeAll(async () => {
    db = await provisionTestDb();
    pool = testPool(db, { connectionLimit: 4 });

    closedGarden = await session("Garden, week 1", "c-garden", "closed", CLOSED_AT);
    fixTank = await entry(closedGarden, "action", "Fix the tank", "open", ANA, null, "2026-10-17");
    orderSeed = await entry(closedGarden, "action", "Order seed", "done", null, "seat-water");
    unheld = await entry(closedGarden, "action", "Nobody took this", "open", null, null);
    parked = await entry(closedGarden, "action", "Parked for later", "parked", ANA, null);
    aNote = await entry(closedGarden, "note", "The pears came early", "open", ANA, null);

    openGarden = await session("Garden, week 2", "c-garden", "open", null);
    liveAction = await entry(openGarden, "action", "Count the hens", "open", ANA, null, "2026-10-20");

    closedLoose = await session("Tool shed", null, "closed", CLOSED_AT);
    mendHose = await entry(closedLoose, "action", "Mend the hose", "open", 0, "seat-water");
  });

  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  it("made the three tables, empty", async () => {
    for (const t of ["live_session_task_state", "live_session_task_events", "live_session_task_sends"]) {
      expect(await q(`SELECT COUNT(*) AS n FROM \`${t}\``)).toEqual([{ n: 0 }]);
    }
    const applied = await q("SELECT `filename` FROM `_migrations_applied` WHERE `filename` = ?", [MIGRATION]);
    expect(applied).toHaveLength(1);
  });

  it("backfills the open and done actions of closed sessions, and nothing else", async () => {
    expect(await backfill()).toBe(4);
    const rows = (await q("SELECT `entry_id`, `session_id`, `circle_id`, `status`, `owner_no`, `owner_seat_id`, " +
      "DATE_FORMAT(`due_on`, '%Y-%m-%d') AS `due_on`, `latest_kind`, `changed_by_no`, `changed_at`, `done_at`, `version` " +
      "FROM `live_session_task_state` ORDER BY `entry_id`")) as any[];
    expect(rows.map((r) => Number(r.entry_id))).toEqual([fixTank, orderSeed, unheld, mendHose]);
    const [tank, seed, loose, hose] = rows;
    expect(tank).toMatchObject({ session_id: closedGarden, circle_id: "c-garden", status: "open", owner_no: ANA, due_on: "2026-10-17", latest_kind: "closed", changed_by_no: 0, version: 1, done_at: null });
    expect(new Date(tank.changed_at).toISOString()).toBe(CLOSED_AT.toISOString());
    expect(seed).toMatchObject({ status: "done", owner_no: null, owner_seat_id: "seat-water" });
    expect(new Date(seed.done_at).toISOString()).toBe(CLOSED_AT.toISOString());
    // An open action nobody holds is back with the circle, so its next call still reads it.
    expect(loose).toMatchObject({ session_id: closedGarden, circle_id: "c-garden", status: "open", owner_no: null, owner_seat_id: null, latest_kind: "closed" });
    // A person column of 0 is nobody, so the seat holds it.
    expect(hose).toMatchObject({ circle_id: null, owner_no: null, owner_seat_id: "seat-water" });
    for (const left of [parked, aNote, liveAction]) {
      expect(await q("SELECT 1 FROM `live_session_task_state` WHERE `entry_id` = ?", [left]), `entry ${left}`).toEqual([]);
    }
  });

  it("changes nothing when the backfill runs again, an answered row included", async () => {
    await q("UPDATE `live_session_task_state` SET `status` = 'done', `version` = 2 WHERE `entry_id` = ?", [mendHose]);
    expect(await backfill()).toBe(0);
    expect(await q("SELECT `status`, `version` FROM `live_session_task_state` WHERE `entry_id` = ?", [mendHose])).toEqual([{ status: "done", version: 2 }]);
    await q("UPDATE `live_session_task_state` SET `status` = 'open', `version` = 1 WHERE `entry_id` = ?", [mendHose]);
  });

  it("seeds one session at its close, in the close's transaction, once", async () => {
    const later = await session("Garden, week 1b", "c-garden", "closed", new Date("2026-10-10T18:00:00.000Z"));
    const water = await entry(later, "action", "Water the beds", "open", CAI, null);
    const unclaimed = await entry(later, "action", "Unclaimed", "open", null, null);
    expect(await inTransaction(pool, (conn) => tasks.seedStateForSession(conn, later))).toBe(2);
    expect(await tasks.seedStateForSession(pool, later)).toBe(0);
    expect(await q("SELECT `owner_no`, `circle_id` FROM `live_session_task_state` WHERE `entry_id` = ?", [water])).toEqual([{ owner_no: CAI, circle_id: "c-garden" }]);
    expect(await q("SELECT `owner_no`, `owner_seat_id`, `status` FROM `live_session_task_state` WHERE `entry_id` = ?", [unclaimed])).toEqual([{ owner_no: null, owner_seat_id: null, status: "open" }]);
    // A rolled-back close leaves no rows behind.
    const rolled = await session("Rolled back", "c-garden", "closed", CLOSED_AT);
    const lost = await entry(rolled, "action", "Never seeded", "open", CAI, null);
    await expect(
      inTransaction(pool, async (conn) => {
        await tasks.seedStateForSession(conn, rolled);
        throw new Error("the close failed after the seed");
      }),
    ).rejects.toThrow("the close failed");
    expect(await q("SELECT 1 FROM `live_session_task_state` WHERE `entry_id` = ?", [lost])).toEqual([]);
  });

  it("reads one member's board, in person and through a seat, and an empty seat list reads nothing", async () => {
    const since = new Date("2026-07-01T00:00:00.000Z");
    const mine = await tasks.boardRows(pool, ANA, [], { finishedSince: since, earlier: false });
    expect(mine.map((r) => Number(r.entry_id))).toEqual([fixTank]);
    expect(mine[0]).toMatchObject({ text: "Fix the tank", title: "Garden, week 1", due_on: "2026-10-17", facilitator_no: ANA });
    const withSeat = await tasks.boardRows(pool, ANA, ["seat-water"], { finishedSince: since, earlier: false });
    expect(withSeat.map((r) => Number(r.entry_id))).toEqual([fixTank, orderSeed, mendHose]);
    // A seat holder who never joined a session has no number, and still reads the seat.
    const seatOnly = await tasks.boardRows(pool, null, ["seat-water"], { finishedSince: since, earlier: false });
    expect(seatOnly.map((r) => Number(r.entry_id))).toEqual([orderSeed, mendHose]);
    expect(await tasks.boardRows(pool, null, [], { finishedSince: since, earlier: false })).toEqual([]);
  });

  it("keeps a finished task out of the window and counts it as earlier", async () => {
    const recent = new Date("2026-10-01T00:00:00.000Z");
    const afterClose = new Date("2026-10-12T00:00:00.000Z");
    const inWindow = await tasks.boardRows(pool, null, ["seat-water"], { finishedSince: recent, earlier: false });
    expect(inWindow.map((r) => Number(r.entry_id))).toContain(orderSeed);
    const outOfWindow = await tasks.boardRows(pool, null, ["seat-water"], { finishedSince: afterClose, earlier: false });
    expect(outOfWindow.map((r) => Number(r.entry_id))).toEqual([mendHose]);
    expect(await tasks.boardEarlierCount(pool, null, ["seat-water"], afterClose)).toBe(1);
    const all = await tasks.boardRows(pool, null, ["seat-water"], { finishedSince: afterClose, earlier: true });
    expect(all.map((r) => Number(r.entry_id))).toEqual([orderSeed, mendHose]);
  });

  it("reads the actions a member holds in a session still open", async () => {
    const live = await tasks.openSessionActionRows(pool, ANA, []);
    expect(live).toHaveLength(1);
    expect(live[0]).toMatchObject({ entry_id: liveAction, session_id: openGarden, text: "Count the hens", due_on: "2026-10-20", title: "Garden, week 2" });
    expect(await tasks.openSessionActionRows(pool, null, [])).toEqual([]);
  });

  it("writes an answer as one step: the state, one event, and the circle's open room moves", async () => {
    const roomBefore = (await q("SELECT `version` FROM `live_sessions` WHERE `id` = ?", [openGarden]))[0].version;
    const now = new Date("2026-10-12T09:00:00.000Z");
    const eventId = await inTransaction(pool, async (conn) => {
      const [row] = await tasks.stateForUpdate(conn, fixTank);
      const next = applyAnswer(asState(row), { op: "not_yet", version: 1, dueOn: "2026-10-30", note: "After the rains" }, BEN, now);
      expect(await tasks.writeState(conn, next)).toBe(1);
      const id = await tasks.appendEvent(conn, eventFor(next, "not_yet"), now);
      await tasks.bumpOpenRooms(conn, "c-garden");
      return id;
    });
    expect(eventId).toBeGreaterThan(0);
    const [after] = await tasks.taskRowsFor(pool, [fixTank]);
    expect(asState(after)).toMatchObject({ status: "open", dueOn: "2026-10-30", latestKind: "not_yet", latestNote: "After the rains", changedByNo: BEN, version: 2 });
    expect(asState(after).changedAt).toBe(now.toISOString());
    const events = await tasks.eventRows(pool, fixTank);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: "not_yet", by_no: BEN, status: "open", owner_no: ANA, due_on: "2026-10-30", note: "After the rains" });
    expect((await q("SELECT `version` FROM `live_sessions` WHERE `id` = ?", [openGarden]))[0].version).toBe(roomBefore + 1);
    // A closed session of the circle is never moved.
    expect((await q("SELECT `version` FROM `live_sessions` WHERE `id` = ?", [closedGarden]))[0].version).toBe(1);
    expect(await tasks.stateForUpdate(pool, 999_999)).toEqual([]);
  });

  it("reads a circle's open tasks and what changed since it last met", async () => {
    const open = await tasks.circleTaskRows(pool, "c-garden", new Date("2026-10-13T00:00:00.000Z"));
    const ids = open.map((r) => Number(r.entry_id));
    expect(ids).toContain(fixTank);
    expect(ids).not.toContain(orderSeed);
    const since = await tasks.circleTaskRows(pool, "c-garden", new Date("2026-10-01T00:00:00.000Z"));
    expect(since.map((r) => Number(r.entry_id))).toContain(orderSeed);
    expect(await tasks.circleTaskRows(pool, "c-nobody", null)).toEqual([]);
  });

  it("reads one session's tasks, all or only the open ones", async () => {
    expect((await tasks.sessionTaskRows(pool, closedGarden)).map((r) => Number(r.entry_id))).toEqual([fixTank, orderSeed, unheld]);
    expect((await tasks.sessionTaskRows(pool, closedGarden, { openOnly: true })).map((r) => Number(r.entry_id))).toEqual([fixTank, unheld]);
  });

  it("takes each send number once", async () => {
    const at = new Date("2026-10-09T18:01:00.000Z");
    const first = await inTransaction(pool, async (conn) => {
      const n = await tasks.nextSendNo(conn, closedGarden);
      expect(await tasks.insertSend(conn, { sessionId: closedGarden, sendNo: n, sentByNo: 0, sentAt: at, counts: "{}" })).toBe(true);
      return n;
    });
    expect(first).toBe(1);
    expect(await tasks.insertSend(pool, { sessionId: closedGarden, sendNo: 1, sentByNo: 0, sentAt: at, counts: "{}" })).toBe(false);
    await tasks.writeSendCounts(pool, closedGarden, 1, JSON.stringify({ queued: 2 }));
    const second = await inTransaction(pool, async (conn) => {
      const n = await tasks.nextSendNo(conn, closedGarden);
      await tasks.insertSend(conn, { sessionId: closedGarden, sendNo: n, sentByNo: CAI, sentAt: new Date("2026-10-12T10:00:00.000Z"), counts: "{}" });
      return n;
    });
    expect(second).toBe(2);
    const [last] = await tasks.lastSend(pool, closedGarden);
    expect(last).toMatchObject({ send_no: 2, sent_by_no: CAI });
    expect(await tasks.lastSend(pool, closedLoose)).toEqual([]);
  });

  it("reads open tasks due in a window, both ends included", async () => {
    const due = await tasks.dueRows(pool, "2026-10-28", "2026-10-30");
    expect(due.map((r) => Number(r.entry_id))).toEqual([fixTank]);
    expect(await tasks.dueRows(pool, "2026-10-17", "2026-10-17")).toEqual([]);
  });

  it("exports a member's held tasks and their own answers", async () => {
    const ana = await tasks.exportTaskRowsFor(pool, ANA);
    expect(ana.held.map((r) => Number(r.entry_id))).toEqual([fixTank]);
    expect(ana.answers).toEqual([]);
    const ben = await tasks.exportTaskRowsFor(pool, BEN);
    expect(ben.held).toEqual([]);
    expect(ben.answers).toHaveLength(1);
    expect(ben.answers[0]).toMatchObject({ entry_id: fixTank, kind: "not_yet", note: "After the rains", due_on: "2026-10-30" });
  });

  it("names every session the task layer ties to a member, so the erasure rebuilds them", async () => {
    // Ben answered a task in the garden session and wrote its entries; Cai pressed a send.
    expect(await sessionIdsNaming(pool, BEN)).toContain(closedGarden);
    const caiOnly = await session("Cai only sent", "c-other", "closed", CLOSED_AT);
    await tasks.insertSend(pool, { sessionId: caiOnly, sendNo: 1, sentByNo: CAI, sentAt: CLOSED_AT, counts: "{}" });
    expect(await sessionIdsNaming(pool, CAI)).toContain(caiOnly);
  });

  it("forgets a leaver: their entries' tasks go, the tasks they held go back to the circle, and their name and words leave", async () => {
    // Ben wrote every entry here, so forgetting Ben as the author deletes those tasks;
    // forget Ana instead, who holds a task and wrote nothing.
    await tasks.forgetTaskRowsFor(pool, ANA, []);
    const [tank] = await tasks.taskRowsFor(pool, [fixTank]);
    expect(asState(tank)).toMatchObject({ ownerNo: null, ownerSeatId: null, status: "open", version: 3 });
    expect(await q("SELECT COUNT(*) AS n FROM `live_session_task_events` WHERE `owner_no` = ?", [ANA])).toEqual([{ n: 0 }]);

    // Now Ben: the answer they gave keeps its kind and loses their number and their words.
    await tasks.forgetTaskRowsFor(pool, BEN, []);
    const [ev] = await tasks.eventRows(pool, fixTank);
    expect(ev).toMatchObject({ kind: "not_yet", by_no: 0, note: null });
    expect(asState((await tasks.taskRowsFor(pool, [fixTank]))[0])).toMatchObject({ changedByNo: 0, latestNote: null, latestKind: "not_yet" });

    // Cai's send reads as the close's own.
    await tasks.forgetTaskRowsFor(pool, CAI, []);
    expect(await q("SELECT COUNT(*) AS n FROM `live_session_task_sends` WHERE `sent_by_no` = ?", [CAI])).toEqual([{ n: 0 }]);

    // The entries a leaver wrote take their state and events with them.
    await tasks.forgetTaskRowsFor(pool, BEN, [fixTank, orderSeed]);
    expect(await tasks.taskRowsFor(pool, [fixTank, orderSeed])).toEqual([]);
    expect(await tasks.eventRows(pool, fixTank)).toEqual([]);
    expect(await tasks.taskRowsFor(pool, [mendHose])).toHaveLength(1);
  });
});
