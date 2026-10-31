// @vitest-environment jsdom
/**
 * The /review card for a departed member's recurring payment a person still
 * has to cancel (round 4, finding 2). It names nobody, Finish runs the page's
 * retry, and "I cancelled these by hand" sends back the `asOf` it was read
 * with, so a hand-off that arrived after the read stays owed.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import OwedCancels from "./OwedCancels";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const headers = () => ({ "Content-Type": "application/json" });

describe("the owed-cancels card", () => {
  it("counts them, and the confirm sends the asOf the card was read with", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ cleared: 2 }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const onFinish = vi.fn();
    const onChanged = vi.fn();
    render(
      <OwedCancels summary={{ count: 2, oldestSince: null, asOf: "evt-1-abcd" }} aged="" busy={false}
        onFinish={onFinish} headers={headers} onChanged={onChanged} />,
    );
    expect(screen.getByText("2 departed members' recurring payments still need cancelling in Stripe")).toBeTruthy();
    fireEvent.click(screen.getByText("Finish them"));
    expect(onFinish).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText("I cancelled these by hand"));
    await vi.waitFor(() => expect(onChanged).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/review/erasure/subscriptions-cancelled");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ asOf: "evt-1-abcd" });
  });

  it("CONTROL: nothing owed, or an older server that sends no count, shows nothing", () => {
    const { container, rerender } = render(
      <OwedCancels summary={{ count: 0, oldestSince: null, asOf: null }} aged="" busy={false}
        onFinish={() => {}} headers={headers} onChanged={() => {}} />,
    );
    expect(container.innerHTML).toBe("");
    rerender(<OwedCancels summary={undefined} aged="" busy={false} onFinish={() => {}} headers={headers} onChanged={() => {}} />);
    expect(container.innerHTML).toBe("");
  });
});
