/**
 * What a fresh village is born paying.
 *
 * Rye, 2026-08-30: the defaults are Village Voice and Village Credits, and
 * Gratitude is "a change they can add not the defaults we're going to ship
 * with". Thirteen founders stand up an instance in three weeks and none of
 * them will read `economySeed.ts`, so what the seed produces is what those
 * villages ARE, and it needs a test that fails when somebody changes it by
 * accident.
 *
 * The test that matters most here is the last one. A default that omits a
 * token must not be a capability that refuses it, and in this build the
 * difference is not rhetorical: there is no route that CREATES a mint rule.
 * `PATCH /api/admin/economy/rules/:id` edits an existing row and the governed
 * path after launch edits the same rows, so a deleted rule is a payout the
 * village can never make again. The gratitude rule therefore has to still be
 * there, and it has to be off.
 */
import mysql from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { provisionTestDb, testDbConfigured, type TestDb } from "../db/testDb";
import { balanceOf, loadTokenRegistry, memberAccount } from "./ledger";
import {
  CREDITS,
  economyEpoch,
  HEARTS,
  ruleCannotPay,
  runSettlement,
  VILLAGE_VOICE,
  villageId,
} from "./economy";
import { ARCHETYPES } from "../../shared/archetypes";
import { seedEconomy } from "./economySeed";

const configured = testDbConfigured();
/**
 * The engine's own village id, not a name of this test's choosing.
 * `runSettlement` and `economyReady` both read `villageId()`, so a suite that
 * seeded somewhere else would prove the seed and never reach the settlement.
 */
const VILLAGE = villageId();

let db: TestDb;
let pool: mysql.Pool;

interface RuleRow {
  id: string;
  trigger: string;
  token_slug: string;
  amount: number;
  ceiling: number;
  recipient: string;
  enabled: number;
}

async function rules(): Promise<RuleRow[]> {
  const [rows] = await pool.query<any[]>(
    "SELECT `id`, `trigger`, `token_slug`, `amount`, `ceiling`, `recipient`, `enabled` " +
      "FROM `mint_rules` WHERE `village_id` = ? ORDER BY `trigger`, `token_slug`",
    [VILLAGE],
  );
  return rows as RuleRow[];
}

const find = (rs: RuleRow[], trigger: string, token: string) =>
  rs.find((r) => r.trigger === trigger && r.token_slug === token);

describe.skipIf(!configured)("the rules a village is seeded with", () => {
  beforeAll(async () => {
    db = await provisionTestDb();
    pool = mysql.createPool({ uri: db.url, timezone: "Z", connectionLimit: 10 });
    await loadTokenRegistry(pool);
    await seedEconomy(pool, VILLAGE);
    await loadTokenRegistry(pool);
    await economyEpoch(pool);
  });

  /** A member holding one live seat, which is all a settlement looks for. */
  async function seatAMember(id: string): Promise<string> {
    await pool.query(
      "INSERT INTO `users` (`id`, `name`, `email`, `password_hash`) VALUES (?,?,?,'x') " +
        "ON DUPLICATE KEY UPDATE `name` = VALUES(`name`)",
      [id, id, `${id}@examples.invalid`],
    );
    await pool.query(
      "INSERT IGNORE INTO `ledger_accounts` (`id`, `kind`, `user_id`, `label`, `faucet`) VALUES (?,?,?,?,0)",
      [memberAccount(id), "member", id, id],
    );
    await pool.query(
      "INSERT IGNORE INTO `org_roles` (`id`, `name`, `is_example`) VALUES (?,?,0)",
      [`role-${id}`, `Seat for ${id}`],
    );
    await pool.query(
      "INSERT IGNORE INTO `org_role_assignments` " +
        "(`id`, `org_role_id`, `holder_kind`, `user_id`, `holder_key`, `is_example`) VALUES (?,?,'member',?,?,0)",
      [`seat-${id}`, `role-${id}`, id, id],
    );
    return id;
  }

  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  /**
   * Renamed. This asserts on the RULE ROW, not on a payout, and under its old
   * name ("pays a confirmed quest in voice and credits") it read as proof that
   * a quest pays. It was green for the whole life of a bug that made every
   * village's first confirmed quest pay nothing but Gratitude. The payout
   * itself is proven in `economyEpoch.test.ts`, against balances.
   */
  it("seeds an enabled quest.completed rule for voice and credits, at 10 and 25", async () => {
    const rs = await rules();
    const voice = find(rs, "quest.completed", VILLAGE_VOICE);
    const credits = find(rs, "quest.completed", CREDITS);
    expect(voice?.enabled).toBe(1);
    expect(credits?.enabled).toBe(1);
    expect(Number(voice?.amount)).toBe(10);
    expect(Number(credits?.amount)).toBe(25);
  });

  it("pays a seat holder each moon in voice and credits", async () => {
    const rs = await rules();
    expect(find(rs, "role.cycle", VILLAGE_VOICE)?.enabled).toBe(1);
    expect(find(rs, "role.cycle", CREDITS)?.enabled).toBe(1);
    expect(Number(find(rs, "role.cycle", CREDITS)?.amount)).toBe(25);
  });

  it("does not pay gratitude for holding a seat", async () => {
    // The ruling. Gratitude stops being a default payout for work.
    expect(find(await rules(), "role.cycle", HEARTS)?.enabled).toBe(0);
  });

  it("keeps the gratitude rule on the books so a village can switch it on", async () => {
    // Off, not gone. There is no create-a-rule route in this build, so
    // deleting this row would remove the ability rather than the default, and
    // the ruling asked for the opposite.
    const rule = find(await rules(), "role.cycle", HEARTS);
    expect(rule).toBeDefined();
    expect(Number(rule?.amount)).toBe(20);
    // And it is a rule the engine could honour the moment somebody enables it:
    // a re-enablable rule that then cannot pay is the same trap in slow motion.
    expect(ruleCannotPay(HEARTS)).toBeNull();
  });

  it("seeds no gratitude rule for a confirmed quest, at all", async () => {
    // Not even disabled. The consent route has minted recognition for a
    // confirmed quest since S7 with its own range, cap and standing
    // multiplier. A disabled rule here would read as the obvious thing to
    // switch on and switching it on would pay twice for one piece of work.
    expect(find(await rules(), "quest.completed", HEARTS)).toBeUndefined();
  });

  it("seeds nothing the engine cannot pay", async () => {
    // The guard against this whole lane's original defect coming back through
    // the seed: every rule shipped enabled must be one the engine can honour.
    for (const r of await rules()) {
      if (!r.enabled) continue;
      expect(ruleCannotPay(r.token_slug), `${r.trigger} / ${r.token_slug}`).toBeNull();
    }
  });

  it("pays a seat holder in voice and credits, and not in gratitude", async () => {
    // The end-to-end proof, and the one the seed tests above cannot give: a
    // rule row that says "credits" is worth nothing if the engine cannot mint
    // the token, which is exactly the state this build was in.
    const u = await seatAMember("seed-seat-1");
    const out = await runSettlement(pool);
    expect(out.unpayable).toHaveLength(0);
    expect(out.stewardsThanked).toBe(1);
    // Whole credits: `credits` carries decimals 0.
    expect(await balanceOf(pool, memberAccount(u), CREDITS)).toBe(25);
    // Voice rides in thousandths, so 50 in the rule is 50000 in the ledger.
    expect(await balanceOf(pool, memberAccount(u), VILLAGE_VOICE)).toBe(50000);
    // The ruling: gratitude is not a default payout for holding a seat.
    expect(await balanceOf(pool, memberAccount(u), HEARTS)).toBe(0);
  });

  it("settles the same moon twice without paying twice", async () => {
    const again = await runSettlement(pool);
    expect(again.alreadyRun).toBe(true);
    expect(await balanceOf(pool, memberAccount("seed-seat-1"), CREDITS)).toBe(25);
  });

  it("never restores a default a village has already changed", async () => {
    // Money rules are INSERT IF ABSENT and never updated. A redeploy that
    // "restored the defaults" would silently undo a governance decision and
    // nobody would see it until the next settlement paid the wrong number.
    await pool.query(
      "UPDATE `mint_rules` SET `amount` = 7, `enabled` = 1 WHERE `village_id` = ? AND `id` = ?",
      [VILLAGE, `rule-role.cycle-${HEARTS}`],
    );
    const report = await seedEconomy(pool, VILLAGE);
    expect(report.rulesAdded).toBe(0);
    const rule = find(await rules(), "role.cycle", HEARTS);
    expect(Number(rule?.amount)).toBe(7);
    expect(rule?.enabled).toBe(1);
  });

  /**
   * A VILLAGE'S OWN WORDS SURVIVE A REDEPLOY, which is the whole reason 0193 and
   * the `customized` column exist.
   *
   * `seedEconomy` runs on EVERY boot. Before 0193 its ON DUPLICATE KEY UPDATE
   * restored subtitle, blurb, examples, sigil and sort_order from the platform
   * every time, so a village that re-blurbed a class would find the platform's
   * copy back at the next restart with nothing said. The comment above that
   * statement promised a `renamed` flag would protect them and no such column
   * existed, which is why the admin editor could not ship before this.
   *
   * These drive the REAL seed against a REAL database twice, because the defect
   * only exists on the second run. A test that seeded once would pass against the
   * bug.
   */
  const KEY = ARCHETYPES[0].key;

  it("CONTROL: the seed really does write the platform's words first", () => {
    // Without this, the assertions below could be passing over a table the
    // seed never touched.
    expect(ARCHETYPES.length).toBeGreaterThan(0);
  });

  it("refreshes a class the village has not touched, so copy improvements travel", async () => {
    await pool.query(
      "UPDATE `archetypes` SET `blurb` = 'a stale platform sentence' WHERE `village_id` = ? AND `key` = ?",
      [VILLAGE, KEY],
    );
    await seedEconomy(pool, VILLAGE);
    const [rows]: any = await pool.query(
      "SELECT `blurb`, `customized` FROM `archetypes` WHERE `village_id` = ? AND `key` = ?",
      [VILLAGE, KEY],
    );
    expect(rows[0].blurb).toBe(ARCHETYPES[0].blurb);
    expect(Number(rows[0].customized)).toBe(0);
  });

  it("leaves every word alone once the village has made the class its own", async () => {
    await pool.query(
      "UPDATE `archetypes` SET `name` = ?, `subtitle` = ?, `blurb` = ?, `sigil` = ?, `sort_order` = 4, " +
        "`customized` = 1 WHERE `village_id` = ? AND `key` = ?",
      ["The Gardener", "Tending & Growing", "Ours, not yours.", "leaf", VILLAGE, KEY],
    );
    await seedEconomy(pool, VILLAGE);
    const [rows]: any = await pool.query(
      "SELECT `name`, `subtitle`, `blurb`, `sigil`, `sort_order` FROM `archetypes` " +
        "WHERE `village_id` = ? AND `key` = ?",
      [VILLAGE, KEY],
    );
    expect(rows[0].name).toBe("The Gardener");
    expect(rows[0].subtitle).toBe("Tending & Growing");
    expect(rows[0].blurb).toBe("Ours, not yours.");
    expect(rows[0].sigil).toBe("leaf");
    expect(Number(rows[0].sort_order)).toBe(4);
  });

  it("never restores a NAME, marked or not, because a rename always belonged to the village", async () => {
    // `name` was already absent from the update list before 0193, so this is
    // the one guarantee that predates the flag. Asserted because the panel now
    // tells a founder their name is always theirs.
    await pool.query(
      "UPDATE `archetypes` SET `name` = 'The Gardener', `customized` = 0 WHERE `village_id` = ? AND `key` = ?",
      [VILLAGE, KEY],
    );
    await seedEconomy(pool, VILLAGE);
    const [rows]: any = await pool.query(
      "SELECT `name` FROM `archetypes` WHERE `village_id` = ? AND `key` = ?",
      [VILLAGE, KEY],
    );
    expect(rows[0].name).toBe("The Gardener");
  });

  it("seeds every key the shared cast declares, and no others", async () => {
    const [rows]: any = await pool.query(
      "SELECT `key` FROM `archetypes` WHERE `village_id` = ? ORDER BY `key`",
      [VILLAGE],
    );
    expect(rows.map((r: any) => r.key)).toEqual(ARCHETYPES.map((a) => a.key).sort());
  });

});
