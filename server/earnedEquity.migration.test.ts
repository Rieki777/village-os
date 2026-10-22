/**
 * 0266 RUN, NOT REVIEWED: a second run of the earned equity seed is a no-op.
 *
 * The file is read off disk and executed through the runner's own
 * `splitStatements`, so this exercises the bytes that run at boot. The
 * provisioned schema has already applied 0266 once, which is the first run.
 *
 * WHAT IT HAS TO PROVE:
 *   1. The file is the two statements it says it is.
 *   2. A second run changes nothing anywhere in the schema: every table's row
 *      count and both seeded tables' rows, byte for byte.
 *   3. A village that renamed the token keeps its own name through a replay,
 *      because INSERT IGNORE never touches a row that already exists.
 */
import fs from "node:fs";
import path from "node:path";
import mysql from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { provisionTestDb, testDbConfigured, testPool, type TestDb } from "./db/testDb";
import { splitStatements } from "./db/migrate";

const configured = testDbConfigured();
if (!configured) {
  // eslint-disable-next-line no-console
  console.warn("[earnedEquity.migration] TEST_DATABASE_URL not set. This suite SKIPPED.");
}

const MIGRATION = path.join(process.cwd(), "drizzle", "0266_a_village_earns_equity_it_can_claim_on_hypha.sql");

describe.skipIf(!configured)("0266, earned equity and its three accounts", () => {
  let db: TestDb;
  let pool: mysql.Pool;

  const runMigration = async () => {
    for (const sql of splitStatements(fs.readFileSync(MIGRATION, "utf-8"))) {
      await pool.query(sql); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    }
  };

  /** Every base table and how many rows it holds, so a stray write anywhere shows. */
  const fingerprint = async (): Promise<Record<string, number>> => {
    const [tables] = await pool.query<any[]>( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
      "SELECT `TABLE_NAME` AS t FROM information_schema.`TABLES` " +
        "WHERE `TABLE_SCHEMA` = DATABASE() AND `TABLE_TYPE` = 'BASE TABLE' ORDER BY `TABLE_NAME`",
    );
    const out: Record<string, number> = {};
    for (const { t } of tables) {
      const [n] = await pool.query<any[]>(`SELECT COUNT(*) AS n FROM \`${String(t)}\``); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
      out[String(t)] = Number(n[0].n);
    }
    return out;
  };

  const seeded = async () => {
    const [tokens] = await pool.query<any[]>( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
      "SELECT * FROM `tokens` WHERE `slug` = 'earned-equity'",
    );
    const [accounts] = await pool.query<any[]>( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
      "SELECT * FROM `ledger_accounts` WHERE `id` LIKE 'sys:equity-%' ORDER BY `id`",
    );
    return { tokens, accounts };
  };

  beforeAll(async () => {
    db = await provisionTestDb();
    pool = testPool(db, { connectionLimit: 2 });
  }, 180_000);

  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  it("is the file the runner discovers, as two statements", () => {
    expect(/^\d{4}.*\.sql$/.test(path.basename(MIGRATION))).toBe(true);
    expect(splitStatements(fs.readFileSync(MIGRATION, "utf-8"))).toHaveLength(2);
  });

  it("seeded one token and three accounts on the first run", async () => {
    const { tokens, accounts } = await seeded();
    expect(tokens).toHaveLength(1);
    expect(tokens[0]).toMatchObject({ name: "Earned Equity", kind: "equity", governance: "platform", transferable: 0 });
    expect(accounts.map((a: any) => [a.id, a.faucet])).toEqual([
      ["sys:equity-bridge", 0],
      ["sys:equity-mint", 1],
      ["sys:equity-settled", 0],
    ]);
  });

  it("changes nothing anywhere on a second run", async () => {
    const before = { rows: await seeded(), counts: await fingerprint() };
    await runMigration();
    const after = { rows: await seeded(), counts: await fingerprint() };
    expect(after).toEqual(before);
  });

  it("keeps a village's own name for the token through a replay", async () => {
    await pool.query("UPDATE `tokens` SET `name` = 'Our Stake' WHERE `slug` = 'earned-equity'"); // module-review-ok: fixture standing in for a founder's rename in Admin then Tokens
    await runMigration();
    const { tokens } = await seeded();
    expect(tokens[0].name).toBe("Our Stake");
  });
});
