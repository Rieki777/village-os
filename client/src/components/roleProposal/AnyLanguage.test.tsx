// @vitest-environment jsdom
/**
 * Your words, and a later edit, can be written in any language. The screen
 * says so. What was typed is what is saved.
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
vi.mock("@/lib/guideApi", () => ({ fetchGuide: async () => null }));
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

describe("any language", () => {
  it("says any language is welcome, and saves the three answers exactly", async () => {
    draw({ roles: [] }, "?path=quick");
    fireEvent.click(await screen.findByRole("button", { name: RP_WORDS.startQuestions }));
    expect(screen.getByText(RP_WORDS.anyLanguage)).toBeTruthy();
    const love = "Me encanta el horno, パンと窯";
    const offer = "Je tiens le four  ";
    const why = "لماذا هنا";
    fireEvent.change(screen.getByLabelText(RP_WORDS.love), { target: { value: love } });
    fireEvent.change(screen.getByLabelText(RP_WORDS.offer), { target: { value: offer } });
    fireEvent.change(screen.getByLabelText(RP_WORDS.whyHere), { target: { value: why } });
    await waitFor(() => {
      expect(server.puts().at(-1)?.season?.ownWords).toEqual({ love, offer, why });
    });
  });

  it("saves an edit on a role in the language it was typed", async () => {
    draw({ roles: [{ roleId: "r1" }] }, "?path=full&step=words");
    expect(await screen.findByText(RP_WORDS.anyLanguage)).toBeTruthy();
    const aim = "El dominio es la cocina";
    fireEvent.change(screen.getByLabelText("Purpose"), { target: { value: aim } });
    await waitFor(() => expect(server.puts().at(-1)?.roles?.[0]?.words.aim).toBe(aim));
  });
});
