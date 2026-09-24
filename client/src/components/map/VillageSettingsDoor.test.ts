/**
 * Which door the shell answers in place, and which it still walks you through.
 *
 * The land map's dock button carries `/admin?tab=setup`, and that one opens
 * the village's colours and words over the map. Every other admin route is
 * somebody asking for the admin PAGE, and taking those over would be the
 * shell deciding it knows better than the link a person clicked.
 */
import { describe, expect, it } from "vitest";
import { isVillageSettingsRoute } from "./VillageSettingsDoor";

describe("the settings door", () => {
  it("answers the dock's own Village Settings route", () => {
    expect(isVillageSettingsRoute("/admin?tab=setup")).toBe(true);
  });

  it("does not swallow the admin page itself", () => {
    expect(isVillageSettingsRoute("/admin")).toBe(false);
    expect(isVillageSettingsRoute("/admin?tab=modules")).toBe(false);
    expect(isVillageSettingsRoute("/admin?tab=setup&x=1")).toBe(true);
  });

  it("is not fooled by a route that merely starts the same way", () => {
    expect(isVillageSettingsRoute("/administration?tab=setup")).toBe(false);
    expect(isVillageSettingsRoute("/admin/setup")).toBe(false);
    expect(isVillageSettingsRoute("//admin?tab=setup")).toBe(false);
  });

  it("answers nothing to a value that is not a route", () => {
    expect(isVillageSettingsRoute("")).toBe(false);
    expect(isVillageSettingsRoute(undefined as unknown as string)).toBe(false);
    expect(isVillageSettingsRoute("?tab=setup")).toBe(false);
  });
});
