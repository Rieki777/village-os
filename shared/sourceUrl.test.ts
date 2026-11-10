import { describe, it, expect } from "vitest";
import { DEFAULT_SOURCE_URL, servedSourceUrl, SOURCE_URL_KEY } from "./sourceUrl";
import { VARIABLES_BY_KEY } from "./gameVariables";

describe("servedSourceUrl", () => {
  it("blank means the public repository", () => {
    expect(servedSourceUrl("")).toBe(DEFAULT_SOURCE_URL);
    expect(servedSourceUrl("   ")).toBe(DEFAULT_SOURCE_URL);
    expect(servedSourceUrl(undefined)).toBe(DEFAULT_SOURCE_URL);
  });
  it("serves an http or https address", () => {
    expect(servedSourceUrl(" https://git.example.org/v/os ")).toBe("https://git.example.org/v/os");
  });
  it("drops anything else", () => {
    for (const bad of ["javascript:alert(1)", "data:text/html,x", "ftp://x.org/a", "not a url", "//x.org"]) {
      expect(servedSourceUrl(bad)).toBe(DEFAULT_SOURCE_URL);
    }
  });
  it("is a registered village setting that defaults to blank", () => {
    const def = VARIABLES_BY_KEY[SOURCE_URL_KEY];
    expect(def).toBeTruthy();
    expect(def.type).toBe("text");
    expect(def.default).toBe("");
  });
});
