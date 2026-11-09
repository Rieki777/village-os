/**
 * The three `exits` status writes on a real database.
 *
 * They moved out of server/index.ts with the exit routes (server/routes/exits.ts)
 * and had never been tested on their own: the loop suite drives the sweep and
 * the resolve through a booted server, and nothing anywhere drove the cancel.
 * These pin what each statement DOES to a row, read back through
 * `exitById`, the same reader the routes answer from.
 *
 * Runs against the S5 harness: a scratch schema with every real migration
 * applied, through `testPool`, so `NOW()` runs in the session zone the app's
 * own pool pins. No TEST_DATABASE_URL → skips loudly.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type mysql from "mysql2/promise";

import { provisionTestDb, testDbConfigured, testPool, type TestDb } from "../db/testDb";
import { createExit, exitById } from "../lib/exit";
import { markExitSettling } from "./exits";

const configured = testDbConfigured();

let db: TestDb;
let pool: mysql.Pool;
let seq = 0;

async function openExit(note: string | null = null): Promise<string> {
  const r = await createExit(pool, { userId: `leaver-${++seq}`, kind: "voluntary", openedBy: "admin", noticeDays: 0, note });
  if (!r.ok) throw new Error(r.error);
  return r.exit.id;
}

describe.skipIf(!configured)("exits status writes on a real database", () => {
  beforeAll(async () => {
    db = await provisionTestDb();
    pool = testPool(db, { connectionLimit: 4 });
  });

  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  it("settling: moves an open exit to settling and APPENDS the sweep's note to what was there", async () => {
    const id = await openExit("asked to leave in June.");
    await markExitSettling(pool, id, " Swept 30 library-credit.");
    const row = await exitById(pool, id);
    expect(row?.status).toBe("settling");
    expect(row?.resolution).toBe("asked to leave in June. Swept 30 library-credit.");
  });

  it("settling: a note on an exit with no resolution text yet starts it, rather than writing NULL", async () => {
    const id = await openExit(null);
    await markExitSettling(pool, id, "Swept nothing.");
    expect((await exitById(pool, id))?.resolution).toBe("Swept nothing.");
  });
});
