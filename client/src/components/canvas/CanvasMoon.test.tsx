// @vitest-environment jsdom
/**
 * The canvas moon card (plan 4.4; Wave 4): the next new moon's block titles,
 * and the offer of a draft gathering to whoever manages the calendar.
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { CanvasMoonPayload } from "@shared/canvasRevisit";
import { CanvasMoon } from "./CanvasMoon";

const payload = (over: Partial<CanvasMoonPayload> = {}): CanvasMoonPayload => ({
  next: {
    newMoonAt: "2026-10-10T03:50:00.000Z",
    startsAt: "2026-10-10T18:00:00.000Z",
    moon: 331,
    blocks: [
      { id: "stakeholders", name: "Stakeholders" },
      { id: "power", name: "Power" },
    ],
    source: { chosen: ["power"], flagged: ["stakeholders"], rotated: null },
  },
  gathering: null,
  calendarOn: true,
  mayOffer: false,
  ...over,
});

describe("the canvas moon card", () => {
  it("names the next moon's blocks by title and links each one down to its card", () => {
    render(<CanvasMoon payload={payload()} onOffer={vi.fn()} />);
    expect(screen.getByText("The canvas moon looks at Stakeholders and Power.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Stakeholders" }).getAttribute("href")).toBe("#canvas-block-stakeholders");
    expect(screen.getByRole("link", { name: "Power" }).getAttribute("href")).toBe("#canvas-block-power");
    expect(screen.getByText(/Next new moon:/)).toBeTruthy();
  });

  it("offers nothing to a member who does not manage the calendar", () => {
    render(<CanvasMoon payload={payload()} onOffer={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /offer a canvas moon gathering/i })).toBeNull();
  });

  it("offers the gathering, says it is a draft, and prints the server's sentence once offered", async () => {
    const onOffer = vi.fn(async () => ({ ok: true as const, message: "The canvas moon is on the calendar's list as a draft." }));
    render(<CanvasMoon payload={payload({ mayOffer: true })} onOffer={onOffer} />);
    // Said of whoever pressed: a role can manage events without an admin
    // account, and the Calendar tab is inside the admin pages, so the card
    // names who publishes and where, never "you" and "there".
    const help = screen.getByText(/Nothing is published until/).textContent ?? "";
    expect(help).toContain("somebody who manages events publishes it from the Calendar tab in the admin pages");
    expect(help).not.toMatch(/\byou\b|\bthere\b/);
    fireEvent.click(screen.getByRole("button", { name: /offer a canvas moon gathering/i }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("as a draft"));
    expect(onOffer).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: /offer a canvas moon gathering/i }), "offered once").toBeNull();
  });

  it("prints a refusal in the server's words and keeps the button", async () => {
    const onOffer = vi.fn(async () => ({ ok: false as const, error: "Offering a gathering is for whoever manages the village's calendar." }));
    render(<CanvasMoon payload={payload({ mayOffer: true })} onOffer={onOffer} />);
    fireEvent.click(screen.getByRole("button", { name: /offer a canvas moon gathering/i }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("manages the village's calendar"));
    expect(screen.getByRole("button", { name: /offer a canvas moon gathering/i })).toBeTruthy();
  });

  it("says where an offered gathering stands", () => {
    const { rerender } = render(<CanvasMoon payload={payload({ gathering: { id: "ev-1", status: "draft" } })} onOffer={vi.fn()} />);
    expect(screen.getByTestId("canvas-moon-gathering").textContent).toContain("as a draft");
    rerender(<CanvasMoon payload={payload({ gathering: { id: "ev-1", status: "scheduled" } })} onOffer={vi.fn()} />);
    expect(screen.getByTestId("canvas-moon-gathering").textContent).toBe("The canvas moon is on the village calendar.");
    rerender(<CanvasMoon payload={payload({ gathering: { id: "ev-1", status: "postponed" } })} onOffer={vi.fn()} />);
    expect(screen.getByTestId("canvas-moon-gathering").textContent).toContain("marked postponed");
    // The server answers a cancelled series as not offered; should one arrive, it is not "on the calendar".
    rerender(<CanvasMoon payload={payload({ gathering: { id: "ev-1", status: "cancelled" } })} onOffer={vi.fn()} />);
    expect(screen.getByTestId("canvas-moon-gathering").textContent).toBe("The canvas moon gathering was cancelled.");
  });

  it("stays off the page with no next moon, or before the read arrives", () => {
    const { container, rerender } = render(<CanvasMoon payload={null} onOffer={vi.fn()} />);
    expect(container.innerHTML).toBe("");
    rerender(<CanvasMoon payload={payload({ next: null })} onOffer={vi.fn()} />);
    expect(container.innerHTML).toBe("");
  });
});
