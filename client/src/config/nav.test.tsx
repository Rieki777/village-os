// @vitest-environment jsdom
/**
 * Who the header offers the Launch Plan to.
 *
 * WHY THIS RENDERS THE SHELL INSTEAD OF READING THE CONFIG. `NAV` is data and
 * the data alone decides nothing: `visible()` in Layout.tsx is what turns a
 * `roles` list into a link a person can see, and asserting on the array would
 * only prove that this file still says what it says. So the assertions below
 * are about anchors in a rendered menu, opened the way a member opens it.
 *
 * THE CONTROL IS THE POINT. The Command Centre sits directly beneath the
 * Launch Plan in the same group and stays team-only, so every case here checks
 * both hrefs. A change that opened the whole About group, or that broke
 * `visible()` into a pass-everything, would show up as the Command Centre
 * appearing for a member, and these tests would say so.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { Router } from "wouter";

const authMock = vi.fn();

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => authMock(),
}));
vi.mock("@/modules/ModuleProvider", () => ({
  useModules: () => ({ modules: [], loaded: true, failed: false }),
}));
vi.mock("@/lib/gameApi", () => ({
  useGameConfig: () => ({
    project: { name: "Willowbrook", tagline: "", memberName: "", location: "", adminPath: "/admin" },
    images: {} as Record<string, string>,
  }),
  altOr: (value: string | undefined, fallback: string) =>
    typeof value === "string" ? value : fallback,
}));
vi.mock("@/components/NotificationBell", () => ({ default: () => null }));
vi.mock("@/components/NotificationToasts", () => ({ default: () => null }));
vi.mock("@/components/mobile/MobileTabBar", () => ({
  default: () => null,
  isBareRoute: () => false,
}));
vi.mock("@/components/mobile/MobileFab", () => ({ default: () => null }));

import Layout from "@/components/Layout";

const LAUNCH_PLAN = '/journey-to-launch';
const COMMAND_CENTRE = '/project-history';

/**
 * Render the shell as `who`, then open the About dropdown, because the desktop
 * dropdown mounts its items only while it is open. `null` is a signed-out
 * visitor.
 */
function openAbout(who: { id: string; name: string; role?: string } | null) {
  authMock.mockReturnValue({ user: who, loading: false, logout: vi.fn() });
  render(
    <Router>
      <Layout>
        <p>page body</p>
      </Layout>
    </Router>,
  );
  const buttons = screen.getAllByRole("button", { name: /About/i });
  fireEvent.click(buttons[0]!);
}

/** Every anchor in the whole shell pointing at `href`, header and footer both. */
function linksTo(href: string) {
  return Array.from(document.querySelectorAll(`a[href="${href}"]`));
}

describe("the Launch Plan entry in the header", () => {
  beforeEach(() => {
    authMock.mockReset();
  });

  it("is there for a signed-in member holding no admin role", () => {
    // R12: any member may run the village's test run, so any member has to be
    // able to find the page that offers it.
    openAbout({ id: "u-wren", name: "Wren Ash", role: "member" });

    expect(linksTo(LAUNCH_PLAN).length).toBeGreaterThan(0);
    // The control: the neighbouring entry is still shut, so this is the one
    // gate that moved and not the group.
    expect(linksTo(COMMAND_CENTRE)).toHaveLength(0);
  });

  it("is still there for an admin, who did not lose the door they had", () => {
    openAbout({ id: "u-admin", name: "Ada Stone", role: "admin" });

    expect(linksTo(LAUNCH_PLAN).length).toBeGreaterThan(0);
    expect(linksTo(COMMAND_CENTRE).length).toBeGreaterThan(0);
  });

  it("is still there for a founder", () => {
    openAbout({ id: "u-founder", name: "Fen Oak", role: "founder" });

    expect(linksTo(LAUNCH_PLAN).length).toBeGreaterThan(0);
    expect(linksTo(COMMAND_CENTRE).length).toBeGreaterThan(0);
  });

  it("is not offered to a stranger, who would only meet a sign-in wall", () => {
    // JourneyToLaunch answers a signed-out visitor with a lock and a Sign in
    // button. A menu entry onto that is a locked door in a public menu, which
    // is the defect the Command Centre entry was written to avoid, so opening
    // this one to members had to stop short of opening it to everyone.
    openAbout(null);

    expect(linksTo(LAUNCH_PLAN)).toHaveLength(0);
    expect(linksTo(COMMAND_CENTRE)).toHaveLength(0);
  });
});
