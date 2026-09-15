/**
 * GET /api/admin/failures over real HTTP, against a real database, after the
 * real job has read every real area.
 *
 * The lib suite proves the judgement and server/failedActions.test.ts proves
 * the SQL. This proves what a founder meets: the job registered with the
 * scheduler, a run over every area of a migrated schema that finishes with no
 * area unreadable, a payload the tab can render, a refusal that says so, and
 * the rule that the report never names a person, asserted on the whole
 * response.
 */
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import express from "express";
import mysql from "mysql2/promise";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { provisionTestDb, testDbConfigured, type TestDb } from "../db/testDb";
import type { ErasureDeps } from "../lib/erasure";
import { BLIND_SPOTS, FAILED_ACTIONS_JOB, REPORT_SOURCE, defaultSources, runFailedActions } from "../lib/failedActions";
import { registeredJobs } from "../lib/scheduler";
import { reconcileSource } from "../repos/failedActionItems";
import { beginErasure, noteErasureFailed, noteStepDone } from "../repos/memberErasure";
import { usersRepo } from "../repos/users";
import { register } from "./failedActions";

const configured = testDbConfigured();
const MEMBER = "failures-departed-member";

let db: TestDb;
let pool: mysql.Pool;
let uploadsDir = "";
let server: http.Server;
let base = "";
let admin = true;
let brokenDatabase = false;
let notices: unknown[][] = [];

function deps(): ErasureDeps {
  const real = usersRepo(pool);
  return {
    members: { byId: (id: string) => real.byId(id), update: (id: string, fn: any) => real.update(id, fn) },
    submissionsRepo: { all: () => [], replaceAll: async () => undefined },
    roleHoldersRepo: { replaceAll: async () => undefined },
    withRoleHolderLock: (fn) => fn(),
    loadRoleHolders: () => [],
    uploadsDir,
  };
}

const read = async () => {
  const r = await fetch(`${base}/api/admin/failures`);
  return { status: r.status, body: await r.json().catch(() => undefined) };
};

const notifyAdmins = async (...args: unknown[]) => {
  notices.push(args);
};

describe.skipIf(!configured)("the failures report", () => {
  beforeAll(async () => {
    db = await provisionTestDb();
    pool = mysql.createPool({ uri: db.url, timezone: "Z", connectionLimit: 6 }); // module-review-ok: the suite's own pool onto the scratch schema it provisioned
    uploadsDir = fs.mkdtempSync(path.join(os.tmpdir(), "village-failures-route-"));

    const app = express();
    app.use(express.json());
    const failing = { query: async () => Promise.reject(new Error("the database went away")) } as unknown as mysql.Pool;
    register(app, {
      isAdmin: async () => admin,
      getPool: () => (brokenDatabase ? failing : pool),
      notifyAdmins,
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
  });

  beforeEach(async () => {
    admin = true;
    brokenDatabase = false;
    notices = [];
    await pool.query("DELETE FROM `failed_action_items`"); // module-review-ok: resetting the scratch schema this suite provisioned, between cases
    await pool.query("DELETE FROM `member_erasures`"); // module-review-ok: resetting the scratch schema this suite provisioned, between cases
    await pool.query( // module-review-ok: seeding the scratch schema this suite provisioned
      "INSERT INTO `users` (`id`, `name`, `email`, `password_hash`) VALUES (?,?,?,'x') " +
        "ON DUPLICATE KEY UPDATE `name` = VALUES(`name`)",
      [MEMBER, "Wren Halloway", `${MEMBER}@examples.invalid`],
    );
  });

  it("registers its job with the scheduler, to run every hour", () => {
    expect(registeredJobs().find((j) => j.name === FAILED_ACTIONS_JOB)).toEqual({ name: FAILED_ACTIONS_JOB, everyMs: 60 * 60 * 1000 });
  });

  it("reads every area of a real schema, renders what it found, and names nobody", async () => {
    // A deletion that stopped before the account closed: the one finding this
    // otherwise empty village has, and the one that concerns a person.
    await beginErasure(pool, MEMBER);
    await noteStepDone(pool, MEMBER, "role-holdings");
    await noteErasureFailed(pool, MEMBER, "org-seatings", "the seating write was refused");

    const sources = defaultSources(pool);
    const summary = await runFailedActions({ pool, sources, retries: [], notifyAdmins, isFirstRun: async () => false });
    expect(summary).toMatch(new RegExp(`^${sources.length} areas read, 1 thing failing`));

    const { status, body } = await read();
    expect(status).toBe(200);
    // Every area was readable, so this report has no trouble of its own.
    expect(body.open.filter((i: any) => i.source === REPORT_SOURCE)).toEqual([]);
    expect(body.open).toEqual([
      expect.objectContaining({
        area: "Account deletions",
        source: "erasures",
        key: "before-close",
        title: "1 account deletion stopped before the account was closed",
        lastError: "stopped at org-seatings (1)",
      }),
    ]);
    expect(body.blindSpots).toEqual([...BLIND_SPOTS]);
    expect(body.job).toEqual({ everyMinutes: 60, schedulerEnabled: expect.any(Boolean), lastRunSecondsAgo: null, lastResult: null });
    expect(notices).toHaveLength(1);
    // The rule the report is built around, asserted on the whole payload and
    // on the notice, which is the other thing it writes.
    for (const text of [JSON.stringify(body), JSON.stringify(notices)]) {
      expect(text).not.toContain(MEMBER);
      expect(text).not.toContain("Wren");
    }
  });

  it("moves a failure that stopped to the recently cleared list", async () => {
    await beginErasure(pool, MEMBER);
    await noteErasureFailed(pool, MEMBER, "org-seatings", "refused");
    const run = () => runFailedActions({ pool, sources: defaultSources(pool), retries: [], notifyAdmins, isFirstRun: async () => false });
    await run();
    await pool.query("DELETE FROM `member_erasures`"); // module-review-ok: the scratch schema's stalled sweep, finished by hand for this case

    await run();
    const { body } = await read();
    expect(body.open).toEqual([]);
    expect(body.resolved).toEqual([expect.objectContaining({ key: "before-close", resolvedSecondsAgo: expect.any(Number) })]);
  });

  it("lists this report's own trouble first, then each area in the order the job reads it", async () => {
    // Alphabetical by source key would read erasure-stores, erasures, payments,
    // report, seat-fees, which is the order the repo returns.
    await reconcileSource(pool, "seat-fees", [{ key: "sc-1", title: "A seat fee", advice: "a" }]);
    await reconcileSource(pool, "payments", [{ key: "stays:ord-1", title: "A payment", advice: "a" }]);
    await reconcileSource(pool, "erasure-stores", [{ key: "waiting", title: "Waiting", advice: "a" }]);
    await reconcileSource(pool, "erasures", [{ key: "before-close", title: "Stopped", advice: "a" }]);
    await reconcileSource(pool, "report", [{ key: "payments", title: "Could not read", advice: "a" }]);

    const { body } = await read();

    expect(body.open.map((i: any) => i.area)).toEqual([
      "This report",
      "Account deletions",
      "Deletions waiting on outside services",
      "Payments",
      "Seat fees",
    ]);
  });

  it("refuses a caller who is not an admin, and shows them nothing", async () => {
    await beginErasure(pool, MEMBER);
    await runFailedActions({ pool, sources: defaultSources(pool), retries: [], notifyAdmins, isFirstRun: async () => false });
    admin = false;

    const { status, body } = await read();

    expect(status).toBe(401);
    expect(body).toEqual({ error: "auth_required", message: "Sign in as an admin to read this report." });
  });

  it("says the report could not be read, and never answers with an empty one", async () => {
    brokenDatabase = true;

    const { status, body } = await read();

    expect(status).toBe(500);
    expect(body).toMatchObject({ error: "failures_unavailable", message: "The report could not be read." });
    expect(body).not.toHaveProperty("open");
  });
});
