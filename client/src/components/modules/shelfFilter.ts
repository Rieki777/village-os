/**
 * THE SHELF'S FILTERS, moved from the retired admin Module Library tab.
 *
 * Search always; state ("On here" / "Not on yet") for a signed-in reader, who
 * is the only one told what this village runs; tier, domain and price only
 * once the catalog holds more than one answer for them, so a library of free
 * included modules is not given three dropdowns that can only return
 * everything. Pure, so it is tested without rendering the page.
 */
import type { CatalogModule } from "./ModuleCard";

export interface ShelfFilters {
  query: string;
  state: "all" | "on" | "off";
  tier: string;
  domain: string;
  price: "all" | "free" | "paid";
}

export const NO_FILTERS: ShelfFilters = { query: "", state: "all", tier: "all", domain: "all", price: "all" };

/** On here, for whoever is reading: core always, otherwise anything served. */
export function isOnHere(m: CatalogModule): boolean {
  return m.core || !!m.on || (!!m.lifecycle && m.lifecycle !== "off");
}

const paid = (m: CatalogModule) => !!m.priceLine && m.priceLine !== "Free";

export function filterShelf(all: readonly CatalogModule[], f: ShelfFilters): CatalogModule[] {
  const needle = f.query.trim().toLowerCase();
  return all.filter((m) => {
    if (needle) {
      const hay = [m.name, m.description, m.id, m.provides, m.card?.promise].filter(Boolean).join(" ").toLowerCase();
      if (!hay.includes(needle)) return false;
    }
    if (f.state === "on" && !isOnHere(m)) return false;
    if (f.state === "off" && isOnHere(m)) return false;
    if (f.tier !== "all" && m.tier !== f.tier) return false;
    if (f.domain !== "all" && (m.provides ?? "") !== f.domain) return false;
    if (f.price !== "all" && (paid(m) ? "paid" : "free") !== f.price) return false;
    return true;
  });
}

export const isFiltered = (f: ShelfFilters) =>
  f.query.trim() !== "" || f.state !== "all" || f.tier !== "all" || f.domain !== "all" || f.price !== "all";

/** The answers a filter could give, so it only appears when it can narrow anything. */
export function filterChoices(all: readonly CatalogModule[]) {
  const distinct = (pick: (m: CatalogModule) => string | null | undefined) =>
    Array.from(new Set(all.map(pick).filter((v): v is string => !!v))).sort();
  return {
    tiers: distinct((m) => m.tier),
    domains: distinct((m) => m.provides ?? null),
    prices: distinct((m) => (paid(m) ? "paid" : "free")),
  };
}
