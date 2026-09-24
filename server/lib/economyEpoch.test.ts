/**
 * The first quest of a village's life gets paid, and the epoch that once
 * stopped it is gone.
 *
 * ── WHY THIS FILE EXISTS, WHICH IS STILL THE MOST USEFUL PART ──────────────
 *
 * It exists because 3,666 tests were green while every village on the platform
 * silently lost its very first payout. `mintForConfirmedClaim` was the only
 * caller of `economyEpoch`, and `economyEpoch` STAMPED the epoch when it found
 * none. So the first confirmed claim in a fresh village wrote the epoch at
 * `now` and was then measured against it, having resolved twenty milliseconds
 * earlier. It lost. Once per village, deterministically, on the first piece of
 * work anybody there ever finished.
 *
 * Two things hid it, and both are worth naming because neither looks like a
 * gap when you are the one writing it:
 *
 *   1. `economySeed.test.ts` has a test called "pays a confirmed quest in
 *      voice and credits". It asserts on four columns of the `mint_rules`
 *      ROW. It proves the rule exists, is enabled, and carries the right
 *      amount. It never confirms a quest and never reads the ledger, so it
 *      would have stayed green through this bug for as long as the bug lived.
 *      A test named for an outcome that asserts on configuration proves the
 *      INTENT and not the outcome.
 *   2. That same file's `beforeAll` called `economyEpoch(pool)`, and so did
 *      `economy.test.ts` near the top. Both were reasonable: they wanted a
 *      running engine. But stamping the epoch in setup is exactly the state
 *      in which the bug cannot reproduce, so every later test in both files
 *      ran on the far side of the defect.
 *
 * ── WHY THE EPOCH IS GONE, AND WHAT THAT CHANGES HERE ─────────────────────
 *
 * Rye ruled on 2026-09-21: "No, definitely it's fine and encouraged to
 * acknowledge historical contributions when an economy gets launched." So work
 * confirmed before a village switched its economy on SHOULD be payable, and
 * the guard that refused it should not exist.
 *
 * It had already stopped refusing anything. An audit on `116d3bb` established
 * that `mintForConfirmedClaim` had no production caller after #264 and #269
 * moved the consent route onto `owedForClaim` and `postOwed`, that esbuild
 * dropped the whole function from the bundle, and that even before the split
 * the guard never fired: the consent route handed it `confirmedAt:
 * consented.resolvedAt`, which the same transaction had just stamped at `now`,
 * and boot stamped the epoch earlier still. So the removal takes away a branch
 * production never took.
 *
 * WHAT THE FIRST TWO TESTS NOW MEAN. They keep the defect above from coming
 * back by the only route still open: the first consent in a village's life
 * must pay, and the second must pay the same. They no longer touch an epoch,
 * because there is none to touch, and they run against the live path the
 * consent route runs. The rule the old header set still holds in spirit: this
 * file asserts on BALANCES and never on rules, because a test named for an
 * outcome that asserts on configuration proves the intent and not the outcome.
 *
 * THE LAST TWO TESTS ARE THE RATCHET. A deletion is only worth as much as its
 * staying deleted, so they read the source and fail if the guard or its
 * machinery comes back.
 */
import fs from "node:fs";
import path from "node:path";
import mysql from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { provisionTestDb, testDbConfigured, type TestDb } from "../db/testDb";
import { balanceOf, loadTokenRegistry, memberAccount } from "./ledger";
import { CREDITS, owedForClaim, postOwed, VILLAGE_VOICE, villageId } from "./economy";
import { seedEconomy } from "./economySeed";

const configured = testDbConfigured();
const VILLAGE = villageId();
const ROOT = path.resolve(__dirname, "..", "..");

let db: TestDb | undefined;
let pool: mysql.Pool;

/**
 * A token's scale, read off the registry rather than typed. The seeded
 * `quest.completed` rules pay 10 Voice and 25 Credits, both HUMAN numbers in
 * `mint_rules.amount`, and `balanceOf` answers in MINOR units. Those were the
 * same number until `0202`, which is why these assertions read as bare
 * literals and why the literal is the wrong shape rather than the wrong value.
 */
async function scaleOf(slug: string): Promise<number> {
  const [rows] = await pool.query<any[]>("SELECT `decimals` FROM `tokens` WHERE `slug` = ?", [slug]); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
  return 10 ** Number(rows[0]?.decimals ?? 0);
}

/** A member who can be paid. The mint needs a user row and a ledger account. */
async function seatAMember(id: string): Promise<string> {
  await pool.query( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    "INSERT INTO `users` (`id`, `name`, `email`, `password_hash`) VALUES (?,?,?,'x') " +
      "ON DUPLICATE KEY UPDATE `name` = VALUES(`name`)",
    [id, id, `${id}@examples.invalid`],
  );
  await pool.query( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    "INSERT IGNORE INTO `ledger_accounts` (`id`, `kind`, `user_id`, `label`, `faucet`) VALUES (?,?,?,?,0)",
    [memberAccount(id), "member", id, id],
  );
  return id;
}

/**
 * The live path: price what the consent owes, then post each row. The same two
 * steps `server/routes/questClaims.ts` takes across its commit.
 *
 * `granted` is passed above zero because `OwedClaim` requires it and
 * `priceClaim` prices no rule at zero or less. Without it these cases would
 * price nothing and their balance assertions would read an empty ledger, which
 * is the same shape of false green this file was written about.
 */
async function payClaim(id: string, questId: string, userId: string): Promise<string[]> {
  const priced = await owedForClaim(pool, { id, questId, userId, granted: 1 });
  for (const row of priced.owed) await postOwed(pool, row);
  return priced.owed.map((o) => o.tokenSlug);
}

describe.skipIf(!configured)("the first confirmed quest in a village's life", () => {
  beforeAll(async () => {
    db = await provisionTestDb();
    pool = mysql.createPool({ uri: db.url, timezone: "Z", connectionLimit: 10 }); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    await loadTokenRegistry(pool);
    await seedEconomy(pool, VILLAGE);
    await loadTokenRegistry(pool);
  });

  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  it("pays credits and voice, on a village where nothing has ever been minted", async () => {
    const u = await seatAMember("epoch-first");
    const priced = await payClaim("claim-first", "quest-first", u);
    // The denominator. A pricing that produced nothing would leave both
    // balances at zero below and read exactly like the defect this file exists
    // to catch, which is the one way this test could lie.
    expect(priced).toEqual(expect.arrayContaining([CREDITS, VILLAGE_VOICE]));
    // The seeded rule pays 25 Credits and 10 Voice, both whole tokens.
    expect(await balanceOf(pool, memberAccount(u), CREDITS)).toBe(25 * (await scaleOf(CREDITS)));
    expect(await balanceOf(pool, memberAccount(u), VILLAGE_VOICE)).toBe(10 * (await scaleOf(VILLAGE_VOICE)));
  });

  it("pays the SECOND quest exactly what it paid the first", async () => {
    const u = await seatAMember("epoch-second");
    const priced = await payClaim("claim-second", "quest-second", u);
    expect(priced).toContain(CREDITS); // denominator
    expect(await balanceOf(pool, memberAccount(u), CREDITS)).toBe(25 * (await scaleOf(CREDITS)));
  });
});

/**
 * THE RATCHET. These two read the source and need no database, so they run
 * wherever the suite runs.
 */
describe("the epoch guard stays removed", () => {
  it("declares no `mintForConfirmedClaim` and no epoch machinery in the engine", () => {
    const src = fs.readFileSync(path.join(ROOT, "server", "lib", "economy.ts"), "utf8");
    // DECLARATIONS, not mentions. Prose that records what the epoch was and why
    // it went is the most useful thing left of it, and a guard that forbade the
    // NAME would push the next author into deleting the account rather than
    // keeping it. What must not come back is the machinery.
    for (const gone of ["mintForConfirmedClaim", "startEconomyEpoch", "economyEpoch", "forgetEpoch", "epochCache"]) {
      const declared = new RegExp(`(function|const|let|var)\\s+${gone}\\b`);
      expect(declared.test(src), `server/lib/economy.ts declares \`${gone}\` again`).toBe(false);
    }
    // A known positive, so a passing run cannot mean the regex never matches
    // anything: a symbol that IS declared here has to be found by the same test.
    expect(new RegExp("(function|const|let|var)\\s+owedForClaim\\b").test(src)).toBe(true);
  });

  // The name avoids the sentence too, for the reason written inside it.
  it("leaves the guard's refusal sentence nowhere in the server source", () => {
    // The sentence the guard returned. It is checked over the SOURCE and not
    // over `dist/index.js`, because esbuild already dropped the function from
    // the bundle while it was merely uncalled: a bundle grep was 0 before this
    // removal and would have proved nothing about it.
    // THE NEEDLE IS SPELLED IN PIECES so this file is not its own haystack.
    // Written whole, the scan found itself and reported `economyEpoch.test.ts`
    // as a surviving guard: a measurement the act of measuring had changed.
    // The same trap caught a grep documented in #292's own comment.
    const needle = ["confirmed before", "the economy epoch"].join(" ");
    const hits: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith(".ts") && fs.readFileSync(full, "utf8").includes(needle)) {
          hits.push(path.relative(ROOT, full));
        }
      }
    };
    walk(path.join(ROOT, "server"));
    // A known positive first: the walk has to be able to find anything at all,
    // or a clean result means the scan did not run. An empty search proves
    // nothing until a search that should succeed has.
    expect(fs.readFileSync(path.join(ROOT, "server", "lib", "economy.ts"), "utf8")).toContain("owedForClaim");
    expect(hits).toEqual([]);
  });
});
