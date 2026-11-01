// @vitest-environment jsdom
/**
 * A TOKEN RENAMED IN ADMIN THEN TOKENS REACHES THE MEMBER PAGES (readiness R084).
 *
 * The repro, as the finding wrote it: rename stay-credit to "Nights" and
 * library-credit to "Tool Tokens". /stay, /wallet and /library still said
 * "stay credits" and "library credits", and the Wallet and Library tooltips
 * said what each token DOES ("earned through work exchange", "earned by
 * donating items", "thanks for work, never pay"), which the 2026-10-22 token
 * ruling forbids anywhere.
 *
 * Every page here is rendered against a config whose registry carries the
 * renamed tokens (`currency.names`, served by GET /api/game/config) and a
 * payload in the route's own shape. InfoTip is mocked to PRINT its tip, so a
 * tooltip's words are on the page this test reads, as they are on the page a
 * member hovers.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { Router } from "wouter";
import type { ReactNode } from "react";

class NoopIntersectionObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}
vi.stubGlobal("IntersectionObserver", NoopIntersectionObserver);

const CONFIG = {
  project: { name: "Riverbend" },
  currency: {
    name: "Seeds",
    nameLower: "seeds",
    collectiveName: "Riverbend Tokens",
    value: { slug: "credits", name: "Commons" },
    names: { gratitude: "Seeds", "stay-credit": "Nights", "library-credit": "Tool Tokens", credits: "Commons" },
  },
  stages: [],
};

vi.mock("@/components/Layout", () => ({ default: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock("@/components/modules/ModuleGate", () => ({ default: () => <p>gated</p> }));
vi.mock("@/modules/ModuleProvider", () => ({
  useModule: (id: string) => ({ id, lifecycle: "public" }),
  useModules: () => ({ loaded: true }),
  useHypha: () => ({ configured: false, links: {} }),
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "usr-ora", name: "Ora" } }) }));
vi.mock("@/lib/gameApi", () => ({ authToken: () => "a-session", useGameConfig: () => CONFIG }));
vi.mock("@/components/InfoTip", () => ({
  default: ({ tip, children }: { tip: string; children?: ReactNode }) => (
    <span>
      {children}
      <span data-testid="tip">{tip}</span>
    </span>
  ),
}));
vi.mock("@/components/SwapCard", () => ({ default: () => null }));
vi.mock("@/components/RedemptionPanel", () => ({ default: () => null }));
vi.mock("@/components/RedemptionQueue", () => ({ default: () => null }));
vi.mock("@/components/WorkPayBlock", () => ({ default: () => null }));
vi.mock("@/components/Image", () => ({ Image: () => null }));
vi.mock("@/components/ExamplesBanner", () => ({ ExamplesBanner: () => null }));
vi.mock("@/components/ExampleRefusal", () => ({ ExampleRefusal: () => null, readRefusal: () => null }));

import Stay from "./Stay";
import Wallet from "./Wallet";
import Library from "./Library";
import OwedPostings from "@/components/review/OwedPostings";

const PAYLOADS: Array<[RegExp, unknown]> = [
  [/^\/api\/stays/, {
    audience: "member",
    priceTokens: { "stay-credit": { name: "Nights", decimals: 0 } },
    accommodations: [{
      id: "acc-1", name: "The Straw Room", description: "", capacity: 2, photoUrl: null, isExample: false,
      prices: { "stay-credit": { guest: 2, member: 1 }, usd: { guest: 4500, member: 3000 } },
    }],
    mine: {
      balance: 12, balanceDecimals: 0, balances: {},
      stays: [{ id: "s-1", status: "active", rateSnapshotToken: "stay-credit", rateSnapshotCredits: 1, rateSnapshotDecimals: 0, nightsRemaining: 2 }],
    },
    earnQuests: [{ id: "q-1", title: "Plaster the north wall", stayCreditReward: 4 }],
    guestBookingEnabled: true,
    stripeConfigured: true,
    maxPurchaseNights: 14,
  }],
  [/^\/api\/exchange/, {
    listings: [{ slug: "stay-credit", name: "Nights", kind: "credit", priceMinor: 2500, inStock: true, isExample: false }],
    mine: {
      balances: { "stay-credit": 2, "library-credit": 3, gratitude: 5 },
      tokenNames: { "stay-credit": "Nights", "library-credit": "Tool Tokens", gratitude: "Seeds" },
      tokenDecimals: {},
      orders: [{ id: "o-1", receipt_no: "R-1", kind: "buy", token_slug: "library-credit", quantity: 3, amount_minor: 1500, status: "paid", created_at: "2026-10-01" }],
      canBuy: true,
    },
    swap: { enabled: false, halted: [], myPairs: [], notSwappable: [] },
  }],
  [/^\/api\/game\/rules/, {}],
  [/^\/api\/library/, {
    items: [{ id: "i-1", name: "Hand saw", status: "available", creditValue: 4, escrow: 2, photoUrl: null }],
    mine: { balance: 5, balanceDecimals: 0, loans: [], strikes: 0 },
  }],
  [/^\/api\/admin\/quest-claims\/owed/, [{
    key: "k-1", claimId: "c-1", questTitle: "Plaster the north wall", holder: "Ora", tokenSlug: "stay-credit",
    units: 2, decimals: 0, state: "owed", refusalReason: null, lastError: null, attempts: 1, createdAt: 1,
  }]],
];

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    const hit = PAYLOADS.find(([p]) => p.test(String(url)));
    return { ok: !!hit, status: hit ? 200 : 404, json: async () => (hit ? hit[1] : {}) } as unknown as Response;
  }));
});
afterEach(() => {
  cleanup();
});

/** What a member reads, tooltips included, as one string. */
const page = () => document.body.textContent ?? "";
/** The first village's words for these tokens, and the sentences that said what a token does. */
const NOT_THIS_VILLAGE = /stay credits?|library credits?|credit\(s\)/i;
const MECHANICS = /never pay|earned (through|by|when)|hosts one night|nights at the village|pay the Material Library|cannot be bought|never bought/i;

describe("a renamed stay token", () => {
  it("is what /stay says on every line that names it", async () => {
    render(<Router><Stay /></Router>);
    await waitFor(() => expect(screen.getByText(/The Straw Room/)).toBeInTheDocument());
    const text = page();
    expect(text).toMatch(/Your balance: 12 Nights/);
    expect(text).toMatch(/1 Nights a night/);
    expect(text).toMatch(/Visitors pay 2 Nights a night/);
    expect(text).toMatch(/4 Nights on consent/);
    expect(text).not.toMatch(NOT_THIS_VILLAGE);
    expect(text).not.toMatch(MECHANICS);
  });

  it("is what a steward reads on a payment a consent still owes", async () => {
    render(<OwedPostings headers={() => ({})} />);
    await waitFor(() => expect(screen.getByText(/2 Nights: still owed\./)).toBeInTheDocument());
    expect(page()).not.toMatch(NOT_THIS_VILLAGE);
  });
});

describe("a renamed library token", () => {
  it("is what /library says, and its tooltip says nothing about how it is earned", async () => {
    render(<Router><Library /></Router>);
    await waitFor(() => expect(screen.getByText(/Hand saw/)).toBeInTheDocument());
    const text = page();
    expect(text).toMatch(/Borrow what you need with\s*Tool Tokens\./);
    expect(text).toMatch(/Your Tool Tokens: 5/);
    expect(text).not.toMatch(NOT_THIS_VILLAGE);
    expect(text).not.toMatch(MECHANICS);
  });
});

describe("/wallet", () => {
  it("names the village's own umbrella word, and no tooltip says what a token does", async () => {
    render(<Router><Wallet /></Router>);
    await waitFor(() => expect(screen.getByText(/Buy Riverbend Tokens and check your balances/)).toBeInTheDocument());
    await waitFor(() => expect(page()).toMatch(/Tool Tokens/));
    const text = page();
    expect(text).not.toMatch(NOT_THIS_VILLAGE);
    expect(text).not.toMatch(MECHANICS);
  });

  it("shows a price in the currency it is charged in, with no symbol typed into the page", async () => {
    render(<Router><Wallet /></Router>);
    await waitFor(() => expect(page()).toMatch(/\$25\.00 each/));
  });
});
