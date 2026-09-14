/**
 * WANING AT ONE PERCENT, READ OFF THE LEDGER, AND THE SKIP IT REPLACES.
 *
 * This is the measurement the scale ruling turns on, so it is taken from the
 * ledger rows `decayVoice` actually wrote and never from its return value. The
 * summary it returns is a claim about what it did; the rows are what it did.
 *
 * THE FINDING. `decayVoice` computes each member's share with `decayUnits`,
 * which FLOORS, and counts the member in `skippedTooSmall` when the answer is
 * zero. At whole numbers and the default one percent, a member holding anything
 * under a hundred Voice never wanes at all, and nothing reports it, because
 * skipping is the ordinary path for a member with nothing to lose. So a village
 * that voted a waning rate would see it in the settings, see it displayed, and
 * have it reach nobody. At two decimals the same one percent reaches a member
 * holding a single whole Voice.
 *
 * Both halves are exercised against the same engine on the same schema, because
 * the counterfactual is the whole argument: showing that waning works at two
 * decimals proves nothing on its own unless the zero-decimals case is shown to
 * skip.
 */
import mysql from "mysql2/promise";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { provisionTestDb, testDbConfigured, type TestDb } from "./db/testDb";
import { loadTokenRegistry, memberAccount, registerToken } from "./lib/ledger";
import { loadVariables, numberVar, stringVar } from "./lib/variables";
import { recordGameStart } from "./lib/gameStart";
import { decayVoice, ensureVoiceToken, VILLAGE_VOICE, VOICE_DECAY, VOICE_MINT, mint } from "./lib/economy";
import { CURRENCY_DECIMALS, VOICE_DECIMALS, decayFloorMinorUnits, decayUnits } from "../shared/tokenScale";

const configured = testDbConfigured();
if (!configured) {
  // eslint-disable-next-line no-console
  console.warn("[tokenScale.decay] TEST_DATABASE_URL not set. This suite SKIPPED.");
}

describe.skipIf(!configured)("waning reaches a small balance at two decimals", () => {
  let db: TestDb;
  let pool: mysql.Pool;
  let seq = 0;

  /** Every waning leg in the ledger, which is the only record that counts. */
  const decayLegs = async (): Promise<Array<{ from: string; to: string; amount: number }>> => {
    const [rows] = await pool.query<any[]>( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
      "SELECT `from_account` AS f, `to_account` AS t, `amount` AS a FROM `token_ledger` " +
        "WHERE `token_type` = ? AND `source` = 'voice_decay'",
      [VILLAGE_VOICE],
    );
    return rows.map((r) => ({ from: String(r.f), to: String(r.t), amount: Number(r.a) }));
  };

  const setVoiceScale = async (decimals: number) => {
    // The scale seam, and the only way a token is ever re-denominated:
    // `registerToken` leaves `decimals` out of its upsert on purpose.
    await pool.query("UPDATE `tokens` SET `decimals` = ? WHERE `slug` = ?", [decimals, VILLAGE_VOICE]); // module-review-ok: the decimals seam this suite exists to exercise, against the S5 scratch schema
    await loadTokenRegistry(pool);
  };

  /** A member holding exactly `units` MINOR units of Voice, from the faucet. */
  const holding = async (id: string, units: number): Promise<string> => {
    await pool.query( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
      "INSERT INTO `users` (`id`,`name`,`email`,`password_hash`) VALUES (?,?,?,'x') " +
        "ON DUPLICATE KEY UPDATE `name` = VALUES(`name`)",
      [id, id, `${id}@examples.invalid`],
    ); // module-review-ok: fixture against the S5 scratch schema
    const r = await mint(pool, {
      toUserId: id,
      tokenSlug: VILLAGE_VOICE,
      amount: units,
      from: VOICE_MINT,
      source: "role_cycle",
      sourceRef: id,
      description: "seeded for a waning measurement",
      idempotencyKey: `dec.scale.seed:${id}:${(seq += 1)}`,
    });
    expect(r.ok, `seeding ${id}`).toBe(true);
    return id;
  };

  const balance = async (account: string): Promise<number> => {
    const [rows] = await pool.query<any[]>( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
      "SELECT COALESCE(`balance`,0) AS b FROM `token_balances` WHERE `account_id` = ? AND `token_type` = ?",
      [account, VILLAGE_VOICE],
    );
    return rows[0] == null ? 0 : Number(rows[0].b);
  };

  beforeAll(async () => {
    db = await provisionTestDb();
    pool = mysql.createPool({ uri: db.url, timezone: "Z", connectionLimit: 6 }); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    await pool.query("SET time_zone = '+00:00'"); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    await loadTokenRegistry(pool);
    await loadVariables(pool);
    await ensureVoiceToken(pool, "Village Voice");
    await loadTokenRegistry(pool);
    // Nothing wanes before the village votes its Game into existence, and that
    // guard is inside `decayVoice` rather than in `economyReady`.
    await recordGameStart(pool, { ballotId: "blt-scale", startedBy: "usr-scale", note: "for a waning measurement" });
  }, 180_000);

  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  beforeEach(async () => {
    await pool.query("DELETE FROM `token_ledger` WHERE `token_type` = ?", [VILLAGE_VOICE]); // module-review-ok: fixture against the S5 scratch schema
    await pool.query("DELETE FROM `token_balances` WHERE `token_type` = ?", [VILLAGE_VOICE]); // module-review-ok: fixture against the S5 scratch schema
    await pool.query("DELETE FROM `exits`"); // module-review-ok: fixture against the S5 scratch schema
  });

  it("runs at the platform default of one percent over the whole balance", () => {
    // Nothing sets either dial here ON PURPOSE. An unset dial reads the
    // platform default, and the defaults ARE the ruling. An unset dial and a
    // real zero are different facts, and this asserts the first one.
    expect(numberVar("economy.voice_decay_pct")).toBe(1);
    expect(stringVar("economy.voice_decay_basis")).toBe("all");
  });

  it("wanes a member holding ONE WHOLE Voice, at two decimals, in the ledger", async () => {
    await setVoiceScale(VOICE_DECIMALS);
    const oneWhole = 10 ** VOICE_DECIMALS;
    const u = await holding("wane-one-whole", oneWhole);

    const out = await decayVoice(pool, new Date());

    // THE LEDGER, which is the record. One leg, member to the waning sink.
    const legs = await decayLegs();
    expect(legs.length).toBe(1);
    expect(legs[0].from).toBe(memberAccount(u));
    expect(legs[0].to).toBe(VOICE_DECAY);
    // One percent of one whole Voice at two decimals is one minor unit, which
    // is one hundredth. At whole numbers this member would have moved nothing.
    expect(legs[0].amount).toBe(1);

    // And the balances agree with the legs.
    expect(await balance(memberAccount(u))).toBe(oneWhole - 1);
    expect(await balance(VOICE_DECAY)).toBe(1);

    // The member was NOT counted as too small, which is the counted fact a
    // village reads to decide whether its waning is working.
    expect(out.skippedTooSmall).toBe(0);
    expect(out.holders).toBe(1);
  });

  it("would have skipped that same member at whole numbers, and the ledger stays empty", async () => {
    await setVoiceScale(0);
    // The same member, the same one percent, the same holding of one whole
    // Voice. At zero decimals one whole Voice is one minor unit.
    const u = await holding("wane-one-whole-zero", 1);

    const out = await decayVoice(pool, new Date());

    // NOTHING MOVED, and the ledger is where that is read. An empty result and
    // a zero are different facts, so both are asserted: no leg exists, and the
    // engine counted the member as too small rather than never seeing them.
    expect(await decayLegs()).toEqual([]);
    expect(out.skippedTooSmall).toBe(1);
    expect(out.holders).toBe(0);
    expect(out.total).toBe(0);
    expect(await balance(memberAccount(u))).toBe(1);
    expect(await balance(VOICE_DECAY)).toBe(0);
  });

  it("needs a hundred whole Voice before one percent reaches anybody at whole numbers", async () => {
    await setVoiceScale(0);
    const under = await holding("wane-ninety-nine", 99);
    const at = await holding("wane-one-hundred", 100);

    const out = await decayVoice(pool, new Date());

    const legs = await decayLegs();
    expect(legs.length).toBe(1);
    expect(legs[0].from).toBe(memberAccount(at));
    expect(legs[0].amount).toBe(1);
    expect(await balance(memberAccount(under))).toBe(99);
    expect(out.skippedTooSmall).toBe(1);

    // Which is exactly the threshold the dial's own sentence reports, computed
    // from the engine's floor and not from a second copy of the arithmetic.
    expect(Math.ceil(decayFloorMinorUnits(1) / 10 ** 0)).toBe(100);
  });

  it("agrees with the engine's floor at every percentage the dial can hold", () => {
    // The dial steps in hundredths between 0 and 100, so these are real
    // settings a village can vote and not invented inputs.
    for (const pct of [0.01, 0.1, 0.25, 0.5, 1, 2, 3, 7, 33, 50, 99.99, 100]) {
      const floorUnits = decayFloorMinorUnits(pct);
      // The claim: this is the SMALLEST balance that wanes anything, so it
      // wanes and the unit below it does not. Asserted through `decayUnits`,
      // which IS what `decayVoice` calls.
      expect(decayUnits(floorUnits, pct), `pct=${pct} at the floor`).toBeGreaterThanOrEqual(1);
      if (floorUnits > 1) {
        expect(decayUnits(floorUnits - 1, pct), `pct=${pct} one below the floor`).toBe(0);
      }
    }
  });

  it("serves every token at the scale the ruling declares", async () => {
    await setVoiceScale(VOICE_DECIMALS);
    // The two module tokens are registered by module code and not by a
    // migration, so a provisioned schema does not carry them until something
    // registers them. Registering them here is what the boot path does.
    await registerToken(pool, {
      slug: "stay-credit",
      name: "Stay Credits",
      kind: "credit",
      governance: "platform",
      transferable: false,
      decimals: CURRENCY_DECIMALS,
    });
    await registerToken(pool, {
      slug: "library-credit",
      name: "Library Credits",
      kind: "credit",
      governance: "platform",
      transferable: false,
      decimals: CURRENCY_DECIMALS,
    });
    await loadTokenRegistry(pool);

    const [rows] = await pool.query<any[]>("SELECT `slug`, `kind`, `governance`, `decimals` FROM `tokens`"); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      const slug = String(r.slug);
      const currencyLike = String(r.kind) === "credit" && String(r.governance) === "platform";
      const expected = currencyLike ? CURRENCY_DECIMALS : slug === VILLAGE_VOICE ? VOICE_DECIMALS : 0;
      // The message carries the slug so a failure names the token, the way the
      // migration's refusal does.
      expect(`${slug}=${Number(r.decimals)}`).toBe(`${slug}=${expected}`);
    }
  });
});
