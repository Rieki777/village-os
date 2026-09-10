/**
 * The door a steward presses to finish an erasure that stopped part way.
 *
 * ── WHY A ROUTE TEST AND NOT ONLY THE LIB TEST ───────────────────────────
 *
 * `server/lib/erasure.test.ts` proves that a resume works when it is CALLED.
 * Nothing calls it on its own: the members concerned have already left, so
 * nothing in this system will ever erase them a second time, and the only
 * thing that can finish one of these is a person pressing this button. A
 * resumable sweep whose only caller is a test is not resumable in production,
 * so the button is exercised here, over real HTTP, against a real database.
 *
 * ── THE OTHER PROPERTY THIS FILE GUARDS ──────────────────────────────────
 *
 * The queue may never name a person. It says the village owes somebody
 * something, how old the debt is and which STEP is holding it, and not who.
 * That rule was written for the vendor queue and it now has to survive a
 * second queue in the same payload, so the whole response body is asserted
 * against the member id rather than a field being checked.
 */
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import express from "express";
import mysql from "mysql2/promise";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { provisionTestDb, testDbConfigured, type TestDb } from "../db/testDb";
import { anonymizeMember, type ErasureDeps } from "../lib/erasure";
import { clearMemberDrivers } from "../lib/memberDrivers";
import { usersRepo } from "../repos/users";
import { erasureRecord } from "../repos/memberErasure";
import { register } from "./erasureQueue";

const configured = testDbConfigured();
const MEMBER = "queue-stalled-member";

let db: TestDb;
let pool: mysql.Pool;
let uploadsDir = "";
let server: http.Server;
let base = "";
let mayModerate = true;
let breakRoleHolders = true;

function deps(): ErasureDeps {
  const real = usersRepo(pool);
  return {
    members: { byId: (id: string) => real.byId(id), update: (id: string, fn: any) => real.update(id, fn) },
    submissionsRepo: { all: () => [], replaceAll: async () => undefined },
    roleHoldersRepo: {
      replaceAll: async () => {
        if (breakRoleHolders) throw new Error("the role holder write was refused");
      },
    },
    withRoleHolderLock: (fn) => fn(),
    loadRoleHolders: () => [],
    uploadsDir,
  };
}

const get = async () => {
  const r = await fetch(`${base}/api/review/erasure`);
  return { status: r.status, body: await r.json().catch(() => undefined) };
};
const retry = async () => {
  const r = await fetch(`${base}/api/review/erasure/retry`, { method: "POST" });
  return { status: r.status, body: await r.json().catch(() => undefined) };
};

describe.skipIf(!configured)("the erasure queue", () => {
  beforeAll(async () => {
    db = await provisionTestDb();
    pool = mysql.createPool({ uri: db.url, timezone: "Z", connectionLimit: 4 }); // module-review-ok: the suite's own pool onto the scratch schema it provisioned
    uploadsDir = fs.mkdtempSync(path.join(os.tmpdir(), "village-erasure-queue-"));

    const app = express();
    app.use(express.json());
    register(app, {
      guardCapability: (async (_req: any, res: any) => {
        if (mayModerate) return true;
        res.status(403).json({ error: "capability_required" });
        return false;
      }) as any,
      getPool: () => pool,
      erasureDeps: deps(),
    });
    server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const addr = server.address();
    if (!addr || typeof addr === "string") throw new Error("the test server did not report a port");
    base = `http://127.0.0.1:${addr.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    await pool?.end();
    await db?.drop?.();
    fs.rmSync(uploadsDir, { recursive: true, force: true });
    clearMemberDrivers();
  });

  beforeEach(async () => {
    clearMemberDrivers();
    mayModerate = true;
    breakRoleHolders = true;
    await pool.query("DELETE FROM `member_erasures`"); // module-review-ok: resetting the scratch schema this suite provisioned, between cases
    await pool.query( // module-review-ok: seeding the scratch schema this suite provisioned
      "INSERT INTO `users` (`id`, `name`, `email`, `password_hash`) VALUES (?,?,?,'x') " +
        "ON DUPLICATE KEY UPDATE `name` = VALUES(`name`), `password_hash` = 'x'",
      [MEMBER, "Wren Halloway", `${MEMBER}@examples.invalid`],
    );
  });

  /** Leave one half-erased member behind, the way a dropped connection would. */
  async function stall(): Promise<void> {
    const target = await usersRepo(pool).byId(MEMBER);
    await expect(anonymizeMember(pool, target, null, deps())).rejects.toThrow();
  }

  it("reports the stalled sweep, where it stopped, and nobody's name", async () => {
    await stall();

    const { status, body } = await get();

    expect(status).toBe(200);
    expect(body.local.count).toBe(1);
    expect(body.local.stoppedAt).toEqual({ "role-holdings": 1 });
    expect(body.local.oldestSince).toBeTruthy();
    // The rule the whole route is built around, asserted on the whole payload.
    expect(JSON.stringify(body)).not.toContain(MEMBER);
    expect(JSON.stringify(body)).not.toContain("Wren");
  });

  it("keeps answering the vendor queue's own shape, so its reader still works", async () => {
    const { body } = await get();
    // The client reads count, oldestSince and waitingOn from the top level.
    // Adding a second queue beside them may not move them.
    expect(body).toHaveProperty("waitingOn");
    expect(body).toHaveProperty("oldestSince");
    expect(typeof body.count).toBe("number");
  });

  it("finishes the sweep when somebody presses it, and the queue empties", async () => {
    await stall();
    breakRoleHolders = false;

    const { status, body } = await retry();

    expect(status).toBe(200);
    expect(body.resumed).toBe(1);
    expect(body.swept).toBe(1);
    expect(body.stillStuck).toBe(0);
    expect(body.local.count).toBe(0);
    expect((await erasureRecord(pool, MEMBER))!.finishedAt).toBeTruthy();
    // The tombstone is late in the sweep, so this is the proof the resume ran
    // the steps that had never run rather than only clearing a row.
    expect((await usersRepo(pool).byId(MEMBER))!.name).toBe("A departed member");
  });

  it("counts a member it still could not finish, and leaves them outstanding", async () => {
    await stall();

    const { body } = await retry();

    expect(body.resumed).toBe(1);
    expect(body.swept).toBe(0);
    expect(body.stillStuck).toBe(1);
    // Still owed. A retry that reported success on a failure would clear the
    // one row saying somebody is owed something.
    expect(body.local.count).toBe(1);
    expect((await erasureRecord(pool, MEMBER))!.failedStep).toBe("role-holdings");
  });

  it("refuses a caller without the key, and says nothing about anybody", async () => {
    await stall();
    mayModerate = false;

    const read = await get();
    const press = await retry();

    expect(read.status).toBe(403);
    expect(press.status).toBe(403);
    expect(JSON.stringify(read.body)).not.toContain("role-holdings");
    // And the refusal changed nothing: the member is still owed a finish.
    expect((await erasureRecord(pool, MEMBER))!.finishedAt).toBeNull();
  });
});
