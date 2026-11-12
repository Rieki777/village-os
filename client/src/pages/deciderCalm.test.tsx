// @vitest-environment jsdom
/**
 * DECIDER CALM (Phase D, decision 4): the pages where people decide change
 * only what they show. These tests hold both halves.
 *
 *   WHAT CHANGED   the night world; the one lit door when the reader is asked
 *                  and has not answered, on a door to the round and never on an
 *                  answer; two circles meeting only for a consent reached; and
 *                  every list a decider reads in the order it arrived.
 *   WHAT DID NOT   the request a vote, a consent answer and an accept send:
 *                  the same route, the same method, the same body, read off
 *                  the network stub itself, so a change in what a decision
 *                  sends fails here by name.
 */
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { Router } from "wouter";
import { CONSENT_WORDS } from "@shared/roleProposalConsent";
import { consentOf } from "@/test/roleProposalFixture";

const route = vi.hoisted(() => ({ id: "b1" }));

vi.mock("@/components/Layout", () => ({ default: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "u-ben" } }),
  useOptionalAuth: () => ({ user: { id: "u-ben" }, loading: false }),
}));
vi.mock("@/modules/ModuleProvider", () => ({
  useModules: () => ({ loaded: true, modules: [{ id: "governance", lifecycle: "members" }] }),
  useModule: () => ({ id: "governance", lifecycle: "members" }),
  useModuleOn: () => false,
}));
vi.mock("@/components/modules/ModuleGate", () => ({
  default: () => <p>Module gate</p>,
  SignInDoors: () => <a href="/login">Sign in</a>,
}));
vi.mock("@/components/natural/useReducedMotion", () => ({ useReducedMotion: () => true, prefersReducedMotion: () => true }));
vi.mock("@/lib/gameApi", async (orig) => ({
  ...(await orig<typeof import("@/lib/gameApi")>()),
  authToken: () => "a-token",
  useCatalyst: () => ({ name: "Steward", aName: "a steward" }),
  useGameConfig: () => ({ currency: { names: {} } }),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("wouter", async (orig) => ({
  ...(await orig<typeof import("wouter")>()),
  useParams: () => ({ id: route.id }),
}));

import Decision from "./Decision";
import Decisions from "./Decisions";
import Review from "./Review";
import SeatApplication from "./SeatApplication";
import CircleConsent, { CONSENT_SEAL, ConsentSummary } from "@/components/roleProposal/CircleConsent";

type Sent = { method: string; url: string; body: unknown };
const sent: Sent[] = [];
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/** Answer by path; anything unnamed is a 404, which every page here reads as "not shown". */
function serve(routes: Record<string, (init?: RequestInit) => Response>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      sent.push({ method, url: String(url), body: init?.body ? JSON.parse(String(init.body)) : undefined });
      const hit = routes[`${method} ${url}`] ?? routes[String(url)];
      return hit ? hit(init) : json({ error: "not here" }, 404);
    }),
  );
}

const DAY = 86_400_000;
const iso = (offsetDays: number) => new Date(Date.now() + offsetDays * DAY).toISOString();

function ballot(over: Record<string, unknown> = {}) {
  return {
    id: "b1",
    subjectType: "proposal",
    subjectRef: "p1",
    binding: true,
    title: "Keep the orchard gate open on market days",
    docMarkdown: "The gate stays open from dawn on market days.",
    purposeAlignment: null,
    method: "majority",
    weightMode: "equal",
    weightToken: null,
    unityPct: 51,
    quorumPct: 30,
    totalWeight: 4,
    electorateCount: 4,
    opensAt: iso(-3),
    closesAt: iso(4),
    status: "open",
    outcomeNote: null,
    closedBy: null,
    closedAt: null,
    tallies: { yesW: 1, noW: 0, abstainW: 0 },
    unity: 100,
    quorum: 25,
    votes: [{ name: "Mara", choice: "yes", weight: 1, castAt: iso(-2) }],
    silent: [{ name: "Ben", weight: 1 }],
    objections: [],
    standingObjections: 0,
    transfer: null,
    myVote: null,
    myWeight: 1,
    appliedKeys: [],
    priorAttempts: [],
    ...over,
  };
}

/** The lit door, and every firefly layer on the page. */
const door = () => document.querySelector("[data-your-turn]");
const fireflyLayers = () => document.querySelectorAll('[data-testid="fireflies"]');
/** Whether an element sits inside the fireflies' host, which is what "lit" means. */
const lit = (el: Element) => !!el.closest(".nk-ff-host");

beforeEach(() => {
  sent.length = 0;
  route.id = "b1";
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("/decisions/:id, one decision", () => {
  const open = (over: Record<string, unknown> = {}) =>
    serve({
      "/api/governance/ballots/b1": () => json(ballot(over)),
      "POST /api/governance/ballots/b1/vote": () => json({ success: true, choice: "yes", ballot: ballot({ ...over, myVote: { choice: "yes" } }) }),
    });

  it("stands in the night world", async () => {
    open();
    const { container } = render(<Decision />);
    await screen.findByRole("heading", { name: "Keep the orchard gate open on market days" });
    expect(container.querySelector(".sheet-night")).toBeTruthy();
  });

  it("lights one door to the vote when the reader is on the roll and has not voted, and never an answer", async () => {
    open();
    render(<Decision />);
    await screen.findByRole("heading", { name: "Keep the orchard gate open on market days" });
    const turn = door();
    expect(turn).toBeTruthy();
    expect(within(turn as HTMLElement).getByRole("link", { name: "Give my answer" }).getAttribute("href")).toBe("#your-answer");
    expect(fireflyLayers()).toHaveLength(1);
    for (const name of ["Yes", "No", "Abstain"]) {
      expect(lit(screen.getByRole("button", { name: new RegExp(`^${name}`) }))).toBe(false);
    }
    expect(document.getElementById("your-answer")).toBeTruthy();
  });

  it("sends exactly the vote it always sent", async () => {
    open();
    render(<Decision />);
    fireEvent.click(await screen.findByRole("button", { name: /^Yes/ }));
    await waitFor(() => expect(sent.some((s) => s.method === "POST")).toBe(true));
    expect(sent.filter((s) => s.method === "POST")).toEqual([
      { method: "POST", url: "/api/governance/ballots/b1/vote", body: { choice: "yes" } },
    ]);
  });

  it.each([
    ["the reader has voted", { myVote: { choice: "yes", reason: null, choiceHidden: false, state: "cast_by_me", sentence: "You voted yes", followedUserId: null, followedName: null } }],
    ["the reader is not on the roll", { myWeight: null }],
    ["the period has ended", { closesAt: iso(-1) }],
    ["the vote is decided", { status: "passed", closedAt: iso(-1), outcomeNote: "Carried." }],
  ])("lights nothing when %s", async (_why, over) => {
    open(over);
    render(<Decision />);
    await screen.findByRole("heading", { name: "Keep the orchard gate open on market days" });
    expect(door()).toBeNull();
    expect(fireflyLayers()).toHaveLength(0);
  });

  it("draws two circles meeting for a decision the village made by consent", async () => {
    open({ method: "consent", status: "passed", closedAt: iso(-1), outcomeNote: "Consented." });
    render(<Decision />);
    await screen.findByRole("heading", { name: "Keep the orchard gate open on market days" });
    expect(document.querySelector("[data-consent-reached]")).toBeTruthy();
    expect(screen.getByRole("img", { name: "The village consented" })).toBeTruthy();
  });

  it.each([
    ["a consent vote still open", { method: "consent" }],
    ["a majority that carried", { status: "passed", closedAt: iso(-1), outcomeNote: "Carried." }],
    ["a consent vote that failed", { method: "consent", status: "failed", closedAt: iso(-1), outcomeNote: "Stopped." }],
  ])("draws no meeting for %s", async (_why, over) => {
    open(over);
    render(<Decision />);
    await screen.findByRole("heading", { name: "Keep the orchard gate open on market days" });
    expect(document.querySelector("[data-consent-reached]")).toBeNull();
  });
});

describe("/decisions, the list", () => {
  const card = (id: string, title: string, opensDaysAgo: number, over: Record<string, unknown> = {}) => {
    const { votes, silent, objections, docMarkdown, transfer, appliedKeys, priorAttempts, ...rest } = ballot({
      id,
      title,
      opensAt: iso(-opensDaysAgo),
      votedCount: 1,
      ...over,
    });
    void votes; void silent; void objections; void docMarkdown; void transfer; void appliedKeys; void priorAttempts;
    return rest;
  };

  it("reads what waits on you oldest first, and lights one door to the one that has waited longest", async () => {
    serve({
      "/api/governance/ballots?limit=100": () =>
        json([card("b-new", "The newest question", 1), card("b-old", "The oldest question", 9), card("b-mid", "A middle question", 4)]),
    });
    render(
      <Router>
        <Decisions />
      </Router>,
    );
    const section = (await screen.findByRole("heading", { name: "Waiting on you" })).closest("section") as HTMLElement;
    const titles = within(section)
      .getAllByRole("link")
      .filter((a) => !a.closest("[data-your-turn]"))
      .map((a) => a.textContent ?? "");
    const order = ["The oldest question", "A middle question", "The newest question"].map((t) => titles.findIndex((x) => x.includes(t)));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(fireflyLayers()).toHaveLength(1);
    expect(within(door() as HTMLElement).getByRole("link").getAttribute("href")).toBe("/decisions/b-old");
  });

  it("lights nothing when nothing waits on you", async () => {
    serve({ "/api/governance/ballots?limit=100": () => json([card("b1", "Voted already", 2, { myVote: { choice: "yes" } })]) });
    render(
      <Router>
        <Decisions />
      </Router>,
    );
    await screen.findByText("You have voted in everything that is open to you.");
    expect(door()).toBeNull();
    expect(fireflyLayers()).toHaveLength(0);
  });
});

describe("/review", () => {
  const item = (id: string, batchId: string) => ({
    id,
    batchId,
    moduleId: "a-service",
    kind: "circle.proposed",
    payload: { name: `Circle ${id}` },
    quote: null,
    sourceRef: null,
    sourceOccurredAt: null,
    evidence: "anchored",
    audience: "steward",
    trustTier: "tier-1",
    confidence: null,
    significance: null,
    subjectRef: null,
    receivedAt: iso(-1),
    correlationId: null,
  });
  const queue = {
    batches: [
      { batchId: "later", moduleId: "the later service", receivedAt: iso(-1), items: [item("p2", "later")] },
      { batchId: "earlier", moduleId: "the earlier service", receivedAt: iso(-6), items: [item("p1", "earlier")] },
    ],
    quests: [],
    drops: [],
    counts: { proposals: 2, quests: 0 },
  };

  beforeEach(() =>
    serve({
      "/api/review/queue": () => json(queue),
      "/api/admin/quest-claims": () => json({ error: "not yours" }, 403),
      "POST /api/review/proposals/p1/accept": () => json({ success: true }),
    }),
  );

  it("stands in the night world and reads batches in the order they arrived", async () => {
    const { container } = render(
      <Router>
        <Review />
      </Router>,
    );
    const first = await screen.findByRole("heading", { name: /from the earlier service/ });
    const second = screen.getByRole("heading", { name: /from the later service/ });
    expect(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(container.querySelector(".sheet-night")).toBeTruthy();
    expect(fireflyLayers()).toHaveLength(0);
  });

  it("sends exactly the accept it always sent, edits included", async () => {
    render(
      <Router>
        <Review />
      </Router>,
    );
    const box = (await screen.findAllByLabelText(/Change anything before you accept it/i))[0];
    fireEvent.change(box, { target: { value: JSON.stringify({ name: "Circle renamed" }) } });
    fireEvent.click(screen.getAllByRole("button", { name: "Accept this one" })[0]);
    await waitFor(() => expect(sent.some((s) => s.method === "POST")).toBe(true));
    expect(sent.filter((s) => s.method === "POST")[0]).toEqual({
      method: "POST",
      url: "/api/review/proposals/p1/accept",
      body: { payload: { name: "Circle renamed" } },
    });
  });
});

describe("/role-applications/:id, the circle's round", () => {
  const ID = "sa-00112233445566d4";
  const served = (consentYou: { asked: boolean; answer: string | null; mayAnswer: boolean }, state: "open" | "consented" = "open") => ({
    id: ID,
    href: `/role-applications/${ID}`,
    status: "awaiting-holder",
    statusWords: "Waiting for a role holder",
    candidate: { id: "u-ana", name: "Ana Quillfeather" },
    seats: [{ id: "role-kitchen", name: "Kitchen keeper", aim: "Feed the village well." }],
    note: "I have cooked for forty for years.",
    deliverables: "Every meal on time.",
    settings: { v: 1 },
    term: { endsOn: "2027-03-20", followsSeason: true, seasonId: "s-next" },
    startsOn: "2026-12-21",
    adoptedVia: null,
    adoptedBy: null,
    ballotId: null,
    decidedAt: null,
    createdAt: "2026-11-02T00:00:00.000Z",
    proposal: { id: "rp-1", changesRoles: true, consent: consentOf(state, { you: consentYou }), decided: null },
    you: { isCandidate: false, mayAdopt: false, mayPutToVillage: false, mayWithdraw: false, holdsThePower: false },
  });

  beforeEach(() => {
    route.id = ID;
  });

  const answerWith = (app: unknown) =>
    serve({
      [`/api/governance/role-applications/${ID}`]: () => json({ application: app }),
      [`POST /api/governance/role-applications/${ID}/consent`]: () =>
        json({ answer: "consent", carried: false, carriedWords: null, consent: consentOf("open", { you: { asked: true, answer: "consent", mayAnswer: false } }) }),
      "/api/org": () => json({ roles: [], circles: [], people: true, village: null }),
      "/api/seat-presets": () => json({ presets: [] }),
    });

  it("lights one door to the round for an asked holder, and leaves Consent and Object unlit", async () => {
    answerWith(served({ asked: true, answer: null, mayAnswer: true }));
    render(<SeatApplication />);
    const consent = await screen.findByRole("button", { name: CONSENT_WORDS.consentButton });
    expect(within(door() as HTMLElement).getByRole("link").getAttribute("href")).toBe("#the-round");
    expect(fireflyLayers()).toHaveLength(1);
    expect(lit(consent)).toBe(false);
    expect(lit(screen.getByRole("button", { name: CONSENT_WORDS.objectButton }))).toBe(false);
    // The words sit beside the round, never behind it.
    expect(screen.getByText("I have cooked for forty for years.")).toBeTruthy();
  });

  it("sends exactly the consent it always sent", async () => {
    answerWith(served({ asked: true, answer: null, mayAnswer: true }));
    render(<SeatApplication />);
    fireEvent.click(await screen.findByRole("button", { name: CONSENT_WORDS.consentButton }));
    await waitFor(() => expect(sent.some((s) => s.method === "POST")).toBe(true));
    expect(sent.filter((s) => s.method === "POST")).toEqual([
      { method: "POST", url: `/api/governance/role-applications/${ID}/consent`, body: { answer: "consent" } },
    ]);
  });

  it("lights nothing for a member the circle did not ask", async () => {
    answerWith(served({ asked: false, answer: null, mayAnswer: false }));
    render(<SeatApplication />);
    await screen.findByRole("heading", { name: CONSENT_WORDS.heading });
    expect(door()).toBeNull();
    expect(fireflyLayers()).toHaveLength(0);
  });
});

describe("the circle's answer: two circles meet only for a consent reached", () => {
  it("draws the meeting once the circle has consented", () => {
    render(<CircleConsent applicationId="a1" consent={consentOf("consented")} decided={null} waiting />);
    expect(screen.getByRole("img", { name: CONSENT_SEAL })).toBeTruthy();
  });

  it.each(["open", "objected", "lapsed", "no-other-holders"] as const)("draws nothing while it stands %s", (state) => {
    render(<CircleConsent applicationId="a1" consent={consentOf(state)} decided={null} waiting />);
    expect(screen.queryByRole("img", { name: CONSENT_SEAL })).toBeNull();
  });

  it("leaves a page that only reports where it stands as it was", () => {
    render(<ConsentSummary consent={consentOf("consented")} decided={null} />);
    expect(screen.queryByRole("img", { name: CONSENT_SEAL })).toBeNull();
  });
});
