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
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { CONSENT_WORDS, type ConsentState } from "@shared/roleProposalConsent";
import { DECIDE_WORDS, DOOR } from "@shared/openProposalDecide";
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
    door: { because: DOOR.aRoleHolds, words: DECIDE_WORDS.door[DOOR.aRoleHolds] },
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
    expect(screen.getByText(DECIDE_WORDS.door[DOOR.aRoleHolds])).toBeTruthy();
  });

  it("a decider reads the links as text to open off-site and the files as downloads; anybody else reads neither (Rye, 10 Nov 2026)", async () => {
    answer = () =>
      json({
        proposal: served({
          attached: {
            links: [{ label: "Gates I built", url: "https://gates.example.org/rowan" }],
            files: [{ id: "pf-0123456789abcdef", kind: "pdf", name: "Gates portfolio.pdf", size: 2048, href: `/api/governance/open-proposals/${ID}/files/pf-0123456789abcdef` }],
          },
        }),
      });
    render(<OpenProposal />);
    await heading();
    expect(screen.getByRole("heading", { name: "Links and files" })).toBeTruthy();
    const link = screen.getByRole("link", { name: "Gates I built" });
    expect(link.getAttribute("href")).toBe("https://gates.example.org/rowan");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer nofollow");
    expect(link.getAttribute("target")).toBe("_blank");
    const file = screen.getByRole("link", { name: "Gates portfolio.pdf" });
    expect(file.getAttribute("href")).toBe(`/api/governance/open-proposals/${ID}/files/pf-0123456789abcdef`);
    expect(file.hasAttribute("download")).toBe(true);
    // The page never fetches a link or a file by itself: the decider opens them.
    // Each entry is "METHOD url": the URL is parsed and its host and path compared, never searched as text.
    const fetched = asked.map((a) => new URL(a.slice(a.indexOf(" ") + 1), "http://local"));
    expect(fetched.some((u) => u.hostname === "gates.example.org")).toBe(false);
    expect(fetched.some((u) => /\/files\/[^/]+$/.test(u.pathname))).toBe(false);
    cleanup();
    // Anybody else: the server sends no attachments, and the page shows no section.
    answer = () => json({ proposal: served({ attached: null }) });
    render(<OpenProposal />);
    await heading();
    expect(screen.queryByRole("heading", { name: "Links and files" })).toBeNull();
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

  it("audit M10: Adopt is disabled while a conversation is not written up, and names whose, with the chart for a role nobody holds", async () => {
    const conversations = [
      { roleId: "r-a", role: "Channel Role", unheld: false, words: DECIDE_WORDS.conversationMissing("Channel Role") },
      { roleId: "r-b", role: "Data Role", unheld: true, words: DECIDE_WORDS.conversationUnheld("Data Role") },
    ];
    answer = () => json({ proposal: served({ you: POWER, beforeAdopt: { conversations, seatsFull: [], seatsWords: null } }) });
    render(<OpenProposal />);
    const adopt = (await screen.findByRole("button", { name: DECIDE_WORDS.adopt })) as HTMLButtonElement;
    expect(adopt.disabled).toBe(true);
    expect(screen.getByText(DECIDE_WORDS.conversationMissing("Channel Role"))).toBeTruthy();
    expect(screen.getByRole("link", { name: DECIDE_WORDS.chartLink }).getAttribute("href")).toBe("/map/circles");
  });

  it("audit B3: every place filled says the count, and Adopt goes only for when a place opens, chosen on purpose", async () => {
    const seatsWords = DECIDE_WORDS.seatsFull([{ name: "Gate Keeper", seats: 1, taken: 1 }]);
    answer = () => json({ proposal: served({ you: POWER, beforeAdopt: { conversations: [], seatsFull: [{ name: "Gate Keeper", seats: 1, taken: 1 }], seatsWords } }) });
    render(<OpenProposal />);
    const adopt = (await screen.findByRole("button", { name: DECIDE_WORDS.adoptWhenASeatOpens })) as HTMLButtonElement;
    expect(screen.getByText(seatsWords)).toBeTruthy();
    expect(adopt.disabled).toBe(true);
    fireEvent.click(screen.getByRole("checkbox", { name: "Adopt them for when a place opens" }));
    expect(adopt.disabled).toBe(false);
    fireEvent.click(adopt);
    await waitFor(() => expect(asked).toContain(`POST /api/governance/open-proposals/${ID}/adopt`));
    const call = (fetch as unknown as { mock: { calls: Array<[string, { body?: string }]> } }).mock.calls.find(([u]) => u.endsWith("/adopt"));
    expect(JSON.parse(String(call?.[1]?.body))).toMatchObject({ whenASeatOpens: true });
  });

  it("verify B153 B8: an agent's proposal never shows a person's terms (pay, allowance, commitment), a person's does", async () => {
    const offer = {
      revision: 0,
      rows: [{ key: "allowance", label: "Allowance", suggested: "Paid for.", current: null, theirs: null, state: "waiting", changed: false }],
      theirCommitment: 60,
      roleCommitment: 100,
      ourCommitment: null,
      history: [],
      openTalks: ["Allowance"],
    };
    const agent = { name: "Scribe", what: "Keeps the minutes.", keeper: "Kai", reach: [], stillAnAgent: true, switchOff: "Revoke its token.", switchOffPlatform: "An admin can end it." };
    answer = () => json({ proposal: served({ you: { ...POWER, mayEditTerms: true }, offer, agent }) });
    const { container, unmount } = render(<OpenProposal />);
    const adopt = (await screen.findByRole("button", { name: DECIDE_WORDS.adopt })) as HTMLButtonElement;
    expect(container.querySelector("[data-terms-we-offer]")).toBeNull();
    expect(container.querySelector("[data-open-talks]")).toBeNull();
    // Nothing about terms holds Adopt back for an agent.
    expect(adopt.disabled).toBe(false);
    unmount();
    answer = () => json({ proposal: served({ you: { ...POWER, mayEditTerms: true }, offer }) });
    const person = render(<OpenProposal />);
    await screen.findByRole("button", { name: DECIDE_WORDS.adopt });
    expect(person.container.querySelector("[data-terms-we-offer]")).not.toBeNull();
  });

  it("the decision sits in one side panel, with one set of buttons, beside the proposal", async () => {
    answer = () => json({ proposal: served({ you: POWER }) });
    const { container } = render(<OpenProposal />);
    await screen.findByRole("button", { name: DECIDE_WORDS.adopt });
    const panel = container.querySelector("[data-decide-panel]");
    expect(panel?.tagName).toBe("ASIDE");
    expect(panel?.querySelector("[data-decider-card]")).not.toBeNull();
    expect(screen.getAllByRole("button", { name: DECIDE_WORDS.adopt })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: DECIDE_WORDS.decline })).toHaveLength(1);
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
      json({ proposal: served({ you: { ...READER, holdsThePower: false }, door: { because: DOOR.villageHolds, words: DECIDE_WORDS.door[DOOR.villageHolds] } }) });
    render(<OpenProposal />);
    await heading();
    expect(screen.getByText(DECIDE_WORDS.door[DOOR.villageHolds])).toBeTruthy();
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

  it("a former member's proposal: the decider reads why it is not adopted here, and may still decline it", async () => {
    answer = () => json({ proposal: served({ you: { ...POWER, mayAdopt: false, mayDecline: true, formerMember: true } }) });
    render(<OpenProposal />);
    expect(await screen.findByText(DECIDE_WORDS.formerMember)).toBeTruthy();
    expect(screen.queryByRole("button", { name: DECIDE_WORDS.adopt })).toBeNull();
    expect(screen.getByRole("button", { name: DECIDE_WORDS.decline })).toBeTruthy();
  });

  it("a visitor is told it is for members, with a way to sign in back here", async () => {
    signedIn = null;
    render(<OpenProposal />);
    expect(await screen.findByRole("heading", { name: DECIDE_WORDS.membersOnly })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Sign in" }).getAttribute("href")).toBe(`/login?next=/open-proposals/${ID}`);
    await waitFor(() => expect(asked).toEqual([]));
  });
});

describe("the two cards side by side (Rye, 9 Nov 2026)", () => {
  it("sets what the role asks beside what they offer, and names the gaps", async () => {
    answer = () =>
      json({
        proposal: served({
          roles: [{ id: "role-gate", name: "Gate Keeper", circle: "Land Circle", note: "", accountabilities: ["Open at dawn", "Close at dusk"], timeCommitment: "10 hours a week" }],
          card: { roles: [{ roleId: "role-gate", moves: [{ text: "Open at dawn", target: "every day" }], firstMoon: [] }], serves: [], hours: "8 a week", agreed: { loveLetter: true, nda: true }, terms: { choice: "talk", note: "The rate" }, timeZone: "America/Costa_Rica" },
        }),
      });
    render(<OpenProposal />);
    expect(await screen.findByRole("heading", { name: "Their card beside the open card" })).toBeTruthy();
    const row = document.querySelector('[data-side-by-side="role-gate"]') as HTMLElement;
    expect(within(row).getByText(/I'll move: Open at dawn/)).toBeTruthy();
    expect(within(row).getByText("(not picked)")).toBeTruthy();
    const gaps = document.querySelector("[data-card-gaps]") as HTMLElement;
    expect(gaps.textContent).toContain("No goal for Gate Keeper");
    expect(gaps.textContent).toContain("No season goal served");
    expect(gaps.textContent).toContain("They want to talk about the terms");
    expect((document.querySelector("[data-terms-flag]") as HTMLElement).textContent).toBe("Wants to talk about the terms: The rate");
    expect(screen.getByText("Time zone: America/Costa_Rica")).toBeTruthy();
  });

  it("the membership gap reads the alignment made at application, never the old Love Letter tick (Rye's answer 8)", async () => {
    const card = { roles: [{ roleId: "role-gate", moves: [], firstMoon: [] }], serves: [], hours: "", agreed: { loveLetter: true, nda: true } };
    const roles = [{ id: "role-gate", name: "Gate Keeper", circle: "Land Circle", note: "", accountabilities: [] }];
    // The old tick says yes, and nothing was aligned: the gap shows.
    answer = () => json({ proposal: served({ roles, card, membership: { aligned: false } }) });
    render(<OpenProposal />);
    await screen.findByRole("heading", { name: "Their card beside the open card" });
    expect((document.querySelector("[data-card-gaps]") as HTMLElement).textContent).toContain("Not aligned with the membership letter");
    expect(screen.getByText(/have not aligned with the membership letter yet/)).toBeTruthy();
    cleanup();
    // CONTROL: aligned at application, the gap is gone.
    answer = () => json({ proposal: served({ roles, card, membership: { aligned: true } }) });
    render(<OpenProposal />);
    await screen.findByRole("heading", { name: "Their card beside the open card" });
    expect(document.querySelector("[data-card-gaps]")?.textContent ?? "").not.toContain("membership letter");
    expect(screen.getByText(/aligned with the membership letter when they proposed/)).toBeTruthy();
  });

  it("says when a proposal predates the applicant's card", async () => {
    render(<OpenProposal />);
    expect(await screen.findByText(/sent before applicants wrote their own role card/)).toBeTruthy();
  });
});
