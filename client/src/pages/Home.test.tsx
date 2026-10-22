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

import { fireEvent, render, screen } from "@testing-library/react";
import { Router } from "wouter";
import type { ReactNode } from "react";

const useBrandImagesMock = vi.fn();
let gameConfig: { project: { tagline: string } } | null = { project: { tagline: "" } };

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
  useVillageLinks: () => ({ siteUrl: "", eventsUrl: "", contactEmail: "", mailTo: () => "" }),
  altOr: (value: string | undefined, fallback: string) =>
    typeof value === "string" ? value : fallback,
}));
vi.mock("@/hooks/useVillageName", () => ({
  useVillageName: () => "Willowbrook",
  useVillageLocation: () => "",
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

describe("the homepage headline", () => {
  beforeEach(() => {
    useBrandImagesMock.mockReset();
    useBrandImagesMock.mockReturnValue({ hero: "" });
  });

  it("is the village's own Tagline from the Setup Wizard", () => {
    gameConfig = { project: { tagline: "Grow the village together" } };
    renderHome();
    gameConfig = { project: { tagline: "" } };

    const h1 = screen.getByRole("heading", { level: 1 });
    expect(h1).toHaveTextContent("Grow the village together");
    expect(h1).not.toHaveTextContent(/Co-Become/);
  });

  it("stays hidden until the config arrives, so the old words never flash", () => {
    gameConfig = null;
    renderHome();
    gameConfig = { project: { tagline: "" } };

    expect(screen.getByRole("heading", { level: 1, hidden: true })).toHaveClass("invisible");
  });

  it("carries no badge above it", () => {
    renderHome();

    expect(screen.queryByText(/co-create paradise/i)).toBeNull();
  });
});

describe("the homepage hero when the village has added no art", () => {
  beforeEach(() => useBrandImagesMock.mockReset());

  it("draws no picture and no placeholder mark", () => {
    useBrandImagesMock.mockReturnValue({ hero: "" });

    renderHome();

    expect(hero().querySelector("img")).toBeNull();
    // The mark Image draws is a role="img" wrapper. An empty village must
    // reach a visitor with nothing missing-looking in the hero at all.
    expect(hero().querySelector('[role="img"]')).toBeNull();
  });

  it("still says what the village is, which is the part that was never missing", () => {
    useBrandImagesMock.mockReturnValue({ hero: "" });

    renderHome();

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      /Co-Become the Most Beautiful Village/i,
    );
  });

  it("paints the copy on its own opaque band rather than on a fading scrim", () => {
    // The band is what makes the contrast a property of two named colours
    // instead of a property of whatever photograph is behind it. It is
    // decorative, so it carries aria-hidden and no accessible name.
    useBrandImagesMock.mockReturnValue({ hero: "" });

    renderHome();
    const band = hero().querySelector(".rounded-3xl.bg-teal-band");

    expect(band).toBeTruthy();
    expect(band).toHaveAttribute("aria-hidden", "true");
  });
});

describe("the homepage hero when the village HAS added art", () => {
  beforeEach(() => useBrandImagesMock.mockReset());

  it("draws the picture, with the village's own alt text", () => {
    useBrandImagesMock.mockReturnValue({
      hero: "/uploads/ridge.jpg",
      heroAlt: "Morning fog over the ridge",
    });

    renderHome();
    const img = hero().querySelector("img");

    expect(img).toHaveAttribute("src", "/uploads/ridge.jpg");
    expect(img).toHaveAttribute("alt", "Morning fog over the ridge");
  });

  it("keeps the accessible name when that picture fails to load", () => {
    // A 404 on a file the village DID upload is real breakage, so it keeps
    // both the deliberate mark and the description. Removing the mark for
    // this case too would leave a sighted visitor with a blank hero and no
    // way to know the village's own photograph had gone missing.
    useBrandImagesMock.mockReturnValue({
      hero: "/uploads/gone.jpg",
      heroAlt: "Morning fog over the ridge",
    });

    renderHome();
    const img = hero().querySelector("img") as HTMLImageElement;
    fireEvent.error(img);

    const mark = hero().querySelector('[role="img"]');
    expect(mark).toBeTruthy();
    expect(mark).toHaveAttribute("aria-label", "Morning fog over the ridge");
  });
});
