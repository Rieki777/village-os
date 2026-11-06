/**
 * The registry page's promises, pinned.
 *
 * One: no sentence about what a token does ships from here. A token's meaning
 * is the village's own words (drizzle/0283, TokenMeaningField.tsx), per Rye's
 * 2026-10-22 ruling that platform copy never says what a token does.
 * Two: a module's token goes dark with its module, and an issued one does not
 * vanish while somebody is holding it.
 */
import { describe, expect, it } from "vitest";
import type { ModuleLifecycle } from "@shared/modules";
import * as catalog from "./tokenCatalog";
import { TOKEN_MODULES, tokenModule, tokenModuleIsOff, visibleTokens } from "./tokenCatalog";

/**
 * The eight tokens a fresh village ships, as `GET /api/admin/tokens` returns
 * them. Five seeded by migration, three registered at first server start.
 *
 * The equity row's slug is deliberately NOT the one `drizzle/0006` happens to
 * seed: that literal is one village's own name, scripts/check-brand-refs.mjs
 * fails a build that puts it in platform code, and none of the behaviour under
 * test cares what it is called.
 */
const FRESH = [
  { slug: "gratitude", name: "Gratitude", kind: "recognition", governance: "platform" },
  { slug: "credits", name: "Village Credits", kind: "credit", governance: "platform" },
  { slug: "stay-credit", name: "Stay Credits", kind: "credit", governance: "platform" },
  { slug: "library-credit", name: "Library Credits", kind: "credit", governance: "platform" },
  { slug: "village-voice", name: "Village Voice", kind: "voice", governance: "platform" },
  { slug: "earned-equity", name: "Earned Equity", kind: "equity", governance: "platform" },
  { slug: "village-equity", name: "Village Equity", kind: "equity", governance: "hypha" },
  { slug: "voice", name: "Voice", kind: "voice", governance: "hypha" },
];

const ALL_OFF: Record<string, ModuleLifecycle> = { stays: "off", library: "off" };
const ALL_ON: Record<string, ModuleLifecycle> = { stays: "members", library: "public" };

describe("what a token means", () => {
  it("is never written by the platform: the catalog carries no sentence about any token", () => {
    // The old `describeToken` and `TOKEN_NOTES[slug].what` are gone. Only
    // the module map is left, and it names modules, never what a token does.
    expect(Object.keys(catalog).sort()).toEqual(["TOKEN_MODULES", "tokenModule", "tokenModuleIsOff", "visibleTokens"]);
    expect(TOKEN_MODULES).toEqual({ "stay-credit": "stays", "library-credit": "library" });
  });
});

describe("tokenModule", () => {
  it("names a module for the two tokens a module registers, and nothing else", () => {
    expect(tokenModule("stay-credit")).toBe("stays");
    expect(tokenModule("library-credit")).toBe("library");
    for (const slug of ["gratitude", "credits", "village-voice", "earned-equity", "village-equity", "voice"]) {
      expect(tokenModule(slug), slug).toBeNull();
    }
  });
});

describe("visibleTokens", () => {
  it("shows all eight while stays and library are on", () => {
    expect(visibleTokens(FRESH, ALL_ON).map((t) => t.slug)).toEqual(FRESH.map((t) => t.slug));
  });

  it("drops a module's token while its module is off", () => {
    const shown = visibleTokens(FRESH, ALL_OFF).map((t) => t.slug);
    expect(shown).not.toContain("stay-credit");
    expect(shown).not.toContain("library-credit");
    // The six the platform always carries stay put. Hiding the equity row
    // here would take it off the one page that names it.
    expect(shown).toEqual(["gratitude", "credits", "village-voice", "earned-equity", "village-equity", "voice"]);
  });

  it("keeps a token somebody is already holding, and says its module is off", () => {
    // stays registers stay-credit at boot even with the module off, so a quest
    // reward can post and wait. That is how a village reaches this state.
    const held = FRESH.map((t) =>
      t.slug === "stay-credit" ? { ...t, issuedBy: { "sys:mint": 40 } } : t,
    );
    const shown = visibleTokens(held, ALL_OFF);
    expect(shown.map((t) => t.slug)).toContain("stay-credit");
    expect(tokenModuleIsOff(shown.find((t) => t.slug === "stay-credit")!, ALL_OFF)).toBe(true);
    // Nothing was issued in library-credit, so it stays out.
    expect(shown.map((t) => t.slug)).not.toContain("library-credit");
  });

  it("reads a module the registry has never heard of as off", () => {
    expect(visibleTokens(FRESH, {}).map((t) => t.slug)).not.toContain("stay-credit");
  });

  it("filters nothing before the modules payload arrives", () => {
    for (const lifecycles of [null, undefined]) {
      expect(visibleTokens(FRESH, lifecycles)).toHaveLength(8);
      expect(tokenModuleIsOff(FRESH[2], lifecycles)).toBe(false);
    }
  });

  it("never calls a platform token's module off", () => {
    for (const slug of ["gratitude", "credits", "village-equity"]) {
      expect(tokenModuleIsOff({ slug }, ALL_OFF), slug).toBe(false);
    }
  });
});
