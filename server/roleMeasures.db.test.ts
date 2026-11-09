/**
 * The role-journey measures on a real schema (L11). Tolerant of lanes that have
 * not landed: the application, onboarding and renewal tables may not exist here,
 * and that reads as nothing, never as an error. A visitor is refused, and what a
 * member gets carries no person.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type mysql from "mysql2/promise";
import { provisionTestDb, testDbConfigured, testPool, type TestDb } from "./db/testDb";
import { register } from "./routes/roleMeasures";
import { applicationFacts, holderFacts } from "./repos/roleMeasures";
import { MEASURE_KEYS } from "../shared/roleMeasures";

const configured = testDbConfigured();
if (!configured) console.warn("[roleMeasures.db] TEST_DATABASE_URL not set - DB cases SKIPPED. A skip is not a pass.");

describe.skipIf(!configured)("role measures, on a real schema", () => {
  let db: TestDb;
  let pool: mysql.Pool;
  let who: string | null = null;
  let handler: (req: any, res: any) => Promise<unknown>;
  const call = async () => {
    const out: { status: number; body: any } = { status: 200, body: undefined };
    const res: any = { status: (c: number) => ((out.status = c), res), json: (b: unknown) => ((out.body = b), res) };
    await handler({ headers: {} }, res);
    return out;
  };

  beforeAll(async () => {
    db = await provisionTestDb();
    pool = testPool(db, { connectionLimit: 4 });
    register({ get: (_p: string, h: any) => (handler = h) } as any, {
      getPool: () => pool as any,
      authedUser: async () => (who ? ({ id: who } as any) : null),
      overLimit: async () => false,
    });
  });
  afterAll(async () => {
    await pool?.end();
    await db?.drop?.();
  });

  it("reads tables that are missing as no facts", async () => {
    await pool.query("DROP TABLE IF EXISTS application_steps, onboarding_paths, onboarding_items, role_moon_renewals");
    expect(await applicationFacts(pool as any)).toEqual([]);
    expect(await holderFacts(pool as any)).toEqual([]);
  });

  it("refuses a visitor", async () => {
    who = null;
    expect((await call()).status).toBe(401);
  });

  it("gives a member rows with the declared keys and no person", async () => {
    who = "m-1";
    await pool.query("CREATE TABLE IF NOT EXISTS application_steps (id bigint AUTO_INCREMENT PRIMARY KEY, application_ref varchar(64), kind varchar(16), subject varchar(32) DEFAULT '', stamped_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3))"); // module-review-ok: fixture table for the scratch schema
    await pool.query("INSERT INTO application_steps (application_ref, kind, stamped_at) VALUES ('op-aaa','confirmed','2026-01-01 00:00:00'),('op-aaa','first_reply','2026-01-01 05:00:00')"); // module-review-ok: fixture rows
    const out = await call();
    expect(out.status).toBe(200);
    expect(out.body.rows).toHaveLength(1);
    const keys = Object.keys(out.body.rows[0]).filter((k) => k !== "circleName").sort();
    expect(keys).toEqual([...MEASURE_KEYS.row].sort());
    expect(JSON.stringify(out.body)).not.toMatch(/op-aaa|m-1/);
    await pool.query("DROP TABLE application_steps");
  });
});
