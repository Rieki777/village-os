/**
 * EVERY TABLE THE MIGRATIONS MAKE HAS A PRIMARY KEY.
 *
 * Some MySQL hosts run with `sql_require_primary_key = ON` (managed MySQL
 * offerings turn it on for replication), and there a CREATE TABLE with no
 * primary key fails. A migration fails loud at boot, so one table without a
 * key is a village that cannot start on such a host. `alignment_parties`
 * (0242) shipped with a UNIQUE key and no primary key, the first table in the
 * migration set to do so; this holds every table to it, from the provisioned
 * schema itself rather than from a reading of the SQL.
 */
import mysql from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { provisionTestDb, testDbConfigured, type TestDb } from "./testDb";

const configured = testDbConfigured();
if (!configured) console.warn("[primaryKeys] TEST_DATABASE_URL not set - DB cases SKIPPED. A skip is not a pass.");

describe.skipIf(!configured)("every migrated table has a primary key", () => {
  let db: TestDb;
  let pool: mysql.Pool;
  beforeAll(async () => {
    db = await provisionTestDb();
    pool = mysql.createPool({ uri: db.url, connectionLimit: 2 }); // module-review-ok: the suite's own pool onto the scratch schema it provisioned
  });
  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  it("names no base table without one", async () => {
    // The schema's name as a literal: information_schema answers a constant far faster than DATABASE().
    const [[here]] = await pool.query<any[]>("SELECT DATABASE() AS db"); // module-review-ok: which scratch schema this pool is on
    const schema = String(here.db);
    const [rows] = await pool.query<any[]>( // module-review-ok: a read of information_schema for the scratch schema, the whole point of the test
      "SELECT t.table_name AS name FROM information_schema.tables t " +
        "LEFT JOIN information_schema.table_constraints c ON c.table_schema = t.table_schema AND c.table_name = t.table_name AND c.constraint_type = 'PRIMARY KEY' " +
        "WHERE t.table_schema = ? AND t.table_type = 'BASE TABLE' AND c.constraint_name IS NULL ORDER BY t.table_name",
      [schema],
    );
    // CONTROL: the schema is the migrated one, so an empty list is about keys and not about an empty schema.
    const [all] = await pool.query<any[]>("SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = ?", [schema]); // module-review-ok: control read of information_schema
    expect(Number(all[0].n)).toBeGreaterThan(100);
    expect(rows.map((r) => String(r.name ?? r.NAME ?? r.TABLE_NAME))).toEqual([]);
  });
});
