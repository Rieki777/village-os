// @vitest-environment jsdom
/**
 * THE WIZARD'S LIVE PREVIEW OF THE ROLE BEING PICKED.
 *
 * Three proposal types pick a role with powers, and the wizard now draws the
 * picked role as its card (`WizardRolePreview`) beside the steps on a laptop
 * and under the question on a phone. The promises held here are the ones a
 * member would notice broken:
 *
 *   1. Nothing is drawn until a role is picked, and picking draws THAT role.
 *   2. The picker, the preview and the read-back share ONE `/api/roles` read
 *      (`loadPermissionRoles`), so they cannot disagree about a role and
 *      picking costs no second request.
 *   3. The read-back names the role (and every other value picked from a
 *      list), where it used to print the id.
 *
 * Driven through the real `ProposalWizard` (its governance API stubbed), so
 * the test reads the wiring a member meets and never a harness's copy of it.
 *
 * THE FIRST TEST COUNTS REQUESTS, and it is first on purpose: the roles read
 * is shared for a minute, which outlives every test in this file.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { Router } from "wouter";
import { GAME_CONFIG } from "@shared/gameConfig";
import { walkFor } from "./wizardWalk";

const drafts = vi.hoisted(() => ({ list: [] as unknown[] }));

vi.mock("@/lib/gameApi", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  authToken: () => "a-token",
}));
vi.mock("./governanceApi", () => ({
  fetchWizardFacts: async () => ({
    ok: true,
    data: { conductable: ["role_seat"], advisory: [], mayOpenAdvisory: false, supportThreshold: 0 },
  }),
  fetchDrafts: async () => ({ ok: true, data: { cap: 10, drafts: drafts.list } }),
  saveDraft: async (input: { id: string | null }) => ({ ok: true, data: { draft: { id: input.id ?? "d1" } } }),
  deleteDraft: async () => ({ ok: true, data: {} }),
  publishProposal: async () => ({ ok: true, data: {} }),
  openAdvisory: async () => ({ ok: true, data: {} }),
}));

import ProposalWizard from "./ProposalWizard";
import WizardRolePreview from "./WizardRolePreview";
import { loadPermissionRoles } from "./pickSources";

const RUNG = GAME_CONFIG.stages[8];
const ROLES = [
  {
    id: "r-example",
    name: "Example Keeper",
    description: "",
    capabilities: [],
    minStage: null,
    isExample: true,
    circleId: null,
    seats: 1,
    holderCount: 0,
    holders: [],
  },
  {
    id: "r-steward",
    name: "Calendar Steward",
    description: "Keeps the village calendar honest.",
    capabilities: ["exchange.manage"],
    minStage: RUNG.id,
    isExample: false,
    circleId: null,
    seats: 2,
    holderCount: 1,
    holders: [{ userId: "u-ada", name: "Ada" }],
  },
];

const asked: string[] = [];

beforeEach(() => {
  // The wizard names its draft in the address once it has one (red team U3); each case starts at a bare /propose.
  window.history.replaceState(null, "", "/propose");
  asked.length = 0;
  drafts.list = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: unknown) => {
      const u = String(url);
      asked.push(u);
      const reply = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
      if (u === "/api/roles") return reply(ROLES);
      if (u === "/api/village/powers")
        return reply({ powers: [{ capability: "exchange.manage", title: "Run the exchange", movable: true, heldBy: null }] });
      if (u === "/api/game/config")
        return reply({ stages: GAME_CONFIG.stages, project: { roleName: "Circle role" } });
      if (u === "/api/season") return reply({ current: { name: "Season of Foundations", endsOn: "2099-03-21" }, daysLeft: 171 });
      return reply([]);
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const at = (step: string, type = "role_seat") => walkFor(type).findIndex((s) => s.key === step);
const draft = (payload: Record<string, unknown>, step: string, type = "role_seat") => ({
  id: "d1",
  wizardType: type,
  payload,
  stepIndex: at(step, type),
  createdAt: "2026-10-01T10:00:00.000Z",
  updatedAt: "2026-10-01T10:00:00.000Z",
});

async function continueDraft() {
  render(
    <Router>
      <ProposalWizard />
    </Router>,
  );
  fireEvent.click(await screen.findByRole("button", { name: "Continue" }));
}

describe("the wizard's preview of the picked role", () => {
  it("draws nothing until a role is picked, then that role, from the picker's own read", async () => {
    drafts.list = [draft({}, "subject")];
    await continueDraft();
    const select = screen.getByRole("combobox", { name: /^Role/ });
    await screen.findByRole("option", { name: /^Calendar Steward/ });
    // The picker offers the village's own roles and leaves the example out.
    expect(screen.queryByRole("option", { name: /Example Keeper/ })).toBeNull();
    // Nothing picked yet: no preview anywhere, and the rail is the narrow one.
    expect(screen.queryByText("Live preview")).toBeNull();
    expect(document.querySelector(".lg\\:grid-cols-\\[1fr_14rem\\]")).toBeTruthy();

    fireEvent.change(select, { target: { value: "r-steward" } });
    // Picked: the card for THAT role, in the rail and under the question.
    const cards = await screen.findAllByRole("article");
    expect(cards).toHaveLength(2);
    for (const card of cards) {
      expect(within(card).getByRole("heading", { level: 3, name: "Calendar Steward" })).toBeTruthy();
      // The village's word for a role and its own rungs reached the card through the wizard.
      expect(within(card).getByText("A circle role with powers")).toBeTruthy();
      expect(within(card).getByText(`Asks for ${RUNG.name} or above. The vote turns away anyone on a lower rung.`)).toBeTruthy();
    }
    expect(screen.getAllByText("Live preview")).toHaveLength(2);
    expect(document.querySelector(".lg\\:grid-cols-\\[1fr_22rem\\]")).toBeTruthy();
    // One read served the picker and both previews.
    expect(asked.filter((u) => u === "/api/roles")).toHaveLength(1);
  });

  it("names the picked role in the read-back, where it printed the role's id", async () => {
    drafts.list = [draft({ userId: "u-ada", roleId: "r-steward", reason: "She has kept the calendar since spring." }, "review")];
    await continueDraft();
    const row = (await screen.findByText("Role", { selector: "dt" })).parentElement!;
    await waitFor(() => expect(within(row).getByText("Calendar Steward")).toBeTruthy());
    expect(within(row).queryByText("r-steward")).toBeNull();
    // The phone's copy of the preview sits above the read-back on this step.
    const preview = screen.getAllByText("Live preview");
    expect(preview.length).toBeGreaterThan(0);
  });

  it("names every listed pick in the read-back, the power as well as the role", async () => {
    drafts.list = [draft({ capability: "exchange.manage", roleId: "r-steward", reason: "The stewards run it already." }, "review", "power_grant")];
    await continueDraft();
    const power = (await screen.findByText("The power", { selector: "dt" })).parentElement!;
    await waitFor(() => expect(within(power).getByText("Run the exchange")).toBeTruthy());
    expect(within(power).queryByText("exchange.manage")).toBeNull();
    const role = screen.getByText("Who would do it", { selector: "dt" }).parentElement!;
    expect(within(role).getByText("Calendar Steward")).toBeTruthy();
  });
});

describe("WizardRolePreview on its own", () => {
  it("draws nothing for an id the roles list does not hold, and the role for one it does", async () => {
    const { container, rerender } = render(<WizardRolePreview roleId="r-gone" look="rail" />);
    // Let the shared read land, and the render after it, before judging the empty one.
    expect(await loadPermissionRoles()).toHaveLength(2);
    await new Promise((r) => setTimeout(r, 20));
    expect(container.textContent).toBe("");
    rerender(<WizardRolePreview roleId="r-steward" look="rail" />);
    expect(await screen.findByRole("heading", { level: 3, name: "Calendar Steward" })).toBeTruthy();
  });
});
