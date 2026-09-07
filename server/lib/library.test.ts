/**
 * The library's five posting legs, and the two readers that carry a ledger
 * figure back out to a person, proved at BOTH scales the token can carry.
 *
 * Why this file exists. The library credit economy is internally closed:
 * appraisal in, award out, escrow held, fee to the pool, remainder released.
 * Every number in that chain is the same unit as every other, so flipping
 * `tokens.decimals` to 4 produces no arithmetic mismatch inside the module and
 * trips no invariant. It produces a silent misvaluation by the whole scale
 * factor, and the only assertions that existed read `/api/game/ledger`, which
 * returns the raw minor column. Those stay green through the entire bug.
 *
 * So the suite runs the same scenarios twice, against a REAL schema, once with
 * `library-credit` at decimals 0 and once at 4, with the flip performed the way
 * the migration will perform it: the registry row and the ledger rescaled in
 * one step, and `library_loans.escrow_credits` deliberately left alone. That
 * last omission is the decision this module is making out loud. The mirror
 * column holds whole credits, so it needs no backfill, and a loan opened
 * before the flip must still reconcile after it. One is carried across on
 * purpose to prove it.
 *
 * Every expected minor number here is derived from the scale the test itself
 * set, never from `toLedgerUnits`, so a conversion that is wrong in the same
 * direction in both places cannot green this file.
 */
import mysql from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { provisionTestDb, testDbConfigured, type TestDb } from "../db/testDb";
import {
  balanceOf,
  checkLedgerInvariants,
  loadTokenRegistry,
  memberAccount,
  MINT_FAUCET,
  TREASURY,
} from "./ledger";
import { loadVariables, setVariable } from "./variables";
import {
  approveIntake,
  assertLibraryInvariants,
  ensureLibraryToken,
  escrowFor,
  escrowReconciliation,
  LIBRARY_CREDIT,
  LIBRARY_ESCROW,
  LIBRARY_MINT,
  LIBRARY_POOL,
  recordIntake,
  reserveItem,
  settleLoan,
  supplyVsBacking,
} from "./library";

const configured = testDbConfigured();

describe.skipIf(!configured)("the material library, in the units the ledger actually holds", () => {
  let db: TestDb;
  let pool: mysql.Pool;
  /** Reserved at decimals 0 in the second phase's setup, then carried across the flip. */
  let carriedLoanId = "";

  /** The scale, read off the `tokens` ROW. Never through the code under test. */
  const decimalsOnTheRow = async (): Promise<number> => {
    const [[r]] = await pool.query<any[]>("SELECT decimals FROM tokens WHERE slug = ?", [LIBRARY_CREDIT]);
    return Number(r.decimals);
  };

  const member = async (id: string): Promise<string> => {
    await pool.query( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
      "INSERT INTO users (id, name, email, password_hash) VALUES (?,?,?,?)",
      [id, id, `${id}@example.test`, "h"],
    );
    return id;
  };

  /** The ledger row a leg wrote, by its idempotency key, or null if it never posted. */
  const postedUnits = async (key: string): Promise<number | null> => {
    const [rows] = await pool.query<any[]>("SELECT amount FROM token_ledger WHERE idempotency_key = ?", [key]);
    return rows.length ? Number(rows[0].amount) : null;
  };

  /** The stored mirror of the escrow leg, straight off the column. */
  const storedEscrow = async (loanId: string): Promise<number> => {
    const [[r]] = await pool.query<any[]>("SELECT escrow_credits FROM library_loans WHERE id = ?", [loanId]);
    return Number(r.escrow_credits);
  };

  const held = (userId: string) => balanceOf(pool, memberAccount(userId), LIBRARY_CREDIT);

  beforeAll(async () => {
    db = await provisionTestDb();
    pool = mysql.createPool({ uri: db.url, timezone: "Z", connectionLimit: 6 }); // module-review-ok: the S5 scratch-schema harness pool, the ballots.test.ts shape
    await ensureLibraryToken(pool);
    await loadTokenRegistry(pool);
    await loadVariables(pool);
  });

  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  /**
   * One scenario set, parameterised by the scale the registry is holding.
   *
   * `scale` is written as an exponent here on purpose: the expected minor
   * numbers are arithmetic this file does, so the file can disagree with the
   * module. Every scenario also re-reads `tokens.decimals` and asserts the
   * phase is really at the scale it claims, because a flip that silently did
   * not happen would otherwise make the second pass a copy of the first.
   */
  const scenarios = (tag: string, dec: number) => {
    const scale = 10 ** dec;

    it(`${tag}: an intake award posts the credits the donor was quoted, times the token's scale`, async () => {
      expect(await decimalsOnTheRow()).toBe(dec);
      const donor = await member(`lib-donor-${tag}`);
      const r = await recordIntake(pool, {
        name: `Wheelbarrow ${tag}`, appraisal: 100, donorUserId: donor, recordedBy: null,
      });
      if (!r.ok) throw new Error(r.error);
      // What a steward reads stays in credits at either scale: 75% of 100.
      expect(r.award).toBe(75);
      expect(r.pendingSecondSignoff).toBe(false);
      // What the ledger holds is that number at the token's own resolution.
      expect(await postedUnits(`intake:${r.itemId}`)).toBe(75 * scale);
      expect(await held(donor)).toBe(75 * scale);
      // And the appraisal is stored as the steward typed it, never scaled.
      const [[item]] = await pool.query<any[]>("SELECT credit_value FROM library_items WHERE id = ?", [r.itemId]);
      expect(Number(item.credit_value)).toBe(100);
    });

    it(`${tag}: the dual-signed award posts at the same scale, and nothing moves before the second signature`, async () => {
      const donor = await member(`lib-donor2-${tag}`);
      const big = await recordIntake(pool, {
        name: `Chainsaw ${tag}`, appraisal: 300, donorUserId: donor, recordedBy: "steward-one",
      });
      if (!big.ok) throw new Error(big.error);
      expect(big.pendingSecondSignoff).toBe(true);
      expect(big.award).toBe(0);
      // An empty state and a real zero are different facts, so read the row.
      expect(await postedUnits(`intake:${big.itemId}`)).toBeNull();
      expect(await held(donor)).toBe(0);

      const approved = await approveIntake(pool, big.itemId, "steward-two");
      if (!approved.ok) throw new Error(approved.error);
      expect(approved.award).toBe(225);
      expect(await postedUnits(`intake:${big.itemId}`)).toBe(225 * scale);
      expect(await held(donor)).toBe(225 * scale);
    });

    it(`${tag}: the per-member cap compares credits against credits, so one award cannot lock the donor out`, async () => {
      const donor = await member(`lib-capped-${tag}`);
      const set = await setVariable(pool, "library.intake_member_cycle_cap", "200");
      expect(set.ok).toBe(true);
      try {
        const first = await recordIntake(pool, {
          name: `Spade ${tag}`, appraisal: 100, donorUserId: donor, recordedBy: null,
        });
        if (!first.ok) throw new Error(first.error);
        expect(first.award).toBe(75);

        // THE LOCKOUT. The cap reads a SUM over `token_ledger.amount` and
        // compares it against a dial whose unit is credits. Left raw, one
        // 75-credit award leaves 750000 against a cap of 200 at 4 decimals,
        // and every later intake in the lunation is refused.
        const second = await recordIntake(pool, {
          name: `Rake ${tag}`, appraisal: 100, donorUserId: donor, recordedBy: null,
        });
        if (!second.ok) throw new Error(second.error);
        expect(second.award).toBe(75);
        expect(await held(donor)).toBe(150 * scale);

        // And it still BITES, at the number a steward typed, in the sentence
        // that steward reads.
        const third = await recordIntake(pool, {
          name: `Hoe ${tag}`, appraisal: 100, donorUserId: donor, recordedBy: null,
        });
        expect(third.ok).toBe(false);
        if (third.ok) throw new Error("the intake cap did not bite");
        expect(third.error).toContain("150 of 200");
        // A refused intake creates no item, so the shelves never learned of it.
        const [[cnt]] = await pool.query<any[]>(
          "SELECT COUNT(*) AS n FROM library_items WHERE name = ?", [`Hoe ${tag}`],
        );
        expect(Number(cnt.n)).toBe(0);
      } finally {
        await setVariable(pool, "library.intake_member_cycle_cap", "500");
      }
    });

    it(`${tag}: a reserve posts the escrow at scale, the loan's mirror stays in credits, and the return reverses the same minor number`, async () => {
      const borrower = await member(`lib-borrower-${tag}`);
      const funded = await recordIntake(pool, {
        name: `Ladder ${tag}`, appraisal: 200, donorUserId: borrower, recordedBy: null,
      });
      if (!funded.ok) throw new Error(funded.error);
      expect(funded.award).toBe(150);

      const shelfDonor = await member(`lib-shelf-${tag}`);
      const shelved = await recordIntake(pool, {
        name: `Barrow ${tag}`, appraisal: 100, donorUserId: shelfDonor, recordedBy: null,
      });
      if (!shelved.ok) throw new Error(shelved.error);
      // 25% of 100, and the member is quoted this number.
      expect(escrowFor(100)).toBe(25);

      const before = await escrowReconciliation(pool);
      expect(before.ok).toBe(true);
      const poolBefore = await balanceOf(pool, LIBRARY_POOL, LIBRARY_CREDIT);

      const reserved = await reserveItem(pool, { itemId: shelved.itemId, userId: borrower });
      if (!reserved.ok) throw new Error(reserved.error);
      expect(reserved.escrow).toBe(25);
      // THE DECISION, asserted rather than assumed: the stored mirror of a
      // posted leg holds whole credits at BOTH scales, so the flip migration
      // has nothing to backfill on this column.
      expect(await storedEscrow(reserved.loanId)).toBe(25);
      expect(await postedUnits(`loan:${reserved.loanId}:escrow`)).toBe(25 * scale);
      expect(await held(borrower)).toBe(125 * scale);
      expect(await balanceOf(pool, LIBRARY_ESCROW, LIBRARY_CREDIT)).toBe(before.actual + 25 * scale);

      const holding = await escrowReconciliation(pool);
      expect(holding.ok).toBe(true);
      expect(holding.expected).toBe(holding.actual);
      expect(holding.actual - before.actual).toBe(25 * scale);
      // Both figures leave the process in minor units, so the scale leaves
      // with them. The admin panel spreads this object straight into its
      // payload and has no other way to learn it.
      expect(holding.decimals).toBe(dec);
      // The boot invariant, with a loan open, at this scale.
      await expect(assertLibraryInvariants(pool)).resolves.toBeUndefined();

      // The return: computed wear is 5% of 100, so 5 to the pool and 20 back.
      const settled = await settleLoan(pool, { loanId: reserved.loanId, outcome: "closed" });
      if (!settled.ok) throw new Error(settled.error);
      expect(settled.wearFee).toBe(5);
      expect(settled.damageFee).toBe(0);
      expect(settled.released).toBe(20);
      const feeUnits = await postedUnits(`loan:${reserved.loanId}:settle:pool`);
      const releaseUnits = await postedUnits(`loan:${reserved.loanId}:settle:release`);
      expect(feeUnits).toBe(5 * scale);
      expect(releaseUnits).toBe(20 * scale);
      // The two legs out are the leg in, TO THE UNIT. A conversion applied to
      // one leg and not the other strands the difference in an account nobody
      // owns, which is what the boot invariant refuses to serve over.
      expect(Number(feeUnits) + Number(releaseUnits)).toBe(await postedUnits(`loan:${reserved.loanId}:escrow`));
      expect(await held(borrower)).toBe(145 * scale);
      expect((await balanceOf(pool, LIBRARY_POOL, LIBRARY_CREDIT)) - poolBefore).toBe(5 * scale);

      const after = await escrowReconciliation(pool);
      expect(after.actual).toBe(before.actual);
      expect(after.expected).toBe(before.expected);
      expect(after.ok).toBe(true);
      expect((await checkLedgerInvariants(pool)).problems).toEqual([]);
    });

    it(`${tag}: supplyVsBacking reports credits, so the over-issuance flag still means something`, async () => {
      // Nothing in this suite sells library credit, so the two exchange-side
      // provenances are empty and the mint account carries the whole issue.
      // Stating it makes the arithmetic below readable instead of magic.
      expect(await balanceOf(pool, MINT_FAUCET, LIBRARY_CREDIT)).toBe(0);
      expect(await balanceOf(pool, TREASURY, LIBRARY_CREDIT)).toBe(0);

      const [[minted]] = await pool.query<any[]>(
        "SELECT COALESCE(SUM(CASE WHEN from_account = ? THEN amount ELSE 0 END),0) " +
          "- COALESCE(SUM(CASE WHEN to_account = ? THEN amount ELSE 0 END),0) AS s " +
          "FROM token_ledger WHERE token_type = ?",
        [LIBRARY_MINT, LIBRARY_MINT, LIBRARY_CREDIT],
      );
      const outstandingUnits = Number(minted.s);
      const [[shelves]] = await pool.query<any[]>(
        "SELECT COALESCE(SUM(credit_value),0) AS s FROM library_items WHERE status <> 'written_off' AND is_example = 0",
      );

      const supply = await supplyVsBacking(pool);
      // The ledger's own figure over the token's scale, and the shelves in the
      // unit a steward appraised them in.
      expect(supply.outstanding).toBe(outstandingUnits / scale);
      expect(supply.shelfBacked).toBe(outstandingUnits / scale);
      expect(supply.sold).toBe(0);
      expect(supply.backing).toBe(Number(shelves.s));
      // Intake pays 75% of an appraisal, so the shelves cover the door's
      // issue. Compared raw, `outstanding` is the whole scale factor above
      // `backing` at 4 decimals and the alarm is red forever, which is the
      // same as having no alarm.
      expect(supply.outstanding).toBeLessThan(supply.backing);
      expect(supply.flagged).toBe(false);

      // The positive control: the flag is not merely stuck at false. Take the
      // shelves away and the credits already issued stop being backed.
      const [rows] = await pool.query<any[]>("SELECT id, status FROM library_items");
      await pool.query("UPDATE library_items SET status = 'written_off' WHERE status <> 'written_off'");
      try {
        const bare = await supplyVsBacking(pool);
        expect(bare.backing).toBe(0);
        expect(bare.outstanding).toBeGreaterThan(0);
        expect(bare.flagged).toBe(true);
      } finally {
        for (const r of rows) {
          await pool.query("UPDATE library_items SET status = ? WHERE id = ?", [String(r.status), String(r.id)]);
        }
      }
      const restored = await supplyVsBacking(pool);
      expect(restored.backing).toBe(Number(shelves.s));
      expect(restored.flagged).toBe(false);
    });
  };

  describe("at decimals 0, where a credit and a minor unit are the same number", () => {
    /*
     * THE SCALE IS SET HERE AND NO LONGER INHERITED. This block used to lean on
     * library credits happening to carry 0, which the 2026-09-04 scale ruling
     * ended: a credit token is currency-like and `0184` gives it two places.
     * Leaning on a platform default made this block silently change what it was
     * asking the day that default moved, so it now names the scale it is about.
     */
    beforeAll(async () => {
      await pool.query("UPDATE tokens SET decimals = 0 WHERE slug = ?", [LIBRARY_CREDIT]); // module-review-ok: the decimals seam this block exists to exercise, against the S5 scratch schema
      await loadTokenRegistry(pool);
    });
    scenarios("d0", 0);
  });

  describe("at decimals 4, a scale no token ships at, which is what makes it a test", () => {
    beforeAll(async () => {
      // The pre-flip scale, set rather than inherited, so this block does not
      // depend on which block ran before it.
      await pool.query("UPDATE tokens SET decimals = 0 WHERE slug = ?", [LIBRARY_CREDIT]); // module-review-ok: the decimals seam this block exists to exercise, against the S5 scratch schema
      await loadTokenRegistry(pool);
      // A loan opened at the OLD scale, so the flip has something live to
      // survive. This is the state a rescaling migration meets in a seeded fork.
      const donor = await member("lib-carried-donor");
      const shelved = await recordIntake(pool, {
        name: "Carried barrow", appraisal: 100, donorUserId: donor, recordedBy: null,
      });
      if (!shelved.ok) throw new Error(shelved.error);
      const borrower = await member("lib-carried-borrower");
      const funded = await recordIntake(pool, {
        name: "Carried ladder", appraisal: 200, donorUserId: borrower, recordedBy: null,
      });
      if (!funded.ok) throw new Error(funded.error);
      const reserved = await reserveItem(pool, { itemId: shelved.itemId, userId: borrower });
      if (!reserved.ok) throw new Error(reserved.error);
      carriedLoanId = reserved.loanId;

      // THE RESCALE, done the only way it is ever safe: the registry row and
      // every holding move together, in one step, and the module's own mirror
      // column is deliberately untouched. `0184` refuses instead of doing this,
      // because it cannot know what a fork holds; a village that DID hold rows
      // would have to move them exactly like this.
      await pool.query("UPDATE tokens SET decimals = 4 WHERE slug = ?", [LIBRARY_CREDIT]);
      await pool.query("UPDATE token_ledger SET amount = amount * 10000 WHERE token_type = ?", [LIBRARY_CREDIT]);
      await pool.query("UPDATE token_balances SET balance = balance * 10000 WHERE token_type = ?", [LIBRARY_CREDIT]);
      await loadTokenRegistry(pool);
    });

    it("a loan opened before the flip still reconciles after it, with no backfill on escrow_credits", async () => {
      expect(await decimalsOnTheRow()).toBe(4);
      // The column did not move and was never meant to.
      expect(await storedEscrow(carriedLoanId)).toBe(25);
      // The leg did move, with every other holding.
      expect(await postedUnits(`loan:${carriedLoanId}:escrow`)).toBe(25 * 10 ** 4);

      const rec = await escrowReconciliation(pool);
      expect(rec.expected).toBe(25 * 10 ** 4);
      expect(rec.actual).toBe(25 * 10 ** 4);
      expect(rec.decimals).toBe(4);
      expect(rec.ok).toBe(true);
      await expect(assertLibraryInvariants(pool)).resolves.toBeUndefined();
      expect((await checkLedgerInvariants(pool)).problems).toEqual([]);

      // Settle it so the rest of this phase starts from an empty escrow.
      const done = await settleLoan(pool, { loanId: carriedLoanId, outcome: "cancelled" });
      if (!done.ok) throw new Error(done.error);
      expect(done.released).toBe(25);
      expect(await postedUnits(`loan:${carriedLoanId}:settle:release`)).toBe(25 * 10 ** 4);
      expect(await balanceOf(pool, LIBRARY_ESCROW, LIBRARY_CREDIT)).toBe(0);
      expect((await escrowReconciliation(pool)).ok).toBe(true);
    });

    scenarios("d4", 4);
  });
});
