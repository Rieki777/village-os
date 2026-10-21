// @vitest-environment jsdom
/**
 * What `aria-modal="true"` promises, held for the keyboard: focus goes in,
 * Tab cannot leave, Escape closes, and closing hands focus back to the opener.
 * Every assertion reads `document.activeElement` after a real key press.
 */
import { describe, expect, it, vi } from "vitest";
import { useRef, useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { focusablesIn, useModalFocus } from "./useModalFocus";

function Harness({ onEscape, withInitial = false }: { onEscape?: () => void; withInitial?: boolean }) {
  const [open, setOpen] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const second = useRef<HTMLButtonElement>(null);
  useModalFocus(open, panel, {
    onEscape: onEscape ? () => { onEscape(); setOpen(false); } : undefined,
    initial: withInitial ? second : undefined,
  });
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>Open</button>
      <a href="#behind">Behind the overlay</a>
      {open && (
        <div role="dialog" aria-modal="true" aria-label="Test" ref={panel}>
          <button type="button">First</button>
          <button type="button" ref={second}>Second</button>
          <button type="button" hidden>Hidden</button>
          <button type="button" onClick={() => setOpen(false)}>Close</button>
        </div>
      )}
    </>
  );
}

describe("useModalFocus", () => {
  it("moves focus into the panel on opening", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: "Open" }));
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "First" }));
  });

  it("prefers the element it is told to focus", async () => {
    const user = userEvent.setup();
    render(<Harness withInitial />);
    await user.click(screen.getByRole("button", { name: "Open" }));
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Second" }));
  });

  it("wraps Tab and Shift+Tab inside the panel, never reaching the page", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: "Open" }));
    const first = screen.getByRole("button", { name: "First" });
    const close = screen.getByRole("button", { name: "Close" });
    await user.tab();
    await user.tab();
    expect(document.activeElement).toBe(close);
    await user.tab();
    expect(document.activeElement).toBe(first);
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(close);
    const behind = screen.getByRole("link", { name: "Behind the overlay" });
    for (let i = 0; i < 6; i++) {
      await user.tab();
      expect(document.activeElement).not.toBe(behind);
    }
  });

  it("closes on Escape and hands focus back to the opener", async () => {
    const user = userEvent.setup();
    const onEscape = vi.fn();
    render(<Harness onEscape={onEscape} />);
    const opener = screen.getByRole("button", { name: "Open" });
    await user.click(opener);
    await user.keyboard("{Escape}");
    expect(onEscape).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it("hands focus back when the panel's own button closes it", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const opener = screen.getByRole("button", { name: "Open" });
    await user.click(opener);
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(document.activeElement).toBe(opener);
  });

  it("does nothing on Escape when no handler is given", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: "Open" }));
    await user.keyboard("{Escape}");
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("counts only what Tab can reach", () => {
    const root = document.createElement("div");
    root.innerHTML = `<button>a</button><button disabled>b</button><span tabindex="-1">c</span><span tabindex="0">d</span><div hidden><button>e</button></div><input type="hidden">`;
    expect(focusablesIn(root).map((e) => e.textContent)).toEqual(["a", "d"]);
  });
});
