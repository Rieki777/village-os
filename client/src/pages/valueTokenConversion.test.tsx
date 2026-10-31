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
 *
 * THE STEWARD RIGHTS PAGE LEFT THE LOOP ON 2026-10-22. Rye ruled that day that
 * a token may be named and no sentence may say what it does, and approved the
 * new pay card word for word (cust-audit TOKEN_COPY_PROPOSAL row 18). The card
 * no longer explains tokens at all, so it no longer publishes the founder's
 * conversion wording either. Its own block below holds it to that. On
 * 2026-10-23 the pay card itself went (Rye: the quest and role cards already
 * say what work pays), and the block holds that too.
 * TWO OF THE FIVE NOW PUBLISH NO CONVERSION SENTENCE AT ALL (Rye, 2026-10-22:
 * "every community will design their own rules for these and other tokens so
 * don't mention what it does anywhere"). The Co-Creators Guide and How We
 * Create name the tokens and link to /game-mechanics, generated from the rules
 * the village set (cust-audit TOKEN_COPY_PROPOSAL rows 2, 4 and 13). For those
 * two this suite now asserts the founder's sentence stays OFF the page, and
 * that the token is still named; the other three keep the 2026-09-03 checks.
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
  // `currency` matches the token-name mocks below for the pages that read their
  // words from a spec (usePageContent fills `{token}` from the config).
  useGameConfig: () => ({
    project: { name: "Willowbrook", eventsUrl: "" },
    currency: { name: "Gratitude", value: { name: "Seeds" } },
    stages: [],
  }),
  fetchGameMe: async () => null,
}));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: null }),
  // A visitor: the Hypha admin note (HyphaAdminNote) stays away.
  useIsAdmin: () => false,
}));
vi.mock("@/modules/ModuleProvider", () => ({
  useHypha: () => ({ enabled: false, dhoSlug: "", tokens: [] }),
  // Maia's type line under a first quest asks this; Gene Keys is off here.
  useModule: () => undefined,
}));
vi.mock("@/hooks/useVillageName", () => ({ useVillageName: () => "Willowbrook" }));
vi.mock("@/hooks/useTokenNames", () => ({
  useTokenName: () => "Gratitude",
  useValueTokenName: () => "Seeds",
}));

const moneySection = vi.hoisted(() => ({ current: null as Record<string, unknown> | null }));
vi.mock("@/hooks/useVillageContent", () => ({
  // Pages on a page spec (shared/pageContent) read their saved words here.
  readVillageSection: () => Promise.resolve(null),
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
import { PROSPERITY_JOURNEY } from "@shared/pageContent/journeys";
import { CO_CREATORS_GUIDE_PAGE } from "@shared/pageContent/coCreatorsGuide";
import type { PageSpec } from "@shared/pageContent/types";

/** A field's default, read from the spec: the starter words move without moving this suite. */
const fieldDefault = (spec: PageSpec, id: string, key: string) =>
  spec.sections.find((s) => s.id === id)!.fields.find((f) => f.key === key)!.default;
/** A literal phrase as a pattern. */
const phrase = (text: string) => new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));

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
  { name: "Quests", render: () => render(<Router><Quests /></Router>), anchor: /About Gratitude/, publishesConversion: true, names: /Seeds/ },
  {
    name: "ProsperityJourney",
    render: () => render(<Router><ProsperityJourney /></Router>),
    // Token row 27 (2026-10-22): the card is "Shared Enterprise", names no
    // token, and no longer carries the founder's conversion sentence.
    anchor: /Shared Enterprise/,
    publishesConversion: false,
    names: phrase(fieldDefault(PROSPERITY_JOURNEY, "economy", "firstBody")),
  },
  {
    name: "CoCreatorsGuide",
    render: () => render(<Router><CoCreatorsGuide /></Router>),
    // 2026-10-22: the section is "{token}" and the card of what work is worth stays.
    // The card's title since the pay ruling of 2026-10-23.
    anchor: phrase(fieldDefault(CO_CREATORS_GUIDE_PAGE, "recognition", "cardTitle")),
    publishesConversion: false,
    names: /Gratitude/,
  },
  {
    name: "HowWeCreate",
    render: () => render(<Router><HowWeCreate /></Router>),
    // 2026-10-22: "The {token} Economy" became "Our Tokens".
    anchor: /Our Tokens/,
    publishesConversion: false,
    names: /Gratitude/,
  },
] as const;

describe("StewardRights, after the token ruling of 2026-10-22", () => {
  const renderSteward = () => render(<Router><StewardRights /></Router>);
  const ready = () => screen.findByText("Voice in Governance");

  it("makes no claim that the value token converts to anything, with nothing written", async () => {
    renderSteward();
    await ready();
    const said = document.body.textContent ?? "";
    expect(said).not.toMatch(/converts? to cash/i);
    expect(said).not.toMatch(/cash, equity, or community currency/i);
    expect(said).not.toMatch(/future conversion/i);
  });

  it("does not publish the founder's conversion wording either, because the pay card no longer explains tokens", async () => {
    moneySection.current = {
      valueConversion: "Converting {value} to cash or equity is arranged directly with {village}, off the platform.",
    };
    renderSteward();
    await ready();
    const said = document.body.textContent ?? "";
    expect(said).not.toContain("arranged directly with Willowbrook");
    expect(said).not.toMatch(/Seeds|Gratitude/);
  });

  it("has no pay card at all since the pay ruling (Rye, 2026-10-23: the quest and role cards say it)", async () => {
    renderSteward();
    await ready();
    expect(screen.queryByText("Get Paid for Your Contribution")).toBeNull();
    expect(document.body.textContent ?? "").not.toMatch(/shows what it is worth on its own card/);
  });
});

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
      // The two pages that only NAME their tokens since 2026-10-22 name the
      // recognition token and no longer mention the value token at all.
      expect(document.body.textContent ?? "").toMatch(page.names);
    });
  });

  if (!page.publishesConversion) {
    describe(`${page.name}, with the founder's own wording published`, () => {
      it("leaves it off the page: a token is named here, never explained (Rye, 2026-10-22)", async () => {
        moneySection.current = {
          valueConversion:
            "Converting {value} to cash or equity is arranged directly with {village}, off the platform.",
        };
        page.render();
        await waitFor(() => expect(screen.queryAllByText(page.anchor).length).toBeGreaterThan(0));
        const said = document.body.textContent ?? "";
        expect(said).not.toContain("arranged directly with Willowbrook");
        expect(said).not.toMatch(/to cash or equity/i);
        expect(said).toMatch(page.names);
      });
    });
    continue;
  }

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
