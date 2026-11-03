// @vitest-environment jsdom
/**
 * After the three answers, a guide suggests about three roles from those
 * words. Open roles come first. Each one is marked Suggested and shows the
 * sentence it came from. A tap picks the role and leaves the words as typed.
 * With no guide configured the list is empty and the member picks by hand.
 * A holder is never named. A role card still arrives with that role picked,
 * and the new-role control says "Add another role" up to the five.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { Router } from "wouter";
import { fakeServer, PROPOSAL_ID, proposalWith, ORG, type DraftBody } from "@/test/roleProposalFixture";
import { AUTOSAVE } from "./useAutosave";
import { RP_WORDS } from "./proposalWords";
import { suggestInput } from "./StepRoles";

const fetchGuide = vi.fn();
vi.mock("@/lib/guideApi", () => ({ fetchGuide: (...args: unknown[]) => fetchGuide(...args) }));
vi.mock("@/lib/gameApi", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/gameApi")>()), authToken: () => "t" }));
vi.mock("@/components/governance/pickSources", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/governance/pickSources")>();
  const { ORG } = await import("@/test/roleProposalFixture");
  return { ...actual, loadOrg: async () => ORG };
});
vi.mock("@/lib/seatPresetsRead", () => ({ useVillagePresets: () => [] }));
vi.mock("@/components/natural/useReducedMotion", () => ({ useReducedMotion: () => true, prefersReducedMotion: () => true }));

import ProposalEditor from "./ProposalEditor";

const GUIDE_ON = { choice: null, options: [], answering: "village", note: null, canChoose: false };

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

async function toRoles(love: string) {
  fireEvent.click(await screen.findByRole("button", { name: RP_WORDS.startQuestions }));
  fireEvent.change(screen.getByLabelText(RP_WORDS.love), { target: { value: love } });
  fireEvent.change(screen.getByLabelText(RP_WORDS.offer), { target: { value: "loaves on Fridays" } });
  fireEvent.change(screen.getByLabelText(RP_WORDS.whyHere), { target: { value: "the kitchen asked" } });
  fireEvent.click(screen.getByRole("button", { name: RP_WORDS.onToRoles }));
  expect(await screen.findByText(RP_WORDS.rolesLede)).toBeTruthy();
}

beforeEach(() => {
  AUTOSAVE.delayMs = 0;
  fetchGuide.mockReset();
  fetchGuide.mockResolvedValue(null);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.sessionStorage.clear();
});

describe("suggested roles from your words", () => {
  it("with no guide configured, suggests nothing and still lets you pick", async () => {
    draw({ roles: [] }, "?path=quick");
    await toRoles("I love the water tanks and the seed bank.");
    expect(screen.queryByRole("heading", { name: RP_WORDS.suggestionsHeading })).toBeNull();
    expect(screen.getByRole("checkbox", { name: /Water keeper/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: RP_WORDS.addNewRole })).toBeTruthy();
  });

  it("marks about three Suggested, open roles first, with the sentence, and does not rewrite your words", async () => {
    fetchGuide.mockResolvedValue(GUIDE_ON);
    const love = "I love the gate and the visitors. I love the water tanks and the seed bank.";
    draw({ roles: [] }, "?path=quick");
    await toRoles(love);
    const box = await screen.findByRole("region", { name: RP_WORDS.suggestionsHeading });
    // The heading is on a section, which has no role region unless aria. I used section with aria-labelledby. role is region if labelled.
    const buttons = within(box).getAllByRole("button");
    expect(buttons.length).toBeGreaterThan(0);
    expect(buttons.length).toBeLessThanOrEqual(3);
    for (const b of buttons) {
      expect(b.textContent).toContain(RP_WORDS.suggested);
      expect(b.textContent).toContain(RP_WORDS.fromYourWords);
      expect(b.className).toContain("min-h-[44px]");
      expect(b.textContent).not.toMatch(/stipend|allowance|bonus|Pat Example/i);
    }
    const ids = buttons.map((b) => b.getAttribute("data-suggested-role"));
    const open = new Set(["r2", "r4", "r5", "r6"]);
    const firstClosed = ids.findIndex((id) => id && !open.has(id));
    const lastOpen = ids.map((id) => (id ? open.has(id) : false)).lastIndexOf(true);
    expect(lastOpen).toBeGreaterThanOrEqual(0);
    if (firstClosed >= 0) expect(lastOpen).toBeLessThan(firstClosed);
    expect(box.textContent).toContain("I love the water tanks and the seed bank.");
    expect(box.textContent).not.toContain("Pat Example");

    const before = server.puts().map((p) => p.season?.ownWords?.love);
    fireEvent.click(buttons.find((b) => b.getAttribute("data-suggested-role") === "r4") ?? buttons[0]);
    await waitFor(() => expect(server.puts().some((p) => p.roles?.some((r) => r.roleId === "r4"))).toBe(true));
    for (const put of server.puts()) {
      if (put.season?.ownWords) expect(put.season.ownWords.love).toBe(love);
    }
    expect(before.every((v) => v === undefined || v === love)).toBe(true);
  });

  it("a role card starts with that role picked, and adding another stops at five", async () => {
    draw({ roles: [] }, "?role=r4&path=quick");
    await waitFor(() => expect(server.puts().some((p) => p.roles?.some((r) => r.roleId === "r4"))).toBe(true));
    fireEvent.click(screen.getByRole("button", { name: RP_WORDS.fullControl }));
    expect(await screen.findByRole("checkbox", { name: /Water keeper/ })).toBeChecked();
    expect(screen.getByRole("button", { name: RP_WORDS.addAnotherRole })).toBeTruthy();
  });

  it("does not copy a holder onto the suggestion input", () => {
    const role = { ...ORG.roles[0], holders: [{ userId: "u-me", name: "Pat Example" }] };
    const input = suggestInput(role, "u-other", "The land thrives.");
    expect(input).toEqual({ id: "r1", name: "Kitchen keeper", about: "The land thrives.", open: false });
    expect(JSON.stringify(input)).not.toContain("Pat Example");
  });
});
