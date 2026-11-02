// @vitest-environment jsdom
/**
 * The homepage's path cards follow the journeys' own switches (Admin, Pages,
 * "Show this page"): a journey switched off on its own takes its card with it,
 * and with every journey off the section draws nothing.
 *
 * Mocked the way Home.test.tsx mocks the page, which holds the rest of it.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
class NoopIntersectionObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}
vi.stubGlobal("IntersectionObserver", NoopIntersectionObserver);

import { render, screen } from "@testing-library/react";
import { Router } from "wouter";
import type { ReactNode } from "react";

let gameConfig: Record<string, unknown>;

vi.mock("@/components/Layout", () => ({
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("@/components/BuildProgress", () => ({ default: () => null }));
vi.mock("@/components/SeasonBanner", () => ({ default: () => null }));
vi.mock("@/components/VillagePulse", () => ({ default: () => null }));
vi.mock("@/components/MapPeek", () => ({ default: () => null }));
vi.mock("@/lib/gameApi", () => ({
  useBrandImages: () => ({ hero: "" }),
  useGameConfig: () => gameConfig,
  useVillageLinks: () => ({ siteUrl: "", eventsUrl: "", contactEmail: "", mailTo: () => "" }),
  altOr: (value: string | undefined, fallback: string) => (typeof value === "string" ? value : fallback),
}));
vi.mock("@/hooks/useVillageContent", () => ({
  readVillageSection: () => Promise.resolve(null),
}));

import Home from "./Home";

const renderHome = async () => {
  render(
    <Router>
      <Home />
    </Router>,
  );
  await screen.findByRole("heading", { level: 1 });
};
const cardLinks = () => Array.from(document.querySelectorAll("#choose-path a")).map((a) => a.getAttribute("href"));

beforeEach(() => {
  gameConfig = { project: { name: "Willowbrook", tagline: "", location: "" }, currency: { name: "Thanks" }, brochurePages: true, brochureHidden: [] };
});

describe("the path cards on the homepage", () => {
  it("draws all four while every journey is on, the control for the cases below", async () => {
    await renderHome();
    expect(cardLinks()).toEqual(["/investor", "/steward", "/resident", "/prosperity"]);
  });

  it("leaves out a journey switched off on its own", async () => {
    gameConfig.brochureHidden = ["/investor"];
    await renderHome();
    expect(cardLinks()).toEqual(["/steward", "/resident", "/prosperity"]);
  });

  it("draws no section at all with every journey off, and keeps the anchor", async () => {
    gameConfig.brochureHidden = ["/investor", "/steward", "/resident", "/prosperity"];
    await renderHome();
    expect(cardLinks()).toEqual([]);
    expect(screen.queryByText("Choose your path")).toBeNull();
    expect(document.getElementById("choose-path")).not.toBeNull();
  });
});
