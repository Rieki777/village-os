import { describe, expect, it } from "vitest";
import { MODULE_CATALOG, MODULE_GROUPS, BUILD_A_MODULE_URL, BUILDER_GUIDE_URL } from "./moduleCatalog";
import { MODULES, MODULES_BY_ID, modulesOwning } from "./modules";
import { VARIABLES } from "./gameVariables";

/**
 * The registry and the catalog move together, and this file is what makes
 * that a build fact instead of a habit. Everything iterates over MODULES
 * itself, never over a copied list of ids, so a later lane that adds a module
 * to BOTH `MODULES` and `MODULE_CATALOG` passes untouched, and one that adds
 * to only one of the two fails with the module named.
 */
describe("moduleCatalog", () => {
  const groupIds = new Set(MODULE_GROUPS.map((g) => g.id));

  it("every registry entry has a catalog entry, a group and a setup", () => {
    for (const m of MODULES) {
      expect(MODULE_CATALOG[m.id], `module "${m.id}" has no MODULE_CATALOG entry`).toBeTruthy();
      expect(m.group, `module "${m.id}" declares no group`).toBeTruthy();
      expect(groupIds.has(m.group!), `module "${m.id}" group "${m.group}" is not a shelf`).toBe(true);
      expect(m.setup, `module "${m.id}" declares no setup`).toBeTruthy();
      expect(["none", "optional", "required"]).toContain(m.setup);
    }
  });

  it("no catalog entry points at a module that does not exist", () => {
    const known = new Set(MODULES.map((m) => m.id));
    for (const id of Object.keys(MODULE_CATALOG)) {
      expect(known.has(id), `MODULE_CATALOG["${id}"] names no registry module`).toBe(true);
    }
  });

  it("every entry carries the full card: promise, 3..5 benefits, forWhom, summaries, hue, emblem", () => {
    for (const m of MODULES) {
      const e = MODULE_CATALOG[m.id];
      expect(e.promise.trim().length, `"${m.id}" promise is empty`).toBeGreaterThan(0);
      expect(e.benefits.length, `"${m.id}" needs 3 to 5 benefits`).toBeGreaterThanOrEqual(3);
      expect(e.benefits.length, `"${m.id}" needs 3 to 5 benefits`).toBeLessThanOrEqual(5);
      for (const b of e.benefits) expect(b.trim().length).toBeGreaterThan(0);
      expect(e.forWhom.trim().length, `"${m.id}" forWhom is empty`).toBeGreaterThan(0);
      expect(e.setupSummary.trim().length, `"${m.id}" setupSummary is empty`).toBeGreaterThan(0);
      expect(e.dataSummary.trim().length, `"${m.id}" dataSummary is empty`).toBeGreaterThan(0);
      expect(Number.isInteger(e.hue) && e.hue >= 0 && e.hue < 360, `"${m.id}" hue must be 0..359`).toBe(true);
      expect(e.emblem.trim().length, `"${m.id}" emblem is empty`).toBeGreaterThan(0);
    }
  });

  it("the shelves are exactly five, ordered, unique, and none stands empty", () => {
    expect(MODULE_GROUPS.length).toBe(5);
    expect(new Set(MODULE_GROUPS.map((g) => g.id)).size).toBe(5);
    for (const g of MODULE_GROUPS) {
      expect(g.label.trim().length).toBeGreaterThan(0);
      expect(g.gloss.trim().length).toBeGreaterThan(0);
      const members = MODULES.filter((m) => m.group === g.id);
      expect(members.length, `shelf "${g.id}" holds no modules`).toBeGreaterThan(0);
    }
  });

  it("the two renamed cards read as ruled: How Power Is Held, Village Calendar", () => {
    expect(MODULES_BY_ID.map.name).toBe("How Power Is Held");
    expect(MODULE_CATALOG.map.promise).toContain("Living Map of the land");
    expect(MODULES_BY_ID.events.name).toBe("Village Calendar");
  });

  it("the calendar knobs ride the events module's variable list", () => {
    for (const key of ["calendar.year_anchor", "calendar.hemisphere", "calendar.cross_quarters"]) {
      expect(MODULES_BY_ID.events.variableKeys).toContain(key);
    }
  });

  /**
   * WHAT "NOTHING TO SET UP" COSTS WHEN IT GOES STALE.
   *
   * `setup: "none"` is a promise to a founder that the module works the
   * moment it is on, and `setupSummary` is that promise in words on the
   * catalog card. Both are written once, when a module lands with no
   * settings, and neither is recomputed when a later ruling gives it dials.
   *
   * Redemption is why these three exist. It shipped with no settings of its
   * own in #285, said "Nothing to set up to switch it on", and then took
   * fourteen dials under ruling 23 while both sentences stayed. One of those
   * dials, `redemption.process_text`, is the village's own instructions for
   * how a member actually gets paid, and it ships empty: a village that read
   * the card and switched redemption on handed every member who asked to cash
   * out nothing at all. That sentence was live on production when this was
   * written.
   *
   * These assertions are enumerations on purpose. The other modules in that
   * state may well be right, and that judgement is not a test's to make; what
   * a test can do is make the set VISIBLE, so a module that joins it has to be
   * looked at by a person instead of arriving silently.
   */
  const ownedDials = (id: string) => VARIABLES.filter((v) => modulesOwning(v.key).includes(id));

  it("a module that carries a legal card never claims there is nothing to set up", () => {
    // The funds-bearing four. Money reaches a member through settings a
    // village has to decide, so "nothing to set up" cannot be true of one of
    // them, whatever its dials happen to be called this month.
    const funded = MODULES.filter((m) => m.legalReview).map((m) => m.id);
    expect(funded.sort()).toEqual(["commerce", "exchange", "redemption", "stays"]);
    for (const m of MODULES) {
      if (!m.legalReview) continue;
      expect(
        m.setup,
        `"${m.id}" ships a legal card and still says setup "none"`,
      ).not.toBe("none");
    }
  });

  it("pins every module that says `setup: none` while owning dials", () => {
    const claiming = MODULES.filter((m) => m.setup === "none" && ownedDials(m.id).length > 0)
      .map((m) => m.id)
      .sort();
    /*
     * Measured on main 2f91c93, redemption included. Every one of these owns
     * dials whose defaults are a working village: the module does what its
     * card says on the day it is switched on, and the dials are there for a
     * village that wants something other than the default. That is what makes
     * "nothing to set up" true for them and false for redemption, which is off
     * this list because it is now `required`.
     *
     * Ownership is `modulesOwning`, never `variableKeys`: progression lists no
     * keys and owns twenty-six by namespace, so the shorter question would
     * have missed it.
     */
    expect(claiming).toEqual([
      "events", "feed", "forum", "governance", "gratitude",
      "introductions", "messaging", "progression", "quests",
    ]);
  });

  it("pins the modules that say `setup: none` while shipping a dial with no value", () => {
    const blank = MODULES.filter(
      (m) => m.setup === "none" && ownedDials(m.id).some((v) => v.default.trim() === ""),
    ).map((m) => m.id);
    /*
     * The narrower question, and the one redemption failed hardest: a dial
     * that ships empty is a decision nobody has made yet.
     *
     * `governance.hub_url` is the one honest case. Empty there MEANS no hub,
     * every reader treats it as off, and the default is blank precisely so a
     * fork does not inherit somebody else's relay. Redemption's three were not
     * that: `process_text` empty shows a member no card at all.
     */
    expect(blank).toEqual(["governance"]);
  });

  it("the builder links point into the upstream repository's module docs", () => {
    expect(BUILD_A_MODULE_URL.startsWith("https://")).toBe(true);
    expect(BUILD_A_MODULE_URL.endsWith("/BUILDING_A_MODULE.md")).toBe(true);
    // Same repository, same directory: only the final file name differs.
    expect(BUILD_A_MODULE_URL.replace(/[^/]+$/, "")).toBe(BUILDER_GUIDE_URL.replace(/[^/]+$/, ""));
  });
});
