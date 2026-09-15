// @vitest-environment jsdom
/**
 * "As the village grows, the value token can convert to cash, equity, or
 * community currency." Two pages published that sentence from compiled copy.
 *
 * THE FOUNDER'S RULING, 2026-09-03: the conversion is REAL and it happens OFF
 * the platform. An on-platform redemption process is coming and does not
 * exist. So the sentence is not deleted and it is not left compiled in: it
 * comes from the runtime content document, where the founder can correct it
 * the day the process changes, and a village that has written nothing about
 * conversion SAYS NOTHING about conversion.
 *
 * NOT a contradiction of the wallet's "money flows in and never back out".
 * That line is about the village never buying back its CREDIT token. This one
 * is about the VALUE token. Two different tokens, and this suite asserts only
 * the second.
 *
 * FIVE PAGES, NOT TWO. The audit that produced the ruling named Quests and
 * ProsperityJourney. Reading the tree for the claim rather than for the two
 * filenames found it three more times: the CoCreators guide says it twice (a
 * "spend" bullet and the economy paragraph), How We Create says it twice (a
 * whole "Future Conversion" card and the line under the explainer), and the
 * Steward rights page says it inside the recognition card. All five are here,
 * because a fix applied to one of a set is the defect this repository has
 * catalogued most (see the fix-one-twin note in CLAUDE.md's house traps).
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

class NoopIntersectionObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}
vi.stubGlobal("IntersectionObserver", NoopIntersectionObserver);

import { render, screen, waitFor } from "@testing-library/react";
import { Router } from "wouter";
import type { ReactNode } from "react";

vi.mock("@/components/Layout", () => ({
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("@/components/FaqSection", () => ({ default: () => null }));
vi.mock("@/components/ExamplesBanner", () => ({ ExamplesBanner: () => null }));
vi.mock("@/components/InfoTip", () => ({ default: () => null }));
vi.mock("@/lib/gameApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/gameApi")>()),
  useBrandImages: () => ({}),
  useVillageLinks: () => ({ siteUrl: "", eventsUrl: "", contactEmail: "", mailTo: () => "" }),
  useGameConfig: () => ({ project: { name: "Willowbrook", eventsUrl: "" }, stages: [] }),
  fetchGameMe: async () => null,
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: null }) }));
vi.mock("@/modules/ModuleProvider", () => ({
  useHypha: () => ({ enabled: false, dhoSlug: "", tokens: [] }),
}));
vi.mock("@/hooks/useVillageName", () => ({ useVillageName: () => "Willowbrook" }));
vi.mock("@/hooks/useTokenNames", () => ({
  useTokenName: () => "Gratitude",
  useValueTokenName: () => "Seeds",
}));

const moneySection = vi.hoisted(() => ({ current: null as Record<string, unknown> | null }));
vi.mock("@/hooks/useVillageContent", () => ({
  useVillageContent: (section: string) =>
    section === "money"
      ? { content: moneySection.current, loading: false, isPlaceholder: !moneySection.current }
      : { content: null, loading: false, isPlaceholder: true },
}));

import Quests from "./Quests";
import ProsperityJourney from "./ProsperityJourney";
import CoCreatorsGuide from "./CoCreatorsGuide";
import HowWeCreate from "./HowWeCreate";
import StewardRights from "./StewardRights";

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

/** Neither page's other fetches matter here; answer them all emptily. */
const quietFetch = () =>
  vi.fn(async () => ({ ok: true, json: async () => ({}) })) as unknown as typeof fetch;

beforeEach(() => {
  moneySection.current = null;
  // afterEach's unstubAllGlobals takes the module-level stub with it, and the
  // second render in any file then dies inside framer-motion's whileInView.
  vi.stubGlobal("IntersectionObserver", NoopIntersectionObserver);
  vi.stubGlobal("fetch", quietFetch());
  vi.stubGlobal("localStorage", memoryStorage());
});
afterEach(() => vi.unstubAllGlobals());

const PAGES = [
  { name: "Quests", render: () => render(<Router><Quests /></Router>), anchor: /About Gratitude/ },
  {
    name: "ProsperityJourney",
    render: () => render(<Router><ProsperityJourney /></Router>),
    anchor: /Gratitude Economy/,
  },
  {
    name: "CoCreatorsGuide",
    render: () => render(<Router><CoCreatorsGuide /></Router>),
    anchor: /Gratitude Economy/,
  },
  {
    name: "HowWeCreate",
    render: () => render(<Router><HowWeCreate /></Router>),
    anchor: /Gratitude Economy/,
  },
  {
    name: "StewardRights",
    render: () => render(<Router><StewardRights /></Router>),
    anchor: /Voice in Governance/,
  },
] as const;

for (const page of PAGES) {
  describe(`${page.name}, with nothing written about conversion`, () => {
    it("makes no claim that the value token converts to anything", async () => {
      page.render();
      await waitFor(() => expect(screen.queryAllByText(page.anchor).length).toBeGreaterThan(0));
      const said = document.body.textContent ?? "";
      // Wide on purpose: the five pages worded the same claim five ways
      // ("can convert to cash", "convert to cash or equity", "they convert
      // to cash or equity"). One pattern has to catch all of them.
      expect(said).not.toMatch(/converts? to cash/i);
      expect(said).not.toMatch(/cash, equity, or community currency/i);
      expect(said).not.toMatch(/future conversion/i);
    });

    it("keeps the surrounding sentences it did not put in question", async () => {
      page.render();
      await waitFor(() => expect(screen.queryAllByText(page.anchor).length).toBeGreaterThan(0));
      expect(document.body.textContent ?? "").toMatch(/Seeds/);
    });
  });

  describe(`${page.name}, with the founder's own wording published`, () => {
    it("publishes it verbatim, with the village and token names filled in", async () => {
      moneySection.current = {
        valueConversion:
          "Converting {value} to cash or equity is arranged directly with {village}, off the platform.",
      };
      page.render();
      await waitFor(() => expect(screen.queryAllByText(page.anchor).length).toBeGreaterThan(0));
      expect(document.body.textContent ?? "").toContain(
        "Converting Seeds to cash or equity is arranged directly with Willowbrook, off the platform.",
      );
    });

    it("changes when the document changes", async () => {
      moneySection.current = { valueConversion: "Ask the stewards how {value} converts." };
      const first = page.render();
      await waitFor(() => expect(screen.queryAllByText(page.anchor).length).toBeGreaterThan(0));
      expect(document.body.textContent ?? "").toContain("Ask the stewards how Seeds converts.");
      first.unmount();

      moneySection.current = { valueConversion: "No conversion is offered at {village} today." };
      page.render();
      await waitFor(() => expect(screen.queryAllByText(page.anchor).length).toBeGreaterThan(0));
      const said = document.body.textContent ?? "";
      expect(said).toContain("No conversion is offered at Willowbrook today.");
      expect(said).not.toContain("Ask the stewards");
    });

    it("never promises an on-platform redemption feature of its own accord", async () => {
      moneySection.current = { valueConversion: "Arranged off the platform, directly with {village}." };
      page.render();
      await waitFor(() => expect(screen.queryAllByText(page.anchor).length).toBeGreaterThan(0));
      const said = document.body.textContent ?? "";
      expect(said).not.toMatch(/redeem (?:your|them|it) (?:here|now)/i);
      expect(said).not.toMatch(/cash out/i);
    });
  });
}
