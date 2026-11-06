import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { MEMBER_READABLE_ADMIN_GETS, isMemberReadable } from "./memberReadable";

const ROOT = path.resolve(__dirname, "../..");
const sources = [path.join(ROOT, "server/index.ts"), ...fs.readdirSync(path.join(ROOT, "server/routes")).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts")).map((f) => path.join(ROOT, "server/routes", f))]
  .map((f) => fs.readFileSync(f, "utf8"))
  .join("\n");

describe("MEMBER_READABLE_ADMIN_GETS: the admin reads every member may make (Q5)", () => {
  it("names only admin GET routes that exist", () => {
    for (const route of Object.keys(MEMBER_READABLE_ADMIN_GETS)) {
      expect(route.startsWith("/api/admin/"), route).toBe(true);
      expect(sources.includes(`app.get("${route}"`), route).toBe(true);
    }
  });

  it("gives every route its reason", () => {
    for (const [route, why] of Object.entries(MEMBER_READABLE_ADMIN_GETS)) expect(why.length, route).toBeGreaterThan(30);
  });

  it("keeps secrets, people and money off the list", () => {
    for (const route of Object.keys(MEMBER_READABLE_ADMIN_GETS)) expect(route).not.toMatch(/integrations|secret|email|users|players|cash|exits|submissions|audit|modules/);
  });

  it("opens only a listed GET, only to a member", () => {
    expect(isMemberReadable("GET", "/api/admin/org/drafts", true)).toBe(true);
    expect(isMemberReadable("GET", "/api/admin/org/drafts", false)).toBe(false);
    expect(isMemberReadable("POST", "/api/admin/org/drafts", true)).toBe(false);
    expect(isMemberReadable("GET", "/api/admin/modules", true)).toBe(false);
    expect(isMemberReadable("GET", undefined, true)).toBe(false);
    expect(isMemberReadable("GET", "constructor", true)).toBe(false);
  });
});
