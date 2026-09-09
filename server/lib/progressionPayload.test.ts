/**
 * The served ladder says this village's words, and never the platform's stencil.
 *
 * WHY THIS FILE EXISTS. `GAME_CONFIG` is a static literal evaluated at module
 * load, so a string in it cannot read a database value in place. The member
 * rung's description and the membership next-action carry `{commitment}`, and
 * the village's own word for what a member signs arrives from
 * `brand.project.commitmentName` at request time. That means the substitution
 * happens where the payload is built, and a payload built without it ships the
 * literal `{commitment}` to a member.
 *
 * A MISSED SUBSTITUTION IS EXACTLY THE KIND OF THING NOTHING ELSE CATCHES. It
 * type-checks, every gate passes, and the string is still a string. The only
 * thing that can notice is an assertion that looks at the built payload.
 *
 * THE CONTROL IS THE LOAD-BEARING PART. A sweep for braces over a payload that
 * never had any would pass forever and prove nothing, which is the silent-zero
 * defect this repository keeps finding in other clothes. So the first test
 * asserts the SOURCE still carries a placeholder. If somebody removes the last
 * one, that test fails and says the sweep below has stopped meaning anything,
 * rather than the suite going quietly green over an empty set.
 */
import { describe, expect, it } from "vitest";
import { GAME_CONFIG, withCommitmentName } from "../../shared/gameConfig";
import { servedLadder } from "./progressionPayload";

/** Every string in a payload, however deeply nested. */
function strings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(strings);
  if (value && typeof value === "object") return Object.values(value).flatMap(strings);
  return [];
}

describe("the village's own word for what a member signs", () => {
  it("CONTROL: the platform config still carries a placeholder to substitute", () => {
    // Without this, every assertion below passes over an empty set.
    const placeholders = [
      ...strings(GAME_CONFIG.stages),
      ...strings(GAME_CONFIG.nextActions),
    ].filter((s) => s.includes("{commitment}"));
    expect(
      placeholders.length,
      "no string carries {commitment} any more, so the sweeps below check nothing",
    ).toBeGreaterThan(0);
  });

  it("puts the village's word into the ladder", () => {
    const ladder = servedLadder("Love Letter");
    const member = ladder.find((s) => s.id === "member");
    expect(member?.description).toContain("Love Letter");
  });

  it("leaves no placeholder anywhere in the served ladder", () => {
    const leaked = strings(servedLadder("Love Letter")).filter((s) => s.includes("{"));
    expect(leaked, "a member would read this brace on their own profile").toEqual([]);
  });

  it("serves the PLATFORM word when a village has not set one", () => {
    // Blank is a legitimate state: `pick()` falls back to the platform default,
    // so what reaches this function is already resolved and never empty.
    const ladder = servedLadder(GAME_CONFIG.project.commitmentName);
    const member = ladder.find((s) => s.id === "member");
    expect(member?.description).toContain("membership agreement");
    expect(member?.description).not.toContain("{");
  });

  it("substitutes every occurrence, not only the first", () => {
    // Cheap to get wrong with a non-global replace, and invisible until a
    // village writes a sentence that names the thing twice.
    expect(withCommitmentName("{commitment} and {commitment}", "Pact")).toBe("Pact and Pact");
  });

  it("leaves a string with no placeholder exactly as it was", () => {
    const plain = "Completed a first quest for the village.";
    expect(withCommitmentName(plain, "Love Letter")).toBe(plain);
  });
});
