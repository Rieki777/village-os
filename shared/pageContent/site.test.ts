import { describe, expect, it } from "vitest";
import { SITE_PAGE } from "./site";
import { NAV, isGroup } from "../../client/src/config/nav";

describe("the Whole site spec's default page names", () => {
  it("match what the menu shows today, so a village that changes nothing sees nothing change", () => {
    const list = SITE_PAGE.sections.find((s) => s.id === "menu")!.lists![0];
    const navByHref = new Map<string, { label: string; subtitle?: string }>();
    for (const entry of NAV) for (const item of isGroup(entry) ? entry.items : [entry]) navByHref.set(item.href, item);
    list.fixed!.forEach((href, i) => {
      const nav = navByHref.get(href);
      const row = list.default[i];
      if (href === "/love-letter") {
        expect(row.label).toBe("Sign the {commitment}");
        return;
      }
      if (!nav) return; // not in the menu (it is reached from a page); the name is still the village's
      expect(row.label, href).toBe(nav.label.replace(/^\S+\s(?=Command Centre)/u, ""));
      expect(row.subtitle ?? "", href).toBe(nav.subtitle ?? "");
    });
  });
});
