// @vitest-environment jsdom
/**
 * The Co-Creators Guide renders from its spec (shared/pageContent/coCreatorsGuide.ts).
 *
 * THE WIRING TEST: a distinct marker typed into every field and every list row
 * must reach the page. Beside it, the defects this conversion fixed, each
 * pinned so it cannot come back:
 *   - "Open Hypha Platform" went to one shared address for every village and
 *     showed with no Hypha space at all;
 *   - an instruction to admins ("Add this village's Hypha DHO link...") was
 *     printed to every visitor;
 *   - the closing slogan was compiled in;
 *   - the token section said what the token does (Rye, 2026-10-22).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

class NoopIntersectionObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}
vi.stubGlobal("IntersectionObserver", NoopIntersectionObserver);

import { render, screen, within } from "@testing-library/react";
import { Router } from "wouter";
import type { ReactNode } from "react";
import { CO_CREATORS_GUIDE_PAGE } from "@shared/pageContent/coCreatorsGuide";
import { fillVars, markerDocument } from "@shared/pageContent/resolve";
import { pageVarsFrom } from "@shared/pageContent/vars";

const DHO = "https://dho.example.org/willowbrook";

/*
 * The words a village that saved nothing sees are the spec's defaults, which
 * are neutral starter text since 2026-10-23. These read them from the spec
 * rather than typing them again, so a later wording change moves no test; the
 * few words a ruling fixes are pinned as such, below.
 */
const section = (id: string) => CO_CREATORS_GUIDE_PAGE.sections.find((s) => s.id === id)!;
const fieldDefault = (id: string, key: string) => section(id).fields.find((f) => f.key === key)!.default;
const listDefault = (id: string, key: string) => section(id).lists!.find((l) => l.key === key)!.default;
/** A default as this test's village reads it. */
const filled = (text: string) => fillVars(text, pageVarsFrom(gameConfig ?? {}));

let gameConfig: { project: Record<string, string>; currency: { name: string; value?: { name: string } } } | null;
let eventsUrl: string;
let stored: Record<string, unknown>;
let hyphaConfigured: boolean;
let isAdmin: boolean;

vi.mock("@/components/Layout", () => ({
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("@/lib/gameApi", () => ({
  useGameConfig: () => gameConfig,
  useVillageLinks: () => ({ siteUrl: "", eventsUrl, contactEmail: "", mailTo: () => "" }),
  // What quests and roles pay is read from the work (EarningsFromTheWork); nothing answers here.
  gameFetch: async () => ({ ok: false, status: 404, json: async () => null }),
}));
vi.mock("@/hooks/useVillageContent", () => ({
  readVillageSection: (section: string) => Promise.resolve(stored[section] ?? null),
}));
vi.mock("@/modules/ModuleProvider", () => ({
  useHypha: () => (hyphaConfigured ? { configured: true, orgUrl: DHO, links: {} } : { configured: false, orgUrl: "", links: {} }),
}));
vi.mock("@/contexts/AuthContext", () => ({ useIsAdmin: () => isAdmin }));

import CoCreatorsGuide from "./CoCreatorsGuide";

const renderPage = () =>
  render(
    <Router>
      <CoCreatorsGuide />
    </Router>,
  );
const headline = () => screen.findByRole("heading", { level: 1 });

beforeEach(() => {
  gameConfig = {
    project: { name: "Willowbrook", commitmentName: "Love Letter" },
    currency: { name: "Thanks", value: { name: "Seeds" } },
  };
  eventsUrl = "https://example.org/events";
  stored = {};
  hyphaConfigured = false;
  isAdmin = false;
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, json: async () => null })));
});

describe("every field in the Co-Creators Guide spec reaches the page", () => {
  it("renders a distinct marker typed into each field and each list row", async () => {
    hyphaConfigured = true;
    const doc = markerDocument(CO_CREATORS_GUIDE_PAGE);
    stored["page-co-creators-guide"] = doc;
    renderPage();
    await headline();

    const text = document.body.textContent ?? "";
    const missing: string[] = [];
    for (const [sectionId, section] of Object.entries(doc)) {
      for (const [key, value] of Object.entries(section as Record<string, unknown>)) {
        const values = Array.isArray(value)
          ? value.flatMap((row) => Object.entries(row as Record<string, string>).filter(([k]) => k !== "id").map(([, v]) => v))
          : [value as string];
        for (const v of values) if (!text.includes(v)) missing.push(`${sectionId}.${key} (${v})`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("draws nothing of a section the village hid, its pill in the section bar included", async () => {
    stored["page-co-creators-guide"] = { ikigai: { hidden: true }, spaces: { hidden: true }, closing: { hidden: true } };
    renderPage();
    await headline();

    expect(screen.queryByText(fieldDefault("ikigai", "heading"))).toBeNull();
    expect(screen.queryByRole("button", { name: fieldDefault("ikigai", "navLabel") })).toBeNull();
    expect(screen.queryByText(fieldDefault("spaces", "heading"))).toBeNull();
    expect(document.body.textContent).not.toContain(filled(fieldDefault("closing", "quote")));
    expect(screen.getByRole("button", { name: fieldDefault("voice", "navLabel") })).toBeInTheDocument();
  });
});

describe("the Hypha section", () => {
  it("is not drawn, and has no pill, while the village has no Hypha DHO link", async () => {
    renderPage();
    await headline();

    expect(document.getElementById("hypha")).toBeNull();
    expect(screen.queryByRole("button", { name: fieldDefault("hypha", "navLabel") })).toBeNull();
    expect(screen.queryByText(fieldDefault("hypha", "openLabel"))).toBeNull();
  });

  it("opens the village's own Hypha space, never a shared address", async () => {
    hyphaConfigured = true;
    renderPage();
    await headline();

    const open = screen.getByRole("link", { name: new RegExp(fieldDefault("hypha", "openLabel")) });
    expect(open).toHaveAttribute("href", DHO);
    expect(document.body.innerHTML).not.toContain("app.hypha.earth");
    expect(screen.getByRole("link", { name: /Create Agreement/ })).toHaveAttribute("href", `${DHO}/agreements/create`);
  });

  it("never prints the admin's instruction to a visitor", async () => {
    renderPage();
    await headline();
    expect(document.body.textContent).not.toMatch(/Hypha DHO link/);

    hyphaConfigured = true;
    isAdmin = true;
    renderPage();
    await screen.findAllByRole("heading", { level: 1 });
    expect(document.body.textContent).not.toMatch(/Hypha DHO link/);
  });

  it("tells a signed-in admin where to set the link while there is none", async () => {
    isAdmin = true;
    renderPage();
    await headline();

    expect(screen.getByText(/Only admins see this note/)).toHaveTextContent("Admin, Variables");
  });
});

describe("the token section (Rye, 2026-10-22)", () => {
  it("names the token, says its rules are the village's, and links to them", async () => {
    renderPage();
    await headline();
    const section = document.getElementById("recognition") as HTMLElement;

    expect(within(section).getByRole("heading", { level: 2 })).toHaveTextContent(/^Thanks$/);
    expect(
      within(section).getByText(
        "Every quest and role shows what it is worth on its own card. Thanks is recognition from the community, and Willowbrook sets its own rules for it and its other tokens.",
      ),
    ).toBeInTheDocument();
    expect(within(section).getByRole("link", { name: /See how they work here/ })).toHaveAttribute("href", "/game-mechanics");
    expect(screen.getByRole("button", { name: "Thanks" })).toBeInTheDocument();
    // The live card of the open work stays, under its 2026-10-23 title.
    expect(within(section).getByText(fieldDefault("recognition", "cardTitle"))).toBeInTheDocument();
    expect(section.textContent).not.toMatch(/get paid/i);
  });

  it("says nothing about what a token does", async () => {
    hyphaConfigured = true;
    renderPage();
    await headline();
    const said = document.body.textContent ?? "";

    expect(said).not.toMatch(/pool/i);
    expect(said).not.toMatch(/no financial value/i);
    expect(said).not.toMatch(/Give and receive/);
    expect(said).not.toMatch(/Pay, and/);
    expect(said).not.toContain("Seeds");
    expect(said).not.toMatch(/claim Thanks/);
    expect(said).not.toMatch(/level of Thanks/);
    expect(said).toContain("Do the work. Document it. Share what you created with the community.");
    expect(said).toContain(filled(listDefault("spaces", "items")[2].description));
  });
});

describe("the pay ruling (Rye, 2026-10-23): the cards say what work pays, so no sentence here does", () => {
  it("draws the words the ruling set, word for word", async () => {
    hyphaConfigured = true;
    renderPage();
    await headline();

    expect(screen.getByText("Open quests and roles")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Claim Your Contribution" })).toBeInTheDocument();
    expect(screen.getByText("After completing a task or season")).toBeInTheDocument();
    expect(document.body.textContent).toContain(
      "Detail what you delivered and what Willowbrook gained. This is how the value you create becomes visible.",
    );
    expect(screen.getByText("The roles and quests Willowbrook needs, each on its own card.")).toBeInTheDocument();
  });

  it("says nowhere that work is paid", async () => {
    hyphaConfigured = true;
    renderPage();
    await headline();
    const said = document.body.textContent ?? "";

    expect(said).not.toMatch(/get paid|What PAYS|claim the tokens|pays what its card says|Claim Your Tokens/i);
  });
});

describe("words the village owns", () => {
  it("keeps the closing words as an editable default, and draws the village's own instead", async () => {
    renderPage();
    await headline();
    expect(document.body.textContent).toContain(filled(fieldDefault("closing", "quote")));
    // The founding village's slogan is its own words now, never a default.
    expect(document.body.textContent).not.toMatch(/co-become|Infinite Game/);
  });

  it("draws the village's own closing words", async () => {
    stored["page-co-creators-guide"] = { closing: { quote: "We keep the river clean." } };
    renderPage();
    await headline();

    expect(screen.getByText(/We keep the river clean\./)).toBeInTheDocument();
    expect(document.body.textContent).not.toContain(filled(fieldDefault("closing", "quote")));
  });

  it("calls the commitment by the village's own name", async () => {
    renderPage();
    await headline();

    const card = filled(listDefault("cta", "cards")[0].title);
    expect(card).toContain("Love Letter");
    expect(screen.getByText(card)).toBeInTheDocument();
    // The platform's own word for it never shows beside the village's.
    expect(document.body.textContent).not.toMatch(/membership agreement/);
  });

  it("names the criteria with the name the Good Neighbor page gives them", async () => {
    stored["page-good-neighbor"] = { hero: { name: "Our Village Agreements" } };
    renderPage();
    await headline();
    const section = document.getElementById("good-neighbor") as HTMLElement;

    expect(within(section).getByRole("heading", { level: 2 })).toHaveTextContent("Our Village Agreements");
    expect(within(section).getByText(/The Our Village Agreements are essential/)).toBeInTheDocument();
    expect(within(section).getByRole("link", { name: /Read the Full Our Village Agreements/ })).toHaveAttribute("href", "/good-neighbor");
  });
});
