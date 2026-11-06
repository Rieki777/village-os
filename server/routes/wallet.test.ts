/**
 * THE MEMBER WALLET, over real HTTP against a real database.
 *
 * Asserted on what the route sends and on the ledger behind it:
 *   - a stranger is refused, and a member reads their own holdings and nobody
 *     else's, because there is no request shape that names another member;
 *   - every token the village has is one row, the Hypha mirror sits on the far
 *     side of its claimable row, and a rename reaches the next read;
 *   - nothing is priced while the exchange is off, and that reads as words;
 *   - the claim door is shut in this build: a claim request answers 503 and
 *     the member's balance does not move;
 *   - the on-chain side is read from the cache only, and only for a proven
 *     wallet in a village that shows it.
 */
import http from "node:http";
import express from "express";
import mysql from "mysql2/promise";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { provisionTestDb, testDbConfigured, testPool, type TestDb } from "../db/testDb";
import { allowanceFor, EARNED_EQUITY, ensureVoiceToken, faucetFor, mint, toLedgerUnits } from "../lib/economy";
import { balanceOf, loadTokenRegistry, memberAccount } from "../lib/ledger";
import { loadVariables, numberVar, setVariable } from "../lib/variables";
import { BRIDGE_DISPATCH_BUILT } from "../lib/voiceClaim";
import { register } from "./wallet";

const configured = testDbConfigured();
if (!configured) {
  // eslint-disable-next-line no-console
  console.warn("[routes/wallet] TEST_DATABASE_URL not set. This suite SKIPPED.");
}

let db: TestDb;
let pool: mysql.Pool;
let server: http.Server;
let base = "";
let seq = 0;

/** Who the stub `authedUser` says sent the request. The header is the whole of auth here. */
const members: Record<string, any> = {};

async function makeMember(id: string, extra: Record<string, unknown> = {}): Promise<string> {
  await pool.query( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    "INSERT INTO `users` (`id`, `name`, `email`, `password_hash`) VALUES (?,?,?,'x') " +
      "ON DUPLICATE KEY UPDATE `name` = VALUES(`name`)",
    [id, id, `${id}@examples.invalid`],
  );
  await pool.query( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    "INSERT IGNORE INTO `ledger_accounts` (`id`, `kind`, `user_id`, `label`, `faucet`) VALUES (?,?,?,?,0)",
    [memberAccount(id), "member", id, id],
  );
  members[id] = { id, name: id, ...extra };
  return id;
}

async function give(userId: string, slug: string, human: number): Promise<void> {
  const res = await mint(pool, {
    toUserId: userId,
    tokenSlug: slug,
    amount: toLedgerUnits(slug, human),
    from: faucetFor(slug)!,
    source: "test",
    idempotencyKey: `test-wallet:${userId}:${slug}:${++seq}`,
  });
  if (!res.ok) throw new Error(`could not seed ${slug}: ${res.error}`);
}

async function call(method: string, route: string, as?: string, body?: unknown) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (as) headers["x-test-member"] = as;
  const r = await fetch(base + route, { // module-review-ok: the test client dialling its own server on localhost
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, json: (await r.json().catch(() => null)) as any };
}

const rowFor = (wallet: any, slug: string) => wallet.rows.find((r: any) => r.token === slug);

describe.skipIf(!configured)("GET /api/me/wallet and the claim door", () => {
  beforeAll(async () => {
    db = await provisionTestDb();
    pool = testPool(db, { connectionLimit: 6 });
    await loadTokenRegistry(pool);
    await loadVariables(pool);
    await ensureVoiceToken(pool, "Village Voice");
    await loadTokenRegistry(pool);

    const app = express();
    app.use(express.json());
    register(app, {
      authedUser: async (req: express.Request) => members[String(req.headers["x-test-member"] ?? "")] ?? null,
      getPool: () => pool,
      gratitudeAllowance: (user: any) => allowanceFor(pool, user.id, 1),
    } as any);
    server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const addr = server.address();
    base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
    await pool?.end();
    await db?.drop();
  });

  beforeEach(async () => {
    await setVariable(pool, "economy.hypha_space", "a-test-space");
    await setVariable(pool, "economy.claims_week_starts", "");
    await setVariable(pool, "tokens.show_economics_section", "false");
    await setVariable(pool, "tokens.equity_address", "");
  });

  it("refuses a stranger", async () => {
    expect((await call("GET", "/api/me/wallet")).status).toBe(401);
    expect((await call("POST", "/api/me/wallet/claim", undefined, { token: EARNED_EQUITY })).status).toBe(401);
  });

  it("shows a member their own holdings, one row per token, and nobody else's", async () => {
    const ora = await makeMember("w-ora");
    const bex = await makeMember("w-bex");
    await give(ora, "credits", 12.5);
    await give(ora, EARNED_EQUITY, 3);
    await give(bex, EARNED_EQUITY, 99);

    const { status, json } = await call("GET", "/api/me/wallet", ora);
    expect(status).toBe(200);
    const slugs = json.rows.map((r: any) => r.token);
    // Claimable first, then what is spent here, then recognition. The two
    // mirrors are not rows of their own.
    expect(slugs.slice(0, 2)).toEqual([EARNED_EQUITY, "village-voice"]);
    expect(slugs[slugs.length - 1]).toBe("gratitude");
    expect(slugs).toContain("credits");
    expect(slugs).not.toContain("equity");
    expect(slugs).not.toContain("voice");
    expect(new Set(slugs).size).toBe(slugs.length);

    const eq = rowFor(json, EARNED_EQUITY);
    expect(eq).toMatchObject({ name: "Earned Equity", role: "claimable", heldUnits: 3, decimals: 0 });
    const credits = rowFor(json, "credits");
    expect(credits).toMatchObject({ heldUnits: 1250, decimals: 2, role: "village" });
    expect(credits.staysHere).toBe("Stays in the village. There is nothing to claim on Hypha.");

    // Each member reads their own balance and only theirs: Ora's 3 is not
    // Bex's 99 and not the two together.
    const theirs = await call("GET", "/api/me/wallet", bex);
    expect(rowFor(theirs.json, EARNED_EQUITY).heldUnits).toBe(99);
    expect(rowFor(theirs.json, "credits").heldUnits).toBe(0);
  });

  it("says no price while the exchange is off, and never prices gratitude", async () => {
    const ora = await makeMember("w-ora");
    const { json } = await call("GET", "/api/me/wallet", ora);
    expect(rowFor(json, "credits").price).toEqual({ state: "unset", says: "No price set" });
    expect(rowFor(json, EARNED_EQUITY).price).toEqual({ state: "unset", says: "No price set" });
    const g = rowFor(json, "gratitude");
    expect(g.price.state).toBe("never");
    expect(g.claim).toBeNull();
    // The dial times a multiplier of one, and nothing given yet, so all of it is left.
    const dial = numberVar("gratitude.base_budget");
    expect(g.gratitude).toMatchObject({ givingTotal: dial, givingLeft: dial });
  });

  it("follows a rename on the next read", async () => {
    const ora = await makeMember("w-ora");
    await pool.query("UPDATE `tokens` SET `name` = 'Shared Stake' WHERE `slug` = ?", [EARNED_EQUITY]); // module-review-ok: fixture standing in for a founder's rename in Admin then Tokens
    await loadTokenRegistry(pool);
    try {
      const { json } = await call("GET", "/api/me/wallet", ora);
      expect(rowFor(json, EARNED_EQUITY).name).toBe("Shared Stake");
    } finally {
      await pool.query("UPDATE `tokens` SET `name` = 'Earned Equity' WHERE `slug` = ?", [EARNED_EQUITY]); // module-review-ok: fixture undoing its own rename
      await loadTokenRegistry(pool);
    }
  });

  it("tells a member why a claim cannot be made, and the door takes nothing", async () => {
    const ora = await makeMember("w-ora");
    const before = await balanceOf(pool, memberAccount(ora), EARNED_EQUITY);
    expect(before).toBeGreaterThan(0);
    const { json } = await call("GET", "/api/me/wallet", ora);
    const claim = rowFor(json, EARNED_EQUITY).claim;
    expect(claim.claimable).toBe(false);
    if (!BRIDGE_DISPATCH_BUILT) {
      expect(claim.says).toContain("still being finished");
      expect(claim.opens).toBe("Claims open once the connection to Hypha is finished. No date is set yet.");
      const asked = await call("POST", "/api/me/wallet/claim", ora, { token: EARNED_EQUITY });
      expect(asked.status).toBe(503);
      expect(await balanceOf(pool, memberAccount(ora), EARNED_EQUITY)).toBe(before);
    } else {
      throw new Error("BRIDGE_DISPATCH_BUILT is now true. Rewrite this case to prove the wallet's claim reaches Hypha.");
    }
    // A token that never crosses is refused by name.
    const credits = await call("POST", "/api/me/wallet/claim", ora, { token: "credits" });
    expect(credits.status).toBe(400);
  });

  it("reads the mirror off the cache, for a proven wallet in a village that shows it", async () => {
    const vera = await makeMember("w-vera", { walletAddress: "0x1111111111111111111111111111111111111111", walletVerifiedAt: "2026-10-01T00:00:00.000Z" });
    await pool.query( // module-review-ok: fixture standing in for what readOnchainBalance last cached
      "INSERT INTO `onchain_balances` (`id`, `user_id`, `token_slug`, `raw_balance`, `decimals`, `fetched_at`) VALUES (?,?,?,?,?,?)",
      [`${vera}:equity`, vera, "equity", "2500000000000000000", 18, new Date("2026-10-20T09:00:00Z")],
    );
    // Off by default: nothing is shown, in words.
    let { json } = await call("GET", "/api/me/wallet", vera);
    expect(rowFor(json, EARNED_EQUITY).onBase).toMatchObject({ state: "hidden", mirror: "equity" });

    await setVariable(pool, "tokens.show_economics_section", "true");
    await setVariable(pool, "tokens.equity_address", "0x2222222222222222222222222222222222222222");
    ({ json } = await call("GET", "/api/me/wallet", vera));
    expect(rowFor(json, EARNED_EQUITY).onBase).toMatchObject({
      state: "read",
      mirror: "equity",
      mirrorName: "Village Equity",
      formatted: "2.5",
      says: "As Base last said, on 2026-10-20.",
    });
    // An unproven member in the same village sees the instruction, not the number.
    const ora = await makeMember("w-ora");
    ({ json } = await call("GET", "/api/me/wallet", ora));
    expect(rowFor(json, EARNED_EQUITY).onBase.state).toBe("hidden");
    expect(rowFor(json, EARNED_EQUITY).onBase.says).toBe("Verify your wallet below to see what you hold on Base.");
  });
});
