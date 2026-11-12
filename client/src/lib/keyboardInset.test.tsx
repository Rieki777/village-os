// @vitest-environment jsdom
/**
 * The phone's keyboard, measured (batch 158, M2 and M9): the inset is what the
 * keyboard covers of the layout viewport, read from visualViewport, and a
 * focused field inside the watched element comes into view.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { useRef } from "react";
import { keyboardInset, useFocusedFieldInView, useKeyboardInset } from "./keyboardInset";

class FakeViewport extends EventTarget {
  height = 800;
  offsetTop = 0;
}

function phone(innerHeight = 800) {
  const vv = new FakeViewport();
  vi.stubGlobal("visualViewport", vv);
  Object.defineProperty(window, "innerHeight", { configurable: true, value: innerHeight });
  return vv;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("keyboardInset", () => {
  it("is 0 with no keyboard, and with no visualViewport at all", () => {
    phone();
    expect(keyboardInset()).toBe(0);
    vi.stubGlobal("visualViewport", undefined);
    expect(keyboardInset()).toBe(0);
  });

  it("is the height the keyboard covers, and ignores a browser bar's few pixels", () => {
    const vv = phone(800);
    vv.height = 480;
    expect(keyboardInset()).toBe(320);
    vv.height = 760;
    expect(keyboardInset()).toBe(0);
  });
});

function Probe() {
  const inset = useKeyboardInset();
  return <p data-testid="inset">{inset}</p>;
}

function Form() {
  const ref = useRef<HTMLDivElement>(null);
  useFocusedFieldInView(ref);
  return (
    <div ref={ref}>
      <textarea aria-label="Your words" />
      <input type="checkbox" aria-label="A tick" />
    </div>
  );
}

describe("the hooks", () => {
  it("follows the keyboard as it opens and closes", () => {
    const vv = phone(800);
    render(<Probe />);
    expect(screen.getByTestId("inset").textContent).toBe("0");
    act(() => {
      vv.height = 500;
      vv.dispatchEvent(new Event("resize"));
    });
    expect(screen.getByTestId("inset").textContent).toBe("300");
    act(() => {
      vv.height = 800;
      vv.dispatchEvent(new Event("resize"));
    });
    expect(screen.getByTestId("inset").textContent).toBe("0");
  });

  it("with the keyboard up, brings a focused text field to the middle, and leaves a tick box alone", async () => {
    const vv = phone(800);
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    });
    render(<Form />);
    const area = screen.getByLabelText("Your words");
    const tick = screen.getByLabelText("A tick");
    const seen = vi.fn();
    area.scrollIntoView = seen;
    tick.scrollIntoView = seen;
    // No keyboard (a desk): focus moves nothing.
    act(() => area.focus());
    expect(seen).not.toHaveBeenCalled();
    act(() => tick.focus());
    vv.height = 480;
    act(() => tick.focus());
    expect(seen).not.toHaveBeenCalled();
    act(() => area.focus());
    expect(seen).toHaveBeenCalledWith({ block: "center", inline: "nearest" });
  });
});
