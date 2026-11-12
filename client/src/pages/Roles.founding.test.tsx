// @vitest-environment jsdom
/**
 * PHASE A, LANE A3: the Roles and Circles page with "Join the founding team"
 * at the top, the full card in the founding register, and the admin view.
 *
 *   - the section draws only while the village turns it on, with the roles it
 *     names in order, and each role appears ONCE on the page;
 *   - the full card holds the founding sections, the village's pay shape with
 *     its at-risk line and footer, never a range, and one act, "Apply for this
 *     role", to /propose-a-role?role=<id>;
 *   - the card is read-only for a reader without the editor's door;
 *   - VERIFY 2.2: a steward the server sends unlisted roles to sees what a
 *     visitor sees, and the rest behind one switch.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { Router } from "wouter";
import type { ReactNode } from "react";

const session = vi.hoisted(() => ({ token: null as string | null, user: null as null | { id: string; role?: string } }));

vi.mock("@/components/Layout", () => ({ default: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock("@/components/SeatClaimCard", () => ({ default: () => null }));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: session.user, token: session.token, loading: false }),
  useIsAdmin: () => false,
  useOptionalAuth: () => ({ user: session.user }),
}));
vi.mock("@/lib/gameApi", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  authToken: () => session.token,
}));
vi.mock("@/modules/ModuleProvider", () => ({ useModule: () => undefined, useModuleOn: () => false }));
vi.mock("@/components/natural/useReducedMotion", () => ({ useReducedMotion: () => true, prefersReducedMotion: () => true }));

import Roles from "./Roles";

class NoopIntersectionObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}

const RANGE_NOTE = "Full time, with equity and other bonuses";
const seat = (id: string, name: string, over: Record<string, unknown> = {}) => ({
  id,
  name,
  circleId: "anchor",
  aim: `Lead all things ${name.toLowerCase()}.`,
  domain: "The whole domain",
  accountabilities: ["Model the viability", "Keep the daily books"],
  authorities: ["Choose the accounting tools"],
  responsibilities: ["A cash view every Monday"],
  bringMe: ["Invoices to approve"],
  notMine: ["Fundraising decisions alone"],
  whyItMatters: "Every home we plan runs on money someone keeps true.",
  signsStretched: "The close slips past day ten.",
  flowsBack: null,
  stepBack: null,
  timeCommitment: "Full time",
  seats: 1,
  holderCount: 0,
  state: "open",
  stateSource: "derived",
  criticality: "normal",
  recruiting: true,
  representsCircle: false,
  howChosen: null,
  howChosenGloss: null,
  termEnds: null,
  archetypes: ["catalyzing", "researching"],
  isExample: false,
  holders: [],
  card: { complete: true, missing: [], written: 11, of: 11, gated: false, track: "contractor", selectionCriteria: ["A", "B", "C"], conversations: [], villageGoals: null, publicPay: { kind: "range", currency: "USD", minMinor: 675000, maxMinor: 900000, per: "month", note: RANGE_NOTE } },
  ...over,
});

const SECTIONS = {
  idealBackground: ["Ideally studied finance", "Real estate development finance"],
  qualities: ["Owns the whole domain"],
  aiSupport: "An AI companion keeps the daily books moving.",
  aiCompanion: "Heron",
  paid: true,
  payShape: [],
  payNote: "",
  payCeiling: { amount: 9000, currency: "USD", per: "month" },
  paySplitNote: "To be decided in the onboarding process.",
};
const VILLAGE_PAY = {
  shape: [
    { label: "cash", pct: 40 },
    { label: "equity", pct: 55 },
    { label: "village credits", pct: 5 },
  ],
  atRisk: "The equity share depends on what the village raises.",
  note: "Indicative only. Equity, land credit, token and credit terms are still being defined and are subject to legal review.",
};

let org: any;
let founding: any;
let roleCard: (id: string) => any;
const asked: string[] = [];

beforeEach(() => {
  asked.length = 0;
  window.history.replaceState(null, "", "/roles");
  session.token = null;
  session.user = null;
  vi.stubGlobal("IntersectionObserver", NoopIntersectionObserver);
  org = {
    people: { visible: false, membersOnly: false, signedIn: false },
    circles: [{ id: "anchor", name: "Anchor Circle", purpose: "", status: "active" }],
    roles: [seat("finance", "Lead Finance Steward"), seat("land", "Regenerative Land & Building Lead"), seat("cook", "Village Cook")],
  };
  founding = { on: true, roleIds: ["land", "finance"], sections: { finance: SECTIONS }, showPayRanges: false, villagePay: VILLAGE_PAY };
  roleCard = (id: string) => ({ roleId: id, sections: id === "finance" ? SECTIONS : null, lastEdited: { by: "Mara", on: "2026-11-11" }, showPayRanges: false, villagePay: VILLAGE_PAY, mayEdit: false });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: unknown) => {
      const u = String(url);
      asked.push(u);
      const reply = (body: unknown, status = 200) => ({ ok: status < 300, status, json: async () => body });
      if (u === "/api/org") return reply(org);
      if (u === "/api/org/founding-team") return reply(founding);
      if (u.startsWith("/api/org/role-card/")) return reply(roleCard(decodeURIComponent(u.split("/").pop() ?? "")));
      if (u === "/api/season") return reply({ current: null });
      return reply([], 404);
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const renderRoles = () =>
  render(
    <Router>
      <Roles />
    </Router>,
  );

describe("Join the founding team", () => {
  it("leads the page with the roles the village names, in its order, and each role appears once", async () => {
    renderRoles();
    const section = await screen.findByRole("region", { name: "Join the founding team" });
    const rows = within(section).getAllByRole("button").filter((b) => b.hasAttribute("data-founding-role"));
    expect(rows.map((b) => b.getAttribute("data-founding-role"))).toEqual(["land", "finance"]);
    // The draft board's competing primary act is gone while the section leads.
    expect(screen.queryByRole("link", { name: /Browse the open roles/ })).toBeNull();
    // Each concept once: the directory leaves the featured roles out.
    fireEvent.click(screen.getByRole("button", { name: "See all roles" }));
    await screen.findByRole("heading", { level: 3, name: "Village Cook" });
    expect(screen.queryByRole("heading", { level: 3, name: "Lead Finance Steward" })).toBeNull();
  });

  it("draws nothing while the village has it off (control: the directory lists every role, and the board's act returns)", async () => {
    founding = { on: false, roleIds: [], sections: {}, showPayRanges: false, villagePay: VILLAGE_PAY };
    renderRoles();
    await screen.findByRole("link", { name: /Browse the open roles/ });
    expect(screen.queryByRole("region", { name: "Join the founding team" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "See all roles" }));
    expect(await screen.findByRole("heading", { level: 3, name: "Lead Finance Steward" })).toBeTruthy();
  });

  it("opens a full card with the founding sections, the village's pay shape and no range, and one Apply act", async () => {
    renderRoles();
    const section = await screen.findByRole("region", { name: "Join the founding team" });
    fireEvent.click(within(section).getByRole("button", { name: /Lead Finance Steward/ }));
    const card = await waitFor(() => {
      const el = section.querySelector('[data-full-role-card="finance"]') as HTMLElement | null;
      if (!el) throw new Error("no card yet");
      return el;
    });
    await waitFor(() => expect(within(card).getByTestId("last-edited").textContent).toBe("Last edited by Mara on 11 November 2026"));
    expect(within(card).getByTestId("paid-role-line").textContent).toBe("This is a paid role");
    expect(within(card).getByRole("heading", { name: "Ideal background" })).toBeTruthy();
    expect(within(card).getByRole("heading", { name: "Qualities we're looking for" })).toBeTruthy();
    // QA2-09: "Digital Companion" (capitalised) replaces the AI wording.
    expect(within(card).getByRole("heading", { name: "Digital Companion" })).toBeTruthy();
    expect(card.textContent).not.toMatch(/AI support/);
    expect(card.textContent).toContain("Heron");
    // Everything the editor holds: the words under the editor's own headings.
    for (const h of ["Why it matters", "What I look after", "What I can decide on my own", "What you can count on me for", "What I do regularly", "Bring me", "Not mine to hold", "Holding this role well"]) {
      expect(within(card).getByRole("heading", { name: h })).toBeTruthy();
    }
    const pay = within(card).getByTestId("pay-shape");
    expect(within(pay).getByTestId("pay-ceiling").textContent).toBe("Total compensation up to $9,000 a month");
    expect(within(pay).getByTestId("pay-split").textContent).toBe("Default split: 40% cash, 55% equity, 5% village credits. To be decided in the onboarding process.");
    expect(within(pay).getByTestId("pay-at-risk").textContent).toBe(VILLAGE_PAY.atRisk);
    expect(within(pay).getByTestId("pay-note").textContent).toBe(VILLAGE_PAY.note);
    // RANGES AND MINIMUMS STAY HIDDEN, even when an older payload still carries one.
    expect(card.textContent).not.toContain("6,750");
    expect(card.textContent).not.toContain("6750");
    expect(card.textContent).not.toContain(RANGE_NOTE);
    const apply = within(card).getAllByRole("link", { name: /Apply for this role/ });
    expect(apply).toHaveLength(1);
    expect(apply[0].getAttribute("href")).toBe("/propose-a-role?role=finance");
    // Read-only: no editor door for a visitor.
    expect(within(card).queryByRole("button", { name: "Edit this role" })).toBeNull();
  });

  it("CONTROL for the hidden range: a village that shows ranges draws the range on the same card", async () => {
    roleCard = (id: string) => ({ roleId: id, sections: SECTIONS, lastEdited: null, showPayRanges: true, villagePay: VILLAGE_PAY, mayEdit: false });
    renderRoles();
    const section = await screen.findByRole("region", { name: "Join the founding team" });
    fireEvent.click(within(section).getByRole("button", { name: /Lead Finance Steward/ }));
    await waitFor(() => expect(section.textContent).toContain(RANGE_NOTE));
  });

  it("a card that writes its own shares shows those in place of the village's", async () => {
    roleCard = (id: string) => ({ roleId: id, sections: { ...SECTIONS, payShape: [{ label: "cash", pct: 70 }, { label: "equity", pct: 30 }], payNote: "This role's own note." }, lastEdited: null, showPayRanges: false, villagePay: VILLAGE_PAY, mayEdit: false });
    renderRoles();
    const section = await screen.findByRole("region", { name: "Join the founding team" });
    fireEvent.click(within(section).getByRole("button", { name: /Lead Finance Steward/ }));
    await waitFor(() => expect(within(section).getByTestId("pay-split").textContent).toContain("70% cash, 30% equity"));
    expect(within(section).getByTestId("pay-shape").textContent).not.toContain("55%");
    expect(within(section).getByTestId("pay-note").textContent).toBe("This role's own note.");
  });
});

describe("QA2-16: each concept once on the founding card", () => {
  const open = async () => {
    renderRoles();
    const section = await screen.findByRole("region", { name: "Join the founding team" });
    fireEvent.click(within(section).getByRole("button", { name: /Lead Finance Steward/ }));
    return waitFor(() => {
      const el = section.querySelector('[data-full-role-card="finance"]') as HTMLElement | null;
      if (!el) throw new Error("no card yet");
      return el;
    });
  };
  it("says paid once: the circle alone in the eyebrow, then This is a paid role", async () => {
    const card = await open();
    await waitFor(() => expect(within(card).getByTestId("paid-role-line").textContent).toBe("This is a paid role"));
    expect(card.textContent).not.toMatch(/Paid role/);
    expect(card.querySelector("header p")?.textContent).toBe("Anchor Circle");
  });
  it("says the commitment once when the role's terms name a percent", async () => {
    org.roles[0] = seat("finance", "Lead Finance Steward", { timeCommitment: "Full commitment", card: { ...seat("x", "x").card, commitmentPct: 100 } });
    const card = await open();
    await waitFor(() => expect(card.textContent).toContain("100%"));
    expect(card.textContent).not.toContain("Full commitment");
  });
  it("keeps the written commitment on a card whose terms name no percent (control)", async () => {
    org.roles[0] = seat("finance", "Lead Finance Steward", { timeCommitment: "Full commitment" });
    const card = await open();
    await waitFor(() => expect(card.textContent).toContain("Full commitment"));
  });
});

describe("the two pay lines on the card", () => {
  const open = async () => {
    renderRoles();
    const section = await screen.findByRole("region", { name: "Join the founding team" });
    fireEvent.click(within(section).getByRole("button", { name: /Lead Finance Steward/ }));
    return section;
  };
  it("ceiling unset: only the split line", async () => {
    roleCard = (id: string) => ({ roleId: id, sections: { ...SECTIONS, payCeiling: null }, lastEdited: null, showPayRanges: false, villagePay: VILLAGE_PAY, mayEdit: false });
    const section = await open();
    await waitFor(() => expect(within(section).getByTestId("pay-split")).toBeTruthy());
    expect(within(section).queryByTestId("pay-ceiling")).toBeNull();
  });
  it("split unset: only the ceiling line, with the footer kept", async () => {
    roleCard = (id: string) => ({ roleId: id, sections: SECTIONS, lastEdited: null, showPayRanges: false, villagePay: { shape: [], atRisk: VILLAGE_PAY.atRisk, note: VILLAGE_PAY.note }, mayEdit: false });
    const section = await open();
    await waitFor(() => expect(within(section).getByTestId("pay-ceiling").textContent).toBe("Total compensation up to $9,000 a month"));
    expect(within(section).queryByTestId("pay-split")).toBeNull();
    expect(within(section).getByTestId("pay-at-risk")).toBeTruthy();
  });
});

describe("the other ways in, and the words", () => {
  it("offers Propose a new role from the start, and names the conflict steps in the village's words", async () => {
    renderRoles();
    const other = await screen.findByRole("region", { name: "Other ways to join" });
    expect(within(other).getByRole("link", { name: /Propose a new role/ }).getAttribute("href")).toBe("/role-proposals/new");
    expect(screen.getByRole("heading", { name: "How we evolve through conflict" })).toBeTruthy();
    expect(screen.queryByText(/When a Tension Is Between People/)).toBeNull();
  });
});

describe("QA2-07: Founding Seeders and volunteering are named among the other ways in", () => {
  it("offers the resident path and the gifts tile in the platform's words, to the way to stay close and the work-with-us door", async () => {
    renderRoles();
    await screen.findByRole("region", { name: "Join the founding team" });
    const other = screen.getByRole("region", { name: "Other ways to join" });
    expect(within(other).getByRole("link", { name: /Become a Founding Seeder/ }).getAttribute("href")).toBe("/resident");
    expect(within(other).getByText("Live here one day? Start on the resident path.")).toBeTruthy();
    expect(within(other).getByRole("link", { name: /Offer your gifts/ }).getAttribute("href")).toBe("/work-with-us");
    expect(within(other).getByText("Volunteer or work-trade: tell us what you would like to give.")).toBeTruthy();
  });
  it("shows the village's own words and link when it wrote them", async () => {
    founding = { ...founding, otherWays: { seeder: { title: "Join the Friends", line: "Come close first.", href: "/friends" }, gifts: { title: "Give a day", line: "Saturdays in the garden.", href: "/work-with-us" } } };
    renderRoles();
    await screen.findByRole("region", { name: "Join the founding team" });
    const other = screen.getByRole("region", { name: "Other ways to join" });
    expect(within(other).getByRole("link", { name: /Join the Friends/ }).getAttribute("href")).toBe("/friends");
    expect(within(other).getByText("Saturdays in the garden.")).toBeTruthy();
    expect(within(other).queryByText(/Become a Founding Seeder/)).toBeNull();
  });
});

describe("QA2-02: no second step one under the founding team", () => {
  it("puts the roots inside Other ways to join, under Find your place in the game, with no Step one", async () => {
    renderRoles();
    await screen.findByRole("region", { name: "Join the founding team" });
    const other = screen.getByRole("region", { name: "Other ways to join" });
    expect(within(other).getByRole("heading", { name: "Find your place in the game" })).toBeTruthy();
    const roots = document.querySelector("[data-archetype-step]") as HTMLElement;
    expect(roots.getAttribute("data-archetype-step")).toBe("nested");
    expect(other.contains(roots)).toBe(true);
    expect(document.body.textContent).not.toMatch(/Step one/i);
  });
  it("keeps Step one as the page's first step while the founding team is off (control)", async () => {
    founding = { on: false, roleIds: [], sections: {}, showPayRanges: false, villagePay: VILLAGE_PAY };
    renderRoles();
    await screen.findByRole("link", { name: /Browse the open roles/ });
    const roots = document.querySelector("[data-archetype-step]") as HTMLElement;
    expect(roots.getAttribute("data-archetype-step")).toBe("step");
    expect(screen.getByRole("region", { name: "Other ways to join" }).contains(roots)).toBe(false);
    expect(screen.queryByRole("heading", { name: "Find your place in the game" })).toBeNull();
  });
});

describe("design pass M1: the founding team leads the page", () => {
  it("opens on the founding team as the page's h1, then Other ways to join, with the page's own header below them", async () => {
    renderRoles();
    const h1 = await screen.findByRole("heading", { level: 1, name: "Join the founding team" });
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    // Nothing of the game sits between the founding section and Other ways to join.
    expect(h1.closest("[data-founding-team]")?.nextElementSibling?.matches("[data-other-ways]")).toBe(true);
    const other = screen.getByRole("region", { name: "Other ways to join" });
    const header = await screen.findByRole("heading", { level: 2, name: "Roles and Circles" });
    expect(other.compareDocumentPosition(header) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
  it("keeps the page's own header first while the founding team is off (control)", async () => {
    founding = { on: false, roleIds: [], sections: {}, showPayRanges: false, villagePay: VILLAGE_PAY };
    renderRoles();
    const h1 = await screen.findByRole("heading", { level: 1, name: "Roles and Circles" });
    const other = screen.getByRole("region", { name: "Other ways to join" });
    expect(h1.compareDocumentPosition(other) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe("design pass D-03: the offer rail on the founding card", () => {
  const open = async () => {
    renderRoles();
    const section = await screen.findByRole("region", { name: "Join the founding team" });
    fireEvent.click(within(section).getByRole("button", { name: /Lead Finance Steward/ }));
    return waitFor(() => {
      const el = section.querySelector('[data-testid="offer-rail"]') as HTMLElement | null;
      if (!el) throw new Error("no rail yet");
      return el;
    });
  };
  it("holds the ceiling, the shares as tiles, the split line and the commitment together", async () => {
    org.roles[0] = seat("finance", "Lead Finance Steward", { card: { ...seat("x", "x").card, commitmentPct: 100 } });
    const rail = await open();
    await waitFor(() => expect(within(rail).getByTestId("pay-ceiling").textContent).toBe("Total compensation up to $9,000 a month"));
    expect(Array.from(within(rail).getByTestId("pay-tiles").querySelectorAll("li")).map((li) => li.textContent)).toEqual(["cash40%", "equity55%", "village credits5%"]);
    expect(within(rail).getByTestId("pay-split").textContent).toContain("To be decided in the onboarding process.");
    expect(rail.textContent).toContain("100%");
  });
  it("shows only the split when no ceiling is written", async () => {
    roleCard = (id: string) => ({ roleId: id, sections: { ...SECTIONS, payCeiling: null }, lastEdited: null, showPayRanges: false, villagePay: VILLAGE_PAY, mayEdit: false });
    const rail = await open();
    await waitFor(() => expect(within(rail).getByTestId("pay-split")).toBeTruthy());
    expect(within(rail).queryByTestId("pay-ceiling")).toBeNull();
  });
});

describe("verify 2.2: the admin view", () => {
  it("a steward sees what a visitor sees, and the unlisted roles behind one switch", async () => {
    founding = { on: false, roleIds: [], sections: {}, showPayRanges: false, villagePay: VILLAGE_PAY };
    org.roles = [seat("finance", "Lead Finance Steward"), seat("ai-secretary", "AI Secretary", { listed: false }), seat("old", "Old Role", { listed: false })];
    renderRoles();
    fireEvent.click(await screen.findByRole("button", { name: "See all roles" }));
    await screen.findByRole("heading", { level: 3, name: "Lead Finance Steward" });
    expect(screen.queryByRole("heading", { level: 3, name: "AI Secretary" })).toBeNull();
    fireEvent.click(screen.getByRole("checkbox", { name: /Show the 2 roles visitors do not see/ }));
    expect(await screen.findByRole("heading", { level: 3, name: "AI Secretary" })).toBeTruthy();
  });

  it("a visitor has no switch, because the server sends no unlisted role (control)", async () => {
    founding = { on: false, roleIds: [], sections: {}, showPayRanges: false, villagePay: VILLAGE_PAY };
    renderRoles();
    fireEvent.click(await screen.findByRole("button", { name: "See all roles" }));
    await screen.findByRole("heading", { level: 3, name: "Lead Finance Steward" });
    expect(screen.queryByRole("checkbox", { name: /roles visitors do not see/ })).toBeNull();
  });
});
