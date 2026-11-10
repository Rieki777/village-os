// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { limitNav, simpleNav, showEverything, weekKey } from "./adminFeelState";
import type { NavGroup } from "./adminNavGroups";

beforeEach(() => localStorage.clear());

const groups = [
  { title: "Today", items: [{ key: "home", label: "Home", icon: null }] },
  { title: "Day to day", items: [{ key: "submissions", label: "Forms", icon: null }, { key: "players", label: "Players", icon: null }] },
] as unknown as NavGroup[];

describe("steward view", () => {
  it("starts a steward on Today and Inbox, and an admin sees every tab", () => {
    expect(simpleNav("member")).toBe(true);
    expect(simpleNav("admin")).toBe(false);
    expect(limitNav(groups, true).flatMap((g) => g.items.map((i) => i.key))).toEqual(["home", "submissions"]);
    showEverything();
    expect(simpleNav("member")).toBe(false);
    expect(limitNav(groups, false)).toBe(groups);
  });

  it("names the week from Monday", () => {
    expect(weekKey(new Date(2026, 10, 4))).toBe("2026-11-02");
  });
});
