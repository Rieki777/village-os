// @vitest-environment jsdom
/**
 * `/role-applications/:id` DRAWS THE PLAYER CARD IN PROPOSAL MODE (PR 3 of 7).
 *
 *   - the candidate's card replaces the stacked role cards: one card for the
 *     whole application, its live sections reading "Starts once adopted";
 *   - the terms drawer sits under it, and the adopt and put to the village
 *     controls are still below;
 *   - CONTROL: when the card cannot load, the stacked role cards come back.
 */
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { buildPlayerCard, type PlayerCardInput, type PlayerRoleIn } from "@shared/playerCard";
import type { PlayerCardPayload } from "@shared/playerCardPayload";

const ID = "sa-0011223344556677";

vi.mock("@/components/Layout", () => ({
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "u-hal" } }),
}));
vi.mock("@/modules/ModuleProvider", () => ({
  useModules: () => ({ loaded: true, modules: [{ id: "governance", lifecycle: "members" }] }),
  useModule: () => ({ id: "governance", lifecycle: "members" }),
  // The Gene Keys strip above the card asks this; off here, so it draws nothing.
  useModuleOn: () => false,
}));
vi.mock("@/components/modules/ModuleGate", () => ({
  default: () => <p>Module gate</p>,
  SignInDoors: () => <a href="/login">Sign in</a>,
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

const SERVED = {
  id: ID,
  href: `/role-applications/${ID}`,
  status: "awaiting-holder",
  statusWords: "Waiting for a role holder",
  candidate: { id: "u-ana", name: "Ana Quillfeather" },
  seats: [
    { id: "seat-lead", name: "Lead steward", aim: "Hold the whole picture." },
    { id: "seat-platform", name: "Platform steward", aim: null },
  ],
  note: "I kept the orchard ledger last season.",
  deliverables: "Two more people can keep the ledger.",
  settings: { v: 1, pay: { kind: "fixed", currency: "XTS", amountMinor: 100000, per: "month" } },
  term: { endsOn: "2026-12-31", followsSeason: false, seasonId: "s-now" },
  startsOn: null,
  adoptedVia: null,
  adoptedBy: null,
  ballotId: null,
  decidedAt: null,
  createdAt: "2026-10-09T00:00:00.000Z",
  you: { isCandidate: false, mayAdopt: true, mayPutToVillage: true, mayWithdraw: false, holdsThePower: true },
};

const role = (id: string, name: string): PlayerRoleIn => ({
  id,
  name,
  aim: `The aim of ${name}.`,
  whyItMatters: null,
  domain: null,
  accountabilities: [],
  criticality: "normal",
  circle: null,
  termEndsAt: "2026-12-31T06:00:00Z",
  archetypes: [],
  archetypesSuggested: false,
  bringMe: null,
  notMine: null,
  runbook: null,
  worksWith: [],
  powers: [],
  tensions: [],
  settings: { v: 1, pay: { kind: "fixed", currency: "XTS", amountMinor: 100000, per: "month" } } as any,
});

function proposalPayload(): PlayerCardPayload {
  const input: PlayerCardInput = {
    now: new Date("2026-10-22T18:00:00Z"),
    timeZone: "UTC",
    owner: { userId: "u-ana", displayName: "Ana Quillfeather", avatar: null },
    viewerUserId: "u-hal",
    villageName: "Riverbend",
    season: { id: "s-now", name: "Now", startsOn: "2026-10-01", endsOn: "2026-12-31" },
    nextSeasonId: null,
    archetypeNames: {},
    roles: [role("seat-lead", "Lead steward"), role("seat-platform", "Platform steward")],
    plan: null,
    seasonalGoals: null,
    tasks: [],
    signRows: {},
    howIHold: null,
    applications: [],
    roleNames: { "seat-lead": "Lead steward", "seat-platform": "Platform steward" },
    bonusTokenName: null,
    mode: "proposal",
  };
  return {
    card: buildPlayerCard(input),
    viewer: { level: "member", isSelf: false },
    timeZone: "UTC",
    sheets: {},
    links: { apply: "/roles", plan: "/season-plans/mine" },
  };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

let cardAnswer: () => Response;
const asked: string[] = [];

beforeEach(() => {
  asked.length = 0;
  cardAnswer = () => json(proposalPayload());
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: { method?: string }) => {
      asked.push(`${init?.method ?? "GET"} ${url}`);
      if (url === `/api/governance/role-applications/${ID}`) return json({ application: SERVED });
      if (url === `/api/governance/role-applications/${ID}/card`) return cardAnswer();
      if (url === "/api/org") return json({ roles: SERVED.seats.map((s) => ({ ...s, seats: 1, holderCount: 0, holders: [], state: "open" })), circles: [], people: true, village: null });
      if (url === "/api/seat-presets") return json({ presets: [] });
      return json({});
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("the application page draws the candidate's card in proposal mode", () => {
  it("one card for both roles, live sections reading Starts once adopted, the controls still below", async () => {
    const { container } = render(<SeatApplication />);
    await screen.findByRole("heading", { name: "Ana Quillfeather applies for Lead steward and Platform steward" });
    const card = await screen.findByText("Applies for Lead steward and Platform steward").then(() =>
      container.querySelector('[data-player-card][data-card-mode="proposal"]'),
    );
    expect(card).toBeTruthy();
    expect(asked).toContain(`GET /api/governance/role-applications/${ID}/card`);
    // One card, both roles in full.
    expect(container.querySelectorAll("[data-player-card]")).toHaveLength(1);
    expect(within(card as HTMLElement).getAllByText("Starts once adopted").length).toBeGreaterThan(0);
    // The stacked role cards are gone, and a proposal is never edited.
    expect(container.querySelector("article[data-power-card]")).toBeNull();
    expect(screen.queryByRole("button", { name: /Edit my card/ })).toBeNull();
    // The terms drawer under the card, the figure readable there, and the holder's doors below.
    expect(container.querySelector("[data-package-terms]")).toBeTruthy();
    expect((await screen.findAllByText("Recorded here. Paid outside the platform.")).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Put it to the village" })).toBeTruthy();
    const order = Array.from(container.querySelectorAll("[data-player-card], [data-package-terms], #sa-holder"));
    expect(order.map((el) => (el.id === "sa-holder" ? "holder" : el.hasAttribute("data-player-card") ? "card" : "terms"))).toEqual(["card", "terms", "holder"]);
  });

  it("CONTROL: when the card cannot load, the stacked role cards come back", async () => {
    cardAnswer = () => json({ error: "This application has no card to show." }, 404);
    const { container } = render(<SeatApplication />);
    await screen.findByRole("heading", { name: "Ana Quillfeather applies for Lead steward and Platform steward" });
    await screen.findAllByText("Recorded here. Paid outside the platform.");
    expect(container.querySelector("[data-player-card]")).toBeNull();
    expect(screen.getAllByText(/Lead steward/).length).toBeGreaterThan(0);
  });
});
