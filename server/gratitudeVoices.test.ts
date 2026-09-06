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
import { heroVoices, realVoiceCount } from "./lib/gratitudeVoices";
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
      expect(v.message).not.toMatch(/gratitude|recognition|amora/i);
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
    pool = mysql.createPool({ uri: db.url, timezone: "Z", connectionLimit: 4 });
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
    await pool.query("DELETE FROM `gratitude_voices`");
    await pool.query("DELETE FROM `gratitude_log`");
    await pool.query("DELETE FROM `example_state` WHERE `module_id` = 'gratitude'");
    await loadExampleState(pool);
    await seedExamples(pool, "gratitude", loadExampleSeed(SEEDS_DIR));
  });

  const say = (id: string, message: string, kind = "gratitude") =>
    pool.query(
      "INSERT INTO `gratitude_log` (`id`, `village_id`, `kind`, `from_id`, `to_id`, `amount`, `message`, `cycle_id`) " +
        "VALUES (?, 'v', ?, 'a', 'b', 1, ?, 'lunar-000900')",
      [id, kind, message],
    );

  it("seeds the voices a gratitude row never could", async () => {
    const [[row]] = await pool.query<any[]>(
      "SELECT COUNT(*) n FROM `gratitude_voices` WHERE `is_example` = 1",
    );
    expect(Number(row.n)).toBeGreaterThanOrEqual(HERO_SLOTS);
    // The invariant the whole design exists to protect: seeding the hero puts
    // nothing in the ledger's table.
    const [[log]] = await pool.query<any[]>("SELECT COUNT(*) n FROM `gratitude_log`");
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
