// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import AdminQueueState from "./AdminQueueState";

beforeEach(() => localStorage.clear());

describe("queue states", () => {
  it("shows a retry when the list fails", async () => {
    const onRetry = vi.fn();
    render(<AdminQueueState kind="error" message="The list did not load. Try again in a moment." onRetry={onRetry} />);
    expect(screen.getByRole("alert").textContent).toMatch(/did not load/);
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalled();
  });

  it("says done for tonight after something was handled today", () => {
    const now = new Date();
    const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    localStorage.setItem("admin.handledToday", JSON.stringify({ day, count: 1 }));
    render(<AdminQueueState kind="empty" />);
    expect(screen.getByText("Done for tonight")).toBeTruthy();
  });

  it("says nothing is waiting on a first empty visit", () => {
    render(<AdminQueueState kind="empty" />);
    expect(screen.getByText("Nothing is waiting yet")).toBeTruthy();
  });
});
