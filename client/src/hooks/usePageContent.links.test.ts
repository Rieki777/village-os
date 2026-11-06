/**
 * A story page switched off on its own takes the buttons that lead to it off
 * every other story page (`withoutLinksToHiddenPages`, usePageContent.ts).
 *
 * The resident journey is the worked case: its hero, two of its steps and its
 * closing all point at /housing by default, beside buttons that point at
 * /visit and at the page's own anchors, which must all survive.
 */
import { describe, expect, it } from "vitest";
import { withoutLinksToHiddenPages } from "./usePageContent";
import { JOURNEY_PAGES } from "@shared/pageContent/journeys";
import { resolvePage } from "@shared/pageContent/resolve";
import type { ResolvedPage } from "@shared/pageContent/types";

const RESIDENT = JOURNEY_PAGES.find((p) => p.path === "/resident")!;
const page = resolvePage(RESIDENT, null, { village: "Willowbrook", tagline: "", location: "", commitment: "Pledge" });

/** Every link box on the page, with where it points. */
function links(p: ResolvedPage): string[] {
  const out: string[] = [];
  for (const section of RESIDENT.sections) {
    for (const f of section.fields) if (f.kind === "link") out.push(p[section.id].fields[f.key]);
    for (const list of section.lists ?? []) {
      const keys = list.fields.filter((f) => f.kind === "link").map((f) => f.key);
      for (const row of p[section.id].lists[list.key]) for (const k of keys) out.push(row[k]);
    }
  }
  return out;
}

describe("a link box pointing at a page that is switched off", () => {
  it("is left blank, so the button it fills is not drawn", () => {
    expect(links(page)).toContain("/housing");
    const off = withoutLinksToHiddenPages(RESIDENT, page, (href) => href.split(/[?#]/)[0] !== "/housing");
    expect(links(off)).not.toContain("/housing");
  });

  it("leaves every other link alone, the control for the case above", () => {
    const off = withoutLinksToHiddenPages(RESIDENT, page, (href) => href !== "/housing");
    const before = links(page).filter((l) => l !== "/housing");
    expect(links(off).filter((l) => l !== "")).toEqual(before.filter((l) => l !== ""));
    expect(links(off)).toContain("/visit");
    expect(links(off)).toContain("#events");
  });

  it("changes nothing at all while every page is served", () => {
    expect(withoutLinksToHiddenPages(RESIDENT, page, () => true)).toEqual(page);
  });
});
