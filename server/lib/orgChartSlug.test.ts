/**
 * The three slugs in server/lib/orgChart.ts, and the dashes that used to cost
 * time in the square of their length.
 *
 * THE DEFECT. `documentedKey`, `agentKeySlug` and `createOrgRole` each collapsed
 * a typed name to dashes and then trimmed with `/^-+|-+$/g`. That trim alternates
 * two greedy runs of the same character, so a name carrying many dashes
 * backtracks: CodeQL alerts #14, #15 and #16, js/polynomial-redos, all HIGH, all
 * on strings a person supplies. A documented holder's name and a seat's name both
 * arrive from an admin form, and `createOrgRole` takes a vendor's string through
 * the review queue.
 *
 * The assertions are about BEHAVIOUR first: the new one-pass slug has to answer
 * exactly what the old one answered, because these values are stored keys.
 * `holder_key` collisions are how one person's card lands on another person's
 * seat, so a slug that changed its mind about trailing dashes would be a data
 * defect wearing a performance fix.
 *
 * The timing case is last and its budget is deliberately loose. The point is the
 * difference between linear and quadratic, not a millisecond count on one
 * machine: the old spelling took tens of seconds on the input below.
 */
import { describe, expect, it } from "vitest";
import { agentKeySlug, documentedKey } from "./orgChart";

/** What the old spelling produced, kept as the definition of "unchanged". */
function previousSpelling(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const NAMES = [
  "Alex",
  "  Alex  ",
  "Alex Rivera",
  "ALEX RIVERA",
  "alex--rivera",
  "--alex--",
  "-",
  "---",
  "",
  "   ",
  "Ana-Maria O'Brien",
  "Water Steward (interim)",
  "a",
  "7",
  "café crème",
  "北の円",
  "Alex_Rivera.2",
];

describe("the slug every org key is built from", () => {
  it("answers exactly what the old spelling answered", () => {
    for (const name of NAMES) {
      expect(documentedKey(name), `documentedKey(${JSON.stringify(name)})`).toBe(
        `doc:${previousSpelling(name) || "unnamed"}`,
      );
    }
  });

  it("keeps the unnamed fallback, which is what stops an empty key", () => {
    expect(documentedKey("")).toBe("doc:unnamed");
    expect(documentedKey("   ")).toBe("doc:unnamed");
    expect(documentedKey("---")).toBe("doc:unnamed");
    expect(documentedKey("!!!")).toBe("doc:unnamed");
  });

  it("still strips the agent prefix after lowercasing, in that order", () => {
    // The order matters and is easy to lose in a refactor: an uppercase prefix
    // has to go too, or an agent named "AGENT:Willow" keeps a colon in a key
    // that is compared against "willow".
    expect(agentKeySlug("agent:Willow")).toBe("willow");
    expect(agentKeySlug("AGENT:Willow")).toBe("willow");
    expect(agentKeySlug("  Agent:Willow Keeper  ")).toBe("willow-keeper");
    expect(agentKeySlug("Willow")).toBe("willow");
  });

  it("gives an agent and a documented human two different keys", () => {
    // The reason `agentKeySlug` exists at all: same holder_kind, same name,
    // and they must not collide on one seat.
    expect(`doc:${agentKeySlug("Willow")}`).toBe(documentedKey("Willow"));
    expect(agentKeySlug("agent:Willow")).not.toBe(documentedKey("Willow"));
  });

  it("answers a dash-heavy name quickly, which is the alert itself", () => {
    const pathological = `${"-".repeat(50_000)}x`;
    const started = Date.now();
    expect(documentedKey(pathological)).toBe("doc:x");
    expect(agentKeySlug(pathological)).toBe("x");
    expect(
      Date.now() - started,
      "the old spelling took tens of seconds on this input",
    ).toBeLessThan(2000);
  });
});
