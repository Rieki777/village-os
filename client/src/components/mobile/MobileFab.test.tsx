// @vitest-environment jsdom
/**
 * The shortcuts button offers the Journal only to a signed-in member, and only
 * while the journal module is on for them.
 *
 * Each case reads the RENDERED rows, opened the way a member opens them,
 * because FAB_ACTIONS alone decides nothing: `resolve()` in MobileFab.tsx is
 * what turns `requiresAuth` and `module` into a row a person can tap. Every
 * case also checks a neighbour (Profile, which needs only a session), so a
 * change that hid the whole menu would fail here as a missing control rather
 * than pass as a missing Journal.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";

const session = vi.hoisted(() => ({
  user: null as null | { id: string; name: string },
  modules: [] as { id: string; lifecycle: string }[],
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: session.user, loading: false }),
}));
vi.mock("@/modules/ModuleProvider", () => ({
  useModules: () => ({ modules: session.modules, loaded: true, failed: false }),
}));
vi.mock("@/lib/haptics", () => ({ haptic: () => false }));

import MobileFab from "./MobileFab";

const JOURNAL_ON = [{ id: "journal", lifecycle: "members" }];

function renderAt(path = "/") {
  const { hook } = memoryLocation({ path });
  return render(
    <Router hook={hook}>
      <MobileFab />
    </Router>,
  );
}

function openMenu() {
  fireEvent.click(screen.getByRole("button", { name: "Open shortcuts" }));
}

const row = (name: string) => screen.queryByRole("menuitem", { name });

describe("the Journal shortcut", () => {
  beforeEach(() => {
    session.user = null;
    session.modules = [];
  });

  it("is offered to a signed-in member when the journal module is on", () => {
    session.user = { id: "u-wren", name: "Wren" };
    session.modules = JOURNAL_ON;
    renderAt();
    openMenu();

    const journal = row("Journal");
    expect(journal).not.toBeNull();
    expect(journal).toHaveAttribute("href", "/journal");
    expect(row("Profile")).not.toBeNull();
  });

  it("sits second from the thumb, just above Quests", () => {
    session.user = { id: "u-wren", name: "Wren" };
    session.modules = JOURNAL_ON;
    renderAt();
    openMenu();

    const names = screen.getAllByRole("menuitem").map((el) => el.getAttribute("aria-label"));
    expect(names.slice(-2)).toEqual(["Journal", "Quests"]);
  });

  it("is not offered while the module is off for this viewer", () => {
    session.user = { id: "u-wren", name: "Wren" };
    session.modules = [];
    renderAt();
    openMenu();

    expect(row("Journal")).toBeNull();
    expect(row("Profile")).not.toBeNull();
  });

  it("is not offered when the manifest carries the module with lifecycle off", () => {
    session.user = { id: "u-wren", name: "Wren" };
    session.modules = [{ id: "journal", lifecycle: "off" }];
    renderAt();
    openMenu();

    expect(row("Journal")).toBeNull();
  });

  it("is not offered to a signed-out visitor, even with the module on", () => {
    session.user = null;
    session.modules = JOURNAL_ON;
    renderAt();
    openMenu();

    expect(row("Journal")).toBeNull();
    expect(row("Sign in")).not.toBeNull();
  });

  it("drops out on the journal itself, where it would link to the page being read", () => {
    session.user = { id: "u-wren", name: "Wren" };
    session.modules = JOURNAL_ON;
    renderAt("/journal");
    openMenu();

    expect(row("Journal")).toBeNull();
    expect(row("Profile")).not.toBeNull();
  });
});

describe("the menu at every width", () => {
  beforeEach(() => {
    session.user = { id: "u-wren", name: "Wren" };
    session.modules = JOURNAL_ON;
  });

  it("is no longer hidden from desktop widths", () => {
    // jsdom applies no media queries, so this pins the class that used to
    // remove the button at `md` and up.
    const { container } = renderAt();
    const box = container.querySelector("[data-mobile-fab]");
    expect(box).not.toBeNull();
    expect(box!.className).not.toMatch(/\bmd:hidden\b/);
  });

  it("closes on Escape and hands focus back to the trigger", () => {
    renderAt();
    const trigger = screen.getByRole("button", { name: "Open shortcuts" });
    // detail 0 is how a keyboard's Enter arrives as a click.
    fireEvent.click(trigger, { detail: 0 });

    // Opened from the keyboard, focus lands on the row nearest the trigger.
    expect(document.activeElement).toBe(row("Quests"));

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.getByRole("button", { name: "Open shortcuts" })).toHaveAttribute("aria-expanded", "false");
    expect(document.activeElement).toBe(trigger);
  });

  it("walks the rows with the arrow keys", () => {
    renderAt();
    fireEvent.click(screen.getByRole("button", { name: "Open shortcuts" }), { detail: 0 });
    fireEvent.keyDown(document.activeElement!, { key: "ArrowUp" });
    expect(document.activeElement).toBe(row("Journal"));
    fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
    expect(document.activeElement).toBe(row("Quests"));
  });

  /*
   * The Escape that closes the menu is spent there. BreakGlass listens on
   * `window`, and the same press used to reach it and decline the override
   * the member was being asked about. The second press, with the menu shut,
   * proves the listener is live, so the first zero is a zero.
   */
  it("keeps the Escape that closes it from reaching a listener on window", () => {
    const onWindowKey = vi.fn();
    window.addEventListener("keydown", onWindowKey);
    try {
      renderAt();
      openMenu();
      fireEvent.keyDown(document, { key: "Escape" });
      expect(screen.getByRole("button", { name: "Open shortcuts" })).toHaveAttribute("aria-expanded", "false");
      expect(onWindowKey).not.toHaveBeenCalled();

      fireEvent.keyDown(document, { key: "Escape" });
      expect(onWindowKey).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener("keydown", onWindowKey);
    }
  });
});

/*
 * A row for the page already showing (Profile on /profile; Roles and Work with
 * us likewise) keeps the button mounted, because the route does not change.
 * Focus used to stay on that row after the menu shut: invisible, aria-hidden,
 * and still inside the menu's key handler, so ArrowDown and End walked hidden
 * links instead of scrolling the page.
 */
describe("after a shortcut to the page already showing", () => {
  beforeEach(() => {
    session.user = { id: "u-wren", name: "Wren" };
    session.modules = JOURNAL_ON;
  });

  it("hands focus back to the trigger, and the arrow keys belong to the page again", () => {
    renderAt("/profile");
    const trigger = screen.getByRole("button", { name: "Open shortcuts" });
    fireEvent.click(trigger, { detail: 0 });
    const profile = row("Profile")!;
    profile.focus();
    // Enter on a link arrives as a click.
    fireEvent.click(profile, { detail: 0 });

    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(document.activeElement).toBe(trigger);
    // fireEvent answers false when a handler called preventDefault.
    expect(fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" })).toBe(true);
  });

  it("leaves the arrow keys alone on a shut menu, even with focus still on a row", () => {
    renderAt("/profile");
    const trigger = screen.getByRole("button", { name: "Open shortcuts" });
    fireEvent.click(trigger, { detail: 0 });
    const quests = row("Quests")!;
    expect(document.activeElement).toBe(quests);
    // A tap elsewhere shuts the menu without moving focus.
    fireEvent.click(document.body);
    expect(trigger).toHaveAttribute("aria-expanded", "false");

    expect(fireEvent.keyDown(quests, { key: "ArrowDown" })).toBe(true);
    expect(fireEvent.keyDown(quests, { key: "End" })).toBe(true);
    expect(document.activeElement).toBe(quests);
  });
});
