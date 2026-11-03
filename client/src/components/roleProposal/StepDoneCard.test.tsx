// @vitest-environment jsdom
/**
 * After each screen, a card says what was saved and what comes next.
 * Focus moves to that card. The words are the feedback, with and without
 * reduced motion, on the night sheet's card.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Router } from "wouter";
import { fakeServer, PROPOSAL_ID, proposalWith } from "@/test/roleProposalFixture";
import { stepDone } from "@shared/stepDone";
import { AUTOSAVE } from "./useAutosave";
import { RP_WORDS } from "./proposalWords";

vi.mock("@/lib/gameApi", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/gameApi")>()), authToken: () => "t" }));
vi.mock("@/components/governance/pickSources", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/governance/pickSources")>();
  const { ORG } = await import("@/test/roleProposalFixture");
  return { ...actual, loadOrg: async () => ORG };
});
vi.mock("@/lib/seatPresetsRead", () => ({ useVillagePresets: () => [] }));
vi.mock("@/lib/guideApi", () => ({ fetchGuide: async () => null }));

import ProposalEditor from "./ProposalEditor";

beforeEach(() => {
  AUTOSAVE.delayMs = 0;
  window.matchMedia = vi.fn().mockImplementation(() => ({
    matches: true,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
  })) as unknown as typeof window.matchMedia;
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.sessionStorage.clear();
});

describe("the step done card", () => {
  it("says what was saved and what comes next, and moves focus there", async () => {
    const server = fakeServer({ roles: [] }, {});
    vi.stubGlobal("fetch", vi.fn(server.fetch));
    window.history.replaceState(null, "", `/role-proposals/${PROPOSAL_ID}?path=quick`);
    render(
      <Router>
        <ProposalEditor initial={proposalWith({ roles: [] })} me="u-me" />
      </Router>,
    );
    fireEvent.click(await screen.findByRole("button", { name: RP_WORDS.startQuestions }));
    const started = stepDone("welcome");
    const head = await screen.findByRole("heading", { name: started.saved });
    await waitFor(() => expect(head).toHaveFocus());
    const card = head.closest("[data-step-done]") as HTMLElement;
    expect(card.textContent).toContain(started.next);
    expect(card.className).toContain("bg-card");
    expect(card.className).toContain("motion-reduce:transition-none");
    expect(card.className).not.toMatch(/animate-/);
    expect(screen.getByLabelText(RP_WORDS.love)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: RP_WORDS.back }));
    expect(screen.queryByRole("heading", { name: started.saved })).toBeNull();
    expect(screen.getByRole("heading", { name: RP_WORDS.welcomeTitle })).toBeTruthy();
  });

  it("after the roles screen, names the roles and the words that come next", async () => {
    const server = fakeServer({ roles: [] }, {});
    vi.stubGlobal("fetch", vi.fn(server.fetch));
    window.history.replaceState(null, "", `/role-proposals/${PROPOSAL_ID}?path=full`);
    render(
      <Router>
        <ProposalEditor initial={proposalWith({ roles: [] })} me="u-me" />
      </Router>,
    );
    fireEvent.click(await screen.findByRole("button", { name: RP_WORDS.next }));
    const line = stepDone("roles");
    expect(await screen.findByRole("heading", { name: line.saved })).toBeTruthy();
    expect(screen.getByText(line.next)).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Each role's words" })).toBeTruthy();
  });
});
