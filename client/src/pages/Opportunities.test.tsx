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
  // The recognition token is named, so the token ruling can be checked
  // against the rendered page rather than against the source.
  useGameConfig: () => ({ project: { name: "Willowbrook" }, currency: { name: "Gratitude", value: { name: "Seeds" } } }),
}));

const moneySection = vi.hoisted(() => ({ current: null as Record<string, unknown> | null }));
// What GET /api/content/page-opportunities answers (null = never saved).
const pageSection = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("@/hooks/useVillageContent", () => ({
  useVillageContent: (section: string) =>
    section === "money"
      ? { content: moneySection.current, loading: false, isPlaceholder: !moneySection.current }
      : { content: null, loading: false, isPlaceholder: true },
  readVillageSection: () => Promise.resolve(pageSection.current),
}));

import Opportunities from "./Opportunities";
import { OPPORTUNITIES_PAGE, VENTURE_IDS } from "@shared/pageContent/opportunities";
import { fillVars, markerDocument } from "@shared/pageContent/resolve";

const renderPage = () =>
  render(
    <Router>
      <Opportunities />
    </Router>,
  );

/** A field's default as the spec holds it, filled with this file's village. The words are the spec's to choose. */
const word = (sectionId: string, key: string) =>
  fillVars(OPPORTUNITIES_PAGE.sections.find((s) => s.id === sectionId)!.fields.find((f) => f.key === key)!.default, {
    village: "Willowbrook",
  });

/** The page's words arrive after one read, so a test waits for them before it asks. */
const loaded = () => screen.findByText(word("hero", "lede"));

/** The eight titles as the spec writes them, so a reworded default moves the test with it. */
const DEFAULT_TITLES = OPPORTUNITIES_PAGE.sections
  .find((s) => s.id === "ventures")!
  .lists![0].default.map((row) => row.title);

beforeEach(() => {
  moneySection.current = null;
  pageSection.current = null;
  // afterEach's unstubAllGlobals takes the module-level stub with it, and the
  // second render in any file then dies inside framer-motion's whileInView.
  vi.stubGlobal("IntersectionObserver", NoopIntersectionObserver);
});
afterEach(() => vi.unstubAllGlobals());

/** Every dollar-shaped run of text anywhere on the rendered page. */
const currencyRuns = () => (document.body.textContent ?? "").match(/\$[\d.,]+ ?[KMB]?/g) ?? [];

describe("a village that has costed none of its ventures", () => {
  it("still draws every venture card", async () => {
    renderPage();
    await loaded();
    expect(DEFAULT_TITLES).toEqual([
      "Retreat Center",
      "Health & Wellness Center",
      "Café & Restaurant",
      "Artisan Market",
      "Learning Center",
      "Fitness & Recreation",
      "Art & Culture Hub",
      "Regenerative Agriculture",
    ]);
    for (const title of DEFAULT_TITLES) {
      expect(screen.queryByText(title), title).toBeTruthy();
    }
  });

  it("publishes no capital figure anywhere on the page", async () => {
    renderPage();
    await loaded();
    expect(currencyRuns()).toEqual([]);
  });

  it("prints no empty range slot and no placeholder in its place", async () => {
    renderPage();
    await loaded();
    const said = document.body.textContent ?? "";
    expect(said).not.toMatch(/\bTBD\b|to be confirmed|Investment: *$/i);
  });
});

describe("a village that has costed some of its ventures", () => {
  it("publishes exactly the ranges it stated and nothing for the rest", async () => {
    moneySection.current = {
      ventureInvestment: {
        "retreat-center": "₡2.500M a ₡5.000M",
        "artisan-market": "under valuation",
      },
    };
    renderPage();
    await loaded();
    expect(screen.queryByText("₡2.500M a ₡5.000M")).toBeTruthy();
    expect(screen.queryByText("under valuation")).toBeTruthy();
    // The six it has not costed stay silent.
    expect(currencyRuns()).toEqual([]);
  });

  it("changes when the document changes", async () => {
    moneySection.current = { ventureInvestment: { "retreat-center": "$5M - $10M" } };
    const first = renderPage();
    await loaded();
    expect(screen.queryByText("$5M - $10M")).toBeTruthy();
    first.unmount();

    moneySection.current = { ventureInvestment: { "retreat-center": "1,2M EUR upwards" } };
    renderPage();
    await loaded();
    expect(screen.queryByText("1,2M EUR upwards")).toBeTruthy();
    expect(screen.queryByText("$5M - $10M")).toBeNull();
  });

  it("attaches a range to its own venture and to no other", async () => {
    // "Artisan Market" and "Regenerative Agriculture" carried the SAME
    // constant range, so a lookup keyed by anything sloppier than the venture
    // would print this twice and nobody would notice.
    moneySection.current = {
      ventureInvestment: { "regenerative-agriculture": "$100K - $300K" },
    };
    renderPage();
    await loaded();
    const printed = screen.getAllByText("$100K - $300K");
    expect(printed).toHaveLength(1);
    // The one place it printed sits inside the agriculture card and no other.
    const card = printed[0]!.closest(".rounded-2xl");
    expect(card?.textContent ?? "").toContain("Regenerative Agriculture");
    expect(card?.textContent ?? "").not.toContain("Artisan Market");
  });
});

describe("a village that renamed a venture", () => {
  it("keeps the range on the card it was typed for, because the id is the contract", async () => {
    // The investment range is keyed by the venture's id in the money
    // section. Renaming the card in Pages must not orphan the figure.
    pageSection.current = { ventures: { cards: [{ id: "retreat-center", title: "Healing Lodge" }] } };
    moneySection.current = { ventureInvestment: { "retreat-center": "₡2.500M" } };
    renderPage();
    const card = (await screen.findByText("Healing Lodge")).closest(".rounded-2xl");
    expect(card?.textContent ?? "").toContain("₡2.500M");
    expect(screen.queryByText("Retreat Center")).toBeNull();
  });

  it("uses the same eight ids the money section is keyed by", () => {
    expect([...VENTURE_IDS]).toEqual([
      "retreat-center",
      "health-wellness",
      "cafe-restaurant",
      "artisan-market",
      "learning-center",
      "fitness-recreation",
      "art-culture",
      "regenerative-agriculture",
    ]);
  });
});

/* ── THE TOKEN RULING (Rye, 2026-10-22; TOKEN_COPY_PROPOSAL rows 31 to 33) ──
 *
 * A token may be named; no sentence says what it does. This page said the
 * revenue share was "paid in" the recognition token, in the hero, in the
 * section heading, in its paragraph and in the link under it.
 */
describe("the page says nothing about what a token does", () => {
  it("never names the recognition token in its default words", async () => {
    renderPage();
    await loaded();
    const text = document.body.textContent ?? "";
    expect(text).not.toContain("Gratitude");
    expect(text).not.toContain("Seeds");
    expect(text).toContain(word("hero", "lede"));
    expect(screen.getByRole("heading", { level: 2, name: word("revenue", "heading") })).toBeTruthy();
    expect(text).toContain(word("revenue", "body"));
    expect(screen.getByRole("link", { name: /How we create together/ })).toHaveAttribute("href", "/how-we-create");
  });
});

describe("every field in the Business Opportunities spec reaches the page", () => {
  it("renders a distinct marker typed into each field and each list row", async () => {
    const doc = markerDocument(OPPORTUNITIES_PAGE);
    pageSection.current = doc;
    renderPage();
    await screen.findByText(String((doc.hero as Record<string, string>).lede));

    const text = document.body.textContent ?? "";
    const missing: string[] = [];
    for (const [sectionId, section] of Object.entries(doc)) {
      for (const [key, value] of Object.entries(section as Record<string, unknown>)) {
        const rows = Array.isArray(value) ? (value as Record<string, string>[]) : [{ [key]: value as string }];
        for (const row of rows) {
          for (const [field, v] of Object.entries(row)) {
            // An icon is a word that picks a picture, never text on the page.
            if (field === "id" || field === "icon") continue;
            if (!text.includes(v)) missing.push(`${sectionId}.${key}.${field} (${v})`);
          }
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it("draws one bullet per line, at most six, and the picture the icon word names", async () => {
    pageSection.current = {
      ventures: {
        cards: [{ id: "cafe-restaurant", icon: "tools", details: ["One", "", "Two", "Three", "Four", "Five", "Six", "Seven"].join("\n") }],
      },
    };
    renderPage();
    const card = (await screen.findByText("Café & Restaurant")).closest(".rounded-2xl") as HTMLElement;
    expect(Array.from(card.querySelectorAll("li")).map((li) => li.textContent)).toEqual([
      "One",
      "Two",
      "Three",
      "Four",
      "Five",
      "Six",
    ]);
    expect(card.querySelector("svg.lucide-hammer")).toBeTruthy();
  });

  it("draws a badge only for a status the village wrote: the starter cards claim no progress", async () => {
    const statuses = OPPORTUNITIES_PAGE.sections.find((s) => s.id === "ventures")!.lists![0].default.map((row) => row.status);
    expect(statuses.every((s) => s === "")).toBe(true);
    pageSection.current = { ventures: { cards: [{ id: "artisan-market", status: "Opening soon" }] } };
    renderPage();
    const card = (await screen.findByText("Artisan Market")).closest(".rounded-2xl") as HTMLElement;
    expect(card.textContent).toContain("Opening soon");
    const other = screen.getByText("Retreat Center").closest(".rounded-2xl") as HTMLElement;
    expect(other.querySelector("span.rounded-lg")).toBeNull();
  });

  it("draws nothing of a section the village hid", async () => {
    pageSection.current = { ventures: { hidden: true }, revenue: { hidden: true } };
    renderPage();
    await loaded();
    expect(screen.queryByText("Retreat Center")).toBeNull();
    expect(screen.queryByText(word("revenue", "heading"))).toBeNull();
    expect(screen.queryByRole("link", { name: /How we create together/ })).toBeNull();
    expect(screen.getByText("Interested in an Opportunity?")).toBeTruthy();
  });
});
