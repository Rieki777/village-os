// @vitest-environment jsdom
/**
 * D-01 (go-live design pass): the landing's first screen. While the village
 * has its founding team section on, "Join the founding team" is the hero's one
 * gold act, the map sits beside it edged, the hero says paid roles exist, and
 * the founding card leads the ways in with the gold edge. Off, the hero keeps
 * its own door to the paths and says nothing of a founding team.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
class NoopIntersectionObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}
vi.stubGlobal("IntersectionObserver", NoopIntersectionObserver);

import { cleanup, render, screen } from "@testing-library/react";
import { Router } from "wouter";
import type { ReactNode } from "react";

let foundingOn = true;
let mapOn = true;

vi.mock("@/components/Layout", () => ({ default: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock("@/components/BuildProgress", () => ({ default: () => null }));
vi.mock("@/components/SeasonBanner", () => ({ default: () => null }));
vi.mock("@/components/VillagePulse", () => ({ default: () => null }));
vi.mock("@/components/MapPeek", () => ({ default: () => null }));
vi.mock("@/modules/ModuleProvider", () => ({ useModule: (id: string) => (id === "map" && mapOn ? { id: "map" } : null) }));
vi.mock("@/lib/gameApi", () => ({
  useBrandImages: () => ({ hero: "" }),
  useGameConfig: () => ({ project: { name: "Willowbrook", tagline: "", location: "" }, currency: { name: "Thanks" } }),
  useVillageLinks: () => ({ siteUrl: "", eventsUrl: "", contactEmail: "", mailTo: () => "" }),
  altOr: (value: string | undefined, fallback: string) => (typeof value === "string" ? value : fallback),
}));
vi.mock("@/hooks/useVillageContent", () => ({ readVillageSection: () => Promise.resolve(null) }));

import Home from "./Home";

beforeEach(() => {
  foundingOn = true;
  mapOn = true;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) =>
      url === "/api/org/founding-team"
        ? new Response(JSON.stringify(foundingOn ? { on: true, roleIds: ["finance-steward"] } : { on: false, roleIds: [] }), { status: 200 })
        : new Response("{}", { status: 404 }),
    ),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.stubGlobal("IntersectionObserver", NoopIntersectionObserver);
});

const renderHome = () =>
  render(
    <Router>
      <Home />
    </Router>,
  );
const hero = () => document.querySelector("[data-landing-hero]") as HTMLElement;

describe("the landing's first screen with the founding team on", () => {
  it("makes Join the founding team the hero's one gold act, with the map beside it edged", async () => {
    renderHome();
    const join = await screen.findByRole("link", { name: /Join the founding team/ });
    expect(join.getAttribute("href")).toBe("/roles");
    expect(join.className).toContain("bg-notice");
    const map = screen.getByRole("link", { name: "Explore the map" });
    expect(map.className).not.toContain("bg-notice");
    // One gold act in the hero.
    expect(hero().querySelectorAll("a.bg-notice")).toHaveLength(1);
    expect(hero().textContent).toContain("paid, multi-year roles");
  });

  it("leads the ways in with the founding card, on the gold edge", async () => {
    renderHome();
    await screen.findByRole("link", { name: /Join the founding team/ });
    const ways = Array.from(document.querySelectorAll("#choose-path a"));
    expect(ways[0].getAttribute("data-way")).toBe("founding");
    expect(ways[0].className).toContain("border-notice/60");
    expect(ways.slice(1).every((a) => !a.className.includes("border-2"))).toBe(true);
  });

  it("CONTROL: with the section off, the hero keeps its door to the paths and names no founding team", async () => {
    foundingOn = false;
    renderHome();
    await screen.findByRole("heading", { level: 1 });
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByRole("link", { name: /Join the founding team/ })).toBeNull();
    const act = hero().querySelector('[data-hero-act="paths"]') as HTMLElement;
    expect(act.getAttribute("href")).toBe("#choose-path");
    expect(act.className).toContain("bg-notice");
    expect(hero().textContent).not.toContain("paid, multi-year roles");
    expect(document.querySelector('[data-way="founding"]')).toBeNull();
  });
});
