/**
 * THE HERO OF THE GRATITUDE WALL, held to what it promises.
 *
 * Three things are worth a test here and none of them are the SQL.
 *
 *   1. The sixteen keep their FORM. They are the first thing a founder reads
 *      in a new village and the register they set is the register the village
 *      writes in afterwards, so second person, one person, one thing that
 *      happened, and no village's own words anywhere in them.
 *   2. The blend is real. Real voices take the hero's slots as they arrive and
 *      labelled examples hold the rest, and every line says which it is.
 *   3. A heart is not a voice. `message` on a heart row is the BODY of the
 *      feed post it was tapped on, and the wall route learned once already
 *      what quoting those costs.
 */
import mysql from "mysql2/promise";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { loadExampleSeed, loadExampleState, retireExamples, seedExamples } from "./lib/examples";
import { heroVoices, realVoiceCount, wallEntries, type WallLogRow } from "./lib/gratitudeVoices";
import { HERO_SLOTS } from "../shared/gratitudeVoices";
import { provisionTestDb, testDbConfigured, type TestDb } from "./db/testDb";

const SEEDS_DIR = new URL("./seeds", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const configured = testDbConfigured();

/**
 * The voices, held to what the voice gate cannot see.
 *
 * No database, so it runs everywhere. It deliberately does NOT re-check the
 * house voice rules: `scripts/check-voice.mjs` already reads every string
 * value under `server/seeds/**.json` and it is a blocking CI gate, so an
 * em-dash or a contrast frame in these sixteen fails the build without this
 * file's help. Importing that script here was tried and is a dead end anyway,
 * because it carries a shebang that vitest's transform refuses.
 *
 * What is left is everything the gate has no opinion about, and all of it
 * matters more: the FORM (second person, one person, one thing that happened),
 * which is the register a founder copies, and the platform-genericity that
 * lets every fork inherit the same set.
 */
describe("the sixteen default voices", () => {
  const seed = loadExampleSeed(SEEDS_DIR);
  const voices: { id: string; message: string }[] = seed?.gratitude?.voices ?? [];

  it("ships a full set", () => {
    // At least a hero's worth, or a fresh village opens with gaps.
    expect(voices.length).toBeGreaterThanOrEqual(HERO_SLOTS);
    expect(new Set(voices.map((v) => v.id)).size).toBe(voices.length);
  });

  it("names no village, no place and no token", () => {
    // Rule 4 of the contract: examples are PLATFORM content, so every fork
    // inherits the same sixteen and check-brand-refs stays green. A default
    // that mentioned this village's currency would also be a lie in a fork
    // that renamed it.
    for (const v of voices) {
      expect(v.message).not.toMatch(/gratitude|recognition|amora/i); // brand-ok: the assertion is that the voices do NOT carry this name
    }
  });

  it("addresses one person, about one thing", () => {
    // The form IS the teaching. A founder reads sixteen of these before they
    // write anything, so a line that drifted into the abstract would teach
    // the abstract.
    for (const v of voices) {
      expect(v.message, v.id).toMatch(/^You /);
      expect(v.message.length, v.id).toBeLessThan(120);
    }
  });
});

describe.skipIf(!configured)("the hero blends real voices over examples", () => {
  let db: TestDb;
  let pool: mysql.Pool;

  beforeAll(async () => {
    db = await provisionTestDb();
    pool = mysql.createPool({ uri: db.url, timezone: "Z", connectionLimit: 4 }); // module-review-ok: fixture SQL against the S5 scratch schema this suite provisions and drops, never a production table
  }, 240_000);

  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  /**
   * A clean village before every case, and `loadExampleState` is the part that
   * is easy to leave out.
   *
   * `seedExamples` early-returns when the module is already stamped, and the
   * stamp lives in a module-level cache as well as in `example_state`. Without
   * the reload the second case onward got an emptied table and a seed that
   * quietly did nothing, which the assertions below then read as "the hero is
   * empty". Worse, the retirement case at the end passed on that empty table
   * without retiring anything, which is a test defending a bug rather than
   * catching one. It now asserts the examples are THERE before it retires them.
   */
  beforeEach(async () => {
    await pool.query("DELETE FROM `gratitude_voices`"); // module-review-ok: fixture SQL against the S5 scratch schema this suite provisions and drops, never a production table
    await pool.query("DELETE FROM `gratitude_log`"); // module-review-ok: fixture SQL against the S5 scratch schema this suite provisions and drops, never a production table
    await pool.query("DELETE FROM `example_state` WHERE `module_id` = 'gratitude'"); // module-review-ok: fixture SQL against the S5 scratch schema this suite provisions and drops, never a production table
    await loadExampleState(pool);
    await seedExamples(pool, "gratitude", loadExampleSeed(SEEDS_DIR));
  });

  const say = (id: string, message: string, kind = "gratitude") =>
    pool.query( // module-review-ok: fixture SQL against the S5 scratch schema this suite provisions and drops, never a production table
      "INSERT INTO `gratitude_log` (`id`, `village_id`, `kind`, `from_id`, `to_id`, `amount`, `message`, `cycle_id`) " +
        "VALUES (?, 'v', ?, 'a', 'b', 1, ?, 'lunar-000900')",
      [id, kind, message],
    );

  /**
   * Two real members for the wall cases: one fronting a character and one not,
   * so the portrait path and the honest null are both exercised. Created once
   * and left standing, because `beforeEach` empties the LOG and not the roster.
   */
  const wren = "u-wren-wall";
  const ash = "u-ash-wall";
  beforeAll(async () => {
    const member = async (id: string, name: string, handle: string) => {
      await pool.query( // module-review-ok: fixture SQL against the S5 scratch schema this suite provisions and drops, never a production table
        "INSERT IGNORE INTO `users` (`id`,`name`,`email`,`handle`,`password_hash`) VALUES (?,?,?,?,'x')",
        [id, name, `${handle}@village.test`, handle],
      );
    };
    await member(wren, "Wren", "wren-t");
    await member(ash, "Ash", "ash-t");
    await pool.query( // module-review-ok: fixture SQL against the S5 scratch schema this suite provisions and drops, never a production table
      "INSERT IGNORE INTO `player_characters` (`id`,`village_id`,`user_id`,`archetype_key`,`presentation`,`tone`) " +
        "VALUES ('pc-wren-t','v',?,'building','m','deep')",
      [wren],
    );
    await pool.query("UPDATE `users` SET `primary_character_id` = 'pc-wren-t' WHERE `id` = ?", [wren]); // module-review-ok: fixture SQL against the S5 scratch schema this suite provisions and drops, never a production table
  }, 60_000);

  /** The log in the shape `wallEntries` takes, ordered the way the repo orders it. */
  const logRows = async (): Promise<WallLogRow[]> => {
    const [rows] = await pool.query<any[]>( // module-review-ok: fixture SQL against the S5 scratch schema this suite provisions and drops, never a production table
      "SELECT `id`, `kind`, `from_id`, `from_name`, `to_id`, `to_name`, `amount`, `message`, `at` " +
        "FROM `gratitude_log` ORDER BY `at`, `id`",
    );
    return rows.map((r) => ({
      id: String(r.id),
      kind: String(r.kind ?? "gratitude"),
      fromId: String(r.from_id),
      fromName: String(r.from_name ?? ""),
      toId: String(r.to_id),
      toName: String(r.to_name ?? ""),
      amount: Number(r.amount) || 0,
      message: String(r.message ?? ""),
      at: new Date(r.at).toISOString(),
    }));
  };

  /**
   * A VILLAGE THAT ALREADY EXISTS, which is the shape that shipped broken.
   *
   * Every other case in this file starts from a virgin schema, and so did both
   * manual checks before release. A virgin schema has no `example_state` row
   * for gratitude, `isSeeded` is false, and the voices seed. On Amora they did
   * not: the module has been stamped seeded since the examples engine shipped,
   * because it was stamped deliberately back when it created no rows, and
   * `seedExamples` opens with `if (isSeeded(id)) return 0`. The live wall
   * opened on an empty hero.
   *
   * So this case seeds the OLD SHAPE first: the stamp with no rows behind it,
   * exactly as a village upgrading into 0180 carries it. Migration 0189 clears
   * that stamp where the module was never retired, and this asserts the voices
   * arrive afterwards.
   */
  it("reaches a village that was stamped seeded before the voices existed", async () => {
    await pool.query("DELETE FROM `gratitude_voices`");
    await pool.query(
      "INSERT INTO `example_state` (`module_id`, `seeded_at`) VALUES ('gratitude', ?) " +
        "ON DUPLICATE KEY UPDATE `seeded_at` = VALUES(`seeded_at`), `retired_at` = NULL",
      [new Date()], // module-review-ok: fixture SQL against the S5 scratch schema this suite provisions and drops, never a production table
    );
    await loadExampleState(pool);

    // The old shape reproduces the defect: stamped, so the seeder declines.
    expect(await seedExamples(pool, "gratitude", loadExampleSeed(SEEDS_DIR))).toBe(0);
    expect((await heroVoices(pool)).voices).toHaveLength(0);

    // 0189, as the runner applies it.
    await pool.query(
      "UPDATE `example_state` SET `seeded_at` = NULL WHERE `module_id` = 'gratitude' AND `retired_at` IS NULL",
    ); // module-review-ok: fixture SQL against the S5 scratch schema this suite provisions and drops, never a production table
    await loadExampleState(pool);

    expect(await seedExamples(pool, "gratitude", loadExampleSeed(SEEDS_DIR))).toBeGreaterThan(0);
    const { voices } = await heroVoices(pool);
    expect(voices).toHaveLength(HERO_SLOTS);
    expect(voices.every((v) => v.isExample)).toBe(true);
  });

  /**
   * The tombstone still wins. A village that RETIRED its gratitude examples has
   * spoken for itself, and 0189 must not talk over it: the migration clears the
   * stamp only where `retired_at IS NULL`, and `isRetired` refuses regardless.
   */
  it("does not resurrect examples in a village that retired them", async () => {
    await pool.query("DELETE FROM `gratitude_voices`");
    await pool.query(
      "INSERT INTO `example_state` (`module_id`, `seeded_at`, `retired_at`, `retired_reason`) " +
        "VALUES ('gratitude', ?, ?, 'first_real_item') " +
        "ON DUPLICATE KEY UPDATE `seeded_at` = VALUES(`seeded_at`), `retired_at` = VALUES(`retired_at`)",
      [new Date(), new Date()], // module-review-ok: fixture SQL against the S5 scratch schema this suite provisions and drops, never a production table
    );
    await loadExampleState(pool);

    // 0189's own WHERE clause leaves this row alone.
    await pool.query(
      "UPDATE `example_state` SET `seeded_at` = NULL WHERE `module_id` = 'gratitude' AND `retired_at` IS NULL",
    ); // module-review-ok: fixture SQL against the S5 scratch schema this suite provisions and drops, never a production table
    await loadExampleState(pool);

    expect(await seedExamples(pool, "gratitude", loadExampleSeed(SEEDS_DIR))).toBe(0);
    expect((await heroVoices(pool)).voices.filter((v) => v.isExample)).toHaveLength(0);
  });

  it("seeds the voices a gratitude row never could", async () => {
    const [[row]] = await pool.query<any[]>( // module-review-ok: fixture SQL against the S5 scratch schema this suite provisions and drops, never a production table
      "SELECT COUNT(*) n FROM `gratitude_voices` WHERE `is_example` = 1",
    );
    expect(Number(row.n)).toBeGreaterThanOrEqual(HERO_SLOTS);
    // The invariant the whole design exists to protect: seeding the hero puts
    // nothing in the ledger's table.
    const [[log]] = await pool.query<any[]>("SELECT COUNT(*) n FROM `gratitude_log`"); // module-review-ok: fixture SQL against the S5 scratch schema this suite provisions and drops, never a production table
    expect(Number(log.n)).toBe(0);
  });

  it("opens a brand new village with a full hero, every line labelled", async () => {
    const { voices, realTotal } = await heroVoices(pool);
    expect(voices).toHaveLength(HERO_SLOTS);
    expect(voices.every((v) => v.isExample)).toBe(true);
    expect(realTotal).toBe(0);
  });

  it("puts this village's own voices first, and keeps the hero full", async () => {
    await say("g1", "You fixed the pump before anyone asked.");
    await say("g2", "You walked the fence line twice.");
    await say("g3", "You stayed until the last person left.");

    const { voices, realTotal } = await heroVoices(pool);
    expect(realTotal).toBe(3);
    expect(voices).toHaveLength(HERO_SLOTS);
    // Real ones first: a member meets their neighbours before the platform.
    expect(voices.slice(0, 3).every((v) => !v.isExample)).toBe(true);
    expect(voices.slice(3).every((v) => v.isExample)).toBe(true);
  });

  it("does not quote a heart, whose message is somebody's feed post", async () => {
    await say("h1", "A members-only post that was tapped, not written to the wall.", "heart");
    expect(await realVoiceCount(pool)).toBe(0);
    const { voices } = await heroVoices(pool);
    expect(voices.every((v) => v.isExample)).toBe(true);
  });

  it("ignores an empty message, which is a row and not a voice", async () => {
    await say("e1", "   ");
    expect(await realVoiceCount(pool)).toBe(0);
  });

  /**
   * THE WALL PAYLOAD, WHICH IS THE PART THAT NAMES PEOPLE.
   *
   * These were missing when this file was first written, and they are the ones
   * that most needed to exist: `wallEntries` is the newest code in this module
   * and the only code that joins member identities onto an endpoint that takes
   * no authentication. Every other test here covers the hero, which carries no
   * identity at all.
   *
   * The heart filter is the one with a history. It ran AFTER the slice in the
   * route this replaced, so whatever the last sixty gratitude rows happened to
   * be went out, and a heart's `message` is the body of the feed post it was
   * tapped on. In a village whose feed is members-only that published
   * member-only prose to anonymous readers. Nothing but a test stops it coming
   * back the next time somebody reorders those two lines.
   */
  it("keeps hearts off the wall, and filters before it slices", async () => {
    await say("w-heart", "A members-only feed post that somebody tapped.", "heart");
    await say("w-real", "You put the tools back where they live.");

    const entries = await wallEntries(pool, await logRows());
    expect(entries).toHaveLength(1);
    expect(entries[0]!.message).toBe("You put the tools back where they live.");
    expect(entries.some((e) => /members-only/.test(e.message))).toBe(false);
  });

  it("carries the amount, which the payload never used to", async () => {
    await pool.query( // module-review-ok: fixture SQL against the S5 scratch schema this suite provisions and drops, never a production table
      "INSERT INTO `gratitude_log` (`id`,`village_id`,`kind`,`from_id`,`to_id`,`amount`,`message`,`cycle_id`) " +
        "VALUES ('w-amt','v','gratitude',?,?,15,'You drove the long way to fetch me.','lunar-000900')",
      [wren, ash],
    );
    const [entry] = await wallEntries(pool, await logRows());
    expect(entry!.amount).toBe(15);
  });

  it("names both sides with the handle and the fronted portrait", async () => {
    await pool.query( // module-review-ok: fixture SQL against the S5 scratch schema this suite provisions and drops, never a production table
      "INSERT INTO `gratitude_log` (`id`,`village_id`,`kind`,`from_id`,`to_id`,`amount`,`message`,`cycle_id`) " +
        "VALUES ('w-named','v','gratitude',?,?,3,'You waited with me.','lunar-000900')",
      [wren, ash],
    );
    const [entry] = await wallEntries(pool, await logRows());
    expect(entry!.from.handle).toBe("wren-t");
    expect(entry!.to.handle).toBe("ash-t");
    // wren fronts a character and ash does not: a portrait where there is one,
    // and NULL rather than a path that might 404 where there is not.
    expect(entry!.from.avatar).toMatch(/^\/images\/avatars\/.+\.webp$/);
    expect(entry!.to.avatar).toBeNull();
  });

  it("keeps the recorded name and no handle for an account that is gone", async () => {
    await pool.query( // module-review-ok: fixture SQL against the S5 scratch schema this suite provisions and drops, never a production table
      "INSERT INTO `gratitude_log` (`id`,`village_id`,`kind`,`from_id`,`from_name`,`to_id`,`to_name`,`amount`,`message`,`cycle_id`) " +
        "VALUES ('w-gone','v','gratitude','user-deleted','Rowan','" + ash + "','Ash',2,'You showed me the ford.','lunar-000900')",
    );
    const [entry] = await wallEntries(pool, await logRows());
    // The tombstone contract: the log's own record of the name survives, and
    // nothing is invented to go with it.
    expect(entry!.from.name).toBe("Rowan");
    expect(entry!.from.handle).toBeNull();
    expect(entry!.from.avatar).toBeNull();
  });

  it("shows only this village once it can fill the hero itself", async () => {
    // The examples are standing BEFORE anything is retired. Without this line
    // an empty table passes every assertion below and the test proves nothing.
    expect((await heroVoices(pool)).voices.some((v) => v.isExample)).toBe(true);

    for (let i = 0; i < HERO_SLOTS; i++) await say(`f${i}`, `You did the ${i}th thing.`);
    expect(await realVoiceCount(pool)).toBe(HERO_SLOTS);

    // The threshold RETIRE_WHEN reads. Called directly here rather than
    // through onRealItemPublished, which is fire-and-forget by design and so
    // cannot be awaited without racing the assertion.
    await retireExamples(pool, "gratitude", "first_real_item", null);

    const { voices } = await heroVoices(pool);
    expect(voices).toHaveLength(HERO_SLOTS);
    expect(voices.some((v) => v.isExample)).toBe(false);
  });
});
