/**
 * Does the seed survive the trip into the database?
 *
 * Every seed bug this feature has produced was the same shape: a field
 * authored in examples-seed.json that the seeder branch never writes, or a
 * value the schema will not take. `capacity` was seeded on every room, read
 * into the row type, and rendered nowhere. `startsAt`/`location`/`ctaLabel`
 * rode the event thread and no page read them. Fifteen health snapshots were
 * written to a table whose only reader filters them out. None of it failed a
 * test, because every test asserted behaviour the seed already had.
 *
 * This suite asserts the CONTRACT between the two files instead: seed one
 * module at a time, then walk every field the JSON declares and check it
 * against the row that came out. A field with a matching column must have
 * arrived intact. A field with no column at all is either a known derived
 * input or a promise nobody keeps, and the allow-list below is where that
 * distinction is written down and defended.
 *
 * Skips loudly without TEST_DATABASE_URL, like every DB-backed suite here.
 */
import mysql from "mysql2/promise";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { testPool, provisionTestDb, testDbConfigured, type TestDb } from "../db/testDb";
import {
  EXAMPLE_TABLES,
  loadExampleSeed,
  loadExampleState,
  retireExamples,
  seedExamples,
} from "./examples";

const configured = testDbConfigured();
if (!configured) {
  // eslint-disable-next-line no-console
  console.warn("[examples.schema.test] TEST_DATABASE_URL not set — DB-backed tests SKIPPED.");
}

const SEEDS_DIR = new URL("../seeds", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

const snake = (s: string) => s.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

/**
 * Seed keys that deliberately have no column of their own, with the reason.
 *
 * Adding a key here is a claim that something CONSUMES it. If that stops
 * being true the entry is a lie, so keep the reason specific enough to check.
 */
const DERIVED_OR_CONSUMED: Record<string, string> = {
  // Timing, minted at seed time so examples never read as stale.
  daysAgo: "agoDate() -> created_at",
  hoursAfter: "offset from the parent thread's created_at",
  startsInDays: "minted into meta.startsAt at seed time",
  durationHours: "minted into meta.endsAt at seed time",
  expiresInDays: "minted into badge_awards.expires_at at seed time",
  // Structural: the seeder walks these into their own tables or columns.
  replies: "seeded into forum_replies",
  tags: "seeded into forum_thread_tags",
  prices: "seeded into currency_prices / accommodation_prices",
  awards: "seeded into badge_awards",
  holders: "seeded into org_role_assignments as documented seatings",
  items: "seeded into the module's own child table",
  cache: "seeded into peer_shared_cache.payload",
  meta: "serialised to the meta column",
  transcript: "seeded into transcripts (body joined from segments, segments as json)",
  synthesis: "seeded into call_syntheses, and its tasks into call_tasks",
  // Flags the seeder translates rather than copies.
  pinned: "translated to pinned_at",
  locked: "translated to locked_at",
  isExample: "the seeder sets is_example on every row it writes",
  selfClaimed: "chooses awarded_by between the holder and the example author",
  // Reward text the platform parses into bounds.
  gratitude: "parsed into gratitude_min / gratitude_max",
};

/** Blocks whose rows the seeder writes through a non-obvious table. */
const BLOCK_TABLE: Record<string, { key: string; table: string; idKey?: string }[]> = {
  map: [{ key: "circles", table: "circles" }],
  progression: [
    { key: "roles", table: "roles" },
    { key: "orgRoles", table: "org_roles" },
  ],
  quests: [{ key: "quests", table: "quests" }],
  forum: [{ key: "threads", table: "forum_threads" }],
  feed: [{ key: "posts", table: "forum_threads" }],
  tools: [{ key: "tools", table: "tools" }],
  library: [
    { key: "categories", table: "library_categories" },
    { key: "items", table: "library_items" },
  ],
  stays: [{ key: "accommodations", table: "accommodations" }],
  commerce: [{ key: "products", table: "payment_products" }],
  badges: [{ key: "badges", table: "badges" }],
  health: [{ key: "regenEntries", table: "regen_entries" }],
  resources: [
    { key: "spendingRules", table: "spending_rules" },
    { key: "fundingSources", table: "funding_sources" },
    { key: "circleBudgets", table: "circle_budgets" },
  ],
  automation: [{ key: "recordings", table: "recordings" }],
  network: [
    { key: "sharedItems", table: "shared_items" },
    { key: "peers", table: "peer_instances" },
  ],
  exchange: [{ key: "tokens", table: "tokens", idKey: "slug" }],
};

describe.skipIf(!configured)("the seed matches the schema it is written against", () => {
  let db: TestDb;
  let pool: mysql.Pool;
  let seed: any;
  /** table -> { column -> mysql type }, read from the live schema. */
  const columns = new Map<string, Map<string, string>>();

  beforeAll(async () => {
    db = await provisionTestDb();
    pool = testPool(db, { connectionLimit: 4 });
    seed = loadExampleSeed(SEEDS_DIR);
    expect(seed, "examples-seed.json must be readable").toBeTruthy();

    const [rows] = await pool.query<any[]>(
      "SELECT TABLE_NAME t, COLUMN_NAME c, COLUMN_TYPE ct FROM information_schema.COLUMNS " +
        "WHERE TABLE_SCHEMA = DATABASE()",
    );
    for (const r of rows) {
      const t = String(r.t);
      if (!columns.has(t)) columns.set(t, new Map());
      columns.get(t)!.set(String(r.c), String(r.ct));
    }
    expect(columns.size, "the scratch schema must have tables").toBeGreaterThan(10);
    /*
     * No local timeout: inherit the 300s from vitest.config.ts.
     *
     * This hook drops a schema, creates it, and runs every migration, one
     * statement at a time, against a HOSTED MySQL. The config sets 300s and
     * says to keep the headroom; a local 180s quietly undercut it. Measured
     * today: 238ms per round trip and 61 migration files, so provisioning
     * took 185s and the hook failed by five seconds while the work itself was
     * fine. Every migration added moves that number up, so the ceiling has to
     * be the one place that thought about it.
     */
  });

  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  beforeEach(async () => {
    await pool.query("DELETE FROM example_state");
    for (const tables of Object.values(EXAMPLE_TABLES)) {
      for (const t of tables) {
        await pool.query(`DELETE FROM \`${t}\` WHERE is_example = 1`).catch(() => {});
      }
    }
    await loadExampleState(pool);
  });

  /**
   * The load-bearing one: a field the JSON declares either lands in its
   * column or is named in DERIVED_OR_CONSUMED with a reason.
   */
  it("writes every authored field, or names it as derived", async () => {
    const unwritten: string[] = [];
    const unexplained: string[] = [];

    for (const [moduleId, blocks] of Object.entries(BLOCK_TABLE)) {
      if (!seed[moduleId]) continue;
      await seedExamples(pool, moduleId, seed, { force: true });

      for (const { key, table, idKey } of blocks) {
        const authored = seed[moduleId][key];
        if (!Array.isArray(authored) || authored.length === 0) continue;
        const cols = columns.get(table);
        expect(cols, `${table} must exist in the schema`).toBeTruthy();

        const pk = idKey ?? "id";
        for (const item of authored) {
          const [found] = await pool.query<any[]>(
            `SELECT * FROM \`${table}\` WHERE \`${pk}\` = ?`,
            [item[pk]],
          );
          expect(found.length, `${moduleId}.${key} "${item[pk]}" must reach ${table}`).toBe(1);
          const row = found[0];

          for (const [k, v] of Object.entries(item)) {
            if (k.startsWith("_")) continue;
            const col = snake(k);
            if (!cols!.has(col)) {
              // No column of that name: it must be declared derived.
              if (!DERIVED_OR_CONSUMED[k]) unexplained.push(`${moduleId}.${key}.${k}`);
              continue;
            }
            if (DERIVED_OR_CONSUMED[k]) continue;
            // A scalar with a column of its own must have ARRIVED. Objects and
            // arrays are serialised, so compare only the primitives here.
            if (v === null || typeof v === "object") continue;
            const got = row[col];
            // Compare by VALUE, never by formatting: a DECIMAL column hands
            // back "240.0000" for a seeded 240, and a tinyint(1) hands back 1
            // for a seeded true. Neither is drift.
            const same = typeof v === "boolean"
              ? Number(got) === Number(v)
              : typeof v === "number"
                ? Number(got) === v
                : String(got) === String(v);
            if (!same) {
              unwritten.push(`${moduleId}.${key}.${k}: seed ${JSON.stringify(v)} but ${table}.${col} is ${JSON.stringify(got)}`);
            }
          }
        }
      }
    }

    expect(unwritten, "every authored field must arrive in its column").toEqual([]);
    expect(
      unexplained,
      "a field with no column must be listed in DERIVED_OR_CONSUMED with the reason it exists",
    ).toEqual([]);
  }, 180_000);

  /**
   * MySQL in strict mode rejects an illegal enum, so this would surface as a
   * seeding failure. It is asserted separately because the failure message
   * from a rejected INSERT names the column and not the seed entry, and a
   * founder-facing seed is worth a message that names the file to fix.
   */
  it("uses only legal enum values", async () => {
    const illegal: string[] = [];
    for (const [moduleId, blocks] of Object.entries(BLOCK_TABLE)) {
      if (!seed[moduleId]) continue;
      for (const { key, table } of blocks) {
        const authored = seed[moduleId][key];
        if (!Array.isArray(authored)) continue;
        const cols = columns.get(table);
        if (!cols) continue;
        for (const item of authored) {
          for (const [k, v] of Object.entries(item)) {
            const type = cols.get(snake(k));
            if (!type?.startsWith("enum(") || typeof v !== "string") continue;
            const allowed = type.slice(5, -1).split(",").map((s) => s.trim().replace(/^'|'$/g, ""));
            if (!allowed.includes(v)) {
              illegal.push(`${moduleId}.${key}.${k} = "${v}" (legal: ${allowed.join(", ")})`);
            }
          }
        }
      }
    }
    expect(illegal, "an illegal enum value fails the INSERT at boot").toEqual([]);
  });

  /**
   * The child rows a nested loop writes are invisible to the block-table
   * check above, because no seed BLOCK names them: forum tags are written
   * from inside the thread loop. They outlived their threads until
   * forum_thread_tags joined BY_PARENT, which is the sort of untidiness that
   * survives precisely because nobody can see it.
   */
  it("leaves no orphan tag rows behind after retirement", async () => {
    await seedExamples(pool, "forum", seed, { force: true });
    const [before] = await pool.query<any[]>("SELECT COUNT(*) n FROM forum_thread_tags");
    expect(Number(before[0].n), "the forum seed writes tags").toBeGreaterThan(0);

    await retireExamples(pool, "forum", "admin_cleared");

    const [orphans] = await pool.query<any[]>(
      "SELECT COUNT(*) n FROM forum_thread_tags t " +
        "LEFT JOIN forum_threads th ON th.id = t.thread_id WHERE th.id IS NULL",
    );
    expect(Number(orphans[0].n), "a tag whose thread is gone is a row nobody can reach").toBe(0);
  }, 120_000);

  /** Every table a module seeds into must be one retirement knows to clear. */
  it("never seeds into a table retirement cannot reach", () => {
    const unreachable: string[] = [];
    for (const [moduleId, blocks] of Object.entries(BLOCK_TABLE)) {
      if (!seed[moduleId]) continue;
      const known = EXAMPLE_TABLES[moduleId] ?? [];
      for (const { key, table } of blocks) {
        if (!Array.isArray(seed[moduleId][key]) || seed[moduleId][key].length === 0) continue;
        if (!known.includes(table)) unreachable.push(`${moduleId} seeds ${table}, absent from EXAMPLE_TABLES`);
      }
    }
    expect(unreachable, "a table retirement cannot reach leaves rows behind for good").toEqual([]);
  });

  /**
   * An author id pointing at nobody renders a blank byline, and the shared
   * identities are the only users an example may ever reference.
   */
  it("references only identities the seed creates", async () => {
    await seedExamples(pool, "forum", seed, { force: true });
    const [ids] = await pool.query<any[]>("SELECT id FROM users WHERE is_example = 1");
    const known = new Set(ids.map((r) => String(r.id)));
    expect(known.size, "the shared example identities must exist").toBeGreaterThan(0);

    const dangling: string[] = [];
    for (const [moduleId, block] of Object.entries<any>(seed)) {
      if (moduleId.startsWith("_") || !block || typeof block !== "object") continue;
      const walk = (node: any, path: string) => {
        if (Array.isArray(node)) return node.forEach((n, i) => walk(n, `${path}[${i}]`));
        if (!node || typeof node !== "object") return;
        for (const [k, v] of Object.entries(node)) {
          if (/^(authorId|userId|recordedBy|createdBy|donorUserId)$/.test(k) && typeof v === "string") {
            if (!known.has(v)) dangling.push(`${moduleId}${path}.${k} -> ${v}`);
          } else {
            walk(v, `${path}.${k}`);
          }
        }
      };
      walk(block, "");
    }
    expect(dangling, "every seeded author must be a seeded identity").toEqual([]);
  }, 120_000);
});
