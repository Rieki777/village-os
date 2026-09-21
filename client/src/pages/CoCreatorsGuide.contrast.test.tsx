// @vitest-environment jsdom
/**
 * The Hypha section of the co-creators guide is a dark band, and its four
 * action cards once carried light-theme ink on it: the body of each card was
 * `text-muted-foreground` (#525252) on a 5% tint of the band (#404040), which
 * measured 1.17:1 in a real browser at 393px. The section heading and intro
 * had been given band-legible ink; the cards had not.
 *
 * These tests hold the RELATIONSHIP, never a class name. They render the real
 * page, and client/src/test/tokenContrast.ts resolves the classes each line of
 * text and each ancestor actually carries through the tokens in index.css,
 * composites the ground, and measures the pair. So a later edit that swaps in
 * a different class which happens to resolve to a legible colour passes, and
 * one that keeps a "known good" class name on a ground it was never measured
 * against fails.
 *
 * Both schemes, because ThemeContext puts `dark` on <html> and the band is a
 * frozen surface: a responsive token placed on it reads one way in light and
 * another in dark. And under a village's own brand, because the band is the
 * brand colour and a card legible on the neutral default can still fail on a
 * seed the platform derived.
 */
import { describe, expect, it, vi } from "vitest";

class NoopIntersectionObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}
vi.stubGlobal("IntersectionObserver", NoopIntersectionObserver);

import { cleanup, render, within } from "@testing-library/react";
import { Router } from "wouter";
import type { ReactNode } from "react";
import { CHARACTER_CARDS, deriveTheme } from "@shared/brandTokens";
import { describeFailures, measureText, type Scheme, type TextContrast } from "@/test/tokenContrast";

let hyphaConfigured = false;

vi.mock("@/components/Layout", () => ({
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("@/modules/ModuleProvider", () => ({
  useHypha: () => ({ configured: hyphaConfigured, orgUrl: "https://dho.example.org/village", links: {} }),
}));
vi.mock("@/lib/gameApi", () => ({
  useVillageLinks: () => ({ siteUrl: "", eventsUrl: "", contactEmail: "", mailTo: () => "" }),
}));
vi.mock("@/hooks/useVillageName", () => ({ useVillageName: () => "Willowbrook" }));
vi.mock("@/hooks/useTokenNames", () => ({
  useTokenName: () => "Recognition",
  useValueTokenName: () => "Village Credits",
}));
vi.mock("@/lib/moneyClaims", () => ({ useValueConversion: () => "" }));

import CoCreatorsGuide from "./CoCreatorsGuide";

function renderHypha(configured: boolean) {
  hyphaConfigured = configured;
  render(
    <Router>
      <CoCreatorsGuide />
    </Router>,
  );
  const section = document.getElementById("hypha");
  if (!section) throw new Error("the co-creators guide rendered no #hypha section");
  return section;
}

/** The four action cards: the section's one list, one item per action. */
const actionCards = (section: HTMLElement) => within(section).getAllByRole("listitem");

const SCHEMES: Scheme[] = ["light", "dark"];

/** Fails naming every line under its floor, with the pair it measured. */
function expectLegible(results: TextContrast[]) {
  const failures = describeFailures(results);
  expect(failures, `${failures.length} lines under their floor:\n${failures.join("\n")}`).toEqual([]);
}

describe.each(SCHEMES)("the Hypha section, %s scheme", (scheme) => {
  it.each([false, true])(
    "every Hypha action card's text, its body included, clears its WCAG floor against the card (Hypha connected: %s)",
    (configured) => {
      const cards = actionCards(renderHypha(configured));
      expect(cards).toHaveLength(4);
      const results = cards.flatMap((card) => measureText(card, scheme));
      // Title, subtitle, body and the link or its fallback, on every card.
      expect(results.length).toBeGreaterThanOrEqual(4 * 4);
      expectLegible(results);
    },
  );

  it("every other line of copy in the section clears its WCAG floor against the band it sits on", () => {
    const results = measureText(renderHypha(false), scheme);
    expect(results.length).toBeGreaterThan(20);
    expectLegible(results);
  });
});

/**
 * Seeds spread round the hue wheel plus the extremes a founder can pick, each
 * under every character card: the band and both inks on it are derived from
 * these, so this is where a pairing that holds on the neutral default and
 * fails on a real village would show.
 */
const SEEDS = ["#157f7d", "#0b3d91", "#7a1f5c", "#b5462f", "#c9a227", "#2e7d32", "#6a5acd", "#111111", "#f5f5f5", "#ff00ff"]; // theme-ok: seed inputs to deriveTheme, never painted

describe("the Hypha action cards under a village's own brand", () => {
  it.each(SCHEMES)("clear 4.5:1 on every card for every seed and character card (%s)", (scheme) => {
    const failures: string[] = [];
    let measured = 0;
    for (const seed of SEEDS) {
      for (const card of CHARACTER_CARDS) {
        const theme = deriveTheme(seed, card.id);
        if (!theme) throw new Error(`deriveTheme produced nothing for ${seed}`);
        const cards = actionCards(renderHypha(true));
        const results = cards.flatMap((c) => measureText(c, scheme, theme.vars));
        measured += results.length;
        describeFailures(results).forEach((f) => failures.push(`${seed}/${card.id}: ${f}`));
        cleanup();
      }
    }
    expect(measured).toBeGreaterThan(SEEDS.length * CHARACTER_CARDS.length * 16 - 1);
    expect(failures, `${failures.length} lines under 4.5:1:\n${failures.join("\n")}`).toEqual([]);
  });
});
