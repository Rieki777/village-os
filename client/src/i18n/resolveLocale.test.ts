import { describe, expect, it } from "vitest";
import { matchLocale, resolveLocale } from "./resolveLocale";

const SUPPORTED = ["en", "es", "ar", "he", "pt-BR", "pt-PT", "zh-Hans", "zh-Hant", "sr", "fr", "nb"];

describe("matchLocale: one preferred tag against the supported set", () => {
  it.each([
    ["es", "es"],
    ["es-CR", "es"],
    ["ES-cr", "es"],
    ["es_CR", "es"],
    ["pt", "pt-BR"],
    ["pt-BR", "pt-BR"],
    ["pt-PT", "pt-PT"],
    ["pt-AO", "pt-PT"],
    ["zh-TW", "zh-Hant"],
    ["zh-HK", "zh-Hant"],
    ["zh-CN", "zh-Hans"],
    ["zh", "zh-Hans"],
    ["zh-Hant-TW", "zh-Hant"],
    ["iw", "he"],
    ["iw-IL", "he"],
    ["sr-Latn-RS", "sr"],
    ["fr-CA", "fr"],
    ["no", "nb"],
    ["no-NO", "nb"],
    ["nb-NO", "nb"],
  ])("%s -> %s", (pref, want) => {
    expect(matchLocale(pref, SUPPORTED)).toBe(want);
  });

  it.each(["", "und", "x-private", "*", "not a tag!!", "de", "123"])("%s matches nothing", (pref) => {
    expect(matchLocale(pref, SUPPORTED)).toBeNull();
  });
});

describe("resolveLocale: the order of the sources (US1.1)", () => {
  const base = { supported: SUPPORTED, saved: null, browser: [] as string[], villageDefault: null };

  it("the saved choice wins over everything", () => {
    expect(resolveLocale({ ...base, saved: "ar", browser: ["es-CR"], villageDefault: "fr" })).toBe("ar");
  });
  it("a saved choice that is no longer supported is skipped, not trusted", () => {
    expect(resolveLocale({ ...base, saved: "de", browser: ["es-CR"] })).toBe("es");
  });
  it("then the browser's languages, in order, skipping unsupported ones", () => {
    expect(resolveLocale({ ...base, browser: ["de-DE", "fr-CA", "es"] })).toBe("fr");
  });
  it("then the village default", () => {
    expect(resolveLocale({ ...base, browser: ["de-DE"], villageDefault: "es" })).toBe("es");
  });
  it("then English", () => {
    expect(resolveLocale({ ...base, browser: ["de-DE"], villageDefault: "xx" })).toBe("en");
    expect(resolveLocale(base)).toBe("en");
  });
  it("English in the browser list counts as a real preference", () => {
    expect(resolveLocale({ ...base, browser: ["en-GB", "es"], villageDefault: "es" })).toBe("en");
  });
});
