/**
 * A SETTLED CYCLE RECORDS THE CLOCK IT WAS PLAYED ON (migration 0169).
 *
 * Against a real scratch schema, because the whole point of the column is
 * that it survives a write and a re-read, and because a migration that was
 * only read is a migration nobody ran. If this file fails to find the column,
 * the migration did not land, whatever the file says.
 *
 * Three properties, and the third is the one the rhythm setting rests on:
 *
 *  1. The column exists and defaults to `lunar`, so every row written before
 *     the rhythm became a setting reads as the only clock a village has ever
 *     run.
 *  2. A row written by a release that predates the column still inserts, so
 *     rolling back to it keeps working. That is what the DEFAULT buys, and it
 *     only holds because `gratitude_cycles` is written by a hand-written
 *     INSERT rather than through `dbCollection`, which names every spec'd
 *     column and sends an explicit NULL for anything left out.
 *  3. Closing a cycle again after a village changed its rhythm does not
 *     rewrite the clock it was played on. `clock` is deliberately absent from
 *     the ON DUPLICATE KEY UPDATE list, and this is where that shows.
 */
import mysql from "mysql2/promise";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { provisionTestDb, testDbConfigured, type TestDb } from "../db/testDb";
import { gratitudeCyclesRepo } from "./gratitude";

const configured = testDbConfigured();

describe.skipIf(!configured)("gratitude_cycles records its clock", () => {
  let db: TestDb;
  let pool: mysql.Pool;

  beforeAll(async () => {
    db = await provisionTestDb();
    pool = mysql.createPool({ uri: db.url, timezone: "Z", connectionLimit: 4 });
  });

  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  beforeEach(async () => {
    await pool.query("DELETE FROM gratitude_cycles");
  });

  it("has the column 0169 adds, defaulting to the only clock any village has run", async () => {
    const [cols] = await pool.query<any[]>("SHOW COLUMNS FROM gratitude_cycles LIKE 'clock'");
    expect(cols.length, "migration 0169 has not run against this database").toBe(1);
    expect(String(cols[0].Null)).toBe("NO");
    expect(String(cols[0].Default)).toBe("lunar");
  });

  it("round-trips both clocks through the repo", async () => {
    const repo = gratitudeCyclesRepo(pool);
    await repo.upsert({
      id: "lunar-000330", cycleNumber: 330,
      startsAt: "2026-08-12T00:00:00.000Z", endsAt: "2026-09-11T00:00:00.000Z",
      status: "closed", closedAt: "2026-09-11T01:00:00.000Z", clock: "lunar",
    });
    await repo.upsert({
      id: "month-2026-10", cycleNumber: 1_000_681,
      startsAt: "2026-10-01T00:00:00.000Z", endsAt: "2026-11-01T00:00:00.000Z",
      status: "open", clock: "calendar",
    });
    const byId = new Map((await repo.all()).map((c) => [c.id, c]));
    expect(byId.get("lunar-000330")?.clock).toBe("lunar");
    expect(byId.get("month-2026-10")?.clock).toBe("calendar");
  });

  it("reads a row written without the column as lunar", async () => {
    // Exactly what the release before 0169 sent: the six columns it knew.
    await pool.query(
      "INSERT INTO gratitude_cycles (id, cycle_number, starts_at, ends_at, status, closed_at) VALUES (?,?,?,?,?,?)",
      ["lunar-000329", 329, "2026-07-14 19:01:00", "2026-08-12 00:00:00", "closed", "2026-08-12 02:00:00"],
    );
    const rows = await gratitudeCyclesRepo(pool).all();
    expect(rows).toHaveLength(1);
    expect(rows[0].clock).toBe("lunar");
  });

  it("never rewrites the clock a closed cycle was played on", async () => {
    const repo = gratitudeCyclesRepo(pool);
    const row = {
      id: "lunar-000331", cycleNumber: 331,
      startsAt: "2026-09-11T00:00:00.000Z", endsAt: "2026-10-10T00:00:00.000Z",
      status: "open" as const, clock: "lunar" as const,
    };
    await repo.upsert(row);
    // The village votes for calendar months, and something closes this cycle
    // afterwards with the new clock in hand. History does not move.
    await repo.upsert({ ...row, status: "closed", closedAt: "2026-10-10T01:00:00.000Z", clock: "calendar" });
    const [got] = await repo.all();
    expect(got.status).toBe("closed");
    expect(got.clock).toBe("lunar");
  });
});
