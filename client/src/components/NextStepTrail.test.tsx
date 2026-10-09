// @vitest-environment jsdom
/**
 * The Trail (R47): a member's next step under the header, on every page that
 * is not already about it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";

const useAuthMock = vi.fn();
const fetchGameMeMock = vi.fn();
let refresh: (() => void) | null = null;

vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => useAuthMock() }));
vi.mock("@/lib/gameApi", () => ({ fetchGameMe: () => fetchGameMeMock() }));
vi.mock("@/lib/profileRefresh", () => ({
  onProfileRefresh: (fn: () => void) => {
    refresh = fn;
    return () => {
      refresh = null;
    };
  },
}));

import NextStepTrail, { clearTrailCache, isQuietPath } from "./NextStepTrail";

function at(path: string) {
  const { hook } = memoryLocation({ path });
  return render(
    <Router hook={hook}>
      <NextStepTrail />
    </Router>,
  );
}

const member = { user: { id: "u1", role: "member" } };
const step = (label: string, href = "/love-letter") => ({ nextAction: { id: "x", label, href } });

beforeEach(() => {
  clearTrailCache();
  window.sessionStorage.clear();
  useAuthMock.mockReturnValue(member);
});
afterEach(() => {
  vi.clearAllMocks();
});

describe("NextStepTrail", () => {
  it("shows a member the one next step, as a link to it", async () => {
    fetchGameMeMock.mockResolvedValue(step("Sign the Love Letter"));
    at("/quests");
    const link = await screen.findByRole("link", { name: /Sign the Love Letter/ });
    expect(link).toHaveAttribute("href", "/love-letter");
    expect(screen.getByRole("complementary", { name: "Your next step" })).toBeInTheDocument();
  });

  it("draws nothing for a signed-out reader and asks for nothing", () => {
    useAuthMock.mockReturnValue({ user: null });
    const { container } = at("/quests");
    expect(container).toBeEmptyDOMElement();
    expect(fetchGameMeMock).not.toHaveBeenCalled();
  });

  it("stays away from the page the step points at, and from the profile", async () => {
    fetchGameMeMock.mockResolvedValue(step("Find your next Quest", "/quests"));
    const { container } = at("/quests");
    await act(async () => {});
    expect(container).toBeEmptyDOMElement();
    expect(isQuietPath("/profile")).toBe(true);
    expect(isQuietPath("/admin/settings")).toBe(true);
    expect(isQuietPath("/gratitude", "/quests")).toBe(false);
  });

  it("hides a closed step for the tab, and shows the next one when the step moves", async () => {
    fetchGameMeMock.mockResolvedValue(step("Sign the Love Letter"));
    at("/gratitude");
    fireEvent.click(await screen.findByRole("button", { name: "Hide your next step" }));
    expect(screen.queryByRole("complementary")).toBeNull();

    fetchGameMeMock.mockResolvedValue(step("Take your first Quest", "/quests"));
    await act(async () => {
      refresh?.();
    });
    expect(await screen.findByRole("link", { name: /Take your first Quest/ })).toBeInTheDocument();
  });

  it("reads once per half minute across pages, so a click is not a request", async () => {
    fetchGameMeMock.mockResolvedValue(step("Sign the Love Letter"));
    const first = at("/gratitude");
    await screen.findByRole("link", { name: /Sign the Love Letter/ });
    first.unmount();
    at("/events");
    expect(await screen.findByRole("link", { name: /Sign the Love Letter/ })).toBeInTheDocument();
    expect(fetchGameMeMock).toHaveBeenCalledTimes(1);
  });
});
