import { describe, it, expect } from "vitest";
import { UPSTREAM_SOURCE_URL, servedVillageSourceUrl, VILLAGE_SOURCE_URL_KEY } from "./sourceUrl";
import { VARIABLES_BY_KEY } from "./gameVariables";

describe("servedVillageSourceUrl", () => {
  it("blank means there is no village link", () => {
    expect(servedVillageSourceUrl("")).toBe("");
    expect(servedVillageSourceUrl("   ")).toBe("");
    expect(servedVillageSourceUrl(undefined)).toBe("");
  });
  it("serves an https address", () => {
    expect(servedVillageSourceUrl(" https://git.example.org/v/os ")).toBe("https://git.example.org/v/os");
  });
  it("refuses anything that is not https", () => {
    for (const bad of ["http://x.org/a", "javascript:alert(1)", "data:text/html,x", "ftp://x.org/a", "not a url", "//x.org"]) {
      expect(servedVillageSourceUrl(bad)).toBe("");
    }
  });
  it("keeps the upstream address in one constant, https", () => {
    expect(UPSTREAM_SOURCE_URL.startsWith("https://")).toBe(true);
  });
  it("is a registered village setting that defaults to blank", () => {
    const def = VARIABLES_BY_KEY[VILLAGE_SOURCE_URL_KEY];
    expect(def).toBeTruthy();
    expect(def.type).toBe("text");
    expect(def.default).toBe("");
  });
});
