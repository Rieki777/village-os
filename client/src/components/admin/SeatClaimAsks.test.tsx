// @vitest-environment jsdom
/**
 * The control a steward answers a seat claim with, rendered.
 *
 * WHY THIS IS A RENDERED TEST AND NOT A UNIT ONE. The server side of this
 * change was complete and correct with no screen anywhere, which is the shape
 * that turned a working feature into one that could only be finished by hand.
 * The claim about this component is that a steward CAN SEE the ask and CAN
 * answer it, and nothing but rendering it can be asked that.
 *
 * FIVE OUTCOMES:
 *
 *   1. NOTHING DRAWS with no ask, which is every seat on most days. A panel
 *      that renders an empty amber box on every seat in the chart would teach
 *      a founder to scroll past the one that matters.
 *   2. THE RECORDED NAME IS PRINTED BESIDE THE ASKER'S. That pair is the whole
 *      decision: a name on an account is typed by whoever holds it, so the
 *      steward is being shown a question and never a proof.
 *   3. CONFIRM CALLS THE CONFIRM ROUTE with the asker's own user id, and says
 *      what happened afterwards.
 *   4. DECLINE CALLS THE DECLINE ROUTE and says so, and its wording does not
 *      claim the seat moved.
 *   5. A REFUSAL SAYS NOTHING HERE. `call` has already printed the server's
 *      own sentence, and this component must not report a success the server
 *      did not give it.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SeatClaimAsks, type SeatClaimAsk } from "./SeatClaimAsks";

const ASK: SeatClaimAsk = {
  claimId: "sc-1",
  assignmentId: "assign-1",
  roleId: "seat-water",
  roleName: "Water Steward",
  recordedName: "Wren Alder",
  userId: "u-wren",
  userName: "Wren Alder",
};

/** `call` as OrgChartTab hands it over: null means the server refused. */
function spyCall(answer: any = { success: true }) {
  const calls: Array<{ path: string; body: any; method?: string }> = [];
  const call = vi.fn(async (path: string, body?: any, method?: string) => {
    calls.push({ path, body, method });
    return answer;
  });
  return { call, calls };
}

describe("answering a seat claim", () => {
  it("draws nothing at all when the seat has no ask", () => {
    const { call } = spyCall();
    const { container } = render(<SeatClaimAsks asks={[]} call={call} onDone={vi.fn()} />);
    expect(container.querySelector("[data-seat-claim-asks]")).toBeNull();
    expect(container.textContent).toBe("");
  });

  it("prints who asked beside the name the seat was recorded under", () => {
    const { call } = spyCall();
    render(<SeatClaimAsks asks={[{ ...ASK, userName: "W. Alder" }]} call={call} onDone={vi.fn()} />);
    expect(screen.getByText("W. Alder")).toBeTruthy();
    // The recorded name is the other half of the decision, so it is on screen
    // whether or not it matches what the asker calls themselves.
    expect(screen.getByText("Wren Alder")).toBeTruthy();
  });

  it("confirms through the confirm route, naming the member who asked", async () => {
    const { call, calls } = spyCall();
    const onDone = vi.fn();
    render(<SeatClaimAsks asks={[ASK]} call={call} onDone={onDone} />);

    await userEvent.click(screen.getByRole("button", { name: /Confirm Wren Alder as Water Steward/ }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(calls).toHaveLength(1);
    expect(calls[0].path).toBe("/org/seatings/assign-1/claim/confirm");
    expect(calls[0].body).toEqual({ userId: "u-wren" });
    expect(String(onDone.mock.calls[0][0])).toContain("Water Steward");
  });

  it("declines through the decline route, and says the seat stayed put", async () => {
    const { call, calls } = spyCall();
    const onDone = vi.fn();
    render(<SeatClaimAsks asks={[ASK]} call={call} onDone={onDone} />);

    await userEvent.click(screen.getByRole("button", { name: /Decline Wren Alder's ask/ }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(calls[0].path).toBe("/org/seat-claims/sc-1/decline");
    const said = String(onDone.mock.calls[0][0]);
    expect(said).toContain("Declined");
    expect(said.toLowerCase(), "a decline never reports a seating").not.toContain("holds");
  });

  it("says nothing when the server refused, because the refusal was already shown", async () => {
    const { call } = spyCall(null);
    const onDone = vi.fn();
    render(<SeatClaimAsks asks={[ASK]} call={call} onDone={onDone} />);

    await userEvent.click(screen.getByRole("button", { name: /Confirm Wren Alder as Water Steward/ }));
    await waitFor(() => expect(call).toHaveBeenCalled());
    expect(onDone, "a success nobody gave us is the defect this change is about").not.toHaveBeenCalled();
  });
});
