/**
 * `{tokens}`, the umbrella word (Rye, 2026-10-23: "Village Tokens is the
 * umbrella word, which should be able to be set in admin"). The server serves
 * it as `currency.collectiveName`; a page field says `{tokens}` and gets the
 * village's word, or Rye's own default while none is set.
 */
import { describe, expect, it } from "vitest";
import { fillVars } from "./resolve";
import { pageVarsFrom } from "./vars";

describe("the {tokens} word", () => {
  it("is the village's umbrella word for all its tokens", () => {
    const words = pageVarsFrom({ currency: { name: "Seeds", collectiveName: "Seed Bank" } });
    expect(fillVars("Earn {tokens} for your work", words)).toBe("Earn Seed Bank for your work");
    // The recognition token's own name is a separate word and did not move.
    expect(words.token).toBe("Seeds");
  });

  it("is Village Tokens until the village sets one, a blank included", () => {
    expect(pageVarsFrom({}).tokens).toBe("Village Tokens");
    expect(pageVarsFrom({ currency: { collectiveName: "   " } }).tokens).toBe("Village Tokens");
  });
});
