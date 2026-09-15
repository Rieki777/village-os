// @vitest-environment jsdom
/**
 * THE TREASURY DESK, AGAINST THE SERVER'S UNITS AND THE SERVER'S DEDUPE.
 *
 * `POST /api/admin/resources/budgets/:id/fund` and `/spend` post `amountMinor`
 * straight to the ledger as minor units (server/routes/circleTreasury.ts; its
 * e2e test posts `60 * scale`). This panel converted typed amounts with 0
 * digits for every `token:` unit, so a steward typing 60 on a two-decimal
 * token minted 0.60, and every treasury balance printed raw minor units.
 *
 * The same routes turn `requestId` into the ledger's idempotency key. The panel
 * built it from the amount and the note, so funding the same amount for the
 * same reason again, or paying the same member the same amount again, was
 * answered `duplicate: true`, moved nothing, and was reported as done.
 *
 * `fetch` is stubbed and every body the panel posts is kept, because what is
 * under test is what the panel SENDS and what it SAYS about the answer.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/components/admin/ModuleConfigPanels", () => ({ ResourcesRoutingEditor: () => null }));

import ResourcesAdminPanel from "./ResourcesAdminPanel";

const budget = (over: Record<string, unknown>) => ({
  id: "bud-kitchen",
  circleId: "cir-kitchen",
  seasonId: null,
  amountMinor: 50_000,
  cycleAmountMinor: null,
  mode: "treasury",
  pending: null,
  dormant: null,
  unit: "token:credits",
  note: null,
  ...over,
});

const payload = (budgets: unknown[], measured: unknown = null) => ({
  rules: [],
  sources: [],
  budgets,
  vocab: { approvals: [{ id: "none", label: "No approval" }], paidFrom: [{ id: "circle-budget", label: "Circle budget" }], sourceKinds: [{ id: "donations", label: "Donations" }] },
  config: { requestCategory: "", measuredVisibleTo: "admin", labels: {} },
  defaultUnit: "token:credits",
  // The registry scale the route now ships. Deliberately 2, the ruled scale for
  // credits: at 0 every assertion below is identical on the broken panel.
  tokens: [{ slug: "credits", name: "Village Credits", decimals: 2 }],
  circles: [{ id: "cir-kitchen", name: "Kitchen" }],
  seats: [],
  measured,
});

type Reply = { status: number; body: Record<string, unknown> };
let posted: Array<{ url: string; body: any }>;
let replies: Reply[];
let budgets: unknown[];
let measured: unknown;

beforeEach(() => {
  posted = [];
  replies = [];
  budgets = [budget({})];
  measured = null;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: any) => {
      if (init?.method === "POST") {
        posted.push({ url: String(url), body: JSON.parse(init.body) });
        const r = replies.shift() ?? { status: 200, body: { success: true, duplicate: false } };
        return { ok: r.status < 400, status: r.status, json: async () => r.body };
      }
      if (String(url).endsWith("/api/admin/resources/treasuries")) {
        return { ok: true, status: 200, json: async () => ({ treasuries: { "bud-kitchen": { account: "circle:cir-kitchen", balanceMinor: 12_550, slug: "credits" } } }) };
      }
      return { ok: true, status: 200, json: async () => payload(budgets, measured) };
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

const renderPanel = async () => {
  render(<ResourcesAdminPanel password="secret" />);
  await screen.findByText("How Resources Flow");
};

const fund = async (user: ReturnType<typeof userEvent.setup>, amount: string, why: string) => {
  const box = screen.getByPlaceholderText("Amount in token:credits");
  await user.clear(box);
  await user.type(box, amount);
  const note = screen.getByPlaceholderText("Why");
  await user.clear(note);
  await user.type(note, why);
  await user.click(screen.getByRole("button", { name: "Mint into it" }));
};

describe("the treasury desk moves and shows tokens at the token's real scale", () => {
  it("shows a treasury balance at the token's scale", async () => {
    await renderPanel();
    // 12550 minor units at decimals 2 is 125.5.
    await waitFor(() => expect(screen.getByText(/holds a treasury of/).textContent).toContain("125.5 credits"));
    expect(screen.getByText(/holds a treasury of/).textContent).not.toContain("12550");
  });

  it("mints what the steward typed, in minor units at the token's scale", async () => {
    const user = userEvent.setup();
    await renderPanel();
    await fund(user, "60", "The Kitchen's season");
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0].url).toContain("/budgets/bud-kitchen/fund");
    // 60 whole credits at decimals 2. The broken panel sent 60, which is 0.60.
    expect(posted[0].body.amountMinor).toBe(6000);
  });

  it("pays from a treasury in minor units at the token's scale", async () => {
    const user = userEvent.setup();
    await renderPanel();
    await user.type(screen.getByPlaceholderText("Amount in token:credits"), "25");
    await user.type(screen.getByPlaceholderText("Member id, to pay somebody"), "usr-wren");
    await user.click(screen.getByRole("button", { name: "Pay from it" }));
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0].body.amountMinor).toBe(2500);
  });

  it("prints measured token inflows at the token's scale", async () => {
    // `measuredInflows` sums `token_ledger.amount`, which is MINOR units.
    measured = { fiat: [], tokens: [{ account: "sys:treasury", tokenType: "credits", direction: "in", count: 2, total: 12_550 }] };
    await renderPanel();
    const line = await screen.findByText(/across 2 moves/);
    expect(line.textContent).toContain("treasury: 125.5 credits across 2 moves");
    expect(line.textContent).not.toContain("12550");
  });

  it("refuses to send an amount for a token whose scale it cannot read", async () => {
    budgets = [budget({ unit: "token:mystery" })];
    const user = userEvent.setup();
    await renderPanel();
    await user.type(screen.getByPlaceholderText("Amount in token:mystery"), "60");
    await user.click(screen.getByRole("button", { name: "Mint into it" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/could not read how many decimal places token:mystery carries/);
    expect(posted).toHaveLength(0);
  });

  it("refuses an amount finer than the token holds, and sends nothing", async () => {
    const user = userEvent.setup();
    await renderPanel();
    await fund(user, "60.005", "Too fine");
    expect(await screen.findByRole("alert")).toHaveTextContent(/goes to 2 decimal places/);
    expect(posted).toHaveLength(0);
  });
});

describe("one submission is one request id", () => {
  it("funds the same amount for the same reason twice as two requests", async () => {
    const user = userEvent.setup();
    await renderPanel();
    await fund(user, "60", "Monthly kitchen float");
    await waitFor(() => expect(posted).toHaveLength(1));
    await fund(user, "60", "Monthly kitchen float");
    await waitFor(() => expect(posted).toHaveLength(2));
    expect(posted[0].body.requestId).toBeTruthy();
    // The broken panel sent `bud-kitchen:60:Monthly kitchen float` both times,
    // and the ledger answered the second with `duplicate: true`.
    expect(posted[1].body.requestId).not.toBe(posted[0].body.requestId);
  });

  it("retries a failed submission under the same request id", async () => {
    replies = [{ status: 500, body: { error: "The ledger did not answer" } }];
    const user = userEvent.setup();
    await renderPanel();
    await fund(user, "60", "Retry me");
    await screen.findByRole("alert");
    await user.click(screen.getByRole("button", { name: "Mint into it" }));
    await waitFor(() => expect(posted).toHaveLength(2));
    expect(posted[1].body.requestId).toBe(posted[0].body.requestId);
  });

  it("retries a failed hand-back under the same request id, with every box untouched", async () => {
    // "Hand it back" needs no amount, so this is the row nobody typed in.
    replies = [{ status: 500, body: { error: "The ledger did not answer" } }];
    const user = userEvent.setup();
    await renderPanel();
    await user.click(screen.getByRole("button", { name: "Hand it back" }));
    await screen.findByRole("alert");
    await user.click(screen.getByRole("button", { name: "Hand it back" }));
    await waitFor(() => expect(posted).toHaveLength(2));
    expect(posted[0].url).toContain("/budgets/bud-kitchen/return");
    // The broken panel sent no requestId at all, so the server keyed each
    // press on the clock and a double click handed back twice.
    expect(posted[0].body.requestId).toBeTruthy();
    expect(posted[1].body.requestId).toBe(posted[0].body.requestId);
  });

  it("hands back twice as two requests when the first one went through", async () => {
    const user = userEvent.setup();
    await renderPanel();
    await user.click(screen.getByRole("button", { name: "Hand it back" }));
    await waitFor(() => expect(posted).toHaveLength(1));
    await screen.findByRole("status");
    await user.click(screen.getByRole("button", { name: "Hand it back" }));
    await waitFor(() => expect(posted).toHaveLength(2));
    expect(posted[1].body.requestId).toBeTruthy();
    expect(posted[1].body.requestId).not.toBe(posted[0].body.requestId);
  });

  it("says plainly when a hand-back was already recorded", async () => {
    replies = [{ status: 200, body: { success: true, duplicate: true, message: "125.5 credits went back to the village faucet." } }];
    const user = userEvent.setup();
    await renderPanel();
    await user.click(screen.getByRole("button", { name: "Hand it back" }));
    expect(await screen.findByRole("status")).toHaveTextContent("This exact request was already recorded, so nothing new moved.");
  });

  it("says plainly when the server already had this exact request", async () => {
    replies = [{ status: 200, body: { success: true, duplicate: true } }];
    const user = userEvent.setup();
    await renderPanel();
    await fund(user, "60", "Pressed twice");
    expect(await screen.findByRole("status")).toHaveTextContent("This exact request was already recorded, so nothing new moved.");
    expect(screen.queryByText(/The treasury is funded/)).toBeNull();
  });
});
