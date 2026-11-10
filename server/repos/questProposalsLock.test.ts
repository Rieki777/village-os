/**
 * THE QUEST IDEA LOCK ASKS THE DATABASE FOR NO FUNCTION PRODUCTION LACKS.
 *
 * withIdeaLock named its GET_LOCK with SQL `SHA1(CONCAT(DATABASE(), ?))`.
 * Production runs MySQL 9.7.2 (read in Railway, 2026-11-10), which has no SHA1(),
 * so every quest idea submission threw "FUNCTION SHA1 does not exist" while CI's
 * mysql:8 passed it. The name is now hashed in Node. This suite needs no database:
 * a fake connection refuses any query that mentions SHA1, and records the name.
 */
import { createHash } from "crypto";
import { describe, expect, it } from "vitest";
import { withIdeaLock } from "./questProposals";

function fakePool(dbName: string) {
  const seen: { sql: string; params: unknown[] }[] = [];
  const conn = {
    async query(sql: string, params: unknown[] = []) {
      seen.push({ sql, params });
      if (/\bSHA1\s*\(/i.test(sql)) throw new Error("FUNCTION SHA1 does not exist");
      if (/DATABASE\(\)\s+AS/i.test(sql)) return [[{ name: dbName }]];
      if (/GET_LOCK/i.test(sql)) return [[{ ok: 1 }]];
      return [[{}]];
    },
    release() {
      seen.push({ sql: "release", params: [] });
    },
  };
  return { pool: { getConnection: async () => conn } as never, seen };
}

describe("withIdeaLock", () => {
  it("takes and releases a 40 character lock named from the schema, with no SQL SHA1", async () => {
    const { pool, seen } = fakePool("village_test_1");
    const out = await withIdeaLock(pool, async () => "done");
    expect(out).toBe("done");
    const get = seen.find((s) => /GET_LOCK/.test(s.sql));
    const release = seen.find((s) => /RELEASE_LOCK/.test(s.sql));
    expect(get?.params[0]).toMatch(/^[0-9a-f]{40}$/);
    expect(release?.params[0]).toBe(get?.params[0]);
    expect(seen.some((s) => /\bSHA1\s*\(/i.test(s.sql))).toBe(false);
  });

  it("names the lock per schema, so one test server holding many schemas never shares one", async () => {
    const a = fakePool("village_test_1");
    const b = fakePool("village_test_2");
    await withIdeaLock(a.pool, async () => 0);
    await withIdeaLock(b.pool, async () => 0);
    const nameOf = (s: { sql: string; params: unknown[] }[]) => s.find((x) => /GET_LOCK/.test(x.sql))?.params[0];
    expect(nameOf(a.seen)).not.toBe(nameOf(b.seen));
    // The same digest the SQL form produced: SHA1 of the schema name followed by the form's suffix.
    expect(nameOf(a.seen)).toBe(createHash("sha1").update("village_test_1" + ":propose-quest").digest("hex"));
  });

  it("releases the lock when the work throws", async () => {
    const { pool, seen } = fakePool("village_test_1");
    await expect(withIdeaLock(pool, async () => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    expect(seen.some((s) => /RELEASE_LOCK/.test(s.sql))).toBe(true);
  });
});
