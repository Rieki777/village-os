/**
 * TWO PR C RESIDUALS, CLOSED.
 *
 * 1. `addChange` read the draft's status on the pool, with no lock. A publish
 *    holds the draft row locked while it applies, so a change added in that
 *    window read "open" from the snapshot and landed in a draft that was
 *    being published: a change the chart never got, in a draft that says it
 *    was applied. It now takes the draft row's lock first, the order publish
 *    and the answer path lock in, and so waits for the publish and is refused.
 *
 *    The race is made deterministic: one connection holds the lock the way a
 *    publish does, the add starts, the holder publishes and commits.
 *
 * 2. A body that sent `expectedChanges` malformed was read as none sent, so a
 *    publish meant to be compared went ahead uncompared. It now becomes an
 *    empty list, which matches no draft with a change in it.
 *
 * No TEST_DATABASE_URL and the database half skips loudly (harness rule).
 */
import { describe, expect, it, beforeAll, afterAll, beforeEach } from "vitest";
import mysql from "mysql2/promise";
import { testPool, provisionTestDb, testDbConfigured, type TestDb } from "../db/testDb";
import { addChange, createDraft } from "./orgDrafts";
import { expectedChangesOf } from "../routes/orgDraftDecide";

describe("a body's expectedChanges", () => {
  it("is none sent only when the field is absent or null", () => {
    expect(expectedChangesOf({})).toBeNull();
    expect(expectedChangesOf({ expectedChanges: null })).toBeNull();
    expect(expectedChangesOf(undefined)).toBeNull();
  });

  it("passes a clean list through", () => {
    expect(expectedChangesOf({ expectedChanges: ["dch-1", "dch-2"] })).toEqual(["dch-1", "dch-2"]);
  });

  it("turns a malformed one into a list that matches no draft, never into none sent", () => {
    expect(expectedChangesOf({ expectedChanges: "dch-1" })).toEqual([]);
    expect(expectedChangesOf({ expectedChanges: ["dch-1", 7] })).toEqual([]);
    expect(expectedChangesOf({ expectedChanges: [""] })).toEqual([]);
    expect(expectedChangesOf({ expectedChanges: ["x".repeat(65)] })).toEqual([]);
    expect(expectedChangesOf({ expectedChanges: { 0: "dch-1" } })).toEqual([]);
  });
});

const configured = testDbConfigured();
let db: TestDb;
let pool: mysql.Pool;

describe.skipIf(!configured)("a change added while a publish holds the draft", () => {
  beforeAll(async () => {
    db = await provisionTestDb();
    pool = testPool(db, { connectionLimit: 4 }); // module-review-ok: the suite's own pool onto the scratch schema it provisioned
  });

  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  beforeEach(async () => {
    await pool.query("DELETE FROM org_draft_changes"); // module-review-ok: resetting the scratch schema this suite provisioned
    await pool.query("DELETE FROM org_drafts"); // module-review-ok: same
  });

  it("waits for the publish, then is refused, and nothing lands in the published draft", async () => {
    const made = await createDraft(pool, { title: "Rename", createdBy: "u-steward", sourceKind: "human", openCap: 99 });
    if (!made.ok) throw new Error(made.error);

    const publisher = await pool.getConnection();
    try {
      await publisher.beginTransaction();
      await publisher.query("SELECT id FROM org_drafts WHERE id = ? FOR UPDATE", [made.id]); // module-review-ok: holding the row the way publishDraft does
      const adding = addChange(pool, made.id, { op: "update_seat", orgRoleId: "keeper", payload: { name: "Water Steward" } });
      // Long enough for the add to reach its read, which must now wait on the lock.
      await new Promise((r) => setTimeout(r, 300));
      await publisher.query("UPDATE org_drafts SET status = 'published' WHERE id = ?", [made.id]); // module-review-ok: the publish this race is against
      await publisher.commit();
      const r = await adding;
      expect(r.ok, "the add saw the published draft").toBe(false);
      if (!r.ok) expect(r.error).toContain("published");
    } finally {
      publisher.release();
    }
    const [[n]] = await pool.query<any[]>("SELECT COUNT(*) AS n FROM org_draft_changes WHERE draft_id = ?", [made.id]); // module-review-ok: reading back the scratch schema
    expect(Number(n.n)).toBe(0);
  });

  it("still adds to an open draft, in its own transaction, when handed a pool", async () => {
    const made = await createDraft(pool, { title: "Rename", createdBy: "u-steward", sourceKind: "human", openCap: 99 });
    if (!made.ok) throw new Error(made.error);
    const r = await addChange(pool, made.id, { op: "update_seat", orgRoleId: "keeper", payload: { name: "Water Steward" } });
    expect(r.ok).toBe(true);
    const [[n]] = await pool.query<any[]>("SELECT COUNT(*) AS n FROM org_draft_changes WHERE draft_id = ?", [made.id]); // module-review-ok: reading back the scratch schema
    expect(Number(n.n)).toBe(1);
  });
});
