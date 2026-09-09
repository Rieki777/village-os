/**
 * THE TRAINING RUNG IS THE SERVER'S TO SAY, and this proves the exploit is shut
 * rather than moved.
 *
 * The defect: `POST /api/game/journey/sync` stored whatever list of ids a
 * member sent, and the rung asked only whether every real module id appeared in
 * it. `GET /api/training-modules` has no authentication by design, so the whole
 * thing was one public read and one authenticated write.
 *
 * The test that matters is the LAST one: it performs the exploit against the
 * new shape and asserts it fails. A suite that only checks the new happy path
 * would pass just as well against code that left the old door open beside it.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import mysql from "mysql2/promise";
import { provisionTestDb, testDbConfigured, type TestDb } from "../db/testDb";
import {
  completionsFor,
  completionsForMany,
  gatingModuleIds,
  recordCompletion,
  serverOwnedJourneyRefusal,
  trainingIsComplete,
} from "./trainingRecord";

const configured = testDbConfigured();
if (!configured) {
  console.warn("[trainingRecord] TEST_DATABASE_URL not set - DB-backed tests SKIPPED.");
}

let db: TestDb;
let pool: mysql.Pool;

beforeAll(async () => {
  if (!configured) return;
  db = await provisionTestDb();
  pool = mysql.createPool({ uri: db.url, timezone: "Z", connectionLimit: 4 });
});

afterAll(async () => {
  if (!configured) return;
  await pool?.end();
  await db?.drop();
});

beforeEach(async () => {
  if (!configured) return;
  await pool.query("DELETE FROM training_completions");
});

describe("what completion means, with no database", () => {
  it("needs every module the village offers, and says so by the SET", () => {
    expect(trainingIsComplete(["a", "b"], ["a", "b"])).toBe(true);
    expect(trainingIsComplete(["a", "b"], ["a"])).toBe(false);
    // Extra completions for modules that no longer exist do not block the rung:
    // a village retiring a module must not strand the members who did it.
    expect(trainingIsComplete(["a"], ["a", "b-retired"])).toBe(true);
  });

  it("answers FALSE for a village with no modules, which is the safe direction", () => {
    /*
     * "There is nothing to complete" must not read as "everybody has completed
     * everything", or emptying the catalogue would hand the rung to the whole
     * village at once. The old code had this shape and it is kept on purpose.
     */
    expect(trainingIsComplete([], [])).toBe(false);
    expect(trainingIsComplete([], ["a"])).toBe(false);
  });

  it("refuses the old door for training and leaves every other journey alone", () => {
    expect(serverOwnedJourneyRefusal("training")?.code).toBe("training_is_server_owned");
    // Named, so an old client is told where the door went rather than silently
    // believing it saved.
    expect(serverOwnedJourneyRefusal("training")?.error).toContain("/api/game/training/");
    for (const other of ["onboarding", "investor", "", null, undefined, 7]) {
      expect(serverOwnedJourneyRefusal(other), String(other)).toBeNull();
    }
  });
});

describe.skipIf(!configured)("the record the server keeps", () => {
  it("stamps the instant itself, on Node's clock", async () => {
    const before = Date.now();
    await recordCompletion(pool, "u-1", "mod-a");
    const [rows] = await pool.query<any[]>(
      "SELECT completed_at FROM training_completions WHERE user_id = ? AND module_id = ?",
      ["u-1", "mod-a"],
    );
    const raw = rows[0]?.completed_at;
    const stamped = raw instanceof Date ? raw : new Date(String(raw).replace(" ", "T") + "Z");
    // A database on another offset lands HOURS out, so this cannot pass by
    // accident on a box whose clock disagrees with Node's.
    expect(Math.abs(stamped.getTime() - before)).toBeLessThan(5000);
  });

  it("is idempotent, and a second marking does not move the first date", async () => {
    await recordCompletion(pool, "u-2", "mod-a");
    const [first] = await pool.query<any[]>(
      "SELECT completed_at FROM training_completions WHERE user_id = ?",
      ["u-2"],
    );
    await new Promise((r) => setTimeout(r, 1100));
    await recordCompletion(pool, "u-2", "mod-a");
    const [again] = await pool.query<any[]>(
      "SELECT user_id, completed_at FROM training_completions WHERE user_id = ?",
      ["u-2"],
    );
    expect(again.length, "one row, not two claims").toBe(1);
    expect(String(again[0].completed_at)).toBe(String(first[0].completed_at));
  });

  it("reads back one member's set, and many members in one query", async () => {
    await recordCompletion(pool, "u-3", "mod-a");
    await recordCompletion(pool, "u-3", "mod-b");
    await recordCompletion(pool, "u-4", "mod-a");
    expect(await completionsFor(pool, "u-3")).toEqual(["mod-a", "mod-b"]);
    expect(await completionsFor(pool, "nobody")).toEqual([]);

    const many = await completionsForMany(pool, ["u-3", "u-4", "u-5"]);
    expect(many.get("u-3")).toEqual(["mod-a", "mod-b"]);
    expect(many.get("u-4")).toEqual(["mod-a"]);
    expect(many.get("u-5"), "a member with none is absent, not empty-and-present").toBeUndefined();
  });

  it("asks the database nothing for an empty roll, because IN () is a syntax error", async () => {
    expect(await completionsForMany(pool, [])).toEqual(new Map());
  });

  it("THE EXPLOIT: a member cannot hand the server a finished set", async () => {
    /*
     * The old attack, performed against the new shape. Read the public module
     * list, post the ids back as one list, cross the rung.
     *
     * There is no route that accepts a list any more, so the closest a member
     * can get is the journey door, and that door names its refusal. The record
     * stays empty, which is the assertion that matters: the rung reads THIS
     * table and nothing a member can write.
     */
    const publiclyKnownIds = ["mod-a", "mod-b", "mod-c"];

    expect(serverOwnedJourneyRefusal("training")).not.toBeNull();
    expect(await completionsFor(pool, "u-attacker")).toEqual([]);
    expect(trainingIsComplete(publiclyKnownIds, await completionsFor(pool, "u-attacker"))).toBe(false);

    // And the honest path still works, one module at a time, which is the
    // control: without it this test would pass against a build where nothing
    // could ever be completed at all.
    for (const id of publiclyKnownIds) await recordCompletion(pool, "u-attacker", id);
    expect(trainingIsComplete(publiclyKnownIds, await completionsFor(pool, "u-attacker"))).toBe(true);
  });
});

describe("gatingModuleIds", () => {
  it("counts a module with no flag as required, so nobody's rung moves on the deploy", () => {
    // Migration 0191 defaults the column to 1, so every row that already exists
    // is mandatory. Reading it as `=== true` would demote every member of every
    // village on the release that shipped the column.
    expect(gatingModuleIds([{ id: "a" }, { id: "b" }])).toEqual(["a", "b"]);
  });

  it("drops the ones a village marked optional", () => {
    expect(gatingModuleIds([{ id: "a", mandatory: true }, { id: "b", mandatory: false }])).toEqual(["a"]);
  });

  it("answers empty when everything is optional, which trainingIsComplete refuses", () => {
    // "This village gates nothing" is a decision somebody makes in Admin, never
    // one a deploy makes by promoting every member at once.
    const ids = gatingModuleIds([{ id: "a", mandatory: false }]);
    expect(ids).toEqual([]);
    expect(trainingIsComplete(ids, ["a"])).toBe(false);
  });

  it("lets a member cross once the required ones are done, optional ones untouched", () => {
    const mods = [{ id: "a" }, { id: "b", mandatory: false }];
    expect(trainingIsComplete(gatingModuleIds(mods), ["a"])).toBe(true);
  });
})
