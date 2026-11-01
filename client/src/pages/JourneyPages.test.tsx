// @vitest-environment jsdom
/**
 * The four journey pages read every word from their specs
 * (shared/pageContent/journeys.ts), and the defects the 2026-10-22 audit found
 * on them stay fixed.
 *
 * THE WIRING TEST, one per page, is Home.test.tsx's: save a document with a
 * distinct marker in every field and every row, render the page, and every
 * marker must be on it, as text, as a link's address or as a box's hint. A
 * field a founder can save that the page never reads is a missing marker.
 * The few fields that are not words on their own (a phrase inside another
 * field, a number drawn as a bar, a note shown only after a form is sent) are
 * named in each page's skip list and each has its own test below.
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
vi.stubGlobal("IntersectionObserver", NoopIntersectionObserver);

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Router } from "wouter";
import type { ComponentType, ReactNode } from "react";
import { fillVars, markerDocument } from "@shared/pageContent/resolve";
import { pageSectionKey, type PageSpec } from "@shared/pageContent/types";
import { pageVarsFrom } from "@shared/pageContent/vars";
import {
  INVESTOR_JOURNEY,
  JOURNEY_LEGACY_STEP_IDS,
  PROSPERITY_JOURNEY,
  RESIDENT_JOURNEY,
  STEWARD_JOURNEY,
  type JourneyId,
} from "@shared/pageContent/journeys";

/*
 * A village that saved nothing reads the spec's defaults, neutral starter
 * text since 2026-10-23. The tests below read them from the spec rather than
 * typing them again, so a later wording change moves no test; they pin the
 * BEHAVIOUR (where a button goes, what a word becomes, what hides).
 */
const sectionOf = (spec: PageSpec, id: string) => spec.sections.find((s) => s.id === id)!;
const fieldDefault = (spec: PageSpec, id: string, key: string) => sectionOf(spec, id).fields.find((f) => f.key === key)!.default;
const listDefault = (spec: PageSpec, id: string, key: string) => sectionOf(spec, id).lists!.find((l) => l.key === key)!.default;
const SPECS: Record<JourneyId, PageSpec> = {
  investor: INVESTOR_JOURNEY,
  steward: STEWARD_JOURNEY,
  resident: RESIDENT_JOURNEY,
  prosperity: PROSPERITY_JOURNEY,
};
/** One default step, found by the id it carried before the steps became a list. */
const stepDefault = (journey: JourneyId, legacyId: string) =>
  listDefault(SPECS[journey], "steps", "items")[JOURNEY_LEGACY_STEP_IDS[journey].indexOf(legacyId)];
/** A default as this suite's village reads it (the config mocked below). */
const filled = (text: string, more: Record<string, string> = {}) =>
  fillVars(text, {
    ...pageVarsFrom({ project: { name: "Willowbrook", commitmentName: "Village Pact" }, currency: { name: "Thanks", value: { name: "Seeds" } } }),
    ...more,
  });
/** A literal phrase as a pattern. */
const phrase = (text: string) => new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));

const state = vi.hoisted(() => ({
  pages: {} as Record<string, unknown>,
  money: null as Record<string, unknown> | null,
  legal: null as Record<string, unknown> | null,
  settings: null as Record<string, unknown> | null,
  eventsUrl: "https://example.org/events",
  contactEmail: "team@example.org",
}));

vi.mock("@/components/Layout", () => ({ default: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock("@/components/WhyCostaRica", () => ({ default: () => null }));
vi.mock("@/components/InvestorSummary", () => ({ default: () => null }));
vi.mock("@/components/comms/PathConsentBox", () => ({ default: () => null, FORM_CONSENT_FIELD: "commsConsent" }));
// The questions come from FAQs; the heading over them is the page's.
vi.mock("@/components/FaqSection", () => ({ default: ({ heading }: { heading?: string }) => <h2>{heading}</h2> }));
vi.mock("@/hooks/useVillageName", () => ({ useVillageName: () => "Willowbrook" }));
vi.mock("@/hooks/useTokenNames", () => ({ useTokenName: () => "Thanks", useValueTokenName: () => "Seeds" }));
vi.mock("@/lib/gameApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/gameApi")>()),
  useBrandImages: () => ({}),
  useVillageLinks: () => ({
    siteUrl: "",
    eventsUrl: state.eventsUrl,
    contactEmail: state.contactEmail,
    mailTo: (subject: string) => (state.contactEmail ? `mailto:${state.contactEmail}?subject=${encodeURIComponent(subject)}` : ""),
  }),
  useVillageSettings: () => state.settings,
  useGameConfig: () => ({
    project: { name: "Willowbrook", commitmentName: "Village Pact" },
    currency: { name: "Thanks", value: { name: "Seeds" } },
  }),
}));
vi.mock("@/hooks/useVillageContent", () => ({
  readVillageSection: (section: string) => Promise.resolve(state.pages[section] ?? null),
  useVillageContent: (section: string) => {
    const content = section === "money" ? state.money : section === "legal" ? state.legal : null;
    return { content, loading: false, isPlaceholder: !content };
  },
}));

import InvestorJourney from "./InvestorJourney";
import StewardJourney from "./StewardJourney";
import ResidentJourney from "./ResidentJourney";
import ProsperityJourney from "./ProsperityJourney";

const memoryStorage = () => {
  const store = new Map<string, string>();
  return {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    get length() {
      return store.size;
    },
  };
};

let posted: { url: string; body: unknown }[] = [];
let workWithUs: Record<string, unknown> = {};

beforeEach(() => {
  state.pages = {};
  state.money = null;
  state.legal = null;
  state.settings = null;
  state.eventsUrl = "https://example.org/events";
  state.contactEmail = "team@example.org";
  posted = [];
  workWithUs = {};
  vi.stubGlobal("IntersectionObserver", NoopIntersectionObserver);
  vi.stubGlobal("localStorage", memoryStorage());
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: { body?: string }) => {
      if (init?.body) posted.push({ url, body: JSON.parse(init.body) });
      const json = url.includes("work-with-us-config") ? workWithUs : { success: true };
      return { ok: true, status: 200, json: async () => json };
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

const show = (Page: ComponentType) =>
  render(
    <Router>
      <Page />
    </Router>,
  );

/** The steps the page drew, by their titles, in order. */
const stepTitles = (spec: PageSpec, doc: Record<string, any>): string[] =>
  (doc.steps?.items ?? []).map((row: Record<string, string>) => row.title).filter(Boolean);

/**
 * Everything a visitor can reach on the page: its text, every link's address
 * and every box's hint, opening each step in turn (only one is open at once).
 */
async function everythingOnThePage(titles: string[]): Promise<{ text: string; hrefs: Set<string>; hints: Set<string> }> {
  let text = "";
  const hrefs = new Set<string>();
  const hints = new Set<string>();
  const take = () => {
    text += ` ${document.body.textContent ?? ""}`;
    document.querySelectorAll("a[href]").forEach((a) => hrefs.add(a.getAttribute("href") ?? ""));
    document.querySelectorAll("[placeholder]").forEach((el) => hints.add(el.getAttribute("placeholder") ?? ""));
  };
  take();
  titles.forEach((title, i) => {
    if (i > 0) fireEvent.click(screen.getByText(title));
    take();
  });
  return { text, hrefs, hints };
}

/** Every marker in the document that is missing from the page, by where it was typed. */
function missingMarkers(doc: Record<string, any>, seen: { text: string; hrefs: Set<string>; hints: Set<string> }, skip: string[]): string[] {
  const missing: string[] = [];
  for (const [sectionId, section] of Object.entries(doc)) {
    for (const [key, value] of Object.entries(section as Record<string, unknown>)) {
      const rows = Array.isArray(value) ? (value as Record<string, string>[]) : [{ [key]: value as string }];
      for (const row of rows) {
        for (const [field, v] of Object.entries(row)) {
          if (field === "id") continue;
          const where = Array.isArray(value) ? `${sectionId}.${key}.${field}` : `${sectionId}.${key}`;
          if (skip.includes(where)) continue;
          const found = v.startsWith("/") ? seen.hrefs.has(v) : seen.text.includes(v) || seen.hints.has(v);
          if (!found) missing.push(`${where} (${v})`);
        }
      }
    }
  }
  return missing;
}

const PAGES = [
  {
    name: "/investor",
    spec: INVESTOR_JOURNEY,
    Page: InvestorJourney,
    skip: [
      // A phrase inside the headline, checked by "draws the highlighted phrase".
      "hero.highlight",
      // The subject of a #contact email; the markers send every button to a page.
      "hero.contactSubject",
      // Only one of the two sentences shows: these markers state figures.
      "figures.empty",
      // A rule and a number, checked by "draws the phases' status and progress".
      "phases.activeStatus",
      "phases.items.progress",
      // The forms open from #pack-form and #call-form; "the investor forms" checks them.
      "packForm.rangeHint",
      "accreditation.statement",
      "accreditation.reminder",
      "callForm.timeHint",
      "callForm.thanks",
    ],
  },
  {
    name: "/steward",
    spec: STEWARD_JOURNEY,
    Page: StewardJourney,
    skip: [
      "hero.highlight",
      // A phrase inside the footnote, checked by "links the footnote's phrase".
      "nextStep.footnoteLink",
      // Shown once the form is sent, checked by "says what the village wrote once the form is sent".
      "nextStep.thanksHeading",
      "nextStep.thanksBody",
      "nextStep.thanksCta",
    ],
  },
  {
    name: "/resident",
    spec: RESIDENT_JOURNEY,
    Page: ResidentJourney,
    skip: ["hero.highlight"],
  },
  {
    name: "/prosperity",
    spec: PROSPERITY_JOURNEY,
    Page: ProsperityJourney,
    skip: [
      "hero.highlight",
      "hero.contactSubject",
      // Words other fields use, checked by "names the tiers with the village's own words".
      "tiers.acronym",
      "tiers.framework",
    ],
  },
] as const;

describe.each(PAGES)("every field in the $name spec reaches the page", ({ spec, Page, skip }) => {
  it("renders a distinct marker typed into each field and each list row", async () => {
    const doc = markerDocument(spec) as Record<string, any>;
    state.pages[pageSectionKey(spec)] = doc;
    state.settings = {
      landFacts: Object.fromEntries(["appreciation", "appraisal", "projectedReturn", "targetRaise"].map((k) => [k, { value: `${k} figure`, note: "" }])),
    };
    show(Page);
    await screen.findByText(doc.hero.eyebrow);

    const seen = await everythingOnThePage(stepTitles(spec, doc));
    expect(missingMarkers(doc, seen, [...skip])).toEqual([]);
  });

  it("draws the highlighted phrase in its own colour inside the headline", async () => {
    state.pages[pageSectionKey(spec)] = { hero: { headline: "A valley that remembers", highlight: "remembers" } };
    show(Page);
    const h1 = await screen.findByRole("heading", { level: 1 });
    await waitFor(() => expect(h1).toHaveTextContent("A valley that remembers"));
    expect(h1.querySelector("span")).toHaveTextContent("remembers");
  });

  it("draws nothing of a section the village hid", async () => {
    const hideable = spec.sections.filter((s) => s.hideable);
    const doc: Record<string, unknown> = {};
    for (const s of hideable) doc[s.id] = { hidden: true };
    state.pages[pageSectionKey(spec)] = doc;
    show(Page);
    await screen.findByRole("heading", { level: 1 });
    await screen.findByText(spec.sections.find((s) => s.id === "steps")!.fields[0].default.replace("{village}", "Willowbrook"));
    for (const s of hideable) {
      const heading = s.fields.find((f) => f.key === "heading" || f.key === "firstHeading");
      if (heading) expect(screen.queryByText(heading.default.replace("{village}", "Willowbrook")), s.id).toBeNull();
    }
  });

  it("draws no button whose destination is blank", async () => {
    const steps = spec.sections.find((s) => s.id === "steps")!;
    const first = (steps.lists![0].default[0] as Record<string, string>);
    state.pages[pageSectionKey(spec)] = {
      steps: { items: [{ ...first, title: "Only step", actionLabel: "Nowhere", actionTarget: "" }] },
    };
    show(Page);
    await screen.findByText("Only step");
    expect(screen.queryByText("Nowhere")).toBeNull();
  });
});

describe("/investor", () => {
  it("never tells the public where the village types its figures", async () => {
    state.settings = { landFacts: {} };
    show(InvestorJourney);
    expect(await screen.findByText("This village has not published any figures yet.")).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/Admin, Settings/);
  });

  it("says the village's own words when it has stated no figures", async () => {
    state.settings = { landFacts: {} };
    state.pages[pageSectionKey(INVESTOR_JOURNEY)] = { figures: { empty: "Figures come after the land survey." } };
    show(InvestorJourney);
    expect(await screen.findByText("Figures come after the land survey.")).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/Admin, Settings/);
  });

  it("draws the phases' status and progress from the village's rows", async () => {
    state.pages[pageSectionKey(INVESTOR_JOURNEY)] = {
      phases: {
        activeStatus: "Building",
        items: [
          { name: "Barn", units: "1 barn", status: "Building", progress: "40" },
          { name: "Orchard", units: "2 acres", status: "Dreaming", progress: "not a number" },
        ],
      },
    };
    show(InvestorJourney);
    expect(await screen.findByText("Building")).toHaveClass("bg-gold");
    expect(screen.getByText("Dreaming")).not.toHaveClass("bg-gold");
    expect(screen.getByRole("progressbar", { name: "Barn" })).toHaveAttribute("aria-valuenow", "40");
    expect(screen.getByRole("progressbar", { name: "Orchard" })).toHaveAttribute("aria-valuenow", "0");
  });

  it("opens the pack form with the village's hint and statement, and holds it until the box is ticked", async () => {
    state.pages[pageSectionKey(INVESTOR_JOURNEY)] = {
      packForm: { rangeHint: "e.g. 10k to 50k EUR" },
      accreditation: { statement: "I am a qualified investor under our law.", reminder: "Please tick the qualified investor box." },
    };
    show(InvestorJourney);
    fireEvent.click((await screen.findAllByRole("button", { name: /Request Investor Pack/ }))[0]);
    expect(await screen.findByPlaceholderText("e.g. 10k to 50k EUR")).toBeInTheDocument();
    expect(screen.getByText("I am a qualified investor under our law.")).toBeInTheDocument();
    fireEvent.submit(screen.getByRole("button", { name: /Send Request/ }).closest("form")!);
    expect(await screen.findByText("Please tick the qualified investor box.")).toBeInTheDocument();
    expect(posted.filter((p) => p.url.includes("investor-docs"))).toEqual([]);
  });

  it("drops the accreditation box where the village switched it off, and sends that nobody was asked", async () => {
    state.pages[pageSectionKey(INVESTOR_JOURNEY)] = { accreditation: { hidden: true } };
    show(InvestorJourney);
    fireEvent.click((await screen.findAllByRole("button", { name: /Request Investor Pack/ }))[0]);
    await screen.findByRole("button", { name: /Send Request/ });
    expect(screen.queryByText("I confirm I am an accredited investor.")).toBeNull();
    fireEvent.submit(screen.getByRole("button", { name: /Send Request/ }).closest("form")!);
    await waitFor(() => expect(posted.some((p) => p.url.includes("investor-docs"))).toBe(true));
    // Null: nobody was asked (Rye, 2026-10-22). The server records "not asked", never "no".
    const sent = posted.find((p) => p.url.includes("investor-docs"))!.body as Record<string, unknown>;
    expect(sent.accredited).toBeNull();
    expect(sent).toHaveProperty("investmentRange");
    expect(sent).toHaveProperty("message");
  });

  it("opens the call form with the village's hint, and thanks the visitor in the village's words", async () => {
    state.pages[pageSectionKey(INVESTOR_JOURNEY)] = {
      callForm: { timeHint: "e.g. Monday 10:00 CET", thanks: "Thanks, we answer within a week." },
    };
    show(InvestorJourney);
    // The call form opens from its step, the third.
    fireEvent.click(await screen.findByText("Schedule Investment Call"));
    fireEvent.click(await screen.findByRole("button", { name: /Schedule Call/ }));
    expect(await screen.findByPlaceholderText("e.g. Monday 10:00 CET")).toBeInTheDocument();
    fireEvent.submit(screen.getByRole("button", { name: /Request Call/ }).closest("form")!);
    expect(await screen.findByText("Thanks, we answer within a week.")).toBeInTheDocument();
  });

  it("draws no phases band until the village lists a phase, and states no phase of its own", async () => {
    expect(listDefault(INVESTOR_JOURNEY, "phases", "items")).toEqual([]);
    show(InvestorJourney);
    await screen.findByText(fieldDefault(INVESTOR_JOURNEY, "steps", "heading"));
    expect(screen.queryByText(fieldDefault(INVESTOR_JOURNEY, "phases", "heading"))).toBeNull();
    expect(screen.queryByRole("progressbar")).toBeNull();
  });

  it("invents no figure: no amount, no rate and no count anywhere in its words", async () => {
    state.settings = { landFacts: {} };
    show(InvestorJourney);
    await screen.findByText(fieldDefault(INVESTOR_JOURNEY, "figures", "empty"));
    const said = document.body.textContent ?? "";
    expect(said).not.toMatch(/\d+\s*%|\$\s*\d|\d+\s*(keys|lots|homes|years?)\b|\d+K\b/i);
  });

  it("emails the commitment with the village's own subject line, and hides it with no address", async () => {
    show(InvestorJourney);
    fireEvent.click(await screen.findByText("Make Your Commitment"));
    expect(await screen.findByRole("link", { name: /Contact Team/ })).toHaveAttribute(
      "href",
      "mailto:team@example.org?subject=Investment%20Commitment",
    );
  });
});

describe("/steward", () => {
  it("sends Learn About Our Seasons to the seasonal festivals page", async () => {
    show(StewardJourney);
    expect(await screen.findByRole("link", { name: /Learn About Our Seasons/ })).toHaveAttribute("href", "/seasonal-festivals");
  });

  it("draws the path of growth with no token promise and no pay line", async () => {
    show(StewardJourney);
    const [first, ...rest] = listDefault(STEWARD_JOURNEY, "ladder", "items");
    expect(await screen.findByText(first.benefits)).toBeInTheDocument();
    for (const level of rest) expect(screen.getByText(level.benefits)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/compensation/i);
  });

  it("says nowhere that a quest pays what its card says (Rye, 2026-10-23)", async () => {
    show(StewardJourney);
    fireEvent.click(await screen.findByText(stepDefault("steward", "quests").title));
    await screen.findByText(stepDefault("steward", "quests").bullet1);
    expect(document.body.textContent).not.toMatch(/get paid|what each quest's card says/i);
  });

  it("links the footnote's phrase to the events page", async () => {
    show(StewardJourney);
    expect(
      await screen.findByRole("link", { name: fieldDefault(STEWARD_JOURNEY, "nextStep", "footnoteLink") }),
    ).toHaveAttribute("href", "https://example.org/events");
  });

  it("says what the village wrote once the form is sent", async () => {
    state.pages[pageSectionKey(STEWARD_JOURNEY)] = {
      nextStep: { thanksHeading: "Glad you wrote.", thanksBody: "A steward answers by the new moon.", thanksCta: "See our gatherings" },
    };
    show(StewardJourney);
    fireEvent.change(await screen.findByLabelText(/your name/i), { target: { value: "Juno" } });
    fireEvent.change(screen.getByLabelText(/^email/i), { target: { value: "juno@example.test" } });
    fireEvent.submit(screen.getByRole("button", { name: /Begin My Stewardship Journey/ }).closest("form")!);
    expect(await screen.findByRole("heading", { name: "Glad you wrote." })).toBeInTheDocument();
    expect(screen.getByText("A steward answers by the new moon.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /See our gatherings/ })).toHaveAttribute("href", "https://example.org/events");
  });

  it("uses the village's commitment name where the page said Love Letter", async () => {
    show(StewardJourney);
    const step = stepDefault("steward", "love-letter");
    fireEvent.click(await screen.findByText(filled(step.title)));
    expect(filled(step.actionLabel)).toBe("Read the Village Pact");
    expect(await screen.findByRole("link", { name: /Read the Village Pact/ })).toHaveAttribute("href", "/love-letter");
  });
});

describe("/resident", () => {
  const open = async (title: string) => fireEvent.click(await screen.findByText(title));

  /** The four steps whose buttons pointed at "#": blank "goes to" in the defaults now. */
  const NOWHERE = ["background", "fireside", "land", "move-in"].map((id) => stepDefault("resident", id));

  it("draws none of the four buttons that went nowhere", async () => {
    show(ResidentJourney);
    for (const step of NOWHERE) {
      expect(step.actionTarget, step.title).toBe("");
      expect(step.actionLabel, step.title).not.toBe("");
      await open(filled(step.title));
      expect(screen.queryByText(step.actionLabel), step.actionLabel).toBeNull();
    }
    expect(document.querySelector('a[href="#"]')).toBeNull();
  });

  it("draws one once the village gives it somewhere to go", async () => {
    const steps = RESIDENT_JOURNEY.sections.find((s) => s.id === "steps")!.lists![0].default;
    const background = stepDefault("resident", "background");
    state.pages[pageSectionKey(RESIDENT_JOURNEY)] = {
      steps: { items: steps.map((row) => (row.title === background.title ? { ...row, actionTarget: "/apply" } : row)) },
    };
    show(ResidentJourney);
    await open(background.title);
    expect(await screen.findByRole("link", { name: phrase(background.actionLabel) })).toHaveAttribute("href", "/apply");
  });

  it("sends the passage step's button to the good neighbor page", async () => {
    show(ResidentJourney);
    const passage = stepDefault("resident", "passage");
    await open(passage.title);
    expect(await screen.findByRole("link", { name: phrase(passage.actionLabel) })).toHaveAttribute("href", "/good-neighbor");
  });

  it("never names the criteria by a name this page cannot follow (the Good Neighbor page renames them)", async () => {
    show(ResidentJourney);
    await open(stepDefault("resident", "passage").title);
    expect(document.body.textContent).not.toMatch(/Good Neighbor Criteria/);
  });

  it("fills the land share transfer note and the background check note from the legal settings", async () => {
    state.legal = { landShareTransferNote: "(within the family line)", membership: { backgroundCheckNote: "and it is free" } };
    show(ResidentJourney);
    const tenure = filled(fieldDefault(RESIDENT_JOURNEY, "tenure", "body"), { "transfer-note": " (within the family line)" });
    expect(tenure).toContain("to your children (within the family line).");
    expect(await screen.findByText(tenure)).toBeInTheDocument();
    const background = stepDefault("resident", "background");
    await open(background.title);
    const sentence = filled(background.description, { "background-note": ", and it is free" });
    expect(sentence).toContain(", and it is free.");
    expect(screen.getAllByText(phrase(sentence)).length).toBeGreaterThan(0);
  });

  it("says the dues words with no token in them, and links How we create together", async () => {
    show(ResidentJourney);
    expect(await screen.findByText(filled(fieldDefault(RESIDENT_JOURNEY, "dues", "fallback")))).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /How we create together/ })).toHaveAttribute("href", "/how-we-create");
    expect(document.body.textContent).not.toMatch(/offset/i);
  });

  it("states none of the founding village's own facts or rituals as every village's (2026-10-23)", async () => {
    show(ResidentJourney);
    await screen.findByText(fieldDefault(RESIDENT_JOURNEY, "steps", "heading"));
    // Only one step is open at a time, and the first opens by itself.
    let said = document.body.textContent ?? "";
    for (const step of listDefault(RESIDENT_JOURNEY, "steps", "items").slice(1)) {
      await open(filled(step.title));
      said += document.body.textContent ?? "";
    }
    expect(said).not.toMatch(/Founding Seeder|Fireside|founding team|Land Credits|Land Share Agreement|Children's Play Day/);
    expect(said).not.toMatch(/Nonviolent Communication|fully refundable|potluck/i);
  });
});

describe("/prosperity", () => {
  const stepsIntro = (count: string) => filled(fieldDefault(PROSPERITY_JOURNEY, "steps", "intro"), { count });

  it("counts its own steps in words", async () => {
    expect(listDefault(PROSPERITY_JOURNEY, "steps", "items")).toHaveLength(7);
    show(ProsperityJourney);
    expect(await screen.findByText(stepsIntro("seven"))).toBeInTheDocument();
  });

  it("says three when the village keeps three", async () => {
    const steps = PROSPERITY_JOURNEY.sections.find((s) => s.id === "steps")!.lists![0].default;
    state.pages[pageSectionKey(PROSPERITY_JOURNEY)] = { steps: { items: steps.slice(0, 3) } };
    show(ProsperityJourney);
    expect(await screen.findByText(stepsIntro("three"))).toBeInTheDocument();
  });

  it("names the tiers with the village's own words, never another village's name after the acronym", async () => {
    state.pages[pageSectionKey(PROSPERITY_JOURNEY)] = { tiers: { acronym: "RIX", framework: "Valley Impact" } };
    show(ProsperityJourney);
    expect(await screen.findByRole("heading", { name: "RIX Tiers: Valley Impact" })).toBeInTheDocument();
    expect(screen.getByText(/through our Valley Impact framework/)).toBeInTheDocument();
    expect(screen.getByText(/Advance your impact through our RIX tiers\./)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/ARI/);
  });

  /** The tier words as the defaults fill them. */
  const tierWords = () => {
    const acronym = fieldDefault(PROSPERITY_JOURNEY, "tiers", "acronym");
    return { acronym, framework: filled(fieldDefault(PROSPERITY_JOURNEY, "tiers", "framework")) };
  };

  it("names its tiers with the spec's own starter words, never another village's acronym", async () => {
    show(ProsperityJourney);
    const words = tierWords();
    expect(await screen.findByRole("heading", { name: filled(fieldDefault(PROSPERITY_JOURNEY, "tiers", "heading"), words) })).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/\bARI\b/);
  });

  it("says the token rows' words and nothing about what a token does", async () => {
    show(ProsperityJourney);
    await screen.findByText(fieldDefault(PROSPERITY_JOURNEY, "economy", "firstHeading"));
    const said = document.body.textContent ?? "";
    expect(said).toContain(filled(fieldDefault(PROSPERITY_JOURNEY, "hero", "intro"), tierWords()));
    expect(said).toContain(filled(fieldDefault(PROSPERITY_JOURNEY, "economy", "firstBody")));
    expect(said).toContain(listDefault(PROSPERITY_JOURNEY, "tiers", "items")[0].metric2);
    expect(said).not.toMatch(/Thanks/);
    expect(said).not.toMatch(/pay in cash|tracked in|tracks contributions/i);
  });

  it("names the village's guide in the proposal step", async () => {
    workWithUs = { assistantName: "Juniper" };
    show(ProsperityJourney);
    const step = stepDefault("prosperity", "business-proposal");
    fireEvent.click(await screen.findByText(step.title));
    await waitFor(() => expect(document.body.textContent).toContain(filled(step.description, { guide: "Juniper" })));
  });

  it("calls a guide the village has not named the village guide, never another village's agent", async () => {
    show(ProsperityJourney);
    const step = stepDefault("prosperity", "business-proposal");
    fireEvent.click(await screen.findByText(step.title));
    await waitFor(() => expect(document.body.textContent).toContain(filled(step.description, { guide: "the village guide" })));
    expect(document.body.textContent).not.toMatch(/Maia/);
  });

  it("emails the packet request with the village's own subject line", async () => {
    state.pages[pageSectionKey(PROSPERITY_JOURNEY)] = { hero: { contactSubject: "Business pack, please" } };
    show(ProsperityJourney);
    const [heroButton] = await screen.findAllByRole("link", { name: phrase(fieldDefault(PROSPERITY_JOURNEY, "hero", "primaryLabel")) });
    expect(heroButton).toHaveAttribute("href", "mailto:team@example.org?subject=Business%20pack%2C%20please");
  });

  it("hides the packet band and every packet button while the village has no contact address", async () => {
    state.contactEmail = "";
    show(ProsperityJourney);
    await screen.findByText(fieldDefault(PROSPERITY_JOURNEY, "economy", "firstHeading"));
    expect(screen.queryByText(fieldDefault(PROSPERITY_JOURNEY, "packet", "heading"))).toBeNull();
    for (const label of [
      fieldDefault(PROSPERITY_JOURNEY, "hero", "primaryLabel"),
      fieldDefault(PROSPERITY_JOURNEY, "packet", "ctaLabel"),
      fieldDefault(PROSPERITY_JOURNEY, "closing", "secondaryLabel"),
    ]) {
      expect(screen.queryByRole("link", { name: phrase(label) }), label).toBeNull();
    }
    expect(document.querySelector('a[href^="mailto:"]')).toBeNull();
  });
});
