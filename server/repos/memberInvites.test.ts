/**
 * `member_invites` on a real database: the take, the race for one link, and
 * expiry by the database's own clock.
 *
 * Every rule that decides whether a link opens sign-up is a conditional UPDATE
 * or a comparison against CURRENT_TIMESTAMP, and those run on MariaDB on a dev
 * box and on MySQL 8 in CI. So this is a database test and not a unit test.
 *
 * Runs against the S5 harness: a scratch schema with every real migration
 * applied. No TEST_DATABASE_URL → skips loudly.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import mysql from "mysql2/promise";

import { provisionTestDb, testDbConfigured, type TestDb } from "../db/testDb";
import { hashInviteToken, inviteStanding, mintInviteToken } from "../lib/invites";
import {
  claimInvite,
  createInvite,
  inviteByHash,
  invitesBy,
  openInviteCount,
  releaseInvite,
  revokeInvite,
} from "./memberInvites";

const configured = testDbConfigured();

let db: TestDb;
let pool: mysql.Pool;
let seq = 0;
const nextId = () => `inv-t-${String(++seq).padStart(3, "0")}`;

/** One link, as the route makes it: a token kept by the caller, its hash kept by the table. */
async function made(inviter: string, days = 14): Promise<{ id: string; token: string }> {
  const token = mintInviteToken();
  const id = nextId();
  await createInvite(pool, { id, tokenHash: hashInviteToken(token), inviterUserId: inviter, days });
  return { id, token };
}

/** Put a link's expiry one second into the past, by the database's clock. */
async function expire(id: string): Promise<void> {
  await pool.query("UPDATE member_invites SET expires_at = CURRENT_TIMESTAMP - INTERVAL 1 SECOND WHERE id = ?", [id]); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
}

describe.skipIf(!configured)("member_invites on a real database", () => {
  beforeAll(async () => {
    db = await provisionTestDb();
    pool = mysql.createPool({ uri: db.url, timezone: "Z", connectionLimit: 4 }); // module-review-ok: the S5 harness pool against the scratch schema
  });

  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  it("finds a link by its token's hash, open, with fourteen days left", async () => {
    const { id, token } = await made("inviter-a");
    const row = await inviteByHash(pool, hashInviteToken(token));
    expect(row?.id).toBe(id);
    expect(inviteStanding(row!)).toBe("open");
    expect(row!.secondsLeft).toBeGreaterThan(13 * 86_400);
    expect(row!.secondsLeft).toBeLessThanOrEqual(14 * 86_400);
    // And a token nobody made finds nothing.
    expect(await inviteByHash(pool, hashInviteToken(mintInviteToken()))).toBeNull();
  });

  it("is taken exactly once when two sign-ups race for it", async () => {
    const { id } = await made("inviter-b");
    const results = await Promise.all([claimInvite(pool, id, "new-1"), claimInvite(pool, id, "new-2")]);
    expect(results.filter(Boolean)).toEqual(["inviter-b"]);
    const [row] = await invitesBy(pool, "inviter-b");
    expect(inviteStanding(row)).toBe("used");
    expect(["new-1", "new-2"]).toContain(row.usedByUserId);
  });

  it("is given back only by the account that took it", async () => {
    const { id } = await made("inviter-c");
    expect(await claimInvite(pool, id, "new-3")).toBe("inviter-c");
    await releaseInvite(pool, id, "somebody-else");
    expect(await claimInvite(pool, id, "new-4"), "still held by new-3").toBeNull();
    await releaseInvite(pool, id, "new-3");
    expect(await claimInvite(pool, id, "new-4")).toBe("inviter-c");
  });

  it("expires by the database's clock, and a fresh link beside it still opens", async () => {
    const stale = await made("inviter-d");
    await expire(stale.id);
    expect(inviteStanding((await inviteByHash(pool, hashInviteToken(stale.token)))!)).toBe("expired");
    expect(await claimInvite(pool, stale.id, "new-5")).toBeNull();

    const fresh = await made("inviter-d");
    expect(await claimInvite(pool, fresh.id, "new-6")).toBe("inviter-d");
  });

  it("reads a link with no expiry as expired, so an undated row never opens", async () => {
    const { id, token } = await made("inviter-e");
    await pool.query("UPDATE member_invites SET expires_at = NULL WHERE id = ?", [id]); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    expect(inviteStanding((await inviteByHash(pool, hashInviteToken(token)))!)).toBe("expired");
    expect(await claimInvite(pool, id, "new-7")).toBeNull();
  });

  it("is withdrawn only by its maker, only once, and only while nobody has used it", async () => {
    const { id } = await made("inviter-f");
    expect(await revokeInvite(pool, id, "not-the-inviter")).toBe(false);
    expect(await revokeInvite(pool, id, "inviter-f")).toBe(true);
    expect(await revokeInvite(pool, id, "inviter-f")).toBe(false);
    expect(await claimInvite(pool, id, "new-8")).toBeNull();

    const used = await made("inviter-f");
    expect(await claimInvite(pool, used.id, "new-9")).toBe("inviter-f");
    expect(await revokeInvite(pool, used.id, "inviter-f")).toBe(false);
  });

  it("counts only the links that could still be used, and lists every one", async () => {
    const who = "inviter-g";
    const used = await made(who);
    const withdrawn = await made(who);
    const stale = await made(who);
    await made(who);
    await claimInvite(pool, used.id, "new-10");
    await revokeInvite(pool, withdrawn.id, who);
    await expire(stale.id);
    expect(await openInviteCount(pool, who)).toBe(1);
    expect((await invitesBy(pool, who)).map(inviteStanding).sort()).toEqual(["expired", "open", "revoked", "used"]);
  });

  it("never stores the token itself", async () => {
    const { id, token } = await made("inviter-h");
    const [rows] = await pool.query<any[]>("SELECT * FROM member_invites WHERE id = ?", [id]); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toContain(token);
  });
});
