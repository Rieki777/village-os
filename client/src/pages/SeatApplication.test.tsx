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
    // The civil day in words, never raw ISO (red team U6).
    expect(screen.getByText("Until 31 December 2026.")).toBeTruthy();
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

  it("asks once before withdrawing, and withdraws only on the yes (red team U1)", async () => {
    answer = () =>
      json({ application: { ...SERVED, you: { isCandidate: true, mayAdopt: false, mayPutToVillage: false, mayWithdraw: true, holdsThePower: false } } });
    render(<SeatApplication />);
    fireEvent.click(await screen.findByRole("button", { name: "Withdraw my application" }));
    expect(asked.some((a) => a.endsWith("/withdraw"))).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Keep it" }));
    expect(asked.some((a) => a.endsWith("/withdraw"))).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Withdraw my application" }));
    fireEvent.click(screen.getByRole("button", { name: "Yes, withdraw it" }));
    await waitFor(() => expect(asked).toContain(`POST /api/governance/role-applications/${ID}/withdraw`));
  });

  it("says a carried vote is carried and keeps the link to it (red team U1)", async () => {
    answer = () =>
      json({ application: { ...SERVED, status: "voting", statusWords: "Carried, lands on 12 November 2029", carried: true, ballotId: "bal-1", you: { isCandidate: true, mayAdopt: false, mayPutToVillage: false, mayWithdraw: false, holdsThePower: false } } });
    render(<SeatApplication />);
    expect(await screen.findByText("Carried, lands on 12 November 2029.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Read the vote" }).getAttribute("href")).toBe("/decisions/bal-1");
    expect(screen.queryByRole("button", { name: "Withdraw my application" })).toBeNull();
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

describe("the words every party aligns with (PR5)", () => {
  const HASH = "c".repeat(64);
  const ALIGNMENT = {
    textId: "at-00112233445566aa",
    title: "Terms for Lead steward and Platform steward",
    body: "Terms for Lead steward and Platform steward\n\nTHE SEATS\n  Lead steward\n  Platform steward\n",
    version: 1,
    seatNames: ["Lead steward", "Platform steward"],
    href: `/seat-applications/${ID}`,
    state: "pending",
    why: "Waiting for every party to align.",
    sealed: false,
    money: true,
    parties: [
      { partyKey: "user:u-ana", label: "Ana Quillfeather", capacity: "individually", required: true, aligned: false, at: null, method: null },
      { partyKey: "village", label: "The village", capacity: "for the village", required: true, aligned: true, at: "2026-10-09T10:00:00.000Z", method: "holder" },
    ],
    you: { partyKey: "user:u-ana", aligned: false, alignedAt: null, mayAlign: true },
    contentHash: HASH,
    createdAt: "2026-10-09T00:00:00.000Z",
  };
  const posted: Array<{ url: string; body: any }> = [];
  let alignAnswers: Response[] = [];

  beforeEach(() => {
    signedIn = { id: "u-ana" };
    posted.length = 0;
    alignAnswers = [];
    answer = () =>
      json({ application: { ...SERVED, alignment: ALIGNMENT, you: { isCandidate: true, mayAdopt: false, mayPutToVillage: false, mayWithdraw: false, holdsThePower: false } } });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: { method?: string; body?: string }) => {
        asked.push(`${init?.method ?? "GET"} ${url}`);
        if (init?.method === "POST") posted.push({ url, body: JSON.parse(init.body ?? "{}") });
        if (url === `/api/governance/role-applications/${ID}`) return answer();
        if (url === "/api/org") return json(ORG);
        if (url === "/api/seat-presets") return json({ presets: [] });
        if (url === "/api/auth/confirm-methods") return json({ confirmWith: "password" });
        if (url === "/api/profile/alignments/confirm") return json({ success: true, fresh: true, freshUntil: null, confirmWith: "password" });
        if (url === "/api/profile/alignments") return alignAnswers.shift() ?? json({ success: true, alignment: null }, 201);
        return json({});
      }),
    );
  });

  it("shows the exact stored words and a chip per party, with one Align and one plain sentence", async () => {
    render(<SeatApplication />);
    const words = await screen.findByText((_, el) => el?.getAttribute("data-alignment-words") === "" && el.textContent === ALIGNMENT.body);
    expect(words).toBeTruthy();
    expect(screen.getAllByText("Ana Quillfeather, not yet").length).toBeGreaterThan(0);
    expect(screen.getAllByText("The village, aligned").length).toBeGreaterThan(0);
    expect(screen.getByText("I align with these terms for Lead steward and Platform steward.")).toBeTruthy();
    // No hash and no version beside the button, and never "sign".
    expect(document.body.textContent).not.toContain(HASH);
    expect(document.body.textContent).not.toMatch(/\bsign(ed|ature)?\b/i);
    fireEvent.click(screen.getByRole("button", { name: "Align" }));
    await waitFor(() => expect(posted.find((p) => p.url === "/api/profile/alignments")?.body).toEqual({ textId: ALIGNMENT.textId, contentHash: HASH }));
  });

  it("MONEY: a re-confirm demand opens the confirmation in place, and confirming aligns without a second click on Align", async () => {
    alignAnswers = [json({ error: "reconfirm_required", message: "These terms carry money, so the village asks you to confirm it is you before you align." }, 403)];
    render(<SeatApplication />);
    fireEvent.click(await screen.findByRole("button", { name: "Align" }));
    expect(await screen.findByText("These terms carry money, so the village asks you to confirm it is you before you align.")).toBeTruthy();
    fireEvent.change(await screen.findByPlaceholderText("Your password"), { target: { value: "right horse battery" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm it is you" }));
    await waitFor(() => expect(posted.find((p) => p.url === "/api/profile/alignments/confirm")?.body).toEqual({ password: "right horse battery" }));
    await waitFor(() => expect(posted.filter((p) => p.url === "/api/profile/alignments")).toHaveLength(2));
  });

  it("once in force, the drawer and the card carry the Aligned stamp beside both chips", async () => {
    answer = () =>
      json({
        application: {
          ...SERVED,
          status: "adopted",
          alignment: {
            ...ALIGNMENT,
            state: "in-force",
            why: null,
            sealed: true,
            parties: ALIGNMENT.parties.map((p) => ({ ...p, aligned: true, at: "2026-10-09T10:00:00.000Z" })),
            you: { partyKey: "user:u-ana", aligned: true, alignedAt: "2026-10-09T10:00:00.000Z", mayAlign: false },
          },
          you: { isCandidate: true, mayAdopt: false, mayPutToVillage: false, mayWithdraw: false, holdsThePower: false },
        },
      });
    render(<SeatApplication />);
    await screen.findByText("You aligned on 9 Oct 2026");
    // One stamp in each seat's drawer tray and one on the card.
    expect(document.querySelectorAll("[data-aligned-stamp]").length).toBe(3);
    expect(screen.getAllByText("Ana Quillfeather, aligned").length).toBe(3);
    expect(screen.queryByRole("button", { name: "Align" })).toBeNull();
  });
});
