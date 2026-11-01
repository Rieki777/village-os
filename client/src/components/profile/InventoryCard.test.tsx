// @vitest-environment jsdom
/**
 * The inventory card draws what the profile read sent, lists homes once, and
 * moves the switch only when the server saved it.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const gameFetch = vi.fn();
vi.mock("@/lib/gameApi", () => ({ gameFetch: (...args: unknown[]) => gameFetch(...args) }));

import InventoryCard from "./InventoryCard";
import type { Inventory } from "@shared/profileInventory";

const answer = (body: unknown, status = 200) => Promise.resolve({ ok: status >= 200 && status < 300, status, json: async () => body });

const inventory = (over: Partial<Inventory> = {}): Inventory => ({
  loans: [{ id: "l1", item: "Cordless drill", status: "active", dueOn: "2026-11-07" }],
  stays: [{ id: "s1", place: "Casita Two", status: "requested", arriveOn: null }],
  lots: [{ id: "h1", homeType: "tiny-home", structureKey: "pond-homes", standing: "You have asked for this" }],
  ...over,
});

/** Answers the two reads the card makes, by URL. */
const reads = (inv: Inventory | null, showInventory: boolean) =>
  gameFetch.mockImplementation((url: string, init?: RequestInit) => {
    if (init?.method === "PUT") return answer({ privacy: { showInventory: JSON.parse(String(init.body)).showInventory } });
    if (url === "/api/me/privacy") return answer({ privacy: { showInventory } });
    return answer({ inventory: inv });
  });

beforeEach(() => gameFetch.mockReset());

describe("InventoryCard", () => {
  it("lists loans, stays and homes, in the member's words", async () => {
    reads(inventory(), false);
    render(<InventoryCard />);
    expect(await screen.findByText("Cordless drill")).toBeTruthy();
    expect(screen.getByText("Borrowed · due 2026-11-07")).toBeTruthy();
    expect(screen.getByText("Casita Two")).toBeTruthy();
    expect(screen.getByText("Tiny home")).toBeTruthy();
  });

  it("points to the Resident path card for homes, without listing them twice", async () => {
    reads(inventory(), false);
    render(<InventoryCard lotsOnPath />);
    expect(await screen.findByText("The homes you asked about are on your Resident path card.")).toBeTruthy();
    expect(screen.queryByText("Tiny home")).toBeNull();
  });

  it("draws nothing at all when nothing is live", async () => {
    reads(inventory({ loans: [], stays: [], lots: [] }), false);
    const { container } = render(<InventoryCard />);
    await waitFor(() => expect(gameFetch).toHaveBeenCalledTimes(2));
    expect(container.textContent).toBe("");
  });

  it("turns showing it on the public profile on, and holds the switch when the save fails", async () => {
    reads(inventory(), false);
    render(<InventoryCard />);
    const box = (await screen.findByLabelText("Show this on my public profile")) as HTMLInputElement;
    expect(box.checked).toBe(false);
    await userEvent.click(box);
    await waitFor(() => expect(box.checked).toBe(true));
    expect(gameFetch).toHaveBeenCalledWith("/api/me/privacy", expect.objectContaining({ method: "PUT", body: JSON.stringify({ showInventory: true }) }));

    gameFetch.mockImplementationOnce(() => answer({ error: "nope" }, 500));
    await userEvent.click(box);
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(box.checked).toBe(true);
  });
});
