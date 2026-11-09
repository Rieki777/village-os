import { describe, expect, it } from "vitest";
import { CHARACTER_ROLE_IDEAS, roleIdeasFor, unmetRoleIdeas } from "./characterRoleIdeas";
import { ARCHETYPES } from "./archetypes";

describe("character role ideas", () => {
  it("gives the Catalyst investment, crowd pooling and village weaving roles", () => {
    expect(roleIdeasFor("catalyzing").map((s) => s.slug)).toEqual([
      "investment-and-partnerships",
      "crowd-pool-steward",
      "village-weaver",
    ]);
  });

  it("keys every suggestion on a real archetype key, with unique slugs and words that lead with the work", () => {
    const keys = new Set(ARCHETYPES.map((a) => a.key));
    const slugs = new Set<string>();
    for (const s of CHARACTER_ROLE_IDEAS) {
      expect(keys.has(s.archetype), s.slug).toBe(true);
      expect(slugs.has(s.slug), s.slug).toBe(false);
      slugs.add(s.slug);
      expect(s.aim.length).toBeGreaterThan(20);
      expect(s.accountabilities.length).toBeGreaterThanOrEqual(3);
    }
  });

  it("leaves out a suggestion the chart already carries, by name and whatever its case", () => {
    expect(unmetRoleIdeas("catalyzing", ["village weaver", "Gardener"]).map((s) => s.slug)).toEqual([
      "investment-and-partnerships",
      "crowd-pool-steward",
    ]);
  });
});
