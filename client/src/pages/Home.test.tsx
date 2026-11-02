// @vitest-environment jsdom
/**
 * The homepage hero, and the difference between "no art yet" and "the art is
 * broken".
 *
 * Code that guards on falsiness cannot tell those two apart, and that is the
 * whole reason the live village looked broken: a village that had uploaded no
 * hero photograph got the same 32px picture-frame mark a 404 gets, drawn in
 * the middle of a 1272px hero. A visitor reads that as breakage. Nothing was
 * broken. Nothing had been added.
 *
 * So this file pins the two cases apart:
 *   no hero configured   -> no image, no mark, nothing announced
 *   hero configured      -> the image, and the mark only if it fails to load
 *
 * The four journey pages already drew nothing when there was no hero. This
 * page did not, and these tests are what stop it drifting back.
 *
 * The visual side (the accent word's contrast against the band behind it) is
 * NOT testable here: jsdom computes no colours through Tailwind's generated
 * utilities and does no compositing, so a ratio assertion would be measuring
 * the test's own arithmetic. That was measured in a real browser instead and
 * the numbers are in the lane report.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
// framer-motion's `whileInView` reaches for IntersectionObserver, which jsdom
// does not implement. A stub that never fires is right for these tests: they
// ask what the hero RENDERS, not what it animates on scroll.
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
import { HOME_PAGE } from "@shared/pageContent/home";
import { markerDocument } from "@shared/pageContent/resolve";

const useBrandImagesMock = vi.fn();
let gameConfig: { project: Record<string, string>; currency: { name: string } } | null;
let storedHome: unknown;

vi.mock("@/components/Layout", () => ({
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("@/components/BuildProgress", () => ({ default: () => null }));
vi.mock("@/components/SeasonBanner", () => ({ default: () => null }));
vi.mock("@/components/VillagePulse", () => ({ default: () => null }));
vi.mock("@/components/MapPeek", () => ({ default: () => null }));
vi.mock("@/lib/gameApi", () => ({
  useBrandImages: () => useBrandImagesMock(),
  useGameConfig: () => gameConfig,
  useVillageLinks: () => ({ siteUrl: "", eventsUrl: "https://example.org/events", contactEmail: "", mailTo: () => "" }),
  altOr: (value: string | undefined, fallback: string) =>
    typeof value === "string" ? value : fallback,
}));
// The saved page, as GET /api/content/page-home would answer it (null = never saved).
vi.mock("@/hooks/useVillageContent", () => ({
  readVillageSection: () => Promise.resolve(storedHome),
}));

import Home from "./Home";

const renderHome = () =>
  render(
    <Router>
      <Home />
    </Router>,
  );

/** The hero is the first section on the page. */
const hero = () => document.querySelector("section") as HTMLElement;
const headline = () => screen.findByRole("heading", { level: 1 });

beforeEach(() => {
  useBrandImagesMock.mockReset();
  useBrandImagesMock.mockReturnValue({ hero: "" });
  gameConfig = { project: { name: "Willowbrook", tagline: "", location: "" }, currency: { name: "Thanks" } };
  storedHome = null;
});

describe("the homepage headline", () => {
  it("is the village's own Tagline when the village has not written one for this page", async () => {
    gameConfig = { project: { name: "Willowbrook", tagline: "Grow the village together" }, currency: { name: "Thanks" } };
    renderHome();

    const h1 = await headline();
    expect(h1).toHaveTextContent("Grow the village together");
    expect(h1).not.toHaveTextContent(/Co-Become/);
  });

  it("is what the village wrote in Admin, Pages, Home, with its highlighted phrase", async () => {
    storedHome = { hero: { headline: "A valley that remembers", highlight: "remembers" } };
    renderHome();

    const h1 = await headline();
    expect(h1).toHaveTextContent("A valley that remembers");
    expect(h1.querySelector(".text-amber-on-band")).toHaveTextContent("remembers");
  });

  it("never comes out blank when the Tagline is cleared", async () => {
    renderHome();

    expect(await headline()).toHaveTextContent("Welcome to Willowbrook");
  });

  it("stays hidden until the saved words arrive, so the defaults never flash first", () => {
    gameConfig = null;
    renderHome();

    expect(screen.getByRole("heading", { level: 1, hidden: true })).toHaveClass("invisible");
  });

  it("paints the hero without waiting on the animation engine", async () => {
    // The engine loads lazily (LazyMotion in App.tsx), so anything framer
    // renders with `initial={{ opacity: 0 }}` stays invisible until that
    // chunk arrives. The hero is the first thing a visitor reads: its
    // entrance is CSS, which needs no script at all.
    storedHome = { hero: { headline: "A valley that remembers", subline: "Come and see" } };
    renderHome();

    const h1 = await headline();
    const subline = screen.getByText("Come and see").closest("p") as HTMLElement;
    const actions = hero().querySelector('a[href="#choose-path"]')?.parentElement as HTMLElement;
    for (const el of [h1, subline, actions]) {
      expect(el.style.opacity, el.tagName).toBe("");
      expect(el.className, el.tagName).toContain("hero-rise");
    }
  });

  it("carries no badge unless the village writes one", async () => {
    renderHome();
    await headline();
    expect(screen.queryByText(/co-create paradise/i)).toBeNull();
  });
});

describe("every field in the Home spec reaches the page", () => {
  it("renders a distinct marker typed into each field and each list row", async () => {
    // The Tagline bug, as a test: a field a founder can save but the page
    // never reads is a marker missing from the page.
    const doc = markerDocument(HOME_PAGE);
    storedHome = doc;
    renderHome();
    await headline();

    const text = document.body.textContent ?? "";
    const missing: string[] = [];
    for (const [sectionId, section] of Object.entries(doc)) {
      for (const [key, value] of Object.entries(section as Record<string, unknown>)) {
        const values = Array.isArray(value)
          ? value.flatMap((row) => Object.entries(row as Record<string, string>).filter(([k]) => k !== "id").map(([, v]) => v))
          : [value as string];
        for (const v of values) {
          // The gold phrase only exists inside the headline; a marker for it
          // is a separate word, so it is checked by the headline test above.
          if (sectionId === "hero" && key === "highlight") continue;
          if (!text.includes(v)) missing.push(`${sectionId}.${key} (${v})`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it("draws nothing of a section the village hid", async () => {
    storedHome = { personas: { hidden: true }, journey: { hidden: true } };
    renderHome();
    await headline();

    expect(screen.queryByText("People like you")).toBeNull();
    expect(screen.queryByText("From First Visit to Home")).toBeNull();
    expect(screen.getByText("Choose your path")).toBeInTheDocument();
  });

  it("keeps the anchor the hero button points at, even with the paths hidden", async () => {
    storedHome = { paths: { hidden: true } };
    renderHome();
    await headline();

    expect(document.getElementById("choose-path")).not.toBeNull();
  });

  it("gives a path card the alt text the founder wrote for its picture", async () => {
    useBrandImagesMock.mockReturnValue({ hero: "", investorHero: "/uploads/inv.webp", investorHeroAlt: "Hands planting a seedling" });
    renderHome();
    await headline();

    expect(screen.getByAltText("Hands planting a seedling")).toHaveAttribute("src", "/uploads/inv.webp");
  });

  it("fills {village} in the defaults", async () => {
    renderHome();
    await headline();

    expect(screen.getByText("Who Comes to Willowbrook?")).toBeInTheDocument();
  });
});

describe("the homepage hero when the village has added no art", () => {
  it("draws no picture and no placeholder mark", async () => {
    renderHome();
    await headline();

    expect(hero().querySelector("img")).toBeNull();
    // The mark Image draws is a role="img" wrapper. An empty village must
    // reach a visitor with nothing missing-looking in the hero at all.
    expect(hero().querySelector('[role="img"]')).toBeNull();
  });

  it("paints the copy on its own opaque band rather than on a fading scrim", async () => {
    // The band is what makes the contrast a property of two named colours
    // instead of a property of whatever photograph is behind it. It is
    // decorative, so it carries aria-hidden and no accessible name.
    renderHome();
    await headline();
    const band = hero().querySelector(".rounded-3xl.bg-teal-band");

    expect(band).toBeTruthy();
    expect(band).toHaveAttribute("aria-hidden", "true");
  });
});

describe("the homepage hero when the village HAS added art", () => {
  it("draws the picture, with the village's own alt text", async () => {
    useBrandImagesMock.mockReturnValue({
      hero: "/uploads/ridge.jpg",
      heroAlt: "Morning fog over the ridge",
    });

    renderHome();
    await headline();
    const img = hero().querySelector("img");

    expect(img).toHaveAttribute("src", "/uploads/ridge.jpg");
    expect(img).toHaveAttribute("alt", "Morning fog over the ridge");
  });

  it("keeps the accessible name when that picture fails to load", async () => {
    // A 404 on a file the village DID upload is real breakage, so it keeps
    // both the deliberate mark and the description. Removing the mark for
    // this case too would leave a sighted visitor with a blank hero and no
    // way to know the village's own photograph had gone missing.
    useBrandImagesMock.mockReturnValue({
      hero: "/uploads/gone.jpg",
      heroAlt: "Morning fog over the ridge",
    });

    renderHome();
    await headline();
    const img = hero().querySelector("img") as HTMLImageElement;
    fireEvent.error(img);

    await waitFor(() => {
      const mark = hero().querySelector('[role="img"]');
      expect(mark).toBeTruthy();
      expect(mark).toHaveAttribute("aria-label", "Morning fog over the ridge");
    });
  });
});
