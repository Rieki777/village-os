/**
 * CASH THE VILLAGE OWES A LEAVER (round 4, finding R4-4), to Rye's ruling of
 * 2026-10-23: "a if b hasn't already happened". A leaver who still holds value
 * stays on as a former member who can claim later.
 *
 * `cash_owed` (0285) is value the village holds for the member, outside the
 * ledger. Before this, nothing on the way out read it:
 *
 *   (a) the exit open state named no cash, so neither the member nor the exit
 *       desk heard about it;
 *   (b) `heldValueOf` reads token balances only, so a leaver owed cash and
 *       holding nothing else was tombstoned at resolve, and the treasurer's
 *       queue was left holding a payment nobody could receive;
 *   (c) delete-account erased with no word about it.
 *
 * Each case runs against a scratch schema with every real migration applied.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import mysql from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { testPool, provisionTestDb, testDbConfigured, type TestDb } from "../db/testDb";
import type { ErasureDeps } from "./erasure";
import { loadTokenRegistry, memberAccount, MINT_FAUCET, postTransfer } from "./ledger";
import { createExit, exitById, exitOpenState, blockingStates } from "./exit";
import { keepsAsFormerMember, resolveExit } from "./exitResolve";
import { cashNotGivenUp, unpaidCashOf } from "./cashOwed";
import { usersRepo } from "../repos/users";
import { insertCashOwedRow } from "../repos/cashOwed";
import { CASH_GIVE_UP_FIELD } from "../../shared/cashOwed";

const configured = testDbConfigured();

describe.skipIf(!configured)("cash the village owes a leaver keeps them on, and is named on the way out", () => {
  let db: TestDb;
  let pool: mysql.Pool;
  let uploadsDir = "";
  let seq = 0;

  const q = async (sql: string, params: unknown[] = []): Promise<any[]> => {
    const [rows] = await pool.query(sql, params); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    return rows as any[];
  };

  function deps(): ErasureDeps {
    const real = usersRepo(pool);
    return {
      members: { byId: (id: string) => real.byId(id), update: (id: string, fn: any, opts?: any) => real.update(id, fn, opts) },
      submissionsRepo: { all: () => [], replaceAll: async () => undefined },
      roleHoldersRepo: { remove: async () => undefined },
      withRoleHolderLock: (fn) => fn(),
      loadRoleHolders: () => [],
      uploadsDir,
    };
  }

  /** A member with no tokens at all, owed cash in the given states. */
  async function member(states: Array<"owed" | "claimed" | "paid">): Promise<string> {
    const id = `exit-cash-${(seq += 1)}`;
    await q(
      "INSERT INTO `users` (`id`, `name`, `email`, `password_hash`, `membership_granted`, `stage_granted`) VALUES (?,?,?,'x',1,'member')",
      [id, "Rowan Ash", `${id}@example.test`],
    );
    for (const [i, state] of states.entries()) {
      const rowId = `cash-${id}-${i}`;
      await insertCashOwedRow(pool, {
        id: rowId,
        occurrenceKey: `test:${rowId}`,
        userId: id,
        workKind: "quest",
        workRef: `quest-${i}`,
        workTitle: "Mend the east fence",
        amountMinor: 20000,
        currency: "USD",
      });
      if (state !== "owed") await q("UPDATE `cash_owed` SET `state` = ? WHERE `id` = ?", [state, rowId]);
    }
    return id;
  }

  async function exitFor(id: string): Promise<string> {
    const opened = await createExit(pool, { userId: id, kind: "voluntary", openedBy: id, noticeDays: 0, note: null });
    if (!opened.ok) throw new Error(opened.error);
    return opened.exit.id;
  }

  beforeAll(async () => {
    db = await provisionTestDb();
    pool = testPool(db, { connectionLimit: 6 }); // module-review-ok: the S5 scratch-schema harness pool, the ballots.test.ts shape
    uploadsDir = fs.mkdtempSync(path.join(os.tmpdir(), "village-exit-cash-"));
    await loadTokenRegistry(pool);
  });

  afterAll(async () => {
    await pool?.end();
    await db?.drop();
    if (uploadsDir) fs.rmSync(uploadsDir, { recursive: true, force: true });
  });

  it("(a) the open state names the unpaid cash once, per currency, and never blocks", async () => {
    const id = await member(["owed", "claimed", "paid"]);
    const states = await exitOpenState(pool, id, []);
    const cash = states.filter((s) => s.domain === "cash");
    expect(cash, "one cash line on the exit desk, not two").toHaveLength(1);
    expect(cash[0].count, "owed and claimed count, paid does not").toBe(2);
    expect(cash[0].blocking).toBe(false);
    expect(cash[0].description).toContain("is owed $400.00 in cash the village has not paid yet");
    // The amount, never the work.
    expect(cash[0].description).not.toContain("east fence");
    expect(blockingStates(states).map((s) => s.domain)).not.toContain("cash");
  });

  it("(a) a member owed nothing reads a zero", async () => {
    const id = await member(["paid"]);
    const cash = (await exitOpenState(pool, id, [])).find((s) => s.domain === "cash")!;
    expect(cash.count).toBe(0);
    expect(await unpaidCashOf(pool, id)).toBe(0);
  });

  it("(b) a leaver owed cash and holding no tokens stays on as a former member, and the exit says why", async () => {
    const id = await member(["owed"]);
    const exitId = await exitFor(id);

    const out = await resolveExit(pool, { exitId, target: await usersRepo(pool).byId(id), actorId: "admin-1", deps: deps() });

    expect(out.outcome, "the account was tombstoned with cash still owed to it").toBe("former");
    expect(out.held).toEqual([]);
    expect(out.owed).toEqual([{ currency: "USD", amountMinor: 20000, rows: 1 }]);
    const u = (await usersRepo(pool).byId(id))!;
    expect(u.email, "the account must keep its address so it can still be paid").toBe(`${id}@example.test`);
    expect(u.membershipGranted).toBe(false);
    const exit = (await exitById(pool, exitId))!;
    expect(exit.status).toBe("resolved");
    expect(String(exit.resolution)).toContain("kept as a former member: is owed $200.00 in cash");
    expect(String(exit.resolution)).not.toContain("east fence");
    // The row is still there for the treasurer to pay.
    expect(await unpaidCashOf(pool, id)).toBe(1);
  });

  it("(b) the control: with the cash paid, the same leaver is erased as before", async () => {
    const id = await member(["paid"]);
    const exitId = await exitFor(id);
    const out = await resolveExit(pool, { exitId, target: await usersRepo(pool).byId(id), actorId: "admin-1", deps: deps() });
    expect(out.outcome).toBe("erased");
  });

  it("(c) delete-account refuses until the member says they give the cash up, and says how much is owed", async () => {
    const id = await member(["owed", "claimed"]);
    const refused = await cashNotGivenUp(pool, id, {});
    expect(refused, "deleting erased a member owed cash without telling them").not.toBeNull();
    expect(refused!.cashOwed).toBe(2);
    expect(refused!.error).toContain("2 cash payment(s) the village still owes you");
    expect(refused!.error).toContain("gives them up");
    // A truthy string is not consent: only an explicit true.
    expect(await cashNotGivenUp(pool, id, { [CASH_GIVE_UP_FIELD]: "yes" })).not.toBeNull();
    expect(await cashNotGivenUp(pool, id, { [CASH_GIVE_UP_FIELD]: true })).toBeNull();
  });

  /** Platform credits on the member's own account, a balance `heldValueOf` counts. */
  async function credits(id: string): Promise<void> {
    const r = await postTransfer(pool, {
      from: MINT_FAUCET,
      to: memberAccount(id),
      tokenType: "credits",
      amount: 500,
      source: "test_seed",
      idempotencyKey: `exit-cash-credits:${id}`,
    });
    if (!r.ok) throw new Error(`could not seed credits: ${r.error}`);
  }

  // R5-0 / R5-1: the departure notices and resolve must ask one rule, so the rule has one home.
  it("(d) keepsAsFormerMember: tokens alone keep a leaver on", async () => {
    const id = await member([]);
    await credits(id);
    expect(await keepsAsFormerMember(pool, id), "a token holder would be erased").toBe(true);
  });

  it("(d) keepsAsFormerMember: cash owed alone keeps a leaver on, the same rule resolve follows", async () => {
    const id = await member(["owed"]);
    expect(await keepsAsFormerMember(pool, id), "a leaver owed cash and holding no tokens is not kept").toBe(true);
    const out = await resolveExit(pool, { exitId: await exitFor(id), target: await usersRepo(pool).byId(id), actorId: "admin-1", deps: deps() });
    expect(out.outcome).toBe("former");
  });

  it("(d) keepsAsFormerMember: neither tokens nor unpaid cash, and resolve erases", async () => {
    const id = await member(["paid"]);
    expect(await keepsAsFormerMember(pool, id)).toBe(false);
    const out = await resolveExit(pool, { exitId: await exitFor(id), target: await usersRepo(pool).byId(id), actorId: "admin-1", deps: deps() });
    expect(out.outcome).toBe("erased");
  });

  it("(c) a member owed nothing is never asked", async () => {
    const id = await member([]);
    expect(await cashNotGivenUp(pool, id, undefined)).toBeNull();
  });
});
