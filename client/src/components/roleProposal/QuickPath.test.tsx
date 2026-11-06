// @vitest-environment jsdom
/**
 * Three people on the front door.
 *
 * Mia, five minutes, on a phone: welcome, three questions, her words saved
 * as she typed them, then the roles.
 * Lena, the steward: Full control is the six steps, and switching back still
 * has what she typed.
 * A role card: the linked role is added, and a sixth role is not.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Router } from "wouter";
import { fixturePayload } from "@/test/playerCardFixture";
import { fakeServer, PROPOSAL_ID, proposalWith, type DraftBody } from "@/test/roleProposalFixture";
import { AUTOSAVE } from "./useAutosave";
import { RP_WORDS } from "./proposalWords";

vi.mock("@/lib/gameApi", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/gameApi")>()), authToken: () => "t" }));
vi.mock("@/components/governance/pickSources", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/governance/pickSources")>();
  const { ORG } = await import("@/test/roleProposalFixture");
  return { ...actual, loadOrg: async () => ORG };
});
vi.mock("@/lib/seatPresetsRead", () => ({ useVillagePresets: () => [] }));
vi.mock("@/components/natural/useReducedMotion", () => ({ useReducedMotion: () => true, prefersReducedMotion: () => true }));

import ProposalEditor from "./ProposalEditor";

let server: ReturnType<typeof fakeServer>;

function draw(body: DraftBody, search: string) {
  server = fakeServer(body, {});
  vi.stubGlobal("fetch", vi.fn(server.fetch));
  window.history.replaceState(null, "", `/role-proposals/${PROPOSAL_ID}${search}`);
  return render(
    <Router>
      <ProposalEditor initial={proposalWith(body)} me="u-me" />
    </Router>,
  );
}

beforeEach(() => {
  AUTOSAVE.delayMs = 0;
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.sessionStorage.clear();
});

describe("the quick path", () => {
  it("Mia writes the three answers and they are saved as she typed them", async () => {
    draw({ roles: [] }, "?path=quick");
    expect(await screen.findByText(RP_WORDS.welcomeLede)).toBeTruthy();
    expect(await screen.findByText(/Your guide here is .*guide\. Anything left open, you fill in together with the village's operations role/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: RP_WORDS.startQuestions }));
    const love = "I love the bread,  the early oven";
    fireEvent.change(screen.getByLabelText(RP_WORDS.love), { target: { value: love } });
    fireEvent.change(screen.getByLabelText(RP_WORDS.offer), { target: { value: "loaves on Fridays" } });
    fireEvent.change(screen.getByLabelText(RP_WORDS.whyHere), { target: { value: "the kitchen asked" } });
    expect(screen.getByText(RP_WORDS.yourWordsKept)).toBeTruthy();
    await waitFor(() => {
      const put = server.puts().at(-1);
      expect(put?.season?.ownWords).toEqual({ love, offer: "loaves on Fridays", why: "the kitchen asked" });
    });
  });

  it("Lena opens full control and her words are still there when she comes back", async () => {
    draw({ roles: [] }, "?path=quick");
    fireEvent.click(await screen.findByRole("button", { name: RP_WORDS.startQuestions }));
    fireEvent.change(screen.getByLabelText(RP_WORDS.love), { target: { value: "The seed lists" } });
    fireEvent.click(screen.getByRole("button", { name: RP_WORDS.fullControl }));
    expect(await screen.findByText(RP_WORDS.rolesLede)).toBeTruthy();
    expect(screen.getByText("Step 1 of 6")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: RP_WORDS.quickPath }));
    expect(screen.getByLabelText(RP_WORDS.love)).toHaveValue("The seed lists");
  });

  it("Mia can step back to her own words, and the bar moves forward", async () => {
    draw({ roles: [] }, "?path=quick");
    fireEvent.click(await screen.findByRole("button", { name: RP_WORDS.startQuestions }));
    const yours = screen.getByRole("progressbar");
    expect(yours.getAttribute("aria-valuenow")).toBe("2");
    fireEvent.click(screen.getByRole("button", { name: RP_WORDS.back }));
    expect(screen.getByText(RP_WORDS.welcomeLede)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: RP_WORDS.startQuestions }));
    fireEvent.click(screen.getByRole("button", { name: RP_WORDS.onToRoles }));
    expect(await screen.findByText(RP_WORDS.rolesLede)).toBeTruthy();
    const roles = screen.getByRole("progressbar");
    expect(Number(roles.getAttribute("aria-valuenow"))).toBeGreaterThan(2);
    fireEvent.click(screen.getByRole("button", { name: RP_WORDS.quickPath }));
    expect(screen.getByText(RP_WORDS.rolesLede)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: RP_WORDS.back }));
    expect(screen.getByLabelText(RP_WORDS.love)).toBeTruthy();
  });

  it("comes back to the step it left when the profile link names no step", async () => {
    draw({ roles: [] }, "?path=full");
    fireEvent.click(await screen.findByRole("button", { name: "Step 3: Your season" }));
    expect(await screen.findByText(RP_WORDS.seasonLede)).toBeTruthy();
    cleanup();
    window.history.replaceState(null, "", `/role-proposals/${PROPOSAL_ID}`);
    render(
      <Router>
        <ProposalEditor initial={proposalWith({ roles: [] })} me="u-me" />
      </Router>,
    );
    expect(await screen.findByText(RP_WORDS.seasonLede)).toBeTruthy();
    expect(screen.getByText("Step 3 of 6")).toBeTruthy();
  });

  it("a role card adds that role, and stops at five", async () => {
    draw({ roles: [] }, "?role=r4&path=quick");
    await waitFor(() => expect(server.puts().some((p) => p.roles?.some((r) => r.roleId === "r4"))).toBe(true));
    fireEvent.click(screen.getByRole("button", { name: RP_WORDS.fullControl }));
    expect(await screen.findByRole("checkbox", { name: /Water keeper/ })).toBeChecked();
  });

  it("a role card says so when the proposal already holds five, and does not add a sixth", async () => {
    draw({ roles: ["r1", "r2", "r3", "r4", "r5"].map((roleId) => ({ roleId })) }, "?role=r6&path=quick");
    expect(await screen.findByText(RP_WORDS.atMost(5))).toBeTruthy();
    expect(server.puts().some((p) => p.roles?.some((r) => r.roleId === "r6"))).toBe(false);
  });

  it("a role card says so when that role is not on the chart", async () => {
    draw({ roles: [] }, "?role=missing&path=quick");
    expect(await screen.findByText(RP_WORDS.roleNotOnChart)).toBeTruthy();
    expect(server.puts()).toEqual([]);
  });

  it("a submitted proposal is not opened for editing, even from a role card", async () => {
    const submitted = proposalWith({ roles: [{ roleId: "r1" }] }, { status: "submitted" });
    server = fakeServer({ roles: [{ roleId: "r1" }] }, { extra: { status: "submitted" }, card: fixturePayload(1, "self", { mode: "proposal" }) });
    vi.stubGlobal("fetch", vi.fn(server.fetch));
    window.history.replaceState(null, "", `/role-proposals/${PROPOSAL_ID}?role=r4&path=quick`);
    render(
      <Router>
        <ProposalEditor initial={submitted} me="u-me" />
      </Router>,
    );
    expect(await screen.findByText(RP_WORDS.stateHeading)).toBeTruthy();
    expect(screen.queryByText(RP_WORDS.rolesLede)).toBeNull();
    expect(server.puts()).toEqual([]);
  });
});
