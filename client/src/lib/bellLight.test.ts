/**
 * Fireflies arriving (Phase B, B2): the bell's three looks, its spoken name,
 * and when a light flies in. Pure rules, so every one is held here.
 */
import { describe, expect, it } from "vitest";
import { NOTIFICATION_KINDS, waitsOnYou } from "@shared/notificationKinds";
import { bellLabel, bellLook, newlyWaiting, waitingCount, waitingIds } from "./bellLight";
import type { FeedItem } from "./notificationFeed";

const at = new Date(0).toISOString();
const item = (id: string, type: string, isRead = false): FeedItem => ({ id, type, title: id, isRead, at });

const vote = item("v1", "ballot_opened");
const thanks = item("g1", "gratitude");
const readVote = item("v0", "ballot_opened", true);

describe("which kinds wait on you", () => {
  it("lights for a vote owed, a consent round, an applicant waiting and a task held", () => {
    for (const k of ["ballot_opened", "role_proposal_consent_ask", "application_interview_turn", "session_action_held", "restorative_intake"]) {
      expect(waitsOnYou(k), k).toBe(true);
    }
  });

  it("keeps news, money, errors and unknown kinds quiet", () => {
    for (const k of ["gratitude", "ballot_carried", "wallet", "payments_alert", "failed_action", "tools", "health", "a_kind_nobody_wrote"]) {
      expect(waitsOnYou(k), k).toBe(false);
    }
  });

  it("never marks a kind that celebrates: a moment is news, never a debt", () => {
    for (const [k, v] of Object.entries(NOTIFICATION_KINDS)) {
      if (v.waits) expect(v.celebrate, k).toBe(false);
    }
  });

  it("never marks an economy kind: fireflies stay away from money", () => {
    for (const [k, v] of Object.entries(NOTIFICATION_KINDS)) {
      if (v.waits) expect(v.group, k).not.toBe("economy");
    }
  });
});

describe("the bell's look", () => {
  it("is lit while an unread notice waits on you, whatever else is new", () => {
    expect(bellLook({ unread: 2, unseen: 2, items: [vote, thanks] })).toBe("lit");
  });

  it("stays lit after the panel is opened, because the vote still waits", () => {
    expect(bellLook({ unread: 1, unseen: 0, items: [vote] })).toBe("lit");
  });

  it("is a still dot when only news is new", () => {
    expect(bellLook({ unread: 1, unseen: 1, items: [thanks, readVote] })).toBe("dot");
  });

  it("is the bell alone once the news is seen and nothing waits", () => {
    expect(bellLook({ unread: 1, unseen: 0, items: [thanks] })).toBe("none");
  });

  it("goes out when the server says nothing is unread, even on a stale list", () => {
    expect(bellLook({ unread: 0, unseen: 0, items: [vote] })).toBe("none");
    expect(waitingCount({ unread: 0, items: [vote] })).toBe(0);
  });
});

describe("the bell's spoken name carries every count the badge showed", () => {
  it("says what waits, what is new, in whole phrases", () => {
    expect(bellLabel({ unread: 3, unseen: 3, items: [vote, item("v2", "ballot_closing"), thanks] })).toBe(
      "Notifications, 2 wait on you, 3 new",
    );
    expect(bellLabel({ unread: 1, unseen: 1, items: [vote] })).toBe("Notifications, 1 waits on you, 1 new");
  });

  it("keeps the unread count once nothing is new", () => {
    expect(bellLabel({ unread: 2, unseen: 0, items: [thanks, item("g2", "gratitude")] })).toBe(
      "Notifications, nothing new, 2 still unread",
    );
    expect(bellLabel({ unread: 0, unseen: 0, items: [] })).toBe("Notifications, nothing new");
  });
});

describe("a light flies in once, for a waiting notice that arrives while the page is open", () => {
  it("seeds the first list in silence", () => {
    expect(newlyWaiting(null, [vote])).toEqual([]);
  });

  it("flies for a new waiting notice, never for news or one already seen", () => {
    const before = new Set(waitingIds([vote]));
    expect(newlyWaiting(before, [vote, thanks])).toEqual([]);
    expect(newlyWaiting(before, [item("v9", "veto_window_opened"), vote])).toEqual(["v9"]);
  });

  it("never flies for a notice that arrives already read", () => {
    expect(newlyWaiting(new Set(), [readVote])).toEqual([]);
  });
});
