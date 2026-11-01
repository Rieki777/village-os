// @vitest-environment jsdom
/**
 * `/role-applications/:id` for a ROLE PROPOSAL (role proposals PR D): the
 * circle's answer on the application page, and "Record the adoption".
 *
 *   - every member reading it sees where the circle's consent stands, with
 *     the tally in counts and role titles;
 *   - an asked holder gets Consent and Object; nobody else does;
 *   - "Record the adoption" is drawn only for a holder of the power, only once
 *     the circle has consented; it calls the adopt route and shows the
 *     decision record it answers with;
 *   - before that, a holder of the power adopts by the power, "Align for the
 *     village", and a proposal that changes roles never offers the village vote.
 *
 * The card route answers nothing drawable here, so the page falls back to its
 * stacked role cards, as SeatApplication.test.tsx reads it.
 */
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CONSENT_WORDS, type ConsentState } from "@shared/roleProposalConsent";
import { consentOf } from "@/test/roleProposalFixture";

const ID = "sa-00112233445566d4";
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

import SeatApplication from "./SeatApplication";

const DECIDED = "Adopted on 9 Nov after the circle consented";
const ROLES = { asked: ["Gate keeper", "Orchard keeper"], consented: ["Gate keeper"], objected: [] };
const READER = { isCandidate: false, mayAdopt: false, mayPutToVillage: false, mayWithdraw: false, holdsThePower: false };
const POWER = { isCandidate: false, mayAdopt: true, mayPutToVillage: false, mayWithdraw: false, holdsThePower: true };

function served(state: ConsentState, you: typeof READER, consentYou = { asked: false, answer: null as string | null, mayAnswer: false }, extra: Record<string, unknown> = {}) {
  return {
    id: ID,
    href: `/role-applications/${ID}`,
    status: "awaiting-holder",
    statusWords: "Waiting for a role holder",
    candidate: { id: "u-ana", name: "Ana Quillfeather" },
    seats: [{ id: "role-kitchen", name: "Kitchen keeper", aim: "Feed the village well." }],
    note: null,
    deliverables: "Every meal on time.",
    settings: { v: 1 },
    term: { endsOn: "2027-03-20", followsSeason: true, seasonId: "s-next" },
    startsOn: "2026-12-21",
    adoptedVia: null,
    adoptedBy: null,
    ballotId: null,
    decidedAt: null,
    createdAt: "2026-11-02T00:00:00.000Z",
    proposal: {
      id: "rp-00000000000000d4",
      changesRoles: true,
      consent: consentOf(state, { consented: state === "consented" ? 1 : 0, roles: ROLES, you: consentYou }),
      decided: null,
    },
    you,
    ...extra,
  };
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

let answer: () => Response;
const asked: string[] = [];

beforeEach(() => {
  signedIn = { id: "u-ben" };
  asked.length = 0;
  answer = () => json({ application: served("open", READER) });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: { method?: string }) => {
      asked.push(`${init?.method ?? "GET"} ${url}`);
      if (url === `/api/governance/role-applications/${ID}`) return answer();
      if (url === `/api/governance/role-applications/${ID}/adopt`) return json({ success: false, status: "adopted", seated: 0, linked: 0, decided: DECIDED });
      if (url === `/api/governance/role-applications/${ID}/consent`) {
        return json({ answer: "consent", carried: false, carriedWords: null, consent: consentOf("open", { consented: 1, roles: ROLES, you: { asked: true, answer: "consent", mayAnswer: false } }) });
      }
      if (url === "/api/org") return json({ roles: [], circles: [], people: true, village: null });
      if (url === "/api/seat-presets") return json({ presets: [] });
      return json({});
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const heading = () => screen.findByRole("heading", { name: "Ana Quillfeather applies for Kitchen keeper" });

describe("the circle's answer on the application page", () => {
  it("every member reads where it stands, with the tally by role title", async () => {
    render(<SeatApplication />);
    await heading();
    expect(screen.getByRole("heading", { name: CONSENT_WORDS.heading })).toBeTruthy();
    expect(screen.getByText("Waiting on the circle")).toBeTruthy();
    expect(screen.getByText("The circle is asked to consent or object by 6 November 2026.")).toBeTruthy();
    expect((document.querySelector('[data-tally="asked"]') as HTMLElement).textContent).toBe("Asked2 (Gate keeper, Orchard keeper)");
    // Not asked: no buttons.
    expect(screen.queryByRole("button", { name: CONSENT_WORDS.consentButton })).toBeNull();
    expect(screen.queryByRole("button", { name: CONSENT_WORDS.objectButton })).toBeNull();
  });

  it("an asked holder consents from the page, which then reads the application again", async () => {
    answer = () => json({ application: served("open", READER, { asked: true, answer: null, mayAnswer: true }) });
    render(<SeatApplication />);
    fireEvent.click(await screen.findByRole("button", { name: CONSENT_WORDS.consentButton }));
    expect(await screen.findByText(CONSENT_WORDS.youConsented)).toBeTruthy();
    expect(asked).toContain(`POST /api/governance/role-applications/${ID}/consent`);
    await waitFor(() => expect(asked.filter((a) => a === `GET /api/governance/role-applications/${ID}`)).toHaveLength(2));
  });

  it("an ordinary application draws no circle's answer", async () => {
    answer = () => json({ application: { ...served("open", READER), proposal: null } });
    render(<SeatApplication />);
    await heading();
    expect(screen.queryByRole("heading", { name: CONSENT_WORDS.heading })).toBeNull();
  });
});

describe("who adopts it, named for this village (E8)", () => {
  it("every member reads who can adopt it while it waits, as the server read it from who holds the power", async () => {
    const who = "Steward Circle (Hal) adopts it.";
    answer = () => json({ application: served("open", READER, undefined, { whoAdopts: who }) });
    render(<SeatApplication />);
    const line = await screen.findByText(who);
    expect(line.closest("[data-who-adopts]")).toBeTruthy();
  });

  it("says nothing of it once the application is decided", async () => {
    answer = () => json({ application: { ...served("consented", READER), status: "adopted", statusWords: "Adopted", whoAdopts: null } });
    render(<SeatApplication />);
    await heading();
    expect(document.querySelector("[data-who-adopts]")).toBeNull();
  });
});

describe("Record the adoption", () => {
  it("is drawn for a holder of the power once the circle has consented, and shows the decision record", async () => {
    answer = () => json({ application: served("consented", POWER) });
    render(<SeatApplication />);
    const record = await screen.findByRole("button", { name: CONSENT_WORDS.record });
    expect(screen.getByText(CONSENT_WORDS.recordLine)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Align for the village" })).toBeNull();
    fireEvent.click(record);
    await waitFor(() => expect(asked).toContain(`POST /api/governance/role-applications/${ID}/adopt`));
    expect(await screen.findByText(DECIDED)).toBeTruthy();
  });

  it.each([
    ["the circle still open", "open"],
    ["an objection", "objected"],
    ["the window lapsed", "lapsed"],
    ["nobody else in the circle", "no-other-holders"],
  ] as const)("is not drawn for a holder of the power with %s, who adopts by the power instead", async (_label, state) => {
    answer = () => json({ application: served(state, POWER) });
    render(<SeatApplication />);
    expect(await screen.findByRole("button", { name: "Align for the village" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: CONSENT_WORDS.record })).toBeNull();
    // A proposal that changes roles never goes to a village vote, and the line says only what can happen.
    expect(screen.queryByRole("button", { name: "Put it to the village" })).toBeNull();
    expect(screen.getByText("You hold the power that seats people. Adopt it for the village.")).toBeTruthy();
  });

  it("is not drawn for a member who does not hold the power, even once the circle has consented", async () => {
    answer = () => json({ application: served("consented", READER) });
    render(<SeatApplication />);
    await heading();
    expect(screen.getByText("Consented by the circle, waiting for a holder of the power to record it")).toBeTruthy();
    expect(screen.queryByRole("button", { name: CONSENT_WORDS.record })).toBeNull();
  });

  it("is not drawn for the candidate, even one who holds the power", async () => {
    answer = () => json({ application: served("consented", { ...POWER, isCandidate: true, mayAdopt: false, mayWithdraw: true }) });
    render(<SeatApplication />);
    expect(await screen.findByText("Your own terms go to the village to adopt.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: CONSENT_WORDS.record })).toBeNull();
  });

  it("an adopted proposal reads its decision record, with no buttons", async () => {
    answer = () =>
      json({
        application: {
          ...served("consented", READER),
          status: "adopted",
          statusWords: "Adopted",
          proposal: { id: "rp-00000000000000d4", changesRoles: true, consent: consentOf("consented", { roles: ROLES }), decided: DECIDED },
        },
      });
    render(<SeatApplication />);
    expect(await screen.findByText(DECIDED)).toBeTruthy();
    expect(screen.queryByRole("button", { name: CONSENT_WORDS.record })).toBeNull();
    expect(screen.queryByRole("button", { name: CONSENT_WORDS.consentButton })).toBeNull();
  });
});
