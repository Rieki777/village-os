// @vitest-environment jsdom
/**
 * The master plan hero, held to the same rule as the homepage hero.
 *
 * This page carried the defect in its most visible form. Image's placeholder
 * mark is centred in the box it fills, and here that box is the full-bleed
 * hero (measured 1264x489 at a 1272px viewport), so the 32px picture frame
 * landed at the middle of the section: inside the headline's own rectangle,
 * in the leading between "The Unnamed Village" and "Master Plan". It reads as
 * a broken image stamped on the title.
 *
 * Worth recording precisely, because the audit brief described it as sitting
 * ON TOP of the headline and that part is not what the browser does: the h1
 * wins the hit test at the glyph's centre, so the mark paints BEHIND the
 * letters. The content already sits at z-10 over a z-0 background and always
 * did. The defect was never the stacking order. It was a 32px mark centred in
 * a box that happens to be the same box the title sits in, and drawing
 * nothing is what removes it.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
// framer-motion's `whileInView` reaches for IntersectionObserver, which jsdom
// does not implement. A stub that never fires is right here: these tests ask
// what the hero renders, not what it animates on scroll.
class NoopIntersectionObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}
vi.stubGlobal("IntersectionObserver", NoopIntersectionObserver);

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Router } from "wouter";
import type { ReactNode } from "react";
import { MASTER_PLAN_PAGE } from "@shared/pageContent/masterPlan";
import { fillVars, markerDocument } from "@shared/pageContent/resolve";

/** A field's default as the spec holds it. The words are the spec's to choose; what the page does with them is this file's. */
const word = (sectionId: string, key: string) =>
  MASTER_PLAN_PAGE.sections.find((s) => s.id === sectionId)!.fields.find((f) => f.key === key)!.default;
const listDefault = (sectionId: string, key: string) =>
  MASTER_PLAN_PAGE.sections.find((s) => s.id === sectionId)!.lists!.find((l) => l.key === key)!.default;

const useBrandImagesMock = vi.fn();
/*
 * The village's own settings, swapped per test. `statedFacts` and `altOr` are
 * the REAL implementations rather than stubs: the tile row is built by the two
 * of them together, so a stub for either would leave the thing under test
 * unexercised. Only the two hooks that reach for the network are replaced.
 */
const useVillageSettingsMock = vi.fn<() => Record<string, unknown> | null>(() => ({}));
/** The saved page, as GET /api/content/page-master-plan would answer it (null = never saved). */
let storedPlan: unknown = null;
/** The village's Events page URL; blank hides the call button. */
let eventsUrl = "";

vi.mock("@/components/Layout", () => ({
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("@/lib/gameApi", async () => {
  const actual = await vi.importActual<typeof import("@/lib/gameApi")>("@/lib/gameApi");
  return {
    useBrandImages: () => useBrandImagesMock(),
    useVillageLinks: () => ({ siteUrl: "", eventsUrl, contactEmail: "", mailTo: () => "" }),
    useVillageSettings: () => useVillageSettingsMock(),
    useGameConfig: () => ({ project: { name: "Willowbrook" }, currency: { name: "Thanks" } }),
    statedFacts: actual.statedFacts,
    altOr: actual.altOr,
  };
});
vi.mock("@/hooks/useVillageName", () => ({ useVillageName: () => "Willowbrook" }));
vi.mock("@/hooks/useVillageContent", () => ({ readVillageSection: () => Promise.resolve(storedPlan) }));

import MasterPlan from "./MasterPlan";

const renderPlan = () =>
  render(
    <Router>
      <MasterPlan />
    </Router>,
  );

const hero = () => document.querySelector("section") as HTMLElement;

beforeEach(() => {
  storedPlan = null;
  eventsUrl = "";
});

describe("the master plan hero", () => {
  beforeEach(() => {
    useBrandImagesMock.mockReset();
    useVillageSettingsMock.mockReturnValue({});
  });

  it("draws no picture and no placeholder mark when the village has added no art", () => {
    useBrandImagesMock.mockReturnValue({ masterPlanHero: "" });

    renderPlan();

    expect(hero().querySelector("img")).toBeNull();
    expect(hero().querySelector('[role="img"]')).toBeNull();
  });

  it("leaves the headline as the only thing in the middle of the hero", () => {
    // The concrete symptom, stated as an assertion: nothing decorative is
    // drawn inside the headline's box any more, so the title reads as a
    // title.
    useBrandImagesMock.mockReturnValue({ masterPlanHero: "" });

    renderPlan();
    const heading = screen.getByRole("heading", { level: 1 });

    expect(heading).toHaveTextContent("The Willowbrook Master Plan");
    expect(hero().querySelectorAll('[role="img"]')).toHaveLength(0);
  });

  it("paints the copy on its own opaque band", () => {
    useBrandImagesMock.mockReturnValue({ masterPlanHero: "" });

    renderPlan();
    const band = hero().querySelector(".rounded-3xl.bg-teal-band");

    expect(band).toBeTruthy();
    expect(band).toHaveAttribute("aria-hidden", "true");
  });

  it("draws the picture when there is one, and keeps its name when it fails", () => {
    useBrandImagesMock.mockReturnValue({
      masterPlanHero: "/uploads/plan.jpg",
      masterPlanHeroAlt: "The site plan drawing",
    });

    renderPlan();
    const img = hero().querySelector("img") as HTMLImageElement;
    expect(img).toHaveAttribute("src", "/uploads/plan.jpg");
    expect(img).toHaveAttribute("alt", "The site plan drawing");

    fireEvent.error(img);

    const mark = hero().querySelector('[role="img"]');
    expect(mark).toBeTruthy();
    expect(mark).toHaveAttribute("aria-label", "The site plan drawing");
  });
});

/**
 * The size of the land, and the unit the village measures it in.
 *
 * The tile label was the literal string "Total Acres" over a free-text number
 * the village types in Settings. Settings asks for the unit in the box beside
 * that number and the tile threw it away, so a village entering 40 hectares
 * published "40 / Total Acres" on the page it shows investors: its land, at
 * 40% of its real size, produced by filling the screen in the way the screen
 * asked. The first village on this platform measures in hectares.
 *
 * Both directions are asserted, because a test that only ever sees the case it
 * was written for is not a test. The hectares village must not get a page
 * saying acres, AND the village that typed a bare number back when acres was
 * the only thing this tile could say must render exactly as it does today.
 */
describe("the size of the land", () => {
  beforeEach(() => {
    useBrandImagesMock.mockReset();
    useBrandImagesMock.mockReturnValue({ masterPlanHero: "" });
  });

  // `section.bg-teal-deep` alone also matches the closing call to action, which
  // renders whether or not the village has stated a figure. The band under test
  // is the py-12 one.
  const statsBand = () =>
    document.querySelector("section.py-12.bg-teal-deep") as HTMLElement | null;
  /** The band once the page's words (its tile labels) have arrived. */
  const bandDrawn = async () => {
    await waitFor(() => expect(statsBand()).toBeTruthy());
    return statsBand() as HTMLElement;
  };

  it("states the unit the village measures in", async () => {
    useVillageSettingsMock.mockReturnValue({
      landFacts: { acres: { value: "40", note: "hectares" } },
    });

    renderPlan();
    const band = await bandDrawn();

    expect(band).toBeTruthy();
    expect(band).toHaveTextContent("40");
    expect(band).toHaveTextContent("Total hectares");
    // The whole page, not just the tile: nothing anywhere may call this land
    // acres when the village said hectares.
    expect(document.body.textContent ?? "").not.toMatch(/acre/i);
  });

  it("converts nothing, so the number on the page is the number that was typed", async () => {
    // 40 hectares is 98.8 acres. Publishing 98.8 would put a figure on an
    // investor page that nobody at the village ever wrote, which is a worse
    // thing to ship than the bug this replaces.
    useVillageSettingsMock.mockReturnValue({
      landFacts: { acres: { value: "40", note: "hectares" } },
    });

    renderPlan();
    await bandDrawn();

    // Scoped to the band a converted figure would land in, so unrelated copy
    // elsewhere on the page cannot fail this for the wrong reason.
    expect(statsBand()).toHaveTextContent("40");
    expect(statsBand()?.textContent ?? "").not.toContain("98");
  });

  it("keeps the page a village with a bare number already has", async () => {
    // No unit stated: the same payload that renders "40 / Total Acres" today,
    // rendering "40 / Total Acres" after the fix. Nobody's live page moves.
    useVillageSettingsMock.mockReturnValue({
      landFacts: { acres: { value: "40", note: "" } },
    });

    renderPlan();
    const band = await bandDrawn();

    expect(band).toHaveTextContent("40");
    expect(band).toHaveTextContent("Total Acres");
  });

  it("carries a unit it has never heard of", async () => {
    // Costa Rica measures in manzanas as well as hectares, and a closed list
    // of units is how the next village gets told its own land is unspeakable.
    // Free text, published verbatim.
    useVillageSettingsMock.mockReturnValue({
      landFacts: { acres: { value: "6", note: "manzanas" } },
    });

    renderPlan();

    expect(await bandDrawn()).toHaveTextContent("Total manzanas");
  });

  it("leaves the other tiles' labels alone", async () => {
    useVillageSettingsMock.mockReturnValue({
      landFacts: {
        acres: { value: "40", note: "hectares" },
        plannedHomes: { value: "150", note: "" },
        guestRooms: { value: "120", note: "" },
      },
    });

    renderPlan();
    const band = await bandDrawn();

    // The defaults of Admin, Pages, Master Plan.
    expect(band).toHaveTextContent(word("stats", "plannedHomesLabel"));
    expect(band).toHaveTextContent(word("stats", "guestRoomsLabel"));
  });

  it("shows no band at all when the village has stated nothing", async () => {
    useVillageSettingsMock.mockReturnValue({ landFacts: { acres: { value: "", note: "hectares" } } });

    renderPlan();
    // The words have arrived (the vision heading is drawn), and still no band.
    await screen.findByText(word("vision", "heading"));

    expect(statsBand()).toBeNull();
  });
});

/**
 * EVERY FIELD IN THE MASTER PLAN SPEC REACHES THE PAGE (2026-10-22).
 *
 * The page's words moved into Admin, Pages, Master Plan. A field a founder can
 * save and the page never reads is the Tagline bug again, so a distinct marker
 * goes into every field and every list row and each one must come out.
 */
describe("every field in the Master Plan spec reaches the page", () => {
  const ALL_FIGURES = {
    landFacts: {
      acres: { value: "40", note: "" },
      plannedHomes: { value: "150", note: "" },
      guestRooms: { value: "120", note: "" },
      appraisal: { value: "$1", note: "" },
    },
  };

  beforeEach(() => {
    useBrandImagesMock.mockReset();
    useBrandImagesMock.mockReturnValue({ masterPlanHero: "" });
    useVillageSettingsMock.mockReturnValue(ALL_FIGURES);
  });

  it("renders a distinct marker typed into each field and each list row", async () => {
    const doc = markerDocument(MASTER_PLAN_PAGE);
    storedPlan = doc;
    // The call button is drawn only when the village has an Events page.
    eventsUrl = "https://example.org/events";
    renderPlan();
    await screen.findByText((doc.vision as Record<string, string>).heading);

    const text = document.body.textContent ?? "";
    const missing: string[] = [];
    for (const [sectionId, section] of Object.entries(doc)) {
      for (const [key, value] of Object.entries(section as Record<string, unknown>)) {
        // The document's link is checked by where it points, below.
        if (sectionId === "valuation" && key === "pdfUrl") continue;
        const values = Array.isArray(value)
          ? value.flatMap((row) => Object.entries(row as Record<string, string>).filter(([k]) => k !== "id").map(([, v]) => v))
          : [value as string];
        for (const v of values) if (!text.includes(v)) missing.push(`${sectionId}.${key} (${v})`);
      }
    }
    expect(missing).toEqual([]);
    const pdf = (doc.valuation as Record<string, string>).pdfUrl;
    expect(screen.getByRole("link", { name: (doc.valuation as Record<string, string>).pdfLabel })).toHaveAttribute("href", pdf);
  });

  it("draws nothing of a section the village hid", async () => {
    storedPlan = {
      vision: { hidden: true, zones: [{ title: "Orchard", description: "Fruit.", tags: "" }] },
      phases: { hidden: true, phases: [{ phase: "Wells", items: "Two wells", status: "Planning" }] },
      valuation: { hidden: true },
      cta: { hidden: true },
    };
    renderPlan();
    await bandDrawnHere();

    for (const gone of [word("vision", "heading"), "Orchard", "Wells", word("phases", "heading"), word("valuation", "heading"), word("cta", "heading")]) {
      expect(screen.queryByText(gone)).toBeNull();
    }
  });

  it("draws the starter words by default, no zones or phases nobody wrote, and no document button until the village links one", async () => {
    renderPlan();
    await screen.findByText(word("vision", "heading"));

    expect(document.body.textContent ?? "").toContain(fillVars(word("hero", "subline"), { village: "Willowbrook" }));
    expect(document.body.textContent ?? "").toContain(fillVars(word("vision", "body"), { village: "Willowbrook" }));
    // Zones and phases are one piece of land's facts, so they ship empty, and
    // a phases heading over no phases is not drawn.
    expect(listDefault("vision", "zones")).toEqual([]);
    expect(listDefault("phases", "phases")).toEqual([]);
    expect(screen.queryByText(word("phases", "heading"))).toBeNull();
    expect(screen.getByText(word("cta", "heading"))).toBeInTheDocument();
    // The disabled "Coming Soon" button every village used to show is gone until there is a document.
    expect(screen.queryByText(/Coming Soon/)).toBeNull();
    expect(screen.queryByRole("link", { name: /Master Plan PDF/ })).toBeNull();
  });

  it("splits a zone's tags on commas and leaves the blanks out", async () => {
    storedPlan = { vision: { zones: [{ title: "Orchard", description: "Fruit.", tags: "Apples, , Pears ," }] } };
    renderPlan();
    await screen.findByText("Orchard");

    expect(screen.getByText("Apples")).toBeInTheDocument();
    expect(screen.getByText("Pears")).toBeInTheDocument();
    expect(screen.queryByText("Village Center")).toBeNull();
  });

  const bandDrawnHere = () => waitFor(() => expect(document.querySelector("section.py-12.bg-teal-deep")).toBeTruthy());
});
