/**
 * The meter, against a real schema.
 *
 * The properties worth a database are the ones a pure test cannot reach: that
 * the count SATURATES at one per member per module per cycle however hard a
 * module is hammered, that the seal leaves no member identity behind at all,
 * and that the reach fraction divides by the members who actually showed up.
 *
 * The saturation test is the important one. It is the whole anti-gaming
 * argument: if the two hundredth request of a cycle can move the number, then
 * a module that refreshes itself out-earns a module a village trusts, and the
 * pool pays for noise.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import mysql from "mysql2/promise";
import {
  cyclesAwaitingSeal,
  markUse,
  openCycleUsage,
  sealCycle,
  sealedCycleUsage,
} from "./repos/moduleUsage";
import { reachWeights } from "./lib/moduleUsage";
import { testPool, provisionTestDb, testDbConfigured, type TestDb } from "./db/testDb";

const configured = testDbConfigured();
const CYCLE = "lunar-000900";
const OTHER = "lunar-000901";

let db: TestDb;
let pool: mysql.Pool;

describe.skipIf(!configured)("the module meter", () => {
  beforeAll(async () => {
    db = await provisionTestDb();
    pool = testPool(db, { connectionLimit: 10 }); // module-review-ok: the suite's own connection to a throwaway scratch schema, as every DB suite does
  });

  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  it("counts a member once however many times they open a module", async () => {
    const cycle = "lunar-000910";
    for (let i = 0; i < 200; i += 1) await markUse(pool, cycle, "library", "member-a");
    const usage = await openCycleUsage(pool, cycle);
    expect(usage.modules).toEqual([
      { moduleId: "library", membersReached: 1, activeMembers: 1 },
    ]);
  });

  it("counts more people, which is the only thing that moves the number", async () => {
    const cycle = "lunar-000911";
    for (const who of ["a", "b", "c"]) await markUse(pool, cycle, "library", who);
    // One of them hammers it. The number does not move.
    for (let i = 0; i < 50; i += 1) await markUse(pool, cycle, "library", "a");
    const usage = await openCycleUsage(pool, cycle);
    expect(usage.modules[0]!.membersReached).toBe(3);
  });

  it("divides by the members who showed up, so a small village is legible", async () => {
    const cycle = "lunar-000912";
    // Four members are active this cycle; three of them opened the library.
    for (const who of ["a", "b", "c"]) await markUse(pool, cycle, "library", who);
    await markUse(pool, cycle, "map", "d");
    const usage = await openCycleUsage(pool, cycle);
    expect(usage.activeMembers).toBe(4);
    const weights = reachWeights(usage);
    expect(weights.get("library")).toBe(0.75);
    expect(weights.get("map")).toBe(0.25);
  });

  it("keeps a village's contribution to any module at or below one", async () => {
    const cycle = "lunar-000913";
    for (const who of ["a", "b", "c"]) await markUse(pool, cycle, "library", who);
    const weights = reachWeights(await openCycleUsage(pool, cycle));
    // Everybody active opened it, which is the ceiling. A village that invents
    // members inflates the denominator exactly as fast as the numerator.
    expect(weights.get("library")).toBe(1);
  });

  it("keeps cycles apart", async () => {
    await markUse(pool, CYCLE, "library", "member-x");
    await markUse(pool, OTHER, "library", "member-x");
    expect((await openCycleUsage(pool, CYCLE)).activeMembers).toBe(1);
    expect((await openCycleUsage(pool, OTHER)).activeMembers).toBe(1);
  });

  it("seals a closed cycle and forgets every member in it", async () => {
    const cycle = "lunar-000920";
    for (const who of ["a", "b", "c"]) await markUse(pool, cycle, "library", who);
    await markUse(pool, cycle, "map", "a");

    const dropped = await sealCycle(pool, cycle);
    expect(dropped).toBe(4);

    const sealed = await sealedCycleUsage(pool, cycle);
    expect(sealed.sealed).toBe(true);
    expect(sealed.activeMembers).toBe(3);
    expect(sealed.modules.find((m) => m.moduleId === "library")!.membersReached).toBe(3);
    expect(sealed.modules.find((m) => m.moduleId === "map")!.membersReached).toBe(1);

    // THE PRIVACY PROPERTY. Not "the aggregate is right", which the lines above
    // already said, but that the database can no longer answer "which modules
    // did this member open". No row anywhere names anybody.
    const [marks]: any = await pool.query( // module-review-ok: the privacy assertion has to read the table directly; asking the repo would be asking the code under test whether it forgot
      "SELECT COUNT(*) AS n FROM module_usage_marks WHERE cycle_id = ?",
      [cycle],
    );
    expect(Number(marks[0].n)).toBe(0);
    const [cols]: any = await pool.query( // module-review-ok: reads information_schema for the shape of the table, which no repo exposes and none should
      "SELECT COLUMN_NAME AS c FROM information_schema.COLUMNS " +
        "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'module_usage_cycles'",
    );
    const names = cols.map((r: any) => String(r.c));
    expect(names).not.toContain("user_id");
    expect(names.some((n: string) => /user|member_id|actor/.test(n))).toBe(false);
  });

  it("is idempotent, so a retried seal does not double count", async () => {
    const cycle = "lunar-000921";
    for (const who of ["a", "b"]) await markUse(pool, cycle, "library", who);
    await sealCycle(pool, cycle);
    await sealCycle(pool, cycle);
    const sealed = await sealedCycleUsage(pool, cycle);
    expect(sealed.modules.find((m) => m.moduleId === "library")!.membersReached).toBe(2);
    expect(sealed.activeMembers).toBe(2);
  });

  it("never lets a second seal lower a count it already recorded", async () => {
    /*
     * The dangerous case, and the reason the upsert takes GREATEST. A mark
     * landing between two seals means the second pass sees only that one mark.
     * A replacing upsert would overwrite forty with one, and the first pass has
     * already deleted the marks behind its forty, so the true number would be
     * gone for good. The marks are the only copy.
     */
    const cycle = "lunar-000922";
    for (const who of ["a", "b", "c", "d"]) await markUse(pool, cycle, "library", who);
    await sealCycle(pool, cycle);
    expect((await sealedCycleUsage(pool, cycle)).modules[0]!.membersReached).toBe(4);

    // One straggler arrives after the seal, and the seal runs again.
    await markUse(pool, cycle, "library", "e");
    await sealCycle(pool, cycle);

    const sealed = await sealedCycleUsage(pool, cycle);
    expect(sealed.modules.find((m) => m.moduleId === "library")!.membersReached).toBe(4);
    expect(sealed.activeMembers).toBe(4);
  });

  it("gives every module in a cycle the same denominator, whatever a re-seal saw", async () => {
    /*
     * THE DENOMINATOR IS THE CYCLE'S, NEVER THE PASS'S, and until this was
     * pinned a re-seal could hand one module a denominator of its own.
     *
     * Seal one counts four active members and writes the library's row against
     * four, then deletes the marks, which are the only copy. A straggler then
     * opens a module nothing had recorded yet. Seal two counts the marks it can
     * see, which is one, and `GREATEST` cannot defend the NEW row because there
     * is nothing there to be greater than: the new module lands with a
     * denominator of one.
     *
     * That is a reach of 1.0 for a module one person in four opened, which is
     * four times what it earned, and the clamp cannot catch it because the
     * number is inside its range. Worse, which denominator the cycle reported
     * depended on which row the database handed back first.
     */
    const cycle = "lunar-000924";
    for (const who of ["a", "b", "c", "d"]) await markUse(pool, cycle, "library", who);
    await sealCycle(pool, cycle);

    // A module that sorts BEFORE the sealed one, so a reader taking the first
    // row would take this one. The ordering is the trap and not the defect.
    await markUse(pool, cycle, "events", "e");
    await sealCycle(pool, cycle);

    const sealed = await sealedCycleUsage(pool, cycle);
    expect(sealed.activeMembers).toBe(4);
    for (const m of sealed.modules) expect(m.activeMembers).toBe(4);
    const weights = reachWeights(sealed);
    expect(weights.get("library")).toBe(1);
    expect(weights.get("events")).toBe(0.25);
  });

  it("holds reach at one even when the counts disagree", async () => {
    // reachWeights clamps, because the cap at one village one vote is the
    // anti-inflation argument and it must be a rule instead of a habit.
    const weights = reachWeights({
      cycleId: "lunar-000923",
      activeMembers: 2,
      sealed: true,
      sealedAt: "2026-08-29T00:00:00.000Z",
      modules: [{ moduleId: "library", membersReached: 5, activeMembers: 2 }],
    });
    expect(weights.get("library")).toBe(1);
  });

  it("finds the cycles a rollup still owes, and leaves the open one alone", async () => {
    const cycle = "lunar-000930";
    const open = "lunar-000931";
    await markUse(pool, cycle, "library", "a");
    await markUse(pool, open, "library", "a");
    const due = await cyclesAwaitingSeal(pool, open);
    expect(due).toContain(cycle);
    expect(due).not.toContain(open);
  });

  it("reports nothing for a cycle nobody used", async () => {
    const usage = await openCycleUsage(pool, "lunar-000999");
    expect(usage.activeMembers).toBe(0);
    expect(usage.modules).toEqual([]);
    expect(reachWeights(usage).size).toBe(0);
    // A seal of an empty cycle writes no row, so an unused cycle never appears
    // in the record at all.
    expect(await sealCycle(pool, "lunar-000999")).toBe(0);
    expect((await sealedCycleUsage(pool, "lunar-000999")).sealed).toBe(false);
  });
});
