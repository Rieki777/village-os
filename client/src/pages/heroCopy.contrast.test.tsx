// @vitest-environment jsdom
/**
 * The hero copy on /prosperity and /investor (eyebrow, heading, paragraph),
 * and the /steward-rights eyebrow, in light. The theme is fixed to light
 * (client/src/App.tsx), so nothing here measures dark.
 *
 * Measured through client/src/test/tokenContrast.ts from the classes each line
 * and its ancestors actually carry, never from a class name.
 *
 * THE PHOTOGRAPH. Both heroes sit over a photograph that showed through under
 * their copy at phone widths (the /prosperity eyebrow had 54% of its pixels
 * under 4.5:1 at 393px, the /investor paragraph a lowest pixel of 3.59). jsdom
 * paints nothing, and a photograph is whatever a village uploads, so the copy
 * is measured on two stand-ins for it, black and white: only an opaque ground
 * of its own passes both.
 *
 * THE BAND. That ground is an opaque band drawn behind the copy, Home's
 * structure: an `aria-hidden` element with no text, absolutely positioned as a
 * SIBLING of the lines it sits behind. The resolver walks ancestors, so the
 * test lifts each such backdrop into an ancestor of the copy before measuring;
 * its colour and its opacity are then what the lines are measured against.
 * That the band COVERS the copy is geometry, which jsdom cannot see; it was
 * measured from rendered pixels at 320, 393, 768 and 1280px.
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
import { describeFailures, measureText, type TextContrast } from "@/test/tokenContrast";

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

/** An element's own text, the way measureText reads it. */
const ownText = (el: Element) =>
  Array.from(el.childNodes)
    .filter((n) => n.nodeType === 3)
    .map((n) => n.nodeValue ?? "")
    .join("")
    .replace(/\s+/g, " ")
    .trim();

/** The measured lines whose own text is one of `texts`, one each. */
function lines(results: TextContrast[], texts: string[]): TextContrast[] {
  return texts.map((text) => {
    const hits = results.filter((r) => r.text === text);
    expect(hits, `expected exactly one line reading "${text.slice(0, 40)}"`).toHaveLength(1);
    return hits[0];
  });
}

const STAND_INS = ["bg-black", "bg-white"] as const;

/**
 * The hero's copy block (the eyebrow's ancestor that is a direct child of the
 * section's container) copied onto a stand-in for the photograph, with any
 * backdrop drawn behind the copy lifted into an ancestor of it, then measured.
 */
function measureOnStandIn(eyebrow: HTMLElement, standIn: (typeof STAND_INS)[number]): TextContrast[] {
  const section = eyebrow.closest("section");
  if (!section) throw new Error("the eyebrow sits in no section");
  let block: Element = eyebrow;
  while (block.parentElement && block.parentElement.parentElement !== section) block = block.parentElement;
  const copy = block.cloneNode(true) as Element;
  const backdrops = Array.from(copy.children).filter(
    (c) => c.getAttribute("aria-hidden") === "true" && !(c.textContent ?? "").trim(),
  );
  let host: Element = document.createElement("div");
  host.setAttribute("class", standIn);
  const root = host;
  for (const b of backdrops) {
    b.remove();
    host.appendChild(b);
    host = b;
  }
  host.appendChild(copy);
  document.body.appendChild(root);
  try {
    return measureText(root, "light");
  } finally {
    root.remove();
  }
}

/** The eyebrow, every line of the h1, and the paragraph under it. */
function heroLines(eyebrowText: string): { eyebrow: HTMLElement; texts: string[] } {
  const eyebrow = screen.getByText(eyebrowText);
  const h1 = screen.getByRole("heading", { level: 1 });
  const paragraph = h1.nextElementSibling;
  if (!paragraph || paragraph.tagName !== "P") throw new Error("no paragraph follows the hero heading");
  const texts = [eyebrow, h1, ...Array.from(h1.querySelectorAll("*")), paragraph].map(ownText).filter((t) => t.length > 1);
  return { eyebrow, texts };
}

const HEROES = [
  { page: "/prosperity", Page: ProsperityJourney, eyebrow: "Prosperity Creator Journey" },
  { page: "/investor", Page: InvestorJourney, eyebrow: "Capital Contributor Journey" },
] as const;

describe.each(HEROES)("the $page hero copy, light", ({ Page, eyebrow: eyebrowText }) => {
  it.each(STAND_INS)(
    "eyebrow, heading and paragraph each clear their floor whatever paints the hero behind them (stand-in: %s)",
    (standIn) => {
      render(
        <Router>
          <Page />
        </Router>,
      );
      const { eyebrow, texts } = heroLines(eyebrowText);
      // Eyebrow, the heading's two runs, the paragraph.
      expect(texts.length).toBeGreaterThanOrEqual(4);
      const measured = lines(measureOnStandIn(eyebrow, standIn), texts);
      // The heading is large text at every width (36px at its smallest), so its floor is 3:1; the rest is 4.5.
      const failures = describeFailures(measured);
      expect(failures, `${failures.length} lines under their floor:\n${failures.join("\n")}`).toEqual([]);
    },
  );
});

describe("the /steward-rights eyebrow, light", () => {
  it("clears 4.5:1 on the page ground", () => {
    render(
      <Router>
        <StewardRights />
      </Router>,
    );
    const eyebrow = screen.getByText("Your Path Forward");
    const [measured] = lines(measureText(eyebrow.parentElement!, "light"), [ownText(eyebrow)]);
    expect(measured.ratio, `${measured.fg} on ${measured.bg}`).toBeGreaterThanOrEqual(4.5);
  });
});
