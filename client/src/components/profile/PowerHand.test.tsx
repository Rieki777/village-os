// @vitest-environment jsdom
/**
 * The hand on a power row: when it shows, what one press sends, what the row
 * says once the server answers, and where focus goes.
 *
 * Every success here waits for the SERVER's answer before asserting the hand is
 * up, and one case has the server refuse, because a row that flipped to "Your
 * hand is up" on the click alone would pass a test that only checked the
 * request went out. One case unmounts and remounts the row through the map's own
 * "Hide what is closed" button, because that is how the answer used to be lost.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import PowerHand from "./PowerHand";
import PowersMap from "./PowersMap";
import type { GameStagePublic, ProgressionCapability } from "@/lib/gameApi";

const LIBRARY = "Keep the shared library and its loans";
const STORY = "Say what the village is, in public, in its own words";
const AT = "2026-09-15T10:00:00.000Z";
const RAISE = new RegExp(`^Raise my hand for ${LIBRARY}$`);

const row = (over: Partial<ProgressionCapability> = {}): ProgressionCapability => ({
  key: "library.keep",
  label: LIBRARY,
  held: false,
  opens: { via: "appointment" },
  suits: [{ key: "researching", name: "The Architect", yours: true }],
  recommended: true,
  ...over,
});

function answering(status: number, body: unknown) {
  const spy = vi.fn(async (_url: string, _init?: RequestInit) => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }));
  vi.stubGlobal("fetch", spy);
  return spy;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("PowerHand", () => {
  it("offers nothing on a power not put to the member, or on one they hold", () => {
    const notPut = render(<PowerHand row={row({ recommended: false, suits: [] })} />);
    expect(notPut.container.textContent).toBe("");
    notPut.unmount();
    const held = render(<PowerHand row={row({ held: true, recommended: false, hand: { status: "reviewing", submittedAt: AT } })} />);
    expect(held.container.textContent).toBe("");
  });

  it("names the power on its button, and puts the cursor in the note box when it opens", () => {
    render(<PowerHand row={row()} />);
    fireEvent.click(screen.getByRole("button", { name: RAISE }));
    expect(document.activeElement).toBe(screen.getByLabelText(/Why this power calls to you/));
  });

  it("returns focus to the button that opened the note box when it is cancelled", async () => {
    render(<PowerHand row={row()} />);
    fireEvent.click(screen.getByRole("button", { name: RAISE }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: RAISE })));
  });

  it("sends the note with the hand, says the hand is up only once the server agrees, and moves focus to that sentence", async () => {
    const spy = answering(200, { success: true, hand: { status: "new", submittedAt: AT } });
    render(<PowerHand row={row()} />);
    fireEvent.click(screen.getByRole("button", { name: RAISE }));
    fireEvent.change(screen.getByLabelText(/Why this power calls to you/), { target: { value: "I keep the tool shed" } });
    fireEvent.click(screen.getByRole("button", { name: RAISE }));

    await waitFor(() => expect(screen.getByText("Your hand is up")).toBeTruthy());
    const [url, init] = spy.mock.calls[0]!;
    expect(url).toBe("/api/powers/library.keep/raise-hand");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({ note: "I keep the tool shed" });
    expect(screen.getByText("Hand raised. The founding team will be in touch.")).toBeTruthy();
    await waitFor(() => expect(document.activeElement?.textContent).toBe("Your hand is up"));
    expect(screen.queryByRole("button", { name: RAISE })).toBeNull();
  });

  it("sends one hand for two quick presses", async () => {
    let finish: (v: unknown) => void = () => undefined;
    const spy = vi.fn(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    vi.stubGlobal("fetch", spy);
    render(<PowerHand row={row()} />);
    fireEvent.click(screen.getByRole("button", { name: RAISE }));
    const send = screen.getByRole("button", { name: RAISE });
    fireEvent.click(send);
    fireEvent.click(send);
    expect(spy).toHaveBeenCalledTimes(1);
    finish({ ok: true, status: 200, json: async () => ({ success: true, hand: { status: "new", submittedAt: AT } }) });
    await waitFor(() => expect(screen.getByText("Your hand is up")).toBeTruthy());
  });

  it("puts the server's refusal in front of the member and leaves the hand down", async () => {
    answering(409, { error: "not_recommended", message: "This power is not one the village puts to you yet." });
    render(<PowerHand row={row()} />);
    fireEvent.click(screen.getByRole("button", { name: RAISE }));
    fireEvent.click(screen.getByRole("button", { name: RAISE }));

    await waitFor(() => expect(screen.getByText("This power is not one the village puts to you yet.")).toBeTruthy());
    expect(screen.queryByText("Your hand is up")).toBeNull();
    expect(screen.getByRole("button", { name: RAISE })).toBeTruthy();
  });

  it("shows the hand a refused second raise names, so an old payload cannot keep offering the button", async () => {
    answering(409, {
      error: "hand_already_up",
      message: "Your hand is already up for this power.",
      hand: { status: "reviewing", submittedAt: AT },
    });
    render(<PowerHand row={row()} />);
    fireEvent.click(screen.getByRole("button", { name: RAISE }));
    fireEvent.click(screen.getByRole("button", { name: RAISE }));

    await waitFor(() => expect(screen.getByText("Your hand is up, and somebody is reading it")).toBeTruthy());
    expect(screen.getByText("Your hand is already up for this power.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: RAISE })).toBeNull();
  });

  it("says where a hand that is up stands, and offers no second hand", () => {
    const reading = render(<PowerHand row={row({ hand: { status: "reviewing", submittedAt: AT } })} />);
    expect(screen.getByText("Your hand is up, and somebody is reading it")).toBeTruthy();
    expect(screen.queryByRole("button", { name: RAISE })).toBeNull();
    reading.unmount();
    render(<PowerHand row={row({ recommended: false, hand: { status: "in-conversation", submittedAt: AT } })} />);
    expect(screen.getByText("Your hand is up, and somebody is talking with you about it")).toBeTruthy();
  });

  it("hangs on an entrusted row in the profile's map, only on the one put to the member, and keeps the server's answer through a remount", async () => {
    answering(200, { success: true, hand: { status: "new", submittedAt: AT } });
    const stages: GameStagePublic[] = [
      { id: "member", name: "Member", description: "Joined the community.", rule: { type: "membership" }, gratitudeMultiplier: 2 },
      { id: "contributor", name: "Contributor", description: "Completed a first quest.", rule: { type: "quests", min: 1 }, gratitudeMultiplier: 2 },
    ];
    const story = row({ key: "story.tell", label: STORY, recommended: false, suits: [{ key: "storytelling", name: "The Storyteller" }] });
    const catalogue = [row(), story];
    render(<PowersMap catalogue={catalogue} stages={stages} stageIndex={1} />);

    const libraryRow = () => screen.getByText(LIBRARY).closest("li") as HTMLElement;
    expect(within(screen.getByText(STORY).closest("li") as HTMLElement).queryByRole("button", { name: /Raise my hand/ })).toBeNull();

    fireEvent.click(within(libraryRow()).getByRole("button", { name: RAISE }));
    fireEvent.click(within(libraryRow()).getByRole("button", { name: RAISE }));
    await waitFor(() => expect(within(libraryRow()).getByText("Your hand is up")).toBeTruthy());

    // Hiding what is closed unmounts every row the member does not hold.
    fireEvent.click(screen.getByRole("button", { name: "Hide what is closed" }));
    expect(screen.queryByText(LIBRARY)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show what is closed" }));
    expect(within(libraryRow()).getByText("Your hand is up")).toBeTruthy();
    expect(within(libraryRow()).queryByRole("button", { name: RAISE })).toBeNull();
  });
});
