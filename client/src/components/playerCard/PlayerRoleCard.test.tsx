// @vitest-environment jsdom
/**
 * The player card drawn for 0, 1 and 6 roles, from the real model.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { PlayerRoleCardView } from "./PlayerRoleCard";
import { FIXTURE_ROLE_TITLE, fixturePayload } from "@/test/playerCardFixture";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const root = () => document.querySelector("[data-player-card]")!;

describe("the player card, live", () => {
  it("with no roles says Holds no roles yet and opens the doors to apply and to plan the season", () => {
    render(<PlayerRoleCardView data={fixturePayload(0)} />);
    expect(screen.getAllByText("Holds no roles yet").length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: "Apply for a role" }).getAttribute("href")).toBe("/roles");
    expect(screen.getByRole("link", { name: "Plan my season" }).getAttribute("href")).toBe("/season-plans/mine");
    expect(document.querySelectorAll("article")).toHaveLength(0);
  });

  it("with one role draws the tile, the role in full with its purpose first, and the handover as a count", () => {
    render(<PlayerRoleCardView data={fixturePayload(1)} />);
    const tile = screen.getByRole("link", { name: new RegExp(FIXTURE_ROLE_TITLE(1)) });
    expect(tile.getAttribute("href")).toBe("#role-r1");
    expect(within(tile).getByText("Within term, to 31 Dec 2026")).toBeTruthy();
    expect(within(tile).getByText("Signs on track")).toBeTruthy();
    const article = document.getElementById("role-r1")!;
    const text = article.textContent ?? "";
    expect(text.indexOf(FIXTURE_ROLE_TITLE(1))).toBeLessThan(text.indexOf("Purpose"));
    expect(text).toContain("2 of 4 ready");
    expect(text).not.toMatch(/\d+%/);
    expect(screen.getByText("Across my role")).toBeTruthy();
  });

  it("links each role's circle to that circle's card", () => {
    render(<PlayerRoleCardView data={fixturePayload(1)} />);
    expect(screen.getByRole("link", { name: "Community Anchor" }).getAttribute("href")).toBe("/circles/c1");
  });

  it("with six roles draws six tiles and six roles in full, in order, and names nobody but the owner", () => {
    render(<PlayerRoleCardView data={fixturePayload(6)} />);
    expect(screen.getByText("Across all 6 roles")).toBeTruthy();
    const articles = Array.from(document.querySelectorAll("article"));
    expect(articles.map((a) => a.id)).toEqual(["role-r1", "role-r2", "role-r3", "role-r4", "role-r5", "role-r6"]);
    const all = root().textContent ?? "";
    expect(all).toContain("Lena Ortiz");
    expect(all).not.toContain("Marco");
    expect(all).not.toMatch(/\bseats?\b/i);
    expect(all).not.toMatch(/[–—]/);
  });

  it("draws the sections in the design's order, with agreements closed at the bottom", () => {
    render(<PlayerRoleCardView data={fixturePayload(1)} />);
    const all = root().textContent ?? "";
    const order = ["My roles", "Across my role", "Purpose", "My moon cycle", "My agreements"].map((s) => all.indexOf(s));
    expect(order.every((n) => n >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    const details = document.querySelector("details")!;
    expect(details.open).toBe(false);
    expect(all).not.toContain("Outside these roles");
  });

  it("opens a sign's sheet on a tap, first names only, in the order it happened", () => {
    render(<PlayerRoleCardView data={fixturePayload(1, "member")} />);
    fireEvent.click(screen.getAllByRole("button", { name: /See what makes up/ })[0]);
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Marco")).toBeTruthy();
    expect(within(dialog).getByText("Answered within 2 business days")).toBeTruthy();
  });

  it("shows the load read as Not set this moon with its caption", () => {
    render(<PlayerRoleCardView data={fixturePayload(1)} />);
    expect(screen.getByText("Not set this moon")).toBeTruthy();
    expect(screen.getByText("My own read, set each moon.")).toBeTruthy();
  });

  it("gives only the owner an Edit my card switch, and in edit mode a role word says it goes to consent", () => {
    render(<PlayerRoleCardView data={fixturePayload(1, "member")} />);
    expect(screen.queryByRole("button", { name: "Edit my card" })).toBeNull();
    cleanup();
    render(<PlayerRoleCardView data={fixturePayload(1)} />);
    expect(screen.queryAllByRole("button", { name: /^Edit:/ })).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Edit my card" }));
    expect(screen.getAllByRole("button", { name: /^Edit:/ }).length).toBeGreaterThan(5);
    expect(screen.getByText("Proposed, waiting for consent")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: `Edit: Purpose, ${FIXTURE_ROLE_TITLE(1)}` }));
    expect(screen.getByText("These words belong to the role, so a change goes to the circle for consent.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Propose this change" })).toBeTruthy();
  });

  it("proposes a role word through the card's route and says it waits for consent", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ success: true, draftId: "d1", key: "decide", review: "/review" }) }));
    vi.stubGlobal("fetch", fetchMock);
    const reload = vi.fn();
    render(<PlayerRoleCardView data={fixturePayload(1)} reload={reload} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit my card" }));
    fireEvent.click(screen.getByRole("button", { name: `Edit: What I decide, ${FIXTURE_ROLE_TITLE(1)}` }));
    fireEvent.change(screen.getByLabelText(`What I decide, ${FIXTURE_ROLE_TITLE(1)}`), { target: { value: "New words." } });
    fireEvent.click(screen.getByRole("button", { name: "Propose this change" }));
    await screen.findAllByText("Proposed, waiting for consent");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/people/me/role-card/roles/r1/propose");
    expect(JSON.parse(String(init.body))).toEqual({ key: "decide", text: "New words." });
    expect(reload).toHaveBeenCalled();
  });

});
