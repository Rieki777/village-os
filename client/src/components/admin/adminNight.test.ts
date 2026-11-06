// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { adminRootClass, readAdminNight, writeAdminNight, ADMIN_NIGHT_KEY } from "./adminNight";

beforeEach(() => localStorage.clear());

describe("admin night look", () => {
  it("stays off until someone turns it on, and remembers the choice", () => {
    expect(readAdminNight()).toBe(false);
    expect(adminRootClass(false)).not.toContain("sheet-night");
    writeAdminNight(true);
    expect(localStorage.getItem(ADMIN_NIGHT_KEY)).toBe("1");
    expect(readAdminNight()).toBe(true);
    expect(adminRootClass(true)).toContain("sheet-night");
    writeAdminNight(false);
    expect(readAdminNight()).toBe(false);
  });

  it("moves white slabs onto the sheet colours", () => {
    const css = fs.readFileSync(path.join(import.meta.dirname, "adminNight.css"), "utf8");
    expect(css).toContain(".admin-root.sheet-night .bg-white");
    expect(css).toContain("background-color: var(--card)");
    expect(css).toContain("color: var(--foreground)");
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}/);
  });
});
