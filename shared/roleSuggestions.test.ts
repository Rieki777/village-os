import { describe, expect, it } from "vitest";
import { suggestRoles, type SuggestRoleIn } from "./roleSuggestions";

const roles: SuggestRoleIn[] = [
  { id: "orchard", name: "Orchard keeper", about: "The orchard and the fruit trees", open: false },
  { id: "water", name: "Water keeper", about: "The water tanks", open: true },
  { id: "seed", name: "Seed keeper", about: "The seed bank and the planting", open: true },
  { id: "kitchen", name: "Kitchen keeper", about: "The kitchen and the bread oven", open: false },
  { id: "gate", name: "Gate keeper", about: "The gate and the visitors", open: false },
];

describe("roles ranked from the member's words", () => {
  it("suggests about three, open roles first, each with the sentence it came from", () => {
    const out = suggestRoles(
      {
        love: "I love the seed bank and the planting.",
        offer: "I would offer bread from the oven.",
        why: "The water tanks need a keeper.",
      },
      roles,
    );
    expect(out.length).toBeGreaterThan(0);
    expect(out.length).toBeLessThanOrEqual(3);
    const firstClosed = out.findIndex((r) => !r.open);
    const lastOpen = out.map((r) => r.open).lastIndexOf(true);
    expect(lastOpen).toBeGreaterThanOrEqual(0);
    if (firstClosed >= 0) expect(lastOpen).toBeLessThan(firstClosed);
    expect(out.find((r) => r.id === "seed")?.source).toBe("I love the seed bank and the planting.");
    expect(out.find((r) => r.id === "water")?.source).toBe("The water tanks need a keeper.");
  });

  it("is empty when the answers are empty, and when nothing on the chart matches", () => {
    expect(suggestRoles({ love: "", offer: "  ", why: "" }, roles)).toEqual([]);
    expect(suggestRoles({ love: "Poems at dusk", offer: "", why: "" }, roles)).toEqual([]);
    expect(suggestRoles({ love: "I love the seed bank", offer: "", why: "" }, [])).toEqual([]);
  });

  it("names no holder: the suggestion is the role and the member's sentence", () => {
    const out = suggestRoles({ love: "I love the seed bank.", offer: "", why: "" }, [
      { id: "seed", name: "Seed keeper", about: "The seed bank", open: true },
    ]);
    expect(out).toEqual([{ id: "seed", name: "Seed keeper", open: true, source: "I love the seed bank." }]);
    expect(Object.keys(out[0]).sort()).toEqual(["id", "name", "open", "source"]);
    expect(JSON.stringify(out)).not.toMatch(/holder|Pat Example/i);
  });

  it("keeps an answer written in another language, and can match a role named in it", () => {
    const love = "Me encanta el horno y el pan.";
    const out = suggestRoles({ love, offer: "パンと窯", why: "" }, [
      { id: "pan", name: "パン係", about: "窯", open: true },
      { id: "en", name: "Baker", about: "Bread", open: false },
    ]);
    expect(out.map((r) => r.id)).toEqual(["pan"]);
    expect(out[0].source).toBe("パンと窯");
    expect(love).toBe("Me encanta el horno y el pan.");
  });
});
