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
 *     would now close a loop, when the circle has moved again since (undoing
 *     would throw that later move away), or when the circle is gone;
 *   - a circle whose id is as long as an id can be still fits in a change,
 *     because the change names it with a prefix.
 *
 * No TEST_DATABASE_URL and the suite skips loudly (harness rule).
 */
import { describe, expect, it, beforeAll, afterAll, beforeEach } from "vitest";
import mysql from "mysql2/promise";
import { testPool, provisionTestDb, testDbConfigured, type TestDb } from "../db/testDb";
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

  it("refuses to undo a move when the circle has moved again since, and writes nothing", async () => {
    // Published: the Web Guild into the General Circle. Then a later draft, or
    // the admin form, moves it on to the top of the village. Putting it "back"
    // inside Development would throw that later move away while the later
    // draft went on saying it was published.
    const id = await draftOf([["web", "gcc"]]);
    expect((await publishDraft(pool, id, "u-steward")).ok).toBe(true);
    await pool.query("UPDATE circles SET parent_circle_id = NULL WHERE id = ?", ["web"]); // module-review-ok: the suite seeds and reads back rows in the scratch schema it provisioned

    const r = await revertDraft(pool, id);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toContain("moved again");
    expect(await parentOf("web"), "a refused revert writes nothing").toBeNull();
  });

  it("refuses to undo a move whose circle is gone", async () => {
    const id = await draftOf([["web", "gcc"]]);
    expect((await publishDraft(pool, id, "u-steward")).ok).toBe(true);
    await pool.query("DELETE FROM circles WHERE id = ?", ["web"]); // module-review-ok: the suite seeds and reads back rows in the scratch schema it provisioned

    const r = await revertDraft(pool, id);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toContain("no longer in the village");
  });

  // ── 0286: a move may also set the circle's order and governance layer ──────

  /** Where a circle sits, in full: parent, place among its siblings, layer. */
  async function placeOf(id: string): Promise<{ parent: string | null; order: number; layer: string | null }> {
    const [[row]] = await pool.query<any[]>("SELECT parent_circle_id, sort_order, layer FROM circles WHERE id = ?", [id]); // module-review-ok: the suite seeds and reads back rows in the scratch schema it provisioned
    return { parent: row.parent_circle_id ?? null, order: Number(row.sort_order), layer: row.layer ?? null };
  }

  /** One draft holding one move with this payload. */
  async function draftWith(circle: string, payload: Record<string, unknown>): Promise<string> {
    const made = await createDraft(pool, { title: "Arrange the circles", createdBy: "u-steward", sourceKind: "human", openCap: 99 });
    if (!made.ok) throw new Error(made.error);
    const r = await addChange(pool, made.id, { op: "move_circle", orgRoleId: `circle:${circle}`, payload });
    expect(r.ok, !r.ok ? r.error : "").toBe(true);
    return made.id;
  }

  it("sets a circle's place and layer with its move, and says so in the preview", async () => {
    const id = await draftWith("dev", { parentCircleId: null, order: 0, layer: "lead" });
    const preview = await previewDraft(pool, id);
    expect(preview.blocked).toBe(0);
    expect(preview.lines[0].reads).toBe('Give "Development Circle" place 1 among the circles beside it, and make it a lead circle');
    expect((await publishDraft(pool, id, "u-steward")).ok).toBe(true);
    expect(await placeOf("dev")).toEqual({ parent: null, order: 0, layer: "lead" });
  });

  it("leaves the place and layer alone when a move carries only its parent", async () => {
    await pool.query("UPDATE circles SET layer = 'operating', sort_order = 7 WHERE id = 'web'"); // module-review-ok: the suite seeds and reads back rows in the scratch schema it provisioned
    const id = await draftOf([["web", "gcc"]]);
    expect((await publishDraft(pool, id, "u-steward")).ok).toBe(true);
    expect(await placeOf("web")).toEqual({ parent: "gcc", order: 7, layer: "operating" });
  });

  it("clears a layer with null", async () => {
    await pool.query("UPDATE circles SET layer = 'advisory' WHERE id = 'web'"); // module-review-ok: the suite seeds and reads back rows in the scratch schema it provisioned
    const id = await draftWith("web", { parentCircleId: "dev", layer: null });
    expect((await previewDraft(pool, id)).lines[0].reads).toBe('Clear the governance layer of "Web Guild"');
    expect((await publishDraft(pool, id, "u-steward")).ok).toBe(true);
    expect((await placeOf("web")).layer).toBeNull();
  });

  it("refuses a layer this build does not know, and publishes nothing", async () => {
    const id = await draftWith("dev", { parentCircleId: null, layer: "chief" });
    expect(String((await previewDraft(pool, id)).lines[0].blocked)).toContain("governance layer is one of");
    expect((await publishDraft(pool, id, "u-steward")).ok).toBe(false);
    expect((await placeOf("dev")).layer).toBeNull();
  });

  it("puts the place and layer back on revert, along with the parent", async () => {
    await pool.query("UPDATE circles SET layer = 'operating' WHERE id = 'web'"); // module-review-ok: the suite seeds and reads back rows in the scratch schema it provisioned
    const id = await draftWith("web", { parentCircleId: "gcc", order: 0, layer: "lead" });
    expect((await publishDraft(pool, id, "u-steward")).ok).toBe(true);
    expect(await placeOf("web")).toEqual({ parent: "gcc", order: 0, layer: "lead" });

    const r = await revertDraft(pool, id);
    expect(r.ok, !r.ok ? r.error : "").toBe(true);
    expect(await placeOf("web")).toEqual({ parent: "dev", order: 3, layer: "operating" });
  });

  it("refuses to undo a layer that has been changed again since, and writes nothing", async () => {
    const id = await draftWith("web", { parentCircleId: "dev", layer: "lead" });
    expect((await publishDraft(pool, id, "u-steward")).ok).toBe(true);
    await pool.query("UPDATE circles SET layer = 'advisory' WHERE id = 'web'"); // module-review-ok: the suite seeds and reads back rows in the scratch schema it provisioned

    const r = await revertDraft(pool, id);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toContain("rearranged again");
    expect((await placeOf("web")).layer, "a refused revert writes nothing").toBe("advisory");
  });

  it("moves a circle whose id is as long as an id can be", async () => {
    // A circle id is cut at 64 characters, and a change names it as
    // circle:<id>, which is 71. The seat column was 64 wide and refused it.
    const longId = "a-very-long-circle-name-that-fills-every-character-an-id-can-hold".slice(0, 64);
    expect(longId).toHaveLength(64);
    await pool.query( // module-review-ok: the suite seeds and reads back rows in the scratch schema it provisioned
      "INSERT INTO circles (id, name, parent_circle_id, is_example, status, sort_order) VALUES (?, ?, NULL, 0, ?, 5)",
      [longId, "A Very Long Circle", "active"],
    );
    const id = await draftOf([[longId, "gcc"]]);
    const r = await publishDraft(pool, id, "u-steward");
    expect(r.ok, !r.ok ? r.error : "").toBe(true);
    expect(await parentOf(longId)).toBe("gcc");
  });
});
