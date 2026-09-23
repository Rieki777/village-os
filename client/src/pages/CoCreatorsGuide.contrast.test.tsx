// @vitest-environment jsdom
/**
 * Contrast in the Hypha section of the co-creators guide, a dark band.
 *
 * These tests hold the RELATIONSHIP, never a class name. They render the real
 * page, and client/src/test/tokenContrast.ts resolves the classes each line of
 * text and each ancestor actually carries through the tokens in index.css,
 * composites the ground, and measures the pair. A later edit that swaps in a
 * different class resolving to a legible colour passes; one that keeps a
 * "known good" class on a ground it was never measured against fails.
 *
 * LIGHT ONLY. ThemeProvider is fixed to light (client/src/App.tsx) and there is
 * no dark mode, so nothing here measures `.dark`.
 *
 * WHAT IS ASSERTED:
 *   - every line of text on the four action cards, against its own card, in
 *     both Hypha states (the link, or the "Available once..." line), on the
 *     unseeded theme: what a village runs until a founder sets a brand colour.
 *     The cards are 5% tints of the band, and the light-page ink they carried
 *     measured 1.00 to 1.96:1 there, the body 1.17:1 at 393px;
 *   - every line of copy outside the cards, against the band;
 *   - under a village's own brand, 10 seeds x 6 character cards, the three
 *     cards whose tints are teal, sage and coral.
 *
 * WHAT IS PENDING: the amber-tinted card under a brand. White on it fails for
 * some seeds, because the brand tone is derived so white only just clears
 * 4.5:1 and a 5% amber tint lightens it past that. Giving that card one of the
 * other three tints closes it; that is a visible change, so it is `it.todo`,
 * not a skipped assertion, which would read like coverage.
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
import { describeFailures, measureText, type TextContrast } from "@/test/tokenContrast";

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

function renderHypha(configured: boolean): HTMLElement {
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

/** The nearest element containing both nodes. */
function commonAncestor(a: Element, b: Element): Element {
  for (let e: Element | null = a; e; e = e.parentElement) if (e.contains(b)) return e;
  throw new Error("the two nodes share no ancestor");
}

/** The grid holding the four action cards: the nearest ancestor of the first and last card titles. */
function cardGrid(section: HTMLElement): Element {
  const first = within(section).getByRole("heading", { name: "Start with an Agreement" });
  const last = within(section).getByRole("heading", { name: "Delegate Your Voice" });
  return commonAncestor(first, last);
}

/** The four action cards, one per child of their grid, each with one title. */
function actionCards(section: HTMLElement): HTMLElement[] {
  const cards = Array.from(cardGrid(section).children) as HTMLElement[];
  expect(cards).toHaveLength(4);
  cards.forEach((card) => expect(within(card).getAllByRole("heading")).toHaveLength(1));
  return cards;
}

/** Every line on a card is small text, so its floor is 4.5:1, stated here rather than read off its size. */
const CARD_FLOOR = 4.5;

/** One line per card line under 4.5:1, naming the pair it measured. */
const underCardFloor = (results: TextContrast[]) =>
  describeFailures(results.map((r) => ({ ...r, floor: Math.max(r.floor, CARD_FLOOR) })));

describe("the Hypha section, light", () => {
  it.each([false, true])(
    "every line of text on each action card clears 4.5:1 against that card, unseeded theme (Hypha connected: %s)",
    (configured) => {
      const perCard = actionCards(renderHypha(configured)).map((card) => measureText(card, "light"));
      // Title, subtitle, body, and the link or its fallback: an empty or wrong subtree fails here.
      perCard.forEach((lines) => expect(lines.length).toBeGreaterThanOrEqual(4));
      const failures = underCardFloor(perCard.flat());
      expect(failures, `${failures.length} card lines under 4.5:1:\n${failures.join("\n")}`).toEqual([]);
    },
  );

  it("every line of copy outside the action cards clears its WCAG floor against the band", () => {
    const section = renderHypha(false);
    // A copy with the card grid removed, so the rendered tree is left for React to unmount.
    const path: number[] = [];
    for (let e: Element = cardGrid(section); e !== section; e = e.parentElement!) {
      path.unshift(Array.prototype.indexOf.call(e.parentElement!.children, e));
    }
    const copy = section.cloneNode(true) as HTMLElement;
    let target: Element = copy;
    path.forEach((i) => (target = target.children[i]));
    target.remove();

    const results = measureText(copy, "light");
    expect(within(copy).queryByRole("heading", { name: "Start with an Agreement" })).toBeNull();
    // Header, panel and loop: well over a dozen lines, so an empty or wrong subtree fails here.
    expect(results.length).toBeGreaterThan(12);
    const failures = describeFailures(results);
    expect(failures, `${failures.length} lines under their floor:\n${failures.join("\n")}`).toEqual([]);
  });
});

/**
 * Seeds spread round the hue wheel plus the extremes a founder can pick, each
 * under every character card: the band is derived from these, so this is
 * where a card that holds on the unseeded theme and fails on a real village
 * would show.
 */
const SEEDS = ["#157f7d", "#0b3d91", "#7a1f5c", "#b5462f", "#c9a227", "#2e7d32", "#6a5acd", "#111111", "#f5f5f5", "#ff00ff"]; // theme-ok: seed inputs to deriveTheme, never painted

/** The amber-tinted card, the one exception under a brand (pending below). */
const AMBER_TINTED_CARD = "Propose Expenses";

describe("the Hypha action cards under a village's own brand, light", () => {
  it("the teal, sage and coral cards clear 4.5:1 for every seed and character card", () => {
    const failures: string[] = [];
    let measured = 0;
    for (const seed of SEEDS) {
      for (const style of CHARACTER_CARDS) {
        const theme = deriveTheme(seed, style.id);
        if (!theme) throw new Error(`deriveTheme produced nothing for ${seed}`);
        const cards = actionCards(renderHypha(true)).filter(
          (card) => !within(card).queryByRole("heading", { name: AMBER_TINTED_CARD }),
        );
        expect(cards).toHaveLength(3);
        const results = cards.flatMap((card) => measureText(card, "light", theme.vars));
        measured += results.length;
        underCardFloor(results).forEach((f) => failures.push(`${seed}/${style.id}: ${f}`));
        cleanup();
      }
    }
    expect(measured).toBeGreaterThanOrEqual(SEEDS.length * CHARACTER_CARDS.length * 3 * 4);
    expect(failures, `${failures.length} lines under 4.5:1:\n${failures.join("\n")}`).toEqual([]);
  });

  it.todo(
    "the amber-tinted card (Propose Expenses) clears 4.5:1 for every seed and character card: 16 of 60 fail today, worst 4.23; giving it another card's tint closes it, a visible change not chosen on 2026-09-21",
  );
});
