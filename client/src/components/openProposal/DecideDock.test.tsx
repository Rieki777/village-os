// @vitest-environment jsdom
/**
 * The steward's decision floats within thumb reach on a phone while its card is
 * still further down, rests in the card once reached, never floats on a desktop,
 * and gives the bottom of the screen to the save bar while changes wait.
 * The row is always the SAME buttons: floating never copies them.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import DecideDock from "./DecideDock";
import { resetUnsavedForTests, setUnsaved } from "@/lib/unsavedChanges";

type Fire = (entry: { isIntersecting: boolean; top: number }) => void;
let fire: Fire = () => {};

function stubScreen(phone: boolean) {
  vi.stubGlobal("matchMedia", (q: string) => ({
    matches: phone && q.includes("max-width"),
    media: q,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
  class IO {
    cb: (e: unknown[]) => void;
    constructor(cb: (e: unknown[]) => void) {
      this.cb = cb;
      fire = ({ isIntersecting, top }) => this.cb([{ isIntersecting, boundingClientRect: { top } }]);
    }
    observe() {}
    disconnect() {}
  }
  vi.stubGlobal("IntersectionObserver", IO);
}

const dock = () => document.querySelector("[data-decide-dock]")?.getAttribute("data-decide-dock");

function draw() {
  render(
    <DecideDock label="For the village" note="Something waits">
      <button type="button">Adopt for the village</button>
    </DecideDock>,
  );
}

describe("DecideDock", () => {
  beforeEach(() => resetUnsavedForTests());
  afterEach(() => {
    cleanup();
    resetUnsavedForTests();
    vi.unstubAllGlobals();
  });

  it("floats the one row above the bottom of a phone while the card is below, and rests once reached", () => {
    stubScreen(true);
    draw();
    act(() => fire({ isIntersecting: false, top: 5000 }));
    expect(dock()).toBe("floating");
    expect(screen.getByRole("region", { name: "For the village" })).toBeTruthy();
    expect(screen.getByText("Something waits")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Adopt for the village" })).toHaveLength(1);

    act(() => fire({ isIntersecting: true, top: 600 }));
    expect(dock()).toBe("resting");
    expect(screen.queryByRole("region", { name: "For the village" })).toBeNull();
  });

  it("does not float once the card has been scrolled past", () => {
    stubScreen(true);
    draw();
    act(() => fire({ isIntersecting: false, top: -400 }));
    expect(dock()).toBe("resting");
  });

  it("never floats on a desktop", () => {
    stubScreen(false);
    draw();
    act(() => fire({ isIntersecting: false, top: 5000 }));
    expect(dock()).toBe("resting");
  });

  it("rests while changes wait to be saved, so the save bar has the bottom of the screen", () => {
    stubScreen(true);
    draw();
    act(() => fire({ isIntersecting: false, top: 5000 }));
    expect(dock()).toBe("floating");
    act(() => setUnsaved("terms", 1));
    expect(dock()).toBe("resting");
    act(() => setUnsaved("terms", 0));
    expect(dock()).toBe("floating");
  });
});
