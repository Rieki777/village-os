/**
 * THE CARD'S PARAMETERS AGAINST A REAL SCHEMA (role journey PR-C): every
 * column from migration 0362 is written and read back through the one parser,
 * the ordered interviews keep their order, lengths and final approval, and a
 * value the parser refuses is never stored.
 */
import mysql from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { provisionTestDb, testDbConfigured, type TestDb, testPool } from "../db/testDb";
import { createOrgRole, listOrgRoles, updateOrgRole } from "./orgChart";

describe.skipIf(!testDbConfigured())("the card's parameters, stored", () => {
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

  const read = async (id: string) => (await listOrgRoles(pool)).find((r) => r.id === id)!;
  const ORDER = [
    { roleId: "rc-a", minutes: 60 },
    { roleId: "rc-b", minutes: 20 },
    { roleId: "rc-c", minutes: 20 },
    { roleId: "rc-d", minutes: 20, final: true },
  ];

  it("writes every parameter on create and reads it back", async () => {
    await createOrgRole(pool, {
      id: "rc-card", name: "Card Role", timeCommitment: undefined, track: "paid", villageGoals: ["Fund the land"],
      selectionCriteria: ["Careful with money", "Calm under pressure", "Writes things down"], conversations: ORDER,
      conversationMode: "separate", whereWorked: "both", languages: ["English", "Spanish"], budgetLine: "Finance", fundedFrom: "2026-12-01",
      reviewAfterDays: 90, accessBundle: ["Bank view"], bookingUrl: "https://cal.example/first",
    });
    const r = await read("rc-card");
    expect(r.track).toBe("paid");
    expect(r.villageGoals).toEqual(["Fund the land"]);
    expect(r.conversations).toEqual(ORDER);
    expect(r.conversationMode).toBe("separate");
    expect(r.whereWorked).toBe("both");
    expect(r.languages).toEqual(["English", "Spanish"]);
    expect(r.budgetLine).toBe("Finance");
    expect(r.fundedFrom).toBe("2026-12-01");
    expect(r.reviewAfterDays).toBe(90);
    expect(r.accessBundle).toEqual(["Bank view"]);
    expect(r.bookingUrl).toBe("https://cal.example/first");
  });

  it("changes one parameter and leaves the others, and clears with null", async () => {
    await updateOrgRole(pool, "rc-card", { track: "volunteer" });
    const r = await read("rc-card");
    expect(r.track).toBe("volunteer");
    expect(r.conversations).toEqual(ORDER);
    await updateOrgRole(pool, "rc-card", { conversations: null });
    expect((await read("rc-card")).conversations).toBeNull();
  });

  it("stores nothing the parser refuses", async () => {
    await expect(updateOrgRole(pool, "rc-card", { track: "emperor" })).rejects.toThrow(/track/i);
    expect((await read("rc-card")).track).toBe("volunteer");
    // Control: a role that names none of these still writes and reads as nothing written.
    await createOrgRole(pool, { id: "rc-plain", name: "Plain" });
    const p = await read("rc-plain");
    expect(p.track).toBeNull();
    expect(p.conversations).toBeNull();
    expect(p.villageGoals).toBeNull();
  });
});
