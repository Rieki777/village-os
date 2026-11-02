// @vitest-environment jsdom
/**
 * Circles renders its words from its spec (shared/pageContent/circles.ts).
 *
 * THE WIRING TEST: a distinct marker typed into every field must reach the
 * page. Some fields only draw in one shape of village, so the page is read
 * twice and the text of both readings is pooled:
 *   - circles nested under one top circle, which draws the "linked" words
 *     with that circle's name filled in, and the top circle's own panel,
 *     which draws the line every other circle gets;
 *   - circles side by side, which draws the words that name no circle.
 * Beside it: a hidden section draws none of its words, and the circles
 * themselves, which are the village's rows, show whatever the words say.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Router } from "wouter";
import type { ReactNode } from "react";
import { CIRCLES_PAGE } from "@shared/pageContent/circles";
import { markerDocument } from "@shared/pageContent/resolve";

let stored: Record<string, unknown>;

vi.mock("@/components/Layout", () => ({
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("@/components/CircleScene", () => ({ default: () => null }));
vi.mock("@/components/CirclesMiniMap", () => ({ default: () => null }));
vi.mock("@/lib/gameApi", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  authToken: () => null,
  useGameConfig: () => ({ project: { name: "Willowbrook" }, currency: { name: "Thanks" } }),
}));
// The saved page, as GET /api/content/page-circles would answer it (absent = never saved).
vi.mock("@/hooks/useVillageContent", () => ({
  readVillageSection: (section: string) => Promise.resolve(stored[section] ?? null),
}));
vi.mock("@/modules/ModuleProvider", () => ({
  useModule: () => undefined,
  useModuleOn: () => false,
}));
vi.mock("@/components/natural/useReducedMotion", () => ({
  useReducedMotion: () => true,
  prefersReducedMotion: () => true,
}));

import Circles from "./Circles";

class NoopIntersectionObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}

const circle = (id: string, name: string, parentCircleId: string | null, status = "active") => ({
  id,
  name,
  purpose: `What ${name} looks after`,
  parentCircleId,
  decidesBy: null,
  color: "sage",
  status,
  isExample: false,
});

const seat = (id: string, name: string, circleId: string) => ({
  id,
  name,
  circleId,
  aim: `Keep the ${name.toLowerCase()} work going.`,
  domain: null,
  accountabilities: [],
  whyItMatters: null,
  seats: 1,
  holderCount: 0,
  state: "open",
  stateSource: "derived",
  criticality: "normal",
  recruiting: true,
  representsCircle: false,
  howChosen: null,
  howChosenGloss: null,
  termEnds: "2027-02-01T12:00:00.000Z",
  archetypes: [],
  isExample: false,
  holders: [],
});

/** Circles nested under the Hearth Council, one of them still forming. */
const NESTED = {
  people: { visible: true, membersOnly: false, signedIn: false },
  village: { decidesBy: "consent" },
  circles: [
    circle("hearth", "Hearth Council", null),
    circle("land", "Land & Water", "hearth"),
    circle("kitchen", "Kitchen Circle", "hearth", "forming"),
  ],
  roles: [seat("keeper", "Fire Keeper", "hearth"), seat("water", "Water Keeper", "land")],
};

/** Circles side by side: nobody's top circle. */
const FLAT = {
  ...NESTED,
  circles: [circle("land", "Land & Water", null), circle("care", "Care Circle", null, "forming")],
  roles: [seat("water", "Water Keeper", "land")],
};

let org: typeof NESTED;

beforeEach(() => {
  org = NESTED;
  stored = {};
  vi.stubGlobal("IntersectionObserver", NoopIntersectionObserver);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: unknown) => {
      const u = String(url);
      const reply = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
      if (u === "/api/org") return reply(org);
      return reply([]);
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const renderPage = () =>
  render(
    <Router>
      <Circles />
    </Router>,
  );
const openCircle = async (name: string) =>
  fireEvent.click((await screen.findByRole("heading", { level: 3, name })).closest("button")!);
/** A field's default, read off the spec, so a reworded default moves its test with it. */
const said = (sectionId: string, key = "heading") =>
  CIRCLES_PAGE.sections.find((s) => s.id === sectionId)!.fields.find((f) => f.key === key)!.default;

describe("every field in the Circles spec reaches the page", () => {
  it("renders a distinct marker typed into each field, across both shapes of village", async () => {
    const doc = markerDocument(CIRCLES_PAGE) as Record<string, Record<string, string>>;
    // A word with an explanation is found in the paragraph it explains, so the
    // paragraph saved carries both. Its own marker is what is looked for: the
    // explanations sit between the words on the page.
    stored["page-circles"] = { ...doc, hero: { ...doc.hero, intro: `${doc.hero.intro} ${doc.hero.firstTerm} and ${doc.hero.secondTerm}.` } };
    const seen: string[] = [];

    org = NESTED;
    renderPage();
    await openCircle("Land & Water");
    seen.push(document.body.textContent ?? "");
    await openCircle("Hearth Council");
    seen.push(document.body.textContent ?? "");
    cleanup();

    org = FLAT;
    renderPage();
    await openCircle("Land & Water");
    seen.push(document.body.textContent ?? "");

    const text = seen.join("\n");
    const missing: string[] = [];
    for (const [sectionId, section] of Object.entries(doc)) {
      for (const [key, value] of Object.entries(section)) if (!text.includes(value)) missing.push(`${sectionId}.${key} (${value})`);
    }
    expect(missing).toEqual([]);
  });

  it("gives each word with an explanation a button that opens it", async () => {
    stored["page-circles"] = {
      hero: { intro: "Our circles share the work of the farm.", firstTerm: "circles", firstTip: "A circle is a team.", secondTerm: "", secondTip: "" },
    };
    renderPage();
    await screen.findByRole("heading", { level: 1 });

    const trigger = screen.getByRole("button", { name: "circles" });
    expect(trigger).toHaveAttribute("aria-describedby");
    expect(document.getElementById(trigger.getAttribute("aria-describedby")!)?.textContent).toBe("A circle is a team.");
    expect(screen.getByText(/share the work of the farm\./)).toBeInTheDocument();
  });

  it("fills {coordinator} with the village's own top circle, and draws the side-by-side words where there is none", async () => {
    stored["page-circles"] = {
      card: { linked: "Linked to the {coordinator}.", flat: "Side by side." },
      together: { acrossLinked: "The **{coordinator}** meets monthly.", acrossFlat: "Every circle meets." },
    };
    renderPage();
    await openCircle("Land & Water");
    expect(document.body.textContent).toContain("Linked to the Hearth Council.");
    expect(screen.getByText("Hearth Council", { selector: "strong" })).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("Every circle meets.");
    cleanup();

    org = FLAT;
    renderPage();
    await openCircle("Land & Water");
    expect(document.body.textContent).toContain("Side by side.");
    expect(document.body.textContent).toContain("Every circle meets.");
    expect(document.body.textContent).not.toContain("{coordinator}");
  });

  it("draws nothing of a section the village hid, and every circle still shows", async () => {
    stored["page-circles"] = Object.fromEntries(CIRCLES_PAGE.sections.filter((s) => s.hideable).map((s) => [s.id, { hidden: true }]));
    renderPage();
    await openCircle("Land & Water");

    for (const hidden of ["today", "future", "together"]) expect(screen.queryByText(said(hidden)), hidden).toBeNull();
    expect(screen.queryByText(said("card", "label"))).toBeNull();
    expect(screen.queryByRole("link", { name: new RegExp(said("closing", "label")) })).toBeNull();
    for (const name of ["Hearth Council", "Land & Water", "Kitchen Circle"]) {
      expect(screen.getByRole("heading", { level: 3, name })).toBeInTheDocument();
    }
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(said("hero", "headline"));
  });

  it("leaves out a blank optional sentence and keeps the paragraph around it", async () => {
    stored["page-circles"] = { together: { first: "We share the work.", acrossLinked: "", after: "", second: "", thirdLinked: "" } };
    renderPage();
    await screen.findByRole("heading", { level: 3, name: "Land & Water" });

    expect(screen.getByText("We share the work.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: said("together") }).parentElement!.querySelectorAll("p")).toHaveLength(1);
  });
});

describe("the page with nothing saved", () => {
  /** What one village's page used to tell every village as its own. */
  const THEIRS = [/sociocra/i, /consent/i, /four leads/i, /Finance & Business/, /double.link/i, /tyranny/i, /elected representatives/i, /\{coordinator\}/];

  it("says the starter words, in the village's own name, and names its own top circle", async () => {
    renderPage();
    expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent(said("hero", "headline"));
    await openCircle("Land & Water");

    const text = document.body.textContent ?? "";
    expect(text).toContain(said("hero", "intro").replace("{village}", "Willowbrook").split(said("hero", "firstTerm"))[0]);
    expect(text).toContain(said("card", "linked").replace("{coordinator}", "Hearth Council"));
    for (const claim of THEIRS) expect(text, String(claim)).not.toMatch(claim);
  });

  it("names no circle where the circles sit side by side, and claims no method either", async () => {
    org = FLAT;
    renderPage();
    await openCircle("Land & Water");

    const text = document.body.textContent ?? "";
    expect(text).toContain(said("card", "flat"));
    expect(text).not.toContain("Hearth Council");
    for (const claim of THEIRS) expect(text, String(claim)).not.toMatch(claim);
  });
});
