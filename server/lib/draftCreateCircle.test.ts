/**
 * A reorganisation that MAKES A CIRCLE, against a real scratch schema.
 *
 * ── THE DEFECT THIS OP EXISTS TO CLOSE ───────────────────────────────────
 *
 * `circle.proposed` has been an accepted proposal kind since 0140, and the
 * review queue ran every one of them through the SEAT reader, because `DraftOp`
 * had no way to make a circle. Accepting a proposed circle therefore produced a
 * SEAT NAMED AFTER THE CIRCLE, silently, and nothing anywhere tested it.
 *
 * What only a database can prove here:
 *
 *   - the circle is written inside the publish transaction and the version
 *     counter tells the circles cache the table moved under it, the same
 *     contract `move_circle` keeps;
 *   - a seat created in the SAME draft may name a circle that draft creates.
 *     Without that, an outside reading of a village could never land in one
 *     batch, because every seat would block on a circle made three lines above
 *     it;
 *   - revert leaves the circle DORMANT rather than deleting it, because seats
 *     from the same draft carry its id and a child may name it as a parent;
 *   - a machine may propose one, which is the whole point, while the rules that
 *     stop a machine resting a seat are untouched.
 *
 * No TEST_DATABASE_URL and the suite skips loudly (harness rule).
 */
import { describe, expect, it, beforeAll, afterAll, beforeEach } from "vitest";
import mysql from "mysql2/promise";
import { provisionTestDb, testDbConfigured, testPool, type TestDb } from "../db/testDb";
import { addChange, createDraft, previewDraft, publishDraft, revertDraft } from "./orgDrafts";

const configured = testDbConfigured();
let db: TestDb;
let pool: mysql.Pool;

async function circleRow(id: string): Promise<{ name: string; status: string; parent: string | null } | undefined> {
  const [[row]] = await pool.query<any[]>( // module-review-ok: the suite seeds and reads back rows in the scratch schema it provisioned
    "SELECT name, status, parent_circle_id FROM circles WHERE id = ?",
    [id],
  );
  return row ? { name: String(row.name), status: String(row.status), parent: row.parent_circle_id ?? null } : undefined;
}

async function circlesVersion(): Promise<number> {
  const [[row]] = await pool.query<any[]>("SELECT version FROM collection_versions WHERE collection = 'circles'"); // module-review-ok: the suite seeds and reads back rows in the scratch schema it provisioned
  return Number(row?.version ?? 0);
}

async function draftWith(
  changes: Array<{ op: string; orgRoleId: string; payload: Record<string, unknown> }>,
  sourceKind = "human",
): Promise<string> {
  const made = await createDraft(pool, {
    title: "Take in a structure",
    createdBy: "u-steward",
    sourceKind,
    openCap: sourceKind === "human" ? 99 : null,
  });
  if (!made.ok) throw new Error(made.error);
  for (const c of changes) {
    const r = await addChange(pool, made.id, c as never);
    expect(r.ok, !r.ok ? r.error : "").toBe(true);
  }
  return made.id;
}

describe.skipIf(!configured)("a draft that makes a circle", () => {
  beforeAll(async () => {
    db = await provisionTestDb();
    pool = testPool(db, { connectionLimit: 4 });
  });
  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });
  beforeEach(async () => {
    await pool.query("DELETE FROM org_draft_changes"); // module-review-ok: resetting the scratch schema this suite provisioned
    await pool.query("DELETE FROM org_drafts"); // module-review-ok: same
    await pool.query("DELETE FROM org_roles"); // module-review-ok: same
    await pool.query("DELETE FROM circles"); // module-review-ok: same
    await pool.query( // module-review-ok: the suite seeds and reads back rows in the scratch schema it provisioned
      "INSERT INTO circles (id, name, parent_circle_id, is_example, status, sort_order) VALUES ('gcc', 'General Circle', NULL, 0, 'active', 1)",
    );
    await pool.query( // module-review-ok: the suite seeds and reads back rows in the scratch schema it provisioned
      "INSERT INTO collection_versions (collection, version) VALUES ('circles', 1) ON DUPLICATE KEY UPDATE version = 1",
    );
  });

  it("previews it in words, publishes it, and tells the cache the table changed", async () => {
    const id = await draftWith([
      { op: "create_circle", orgRoleId: "circle:land-ecology", payload: { name: "Land & Ecology" } },
    ]);
    const preview = await previewDraft(pool, id);
    expect(preview.blocked).toBe(0);
    expect(preview.lines[0].reads).toBe('Create the circle "Land & Ecology"');

    const before = await circlesVersion();
    const r = await publishDraft(pool, id, "u-steward");
    expect(r.ok, !r.ok ? r.error : "").toBe(true);

    expect(await circleRow("land-ecology")).toEqual({ name: "Land & Ecology", status: "active", parent: null });
    expect(await circlesVersion()).toBeGreaterThan(before);
  });

  it("puts it inside a circle that already exists", async () => {
    const id = await draftWith([
      { op: "create_circle", orgRoleId: "circle:water", payload: { name: "Water", parentCircleId: "gcc" } },
    ]);
    expect((await previewDraft(pool, id)).blocked).toBe(0);
    expect((await publishDraft(pool, id, "u-steward")).ok).toBe(true);
    expect((await circleRow("water"))?.parent).toBe("gcc");
  });

  it("LETS A SEAT IN THE SAME DRAFT NAME THE CIRCLE THAT DRAFT CREATES", async () => {
    // The reason this op is worth having. Without it every seat would block on
    // a circle made three lines above it, and an outside reading of a village
    // could only land in two passes with somebody making circles by hand.
    const id = await draftWith([
      { op: "create_circle", orgRoleId: "circle:land-ecology", payload: { name: "Land & Ecology" } },
      {
        op: "create_seat",
        orgRoleId: "role-water",
        payload: { name: "Water Steward", circleId: "land-ecology", seats: 1 },
      },
    ]);
    const preview = await previewDraft(pool, id);
    expect(preview.blocked, JSON.stringify(preview.lines.map((l) => l.blocked))).toBe(0);

    expect((await publishDraft(pool, id, "u-steward")).ok).toBe(true);
    const [[seat]] = await pool.query<any[]>("SELECT circle_id FROM org_roles WHERE id = 'role-water'"); // module-review-ok: the suite reads back rows in the scratch schema it provisioned
    expect(seat.circle_id).toBe("land-ecology");
  });

  it("still blocks a seat naming a circle nobody has made", async () => {
    const id = await draftWith([
      { op: "create_seat", orgRoleId: "role-x", payload: { name: "A Seat", circleId: "nowhere", seats: 1 } },
    ]);
    const preview = await previewDraft(pool, id);
    expect(preview.blocked).toBe(1);
    expect(String(preview.lines[0].blocked)).toContain("does not exist");
  });

  it("refuses a circle whose id is already taken", async () => {
    const id = await draftWith([{ op: "create_circle", orgRoleId: "circle:gcc", payload: { name: "Another" } }]);
    const preview = await previewDraft(pool, id);
    expect(preview.blocked).toBe(1);
    expect(String(preview.lines[0].blocked)).toContain("already exists");
  });

  it("refuses a circle with no name, instead of making one called by its id", async () => {
    const id = await draftWith([{ op: "create_circle", orgRoleId: "circle:nameless", payload: {} }]);
    const preview = await previewDraft(pool, id);
    expect(preview.blocked).toBe(1);
    expect(String(preview.lines[0].blocked)).toContain("needs a name");
  });

  it("refuses a parent that does not exist and that this draft does not create", async () => {
    const id = await draftWith([
      { op: "create_circle", orgRoleId: "circle:orphan", payload: { name: "Orphan", parentCircleId: "nowhere" } },
    ]);
    expect((await previewDraft(pool, id)).blocked).toBe(1);
  });

  it("accepts a parent the same draft creates, in order", async () => {
    const id = await draftWith([
      { op: "create_circle", orgRoleId: "circle:parent", payload: { name: "Parent" } },
      { op: "create_circle", orgRoleId: "circle:child", payload: { name: "Child", parentCircleId: "parent" } },
    ]);
    expect((await previewDraft(pool, id)).blocked).toBe(0);
    expect((await publishDraft(pool, id, "u-steward")).ok).toBe(true);
    expect((await circleRow("child"))?.parent).toBe("parent");
  });

  it("A MACHINE MAY PROPOSE ONE, which is the whole point of the op", async () => {
    // Structure, so a machine may propose it, exactly as it may propose a seat.
    // The rules that stop a machine seating somebody or resting a seat are a
    // different question and are not touched here.
    const id = await draftWith(
      [{ op: "create_circle", orgRoleId: "circle:from-a-machine", payload: { name: "From A Machine" } }],
      "agent",
    );
    const preview = await previewDraft(pool, id);
    expect(preview.blocked, JSON.stringify(preview.lines.map((l) => l.blocked))).toBe(0);
  });

  it("LEAVES IT DORMANT ON REVERT rather than deleting the row", async () => {
    // A delete is the obvious move and the wrong one: seats from the same draft
    // carry this id and a child circle may name it as a parent, so removing the
    // row leaves those pointing at nothing.
    const id = await draftWith([
      { op: "create_circle", orgRoleId: "circle:temporary", payload: { name: "Temporary" } },
    ]);
    expect((await publishDraft(pool, id, "u-steward")).ok).toBe(true);
    expect((await circleRow("temporary"))?.status).toBe("active");

    const back = await revertDraft(pool, id);
    expect(back.ok, !back.ok ? back.error : "").toBe(true);

    const after = await circleRow("temporary");
    expect(after, "the row is kept, so nothing that named it points at nothing").toBeDefined();
    expect(after?.status).toBe("dormant");
  });
});
