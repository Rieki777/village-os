/**
 * Opaque subject references (0153), and the properties an erasure depends on.
 *
 * The promise in the module library contract is that a vendor names a member by
 * a reference that carries nothing about them, that the village can resolve it
 * back, and that it can be retired for one person without touching anybody
 * else. Each of those is a test here, because each of them is load-bearing for
 * `forgetMember` and none of them is visible by reading a call site.
 *
 * The one that matters most is idempotence. Two references for one member means
 * an erasure clears one of them, reports success, and leaves the other
 * resolving, which is the failure this whole file exists to make impossible.
 *
 * No TEST_DATABASE_URL and the suite skips loudly (harness rule).
 */
import { describe, expect, it, beforeAll, afterAll, beforeEach } from "vitest";
import mysql from "mysql2/promise";
import { provisionTestDb, testDbConfigured, type TestDb } from "../db/testDb";
import {
  dropSubjectRef,
  looksLikeSubjectRef,
  newSubjectRef,
  subjectRefFor,
  subjectRefsFor,
  userIdForSubjectRef,
} from "./subjectRefs";

const configured = testDbConfigured();

let db: TestDb;
let pool: mysql.Pool;

describe.skipIf(!configured)("opaque subject references", () => {
  beforeAll(async () => {
    db = await provisionTestDb();
    pool = mysql.createPool({ uri: db.url, timezone: "Z", connectionLimit: 4 }); // module-review-ok: the suite's own pool onto the scratch schema it provisioned
  });

  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  beforeEach(async () => {
    await pool.query("DELETE FROM subject_refs"); // module-review-ok: resetting the scratch schema this suite provisioned, between cases
  });

  it("issues one reference per member and returns the same one every time after", async () => {
    const first = await subjectRefFor(pool, "u1");
    const second = await subjectRefFor(pool, "u1");
    expect(second).toBe(first);

    const [rows] = await pool.query<any[]>("SELECT COUNT(*) AS n FROM subject_refs WHERE user_id = ?", ["u1"]); // module-review-ok: asserting on the scratch schema this suite provisioned
    expect(Number(rows[0].n)).toBe(1);
  });

  it("gives different members different references", async () => {
    const a = await subjectRefFor(pool, "u1");
    const b = await subjectRefFor(pool, "u2");
    expect(a).not.toBe(b);
  });

  it("resolves a reference back to the member who holds it", async () => {
    const ref = await subjectRefFor(pool, "u1");
    expect(await userIdForSubjectRef(pool, ref)).toBe("u1");
  });

  it("carries nothing about its subject", async () => {
    const ref = await subjectRefFor(pool, "ada@example.test");
    expect(ref).not.toContain("ada");
    expect(ref).not.toContain("example");
    expect(looksLikeSubjectRef(ref)).toBe(true);
  });

  it("refuses a malformed reference without resolving it", async () => {
    expect(await userIdForSubjectRef(pool, "u1")).toBeNull();
    expect(await userIdForSubjectRef(pool, "sub_notHex")).toBeNull();
    expect(looksLikeSubjectRef("sub_" + "0".repeat(31))).toBe(false);
    expect(looksLikeSubjectRef(newSubjectRef())).toBe(true);
  });

  it("resolves to nothing once retired, and leaves everybody else alone", async () => {
    const mine = await subjectRefFor(pool, "u1");
    const theirs = await subjectRefFor(pool, "u2");

    await dropSubjectRef(pool, "u1");

    expect(await userIdForSubjectRef(pool, mine)).toBeNull();
    expect(await userIdForSubjectRef(pool, theirs)).toBe("u2");
  });

  it("re-issues a different reference if a retired member is referenced again", async () => {
    const before = await subjectRefFor(pool, "u1");
    await dropSubjectRef(pool, "u1");
    const after = await subjectRefFor(pool, "u1");

    // A retired reference is not resurrected. A vendor still holding the old
    // string holds one that names nobody, and it never starts naming somebody
    // again.
    expect(after).not.toBe(before);
    expect(await userIdForSubjectRef(pool, before)).toBeNull();
  });

  it("batches, and issues for members who have never been referenced", async () => {
    const known = await subjectRefFor(pool, "u1");

    const map = await subjectRefsFor(pool, ["u1", "u2", "u3", "u2"]);

    expect(map.get("u1")).toBe(known);
    expect(map.size).toBe(3);
    for (const id of ["u1", "u2", "u3"]) {
      expect(looksLikeSubjectRef(map.get(id))).toBe(true);
      expect(await userIdForSubjectRef(pool, map.get(id)!)).toBe(id);
    }
  });

  it("returns an empty map for an empty ask, without touching the table", async () => {
    const map = await subjectRefsFor(pool, []);
    expect(map.size).toBe(0);

    const [rows] = await pool.query<any[]>("SELECT COUNT(*) AS n FROM subject_refs"); // module-review-ok: asserting on the scratch schema this suite provisioned
    expect(Number(rows[0].n)).toBe(0);
  });
});
