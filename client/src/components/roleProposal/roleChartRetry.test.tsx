// @vitest-environment jsdom
/**
 * The role chart can fail to load. The step says so and asks again, and the
 * second read is the one that fills the list.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Router } from "wouter";
import { ORG, PROPOSAL_ID, proposalWith } from "@/test/roleProposalFixture";

const load = vi.hoisted(() => vi.fn());
vi.mock("@/lib/gameApi", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/gameApi")>()), authToken: () => "t" }));
vi.mock("@/components/governance/pickSources", () => ({ loadOrg: () => load() }));
vi.mock("@/lib/seatPresetsRead", () => ({ useVillagePresets: () => [] }));
vi.mock("@/components/natural/useReducedMotion", () => ({ useReducedMotion: () => true, prefersReducedMotion: () => true }));

import ProposalEditor from "./ProposalEditor";
import { RP_WORDS } from "./proposalWords";

afterEach(() => {
  cleanup();
  load.mockReset();
});

describe("the role chart did not load", () => {
  it("says so, and a second try fills the list", async () => {
    load.mockResolvedValueOnce(null).mockResolvedValueOnce(ORG);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ applications: [] }), { status: 200, headers: { "Content-Type": "application/json" } })));
    window.history.replaceState(null, "", `/role-proposals/${PROPOSAL_ID}?step=roles`);
    render(
      <Router>
        <ProposalEditor initial={proposalWith({ roles: [] })} me="u-me" />
      </Router>,
    );
    expect(await screen.findByText(/The roles did not load/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: RP_WORDS.tryAgain }));
    expect(await screen.findByText("Kitchen keeper")).toBeTruthy();
    expect(load).toHaveBeenCalledTimes(2);
  });
});
