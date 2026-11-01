// @vitest-environment jsdom
/**
 * The two member-facing claims this page publishes about money and about
 * standing, held to the founder's rulings of 2026-09-03.
 *
 * THE DEPOSIT RANGE. "from $5k to $20k+ depending on the home type you're
 * reserving" shipped as a module constant, so every village that deploys this
 * platform published one village's dollar figures under its own name with no
 * screen anywhere that could change them. Same class of defect as the housing
 * tiers (0131) and the land figures (`landFacts`), and the same answer: the
 * figure comes from the runtime content document, a village that has written
 * nothing publishes NO figure, and whatever a founder types publishes
 * verbatim with no currency supplied and no range reformatted.
 *
 * THE TENURE LADDER. Guardian at 7 years, Elder at 21, Sage at 49. Nothing in
 * the product implements any of it. The founder's ruling is that the titles
 * stay and the page says plainly that they are honorary, and that the Rights
 * of Nature is DECOUPLED from the Sage title, because a voice for nature that
 * waits on somebody's forty-ninth year is no voice at all. The standing
 * economics ruling is that voice follows contribution, so nothing here may
 * say or imply that years alone grow it.
 *
 * THE YEARS ARE THE VILLAGE'S OWN SINCE 2026-10-23. Seven, twenty-one and
 * forty-nine were the founding village's numbers, and that village now keeps
 * them in its own copy of this page. The neutral defaults keep the titles and
 * the honorary wording, and draw no year until a village writes one.
 *
 * THE WORDS ARE READ FROM THE SPEC (shared/pageContent/journeys.ts), so the
 * starter wording can move without moving this suite.
 *
 * BOTH DIRECTIONS ARE THE TEST, the way Housing.test.tsx puts it: a suite
 * that only ever sees the populated case goes green on a page drawing a
 * sentence with a hole in it.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

// framer-motion's `whileInView` reaches for IntersectionObserver, which jsdom
// does not implement. A stub that never fires is right here: these tests ask
// what the page renders, not what it animates on scroll.
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
import type { ReactNode } from "react";

vi.mock("@/components/Layout", () => ({
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("@/components/WhyCostaRica", () => ({ default: () => null }));
vi.mock("@/components/FaqSection", () => ({ default: () => null }));
vi.mock("@/lib/gameApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/gameApi")>()),
  useBrandImages: () => ({}),
  useVillageLinks: () => ({ siteUrl: "", eventsUrl: "", contactEmail: "", mailTo: () => "" }),
  // The page's words come from its spec, filled with this village's names.
  useGameConfig: () => ({ project: { name: "Willowbrook" }, currency: { name: "Gratitude" } }),
}));
vi.mock("@/hooks/useVillageName", () => ({ useVillageName: () => "Willowbrook" }));
vi.mock("@/hooks/useTokenNames", () => ({ useTokenName: () => "Gratitude" }));

/**
 * One mock for the content hook, re-pointed per test. Every section this page
 * reads goes through it, so the money section answers from `money` and the
 * legal section keeps answering nothing.
 */
const moneySection = vi.hoisted(() => ({ current: null as Record<string, unknown> | null }));
vi.mock("@/hooks/useVillageContent", () => ({
  useVillageContent: (section: string) =>
    section === "money"
      ? { content: moneySection.current, loading: false, isPlaceholder: !moneySection.current }
      : { content: null, loading: false, isPlaceholder: true },
  // The page's own saved words (page-journey-resident): none, so the defaults.
  readVillageSection: () => Promise.resolve(null),
}));

import ResidentJourney from "./ResidentJourney";
import { JOURNEY_LEGACY_STEP_IDS, RESIDENT_JOURNEY } from "@shared/pageContent/journeys";

const sectionOf = (id: string) => RESIDENT_JOURNEY.sections.find((s) => s.id === id)!;
/** The deposit step as the spec ships it. */
const DEPOSIT = sectionOf("steps").lists![0].default[JOURNEY_LEGACY_STEP_IDS.resident.indexOf("deposit")];
/** The deposit sentence either side of where the range goes. */
const [BEFORE_RANGE, AFTER_RANGE] = DEPOSIT.description.split("{range}");
/** The deposit step's points that carry no figure. */
const PLAIN_POINTS = ["bullet1", "bullet2", "bullet3", "bullet4"]
  .map((k) => DEPOSIT[k])
  .filter((p): p is string => !!p && !p.includes("{"));
const TITLES = sectionOf("titles").lists![0].default;

const renderPage = () =>
  render(
    <Router>
      <ResidentJourney />
    </Router>,
  );

/**
 * Node 25 ships its own `localStorage` and jsdom's is not installed over it,
 * so `window.localStorage.clear` is undefined here while `getItem` is not.
 * An in-memory one per test keeps the pages' progress reads honest and
 * isolated.
 */
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

/** `/api/settings` is the only fetch this page makes; dues stay unset. */
const settingsAnswering = () =>
  vi.fn(async () => ({ ok: true, json: async () => ({}) })) as unknown as typeof fetch;

beforeEach(() => {
  moneySection.current = null;
  // afterEach's unstubAllGlobals takes the module-level stub with it, and the
  // second render in any file then dies inside framer-motion's whileInView.
  vi.stubGlobal("IntersectionObserver", NoopIntersectionObserver);
  vi.stubGlobal("fetch", settingsAnswering());
  vi.stubGlobal("localStorage", memoryStorage());
});
afterEach(() => vi.unstubAllGlobals());

/** A literal phrase as a pattern. */
const phrase = (text: string) => new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));

/** The deposit step's own text, wherever the page has put it. */
const depositStepText = () => screen.getByText(phrase(BEFORE_RANGE)).textContent ?? "";

/**
 * The bullet list under a step draws only while that step is expanded, and the
 * page opens on a different one. Clicking the heading is how a reader gets
 * there, so it is how this suite gets there too.
 */
const openDepositStep = () => fireEvent.click(screen.getByText(DEPOSIT.title));
const depositDrawn = () => waitFor(() => expect(screen.queryByText(DEPOSIT.title)).toBeTruthy());

describe("a village that has not stated its deposit range", () => {
  it("publishes no figure at all in the deposit sentence", async () => {
    renderPage();
    await depositDrawn();
    const sentence = depositStepText();
    expect(sentence).toContain(BEFORE_RANGE);
    // Not a zero, not a placeholder, not somebody else's dollars.
    expect(sentence).not.toMatch(/\$/);
    expect(sentence).not.toMatch(/\bTBD\b|to be confirmed/i);
    // Nor one village's refund terms stated as every village's (2026-10-23).
    expect(sentence).not.toMatch(/fully refundable/i);
  });

  it("leaves no dangling comma where the range was", async () => {
    renderPage();
    await depositDrawn();
    expect(depositStepText()).toContain(`${BEFORE_RANGE}${AFTER_RANGE}`);
  });

  it("drops the range bullet instead of printing an empty one", async () => {
    renderPage();
    await depositDrawn();
    openDepositStep();
    expect(screen.queryByText(/depending on home type/)).toBeNull();
    // The bullets that do not carry a figure are all still there.
    expect(PLAIN_POINTS.length).toBeGreaterThan(1);
    for (const point of PLAIN_POINTS) expect(screen.queryByText(point), point).toBeTruthy();
  });
});

describe("a village that has stated its deposit range", () => {
  it("publishes exactly what was typed, in the sentence and in the bullet", async () => {
    moneySection.current = {
      depositRange: "from 2.000.000 to 9.000.000 colones depending on the home",
      depositSummary: "2M-9M colones by home type",
    };
    renderPage();
    await depositDrawn();
    expect(depositStepText()).toContain(
      `${BEFORE_RANGE}, from 2.000.000 to 9.000.000 colones depending on the home${AFTER_RANGE}`,
    );
    openDepositStep();
    expect(screen.queryByText("2M-9M colones by home type")).toBeTruthy();
  });

  it("changes when the document changes, with nothing of the old figure left", async () => {
    moneySection.current = { depositRange: "from $5k to $20k+ depending on the home type you're reserving" };
    const first = renderPage();
    await depositDrawn();
    expect(depositStepText()).toContain("$5k to $20k+");
    first.unmount();

    moneySection.current = { depositRange: "a flat 1.500 EUR, refunded on request" };
    renderPage();
    await depositDrawn();
    const sentence = depositStepText();
    expect(sentence).toContain("a flat 1.500 EUR, refunded on request");
    expect(sentence).not.toContain("$5k");
  });
});

describe("the tenure ladder is honorary and says so", () => {
  beforeEach(() => renderPage());
  const lastTitle = TITLES[TITLES.length - 1].level;

  it("keeps every title in the spec, and draws a time only where the village wrote one", async () => {
    await waitFor(() => expect(screen.queryByText(lastTitle)).toBeTruthy());
    expect(TITLES.map((t) => t.level)).toEqual(["Resident", "Guardian", "Elder", "Sage"]);
    for (const { level, years } of TITLES) {
      // getAllBy: "Resident" is also a journey stage badge further up.
      expect(screen.queryAllByText(level).length, level).toBeGreaterThan(0);
      if (years) expect(screen.queryByText(`${years}+`), level).toBeTruthy();
    }
    // The founding village's 7, 21 and 49 are its own copy's, not every village's.
    expect(TITLES.every((t) => !t.years)).toBe(true);
    expect(document.body.textContent ?? "").not.toMatch(/\d+ years\+/);
  });

  it("says plainly that the titles carry no voice and no rights today", async () => {
    await waitFor(() => expect(screen.queryByText(lastTitle)).toBeTruthy());
    const said = document.body.textContent ?? "";
    expect(said).toMatch(/honorary/i);
    expect(said).toMatch(/no voice in governance and no rights today/i);
  });

  it("says a village may grant these titles powers later", async () => {
    await waitFor(() => expect(screen.queryByText(lastTitle)).toBeTruthy());
    expect(document.body.textContent ?? "").toMatch(/may .{0,30}attach powers/i);
  });

  it("never says that years alone grow a member's voice", async () => {
    await waitFor(() => expect(screen.queryByText(lastTitle)).toBeTruthy());
    const said = document.body.textContent ?? "";
    // The retired heading and its blurb, verbatim. Voice follows contribution.
    expect(said).not.toContain("Growing Your Voice");
    expect(said).not.toMatch(/your voice in governance grows/i);
    expect(said).not.toMatch(/as you invest more years/i);
  });

  it("does not hang the Rights of Nature on the Sage title", async () => {
    await waitFor(() => expect(screen.queryByText(lastTitle)).toBeTruthy());
    expect(document.body.textContent ?? "").not.toMatch(/rights of nature/i);
  });
});

/*
 * THE DUES FIGURE. Its currency was a compiled "$" whenever the village had
 * typed none, so a village pricing in colones published dollars. The village
 * here has stated no currency at all, so the figure stands alone.
 */
describe("the village dues", () => {
  it("prints the amount with no invented currency when the village stated none", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => ({ villageDues: { amount: "250", period: "month", currency: "", note: "" } }) })) as unknown as typeof fetch,
    );
    renderPage();
    const figure = await screen.findByText("250");
    expect(figure.textContent).toBe("250");
    expect(figure.parentElement?.textContent ?? "").not.toMatch(/\$/);
  });

  it("prints the symbol the village typed", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => ({ villageDues: { amount: "300", period: "month", currency: "€", note: "" } }) })) as unknown as typeof fetch,
    );
    renderPage();
    expect(await screen.findByText("€300")).toBeTruthy();
  });
});
