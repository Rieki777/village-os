/**
 * A REVERSED GIFT REFUNDS ITS GIVER, THROUGH EITHER DOOR, AND NOBODY ELSE.
 *
 * Two doors write a gratitude gift. `give()` posts its ledger leg under
 * `keys.gratitudeGiven`; `sendGratitude()`, the acknowledgement door, posts
 * under a hand-built `gratitude_received:<noteId>`. The allowance used to find
 * reversals by matching the first shape as a key prefix, so a gift made through
 * the acknowledgement door could be reversed and refund its giver nothing.
 *
 * Two fixes were written for that, one on each branch. The economics branch
 * rewrote the door's key to the first shape and repaired old rows with a
 * migration; main's #233 walked every reversal back through the posting it
 * undoes to the note it delivered (`REVERSED_GRATITUDE_FROM`, server/repos/
 * gratitude.ts), which reaches both shapes with no rename at all. Main's design
 * is the one that landed, and the migration was retired before it shipped: it
 * renamed the postings and not the mirrors whose `source_ref` points at them,
 * which would have cut every historical reversal from this door out of the join.
 *
 * server/lib/economy.allowance.test.ts is #233's own proof and covers the rule
 * for one giver, the cycle a refund belongs to, both doors, and the settlement.
 * These are the cases it does not reach: that a refund through the
 * acknowledgement door stays with its giver, that the PER-RECIPIENT share cap
 * unwinds with it (`writeGratitudeRow` weighs that under its lock), that
 * another village's reversal never reaches this one, and that conservation
 * holds through all of it. Each reverses the acknowledgement door's gifts by the
 * key that door really writes, so none of them can pass by accident of shape.
 *
 * Every refund case keeps a gift beside the one it undoes, so the wrong answer
 * and the right one are different numbers. With nothing kept, both would floor
 * at zero and the case would be green over the defect.
 *
 * Runs against the S5 harness: a scratch schema with every real migration
 * applied. No TEST_DATABASE_URL and it skips loudly rather than passing
 * hollowly.
 */
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import mysql from "mysql2/promise";
import { allowanceFor, HEARTS, reverse, toLedgerUnits } from "./lib/economy";
import {
  checkLedgerInvariants,
  loadTokenRegistry,
  memberAccount,
  postTransfer,
  RECOGNITION_FAUCET,
} from "./lib/ledger";
import { loadVariables } from "./lib/variables";
import { provisionTestDb, testDbConfigured, type TestDb } from "./db/testDb";
import { sendGratitude, type GratitudeDeps } from "./lib/gratitude";
import { gratitudeLogRepo } from "./repos/gratitude";
import { cycleIdFor } from "./lib/gratitude-cycles";
import type { UsersRepo } from "./repos/users";

const configured = testDbConfigured();

/** The key the acknowledgement door writes. Spelled here, asserted by use. */
const ackKey = (noteId: string) => `gratitude_received:${noteId}`;

describe.skipIf(!configured)("a reversed gift refunds its giver", () => {
  let db: TestDb;
  let pool: mysql.Pool;
  let ONE = 1;

  beforeAll(async () => {
    db = await provisionTestDb();
    pool = mysql.createPool({ uri: db.url, timezone: "Z", connectionLimit: 10 });
    await loadTokenRegistry(pool);
    await loadVariables(pool);
    const [rows] = await pool.query<any[]>("SELECT `decimals` FROM `tokens` WHERE `slug` = ?", [HEARTS]);
    ONE = 10 ** Number(rows[0]?.decimals ?? 0);
  });

  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  const member = async (id: string): Promise<string> => {
    await pool.query(
      "INSERT INTO `users` (`id`, `name`, `email`, `password_hash`) VALUES (?,?,?,'x') " + // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
        "ON DUPLICATE KEY UPDATE `name` = VALUES(`name`)",
      [id, id, `${id}@examples.invalid`],
    );
    await pool.query(
      "INSERT IGNORE INTO `ledger_accounts` (`id`, `kind`, `user_id`, `label`, `faucet`) VALUES (?,?,?,?,0)", // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
      [memberAccount(id), "member", id, id],
    );
    return id;
  };

  const depsOver = (p: mysql.Pool): GratitudeDeps => {
    const load = async (where: string, v: string) => {
      const [rows] = await p.query<any[]>(`SELECT * FROM \`users\` WHERE ${where} = ? LIMIT 1`, [v]);
      return rows[0] ?? null;
    };
    const members: UsersRepo = {
      async all() {
        const [rows] = await p.query<any[]>("SELECT * FROM `users`");
        return rows as any;
      },
      async byId(id: string) {
        return load("`id`", id);
      },
      async byEmail(email: string) {
        return load("`email`", email);
      },
      async update() {
        return undefined as any;
      },
    } as any;
    return {
      pool: p,
      log: gratitudeLogRepo(p),
      members,
      stageMultiplierFor: async () => 1,
    };
  };

  it("refunds the giver and nobody else, through the acknowledgement door", async () => {
    const from = await member("gr-iso-from");
    const other = await member("gr-iso-other");
    const to = await member("gr-iso-to");
    const deps = depsOver(pool);

    const mine = await sendGratitude(deps, {
      fromUser: await deps.members.byId(from),
      toId: to,
      amount: 6,
      message: "mine",
    });
    const theirs = await sendGratitude(deps, {
      fromUser: await deps.members.byId(other),
      toId: to,
      amount: 4,
      message: "theirs",
    });
    expect(mine.ok && theirs.ok).toBe(true);
    if (!mine.ok || !theirs.ok) throw new Error("the acknowledgement door refused a valid send");

    expect((await allowanceFor(pool, other, 1)).spent).toBe(4);

    const back = await reverse(pool, ackKey(mine.entry.id), {
      from: memberAccount(to),
      to: RECOGNITION_FAUCET,
      tokenSlug: HEARTS,
      amount: 6 * ONE,
    });
    expect(back.ok, back.ok === false ? back.error : "").toBe(true);

    expect((await allowanceFor(pool, from, 1)).spent).toBe(0);
    // The member who did nothing keeps exactly what they spent. The old sum
    // filtered on neither giver nor gift and would have moved this to zero.
    expect((await allowanceFor(pool, other, 1)).spent).toBe(4);
  });

  it("unwinds the per-recipient headroom with the refund", async () => {
    const from = await member("gr-share-from");
    const to = await member("gr-share-to");
    const deps = depsOver(pool);
    const fromUser = await deps.members.byId(from);

    const total = (await allowanceFor(pool, from, 1)).total;
    const capped = await sendGratitude(deps, { fromUser, toId: to, amount: 20, message: "most of it" });
    expect(capped.ok, capped.ok === false ? capped.error : "").toBe(true);
    if (!capped.ok) throw new Error("the acknowledgement door refused a valid send");

    // The share cap refuses a second gift to the same person, which is the
    // limit the reversal below has to lift.
    const refused = await sendGratitude(deps, { fromUser, toId: to, amount: 20, message: "and more" });
    expect(refused.ok).toBe(false);
    expect(refused.ok === false && refused.error).toMatch(/most you can give one person/);

    const back = await reverse(pool, ackKey(capped.entry.id), {
      from: memberAccount(to),
      to: RECOGNITION_FAUCET,
      tokenSlug: HEARTS,
      amount: 20 * ONE,
    });
    expect(back.ok, back.ok === false ? back.error : "").toBe(true);

    const again = await sendGratitude(deps, { fromUser, toId: to, amount: 20, message: "again" });
    expect(again.ok, again.ok === false ? again.error : "").toBe(true);
    expect((await allowanceFor(pool, from, 1)).spent).toBe(20);
    expect(total).toBeGreaterThan(0);
  });

  it("keeps one village's reversed gift out of a member's allowance in another", async () => {
    const from = await member("gr-village-from");
    const to = await member("gr-village-to");
    const deps = depsOver(pool);

    const here = await sendGratitude(deps, {
      fromUser: await deps.members.byId(from),
      toId: to,
      amount: 5,
      message: "here",
    });
    expect(here.ok, here.ok === false ? here.error : "").toBe(true);
    if (!here.ok) throw new Error("the acknowledgement door refused a valid send");

    // The same giver and recipient, a note in ANOTHER village, posted and
    // reversed for real. The join reaches it; the village filter must not.
    const elsewhere = "gr-note-elsewhere";
    const otherVillage = "elsewhere";
    await pool.query(
      "INSERT INTO `gratitude_log` " + // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
        "(`id`, `village_id`, `kind`, `from_id`, `to_id`, `amount`, `message`, `cycle_id`) " +
        "VALUES (?,?,?,?,?,?,?,?)",
      [elsewhere, otherVillage, "gratitude", from, to, 9, "", cycleIdFor(new Date())],
    );
    const otherKey = ackKey(elsewhere);
    const posted = await postTransfer(pool, {
      from: RECOGNITION_FAUCET,
      to: memberAccount(to),
      tokenType: HEARTS,
      amount: toLedgerUnits(HEARTS, 9),
      source: "gratitude_received",
      sourceRef: elsewhere,
      description: "elsewhere",
      idempotencyKey: otherKey,
    });
    expect(posted.ok, posted.ok === false ? String(posted.error) : "").toBe(true);
    const backThere = await reverse(pool, otherKey, {
      from: memberAccount(to),
      to: RECOGNITION_FAUCET,
      tokenSlug: HEARTS,
      amount: toLedgerUnits(HEARTS, 9),
    });
    expect(backThere.ok, backThere.ok === false ? backThere.error : "").toBe(true);

    const before = await allowanceFor(pool, from, 1);
    expect(before.spent).toBe(5);

    const backHere = await reverse(pool, ackKey(here.entry.id), {
      from: memberAccount(to),
      to: RECOGNITION_FAUCET,
      tokenSlug: HEARTS,
      amount: 5 * ONE,
    });
    expect(backHere.ok, backHere.ok === false ? backHere.error : "").toBe(true);

    const after = await allowanceFor(pool, from, 1);
    expect(after.spent).toBe(0);
    expect(after.remaining).toBe(after.total);
  });

  it("holds conservation and the boot invariants through all of it", async () => {
    const report = await checkLedgerInvariants(pool);
    expect(report.problems).toEqual([]);
  });
});
