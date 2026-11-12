// @vitest-environment jsdom
/**
 * Fireflies arriving (Phase B, B2). The bell shows no number on screen: a few
 * fireflies rest on it while something waits on you, a still dot when there is
 * only news, and nothing otherwise. The count lives on in the bell's spoken
 * name, and a waiting notice that arrives while the page is open flies its
 * light in once.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { Router } from "wouter";

type Item = { id: string; type: string; title: string; isRead: boolean; at: string; link?: string };
type Snap = { items: Item[]; unread: number; unseen: number; loaded: boolean };

const store = vi.hoisted(() => {
  let snap: Snap = { items: [], unread: 0, unseen: 0, loaded: false };
  const listeners = new Set<() => void>();
  return {
    get: () => snap,
    set(next: Snap) {
      snap = next;
      for (const l of Array.from(listeners)) l();
    },
    subscribe(l: () => void) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
});

vi.mock("@/lib/notificationStore", () => ({
  getNotifyState: () => store.get(),
  subscribeNotifications: (l: () => void) => store.subscribe(l),
  refreshNotifications: vi.fn(async () => {}),
  markNotificationsSeen: vi.fn(async () => {}),
  markNotificationsRead: vi.fn(async () => 0),
}));

import NotificationBell from "./NotificationBell";

const at = new Date().toISOString();
const vote: Item = { id: "v1", type: "ballot_opened", title: "A vote opened", isRead: false, at, link: "/decisions" };
const thanks: Item = { id: "g1", type: "gratitude", title: "You were thanked", isRead: false, at, link: "/gratitude" };

function mount(snap: Snap) {
  store.set(snap);
  return render(
    <Router>
      <NotificationBell />
    </Router>,
  );
}

afterEach(() => {
  cleanup();
  store.set({ items: [], unread: 0, unseen: 0, loaded: false });
});

describe("the bell's number becomes fireflies", () => {
  it("shows no number anywhere on the bell, however many are new", () => {
    mount({ items: [vote, thanks], unread: 12, unseen: 12, loaded: true });
    const bell = screen.getByRole("button", { name: /Notifications/ });
    expect(bell.textContent).toBe("");
  });

  it("rests fireflies on the bell while a notice waits on you, and says the count aloud", async () => {
    mount({ items: [vote, thanks], unread: 2, unseen: 2, loaded: true });
    expect(await screen.findByTestId("bell-fireflies")).toBeTruthy();
    expect(screen.queryByTestId("bell-news-dot")).toBeNull();
    expect(screen.getByRole("button", { name: "Notifications, 1 waits on you, 2 new" })).toBeTruthy();
  });

  it("shows a still dot, no light, when only news is new", () => {
    mount({ items: [thanks], unread: 1, unseen: 1, loaded: true });
    expect(screen.getByTestId("bell-news-dot")).toBeTruthy();
    expect(screen.queryByTestId("bell-fireflies")).toBeNull();
    expect(screen.getByRole("button", { name: "Notifications, 1 new" })).toBeTruthy();
  });

  it("is the bell alone when nothing is new and nothing waits", () => {
    mount({ items: [{ ...thanks, isRead: true }], unread: 0, unseen: 0, loaded: true });
    expect(screen.queryByTestId("bell-news-dot")).toBeNull();
    expect(screen.queryByTestId("bell-fireflies")).toBeNull();
  });

  it("marks a waiting row in words in the panel, so the light is explained", async () => {
    mount({ items: [vote, thanks], unread: 2, unseen: 2, loaded: true });
    act(() => screen.getByRole("button", { name: /Notifications/ }).click());
    expect(screen.getAllByText("Waits on you")).toHaveLength(1);
  });
});

describe("a firefly arrives once", () => {
  it("does not fly for what was already waiting when the page loaded", async () => {
    mount({ items: [vote], unread: 1, unseen: 1, loaded: true });
    const ff = await screen.findByTestId("bell-fireflies");
    expect(ff.getAttribute("data-arrival")).toBe("false");
  });

  it("flies in when a waiting notice arrives while the page is open", async () => {
    mount({ items: [thanks], unread: 1, unseen: 1, loaded: true });
    expect(screen.queryByTestId("bell-fireflies")).toBeNull();
    const fresh: Item = { ...vote, id: "v2", type: "role_proposal_consent_ask" };
    act(() => store.set({ items: [fresh, thanks], unread: 2, unseen: 2, loaded: true }));
    const ff = await screen.findByTestId("bell-fireflies");
    expect(ff.getAttribute("data-arrival")).toBe("true");
  });

  it("does not fly for news arriving while the page is open", async () => {
    mount({ items: [vote], unread: 1, unseen: 1, loaded: true });
    await screen.findByTestId("bell-fireflies");
    act(() => store.set({ items: [{ ...thanks, id: "g9" }, vote], unread: 2, unseen: 2, loaded: true }));
    const ff = await screen.findByTestId("bell-fireflies");
    expect(ff.getAttribute("data-arrival")).toBe("false");
  });
});

describe("one light per screen (batch 158)", () => {
  it("keeps one still light on the bell while the page shows its own lit act, and the swarm returns after", async () => {
    const { default: Fireflies } = await import("@/components/journey/nature/Fireflies");
    store.set({ items: [vote], unread: 1, unseen: 1, loaded: true });
    const view = render(
      <Router>
        <NotificationBell />
        <Fireflies block>
          <button type="button">Take your turn</button>
        </Fireflies>
      </Router>,
    );
    expect(screen.getByTestId("bell-still-light")).toBeTruthy();
    expect(screen.queryByTestId("bell-fireflies")).toBeNull();
    // The count still lives in the bell's name.
    expect(screen.getByRole("button", { name: "Notifications, 1 waits on you, 1 new" })).toBeTruthy();
    view.rerender(
      <Router>
        <NotificationBell />
      </Router>,
    );
    expect(await screen.findByTestId("bell-fireflies")).toBeTruthy();
    expect(screen.queryByTestId("bell-still-light")).toBeNull();
  });

  it("an illustration's fireflies (no act inside) leave the bell's swarm alone", async () => {
    const { default: Fireflies } = await import("@/components/journey/nature/Fireflies");
    store.set({ items: [vote], unread: 1, unseen: 1, loaded: true });
    render(
      <Router>
        <NotificationBell />
        <Fireflies />
      </Router>,
    );
    expect(await screen.findByTestId("bell-fireflies")).toBeTruthy();
    expect(screen.queryByTestId("bell-still-light")).toBeNull();
  });
});
