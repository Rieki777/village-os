/**
 * Draft, publish and undo, against a real scratch schema (0063).
 *
 * Three properties here cannot be proven any other way, and each one is a
 * failure a founder would meet on a normal Tuesday:
 *
 *   1. A scene comes back byte for byte. Only the database can prove this,
 *      because the column type is where a scene would lose its parts.
 *   2. Two admins publishing from the same base: exactly one wins, the loser
 *      is told, and NOTHING is half-written. Only concurrency against the
 *      real UNIQUE index can prove that.
 *   3. An undo appends. The version that was live when someone pressed undo
 *      is still there afterwards, so undo is safe to press when unsure.
 *
 * Runs against the S5 harness: a scratch schema with every real migration
 * applied. No TEST_DATABASE_URL and it skips loudly.
 */
import { describe, expect, it, beforeAll, afterAll, beforeEach } from "vitest";
import mysql from "mysql2/promise";
import {
  discardDraft,
  getDraft,
  listRevisions,
  pendingDraft,
  publishScene,
  publishedScene,
  publishedVersion,
  restoreRevision,
  revisionScene,
  saveDraft,
} from "./mapScene";
import { provisionTestDb, testDbConfigured, type TestDb } from "../db/testDb";

const configured = testDbConfigured();

let db: TestDb;
let pool: mysql.Pool;

/**
 * A scene with deliberately awkward JSON text: keys out of alphabetical
 * order, irregular whitespace, a block from no build that exists, a unicode
 * name and an empty array. If any layer normalises, re-serialises or rebuilds
 * a scene, this string changes and the verbatim test fails.
 */
const AWKWARD_SCENE =
  '{"zz_last":1,"map_scene":{"version":"v0.8-roundD","name":"Riverbend"},' +
  '"map_structures":[{"key":"gate","name":"Portón"}],' +
  '"a_block_from_a_later_build":{"deep":[null,false,  3]},"empty":[]}';

describe.skipIf(!configured)("the map's draft, publish and undo", () => {
  beforeAll(async () => {
    db = await provisionTestDb();
    pool = mysql.createPool({ uri: db.url, timezone: "Z", connectionLimit: 6 });
  });

  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  beforeEach(async () => {
    // Each test starts from a village that has never published.
    await pool.query("DELETE FROM map_scene_revisions");
    await pool.query("DELETE FROM map_scene_drafts");
    await pool.query("ALTER TABLE map_scene_revisions AUTO_INCREMENT = 1");
  });

  it("an unpublished village has no live map and a base of 0", async () => {
    expect(await publishedScene(pool)).toBeNull();
    expect(await publishedVersion(pool)).toBe(0);
  });

  it("stores and returns a scene byte for byte", async () => {
    const r = await publishScene(pool, {
      scene: AWKWARD_SCENE,
      baseVersion: 0,
      actorUserId: "u-rye",
    });
    expect(r.ok).toBe(true);

    const live = await publishedScene(pool);
    // The whole point: identical text, not merely equivalent JSON.
    expect(live?.scene).toBe(AWKWARD_SCENE);
    expect(live?.version).toBe(1);
    expect(live?.actorUserId).toBe("u-rye");
  });

  it("carries the change summary and the note into the history", async () => {
    await publishScene(pool, {
      scene: AWKWARD_SCENE,
      baseVersion: 0,
      actorUserId: "u-rye",
      note: "Moved the hall to where it actually stands",
      summary: [{ seq: 2, action: "move", target: "Great Hall", text: "moved Great Hall", at: "" }],
    });
    const live = await publishedScene(pool);
    expect(live?.note).toMatch(/actually stands/);
    expect(live?.summary).toHaveLength(1);
    expect(live?.summary[0].text).toBe("moved Great Hall");
  });

  describe("two admins, one map", () => {
    it("refuses the second publish from a stale base and writes nothing", async () => {
      await publishScene(pool, { scene: AWKWARD_SCENE, baseVersion: 0, actorUserId: "u-rye" });

      const second = await publishScene(pool, {
        scene: '{"map_scene":{"version":"v0.8-roundD"},"map_structures":[]}',
        baseVersion: 0, // forked before Rye published
        actorUserId: "u-mara",
      });

      expect(second.ok).toBe(false);
      if (second.ok) throw new Error("unreachable");
      expect(second.reason).toBe("stale");
      // The loser is told who moved it, which is what turns a refusal into a
      // sentence somebody can act on.
      expect(second.live.version).toBe(1);
      expect(second.live.actorUserId).toBe("u-rye");

      // And the live map is untouched: no half-write, no second row.
      expect((await publishedScene(pool))?.scene).toBe(AWKWARD_SCENE);
      expect(await listRevisions(pool)).toHaveLength(1);
    });

    it("lets the loser through once they rebase onto what is live", async () => {
      await publishScene(pool, { scene: AWKWARD_SCENE, baseVersion: 0, actorUserId: "u-rye" });
      const mine = '{"map_scene":{"version":"v0.8-roundD"},"map_structures":[{"key":"barn"}]}';

      const rebased = await publishScene(pool, {
        scene: mine,
        baseVersion: await publishedVersion(pool),
        actorUserId: "u-mara",
      });

      expect(rebased.ok).toBe(true);
      expect((await publishedScene(pool))?.scene).toBe(mine);
    });

    it("settles a genuine race: exactly one of six concurrent publishes wins", async () => {
      /*
       * The read-then-write version of this passes every sequential test and
       * loses a change under real concurrency. Fired together, on separate
       * pool connections, against the real index.
       */
      const attempts = Array.from({ length: 6 }, (_, i) =>
        publishScene(pool, {
          scene: `{"map_scene":{"version":"v0.8-roundD"},"map_structures":[],"who":${i}}`,
          baseVersion: 0,
          actorUserId: `u-${i}`,
        }),
      );
      const results = await Promise.all(attempts);

      expect(results.filter((r) => r.ok)).toHaveLength(1);
      expect(results.filter((r) => !r.ok)).toHaveLength(5);
      expect(await listRevisions(pool)).toHaveLength(1);
    });
  });

  describe("drafts", () => {
    it("keeps one working copy per person, and they never touch", async () => {
      await saveDraft(pool, "u-rye", '{"mine":"rye"}', 0);
      await saveDraft(pool, "u-mara", '{"mine":"mara"}', 0);

      expect((await getDraft(pool, "u-rye"))?.scene).toBe('{"mine":"rye"}');
      expect((await getDraft(pool, "u-mara"))?.scene).toBe('{"mine":"mara"}');
    });

    it("replaces a draft wholesale on the next save", async () => {
      await saveDraft(pool, "u-rye", '{"v":1}', 0);
      await saveDraft(pool, "u-rye", '{"v":2}', 3);
      const d = await getDraft(pool, "u-rye");
      expect(d?.scene).toBe('{"v":2}');
      expect(d?.baseVersion).toBe(3);
    });

    it("publishing does NOT delete the draft under the member's hands", async () => {
      await saveDraft(pool, "u-rye", AWKWARD_SCENE, 0);
      await publishScene(pool, { scene: AWKWARD_SCENE, baseVersion: 0, actorUserId: "u-rye" });
      expect(await getDraft(pool, "u-rye")).not.toBeNull();
    });

    it("discard says whether there was anything to discard", async () => {
      expect(await discardDraft(pool, "u-rye")).toBe(false);
      await saveDraft(pool, "u-rye", '{"v":1}', 0);
      expect(await discardDraft(pool, "u-rye")).toBe(true);
      expect(await getDraft(pool, "u-rye")).toBeNull();
    });
  });

  describe("undo", () => {
    it("appends a revision instead of deleting one", async () => {
      const first = '{"map_scene":{"version":"v0.8-roundD"},"map_structures":[],"n":1}';
      const second = '{"map_scene":{"version":"v0.8-roundD"},"map_structures":[],"n":2}';
      await publishScene(pool, { scene: first, baseVersion: 0, actorUserId: "u-rye" });
      await publishScene(pool, { scene: second, baseVersion: 1, actorUserId: "u-rye" });

      const undo = await restoreRevision(pool, 1, "u-mara");
      expect(undo.ok).toBe(true);

      const live = await publishedScene(pool);
      expect(live?.version).toBe(3); // forwards, never backwards
      expect(live?.scene).toBe(first);
      expect(live?.restoredFrom).toBe(1);
      expect(live?.actorUserId).toBe("u-mara");

      // The version that was live when undo was pressed is still reachable,
      // which is what makes undo safe to press when you are not certain.
      expect(await revisionScene(pool, 2)).toBe(second);
      expect(await listRevisions(pool)).toHaveLength(3);
    });

    it("restoring what is already live writes nothing", async () => {
      await publishScene(pool, { scene: AWKWARD_SCENE, baseVersion: 0, actorUserId: "u-rye" });
      const again = await restoreRevision(pool, 1, "u-rye");
      expect(again.ok).toBe(true);
      expect(await listRevisions(pool)).toHaveLength(1);
    });

    it("says so when the version does not exist", async () => {
      const r = await restoreRevision(pool, 99, "u-rye");
      expect(r.ok).toBe(false);
      if (r.ok) throw new Error("unreachable");
      expect(r.reason).toBe("missing");
    });
  });

  it("lists history newest first and never hauls the scenes along", async () => {
    await publishScene(pool, { scene: AWKWARD_SCENE, baseVersion: 0, actorUserId: "u-rye" });
    await publishScene(pool, { scene: AWKWARD_SCENE, baseVersion: 1, actorUserId: "u-mara" });

    const rows = await listRevisions(pool);
    expect(rows.map((r) => r.version)).toEqual([2, 1]);
    expect(rows.map((r) => r.baseVersion)).toEqual([1, 0]);
    // A history page must not cost one megabyte per row.
    expect(rows.every((r) => !("scene" in r))).toBe(true);
  });

  /*
   * THE MAP THAT SAVED AND WAS EXPERIENCED AS ONE THAT DID NOT.
   *
   * Reported from live Amora on 2026-09-09: "I'm publishing my map to live
   * but it's not saving", then "it says it saves but when I save and reload
   * it gives me the old one."
   *
   * It was saving. Version 6 held exactly the 23 buildings and 53 changes the
   * banner named. What the map drew on every reload afterwards was
   *
   *   "You have an unpublished draft of the map: 23 buildings, 53 changes."
   *
   * because `publishScene` rebases the draft on success and the route offered
   * any row that existed. The count is the scene's whole edit log rather than
   * a difference, so it reads as pending work that is not pending.
   *
   * And the artifact resolves draft conflicts by letting the SERVER'S copy
   * win over the browser-saved session, so accepting that offer replaces
   * newer local work with the state already published. A correct save,
   * experienced as a lost one.
   */
  describe("the draft offered after a publish", () => {
    it("keeps the rebased row, because a second publish must not be stale", async () => {
      await saveDraft(pool, "u-rye", AWKWARD_SCENE, 0);
      const r = await publishScene(pool, { scene: AWKWARD_SCENE, baseVersion: 0, actorUserId: "u-rye" });
      expect(r.ok).toBe(true);
      await saveDraft(pool, "u-rye", AWKWARD_SCENE, r.ok ? r.version : 0);
      const row = await getDraft(pool, "u-rye");
      expect(row, "the rebase is deliberate and stays").not.toBeNull();
      expect(row!.baseVersion).toBe(1);
    });

    it("does NOT offer it, because it is the map that is already live", async () => {
      await saveDraft(pool, "u-rye", AWKWARD_SCENE, 0);
      const r = await publishScene(pool, { scene: AWKWARD_SCENE, baseVersion: 0, actorUserId: "u-rye" });
      await saveDraft(pool, "u-rye", AWKWARD_SCENE, r.ok ? r.version : 0);
      const live = await publishedScene(pool);
      const row = await getDraft(pool, "u-rye");
      expect(pendingDraft(row, live?.scene)).toBeNull();
    });

    it("DOES offer real work, which is the half that must not break", async () => {
      await publishScene(pool, { scene: AWKWARD_SCENE, baseVersion: 0, actorUserId: "u-rye" });
      const mine = JSON.stringify({ ...JSON.parse(AWKWARD_SCENE), map_edits: [{ seq: 99, action: "move" }] });
      await saveDraft(pool, "u-rye", mine, 1);
      const live = await publishedScene(pool);
      const row = await getDraft(pool, "u-rye");
      const offered = pendingDraft(row, live?.scene);
      expect(offered, "a draft that differs is still a draft").not.toBeNull();
      expect(offered!.scene).toBe(mine);
    });

    it("offers nothing when there is no draft at all", () => {
      expect(pendingDraft(null, "{}")).toBeNull();
    });

    it("offers a draft when nothing has ever been published", () => {
      // liveScene is undefined before version 1, and a first draft is real.
      expect(pendingDraft({ scene: "{}" }, undefined)).not.toBeNull();
    });
  });
});
