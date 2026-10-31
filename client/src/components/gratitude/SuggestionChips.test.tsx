// @vitest-environment jsdom
/**
 * The quick-pick chips: a tap fills the recipient and sends nothing, the
 * chosen chip reads as pressed, and no suggestions renders no row at all.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import SuggestionChips from "./SuggestionChips";

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });

afterEach(() => {
  vi.unstubAllGlobals();
});

const TWO = {
  suggestions: [
    { name: "Ana Rivera", handle: "ana", sources: ["quest"] },
    { name: "Ben Ito", handle: "ben", sources: ["session", "circle"] },
  ],
};

describe("SuggestionChips", () => {
  it("a tap fills the field with the handle, and makes no other request", async () => {
    const fetchMock = vi.fn(async () => json(TWO));
    vi.stubGlobal("fetch", fetchMock);
    const onPick = vi.fn();
    render(<SuggestionChips selected="" onPick={onPick} refreshKey={0} />);
    fireEvent.click(await screen.findByRole("button", { name: "Ana Rivera" }));
    expect(onPick).toHaveBeenCalledWith("@ana");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toContain("/api/game/gratitude/suggestions");
  });

  it("marks the chip matching the field as pressed, whatever its case or @", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json(TWO)));
    render(<SuggestionChips selected="@BEN" onPick={() => {}} refreshKey={0} />);
    expect((await screen.findByRole("button", { name: "Ben Ito" })).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Ana Rivera" }).getAttribute("aria-pressed")).toBe("false");
  });

  it("renders nothing when there is nobody to suggest", async () => {
    const fetchMock = vi.fn(async () => json({ suggestions: [] }));
    vi.stubGlobal("fetch", fetchMock);
    const { container } = render(<SuggestionChips selected="" onPick={() => {}} refreshKey={0} />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(container.innerHTML).toBe("");
  });
});
