/**
 * A draft that sets a circle's standing (0373), against a real scratch schema.
 * Operating or forming, and the anchor mark: previewed, published by a person,
 * and reverted, with at most one anchor at any time.
 * No TEST_DATABASE_URL and the suite skips loudly (harness rule).
 */
import { describe, expect, it, beforeAll, afterAll, beforeEach } from "vitest";
import mysql from "mysql2/promise";
import { testPool, provisionTestDb, testDbConfigured, type TestDb } from "../db/testDb";
import { addChange, createDraft, previewDraft, publishDraft, revertDraft } from "./orgDrafts";

const configured = testDbConfigured();
let db: TestDb;
let pool: mysql.Pool;

async function row(id: string) {
  const [[r]] = await pool.query<any[]>("SELECT status, is_anchor FROM circles WHERE id = ?", [id]); // module-review-ok: the suite reads back rows in the scratch schema it provisioned
  return r as { status: string; is_anchor: number };
}
async function draftWith(circle: string, payload: Record<string, unknown>): Promise<string> {
  const made = await createDraft(pool, { title: "Standing", createdBy: "u-steward", sourceKind: "human", openCap: 99 });
  if (!made.ok) throw new Error(made.error);
  const r = await addChange(pool, made.id, { op: "set_circle_standing", orgRoleId: `circle:${circle}`, payload });
  expect(r.ok, !r.ok ? r.error : "").toBe(true);
  return made.id;
}

describe.skipIf(!configured)("a draft that sets a circle's standing", () => {
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
    await pool.query("DELETE FROM circles"); // module-review-ok: same
    await pool.query( // module-review-ok: seeds the scratch schema this suite provisioned
      `INSERT INTO circles (id, name, is_example, status, is_anchor, sort_order) VALUES
         ('one', 'One', 0, 'active', 1, 1), ('two', 'Two', 0, 'active', 0, 2), ('old', 'Old', 0, 'dormant', 0, 3)`,
    );
  });

  it("publishes forming and a moved anchor, then reverts both", async () => {
    const id = await draftWith("two", { status: "forming", isAnchor: true });
    const pv = await previewDraft(pool, id);
    expect(JSON.stringify(pv)).toContain("as the anchor circle");
    const pub = await publishDraft(pool, id, "u-steward");
    expect(pub.ok).toBe(true);
    expect(await row("two")).toMatchObject({ status: "forming", is_anchor: 1 });
    expect((await row("one")).is_anchor).toBe(0);
    const back = await revertDraft(pool, id, "u-steward");
    expect(back.ok, !back.ok ? back.error : "").toBe(true);
    expect(await row("two")).toMatchObject({ status: "active", is_anchor: 0 });
    expect((await row("one")).is_anchor).toBe(1);
  });

  it("blocks a dormant circle, a bad status and an empty change", async () => {
    for (const [c, p] of [["old", { status: "forming" }], ["two", { status: "dormant" }], ["two", {}]] as const) {
      const id = await draftWith(c, p as Record<string, unknown>);
      expect(JSON.stringify(await previewDraft(pool, id))).toMatch(/blocked":"/);
    }
  });
});
