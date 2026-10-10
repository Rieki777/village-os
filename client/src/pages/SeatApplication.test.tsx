// @vitest-environment jsdom
/**
 * `/seat-applications/:id` (seat settings PR4): members only, the cards with
 * the drawer open on the application's terms, the member's words, and the
 * holder's card.
 *
 *   - a visitor gets the sign-in doors and no application is fetched;
 *   - a signed-in guest is answered 401 and reads "Members read seat
 *     applications." with no terms on the page;
 *   - a holder reads the terms, money line included, and gets "Align for the
 *     village" and "Put it to the village";
 *   - a holder who is the candidate gets "Your own terms go to the village to
 *     adopt." and no adopt button.
 */
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const ID = "sa-0011223344556677";
let signedIn: { id: string } | null = { id: "u-hal" };

vi.mock("@/components/Layout", () => ({
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: signedIn }),
}));
vi.mock("@/modules/ModuleProvider", () => ({
  useModules: () => ({ loaded: true, modules: [{ id: "governance", lifecycle: "members" }] }),
  useModule: () => ({ id: "governance", lifecycle: "members" }),
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

const SERVED = {
  id: ID,
  href: `/seat-applications/${ID}`,
  status: "awaiting-holder",
  statusWords: "Waiting for a seat holder",
  candidate: { id: "u-ana", name: "Ana Quillfeather" },
  seats: [
    { id: "seat-lead", name: "Lead steward", aim: "Hold the whole picture." },
    { id: "seat-platform", name: "Platform steward", aim: null },
  ],
  note: "I kept the orchard ledger last season.",
  deliverables: "Two more people can keep the ledger by the end of the season.",
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

const ORG = {
  roles: [
    { id: "seat-lead", name: "Lead steward", seats: 1, holderCount: 0, holders: [], state: "open" },
    { id: "seat-platform", name: "Platform steward", seats: 1, holderCount: 0, holders: [], state: "open" },
  ],
  circles: [],
  people: true,
  village: null,
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

let answer: () => Response;
const asked: string[] = [];

beforeEach(() => {
  signedIn = { id: "u-hal" };
  asked.length = 0;
  answer = () => json({ application: SERVED });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: { method?: string }) => {
      asked.push(`${init?.method ?? "GET"} ${url}`);
      if (url === `/api/governance/role-applications/${ID}`) return answer();
      if (url === "/api/org") return json(ORG);
      if (url === "/api/seat-presets") return json({ presets: [] });
      if (url.endsWith("/adopt")) return json({ status: "adopted" });
      return json({});
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("who reads an application", () => {
  it("a visitor gets the sign-in doors, and nothing is fetched", () => {
    signedIn = null;
    render(<SeatApplication />);
    expect(screen.getByText("Members read seat applications.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Sign in" }).getAttribute("href")).toContain(`/seat-applications/${ID}`);
    expect(asked.filter((a) => a.includes("role-applications"))).toEqual([]);
  });

  it("a guest answered 401 reads the members line and no terms", async () => {
    signedIn = { id: "u-guest" };
    answer = () => json({ error: "auth_required", message: "Members read seat applications." }, 401);
    render(<SeatApplication />);
    expect(await screen.findByText("Members read seat applications.")).toBeTruthy();
    expect(screen.queryByText(/Recorded here/)).toBeNull();
    expect(screen.queryByText(/orchard ledger/)).toBeNull();
  });
});

describe("a member reading one", () => {
  it("shows every seat, the terms with the money line, and the member's words", async () => {
    render(<SeatApplication />);
    expect(await screen.findByRole("heading", { name: "Ana Quillfeather applies for Lead steward and Platform steward" })).toBeTruthy();
    expect(screen.getByText("Waiting for a seat holder")).toBeTruthy();
    expect(await screen.findAllByText("Recorded here. Paid outside the platform.")).not.toHaveLength(0);
    expect(screen.getByText("I kept the orchard ledger last season.")).toBeTruthy();
    expect(screen.getByText("Until 2026-12-31.")).toBeTruthy();
  });

  it("gives a holder both doors, and adopting reads the application again", async () => {
    render(<SeatApplication />);
    const align = await screen.findByRole("button", { name: "Align for the village" });
    expect(screen.getByRole("button", { name: "Put it to the village" })).toBeTruthy();
    fireEvent.click(align);
    await waitFor(() => expect(asked).toContain(`POST /api/governance/role-applications/${ID}/adopt`));
    await waitFor(() => expect(asked.filter((a) => a === `GET /api/governance/role-applications/${ID}`)).toHaveLength(2));
  });

  it("tells a holder who is the candidate that their own terms go to the village, with no adopt button", async () => {
    answer = () =>
      json({ application: { ...SERVED, you: { isCandidate: true, mayAdopt: false, mayPutToVillage: true, mayWithdraw: true, holdsThePower: true } } });
    render(<SeatApplication />);
    expect(await screen.findByText("Your own terms go to the village to adopt.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Align for the village" })).toBeNull();
    expect(screen.getByRole("button", { name: "Withdraw my application" })).toBeTruthy();
  });

  it("CONTROL: a member who holds no power gets neither door", async () => {
    answer = () =>
      json({ application: { ...SERVED, you: { isCandidate: false, mayAdopt: false, mayPutToVillage: false, mayWithdraw: false, holdsThePower: false } } });
    render(<SeatApplication />);
    await screen.findByText("I kept the orchard ledger last season.");
    expect(screen.queryByRole("button", { name: "Align for the village" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Put it to the village" })).toBeNull();
  });
});
