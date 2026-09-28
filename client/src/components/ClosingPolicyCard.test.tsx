// @vitest-environment jsdom
/**
 * WHAT A MEMBER READS ABOUT A VILLAGE CLOSING, AND THE DOOR TO CHANGE IT.
 *
 * The card on /exit-policy (Rye, 2026-09-25): every member reads the closing
 * policy, and may propose a change from day one. What this pins:
 *
 *   - ONLY ADOPTED WORDS are printed as the village's. A draft, which is also
 *     what the pre-filled default is until somebody adopts it, prints the
 *     "not yet named" sentence and none of its own words.
 *   - The door says which of its states this reader is in, and a reader it
 *     cannot answer for (signed out, or a read still in flight) gets nothing
 *     rather than a claim about them.
 *   - The ask opens the practice vote with the FIXED question, so a second
 *     member finds the first ask instead of ringing the roll twice.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const auth = vi.hoisted(() => ({ user: null as any, loading: false }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => auth }));

const catalog = vi.hoisted(() => ({ modules: [] as any[], loaded: true, failed: false }));
vi.mock("@/modules/ModuleProvider", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/modules/ModuleProvider")>();
  return {
    ...real,
    useModules: () => ({ ...catalog }),
    useModule: (id: string) => catalog.modules.find((m) => m.id === id),
  };
});

const gov = vi.hoisted(() => ({
  facts: { ok: true, data: { mayOpenAdvisory: true } } as any,
  ballots: { ok: true, data: [] as any[] } as any,
}));
vi.mock("@/components/governance/governanceApi", () => ({
  fetchWizardFacts: async () => gov.facts,
  fetchBallots: async () => gov.ballots,
}));

// The practice vote is its own suite's subject. Here it only has to show it
// was opened, and with which question.
vi.mock("@/components/governance/PracticeVote", () => ({
  default: ({ asking }: any) => <p data-testid="practice-vote">{asking?.question}</p>,
}));

import ClosingPolicyCard, { CLOSING_CHANGE_QUESTION } from "./ClosingPolicyCard";
import { PROPORTIONAL_CLOSING_STATEMENT } from "@shared/closingPolicies";

const GOVERNANCE_ON = { id: "governance", name: "Governance", description: "", core: false, lifecycle: "members", hyphaLinks: [] };
const MEMBER = { id: "user-wren", name: "Wren" };
const ADOPTED = { policyId: "proportional-closing-balance", statement: PROPORTIONAL_CLOSING_STATEMENT, adoptedAt: "2026-10-03T10:00:00.000Z" };
const OWN = "If the village closes, the land passes to a community land trust and the cash is shared among whoever still lives here.";

beforeEach(() => {
  auth.user = MEMBER;
  auth.loading = false;
  catalog.modules = [GOVERNANCE_ON];
  catalog.loaded = true;
  gov.facts = { ok: true, data: { mayOpenAdvisory: true } };
  gov.ballots = { ok: true, data: [] };
});

describe("the words a member reads", () => {
  it("prints adopted words, the policy's name and the day", () => {
    render(<ClosingPolicyCard closing={ADOPTED} />);
    expect(screen.getByText(PROPORTIONAL_CLOSING_STATEMENT)).toBeInTheDocument();
    expect(screen.getByText(/Shared by closing-day balances\. Adopted on/)).toBeInTheDocument();
    expect(screen.queryByText(/has not yet named/)).toBeNull();
  });

  it("prints a village's own words under its own name", () => {
    render(<ClosingPolicyCard closing={{ policyId: "own-words", statement: OWN, adoptedAt: ADOPTED.adoptedAt }} />);
    expect(screen.getByText(OWN)).toBeInTheDocument();
    expect(screen.getByText(/In the village's own words\. Adopted on/)).toBeInTheDocument();
  });

  it("never prints a DRAFT as the village's words, even the default's", () => {
    render(<ClosingPolicyCard closing={{ ...ADOPTED, adoptedAt: null }} />);
    expect(screen.getByText(/has not yet named what happens to its treasury and assets/)).toBeInTheDocument();
    expect(screen.queryByText(PROPORTIONAL_CLOSING_STATEMENT)).toBeNull();
  });

  it("says plainly when there is nothing at all, which is every policy saved before this existed", () => {
    render(<ClosingPolicyCard closing={undefined} />);
    expect(screen.getByText(/has not yet named what happens to its treasury and assets/)).toBeInTheDocument();
  });
});

describe("the door to propose a change", () => {
  it("offers nothing to a signed-out reader, who still reads the words", () => {
    auth.user = null;
    render(<ClosingPolicyCard closing={ADOPTED} />);
    expect(screen.getByText(PROPORTIONAL_CLOSING_STATEMENT)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Propose a change" })).toBeNull();
    expect(screen.queryByText(/governance/)).toBeNull();
  });

  it("says why there is no vote when the village has not turned governance on", () => {
    catalog.modules = [];
    render(<ClosingPolicyCard closing={ADOPTED} />);
    expect(screen.getByText(/has not turned governance on yet/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Propose a change" })).toBeNull();
  });

  it("says so, without a button, to an account that does not open votes", async () => {
    gov.facts = { ok: true, data: { mayOpenAdvisory: false } };
    render(<ClosingPolicyCard closing={ADOPTED} />);
    expect(await screen.findByText(/this\s+account does not open those yet/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Propose a change" })).toBeNull();
  });

  it("stays quiet when the read did not answer, and invents nothing about the reader", async () => {
    gov.facts = { ok: false, error: "dropped" };
    render(<ClosingPolicyCard closing={ADOPTED} />);
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.queryByRole("button", { name: "Propose a change" })).toBeNull();
    expect(screen.queryByText(/does not open those/)).toBeNull();
  });

  it("opens the practice vote with the fixed question for a member who may open one", async () => {
    render(<ClosingPolicyCard closing={ADOPTED} />);
    fireEvent.click(await screen.findByRole("button", { name: "Propose a change" }));
    await waitFor(() => expect(screen.getByTestId("practice-vote").textContent).toBe(CLOSING_CHANGE_QUESTION));
  });

  it("sends a member to the vote already running, and opens no second one", async () => {
    gov.ballots = {
      ok: true,
      data: [
        { id: "bal-other", subjectType: "advisory", status: "open", title: "Should this village turn on Events?" },
        { id: "bal-closing", subjectType: "advisory", status: "open", title: CLOSING_CHANGE_QUESTION },
      ],
    };
    render(<ClosingPolicyCard closing={ADOPTED} />);
    const link = await screen.findByRole("link", { name: "Go to the vote" });
    expect(link.getAttribute("href")).toBe("/decisions/bal-closing");
    expect(screen.queryByRole("button", { name: "Propose a change" })).toBeNull();
  });
});
