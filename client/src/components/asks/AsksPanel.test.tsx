// @vitest-environment jsdom
/**
 * The asks panel draws what the server sent, in three bands, and moves a row
 * only when the server said yes. A read that failed says so; a read closed to
 * the reader draws nothing.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const gameFetch = vi.fn();
vi.mock("@/lib/gameApi", () => ({ gameFetch: (...args: unknown[]) => gameFetch(...args) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn() } }));

import AsksPanel from "./AsksPanel";
import type { AskView, AsksPayload } from "@shared/memberAsks";

const answer = (body: unknown, status = 200) => Promise.resolve({ ok: status >= 200 && status < 300, status, json: async () => body });

const row = (over: Partial<AskView>): AskView => ({
  id: "a1",
  link: "https://docs.example.org/d/1",
  why: "Review the draft",
  dueOn: null,
  blocking: false,
  status: "open",
  otherName: "Ana",
  askedOn: "2026-10-30",
  handBackNote: null,
  tier: "whenever",
  ...over,
});

const payload = (over: Partial<AsksPayload> = {}): AsksPayload => ({ waitingOnYou: [], yourAsks: [], ...over });

beforeEach(() => {
  gameFetch.mockReset();
});

describe("AsksPanel", () => {
  it("draws the asks waiting on you in their bands, someone stuck first", async () => {
    gameFetch.mockReturnValueOnce(
      answer(
        payload({
          waitingOnYou: [
            row({ id: "b", why: "Sign the NDA", tier: "blocking", blocking: true, otherName: "Rick" }),
            row({ id: "w", why: "Look at the map", tier: "whenever" }),
          ],
        }),
      ),
    );
    render(<AsksPanel />);
    const stuck = await screen.findByText("Someone is stuck until you do these");
    const bands = document.querySelectorAll("[data-ask-tier]");
    expect(Array.from(bands).map((b) => b.getAttribute("data-ask-tier"))).toEqual(["blocking", "whenever"]);
    expect(within(stuck.parentElement as HTMLElement).getByText("Rick asks: Sign the NDA")).toBeTruthy();
    expect(screen.queryByText("Due this week")).toBeNull();
  });

  it("takes a row away once the server says it is done, and keeps it when the server refuses", async () => {
    gameFetch.mockReturnValueOnce(answer(payload({ waitingOnYou: [row({ id: "x" })] })));
    render(<AsksPanel />);
    await screen.findByText("Ana asks: Review the draft");

    gameFetch.mockReturnValueOnce(answer({ error: "This ask is already closed." }, 409));
    await userEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "This ask is already closed.");
    expect(screen.getByText("Ana asks: Review the draft")).toBeTruthy();

    gameFetch.mockReturnValueOnce(answer({ ok: true }));
    await userEvent.click(screen.getByRole("button", { name: "Done" }));
    await waitFor(() => expect(screen.queryByText("Ana asks: Review the draft")).toBeNull());
    expect(gameFetch).toHaveBeenLastCalledWith("/api/asks/x/done", expect.objectContaining({ method: "POST" }));
  });

  it("hands an ask back with a note", async () => {
    gameFetch.mockReturnValueOnce(answer(payload({ waitingOnYou: [row({ id: "y" })] })));
    render(<AsksPanel />);
    await userEvent.click(await screen.findByRole("button", { name: "Not mine" }));
    await userEvent.type(screen.getByLabelText(/Anything Ana should know/), "Cai owns the docs");
    gameFetch.mockReturnValueOnce(answer({ ok: true }));
    await userEvent.click(screen.getByRole("button", { name: "Hand it back" }));
    await waitFor(() => expect(screen.queryByText("Ana asks: Review the draft")).toBeNull());
    const [url, init] = gameFetch.mock.calls.at(-1) as [string, RequestInit];
    expect(url).toBe("/api/asks/y/not-mine");
    expect(JSON.parse(String(init.body))).toEqual({ note: "Cai owns the docs" });
  });

  it("shows your own asks with how they closed", async () => {
    gameFetch.mockReturnValueOnce(
      answer(payload({ yourAsks: [row({ id: "m", otherName: "Ben", status: "handed_back", handBackNote: "Not my circle" })] })),
    );
    render(<AsksPanel />);
    expect(await screen.findByText("You asked Ben: Review the draft")).toBeTruthy();
    expect(screen.getByText("Handed back")).toBeTruthy();
    expect(screen.getByText("Ben said: Not my circle")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Withdraw" })).toBeNull();
  });

  it("says a failed read failed, and draws nothing for a read closed to the reader", async () => {
    gameFetch.mockReturnValueOnce(answer({}, 500));
    const { unmount } = render(<AsksPanel />);
    expect(await screen.findByText("Your asks did not load.")).toBeTruthy();
    unmount();

    gameFetch.mockReturnValueOnce(answer({ error: "auth_required" }, 401));
    const { container } = render(<AsksPanel />);
    await waitFor(() => expect(gameFetch).toHaveBeenCalledTimes(2));
    expect(container.textContent).toBe("");
  });

  it("sends nothing until a person, a link and a reason are there", async () => {
    gameFetch.mockReturnValueOnce(answer(payload()));
    render(<AsksPanel />);
    const send = await screen.findByRole("button", { name: "Send the ask" });
    expect(send).toHaveProperty("disabled", true);
  });
});
