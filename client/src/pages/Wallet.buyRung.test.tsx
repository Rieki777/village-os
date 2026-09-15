// @vitest-environment jsdom
/**
 * WHICH RUNG THE EXCHANGE SAYS OPENS BUYING.
 *
 * `progression.unlock.exchange.buy` is an open-ring dial whose default is the
 * platform's own STAGE_UNLOCKS entry, "member". Any member may put it on a
 * ballot, and a village may move it up the ladder or set it to "none" and
 * grant buying by role alone. This caption was the literal "Buying opens at
 * the member stage", so every village that moved the rung published a rule it
 * had voted against, on the page where a member meets the refusal.
 *
 * `GET /api/exchange` carries only the BOOLEAN `mine.canBuy`, which is the
 * answer for one member and never the rule. The rung itself now rides on
 * `GET /api/game/rules`, the anonymous whitelist whose own header says it
 * exists "so the UI can render the game's actual rules rather than hardcoded
 * copy", and the stage's NAME comes from the live config the shell already
 * reads. `gateLabel` in lib/questBoard.ts words a quest's stage gate the same
 * way, so the two sentences on a member's screen match.
 *
 * Every assertion below reads the rendered caption.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";

vi.mock("@/components/Layout", () => ({
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("@/components/modules/ModuleGate", () => ({ default: () => <div /> }));
vi.mock("@/components/SwapCard", () => ({ default: () => <div /> }));
vi.mock("@/components/ExamplesBanner", () => ({ ExamplesBanner: () => <div /> }));
vi.mock("@/modules/ModuleProvider", () => ({
  useModule: () => ({ id: "exchange", lifecycle: "public" }),
  useModules: () => ({ loaded: true }),
  // The page reads `hypha.configured` with no guard, so the provider's own
  // shape is what a test has to hand it.
  useHypha: () => ({ configured: false }),
}));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "usr-ana", name: "Ana" } }),
}));
vi.mock("@/hooks/useTokenNames", () => ({ useTokenName: () => "Gratitude" }));

const STAGES = [
  { id: "member", name: "Member", description: "" },
  { id: "co-creator", name: "Co-Creator", description: "" },
];

vi.mock("@/lib/gameApi", () => ({
  authToken: () => "a-session",
  useGameConfig: () => ({ stages: STAGES }),
}));

import Wallet from "./Wallet";

/**
 * One real, in-stock, priced listing this member cannot buy: the exact state
 * that draws the caption. `canBuy` false is the member's own answer; the RULE
 * behind it is what the caption has to state.
 */
const EXCHANGE = {
  listings: [
    {
      slug: "village-credit",
      name: "Village Credit",
      kind: "credit",
      priceMinor: 500,
      inStock: true,
      isExample: false,
      sortOrder: 1,
    },
  ],
  mine: { balances: {}, tokenNames: {}, tokenDecimals: {}, orders: [], canBuy: false, canSwap: false, canManage: false },
  swap: { enabled: false, halted: [], myPairs: [], notSwappable: [] },
  stripeConfigured: true,
  tradingEnabled: false,
};

/** `/api/game/rules` answering with one exchange block; `/api/exchange` fixed. */
const serve = (exchange: unknown) => {
  const fetchMock = vi.fn(async (url: string) => {
    if (String(url).includes("/api/game/rules")) {
      return { ok: true, json: async () => ({ exchange }) } as unknown as Response;
    }
    return { ok: true, json: async () => EXCHANGE } as unknown as Response;
  });
  vi.stubGlobal("fetch", fetchMock);
};

const caption = async (): Promise<string> => {
  const found = await waitFor(() => {
    const hit = screen.getAllByText(/Buying/i).find((el) => el.textContent);
    if (!hit) throw new Error("the buying caption has not rendered");
    return hit;
  });
  return String(found.textContent).replace(/\s+/g, " ").trim();
};

describe("the exchange names the rung this village voted", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("says Member when the village left the rung where the platform put it", async () => {
    serve({ buyOpensAt: "member" });
    render(<Wallet />);
    expect(await caption()).toBe("Buying opens at the Member stage");
  });

  it("says Co-Creator when the village moved the rung up the ladder", async () => {
    serve({ buyOpensAt: "co-creator" });
    render(<Wallet />);
    const text = await caption();
    expect(text).toBe("Buying opens at the Co-Creator stage");
    expect(text).not.toContain("Member");
  });

  /**
   * A rung the live config does not name still prints SOMETHING true: the id
   * itself. A village that renamed its ladder is better served by its own word
   * than by a caption that vanishes.
   */
  it("falls back to the rung's own id when the ladder does not name it", async () => {
    serve({ buyOpensAt: "elder" });
    render(<Wallet />);
    expect(await caption()).toBe("Buying opens at the elder stage");
  });

  it("stops claiming a stage at all when the village opened buying by role", async () => {
    serve({ buyOpensAt: "none" });
    render(<Wallet />);
    const text = await caption();
    expect(text).toBe("Buying opens by role here, never by stage");
    expect(text).not.toContain("stage.");
  });

  /**
   * AN ABSENT PAYLOAD IS NOT A RUNG. Until the rules arrive the caption says
   * only what is true of this member, and names no rung at all.
   */
  it("names no rung while the rules have not arrived", async () => {
    serve(undefined);
    render(<Wallet />);
    const text = await caption();
    expect(text).toBe("Buying is not open to you yet");
    expect(text).not.toContain("Member");
  });
});
