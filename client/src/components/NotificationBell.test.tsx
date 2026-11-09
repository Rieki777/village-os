// @vitest-environment jsdom
/**
 * The bell is the one place a restorative intake's recipient can read the
 * sender's words: the email for that kind carries the title alone
 * (server/lib/notify.ts, `emailCarriesBody`). So the intake's row must show
 * its body whole, where every other row is cut to two lines.
 *
 * jsdom does no layout, so nothing here can measure how many lines a span
 * shows. What it holds is the CAUSE: which class the row's second line
 * carries. Put `line-clamp-2` back on every row in NotificationBell.tsx and
 * the first test fails on the intake's words.
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { Router } from "wouter";

const WORDS =
  "Somebody pushed me at the market this morning and I have not felt safe since. " +
  "I would like to talk with somebody about repairing it before the next gathering.";

const ITEMS = [
  {
    id: "n-intake",
    type: "restorative_intake",
    title: "A private intake is waiting for you",
    body: `A member wrote: ${WORDS}`,
    link: "/profile",
    isRead: false,
    at: new Date().toISOString(),
  },
  {
    id: "n-thanks",
    type: "gratitude",
    title: "You were thanked",
    body: "Thank you for fixing the pump by the long field before the frost came in.",
    link: "/gratitude",
    isRead: false,
    at: new Date(Date.now() - 60_000).toISOString(),
  },
];

// One object, handed back every time: useSyncExternalStore re-renders forever
// on a snapshot that is a new object on each read.
const STATE = { items: ITEMS, unread: 2, unseen: 2, loaded: true };

vi.mock("@/lib/notificationStore", () => ({
  getNotifyState: () => STATE,
  subscribeNotifications: () => () => {},
  refreshNotifications: vi.fn(async () => {}),
  markNotificationsSeen: vi.fn(async () => {}),
  markNotificationsRead: vi.fn(async () => 0),
}));

import NotificationBell from "./NotificationBell";

function openBell() {
  render(
    <Router>
      <NotificationBell />
    </Router>,
  );
  fireEvent.click(screen.getByRole("button", { name: /Notifications/ }));
}

describe("the bell's second line", () => {
  it("shows a restorative intake's words whole, never cut to two lines", () => {
    openBell();
    const line = screen.getByText(`A member wrote: ${WORDS}`);
    expect(line.className).toContain("whitespace-pre-wrap");
    expect(line.className).not.toContain("line-clamp-2");
  });

  it("still cuts every other kind's body to two lines", () => {
    openBell();
    const line = screen.getByText(/Thank you for fixing the pump/);
    expect(line.className).toContain("line-clamp-2");
  });
});
