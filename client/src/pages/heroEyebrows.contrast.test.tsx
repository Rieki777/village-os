// @vitest-environment jsdom
/**
 * The eyebrows on /prosperity, /investor and /steward-rights, in light. The
 * theme is fixed to light (client/src/App.tsx), so nothing here measures dark.
 *
 * Measured through client/src/test/tokenContrast.ts from the classes each line
 * and its ancestors actually carry, never from a class name. Gold, the ink two
 * of these carried, is 4.07:1 on the page ground and the third carried stock
 * amber-700 at 4.49; amber-ink is index.css's amber for text on light grounds.
 *
 * THE PHOTOGRAPH. jsdom paints nothing, and a hero photograph is a SIBLING of
 * the copy, never an ancestor, so the resolver cannot see it. On /prosperity
 * the photograph shows through under the eyebrow (at 393px, 54% of the pixels
 * under amber-ink scored below 4.5:1), and the fix is an opaque chip of the
 * page's own ground. Its test asks the question that fix answers: the hero's
 * copy is lifted onto a stand-in ground, black and then white, and the eyebrow
 * must clear 4.5:1 on both, which only an opaque ground of its own can give.
 * /investor's eyebrow has no chip and clears over today's photograph (lowest
 * pixel 4.92 from 320 to 1280px, measured in a browser); here it is measured
 * on the page ground, which holds the ink and says nothing about a photograph.
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

import { render, screen } from "@testing-library/react";
import { Router } from "wouter";
import type { ReactNode } from "react";
import { measureText, type TextContrast } from "@/test/tokenContrast";

vi.mock("@/components/Layout", () => ({
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("@/components/FaqSection", () => ({ default: () => null }));
vi.mock("@/components/WhyCostaRica", () => ({ default: () => null }));
vi.mock("@/components/InvestorSummary", () => ({ default: () => null }));
vi.mock("@/lib/gameApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/gameApi")>()),
  useBrandImages: () => ({ prosperityHero: "/hero.webp", investorHero: "/hero.webp" }),
  useVillageLinks: () => ({ siteUrl: "", eventsUrl: "", contactEmail: "", mailTo: () => "" }),
  useVillageSettings: () => null,
}));
vi.mock("@/hooks/useVillageName", () => ({ useVillageName: () => "Willowbrook" }));
vi.mock("@/hooks/useTokenNames", () => ({
  useTokenName: () => "Recognition",
  useValueTokenName: () => "Village Credits",
}));
vi.mock("@/lib/moneyClaims", () => ({ useValueConversion: () => "" }));

import ProsperityJourney from "./ProsperityJourney";
import InvestorJourney from "./InvestorJourney";
import StewardRights from "./StewardRights";

beforeEach(() => {
  vi.stubGlobal("IntersectionObserver", NoopIntersectionObserver);
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({}) })));
});
afterEach(() => vi.unstubAllGlobals());

const FLOOR = 4.5;

/** The one measured line whose own text is `text`. */
function line(results: TextContrast[], text: string): TextContrast {
  const want = text.replace(/\s+/g, " ").trim().toLowerCase();
  const hits = results.filter((r) => r.text.toLowerCase() === want);
  expect(hits, `expected exactly one line reading "${text}"`).toHaveLength(1);
  return hits[0];
}

/**
 * The eyebrow measured inside a copy of the hero's copy block (its ancestor
 * that is a direct child of the section), placed on a stand-in ground where
 * the photograph would be. The copy is attached so its ancestors resolve, and
 * removed again.
 */
function onStandIn(eyebrow: HTMLElement, ground: "bg-black" | "bg-white"): TextContrast {
  const section = eyebrow.closest("section");
  if (!section) throw new Error("the eyebrow sits in no section");
  let block: Element = eyebrow;
  while (block.parentElement !== section) block = block.parentElement!;
  const wrapper = document.createElement("div");
  wrapper.setAttribute("class", ground);
  wrapper.appendChild(block.cloneNode(true));
  document.body.appendChild(wrapper);
  try {
    return line(measureText(wrapper, "light"), eyebrow.textContent ?? "");
  } finally {
    wrapper.remove();
  }
}

/** The eyebrow measured where it renders; its row is the root, since measureText reads descendants. */
const inPlace = (eyebrow: HTMLElement) => line(measureText(eyebrow.parentElement!, "light"), eyebrow.textContent ?? "");

describe("the /prosperity hero eyebrow, light", () => {
  it.each(["bg-black", "bg-white"] as const)(
    "clears 4.5:1 whatever paints the hero behind it (stand-in: %s)",
    (ground) => {
      render(
        <Router>
          <ProsperityJourney />
        </Router>,
      );
      const measured = onStandIn(screen.getByText("Prosperity Creator Journey"), ground);
      expect(measured.ratio, `${measured.fg} on ${measured.bg}`).toBeGreaterThanOrEqual(FLOOR);
    },
  );
});

describe("the eyebrows on the page ground, light", () => {
  it("/investor: clears 4.5:1", () => {
    render(
      <Router>
        <InvestorJourney />
      </Router>,
    );
    const measured = inPlace(screen.getByText("Capital Contributor Journey"));
    expect(measured.ratio, `${measured.fg} on ${measured.bg}`).toBeGreaterThanOrEqual(FLOOR);
  });

  it("/steward-rights: clears 4.5:1", () => {
    render(
      <Router>
        <StewardRights />
      </Router>,
    );
    const measured = inPlace(screen.getByText("Your Path Forward"));
    expect(measured.ratio, `${measured.fg} on ${measured.bg}`).toBeGreaterThanOrEqual(FLOOR);
  });
});
