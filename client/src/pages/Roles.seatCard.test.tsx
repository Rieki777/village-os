// @vitest-environment jsdom
/**
 * /roles: THE ROW HEADER AND THE ROLE CARD UNDER IT.
 *
 * Nothing rendered this page in a test before. Three promises are held here:
 *
 *   1. THE HEADER SAYS THE SEAT'S STATE IN THE CARD'S WORDS. A seat whose term
 *      reached its date used to fall through `normalizeStatus` and read "Open
 *      Role", which told a reader the place was free when it was waiting to be
 *      re-chosen. Now the header and the card read one map (`STATE_WORDS`).
 *   2. OPENING A ROW SHOWS THE CARD, with the seat's history, its needs and
 *      the vendor drawer still below it, outside the night card.
 *   3. THE ONE DOOR IS A RAISED HAND, and only while the map module is on for
 *      this reader, because the route lives under `/api/map` behind that
 *      module. The contact relay is the map's alone and never appears here.
 *
 * Every absence has a known-positive control beside it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { Router } from "wouter";
import type { ReactNode } from "react";
import { seatSheet } from "@shared/roleSheet";
import { fromMapSeat } from "@shared/roleSheetInputs";

const session = vi.hoisted(() => ({ token: null as string | null, user: null as null | { id: string; role?: string } }));
const catalog = vi.hoisted(() => ({ modules: [] as Array<{ id: string; name: string; lifecycle: string }> }));

vi.mock("@/components/Layout", () => ({
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("@/components/SeatClaimCard", () => ({ default: () => null }));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: session.user, token: session.token, loading: false }),
  useIsAdmin: () => session.user?.role === "admin" || session.user?.role === "founder",
}));
vi.mock("@/lib/gameApi", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  authToken: () => session.token,
}));
// The catalog by its real rule (`moduleIsOn`, for a catalog that loaded): a
// module is on when the viewer's manifest lists it with a lifecycle past off.
vi.mock("@/modules/ModuleProvider", () => ({
  useModule: (id: string) => catalog.modules.find((m) => m.id === id),
  useModuleOn: (id: string) => catalog.modules.some((m) => m.id === id && m.lifecycle !== "off"),
}));
vi.mock("@/components/natural/useReducedMotion", () => ({
  useReducedMotion: () => true,
  prefersReducedMotion: () => true,
}));

import Roles from "./Roles";

class NoopIntersectionObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}

const MAP_ON = { id: "map", name: "Village map", lifecycle: "members" };
const VENDOR_ON = { id: "saberra", name: "Fieldnotes", lifecycle: "members" };

/** `/api/org` at the member tier, in the shape the seat projection serves. */
const ORG = {
  people: { visible: true, membersOnly: false, signedIn: true },
  village: { decidesBy: "consent" },
  circles: [{ id: "land", name: "Land & Water", purpose: "The ground and its water", decidesBy: null, color: "sage", status: "active" }],
  roles: [
    {
      id: "water-keeper",
      name: "Water Keeper",
      circleId: "land",
      aim: "Keep the village's water clean.",
      domain: "The tanks and the greywater lines",
      accountabilities: ["Testing the spring monthly"],
      whyItMatters: "A village that loses its water loses a season.",
      seats: 1,
      holderCount: 1,
      state: "expired",
      stateSource: "derived",
      criticality: "normal",
      recruiting: false,
      representsCircle: false,
      howChosen: null,
      howChosenGloss: null,
      termEnds: "2026-09-01T12:00:00.000Z",
      archetypes: [],
      isExample: false,
      holders: [{ userId: "u-mara", name: "Mara", kind: "member", focus: null, lapsed: true, isAgent: false, note: null }],
    },
    {
      id: "seed-keeper",
      name: "Seed Keeper",
      circleId: "land",
      aim: "Keep the seed library alive.",
      domain: null,
      accountabilities: [],
      whyItMatters: null,
      seats: 2,
      holderCount: 1,
      state: "partial",
      stateSource: "derived",
      criticality: "normal",
      recruiting: false,
      representsCircle: false,
      howChosen: null,
      howChosenGloss: null,
      termEnds: "2027-02-01T12:00:00.000Z",
      archetypes: [],
      isExample: false,
      // A member with an account: the map would offer to reach her.
      holders: [{ userId: "u-ines", name: "Ines", kind: "member", focus: null, lapsed: false, isAgent: false, note: null }],
    },
  ],
};

const asked: Array<{ url: string; method: string; body: unknown }> = [];

beforeEach(() => {
  asked.length = 0;
  session.token = "a-token";
  session.user = { id: "u-me" };
  catalog.modules = [MAP_ON];
  vi.stubGlobal("IntersectionObserver", NoopIntersectionObserver);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: unknown, init?: RequestInit) => {
      const u = String(url);
      asked.push({ url: u, method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : null });
      const reply = (body: unknown, status = 200) => ({ ok: status < 300, status, json: async () => body });
      if (u === "/api/org") return reply(ORG);
      if (u === "/api/season") return reply({ current: { name: "Season of Foundations", endsOn: "2099-03-21" }, daysLeft: 171 });
      if (u === "/api/archetypes") return reply([]);
      if (u.endsWith("/needs")) return reply({ needs: [] });
      if (u.includes("/raise-hand")) return reply({ success: true });
      return reply([]);
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
});

function renderRoles() {
  return render(
    <Router>
      <Roles />
    </Router>,
  );
}

const header = async (name: string) => (await screen.findByRole("heading", { level: 3, name })).closest("button")!;

describe("the /roles row header", () => {
  it("says a seat whose term reached its date is ready to be re-chosen, never an open role", async () => {
    renderRoles();
    const expired = await header("Water Keeper");
    expect(within(expired).getByText("Ready to be re-chosen")).toBeTruthy();
    // Known positive: the neighbour's header draws its own state the same way.
    expect(within(await header("Seed Keeper")).getByText("Partly held")).toBeTruthy();
    expect(screen.queryByText(/Open Role/)).toBeNull();
    expect(expired.getAttribute("aria-expanded")).toBe("false");
  });
});

describe("an agent on /roles", () => {
  it("reads An agent in the row header, as the card under it does, and never the vendor's name its member row carries", async () => {
    const VENDOR = "Fieldnotes Assistant";
    const withAgent = {
      ...ORG.roles[1],
      holders: [
        ...ORG.roles[1].holders,
        { userId: null, name: VENDOR, kind: "documented", focus: null, lapsed: false, isAgent: true, note: null },
      ],
      holderCount: 2,
      state: "filled",
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: unknown) => {
        const body = String(url) === "/api/org" ? { ...ORG, roles: [withAgent] } : [];
        return { ok: true, status: 200, json: async () => body };
      }),
    );
    renderRoles();
    const row = await header("Seed Keeper");
    // Control: the vendor's name is in what the route served.
    expect(JSON.stringify(withAgent)).toContain(VENDOR);
    expect(row.textContent).toContain("Ines, An agent");
    fireEvent.click(row);
    const card = document.querySelector("article[data-power-card]") as HTMLElement;
    expect(within(card).getByText("An agent")).toBeTruthy();
    expect(document.body.textContent).not.toContain(VENDOR);
  });
});

describe("an opened /roles row", () => {
  it("shows the role card, named by its header, with the history, the needs and the vendor drawer below it", async () => {
    catalog.modules = [MAP_ON, VENDOR_ON];
    renderRoles();
    const row = await header("Water Keeper");
    // Closed: no card yet. The control is the open state below.
    expect(document.querySelector("article[data-power-card]")).toBeNull();
    fireEvent.click(row);
    expect(row.getAttribute("aria-expanded")).toBe("true");

    const card = document.querySelector("article[data-power-card]") as HTMLElement;
    expect(card).toBeTruthy();
    expect(card.getAttribute("aria-labelledby")).toBe(row.id);
    // Embedded: the header already names the seat and says its state, so the
    // card draws neither a second heading nor the badge.
    expect(within(card).queryByRole("heading", { level: 3 })).toBeNull();
    expect(within(card).queryByText("Ready to be re-chosen")).toBeNull();
    expect(card.querySelector('svg[viewBox="-10 -10 20 20"]')).toBeNull();
    // The card's own content: the roster, the holder ready to be re-chosen, the line that says so.
    expect(within(card).getByText("Holding it now")).toBeTruthy();
    expect(within(card).getByText("Mara")).toBeTruthy();
    expect(within(card).getByText("Everyone seated here is ready to be re-chosen.")).toBeTruthy();

    await waitFor(() => expect(asked.some((a) => a.url === "/api/org/roles/water-keeper/history")).toBe(true));
    expect(asked.some((a) => a.url === "/api/org/roles/water-keeper/needs")).toBe(true);
    // #391's drawer still sits under the card, outside it, in the service's own name.
    const vendor = await screen.findByRole("button", { name: "See what Fieldnotes holds" });
    expect(card.contains(vendor)).toBe(false);
  });
});

describe("the door a /roles card opens", () => {
  it("offers a raised hand while the map module is on, and posts it to the map's own route", async () => {
    renderRoles();
    fireEvent.click(await header("Seed Keeper"));
    const raise = await screen.findByRole("button", { name: "Raise your hand for Seed Keeper" });
    fireEvent.click(raise);
    fireEvent.click(await screen.findByRole("button", { name: "Raise my hand" }));
    await waitFor(() =>
      expect(asked.find((a) => a.method === "POST")?.url).toBe("/api/map/roles/seed-keeper/raise-hand"),
    );
    // Said twice on purpose: on the line under the door, and once in the card's polite live region.
    expect(await screen.findAllByText("Hand raised. The founding team will be in touch.")).toHaveLength(2);
  });

  it("never offers the contact relay, even on a full seat whose holder the map would offer it for", async () => {
    const full = { ...ORG.roles[1], seats: 1, state: "filled" };
    // Known positive first: the same row, read the way the MAP reads it, does
    // offer to reach Ines. So the absence below is this page's rule and not
    // a fixture with nobody reachable in it.
    const mapView = seatSheet(
      fromMapSeat({ ...full, description: full.aim }, { circles: ORG.circles, viewer: { viewPeople: true } }, { signedIn: true }),
      { now: new Date(), season: null, classNames: null },
    );
    expect(mapView.action).toMatchObject({ kind: "contact", contactName: "Ines" });

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: unknown) => {
        const body = String(url) === "/api/org" ? { ...ORG, roles: [full] } : [];
        return { ok: true, status: 200, json: async () => body };
      }),
    );
    renderRoles();
    fireEvent.click(await header("Seed Keeper"));
    const card = document.querySelector("article[data-power-card]") as HTMLElement;
    expect(within(card).getByText("Ines")).toBeTruthy();
    expect(within(card).queryByRole("button", { name: /^Contact/ })).toBeNull();
    expect(within(card).queryByRole("button", { name: /Raise your hand/ })).toBeNull();
    // Nor the map's note about a holder the map cannot reach yet.
    expect(within(card).queryByText("Held, and not reachable through the map yet.")).toBeNull();
  });

  it("offers no hand while the map module is off for this reader", async () => {
    catalog.modules = [];
    renderRoles();
    fireEvent.click(await header("Seed Keeper"));
    const card = document.querySelector("article[data-power-card]") as HTMLElement;
    // The card itself rendered (known positive), and it has no door.
    expect(within(card).getByText("Holding it now")).toBeTruthy();
    expect(within(card).queryByRole("button", { name: /Raise your hand/ })).toBeNull();
    expect(within(card).queryByRole("link", { name: /Sign in to raise your hand/ })).toBeNull();
  });

  it("asks a signed-out reader to sign in first, back to this page", async () => {
    session.token = null;
    session.user = null;
    // A stranger's catalog lists the map only while it is public.
    catalog.modules = [{ ...MAP_ON, lifecycle: "public" }];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: unknown) => {
        const u = String(url);
        const body =
          u === "/api/org"
            ? { ...ORG, people: { visible: false, membersOnly: false, signedIn: false }, roles: ORG.roles.map((r) => ({ ...r, holders: [] })) }
            : [];
        return { ok: true, status: 200, json: async () => body };
      }),
    );
    renderRoles();
    fireEvent.click(await header("Seed Keeper"));
    const link = await screen.findByRole("link", { name: /Sign in to raise your hand/ });
    expect(link.getAttribute("href")).toMatch(/^\/login\?next=/);
    expect(screen.queryByRole("button", { name: /Raise your hand/ })).toBeNull();
  });
});
