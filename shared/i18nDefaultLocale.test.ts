import { describe, expect, it } from "vitest";
import { VARIABLES_BY_KEY, ringOf } from "./gameVariables";
import { offeredLocaleTags } from "./i18nLocales";

describe("village.default_locale (spec i18n US3, C8)", () => {
  const def = VARIABLES_BY_KEY["village.default_locale"];

  it("is a dial whose choices are exactly the offered languages, English by default", () => {
    expect(def).toBeTruthy();
    expect(def.type).toBe("choice");
    expect(def.default).toBe("en");
    expect(def.choices?.map((c) => c.value)).toEqual(offeredLocaleTags());
  });

  it("is open-ring, so any member may propose it and a vote can change it (I.3, 0.1)", () => {
    expect(ringOf(def)).toBe("open");
  });

  it("labels each choice in its own language", () => {
    expect(def.choices?.find((c) => c.value === "es")?.label).toBe("Español");
    expect(def.choices?.find((c) => c.value === "en")?.label).toBe("English");
  });
});
