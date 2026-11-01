/**
 * NOTHING PAYS, OR IS OWED TO, A MEMBER WHO HAS LEFT (round 4, finding 3).
 *
 * The three send doors refuse a tombstone (server/lib/departed.ts). The work a
 * member did before leaving still sat in four places a steward signs later:
 * a quest consent's owed rows and the /review press that settles them, the
 * cash owed for a quest, a proposal or a role, a Work With Us acceptance, and
 * a library intake's award. Each paid the tombstone's account, or wrote cash
 * the treasurer owed to nobody.
 *
 * Every case asks the same door for a tombstone and for a living member, and
 * reads the ledger and `cash_owed` for what reached them. The tombstone is
 * written the way `writeTombstone` leaves one: a living member whose address
 * becomes `deleted-<id>@anonymized.invalid`, so a row recorded while they were
 * here is what the later signature meets.
 */
import mysql from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { testPool, provisionTestDb, testDbConfigured, type TestDb } from "../db/testDb";
import { loadTokenRegistry } from "./ledger";
import { owedForClaim, postOwed, villageId } from "./economy";
import { seedEconomy } from "./economySeed";
import { oweProposalCash, oweQuestCash } from "./cashOwed";
import { applyAcceptReward } from "./proposalAward";
import { approveIntake, ensureLibraryToken, recordIntake } from "./library";
import { loadVariables } from "./variables";
import { recordOwed, settleOwedPosting } from "../repos/questOwedPostings";
import { DEPARTED_RECIPIENT } from "./departed";
import { leftTheVillage } from "./formerMember";

const configured = testDbConfigured();

describe.skipIf(!configured)("nothing pays, or is owed to, a member who has left", () => {
  let db: TestDb;
  let pool: mysql.Pool;

  beforeAll(async () => {
    db = await provisionTestDb();
    pool = testPool(db, { connectionLimit: 6 }); // module-review-ok: the S5 scratch-schema harness pool, the ballots.test.ts shape
    await loadTokenRegistry(pool);
    await seedEconomy(pool, villageId());
    await ensureLibraryToken(pool);
    await loadTokenRegistry(pool);
    await loadVariables(pool);
  });

  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  const member = async (id: string) => {
    await pool.query("INSERT INTO `users` (`id`, `name`, `email`, `password_hash`) VALUES (?,?,?,'x')", [id, id, `${id}@example.test`]); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    return id;
  };
  /** What `writeTombstone` does to the address, the one fact every tombstone check reads. */
  const erase = async (id: string) => {
    await pool.query("UPDATE `users` SET `name` = 'A departed member', `email` = ? WHERE `id` = ?", [`deleted-${id}@anonymized.invalid`, id]); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
  };
  const legsTo = async (id: string) => {
    const [rows] = await pool.query<any[]>( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
      "SELECT COUNT(*) AS n FROM `token_ledger` l JOIN `ledger_accounts` a ON a.`id` = l.`to_account` WHERE a.`user_id` = ?",
      [id],
    );
    return Number(rows[0]?.n ?? 0);
  };
  const cashTo = async (id: string) => {
    const [rows] = await pool.query<any[]>("SELECT COUNT(*) AS n FROM `cash_owed` WHERE `user_id` = ?", [id]); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    return Number(rows[0]?.n ?? 0);
  };
  const cash = { minor: 5000, currency: "USD" };

  it("an owed row recorded while they were here posts nothing once they have left, on either path", async () => {
    const owe = async (who: string) => {
      const priced = await owedForClaim(pool, { id: `claim-${who}`, questId: `q-${who}`, userId: who });
      expect(priced.owed.length, "the control: the seeded rules price the claim").toBeGreaterThan(0);
      const conn = await pool.getConnection();
      try {
        await recordOwed(conn, `claim-${who}`, priced.owed);
      } finally {
        conn.release();
      }
      return priced.owed;
    };
    const gone = await member("dp-owed-gone");
    const living = await member("dp-owed-living");
    const goneRows = await owe(gone);
    const livingRows = await owe(living);
    await erase(gone);

    // /review's press, and a retry: the stored row, settled.
    const settled = await settleOwedPosting(pool, goneRows[0].idempotencyKey);
    expect(settled.outcome, "the settle refuses it, for good").toBe("refused");
    expect(settled.outcome === "refused" ? settled.message : "").toBe(DEPARTED_RECIPIENT);
    // The pool path the consent's own settle and `mintForConfirmedClaim` take.
    const direct = await postOwed(pool, goneRows[1] ?? goneRows[0]);
    expect(direct).toEqual({ outcome: "refused", reason: "rule", message: DEPARTED_RECIPIENT });
    expect(await legsTo(gone), "no ledger leg reached the tombstone").toBe(0);

    // The control: the same rows for a living member post.
    expect((await settleOwedPosting(pool, livingRows[0].idempotencyKey)).outcome).toBe("posted");
    expect(await legsTo(living)).toBeGreaterThan(0);
  });

  it("no cash is written down as owed to them, for a quest or a proposal", async () => {
    const gone = await member("dp-cash-gone");
    const living = await member("dp-cash-living");
    await erase(gone);
    expect(await oweQuestCash(pool, { claimId: "c-dp-gone", userId: gone, questId: "q-dp", questTitle: "Mend the oven", cash })).toBe(false);
    expect(await oweProposalCash(pool, { submissionId: "s-dp-gone", userId: gone, title: "Bread", cash })).toBe(false);
    expect(await cashTo(gone), "the treasurer's queue holds no line for nobody").toBe(0);
    // The control.
    expect(await oweQuestCash(pool, { claimId: "c-dp-living", userId: living, questId: "q-dp", questTitle: "Mend the oven", cash })).toBe(true);
    expect(await cashTo(living)).toBe(1);
  });

  it("accepting a proposal they sent before leaving pays and owes them nothing", async () => {
    const gone = await member("dp-proposal-gone");
    const living = await member("dp-proposal-living");
    await erase(gone);
    const updated: string[] = [];
    const deps = {
      members: {
        byId: async (id: string) => {
          const [rows] = await pool.query<any[]>("SELECT `id`, `name`, `email` FROM `users` WHERE `id` = ?", [id]); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
          return rows[0] ? { ...rows[0] } : null;
        },
        byEmail: async () => null,
        update: async (id: string, mutate: (u: any) => void) => {
          updated.push(id);
          const u: any = { id, name: id };
          mutate(u);
          return u;
        },
      },
      boostFor: async () => ({}),
      activity: async () => {},
    };
    const refused = await applyAcceptReward(pool, deps, { id: "sub-dp-gone", userId: gone, data: { work: "Bread" } }, "steward-one", cash);
    expect(refused).toEqual({ rewarded: false, refused: DEPARTED_RECIPIENT });
    expect(await legsTo(gone)).toBe(0);
    expect(await cashTo(gone)).toBe(0);
    expect(updated, "nothing is recorded on their row").toEqual([]);
    // The control.
    const paid = await applyAcceptReward(pool, deps, { id: "sub-dp-living", userId: living, data: { work: "Bread" } }, "steward-one", cash);
    expect(paid).toEqual({ rewarded: true });
    expect(await cashTo(living)).toBe(1);
  });

  it("a library intake awards no credits to a donor who has left, and the item still joins the library", async () => {
    const gone = await member("dp-donor-gone");
    const living = await member("dp-donor-living");
    const itemsBy = async (donor: string) => {
      const [rows] = await pool.query<any[]>("SELECT `status` FROM `library_items` WHERE `donor_user_id` = ?", [donor]); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
      return rows.map((r) => String(r.status));
    };
    // Recorded while they were here, over the dual sign-off line, so it waits.
    const big = await recordIntake(pool, { name: "Chainsaw", appraisal: 300, donorUserId: gone, recordedBy: "steward-one" });
    if (!big.ok) throw new Error(big.error);
    expect(big.pendingSecondSignoff, "the control: it waits for a second steward").toBe(true);
    await erase(gone);

    const signed = await approveIntake(pool, big.itemId, "steward-two");
    expect(signed, "signed, with no award").toEqual({ ok: true, award: 0 });
    expect(await itemsBy(gone), "the item is in the library for the living").toEqual(["available"]);

    // A new intake naming them is refused, and nothing is recorded.
    const fresh = await recordIntake(pool, { name: "Saw", appraisal: 100, donorUserId: gone, recordedBy: "steward-one" });
    expect(fresh).toEqual({ ok: false, error: DEPARTED_RECIPIENT });
    expect(await itemsBy(gone)).toEqual(["available"]);
    expect(await legsTo(gone), "no library credit reached the tombstone").toBe(0);

    // The control: a living donor is awarded on both paths.
    const small = await recordIntake(pool, { name: "Saw", appraisal: 100, donorUserId: living, recordedBy: "steward-one" });
    expect(small.ok && small.award).toBe(75);
    const big2 = await recordIntake(pool, { name: "Chainsaw", appraisal: 300, donorUserId: living, recordedBy: "steward-one" });
    if (!big2.ok) throw new Error(big2.error);
    expect(await approveIntake(pool, big2.itemId, "steward-two")).toEqual({ ok: true, award: 225 });
    expect(await legsTo(living)).toBe(2);
  });

  /*
   * Rye, 2026-10-31, item 5: "erased members figures should outlive them if
   * they're not paid out - still a debt owed". Item 9: an approved donation
   * from a departed donor paid nothing.
   */
  it("a former member who donated before leaving is awarded as normal, and keeps the credits", async () => {
    const left = await member("dp-donor-left");
    const big = await recordIntake(pool, { name: "Kiln", appraisal: 300, donorUserId: left, recordedBy: "steward-one" });
    if (!big.ok) throw new Error(big.error);
    expect(big.pendingSecondSignoff, "the control: it waits for a second steward").toBe(true);
    // They leave and the exit resolves with the account kept: a former member, no tombstone.
    await pool.query("INSERT INTO `exits` (`id`, `user_id`, `status`, `opened_by`) VALUES (?,?,'resolved',?)", ["dp-exit-left", left, left]); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    expect(await leftTheVillage(pool, { id: left, email: `${left}@example.test` }), "the control: they are a former member").toBe(true);

    expect(await approveIntake(pool, big.itemId, "steward-two")).toEqual({ ok: true, award: 225 });
    expect(await legsTo(left), "the award reached the account they kept").toBe(1);
  });

  it("an erased donor's award is paid to nobody, and the unpaid figure stays on the item's history", async () => {
    const gone = await member("dp-donor-erased");
    const big = await recordIntake(pool, { name: "Lathe", appraisal: 300, donorUserId: gone, recordedBy: "steward-one" });
    if (!big.ok) throw new Error(big.error);
    await erase(gone);
    expect(await approveIntake(pool, big.itemId, "steward-two")).toEqual({ ok: true, award: 0 });
    expect(await legsTo(gone), "no credit reached the tombstone").toBe(0);
    const [rows] = await pool.query<any[]>("SELECT `detail` FROM `library_item_events` WHERE `item_id` = ? AND `kind` = 'intake_approved'", [big.itemId]); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    expect(rows.map((r) => String(r.detail))).toEqual(["second sign-off; award 0; 225 credits unpaid, the donor's account was erased"]);
  });
});
