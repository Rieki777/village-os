/**
 * The role guide's four checks (Rye, 2026-10-24), worked out by the village
 * from its own chart so they come out the same whoever answers: a domain that
 * may overlap another role, a circle accountability nobody covers, a load
 * over a full season, and the card's own limit of 3 to 6 accountabilities.
 */
import { describe, expect, it } from "vitest";
import { contentWords, guideChecks, GUIDE_CHECK_WORDS, sharesMeaning, type ChartRoleIn, type CircleIn, type GuideRoleIn } from "./roleGuideChecks";

const role = (over: Partial<GuideRoleIn> = {}): GuideRoleIn => ({
  key: "newRoles.0",
  name: "Garden Steward",
  circleId: "c-land",
  roleId: null,
  domain: "",
  accountabilities: ["Seed saving", "Compost rhythm", "Weekly harvest list"],
  time: null,
  ...over,
});

const chart: ChartRoleIn[] = [
  { id: "r-food", name: "Food Forest Lead", circleId: "c-land", domain: "the food forest planting plan and its seed bank", accountabilities: ["Planting plan for each season"] },
  { id: "r-web", name: "Front-End Steward", circleId: "c-ops", domain: "how the app looks and plays", accountabilities: ["The member interface"] },
];

const circles: CircleIn[] = [
  { id: "c-land", name: "Land Circle", accountabilities: ["Planting plan for each season", "Water for the gardens"] },
  { id: "c-ops", name: "Operations Circle", accountabilities: ["Hosting and backups"] },
];

describe("content words and shared meaning", () => {
  it("drops small and common words, and folds plurals", () => {
    expect(Array.from(contentWords("The seeds of the gardens and a plan"))).toEqual(["seed", "garden", "plan"]);
  });

  it("finds two lines that share most of their content words", () => {
    expect(sharesMeaning("the seed bank and planting plan", "the food forest planting plan and its seed bank")).toBe(true);
  });

  it("does not match lines that share only one word", () => {
    expect(sharesMeaning("water for the gardens", "the garden tools shed and its keys")).toBe(false);
  });

  it("matches a short line held wholly inside a longer one", () => {
    expect(sharesMeaning("Hosting", "Hosting and backups")).toBe(true);
  });
});

describe("the four checks", () => {
  it("flags a domain that may overlap another role, naming that role", () => {
    const flags = guideChecks({ roles: [role({ domain: "the seed bank and the planting plan" })], chart, circles });
    const overlap = flags.find((f) => f.kind === "overlap");
    expect(overlap).toMatchObject({ otherRole: "Food Forest Lead", sentence: GUIDE_CHECK_WORDS.overlap("Garden Steward", "Food Forest Lead") });
  });

  it("never flags a role against the posted role it renews", () => {
    const flags = guideChecks({ roles: [role({ roleId: "r-food", domain: "the food forest planting plan and its seed bank" })], chart, circles });
    expect(flags.filter((f) => f.kind === "overlap")).toEqual([]);
  });

  it("flags a circle accountability no role in that circle covers", () => {
    const flags = guideChecks({ roles: [role()], chart, circles });
    const uncovered = flags.filter((f) => f.kind === "uncovered");
    expect(uncovered.map((f) => (f.kind === "uncovered" ? f.accountability : ""))).toEqual(["Water for the gardens"]);
  });

  it("counts the proposal's own words as covering a circle accountability", () => {
    const flags = guideChecks({ roles: [role({ accountabilities: ["Seed saving", "Water for the gardens", "Compost"] })], chart, circles });
    expect(flags.filter((f) => f.kind === "uncovered")).toEqual([]);
  });

  it("reads a renewed role's proposed words in place of its posted ones", () => {
    const flags = guideChecks({ roles: [role({ roleId: "r-food", accountabilities: ["Seed saving", "Compost", "Water for the gardens"] })], chart, circles });
    const uncovered = flags.filter((f) => f.kind === "uncovered").map((f) => (f.kind === "uncovered" ? f.accountability : ""));
    expect(uncovered).toEqual(["Planting plan for each season"]);
  });

  it("leaves out circles none of the proposal's roles sit in", () => {
    const flags = guideChecks({ roles: [role()], chart, circles });
    expect(flags.some((f) => f.kind === "uncovered" && f.circle === "Operations Circle")).toBe(false);
  });

  it("flags a load over a full season with the load check's own sentence", () => {
    const flags = guideChecks({ roles: [role({ time: "30 hours a week" }), role({ key: "newRoles.1", name: "Kitchen Lead", time: "20 hours a week" })], chart, circles });
    const load = flags.find((f) => f.kind === "load");
    expect(load).toMatchObject({ hours: 50 });
    expect(load?.sentence).toContain("50 hours a week");
  });

  it("flags a card under 3 or over 6 accountabilities, and leaves an empty list alone", () => {
    const few = guideChecks({ roles: [role({ accountabilities: ["One"] })], chart, circles });
    expect(few.find((f) => f.kind === "limit")?.sentence).toBe(GUIDE_CHECK_WORDS.tooFew("Garden Steward", 1));
    const many = guideChecks({ roles: [role({ accountabilities: ["a1", "a2", "a3", "a4", "a5", "a6", "a7"] })], chart, circles });
    expect(many.find((f) => f.kind === "limit")?.sentence).toBe(GUIDE_CHECK_WORDS.tooMany("Garden Steward", 7));
    const none = guideChecks({ roles: [role({ accountabilities: [] })], chart, circles });
    expect(none.some((f) => f.kind === "limit")).toBe(false);
  });

  it("orders flags as limits, overlap, uncovered, then load", () => {
    const flags = guideChecks({
      roles: [role({ domain: "the seed bank and the planting plan", accountabilities: ["One"], time: "50 hours a week" })],
      chart,
      circles,
    });
    expect(flags.map((f) => f.kind)).toEqual(["limit", "overlap", "uncovered", "load"]);
  });
});
