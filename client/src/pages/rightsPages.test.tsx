// @vitest-environment jsdom
/**
 * The two rights pages render every word from their specs
 * (shared/pageContent/rights.ts), hide what a village hides, and say what
 * Rye approved about tokens on 2026-10-22 (TOKEN_COPY_PROPOSAL rows 15-20).
 *
 * THE WIRING TEST is the marker one: a distinct marker typed into every field
 * and every list row must reach the page. A field a founder can save that the
 * page never reads is a marker missing from the page, which is how the Home
 * Tagline bug would have been caught.
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
import type { ComponentType, ReactNode } from "react";
import { RIGHTS_RESIDENT_PAGE, RIGHTS_STEWARD_PAGE } from "@shared/pageContent/rights";
import { markerDocument } from "@shared/pageContent/resolve";
import { pageSectionKey, type PageSpec } from "@shared/pageContent/types";

let stored: Record<string, unknown>;
let legal: Record<string, unknown> | null;

vi.mock("@/components/Layout", () => ({
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("@/lib/gameApi", () => ({
  useGameConfig: () => ({ project: { name: "Willowbrook" }, currency: { name: "Thanks", value: { name: "Seeds" } } }),
}));
vi.mock("@/hooks/useVillageContent", () => ({
  // The saved page, as GET /api/content/page-<id> would answer it (null = never saved).
  readVillageSection: (section: string) => Promise.resolve(stored[section] ?? null),
  useVillageContent: (section: string) =>
    section === "legal"
      ? { content: legal, loading: false, isPlaceholder: !legal }
      : { content: null, loading: false, isPlaceholder: true },
}));

import ResidentRights from "./ResidentRights";
import StewardRights from "./StewardRights";

beforeEach(() => {
  stored = {};
  legal = null;
});

const PAGES = [
  { name: "ResidentRights", spec: RIGHTS_RESIDENT_PAGE, Page: ResidentRights },
  { name: "StewardRights", spec: RIGHTS_STEWARD_PAGE, Page: StewardRights },
] as const;

const show = (Page: ComponentType) =>
  render(
    <Router>
      <Page />
    </Router>,
  );

/** The page has finished loading once the hero headline is visible. */
async function loaded() {
  const h1 = await screen.findByRole("heading", { level: 1 });
  await vi.waitFor(() => expect(h1).not.toHaveClass("invisible"));
  return h1;
}

const save = (spec: PageSpec, doc: unknown) => {
  stored[pageSectionKey(spec)] = doc;
};

const pageText = () => document.body.textContent ?? "";

describe.each(PAGES)("$name, every field in its spec reaches the page", ({ spec, Page }) => {
  it("renders a distinct marker typed into each field and each list row", async () => {
    const doc = markerDocument(spec);
    save(spec, doc);
    show(Page);
    await loaded();

    const text = pageText();
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

  it("draws nothing of a section the village hid, and keeps the rest", async () => {
    const defaults = (id: string, key: string) =>
      spec.sections.find((s) => s.id === id)!.fields.find((f) => f.key === key)!.default;
    save(spec, {
      ownership: { hidden: true },
      responsibilities: { hidden: true },
      progression: { hidden: true },
      cta: { hidden: true },
    });
    show(Page);
    await loaded();

    for (const [id, key] of [
      ["ownership", "heading"],
      ["responsibilities", "heading"],
      ["progression", "heading"],
      ["cta", "heading"],
    ] as const) {
      expect(screen.queryByText(defaults(id, key))).toBeNull();
    }
    expect(screen.getByText(defaults("rights", "heading"))).toBeInTheDocument();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("hides the whole rights list when the village hides it", async () => {
    save(spec, { rights: { hidden: true } });
    show(Page);
    await loaded();

    expect(screen.queryByText("What You Hold")).toBeNull();
    expect(screen.getByText("What You Carry")).toBeInTheDocument();
  });

  it("stays invisible until the saved words arrive, so the defaults never flash first", () => {
    stored = new Proxy({}, { get: () => new Promise(() => {}) }) as Record<string, unknown>;
    show(Page);
    expect(screen.getByRole("heading", { level: 1, hidden: true })).toHaveClass("invisible");
    expect(screen.queryByText("What You Hold")).toBeNull();
  });

  it("names no token and says nothing a token does (Rye, 2026-10-22)", async () => {
    show(Page);
    await loaded();

    const text = pageText();
    expect(text).not.toMatch(/Thanks|Seeds/);
    expect(text).not.toMatch(/offset|economy access|increased|builds real wealth|financial value|pool of/i);
  });

  it("drops the second button when the village blanks it, and keeps the first", async () => {
    save(spec, { cta: { secondaryLabel: "" } });
    show(Page);
    await loaded();

    expect(screen.getAllByRole("link")).toHaveLength(1);
  });
});

describe("ResidentRights words", () => {
  it("fills {village} in the defaults and carries the approved token rows", async () => {
    show(ResidentRights);
    await loaded();

    const text = pageText();
    expect(text).toContain("Living at Willowbrook means you are not a tenant.");
    // Row 15.
    expect(screen.getByText("A Share in What We Build")).toBeInTheDocument();
    expect(text).toContain("make life here net-positive for every resident.");
    expect(text).not.toContain("Dues Offset");
    // Row 16.
    expect(text).toContain("creating a net-positive financial life for all residents. Exact monthly amounts");
    // Row 17.
    expect(text).toContain("Where your business participation or your role in community operations covers your dues");
    expect(text).toContain("Year thresholds are approximate");
  });

  it("puts nothing where the transfer note goes when Legal has none", async () => {
    show(ResidentRights);
    await loaded();

    expect(pageText()).toContain("transferable to your children, and protected by community ownership");
    expect(pageText()).not.toContain("{transfer}");
  });

  it("splices Legal's transfer note into the Land Share card, as it always did", async () => {
    legal = { landShareTransferNote: "with no transfer tax under local law" };
    show(ResidentRights);
    await loaded();

    expect(pageText()).toContain(
      "transferable to your children with no transfer tax under local law, and protected by community ownership",
    );
  });

  it("follows {transfer} into the card a village rewrote", async () => {
    legal = { landShareTransferNote: "under the village's own rules" };
    save(RIGHTS_RESIDENT_PAGE, {
      rights: { items: [{ title: "Your plot", description: "Yours to pass on{transfer}." }] },
    });
    show(ResidentRights);
    await loaded();

    expect(screen.getByText("Yours to pass on under the village's own rules.")).toBeInTheDocument();
    expect(screen.queryByText("Your Land Share is Yours")).toBeNull();
  });

  it("drops the footnote and the finances card when the village blanks or hides them", async () => {
    save(RIGHTS_RESIDENT_PAGE, { progression: { footnote: "" }, finances: { hidden: true } });
    show(ResidentRights);
    await loaded();

    expect(screen.queryByText(/Year thresholds are approximate/)).toBeNull();
    expect(screen.queryByText("The Vision for Your Finances Here")).toBeNull();
    expect(screen.getByText("Rights Grow With Your Roots")).toBeInTheDocument();
  });
});

describe("StewardRights words", () => {
  it("carries the approved token rows", async () => {
    show(StewardRights);
    await loaded();

    // Row 18.
    expect(
      screen.getByText("Every role you hold and every quest you complete shows what it is worth on its own card."),
    ).toBeInTheDocument();
    // Rows 19 and 20.
    expect(screen.getByText("Full governance voice, seasonal role eligibility")).toBeInTheDocument();
    expect(screen.getByText("Mentorship responsibilities, voice in cross-circle decisions")).toBeInTheDocument();
    expect(pageText()).toContain("you have access to Willowbrook's wellness offerings");
  });

  it("has no footnote and no stage tags until the village writes them", async () => {
    show(StewardRights);
    await loaded();
    expect(screen.queryByText(/Year \d/)).toBeNull();

    save(RIGHTS_STEWARD_PAGE, {
      progression: { stages: [{ level: "Guide", description: "Mentors", years: "Season 3" }], footnote: "Approximate." },
    });
    show(StewardRights);
    await screen.findByText("Season 3");
    expect(screen.getByText("Approximate.")).toBeInTheDocument();
  });
});
