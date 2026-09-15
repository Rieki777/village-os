/**
 * A reorganisation that MOVES A CIRCLE (0208), against a real scratch schema.
 *
 * What only a database can prove here:
 *
 *   - the move is written inside the publish transaction, and the circles
 *     cache is told through the version counter that the table changed under
 *     it, so a writer holding an older snapshot is rebased and cannot put the
 *     old parent back;
 *   - two moves in ONE draft that close a loop only between them are refused
 *     at preview. No single-row check can see that, and a loop drew an empty
 *     map;
 *   - revert puts a circle back where it sat, and refuses when putting it back
 *     would now close a loop because the village moved on after the publish.
 *
 * No TEST_DATABASE_URL and the suite skips loudly (harness rule).
 */
import { describe, expect, it, beforeAll, afterAll, beforeEach } from "vitest";
import mysql from "mysql2/promise";
import { provisionTestDb, testDbConfigured, type TestDb } from "../db/testDb";
import { addChange, createDraft, previewDraft, publishDraft, revertDraft } from "./orgDrafts";

const configured = testDbConfigured();
let db: TestDb;
let pool: mysql.Pool;

/** Where a circle sits: its parent id, null at the top, undefined when there is no such circle. */
async function parentOf(id: string): Promise<string | null | undefined> {
  const [[row]] = await pool.query<any[]>("SELECT parent_circle_id FROM circles WHERE id = ?", [id]); // module-review-ok: the suite seeds and reads back rows in the scratch schema it provisioned
  return row ? (row.parent_circle_id ?? null) : undefined;
}

async function circlesVersion(): Promise<number> {
  const [[row]] = await pool.query<any[]>("SELECT version FROM collection_versions WHERE collection = 'circles'"); // module-review-ok: the suite seeds and reads back rows in the scratch schema it provisioned
  return Number(row?.version ?? 0);
}

/** One draft holding these moves, in order: [circle, new parent or null for the top]. */
async function draftOf(moves: Array<[string, string | null]>): Promise<string> {
  const made = await createDraft(pool, {
    title: "Arrange the circles",
    createdBy: "u-steward",
    sourceKind: "human",
    openCap: 99,
  });
  if (!made.ok) throw new Error(made.error);
  for (const [circle, parent] of moves) {
    const r = await addChange(pool, made.id, {
      op: "move_circle",
      orgRoleId: `circle:${circle}`,
      payload: { parentCircleId: parent },
    });
    expect(r.ok, !r.ok ? r.error : "").toBe(true);
  }
  return made.id;
}

describe.skipIf(!configured)("a draft that moves circles", () => {
  beforeAll(async () => {
    db = await provisionTestDb();
    pool = mysql.createPool({ uri: db.url, timezone: "Z", connectionLimit: 4 }); // module-review-ok: the suite's own pool onto the scratch schema it provisioned
  });

  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  beforeEach(async () => {
    await pool.query("DELETE FROM org_draft_changes"); // module-review-ok: resetting the scratch schema this suite provisioned
    await pool.query("DELETE FROM org_drafts"); // module-review-ok: same
    await pool.query("DELETE FROM circles"); // module-review-ok: same
    await pool.query( // module-review-ok: the suite seeds and reads back rows in the scratch schema it provisioned
      `INSERT INTO circles (id, name, parent_circle_id, is_example, status, sort_order) VALUES
         ('gcc', 'General Circle', NULL, 0, 'active', 1),
         ('dev', 'Development Circle', NULL, 0, 'active', 2),
         ('web', 'Web Guild', 'dev', 0, 'active', 3),
         ('demo', 'Demo Circle', NULL, 1, 'active', 4)`,
    );
    await pool.query( // module-review-ok: the suite seeds and reads back rows in the scratch schema it provisioned
      "INSERT INTO collection_versions (collection, version) VALUES ('circles', 1) ON DUPLICATE KEY UPDATE version = 1",
    );
  });

  it("previews the move in words, publishes it, and tells the cache the table changed", async () => {
    const id = await draftOf([["dev", "gcc"]]);
    const preview = await previewDraft(pool, id);
    expect(preview.blocked).toBe(0);
    expect(preview.lines[0].reads).toBe('Move "Development Circle" inside "General Circle"');

    const before = await circlesVersion();
    const r = await publishDraft(pool, id, "u-steward");
    expect(r.ok, !r.ok ? r.error : "").toBe(true);
    expect(await parentOf("dev")).toBe("gcc");
    // The bump is what makes an in-flight replaceAll rebase instead of writing
    // the old parent back before the route reloads the cache.
    expect(await circlesVersion()).toBeGreaterThan(before);
  });

  it("moves a circle to the top of the village", async () => {
    const id = await draftOf([["web", null]]);
    expect((await previewDraft(pool, id)).lines[0].reads).toBe('Move "Web Guild" to the top of the village');
    expect((await publishDraft(pool, id, "u-steward")).ok).toBe(true);
    expect(await parentOf("web")).toBeNull();
  });

  it("refuses two moves that close a loop only together, and publishes neither", async () => {
    // Each move alone is fine: the General Circle inside Development, or
    // Development inside the General Circle. Both in one draft is a loop.
    const id = await draftOf([["gcc", "dev"], ["dev", "gcc"]]);
    const preview = await previewDraft(pool, id);
    expect(preview.lines[0].blocked).toBeNull();
    expect(String(preview.lines[1].blocked)).toContain("already inside");

    const r = await publishDraft(pool, id, "u-steward");
    expect(r.ok).toBe(false);
    expect(await parentOf("gcc")).toBeNull();
    expect(await parentOf("dev")).toBeNull();
  });

  it("refuses to move a standing example, or a circle that does not exist", async () => {
    const id = await draftOf([["demo", "gcc"], ["ghost", "gcc"]]);
    const preview = await previewDraft(pool, id);
    expect(String(preview.lines[0].blocked)).toContain("standing example");
    expect(preview.lines[1].blocked).toBe("That circle does not exist");
  });

  it("refuses a standing example as the parent", async () => {
    const id = await draftOf([["dev", "demo"]]);
    expect(String((await previewDraft(pool, id)).lines[0].blocked)).toContain("standing example");
  });

  it("reverts a move to where the circle sat before", async () => {
    const id = await draftOf([["web", "gcc"]]);
    expect((await publishDraft(pool, id, "u-steward")).ok).toBe(true);
    expect(await parentOf("web")).toBe("gcc");

    const r = await revertDraft(pool, id);
    expect(r.ok, !r.ok ? r.error : "").toBe(true);
    expect(await parentOf("web")).toBe("dev");
  });

  it("refuses to revert when putting the circle back would now close a loop", async () => {
    // Publish: the Web Guild leaves Development for the top. Then, outside the
    // draft, Development is put INSIDE the Web Guild. Putting the Web Guild
    // back inside Development would now close a loop.
    const id = await draftOf([["web", null]]);
    expect((await publishDraft(pool, id, "u-steward")).ok).toBe(true);
    await pool.query("UPDATE circles SET parent_circle_id = 'web' WHERE id = 'dev'"); // module-review-ok: the suite seeds and reads back rows in the scratch schema it provisioned

    const r = await revertDraft(pool, id);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toContain("cannot be undone");
    expect(await parentOf("web"), "a refused revert writes nothing").toBeNull();
  });
});
