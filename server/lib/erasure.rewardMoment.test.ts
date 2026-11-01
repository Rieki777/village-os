/**
 * AN ERASED MEMBER'S REWARD MOMENT MARKERS GO.
 *
 * `reward_moment_seen` (0294) holds a row per arrival a member was shown, and
 * a baseline row for when they first looked: when they opened the app, and
 * which of their payments they saw. That is personal data about them, and it
 * outlived their erasure. It is not a debt, so the reasoning that keeps
 * `cash_owed` through an erasure (Rye, 2026-10-31) does not reach it.
 *
 * `reward-moments-after-tombstone` deletes every row keyed on the member, and
 * a neighbour's rows are never touched.
 *
 * Runs against a scratch schema with every real migration applied. No
 * TEST_DATABASE_URL and the suite skips (harness rule).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import mysql from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { provisionTestDb, testDbConfigured, testPool, type TestDb } from "../db/testDb";
import { anonymizeMember, type ErasureDeps } from "./erasure";
import { clearMemberDrivers } from "./memberDrivers";
import { usersRepo } from "../repos/users";
import { erasureRecord } from "../repos/memberErasure";

const configured = testDbConfigured();
const STEP = "reward-moments-after-tombstone";

let db: TestDb;
let pool: mysql.Pool;
let uploadsDir = "";

function deps(): ErasureDeps {
  const real = usersRepo(pool);
  return {
    members: { byId: (id: string) => real.byId(id), update: (id: string, fn: (u: any) => void, opts?: { erasure?: boolean }) => real.update(id, fn, opts) },
    submissionsRepo: { all: () => [], replaceAll: async () => undefined },
    roleHoldersRepo: { remove: async () => undefined },
    withRoleHolderLock: (fn: () => Promise<any>) => fn(),
    loadRoleHolders: () => [],
    uploadsDir,
  } as ErasureDeps;
}

async function member(id: string, name: string): Promise<any> {
  await usersRepo(pool).add({ id, name, email: `${id}@example.test`, passwordHash: "x", paths: [], role: "member" } as any);
  return usersRepo(pool).byId(id);
}

async function seen(userId: string, keys: string[]): Promise<void> {
  for (const key of keys) {
    await pool.query("INSERT INTO `reward_moment_seen` (`user_id`, `arrival_key`) VALUES (?, ?)", [userId, key]); // module-review-ok: seeding the scratch schema this suite provisioned
  }
}

async function rowsOf(userId: string): Promise<string[]> {
  const [rows] = await pool.query<any[]>("SELECT `arrival_key` FROM `reward_moment_seen` WHERE `user_id` = ? ORDER BY `arrival_key`", [userId]); // module-review-ok: reading back the scratch schema this suite provisioned, which is the assertion
  return rows.map((r) => String(r.arrival_key));
}

describe.skipIf(!configured)("an erased member's reward moment markers", () => {
  beforeAll(async () => {
    db = await provisionTestDb();
    pool = testPool(db, { connectionLimit: 6 }); // module-review-ok: the suite's own pool onto the scratch schema it provisioned
    uploadsDir = fs.mkdtempSync(path.join(os.tmpdir(), "village-erasure-reward-"));
    clearMemberDrivers();
  });

  afterAll(async () => {
    await pool?.end();
    await db?.drop?.();
    if (uploadsDir) fs.rmSync(uploadsDir, { recursive: true, force: true });
    clearMemberDrivers();
  });

  it("are deleted, and a neighbour's stay", async () => {
    const wren = await member("rm-er-wren", "Wren Halloway");
    const ash = await member("rm-er-ash", "Ash Moreno");
    await seen(wren.id, ["baseline", "ledger:11", "cash:c-1"]);
    await seen(ash.id, ["baseline", "ledger:12"]);

    await anonymizeMember(pool, wren, "admin-1", deps());
    expect((await erasureRecord(pool, wren.id))?.stepsDone).toContain(STEP);

    expect(await rowsOf(wren.id)).toEqual([]);
    expect(await rowsOf(ash.id)).toEqual(["baseline", "ledger:12"]);
  });

  it("a second run finds nothing and changes nothing", async () => {
    const bo = await member("rm-er-bo", "Bo Marsh");
    await seen(bo.id, ["baseline"]);
    await anonymizeMember(pool, bo, "admin-1", deps());
    await anonymizeMember(pool, await usersRepo(pool).byId(bo.id), "admin-1", deps());
    expect(await rowsOf(bo.id)).toEqual([]);
  });
});
