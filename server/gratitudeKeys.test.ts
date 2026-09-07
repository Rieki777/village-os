/**
 * ONE GIFT, ONE KEY.
 *
 * The two gratitude doors used to post their ledger legs under two different
 * occurrence keys. `give()` wrote `keys.gratitudeGiven`, which is
 * `gratitude.given:<esc(village)>:<esc(noteId)>`. `sendGratitude()` wrote a
 * hand-built `gratitude_received:<noteId>` carrying no village.
 *
 * The allowance's refund arm rebuilds the first shape and keeps only the
 * reversal mirrors that match one, so a gift made through the acknowledgement
 * door could be reversed and refund the giver nothing: the member stayed out
 * that amount for the rest of the cycle and no surface reported it.
 *
 * Every case here reads its outcome out of the database. The refund cases are
 * written so that the wrong answer and the right one are DIFFERENT NUMBERS: a
 * gift that stays sits beside every gift that is undone, because with nothing
 * kept both answers floor at zero and the case would be green over the defect.
 *
 * Runs against the S5 harness: a scratch schema with every real migration
 * applied. No TEST_DATABASE_URL and it skips loudly rather than passing
 * hollowly.
 */
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import mysql from "mysql2/promise";
import fs from "node:fs";
import path from "node:path";
import {
  allowanceFor,
  give,
  HEARTS,
  keys,
  reverse,
  villageId,
  toLedgerUnits,
} from "./lib/economy";
import {
  balanceOf,
  checkLedgerInvariants,
  loadTokenRegistry,
  memberAccount,
  postTransfer,
  RECOGNITION_FAUCET,
} from "./lib/ledger";
import { loadVariables } from "./lib/variables";
import { provisionTestDb, testDbConfigured, type TestDb } from "./db/testDb";
import { splitStatements } from "./db/migrate";
import { sendGratitude, type GratitudeDeps } from "./lib/gratitude";
import { gratitudeLogRepo } from "./repos/gratitude";
import { cycleIdFor } from "./lib/gratitude-cycles";
import type { UsersRepo } from "./repos/users";

const configured = testDbConfigured();

/** The file under test, read off disk so the case runs what the fleet runs. */
const MIGRATION = path.join(process.cwd(), "drizzle", "0182_one_gift_one_key.sql");

const AT_GUEST = async () => 1;

describe.skipIf(!configured)("one gift, one key", () => {
  let db: TestDb;
  let pool: mysql.Pool;
  /** 10^decimals, read off the `tokens` row rather than from the converter. */
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

  /** The ledger row one posting wrote, found by its occurrence key. */
  const legFor = async (key: string) => {
    const [rows] = await pool.query<any[]>(
      "SELECT `amount`, `token_type`, `source`, `source_ref` FROM `token_ledger` WHERE `idempotency_key` = ?",
      [key],
    );
    return rows[0] ?? null;
  };

  const keyCount = async (key: string) => {
    const [rows] = await pool.query<any[]>(
      "SELECT COUNT(*) AS n FROM `token_ledger` WHERE `idempotency_key` = ?",
      [key],
    );
    return Number(rows[0].n);
  };

  /*
   * ── THE FIX, THROUGH THE DOOR THAT CARRIED THE DEFECT ──────────────────
   */

  it("refunds the giver when a gift made through the acknowledgement door is reversed", async () => {
    const from = await member("km-ack-from");
    const to = await member("km-ack-to");
    const deps = depsOver(pool);
    const fromUser = await deps.members.byId(from);

    // A gift that STAYS, so the allowance has something to clamp against.
    const kept = await sendGratitude(deps, { fromUser, toId: to, amount: 3, message: "for the water line" });
    expect(kept.ok, kept.ok === false ? kept.error : "").toBe(true);
    const undone = await sendGratitude(deps, { fromUser, toId: to, amount: 5, message: "for the fence" });
    expect(undone.ok, undone.ok === false ? undone.error : "").toBe(true);
    if (!undone.ok || !kept.ok) throw new Error("the acknowledgement door refused a valid send");

    expect((await allowanceFor(pool, from, 1)).spent).toBe(8);

    // The key the ALLOWANCE builds, handed to the reversal. This is the whole
    // case: before the fix no row answered to it and `reverse` refused.
    const key = keys.gratitudeGiven(villageId(), undone.entry.id);
    const back = await reverse(pool, key, {
      from: memberAccount(to),
      to: RECOGNITION_FAUCET,
      tokenSlug: HEARTS,
      amount: 5 * ONE,
    });
    expect(back.ok, back.ok === false ? back.error : "").toBe(true);

    // Read out of the database on both sides: the recipient holds only the
    // gift that stayed, and the giver has five of their allowance back.
    expect(await balanceOf(pool, memberAccount(to), HEARTS)).toBe(3 * ONE);
    const after = await allowanceFor(pool, from, 1);
    expect(after.spent).toBe(3);
    expect(after.remaining).toBe(after.total - 3);
  });

  it("refunds the giver and nobody else", async () => {
    const from = await member("km-iso-from");
    const other = await member("km-iso-other");
    const to = await member("km-iso-to");
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

    const back = await reverse(pool, keys.gratitudeGiven(villageId(), mine.entry.id), {
      from: memberAccount(to),
      to: RECOGNITION_FAUCET,
      tokenSlug: HEARTS,
      amount: 6 * ONE,
    });
    expect(back.ok, back.ok === false ? back.error : "").toBe(true);

    expect((await allowanceFor(pool, from, 1)).spent).toBe(0);
    // The other member's spend is untouched. A refund arm keyed on the gift
    // and not the giver hands this back to everybody at once.
    expect((await allowanceFor(pool, other, 1)).spent).toBe(4);
  });

  it("unwinds the per-recipient headroom with the refund", async () => {
    const from = await member("km-share-from");
    const to = await member("km-share-to");
    const deps = depsOver(pool);
    const fromUser = await deps.members.byId(from);

    const total = (await allowanceFor(pool, from, 1)).total;
    // The share cap at the stock dials, read off the allowance rather than
    // restated: a member may give one person at most this much in a cycle.
    const capped = await sendGratitude(deps, { fromUser, toId: to, amount: 20, message: "most of it" });
    expect(capped.ok, capped.ok === false ? capped.error : "").toBe(true);
    if (!capped.ok) throw new Error("the acknowledgement door refused a valid send");

    // At the cap, a second gift to the same person refuses.
    const refused = await sendGratitude(deps, { fromUser, toId: to, amount: 20, message: "and more" });
    expect(refused.ok).toBe(false);
    expect(refused.ok === false && refused.error).toMatch(/most you can give one person/);

    const back = await reverse(pool, keys.gratitudeGiven(villageId(), capped.entry.id), {
      from: memberAccount(to),
      to: RECOGNITION_FAUCET,
      tokenSlug: HEARTS,
      amount: 20 * ONE,
    });
    expect(back.ok, back.ok === false ? back.error : "").toBe(true);

    // The headroom came back with the budget. A refund that returned one and
    // not the other leaves a member unable to spend it on the person it came
    // back from.
    const again = await sendGratitude(deps, { fromUser, toId: to, amount: 20, message: "again" });
    expect(again.ok, again.ok === false ? again.error : "").toBe(true);
    expect((await allowanceFor(pool, from, 1)).spent).toBe(20);
    expect(total).toBeGreaterThan(0);
  });

  it("still refunds a gift made through the other door, which is the regression that matters", async () => {
    const from = await member("km-give-from");
    const to = await member("km-give-to");

    const kept = await give(pool, { fromUserId: from, toUserId: to, amount: 3 }, AT_GUEST);
    const undone = await give(pool, { fromUserId: from, toUserId: to, amount: 5 }, AT_GUEST);
    expect(kept.ok && undone.ok).toBe(true);
    expect((await allowanceFor(pool, from, 1)).spent).toBe(8);

    const back = await reverse(pool, keys.gratitudeGiven(villageId(), String(undone.noteId)), {
      from: memberAccount(to),
      to: RECOGNITION_FAUCET,
      tokenSlug: HEARTS,
      amount: 5 * ONE,
    });
    expect(back.ok, back.ok === false ? back.error : "").toBe(true);
    expect((await allowanceFor(pool, from, 1)).spent).toBe(3);
    expect(await balanceOf(pool, memberAccount(to), HEARTS)).toBe(3 * ONE);
  });

  it("keeps one village's reversed gift out of a member's allowance in another", async () => {
    const from = await member("km-village-from");
    const to = await member("km-village-to");
    const deps = depsOver(pool);

    const here = await sendGratitude(deps, {
      fromUser: await deps.members.byId(from),
      toId: to,
      amount: 5,
      message: "here",
    });
    expect(here.ok, here.ok === false ? here.error : "").toBe(true);
    if (!here.ok) throw new Error("the acknowledgement door refused a valid send");

    /*
     * THE SAME MEMBER'S GIFT IN A SECOND VILLAGE. `villageId()` is one
     * constant in this build, so the second village's note is a fixture row
     * and every movement of value still goes through the ledger's own doors:
     * `postTransfer` posts the leg under the key that village's builder would
     * produce, and `reverse` undoes it.
     */
    const elsewhere = "km-note-elsewhere";
    const otherVillage = "elsewhere";
    await pool.query(
      "INSERT INTO `gratitude_log` " + // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
        "(`id`, `village_id`, `kind`, `from_id`, `to_id`, `amount`, `message`, `cycle_id`) " +
        "VALUES (?,?,?,?,?,?,?,?)",
      [elsewhere, otherVillage, "gratitude", from, to, 9, "", cycleIdFor(new Date())],
    );
    const otherKey = keys.gratitudeGiven(otherVillage, elsewhere);
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

    /*
     * The member's spend in THIS village is 5, because the note in the other
     * village is not this village's note. This is asserted from the database
     * and not from the key's shape: the allowance is asked, and the number it
     * answers is the number a member reads.
     */
    const before = await allowanceFor(pool, from, 1);
    expect(before.spent).toBe(5);

    const backHere = await reverse(pool, keys.gratitudeGiven(villageId(), here.entry.id), {
      from: memberAccount(to),
      to: RECOGNITION_FAUCET,
      tokenSlug: HEARTS,
      amount: 5 * ONE,
    });
    expect(backHere.ok, backHere.ok === false ? backHere.error : "").toBe(true);

    // Five back, never fourteen. The other village's reversal is in the same
    // window and the same table and belongs to no allowance here.
    const after = await allowanceFor(pool, from, 1);
    expect(after.spent).toBe(0);
    expect(after.remaining).toBe(after.total);
  });

  it("round-trips a note id whose escaping changes its bytes", async () => {
    const from = await member("km-esc-from");
    const to = await member("km-esc-to");
    // A capital and a colon: `esc` rewrites both, so the key the ledger holds
    // is not the id with a prefix in front of it. The colon is the one that
    // would move a segment boundary if it went in raw.
    const noteId = "Grat:ESC-1";
    const key = keys.gratitudeGiven(villageId(), noteId);
    expect(key).not.toContain(noteId);

    await pool.query(
      "INSERT INTO `gratitude_log` " + // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
        "(`id`, `village_id`, `kind`, `from_id`, `to_id`, `amount`, `message`, `cycle_id`) " +
        "VALUES (?,?,?,?,?,?,?,?)",
      [noteId, villageId(), "gratitude", from, to, 7, "", cycleIdFor(new Date())],
    );
    const posted = await postTransfer(pool, {
      from: RECOGNITION_FAUCET,
      to: memberAccount(to),
      tokenType: HEARTS,
      amount: toLedgerUnits(HEARTS, 7),
      source: "gratitude_received",
      sourceRef: noteId,
      description: "escaped",
      idempotencyKey: key,
    });
    expect(posted.ok, posted.ok === false ? String(posted.error) : "").toBe(true);
    expect((await allowanceFor(pool, from, 1)).spent).toBe(7);

    const back = await reverse(pool, key, {
      from: memberAccount(to),
      to: RECOGNITION_FAUCET,
      tokenSlug: HEARTS,
      amount: toLedgerUnits(HEARTS, 7),
    });
    expect(back.ok, back.ok === false ? back.error : "").toBe(true);
    // The allowance rebuilt the escaped key from the id in the column and
    // matched the mirror that carries it.
    expect((await allowanceFor(pool, from, 1)).spent).toBe(0);
  });

  it("holds conservation and the boot invariants through all of it", async () => {
    const report = await checkLedgerInvariants(pool);
    expect(report.problems).toEqual([]);
  });

  /*
   * ── THE REPAIR, RUN RATHER THAN READ ───────────────────────────────────
   */

  describe("drizzle/0182_one_gift_one_key.sql", () => {
    /** Seeded note ids, one per case the file claims to handle. */
    const plain = "grat-1756000000000-abc123";
    const heart = "grat-1756000000001-def456";
    const escaped = "grat-1756000000002-QQQ999";
    const foreign = "grat-1756000000003-zzz111";
    const orphan = "grat-1756000000099-nonote";
    const already = "grat-1756000000004-yyy222";
    const mirrored = "grat-1756000000005-xxx333";

    const seedNote = async (id: string, village: string) => {
      await pool.query(
        "INSERT INTO `gratitude_log` " + // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
          "(`id`, `village_id`, `kind`, `from_id`, `to_id`, `amount`, `message`, `cycle_id`) " +
          "VALUES (?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE `village_id` = VALUES(`village_id`)",
        [id, village, "gratitude", "km-mig-from", "km-mig-to", 1, "", cycleIdFor(new Date())],
      );
    };

    /*
     * SEEDED THROUGH THE LEDGER'S OWN DOOR, never as a raw row. The releases
     * that wrote these keys are gone, so the KEY is chosen here, and every
     * unit of value still moves through `postTransfer` and `reverse`. A raw
     * INSERT would also fail the boot check outright: `checkLedgerInvariants`
     * compares `token_balances` against the summed ledger, and a row posted
     * behind the cache is drift by definition.
     */
    const rowIds = new Map<string, string>();
    const seedLeg = async (tag: string, source: string, ref: string, key: string) => {
      const posted = await postTransfer(pool, {
        from: RECOGNITION_FAUCET,
        to: memberAccount("km-mig-to"),
        tokenType: HEARTS,
        amount: toLedgerUnits(HEARTS, 1),
        source,
        sourceRef: ref,
        description: tag,
        idempotencyKey: key,
      });
      expect(posted.ok, posted.ok === false ? String(posted.error) : "").toBe(true);
      const [rows] = await pool.query<any[]>(
        "SELECT `id` FROM `token_ledger` WHERE `idempotency_key` = ?",
        [key],
      );
      rowIds.set(tag, String(rows[0].id));
    };

    const keyOf = async (tag: string) => {
      const [rows] = await pool.query<any[]>(
        "SELECT `idempotency_key` AS k FROM `token_ledger` WHERE `id` = ?",
        [rowIds.get(tag)],
      );
      return String(rows[0]?.k ?? "");
    };

    /** The file, split the way `server/db/migrate.ts` splits it at boot. */
    const runMigration = async (): Promise<number> => {
      const statements = splitStatements(fs.readFileSync(MIGRATION, "utf8"));
      expect(statements.length).toBe(1);
      let changed = 0;
      for (const s of statements) {
        const [res] = await pool.query<any>(s);
        changed += Number(res.changedRows ?? 0);
      }
      return changed;
    };

    beforeAll(async () => {
      await member("km-mig-from");
      await member("km-mig-to");
      await seedNote(plain, villageId());
      await seedNote(heart, villageId());
      await seedNote(escaped, villageId());
      await seedNote(foreign, "Elsewhere:North");
      await seedNote(already, villageId());
      await seedNote(mirrored, villageId());

      await seedLeg("km-l1", "gratitude_received", plain, `gratitude_received:${plain}`);
      await seedLeg("km-l2", "heart_received", heart, `gratitude_received:${heart}`);
      await seedLeg("km-l3", "gratitude_received", escaped, `gratitude_received:${escaped}`);
      await seedLeg("km-l4", "gratitude_received", foreign, `gratitude_received:${foreign}`);
      await seedLeg("km-l5", "gratitude_received", orphan, `gratitude_received:${orphan}`);
      await seedLeg("km-l6", "gratitude_received", already, keys.gratitudeGiven(villageId(), already));
      await seedLeg("km-l7", "gratitude_received", mirrored, `gratitude_received:${mirrored}`);

      // A REAL mirror, written by `reverse` against the old-shape key, so the
      // case the file refuses is the one the ledger would actually hold.
      const undone = await reverse(pool, `gratitude_received:${mirrored}`, {
        from: memberAccount("km-mig-to"),
        to: RECOGNITION_FAUCET,
        tokenSlug: HEARTS,
        amount: toLedgerUnits(HEARTS, 1),
      });
      expect(undone.ok, undone.ok === false ? undone.error : "").toBe(true);
      const [mirrorRows] = await pool.query<any[]>(
        "SELECT `id` FROM `token_ledger` WHERE `source` = 'reversal' AND `source_ref` = ?",
        [`gratitude_received:${mirrored}`],
      );
      rowIds.set("km-l8", String(mirrorRows[0].id));
    });

    it("rewrites both kinds of gift the acknowledgement door wrote", async () => {
      const changed = await runMigration();
      expect(changed).toBe(2);
      expect(await keyOf("km-l1")).toBe(keys.gratitudeGiven(villageId(), plain));
      expect(await keyOf("km-l2")).toBe(keys.gratitudeGiven(villageId(), heart));
      // The note is still findable from the row, which is what the ledger's
      // own gratitude join reads.
      expect(String((await legFor(keys.gratitudeGiven(villageId(), plain))).source_ref)).toBe(plain);
    });

    it("refuses the rows it cannot attribute and leaves them exactly as they were", async () => {
      // An id the escape rewrites. Repairing it by carrying the id through
      // unchanged would write a key `keys.gratitudeGiven` can never build,
      // which is the defect again in a new spelling.
      expect(await keyOf("km-l3")).toBe(`gratitude_received:${escaped}`);
      // A village id the escape rewrites, same reason.
      expect(await keyOf("km-l4")).toBe(`gratitude_received:${foreign}`);
      // A row whose `source_ref` names no note. `token_ledger` has no village
      // column, so the note is the only witness to which village it belonged
      // to and there is none.
      expect(await keyOf("km-l5")).toBe(`gratitude_received:${orphan}`);
      // A gift that already has a reversal mirror. Renaming the original out
      // from under the stored mirror would let a second reversal of the same
      // gift collide with nothing and debit the recipient twice.
      expect(await keyOf("km-l7")).toBe(`gratitude_received:${mirrored}`);
      expect(await keyOf("km-l8")).toBe(`reversal:${villageId()}:gratitude_received:${mirrored}`);
    });

    it("leaves a row already in the new shape alone", async () => {
      expect(await keyOf("km-l6")).toBe(keys.gratitudeGiven(villageId(), already));
      expect(await keyCount(keys.gratitudeGiven(villageId(), already))).toBe(1);
    });

    it("is a no-op on a second run", async () => {
      const before = await Promise.all(
        ["km-l1", "km-l2", "km-l3", "km-l4", "km-l5", "km-l6", "km-l7", "km-l8"].map(keyOf),
      );
      const changed = await runMigration();
      expect(changed).toBe(0);
      const after = await Promise.all(
        ["km-l1", "km-l2", "km-l3", "km-l4", "km-l5", "km-l6", "km-l7", "km-l8"].map(keyOf),
      );
      expect(after).toEqual(before);
    });

    it("finds every row it refused with the one query the document names", async () => {
      const [rows] = await pool.query<any[]>(
        "SELECT `source_ref` AS ref FROM `token_ledger` WHERE `idempotency_key` LIKE 'gratitude_received:%'",
      );
      // The four refusals and nothing else. The mirror is not among them: its
      // own key begins `reversal:`, so the shape that finds a leftover gift
      // does not also collect the clawbacks of one.
      expect(rows.map((r) => String(r.ref)).sort()).toEqual([escaped, foreign, mirrored, orphan].sort());
    });

    it("moves no value, so conservation is the same number after it as before", async () => {
      const report = await checkLedgerInvariants(pool);
      expect(report.problems).toEqual([]);
    });
  });
});
