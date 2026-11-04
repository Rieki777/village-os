// @vitest-environment jsdom
/**
 * On a phone the Back/Next bar sticks above the tab bar. The document needs
 * that same room after the bar, or the last card stays hidden behind both.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { RP_WORDS } from "./proposalWords";
import { Router } from "wouter";
import { fakeServer, PROPOSAL_ID, proposalWith } from "@/test/roleProposalFixture";
import ProposalEditor from "./ProposalEditor";

vi.mock("@/lib/gameApi", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/gameApi")>()), authToken: () => "t" }));
vi.mock("@/components/governance/pickSources", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/governance/pickSources")>();
  const { ORG } = await import("@/test/roleProposalFixture");
  return { ...actual, loadOrg: async () => ORG };
});
vi.mock("@/lib/seatPresetsRead", () => ({ useVillagePresets: () => [] }));
vi.mock("@/lib/guideApi", () => ({ fetchGuide: async () => null }));

afterEach(cleanup);

describe("the phone scroll room", () => {
  it("keeps one bar on a phone: the step bar sits at the edge and the tab bar steps out", () => {
    const server = fakeServer({ roles: [] }, {});
    vi.stubGlobal("fetch", vi.fn(server.fetch));
    window.history.replaceState(null, "", `/role-proposals/${PROPOSAL_ID}?path=full`);
    render(
      <Router>
        <ProposalEditor initial={proposalWith({ roles: [] })} me="u-me" />
      </Router>,
    );
    const pad = document.querySelector("[data-proposal-pad]") as HTMLElement;
    expect(pad.className).toContain("max-md:pb-[env(safe-area-inset-bottom,0px)]");
    const bar = document.querySelector("[data-step-bar]") as HTMLElement;
    expect(bar.className).toContain("bottom-[var(--rp-bar-bottom)]");
    expect(bar.hasAttribute("data-hides-tabbar-phone")).toBe(true);
    expect(bar.style.getPropertyValue("--rp-bar-bottom")).toBe("env(safe-area-inset-bottom, 0px)");
  });

  it("draws the quick path's Back and Pick the roles inside the sticky bar", async () => {
    const server = fakeServer({ roles: [] }, {});
    vi.stubGlobal("fetch", vi.fn(server.fetch));
    window.history.replaceState(null, "", `/role-proposals/${PROPOSAL_ID}?path=quick`);
    render(
      <Router>
        <ProposalEditor initial={proposalWith({ roles: [] })} me="u-me" />
      </Router>,
    );
    fireEvent.click(await screen.findByRole("button", { name: RP_WORDS.startQuestions }));
    const bar = document.querySelector("[data-step-bar]") as HTMLElement;
    expect(within(bar).getByRole("button", { name: RP_WORDS.onToRoles })).toBeTruthy();
    expect(within(bar).getByRole("button", { name: RP_WORDS.back })).toBeTruthy();
  });
});
