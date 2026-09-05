/**
 * One cycle, one name.
 *
 * Two formatters used to write different strings into the same `cycle_id`
 * column: the acknowledgement flow wrote `lunar-000329` and the Hearts economy
 * wrote `moon-329`. They were the same lunation and neither knew about the
 * other, so a member's spending was counted twice against two allowances that
 * could not see each other, and the settlement read half the rows it was
 * settling over.
 *
 * These tests hold both ends of that shut. They are written against the engine
 * and the service rather than over HTTP, because the rule is the thing under
 * test: a route can refuse for its own reasons and prove nothing about the
 * ledger underneath it.
 */
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import mysql from "mysql2/promise";
import { allowanceFor, cycleWindow, ensureVoiceToken, give, HEARTS, keys, reverse, villageId } from "./lib/economy";
import { budgetFor, sendGratitude, type GratitudeDeps } from "./lib/gratitude";
import { cycleIdFor, dueCycles, settleCycle } from "./lib/gratitude-cycles";
import { loadTokenRegistry, memberAccount, RECOGNITION_FAUCET } from "./lib/ledger";
import { loadVariables } from "./lib/variables";
import { seedEconomy } from "./lib/economySeed";
import { gratitudeLogRepo } from "./repos/gratitude";
import type { UsersRepo } from "./repos/users";
import { provisionTestDb, testDbConfigured, type TestDb } from "./db/testDb";

const configured = testDbConfigured();

let db: TestDb;
let pool: mysql.Pool;

async function makeMember(id: string): Promise<string> {
  await pool.query(
    "INSERT INTO `users` (`id`, `name`, `email`, `password_hash`) VALUES (?,?,?,'x') " +
      "ON DUPLICATE KEY UPDATE `name` = VALUES(`name`)",
    [id, id, `${id}@village.test`],
  );
  await pool.query(
    "INSERT IGNORE INTO `ledger_accounts` (`id`, `kind`, `user_id`, `label`, `faucet`) VALUES (?,?,?,?,0)",
    [memberAccount(id), "member", id, id],
  );
  return id;
}

/** The users repo the gratitude service needs, over the scratch pool. */
function usersOver(pool: mysql.Pool): UsersRepo {
  const load = async (where: string, v: string) => {
    const [rows] = await pool.query<any[]>(`SELECT * FROM \`users\` WHERE ${where} = ? LIMIT 1`, [v]);
    return rows[0] ?? null;
  };
  return {
    async all() {
      const [rows] = await pool.query<any[]>("SELECT * FROM `users`");
      return rows as any;
    },
    byId: (id: string) => load("`id`", id),
    byEmail: (email: string) => load("`email`", email),
    async update() {
      /* the recipient's cached balance is not what these tests measure */
    },
  } as unknown as UsersRepo;
}

function depsOver(pool: mysql.Pool): GratitudeDeps {
  return {
    pool,
    log: gratitudeLogRepo(pool),
    members: usersOver(pool),
    stageMultiplierFor: async () => 1,
  };
}

/** Both allowances read a member's own spending out of the same table. */
async function spentByFormat(fromId: string) {
  const [rows] = await pool.query<any[]>(
    "SELECT `cycle_id`, SUM(`amount`) AS s FROM `gratitude_log` WHERE `from_id` = ? GROUP BY `cycle_id`",
    [fromId],
  );
  const out: Record<string, number> = {};
  for (const r of rows) out[String(r.cycle_id)] = Number(r.s);
  return out;
}

describe.skipIf(!configured)("one cycle, one name", () => {
  beforeAll(async () => {
    db = await provisionTestDb();
    pool = mysql.createPool({ uri: db.url, timezone: "Z", connectionLimit: 6 });
    await loadTokenRegistry(pool);
    await loadVariables(pool);
    await ensureVoiceToken(pool, "Village Voice");
    await loadTokenRegistry(pool);
    // `give` is inert until the village's rules are seeded.
    await seedEconomy(pool, villageId());
  }, 240_000);

  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  /**
   * QA2-01, held shut, and R73 on top of it.
   *
   * The dials WERE 30 a moon through the Hearts economy and 100 through the
   * acknowledgement flow, and this test held the seam shut between two totals
   * that disagreed. There is one total now: `gratitude.base_budget` times the
   * giver's stage multiplier, read by both doors. What is left to prove is
   * that one member still cannot move more than it by using both.
   */
  it("counts a member's spending once, whichever door they came through", async () => {
    const giver = await makeMember("cyc-giver");
    const people = [];
    for (let i = 0; i < 8; i++) people.push(await makeMember(`cyc-friend-${i}`));

    // Stock dials, and this test's stage multiplier is 1: an allowance of 100
    // and a per-recipient share of 25% of it, so 25 to any one person.
    const ack = (to: string, amount: number) =>
      sendGratitude(depsOver(pool), { fromUser: { id: giver, name: giver }, toId: to, amount, message: "thank you" });
    const hearts = (to: string, amount: number, nonce: string) =>
      give(pool, { fromUserId: giver, toUserId: to, amount, clientNonce: nonce }, async () => 1);

    // Door one: the Hearts economy, on the one allowance.
    expect((await hearts(people[0], 25, "n-0")).ok).toBe(true);

    // The share, on this door, and measured while 75 of the allowance is still
    // unspent so the ALLOWANCE cannot be what refuses it. Order of refusals is
    // part of the contract: the remaining allowance is checked first, because
    // it is the harder limit and the more useful sentence when both bind.
    const hogging = await hearts(people[1], 26, "n-hog");
    expect(hogging.ok).toBe(false);
    expect(hogging.ok === false && hogging.error).toContain("25 is the most you can give one person");

    expect((await hearts(people[1], 25, "n-1")).ok).toBe(true);
    expect((await hearts(people[2], 25, "n-2")).ok).toBe(true);

    // Door two: the acknowledgement flow. Its budget already sees the 75.
    const budget = await budgetFor(depsOver(pool), { id: giver, name: giver });
    expect(budget.total).toBe(100);
    expect(budget.spent).toBe(75);
    expect(budget.remaining).toBe(25);

    // THE SAME PERSON, TWICE, inside the share. At 6b44084 the second of
    // these was a 409: `gratitude.max_per_recipient_per_cycle` counted sends
    // and was set to 1.
    expect((await ack(people[3], 12)).ok).toBe(true);
    expect((await ack(people[3], 13)).ok).toBe(true);

    const byFormat = await spentByFormat(giver);
    // One name for one lunation. Nothing under any other key.
    expect(Object.keys(byFormat)).toEqual([cycleIdFor()]);
    // 75 through one door and 25 through the other, against one allowance of
    // 100. At b5bed01 this shape moved 130.
    expect(Object.values(byFormat).reduce((a, b) => a + b, 0)).toBe(100);

    // Nothing at all is left to give, through either door.
    const spent = await ack(people[4], 1);
    expect(spent.ok).toBe(false);
    expect(spent.ok === false && spent.error).toBe("Only 0 left in your budget this cycle");
    expect((await hearts(people[7], 1, "n-last")).ok).toBe(false);
  });

  /**
   * QA2-02, held shut. The settlement runs over the rows the previous test
   * wrote, which came through both doors. It has to see all of them.
   *
   * At `b5bed01` this same shape lost 30 of 130 units: `settleCycle` matches a
   * row's own `cycleId` against the cycle being settled, which is always
   * `lunar-`, so every row the Hearts economy wrote was simply absent from the
   * totals, and `dueCycles` never listed a Hearts-only lunation as due for
   * closing at all.
   */
  it("a settlement over rows from both doors counts every unit", async () => {
    const entries = await gratitudeLogRepo(pool).all();
    const [[row]] = await pool.query<any[]>("SELECT COALESCE(SUM(`amount`),0) AS s FROM `gratitude_log`");
    const inTheTable = Number(row.s);
    expect(inTheTable).toBe(100);

    const totals = settleCycle(entries as any, cycleIdFor());
    const settled = totals.reduce((n, t) => n + t.received, 0);
    // The number this test exists to state: nothing invisible.
    expect(inTheTable - settled).toBe(0);
    expect(settled).toBe(100);

    // And the lunation is offered for closing once it has ended.
    const fortyDaysOn = new Date(Date.now() + 40 * 24 * 60 * 60 * 1000);
    expect(dueCycles([], entries as any, fortyDaysOn).map((c) => c.id)).toEqual([cycleIdFor()]);
  });

  /**
   * The write path fills the integer twin 0010 added for exactly this reason.
   * Every row the Hearts economy has ever written carried NULL here.
   */
  it("every row carries the number as well as the name", async () => {
    const [[row]] = await pool.query<any[]>(
      "SELECT COUNT(*) AS n, COUNT(`cycle_number`) AS numbered FROM `gratitude_log`",
    );
    expect(Number(row.numbered)).toBe(Number(row.n));
    expect(Number(row.n)).toBeGreaterThan(0);
  });

  /** The engine's own window key is the same string the log carries. */
  it("the economy's cycle key and the gratitude cycle id are one string", () => {
    expect(cycleWindow().key).toBe(cycleIdFor());
  });

  /**
   * R73: the per-recipient rule is ONE rule over BOTH channels.
   *
   * The caps it replaced were per channel and counted different things, so a
   * heart could carry what an acknowledgment had just been refused. This holds
   * the two doors to one running total against one ceiling.
   *
   * Last in the file on purpose: it writes rows, and the settlement assertions
   * above count every row in the table.
   */
  it("holds one share against one person, whichever door the giving comes through", async () => {
    const giver = await makeMember("cyc-share-giver");
    const friend = await makeMember("cyc-share-friend");
    const other = await makeMember("cyc-share-other");

    const ack = (to: string, amount: number) =>
      sendGratitude(depsOver(pool), { fromUser: { id: giver, name: giver }, toId: to, amount, message: "thank you" });

    // 25% of an allowance of 100. A single send of the whole allowance to one
    // person is the thing the old sends cap permitted and this refuses.
    const all = await ack(friend, 100);
    expect(all.ok).toBe(false);
    expect(all.ok === false && all.error).toContain("gratitude.max_share_per_recipient");

    // Up to the share, in as many sends as the giver likes.
    expect((await ack(friend, 20)).ok).toBe(true);
    expect((await ack(friend, 5)).ok).toBe(true);
    const overByOne = await ack(friend, 1);
    expect(overByOne.ok).toBe(false);
    expect(overByOne.ok === false && overByOne.error).toContain("you have given them 25");

    // The other door reads the same running total and the same ceiling.
    const viaHearts = await give(
      pool,
      { fromUserId: giver, toUserId: friend, amount: 1, clientNonce: "share-cross" },
      async () => 1,
    );
    expect(viaHearts.ok).toBe(false);
    expect(viaHearts.ok === false && viaHearts.error).toContain("you have given them 25");

    // And somebody else is entirely unaffected: the ceiling is per pair.
    expect((await ack(other, 25)).ok).toBe(true);
  });

  /**
   * ONE ALLOWANCE, AFTER A REVERSAL, ASSERTED THROUGH BOTH DOORS.
   *
   * The same shape as this file's first test and one layer deeper. The two
   * doors agreed on the TOTAL after R73, and they still disagreed about what
   * was SPENT the moment a gift in the cycle was reversed: `budgetFor` was
   * `total - sum(gratitude_log)` with no reversal term, and `allowanceFor` is
   * `total - max(0, given - reversals)`. Reversing a gift refunded the
   * allowance through one and left it spent through the other.
   *
   * Nobody had to choose between them, because /profile renders BOTH: the
   * dashboard card says "Sending budget: N of 100 left this cycle" out of
   * `budgetFor` and the sheet says "You can still give N Gratitude this moon"
   * out of `allowanceFor`, with two different N on one page.
   *
   * The gift goes through the Hearts door because that is the door whose
   * ledger posting carries a `gratitude.given:` key, and that prefix is what
   * `allowanceFor` matches a reversal by.
   *
   * Last in the file, beside the other test that writes rows the settlement
   * assertions above do not expect.
   */
  it("gives one number through both doors after a gift in the cycle is reversed", async () => {
    const giver = await makeMember("cyc-rev-giver");
    const friend = await makeMember("cyc-rev-friend");

    // Both doors, asked the same question at the same moment. `depsOver`
    // resolves the multiplier as 1 and so does the second argument here, so
    // any difference between the two answers is the arithmetic and never the
    // stage.
    const bothDoors = async () => ({
      budget: await budgetFor(depsOver(pool), { id: giver, name: giver }),
      allowance: await allowanceFor(pool, giver, 1),
    });

    const gift = await give(
      pool,
      { fromUserId: giver, toUserId: friend, amount: 20, clientNonce: "rev-gift" },
      async () => 1,
    );
    expect(gift.ok).toBe(true);
    const noteId = gift.ok ? String(gift.noteId ?? "") : "";
    expect(noteId).not.toBe("");

    const spent = await bothDoors();
    expect(spent.budget.spent).toBe(20);
    expect(spent.budget.remaining).toBe(spent.allowance.remaining);

    // Undo it. A refund is always a reversal (a fresh mint would inherit none
    // of the ledger's guards), and the mirror carries its own key.
    const back = await reverse(pool, keys.gratitudeGiven(villageId(), noteId), {
      from: memberAccount(friend),
      to: RECOGNITION_FAUCET,
      tokenSlug: HEARTS,
      amount: 20,
      note: "given to the wrong person",
    });
    expect(back.ok).toBe(true);

    const after = await bothDoors();
    // The reversal hands the allowance back. This is `allowanceFor` doing what
    // its own comment promises: the subtraction stops counting the gift, with
    // nothing to remember to do.
    expect(after.allowance.spent).toBe(0);
    expect(after.allowance.remaining).toBe(after.allowance.total);

    // THE ASSERTION THIS TEST EXISTS FOR. Before the fix `budgetFor` still
    // read 20 spent and 80 remaining here, against 0 and 100 from the other
    // door, and the profile page printed both of them.
    expect(after.budget.total).toBe(after.allowance.total);
    expect(after.budget.spent).toBe(after.allowance.spent);
    expect(after.budget.remaining).toBe(after.allowance.remaining);
    // And the two names for the cycle are still one string, which is what
    // lets one of these be a rename of the other.
    expect(after.budget.cycleId).toBe(after.allowance.cycleKey);
  });
});
