/**
 * COUNTING ONLY WORK-EARNED VOICE, READ OFF THE LEDGER.
 *
 * Rye, 2026-11-08 (relayed by the master coordinator): a vote may count only
 * work-earned Voice, and Funding rounds keeps money and backing Voice out of
 * pot ballots. `workEarnedVoice` is that one read: each member's balance times
 * the share of Voice ever minted to them that came from work, each source net
 * of its own reversals.
 *
 * Every figure here is in Voice's MINOR units (2 decimals), as `weightsFor`
 * reads balances, so 1000 is 10.00 Voice.
 */
import mysql from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { provisionTestDb, testDbConfigured, testPool, type TestDb } from "./db/testDb";
import { loadTokenRegistry, memberAccount, postClawbackMirror, postTransfer } from "./lib/ledger";
import { loadVariables } from "./lib/variables";
import { ensureVoiceToken, mint, villageId, VILLAGE_VOICE, VOICE_DECAY, VOICE_MINT } from "./lib/economy";
import { workEarnedVoice } from "./lib/voiceProvenance";

const configured = testDbConfigured();
if (!configured) {
  // eslint-disable-next-line no-console
  console.warn("[voiceProvenance] TEST_DATABASE_URL not set. This suite SKIPPED.");
}

describe.skipIf(!configured)("workEarnedVoice", () => {
  let db: TestDb;
  let pool: mysql.Pool;

  const member = async (id: string) => {
    await pool.query( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
      "INSERT INTO `users` (`id`,`name`,`email`,`password_hash`) VALUES (?,?,?,'x') ON DUPLICATE KEY UPDATE `name` = VALUES(`name`)",
      [id, id, `${id}@examples.invalid`],
    );
  };

  /** Mint `minor` Voice to `id` from the Voice faucet, under `source`. Returns the posting's key. */
  const minted = async (id: string, minor: number, source: string): Promise<string> => {
    const key = `prov:${id}:${source}`;
    const r = await mint(pool, {
      toUserId: id,
      tokenSlug: VILLAGE_VOICE,
      amount: minor,
      from: VOICE_MINT,
      source,
      sourceRef: id,
      description: "seeded for the work-only count",
      idempotencyKey: key,
    });
    expect(r.ok, `minting ${source} to ${id}`).toBe(true);
    return key;
  };

  const waned = async (id: string, minor: number) => {
    const r = await postTransfer(pool, {
      from: memberAccount(id), to: VOICE_DECAY, tokenType: VILLAGE_VOICE, amount: minor,
      source: "voice_decay", idempotencyKey: `prov:${id}:wane`,
    });
    expect(r.ok, `waning ${id}`).toBe(true);
  };

  beforeAll(async () => {
    db = await provisionTestDb();
    pool = testPool(db, { connectionLimit: 4 }); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    await loadTokenRegistry(pool);
    await loadVariables(pool);
    await ensureVoiceToken(pool, "Village Voice");
    await loadTokenRegistry(pool);
    for (const id of ["p-worker", "p-donor", "p-refunded", "p-odd", "p-none"]) await member(id);

    await minted("p-worker", 1000, "quest_consent");

    await minted("p-donor", 1000, "role_cycle");
    await minted("p-donor", 1000, "donation_voice");
    await waned("p-donor", 20); // one percent of 20.00

    await minted("p-refunded", 1000, "proposal_accepted");
    const gift = await minted("p-refunded", 1000, "donation_voice");
    const back = await postClawbackMirror(pool, {
      from: memberAccount("p-refunded"), to: VOICE_MINT, tokenType: VILLAGE_VOICE, amount: 1000,
      sourceRef: gift, description: gift, idempotencyKey: `reversal:${villageId()}:${gift}`,
    });
    expect(back.ok, back.error).toBe(true);

    await minted("p-odd", 1000, "admin_mint");
    await minted("p-odd", 1000, "founding_allocation");
  }, 180_000);

  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  it("a member paid only for work counts their whole balance", async () => {
    const { byUser } = await workEarnedVoice(pool, ["p-worker"]);
    expect(byUser.get("p-worker")).toBe(1000);
  });

  it("donated Voice is left out, and decay takes the same share of both halves", async () => {
    const { byUser } = await workEarnedVoice(pool, ["p-donor"]);
    // 19.80 held after one percent waned, half of it from a role: 9.90.
    expect(byUser.get("p-donor")).toBe(990);
  });

  it("a donation that was reversed leaves the work share whole", async () => {
    const { byUser } = await workEarnedVoice(pool, ["p-refunded"]);
    expect(byUser.get("p-refunded")).toBe(1000);
  });

  it("a source nobody classified counts against the work share, and is reported", async () => {
    const { byUser, unclassified } = await workEarnedVoice(pool, ["p-odd"]);
    expect(byUser.get("p-odd")).toBe(1000);
    expect(unclassified).toEqual(["founding_allocation"]);
  });

  it("a member who holds nothing counts 0, and an empty list asks nothing", async () => {
    expect((await workEarnedVoice(pool, ["p-none"])).byUser.get("p-none")).toBe(0);
    expect((await workEarnedVoice(pool, [])).byUser.size).toBe(0);
  });

  it("reads several members in one call", async () => {
    const { byUser } = await workEarnedVoice(pool, ["p-worker", "p-donor", "p-none"]);
    expect([...byUser.entries()].sort()).toEqual([["p-donor", 990], ["p-none", 0], ["p-worker", 1000]]);
  });
});
