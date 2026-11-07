import { describe, expect, it } from "vitest";
import { directionOf } from "./i18nDirection";

describe("directionOf", () => {
  it.each(["ar", "he", "fa", "ur", "ar-EG", "ps", "yi", "dv", "ckb", "ar-XB"])("%s is rtl", (tag) => {
    expect(directionOf(tag)).toBe("rtl");
  });
  it.each(["en", "es", "es-CR", "zh-Hant", "ja", "sr", "en-XA", "", "garbage!!"])("%s is ltr", (tag) => {
    expect(directionOf(tag)).toBe("ltr");
  });
});
