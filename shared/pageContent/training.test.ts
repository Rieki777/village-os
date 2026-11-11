/**
 * The two training pages as data (shared/pageContent/training.ts).
 *
 * The lead (11 Nov 2026): community training is on both the steward and the
 * resident routes, the trainings will differ later and hold the same content
 * for now, and Admin has two different routes for them. So:
 *   - Admin, Pages lists both, each with its own address;
 *   - each address is a route the app mounts, so "Open this page" and a
 *     track's "Community training" step both land somewhere real;
 *   - the save route takes each page's own words and refuses the other's
 *     sections;
 *   - the first village's two kept copies say the same thing, apart from the
 *     name each carries on the /training chooser.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PAGE_SPECS, pageContentProblem, pageSectionKey } from "./index";
import { TRAINING_PAGES, TRAINING_PATH, TRAINING_TRACKS, isTrainingTrack, trainingPathFor } from "./training";

const app = fs.readFileSync(path.resolve(import.meta.dirname, "..", "..", "client", "src", "App.tsx"), "utf8");
const routes = new Set(Array.from(app.matchAll(/<Route\s+path="([^"]+)"/g), (m) => m[1]));
const SEEDS = path.resolve(import.meta.dirname, "..", "..", "server", "seeds", "amora", "pages"); // brand-ok: the first village's own record

describe("two training pages", () => {
  it("are both in Admin, Pages, each at its own address", () => {
    const listed = PAGE_SPECS.filter((s) => s.id.startsWith("training-"));
    expect(listed.map((s) => [pageSectionKey(s), s.path])).toEqual([
      ["page-training-steward", "/training/steward"],
      ["page-training-resident", "/training/resident"],
    ]);
    for (const t of TRAINING_TRACKS) expect(TRAINING_PAGES[t].path).toBe(trainingPathFor(t));
  });

  it("are mounted routes, beside the chooser", () => {
    for (const t of TRAINING_TRACKS) expect(routes.has(trainingPathFor(t)), trainingPathFor(t)).toBe(true);
    expect(routes.has(TRAINING_PATH)).toBe(true);
  });

  it("know their tracks and nothing else", () => {
    expect(isTrainingTrack("steward")).toBe(true);
    expect(isTrainingTrack("resident")).toBe(true);
    expect(isTrainingTrack("investor")).toBe(false);
    expect(isTrainingTrack(undefined)).toBe(false);
  });

  it("each take their own words through the save route", () => {
    expect(pageContentProblem("page-training-steward", { hero: { headline: "Ours" }, door: { title: "Stewards" } })).toBeNull();
    expect(pageContentProblem("page-training-resident", { close: { hidden: true } })).toBeNull();
    expect(pageContentProblem("page-training-steward", { hero: { headline: "x".repeat(46) } })).toMatch(/the most it holds is 45/);
    expect(pageContentProblem("page-training-steward", { hero: { hidden: true } })).toMatch(/cannot be hidden/);
  });

  it("carry different names on the chooser", () => {
    const door = (t: (typeof TRAINING_TRACKS)[number]) =>
      TRAINING_PAGES[t].sections.find((s) => s.id === "door")!.fields.find((f) => f.key === "title")!.default;
    expect(door("steward")).not.toBe(door("resident"));
  });
});

describe("the first village's two training pages", () => {
  const read = (t: string) => JSON.parse(fs.readFileSync(path.join(SEEDS, `page-training-${t}.json`), "utf8"));

  it("hold the same content for now, apart from their name on the chooser", () => {
    const { door: stewardDoor, ...steward } = read("steward");
    const { door: residentDoor, ...resident } = read("resident");
    expect(steward).toEqual(resident);
    expect(stewardDoor.title).not.toBe(residentDoor.title);
  });
});
