// @vitest-environment jsdom
/**
 * The arrival form keeps the number a person just chose.
 *
 * Since 0288 the form follows `whom`, the person it is for (the viewer, or
 * whoever the facilitator is filling in for), and starts again from their
 * stored number when `whom` changes. The reset effect ran on mount too, and a
 * mount's passive effects can flush AFTER a click that lands first: the click
 * set 9, the late effect set the stored 7 back, and "Change my number" sent 7.
 * Only a real change of person may reset the form now.
 *
 * The first case reproduces the race outside `act`, where React flushes
 * effects on its own schedule the way a browser does; inside `act` every
 * effect has flushed before the click and the defect cannot be seen.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createRoot } from "react-dom/client";
import { ROOM_COPY, SESSION_COPY, defaultSessionState, type SessionView } from "@shared/sessions";
import StageArrival from "./StageArrival";
import { makeView } from "./__tests__/roomFixture";
import type { RoomActions } from "./useSessionRoom";

const arrivalStage = { ...defaultSessionState(), stage: "arrival" as const };
const ADA = { userId: 1, joined: true, facilitates: true, secretary: false, admin: false };
const ok = async () => ({ ok: true as const, body: {}, room: null });
const checked = (root: ParentNode = document) =>
  Array.from(root.querySelectorAll('[role="radio"]')).find((b) => b.getAttribute("aria-checked") === "true")?.textContent ?? null;

afterEach(() => {
  cleanup();
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

describe("the arrival form keeps the number just chosen", () => {
  it("a click that lands before the mount's effects flush is not overwritten by the stored number", async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
    const el = document.createElement("div");
    document.body.appendChild(el);
    const root = createRoot(el);
    // Bo (the viewer) gave 7 before, and chooses 9 now.
    const view = makeView({ state: arrivalStage });
    try {
      root.render(<StageArrival view={view} now={0} actions={{ arrival: vi.fn(ok), act: vi.fn(ok) } as unknown as RoomActions} />);
      // The click goes in from a MutationObserver, a microtask straight after the commit and before the passive flush.
      await new Promise<void>((resolve) => {
        const seen = new MutationObserver(() => {
          const nine = Array.from(el.querySelectorAll<HTMLButtonElement>('[role="radio"]')).find((b) => b.textContent === "9");
          if (!nine) return;
          seen.disconnect();
          nine.click();
          resolve();
        });
        seen.observe(el, { childList: true, subtree: true });
      });
      await new Promise((r) => setTimeout(r, 50));
      expect(checked(el)).toBe("9");
    } finally {
      root.unmount();
      el.remove();
    }
  });

  it("keeps the click when the room is fetched again with the same person (a refetch is no reset)", () => {
    const actions = { arrival: vi.fn(ok), act: vi.fn(ok) } as unknown as RoomActions;
    const { rerender } = render(<StageArrival view={makeView({ state: arrivalStage })} now={0} actions={actions} />);
    expect(checked()).toBe("7");
    fireEvent.click(screen.getByRole("radio", { name: "9" }));
    // A poll brings a newer room: the same stored number, a newer version.
    rerender(<StageArrival view={makeView({ state: arrivalStage, version: 4 })} now={0} actions={actions} />);
    expect(checked()).toBe("9");
  });

  it("CONTROL: switching the person still starts the form from what they gave", () => {
    const view = (fillingFor: number | null): [SessionView, RoomActions] => [
      makeView({ me: ADA, state: arrivalStage }),
      { arrival: vi.fn(ok), act: vi.fn(ok), fillingFor, fillFor: vi.fn() } as unknown as RoomActions,
    ];
    const [v1, a1] = view(null);
    const { rerender } = render(<StageArrival view={v1} now={0} actions={a1} />);
    expect(checked()).toBeNull(); // Ada has given nothing yet.
    fireEvent.click(screen.getByRole("radio", { name: "4" }));

    // Ada fills in for Bo: the form shows Bo's 7, not Ada's unsent 4.
    const [v2, a2] = view(2);
    rerender(<StageArrival view={v2} now={0} actions={a2} />);
    expect(checked()).toBe("7");

    // And back to herself: her own (still none).
    const [v3, a3] = view(null);
    rerender(<StageArrival view={v3} now={0} actions={a3} />);
    expect(checked()).toBeNull();
  });

  it("a facilitator filling in sends the number they chose for that person", async () => {
    const arrival = vi.fn(ok);
    render(
      <StageArrival
        view={makeView({ me: ADA, state: arrivalStage })}
        now={0}
        actions={{ arrival, act: vi.fn(ok), fillingFor: 2, fillFor: vi.fn() } as unknown as RoomActions}
      />,
    );
    expect(checked()).toBe("7");
    fireEvent.click(screen.getByRole("radio", { name: "5" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: ROOM_COPY.changeNumber }));
    });
    // Bo's wish rides along unchanged; the number is the one just chosen.
    expect(arrival).toHaveBeenCalledWith(5, "More sleep");
    expect(checked()).toBe("5");
  });

  it("a switch of person while a save is out does not say the new person is saved", async () => {
    let release!: () => void;
    const arrival = vi.fn(() => new Promise<{ ok: true; body: object; room: null }>((r) => (release = () => r({ ok: true, body: {}, room: null }))));
    const props = (fillingFor: number) => ({
      view: makeView({ me: ADA, state: arrivalStage }),
      now: 0,
      actions: { arrival, act: vi.fn(ok), fillingFor, fillFor: vi.fn() } as unknown as RoomActions,
    });
    const { rerender } = render(<StageArrival {...props(2)} />);
    fireEvent.click(screen.getByRole("radio", { name: "9" }));
    fireEvent.click(screen.getByRole("button", { name: ROOM_COPY.changeNumber }));
    expect(arrival).toHaveBeenCalledWith(9, "More sleep");

    // Cy is chosen before Bo's save answers.
    rerender(<StageArrival {...props(3)} />);
    await act(async () => release());
    expect(screen.queryByText(SESSION_COPY.arrivalSaved)).toBeNull();
    expect(checked()).toBeNull(); // Cy has given nothing.

    // A save for the person on screen still says so.
    fireEvent.click(screen.getByRole("radio", { name: "6" }));
    fireEvent.click(screen.getByRole("button", { name: ROOM_COPY.giveNumber }));
    await act(async () => release());
    expect(screen.getByText(SESSION_COPY.arrivalSaved)).toBeTruthy();
  });
});
