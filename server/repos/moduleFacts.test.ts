/**
 * What a module knows, against a real database.
 *
 * The case that matters most is the last one: everything a module wrote has to
 * be removable by that module's id alone, because that is the lever a village
 * pulls when it turns a module off.
 */
import { describe, expect, it, beforeAll, afterAll, beforeEach } from "vitest";
import mysql from "mysql2/promise";
import { provisionTestDb, testDbConfigured, testPool, type TestDb } from "../db/testDb";
import { factsByName, factsForEntity, forgetModuleFacts, moduleFactCount, upsertFacts } from "./moduleFacts";

const configured = testDbConfigured();
let db: TestDb;
let pool: mysql.Pool;

const fact = (over: Record<string, unknown> = {}) => ({
  entityKind: "org_role",
  entityId: "role-1",
  vendorKind: "role",
  vendorRecordId: "rec-1",
  attachesTo: "Water Steward",
  fields: { "Role Type": "Steward", "Next Audit Date": "2027-01-15" },
  sourceUrl: "https://example.test/p/rec-1",
  ...over,
});

describe.skipIf(!configured)("what a module knows about a seat", () => {
  beforeAll(async () => {
    db = await provisionTestDb();
    pool = testPool(db, { connectionLimit: 4 });
  });
  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });
  beforeEach(async () => {
    await pool.query("DELETE FROM module_entity_facts"); // module-review-ok: resetting the scratch schema this suite provisioned, between cases
  });

  it("keeps the vendor's own field names, uninterpreted", async () => {
    await upsertFacts(pool, "v1", "saberra", [fact()]);
    const [row] = await factsForEntity(pool, "org_role", "role-1");
    expect(row.fields).toEqual({ "Role Type": "Steward", "Next Audit Date": "2027-01-15" });
    expect(row.vendorRecordId).toBe("rec-1");
    expect(row.sourceUrl).toBe("https://example.test/p/rec-1");
  });

  it("REPLACES what it knew about the same record instead of stacking a second row", async () => {
    await upsertFacts(pool, "v1", "saberra", [fact()]);
    await upsertFacts(pool, "v1", "saberra", [fact({ fields: { "Role Type": "Lead Steward" } })]);
    const rows = await factsForEntity(pool, "org_role", "role-1");
    expect(rows).toHaveLength(1);
    expect(rows[0].fields).toEqual({ "Role Type": "Lead Steward" });
  });

  it("holds detail for a record whose seat does not exist here yet", async () => {
    // A circle the service knows and this village has not created. Nullable
    // `entity_id` is the honest state, and the name is how a panel finds it.
    await upsertFacts(pool, "v1", "saberra", [
      fact({ entityKind: "circle", entityId: null, vendorKind: "circle", vendorRecordId: "c-9", attachesTo: "Land & Ecology" }),
    ]);
    expect(await factsForEntity(pool, "circle", "c-9")).toEqual([]);
    const byName = await factsByName(pool, "saberra", "circle");
    expect(byName.get("Land & Ecology")?.vendorRecordId).toBe("c-9");
  });

  it("CLIPS A VENDOR STRING rather than letting a strict server refuse the whole write", async () => {
    // One character over a column width is a refused INSERT on this server, and
    // a sync that lands nothing and says nothing is the worst of the outcomes.
    const long = "x".repeat(500);
    const n = await upsertFacts(pool, "v1", "saberra", [fact({ attachesTo: long, sourceUrl: long })]);
    expect(n).toBe(1);
    const [row] = await factsForEntity(pool, "org_role", "role-1");
    expect(row.attachesTo).toHaveLength(200);
    expect(row.sourceUrl).toHaveLength(400);
  });

  it("refuses a record with no vendor id instead of writing an unfindable row", async () => {
    const n = await upsertFacts(pool, "v1", "saberra", [fact({ vendorRecordId: "" })]);
    expect(n).toBe(0);
    expect(await moduleFactCount(pool, "saberra")).toBe(0);
  });

  it("writes nothing and answers zero for an empty read", async () => {
    expect(await upsertFacts(pool, "v1", "saberra", [])).toBe(0);
    expect(await factsForEntity(pool, "org_role", "nobody")).toEqual([]);
  });

  it("TAKES EVERYTHING ONE MODULE WROTE, which is what turning it off has to mean", async () => {
    await upsertFacts(pool, "v1", "saberra", [fact(), fact({ vendorRecordId: "rec-2", entityId: "role-2" })]);
    await upsertFacts(pool, "v1", "other", [fact({ vendorRecordId: "rec-3", entityId: "role-3" })]);
    expect(await moduleFactCount(pool, "saberra")).toBe(2);

    const gone = await forgetModuleFacts(pool, "saberra");
    expect(gone).toBe(2);
    expect(await moduleFactCount(pool, "saberra")).toBe(0);
    // The other module's row is untouched: the lever is per module, not global.
    expect(await moduleFactCount(pool, "other")).toBe(1);
  });
});
