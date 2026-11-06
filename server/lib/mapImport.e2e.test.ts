/**
 * The importer's key plane, run as the importer.
 *
 * The one property `map_key` exists for is that A RENAMED QUEST STILL
 * RESOLVES. That cannot be proven by exercising the SQL this repo wrote,
 * because the SQL is the thing under suspicion; it has to be the real script,
 * against a real schema, matching the way it will match in a village.
 *
 * The failure being pinned actually happened: the map renamed three of its own
 * seed quests in one afternoon and all three stopped matching, because the
 * only handle was the title.
 */
import { execFileSync } from "child_process";
import path from "path";
import fs from "fs";
import mysql from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { testPool, provisionTestDb, testDbConfigured, type TestDb } from "../db/testDb";

const configured = testDbConfigured();
const REPO = path.resolve(__dirname, "..", "..");

/** A minimum scene the importer accepts: the version gate plus two quests. */
function sceneWith(
  quests: Array<{ key: string; title: string; structure_key: string; address_source?: string }>,
) {
  return {
    map_scene: {
      key: "testscene",
      name: "Test Scene",
      version: "v0.8-roundD",
      address_source_vocabulary: ["creator", "resolver-guess", "creator-board"],
    },
    quests: quests.map((q) => ({ address_source: "creator", ...q })),
  };
}

describe.skipIf(!configured)("the importer's key plane", () => {
  let db: TestDb;
  let pool: mysql.Pool;
  let scenePath: string;

  beforeAll(async () => {
    db = await provisionTestDb();
    pool = testPool(db, { connectionLimit: 4 });
    scenePath = path.join(REPO, "node_modules", ".cache", "map-import-test.json");
    fs.mkdirSync(path.dirname(scenePath), { recursive: true });
  });

  afterAll(async () => {
    await pool?.end();
    await db?.drop();
    try { fs.unlinkSync(scenePath); } catch { /* already gone */ }
  });

  /*
   * Node's own binary running tsx's entry, never `npx`.
   *
   * Spawning `npx.cmd` fails with EINVAL on Windows: since the 2024 command
   * -injection fix, Node refuses to spawn a `.cmd` shim without `shell: true`,
   * and turning the shell on to work around it would put a scene path through
   * a command line. Resolving the real entry keeps the argument vector intact
   * on every platform.
   */
  const TSX = require.resolve("tsx/cli");
  const runImport = (scene: unknown) => {
    fs.writeFileSync(scenePath, JSON.stringify(scene));
    return execFileSync(
      process.execPath,
      [TSX, "scripts/import-map-scene.ts", scenePath, "--only", "quests"],
      { cwd: REPO, env: { ...process.env, DATABASE_URL: db.url }, encoding: "utf8" },
    );
  };

  const questRow = async (id: string) => {
    const [rows] = await pool.query<any[]>("SELECT * FROM quests WHERE id = ?", [id]);
    return rows[0] ?? null;
  };

  it("stamps the map's key on the first import and honours it after a rename", async () => {
    await pool.query(
      "INSERT INTO quests (id, title) VALUES ('q-swale','Swale dig on the east slope')",
    );

    /*
     * First pass with a RESOLVER GUESS, not a creator's word. The creator-wins
     * rule in shared/mapAddress.ts refuses to overwrite a creator-authored
     * address on any later import, so seeding one here would protect the row
     * and the second pass would prove nothing about matching. A guess is the
     * honest starting state anyway: nobody has placed this yet.
     */
    const first = runImport(sceneWith([
      {
        key: "swale-dig-on-the-east-slope", title: "Swale dig on the east slope",
        structure_key: "foodforest", address_source: "resolver-guess",
      },
    ]));
    expect(first).toContain("[key swale-dig-on-the-east-slope]");
    let row = await questRow("q-swale");
    expect(row.map_key).toBe("swale-dig-on-the-east-slope");
    expect(row.structure_key).toBe("foodforest");

    // THE POINT. The map renames the quest and keeps the key it minted once.
    // A title match reports NO MATCH here and the address stops arriving; the
    // key match carries it through to a row whose title no longer agrees.
    const second = runImport(sceneWith([
      {
        key: "swale-dig-on-the-east-slope", title: "Swale dig, east slope, second pass",
        structure_key: "ponds", address_source: "creator",
      },
    ]));
    expect(second).not.toContain("NO MATCH");
    row = await questRow("q-swale");
    expect(row.structure_key).toBe("ponds");
    expect(row.address_source).toBe("creator");
    // The site's own title is never rewritten from a scene; only the address
    // moved. A village names its own work.
    expect(row.title).toBe("Swale dig on the east slope");
  });

  it("still refuses to move an address a person placed, matched by key or not", async () => {
    await pool.query(
      "INSERT INTO quests (id, title) VALUES ('q-held','A quest somebody placed')",
    );
    runImport(sceneWith([
      { key: "a-quest-somebody-placed", title: "A quest somebody placed", structure_key: "gate", address_source: "creator" },
    ]));
    // Matching by key gets the importer to the row. It does NOT get it past
    // the creator-wins rule, which is the whole doctrine of the address plane
    // and must not quietly weaken because the join got better.
    const out = runImport(sceneWith([
      { key: "a-quest-somebody-placed", title: "A quest somebody placed", structure_key: "kitchen", address_source: "resolver-guess" },
    ]));
    expect(out).toContain("LEFT ALONE");
    expect((await questRow("q-held")).structure_key).toBe("gate");
  });

  it("reports a quest it cannot find instead of creating one", async () => {
    const out = runImport(sceneWith([
      { key: "no-such-quest-here", title: "A quest this village never had", structure_key: "gate" },
    ]));
    expect(out).toContain("NO MATCH");
    const [rows] = await pool.query<any[]>(
      "SELECT COUNT(*) n FROM quests WHERE map_key = 'no-such-quest-here'",
    );
    expect(Number(rows[0].n)).toBe(0);
  });

  it("lets the key beat the title when the two disagree", async () => {
    /*
     * The precedence rule, stated as a test because it is the thing that
     * makes a rename survivable and it is also the thing that would hide a
     * mistake. Once a key is stamped, THAT is the row, and a scene entry
     * whose title happens to name a different quest does not redirect it.
     *
     * This is also why the ER_DUP_ENTRY guard in the importer is close to
     * unreachable from a real export: the key lookup finds the stamped row
     * before anything tries to stamp a second one. The guard stays because a
     * unique-key violation would otherwise abandon a whole import halfway,
     * and it is not claimed as tested here.
     */
    await pool.query(
      "INSERT INTO quests (id, title) VALUES ('q-a','Quest A'),('q-b','Quest B')",
    );
    runImport(sceneWith([
      { key: "shared-key", title: "Quest A", structure_key: "gate", address_source: "resolver-guess" },
    ]));
    expect((await questRow("q-a")).map_key).toBe("shared-key");

    runImport(sceneWith([
      { key: "shared-key", title: "Quest B", structure_key: "kitchen", address_source: "resolver-guess" },
    ]));
    // Quest A moved, because the key named it. Quest B is untouched and
    // unstamped, because its title never got a turn.
    expect((await questRow("q-a")).structure_key).toBe("kitchen");
    expect((await questRow("q-b")).map_key).toBeNull();
    expect((await questRow("q-b")).structure_key).toBeNull();
  });
});
