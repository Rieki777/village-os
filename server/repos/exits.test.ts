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
import { cancelOpenExit, markExitResolved, markExitSettling } from "./exits";

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

  it("resolved: stamps the time and records the agreement pointer", async () => {
    const id = await openExit();
    await markExitResolved(pool, id, "handshake-2026-07");
    const row = await exitById(pool, id);
    expect(row?.status).toBe("resolved");
    expect(row?.resolvedAt).not.toBeNull();
    expect(row?.agreementRef).toBe("handshake-2026-07");
  });

  it("resolved: no pointer given keeps the one the row already holds", async () => {
    const id = await openExit();
    await pool.query("UPDATE exits SET agreement_ref = ? WHERE id = ?", ["kept-ref", id]);
    await markExitResolved(pool, id, null);
    const row = await exitById(pool, id);
    expect(row?.status).toBe("resolved");
    expect(row?.agreementRef).toBe("kept-ref");
  });

  it("cancel: closes an open exit, and a settling one, without a tombstone, and says it did", async () => {
    const open = await openExit();
    expect(await cancelOpenExit(pool, open)).toBe(true);
    const openRow = await exitById(pool, open);
    expect(openRow?.status).toBe("cancelled");
    expect(openRow?.resolvedAt).not.toBeNull();

    const settling = await openExit();
    await markExitSettling(pool, settling, "Swept.");
    expect(await cancelOpenExit(pool, settling)).toBe(true);
    expect((await exitById(pool, settling))?.status).toBe("cancelled");
  });

  it("cancel: refuses a resolved exit, a cancelled one and an id that does not exist, and changes none of them", async () => {
    const resolved = await openExit();
    await markExitResolved(pool, resolved, "done");
    expect(await cancelOpenExit(pool, resolved)).toBe(false);
    expect((await exitById(pool, resolved))?.status).toBe("resolved");

    const cancelled = await openExit();
    expect(await cancelOpenExit(pool, cancelled)).toBe(true);
    expect(await cancelOpenExit(pool, cancelled)).toBe(false);
    expect((await exitById(pool, cancelled))?.status).toBe("cancelled");

    expect(await cancelOpenExit(pool, "exit-that-never-was")).toBe(false);
  });
});
