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
}));

import ResidentJourney from "./ResidentJourney";

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

/** The deposit step's own text, wherever the page has put it. */
const depositStepText = () =>
  screen.getByText(/Secure your future home with a fully refundable deposit/).textContent ?? "";

/**
 * The bullet list under a step draws only while that step is expanded, and the
 * page opens on a different one. Clicking the heading is how a reader gets
 * there, so it is how this suite gets there too.
 */
const openDepositStep = () =>
  fireEvent.click(screen.getByText("Put Down a Deposit on Your Future Home"));

describe("a village that has not stated its deposit range", () => {
  it("publishes no figure at all in the deposit sentence", async () => {
    renderPage();
    await waitFor(() => expect(screen.queryByText("Put Down a Deposit on Your Future Home")).toBeTruthy());
    const sentence = depositStepText();
    expect(sentence).toContain("fully refundable deposit");
    // Not a zero, not a placeholder, not somebody else's dollars.
    expect(sentence).not.toMatch(/\$/);
    expect(sentence).not.toMatch(/\bTBD\b|to be confirmed/i);
  });

  it("leaves no dangling comma where the range was", async () => {
    renderPage();
    await waitFor(() => expect(screen.queryByText("Put Down a Deposit on Your Future Home")).toBeTruthy());
    expect(depositStepText()).toContain("a fully refundable deposit. This holds your place");
  });

  it("drops the range bullet instead of printing an empty one", async () => {
    renderPage();
    await waitFor(() => expect(screen.queryByText("Put Down a Deposit on Your Future Home")).toBeTruthy());
    openDepositStep();
    expect(screen.queryByText(/depending on home type/)).toBeNull();
    // The bullets that do not carry a figure are all still there.
    expect(screen.queryByText("Fully refundable deposit")).toBeTruthy();
    expect(screen.queryByText("Priority on your chosen lot")).toBeTruthy();
  });
});

describe("a village that has stated its deposit range", () => {
  it("publishes exactly what was typed, in the sentence and in the bullet", async () => {
    moneySection.current = {
      depositRange: "from 2.000.000 to 9.000.000 colones depending on the home",
      depositSummary: "2M-9M colones by home type",
    };
    renderPage();
    await waitFor(() => expect(screen.queryByText("Put Down a Deposit on Your Future Home")).toBeTruthy());
    expect(depositStepText()).toContain(
      "a fully refundable deposit, from 2.000.000 to 9.000.000 colones depending on the home.",
    );
    openDepositStep();
    expect(screen.queryByText("2M-9M colones by home type")).toBeTruthy();
  });

  it("changes when the document changes, with nothing of the old figure left", async () => {
    moneySection.current = { depositRange: "from $5k to $20k+ depending on the home type you're reserving" };
    const first = renderPage();
    await waitFor(() => expect(screen.queryByText("Put Down a Deposit on Your Future Home")).toBeTruthy());
    expect(depositStepText()).toContain("$5k to $20k+");
    first.unmount();

    moneySection.current = { depositRange: "a flat 1.500 EUR, refunded on request" };
    renderPage();
    await waitFor(() => expect(screen.queryByText("Put Down a Deposit on Your Future Home")).toBeTruthy());
    const sentence = depositStepText();
    expect(sentence).toContain("a flat 1.500 EUR, refunded on request");
    expect(sentence).not.toContain("$5k");
  });
});

describe("the tenure ladder is honorary and says so", () => {
  beforeEach(() => renderPage());

  it("keeps every title and every year the founder ruled on", async () => {
    await waitFor(() => expect(screen.queryByText("Sage")).toBeTruthy());
    for (const level of ["Resident", "Guardian", "Elder", "Sage"]) {
      // getAllBy: "Resident" is also a journey stage badge further up.
      expect(screen.queryAllByText(level).length, level).toBeGreaterThan(0);
    }
    for (const years of ["7 years+", "21 years+", "49 years+"]) {
      expect(screen.queryByText(years)).toBeTruthy();
    }
  });

  it("says plainly that the titles carry no voice and no rights today", async () => {
    await waitFor(() => expect(screen.queryByText("Sage")).toBeTruthy());
    const said = document.body.textContent ?? "";
    expect(said).toMatch(/honorary/i);
    expect(said).toMatch(/no voice in governance and no rights today/i);
  });

  it("says a village may grant these titles powers later", async () => {
    await waitFor(() => expect(screen.queryByText("Sage")).toBeTruthy());
    expect(document.body.textContent ?? "").toMatch(/may .{0,30}attach powers/i);
  });

  it("never says that years alone grow a member's voice", async () => {
    await waitFor(() => expect(screen.queryByText("Sage")).toBeTruthy());
    const said = document.body.textContent ?? "";
    // The retired heading and its blurb, verbatim. Voice follows contribution.
    expect(said).not.toContain("Growing Your Voice");
    expect(said).not.toMatch(/your voice in governance grows/i);
    expect(said).not.toMatch(/as you invest more years/i);
  });

  it("does not hang the Rights of Nature on the Sage title", async () => {
    await waitFor(() => expect(screen.queryByText("Sage")).toBeTruthy());
    expect(document.body.textContent ?? "").not.toMatch(/rights of nature/i);
  });
});
