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
 * WHAT IS ASSERTED: every line of copy in the section OUTSIDE the four action
 * cards (the header, the "Value In = Value Out" panel, the contribution loop),
 * in light and dark. Those were raised from cream/50 and cream/70 to clear AA.
 *
 * WHAT IS PENDING: the four action cards themselves. Their body text is
 * light-page ink on the band (1.17:1 measured at 393px), and their titles,
 * subtitles and links fail too (1.00 to 1.96). The fix is a design decision
 * held for Rye, because every option that passes changes how the cards look.
 * Option A (cards onto bg-teal-band) is built at commit 78ef635, with this
 * file's full card assertions, including 10 seeds x 6 character cards in both
 * schemes; restoring that commit's version of this file restores them. They
 * are `it.todo` here rather than skipped assertions, because this tree does
 * not meet them and a skipped assertion reads like coverage.
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

import { render, within } from "@testing-library/react";
import { Router } from "wouter";
import type { ReactNode } from "react";
import { describeFailures, measureText, type Scheme } from "@/test/tokenContrast";

vi.mock("@/components/Layout", () => ({
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("@/modules/ModuleProvider", () => ({
  useHypha: () => ({ configured: false, orgUrl: "", links: {} }),
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

/** The nearest element containing both nodes. */
function commonAncestor(a: Element, b: Element): Element {
  for (let e: Element | null = a; e; e = e.parentElement) if (e.contains(b)) return e;
  throw new Error("the two nodes share no ancestor");
}

/**
 * A copy of the Hypha section with the action cards removed. The cards are
 * found by their first and last titles, whose nearest common ancestor is the
 * grid that holds all four; a copy is measured so the rendered tree is left
 * alone for React to unmount.
 */
function hyphaSectionWithoutCards(): HTMLElement {
  render(
    <Router>
      <CoCreatorsGuide />
    </Router>,
  );
  const section = document.getElementById("hypha");
  if (!section) throw new Error("the co-creators guide rendered no #hypha section");
  const first = within(section).getByRole("heading", { name: "Start with an Agreement" });
  const last = within(section).getByRole("heading", { name: "Delegate Your Voice" });
  const grid = commonAncestor(first, last);
  const path: number[] = [];
  for (let e: Element = grid; e !== section; e = e.parentElement!) {
    path.unshift(Array.prototype.indexOf.call(e.parentElement!.children, e));
  }
  const copy = section.cloneNode(true) as HTMLElement;
  let target: Element = copy;
  path.forEach((i) => (target = target.children[i]));
  target.remove();
  return copy;
}

const SCHEMES: Scheme[] = ["light", "dark"];

describe.each(SCHEMES)("the Hypha section, %s scheme", (scheme) => {
  it("every line of copy outside the action cards clears its WCAG floor against the band", () => {
    const copy = hyphaSectionWithoutCards();
    const results = measureText(copy, scheme);
    expect(within(copy).queryByRole("heading", { name: "Start with an Agreement" })).toBeNull();
    // Header, panel and loop: well over a dozen lines, so an empty or wrong subtree fails here.
    expect(results.length).toBeGreaterThan(12);
    const failures = describeFailures(results);
    expect(failures, `${failures.length} lines under their floor:\n${failures.join("\n")}`).toEqual([]);
  });

  it.todo(
    "every Hypha action card's text, its body included, clears its WCAG floor against the card (held for Rye; option A with assertions at 78ef635)",
  );
});

describe("the Hypha action cards under a village's own brand", () => {
  it.todo("clear 4.5:1 on every card for every seed and character card, light and dark (held for Rye; see 78ef635)");
});
