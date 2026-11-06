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
import { fillVars, markerDocument } from "@shared/pageContent/resolve";
import { pageSectionKey, type PageSpec } from "@shared/pageContent/types";

/*
 * A village that saved nothing reads the spec's defaults, neutral starter
 * text since 2026-10-23. These read them from the spec rather than typing
 * them again, so a later wording change moves no test.
 */
const sectionOf = (spec: PageSpec, id: string) => spec.sections.find((s) => s.id === id)!;
const fieldDefault = (spec: PageSpec, id: string, key: string) => sectionOf(spec, id).fields.find((f) => f.key === key)!.default;
const listDefault = (spec: PageSpec, id: string, key: string) => sectionOf(spec, id).lists!.find((l) => l.key === key)!.default;
const filled = (text: string, more: Record<string, string> = {}) => fillVars(text, { village: "Willowbrook", ...more });
/** The resident card that carries Legal's transfer note. */
const transferCard = () => listDefault(RIGHTS_RESIDENT_PAGE, "rights", "items").find((row) => row.description.includes("{transfer}"))!;

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
  it("fills {village} in the starter words and states none of the founding village's own facts", async () => {
    show(ResidentRights);
    await loaded();

    const text = pageText();
    expect(text).toContain(filled(fieldDefault(RIGHTS_RESIDENT_PAGE, "hero", "intro")));
    expect(text).not.toContain("{village}");
    // The token rows of 2026-10-22 stay true: no token offsets anything.
    expect(text).not.toContain("Dues Offset");
    // The founding village's land model, businesses and year thresholds (2026-10-23).
    expect(text).not.toMatch(/retreat cent|cafe|wellness center|artisan market|net-positive/i);
    expect(text).not.toMatch(/Year \d|Sage eligibility|Circle Representative|Children's Play Day/);
    // The Good Neighbor page can rename its criteria and this page cannot follow, so it names the page.
    expect(text).not.toMatch(/Good Neighbor Criteria/);
  });

  it("puts nothing where the transfer note goes when Legal has none", async () => {
    show(ResidentRights);
    await loaded();

    expect(pageText()).toContain(filled(transferCard().description, { transfer: "" }));
    expect(pageText()).not.toContain("{transfer}");
  });

  it("splices Legal's transfer note into the card that carries it, as it always did", async () => {
    legal = { landShareTransferNote: "with no transfer tax under local law" };
    show(ResidentRights);
    await loaded();

    const spliced = filled(transferCard().description, { transfer: " with no transfer tax under local law" });
    expect(spliced).toContain(" with no transfer tax under local law");
    expect(pageText()).toContain(spliced);
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
    save(RIGHTS_RESIDENT_PAGE, { progression: { footnote: "Stages are agreed each year." } });
    const first = show(ResidentRights);
    await loaded();
    expect(screen.getByText("Stages are agreed each year.")).toBeInTheDocument();
    expect(screen.getByText(fieldDefault(RIGHTS_RESIDENT_PAGE, "finances", "heading"))).toBeInTheDocument();
    first.unmount();

    save(RIGHTS_RESIDENT_PAGE, { progression: { footnote: "" }, finances: { hidden: true } });
    show(ResidentRights);
    await loaded();

    expect(screen.queryByText("Stages are agreed each year.")).toBeNull();
    expect(screen.queryByText(fieldDefault(RIGHTS_RESIDENT_PAGE, "finances", "heading"))).toBeNull();
    expect(screen.getByText(fieldDefault(RIGHTS_RESIDENT_PAGE, "progression", "heading"))).toBeInTheDocument();
  });
});

describe("StewardRights words", () => {
  it("has no pay card, because the quest and role cards say what work pays (Rye, 2026-10-23)", async () => {
    show(StewardRights);
    await loaded();

    expect(screen.queryByText("Get Paid for Your Contribution")).toBeNull();
    expect(pageText()).not.toMatch(/get paid|shows what it is worth on its own card/i);
    // Its stages promise no token and no more of one (rows 19 and 20 of 2026-10-22).
    for (const stage of listDefault(RIGHTS_STEWARD_PAGE, "progression", "stages")) {
      expect(screen.getByText(filled(stage.description))).toBeInTheDocument();
    }
    // The founding village's own retreat and council are its own words now.
    expect(pageText()).not.toMatch(/wellness offerings|Leadership Council|Nonviolent Communication|Right of Passage/);
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
