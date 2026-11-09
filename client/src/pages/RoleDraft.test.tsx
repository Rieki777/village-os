// @vitest-environment jsdom
/**
 * THE ROLE DRAFT BOARD (Rye, 9 Nov 2026). Everything on it is read live from
 * the village's own routes, so the canned answers here stand in for
 * `/api/archetypes`, `/api/org` and `/api/place-registry`, and every assertion
 * is about what the page does with whatever they say.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ROLE_DRAFT_KEY } from "@shared/roleDraft";

vi.mock("@/components/Layout", () => ({ default: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
const auth = vi.hoisted(() => ({ user: null as null | { id: string; name: string } }));
vi.mock("@/contexts/AuthContext", () => ({ useOptionalAuth: () => ({ user: auth.user }) }));
vi.mock("@/hooks/useVillageName", () => ({ useVillageName: () => "Hollow Oak" }));
// The full card is its own component with its own tests; here it only has to open.
vi.mock("@/components/power/SeatTradingCard", () => ({ default: ({ input }: { input: { name: string } }) => <article data-testid="full-card">{input.name}</article> }));

import RoleDraft from "./RoleDraft";

const CAST = [
  { key: "building", name: "The Builder", subtitle: "Building & Developing" },
  { key: "catalyzing", name: "The Catalyst", subtitle: "Catalyzing & Connecting" },
  { key: "facilitating", name: "The Spaceholder", subtitle: "Facilitating & Space Holding" },
];
const ORG = {
  people: { visible: true },
  circles: [
    { id: "anchor", name: "Anchor Circle" },
    { id: "land", name: "Land Circle" },
  ],
  roles: [
    { id: "lfs", name: "Lead Financial Steward", circleId: "anchor", seats: 1, holderCount: 0, state: "open", archetypes: ["catalyzing"], timeCommitment: "25 to 30 hours a week", aim: "Money kept true." },
    { id: "garden", name: "Gardener", circleId: "land", seats: 1, holderCount: 0, state: "open", archetypes: ["building"] },
    { id: "host", name: "Welcome Host", circleId: "land", seats: 1, holderCount: 0, state: "open", archetypes: ["facilitating"] },
    { id: "cook", name: "Cook", circleId: "land", seats: 1, holderCount: 0, state: "open", archetypes: [] },
    { id: "held", name: "Water Keeper", circleId: "land", seats: 1, holderCount: 1, state: "filled", archetypes: ["building"] },
  ],
};

function serve(over: { org?: unknown; places?: unknown } = {}) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const u = String(url);
      const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
      if (u.includes("/api/archetypes")) return json(CAST);
      if (u.includes("/api/org")) return json(over.org ?? ORG);
      if (u.includes("/api/place-registry")) return over.places ? json(over.places) : json({ error: "not here" }, 404);
      if (u.includes("/api/season")) return json({ current: null, upcoming: null, seasons: [] });
      return json([]);
    }),
  );
}

const card = (name: string) => screen.getByRole("heading", { level: 3, name }).closest("article") as HTMLElement;

beforeEach(() => {
  try { localStorage.clear(); } catch { /* jsdom */ }
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  auth.user = null;
});

describe("the board, read live", () => {
  it("lists every open role from the chart, with its circle and only the stats it has written", async () => {
    serve();
    render(<RoleDraft />);
    expect(await screen.findByRole("heading", { level: 3, name: "Lead Financial Steward" })).toBeTruthy();
    expect(screen.queryByRole("heading", { level: 3, name: "Water Keeper" })).toBeNull();
    const lfs = card("Lead Financial Steward");
    expect(within(lfs).getByText("Anchor Circle")).toBeTruthy();
    expect(within(lfs).getByText("25 to 30 hours a week")).toBeTruthy();
    // A role that wrote no hours says so; nothing is guessed.
    expect(within(card("Cook")).getByText("Hours not set yet")).toBeTruthy();
  });

  it("offers the village's own cast, and more than one character can be picked", async () => {
    serve();
    render(<RoleDraft />);
    const catalyst = await screen.findByRole("button", { name: /The Catalyst/ });
    const builder = screen.getByRole("button", { name: /The Builder/ });
    fireEvent.click(catalyst);
    fireEvent.click(builder);
    expect(catalyst.getAttribute("aria-pressed")).toBe("true");
    expect(builder.getAttribute("aria-pressed")).toBe("true");
    // Roles that fit a picked character come first and say which.
    const names = screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent);
    expect(names.slice(0, 2).sort()).toEqual(["Gardener", "Lead Financial Steward"]);
    expect(within(card("Lead Financial Steward")).getByText(/Fits The Catalyst/)).toBeTruthy();
  });

  it("filters to the picked characters only when asked, and says when nothing fits", async () => {
    serve();
    render(<RoleDraft />);
    fireEvent.click(await screen.findByRole("button", { name: /The Spaceholder/ }));
    fireEvent.click(screen.getByRole("button", { name: "Only roles that fit" }));
    expect(screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual(["Welcome Host"]);
  });

  it("opens the full card in place", async () => {
    serve();
    render(<RoleDraft />);
    await screen.findByRole("heading", { level: 3, name: "Gardener" });
    fireEvent.click(within(card("Gardener")).getByRole("button", { name: "Open the full card for Gardener" }));
    expect(screen.getByTestId("full-card").textContent).toBe("Gardener");
  });

  it("says plainly when the chart cannot be read", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 500 })));
    render(<RoleDraft />);
    expect(await screen.findByText(/could not load the open roles/i)).toBeTruthy();
  });
});

describe("the draft", () => {
  it("drafts up to three in order, keeps them in this browser, and applies with all of them", async () => {
    serve();
    render(<RoleDraft />);
    await screen.findByRole("heading", { level: 3, name: "Gardener" });
    for (const n of ["Lead Financial Steward", "Gardener", "Welcome Host"]) fireEvent.click(within(card(n)).getByRole("button", { name: `Draft ${n}` }));
    const cook = within(card("Cook")).getByRole("button", { name: "Draft Cook" }) as HTMLButtonElement;
    expect(cook.disabled).toBe(true);

    const tray = screen.getByRole("complementary", { name: "Your draft" });
    expect(within(tray).getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      expect.stringContaining("Lead Financial Steward"),
      expect.stringContaining("Gardener"),
      expect.stringContaining("Welcome Host"),
    ]);
    const apply = within(tray).getByRole("link", { name: /Apply with my 3 picks/ });
    expect(apply.getAttribute("href")).toBe("/propose-a-role?role=lfs&role=garden&role=host");
    expect(JSON.parse(localStorage.getItem(ROLE_DRAFT_KEY) ?? "{}")).toEqual({ chars: [], picks: ["lfs", "garden", "host"] });

    // Taking one off frees a place.
    fireEvent.click(within(tray).getByRole("button", { name: "Remove Gardener from your draft" }));
    expect(cook.disabled).toBe(false);
  });

  it("comes back as it was left, dropping any role that is no longer open", async () => {
    localStorage.setItem(ROLE_DRAFT_KEY, JSON.stringify({ chars: ["catalyzing"], picks: ["held", "lfs"] }));
    serve();
    render(<RoleDraft />);
    const tray = await screen.findByRole("complementary", { name: "Your draft" });
    await waitFor(() => expect(within(tray).getAllByRole("listitem")).toHaveLength(1));
    expect(within(tray).getByText("Lead Financial Steward")).toBeTruthy();
    expect(screen.getByRole("button", { name: /The Catalyst/ }).getAttribute("aria-pressed")).toBe("true");
  });

  it("sends a signed-in member to Propose my roles instead", async () => {
    auth.user = { id: "u1", name: "Ana" };
    serve();
    render(<RoleDraft />);
    await screen.findByRole("heading", { level: 3, name: "Gardener" });
    fireEvent.click(within(card("Gardener")).getByRole("button", { name: "Draft Gardener" }));
    const tray = screen.getByRole("complementary", { name: "Your draft" });
    expect(within(tray).getByRole("link", { name: /Propose my roles/ }).getAttribute("href")).toBe("/role-proposals/new?role=garden&path=quick");
  });
});

describe("what happens next", () => {
  it("walks a visitor through the steps after applying, ending with the Love Letter before seating", async () => {
    serve();
    render(<RoleDraft />);
    const steps = await screen.findByRole("list", { name: "After you apply" });
    const items = within(steps).getAllByRole("listitem").map((li) => li.textContent ?? "");
    expect(items[0]).toMatch(/confirm/i);
    expect(items.some((t) => /Love Letter/.test(t))).toBe(true);
  });

  it("lists places looking for a steward when the registry names them, and links the map otherwise", async () => {
    serve({ places: { places: [{ key: "greenhouse", name: "Greenhouse", invitationOpen: true }, { key: "cafe", name: "Cafe", invitationOpen: false }] } });
    render(<RoleDraft />);
    expect(await screen.findByText("Greenhouse")).toBeTruthy();
    expect(screen.queryByText("Cafe")).toBeNull();
    cleanup();
    serve();
    render(<RoleDraft />);
    expect((await screen.findByRole("link", { name: /Living Map/ })).getAttribute("href")).toBe("/map");
  });
});
