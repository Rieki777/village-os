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
import { testPool, provisionTestDb, testDbConfigured, type TestDb } from "../db/testDb";
import { anonymizeMember, type ErasureDeps } from "../lib/erasure";
import { clearMemberDrivers } from "../lib/memberDrivers";
import { usersRepo } from "../repos/users";
import { beginErasure, erasureRecord, noteErasureFailed, noteStepDone } from "../repos/memberErasure";
import { cancelExit, createExit, exitById } from "../lib/exit";
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
      remove: async () => {
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
    pool = testPool(db, { connectionLimit: 4 }); // module-review-ok: the suite's own pool onto the scratch schema it provisioned
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

  /*
   * A MEMBER WHO STAYED (round 2, finding 1). Resolving an exit runs the
   * erasure and only then marks the exit resolved, so a sweep that stops
   * before the tombstone leaves the exit open with the admin's "They're
   * staying" button on it. Cancelling used to flip the exit and nothing else.
   * The record stayed open, Finish them restarts every unfinished record from
   * the top, and the next steward to press it, clearing somebody else's stuck
   * sweep, closed the account of a member the village had decided keeps it.
   */
  describe("a departure cancelled after its resolve stopped part way", () => {
    let n = 0;

    /** A living member with an open exit whose resolve stopped before the tombstone. */
    async function resolveStopped(): Promise<{ id: string; exitId: string; before: any }> {
      const id = `queue-stayed-${(n += 1)}`;
      await pool.query("INSERT INTO `users` (`id`, `name`, `email`, `password_hash`) VALUES (?,?,?,'x')", [id, "Ned Okafor", `${id}@examples.invalid`]); // module-review-ok: seeding the scratch schema this suite provisioned
      const opened = await createExit(pool, { userId: id, kind: "voluntary", openedBy: "admin", noticeDays: 0 });
      if (!opened.ok) throw new Error(opened.error);
      const before = await usersRepo(pool).byId(id);
      await expect(anonymizeMember(pool, before, null, deps())).rejects.toThrow(/role holder write was refused/);
      const stopped = await erasureRecord(pool, id);
      expect(stopped!.stepsDone, "the resolve must stop before the close, or this is a different case").not.toContain("tombstone");
      return { id, exitId: opened.exit.id, before };
    }

    const cancel = (exitId: string) => cancelExit(pool, exitId, { memberById: (id) => usersRepo(pool).byId(id), actorId: "admin-1" });

    async function expectStillThemselves(id: string, before: any): Promise<void> {
      const after = await usersRepo(pool).byId(id);
      expect(
        { name: after!.name, email: after!.email, tokenVersion: after!.tokenVersion },
        "a steward's Finish them closed the account of a member who stayed",
      ).toEqual({ name: before.name, email: before.email, tokenVersion: before.tokenVersion });
      expect(await erasureRecord(pool, id), "the deletion the cancel ended is still waiting to be finished").toBeNull();
    }

    it("ends the deletion when the admin cancels, so Finish them leaves the member alone", async () => {
      const { id, exitId, before } = await resolveStopped();

      const out = await cancel(exitId);
      expect(out.status).toBe(200);
      expect((await exitById(pool, exitId))!.status).toBe("cancelled");
      expect(await erasureRecord(pool, id), "the cancel left the deletion armed for the next Finish them").toBeNull();

      breakRoleHolders = false;
      const { body } = await retry();
      await expectStillThemselves(id, before);
      expect(body.local.count).toBe(0);
      // Some of what they held is already gone, and the cancel cannot put it back.
      expect(String(out.body.message)).toMatch(/already removed/);
    });

    it("leaves a deletion an exit cancelled before this fix alone too, the next time Finish them is pressed", async () => {
      const { id, exitId, before } = await resolveStopped();
      // What the cancel route did before: the exit flips and the record stays armed.
      await pool.query("UPDATE `exits` SET `status` = 'cancelled', `resolved_at` = CURRENT_TIMESTAMP WHERE `id` = ?", [exitId]); // module-review-ok: reproducing the old cancel's single write on the scratch schema
      expect((await erasureRecord(pool, id))!.finishedAt).toBeNull();

      breakRoleHolders = false;
      const { body } = await retry();
      await expectStillThemselves(id, before);
      expect(body.stillStuck, "a member who stayed was counted as a deletion still stuck").toBe(0);
      expect(body.stayed).toBe(1);
    });

    it("still finishes a deletion asked for after an exit was cancelled", async () => {
      const { id, exitId } = await resolveStopped();
      await pool.query("UPDATE `exits` SET `status` = 'cancelled', `resolved_at` = CURRENT_TIMESTAMP - INTERVAL 1 HOUR WHERE `id` = ?", [exitId]); // module-review-ok: an exit cancelled an hour before the deletion, on the scratch schema
      await pool.query("UPDATE `member_erasures` SET `last_attempt_at` = CURRENT_TIMESTAMP WHERE `user_id` = ?", [id]); // module-review-ok: the deletion asked for after the cancel, on the scratch schema

      breakRoleHolders = false;
      const { body } = await retry();
      expect(body.swept).toBe(1);
      expect((await usersRepo(pool).byId(id))!.name).toBe("A departed member");
      expect((await erasureRecord(pool, id))!.finishedAt).toBeTruthy();
    });

    /*
     * A CLOSED ACCOUNT CANNOT HAVE STAYED (round 3, finding 17). The resume
     * used to decide "they stayed" from the record's steps alone, and two
     * states from before this release give a record without "tombstone" over
     * an account that is one: a tombstone write that committed with its note
     * lost (`noteStepDone` runs outside the step's try, and a deploy's SIGTERM
     * can land between them), and a second resolve over a closed account,
     * which empties the steps and can then stop early. The old cancel route
     * flipped either exit with no look at the account, and the next Finish
     * them deleted the record and told the steward the member stayed, while
     * every step after the tombstone never ran.
     */
    async function closeByHand(id: string): Promise<void> {
      await usersRepo(pool).update(
        id,
        (u: any) => {
          u.name = "A departed member";
          u.email = `deleted-${id}@anonymized.invalid`;
          u.handle = null;
          u.passwordHash = "";
          u.tokenVersion = (u.tokenVersion ?? 0) + 1;
        },
        { erasure: true },
      );
    }

    async function expectSweptToTheEnd(id: string, body: any): Promise<void> {
      expect(body.stayed, "Finish them counted a closed account as a member who stayed").toBe(0);
      expect(body.swept).toBe(1);
      expect(body.stillStuck).toBe(0);
      const record = await erasureRecord(pool, id);
      expect(record, "Finish them ended the record of an account that is already closed").not.toBeNull();
      expect(record!.finishedAt).toBeTruthy();
      // The steps the abandoned record never ran: the ones after the close.
      expect(record!.stepsDone).toEqual(expect.arrayContaining(["tombstone", "member-agent-after-tombstone", "external-stores"]));
      expect((await usersRepo(pool).byId(id))!.email).toBe(`deleted-${id}@anonymized.invalid`);
    }

    it("finishes the sweep of a closed account whose tombstone note was lost, though its exit was cancelled the old way", async () => {
      const { id, exitId } = await resolveStopped();
      await closeByHand(id);
      expect((await erasureRecord(pool, id))!.stepsDone, "the note must be missing, or this is a different case").not.toContain("tombstone");
      await pool.query("UPDATE `exits` SET `status` = 'cancelled', `resolved_at` = CURRENT_TIMESTAMP WHERE `id` = ?", [exitId]); // module-review-ok: reproducing the old cancel's single write on the scratch schema

      breakRoleHolders = false;
      const { body } = await retry();
      await expectSweptToTheEnd(id, body);
    });

    it("finishes the sweep of a closed account resolved a second time, though its exit was cancelled the old way", async () => {
      const { id, exitId } = await resolveStopped();
      // The first resolve got past the close and stopped later on.
      await closeByHand(id);
      await noteStepDone(pool, id, "tombstone");
      await noteErasureFailed(pool, id, "audit", "refused");
      // The admin resolves again: a fresh sweep empties the steps and stops early.
      await expect(anonymizeMember(pool, await usersRepo(pool).byId(id), null, deps())).rejects.toThrow(/role holder write was refused/);
      expect((await erasureRecord(pool, id))!.stepsDone).not.toContain("tombstone");
      await pool.query("UPDATE `exits` SET `status` = 'cancelled', `resolved_at` = CURRENT_TIMESTAMP WHERE `id` = ?", [exitId]); // module-review-ok: reproducing the old cancel's single write on the scratch schema

      breakRoleHolders = false;
      const { body } = await retry();
      await expectSweptToTheEnd(id, body);
    });

    it("refuses to cancel once the account is closed, and leaves the record for the queue", async () => {
      const { id, exitId } = await resolveStopped();
      breakRoleHolders = false;
      // The sweep finished, and the status write after it never ran.
      await anonymizeMember(pool, await usersRepo(pool).byId(id), null, deps());

      const out = await cancel(exitId);
      expect(out.status).toBe(409);
      expect((await exitById(pool, exitId))!.status).toBe("open");
    });

    it("refuses to cancel while the record says the account was closed, or a deletion is still running", async () => {
      const id = `queue-stayed-${(n += 1)}`;
      await pool.query("INSERT INTO `users` (`id`, `name`, `email`, `password_hash`) VALUES (?,?,?,'x')", [id, "Ned Okafor", `${id}@examples.invalid`]); // module-review-ok: seeding the scratch schema this suite provisioned
      const opened = await createExit(pool, { userId: id, kind: "voluntary", openedBy: "admin", noticeDays: 0 });
      if (!opened.ok) throw new Error(opened.error);

      // Begun moments ago, with no step failed: it may still be going.
      await beginErasure(pool, id);
      const running = await cancel(opened.exit.id);
      expect(running.status).toBe(409);
      expect(String(running.body.error)).toMatch(/right now/);

      // Past the close: whatever the row says, the record cannot be ended here.
      await noteStepDone(pool, id, "tombstone");
      await noteErasureFailed(pool, id, "audit", "refused");
      const closed = await cancel(opened.exit.id);
      expect(closed.status).toBe(409);
      expect((await erasureRecord(pool, id))!.stepsDone).toContain("tombstone");
      expect((await exitById(pool, opened.exit.id))!.status).toBe("open");
    });
  });
});
