// @vitest-environment jsdom
/**
 * A FULL SEAT IS NOT A FIVE-STEP DEAD END (red team U4).
 *
 * The picker listed every seat alike, so a member could pick a seat whose
 * every place is held, walk the whole wizard, and be refused at the end.
 * Now a full seat is marked and cannot be ticked, unless the member holds it
 * (a renewal), and a full seat already picked by a link or a saved draft is
 * taken off the list at this step, with the member told which.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import SeatPicksField from "./SeatPicksField";

vi.mock("@/components/InfoTip", () => ({ default: () => null }));
vi.mock("@/contexts/AuthContext", () => ({ useOptionalAuth: () => ({ user: { id: "u-ana" } }) }));
vi.mock("./pickSources", () => ({
  loadPickOptions: async () => [
    { value: "seat-open", label: "Open seat" },
    { value: "seat-full", label: "Full seat", full: true, holderIds: ["u-hal"] },
    { value: "seat-mine", label: "My seat", full: true, holderIds: ["u-ana"] },
  ],
}));

afterEach(cleanup);

const FIELD = { key: "seatIds", label: "The seats", kind: "seatPicks", required: true } as any;

describe("picking seats", () => {
  it("marks a full seat and will not tick it, but lets a holder renew their own", async () => {
    render(<SeatPicksField field={FIELD} value={[]} onChange={() => {}} invalid={false} footerNode={null} />);
    const full = (await screen.findByLabelText(/Full seat/)) as HTMLInputElement;
    expect(full.disabled).toBe(true);
    expect(screen.getByText("Full: every place is held")).toBeTruthy();
    expect((screen.getByLabelText(/My seat/) as HTMLInputElement).disabled).toBe(false);
    expect((screen.getByLabelText(/Open seat/) as HTMLInputElement).disabled).toBe(false);
  });

  it("takes a full seat that was already picked off the list, and says so", async () => {
    const onChange = vi.fn();
    render(<SeatPicksField field={FIELD} value={["seat-full", "seat-open"]} onChange={onChange} invalid={false} footerNode={null} />);
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(["seat-open"]));
    expect(screen.getByRole("status").textContent).toMatch(/Full seat is full/);
  });
});
