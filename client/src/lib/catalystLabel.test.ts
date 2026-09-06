/**
 * The village's own word for whoever runs it, and the two pieces of grammar
 * that make it fit into a sentence.
 *
 * WHY THIS FILE EXISTS. `useCatalyst` is a hook and this suite runs in a node
 * environment with no renderer, so the hook itself cannot be exercised here.
 * What CAN be exercised is everything the hook computes, and that is where the
 * risk is: `articleFor` and `pluralFor` are heuristics over a string a founder
 * typed, and a heuristic nobody pins is a heuristic that drifts. The hook is
 * three lines of assembly over these two functions and one config read.
 *
 * IT IS A LABEL AND NOT A ROLE, which is the other half of what this file
 * records. Nothing in `shared/capabilities.ts` reads it and no gate anywhere
 * changes when a village renames it; the second describe block below asserts
 * that as a property of the source rather than as a comment, so a later lane
 * that wires a permission to this word fails here first.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { CATALYST_FALLBACK, articleFor, pluralFor } from "./gameApi";

const ROOT = path.resolve(__dirname, "../../..");

describe("the article a village's word takes", () => {
  it("says a before a consonant and an before a vowel", () => {
    expect(articleFor("Catalyst")).toBe("a");
    expect(articleFor("Founder")).toBe("a");
    expect(articleFor("Steward")).toBe("a");
    expect(articleFor("Elder")).toBe("an");
    expect(articleFor("Anchor")).toBe("an");
  });

  it("ignores case and surrounding space, because a founder types into a box", () => {
    expect(articleFor("  elder  ")).toBe("an");
    expect(articleFor("catalyst")).toBe("a");
  });

  it("answers for an empty word rather than throwing", () => {
    // A blank field is the ordinary state of this box, and the hook falls back
    // to the platform word before it ever gets here. This is the belt.
    expect(articleFor("")).toBe("a");
    expect(articleFor(undefined as unknown as string)).toBe("a");
  });
});

describe("more than one of them", () => {
  it("takes the regular plural for the words villages actually choose", () => {
    expect(pluralFor("Catalyst")).toBe("Catalysts");
    expect(pluralFor("Founder")).toBe("Founders");
    expect(pluralFor("Steward")).toBe("Stewards");
    expect(pluralFor("Elder")).toBe("Elders");
  });

  it("handles the two irregular endings that come up", () => {
    // A consonant plus y, and a sibilant. Both are common enough in this space
    // that getting them wrong would show on a real village's screen.
    expect(pluralFor("Custodian")).toBe("Custodians");
    expect(pluralFor("Ally")).toBe("Allies");
    expect(pluralFor("Witness")).toBe("Witnesses");
    expect(pluralFor("Watch")).toBe("Watches");
  });

  it("keeps a vowel before the y, where the plural is regular", () => {
    expect(pluralFor("Attorney")).toBe("Attorneys");
  });

  it("gives back a blank rather than the letter s on its own", () => {
    expect(pluralFor("")).toBe("");
    expect(pluralFor("   ")).toBe("");
  });
});

describe("the label is not a role and not a capability", () => {
  it("ships the platform's own word, which names no village", () => {
    expect(CATALYST_FALLBACK).toBe("Catalyst");
  });

  /*
   * THE PROPERTY THAT MATTERS, asserted on the capability gate itself.
   *
   * Rye's decision was explicit that this is a setting for what a village
   * calls itself and NOT a new role or a new capability. The way that could
   * quietly stop being true is a later lane reading the label somewhere a
   * decision is made. `shared/capabilities.ts` is the one gate in this
   * platform, so it is the one file that has to stay ignorant of the word.
   */
  it("is unknown to the one capability gate", () => {
    const gate = fs.readFileSync(path.join(ROOT, "shared", "capabilities.ts"), "utf8");
    expect(gate).not.toContain("catalyst");
    expect(gate).not.toContain("Catalyst");
  });

  it("is unknown to the game variables registry, which is the plane for behaviour", () => {
    // The label lives in the brand overlay (identity), not in gameVariables
    // (behaviour). A key appearing there would mean somebody had made it a
    // dial that changes what happens rather than what things are called.
    const variables = fs.readFileSync(path.join(ROOT, "shared", "gameVariables.ts"), "utf8");
    expect(variables).not.toContain("catalyst");
  });
});
