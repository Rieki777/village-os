/**
 * What a token means is the village's own words (0283), judged before the
 * route writes anything. The route itself is driven end to end in
 * server/adminTokens.e2e.test.ts; this holds the judgement on its own.
 */
import { describe, expect, it } from "vitest";
import { TOKEN_DESCRIPTION_MAX, tokenDescriptionProblem } from "./tokenMeaning";

describe("a token's description", () => {
  it("takes words, blank and absent alike, up to what the column holds", () => {
    expect(tokenDescriptionProblem("What we pay each other in.")).toBeNull();
    expect(tokenDescriptionProblem("")).toBeNull();
    expect(tokenDescriptionProblem("   ")).toBeNull();
    expect(tokenDescriptionProblem(null)).toBeNull();
    expect(tokenDescriptionProblem(undefined)).toBeNull();
    expect(tokenDescriptionProblem("x".repeat(TOKEN_DESCRIPTION_MAX))).toBeNull();
  });

  it("measures the trimmed words, so spaces around them never refuse a description that fits", () => {
    expect(tokenDescriptionProblem(`  ${"x".repeat(TOKEN_DESCRIPTION_MAX)}  `)).toBeNull();
    expect(tokenDescriptionProblem("x".repeat(TOKEN_DESCRIPTION_MAX + 1))).toMatch(/at most 600 characters; this one is 601/);
  });

  it("refuses anything that is not words", () => {
    expect(tokenDescriptionProblem(7)).toMatch(/words/);
    expect(tokenDescriptionProblem({ text: "hi" })).toMatch(/words/);
    expect(tokenDescriptionProblem(["hi"])).toMatch(/words/);
  });
});
