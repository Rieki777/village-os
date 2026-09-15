/**
 * `member_vouches` on a real database: the one write, and the one way it may
 * change a row.
 *
 * The rule under test is that a vouch can only ever be RAISED. A steward who
 * already gave an ordinary vouch can turn it into a super vouch, which is what
 * lets the stuck village the override exists for admit anybody at all; and
 * nothing, not a repeat and not an ordinary vouch arriving after a super one,
 * lowers or duplicates a row. The statement that does it runs on MariaDB on a
 * dev box and on MySQL 8 in CI, which is why this is a database test and not a
 * unit test.
 *
 * Runs against the S5 harness: a scratch schema with every real migration
 * applied. No TEST_DATABASE_URL → skips loudly.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import mysql from "mysql2/promise";

import { provisionTestDb, testDbConfigured, type TestDb } from "../db/testDb";
import { recordVouch, vouchesBy, vouchesFor, vouchesForMany } from "./vouches";

const configured = testDbConfigured();

let db: TestDb;
let pool: mysql.Pool;
let seq = 0;
const nextId = () => `vt-${String(++seq).padStart(3, "0")}`;

describe.skipIf(!configured)("member_vouches on a real database", () => {
  beforeAll(async () => {
    db = await provisionTestDb();
    pool = mysql.createPool({ uri: db.url, timezone: "Z", connectionLimit: 4 });
  });

  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  it("keeps one row per person, however many times they press", async () => {
    await recordVouch(pool, { id: nextId(), voucherUserId: "a", vouchedUserId: "new-1", kind: "member" });
    await recordVouch(pool, { id: nextId(), voucherUserId: "a", vouchedUserId: "new-1", kind: "member" });
    await recordVouch(pool, { id: nextId(), voucherUserId: "b", vouchedUserId: "new-1", kind: "member", note: "known them for years" });
    const rows = await vouchesFor(pool, "new-1");
    expect(rows.map((r) => r.voucherUserId)).toEqual(["a", "b"]);
    expect(rows.find((r) => r.voucherUserId === "b")?.note).toBe("known them for years");
  });

  it("RAISES the same person's ordinary vouch to a super vouch, on the same row", async () => {
    await recordVouch(pool, { id: nextId(), voucherUserId: "steward", vouchedUserId: "new-2", kind: "member" });
    await recordVouch(pool, { id: nextId(), voucherUserId: "steward", vouchedUserId: "new-2", kind: "super" });
    const rows = await vouchesFor(pool, "new-2");
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe("super");
  });

  it("never lowers a super vouch, whatever arrives after it", async () => {
    await recordVouch(pool, { id: nextId(), voucherUserId: "steward", vouchedUserId: "new-3", kind: "super" });
    await recordVouch(pool, { id: nextId(), voucherUserId: "steward", vouchedUserId: "new-3", kind: "member" });
    await recordVouch(pool, { id: nextId(), voucherUserId: "steward", vouchedUserId: "new-3", kind: "arrival" });
    const rows = await vouchesFor(pool, "new-3");
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe("super");
  });

  it("leaves an ordinary vouch as it was when another ordinary one arrives", async () => {
    // The control for the raise. An update that rewrote the kind every time
    // would pass the raise above and fail here, and so would one that lowered.
    await recordVouch(pool, { id: nextId(), voucherUserId: "c", vouchedUserId: "new-4", kind: "arrival" });
    await recordVouch(pool, { id: nextId(), voucherUserId: "c", vouchedUserId: "new-4", kind: "member" });
    const rows = await vouchesFor(pool, "new-4");
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe("arrival");
  });

  it("reads the same rows from the giver's side and in bulk", async () => {
    const given = await vouchesBy(pool, "steward");
    expect(given.map((v) => v.vouchedUserId).sort()).toEqual(["new-2", "new-3"]);
    const many = await vouchesForMany(pool, ["new-1", "new-2", "nobody"]);
    expect(many.get("new-1")?.length).toBe(2);
    expect(many.get("new-2")?.[0]?.kind).toBe("super");
    expect(many.has("nobody")).toBe(false);
    expect((await vouchesForMany(pool, [])).size).toBe(0);
  });
});
