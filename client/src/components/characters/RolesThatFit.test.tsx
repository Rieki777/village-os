// @vitest-environment jsdom
/**
 * "ROLES THAT FIT THIS CHARACTER": pick the seats, propose them in one go.
 *
 *   - the seats shown are the ones the server's archetype join named (`fits`),
 *     in its order, less any full seat, example or id the chart does not have;
 *   - each card says its circle, its aim and its open places;
 *   - a member who reads terms picks up to five, the sixth box goes still, and
 *     "Propose these" carries every picked seat to the wizard;
 *   - a reader below the member rung reads the cards and the MySeason sentence,
 *     with nothing to tick;
 *   - on the real page, the class's "Open paths" answer feeds the cards.
 */
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

vi.mock("wouter", () => ({
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("@/components/Layout", () => ({ default: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1", name: "Rowan Fell" } }) }));
vi.mock("@/components/characters/PortraitStudio", () => ({ default: () => null }));

const loadOrg = vi.fn();
vi.mock("@/components/governance/pickSources", () => ({ loadOrg: () => loadOrg() }));

import RolesThatFit, { fittingSeats, openPlacesOf, ROLES_FIT_WORDS } from "./RolesThatFit";
import { seatsFromSearch } from "@shared/seatApplyLinks";
import Characters from "@/pages/Characters";

const seat = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  name: `Seat ${id}`,
  circleId: "c-land",
  aim: `Keep ${id} going.`,
  seats: 1,
  holderCount: 0,
  state: "open",
  isExample: false,
  holders: [],
  termsOffer: null,
  ...over,
});
const ORG = {
  circles: [{ id: "c-land", name: "Land circle" }, { id: "c-hearth", name: "Hearth circle" }],
  roles: [
    seat("a", { name: "Orchard keeper", circleId: "c-land", aim: "The orchard is pruned and fed.", seats: 2, holderCount: 1, state: "partial", holders: [{ lapsed: false }] }),
    seat("b", { name: "Hearth host", circleId: "c-hearth", aim: "Every newcomer is fed and met.", seats: 3 }),
    seat("full", { name: "Water warden", state: "filled", holderCount: 1 }),
    seat("ex", { name: "Example seat", isExample: true }),
    seat("c"),
    seat("d"),
    seat("e"),
    seat("f"),
    seat("untagged", { name: "Untagged seat" }),
  ],
};
const FITS = ["b", "a", "full", "ex", "gone", "c", "d", "e", "f"];

beforeEach(() => loadOrg.mockReset());
afterEach(cleanup);

describe("which seats fit", () => {
  it("keeps the server's order and leaves out full seats, examples, unknown ids and seats it did not name", () => {
    const out = fittingSeats(ORG, FITS);
    expect(out.map((s) => s.id)).toEqual(["b", "a", "c", "d", "e", "f"]);
    expect(out[0]).toEqual({ id: "b", name: "Hearth host", circle: "Hearth circle", aim: "Every newcomer is fed and met.", openPlaces: 3 });
    expect(out[1].openPlaces).toBe(1);
  });

  it("counts the places still to fill", () => {
    expect(openPlacesOf({ state: "open", seats: 3 })).toBe(3);
    expect(openPlacesOf({ state: "expired", seats: 2, holderCount: 2 })).toBe(2);
    expect(openPlacesOf({ state: "partial", seats: 4, holderCount: 3, holders: [{ lapsed: true }, {}, {}] })).toBe(2);
    expect(openPlacesOf({ state: "partial", seats: 4, holderCount: 1 })).toBe(3);
  });
});

describe("Roles that fit this character", () => {
  it("draws each fitting seat as a card with its circle, aim and open places", async () => {
    loadOrg.mockResolvedValue(ORG);
    render(<RolesThatFit archetypeName="The Builder" fits={FITS} />);
    await screen.findByText("Hearth host");
    const cards = screen.getAllByRole("listitem");
    expect(cards).toHaveLength(6);
    expect(within(cards[0]).getByText("Hearth circle")).toBeTruthy();
    expect(within(cards[0]).getByText("Every newcomer is fed and met.")).toBeTruthy();
    expect(within(cards[0]).getByText("3 places open")).toBeTruthy();
    expect(within(cards[1]).getByText("1 place open")).toBeTruthy();
    expect(screen.queryByText("Water warden")).toBeNull();
    expect(screen.queryByText("Example seat")).toBeNull();
    expect(screen.queryByText("Untagged seat")).toBeNull();
    expect(screen.getByRole("link", { name: ROLES_FIT_WORDS.every }).getAttribute("href")).toBe("/roles");
    expect(screen.getByText(ROLES_FIT_WORDS.line("The Builder"))).toBeTruthy();
  });

  it("picks up to five, stills the sixth, and proposes every picked seat in one link", async () => {
    loadOrg.mockResolvedValue(ORG);
    render(<RolesThatFit archetypeName="The Builder" fits={FITS} />);
    await screen.findByText("Hearth host");
    expect(screen.queryByRole("link", { name: ROLES_FIT_WORDS.propose })).toBeNull();
    expect(screen.getByText(ROLES_FIT_WORDS.pickFirst)).toBeTruthy();

    for (const name of ["Hearth host", "Orchard keeper", "Seat c", "Seat d", "Seat e"]) {
      fireEvent.click(screen.getByRole("checkbox", { name: ROLES_FIT_WORDS.add(name) }));
    }
    expect(screen.getByText(ROLES_FIT_WORDS.picked(5))).toBeTruthy();
    const sixth = screen.getByRole("checkbox", { name: ROLES_FIT_WORDS.add("Seat f") }) as HTMLInputElement;
    expect(sixth.disabled).toBe(true);
    fireEvent.click(sixth);
    expect(sixth.checked).toBe(false);

    const href = screen.getByRole("link", { name: ROLES_FIT_WORDS.propose }).getAttribute("href") ?? "";
    expect(href.startsWith("/propose?type=role_application&")).toBe(true);
    expect(seatsFromSearch(href.slice(href.indexOf("?")))).toEqual(["b", "a", "c", "d", "e"]);

    // Unticking one frees the sixth.
    fireEvent.click(screen.getByRole("checkbox", { name: ROLES_FIT_WORDS.add("Seat c") }));
    expect(sixth.disabled).toBe(false);
  });

  it("a reader below the member rung reads the cards with nothing to tick", async () => {
    loadOrg.mockResolvedValue({ ...ORG, roles: ORG.roles.map(({ termsOffer: _t, ...r }) => r) });
    render(<RolesThatFit archetypeName="The Builder" fits={FITS} />);
    await screen.findByText("Hearth host");
    expect(screen.getByText(ROLES_FIT_WORDS.membersOnly)).toBeTruthy();
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
    expect(screen.queryByRole("link", { name: ROLES_FIT_WORDS.propose })).toBeNull();
  });

  it("says when nothing fits, and when the chart did not load", async () => {
    loadOrg.mockResolvedValue(ORG);
    render(<RolesThatFit archetypeName="The Builder" fits={["full"]} />);
    await screen.findByText(ROLES_FIT_WORDS.none);
    cleanup();
    loadOrg.mockResolvedValueOnce(null).mockResolvedValueOnce(ORG);
    render(<RolesThatFit archetypeName="The Builder" fits={["b"]} />);
    await screen.findByText(ROLES_FIT_WORDS.failed);
    fireEvent.click(screen.getByRole("button", { name: ROLES_FIT_WORDS.retry }));
    await screen.findByText("Hearth host");
  });
});

describe("on the character page", () => {
  const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
  beforeEach(() => {
    window.history.pushState({}, "", "/profile/characters");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (path: string) => {
        const p = String(path);
        if (p === "/api/archetypes") return ok([{ key: "building", name: "The Builder", subtitle: "Building", blurb: "Makes things.", examples: [] }]);
        if (p.includes("/api/archetypes/building/paths")) return ok({ roles: [{ id: "a", name: "Orchard keeper", recruiting: true, color: null }, { id: "b", name: "Hearth host", recruiting: false, color: null }], questCount: 0 });
        if (p.includes("/api/me/characters")) return ok({ party: [] });
        return ok({});
      }),
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it("feeds the class's open paths into the cards, so the seats shown are the ones tagged for it", async () => {
    loadOrg.mockResolvedValue(ORG);
    render(<Characters />);
    const section = (await screen.findByRole("heading", { name: ROLES_FIT_WORDS.heading })).closest("section")!;
    await waitFor(() => expect(within(section).getAllByRole("checkbox")).toHaveLength(2));
    expect(within(section).getByText("Land circle")).toBeTruthy();
    expect(within(section).queryByText("Seat c")).toBeNull();
  });
});
