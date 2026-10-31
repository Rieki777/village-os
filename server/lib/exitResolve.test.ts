/**
 * Resolve and "They're staying" take turns on one exit (round 4).
 *
 * ── THE TWO DEFECTS ──────────────────────────────────────────────────────
 *
 * 1. THE RACE. The resolve route reads the exit's status once, at the top,
 *    and `resolveExit` then ran every step and wrote 'resolved' with no
 *    status condition at all (`markExitResolved`, server/repos/exitNotes.ts).
 *    A cancel that landed anywhere in between flipped the exit to
 *    'cancelled', told the admin the member was staying, and was then
 *    overwritten. On the former-member path the resolve went on to end the
 *    membership of the member the admins had just kept; on the tombstone path
 *    a cancel that landed before the deletion began let it close their
 *    account.
 *
 * 2. THE SILENT CANCEL. `keepAsFormerMember` vacates roles before it ends the
 *    membership, and the exit is marked resolved last. A resolve that stopped
 *    in between left the exit open, and "They're staying" then closed it with
 *    the plain answer: no erasure record exists on this path, so nothing named
 *    the roles that were already ended and do not come back.
 *
 * ── HOW EACH CASE INTERLEAVES ────────────────────────────────────────────
 *
 * The cancel is driven from INSIDE the resolve, through the deps the resolve
 * calls: the role-holder write (the "role-holdings" step) and the account
 * write (the end of membership). That places it at an exact point between the
 * resolve's check and its final write, which is the window the defect lives
 * in, instead of hoping two requests overlap. Every case runs against a
 * scratch schema with every real migration applied.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import mysql from "mysql2/promise";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { testPool, provisionTestDb, testDbConfigured, type TestDb } from "../db/testDb";
import type { ErasureDeps } from "./erasure";
import { loadTokenRegistry, memberAccount, MINT_FAUCET, postTransfer } from "./ledger";
import { cancelExit, createExit, exitById, forgetOwnExitNotes } from "./exit";
import { resolveExit } from "./exitResolve";
import { usersRepo } from "../repos/users";
import { erasureRecord } from "../repos/memberErasure";
import { createInviteOn } from "../repos/memberInvites";
import { hashInviteToken, INVITE_REFUSALS, mintInviteToken } from "./invites";
import { makeInviteDoor } from "./inviteDoor";
import { acceptDelegations, setDelegation } from "./delegation";

const configured = testDbConfigured();

/** Long enough that a cancel nothing holds back has certainly finished. */
const NOTHING_HOLDS_IT_MS = 1500;

describe.skipIf(!configured)("resolve and They're staying take turns on one exit (round 4)", () => {
  let db: TestDb;
  let pool: mysql.Pool;
  let uploadsDir = "";
  let seq = 0;

  /** The village's permission holdings, as the server's store hands them to the sweep. */
  let holders: Array<{ id: string; userId: string; roleId: string }> = [];
  /** Runs once, inside the role-holder write: the cancel lands while roles are being ended. */
  let whenRolesEnd: (() => Promise<void>) | null = null;
  /** Runs once, inside the account write: the cancel lands while membership is ending. */
  let whenAccountWritten: (() => Promise<void>) | null = null;
  /** The account write refuses, so a former-member resolve stops after the roles went. */
  let refuseAccountWrite = false;

  const q = async (sql: string, params: unknown[] = []): Promise<any[]> => {
    const [rows] = await pool.query(sql, params); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    return rows as any[];
  };

  function deps(): ErasureDeps {
    const real = usersRepo(pool);
    return {
      members: {
        byId: (id: string) => real.byId(id),
        update: async (id: string, fn: any, opts?: { erasure?: boolean }) => {
          const hook = whenAccountWritten;
          whenAccountWritten = null;
          if (hook) await hook();
          if (refuseAccountWrite) throw new Error("the account write was refused");
          return real.update(id, fn, opts);
        },
      },
      submissionsRepo: { all: () => [], replaceAll: async () => undefined },
      roleHoldersRepo: {
        remove: async (ids: string[]) => {
          const hook = whenRolesEnd;
          whenRolesEnd = null;
          if (hook) await hook();
          holders = holders.filter((h) => !ids.includes(h.id));
        },
      },
      withRoleHolderLock: (fn) => fn(),
      loadRoleHolders: () => holders,
      uploadsDir,
    };
  }

  /** A member, admitted both ways a village records it, in a permission role and an org chart role. */
  async function member(opts: { holdsValue: boolean; openedBy?: "self"; note?: string }): Promise<{ id: string; exitId: string }> {
    const id = `exit-turns-${(seq += 1)}`;
    await q(
      "INSERT INTO `users` (`id`, `name`, `email`, `password_hash`, `membership_granted`, `stage_granted`) VALUES (?,?,?,'x',1,'member')",
      [id, "Ash Holder", `${id}@example.test`],
    );
    holders.push({ id: `holding-${id}`, userId: id, roleId: "treasury" });
    await q(
      "INSERT INTO `org_role_assignments` (`id`, `org_role_id`, `holder_kind`, `user_id`, `holder_key`, `is_example`) VALUES (?,'kitchen-voice','member',?,?,0)",
      [`seating-${id}`, id, id],
    );
    if (opts.holdsValue) {
      const r = await postTransfer(pool, {
        from: MINT_FAUCET,
        to: memberAccount(id),
        tokenType: "credits",
        amount: 500,
        source: "test_seed",
        idempotencyKey: `exit-turns:${id}`,
      });
      if (!r.ok) throw new Error(`could not seed credits: ${r.error}`);
    }
    const opened = await createExit(pool, {
      userId: id,
      kind: "voluntary",
      openedBy: opts.openedBy === "self" ? id : "admin-1",
      noticeDays: 0,
      note: opts.note ?? null,
    });
    if (!opened.ok) throw new Error(opened.error);
    return { id, exitId: opened.exit.id };
  }

  const cancel = (exitId: string) =>
    cancelExit(pool, exitId, { memberById: (id) => usersRepo(pool).byId(id), actorId: "admin-1" });
  const resolve = async (exitId: string, id: string) =>
    resolveExit(pool, { exitId, target: await usersRepo(pool).byId(id), actorId: "admin-1", deps: deps() });
  const statusOf = async (exitId: string) => (await exitById(pool, exitId))!.status;
  const admission = async (id: string) => {
    const u = (await usersRepo(pool).byId(id))!;
    return { membershipGranted: u.membershipGranted, stageGranted: u.stageGranted };
  };
  const seatingOpen = async (id: string) =>
    (await q("SELECT `ended_at` FROM `org_role_assignments` WHERE `id` = ?", [`seating-${id}`]))[0]?.ended_at == null;
  const holdsTreasury = (id: string) => holders.some((h) => h.userId === id && h.roleId === "treasury");

  /** Whether `p` settled within `ms`, without waiting for it past that. */
  async function settledWithin(p: Promise<unknown>, ms: number): Promise<boolean> {
    let settled = false;
    p.then(
      () => (settled = true),
      () => (settled = true),
    );
    await new Promise((r) => setTimeout(r, ms));
    return settled;
  }

  beforeAll(async () => {
    db = await provisionTestDb();
    pool = testPool(db, { connectionLimit: 8 }); // module-review-ok: the S5 scratch-schema harness pool, the ballots.test.ts shape
    uploadsDir = fs.mkdtempSync(path.join(os.tmpdir(), "village-exit-turns-"));
    await loadTokenRegistry(pool);
  });

  afterAll(async () => {
    await pool?.end();
    await db?.drop();
    if (uploadsDir) fs.rmSync(uploadsDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    whenRolesEnd = null;
    whenAccountWritten = null;
    refuseAccountWrite = false;
  });

  // ── 1. The race ─────────────────────────────────────────────────────────

  it("a cancel that lands while resolve is ending roles stops it before membership ends, and the exit stays cancelled", async () => {
    const { id, exitId } = await member({ holdsValue: true });
    let cancelled: Awaited<ReturnType<typeof cancel>> | null = null;
    whenRolesEnd = async () => {
      cancelled = await cancel(exitId);
    };

    const out = await resolve(exitId, id);

    expect(await statusOf(exitId), "the resolve overwrote the admin's They're staying").toBe("cancelled");
    expect(await admission(id), "the member the admins kept had their membership ended").toEqual({ membershipGranted: true, stageGranted: "member" });
    expect(await seatingOpen(id), "the resolve went on ending roles after the cancel").toBe(true);
    expect(out.outcome, "the resolve did not say it stopped").toBe("stopped");
    expect(String((out as any).stopped?.message ?? "")).toMatch(/still a member/);

    expect(cancelled!.status).toBe(200);
    expect(cancelled!.body.alreadyRemoved, "the cancel did not name what the resolve had already ended").toEqual(["alignment-party-left", "role-holdings"]);
    expect(cancelled!.body.vacatedRoles).toEqual(["treasury"]);
    expect(String(cancelled!.body.message)).toMatch(/treasury/);
  });

  it("a cancel that lands first makes the resolve stop before anything ends, and say so", async () => {
    const { id, exitId } = await member({ holdsValue: true });
    // The route read the exit open; the cancel landed before resolveExit began.
    expect((await cancel(exitId)).status).toBe(200);

    const out = await resolve(exitId, id);

    expect(await statusOf(exitId), "the resolve overwrote the admin's They're staying").toBe("cancelled");
    expect(await admission(id), "the member the admins kept had their membership ended").toEqual({ membershipGranted: true, stageGranted: "member" });
    expect(holdsTreasury(id), "a role ended after the cancel").toBe(true);
    expect(await seatingOpen(id)).toBe(true);
    expect(out.outcome).toBe("stopped");
    expect((out as any).stopped?.alreadyEnded).toEqual([]);
    expect(String((out as any).stopped?.message ?? "")).toMatch(/They're staying/);
    expect((await exitById(pool, exitId))!.resolution ?? "", "a stopped resolve wrote a resolution line").not.toContain("kept as a former member");
  });

  it("a cancel that lands while membership is ending waits for the resolve, and finds the exit resolved", async () => {
    const { id, exitId } = await member({ holdsValue: true });
    let pending: Promise<Awaited<ReturnType<typeof cancel>>> | null = null;
    let finishedEarly: boolean | null = null;
    whenAccountWritten = async () => {
      pending = cancel(exitId);
      finishedEarly = await settledWithin(pending, NOTHING_HOLDS_IT_MS);
    };

    const out = await resolve(exitId, id);
    const answer = await pending!;

    expect(finishedEarly, "the cancel closed the exit while resolve was ending the membership").toBe(false);
    expect(out.outcome).toBe("former");
    expect(await statusOf(exitId)).toBe("resolved");
    expect(answer.status, JSON.stringify(answer.body)).toBe(404);
    expect(await admission(id)).toEqual({ membershipGranted: false, stageGranted: null });
  });

  it("two admins pressing Resolve at once resolve it once", async () => {
    const { id, exitId } = await member({ holdsValue: true });

    const outs = await Promise.all([resolve(exitId, id), resolve(exitId, id)]);

    expect(outs.map((o) => o.outcome).sort()).toEqual(["former", "stopped"]);
    const lines = String((await exitById(pool, exitId))!.resolution ?? "")
      .split("\n")
      .filter((l) => l.includes("kept as a former member"));
    expect(lines, "the exit was marked resolved twice").toHaveLength(1);
  });

  it("a cancel that lands first stops a resolve that would erase, before the deletion begins", async () => {
    const { id, exitId } = await member({ holdsValue: false });
    expect((await cancel(exitId)).status).toBe(200);

    const out = await resolve(exitId, id);

    expect(await statusOf(exitId), "the resolve overwrote the admin's They're staying").toBe("cancelled");
    const after = (await usersRepo(pool).byId(id))!;
    expect({ name: after.name, email: after.email }, "the deletion closed the account of a member who stayed").toEqual({
      name: "Ash Holder",
      email: `${id}@example.test`,
    });
    expect(await erasureRecord(pool, id), "a deletion was begun for a member who stayed").toBeNull();
    expect(out.outcome).toBe("stopped");
  });

  it("a cancel that lands once the deletion has begun is refused, and the resolve finishes (held since round 2)", async () => {
    const { id, exitId } = await member({ holdsValue: false });
    let cancelled: Awaited<ReturnType<typeof cancel>> | null = null;
    whenRolesEnd = async () => {
      cancelled = await cancel(exitId);
    };

    const out = await resolve(exitId, id);

    expect(cancelled!.status, JSON.stringify(cancelled!.body)).toBe(409);
    expect(String(cancelled!.body.error)).toMatch(/being deleted right now/);
    expect(out.outcome).toBe("erased");
    expect(await statusOf(exitId)).toBe("resolved");
  });

  // ── 1b. A former member's open links (round 6, R5-2) ────────────────────

  it("a former member's open invitation links stop admitting, and nobody arrives on their vouch", async () => {
    const { id, exitId } = await member({ holdsValue: true });
    const token = mintInviteToken();
    const inviteId = `inv-former-${id}`;
    const conn = await pool.getConnection();
    try {
      await createInviteOn(conn, { id: inviteId, tokenHash: hashInviteToken(token), inviterUserId: id, days: 14 });
    } finally {
      conn.release();
    }
    const door = makeInviteDoor({ getPool: () => pool, members: usersRepo(pool) });
    expect((await door.resolve(token)).ok, "the control: the link opened the door before the resolve").toBe(true);

    const out = await resolve(exitId, id);
    expect(out.outcome).toBe("former");

    expect(await door.resolve(token)).toEqual({ ok: false, error: INVITE_REFUSALS.revoked });
    const newcomer = `newcomer-${id}`;
    await q("INSERT INTO `users` (`id`, `name`, `email`, `password_hash`) VALUES (?,?,?,'x')", [newcomer, "Pip Arden", `${newcomer}@example.test`]);
    // As both sign-up doors run it: the take, then the welcome only for a link that was taken.
    const inviter = await door.claim(inviteId, newcomer);
    if (inviter) await door.welcome(inviter, newcomer);
    expect(inviter, "the link of a member who left was taken").toBeNull();
    expect(await q("SELECT `id` FROM `member_vouches` WHERE `voucher_user_id` = ?", [id]), "an arrival vouch from someone who left").toEqual([]);
    expect(await q("SELECT `id` FROM `member_invites` WHERE `inviter_user_id` = ? AND `used_at` IS NULL AND `revoked_at` IS NULL", [id])).toEqual([]);
    expect(String((await exitById(pool, exitId))!.resolution ?? "")).toMatch(/resolve began ending: invitations/);
  });

  it("a link taken while the resolve ran, then given back, opens nothing in a former member's name (round 6)", async () => {
    const { id, exitId } = await member({ holdsValue: true });
    const token = mintInviteToken();
    const inviteId = `inv-inflight-${id}`;
    const conn = await pool.getConnection();
    try {
      await createInviteOn(conn, { id: inviteId, tokenHash: hashInviteToken(token), inviterUserId: id, days: 14 });
    } finally {
      conn.release();
    }
    const door = makeInviteDoor({ getPool: () => pool, members: usersRepo(pool) });
    const first = `inflight-a-${id}`;
    const second = `inflight-b-${id}`;
    for (const u of [first, second]) {
      await q("INSERT INTO `users` (`id`, `name`, `email`, `password_hash`) VALUES (?,?,?,'x')", [u, "Pip Arden", `${u}@example.test`]);
    }
    // A sign-up takes the link, so the bulk withdraw cannot see it, and is still hashing when the resolve runs.
    expect(await door.claim(inviteId, first)).toBe(id);
    expect((await resolve(exitId, id)).outcome).toBe("former");
    // Its welcome lands after membership ended: no vouch from someone who left.
    await door.welcome(id, first);
    // Its account write fails and the link is given back, open again by the row alone.
    await door.release(inviteId, first);
    expect(await door.resolve(token)).toEqual({ ok: false, error: INVITE_REFUSALS.revoked });
    expect(await door.claim(inviteId, second), "the given-back link of a member who left was taken").toBeNull();
    expect(await q("SELECT `id` FROM `member_vouches` WHERE `voucher_user_id` = ?", [id]), "an arrival vouch from someone who left").toEqual([]);
    expect(await q("SELECT `revoked_at` FROM `member_invites` WHERE `id` = ?", [inviteId]).then((r) => r[0]?.revoked_at)).not.toBeNull();
  });

  it("a former member an admin admits again by a stage grant invites and vouches again (round 6)", async () => {
    const { id, exitId } = await member({ holdsValue: true });
    expect((await resolve(exitId, id)).outcome).toBe("former");
    await usersRepo(pool).update(id, (u: any) => {
      u.stageGranted = "contributor";
    });
    const token = mintInviteToken();
    const inviteId = `inv-readmitted-${id}`;
    const conn = await pool.getConnection();
    try {
      await createInviteOn(conn, { id: inviteId, tokenHash: hashInviteToken(token), inviterUserId: id, days: 14 });
    } finally {
      conn.release();
    }
    const door = makeInviteDoor({ getPool: () => pool, members: usersRepo(pool) });
    expect((await door.resolve(token)).ok, "a re-admitted member's new link").toBe(true);
    const newcomer = `readmitted-newcomer-${id}`;
    await q("INSERT INTO `users` (`id`, `name`, `email`, `password_hash`) VALUES (?,?,?,'x')", [newcomer, "Pip Arden", `${newcomer}@example.test`]);
    expect(await door.claim(inviteId, newcomer)).toBe(id);
    await door.welcome(id, newcomer);
    expect(await q("SELECT `id` FROM `member_vouches` WHERE `voucher_user_id` = ?", [id])).toHaveLength(1);
  });

  it("no second exit opens for a former member, and one admitted again can leave again (e2e sweep, E4)", async () => {
    const { id, exitId } = await member({ holdsValue: true });
    expect((await resolve(exitId, id)).outcome).toBe("former");
    const again = await createExit(pool, { userId: id, kind: "voluntary", openedBy: "admin-1", noticeDays: 0 });
    expect(again.ok, "a former member had a second exit opened").toBe(false);
    expect(again.ok ? "" : again.error).toMatch(/already left the village/);
    expect((await q("SELECT `id` FROM `exits` WHERE `user_id` = ?", [id])).length).toBe(1);
    // The control: admitted again, they are a member, and a member may leave.
    await usersRepo(pool).update(id, (u: any) => {
      u.membershipGranted = true;
      u.stageGranted = "member";
    });
    expect((await createExit(pool, { userId: id, kind: "voluntary", openedBy: "admin-1", noticeDays: 0 })).ok).toBe(true);
  });

  it("a former member's delegations end with their membership, never in a step a cancel could still undo (round 6)", async () => {
    const { id, exitId } = await member({ holdsValue: true });
    const giver = `delegator-${id}`;
    await q("INSERT INTO `users` (`id`, `name`, `email`, `password_hash`, `membership_granted`) VALUES (?,?,?,'x',1)", [giver, "Ann Rivers", `${giver}@example.test`]);
    expect((await setDelegation(pool, giver, id)).ok).toBe(true);
    await acceptDelegations(pool, id, giver);
    const live = () => q("SELECT `delegator_id` FROM `delegations` WHERE `delegator_id` = ? AND `revoked_at` IS NULL", [giver]);
    const told = () => q("SELECT `id` FROM `notifications` WHERE `user_id` = ? AND `dedupe_key` LIKE 'delegation-ended:%'", [giver]);
    // Every step before membership ends has run when the account is written: nobody may have been told yet.
    let atAccountWrite: { live: number; told: number } | null = null;
    whenAccountWritten = async () => {
      atAccountWrite = { live: (await live()).length, told: (await told()).length };
    };

    expect((await resolve(exitId, id)).outcome).toBe("former");

    expect(atAccountWrite, "a step a cancel could still stop had already ended the delegation and told its giver").toEqual({ live: 1, told: 0 });
    expect(await live(), "the delegation they carried outlived their membership").toEqual([]);
    expect(await told(), "the giver is told once").toHaveLength(1);
  });

  it("the control: a living member who was never admitted, with no departure, still invites and vouches", async () => {
    const id = `exit-turns-living-${(seq += 1)}`;
    await q("INSERT INTO `users` (`id`, `name`, `email`, `password_hash`, `role`) VALUES (?,?,?,'x','admin')", [id, "Rowan Keep", `${id}@example.test`]);
    const token = mintInviteToken();
    const inviteId = `inv-living-${id}`;
    const conn = await pool.getConnection();
    try {
      await createInviteOn(conn, { id: inviteId, tokenHash: hashInviteToken(token), inviterUserId: id, days: 14 });
    } finally {
      conn.release();
    }
    const door = makeInviteDoor({ getPool: () => pool, members: usersRepo(pool) });
    expect((await door.resolve(token)).ok).toBe(true);
    const newcomer = `living-newcomer-${id}`;
    await q("INSERT INTO `users` (`id`, `name`, `email`, `password_hash`) VALUES (?,?,?,'x')", [newcomer, "Pip Arden", `${newcomer}@example.test`]);
    expect(await door.claim(inviteId, newcomer)).toBe(id);
    await door.welcome(id, newcomer);
    expect(await q("SELECT `id` FROM `member_vouches` WHERE `voucher_user_id` = ?", [id])).toHaveLength(1);
  });

  // ── 2. What a stopped former-member resolve already ended ───────────────

  it("a cancel after a former-member resolve that stopped part way names every role it had already ended", async () => {
    const { id, exitId } = await member({ holdsValue: true });
    refuseAccountWrite = true;
    // Pressed twice, as an admin retrying a resolve that keeps failing would.
    await expect(resolve(exitId, id)).rejects.toThrow(/account write was refused/);
    await expect(resolve(exitId, id)).rejects.toThrow(/account write was refused/);
    expect(await statusOf(exitId), "the stopped resolve must leave the exit open, or this is a different case").toBe("open");
    expect(holdsTreasury(id), "the control: the role went before the resolve stopped").toBe(false);
    expect(await seatingOpen(id)).toBe(false);

    const out = await cancel(exitId);

    expect(out.status).toBe(200);
    expect(out.body.alreadyRemoved, "the cancel did not name what the resolve had already ended").toEqual([
      "alignment-party-left",
      "role-holdings",
      "org-seatings",
      "role-applications",
      "invitations",
      "subscriptions",
    ]);
    expect(out.body.vacatedRoles).toEqual(["treasury"]);
    expect(String(out.body.message)).toMatch(/treasury/);
    // Rye, 2026-10-31, ruling 8: the cancelled payments do not come back either, and the admin is told so.
    expect(String(out.body.message)).toMatch(/their recurring payments through Stripe/);
    expect(String(out.body.message)).toMatch(/do not come back/);
    expect(await statusOf(exitId)).toBe("cancelled");
    expect(await admission(id), "they stay a member").toEqual({ membershipGranted: true, stageGranted: "member" });
  });

  it("the record of what a stopped resolve ended outlives an erasure of the member's own words", async () => {
    const { id, exitId } = await member({ holdsValue: true, openedBy: "self", note: "Leaving because of how Sam treated me" });
    refuseAccountWrite = true;
    await expect(resolve(exitId, id)).rejects.toThrow(/account write was refused/);
    const before = String((await exitById(pool, exitId))!.resolution ?? "");
    expect(before, "the control: the stopped resolve recorded what it ended").toMatch(/role-holdings/);

    // The erasure's exit step, as a later deletion of this member runs it.
    await forgetOwnExitNotes(pool, id);

    const after = String((await exitById(pool, exitId))!.resolution ?? "");
    expect(after, "their words do not outlive them").not.toContain("Sam");
    for (const line of before.split("\n").filter((l) => /role-holdings|org-seatings/.test(l))) {
      expect(after, "the erasure took the record of what was ended").toContain(line);
    }
    const out = await cancel(exitId);
    expect(out.body.vacatedRoles).toEqual(["treasury"]);
  });
});
