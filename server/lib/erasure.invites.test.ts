/**
 * AN ERASED MEMBER'S INVITATION LINKS LEAVE WITH THEM.
 *
 * A link is its maker's vouch (`server/lib/invites.ts`): using one opens sign-up
 * and records an `arrival` vouch from the person who made it, and a village
 * whose bar is one admits on that vouch alone. A member who asked to be
 * forgotten has no vouch left to give, so three things have to hold, and each
 * case below asserts one of them on the rows, beside a live member's link that
 * must keep working:
 *
 *   THE SWEEP WITHDRAWS THEIR OPEN LINKS (`invites-after-tombstone`). A link
 *   somebody already used made an account and stays the record of that.
 *
 *   THE DOOR REFUSES A LINK WHOSE MAKER IS GONE, even before the sweep reaches
 *   it. A sweep can stop after the tombstone and wait for a steward's retry,
 *   and in that window the row still reads open. The refusal is the one a
 *   withdrawn link gets, and the tombstone's name is never read out to the
 *   stranger holding the link.
 *
 *   NO VOUCH IS RECORDED FROM A TOMBSTONE, for a link taken in the moment
 *   between the door's check and the sweep.
 *
 * Runs against a scratch schema with every real migration applied. No
 * TEST_DATABASE_URL and the suite skips (harness rule).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import mysql from "mysql2/promise";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { provisionTestDb, testDbConfigured, testPool, type TestDb } from "../db/testDb";
import { anonymizeMember, type ErasureDeps } from "./erasure";
import { clearMemberDrivers } from "./memberDrivers";
import { makeInviteDoor } from "./inviteDoor";
import { INVITE_REFUSALS, hashInviteToken, inviteStanding, mintInviteToken } from "./invites";
import { usersRepo } from "../repos/users";
import { claimInvite, createInvite, inviteByHash, revokeOpenInvitesOf } from "../repos/memberInvites";
import { erasureRecord } from "../repos/memberErasure";
import { vouchesFor } from "../repos/vouches";

const configured = testDbConfigured();

let db: TestDb;
let pool: mysql.Pool;
let uploadsDir = "";
let seq = 0;

async function q(sql: string, params: unknown[] = []): Promise<any[]> {
  const [rows] = await pool.query<any[]>(sql, params); // module-review-ok: seeding and reading back the scratch schema this suite provisioned, which is the assertion
  return rows;
}

/** The erasure's singletons, with the real users repository, and one seam just before the tombstone. */
function deps(beforeTombstone?: () => Promise<void>): ErasureDeps {
  const real = usersRepo(pool);
  return {
    members: {
      byId: (id: string) => real.byId(id),
      update: async (id: string, fn: (u: any) => void) => {
        // The last instant the member's sessions still live: a write here is one a signed-in request could make.
        await beforeTombstone?.();
        return real.update(id, fn);
      },
    },
    submissionsRepo: { all: () => [], replaceAll: async () => undefined },
    roleHoldersRepo: { remove: async () => undefined },
    withRoleHolderLock: (fn) => fn(),
    loadRoleHolders: () => [],
    uploadsDir,
  };
}

/** The door both sign-up routes and `/api/invites/check` hold, over the real users repository. */
const door = () => makeInviteDoor({ getPool: () => pool, members: usersRepo(pool) });

async function member(id: string, name: string): Promise<any> {
  await usersRepo(pool).add({ id, name, email: `${id}@example.test`, passwordHash: "x", paths: [] });
  return usersRepo(pool).byId(id);
}

/** One link, as `POST /api/invites` makes it. */
async function link(inviter: string): Promise<{ id: string; token: string }> {
  const token = mintInviteToken();
  const id = `inv-er-${String(++seq).padStart(3, "0")}`;
  await createInvite(pool, { id, tokenHash: hashInviteToken(token), inviterUserId: inviter, days: 14 });
  return { id, token };
}

/** The row as the table holds it, columns and all. */
async function row(id: string): Promise<any> {
  const [r] = await q("SELECT used_at, used_by_user_id, revoked_at FROM member_invites WHERE id = ?", [id]);
  return r;
}

/** What the tombstone step writes, for a sweep that stopped after it and before the links. */
async function tombstoneOnly(id: string): Promise<void> {
  await usersRepo(pool).update(id, (u: any) => {
    u.name = "A departed member";
    u.email = `deleted-${u.id}@anonymized.invalid`;
    u.passwordHash = "";
    u.tokenVersion = (u.tokenVersion ?? 0) + 1;
  });
}

describe.skipIf(!configured)("an erased member's invitation links", () => {
  beforeAll(async () => {
    db = await provisionTestDb();
    pool = testPool(db, { connectionLimit: 4 }); // module-review-ok: the suite's own pool onto the scratch schema it provisioned
    uploadsDir = fs.mkdtempSync(path.join(os.tmpdir(), "village-erasure-invites-"));
  });

  afterAll(async () => {
    await pool?.end();
    await db?.drop?.();
    if (uploadsDir) fs.rmSync(uploadsDir, { recursive: true, force: true });
    clearMemberDrivers();
  });

  beforeEach(() => {
    // No outside store is registered, so these cases are about the local sweep.
    clearMemberDrivers();
  });

  it("withdraws their open links, leaves a used one as it was, and a live member's link still opens the door", async () => {
    const leaver = await member("inv-er-leaver", "Wren Halloway");
    await member("inv-er-live", "Ash Moreno");
    await member("inv-er-arrived", "Pip Arden");

    const open = await link(leaver.id);
    const used = await link(leaver.id);
    expect(await claimInvite(pool, used.id, "inv-er-arrived")).toBe(leaver.id);
    const usedBefore = await row(used.id);
    const theirs = await link("inv-er-live");
    // Made by a signed-in request at the last instant the leaver's sessions lived.
    let late: { id: string; token: string } | null = null;

    await anonymizeMember(pool, leaver, "admin-1", deps(async () => {
      late ??= await link(leaver.id);
    }));

    expect(late, "the fixture must make a link inside the sweep, or the late case proves nothing").not.toBeNull();
    for (const l of [open, late!]) {
      expect((await row(l.id)).revoked_at, `link ${l.id} is withdrawn`).not.toBeNull();
      expect(inviteStanding((await inviteByHash(pool, hashInviteToken(l.token)))!)).toBe("revoked");
      expect(await door().resolve(l.token)).toEqual({ ok: false, error: INVITE_REFUSALS.revoked });
    }
    // A used link made an account. It is the record of that, and the sweep leaves it alone.
    expect(await row(used.id)).toEqual(usedBefore);
    expect(usedBefore.revoked_at).toBeNull();
    expect(await door().resolve(used.token)).toEqual({ ok: false, error: INVITE_REFUSALS.used });

    // The control: somebody who stays keeps a link that works, and is named by first name.
    expect((await row(theirs.id)).revoked_at).toBeNull();
    const found = await door().resolve(theirs.token);
    expect(found).toMatchObject({ ok: true, id: theirs.id, inviterName: "Ash Moreno" });

    // A named step, after the tombstone and directly after the journal.
    const steps = (await erasureRecord(pool, leaver.id))!.stepsDone;
    expect(steps).toContain("invites-after-tombstone");
    expect(steps.indexOf("invites-after-tombstone")).toBeGreaterThan(steps.indexOf("tombstone"));
    expect(steps.indexOf("invites-after-tombstone")).toBe(steps.indexOf("journal-after-tombstone") + 1);
  });

  it("is idempotent: a second erasure withdraws nothing again and touches no link twice", async () => {
    const leaver = await member("inv-er-twice", "Rowan Ise");
    const open = await link(leaver.id);
    await anonymizeMember(pool, leaver, null, deps());
    expect((await row(open.id)).revoked_at).not.toBeNull();

    // The step's own statement, asked again at once, matches nothing. mysql2 counts
    // MATCHED rows (it sets FOUND_ROWS), so a statement that rewrote a withdrawn
    // link would count it here even inside the same second.
    expect(await revokeOpenInvitesOf(pool, leaver.id), "a second run withdrew a link again").toBe(0);

    // `revoked_at` holds whole seconds, so a rewrite inside the same second would
    // read the same. Move the withdrawal to a moment no second run can land in.
    await q("UPDATE member_invites SET revoked_at = '2026-01-02 03:04:05' WHERE id = ?", [open.id]); // module-review-ok: backdating a row in the scratch schema this suite provisioned, which is the assertion
    const first = await row(open.id);

    // An erasure asked for again runs every step again, over the tombstone.
    await anonymizeMember(pool, await usersRepo(pool).byId(leaver.id), null, deps());
    expect(await row(open.id)).toEqual(first);
    const [kept] = await q("SELECT DATE_FORMAT(revoked_at, '%Y-%m-%d %H:%i:%s') AS at FROM member_invites WHERE id = ?", [open.id]); // module-review-ok: reading back the scratch schema this suite provisioned, which is the assertion
    expect(kept.at, "a second erasure rewrote an earlier withdrawal").toBe("2026-01-02 03:04:05");
  });

  it("will not hand a link to a new account once its maker has left, withdraws it, and still hands over a live member's link", async () => {
    // A Google sign-in asks the door at /start, while the maker stands, and
    // carries only the link's id to the callback, up to fifteen minutes later.
    const gone = await member("inv-er-claim-gone", "Ash Roe");
    const taken = await link(gone.id);
    expect(await door().resolve(taken.token)).toMatchObject({ ok: true, id: taken.id });
    // In between, the sweep wrote the tombstone and stopped before the links.
    await tombstoneOnly(gone.id);
    expect(inviteStanding((await inviteByHash(pool, hashInviteToken(taken.token)))!)).toBe("open");

    expect(await door().claim(taken.id, "inv-er-claim-new-1"), "a tombstone's link was claimed").toBeNull();
    const after = await row(taken.id);
    expect(after.used_by_user_id, "the link was spent on an account made in a tombstone's name").toBeNull();
    expect(after.used_at).toBeNull();
    expect(after.revoked_at, "the refused link is withdrawn, as the sweep withdraws it").not.toBeNull();
    // So a sweep that resumes later has nothing left to withdraw, and the link stays shut.
    expect(await revokeOpenInvitesOf(pool, gone.id)).toBe(0);
    expect(await door().resolve(taken.token)).toEqual({ ok: false, error: INVITE_REFUSALS.revoked });

    // A maker with no user row at all is refused the same way.
    const orphan = await link("inv-er-claim-nobody");
    expect(await door().claim(orphan.id, "inv-er-claim-new-2")).toBeNull();
    expect((await row(orphan.id)).used_by_user_id).toBeNull();

    // THE CONTROL, in the same case: a link from somebody who stays is taken for the account, and names them.
    await member("inv-er-claim-live", "Moss Ide");
    const theirs = await link("inv-er-claim-live");
    expect(await door().claim(theirs.id, "inv-er-claim-new-3")).toBe("inv-er-claim-live");
    expect((await row(theirs.id)).used_by_user_id).toBe("inv-er-claim-new-3");
  });

  it("gives a claimed link back when the maker cannot be read, so no account that was never made holds it", async () => {
    await member("inv-er-claim-unread", "Teal Oran");
    const held = await link("inv-er-claim-unread");
    const failing = makeInviteDoor({
      getPool: () => pool,
      members: {
        byId: async () => {
          throw new Error("the members table did not answer");
        },
        update: async () => null,
      },
    });
    await expect(failing.claim(held.id, "inv-er-claim-new-4")).rejects.toThrow("did not answer");
    expect(await row(held.id)).toEqual({ used_at: null, used_by_user_id: null, revoked_at: null });
    // The link was given back open, so the next try, with the members table answering, takes it.
    expect(await door().claim(held.id, "inv-er-claim-new-5")).toBe("inv-er-claim-unread");
  });

  it("refuses a link whose maker is a tombstone or gone, before the sweep reaches the row, and never names them", async () => {
    const stopped = await member("inv-er-stopped", "Sage Okafor");
    const pending = await link(stopped.id);
    // The sweep stopped after the tombstone and is waiting for a retry: the row still reads open.
    await tombstoneOnly(stopped.id);
    expect(inviteStanding((await inviteByHash(pool, hashInviteToken(pending.token)))!)).toBe("open");

    const refused = await door().resolve(pending.token);
    expect(refused).toEqual({ ok: false, error: INVITE_REFUSALS.revoked });
    expect(JSON.stringify(refused)).not.toContain("departed");

    // A maker with no user row at all is refused the same way.
    const orphan = await link("inv-er-nobody");
    expect(await door().resolve(orphan.token)).toEqual({ ok: false, error: INVITE_REFUSALS.revoked });
  });

  it("records no arrival vouch from a tombstone, and records one from a member who stays", async () => {
    const gone = await member("inv-er-vouch-gone", "Lark Benn");
    await member("inv-er-vouch-live", "Moss Tal");
    await member("inv-er-new-1", "New One");
    await member("inv-er-new-2", "New Two");
    await tombstoneOnly(gone.id);

    await door().welcome(gone.id, "inv-er-new-1");
    await door().welcome("inv-er-vouch-live", "inv-er-new-2");

    expect(await vouchesFor(pool, "inv-er-new-1")).toEqual([]);
    const live = await vouchesFor(pool, "inv-er-new-2");
    expect(live.map((v) => [v.voucherUserId, v.kind])).toEqual([["inv-er-vouch-live", "arrival"]]);
  });
});
