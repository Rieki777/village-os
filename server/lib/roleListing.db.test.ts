/**
 * LISTING AGAINST A REAL SCHEMA (role journey PR-A): the migration's column
 * reads NULL as listed, an admin write and a draft's create_seat both reach it,
 * and "List only these" keeps what was listed before so it can be put back.
 */
import mysql from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { provisionTestDb, testDbConfigured, type TestDb, testPool } from "../db/testDb";
import { createOrgRole, listOrgRoles, updateOrgRole } from "./orgChart";
import { applyListOnly, readListingRecords, undoListOnly } from "../repos/roleListingRecords";
import { isListed, planListOnly } from "../../shared/roleListing";

describe.skipIf(!testDbConfigured())("listing, stored", () => {
  let db: TestDb;
  let pool: mysql.Pool;

  beforeAll(async () => {
    db = await provisionTestDb();
    pool = testPool(db, { connectionLimit: 4 });
  });
  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  const listedOf = async (id: string) => (await listOrgRoles(pool)).find((r) => r.id === id)?.listed;

  it("reads a role nobody touched as listed, and stores an explicit unlisted", async () => {
    const plain = await createOrgRole(pool, { id: "lst-plain", name: "Plain" });
    const hidden = await createOrgRole(pool, { id: "lst-hidden", name: "Hidden", listed: false });
    expect(await listedOf(plain)).toBeNull();
    expect(isListed({ listed: await listedOf(plain) })).toBe(true);
    expect(await listedOf(hidden)).toBe(false);
  });

  it("changes through the admin edit, and an empty value goes back to NULL", async () => {
    await updateOrgRole(pool, "lst-plain", { listed: false });
    expect(await listedOf("lst-plain")).toBe(false);
    await updateOrgRole(pool, "lst-plain", { listed: null });
    expect(await listedOf("lst-plain")).toBeNull();
  });

  it("List only these lists the named role, unlists the rest, and undo puts the earlier listing back", async () => {
    await createOrgRole(pool, { id: "lst-keep", name: "Keep" });
    const roles = (await listOrgRoles(pool)).filter((r) => r.id.startsWith("lst-"));
    const before = new Map(roles.map((r) => [r.id, isListed(r)]));
    await applyListOnly(pool, planListOnly(roles, ["lst-keep"]), ["lst-keep"]);
    expect(await listedOf("lst-keep")).toBe(true);
    expect(await listedOf("lst-plain")).toBe(false);
    expect(await listedOf("lst-hidden")).toBe(false);
    expect((await readListingRecords(pool))[0].kept).toEqual(["lst-keep"]);

    const undone = await undoListOnly(pool);
    expect(undone?.undoneAt).toBeTruthy();
    for (const [id, was] of before) expect(isListed({ listed: await listedOf(id) })).toBe(was);
    // A second undo has nothing left to put back (control: the first one found a record).
    expect(await undoListOnly(pool)).toBeNull();
  });
});
