/**
 * THE STARTER QUEST BOARD, ON A FRESH VILLAGE AND ON ONE THAT ALREADY HAS ITS
 * OWN (2026-09-27).
 *
 * The seed used to be one village's board: "our food forests", a watch team,
 * circles to meet, and a circle name on every quest. It now says what each
 * practice is. Two promises ride on that change, and this file holds both:
 *
 *   1. A FRESH village gets the rewritten board, with no circle on any quest.
 *   2. A village that ALREADY HAS its board, the one the old seed came from
 *      included, keeps every row word for word: the seed is never applied to
 *      a table that has quests, and the story fill writes only into a field
 *      the live row left empty. Nothing is added, rewritten or deleted.
 *
 * The board for promise 2 is built from the OLD seed's own rows, the two
 * that carried the worst of it, plus a quest the seed no longer ships and one
 * a village wrote itself.
 */
import path from "node:path";
import fs from "node:fs";
import mysql from "mysql2/promise";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { provisionTestDb, testDbConfigured, type TestDb } from "../db/testDb";
import { questsRepo, type QuestRecord, type QuestsRepo } from "../repos/quests";
import { fillQuestStoriesFromSeed, seedEmptyQuestBoard } from "./questSeed";

const SEED: Array<Record<string, unknown>> = JSON.parse(
  fs.readFileSync(path.resolve(process.cwd(), "server/seeds/quests-seed.json"), "utf8"),
);

/** Two rows exactly as the seed shipped them before 2026-09-27. */
const OLD_FOOD_FOREST: QuestRecord = {
  id: "q-food-forest-tender",
  order: 2,
  title: "Food Forest Tender",
  subtitle: "Learn the land by feeding it.",
  description:
    "Assist with planting, pruning, weeding, and harvesting in our food forests and community gardens. Learn regenerative growing practices hands-on.",
  impact: "Directly grows the food that feeds the village and builds our ARI score.",
  story:
    "The food forests are the village pantry and its longest promise: a tree planted this season feeds people who have not arrived yet. Tending them puts your hands in the daily work of regeneration, with growers beside you who love to teach. Nobody leaves a session without learning at least one new plant.",
  firstStep: "Walk a food forest path and photograph three plants you cannot name yet. Bring the photos to your first session.",
  steps: [
    "Check the board or ask the agriculture circle when the next tending session runs.",
    "Show up with water, sun cover, and closed shoes. Tools live on site.",
    "Work alongside the session lead: planting, pruning, weeding, or harvesting, whatever the season asks.",
    "Log what you worked on so the next tender knows where things stand.",
  ],
  deliverable: "Photos from your session and a note on what you planted, pruned, or harvested.",
  tips: ["Morning sessions beat the heat.", "Ask why before you cut. Every pruning choice is a small design decision."],
  imageUrl: null,
  gratitude: "40-80",
  duration: "4-6 hours",
  difficulty: "Beginner",
  circle: "Regenerative Agriculture",
  status: "Open",
  icon: "Sprout",
  tags: ["land", "food", "regenerative"],
};

const OLD_NIGHT_WATCH: QuestRecord = {
  id: "q-security-night-watch",
  order: 14,
  title: "Security & Night Watch",
  subtitle: "Watch over the night.",
  description:
    "Participate in the village safety rotation-nighttime presence, gate awareness, and care for the boundary between the village and the wider world.",
  impact: "Collective safety is how all other contributions stay protected.",
  story:
    "Every open-hearted place needs people who mind the edges. Night watch is quiet, real responsibility: presence at the gate, eyes on the boundary, care for everyone sleeping inside it. The village rests because someone is awake.",
  firstStep: "Walk the property boundary once in daylight with a current watch member and learn the checkpoints.",
  steps: [
    "Take a rotation slot through the governance circle and get the handover briefing.",
    "Walk the rounds on schedule: gate, common spaces, boundary points.",
    "Log anything unusual, and wake the right person for anything urgent.",
    "Hand over clearly at the end of your shift, with notes for the next watch.",
  ],
  deliverable: "Your completed shift log with any observations passed to the next watch.",
  tips: ["A good flashlight and warm layers turn the shift from endurance into ease.", "Most of the job is being visibly, calmly there."],
  imageUrl: null,
  // The village's own pay, changed in Admin after it was seeded.
  gratitude: "75-120",
  duration: "Night shift (6-8 hrs)",
  difficulty: "Intermediate",
  circle: "Governance",
  status: "Open",
  roleRequired: "Resident or Immersant",
  icon: "ShieldCheck",
  tags: ["safety", "land", "responsibility"],
};

/** A quest the seed stopped shipping on 2026-09-26, still on the board that had it. */
const NO_LONGER_SEEDED: QuestRecord = {
  id: "q-retreat-center-host",
  order: 6,
  title: "Retreat Center Host",
  description: "Host guests at the retreat center.",
  gratitude: "80-150",
  circle: "Tourism & Retreat",
  status: "Open",
  tags: [],
};

/** A quest the village wrote for itself. */
const ITS_OWN: QuestRecord = {
  id: "q-own-seed-library",
  order: 20,
  title: "Seed Library Keeper",
  description: "Sort and label the seed library before planting season.",
  gratitude: "30-60",
  circle: "Regenerative Agriculture",
  status: "Open",
  tags: ["seeds"],
};

/**
 * What a starter quest must never say: another village's places, teams,
 * circles, rituals and scores, each as the old seed said it.
 */
const CLAIMS = [
  "our food forests",
  "ARI score",
  "The food forests are the village pantry",
  "Tools live on site",
  "the session lead",
  "a current watch member",
  "the village safety rotation",
  "the governance circle",
  "the land stewardship circle",
  "the agriculture circle",
  "the community development circle",
  "the tech circle",
  "the wellness circle",
  "the arts circle",
  "circle notes",
  "the circle meeting",
  "the current build site",
  "A core ritual of village life",
  "a village ritual",
  "village kids",
  "year two",
  "monthly",
];

/** Every claim a quest's words make, and every "we" in them. */
function claimsIn(quest: Record<string, unknown>): string[] {
  const words = JSON.stringify(quest);
  const found = CLAIMS.filter((c) => words.toLowerCase().includes(c.toLowerCase()));
  const plural = words.match(/\b(our|we|us)\b/gi) ?? [];
  return [...found, ...plural];
}

describe("the starter quests' own words", () => {
  it("still ships the thirteen quests, and none of them carries a circle", () => {
    expect(SEED).toHaveLength(13);
    expect(new Set(SEED.map((q) => q.id)).size).toBe(13);
    // A circle name on a quest is a filter chip on the board and a "More
    // from" heading: a circle the village has not formed.
    expect(SEED.filter((q) => String(q.circle ?? "").trim() !== "").map((q) => q.id)).toEqual([]);
  });

  it("say what each practice is and claim no place, team, circle or ritual for the village", () => {
    for (const q of SEED) expect(claimsIn(q), String(q.id)).toEqual([]);
  });

  it("would catch the old board's claims (the scan is not blind)", () => {
    expect(claimsIn(OLD_FOOD_FOREST as unknown as Record<string, unknown>)).toEqual(
      expect.arrayContaining(["our food forests", "ARI score", "the agriculture circle", "Tools live on site", "our"]),
    );
    expect(claimsIn(OLD_NIGHT_WATCH as unknown as Record<string, unknown>)).toEqual(
      expect.arrayContaining(["a current watch member", "the governance circle", "the village safety rotation"]),
    );
  });
});

const configured = testDbConfigured();
if (!configured) console.warn("[questSeed] TEST_DATABASE_URL not set - DB-backed tests SKIPPED.");

describe.skipIf(!configured)("the seed on a real board (MySQL)", () => {
  let db: TestDb;
  let pool: mysql.Pool;
  let repo: QuestsRepo;

  beforeAll(async () => {
    db = await provisionTestDb();
    pool = mysql.createPool({ uri: db.url, timezone: "Z", connectionLimit: 4 }); // module-review-ok: the suite's own pool onto the scratch schema it provisions and drops
    repo = questsRepo(pool);
  }, 240_000);

  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  beforeEach(async () => {
    for (const q of await repo.all()) {
      const gone = await repo.remove(q.id);
      expect(gone.ok, q.id).toBe(true);
    }
    expect(await repo.all()).toEqual([]);
  });

  it("puts the whole starter seed on a fresh village's empty board, with no circle on any quest", async () => {
    expect(await seedEmptyQuestBoard(repo, SEED)).toBe(13);
    const board = await repo.all();
    expect(board.map((q) => q.id).sort()).toEqual(SEED.map((q) => String(q.id)).sort());
    expect(board.filter((q) => q.circle).map((q) => q.id)).toEqual([]);
    const food = board.find((q) => q.id === "q-food-forest-tender")!;
    expect(food.description).toBe(SEED.find((q) => q.id === "q-food-forest-tender")!.description);
    for (const q of board) expect(claimsIn(q as unknown as Record<string, unknown>), q.id).toEqual([]);
  });

  it("leaves a village's existing board exactly as it was: nothing added, rewritten or deleted", async () => {
    for (const q of [OLD_FOOD_FOREST, OLD_NIGHT_WATCH, NO_LONGER_SEEDED, ITS_OWN]) await repo.add(q);
    const before = await repo.all();
    expect(before).toHaveLength(4);

    // The boot's first path: the seed goes only onto an empty board.
    expect(await seedEmptyQuestBoard(repo, SEED)).toBe(0);
    // The boot's second path: the story fill, matched by id, into empty fields only.
    expect(await fillQuestStoriesFromSeed(repo, SEED)).toBe(0);

    const after = await repo.all();
    expect(after).toEqual(before);
    // Said in the words that matter, so a failure reads as what it would mean.
    const food = after.find((q) => q.id === "q-food-forest-tender")!;
    expect(food.description).toContain("our food forests");
    expect(food.circle).toBe("Regenerative Agriculture");
    const watch = after.find((q) => q.id === "q-security-night-watch")!;
    expect(watch.firstStep).toContain("a current watch member");
    expect(watch.gratitude).toBe("75-120");
    expect(after.map((q) => q.id)).toEqual(expect.arrayContaining(["q-retreat-center-host", "q-own-seed-library"]));
  });

  it("fills a story field the live row left empty, and never writes over one it has", async () => {
    // A row whose subtitle and tips were cleared, and whose story was not.
    await repo.add({ ...OLD_FOOD_FOREST, subtitle: "", tips: [] });
    expect(await fillQuestStoriesFromSeed(repo, SEED)).toBe(1);
    const seeded = SEED.find((q) => q.id === "q-food-forest-tender")!;
    const food = (await repo.byId("q-food-forest-tender"))!;
    expect(food.subtitle).toBe(seeded.subtitle);
    expect(food.tips).toEqual(seeded.tips);
    // Written fields keep the row's own words, and fields the fill never reads stay too.
    expect(food.story).toBe(OLD_FOOD_FOREST.story);
    expect(food.steps).toEqual(OLD_FOOD_FOREST.steps);
    expect(food.firstStep).toBe(OLD_FOOD_FOREST.firstStep);
    expect(food.description).toBe(OLD_FOOD_FOREST.description);
    expect(food.circle).toBe("Regenerative Agriculture");
    // Once full, a second pass finds nothing to do.
    expect(await fillQuestStoriesFromSeed(repo, SEED)).toBe(0);
  });
});
