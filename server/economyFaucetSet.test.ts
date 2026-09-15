/**
 * THE FAUCET SET THE SUPPLY SURFACES READ, AND THE SIXTH FAUCET.
 *
 * `publicSupply` and the per-source breakdown inside `mintView` used to name
 * five faucet accounts by hand while `GET /api/admin/tokens` derived the same
 * set from `ledger_accounts.faucet = 1`. The three agreed and nothing made
 * them agree: the migrations seed exactly five rows with that flag
 * (`sys:gratitude-pool` and `sys:cycle-pool` in 0009, `sys:mint` in 0011,
 * `sys:library-mint` in 0024, `sys:voice-mint` in 0072) and every other system
 * account carries 0, so the hand-kept list was right by coincidence.
 *
 * A tripwire in `server/mintCap.e2e.test.ts` asserts the two sets are EQUAL
 * today, which is the fact that made the coincidence visible. This file
 * asserts the property that replaced it: a faucet the hand-kept list could
 * never have known about is counted by both surfaces. The two cases below are
 * written so that they FAIL on the hand-kept version of the code, which was
 * measured by running this file against it before the fix landed.
 *
 * Engine-level, over a scratch schema, with no server booted: the defect was
 * in two SQL reads and a route test would have proved the route instead.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import mysql from "mysql2/promise";
import { faucetAccounts, mintView, publicSupply } from "./lib/economy";
import { loadTokenRegistry, memberAccount, postTransfer, registerToken } from "./lib/ledger";
import { loadVariables } from "./lib/variables";
import { provisionTestDb, testDbConfigured, type TestDb } from "./db/testDb";

const configured = testDbConfigured();

let db: TestDb;
let pool: mysql.Pool;

/**
 * The five the migrations seed, written out so the assertion is a claim about
 * the MIGRATIONS and not a restatement of whatever the query returned. If a
 * lane seeds a sixth upstream faucet, this list is the thing that goes red,
 * and the two cases below are what say the supply surfaces already handle it.
 */
const SEEDED_FAUCETS = [
  "sys:cycle-pool",
  "sys:gratitude-pool",
  "sys:library-mint",
  "sys:mint",
  "sys:voice-mint",
];

/** A faucet no hand-kept list in this repository has ever heard of. */
const PROBE_FAUCET = "sys:probe-mint";
const PROBE_TOKEN = "probe-credit";
const PROBE_SOURCE = "probe_issue";

describe.skipIf(!configured)("the faucet set the supply surfaces read", () => {
  beforeAll(async () => {
    db = await provisionTestDb();
    pool = mysql.createPool({ uri: db.url, timezone: "Z", connectionLimit: 5 }); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    await loadTokenRegistry(pool);
    await loadVariables(pool);
  });

  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  it("reads exactly the faucets the migrations seed, and nothing else", async () => {
    expect(await faucetAccounts(pool)).toEqual(SEEDED_FAUCETS);
  });

  it("counts a sixth faucet in the public supply feed and in the admin breakdown", async () => {
    await pool.query( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
      "INSERT IGNORE INTO `ledger_accounts` (`id`, `kind`, `user_id`, `label`, `faucet`) VALUES (?,?,?,?,1)",
      [PROBE_FAUCET, "system", null, "A faucet added after the lists were written"],
    );
    await pool.query( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
      "INSERT INTO `users` (`id`, `name`, `email`, `password_hash`) VALUES (?,?,?,'x') " +
        "ON DUPLICATE KEY UPDATE `name` = VALUES(`name`)",
      ["probe-holder", "Probe Holder", "probe-holder@examples.invalid"],
    );
    await pool.query( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
      "INSERT IGNORE INTO `ledger_accounts` (`id`, `kind`, `user_id`, `label`, `faucet`) VALUES (?,?,?,?,0)",
      [memberAccount("probe-holder"), "member", "probe-holder", "Probe Holder"],
    );
    await registerToken(pool, {
      slug: PROBE_TOKEN,
      name: "Probe Credit",
      kind: "credit",
      governance: "platform",
      transferable: true,
    });

    // The helper sees it immediately, because the flag is the definition.
    expect(await faucetAccounts(pool)).toContain(PROBE_FAUCET);

    const posted = await postTransfer(pool, {
      from: PROBE_FAUCET,
      to: memberAccount("probe-holder"),
      tokenType: PROBE_TOKEN,
      amount: 700,
      source: PROBE_SOURCE,
      idempotencyKey: "probe:issue:1",
    });
    expect(posted.ok, posted.error ?? "").toBe(true);

    /*
     * THE PUBLIC FEED. Matched on the token's NAME, because that is what the
     * feed publishes: it renders `tokens.name` and falls back to the slug, so
     * asserting on the slug would pass against a feed that had stopped naming
     * anything.
     */
    const feed = await publicSupply(pool);
    const line = feed.tokens.find((t) => t.token === "Probe Credit");
    expect(line, "a sixth faucet's issuance must reach the public supply feed").toBeTruthy();
    expect(line!.issued).toBe(700);
    // Nothing waned, so circulating is the whole of it. An empty sink and a
    // zeroed one read the same here and both are honest: no Probe Credit has
    // ever left a wallet.
    expect(line!.waned).toBe(0);
    expect(line!.circulating).toBe(700);

    /*
     * THE ADMIN BREAKDOWN, which is the surface that answers per SOURCE. The
     * source is what a founder reads to decide whether an issuance was theirs,
     * so the assertion names it rather than only counting rows.
     */
    const admin = await mintView(pool);
    const row = admin.supply.find((s) => s.token === PROBE_TOKEN && s.source === PROBE_SOURCE);
    expect(row, "a sixth faucet's issuance must reach the admin per-source breakdown").toBeTruthy();
    expect(Number(row!.issued)).toBe(700);
  });

  /**
   * AN UNMIGRATED DATABASE IS NOT A VILLAGE THAT ISSUED NOTHING.
   *
   * With no faucet row at all the derived list is empty, and an empty list
   * spliced into an `IN (...)` clause is `IN ()`, which MySQL refuses to parse:
   * the public feed would have answered a SQL error to every reader. Both
   * callers return an empty supply instead. This case runs LAST because it
   * clears the flag on every account in this schema.
   */
  it("answers an empty supply rather than a SQL error when no account is a faucet", async () => {
    await pool.query("UPDATE `ledger_accounts` SET `faucet` = 0"); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    expect(await faucetAccounts(pool)).toEqual([]);
    expect((await publicSupply(pool)).tokens).toEqual([]);
    expect((await mintView(pool)).supply).toEqual([]);
  });
});
