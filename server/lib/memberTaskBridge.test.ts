/**
 * THE FEEDBACK BRIDGE: fields the service does not declare are dropped, closed
 * ids are read from whichever field it uses, and (against a real schema) a
 * press queues what the library is owed, notes stay held until released, the
 * member's off switch drops what is unsent, undo takes a press back, and
 * erasure leaves nothing.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type mysql from "mysql2/promise";
import { provisionTestDb, testDbConfigured, testPool, type TestDb } from "../db/testDb";
import { declaredFields, recordAction, removedIdsOf, shapeArgs } from "./memberTaskBridge";
import { forgetMemberTasks, insertTask, ownTask } from "../repos/memberTasks";
import { linkSeraPerson } from "../repos/memberTaskImport";
import { setFeedbackOn, setNotesRelease, undoFeedback } from "../repos/memberTaskFeedback";

describe("shaping a call to the service's own schema", () => {
  it("drops what the tool does not declare, and sends everything when it declares nothing", () => {
    const fields = declaredFields({ name: "submit_task_feedback", inputSchema: { properties: { task_id: {}, reason_code: {} } } });
    expect(shapeArgs({ task_id: "t", reason_code: "not_mine", note: "x" }, fields)).toEqual({ args: { task_id: "t", reason_code: "not_mine" }, dropped: ["note"] });
    expect(shapeArgs({ a: 1 }, declaredFields({ name: "x", inputSchema: null })).args).toEqual({ a: 1 });
  });
  it("reads closed ids from the field the service uses", () => {
    expect(removedIdsOf({ removed_ids: ["a", "b"] })).toEqual(["a", "b"]);
    expect(removedIdsOf({ closed_ids: [{ id: "c" }] })).toEqual(["c"]);
    expect(removedIdsOf({ results: [] })).toEqual([]);
  });
});

const configured = testDbConfigured();

describe.skipIf(!configured)("the bridge against a real schema", () => {
  let db: TestDb;
  let pool: mysql.Pool;
  const q = async (sql: string, params: unknown[] = []) => (await pool.query<any[]>(sql, params))[0]; // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
  const ctx = { shownIn: "today" as const, rankScore: 3.5, daysOnList: 2, surface: "profile" as const };

  beforeAll(async () => {
    db = await provisionTestDb();
    pool = testPool(db, { connectionLimit: 4 });
  }, 180_000);
  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });
  beforeEach(async () => {
    for (const t of ["member_tasks", "member_task_feedback", "member_task_outbox", "member_task_prefs", "member_task_bridge", "sera_person_links"]) {
      await q(`DELETE FROM \`${t}\``); // module-review-ok: fixture SQL against the S5 scratch schema
    }
  });

  const libraryTask = async () => {
    await linkSeraPerson(pool, "own-wren", "m-wren", null);
    const id = await insertTask(pool, "m-wren", { title: "From the library", tier: "high", dueOn: null, horizon: null, minutes: null, privateDetail: "journal words", source: "sera", externalId: "s-1", createdOn: "2026-11-02" }, null);
    return (await ownTask(pool, "m-wren", id))!;
  };

  it("queues the code, the context and a suppression on removal; the note waits, stripped", async () => {
    const task = await libraryTask();
    const fresh = await recordAction(pool, { userId: "m-wren", task, action: "remove", feedback: { feedbackId: "fb-aaaaaaaa", reason: "merged", note: "ask a@b.co", context: ctx } });
    expect(fresh).toBe(true);
    expect(await recordAction(pool, { userId: "m-wren", task, action: "remove", feedback: { feedbackId: "fb-aaaaaaaa", reason: "merged", note: null, context: ctx } })).toBe(false);
    const rows = await q("SELECT `kind`, `status`, `payload` FROM `member_task_outbox` ORDER BY `id`"); // module-review-ok: fixture SQL against the S5 scratch schema
    expect(rows.map((r: any) => [r.kind, r.status])).toEqual([["feedback", "queued"], ["suppress", "queued"], ["note", "held"]]);
    const fb = JSON.parse(rows[0].payload);
    expect(fb).toMatchObject({ task_id: "s-1", owner_id: "own-wren", reason_code: "duplicate", context: { shown_in: "today", rank_score: 3.5, days_on_list: 2, surface: "profile" } });
    expect(rows[0].payload).not.toContain("journal words");
    expect(rows[2].payload).not.toContain("a@b.co");
    const [f] = await q("SELECT `review` FROM `member_task_feedback` WHERE `feedback_id` = 'fb-aaaaaaaa'"); // module-review-ok: fixture SQL against the S5 scratch schema
    expect(f.review).toBe("steward");
    await setNotesRelease(pool, "released", "m-steward");
    expect((await q("SELECT `status` FROM `member_task_outbox` WHERE `kind` = 'note'"))[0].status).toBe("queued"); // module-review-ok: fixture SQL against the S5 scratch schema
  });

  it("sends nothing for a member's own task, or when the member turned it off", async () => {
    const own = (await ownTask(pool, "m-wren", await insertTask(pool, "m-wren", { title: "Mine", tier: "high", dueOn: null, horizon: null, minutes: null, privateDetail: null, source: "self", createdOn: "2026-11-02" }, null)))!;
    await recordAction(pool, { userId: "m-wren", task: own, action: "done", feedback: { feedbackId: "fb-bbbbbbbb", reason: null, note: null, context: ctx } });
    const task = await libraryTask();
    await setFeedbackOn(pool, "m-wren", false);
    await recordAction(pool, { userId: "m-wren", task, action: "done", feedback: { feedbackId: "fb-cccccccc", reason: null, note: null, context: ctx } });
    expect(await q("SELECT `id` FROM `member_task_outbox`")).toEqual([]); // module-review-ok: fixture SQL against the S5 scratch schema
  });

  it("undo drops what was not yet sent", async () => {
    const task = await libraryTask();
    await recordAction(pool, { userId: "m-wren", task, action: "remove", feedback: { feedbackId: "fb-dddddddd", reason: "already_done", note: null, context: ctx } });
    expect((await undoFeedback(pool, "m-wren", "fb-dddddddd")).wasSent).toBe(false);
    expect((await q("SELECT DISTINCT `status` FROM `member_task_outbox`")).map((r: any) => r.status)).toEqual(["dropped"]); // module-review-ok: fixture SQL against the S5 scratch schema
  });

  it("erasure deletes the member's feedback and asks the library to forget them", async () => {
    const task = await libraryTask();
    await recordAction(pool, { userId: "m-wren", task, action: "done", feedback: { feedbackId: "fb-eeeeeeee", reason: null, note: null, context: ctx } });
    await forgetMemberTasks(pool, "m-wren");
    expect(await q("SELECT `feedback_id` FROM `member_task_feedback` WHERE `user_id` = 'm-wren'")).toEqual([]); // module-review-ok: fixture SQL against the S5 scratch schema
    const left = await q("SELECT `kind`, `user_id`, `payload` FROM `member_task_outbox`"); // module-review-ok: fixture SQL against the S5 scratch schema
    expect(left).toHaveLength(1);
    expect(left[0]).toMatchObject({ kind: "forget_person", user_id: null });
    expect(left[0].payload).not.toContain("m-wren");
  });
});
