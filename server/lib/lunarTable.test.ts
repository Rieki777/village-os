/**
 * The village's lunar year, named (0085): month names, the southern rotation,
 * and the summary the events route prints beside its window.
 */
import mysql from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { testPool, provisionTestDb, testDbConfigured, type TestDb } from "../db/testDb";
import {
  EXAMPLE_MONTH_NAMES,
  listMonthNames,
  lunarSummaryFor,
  namesForHemisphere,
  setMonthName,
  type MonthName,
} from "./lunarTable";

const examples: MonthName[] = EXAMPLE_MONTH_NAMES.map((name, i) => ({ index: i + 1, name, isExample: true }));

describe("namesForHemisphere", () => {
  it("rotates example names by six in the south and leaves the thirteenth and typed names alone", () => {
    const south = namesForHemisphere(examples, "south");
    expect(south[0].name).toBe("Buck Moon");
    expect(south[6].name).toBe("Wolf Moon");
    expect(south[12].name).toBe("Blue Moon");
    const typed = examples.map((n) => (n.index === 1 ? { ...n, name: "Rain Moon", isExample: false } : n));
    expect(namesForHemisphere(typed, "south")[0].name).toBe("Rain Moon");
    expect(namesForHemisphere(examples, "north")).toEqual(examples);
  });
});

describe("lunarSummaryFor", () => {
  it("prints the moon, its name, the day and the length in village time", () => {
    const s = lunarSummaryFor(new Date("2026-08-16T12:00:00Z"), { anchor: "december_solstice", timezone: "America/Costa_Rica", hemisphere: "north", names: examples })!;
    expect(s.monthIndex).toBe(8);
    expect(s.name).toBe("Sturgeon Moon");
    expect(s.isExampleName).toBe(true);
    expect(s.day).toBe(5);
    expect(s.monthCount).toBe(12);
    expect(s.monthStartsAt.slice(0, 10)).toBe("2026-08-12");
    expect(s.phaseName).toBe("Waxing crescent");
    // Outside the table there is nothing to say.
    expect(lunarSummaryFor(new Date("1999-01-01T00:00:00Z"), { anchor: "december_solstice", timezone: "UTC", hemisphere: "north", names: examples })).toBeNull();
  });
});

const configured = testDbConfigured();

describe.skipIf(!configured)("month names in the table", () => {
  let db: TestDb;
  let pool: mysql.Pool;

  beforeAll(async () => {
    db = await provisionTestDb();
    pool = testPool(db, { connectionLimit: 2 });
  });
  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  it("ships the thirteen examples, takes a village name, and restores the example on blank", async () => {
    const seeded = await listMonthNames(pool);
    expect(seeded).toHaveLength(13);
    expect(seeded.every((n) => n.isExample)).toBe(true);
    expect(seeded[7].name).toBe("Sturgeon Moon");

    expect(await setMonthName(pool, 8, "  Ricing Moon ")).toEqual({ index: 8, name: "Ricing Moon", isExample: false });
    expect((await listMonthNames(pool))[7]).toEqual({ index: 8, name: "Ricing Moon", isExample: false });

    expect(await setMonthName(pool, 8, "")).toEqual({ index: 8, name: "Sturgeon Moon", isExample: true });
    expect(await setMonthName(pool, 14, "x")).toBeNull();
    expect(await setMonthName(pool, 0, "x")).toBeNull();
  });
});
