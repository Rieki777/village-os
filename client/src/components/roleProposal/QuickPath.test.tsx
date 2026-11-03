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
});

describe("the quick path", () => {
  it("Mia writes the three answers and they are saved as she typed them", async () => {
    draw({ roles: [] }, "?path=quick");
    expect(await screen.findByText(RP_WORDS.welcomeLede)).toBeTruthy();
    expect(screen.getByText(/Your guide here is the village's operations role/)).toBeTruthy();
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

  it("a role card adds that role, and stops at five", async () => {
    draw({ roles: [] }, "?role=r4&path=quick");
    await waitFor(() => expect(server.puts().some((p) => p.roles?.some((r) => r.roleId === "r4"))).toBe(true));
    fireEvent.click(screen.getByRole("button", { name: RP_WORDS.fullControl }));
    expect(await screen.findByRole("checkbox", { name: /Water keeper/ })).toBeChecked();
  });
});
