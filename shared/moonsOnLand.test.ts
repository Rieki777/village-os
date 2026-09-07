import { describe, expect, it } from "vitest";
import { moonsOnLandPhrase } from "./villageMoon";

describe("moonsOnLandPhrase", () => {
  it("says one moon in the singular, which is the bug that shipped", () => {
    expect(moonsOnLandPhrase(1)).toBe("1 moon on the land");
  });
  it("names the state at zero rather than counting to it", () => {
    expect(moonsOnLandPhrase(0)).toBe("New on the land");
  });
  it("pluralises everything above one", () => {
    expect(moonsOnLandPhrase(2)).toBe("2 moons on the land");
    expect(moonsOnLandPhrase(47)).toBe("47 moons on the land");
  });
  it("says nothing at all when the count is unknown", () => {
    expect(moonsOnLandPhrase(null)).toBe("");
    expect(moonsOnLandPhrase(undefined)).toBe("");
    expect(moonsOnLandPhrase(Number.NaN)).toBe("");
  });
  it("refuses a negative rather than printing one", () => {
    expect(moonsOnLandPhrase(-3)).toBe("");
  });
});
