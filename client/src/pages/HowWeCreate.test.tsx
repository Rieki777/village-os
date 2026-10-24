// @vitest-environment jsdom
/**
 * How We Create renders from its spec (shared/pageContent/howWeCreate.ts).
 *
 * THE WIRING TEST: a distinct marker typed into every field and every list row
 * must reach the page, with Hypha configured so its section draws. Beside it,
 * the three things this conversion changed on purpose: the token section names
 * the token and says nothing about what it does (Rye, 2026-10-22), the Hypha
 * section follows whether the village has a Hypha space, and the slogan under
 * the headline is an ordinary field.
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

import { render, screen } from "@testing-library/react";
import { Router } from "wouter";
import type { ReactNode } from "react";
import { HOW_WE_CREATE_PAGE } from "@shared/pageContent/howWeCreate";
import { markerDocument } from "@shared/pageContent/resolve";

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
}));
vi.mock("@/hooks/useVillageContent", () => ({
  readVillageSection: (section: string) => Promise.resolve(stored[section] ?? null),
}));
vi.mock("@/modules/ModuleProvider", () => ({
  useHypha: () =>
    hyphaConfigured
      ? { configured: true, orgUrl: "https://dho.example.org/willowbrook", links: {} }
      : { configured: false, orgUrl: "", links: {} },
}));
vi.mock("@/contexts/AuthContext", () => ({ useIsAdmin: () => isAdmin }));

import HowWeCreate from "./HowWeCreate";

const renderPage = () =>
  render(
    <Router>
      <HowWeCreate />
    </Router>,
  );
const headline = () => screen.findByRole("heading", { level: 1 });

beforeEach(() => {
  gameConfig = { project: { name: "Willowbrook" }, currency: { name: "Thanks", value: { name: "Seeds" } } };
  eventsUrl = "https://example.org/events";
  stored = {};
  hyphaConfigured = false;
  isAdmin = false;
});

describe("every field in the How We Create spec reaches the page", () => {
  it("renders a distinct marker typed into each field and each list row", async () => {
    hyphaConfigured = true;
    const doc = markerDocument(HOW_WE_CREATE_PAGE);
    stored["page-how-we-create"] = doc;
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

  it("draws nothing of a section the village hid", async () => {
    hyphaConfigured = true;
    stored["page-how-we-create"] = { governance: { hidden: true }, seasons: { hidden: true }, hypha: { hidden: true } };
    renderPage();
    await headline();

    expect(screen.queryByText("Our Governance Structure")).toBeNull();
    // "Seasonal Rhythm" is also a principle card's title, so the section is found by its own words.
    expect(screen.queryByText(/Each season is its own chapter/)).toBeNull();
    expect(screen.queryByText("Winter Season")).toBeNull();
    expect(screen.queryByText("Flexible Governance with Hypha")).toBeNull();
    expect(screen.getByText("Our Tokens")).toBeInTheDocument();
  });
});

describe("the page with nothing saved", () => {
  it("keeps today's words, the slogan and the circles count among them, as editable defaults", async () => {
    renderPage();

    expect(await headline()).toHaveTextContent("How We Create Together");
    expect(screen.getByText(/designed to ensure all beings belong and thrive\./)).toBeInTheDocument();
    expect(screen.getByText("8 Sociocratic Circles take active role")).toBeInTheDocument();
    expect(screen.getByText("Community Advisory Council shapes culture")).toBeInTheDocument();
  });

  it("says what the village wrote under the headline instead of the slogan", async () => {
    stored["page-how-we-create"] = { hero: { intro: "We decide together, slowly." } };
    renderPage();
    await headline();

    expect(screen.getByText("We decide together, slowly.")).toBeInTheDocument();
    expect(screen.queryByText(/all beings belong and thrive/)).toBeNull();
  });
});

describe("the token section (Rye, 2026-10-22)", () => {
  it("names the token, says its rules are the village's, and links to them", async () => {
    renderPage();
    await headline();

    expect(screen.getByRole("heading", { name: "Our Tokens" })).toBeInTheDocument();
    expect(screen.getByText("Willowbrook keeps its own tokens, Thanks among them. Their rules are the community's to design.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /See how they work here/ })).toHaveAttribute("href", "/game-mechanics");
    expect(screen.getByRole("heading", { name: "Thanks" })).toBeInTheDocument();
  });

  it("says nothing about what a token does", async () => {
    renderPage();
    await headline();
    const said = document.body.textContent ?? "";

    expect(said).not.toMatch(/pool/i);
    expect(said).not.toMatch(/no financial value/i);
    expect(said).not.toMatch(/Nobody buys or sells/);
    expect(said).not.toMatch(/Two tokens/);
    expect(said).not.toMatch(/pay in cash/);
    expect(said).not.toContain("Seeds");
  });
});

describe("the Hypha section follows the village's Hypha space", () => {
  it("is not drawn while the village has no Hypha DHO link", async () => {
    renderPage();
    await headline();

    expect(screen.queryByText("Flexible Governance with Hypha")).toBeNull();
    expect(screen.queryByText("How Hypha Enables This")).toBeNull();
  });

  it("is drawn, decision methods and all, once the link is set", async () => {
    hyphaConfigured = true;
    renderPage();
    await headline();

    expect(screen.getByText("Flexible Governance with Hypha")).toBeInTheDocument();
    expect(screen.getByText("Advice Process")).toBeInTheDocument();
    expect(screen.getByText("How Hypha Enables This")).toBeInTheDocument();
  });

  it("tells an admin, and only an admin, why it is missing", async () => {
    renderPage();
    await headline();
    expect(screen.queryByText(/Only admins see this note/)).toBeNull();

    isAdmin = true;
    renderPage();
    expect(await screen.findByText(/Only admins see this note/)).toHaveTextContent("Admin, Variables");
  });
});
