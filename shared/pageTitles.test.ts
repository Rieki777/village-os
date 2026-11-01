/**
 * EVERY ROUTE HAS A PAGE NAME.
 *
 * A route with no entry in PAGE_TITLES falls back to the village name alone,
 * so its tab, its link preview and what a screen reader says on arrival are
 * all the same as the home page's. Fifteen routes were in that state on
 * 2026-10-31, found by a production sweep rather than by anything here.
 *
 * The routes are read from App.tsx itself, so a route added there with no
 * title fails this file by name.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { PAGE_TITLES, documentTitle, pageTitleFor } from "./pageTitles";

const app = readFileSync(resolve(__dirname, "../client/src/App.tsx"), "utf8");
const routes = Array.from(new Set(Array.from(app.matchAll(/<Route\s+path="([^"]+)"/g), (m) => m[1])));

/** A concrete location for a route pattern: each `:param` becomes a sample segment. */
const sample = (path: string) => path.replace(/:[A-Za-z]+/g, "x");

describe("page titles", () => {
  it("reads the routes out of App.tsx", () => {
    // A parser that matched nothing would make every assertion below vacuous.
    expect(routes.length).toBeGreaterThan(80);
    expect(routes).toContain("/quests");
  });

  it("names every route but the home page", () => {
    const untitled = routes.filter((p) => p !== "/" && pageTitleFor(sample(p)) === "");
    expect(untitled).toEqual([]);
  });

  it("names the pages the sweep found untitled", () => {
    expect(documentTitle("/claim", "Village")).toBe("Claim this village · Village");
    expect(documentTitle("/email/unsubscribe", "Village")).toBe("Your email · Village");
    expect(documentTitle("/season-plans/mine", "Village")).toBe("Your season · Village");
    expect(documentTitle("/season-plans", "Village")).toBe("The village's season · Village");
    expect(documentTitle("/404", "Village")).toBe("Page not found · Village");
  });

  it("keeps the longer key winning where one key is a prefix of another", () => {
    expect(pageTitleFor("/propose-quest")).toBe(PAGE_TITLES["/propose-quest"]);
    expect(pageTitleFor("/propose")).toBe(PAGE_TITLES["/propose"]);
    expect(pageTitleFor("/role-proposals/new")).toBe(PAGE_TITLES["/role-proposals"]);
    expect(pageTitleFor("/role-applications/x")).toBe(PAGE_TITLES["/role-applications"]);
  });

  it("has no key that no route can reach", () => {
    const dead = Object.keys(PAGE_TITLES).filter((key) => !routes.some((p) => sample(p) === key || sample(p).startsWith(key)));
    expect(dead).toEqual([]);
  });
});
