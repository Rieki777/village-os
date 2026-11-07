/**
 * HOW MANY CHANGES ONE PROPOSAL MAY CARRY, as a village dial (Rye,
 * 2026-11-06): the cap moves from 12 to 22, and each village may move it by
 * vote, between a floor and a ceiling written here in code.
 */
import { describe, expect, it } from "vitest";
import {
  CHANGE_SET_CAP_DEFAULT,
  CHANGE_SET_CAP_KEY,
  CHANGE_SET_CAP_MAX,
  CHANGE_SET_CAP_MIN,
  changeSetCapFrom,
} from "./changeSetCap";
import { VARIABLES_BY_KEY, validateVariable } from "./gameVariables";
import { isMetaSetting, metaSettingTrialRefusal } from "./ballotSubjects";

describe("the change-set cap dial", () => {
  it("defaults to 22, inside a floor of 1 and a ceiling of 50", () => {
    expect(CHANGE_SET_CAP_DEFAULT).toBe(22);
    expect(CHANGE_SET_CAP_MIN).toBe(1);
    expect(CHANGE_SET_CAP_MAX).toBe(50);
  });

  it("is a registered governance dial whose bounds are the code's floor and ceiling", () => {
    const def = VARIABLES_BY_KEY[CHANGE_SET_CAP_KEY];
    expect(def).toBeDefined();
    expect(def.category).toBe("Governance");
    expect(def.type).toBe("integer");
    expect(def.default).toBe(String(CHANGE_SET_CAP_DEFAULT));
    expect(def.min).toBe(CHANGE_SET_CAP_MIN);
    expect(def.max).toBe(CHANGE_SET_CAP_MAX);
    // Open to the village's vote: no founder ring (Article 0).
    expect(def.ring ?? "open").not.toBe("founder");
  });

  it("refuses a stored value outside the floor and the ceiling", () => {
    const def = VARIABLES_BY_KEY[CHANGE_SET_CAP_KEY];
    expect(validateVariable(def, "0")).not.toBeNull();
    expect(validateVariable(def, "51")).not.toBeNull();
    expect(validateVariable(def, "1")).toBeNull();
    expect(validateVariable(def, "50")).toBeNull();
  });

  it("is priced as structural, since it shapes how every other change is read", () => {
    expect(VARIABLES_BY_KEY[CHANGE_SET_CAP_KEY].criticality).toBe("structural");
  });

  it("is a meta setting, so it is never tried for a moon at a lower bar", () => {
    expect(isMetaSetting(CHANGE_SET_CAP_KEY)).toBe(true);
    expect(metaSettingTrialRefusal(CHANGE_SET_CAP_KEY)).not.toBeNull();
  });

  it("reads any stored value back inside the bounds, and garbage as the default", () => {
    expect(changeSetCapFrom(22)).toBe(22);
    expect(changeSetCapFrom(0)).toBe(CHANGE_SET_CAP_MIN);
    expect(changeSetCapFrom(-4)).toBe(CHANGE_SET_CAP_MIN);
    expect(changeSetCapFrom(999)).toBe(CHANGE_SET_CAP_MAX);
    expect(changeSetCapFrom(7.9)).toBe(7);
    expect(changeSetCapFrom(Number.NaN)).toBe(CHANGE_SET_CAP_DEFAULT);
    expect(changeSetCapFrom(undefined)).toBe(CHANGE_SET_CAP_DEFAULT);
    expect(changeSetCapFrom("12")).toBe(12);
  });
});
