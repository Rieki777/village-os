import { describe, expect, it } from "vitest";
import { filterChoices, filterShelf, isOnHere, NO_FILTERS } from "./shelfFilter";
import type { CatalogModule } from "./ModuleCard";

const mod = (id: string, over: Partial<CatalogModule> = {}): CatalogModule => ({
  id,
  name: id,
  description: `${id} module`,
  core: false,
  tier: "included",
  dataClass: "none",
  group: "coordinate",
  setup: "none",
  requires: [],
  recommends: [],
  legalReview: false,
  withdrawn: null,
  priceLine: null,
  pool: null,
  support: null,
  card: null,
  imageUrl: null,
  ...over,
});

const shelf = [
  mod("quests", { core: true }),
  mod("forum", { on: true }),
  mod("tools", { lifecycle: "preview" }),
  mod("stays"),
  mod("saberra", { tier: "connected", priceLine: "$10.00 a month" }),
];

describe("filterShelf", () => {
  it("shows everything with no filter", () => {
    expect(filterShelf(shelf, NO_FILTERS)).toHaveLength(5);
  });

  it("splits on here from not on yet, counting core and a steward's preview as on", () => {
    expect(filterShelf(shelf, { ...NO_FILTERS, state: "on" }).map((m) => m.id)).toEqual(["quests", "forum", "tools"]);
    expect(filterShelf(shelf, { ...NO_FILTERS, state: "off" }).map((m) => m.id)).toEqual(["stays", "saberra"]);
    expect(isOnHere(mod("x", { lifecycle: "off" }))).toBe(false);
  });

  it("filters on tier and on price, and searches the name and description", () => {
    expect(filterShelf(shelf, { ...NO_FILTERS, tier: "connected" }).map((m) => m.id)).toEqual(["saberra"]);
    expect(filterShelf(shelf, { ...NO_FILTERS, price: "paid" }).map((m) => m.id)).toEqual(["saberra"]);
    expect(filterShelf(shelf, { ...NO_FILTERS, query: "STAYS mod" }).map((m) => m.id)).toEqual(["stays"]);
  });

  it("only offers a filter that can narrow something", () => {
    const c = filterChoices(shelf);
    expect(c.tiers).toEqual(["connected", "included"]);
    expect(c.domains).toEqual([]);
    expect(c.prices).toEqual(["free", "paid"]);
  });
});
