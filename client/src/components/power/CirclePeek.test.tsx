// @vitest-environment jsdom
/**
 * The peek a phone shows after stepping into a circle, and the sheet it opens.
 *
 * Rye's ruling, 2026-09-21: "peek, expand on tap". Stepping in used to open the
 * whole card over the map; now a bar names the circle and the card waits to be
 * asked for. These pin the promises that ruling makes: the bar says where you
 * are and what is inside, a tap OR a swipe up opens the card, the arrow steps
 * out and nothing else, and the sheet hands focus back when it closes.
 *
 * The contrast half of this change (the sheet was a white panel under the
 * lens's light ink, 1.36:1 measured live) is a rendered colour, which jsdom
 * does not compute. It is measured in a real browser by
 * scratchpad/verify-phone-map.mjs, not asserted here.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import CirclePeek, { PEEK_SWIPE_PX, peekSummary } from "./CirclePeek";
import SeatSheet from "./SeatSheet";
import type { PowerCircle, PowerData, PowerSeat } from "./types";

afterEach(cleanup);

const seat = (id: string, circleId: string, seats: number, holderCount: number): PowerSeat =>
  ({ id, name: id, description: "", circleId, seats, holderCount }) as unknown as PowerSeat;

const DEV: PowerCircle = { id: "dev", name: "Development Circle", parentCircleId: "root", color: null };
const DATA = {
  circles: [
    { id: "root", name: "Coordinating Circle", parentCircleId: null },
    DEV,
    { id: "arch", name: "Architecture Circle", parentCircleId: "dev" },
    { id: "farm", name: "Regen Ag Circle", parentCircleId: "dev" },
  ],
  roles: [seat("lead", "dev", 1, 1), seat("steward", "dev", 2, 0), seat("elsewhere", "root", 1, 1)],
} as unknown as PowerData;

function peek(overrides: Partial<Parameters<typeof CirclePeek>[0]> = {}) {
  const onOut = vi.fn();
  const onExpand = vi.fn();
  render(<CirclePeek circle={DEV} data={DATA} outTo="Coordinating Circle" onOut={onOut} onExpand={onExpand} {...overrides} />);
  return { onOut, onExpand };
}

describe("the circle peek", () => {
  it("says which circle you are in and what it holds", () => {
    peek();
    const region = screen.getByRole("region", { name: "The circle you are in" });
    expect(region.textContent).toContain("Development Circle");
    // Two circles inside it, and one of three seats held: only its OWN seats.
    expect(region.textContent).toContain("2 circles inside · 1 of 3 seats held");
  });

  it("counts a circle with nothing inside and no seats in plain words", () => {
    const empty = { circles: [DEV], roles: [] } as unknown as PowerData;
    expect(peekSummary(DEV, empty)).toBe("No seats yet");
    expect(peekSummary({ ...DEV, id: "root" }, DATA)).toBe("1 circle inside · 1 of 1 seat held");
  });

  it("opens the card on a tap", () => {
    const { onExpand, onOut } = peek();
    fireEvent.click(screen.getByRole("button", { name: /Details/ }));
    expect(onExpand).toHaveBeenCalledTimes(1);
    expect(onOut).not.toHaveBeenCalled();
  });

  it("opens the card on a swipe up, and not on a nudge", () => {
    const { onExpand } = peek();
    const bar = screen.getByRole("region", { name: "The circle you are in" });
    fireEvent.pointerDown(bar, { clientY: 700 });
    fireEvent.pointerMove(bar, { clientY: 700 - (PEEK_SWIPE_PX - 4) });
    expect(onExpand).not.toHaveBeenCalled();
    fireEvent.pointerMove(bar, { clientY: 700 - (PEEK_SWIPE_PX + 6) });
    expect(onExpand).toHaveBeenCalledTimes(1);
    // One swipe is one ask: travelling further does not ask again.
    fireEvent.pointerMove(bar, { clientY: 600 });
    expect(onExpand).toHaveBeenCalledTimes(1);
  });

  it("a swipe down, or a swipe that has ended, asks for nothing", () => {
    const { onExpand } = peek();
    const bar = screen.getByRole("region", { name: "The circle you are in" });
    fireEvent.pointerDown(bar, { clientY: 700 });
    fireEvent.pointerMove(bar, { clientY: 760 });
    fireEvent.pointerUp(bar, { clientY: 760 });
    fireEvent.pointerMove(bar, { clientY: 600 });
    expect(onExpand).not.toHaveBeenCalled();
  });

  it("steps out with the arrow, named for where it leads", () => {
    const { onOut, onExpand } = peek();
    fireEvent.click(screen.getByRole("button", { name: "Step out to Coordinating Circle" }));
    expect(onOut).toHaveBeenCalledTimes(1);
    expect(onExpand).not.toHaveBeenCalled();
  });

  it("a thumb that starts on the arrow and drags up does not open the card", () => {
    const { onExpand } = peek();
    const arrow = screen.getByRole("button", { name: "Step out to Coordinating Circle" });
    fireEvent.pointerDown(arrow, { clientY: 700 });
    fireEvent.pointerMove(arrow, { clientY: 600 });
    expect(onExpand).not.toHaveBeenCalled();
  });
});

describe("the sheet the peek opens", () => {
  it("is a dialog named for what it shows, and closes on Escape, the backdrop and the button", () => {
    const onClose = vi.fn();
    render(
      <SeatSheet label="Development Circle" onClose={onClose}>
        <p>inside</p>
      </SeatSheet>,
    );
    const dialog = screen.getByRole("dialog", { name: "Development Circle" });
    fireEvent.click(screen.getByText("inside"));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(dialog, { key: "Escape" });
    fireEvent.click(dialog.parentElement!);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it("takes focus when it opens and hands it back when it closes", () => {
    render(<button type="button">Details</button>);
    const opener = screen.getByRole("button", { name: "Details" });
    opener.focus();
    const sheet = render(
      <SeatSheet label="Development Circle" onClose={() => {}}>
        <p>inside</p>
      </SeatSheet>,
    );
    expect(document.activeElement).toBe(screen.getByRole("dialog"));
    sheet.unmount();
    expect(document.activeElement).toBe(opener);
  });
});
