/**
 * WHAT THE DRY RUN READS OFF A REAL VILLAGE, MEASURED AGAINST THE TABLES.
 *
 * Every number below is read back out of a scratch schema that the real
 * migrations built and the real `seedEconomy` seeded. Nothing here is a
 * fixture of the reader's own making, because a reader tested against a
 * fixture only ever proves it agrees with whoever wrote the fixture.
 *
 * Four things this file is trying to catch, in the order they would hurt:
 *
 *   1. A BALANCE THAT MOVED. The whole cardinal rule of the dry run is that a
 *      simulation never writes to the ledger, and the reader is the one piece
 *      of it that holds a connection. So the module's own bytes are walked for
 *      anything that is not a SELECT, the fence the caller opens is proven to
 *      be a real fence (MySQL and MariaDB both refuse a write inside it with
 *      errno 1792), and the reader is proven to run whole inside it.
 *   2. A ROUNDED NUMBER PRESENTED AS A WRITTEN ONE. `mint_rules.amount` is
 *      `decimal(18,4)` and a token with no decimals turns 0.0004 into zero
 *      minor units. The pair of fields exists so a model can tell a deliberate
 *      zero from one that rounded away, and both halves are measured here.
 *   3. A MOCK PRESENTED AS A MEASUREMENT. An empty table falls back to the
 *      seed, and `economyProvenance` has to say so.
 *   4. A SNAPSHOT THAT CANNOT CONSERVE. The last test runs the reader's own
 *      output through `simulate` for one cycle and asserts every token still
 *      sums to zero across every account.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import mysql from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { economicsModel, readEconomicsMemo } from "../../shared/dryRun/economicsModel";
import { simulate } from "../../shared/dryRun/simulate";
import type { MintRuleSpec, TokenSpec, VillageSnapshot } from "../../shared/dryRun/types";
import { VARIABLES, VARIABLES_BY_KEY } from "../../shared/gameVariables";
import { provisionTestDb, testDbConfigured, type TestDb } from "../db/testDb";
import {
  economyProvenance,
  readEconomySnapshot,
  seedSnapshotFields,
  type EconomySnapshotFields,
} from "./dryRunEconomyReader";
import { CREDITS, CURRENCY_DECIMALS, HEARTS, VILLAGE_VOICE, VOICE_DECIMALS, villageId } from "./economy";
import { seedEconomy } from "./economySeed";
import { recordGameStart } from "./gameStart";
import { RECOGNITION_FAUCET, TREASURY, loadTokenRegistry, memberAccount, postTransfer } from "./ledger";

const configured = testDbConfigured();

/** The engine's own village id. A rule seeded anywhere else is a rule the reader will not see. */
const VILLAGE = villageId();

/** Midday, inside a lunation and inside a month, so neither clock sits on a boundary. */
const AT_ISO = "2026-09-03T12:00:00.000Z";

/** A rule, found by id. Named so a failure says which rule rather than which index. */
function ruleById(rules: MintRuleSpec[], id: string): MintRuleSpec {
  const found = rules.find((r) => r.id === id);
  if (!found) throw new Error(`no mint rule ${id} in ${rules.map((r) => r.id).join(", ")}`);
  return found;
}

/** A token, found by slug. */
function tokenBySlug(tokens: TokenSpec[], slug: string): TokenSpec {
  const found = tokens.find((t) => t.slug === slug);
  if (!found) throw new Error(`no token ${slug} in ${tokens.map((t) => t.slug).join(", ")}`);
  return found;
}

/** Slug to decimals, which is the one fact every amount in the snapshot is scaled by. */
function decimalsOf(tokens: TokenSpec[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const t of tokens) out[t.slug] = t.decimals;
  return out;
}

/** Every token's total across every account. The ledger's own invariant, asked of the snapshot. */
function sumsPerToken(balances: Record<string, Record<string, bigint>>): Record<string, bigint> {
  const out: Record<string, bigint> = {};
  for (const account of Object.keys(balances)) {
    const row = balances[account] ?? {};
    for (const slug of Object.keys(row)) {
      out[slug] = (out[slug] ?? BigInt(0)) + row[slug];
    }
  }
  return out;
}

/**
 * The governance half of a snapshot, supplied by this test so the economy half
 * can be run through the engine. The composing reader fills these for real.
 */
function snapshotAround(economy: EconomySnapshotFields, memberId: string): VillageSnapshot {
  return {
    atIso: AT_ISO,
    launched: true,
    quests: { open: 1, confirmedPerCycle: 1, gratitudePerConfirmation: BigInt(0) },
    clock: { mode: "lunar", timezone: "UTC" },
    members: [{ id: memberId, accountId: memberAccount(memberId), stage: "member", seats: [] }],
    modules: { quests: "public", gratitude: "public", progression: "public", profiles: "public" },
    ...economy,
  };
}

// ───────────────────────────────────────────────────────────────────────────
// A village that has been seeded and has moved value.
// ───────────────────────────────────────────────────────────────────────────

describe.skipIf(!configured)("the economy snapshot of a live village", () => {
  let db: TestDb;
  let pool: mysql.Pool;
  const MEMBER = "u-rd";

  beforeAll(async () => {
    db = await provisionTestDb();
    pool = mysql.createPool({ uri: db.url, timezone: "Z", connectionLimit: 6 });
    await loadTokenRegistry(pool);
    // Registers `village-voice` at VOICE_DECIMALS and writes the default rules.
    await seedEconomy(pool, VILLAGE);
    await loadTokenRegistry(pool);
    // Faucet postings are refused until the launch vote carries (R67, R74).
    await recordGameStart(pool, {
      ballotId: "bal-rd",
      startedBy: "u-closer",
      note: "The village voted to start its Game.",
      at: new Date(AT_ISO),
    });
    const moved = await postTransfer(pool, {
      from: RECOGNITION_FAUCET,
      to: memberAccount(MEMBER),
      tokenType: HEARTS,
      amount: 40,
      source: "manual",
      idempotencyKey: "rd-recognition-1",
    });
    expect(moved.ok).toBe(true);
    // One stored override, written here and not inside a test, so the row
    // counts every test below reads do not depend on the order they run in.
    await pool.query(
      "INSERT INTO `game_variables` (`config_key`, `value`, `value_type`) VALUES (?,?,?)",
      ["gratitude.pool_per_cycle", "1234", "integer"],
    );
  });

  afterAll(async () => {
    if (pool) await pool.end();
    if (db) await db.drop();
  });

  async function read(): Promise<EconomySnapshotFields> {
    const conn = await pool.getConnection();
    try {
      return await readEconomySnapshot(conn);
    } finally {
      conn.release();
    }
  }

  it("answers exactly the four economy fields, and nothing beside them", async () => {
    // The runtime half of the same claim the source walk makes. The composing
    // reader spreads this straight into a `VillageSnapshot`, so a fifth key
    // here lands on the snapshot it asserts the shape of.
    const snapshot = await read();
    expect(Object.keys(snapshot).sort()).toEqual(["balances", "mintRules", "tokens", "variables"]);
  });

  it("carries every token in the registry, with the decimals the registry holds", async () => {
    const snapshot = await read();
    const places = decimalsOf(snapshot.tokens);

    // The four rows the migrations seed, plus the one `ensureVoiceToken`
    // registers at boot. `0006` gives every migrated row `decimals int NOT NULL
    // DEFAULT 0` and `0162` then raises the currency-like ones, which is
    // `credits` here: recognition and the two hypha mirrors stay whole and
    // village-voice takes VOICE_DECIMALS.
    expect(Object.keys(places).sort()).toEqual(["credits", "equity", "gratitude", "village-voice", "voice"]);
    expect(places["gratitude"]).toBe(0);
    expect(places["credits"]).toBe(CURRENCY_DECIMALS);
    expect(places["voice"]).toBe(0);
    expect(places["equity"]).toBe(0);
    expect(places["village-voice"]).toBe(VOICE_DECIMALS);
    expect(VOICE_DECIMALS).toBe(2);
    expect(CURRENCY_DECIMALS).toBe(2);

    // The three facts behind three of `ruleCannotPay`'s four refusals.
    const gratitude = tokenBySlug(snapshot.tokens, HEARTS);
    expect(gratitude.governance).toBe("platform");
    expect(gratitude.active).toBe(true);
    expect(gratitude.faucet).toBe(RECOGNITION_FAUCET);
    expect(gratitude.sinks).toEqual([TREASURY]);

    // A Hypha mirror this platform may never post, so it names no sink here.
    const mirror = tokenBySlug(snapshot.tokens, "voice");
    expect(mirror.governance).toBe("hypha");
    expect(mirror.faucet).toBeNull();
    expect(mirror.sinks).toEqual([]);

    // village-voice issues from its own mint.
    expect(tokenBySlug(snapshot.tokens, VILLAGE_VOICE).faucet).toBe("sys:voice-mint");
  });

  it("carries every balance as a bigint, faucets and their negatives included", async () => {
    const snapshot = await read();

    const [rows] = await pool.query<any[]>(
      "SELECT `account_id`, `token_type`, `balance` FROM `token_balances` ORDER BY `account_id`, `token_type`",
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      const held = snapshot.balances[String(row.account_id)];
      expect(held, `${row.account_id} is absent from the snapshot`).toBeDefined();
      expect(held[String(row.token_type)]).toBe(BigInt(String(row.balance)));
      expect(typeof held[String(row.token_type)]).toBe("bigint");
    }

    // The faucet's negative IS the issued supply, and it has to survive the
    // read or nothing downstream can conserve.
    expect(snapshot.balances[RECOGNITION_FAUCET][HEARTS]).toBe(BigInt(-40));
    expect(snapshot.balances[memberAccount(MEMBER)][HEARTS]).toBe(BigInt(40));

    // Conservation, asked of the snapshot rather than of the database.
    const sums = sumsPerToken(snapshot.balances);
    for (const slug of Object.keys(sums)) {
      expect(sums[slug], `${slug} does not sum to zero across the snapshot`).toBe(BigInt(0));
    }

    // An account that exists and has never held a token is an empty row, not
    // an absent one: the model reads an absent faucet as an account that does
    // not exist and raises a danger flag for it.
    expect(snapshot.balances["sys:voice-mint"]).toEqual({});
    expect(snapshot.balances["sys:cycle-pool"]).toEqual({});
  });

  it("carries every seeded rule, disabled ones included, in minor units and in the column's own text", async () => {
    const snapshot = await read();
    expect(snapshot.mintRules.map((r) => r.id).sort()).toEqual([
      "rule-quest.completed-credits",
      "rule-quest.completed-village-voice",
      "rule-role.cycle-credits",
      "rule-role.cycle-gratitude",
      "rule-role.cycle-village-voice",
    ]);

    // 10 village-voice at two places is 1000 minor units, and the column holds
    // the whole number as four-place text whatever the token's own scale is.
    const questVoice = ruleById(snapshot.mintRules, "rule-quest.completed-village-voice");
    expect(questVoice.amount).toBe(BigInt(10 * 10 ** VOICE_DECIMALS));
    expect(questVoice.amountRaw).toBe("10.0000");
    expect(questVoice.ceiling).toBe(BigInt(100 * 10 ** VOICE_DECIMALS));
    expect(questVoice.ceilingRaw).toBe("100.0000");
    expect(questVoice.enabled).toBe(true);
    expect(questVoice.recipient).toBe("claimant");

    // 25 credits at two places is 2500 minor units, since 0162.
    const questCredits = ruleById(snapshot.mintRules, "rule-quest.completed-credits");
    expect(questCredits.amount).toBe(BigInt(25 * 10 ** CURRENCY_DECIMALS));
    expect(questCredits.amountRaw).toBe("25.0000");
    expect(questCredits.ceiling).toBe(BigInt(250 * 10 ** CURRENCY_DECIMALS));

    // Off, and still in the snapshot. A change set can turn it on, so a
    // snapshot that dropped it could not preview that decision at all.
    const seatGratitude = ruleById(snapshot.mintRules, "rule-role.cycle-gratitude");
    expect(seatGratitude.enabled).toBe(false);
    expect(seatGratitude.amount).toBe(BigInt(20));
  });

  it("materialises the platform default for a key the village never stored, and the village's own where it did", async () => {
    const after = await read();
    // The one key this village has an opinion about.
    expect(after.variables["gratitude.pool_per_cycle"]).toBe("1234");
    // The stored value must not be the default it replaced, or this proves nothing.
    expect(VARIABLES_BY_KEY["gratitude.pool_per_cycle"].default).not.toBe("1234");
    // An unstored neighbour still carries its default.
    expect(after.variables["gratitude.base_budget"]).toBe(
      VARIABLES_BY_KEY["gratitude.base_budget"].default,
    );
    // Every key in the registry is present, stored or not.
    expect(Object.keys(after.variables).length).toBe(VARIABLES.length);
    // Every key the economics model reads is present, so it never sees undefined.
    for (const key of [
      "gratitude.base_budget",
      "gratitude.pool_per_cycle",
      "gratitude.pool_token",
      "gratitude.max_share_per_recipient",
      "governance.weight_mode",
      "governance.weight_token",
      "ledger.admin_mint_cycle_cap",
      "progression.multiplier.member",
    ]) {
      expect(after.variables[key], `${key} is missing from the snapshot`).toBeDefined();
    }
  });

  it("runs whole inside a transaction the caller opened READ ONLY", async () => {
    const conn = await pool.getConnection();
    try {
      await conn.query("SET TRANSACTION READ ONLY");
      await conn.query("START TRANSACTION");
      const snapshot = await readEconomySnapshot(conn);
      const provenance = await economyProvenance(conn);
      await conn.query("COMMIT");
      expect(snapshot.tokens.length).toBe(5);
      expect(snapshot.mintRules.length).toBe(5);
      expect(provenance.anySeeded).toBe(false);
    } finally {
      conn.release();
    }
  });

  it("is fenced by a transaction the database itself refuses a write in", async () => {
    // The fence is only worth anything if it is real. MySQL 8 and MariaDB both
    // answer errno 1792 here, so this holds on CI's service container and on a
    // local server alike.
    const conn = await pool.getConnection();
    let refusal: any = null;
    try {
      await conn.query("SET TRANSACTION READ ONLY");
      await conn.query("START TRANSACTION");
      await readEconomySnapshot(conn);
      try {
        await conn.query(
          "INSERT INTO `game_variables` (`config_key`, `value`, `value_type`) VALUES (?,?,?)",
          ["rd-fence-probe", "1", "text"],
        );
      } catch (e) {
        refusal = e;
      }
      await conn.query("ROLLBACK");
    } finally {
      conn.release();
    }
    expect(refusal, "the read-only transaction accepted a write").not.toBeNull();
    expect(refusal.errno).toBe(1792);
  });

  it("says every section is live, with the row counts it read", async () => {
    const conn = await pool.getConnection();
    let provenance;
    try {
      provenance = await economyProvenance(conn);
    } finally {
      conn.release();
    }
    expect(provenance.tokens.source).toBe("live");
    expect(provenance.tokens.rows).toBe(5);
    expect(provenance.mintRules.source).toBe("live");
    expect(provenance.mintRules.rows).toBe(5);
    expect(provenance.balances.source).toBe("live");
    expect(provenance.balances.rows).toBe(2);
    expect(provenance.variables.rows).toBe(1);
    expect(provenance.anySeeded).toBe(false);
    expect(provenance.sentence).toBe(
      `tokens: live (5 rows), mint rules: live (5 rows), balances: live (2 rows), ` +
        `variables: live (1 stored, ${VARIABLES.length} platform defaults)`,
    );
  });

  it("feeds one cycle of the economics model and still conserves", async () => {
    const economy = await read();
    const result = simulate(
      {
        snapshot: snapshotAround(economy, MEMBER),
        changes: [],
        cycles: 1,
        seed: 20260903,
      },
      [economicsModel()],
    );

    expect(result.baseline.length).toBe(1);
    expect(result.proposed.length).toBe(1);
    expect(result.violations).toEqual([]);

    const final = result.proposed[0].state;
    const sums = sumsPerToken(final.balances);
    for (const slug of Object.keys(sums)) {
      expect(sums[slug], `${slug} does not conserve after one cycle`).toBe(BigInt(0));
    }

    // The cycle did something, or conservation is a statement about nothing.
    const memo = readEconomicsMemo(final);
    expect(memo, "the economics model kept no memo").not.toBeNull();
    expect(memo!.postings).toBeGreaterThan(0);
    expect(memo!.launched).toBe(true);

    // No faucet was reported missing: every account the ledger holds is in the
    // snapshot, empty rows and all.
    expect(result.flags.filter((f) => f.code === "econ_faucet_account_missing")).toEqual([]);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// The written number against the number that pays.
// ───────────────────────────────────────────────────────────────────────────

describe.skipIf(!configured)("a rule written below its token's own resolution", () => {
  let db: TestDb;
  let pool: mysql.Pool;

  beforeAll(async () => {
    db = await provisionTestDb();
    pool = mysql.createPool({ uri: db.url, timezone: "Z", connectionLimit: 4 });
    await loadTokenRegistry(pool);
    await seedEconomy(pool, VILLAGE);

    // A token with four places, which is the resolution `decimal(18,4)` itself
    // has. No migration seeds one, so this is the only way to measure the far
    // end of the scaling.
    await pool.query(
      "INSERT INTO `tokens` (`slug`, `name`, `kind`, `governance`, `transferable`, `decimals`, `active`, `sort_order`) " +
        "VALUES (?,?,?,?,?,?,?,?)",
      ["fine-grain", "Fine Grain", "credit", "platform", 0, 4, 1, 90],
    );

    // 0.0004 on a token with NO places. The engine rounds it to nothing.
    await pool.query(
      "INSERT INTO `mint_rules` (`id`, `village_id`, `trigger`, `token_slug`, `amount`, `ceiling`, `recipient`, `enabled`) " +
        "VALUES (?,?,?,?,?,?,?,?)",
      ["rd-rounds-away", VILLAGE, "gratitude.given", CREDITS, "0.0004", "1", "receiver", 1],
    );
    // The same text on a token with four places, where it is four minor units.
    await pool.query(
      "INSERT INTO `mint_rules` (`id`, `village_id`, `trigger`, `token_slug`, `amount`, `ceiling`, `recipient`, `enabled`) " +
        "VALUES (?,?,?,?,?,?,?,?)",
      ["rd-fine-grain", VILLAGE, "gratitude.given", "fine-grain", "0.0004", "0.0004", "receiver", 1],
    );
    // A figure the column holds exactly and a double does not. TWO places of
    // village-voice against a four-place column, and the figure had to be
    // re-chosen when the scale ruling took Voice from three places to two:
    // `0.5005` discriminated the two arithmetics at THREE places and both give
    // 50 at two, so keeping it would have left a green test that proved
    // nothing. `1.0050` is the same shape at the new scale, found the same way.
    await pool.query(
      "INSERT INTO `mint_rules` (`id`, `village_id`, `trigger`, `token_slug`, `amount`, `ceiling`, `recipient`, `enabled`) " +
        "VALUES (?,?,?,?,?,?,?,?)",
      ["rd-half-up", VILLAGE, "gratitude.given", VILLAGE_VOICE, "1.0050", "9", "receiver", 1],
    );
    // No amount at all: the amount rides on whatever the source posted.
    await pool.query(
      "INSERT INTO `mint_rules` (`id`, `village_id`, `trigger`, `token_slug`, `amount`, `ceiling`, `recipient`, `enabled`) " +
        "VALUES (?,?,?,?,NULL,?,?,?)",
      ["rd-from-source", VILLAGE, "library.contributed", CREDITS, "5", "claimant", 1],
    );
  });

  afterAll(async () => {
    if (pool) await pool.end();
    if (db) await db.drop();
  });

  async function rules(): Promise<MintRuleSpec[]> {
    const conn = await pool.getConnection();
    try {
      return (await readEconomySnapshot(conn)).mintRules;
    } finally {
      conn.release();
    }
  }

  it("reads a rounded-away amount as zero minor units and keeps the text that says so", async () => {
    const rule = ruleById(await rules(), "rd-rounds-away");
    expect(rule.amount).toBe(BigInt(0));
    // The text is what tells a written zero from one that rounded away, and
    // this one is not the text a deliberate zero would carry.
    expect(rule.amountRaw).toBe("0.0004");
    expect(rule.amountRaw).not.toBe("0.0000");
  });

  it("reads the same text as four minor units on a token with four places", async () => {
    const rule = ruleById(await rules(), "rd-fine-grain");
    expect(rule.amount).toBe(BigInt(4));
    expect(rule.amountRaw).toBe("0.0004");
    // The ceiling carries the same pair, and it is the field that matters
    // most: a cap below the token's resolution reads as refuse-everything.
    expect(rule.ceiling).toBe(BigInt(4));
    expect(rule.ceilingRaw).toBe("0.0004");
  });

  it("scales on the column's text, where a double would land a unit short", async () => {
    const rule = ruleById(await rules(), "rd-half-up");
    // 1.0050 at two places is 100.5 minor units, and half goes up, so 101.
    expect(rule.amount).toBe(BigInt(101));
    expect(rule.amountRaw).toBe("1.0050");
    // The same figure through a double, which is what this reader refuses to
    // do: 1.0050 is not representable, 1.0050 * 100 is 100.49999999999999,
    // and the nearest whole number to that is 100. One hundredth of
    // somebody's Voice, lost to IEEE, on every occurrence this rule fires.
    //
    // THIS LINE IS THE POINT OF THE TEST. The two amounts either side of it
    // were both chosen so the two arithmetics AGREE on them, which means
    // neither of them can tell a text scaling from a float one. This figure
    // was found by scanning every four-place decimal against three places
    // until the two answers parted, and it is the smallest one that does.
    expect(Math.round(Number(rule.amountRaw) * 100)).toBe(100);
  });

  it("reads a NULL amount as null, with an empty string beside it", async () => {
    const rule = ruleById(await rules(), "rd-from-source");
    expect(rule.amount).toBeNull();
    expect(rule.amountRaw).toBe("");
    // The ceiling column is NOT NULL, so a from-source rule still has a cap.
    // 5 credits at two places, since 0162.
    expect(rule.ceiling).toBe(BigInt(5 * 10 ** CURRENCY_DECIMALS));
    expect(rule.ceilingRaw).toBe("5.0000");
  });
});

// ───────────────────────────────────────────────────────────────────────────
// A village whose economy has not been seeded yet.
// ───────────────────────────────────────────────────────────────────────────

describe.skipIf(!configured)("the seed fallback, and saying it is a seed", () => {
  let db: TestDb;
  let pool: mysql.Pool;
  let migratedSlugs: string[] = [];

  beforeAll(async () => {
    db = await provisionTestDb();
    pool = mysql.createPool({ uri: db.url, timezone: "Z", connectionLimit: 4 });
    // What the migrations alone put in the registry, before any boot code runs.
    const [rows] = await pool.query<any[]>("SELECT `slug` FROM `tokens` ORDER BY `slug`");
    migratedSlugs = rows.map((r: any) => String(r.slug));
    // Now empty both tables, which is the state a founder can open a preview in.
    await pool.query("DELETE FROM `tokens`");
    await pool.query("DELETE FROM `mint_rules`");
    await loadTokenRegistry(pool);
  });

  afterAll(async () => {
    if (pool) await pool.end();
    if (db) await db.drop();
  });

  async function readBoth() {
    const conn = await pool.getConnection();
    try {
      return {
        snapshot: await readEconomySnapshot(conn),
        provenance: await economyProvenance(conn),
        seed: await seedSnapshotFields(conn),
      };
    } finally {
      conn.release();
    }
  }

  it("the seed's registry is what the migrations seed plus the token boot registers", async () => {
    const { seed } = await readBoth();
    const seeded = seed.tokens.map((t) => t.slug).sort();
    expect(migratedSlugs).toEqual(["credits", "equity", "gratitude", "voice"]);
    expect(seeded).toEqual(migratedSlugs.concat([VILLAGE_VOICE]).sort());
    expect(tokenBySlug(seed.tokens, VILLAGE_VOICE).decimals).toBe(VOICE_DECIMALS);
  });

  it("an empty registry yields the seed's tokens, and the provenance says so", async () => {
    const { snapshot, provenance } = await readBoth();
    expect(snapshot.tokens.map((t) => t.slug).sort()).toEqual(
      ["credits", "equity", "gratitude", "village-voice", "voice"],
    );
    expect(provenance.tokens.source).toBe("seed");
    expect(provenance.tokens.rows).toBe(5);
    expect(provenance.tokens.clause).toBe("tokens: seed defaults (5 rows)");
    expect(provenance.anySeeded).toBe(true);
  });

  it("an empty rules table yields the seed's rules, scaled against the seed's tokens", async () => {
    const { snapshot, provenance } = await readBoth();
    expect(snapshot.mintRules.map((r) => r.id).sort()).toEqual([
      "rule-quest.completed-credits",
      "rule-quest.completed-village-voice",
      "rule-role.cycle-credits",
      "rule-role.cycle-gratitude",
      "rule-role.cycle-village-voice",
    ]);
    const voice = ruleById(snapshot.mintRules, "rule-role.cycle-village-voice");
    expect(voice.amount).toBe(BigInt(50 * 10 ** VOICE_DECIMALS));
    expect(voice.amountRaw).toBe("50.0000");
    expect(voice.ceiling).toBe(BigInt(200 * 10 ** VOICE_DECIMALS));
    expect(provenance.mintRules.source).toBe("seed");
    expect(provenance.mintRules.clause).toBe("mint rules: seed defaults (5 rows)");
  });

  it("balances and variables stay live and say zero, because zero is a measurement", async () => {
    const { snapshot, provenance } = await readBoth();
    expect(provenance.balances.source).toBe("live");
    expect(provenance.balances.rows).toBe(0);
    expect(provenance.balances.clause).toBe("balances: live (0 rows)");
    expect(provenance.variables.source).toBe("live");
    expect(provenance.variables.rows).toBe(0);
    // Every system account the migrations seed is there, and all of them are
    // empty. Sixteen of them, which is more than the five faucets a token can
    // issue from: the escrows, the sinks and the settled-voice vault are
    // ordinary accounts and they belong in the snapshot for the same reason,
    // which is that a posting into an account the snapshot does not know about
    // cannot be previewed at all.
    //
    // A NEW SYSTEM ACCOUNT IS EXPECTED TO BREAK THIS CASE, AND THAT IS THE
    // POINT. The list is pinned rather than counted or filtered because a
    // pinned enumeration costs exactly one red per legitimate addition, and
    // the alternative costs an addition nobody notices. It has already earned
    // that once: `sys:voice-decay` arrived with drizzle/0165_voice_that_waned
    // from the decay lane, and this line is what said so. Twice now:
    // `sys:redemption-hold` and `sys:redeemed` arrived with
    // drizzle/0161_a_member_redeems_what_they_hold from the redemption lane, and
    // both belong in the snapshot by the rule above, because a redemption posts
    // into one of them and then the other. If you are here
    // because you added an account, add it to the list and read the sentence
    // above to check the snapshot should carry it. It almost certainly should.
    expect(Object.keys(snapshot.balances).sort()).toEqual([
      "sys:cycle-pool",
      "sys:event-escrow",
      "sys:exit-settlement",
      "sys:gratitude-pool",
      "sys:library-escrow",
      "sys:library-mint",
      "sys:library-pool",
      "sys:library-sink",
      "sys:mint",
      "sys:redeemed",
      "sys:redemption-hold",
      "sys:treasury",
      "sys:voice-bridge",
      "sys:voice-decay",
      "sys:voice-mint",
      "sys:voice-settled",
    ]);
    for (const account of Object.keys(snapshot.balances)) {
      expect(snapshot.balances[account]).toEqual({});
    }
    expect(Object.keys(snapshot.variables).length).toBe(VARIABLES.length);
  });

  it("the seed's own fields hold the accounts a Birthing creates, all at zero", async () => {
    const { seed } = await readBoth();
    expect(Object.keys(seed.balances).sort()).toEqual([
      "sys:cycle-pool",
      "sys:gratitude-pool",
      "sys:treasury",
      "sys:voice-mint",
    ]);
    for (const account of Object.keys(seed.balances)) {
      expect(seed.balances[account]).toEqual({});
    }
    expect(Object.keys(seed).sort()).toEqual(["balances", "mintRules", "tokens", "variables"]);
    expect(Object.keys(seed.variables).length).toBe(VARIABLES.length);
  });

  it("the seed's tokens and rules are what a real boot writes, field for field", async () => {
    // The reader mirrors economySeed's private RULES list and the registry the
    // migrations plus `ensureVoiceToken` produce. Neither is exported, so the
    // only honest check is to run the real thing and compare. This is the test
    // that fails the day somebody retunes the seed and forgets the mirror.
    const fresh = await provisionTestDb();
    const other = mysql.createPool({ uri: fresh.url, timezone: "Z", connectionLimit: 4 });
    try {
      await loadTokenRegistry(other);
      await seedEconomy(other, VILLAGE);
      await loadTokenRegistry(other);

      const [ruleRows] = await other.query<any[]>(
        "SELECT `id`, `trigger`, `token_slug`, `amount`, `ceiling`, `recipient`, `enabled` " +
          "FROM `mint_rules` WHERE `village_id` = ? ORDER BY `id`",
        [VILLAGE],
      );
      const writtenRules = ruleRows.map((r: any) => ({
        id: String(r.id),
        trigger: String(r.trigger),
        tokenSlug: String(r.token_slug),
        amountRaw: String(r.amount),
        ceilingRaw: String(r.ceiling),
        recipient: String(r.recipient),
        enabled: !!r.enabled,
      }));

      const [tokenRows] = await other.query<any[]>(
        "SELECT `slug`, `kind`, `decimals`, `governance` FROM `tokens` ORDER BY `slug`",
      );
      const writtenTokens = tokenRows.map((r: any) => ({
        slug: String(r.slug),
        kind: String(r.kind),
        decimals: Number(r.decimals),
        governance: r.governance === "hypha" ? "hypha" : "platform",
      }));

      const { seed } = await readBoth();

      expect(
        seed.mintRules
          .map((r) => ({
            id: r.id,
            trigger: r.trigger,
            tokenSlug: r.tokenSlug,
            amountRaw: r.amountRaw,
            ceilingRaw: r.ceilingRaw,
            recipient: r.recipient,
            enabled: r.enabled,
          }))
          .sort((a, b) => (a.id < b.id ? -1 : 1)),
      ).toEqual(writtenRules);

      expect(
        seed.tokens
          .map((t) => ({ slug: t.slug, kind: t.kind, decimals: t.decimals, governance: t.governance }))
          .sort((a, b) => (a.slug < b.slug ? -1 : 1)),
      ).toEqual(writtenTokens);
    } finally {
      await other.end();
      await fresh.drop();
    }
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Read only by construction, proven from the module's own bytes.
// ───────────────────────────────────────────────────────────────────────────

describe("the reader cannot write, and the shape of that claim", () => {
  const HERE = path.dirname(fileURLToPath(import.meta.url));
  const SOURCE = fs.readFileSync(path.join(HERE, "dryRunEconomyReader.ts"), "utf8");

  it("spells no statement that could change a row", () => {
    const forbidden: Array<[string, RegExp]> = [
      ["an insert", /\binsert\s+(?:ignore\s+)?into\b/i],
      ["an update", /\bupdate\s+[`"'\w]/i],
      ["a delete", /\bdelete\s+from\b/i],
      ["a replace", /\breplace\s+into\b/i],
      ["a truncate", /\btruncate\b/i],
      ["a drop", /\bdrop\s+(?:table|database|schema|column|index)\b/i],
      ["an alter", /\balter\s+table\b/i],
      ["a table creation", /\bcreate\s+(?:table|database|index)\b/i],
      ["a locking read", /\bfor\s+update\b/i],
    ];
    for (const [what, pattern] of forbidden) {
      expect(pattern.test(SOURCE), `dryRunEconomyReader.ts spells ${what}`).toBe(false);
    }
  });

  it("begins and ends no transaction of its own", () => {
    expect(/\.beginTransaction\s*\(/.test(SOURCE)).toBe(false);
    expect(/\.commit\s*\(/.test(SOURCE)).toBe(false);
    expect(/\.rollback\s*\(/.test(SOURCE)).toBe(false);
  });

  it("every statement it does spell is a SELECT", () => {
    // Every double-quoted literal that looks like SQL at all. The reader
    // concatenates one statement across two literals, so a fragment that
    // continues a SELECT is allowed to start with a clause keyword.
    const literals = SOURCE.match(/"[^"\n]*"/g) ?? [];
    const sqlish = literals
      .map((l) => l.slice(1, -1))
      .filter((l) => /\bFROM\b|\bSELECT\b|\bWHERE\b|\bORDER BY\b/.test(l));
    expect(sqlish.length).toBeGreaterThanOrEqual(6);
    for (const statement of sqlish) {
      const ok = /^SELECT\b/i.test(statement) || /^(FROM|WHERE|ORDER BY|AND|JOIN)\b/i.test(statement.trim());
      expect(ok, `not a SELECT: ${statement}`).toBe(true);
    }
  });

  it("takes a connection and never a pool", () => {
    // A pool hands out a fresh connection per query, which would sit outside
    // whatever fence the caller opened.
    expect(/:\s*Pool\s*[,)]/.test(SOURCE)).toBe(false);
    expect(SOURCE.includes("PoolConnection")).toBe(true);
    for (const exported of ["readEconomySnapshot", "seedSnapshotFields", "economyProvenance"]) {
      expect(
        new RegExp(`export async function ${exported}\\(conn: PoolConnection`).test(SOURCE),
        `${exported} does not take a PoolConnection`,
      ).toBe(true);
    }
  });

  it("answers exactly the four economy fields of the snapshot", () => {
    // The composing reader asserts the key set, so a fifth key here is a red
    // test over there. Provenance is a separate export for that reason.
    //
    // ANCHORED AT BOTH ENDS. The first version of this line matched only the
    // `Pick<...>`, and an intersection welded onto the end of it still
    // matched: the type gained a fifth key and this test stayed green. The
    // `;` and the end-of-line are what make it a statement about the whole
    // declaration.
    expect(
      /^export type EconomySnapshotFields = Pick<VillageSnapshot, "tokens" \| "balances" \| "mintRules" \| "variables">;$/m.test(
        SOURCE,
      ),
    ).toBe(true);
  });
});
