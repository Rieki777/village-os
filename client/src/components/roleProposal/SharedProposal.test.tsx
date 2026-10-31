// @vitest-environment jsdom
/**
 * The shared view at a proposal's share link (role proposals PR C).
 *
 *   - anyone with the link reads the roles and their words on the card, read
 *     only: no terms drawn even when a payload carried some, no comment box,
 *     no feedback asked for;
 *   - a member reads it and leaves feedback, and reads back their own;
 *   - the owner reading their own link sees every comment and a way back;
 *   - the page answers a dead link and a members-only link to a visitor in
 *     the server's own sentences.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Router } from "wouter";
import { fixturePayload, fixtureRole } from "@/test/playerCardFixture";
import { consentOf, proposalWith } from "@/test/roleProposalFixture";
import { CONSENT_WORDS } from "@shared/roleProposalConsent";
import type { SharedOut } from "./proposalApi";

vi.mock("@/lib/gameApi", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/gameApi")>()), authToken: () => "t" }));

import SharedProposal from "./SharedProposal";
import { RP_WORDS, STATE_HEADINGS } from "./proposalWords";

const TOKEN = "T".repeat(32);
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const asked: Array<{ method: string; url: string; body?: any }> = [];
let comments: unknown[] = [];

beforeEach(() => {
  asked.length = 0;
  comments = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: { method?: string; body?: string }) => {
      const method = init?.method ?? "GET";
      const body = init?.body ? JSON.parse(init.body) : undefined;
      asked.push({ method, url, body });
      if (url.endsWith("/comments") && method === "POST") {
        comments = [{ id: "rpc-9", text: body.text, mine: true, writtenOn: "2026-10-24" }];
        return json({ comments }, 201);
      }
      if (url.endsWith("/comments")) return json({ comments });
      return json({});
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const proposal = proposalWith({ roles: [{ roleId: "r1", words: { aim: "Feed everyone, every day." } }] });

function draw(shared: SharedOut) {
  return render(
    <Router>
      <SharedProposal token={TOKEN} shared={shared} />
    </Router>,
  );
}

describe("anyone with the link", () => {
  it("reads the card with its gold, and never the terms, the season or the feedback", async () => {
    // The public card the server builds: the roles and their words, terms unread.
    const card = fixturePayload(1, "stranger", { mode: "proposal", roles: [{ ...fixtureRole(1), settings: undefined }] });
    // Even a payload that carried terms draws none: this page draws only the card.
    draw({ proposal: { ...proposal, settings: { v: 1, pay: { kind: "fixed", currency: "USD", amountMinor: 500000, per: "month" } } }, card, you: { isOwner: false, mayComment: false, tier: "public" } });
    expect(document.querySelector('[data-shared-tier="public"]')).not.toBeNull();
    expect(document.querySelector("[data-player-card]")!.getAttribute("data-card-mode")).toBe("proposal");
    expect(document.querySelector('[data-changed-mark="purpose"]')).not.toBeNull();
    expect(screen.queryByText(/Agreements/)).toBeNull();
    expect(document.body.textContent).not.toMatch(/USD|5,000|Fixed pay/);
    expect(screen.getByText(RP_WORDS.readOnly)).toBeTruthy();
    expect(screen.queryByRole("textbox", { name: RP_WORDS.feedbackLabel })).toBeNull();
    await new Promise((r) => setTimeout(r, 10));
    expect(asked).toEqual([]);
  });
});

describe("a member with the link", () => {
  it("leaves feedback and reads back their own", async () => {
    draw({ proposal, card: fixturePayload(1, "member", { mode: "proposal" }), you: { isOwner: false, mayComment: true, tier: "member" } });
    fireEvent.change(await screen.findByRole("textbox", { name: RP_WORDS.feedbackLabel }), { target: { value: "Add the bakery." } });
    fireEvent.click(screen.getByRole("button", { name: RP_WORDS.sendFeedback }));
    expect(await screen.findByText(RP_WORDS.feedbackSent)).toBeTruthy();
    expect(asked.find((a) => a.method === "POST")).toEqual({ method: "POST", url: `/api/governance/role-proposals/shared/${TOKEN}/comments`, body: { text: "Add the bakery." } });
    expect(screen.getByText(RP_WORDS.yourFeedback)).toBeTruthy();
    expect(screen.getByText("Add the bakery.")).toBeTruthy();
  });

  it("is told feedback is closed once the proposal is submitted", async () => {
    draw({ proposal: { ...proposal, status: "submitted" }, card: null, you: { isOwner: false, mayComment: false, tier: "member" } });
    expect(await screen.findByText(RP_WORDS.submittedNoFeedback)).toBeTruthy();
    expect(screen.queryByRole("textbox", { name: RP_WORDS.feedbackLabel })).toBeNull();
  });

  it("reads where a submitted proposal stands, by role title, with no buttons (PR D)", async () => {
    const consent = consentOf("objected", { asked: 2, objected: 1, objections: ["Two of us already keep the gate."], roles: { asked: ["Gate keeper", "Orchard keeper"], consented: [], objected: ["Gate keeper"] } });
    draw({ proposal: { ...proposal, status: "submitted", consent }, card: null, you: { isOwner: false, mayComment: false, tier: "member" } });
    expect(await screen.findByText(STATE_HEADINGS.objected)).toBeTruthy();
    expect((document.querySelector('[data-tally="objected"]') as HTMLElement).textContent).toBe("Objected1 (Gate keeper)");
    expect(screen.getByText("Two of us already keep the gate.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: CONSENT_WORDS.consentButton })).toBeNull();
  });
});

describe("the consent state on a public read", () => {
  it("is never drawn, even if a payload carried one", () => {
    draw({ proposal: { ...proposal, status: "submitted", consent: consentOf("open") }, card: null, you: { isOwner: false, mayComment: false, tier: "public" } });
    expect(document.querySelector("[data-consent-summary]")).toBeNull();
  });
});

describe("the owner reading their own link", () => {
  it("sees every comment with who wrote it, and a way back to the steps", async () => {
    comments = [{ id: "rpc-1", text: "Looks right.", mine: false, from: "Ana", writtenOn: "2026-10-23" }];
    draw({ proposal, card: null, you: { isOwner: true, mayComment: true, tier: "member" } });
    expect(await screen.findByText("Ana, 2026-10-23")).toBeTruthy();
    expect(screen.getByRole("link", { name: RP_WORDS.editYourOwn }).getAttribute("href")).toBe(`/role-proposals/${proposal.id}`);
    expect(screen.queryByRole("textbox", { name: RP_WORDS.feedbackLabel })).toBeNull();
    await waitFor(() => expect(asked.some((a) => a.url.endsWith("/comments"))).toBe(true));
  });
});
