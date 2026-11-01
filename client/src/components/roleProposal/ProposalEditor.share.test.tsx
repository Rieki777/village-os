// @vitest-environment jsdom
/**
 * The proposal steps 5 and 6, and where a submitted proposal stands (role
 * proposals PR C), over a fake of the routes.
 *
 *   5 the preview is the real player card in proposal mode, with the changed
 *     words in gold and a new role marked New;
 *   6 the share link: made, switched between members and anyone, made anew
 *     and turned off; the owner reads every comment by first name; submit
 *     confirms who approves it, shows the words aligned with, and sends them;
 *   after submit, each consent state in plain words, and adopted with the
 *     decision record.
 *
 * Every name is made up.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { Router } from "wouter";
import { CONSENT_STATES, type ConsentState } from "@shared/roleProposalConsent";
import { fixturePayload } from "@/test/playerCardFixture";
import { consentOf, fakeServer, ORG, PROPOSAL_ID, proposalWith, type DraftBody } from "@/test/roleProposalFixture";

vi.mock("@/lib/gameApi", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/gameApi")>()), authToken: () => "t" }));
vi.mock("@/components/governance/pickSources", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/components/governance/pickSources")>()),
  loadOrg: async () => ORG,
}));
vi.mock("@/lib/seatPresetsRead", () => ({ useVillagePresets: () => [] }));
vi.mock("@/components/natural/useReducedMotion", () => ({ useReducedMotion: () => true, prefersReducedMotion: () => true }));

import ProposalEditor from "./ProposalEditor";
import ProposalState from "./ProposalState";
import { AUTOSAVE } from "./useAutosave";
import { ADOPTED_HEADING, RP_WORDS, STATE_HEADINGS } from "./proposalWords";

let server: ReturnType<typeof fakeServer>;

/** The card the preview reads: the card fixture's roles r1 and r2, in proposal mode. */
const CARD = fixturePayload(2, "self", { mode: "proposal" });

function draw(body: DraftBody, step: string, opts: Parameters<typeof fakeServer>[1] = {}) {
  server = fakeServer(body, { card: CARD, ...opts });
  vi.stubGlobal("fetch", vi.fn(server.fetch));
  window.history.replaceState(null, "", `/role-proposals/${PROPOSAL_ID}?step=${step}`);
  return render(
    <Router>
      <ProposalEditor initial={proposalWith(body, opts.extra)} me="u-me" />
    </Router>,
  );
}

beforeEach(() => {
  AUTOSAVE.delayMs = 0;
  Object.assign(navigator, { clipboard: { writeText: vi.fn(async () => undefined) } });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const called = (method: string, tail: string) => server.asked.filter((a) => a.method === method && a.url.endsWith(tail));

describe("step 5, preview", () => {
  it("is the real player card in proposal mode, gold on the words that changed", async () => {
    draw({ roles: [{ roleId: "r1", words: { aim: "Feed everyone, every day." } }, { roleId: "r2" }] }, "preview");
    await waitFor(() => expect(document.querySelector("[data-player-card]")).not.toBeNull());
    expect(document.querySelector("[data-player-card]")!.getAttribute("data-card-mode")).toBe("proposal");
    const r1 = document.getElementById("role-r1")!;
    expect(within(r1).getByText("Changed from the posted role")).toBeTruthy();
    expect(r1.querySelector('[data-changed-mark="purpose"]')).not.toBeNull();
    // Only the field that changed: r1's domain and the whole of r2 carry no mark.
    expect(r1.querySelector('[data-changed-mark="decide"]')).toBeNull();
    expect(document.getElementById("role-r2")!.querySelector("[data-changed-mark]")).toBeNull();
    // A proposal card is never edited in place.
    expect(screen.queryByRole("button", { name: "Edit my card" })).toBeNull();
  });
});

describe("step 6, share", () => {
  it("makes a link, switches who reads it, copies it, makes a new one and turns it off", async () => {
    draw({ roles: [{ roleId: "r1" }] }, "share");
    fireEvent.click(await screen.findByRole("button", { name: RP_WORDS.makeLink }));
    const link = (await screen.findByLabelText(RP_WORDS.theLink)) as HTMLInputElement;
    expect(link.value).toBe(`${window.location.origin}/role-proposals/shared/${"T".repeat(32)}`);
    expect(called("POST", "/share")[0].body).toEqual({ audience: "members" });
    expect((screen.getByLabelText(new RegExp(RP_WORDS.membersOnlyTier)) as HTMLInputElement).checked).toBe(true);

    fireEvent.click(screen.getByLabelText(new RegExp(RP_WORDS.anyoneTier)));
    await waitFor(() => expect(called("POST", "/share")[1]?.body).toEqual({ audience: "anyone" }));
    await waitFor(() => expect((screen.getByLabelText(new RegExp(RP_WORDS.anyoneTier)) as HTMLInputElement).checked).toBe(true));

    fireEvent.click(screen.getByRole("button", { name: RP_WORDS.copyLink }));
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith(link.value));

    fireEvent.click(screen.getByRole("button", { name: RP_WORDS.regenerate }));
    expect(await screen.findByText(RP_WORDS.regenerated)).toBeTruthy();
    expect(called("POST", "/share/regenerate")[0].body).toEqual({ audience: "anyone" });
    expect(((await screen.findByLabelText(RP_WORDS.theLink)) as HTMLInputElement).value).toContain("N".repeat(32));

    fireEvent.click(screen.getByRole("button", { name: RP_WORDS.turnOff }));
    expect(await screen.findByText(RP_WORDS.shareOff)).toBeTruthy();
    expect(called("DELETE", "/share")).toHaveLength(1);
  });

  it("says where anyone with the link cannot reach yet", async () => {
    const share = { on: true, audience: "anyone" as const, link: `/role-proposals/shared/${"T".repeat(32)}`, token: "T".repeat(32), anyoneReaches: false, anyoneNote: "Anyone with the link can read it once the village shows its governance to the public." };
    draw({ roles: [{ roleId: "r1" }] }, "share", { extra: { share } });
    expect(await screen.findByText(share.anyoneNote)).toBeTruthy();
  });

  it("lists every comment for the owner, by first name and day", async () => {
    draw({ roles: [{ roleId: "r1" }] }, "share", {
      comments: [
        { id: "rpc-1", text: "Add the bakery to what you look after.", mine: false, from: "Ana", writtenOn: "2026-10-23" },
        { id: "rpc-2", text: "Looks right to me.", mine: false, from: "A former member", writtenOn: "2026-10-24" },
      ],
    });
    const feedback = (await screen.findByText("Add the bakery to what you look after.")).closest("[data-feedback]") as HTMLElement;
    expect(within(feedback).getByText("Ana, 2026-10-23")).toBeTruthy();
    expect(within(feedback).getByText("A former member, 2026-10-24")).toBeTruthy();
  });
});

describe("step 6, submit", () => {
  it("confirms who approves it, shows the words aligned with, sends them, and then shows where it stands", async () => {
    draw({ roles: [{ roleId: "r1" }] }, "share", { extra: { submitBlocked: null, readyToSubmit: true } });
    fireEvent.click(await screen.findByRole("button", { name: RP_WORDS.submit }));
    const confirm = (await screen.findByText(RP_WORDS.whoApproves)).closest("[data-submit-confirm]") as HTMLElement;
    // A server that names nobody (an older one) leaves the plain line, which promises no particular power.
    expect(RP_WORDS.whoApproves).toBe("The circle consents within 2 business days, or a founder or steward role adopts it.");
    expect(within(confirm).getByText("I hold Kitchen keeper on these terms.")).toBeTruthy();
    expect(called("POST", "/submit")).toHaveLength(0);

    fireEvent.click(within(confirm).getByRole("button", { name: RP_WORDS.confirm }));
    expect(await screen.findByText(STATE_HEADINGS.open)).toBeTruthy();
    expect(called("POST", "/submit")[0].body).toEqual({ alignedWords: "I hold Kitchen keeper on these terms." });
    expect(screen.getByText("The circle is asked to consent or object by 6 November 2026.")).toBeTruthy();
    expect(screen.getByRole("link", { name: RP_WORDS.seeApplication }).getAttribute("href")).toBe("/role-applications/sa-00000000000000b1");
  });

  it("E8: names who adopts in this village, as the server read it from who holds the power, and never promises a power nobody holds", async () => {
    const who = "The circle consents within 2 business days, or Steward Circle (Hal) adopts it.";
    draw({ roles: [{ roleId: "r1" }] }, "share", { extra: { submitBlocked: null, readyToSubmit: true }, whoApproves: who });
    fireEvent.click(await screen.findByRole("button", { name: RP_WORDS.submit }));
    const confirm = (await screen.findByText(who)).closest("[data-submit-confirm]") as HTMLElement;
    expect(confirm).toBeTruthy();
    expect(screen.queryByText(RP_WORDS.whoApproves)).toBeNull();
    // The old line promised the founder, steward or organisation power whatever the village held.
    expect(document.body.textContent).not.toContain("organisation power");
  });

  it("a draft that is not ready says the server's reason and cannot be submitted", async () => {
    draw({ roles: [{ roleId: "r1" }] }, "share");
    expect(await screen.findByText("Write your aim for the season, then submit.")).toBeTruthy();
    expect((screen.getByRole("button", { name: RP_WORDS.submit }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("Not yet closes the confirm and submits nothing", async () => {
    draw({ roles: [{ roleId: "r1" }] }, "share", { extra: { submitBlocked: null, readyToSubmit: true } });
    fireEvent.click(await screen.findByRole("button", { name: RP_WORDS.submit }));
    fireEvent.click(await screen.findByRole("button", { name: RP_WORDS.notYet }));
    expect(screen.queryByText(RP_WORDS.whoApproves)).toBeNull();
    expect(called("POST", "/submit")).toHaveLength(0);
  });
});

describe("where a submitted proposal stands", () => {
  const submitted = (consent: ConsentState | null, extra = {}) =>
    proposalWith({ roles: [{ roleId: "r1" }] }, {
      status: "submitted",
      consent: consent ? consentOf(consent, consent === "objected" ? { objections: ["The kitchen needs a second keeper first."] } : {}) : null,
      application: { id: "sa-00000000000000b1", href: "/role-applications/sa-00000000000000b1" },
      submittedAt: "2026-11-04T15:00:00.000Z",
      ...extra,
    });

  it.each(CONSENT_STATES.map((s) => [s]))("says %s in plain words, with the server's sentence", (state) => {
    render(
      <Router>
        <ProposalState proposal={submitted(state)} />
      </Router>,
    );
    expect(screen.getByText(STATE_HEADINGS[state])).toBeTruthy();
    expect(screen.getByText(consentOf(state).words)).toBeTruthy();
    expect(document.querySelector("[data-proposal-state]")!.getAttribute("data-proposal-state")).toBe(state);
  });

  it("names the objection's reason and where it goes", () => {
    render(
      <Router>
        <ProposalState proposal={submitted("objected")} />
      </Router>,
    );
    expect(screen.getByText("An objection goes to the circle's next meeting")).toBeTruthy();
    expect(screen.getByText("The kitchen needs a second keeper first.")).toBeTruthy();
  });

  it("counts who was asked, consented and objected, by role title, never a name (PR D)", () => {
    const roles = { asked: ["Gate keeper", "Orchard keeper"], consented: ["Gate keeper"], objected: [] };
    render(
      <Router>
        <ProposalState proposal={submitted("open", { consent: consentOf("open", { consented: 1, roles }) })} />
      </Router>,
    );
    expect((document.querySelector('[data-tally="asked"]') as HTMLElement).textContent).toBe("Asked2 (Gate keeper, Orchard keeper)");
    expect((document.querySelector('[data-tally="consented"]') as HTMLElement).textContent).toBe("Consented1 (Gate keeper)");
    expect((document.querySelector('[data-tally="objected"]') as HTMLElement).textContent).toBe("ObjectedNone");
  });

  it("consented says it waits for a holder of the power to record it", () => {
    render(
      <Router>
        <ProposalState proposal={submitted("consented")} />
      </Router>,
    );
    expect(screen.getByText("Consented by the circle, waiting for a holder of the power to record it")).toBeTruthy();
  });

  it("adopted shows the decision record, which names a role", () => {
    render(
      <Router>
        <ProposalState proposal={submitted("consented", { decided: "Adopted on 9 Nov after the circle consented" })} />
      </Router>,
    );
    expect(screen.getByText(ADOPTED_HEADING)).toBeTruthy();
    expect(screen.getByText("Adopted on 9 Nov after the circle consented")).toBeTruthy();
  });

  it("keeps a way to the shared view while the link is on", () => {
    const share = { on: true, audience: "members" as const, link: `/role-proposals/shared/${"T".repeat(32)}`, token: "T".repeat(32), anyoneReaches: true, anyoneNote: null };
    render(
      <Router>
        <ProposalState proposal={submitted("open", { share })} />
      </Router>,
    );
    expect(screen.getByRole("link", { name: RP_WORDS.openShared }).getAttribute("href")).toBe(`/role-proposals/shared/${"T".repeat(32)}`);
  });

  it("the page draws the state, not the steps, once submitted", async () => {
    server = fakeServer({ roles: [{ roleId: "r1" }] }, { card: CARD });
    vi.stubGlobal("fetch", vi.fn(server.fetch));
    render(
      <Router>
        <ProposalEditor initial={submitted("open")} me="u-me" />
      </Router>,
    );
    expect(screen.getByText(STATE_HEADINGS.open)).toBeTruthy();
    expect(screen.queryByRole("button", { name: RP_WORDS.next })).toBeNull();
    await waitFor(() => expect(document.querySelector("[data-player-card]")).not.toBeNull());
  });
});
