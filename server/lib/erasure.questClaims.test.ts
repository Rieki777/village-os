/**
 * AN ERASED MEMBER'S OPEN QUEST CLAIMS ARE RELEASED (Rye, 2026-10-31, item 9).
 *
 * The sweep kept every quest claim, open ones included. Nobody can work an
 * open claim of a tombstone's: the account cannot sign in, and consent refuses
 * to pay it. Kept, it counted as somebody working the quest on the board, sat
 * in the steward's queue, and held the quest against its own delete.
 *
 * `quest-claims-after-tombstone` deletes a `claimed` row, declines a
 * `submitted` one, and leaves consented and declined history as it was. A
 * neighbour's open claim is never touched, and another member can take the
 * quest afterwards.
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
import { claimsRepo, questsRepo, type ClaimRecord } from "../repos/quests";

const configured = testDbConfigured();
const STEP = "quest-claims-after-tombstone";

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

async function quest(id: string, title: string): Promise<void> {
  await questsRepo(pool).add({ id, title, status: "Open" } as any);
}

function claim(id: string, questId: string, userId: string, status: ClaimRecord["status"]): ClaimRecord {
  return {
    id, questId, questTitle: questId, userId, userName: userId, status,
    claimedAt: "2026-10-01T09:00:00.000Z",
    artifactUrl: status === "claimed" ? "" : "https://example.test/work",
    note: status === "claimed" ? "" : "Done, see the link",
    submittedAt: status === "claimed" ? null : "2026-10-02T09:00:00.000Z",
    resolvedAt: status === "consented" || status === "declined" ? "2026-10-03T09:00:00.000Z" : null,
  };
}

describe.skipIf(!configured)("an erased member's open quest claims", () => {
  beforeAll(async () => {
    db = await provisionTestDb();
    pool = testPool(db, { connectionLimit: 6 }); // module-review-ok: the suite's own pool onto the scratch schema it provisioned
    uploadsDir = fs.mkdtempSync(path.join(os.tmpdir(), "village-erasure-claims-"));
    clearMemberDrivers();
  });

  afterAll(async () => {
    await pool?.end();
    await db?.drop?.();
    if (uploadsDir) fs.rmSync(uploadsDir, { recursive: true, force: true });
    clearMemberDrivers();
  });

  it("are released so each quest reopens, and consented history stays", async () => {
    const wren = await member("qc-wren", "Wren Halloway");
    const ash = await member("qc-ash", "Ash Moreno");
    const bo = await member("qc-bo", "Bo Marsh");
    await quest("q-qc-picked", "Mend the oven");
    await quest("q-qc-handed", "Paint the gate");
    await quest("q-qc-done", "Plant the beds");
    await quest("q-qc-shared", "Sweep the hall");
    const claims = claimsRepo(pool);
    await claims.add(claim("c-qc-picked", "q-qc-picked", wren.id, "claimed"));
    await claims.add(claim("c-qc-handed", "q-qc-handed", wren.id, "submitted"));
    await claims.add(claim("c-qc-done", "q-qc-done", wren.id, "consented"));
    await claims.add(claim("c-qc-old", "q-qc-shared", wren.id, "declined"));
    await claims.add(claim("c-qc-ash", "q-qc-shared", ash.id, "claimed"));
    const doneBefore = await claims.byId("c-qc-done");
    const oldBefore = await claims.byId("c-qc-old");

    // The control: an open claim holds the quest against its delete.
    expect(await questsRepo(pool).remove("q-qc-picked"), "the control: a claim in flight blocks the delete").toEqual({
      ok: false, reason: "in_flight", count: 1,
    });

    await anonymizeMember(pool, wren, "admin-1", deps());
    expect((await erasureRecord(pool, wren.id))?.stepsDone).toContain(STEP);

    // Picked up and never worked: gone, as a member putting it back leaves it.
    expect(await claims.byId("c-qc-picked")).toBeNull();
    // Handed in: declined, the row and the work kept.
    const handed = await claims.byId("c-qc-handed");
    expect(handed).toMatchObject({ status: "declined", artifactUrl: "https://example.test/work" });
    expect(handed!.resolvedAt).not.toBeNull();
    // History stays exactly as it was (the sweep's own name step aside).
    expect({ ...(await claims.byId("c-qc-done")), userName: "" }).toEqual({ ...doneBefore, userName: "" });
    expect({ ...(await claims.byId("c-qc-old")), userName: "" }).toEqual({ ...oldBefore, userName: "" });
    // A neighbour's open claim on a quest the leaver had is theirs still.
    expect((await claims.byId("c-qc-ash"))!.status).toBe("claimed");

    // Nothing open is left in the leaver's name, so the board counts nobody working.
    const open = (await claims.forUser(wren.id)).filter((c) => c.status === "claimed" || c.status === "submitted");
    expect(open).toEqual([]);
    const counts = await claims.fieldCounts();
    expect(counts.get("q-qc-picked")?.active ?? 0).toBe(0);
    expect(counts.get("q-qc-handed")?.active ?? 0).toBe(0);

    // Another member can claim each quest the leaver held open.
    for (const q of ["q-qc-picked", "q-qc-handed"]) {
      const taken = await claims.openClaim(claim(`c-qc-bo-${q}`, q, bo.id, "claimed"));
      expect(taken.ok, `Bo takes ${q}`).toBe(true);
    }
    // And the quest is free to be deleted once that claim is put back.
    expect(await claims.remove("c-qc-bo-q-qc-picked")).not.toBeNull();
    expect((await questsRepo(pool).remove("q-qc-picked")).ok).toBe(true);

    // A second run finds nothing to move.
    await anonymizeMember(pool, await usersRepo(pool).byId(wren.id), "admin-1", deps());
    expect((await claims.byId("c-qc-done"))!.status).toBe("consented");
    expect((await claims.byId("c-qc-handed"))!.resolvedAt).toEqual(handed!.resolvedAt);
  });
});
