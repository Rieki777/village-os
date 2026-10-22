// @vitest-environment jsdom
/**
 * WHAT THE WALLET ACTUALLY PRINTS.
 *
 * The card renders `GET /api/me/wallet` and decides nothing of its own, so
 * these cases assert on the DOM a member reads, against payloads in the real
 * shape `assembleWallet` (server/lib/wallet.ts) sends:
 *
 *   - a balance is divided by its own scale: ten Village Voice is 1000 on the
 *     row and reads 10, never 1000 (the defect this card was first tested for);
 *   - an unpriced token reads "No price set" and no money figure appears;
 *   - Gratitude reads as thanks received and giving left, and carries no price
 *     and no claim button;
 *   - a claimable token says why it cannot be claimed and when that changes,
 *     and offers no button that would fail;
 *   - the on-Base side is a number only when Base said one;
 *   - the card renders with the exchange module off, which the old card did not.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

const modules = vi.hoisted(() => ({ exchange: false }));

vi.mock("@/modules/ModuleProvider", () => ({
  useModule: (id: string) => (id === "exchange" && modules.exchange ? { id: "exchange", lifecycle: "public" } : undefined),
  useModules: () => ({
    modules: modules.exchange ? [{ id: "exchange", lifecycle: "public" }] : [],
    loaded: true,
    failed: false,
  }),
}));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "usr-ora", name: "Ora" } }),
}));
vi.mock("@/lib/gameApi", () => ({ authToken: () => "a-session" }));
vi.mock("wouter", () => ({
  Link: ({ children }: { children: React.ReactNode }) => <a href="/tokens">{children}</a>,
}));

import WalletCard from "./WalletCard";

const unset = { state: "unset", says: "No price set" };
const blocked = {
  claimable: false,
  says: "3 gathered, and ready. The connection to Hypha is still being finished.",
  opens: "Claims open once the connection to Hypha is finished. No date is set yet.",
  threshold: 1,
  openClaim: null,
  claimedToHypha: 0,
};

/** The payload a member with some of everything is sent, field for field. */
const PAYLOAD = {
  bridgeReady: false,
  rows: [
    {
      token: "earned-equity", name: "Earned Equity", kind: "equity", role: "claimable", decimals: 0,
      heldUnits: 3, lockedUnits: 0, locks: [], claim: blocked, staysHere: null,
      onBase: { state: "hidden", mirror: "equity", mirrorName: "Village Equity", says: "This village does not show on-chain holdings yet." },
      gratitude: null, price: unset,
    },
    {
      token: "village-voice", name: "Village Voice", kind: "voice", role: "claimable", decimals: 2,
      heldUnits: 1000, lockedUnits: 0, locks: [],
      claim: { ...blocked, says: "10 gathered. Claims open at 100.", threshold: 100 },
      staysHere: null,
      onBase: { state: "read", mirror: "voice", mirrorName: "Voice", formatted: "42", fetchedAt: "2026-10-20T09:00:00.000Z", says: "As Base last said, on 2026-10-20." },
      gratitude: null, price: unset,
    },
    {
      token: "credits", name: "Village Credits", kind: "credit", role: "village", decimals: 2,
      heldUnits: 1250, lockedUnits: 0, locks: [], claim: null,
      staysHere: "Stays in the village. There is nothing to claim on Hypha.",
      onBase: null, gratitude: null, price: unset,
    },
    {
      token: "gratitude", name: "Gratitude", kind: "recognition", role: "gratitude", decimals: 0,
      heldUnits: 45, lockedUnits: 0, locks: [], claim: null,
      staysHere: "Gratitude is given and received here, and never claimed or sent to Base.",
      onBase: null,
      gratitude: { givingLeft: 70, givingTotal: 100, cycleKey: "lunar-000330", says: "70 of 100 left to give this cycle. What you do not give expires when the cycle closes." },
      price: { state: "never", says: "Gratitude is never priced. What you receive decides your share of the cycle pool." },
    },
  ],
};

const serve = (body: unknown) =>
  vi.fn().mockResolvedValue({ ok: true, json: async () => body } as unknown as Response);

describe("the wallet on a member's own profile", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    modules.exchange = false;
  });

  it("renders with the exchange module off, and asks the wallet route with the session", async () => {
    const fetchMock = serve(PAYLOAD);
    vi.stubGlobal("fetch", fetchMock);
    render(<WalletCard />);
    await waitFor(() => expect(screen.getByText("Earned Equity")).toBeInTheDocument());
    expect(fetchMock.mock.calls[0][0]).toBe("/api/me/wallet");
    expect((fetchMock.mock.calls[0][1] as RequestInit).headers).toMatchObject({ Authorization: "Bearer a-session" });
    // No exchange, no link to it.
    expect(screen.queryByText("The Exchange")).toBeNull();
  });

  it("prints ten for ten Village Voice, and never the ledger's thousand", async () => {
    vi.stubGlobal("fetch", serve(PAYLOAD));
    render(<WalletCard />);
    await waitFor(() => expect(screen.getByText("10")).toBeInTheDocument());
    expect(screen.queryByText("1000")).toBeNull();
    expect(screen.getByText("12.5")).toBeInTheDocument();
  });

  it("says no price in words and prints no money figure for an unpriced token", async () => {
    vi.stubGlobal("fetch", serve(PAYLOAD));
    const { container } = render(<WalletCard />);
    await waitFor(() => expect(screen.getAllByText("No price set").length).toBe(3));
    // Not a $0, and not a currency sign anywhere on the card.
    expect(container.textContent).not.toMatch(/\$|USD|CHF|€/);
  });

  it("shows Gratitude as thanks received and giving left, with no price and no claim", async () => {
    vi.stubGlobal("fetch", serve(PAYLOAD));
    render(<WalletCard />);
    await waitFor(() => expect(screen.getByText("Thanks received")).toBeInTheDocument());
    expect(screen.getByText("45")).toBeInTheDocument();
    expect(screen.getByText("70 of 100 left to give this cycle. What you do not give expires when the cycle closes.")).toBeInTheDocument();
    expect(screen.getByText("Gratitude is never priced. What you receive decides your share of the cycle pool.")).toBeInTheDocument();
  });

  it("says why a claim cannot be made and when that changes, and offers no button that would fail", async () => {
    vi.stubGlobal("fetch", serve(PAYLOAD));
    render(<WalletCard />);
    await waitFor(() =>
      expect(screen.getByText("3 gathered, and ready. The connection to Hypha is still being finished.")).toBeInTheDocument(),
    );
    expect(screen.getAllByText("Claims open once the connection to Hypha is finished. No date is set yet.").length).toBe(2);
    expect(screen.queryByRole("button", { name: /Claim/ })).toBeNull();
  });

  it("offers the claim only when the engine says it can be made", async () => {
    const open = JSON.parse(JSON.stringify(PAYLOAD));
    open.rows[0].claim = { ...blocked, claimable: true, says: "3 ready to claim.", opens: "Claims Week is open now." };
    vi.stubGlobal("fetch", serve(open));
    render(<WalletCard />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Claim 3 on Hypha" })).toBeInTheDocument());
  });

  it("prints a Base figure only when Base said one", async () => {
    vi.stubGlobal("fetch", serve(PAYLOAD));
    render(<WalletCard />);
    await waitFor(() => expect(screen.getByText("On Base, as Voice")).toBeInTheDocument());
    expect(screen.getByText("42")).toBeInTheDocument();
    expect(screen.getByText("On Base, as Village Equity")).toBeInTheDocument();
    expect(screen.getByText("This village does not show on-chain holdings yet.")).toBeInTheDocument();
  });

  it("prints a posted price as money, at the exchange's own figure", async () => {
    modules.exchange = true;
    const priced = JSON.parse(JSON.stringify(PAYLOAD));
    priced.rows[2].price = { state: "priced", currency: "USD", perTokenMinor: 40, heldValueMinor: 500, since: "2026-10-01T00:00:00.000Z" };
    vi.stubGlobal("fetch", serve(priced));
    render(<WalletCard />);
    await waitFor(() => expect(screen.getByText(/\$0\.40 each at the exchange/)).toBeInTheDocument());
    expect(screen.getByText(/yours come to \$5\.00/)).toBeInTheDocument();
    expect(screen.getByText("The Exchange")).toBeInTheDocument();
  });

  it("tells a failed load apart from an empty wallet", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) } as unknown as Response));
    render(<WalletCard />);
    await waitFor(() => expect(screen.getByText(/Your wallet didn't load/)).toBeInTheDocument());
    expect(screen.queryByText("This village has no tokens yet.")).toBeNull();
  });
});
