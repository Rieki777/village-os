/** A member's saved time zone: stored once, refused when not an IANA name, cleared with null, erased with the person. */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type mysql from "mysql2/promise";
import { provisionTestDb, testDbConfigured, testPool, type TestDb } from "../db/testDb";
import { forgetTimeZone, setTimeZone, timeZoneOf } from "./memberTimeZone";

describe.skipIf(!testDbConfigured())("member time zones against a real schema", () => {
  let db: TestDb;
  let pool: mysql.Pool;
  beforeAll(async () => {
    db = await provisionTestDb();
    pool = testPool(db, { connectionLimit: 2 });
  }, 180_000);
  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });
  beforeEach(async () => {
    await pool.query("DELETE FROM `member_time_zones`"); // module-review-ok: fixture SQL against the scratch schema
  });

  it("reads null before a choice, then the saved zone, then null after clearing", async () => {
    expect(await timeZoneOf(pool, "m-wren")).toBeNull();
    expect(await setTimeZone(pool, "m-wren", " America/Costa_Rica ")).toBe(true);
    expect(await timeZoneOf(pool, "m-wren")).toBe("America/Costa_Rica");
    expect(await setTimeZone(pool, "m-wren", "Europe/Lisbon")).toBe(true);
    expect(await timeZoneOf(pool, "m-wren")).toBe("Europe/Lisbon");
    expect(await setTimeZone(pool, "m-wren", null)).toBe(true);
    expect(await timeZoneOf(pool, "m-wren")).toBeNull();
  });
  it("refuses what is not a zone and keeps the old one", async () => {
    await setTimeZone(pool, "m-wren", "Europe/Lisbon");
    for (const bad of ["CST", "+02:00", "Mars/Olympus", 5]) expect(await setTimeZone(pool, "m-wren", bad)).toBe(false);
    expect(await timeZoneOf(pool, "m-wren")).toBe("Europe/Lisbon");
  });
  it("erasure leaves nothing", async () => {
    await setTimeZone(pool, "m-wren", "Europe/Lisbon");
    await forgetTimeZone(pool, "m-wren");
    expect(await timeZoneOf(pool, "m-wren")).toBeNull();
  });
});
