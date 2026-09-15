// @vitest-environment jsdom
/**
 * The eight venture investment ranges, held to the founder's ruling of
 * 2026-09-03.
 *
 * "$5M - $10M" through "$100K - $300K" shipped as a module constant and the
 * page fetched nothing, so every village that deploys this platform published
 * eight capital figures about ventures it has not costed, in a currency it may
 * not use. Same class as the housing tiers (0131) and the land figures
 * (`landFacts`), same answer: the ranges come from the runtime content
 * document, an unstated range publishes NOTHING, and a stated one publishes
 * verbatim.
 *
 * The card itself is not the claim under test. A card with no range is still a
 * card: the village still means to build a retreat centre, it has just not
 * said what one costs.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

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

vi.mock("@/components/Layout", () => ({
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("@/lib/gameApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/gameApi")>()),
  useVillageLinks: () => ({ siteUrl: "", eventsUrl: "", contactEmail: "", mailTo: () => "" }),
}));
vi.mock("@/hooks/useVillageName", () => ({ useVillageName: () => "Willowbrook" }));
vi.mock("@/hooks/useTokenNames", () => ({ useTokenName: () => "Gratitude" }));

const moneySection = vi.hoisted(() => ({ current: null as Record<string, unknown> | null }));
vi.mock("@/hooks/useVillageContent", () => ({
  useVillageContent: (section: string) =>
    section === "money"
      ? { content: moneySection.current, loading: false, isPlaceholder: !moneySection.current }
      : { content: null, loading: false, isPlaceholder: true },
}));

import Opportunities from "./Opportunities";

const renderPage = () =>
  render(
    <Router>
      <Opportunities />
    </Router>,
  );

beforeEach(() => {
  moneySection.current = null;
  // afterEach's unstubAllGlobals takes the module-level stub with it, and the
  // second render in any file then dies inside framer-motion's whileInView.
  vi.stubGlobal("IntersectionObserver", NoopIntersectionObserver);
});
afterEach(() => vi.unstubAllGlobals());

/** Every dollar-shaped run of text anywhere on the rendered page. */
const currencyRuns = () => (document.body.textContent ?? "").match(/\$[\d.,]+ ?[KMB]?/g) ?? [];

describe("a village that has costed none of its ventures", () => {
  it("still draws every venture card", () => {
    renderPage();
    for (const title of [
      "Retreat Center",
      "Health & Wellness Center",
      "Café & Restaurant",
      "Artisan Market",
      "Learning Center",
      "Fitness & Recreation",
      "Art & Culture Hub",
      "Regenerative Agriculture",
    ]) {
      expect(screen.queryByText(title), title).toBeTruthy();
    }
  });

  it("publishes no capital figure anywhere on the page", () => {
    renderPage();
    expect(currencyRuns()).toEqual([]);
  });

  it("prints no empty range slot and no placeholder in its place", () => {
    renderPage();
    const said = document.body.textContent ?? "";
    expect(said).not.toMatch(/\bTBD\b|to be confirmed|Investment: *$/i);
  });
});

describe("a village that has costed some of its ventures", () => {
  it("publishes exactly the ranges it stated and nothing for the rest", () => {
    moneySection.current = {
      ventureInvestment: {
        "retreat-center": "₡2.500M a ₡5.000M",
        "artisan-market": "under valuation",
      },
    };
    renderPage();
    expect(screen.queryByText("₡2.500M a ₡5.000M")).toBeTruthy();
    expect(screen.queryByText("under valuation")).toBeTruthy();
    // The six it has not costed stay silent.
    expect(currencyRuns()).toEqual([]);
  });

  it("changes when the document changes", () => {
    moneySection.current = { ventureInvestment: { "retreat-center": "$5M - $10M" } };
    const first = renderPage();
    expect(screen.queryByText("$5M - $10M")).toBeTruthy();
    first.unmount();

    moneySection.current = { ventureInvestment: { "retreat-center": "1,2M EUR upwards" } };
    renderPage();
    expect(screen.queryByText("1,2M EUR upwards")).toBeTruthy();
    expect(screen.queryByText("$5M - $10M")).toBeNull();
  });

  it("attaches a range to its own venture and to no other", () => {
    // "Artisan Market" and "Regenerative Agriculture" carried the SAME
    // constant range, so a lookup keyed by anything sloppier than the venture
    // would print this twice and nobody would notice.
    moneySection.current = {
      ventureInvestment: { "regenerative-agriculture": "$100K - $300K" },
    };
    renderPage();
    const printed = screen.getAllByText("$100K - $300K");
    expect(printed).toHaveLength(1);
    // The one place it printed sits inside the agriculture card and no other.
    const card = printed[0]!.closest(".rounded-2xl");
    expect(card?.textContent ?? "").toContain("Regenerative Agriculture");
    expect(card?.textContent ?? "").not.toContain("Artisan Market");
  });
});
