// @vitest-environment jsdom
/**
 * WHAT THE MEMBER-FACING SURFACES ACTUALLY PRINT, at a scale that is not 1.
 *
 * `token_ledger.amount`, `token_balances.balance` and
 * `accommodation_prices.amount_minor` are INTs of MINOR units. Village Voice
 * carries decimals 3, so a member who earned ten holds 10000 on the row.
 * Village Credits is ruled to 2 (docs/ECONOMICS.md section 11, 2026-09-04), and
 * credits is the token a room is priced in, the token members send each other
 * and the token the cycle pool pays out, so that one ruling reaches every
 * surface in this file at once.
 *
 * WHY THESE ARE COMPONENT TESTS AND NOT ROUTE TESTS. A route test can prove
 * the scale is on the wire. It cannot prove the surface READS it: a page that
 * ignored `decimals` entirely would leave every payload suite green. So each
 * case here renders the real component against the real payload shape and
 * asserts on the DOM, which is the thing a member reads.
 *
 * EVERY CASE USES A DECIMAL TOKEN ON PURPOSE. Six of the seven tokens sit at
 * decimals 0 today (drizzle/0126), where a minor unit and a whole one are the
 * same number, so a test written against those would pass on the broken code.
 * These fixtures put a scale on each surface's own token, which is the state
 * the credits ruling puts the busiest one of them in, and every assertion below
 * fails on the pre-fix render.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
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

vi.mock("@/components/Layout", () => ({
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("@/components/modules/ModuleGate", () => ({ default: () => <p>gated</p> }));
vi.mock("@/modules/ModuleProvider", () => ({
  useModule: () => ({ id: "stays", lifecycle: "public" }),
  useModules: () => ({ loaded: true }),
  useHypha: () => ({ configured: false, links: {} }),
}));
vi.mock("@/hooks/useTokenNames", () => ({ useTokenName: () => "Cob Credit" }));
vi.mock("@/components/SwapCard", () => ({ default: () => null }));
vi.mock("@/components/InfoTip", () => ({ default: () => null }));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "usr-ora", name: "Ora" } }),
}));
vi.mock("@/lib/gameApi", () => ({ authToken: () => "a-session" }));
vi.mock("@/components/Image", () => ({ Image: () => null }));
vi.mock("@/components/ExamplesBanner", () => ({ ExamplesBanner: () => null }));
vi.mock("@/components/ExampleRefusal", () => ({
  ExampleRefusal: () => null,
  readRefusal: () => null,
}));

import Stay from "@/pages/Stay";
import Contribute from "@/pages/Contribute";
import Wallet from "@/pages/Wallet";
import QuestActions from "@/components/QuestActions";
import type { QuestClaim } from "@/lib/gameApi";

const answering = (payload: unknown) =>
  vi.fn(async () => ({ ok: true, json: async () => payload })) as unknown as typeof fetch;

afterEach(() => vi.unstubAllGlobals());

/* ── /stay: the nightly rate, against the balance line above it ──────────── */

/**
 * The village prices a room at three Cob Credits a night and the token carries
 * decimals 3, so `accommodation_prices.amount_minor` holds 3000. The member
 * holds twelve stay credits.
 *
 * The two numbers on this page exist to be compared: "can I afford a night".
 * Before the fix the balance line divided and the rate did not, so the only
 * arithmetic anyone does here could not be done.
 *
 * `mine.balances` IS DELIBERATELY EMPTY OF COB CREDITS. That is where the
 * token's NAME used to be read from, and it holds only tokens the member
 * already has, so a member reading the rate for a token they have never held
 * got the raw slug. A signed-out visitor got nothing at all, `mine` being
 * null for them; that half is pinned server-side in
 * server/tokenSinks.routes.e2e.test.ts, which asks for the payload with no
 * token and checks `priceTokens` is still there.
 */
const STAYS = {
  audience: "member",
  priceTokens: {
    "stay-credit": { name: "Stay credit", decimals: 0 },
    "cob-credit": { name: "Cob Credit", decimals: 3 },
  },
  accommodations: [
    {
      id: "acc-1",
      name: "The Straw Room",
      description: "",
      capacity: 2,
      photoUrl: null,
      isExample: false,
      prices: {
        "stay-credit": { guest: 2, member: 1 },
        "cob-credit": { guest: 4500, member: 3000 },
      },
    },
  ],
  mine: {
    balance: 12,
    balanceDecimals: 0,
    balances: {},
    stays: [{ id: "s-1", status: "active", rateSnapshotToken: "cob-credit", rateSnapshotCredits: 3000, nightsRemaining: 2 }],
  },
  earnQuests: [{ id: "q-1", title: "Plaster the north wall", stayCreditReward: 4, gratitude: null }],
  guestBookingEnabled: true,
  stripeConfigured: false,
  maxPurchaseNights: 14,
};

describe("/stay prints a nightly rate in the units the balance above it is in", () => {
  beforeEach(() => vi.stubGlobal("fetch", answering(STAYS)));

  it("divides the village-token rate rather than printing the ledger row", async () => {
    render(<Router><Stay /></Router>);
    // 3000 minor units at decimals 3 is three Cob Credits a night.
    await waitFor(() => expect(screen.getByText(/3 Cob Credit\/night/)).toBeInTheDocument());
    // The pre-fix render. It is asserted absent rather than merely "not
    // expected": 3000 is exactly what the raw row prints, so its absence is
    // the whole claim of this test.
    expect(screen.queryByText(/3000 Cob Credit/)).not.toBeInTheDocument();
  });

  it("names the token from the payload's own registry and not from the slug", async () => {
    render(<Router><Stay /></Router>);
    await waitFor(() => expect(screen.getByText(/Cob Credit\/night/)).toBeInTheDocument());
    expect(screen.queryByText(/cob-credit/)).not.toBeInTheDocument();
  });

  it("reads the active stay's rate against the token that stay was activated in", async () => {
    render(<Router><Stay /></Router>);
    // rateSnapshotToken is cob-credit, NOT stay credits, so this line has to
    // divide by 3 and not by the balance line's 0.
    await waitFor(() => expect(screen.getByText(/Your stay is active at/)).toBeInTheDocument());
    expect(screen.getByText(/Your stay is active at/).textContent).toContain("3 credit(s)/night");
  });
});

/**
 * THE SAME PAGE, WITH A SCALE ON STAY CREDITS THEMSELVES.
 *
 * `stay-credit` is a voucher and the 2026-09-04 ruling explicitly leaves it at
 * 0, so this fixture is not a forecast. It is the only way to hold the OTHER
 * three lines on this page to the same rule: the credit rate, the two tier
 * lines and the work-exchange rewards all print `stay-credit` figures, and at
 * decimals 0 a divided render and an undivided one are byte-identical, so a
 * test written at the shipped scale proves nothing about them.
 *
 * What it actually pins is that the page reads the scale it is SENT rather
 * than assuming one, which is the property that has to hold whichever tokens
 * the village eventually gives a scale to.
 */
const STAYS_SCALED = {
  ...STAYS,
  priceTokens: {
    "stay-credit": { name: "Stay credit", decimals: 2 },
    "cob-credit": { name: "Cob Credit", decimals: 3 },
  },
  accommodations: [
    {
      ...STAYS.accommodations[0],
      prices: {
        "stay-credit": { guest: 250, member: 150 },
        "cob-credit": { guest: 4500, member: 3000 },
      },
    },
  ],
  mine: { ...STAYS.mine, balance: 1200, balanceDecimals: 2 },
  earnQuests: [{ id: "q-1", title: "Plaster the north wall", stayCreditReward: 400, gratitude: null }],
};

describe("/stay reads the scale it is sent, on every line and not just one", () => {
  beforeEach(() => vi.stubGlobal("fetch", answering(STAYS_SCALED)));

  it("divides the credit rate and both tier lines", async () => {
    render(<Router><Stay /></Router>);
    // 150 minor units at decimals 2 is one and a half credits for a member.
    await waitFor(() => expect(screen.getByText(/1.5/)).toBeInTheDocument());
    // The other tier, on the line below, which a visitor and a member both see.
    expect(screen.getByText(/Visitors pay 2.5 credit\(s\)\/night\./)).toBeInTheDocument();
    expect(screen.queryByText(/Visitors pay 250/)).not.toBeInTheDocument();
  });

  it("divides the work-exchange reward against the token it is paid in", async () => {
    render(<Router><Stay /></Router>);
    await waitFor(() => expect(screen.getByText(/Plaster the north wall/)).toBeInTheDocument());
    // The title sits in its own span inside the link; the reward is the link's
    // next text node, so the assertion has to be on the row and not the span.
    const row = screen.getByText(/Plaster the north wall/).closest("a");
    expect(row?.textContent).toContain("4 stay credit(s) on consent");
    expect(row?.textContent).not.toContain("400 stay credit");
  });
});

/* ── /contribute: what a product grants ──────────────────────────────────── */

/**
 * A membership that includes ten Cob Credits. `products.token_amount` is the
 * ledger's minor units, so the row holds 10000.
 *
 * This one could not be fixed at the render site: the payload shipped `name`
 * and `amount` and NO scale at all, so the server had to send `decimals`
 * first. Deleting that server field turns this case red, which is the point.
 */
const PRODUCTS = {
  products: [
    {
      id: "p-1",
      name: "Founding membership",
      description: "",
      kind: "membership",
      amountMinor: 12000,
      minAmountMinor: 500,
      recurring: "none",
      provider: "stripe",
      grantsToken: { slug: "cob-credit", amount: 10000, name: "Cob Credit", decimals: 3 },
    },
  ],
  stripeConfigured: true,
};

describe("/contribute prints what a product grants, not what the row stores", () => {
  beforeEach(() => vi.stubGlobal("fetch", answering(PRODUCTS)));

  it("divides the granted amount by the scale the payload now carries", async () => {
    render(<Router><Contribute /></Router>);
    await waitFor(() => expect(screen.getByText(/Includes 10 Cob Credit/)).toBeInTheDocument());
    expect(screen.queryByText(/Includes 10000 Cob Credit/)).not.toBeInTheDocument();
  });
});

/* ── the quest payout ────────────────────────────────────────────────────── */

/**
 * A consented quest that granted ten of the recognition token and credited
 * twelve, the extra two being a standing badge's multiplier. Both are ledger
 * figures. GameDashboard already divides this same token's balance through the
 * same formatter, so before the fix the app contradicted itself on two screens
 * a member reaches from the same menu.
 */
const CLAIM: QuestClaim = {
  id: "clm-1",
  questId: "q-1",
  questTitle: "Plaster the north wall",
  status: "consented",
  claimedAt: "2026-09-01T00:00:00.000Z",
  artifactUrl: "",
  note: "",
  amount: 10_000,
  credited: 12_000,
};

describe("the quest payout reads in the same units the dashboard balance does", () => {
  it("divides the grant and the badge bonus by the recognition token's scale", () => {
    render(
      <Router>
        <QuestActions questId="q-1" signedIn claim={CLAIM} decimals={3} onChanged={() => {}} />
      </Router>,
    );
    // 12000 credited, 10000 granted, so the badge added 2.
    expect(screen.getByText(/10 granted, and 2 more for a standing badge/)).toBeInTheDocument();
    expect(screen.queryByText(/10000 granted/)).not.toBeInTheDocument();
  });

  it("defaults to whole units when no scale is passed, which is what every token carried before Voice", () => {
    render(
      <Router>
        <QuestActions questId="q-1" signedIn claim={CLAIM} onChanged={() => {}} />
      </Router>,
    );
    expect(screen.getByText(/10000 granted, and 2000 more/)).toBeInTheDocument();
  });
});

/* ── /wallet receipts: the village's word, and a scale left alone ────────── */

/**
 * One swap and one fiat purchase, exactly as `GET /api/exchange` ships them.
 *
 * TWO CLAIMS, AND THE SECOND IS THE HARDER ONE.
 *
 * The receipts printed the raw SLUG where every other line on the page prints
 * the village's own name for the token, so the one place a member goes to
 * check what happened was the one place naming things differently. That is
 * fixed and asserted below.
 *
 * The QUANTITIES are deliberately still the ledger's minor units, and that is
 * pinned here so it cannot be half-changed by accident. `exchange_orders`
 * quantities go into the ledger as the transfer amount, and every other part
 * of the exchange is in the same units: SwapCard's receipt banner for this
 * same order, the quote sentence composed in server/lib/exchange.ts that a
 * member consents to, the "How many" box, and the Buy quantity box. All raw,
 * all agreeing. Dividing HERE alone would make one page report one swap two
 * ways and would make a member who typed 1 read a receipt saying 0.01, which
 * is the exact failure the send card shipped. Making the exchange read in
 * human units is a units pass over the server, not a render fix.
 */
const EXCHANGE = {
  mine: {
    balances: { "cob-credit": 6000 },
    tokenNames: { "cob-credit": "Cob Credit", "swap-b": "Barn Share" },
    tokenDecimals: { "cob-credit": 3, "swap-b": 0 },
    canBuy: true,
    orders: [
      { id: "o-1", receipt_no: 41, kind: "swap", pay_token_slug: "cob-credit", pay_quantity: 4000, token_slug: "swap-b", quantity: 2, amount_minor: 0, status: "paid" },
      { id: "o-2", receipt_no: 42, kind: "buy", token_slug: "swap-b", quantity: 3, amount_minor: 1500, status: "paid" },
    ],
  },
  listings: [],
  swap: { enabled: false, myPairs: [], notSwappable: [], halted: [] },
  stripeConfigured: false,
};

describe("/wallet receipts", () => {
  beforeEach(() => vi.stubGlobal("fetch", answering(EXCHANGE)));

  it("names the token the way the rest of the page names it", async () => {
    render(<Router><Wallet /></Router>);
    await waitFor(() => expect(screen.getByText(/#41:/)).toBeInTheDocument());
    const swap = screen.getByText(/#41:/).textContent ?? "";
    expect(swap).toContain("Cob Credit");
    expect(swap).toContain("Barn Share");
    expect(swap).not.toContain("cob-credit");
    expect(swap).not.toContain("swap-b");
  });

  it("leaves the quantity in the units the rest of the exchange is in", async () => {
    render(<Router><Wallet /></Router>);
    await waitFor(() => expect(screen.getByText(/#41:/)).toBeInTheDocument());
    // 4000 minor units of a token at decimals 3. Divided, it would read "4",
    // and the swap card's own banner for this order would still say 4000.
    expect(screen.getByText(/#41:/).textContent).toContain("4000 Cob Credit");
  });

  it("still divides the balance grid a hundred lines above, which is not the exchange", async () => {
    render(<Router><Wallet /></Router>);
    // 6000 at decimals 3 is six. This is the line that already divided, and it
    // is asserted here so the two halves of this page stay visibly different
    // on purpose rather than by neglect.
    await waitFor(() => expect(screen.getByText("6")).toBeInTheDocument());
  });
});
