// @vitest-environment jsdom
/**
 * The weekly brief is an aria-modal overlay. Before useModalFocus, opening it
 * left focus on the button behind the overlay, Tab walked the page beneath,
 * Escape did nothing, and closing dropped focus on <body>.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// Events off: the panel opens without fetching, which is all focus needs.
vi.mock("@/modules/ModuleProvider", () => ({ useModuleOn: () => false }));

import WeeklyBrief from "./WeeklyBrief";

describe("WeeklyBrief dialog focus", () => {
  it("takes focus, keeps Tab inside, closes on Escape and gives focus back", async () => {
    const user = userEvent.setup();
    render(
      <>
        <WeeklyBrief signedIn />
        <a href="#after">After the card</a>
      </>,
    );
    const opener = screen.getByRole("button", { name: "Read this week's" });
    await user.click(opener);

    const dialog = screen.getByRole("dialog", { name: "Weekly brief" });
    const close = screen.getByRole("button", { name: "Close the brief" });
    expect(dialog).toContainElement(close);
    expect(document.activeElement).toBe(close);

    await user.tab();
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
    await user.tab({ shift: true });
    expect(dialog).toContainElement(document.activeElement as HTMLElement);

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it("gives focus back when the close button closes it", async () => {
    const user = userEvent.setup();
    render(<WeeklyBrief signedIn />);
    const opener = screen.getByRole("button", { name: "Read this week's" });
    await user.click(opener);
    await user.click(screen.getByRole("button", { name: "Close the brief" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(opener);
  });
});
