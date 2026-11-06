// @vitest-environment jsdom
/**
 * The break-glass question is an aria-modal dialog drawn over whatever panel
 * fired the write. Its confirm button always took focus; nothing kept Tab
 * inside the panel or handed focus back when the question was answered, so a
 * keyboard user landed on <body> mid-task.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import BreakGlass from "./BreakGlass";

const REFUSAL = {
  error: "The village holds this power",
  requiresOverride: true,
  overrideAvailable: true,
  capability: "forum.moderate",
  title: "Moderate the forum",
  holder: "Forum Steward",
  consequence: "Hide or lock any thread",
};

const realFetch = window.fetch;
beforeEach(() => {
  window.fetch = vi.fn(async () =>
    new Response(JSON.stringify(REFUSAL), { status: 409, headers: { "Content-Type": "application/json" } }),
  ) as unknown as typeof fetch;
});
afterEach(() => {
  window.fetch = realFetch;
});

function Writer() {
  return (
    <button type="button" onClick={() => { void window.fetch("/api/forum/x/lock", { method: "POST", body: "{}" }); }}>
      Lock the thread
    </button>
  );
}

describe("BreakGlass dialog focus", () => {
  it("keeps Tab inside the question and hands focus back once it is answered", async () => {
    const user = userEvent.setup();
    render(
      <>
        <BreakGlass />
        <Writer />
        <a href="#elsewhere">Elsewhere on the page</a>
      </>,
    );
    const opener = screen.getByRole("button", { name: "Lock the thread" });
    await user.click(opener);

    const dialog = await screen.findByRole("dialog");
    const act = screen.getByTestId("break-glass-act");
    const leave = screen.getByTestId("break-glass-leave");
    await waitFor(() => expect(document.activeElement).toBe(act));

    await user.tab();
    expect(document.activeElement).toBe(leave);
    await user.tab();
    expect(document.activeElement).toBe(act);
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(leave);
    expect(dialog).toContainElement(document.activeElement as HTMLElement);

    await user.click(leave);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.activeElement).toBe(opener);
  });
});
