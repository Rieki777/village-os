// @vitest-environment jsdom
/**
 * `/open-proposals/:id`: a role proposal from somebody with no account yet
 * (open proposals part B), as members read it.
 *
 *   - members read the proposer by first name, the roles and their words, and
 *     where the circle stands; an asked holder answers on this proposal's own
 *     route;
 *   - a holder of the power adopts or declines (declining asks first); after an
 *     adoption with no account behind the address, the invitation's link is
 *     shown with the sentence saying whether it went;
 *   - after a handover the card says so plainly and offers nothing;
 *   - a visitor is told it is for members.
 */
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CONSENT_WORDS, type ConsentState } from "@shared/roleProposalConsent";
import { DECIDE_WORDS } from "@shared/openProposalDecide";
import { consentOf } from "@/test/roleProposalFixture";

const ID = "op-0123456789abcdef0123";
let signedIn: { id: string } | null = { id: "u-ben" };

vi.mock("@/components/Layout", () => ({
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: signedIn }),
}));
vi.mock("@/modules/ModuleProvider", () => ({
  useModules: () => ({ loaded: true, modules: [{ id: "governance", lifecycle: "members" }] }),
  useModule: () => ({ id: "governance", lifecycle: "members" }),
  useModuleOn: () => false,
}));
vi.mock("@/components/modules/ModuleGate", () => ({
  default: () => <p>Module gate</p>,
  SignInDoors: ({ next }: { next?: string }) => <a href={`/login?next=${next}`}>Sign in</a>,
}));
vi.mock("@/components/natural/useReducedMotion", () => ({
  useReducedMotion: () => true,
  prefersReducedMotion: () => true,
}));
vi.mock("wouter", async (orig) => ({
  ...(await orig<typeof import("wouter")>()),
  useParams: () => ({ id: ID }),
}));

import OpenProposal from "./OpenProposal";

const READER = { holdsThePower: false, own: false, mayAdopt: false, mayDecline: false, mayReissue: false };
const POWER = { holdsThePower: true, own: false, mayAdopt: true, mayDecline: true, mayReissue: false };

function served(over: Record<string, unknown> = {}, state: ConsentState = "open", consentYou = { asked: false, answer: null as string | null, mayAnswer: false }) {
  return {
    id: ID,
    href: `/open-proposals/${ID}`,
    status: "confirmed",
    statusWords: DECIDE_WORDS.status.confirmed,
    proposer: "Rowan",
    season: { id: "s-next", name: "Season of Roots", startsOn: "2037-01-01" },
    roles: [{ id: "role-gate", name: "Gate Keeper", circle: "Land Circle", note: "I open gates for a living." }],
    why: "I live up the road and the gate is always shut.",
    aim: "The gate opens at dawn every day.",
    confirmedOn: "2026-11-01",
    decidedOn: null,
    decided: null,
    consent: consentOf(state, { you: consentYou }),
    door: { because: "a-role-holds-it", words: DECIDE_WORDS.door["a-role-holds-it"] },
    invitation: null,
    you: READER,
    ...over,
  };
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const LINK = "https://village.example.test/register?invite=abcdefghijklmnopqrstuvwxyz0123456789";

let answer: () => Response;
let adopted: () => Response;
const asked: string[] = [];

beforeEach(() => {
  signedIn = { id: "u-ben" };
  asked.length = 0;
  answer = () => json({ proposal: served() });
  adopted = () => json({ success: true, status: "adopted", account: false, invitation: { link: LINK, emailed: false }, message: DECIDE_WORDS.adoptedNotEmailed("not_set_up") });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: { method?: string; headers?: Record<string, string> }) => {
      asked.push(`${init?.method ?? "GET"} ${url}`);
      if (url === `/api/governance/open-proposals/${ID}`) return answer();
      if (url === `/api/governance/open-proposals/${ID}/adopt`) return adopted();
      if (url === `/api/governance/open-proposals/${ID}/decline`) return json({ success: true, status: "declined", emailed: true, message: DECIDE_WORDS.declinedEmailed });
      if (url === `/api/governance/open-proposals/${ID}/consent`) {
        return json({ answer: "consent", carried: false, carriedWords: null, consent: consentOf("open", { consented: 1, you: { asked: true, answer: "consent", mayAnswer: false } }) });
      }
      return json({});
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const heading = () => screen.findByRole("heading", { name: "Rowan proposes to hold Gate Keeper next season" });

describe("the open proposal page", () => {
  it("members read the proposer by first name, the roles, their words and where the circle stands, and nothing to decide", async () => {
    render(<OpenProposal />);
    await heading();
    expect(screen.getByText("I open gates for a living.")).toBeTruthy();
    expect(screen.getByText("I live up the road and the gate is always shut.")).toBeTruthy();
    expect(screen.getByRole("heading", { name: CONSENT_WORDS.heading })).toBeTruthy();
    expect(screen.queryByRole("button", { name: DECIDE_WORDS.adopt })).toBeNull();
    expect(screen.getByText(DECIDE_WORDS.door["a-role-holds-it"])).toBeTruthy();
  });

  it("an asked holder consents on the proposal's own route", async () => {
    answer = () => json({ proposal: served({}, "open", { asked: true, answer: null, mayAnswer: true }) });
    render(<OpenProposal />);
    fireEvent.click(await screen.findByRole("button", { name: CONSENT_WORDS.consentButton }));
    expect(await screen.findByText(CONSENT_WORDS.youConsented)).toBeTruthy();
    expect(asked).toContain(`POST /api/governance/open-proposals/${ID}/consent`);
    expect(asked.some((a) => a.includes("role-applications"))).toBe(false);
  });

  it("a holder of the power adopts, and with email off reads that nothing went and gets the link to copy", async () => {
    answer = () => json({ proposal: served({ you: POWER }) });
    render(<OpenProposal />);
    fireEvent.click(await screen.findByRole("button", { name: DECIDE_WORDS.adopt }));
    expect(await screen.findByText(DECIDE_WORDS.adoptedNotEmailed("not_set_up"))).toBeTruthy();
    expect(screen.getByText(LINK)).toBeTruthy();
    expect(screen.getByRole("button", { name: DECIDE_WORDS.copy })).toBeTruthy();
    expect(asked).toContain(`POST /api/governance/open-proposals/${ID}/adopt`);
  });

  it("once the circle has consented, the same click reads Record the adoption", async () => {
    answer = () => json({ proposal: served({ you: POWER }, "consented") });
    render(<OpenProposal />);
    expect(await screen.findByRole("button", { name: CONSENT_WORDS.record })).toBeTruthy();
    expect(screen.getByText(CONSENT_WORDS.recordLine)).toBeTruthy();
  });

  it("declining asks first, then sends the kind no", async () => {
    answer = () => json({ proposal: served({ you: POWER }) });
    render(<OpenProposal />);
    fireEvent.click(await screen.findByRole("button", { name: DECIDE_WORDS.decline }));
    expect(screen.getByText(DECIDE_WORDS.declineAsk)).toBeTruthy();
    expect(asked).not.toContain(`POST /api/governance/open-proposals/${ID}/decline`);
    fireEvent.click(screen.getByRole("button", { name: DECIDE_WORDS.declineYes }));
    expect(await screen.findByText(DECIDE_WORDS.declinedEmailed)).toBeTruthy();
    expect(asked).toContain(`POST /api/governance/open-proposals/${ID}/decline`);
  });

  it("after a handover the card says so plainly and offers nothing", async () => {
    answer = () =>
      json({ proposal: served({ you: { ...READER, holdsThePower: false }, door: { because: "village-holds-it", words: DECIDE_WORDS.door["village-holds-it"] } }) });
    render(<OpenProposal />);
    await heading();
    expect(screen.getByText(DECIDE_WORDS.door["village-holds-it"])).toBeTruthy();
    expect(screen.queryByRole("button", { name: DECIDE_WORDS.adopt })).toBeNull();
    expect(screen.queryByRole("button", { name: DECIDE_WORDS.decline })).toBeNull();
  });

  it("an adopted proposal whose invitation nobody used offers a new one to a holder of the power", async () => {
    answer = () =>
      json({
        proposal: served({ status: "adopted", statusWords: "Adopted on 2 Nov by the founder's power", decided: "Adopted on 2 Nov by the founder's power", invitation: { state: "open" }, you: { ...POWER, mayAdopt: false, mayDecline: false, mayReissue: true } }),
      });
    render(<OpenProposal />);
    expect(await screen.findByRole("button", { name: DECIDE_WORDS.reissue })).toBeTruthy();
    expect(screen.queryByRole("button", { name: DECIDE_WORDS.adopt })).toBeNull();
  });

  it("a declined proposal reads as declined, with no circle's answer calling it adopted", async () => {
    answer = () => json({ proposal: served({ status: "declined", statusWords: "Declined on 2 Nov", decided: "Declined on 2 Nov", you: { ...POWER, mayAdopt: false, mayDecline: false } }) });
    render(<OpenProposal />);
    await heading();
    expect(screen.getAllByText("Declined on 2 Nov").length).toBeGreaterThan(0);
    expect(screen.queryByText("Adopted")).toBeNull();
    expect(screen.queryByRole("heading", { name: CONSENT_WORDS.heading })).toBeNull();
    expect(screen.queryByRole("button", { name: DECIDE_WORDS.adopt })).toBeNull();
  });

  it("a visitor is told it is for members, with a way to sign in back here", async () => {
    signedIn = null;
    render(<OpenProposal />);
    expect(await screen.findByRole("heading", { name: DECIDE_WORDS.membersOnly })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Sign in" }).getAttribute("href")).toBe(`/login?next=/open-proposals/${ID}`);
    await waitFor(() => expect(asked).toEqual([]));
  });
});
