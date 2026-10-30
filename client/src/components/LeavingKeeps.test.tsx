// @vitest-environment jsdom
/**
 * WHAT LEAVING KEEPS, told before the member confirms (round 4, R4-4 and R4-8).
 *
 *   1. A member the village still owes cash reads the count before either
 *      door. The departure keeps them on as a former member; deleting gives
 *      the cash up, and the delete panel asks them to say so.
 *   2. A member owed nothing, or whose read failed, sees no cash line.
 *   3. Both doors say a vote already cast on an open ballot still counts.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("@/lib/gameApi", () => ({ authToken: () => "a-session" }));

import { CashOwedNotice, VOTE_CAST_STAYS, VotesCastNotice, useUnpaidCash } from "./LeavingKeeps";

afterEach(() => vi.unstubAllGlobals());

const row = (state: string, id: string) => ({
  id, workKind: "quest", workRef: "q-1", workTitle: "Rebuild the water tank", amountMinor: 2500000,
  currency: "CRC", state, owedAt: "2026-10-20T00:00:00.000Z", claimedAt: null, paidAt: null, paidNote: null,
});

function serve(payload: unknown) {
  const fetchMock = vi.fn(async () => ({ ok: payload !== null, status: payload !== null ? 200 : 500, json: async () => payload }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function Probe({ door, onGiveUp }: { door: "departure" | "deletion"; onGiveUp?: (v: boolean) => void }) {
  const count = useUnpaidCash(true);
  return <CashOwedNotice count={count} door={door} givenUp={false} onGiveUp={onGiveUp} />;
}

describe("what leaving keeps", () => {
  it("counts owed and claimed rows, never paid ones, and on the departure says they stay a former member", async () => {
    serve({ entries: [row("owed", "a"), row("claimed", "b"), row("paid", "c")], mayPay: false });
    render(<Probe door="departure" />);
    expect(await screen.findByText(/2 cash payment\(s\) the village still owes you/)).toBeTruthy();
    expect(screen.getByText(/former member/)).toBeTruthy();
    expect(screen.queryByRole("checkbox")).toBeNull();
    // A count only: the amount and the work are on the cash card, never on the way out.
    expect(screen.queryByText(/water tank/)).toBeNull();
  });

  it("on the delete panel says the cash is given up, and asks for the tick", async () => {
    serve({ entries: [row("owed", "a")], mayPay: false });
    const onGiveUp = vi.fn();
    render(<Probe door="deletion" onGiveUp={onGiveUp} />);
    expect(await screen.findByText(/gives them up/)).toBeTruthy();
    fireEvent.click(screen.getByRole("checkbox", { name: /I give up the cash/ }));
    expect(onGiveUp).toHaveBeenCalledWith(true);
  });

  it("shows nothing for a member owed nothing, or when the read fails", async () => {
    const fetchMock = serve({ entries: [row("paid", "c")], mayPay: false });
    const { container } = render(<Probe door="deletion" />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(container.innerHTML).toBe("");
    vi.unstubAllGlobals();
    serve(null);
    const failed = render(<Probe door="deletion" />);
    await new Promise((r) => setTimeout(r, 20));
    expect(failed.container.innerHTML).toBe("");
  });

  it("says a vote already cast on an open ballot still counts", () => {
    render(<VotesCastNotice />);
    expect(screen.getByText(VOTE_CAST_STAYS)).toBeTruthy();
    expect(VOTE_CAST_STAYS).toContain("A vote you already cast on an open ballot still counts");
  });
});
