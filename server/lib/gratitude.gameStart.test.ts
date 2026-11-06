/**
 * A GIFT THAT NEVER ARRIVES, HELD SHUT ON BOTH GRATITUDE DOORS (R67).
 *
 * `sendGratitude` wrote the acknowledgement row and then asked the ledger to
 * issue. The row IS the spend: `budgetFor` sums `gratitude_log` for the cycle,
 * so a refused issue left a permanent record saying somebody gave something,
 * charged against their allowance, with nothing in the recipient's hands.
 *
 * The ledger refuses every faucet posting until a village's launch vote
 * carries, and under R67 that is every village until it launches. So this was
 * never only a crash window. It fired on every heart and every acknowledgement
 * a founder sent while setting their village up.
 *
 * ── WHAT THIS SUITE ASSERTS, AND WHY IT IS NOT THE STATUS CODE ──────────────
 *
 * The response was already a refusal before the fix: a 500 carrying the
 * ledger's sentence. A test that read the response would have passed against
 * the broken code. What separates broken from fixed is the ROW COUNT and the
 * allowance, so that is what each case measures, on both doors:
 *
 *  - the forum heart (`POST /api/feed/threads/:id/heart`), which calls with
 *    `toId`, `kind: 'heart'` and a context;
 *  - the emailed acknowledgement (`POST /api/game/gratitude/send`), which
 *    calls with `toEmail` and the defaults.
 *
 * Both routes hand `outcome.error` straight to the member, so the sentence is
 * asserted too. The last case opens the gate and sends for real, which is the
 * control: a suite of two refusals proves only that something refused, and a
 * broken fixture refuses just as convincingly.
 *
 * No TEST_DATABASE_URL: skips loudly, never passes hollowly (house rule).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import mysql from "mysql2/promise";
import { testPool, provisionTestDb, testDbConfigured, type TestDb } from "../db/testDb";
import { balanceOf, loadTokenRegistry, memberAccount } from "./ledger";
import { loadVariables } from "./variables";
import { recordGameStart } from "./gameStart";
import { budgetFor, sendGratitude, type GratitudeDeps } from "./gratitude";
import { gratitudeLogRepo } from "../repos/gratitude";
import type { UsersRepo } from "../repos/users";

const configured = testDbConfigured();

let db: TestDb;
let pool: mysql.Pool;

async function makeMember(id: string): Promise<any> {
  await pool.query(
    "INSERT INTO `users` (`id`, `name`, `email`, `password_hash`) VALUES (?,?,?,'x') " + // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
      "ON DUPLICATE KEY UPDATE `name` = VALUES(`name`)",
    [id, id, `${id}@village.test`],
  );
  await pool.query(
    "INSERT IGNORE INTO `ledger_accounts` (`id`, `kind`, `user_id`, `label`, `faucet`) VALUES (?,?,?,?,0)", // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    [memberAccount(id), "member", id, id],
  );
  const [rows] = await pool.query<any[]>("SELECT * FROM `users` WHERE `id` = ?", [id]);
  return rows[0];
}

/** The users repo the gratitude service needs, over the scratch pool. */
function usersOver(p: mysql.Pool): UsersRepo {
  const load = async (where: string, v: string) => {
    const [rows] = await p.query<any[]>(`SELECT * FROM \`users\` WHERE ${where} = ? LIMIT 1`, [v]);
    return rows[0] ?? null;
  };
  return {
    async all() {
      const [rows] = await p.query<any[]>("SELECT * FROM `users`");
      return rows as any;
    },
    byId: (id: string) => load("`id`", id),
    byEmail: (email: string) => load("`email`", email),
    async update() {
      /* the recipient's cached balance is not what this suite measures */
    },
  } as unknown as UsersRepo;
}

const deps = (): GratitudeDeps => ({
  pool,
  log: gratitudeLogRepo(pool),
  members: usersOver(pool),
  stageMultiplierFor: async () => 1,
});

/** Every acknowledgement this member has ever written, whatever the cycle. */
async function logRows(fromId: string): Promise<number> {
  const [rows] = await pool.query<any[]>(
    "SELECT COUNT(*) AS n FROM `gratitude_log` WHERE `from_id` = ?",
    [fromId],
  );
  return Number(rows[0].n);
}

/** Ledger legs landing on this member, which is what a gift is made of. */
async function ledgerRows(toId: string): Promise<number> {
  const [rows] = await pool.query<any[]>(
    "SELECT COUNT(*) AS n FROM `token_ledger` WHERE `to_account` = ?",
    [memberAccount(toId)],
  );
  return Number(rows[0].n);
}

describe.skipIf(!configured)("gratitude before the Game starts (MySQL)", () => {
  beforeAll(async () => {
    // The whole point of this suite: a village that has NOT launched, which is
    // every village on its first day.
    db = await provisionTestDb({ gameStarted: false });
    pool = testPool(db, { connectionLimit: 6 }); // module-review-ok: the S5 scratch-schema harness pool, the crews.test.ts shape
    await loadTokenRegistry(pool);
    await loadVariables(pool);
  }, 240_000);

  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  it("refuses a forum heart, and writes nothing and spends nothing", async () => {
    const giver = await makeMember("mend-heart-giver");
    const author = await makeMember("mend-heart-author");
    const before = await budgetFor(deps(), giver);
    expect(before.total).toBeGreaterThan(0);
    expect(before.spent).toBe(0);

    const outcome = await sendGratitude(deps(), {
      fromUser: giver,
      toId: author.id,
      amount: 5,
      kind: "heart",
      contextType: "post",
      contextRef: "thread-mend-1",
      message: "on a post",
    });

    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error("unreachable");
    // The sentence the route hands the member, word for word from the gate.
    expect(outcome.error).toContain("has not started its Game");
    expect(outcome.error).toContain("launch vote carries");

    // THE ASSERTION THAT SEPARATES BROKEN FROM FIXED. The refusal above was
    // there before the fix as well; these four were not.
    expect(await logRows(giver.id)).toBe(0);
    expect((await budgetFor(deps(), giver)).spent).toBe(0);
    expect(await ledgerRows(author.id)).toBe(0);
    expect(await balanceOf(pool, memberAccount(author.id))).toBe(0);
  });

  it("refuses an emailed acknowledgement, and writes nothing and spends nothing", async () => {
    const giver = await makeMember("mend-mail-giver");
    const friend = await makeMember("mend-mail-friend");
    const before = await budgetFor(deps(), giver);
    expect(before.total).toBeGreaterThan(0);
    expect(before.spent).toBe(0);

    const outcome = await sendGratitude(deps(), {
      fromUser: giver,
      toEmail: friend.email,
      amount: 7,
      message: "thank you for the ride",
    });

    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error("unreachable");
    expect(outcome.error).toContain("has not started its Game");
    expect(outcome.error).toContain("launch vote carries");

    expect(await logRows(giver.id)).toBe(0);
    expect((await budgetFor(deps(), giver)).spent).toBe(0);
    expect(await ledgerRows(friend.id)).toBe(0);
    expect(await balanceOf(pool, memberAccount(friend.id))).toBe(0);
  });

  /**
   * The control, and it runs last on purpose: the gate only ever moves one
   * way, so opening it is not something the two cases above could be given
   * back.
   *
   * Two refusals on their own would pass against a fixture that refuses
   * everything for some other reason, so the gate is opened and the same call
   * is made again. This is also where the allowance is proven spendable at
   * all, which is what makes `spent` staying at 0 above mean something.
   */
  it("sends for real once the launch ballot carries", async () => {
    const giver = await makeMember("mend-open-giver");
    const friend = await makeMember("mend-open-friend");

    await recordGameStart(pool, {
      ballotId: "bal-mend-launch",
      startedBy: giver.id,
      note: "The village voted to start its Game.",
    });

    const outcome = await sendGratitude(deps(), {
      fromUser: giver,
      toEmail: friend.email,
      amount: 7,
      message: "thank you for the ride",
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error(outcome.error);
    expect(await logRows(giver.id)).toBe(1);
    expect((await budgetFor(deps(), giver)).spent).toBe(7);
    expect(await balanceOf(pool, memberAccount(friend.id))).toBe(7);
  });
});
