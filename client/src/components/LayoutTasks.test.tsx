// @vitest-environment jsdom
/**
 * "My tasks" in the avatar menu and in the mobile drawer, with the member's
 * own count beside it.
 *
 * The count is read only while a menu is open (the badge mounts with the
 * menu), so a closed header asks nothing. It is hidden at zero, and the whole
 * entry is gone with the sessions module off.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Router } from "wouter";
import { TASK_BOARD_PATH, TASK_COPY, TASKS_COUNT_URL } from "@shared/sessionTasks";

const env = vi.hoisted(() => ({ modules: [{ id: "sessions", lifecycle: "members" }] as { id: string; lifecycle: string }[] }));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "u1", name: "Ada Lovelace", role: "member" }, logout: vi.fn() }),
}));
vi.mock("@/modules/ModuleProvider", () => ({
  useModules: () => ({ modules: env.modules, loaded: true, failed: false }),
}));
vi.mock("@/lib/gameApi", () => ({
  useGameConfig: () => ({ project: { name: "Willowbrook" }, images: {} }),
  altOr: (value: string | undefined, fallback: string) => (typeof value === "string" ? value : fallback),
  authToken: () => "t",
  gameFetch: (path: string, init: RequestInit = {}) => fetch(path, { ...init, headers: { Authorization: "Bearer t" } }),
}));
vi.mock("@/hooks/useTokenNames", () => ({ useTokenName: (f: string) => f }));
vi.mock("@/components/NotificationBell", () => ({ default: () => null }));
vi.mock("@/components/NotificationToasts", () => ({ default: () => null }));
vi.mock("@/components/RewardMoment", () => ({ default: () => null }));
vi.mock("./mobile/MobileTabBar", () => ({ default: () => null, isBareRoute: () => false }));
vi.mock("./mobile/MobileFab", () => ({ default: () => null }));
vi.mock("./NextStepTrail", () => ({ default: () => null }));

import Layout from "./Layout";

const fetchMock = vi.fn();
beforeEach(() => {
  env.modules = [{ id: "sessions", lifecycle: "members" }];
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

function renderShell() {
  return render(
    <Router>
      <Layout>
        <p>page body</p>
      </Layout>
    </Router>,
  );
}

const countCalls = () => fetchMock.mock.calls.filter((c) => c[0] === TASKS_COUNT_URL).length;

describe("My tasks in the menus", () => {
  it("sits in the avatar menu with the member's own count, read only once the menu opens", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ waiting: 2, nextDue: null }), { status: 200 }));
    renderShell();
    await act(async () => {});
    expect(countCalls()).toBe(0);
    fireEvent.click(screen.getByRole("button", { name: "Your account, Ada" }));
    const link = await screen.findByRole("link", { name: `${TASK_COPY.menu.label}, ${TASK_COPY.menu.waiting(2)}` });
    expect(link.getAttribute("href")).toBe(TASK_BOARD_PATH);
    expect(countCalls()).toBe(1);
  });

  it("sits in the mobile drawer's account block too", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ waiting: 1, nextDue: null }), { status: 200 }));
    renderShell();
    fireEvent.click(screen.getByRole("button", { name: "Open menu" }));
    const link = await screen.findByRole("link", { name: `${TASK_COPY.menu.label}, ${TASK_COPY.menu.waiting(1)}` });
    expect(link.getAttribute("href")).toBe(TASK_BOARD_PATH);
  });

  it("shows no number when nothing waits", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ waiting: 0, nextDue: null }), { status: 200 }));
    renderShell();
    fireEvent.click(screen.getByRole("button", { name: "Your account, Ada" }));
    await waitFor(() => expect(countCalls()).toBe(1));
    await act(async () => {});
    expect(screen.getByRole("link", { name: TASK_COPY.menu.label })).toBeInTheDocument();
  });

  it("is not offered with the sessions module off, and nothing is asked", async () => {
    env.modules = [];
    renderShell();
    fireEvent.click(screen.getByRole("button", { name: "Your account, Ada" }));
    await act(async () => {});
    expect(screen.queryByRole("link", { name: new RegExp(`^${TASK_COPY.menu.label}`) })).toBeNull();
    expect(countCalls()).toBe(0);
  });
});
