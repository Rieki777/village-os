// @vitest-environment jsdom
/**
 * The proposal steps 1 to 4, rendered over a fake of the routes (role
 * proposals PR C).
 *
 *   1 the roles in three groups with counts and no names, a pick autosaves,
 *     at most five, and a new role is added in a circle;
 *   2 every field prefilled from the posted role, gold only on the field that
 *     changed with the posted words a tap away, "New" on a new role, the 3 to 6
 *     refusal, the CCOS term behind a heading, the holder's runbook and
 *     handover meter, and no AI button while the bridge is not configured;
 *   3 the village's goals for next season, ticked with how each helps, and the
 *     sentence when none are set, saving anyway;
 *   4 the load check, the review dates and the terms.
 *
 * Every save is read back off the PUT the page sent. Every name is made up.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { Router } from "wouter";
import { ROLE_CCOS_WORDS } from "@shared/roleCcos";
import { LOAD_WORDS } from "@shared/roleProposalLoad";
import { fakeServer, ORG, PROPOSAL_ID, proposalWith, type DraftBody } from "@/test/roleProposalFixture";

vi.mock("@/lib/gameApi", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/gameApi")>()), authToken: () => "t" }));
vi.mock("@/components/governance/pickSources", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/components/governance/pickSources")>()),
  loadOrg: async () => ORG,
}));
vi.mock("@/lib/seatPresetsRead", () => ({ useVillagePresets: () => [] }));
vi.mock("@/components/natural/useReducedMotion", () => ({ useReducedMotion: () => true, prefersReducedMotion: () => true }));

import ProposalEditor from "./ProposalEditor";
import { AUTOSAVE } from "./useAutosave";
import { RP_WORDS } from "./proposalWords";

let server: ReturnType<typeof fakeServer>;

function draw(body: DraftBody, step: string, extra: Parameters<typeof proposalWith>[1] = {}) {
  server = fakeServer(body, { extra });
  vi.stubGlobal("fetch", vi.fn(server.fetch));
  window.history.replaceState(null, "", `/role-proposals/${PROPOSAL_ID}?step=${step}`);
  return render(
    <Router>
      <ProposalEditor initial={proposalWith(body, extra)} me="u-me" />
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

const lastPut = () => server.puts()[server.puts().length - 1];
const frame = (field: string) => document.querySelector(`[data-field="${field}"]`) as HTMLElement;

describe("step 1, pick your roles", () => {
  it("groups the roles as held by you, open, and held by someone else, counting who holds or applies and naming nobody", async () => {
    draw({ roles: [] }, "roles");
    const held = await screen.findByRole("group", { name: RP_WORDS.youHold });
    expect(within(held).getByText("Kitchen keeper")).toBeTruthy();
    expect(within(held).getByText(/You hold this role now/)).toBeTruthy();
    expect(within(held).getByText("Food circle: Everyone eats well.")).toBeTruthy();

    const open = screen.getByRole("group", { name: RP_WORDS.open });
    const orchard = within(open).getByText("Orchard keeper").closest("label")!;
    expect(orchard.textContent).toContain("Held by 1 other member now. 1 of 2 places open. 1 other member is applying.");

    const others = screen.getByRole("group", { name: RP_WORDS.othersHold });
    const gate = within(others).getByText("Gate keeper").closest("label")!;
    // The reader's own application for the gate is not "another member applying".
    expect(gate.textContent).toContain("Held by 1 other member now. Every place is held now.");
    expect(gate.textContent).not.toContain("applying");
    expect(document.body.textContent).not.toContain("u-other");
  });

  it("a pick autosaves the roles group, and says Saved", async () => {
    draw({ roles: [] }, "roles");
    fireEvent.click(await screen.findByLabelText(/Orchard keeper/));
    await waitFor(() => expect(lastPut()).toEqual({ roles: [{ roleId: "r2", words: {}, reviewOn: null }] }));
    expect(await screen.findByText(RP_WORDS.saved)).toBeTruthy();
  });

  it("holds at most five, and says why the rest are off", async () => {
    draw({ roles: ["r1", "r2", "r3", "r4", "r5"].map((roleId) => ({ roleId })) }, "roles");
    const seed = (await screen.findByLabelText(/Seed keeper/)) as HTMLInputElement;
    expect(seed.disabled).toBe(true);
    expect(screen.getByText(/5 of at most 5 picked\. One proposal holds at most 5 roles\. Take one off to add another\./)).toBeTruthy();
  });

  it("proposes a new role in a circle", async () => {
    draw({ roles: [] }, "roles");
    await screen.findByText("Kitchen keeper");
    fireEvent.change(screen.getByLabelText(RP_WORDS.newRoleCircle), { target: { value: "c-land" } });
    fireEvent.change(screen.getByLabelText(RP_WORDS.newRoleName), { target: { value: "Seed saver" } });
    fireEvent.click(screen.getByRole("button", { name: RP_WORDS.addNewRole }));
    await waitFor(() => expect(lastPut()).toEqual({ newRoles: [{ circleId: "c-land", words: { name: "Seed saver" }, reviewOn: null }] }));
    expect(await screen.findByRole("button", { name: RP_WORDS.removeNewRole("Seed saver") })).toBeTruthy();
  });
});

describe("step 2, each role's words", () => {
  it("prefills every field from the posted role and draws gold only on the field that changed", async () => {
    draw({ roles: [{ roleId: "r1" }] }, "words");
    const purpose = (await screen.findByLabelText("Purpose")) as HTMLTextAreaElement;
    expect(purpose.value).toBe("Feed the village well.");
    expect((screen.getByLabelText("What you can count on me for") as HTMLTextAreaElement).value).toBe("Meals on time\nA clean kitchen\nStores counted");
    expect(document.querySelectorAll('[data-changed="true"]').length).toBe(0);

    fireEvent.change(purpose, { target: { value: "Feed everyone, every day." } });
    expect(frame("aim").getAttribute("data-changed")).toBe("true");
    expect(frame("aim").className).toContain("border-notice");
    expect(frame("domain").getAttribute("data-changed")).toBe("false");
    expect(screen.getAllByText(RP_WORDS.changed)).toHaveLength(1);
    // The posted words, a tap away.
    expect(within(frame("aim")).getByText(RP_WORDS.seePosted)).toBeTruthy();
    expect(within(frame("aim")).getByText("Feed the village well.")).toBeTruthy();

    await waitFor(() => expect(lastPut()).toEqual({ roles: [{ roleId: "r1", words: { aim: "Feed everyone, every day." }, reviewOn: null }] }));

    // Typed back to the posted words, the gold goes and the change is undone.
    fireEvent.change(screen.getByLabelText("Purpose"), { target: { value: "Feed the village well." } });
    expect(frame("aim").getAttribute("data-changed")).toBe("false");
    await waitFor(() => expect(lastPut()).toEqual({ roles: [{ roleId: "r1", words: {}, reviewOn: null }] }));
  });

  it("refuses 2 things to count on with the server's sentence, and does not save", async () => {
    draw({ roles: [{ roleId: "r1" }] }, "words");
    fireEvent.change(await screen.findByLabelText("What you can count on me for"), { target: { value: "Meals on time\nA clean kitchen" } });
    expect(screen.getByText(ROLE_CCOS_WORDS.accountabilities, { selector: "[data-field-problem]" })).toBeTruthy();
    expect(await screen.findByText(RP_WORDS.notSaved)).toBeTruthy();
    expect(server.puts()).toEqual([]);
  });

  it("reads New on every field of a new role", async () => {
    draw({ roles: [], newRoles: [{ id: "role-000000000001", circleId: "c-land", words: { name: "Seed saver" } }] }, "words");
    await screen.findByLabelText("Purpose");
    const frames = document.querySelectorAll("[data-field]");
    expect(frames.length).toBe(13);
    expect(Array.from(frames).every((f) => f.getAttribute("data-changed") === "true")).toBe(true);
    expect(screen.getAllByText(RP_WORDS.isNew)).toHaveLength(13);
    expect(screen.queryByText(RP_WORDS.seePosted)).toBeNull();
  });

  it("keeps the CCOS term behind each heading, on hover or tap", async () => {
    draw({ roles: [{ roleId: "r1" }] }, "words");
    const trigger = await screen.findByRole("button", { name: "What I can decide on my own" });
    expect(document.getElementById(trigger.getAttribute("aria-describedby")!)!.textContent).toBe("CCOS: Authorities");
  });

  it("shows the current holder's runbook and handover meter for a held role", async () => {
    draw({ roles: [{ roleId: "r1" }] }, "words");
    const from = (await screen.findByText(RP_WORDS.fromHolder)).closest("[data-from-holder]") as HTMLElement;
    expect(within(from).getByRole("link", { name: "https://example.org/kitchen" })).toBeTruthy();
    expect(within(from).getByText("Ready to hand over")).toBeTruthy();
    expect(within(from).getByText(/of 4 ready/)).toBeTruthy();
  });

  it("draws no AI button while the bridge is not configured", async () => {
    draw({ roles: [{ roleId: "r1" }] }, "words");
    await screen.findByLabelText("Purpose");
    await new Promise((r) => setTimeout(r, 10));
    expect(screen.queryByRole("button", { name: RP_WORDS.aiHelp })).toBeNull();
  });
});

describe("step 3, your season", () => {
  it("ties the season to the village's goals for that season, each with how it helps", async () => {
    draw({ roles: [{ roleId: "r1" }] }, "season");
    fireEvent.click(await screen.findByLabelText("Grow the orchard"));
    fireEvent.change(screen.getByLabelText("How it helps: Grow the orchard"), { target: { value: "Fruit for the kitchen." } });
    fireEvent.change(screen.getByLabelText(new RegExp(RP_WORDS.aim)), { target: { value: "Every meal from our own land." } });
    await waitFor(() =>
      expect(lastPut()).toEqual({
        season: { aim: "Every meal from our own land.", seasonalGoals: [], servesGoals: [{ goal: "Grow the orchard", howItHelps: "Fruit for the kitchen." }] },
      }),
    );
    expect(screen.queryByRole("button", { name: RP_WORDS.aiHelp })).toBeNull();
  });

  it("says when next season's goals are not set, and saves anyway", async () => {
    draw({ roles: [{ roleId: "r1" }] }, "season", { orgGoals: [] });
    expect(await screen.findByText("The village hasn't set next season's goals yet.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Add a seasonal goal" }));
    fireEvent.change(screen.getByLabelText("Goal"), { target: { value: "A harvest supper" } });
    fireEvent.change(screen.getByLabelText("Done when"), { target: { value: "Everyone has eaten from the orchard" } });
    await waitFor(() =>
      expect(lastPut()).toEqual({ season: { aim: null, seasonalGoals: [{ title: "A harvest supper", doneWhen: "Everyone has eaten from the orchard" }], servesGoals: [] } }),
    );
  });
});

describe("step 4, terms and review dates", () => {
  it("adds up each role's time and says plainly when it goes past a full season", async () => {
    draw({ roles: [{ roleId: "r1" }, { roleId: "r2" }] }, "terms");
    const check = (await screen.findByText(LOAD_WORDS.heading)).closest("[data-load-check]") as HTMLElement;
    expect(check.getAttribute("data-load-check")).toBe("over");
    expect(within(check).getByText(LOAD_WORDS.over(54))).toBeTruthy();
    expect(within(check).getByText("Kitchen keeper: about 30 hours a week")).toBeTruthy();
  });

  it("fits when the time fits, and names a role it could not count", async () => {
    draw({ roles: [{ roleId: "r1" }, { roleId: "r3" }] }, "terms");
    const check = (await screen.findByText(LOAD_WORDS.heading)).closest("[data-load-check]") as HTMLElement;
    expect(check.getAttribute("data-load-check")).toBe("within");
    expect(within(check).getByText(LOAD_WORDS.within(30))).toBeTruthy();
    expect(within(check).getByText("Gate keeper: No time written yet")).toBeTruthy();
  });

  it("a review date autosaves with its role", async () => {
    draw({ roles: [{ roleId: "r1" }] }, "terms");
    const reviews = (await screen.findByText(RP_WORDS.reviewDates)).closest("fieldset") as HTMLElement;
    fireEvent.change(within(reviews).getByLabelText("Kitchen keeper"), { target: { value: "2027-02-08" } });
    await waitFor(() => expect(lastPut()).toEqual({ roles: [{ roleId: "r1", words: {}, reviewOn: "2027-02-08" }] }));
  });

  it("the step indicator moves between steps, saving first", async () => {
    draw({ roles: [{ roleId: "r1" }] }, "terms");
    await screen.findByText(LOAD_WORDS.heading);
    expect(screen.getByRole("button", { name: "Step 4: Terms and review dates" }).getAttribute("aria-current")).toBe("step");
    fireEvent.click(screen.getByRole("button", { name: RP_WORDS.back }));
    expect(await screen.findByText(RP_WORDS.seasonLede)).toBeTruthy();
    expect(screen.getByText("Step 3 of 6")).toBeTruthy();
    expect(window.location.search).toBe("?step=season");
  });
});
