/**
 * Ending every agent token a member holds, against a real schema (lane
 * tokens-on-reset).
 *
 * A password set or reset and an admin's "revoke sessions" call
 * `revokeAllTokens` once the credential has changed. The route half is proven
 * in server/agent.routes.e2e.test.ts, over HTTP; this file pins the function
 * itself, because the questions worth asking are about which ROWS it touches:
 * only this member's, only the live ones, each one once, with the audit line
 * the single revoke writes. A fake pool would answer them by agreeing with
 * whatever SQL it was handed.
 *
 * No TEST_DATABASE_URL and the suite skips (harness rule).
 */
import mysql from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { provisionTestDb, testDbConfigured, testPool, type TestDb } from "../db/testDb";
import { mintToken, revokeAllTokens, revokeToken, verifyToken } from "./agentTokens";

const configured = testDbConfigured();

let db: TestDb;
let pool: mysql.Pool;

const IVY = "usr-reset-ivy";
const JON = "usr-reset-jon";

async function q(sql: string, params: unknown[] = []): Promise<any[]> {
  const [rows] = await pool.query<any[]>(sql, params); // module-review-ok: seeding and reading back the scratch schema this suite provisioned, which is the assertion
  return rows;
}

async function mint(userId: string, name: string): Promise<{ token: string; id: string }> {
  const minted = await mintToken(pool, userId, { name, scopes: ["me.read"], ttlDays: 365 });
  if (!minted.ok) throw new Error(`mint refused: ${minted.error}`);
  return { token: minted.token, id: minted.row.id };
}

async function revokeLines(id: string): Promise<any[]> {
  return q("SELECT actor_user_id, actor_kind, audience FROM health_events WHERE kind = 'agent_token' AND entity_ref = ? AND text = ?", [
    id,
    `revoked agent token ${id}`,
  ]);
}

beforeAll(async () => {
  if (!configured) return;
  db = await provisionTestDb();
  pool = testPool(db, { connectionLimit: 4 });
});

afterAll(async () => {
  await pool?.end();
  await db?.drop();
});

describe.skipIf(!configured)("revokeAllTokens", () => {
  it("ends every live token the member holds, says how many, and leaves everyone else's standing", async () => {
    const laptop = await mint(IVY, "ivy laptop");
    const phone = await mint(IVY, "ivy phone");
    const bystander = await mint(JON, "jon laptop");

    // Already revoked: keeps its own revoke time and gets no second audit line.
    const old = await mint(IVY, "ivy old");
    expect(await revokeToken(pool, IVY, old.id)).toBe(true);
    await q("UPDATE agent_tokens SET revoked_at = '2026-01-02 03:04:05' WHERE id = ?", [old.id]);
    // Already expired: an expired token is dead, and the member's list keeps saying "expired".
    const lapsed = await mint(IVY, "ivy lapsed");
    await q("UPDATE agent_tokens SET expires_at = UTC_TIMESTAMP() - INTERVAL 1 DAY WHERE id = ?", [lapsed.id]);

    expect(await revokeAllTokens(pool, IVY)).toBe(2);

    for (const t of [laptop, phone]) {
      const verdict = await verifyToken(pool, t.token);
      expect(verdict.ok, `${t.id} still answers`).toBe(false);
      expect(verdict.ok ? null : verdict.reason).toBe("revoked");
      const lines = await revokeLines(t.id);
      expect(lines, `the audit line for ${t.id}`).toHaveLength(1);
      expect(lines[0]).toMatchObject({ actor_user_id: IVY, actor_kind: "agent", audience: "admin" });
    }

    expect((await verifyToken(pool, bystander.token)).ok, "another member's token was ended").toBe(true);
    expect(await revokeLines(bystander.id)).toHaveLength(0);

    const [oldRow] = await q("SELECT DATE_FORMAT(revoked_at, '%Y-%m-%d %H:%i:%s') AS at FROM agent_tokens WHERE id = ?", [old.id]);
    expect(oldRow.at, "an earlier revoke was rewritten").toBe("2026-01-02 03:04:05");
    expect(await revokeLines(old.id)).toHaveLength(1);

    const [lapsedRow] = await q("SELECT revoked_at FROM agent_tokens WHERE id = ?", [lapsed.id]);
    expect(lapsedRow.revoked_at, "an expired token was relabelled revoked").toBeNull();
    expect(await revokeLines(lapsed.id)).toHaveLength(0);
  });

  it("is safe to call again: a second run ends nothing and writes nothing", async () => {
    const before = await q("SELECT COUNT(*) AS n FROM health_events WHERE kind = 'agent_token'");
    expect(await revokeAllTokens(pool, IVY)).toBe(0);
    const after = await q("SELECT COUNT(*) AS n FROM health_events WHERE kind = 'agent_token'");
    expect(Number(after[0].n)).toBe(Number(before[0].n));
  });

  it("ends a member with no tokens at all without complaint", async () => {
    expect(await revokeAllTokens(pool, "usr-reset-nobody")).toBe(0);
  });
});
