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
vi.mock("@/hooks/useVillageName", () => ({ useVillageName: () => "Hollow Oak" }));
// The full card is its own component with its own tests; here it only has to open.
vi.mock("@/components/power/SeatTradingCard", () => ({ default: ({ input }: { input: { name: string } }) => <article data-testid="full-card">{input.name}</article> }));

// The season is one cached read in the app; each test says what it holds.
const seasonRef = vi.hoisted(() => ({ value: null as unknown }));
vi.mock("@/lib/gameApi", async (orig) => ({ ...(await orig<typeof import("@/lib/gameApi")>()), useSeason: () => seasonRef.value }));

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

const OPEN_FORM = { open: true, roles: ORG.roles.map((r) => ({ id: r.id, name: r.name })) };

function serve(over: { org?: unknown; places?: unknown; form?: unknown; season?: unknown } = {}) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const u = String(url);
      const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
      if (u.includes("/api/archetypes")) return json(CAST);
      if (u.includes("/api/org")) return json(over.org ?? ORG);
      if (u.includes("/api/open-proposals/form")) return json(over.form ?? OPEN_FORM);
      if (u.includes("/api/place-registry")) return over.places ? json(over.places) : json({ error: "not here" }, 404);
      if (u.includes("/api/season")) return json(over.season ?? { current: null, upcoming: null, seasons: [] });
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
  seasonRef.value = null;
  vi.unstubAllGlobals();
});

describe("the board, read live", () => {
  it("lists every open role from the chart, with its circle and only the stats it has written", async () => {
    serve();
    render(<RoleDraft />);
    expect(await screen.findByRole("heading", { level: 3, name: "Lead Financial Steward" })).toBeTruthy();
    expect(screen.queryByRole("heading", { level: 3, name: "Water Keeper" })).toBeNull();
    const lfs = card("Lead Financial Steward");
    expect(within(lfs).getByText("Anchor Circle")).toBeTruthy();
    expect(within(lfs).getByText("Roughly 25 to 30 hours a week")).toBeTruthy();
    // A role that wrote no hours shows the village's estimate, never a blank (Rye, 9 Nov).
    expect(within(card("Cook")).getByText("~20 h half time, ~30 to 40 h full time")).toBeTruthy();
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
    fireEvent.click(within(card("Gardener")).getByRole("button", { name: "Full card for Gardener" }));
    expect(screen.getByTestId("full-card").textContent).toBe("Gardener");
  });

  it("says plainly when the chart cannot be read", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 500 })));
    render(<RoleDraft />);
    expect(await screen.findByText(/could not load the open roles/i)).toBeTruthy();
  });
});

describe("the draft", () => {
  it("selects up to three in order, keeps them in this browser, and applies with all of them", async () => {
    serve();
    render(<RoleDraft />);
    await screen.findByRole("heading", { level: 3, name: "Gardener" });
    for (const n of ["Lead Financial Steward", "Gardener", "Welcome Host"]) fireEvent.click(within(card(n)).getByRole("button", { name: `Select ${n}` }));
    // A fourth is refused out loud, never by a silent disabled button.
    const cook = within(card("Cook")).getByRole("button", { name: "Select Cook" });
    expect(cook.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(cook);
    expect(screen.getByText("Your selection holds three. Take one off to select another.")).toBeTruthy();

    const tray = screen.getByRole("complementary", { name: "Your selection" });
    expect(within(tray).getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      expect.stringContaining("Lead Financial Steward"),
      expect.stringContaining("Gardener"),
      expect.stringContaining("Welcome Host"),
    ]);
    const apply = within(tray).getByRole("link", { name: /Apply with my 3 picks/ });
    expect(apply.getAttribute("href")).toBe("/propose-a-role?role=lfs&role=garden&role=host");
    expect(JSON.parse(localStorage.getItem(ROLE_DRAFT_KEY) ?? "{}")).toEqual({ chars: [], picks: ["lfs", "garden", "host"] });

    // Taking one off frees a place.
    fireEvent.click(within(tray).getByRole("button", { name: "Remove Gardener from your selection" }));
    expect(cook.getAttribute("aria-disabled")).toBe("false");
  });

  it("comes back as it was left, dropping any role that is no longer open", async () => {
    localStorage.setItem(ROLE_DRAFT_KEY, JSON.stringify({ chars: ["catalyzing"], picks: ["held", "lfs"] }));
    serve();
    render(<RoleDraft />);
    const tray = await screen.findByRole("complementary", { name: "Your selection" });
    await waitFor(() => expect(within(tray).getAllByRole("listitem")).toHaveLength(1));
    expect(within(tray).getByText("Lead Financial Steward")).toBeTruthy();
    expect(screen.getByRole("button", { name: /The Catalyst/ }).getAttribute("aria-pressed")).toBe("true");
  });

  it("sends a member, told by the chart's terms tier, to one role application with every pick", async () => {
    serve({ org: { ...ORG, roles: ORG.roles.map((r) => ({ ...r, termsOffer: null })) } });
    render(<RoleDraft />);
    await screen.findByRole("heading", { level: 3, name: "Gardener" });
    fireEvent.click(within(card("Gardener")).getByRole("button", { name: "Select Gardener" }));
    fireEvent.click(within(card("Cook")).getByRole("button", { name: "Select Cook" }));
    const tray = screen.getByRole("complementary", { name: "Your selection" });
    expect(within(tray).getByRole("link", { name: /Apply for these 2 roles/ }).getAttribute("href")).toBe("/propose?type=role_application&seat=garden&seat=cook");
  });

  it("offers no Apply to a visitor while applications are closed, and keeps the selection", async () => {
    serve({ form: { open: false, message: "This page isn't taking proposals right now." } });
    render(<RoleDraft />);
    await screen.findByRole("heading", { level: 3, name: "Gardener" });
    fireEvent.click(within(card("Gardener")).getByRole("button", { name: "Select Gardener" }));
    const tray = screen.getByRole("complementary", { name: "Your selection" });
    expect(within(tray).queryByRole("link", { name: /Apply/ })).toBeNull();
    expect(within(tray).getByText("This page isn't taking proposals right now.")).toBeTruthy();
  });

  it("shows a visitor only the roles the application form would take", async () => {
    serve({ form: { open: true, roles: [{ id: "lfs" }, { id: "cook" }] } });
    render(<RoleDraft />);
    await screen.findByRole("heading", { level: 3, name: "Cook" });
    expect(screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent).sort()).toEqual(["Cook", "Lead Financial Steward"]);
  });

  it("says so when the chart sends no character tags, instead of claiming nothing fits", async () => {
    serve({ org: { ...ORG, roles: ORG.roles.map((r) => ({ ...r, archetypes: [] })) } });
    render(<RoleDraft />);
    expect(await screen.findByText(/has not tagged its roles by character for visitors yet/)).toBeTruthy();
    expect(screen.queryByText(/open roles? fits?/)).toBeNull();
  });
});

describe("what happens next", () => {
  it("walks a visitor through the steps in Rye's order: the Love Letter at application, then confirm, conversations, consent, invitation, NDA", async () => {
    serve();
    render(<RoleDraft />);
    const steps = await screen.findByRole("list", { name: "After you apply" });
    const items = within(steps).getAllByRole("listitem").map((li) => li.textContent ?? "");
    // Rye's answer 8 (9 Nov): membership is aligned with at application.
    expect(items[0]).toMatch(/Love Letter.*when you apply/);
    expect(items[1]).toMatch(/confirm/i);
    expect(items.some((t) => /Love Letter/.test(t))).toBe(true);
    // Rye, 9 Nov: the NDA comes after approval, before any confidential record.
    const nda = items.findIndex((t) => /NDA/.test(t));
    const invite = items.findIndex((t) => /invitation/.test(t));
    expect(nda).toBeGreaterThan(invite);
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

describe("the season's goals, the first step", () => {
  it("opens with the season's name, dates and every goal from Admin, the done ones marked", async () => {
    seasonRef.value = { current: { name: "Season of Foundations", startsOn: "2026-09-22", endsOn: "2026-12-21", goals: [{ text: "Investor ready", done: false }, { text: "Old goal", done: true }] }, upcoming: null, seasons: [] };
    serve();
    render(<RoleDraft />);
    expect(await screen.findByRole("heading", { name: "This season's goals: Season of Foundations" })).toBeTruthy();
    expect(screen.getByText("22 September 2026 to 21 December 2026")).toBeTruthy();
    expect(screen.getByText("Investor ready")).toBeTruthy();
    expect(screen.getByText("Old goal")).toBeTruthy();
    expect(screen.getByText("Done")).toBeTruthy();
    const steps = screen.getAllByRole("listitem").map((li) => li.textContent ?? "").filter((x) => /goals$|Apply$/.test(x));
    expect(steps[0]).toMatch(/This season's goals/);
    expect(screen.getByText(/what you would like to contribute each moon and this season/)).toBeTruthy();
  });
});

describe("a village whose proposals are for this moon", () => {
  it("says the role runs to the next new moon, by its day", async () => {
    serve({ form: { ...OPEN_FORM, term: { kind: "moon", startsOn: "2026-11-09", endsOn: "2026-12-08" } } });
    render(<RoleDraft />);
    expect(await screen.findByText(/Your role runs from adoption to the next new moon, 8 December 2026/)).toBeTruthy();
  });
});
