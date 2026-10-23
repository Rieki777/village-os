/**
 * The class tags on a seat, at the column level.
 *
 * Migration 0069 added `org_roles.archetypes` and `ROLE_COLS` did not select
 * it, which is the same shape the recruitment pack was in and which that
 * comment in orgChart.ts describes exactly: a column the API accepted and then
 * swallowed on the way back out. An end-to-end test over `/api/map` could not
 * have caught it either, because a route that never emits a field looks
 * identical to a village that has not tagged anything.
 *
 * So this reads the rows. It writes tags straight into the table and asserts
 * `listOrgRoles` hands them back, which is the only assertion that fails if
 * somebody trims `ROLE_COLS` again.
 *
 * THE EMPTY CASE IS THE POINT, not an edge. "Tagged for nobody" and "not
 * tagged at all" have to read the same way, because collapsing them the other
 * way is how a filter quietly empties a board, and both of them have to be
 * distinguishable from a tag list by the ONE branch every reader takes.
 *
 * Runs against the S5 harness: a scratch schema with every real migration
 * applied. No TEST_DATABASE_URL and the suite skips loudly (harness rule).
 */
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import mysql from "mysql2/promise";
import { listOrgRoles } from "./orgChart";
import { testPool, provisionTestDb, testDbConfigured, type TestDb } from "../db/testDb";

const configured = testDbConfigured();

let db: TestDb;
let pool: mysql.Pool;

const tagsOf = async (id: string): Promise<string[]> => {
  const roles = await listOrgRoles(pool);
  const r = roles.find((x) => x.id === id);
  if (!r) throw new Error(`no role ${id}`);
  return r.archetypes;
};

describe.skipIf(!configured)("the class tags on a seat", () => {
  beforeAll(async () => {
    db = await provisionTestDb();
    pool = testPool(db, { connectionLimit: 4 }); // module-review-ok: the scratch-schema pool this DB test provisions, same shape as every server DB suite
    await pool.query( // module-review-ok: seeding org_roles on the scratch schema so ROLE_COLS' archetypes read-back is provable
      "INSERT INTO org_roles (id, name, seats, archetypes) VALUES " +
        "('tagged','Water Steward',1,?), " +
        "('empty','Kitchen Lead',1,?), " +
        "('untagged','Site Guide',1,NULL)",
      [JSON.stringify(["building", "researching"]), JSON.stringify([])],
    );
  });

  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  it("reads the tags back out, which ROLE_COLS has to select for", async () => {
    expect(await tagsOf("tagged")).toEqual(["building", "researching"]);
  });

  it("gives an untagged seat and a seat tagged for nobody the SAME answer", async () => {
    // A reader takes one branch for both, so both have to arrive as the same
    // value. If NULL ever came back as null and `[]` as an array, every caller
    // would need two checks and one of them would eventually be forgotten.
    const untagged = await tagsOf("untagged");
    const empty = await tagsOf("empty");
    expect(untagged).toEqual([]);
    expect(empty).toEqual([]);
    expect(untagged).toEqual(empty);
  });

  it("keeps the tags out of nothing else: a seat with tags is otherwise unchanged", async () => {
    const roles = await listOrgRoles(pool);
    const r = roles.find((x) => x.id === "tagged")!;
    expect(r.name).toBe("Water Steward");
    expect(r.seats).toBe(1);
    expect(r.active).toBe(true);
  });
});
