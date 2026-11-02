// @vitest-environment jsdom
/**
 * THE ONE HAND-OVER CONTROL, rendered (Rye, 2026-11-01): a checklist of the
 * powers in plain words, then a confirm, for the launch selection and for every
 * hand-over after it. The rules live on the server
 * (server/routes/stewardHandover.test.ts); this pins what the page shows and
 * what it sends.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import HandOverPowers from "./HandOverPowers";

vi.mock("@/lib/gameApi", () => ({ authToken: () => "a-token" }));

const POWERS = [
  { capability: "org.seat", title: "Who sits in which role", consequence: "seat people in the village's roles", held: false },
  { capability: "story.tell", title: "The village's story", consequence: "say what this village is", held: false },
];

let posts: any[] = [];
function serve(standing: Record<string, unknown>) {
  posts = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: any) => {
      if (init?.method === "POST") {
        const body = JSON.parse(init.body);
        posts.push(body);
        return { ok: true, status: 200, json: async () => ({ stage: "launch", selected: body.capabilities, moved: body.capabilities }) };
      }
      return { ok: true, status: 200, json: async () => standing };
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the hand-over control", () => {
  it("renders nothing for somebody who may not use it", async () => {
    serve({ gameStarted: false, mayAct: false });
    const { container } = render(<HandOverPowers />);
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(container.textContent).toBe("");
  });

  it("before launch, shows the current selection and saves an empty one only after a confirm", async () => {
    serve({ gameStarted: false, mayAct: true, selected: ["org.seat"], powers: POWERS });
    render(<HandOverPowers />);
    await waitFor(() => expect(screen.getByText("What the launch hands to the village")).toBeTruthy());
    expect(screen.getByText(/seat people in the village's roles/)).toBeTruthy();
    const seat = screen.getByRole("checkbox", { name: /Who sits in which role/ }) as HTMLInputElement;
    expect(seat.checked, "the stored selection is ticked").toBe(true);
    fireEvent.click(seat);
    fireEvent.click(screen.getByRole("button", { name: /Save what the launch hands over/ }));
    expect(posts, "nothing is sent before the confirm").toEqual([]);
    expect(screen.getByText(/none of its powers\. Confirm\?/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(posts).toEqual([{ capabilities: [], confirm: true }]));
  });

  it("while the launch vote is open, shows the frozen list and offers no save", async () => {
    serve({ gameStarted: false, mayAct: true, selected: ["org.seat"], frozen: true, powers: POWERS });
    render(<HandOverPowers />);
    await waitFor(() => expect(screen.getByText(/this list is written into it/)).toBeTruthy());
    expect((screen.getByRole("checkbox", { name: /Who sits in which role/ }) as HTMLInputElement).disabled).toBe(true);
    expect(screen.queryByRole("button", { name: /Save what the launch hands over/ })).toBeNull();
  });

  it("asks a second steward to sign the list that waits, ticked for them", async () => {
    serve({ gameStarted: true, mayAct: true, twoSign: true, pending: { capabilities: ["story.tell"], mine: false }, powers: POWERS });
    render(<HandOverPowers />);
    await waitFor(() => expect(screen.getByText(/waits for your signature/)).toBeTruthy());
    expect((screen.getByRole("checkbox", { name: /The village's story/ }) as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: /Hand over 1/ }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(posts).toEqual([{ capabilities: ["story.tell"], confirm: true }]));
  });

  it("asks a second tick for a mature-only power before Confirm opens, and sends it", async () => {
    const veto = { capability: "steward.veto", title: "Stop a carried decision", consequence: "stop a decision", held: false, matureOnly: true };
    serve({ gameStarted: true, mayAct: true, powers: [veto] });
    render(<HandOverPowers />);
    await waitFor(() => expect(screen.getByText("For mature villages only")).toBeTruthy());
    fireEvent.click(screen.getByRole("checkbox", { name: /Stop a carried decision/ }));
    fireEvent.click(screen.getByRole("button", { name: /Hand over 1/ }));
    expect((screen.getByRole("button", { name: "Confirm" }) as HTMLButtonElement).disabled, "not before the second tick").toBe(true);
    fireEvent.click(screen.getByRole("checkbox", { name: /mature enough to hold/ }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(posts).toEqual([{ capabilities: ["steward.veto"], confirm: true, confirmMature: true }]));
  });

  it("after launch, shows a held power as held and sends only the newly ticked one", async () => {
    serve({ gameStarted: true, mayAct: true, powers: [{ ...POWERS[0], held: true }, POWERS[1]] });
    render(<HandOverPowers />);
    await waitFor(() => expect(screen.getByText("Hand powers to the village")).toBeTruthy());
    const held = screen.getByRole("checkbox", { name: /Who sits in which role/ }) as HTMLInputElement;
    expect(held.checked && held.disabled, "a held power stays where it is").toBe(true);
    expect((screen.getByRole("button", { name: /Hand over 0/ }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("checkbox", { name: /The village's story/ }));
    fireEvent.click(screen.getByRole("button", { name: /Hand over 1/ }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(posts).toEqual([{ capabilities: ["story.tell"], confirm: true }]));
  });
});
