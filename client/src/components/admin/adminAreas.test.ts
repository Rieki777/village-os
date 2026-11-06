// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { navGroups } from "./adminNavGroups";
import { ADMIN_TABS, fallbackAdminTab, homeBaseOn, setHomeBaseOn, tabEntry, tabFromSearch } from "./adminAreas";

beforeEach(() => localStorage.clear());

describe("admin areas", () => {
  it("gives every nav tab a home, including the old mail settings address", () => {
    const keys = new Set<string>(["email-settings", "home"]);
    for (const complete of [false, true]) {
      for (const group of navGroups(complete)) {
        for (const item of group.items) keys.add(item.key);
      }
    }
    const mapped = new Set(ADMIN_TABS.map((tab) => tab.key));
    const missing = [...keys].filter((key) => !mapped.has(key));
    expect(missing, missing.join(", ")).toEqual([]);
    for (const tab of ADMIN_TABS) {
      expect(tab.help.trim().length, tab.key).toBeGreaterThan(8);
      expect(tabEntry(tab.key)?.name).toBe(tab.name);
    }
  });

  it("opens home unless this device asks for the form list, and an old tab link still wins", () => {
    expect(homeBaseOn()).toBe(true);
    expect(fallbackAdminTab()).toBe("home");
    expect(tabFromSearch("")).toBe("home");
    expect(tabFromSearch("?tab=players")).toBe("players");
    expect(tabFromSearch("?tab=modules&module=saberra")).toBe("modules");
    setHomeBaseOn(false);
    expect(tabFromSearch("")).toBe("submissions");
    expect(tabFromSearch("?tab=feedback")).toBe("feedback");
  });
});
