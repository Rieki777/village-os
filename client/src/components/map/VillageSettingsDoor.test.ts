/**
 * Which door the shell answers in place, and which it still walks you through.
 *
 * The land map's dock button carries `/admin?tab=setup`, and that one opens
 * the village's colours and words over the map. Every other admin route is
 * somebody asking for the admin PAGE, and taking those over would be the
 * shell deciding it knows better than the link a person clicked.
 */
import { describe, expect, it } from "vitest";
import { isVillageSettingsRoute, takeSettingsDoor } from "./VillageSettingsDoor";

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

describe("who the door is answered for", () => {
  const land = () => {
    let closed = false;
    return { land: { closeDoor: () => { closed = true; } }, closed: () => closed };
  };

  it("opens the panel for a viewer who may style the land, and closes the map's own card", () => {
    const l = land();
    let opened = false;
    expect(takeSettingsDoor("/admin?tab=setup", true, l.land, () => { opened = true; })).toBe(true);
    expect(opened).toBe(true);
    expect(l.closed()).toBe(true);
  });

  /*
   * THE DEFECT THIS FILE EXISTS FOR. Intercepting a member's click answered
   * them with nothing: the panel renders null for them, so the card closed and
   * no panel took its place. The click has to travel instead.
   */
  it("lets a member's click travel, rather than intercepting it into nothing", () => {
    const l = land();
    let opened = false;
    expect(takeSettingsDoor("/admin?tab=setup", false, l.land, () => { opened = true; })).toBe(false);
    expect(opened, "no panel was opened").toBe(false);
    expect(l.closed(), "and the map's own card was left alone").toBe(false);
  });

  it("lets every other route travel, whoever is asking", () => {
    for (const may of [true, false]) {
      const l = land();
      let opened = false;
      expect(takeSettingsDoor("/admin?tab=modules", may, l.land, () => { opened = true; })).toBe(false);
      expect(opened).toBe(false);
      expect(l.closed()).toBe(false);
    }
  });

  it("still opens when the map has no card to close", () => {
    let opened = false;
    expect(takeSettingsDoor("/admin?tab=setup", true, null, () => { opened = true; })).toBe(true);
    expect(opened).toBe(true);
  });

  it("opens even when closing the card throws", () => {
    let opened = false;
    const angry = { closeDoor: () => { throw new Error("the land is busy"); } };
    expect(takeSettingsDoor("/admin?tab=setup", true, angry, () => { opened = true; })).toBe(true);
    expect(opened).toBe(true);
  });
});
