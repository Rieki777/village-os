// @vitest-environment jsdom
/**
 * The shell's keyboard paths, measured broken on the deployed build:
 *
 *  - the phone's More opened the drawer at the top of the page while focus
 *    stayed on More at the bottom, and the next Tab left the page;
 *  - Escape did nothing to the phone drawer;
 *  - there was no banner landmark on any route (the header was a bare <nav>).
 *
 * Every assertion reads the accessibility role or document.activeElement.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Router } from "wouter";

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: null, logout: vi.fn() }),
}));
vi.mock("@/modules/ModuleProvider", () => ({
  useModules: () => ({ modules: [], loaded: true, failed: false }),
}));
vi.mock("@/lib/gameApi", () => ({
  useGameConfig: () => ({ project: { name: "Willowbrook" }, images: {} }),
  altOr: (value: string | undefined, fallback: string) => (typeof value === "string" ? value : fallback),
}));
vi.mock("@/components/NotificationBell", () => ({ default: () => null }));
vi.mock("@/components/NotificationToasts", () => ({ default: () => null }));
vi.mock("@/components/RewardMoment", () => ({ default: () => null }));
vi.mock("./mobile/MobileTabBar", () => ({ default: () => null, isBareRoute: () => false }));
vi.mock("./mobile/MobileFab", () => ({ default: () => null }));
vi.mock("./NextStepTrail", () => ({ default: () => null }));

import Layout from "./Layout";

function renderShell() {
  return render(
    <Router>
      <Layout>
        <p>page body</p>
      </Layout>
    </Router>,
  );
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("the shell's landmarks", () => {
  it("puts the site navigation inside a banner landmark", () => {
    renderShell();
    const banner = screen.getByRole("banner");
    expect(within(banner).getByRole("navigation")).toBeTruthy();
    expect(within(banner).getByRole("link", { name: /willowbrook home/i })).toBeTruthy();
  });
});

describe("the phone drawer", () => {
  it("takes focus when More opens it, so the keyboard can reach it", async () => {
    renderShell();
    act(() => {
      window.dispatchEvent(new CustomEvent("open-mobile-menu"));
    });
    await waitFor(() => {
      const drawer = document.getElementById("mobile-menu");
      expect(drawer).not.toBeNull();
      expect(drawer!.contains(document.activeElement)).toBe(true);
    });
  });

  it("closes on Escape and hands focus to the menu button", async () => {
    const user = userEvent.setup();
    renderShell();
    const button = screen.getByRole("button", { name: "Open menu" });
    await user.click(button);
    expect(document.getElementById("mobile-menu")).not.toBeNull();
    await user.tab();
    expect(document.getElementById("mobile-menu")!.contains(document.activeElement)).toBe(true);

    await user.keyboard("{Escape}");
    const after = screen.getByRole("button", { name: "Open menu" });
    expect(after).toHaveAttribute("aria-expanded", "false");
    expect(document.activeElement).toBe(after);
    await waitFor(() => expect(document.getElementById("mobile-menu")).toBeNull());
  });

  it("leaves focus alone when the menu button itself opens it", async () => {
    const user = userEvent.setup();
    renderShell();
    const button = screen.getByRole("button", { name: "Open menu" });
    await user.click(button);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Close menu" }));
  });
});
