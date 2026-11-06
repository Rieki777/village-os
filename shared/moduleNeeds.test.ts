import { describe, expect, it } from "vitest";
import { MODULES, MODULES_BY_ID } from "./modules";
import { SEEDS_BY_ID } from "./guilds";
import { moduleNeeds, planNeeds } from "./moduleNeeds";

describe("moduleNeeds", () => {
  it("turns every seed a module declares into a line, in guild order", () => {
    for (const m of MODULES) {
      const needs = moduleNeeds(m.guild);
      expect(needs.map((n) => n.id)).toEqual([...(m.guild ?? [])]);
    }
  });

  it("carries the catalog's own words and marks keystones", () => {
    const stays = MODULES_BY_ID.stays!;
    const needs = moduleNeeds(stays.guild);
    expect(needs.length).toBeGreaterThan(0);
    for (const n of needs) {
      const seed = SEEDS_BY_ID[n.id]!;
      expect(n.title).toBe(seed.title);
      expect(n.consequence).toBe(seed.consequence);
      expect(n.keystone).toBe(seed.risk === "keystone");
    }
  });

  it("skips an id the catalog does not hold", () => {
    expect(moduleNeeds(["no-such-seed"])).toEqual([]);
    expect(moduleNeeds(undefined)).toEqual([]);
  });
});

describe("planNeeds", () => {
  it("lists a seed two modules share once, naming both", () => {
    const stays = MODULES_BY_ID.stays!;
    const commerce = MODULES_BY_ID.commerce!;
    const shared = (stays.guild ?? []).filter((id) => (commerce.guild ?? []).includes(id));
    expect(shared.length).toBeGreaterThan(0);
    const rows = planNeeds([
      { id: "stays", name: "Stays", needs: moduleNeeds(stays.guild) },
      { id: "commerce", name: "Commerce", needs: moduleNeeds(commerce.guild) },
    ]);
    for (const id of shared) {
      const row = rows.filter((r) => r.need.id === id);
      expect(row).toHaveLength(1);
      expect(row[0]!.forModules).toEqual(["Stays", "Commerce"]);
    }
  });
});
