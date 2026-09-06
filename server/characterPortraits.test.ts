/**
 * Portraits: the privacy rule, the atomic budget, and the crop that is a
 * property of the stored bytes.
 *
 * The arithmetic is proved without a database in
 * `shared/characterPortraits.test.ts`. Everything here needs a real one,
 * because every claim in this file is about what SQL does: a filter that has to
 * run in the WHERE clause, a decrement that has to survive two callers, and an
 * accrual that has to be applied once by whichever process gets there first.
 *
 * THE CROP TEST DOES NOT ASSERT A COMMENT. It runs the real encoder over a real
 * picture of the wrong shape and measures the output.
 */
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import mysql from "mysql2/promise";
import { addCharacter, partyFor } from "./lib/characters";
import {
  PORTRAIT_HEIGHT,
  PORTRAIT_WIDTH,
  encodePortrait,
  hasPortraitForge,
  installPortraitForge,
  portraitUrl,
  readBudget,
} from "./lib/characterPortraits";
import * as repo from "./repos/characterPortraits";
import { seedEconomy } from "./lib/economySeed";
import { loadTokenRegistry, memberAccount } from "./lib/ledger";
import { provisionTestDb, testDbConfigured, type TestDb } from "./db/testDb";

const configured = testDbConfigured();
const VILLAGE = "local";

let db: TestDb;
let pool: mysql.Pool;

async function makeMember(id: string): Promise<string> {
  await pool.query( // module-review-ok: reading back from the scratch schema this suite provisioned, which is the assertion
    "INSERT INTO `users` (`id`, `name`, `email`, `password_hash`) VALUES (?,?,?,'x') " +
      "ON DUPLICATE KEY UPDATE `name` = VALUES(`name`)",
    [id, id, `${id}@examples.invalid`],
  );
  await pool.query( // module-review-ok: reading back from the scratch schema this suite provisioned, which is the assertion
    "INSERT IGNORE INTO `ledger_accounts` (`id`, `kind`, `user_id`, `label`, `faucet`) VALUES (?,?,?,?,0)",
    [memberAccount(id), "member", id, id],
  );
  return id;
}

/** A portrait row with a filename that names no real file. The repo never opens one. */
async function givePortrait(userId: string, key: string, fileName: string) {
  await repo.upsertPortrait(pool, {
    id: `cp-${userId}-${key}`,
    villageId: VILLAGE,
    userId,
    archetypeKey: key,
    fileName,
    source: "uploaded",
    width: PORTRAIT_WIDTH,
    height: PORTRAIT_HEIGHT,
    bytes: 1234,
  });
}

describe.skipIf(!configured)("character portraits", () => {
  beforeAll(async () => {
    db = await provisionTestDb();
    pool = mysql.createPool({ uri: db.url, timezone: "Z", connectionLimit: 10 }); // module-review-ok: the suite's own pool onto the scratch schema it provisioned
    await loadTokenRegistry(pool);
    await seedEconomy(pool, VILLAGE);
  });

  afterAll(async () => {
    await pool?.end();
    await db?.drop?.();
  });

  // ── The rule the public profile depends on ──────────────────────────────

  describe("private until published", () => {
    it("hides an unpublished portrait from everybody except its owner", async () => {
      const owner = await makeMember("pp-owner-1");
      const stranger = await makeMember("pp-stranger-1");
      await addCharacter(pool, VILLAGE, owner, {
        archetypeKey: "building", presentation: "f", tone: "olive",
      });
      await givePortrait(owner, "building", "portrait-private-1.webp");

      const own = await partyFor(pool, VILLAGE, owner, owner);
      expect(own[0].avatar).toBe("/api/uploads/portrait-private-1.webp");
      expect(own[0].portrait).toEqual({ source: "uploaded", published: false });

      // The two readings a stranger can be: signed in as somebody else, and
      // not signed in at all. Neither sees it.
      for (const viewer of [stranger, null]) {
        const theirs = await partyFor(pool, VILLAGE, owner, viewer);
        expect(theirs[0].portrait).toBeNull();
        expect(theirs[0].avatar).toBe(theirs[0].stockAvatar);
        expect(JSON.stringify(theirs)).not.toContain("portrait-private-1");
      }
    });

    it("shows it to everybody once the owner publishes, and hides it again on withdrawal", async () => {
      const owner = await makeMember("pp-owner-2");
      const stranger = await makeMember("pp-stranger-2");
      await addCharacter(pool, VILLAGE, owner, {
        archetypeKey: "building", presentation: "f", tone: "olive",
      });
      await givePortrait(owner, "building", "portrait-public-2.webp");

      expect(await repo.setPublished(pool, VILLAGE, owner, "building", true)).toBe(true);
      const seen = await partyFor(pool, VILLAGE, owner, stranger);
      expect(seen[0].avatar).toBe("/api/uploads/portrait-public-2.webp");
      expect(seen[0].portrait).toEqual({ source: "uploaded", published: true });

      expect(await repo.setPublished(pool, VILLAGE, owner, "building", false)).toBe(true);
      const gone = await partyFor(pool, VILLAGE, owner, stranger);
      expect(gone[0].portrait).toBeNull();
      expect(JSON.stringify(gone)).not.toContain("portrait-public-2");
    });

    it("filters in SQL, so a stranger's read never fetches the private filename", async () => {
      const owner = await makeMember("pp-owner-3");
      await givePortrait(owner, "building", "portrait-sql-3.webp");
      // `publishedPortraitsOf` is the query a stranger's request runs. It is
      // the guarantee, and it is asserted directly rather than through the
      // caller that happens to use it today.
      expect(await repo.publishedPortraitsOf(pool, VILLAGE, owner)).toHaveLength(0);
      expect(await repo.portraitsOwnedBy(pool, VILLAGE, owner)).toHaveLength(1);
    });

    it("refuses to publish a row that holds only a candidate", async () => {
      const owner = await makeMember("pp-owner-4");
      await repo.stageCandidate(pool, {
        id: "cp-cand-4", villageId: VILLAGE, userId: owner,
        archetypeKey: "building", fileName: "portrait-cand-4.webp",
      });
      expect(await repo.setPublished(pool, VILLAGE, owner, "building", true)).toBe(false);
      expect(await repo.publishedPortraitsOf(pool, VILLAGE, owner)).toHaveLength(0);
    });
  });

  // ── One row per member per class ────────────────────────────────────────

  describe("one record per member per class", () => {
    it("replaces rather than growing a second row", async () => {
      const owner = await makeMember("pp-owner-5");
      await givePortrait(owner, "building", "portrait-first-5.webp");
      await givePortrait(owner, "building", "portrait-second-5.webp");
      const rows = await repo.portraitsOwnedBy(pool, VILLAGE, owner);
      expect(rows).toHaveLength(1);
      expect(rows[0].fileName).toBe("portrait-second-5.webp");
    });

    it("keeps one row per class and not one per member", async () => {
      const owner = await makeMember("pp-owner-6");
      await givePortrait(owner, "building", "portrait-b-6.webp");
      await givePortrait(owner, "researching", "portrait-r-6.webp");
      expect(await repo.portraitsOwnedBy(pool, VILLAGE, owner)).toHaveLength(2);
    });

    it("keeps the published state through a replacement, in both directions", async () => {
      const owner = await makeMember("pp-owner-7");
      await givePortrait(owner, "building", "portrait-p1-7.webp");
      await repo.setPublished(pool, VILLAGE, owner, "building", true);
      await givePortrait(owner, "building", "portrait-p2-7.webp");
      // Swapping the picture on a published portrait must not silently
      // un-publish it, and must not silently publish a private one.
      expect((await repo.portraitFor(pool, VILLAGE, owner, "building"))!.publishedAt).not.toBeNull();
      await repo.setPublished(pool, VILLAGE, owner, "building", false);
      await givePortrait(owner, "building", "portrait-p3-7.webp");
      expect((await repo.portraitFor(pool, VILLAGE, owner, "building"))!.publishedAt).toBeNull();
    });
  });

  // ── The candidate lifecycle ─────────────────────────────────────────────

  describe("a forged candidate", () => {
    it("does not disturb the portrait already on the card", async () => {
      const owner = await makeMember("pp-owner-8");
      await givePortrait(owner, "building", "portrait-live-8.webp");
      await repo.setPublished(pool, VILLAGE, owner, "building", true);
      await repo.stageCandidate(pool, {
        id: "cp-cand-8", villageId: VILLAGE, userId: owner,
        archetypeKey: "building", fileName: "portrait-cand-8.webp",
      });
      const row = (await repo.portraitFor(pool, VILLAGE, owner, "building"))!;
      expect(row.fileName).toBe("portrait-live-8.webp");
      expect(row.candidateFileName).toBe("portrait-cand-8.webp");
      expect(row.publishedAt).not.toBeNull();
    });

    it("becomes the portrait on keep, and records that a forge made it", async () => {
      const owner = await makeMember("pp-owner-9");
      await repo.stageCandidate(pool, {
        id: "cp-cand-9", villageId: VILLAGE, userId: owner,
        archetypeKey: "building", fileName: "portrait-cand-9.webp",
      });
      expect(
        await repo.keepCandidate(pool, VILLAGE, owner, "building", { width: null, height: null, bytes: 9 }),
      ).toBe(true);
      const row = (await repo.portraitFor(pool, VILLAGE, owner, "building"))!;
      expect(row.fileName).toBe("portrait-cand-9.webp");
      expect(row.source).toBe("forged");
      expect(row.candidateFileName).toBeNull();
      // A second keep lands on nothing, so two taps cannot double anything.
      expect(
        await repo.keepCandidate(pool, VILLAGE, owner, "building", { width: null, height: null, bytes: 9 }),
      ).toBe(false);
    });

    it("leaves the row alone on discard, and a discard is never a refund", async () => {
      const owner = await makeMember("pp-owner-10");
      await repo.stageCandidate(pool, {
        id: "cp-cand-10", villageId: VILLAGE, userId: owner,
        archetypeKey: "building", fileName: "portrait-cand-10.webp",
      });
      await repo.loadCounters(pool, VILLAGE, owner);
      await repo.spendGrant(pool, VILLAGE, owner);
      const before = await repo.loadCounters(pool, VILLAGE, owner);
      expect(await repo.clearCandidate(pool, VILLAGE, owner, "building")).toBe(true);
      const after = await repo.loadCounters(pool, VILLAGE, owner);
      // The whole rule: the gift stays spent.
      expect(after.setupRemaining + after.moonRemaining).toBe(before.setupRemaining + before.moonRemaining);
      expect(after.spent).toBe(before.spent);
    });
  });

  // ── The budget, against a real database ─────────────────────────────────

  describe("the budget", () => {
    it("hands a member three gifts the first time it is read, and only once", async () => {
      const owner = await makeMember("pp-budget-1");
      const first = await repo.loadCounters(pool, VILLAGE, owner);
      expect(first.setupRemaining).toBe(3);
      expect(first.moonRemaining).toBe(0);
      await repo.spendGrant(pool, VILLAGE, owner);
      // A second read must not top the row back up to three.
      expect((await repo.loadCounters(pool, VILLAGE, owner)).setupRemaining).toBe(2);
    });

    it("spends exactly once when two callers arrive together on the last gift", async () => {
      const owner = await makeMember("pp-budget-2");
      await repo.loadCounters(pool, VILLAGE, owner);
      await pool.query( // module-review-ok: reading back from the scratch schema this suite provisioned, which is the assertion
        "UPDATE `portrait_grants` SET `setup_remaining` = 1, `moon_remaining` = 0 WHERE `user_id` = ?",
        [owner],
      );
      const both = await Promise.all([
        repo.spendGrant(pool, VILLAGE, owner),
        repo.spendGrant(pool, VILLAGE, owner),
      ]);
      expect(both.filter(Boolean)).toHaveLength(1);
      const after = await repo.loadCounters(pool, VILLAGE, owner);
      expect(after.setupRemaining).toBe(0);
      expect(after.spent).toBe(1);
    });

    it("takes the moon half before the setup half", async () => {
      const owner = await makeMember("pp-budget-3");
      await repo.loadCounters(pool, VILLAGE, owner);
      await pool.query( // module-review-ok: reading back from the scratch schema this suite provisioned, which is the assertion
        "UPDATE `portrait_grants` SET `setup_remaining` = 3, `moon_remaining` = 2 WHERE `user_id` = ?",
        [owner],
      );
      await repo.spendGrant(pool, VILLAGE, owner);
      const after = await repo.loadCounters(pool, VILLAGE, owner);
      expect(after.moonRemaining).toBe(1);
      expect(after.setupRemaining).toBe(3);
    });

    /**
     * THE ONE VALUE THAT SHOWED THE BUG, and the reason this test is separate
     * from the one above.
     *
     * `spendGrant` was a single UPDATE choosing its counter in two CASE
     * expressions. MySQL evaluates a single-table UPDATE's assignments left to
     * right and lets a later one read what an earlier one just wrote, so
     * setting `moon_remaining` to 0 made the next clause read that 0, take its
     * ELSE branch, and spend a setup grant in the same statement. One press,
     * two gifts.
     *
     * The test above passes either way, because a moon half of TWO leaves a 1
     * behind for the second clause to read. Exactly one is the only starting
     * value that separates the two behaviours, so it gets its own case with its
     * own name.
     */
    it("spends exactly ONE gift when the moon half holds exactly one", async () => {
      const owner = await makeMember("pp-budget-3b");
      await repo.loadCounters(pool, VILLAGE, owner);
      await pool.query( // module-review-ok: reading back from the scratch schema this suite provisioned, which is the assertion
        "UPDATE `portrait_grants` SET `setup_remaining` = 3, `moon_remaining` = 1, `spent` = 0 WHERE `user_id` = ?",
        [owner],
      );
      expect(await repo.spendGrant(pool, VILLAGE, owner)).toBe(true);
      const after = await repo.loadCounters(pool, VILLAGE, owner);
      expect(after.moonRemaining).toBe(0);
      expect(after.setupRemaining).toBe(3);
      expect(after.spent).toBe(1);
      // The whole point, said as the total: four gifts became three.
      expect(after.setupRemaining + after.moonRemaining).toBe(3);
    });

    it("spends one at a time all the way down, and stops at empty", async () => {
      const owner = await makeMember("pp-budget-3c");
      await repo.loadCounters(pool, VILLAGE, owner);
      await pool.query( // module-review-ok: reading back from the scratch schema this suite provisioned, which is the assertion
        "UPDATE `portrait_grants` SET `setup_remaining` = 3, `moon_remaining` = 3, `spent` = 0 WHERE `user_id` = ?",
        [owner],
      );
      // Six gifts means six presses, and every intermediate total is exact.
      for (let left = 5; left >= 0; left--) {
        expect(await repo.spendGrant(pool, VILLAGE, owner)).toBe(true);
        const c = await repo.loadCounters(pool, VILLAGE, owner);
        expect(c.setupRemaining + c.moonRemaining).toBe(left);
      }
      expect(await repo.spendGrant(pool, VILLAGE, owner)).toBe(false);
      const end = await repo.loadCounters(pool, VILLAGE, owner);
      expect(end.spent).toBe(6);
      expect(end.setupRemaining).toBe(0);
      expect(end.moonRemaining).toBe(0);
    });

    it("applies an accrual once when two processes read the same turned moon", async () => {
      const owner = await makeMember("pp-budget-4");
      await repo.loadCounters(pool, VILLAGE, owner);
      await pool.query( // module-review-ok: reading back from the scratch schema this suite provisioned, which is the assertion
        "UPDATE `portrait_grants` SET `moon_remaining` = 0, `moon_cycle` = 400 WHERE `user_id` = ?",
        [owner],
      );
      const both = await Promise.all([
        repo.applyAccrual(pool, VILLAGE, owner, 1, 401),
        repo.applyAccrual(pool, VILLAGE, owner, 1, 401),
      ]);
      expect(both.filter(Boolean)).toHaveLength(1);
      expect((await repo.loadCounters(pool, VILLAGE, owner)).moonRemaining).toBe(1);
    });

    it("refunds into the SETUP half, where no ceiling can swallow it", async () => {
      const owner = await makeMember("pp-budget-5");
      await repo.loadCounters(pool, VILLAGE, owner);
      await pool.query( // module-review-ok: reading back from the scratch schema this suite provisioned, which is the assertion
        "UPDATE `portrait_grants` SET `setup_remaining` = 0, `moon_remaining` = 3, `spent` = 4 WHERE `user_id` = ?",
        [owner],
      );
      await repo.refundGrant(pool, VILLAGE, owner);
      const after = await repo.loadCounters(pool, VILLAGE, owner);
      expect(after.setupRemaining).toBe(1);
      expect(after.moonRemaining).toBe(3);
      expect(after.spent).toBe(3);
    });

    /**
     * THE UNANCHORED VILLAGE. A village with no Moon 1 has no ordinal to print
     * and its members are still owed their gifts, so the accrual must run off
     * the absolute lunation number and never off the anchor.
     *
     * The scratch schema has no launch state and no first-moon override, which
     * IS the unanchored village. Nothing is stubbed to produce it.
     */
    it("works in a village that has not set its Moon 1", async () => {
      const owner = await makeMember("pp-budget-6");
      const { budget, moon } = await readBudget(pool, VILLAGE, owner);
      expect(moon.standing).toBe("unanchored");
      expect(moon.ordinal).toBeNull();
      // The budget exists anyway, and the window is still readable, so the
      // countdown can still name a day.
      expect(budget.total).toBe(3);
      expect(budget.moonCycle).not.toBeNull();
      expect(moon.endsAt).not.toBe("");
      expect(budget.daysToNextGrant).not.toBeNull();
      expect(budget.daysToNextGrant).toBeGreaterThanOrEqual(0);
    });

    it("accrues across a turned moon in that same unanchored village", async () => {
      const owner = await makeMember("pp-budget-7");
      await readBudget(pool, VILLAGE, owner);
      const [rows]: any = await pool.query( // module-review-ok: reading back from the scratch schema this suite provisioned, which is the assertion
        "SELECT `moon_cycle` AS c FROM `portrait_grants` WHERE `user_id` = ?", [owner],
      );
      const now = Number(rows[0].c);
      // Wind the marker back two moons, then read again.
      await pool.query( // module-review-ok: reading back from the scratch schema this suite provisioned, which is the assertion
        "UPDATE `portrait_grants` SET `moon_cycle` = ?, `moon_remaining` = 0 WHERE `user_id` = ?",
        [now - 2, owner],
      );
      const after = await readBudget(pool, VILLAGE, owner);
      expect(after.budget.moonRemaining).toBe(2);
      expect(after.budget.total).toBe(5);
    });
  });

  // ── The file sweep and the address ──────────────────────────────────────

  describe("filenames", () => {
    it("names every live file, candidates included", async () => {
      const owner = await makeMember("pp-files-1");
      await givePortrait(owner, "building", "portrait-live-f1.webp");
      await repo.stageCandidate(pool, {
        id: "cp-cand-f1", villageId: VILLAGE, userId: owner,
        archetypeKey: "researching", fileName: "portrait-cand-f1.webp",
      });
      const live = await repo.livePortraitFiles(pool);
      expect(live.has("portrait-live-f1.webp")).toBe(true);
      expect(live.has("portrait-cand-f1.webp")).toBe(true);
    });

    it("hands back both filenames on a delete so the caller can unlink them", async () => {
      const owner = await makeMember("pp-files-2");
      await givePortrait(owner, "building", "portrait-live-f2.webp");
      await repo.stageCandidate(pool, {
        id: "cp-cand-f2", villageId: VILLAGE, userId: owner,
        archetypeKey: "building", fileName: "portrait-cand-f2.webp",
      });
      const files = await repo.deletePortrait(pool, VILLAGE, owner, "building");
      expect(files.sort()).toEqual(["portrait-cand-f2.webp", "portrait-live-f2.webp"]);
      expect(await repo.portraitFor(pool, VILLAGE, owner, "building")).toBeNull();
    });

    it("refuses to build an address out of anything with a separator in it", () => {
      // 0069's rule, kept: a path in a data column is a path somebody can
      // point anywhere. Nothing this build mints looks like these.
      expect(portraitUrl("portrait-1-abc.webp")).toBe("/api/uploads/portrait-1-abc.webp");
      expect(portraitUrl("../../etc/passwd")).toBeNull();
      expect(portraitUrl("a/b.webp")).toBeNull();
      expect(portraitUrl("a\\b.webp")).toBeNull();
      expect(portraitUrl("")).toBeNull();
      expect(portraitUrl(null)).toBeNull();
    });
  });

  // ── The crop, measured ──────────────────────────────────────────────────

  describe("the 3:4 crop", () => {
    it("comes out 3:4 from a wide picture, whatever went in", async () => {
      const sharp = (await import("sharp")).default;
      const wide = await sharp({
        create: { width: 1600, height: 400, channels: 3, background: { r: 20, g: 90, b: 60 } },
      }).jpeg().toBuffer();
      const out = await encodePortrait(wide);
      expect(out.width).toBe(PORTRAIT_WIDTH);
      expect(out.height).toBe(PORTRAIT_HEIGHT);
      expect(out.width / out.height).toBeCloseTo(3 / 4, 5);
    });

    it("comes out 3:4 from a tall picture too", async () => {
      const sharp = (await import("sharp")).default;
      const tall = await sharp({
        create: { width: 300, height: 1900, channels: 3, background: { r: 90, g: 20, b: 60 } },
      }).png().toBuffer();
      const out = await encodePortrait(tall);
      expect(out.width).toBe(PORTRAIT_WIDTH);
      expect(out.height).toBe(PORTRAIT_HEIGHT);
    });

    it("carries no metadata out, which is the strip this shares with place photos", async () => {
      const sharp = (await import("sharp")).default;
      const { readMetadataMarkers } = await import("./lib/uploads");
      const src = await sharp({
        create: { width: 800, height: 800, channels: 3, background: { r: 10, g: 10, b: 10 } },
      })
        .withMetadata({ exif: { IFD0: { Copyright: "somebody", Software: "a camera" } } })
        .jpeg()
        .toBuffer();
      // The fixture really does carry it, so the assertion below cannot pass
      // vacuously.
      expect(await readMetadataMarkers(src)).not.toHaveLength(0);
      const out = await encodePortrait(src);
      expect(await readMetadataMarkers(out.bytes)).toHaveLength(0);
    });
  });

  // ── The seam ────────────────────────────────────────────────────────────

  describe("the forge seam", () => {
    it("is empty in this build, which is what makes the upload path the whole feature", () => {
      expect(hasPortraitForge()).toBe(false);
    });

    it("accepts a provider and gives it back, and can be emptied again", async () => {
      const fake = { name: "test", render: async () => Buffer.alloc(0) };
      installPortraitForge(fake);
      expect(hasPortraitForge()).toBe(true);
      installPortraitForge(null);
      expect(hasPortraitForge()).toBe(false);
    });
  });
});
