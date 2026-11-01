/**
 * THE FROZEN QUEST SEED, AND THE STARTER SET THAT REPLACED IT.
 *
 * Two promises, both about villages that are running today.
 *
 *   1. The two one-shot passes that match live quest rows to
 *      `server/seeds/quests-seed.json` by id (`backfillQuestStories` and
 *      `repairSeededQuestCopy`) never rewrite a running village's quest text
 *      because somebody reworded a seed. The file is frozen byte for byte,
 *      and the passes leave a village's own words where they are.
 *   2. The starter set a NEW village opens on (the `quests` section of the
 *      examples seed) is neutral: no sentence says what a token does, none
 *      restates pay, no reward label, and nothing one village has that
 *      another may not.
 *
 * No database: the passes take a repo, and a repo is a map here. What is
 * asserted is what they WRITE, which a map records exactly.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { QuestRecord } from "../repos/quests";
import { loadExampleSeed } from "./examples";
import {
  LEGACY_QUESTS_SEED,
  backfillQuestStories,
  copyRepairsFor,
  repairSeededQuestCopy,
} from "./legacyQuestSeed";

const SEEDS_DIR = new URL("../seeds", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const FROZEN = path.join(SEEDS_DIR, LEGACY_QUESTS_SEED);
const legacy: any[] = JSON.parse(fs.readFileSync(FROZEN, "utf-8"));
const starters: any[] = loadExampleSeed(SEEDS_DIR)?.quests?.quests ?? [];

/**
 * The frozen file's SHA-256, over LF line endings so a Windows checkout
 * (autocrlf) and CI read the same bytes. Measured on origin/main edc7d0d.
 */
const FROZEN_SHA256 = "503cc31334889ff37ac60d025ed6ef285183db782596e646a7593eac2046e48f";

/** A repo over a map, recording every write. */
function mapRepo(rows: QuestRecord[]) {
  const byId = new Map(rows.map((r) => [r.id, structuredClone(r)]));
  const writes: string[] = [];
  return {
    writes,
    rows: byId,
    async all() { return Array.from(byId.values()).map((r) => structuredClone(r)); },
    async byId(id: string) { const r = byId.get(id); return r ? structuredClone(r) : null; },
    async update(id: string, mutate: (q: QuestRecord) => void) {
      const r = byId.get(id);
      if (!r) return null;
      const next = structuredClone(r);
      mutate(next);
      writes.push(id);
      byId.set(id, next);
      return next;
    },
  };
}

/** A legacy seed entry as the old boot block wrote it to a live table. */
const asLive = (q: any): QuestRecord => ({ tags: [], order: 0, status: "open", gratitude: "", ...q });

const snapshot = (repo: ReturnType<typeof mapRepo>) =>
  JSON.stringify(Array.from(repo.rows.values()).sort((a, b) => a.id.localeCompare(b.id)));

describe("the frozen quest seed", () => {
  it("is byte for byte the file every existing village was seeded from", () => {
    const text = fs.readFileSync(FROZEN, "utf-8").replace(/\r\n/g, "\n");
    const sha = crypto.createHash("sha256").update(text).digest("hex");
    // If this fails, quests-seed.json was edited. It seeds nothing any more:
    // a new village's starters live in the `quests` section of
    // server/seeds/examples-seed.json, so change them there. This file only
    // tells the two repair passes what running villages were given.
    expect(sha, "server/seeds/quests-seed.json is frozen; edit the examples seed instead").toBe(FROZEN_SHA256);
    expect(legacy).toHaveLength(14);
  });

  it("shares no id with the starter set, so neither pass can ever reach a starter or a kept one", () => {
    const legacyIds = new Set(legacy.map((q) => String(q.id)));
    expect(starters.length).toBeGreaterThan(0);
    for (const s of starters) expect(legacyIds.has(String(s.id)), s.id).toBe(false);
  });
});

describe("the repair passes on a village seeded from the frozen file", () => {
  it("leave a village's own words alone, field by field", async () => {
    // The first tenant's shape: every seeded quest, then edited by the village.
    const rows = legacy.map(asLive);
    rows[0] = { ...rows[0], title: "Welcome Host", story: "Our own story, in our own words." };
    rows[1] = { ...rows[1], description: "Weeding on Tuesdays with whoever turns up." };
    rows[2] = { ...rows[2], steps: ["Book the hall.", "Cook."], tips: ["Bring plates."] };
    const repo = mapRepo(rows);
    const before = snapshot(repo);

    expect(await backfillQuestStories(repo, FROZEN, "test-story")).toBe(0);
    expect(await repairSeededQuestCopy(repo, FROZEN)).toBe(0);
    expect(repo.writes, "no write at all").toEqual([]);
    expect(snapshot(repo)).toBe(before);
  });

  it("would still write only the FROZEN words, never a starter's, wherever a field is empty", async () => {
    // The fill-empty contract, on the one shape it acts on: a story layer that
    // never arrived. What it writes is the August text, which is what that
    // village was seeded with, and never the neutral starter wording.
    const bare = asLive({ ...legacy[0], story: null, subtitle: "", steps: [] });
    const repo = mapRepo([bare]);
    expect(await backfillQuestStories(repo, FROZEN, "test-story")).toBe(1);
    const filled = repo.rows.get(bare.id)!;
    expect(filled.story).toBe(legacy[0].story);
    expect(filled.subtitle).toBe(legacy[0].subtitle);
    expect(filled.steps).toEqual(legacy[0].steps);
    const starterWords = new Set(starters.flatMap((s) => [s.story, s.subtitle]).filter(Boolean));
    expect(starterWords.has(filled.story)).toBe(false);
  });

  it("repair only punctuation, and refuse any field where a word changed", () => {
    const def = { title: "Circle Scribe", story: "Decisions fade, notes last." };
    expect(copyRepairsFor({ title: "Circle  Scribe!", story: "Decisions fade - notes last" }, def)).toEqual([
      ["title", "Circle Scribe"],
      ["story", "Decisions fade, notes last."],
    ]);
    expect(copyRepairsFor({ title: "Village Scribe", story: "Decisions fade. Notes stay." }, def)).toEqual([]);
  });

  it("touch nothing on a board of starters, kept or not", async () => {
    const board = starters.map((s, i) => asLive({ ...s, isExample: i % 2 === 0 }));
    const repo = mapRepo(board);
    expect(await backfillQuestStories(repo, FROZEN, "test-story")).toBe(0);
    expect(await repairSeededQuestCopy(repo, FROZEN)).toBe(0);
    expect(repo.writes).toEqual([]);
  });

  it("fail loud on a missing file, so runOnce records nothing and retries", async () => {
    const repo = mapRepo([]);
    await expect(backfillQuestStories(repo, path.join(SEEDS_DIR, "no-such-seed.json"), "t")).rejects.toThrow(/missing/);
    expect(await repairSeededQuestCopy(repo, path.join(SEEDS_DIR, "no-such-seed.json"))).toBe(0);
  });
});

/**
 * The starter set is platform language that every new village reads first,
 * held to the rulings that bind it. Words are matched whole, so "Leaf" the
 * icon and "repaid" never trip a rule they have nothing to do with.
 */
describe("the starter set", () => {
  const prose = (s: any): string[] =>
    [s.title, s.subtitle, s.description, s.impact, s.story, s.firstStep, s.deliverable, s.duration,
      ...(s.steps ?? []), ...(s.tips ?? [])].filter((v) => typeof v === "string");

  it("is a full set of complete quests, each one an example with a story a founder can read", () => {
    expect(starters.length).toBeGreaterThanOrEqual(8);
    for (const s of starters) {
      expect(String(s.id), "prove-examples.mjs finds starters by this prefix").toMatch(/^ex-quest-/);
      expect(s.isExample).toBe(true);
      for (const k of ["title", "subtitle", "description", "impact", "story", "firstStep", "deliverable", "difficulty", "circle", "icon"]) {
        expect(String(s[k] ?? "").trim(), `${s.id}.${k}`).not.toBe("");
      }
      expect((s.steps ?? []).length, `${s.id}.steps`).toBeGreaterThanOrEqual(3);
      expect((s.tips ?? []).length, `${s.id}.tips`).toBeGreaterThanOrEqual(1);
      expect(["Beginner", "Intermediate", "Advanced"]).toContain(s.difficulty);
      expect(String(s.status).toLowerCase()).toBe("open");
    }
  });

  it("carries no reward label and no value: the village sets that on the card when it keeps one", () => {
    for (const s of starters) {
      expect(s.gratitude ?? "", s.id).toBe("");
      for (const k of ["valueMinor", "valueTokens", "cashMinor", "stayCreditReward"]) {
        expect(s[k], `${s.id}.${k}`).toBeUndefined();
      }
    }
  });

  it("says nothing about what a token does and never restates pay", () => {
    const banned = /\b(pay|pays|paid|payment|earn|earns|earned|token|tokens|credit|credits|gratitude|reward|rewards|wage|wages|money|cash)\b/i;
    for (const s of starters) {
      for (const line of prose(s)) expect(line, s.id).not.toMatch(banned);
    }
  });

  it("names nothing one village has and another may not, and states no village fact", () => {
    // The first board named a retreat center, food forests, a night watch at
    // the gate and a score only one village keeps. A starter may suggest work;
    // it may not tell a village what it already has.
    const specific = /\b(retreat|food forest|night watch|gate|ARI|amora|costa rica|immersant|resident)\b/i; // brand-ok: asserts the starters carry no village name
    for (const s of starters) {
      for (const line of prose(s)) expect(line, s.id).not.toMatch(specific);
    }
  });

  it("keeps the shapes the board teaches: a first ring, a stage floor and a role gate", () => {
    expect(starters.some((s) => s.difficulty === "Beginner" && !s.minStage && !s.requiresRole)).toBe(true);
    expect(starters.some((s) => s.minStage === "member")).toBe(true);
    // `practitioners` ships in server/seeds/roles-seed.json, so the gate
    // resolves on every fresh village.
    const roles = JSON.parse(fs.readFileSync(path.join(SEEDS_DIR, "roles-seed.json"), "utf-8"));
    const gated = starters.filter((s) => s.requiresRole);
    expect(gated.length).toBeGreaterThan(0);
    for (const s of gated) expect(roles.map((r: any) => r.id), s.id).toContain(s.requiresRole);
  });
});
