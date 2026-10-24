// @vitest-environment jsdom
/**
 * The Good Neighbor page renders from its spec (shared/pageContent/goodNeighbor.ts).
 *
 * THE WIRING TEST is the one that matters: a distinct marker typed into every
 * field and every list row must reach the page. A field a founder can save and
 * the page never reads is a marker missing here, which is how the Home
 * Tagline bug is caught on this page next time.
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
import { GOOD_NEIGHBOR_PAGE } from "@shared/pageContent/goodNeighbor";
import { GOOD_NEIGHBOR_NAME_DEFAULT } from "@shared/pageContent/goodNeighborName";
import { fillVars, markerDocument } from "@shared/pageContent/resolve";
import { pageVarsFrom } from "@shared/pageContent/vars";

/*
 * A village that saved nothing reads the spec's defaults, neutral starter
 * text since 2026-10-23. These read them from the spec rather than typing
 * them again, so a later wording change moves no test.
 */
const section = (id: string) => GOOD_NEIGHBOR_PAGE.sections.find((s) => s.id === id)!;
const fieldDefault = (id: string, key: string) => section(id).fields.find((f) => f.key === key)!.default;
const listDefault = (id: string, key: string) => section(id).lists!.find((l) => l.key === key)!.default;
const filled = (text: string) =>
  fillVars(text, { ...pageVarsFrom(gameConfig ?? {}), "good-neighbor": GOOD_NEIGHBOR_NAME_DEFAULT });

let gameConfig: { project: Record<string, string>; currency: { name: string } } | null;
let eventsUrl: string;
let stored: Record<string, unknown>;

vi.mock("@/components/Layout", () => ({
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("@/lib/gameApi", () => ({
  useGameConfig: () => gameConfig,
  useVillageLinks: () => ({ siteUrl: "", eventsUrl, contactEmail: "", mailTo: () => "" }),
}));
// The saved pages, as GET /api/content/<section> would answer (null = never saved).
vi.mock("@/hooks/useVillageContent", () => ({
  readVillageSection: (section: string) => Promise.resolve(stored[section] ?? null),
}));

import GoodNeighbor from "./GoodNeighbor";

const renderPage = () =>
  render(
    <Router>
      <GoodNeighbor />
    </Router>,
  );
const headline = () => screen.findByRole("heading", { level: 1 });

beforeEach(() => {
  gameConfig = {
    project: { name: "Willowbrook", commitmentName: "Love Letter" },
    currency: { name: "Thanks" },
  };
  eventsUrl = "https://example.org/events";
  stored = {};
});

describe("every field in the Good Neighbor spec reaches the page", () => {
  it("renders a distinct marker typed into each field and each list row", async () => {
    const doc = markerDocument(GOOD_NEIGHBOR_PAGE);
    stored["page-good-neighbor"] = doc;
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
    stored["page-good-neighbor"] = { values: { hidden: true }, dealbreakers: { hidden: true }, process: { hidden: true } };
    renderPage();
    await headline();

    expect(screen.queryByText(filled(fieldDefault("values", "heading")))).toBeNull();
    expect(screen.queryByText(fieldDefault("dealbreakers", "heading"))).toBeNull();
    expect(screen.queryByText(fieldDefault("process", "heading"))).toBeNull();
    expect(screen.getByText("The Good Neighbor Criteria")).toBeInTheDocument();
  });

  it("draws the criteria a village wrote, and only those", async () => {
    stored["page-good-neighbor"] = {
      criteria: { items: [{ title: "Tend the Commons", subtitle: "Every week", description: "Show up.", practice2: "Bring a rake." }] },
    };
    renderPage();
    await headline();

    expect(screen.getByText("Tend the Commons")).toBeInTheDocument();
    expect(screen.getByText("Bring a rake.")).toBeInTheDocument();
    expect(screen.queryByText(listDefault("criteria", "items")[0].title)).toBeNull();
  });
});

describe("the Good Neighbor page with nothing saved", () => {
  it("draws the spec's starter words, with the village's own name filled in", async () => {
    renderPage();

    expect(await headline()).toHaveTextContent("Good Neighbor Criteria");
    expect(screen.getByText(fieldDefault("hero", "eyebrow"))).toBeInTheDocument();
    expect(screen.getByText(filled(fieldDefault("values", "heading")))).toBeInTheDocument();
    expect(screen.getByText(filled(listDefault("commitments", "items")[0].text))).toBeInTheDocument();
    expect(screen.getByText(/If you commit to the Good Neighbor Criteria, Willowbrook commits to you:/)).toBeInTheDocument();
  });

  it("states none of the founding village's own practices or facts as every village's (2026-10-23)", async () => {
    renderPage();
    await headline();
    const said = document.body.textContent ?? "";

    expect(said).not.toMatch(/Nonviolent Communication|\bNVC\b|R-Ikigai|Resident Circle|Children's Play Day|school pilot/);
    expect(said).not.toMatch(/30%|3-5 years|30-99 year|HOA/);
    expect(said).not.toMatch(/Buckminster Fuller/);
    // The work's pay is on its cards (Rye, 2026-10-23).
    expect(said).not.toMatch(/pay what their cards say/);
    expect(said).toContain("You propose contributions and take on quests and roles.");
  });

  it("asks a visitor to sign the village's own commitment, by its own name", async () => {
    renderPage();
    await headline();

    expect(screen.getByRole("link", { name: /Sign the Love Letter/ })).toHaveAttribute("href", "/love-letter");
    expect(screen.queryByText(/Membership Covenant/)).toBeNull();
  });

  it("follows a village whose commitment has another name", async () => {
    gameConfig = { project: { name: "Willowbrook", commitmentName: "Village Pact" }, currency: { name: "Thanks" } };
    renderPage();
    await headline();

    expect(screen.getByRole("link", { name: /Sign the Village Pact/ })).toBeInTheDocument();
  });

  it("drops the events button when the village has no events page", async () => {
    eventsUrl = "";
    renderPage();
    await headline();

    expect(screen.queryByText(fieldDefault("closing", "eventsLabel"))).toBeNull();
  });

  it("draws the events button while the village has an events page", async () => {
    renderPage();
    await headline();

    expect(screen.getByRole("link", { name: new RegExp(fieldDefault("closing", "eventsLabel")) })).toHaveAttribute(
      "href",
      "https://example.org/events",
    );
  });
});

describe("one name for the criteria", () => {
  it("renames every mention on the page when the village renames the headline", async () => {
    stored["page-good-neighbor"] = { hero: { name: "Our Village Agreements" } };
    renderPage();

    expect(await headline()).toHaveTextContent("Our Village Agreements");
    expect(screen.getByText("The Our Village Agreements")).toBeInTheDocument();
    expect(screen.getByText(/If you commit to the Our Village Agreements, Willowbrook commits/)).toBeInTheDocument();
    expect(screen.getByText(/The Our Village Agreements exist because/)).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("Good Neighbor Criteria");
  });
});
