/**
 * Following circles on a calendar, without a database: reading the circles to
 * follow, the key's shape, the addresses a calendar app is given, and the
 * words. The doors and the feed run against a real schema in
 * server/sessionCalendar.db.test.ts.
 */
import { describe, expect, it } from "vitest";
import {
  CALENDAR_COPY,
  CALENDAR_REFUSALS,
  CIRCLE_FEED_PATH,
  cleanFollow,
  feedUrl,
  googleAddUrl,
  looksLikeFeedKey,
  meetingTitle,
  webcalUrl,
} from "./sessionCalendar";

const LIVE = new Set(["garden", "kitchen"]);
const KEY = "a".repeat(64);

describe("reading the circles to follow", () => {
  it("reads live circles, once each, in order", () => {
    expect(cleanFollow({ all: false, circleIds: ["kitchen", "garden", "kitchen"] }, LIVE)).toEqual({ ok: true, value: { all: false, circleIds: ["garden", "kitchen"] } });
    expect(cleanFollow({ circleIds: [] }, LIVE)).toEqual({ ok: true, value: { all: false, circleIds: [] } });
  });

  it("reads every circle as one choice, whatever else is sent", () => {
    expect(cleanFollow({ all: true, circleIds: ["garden"] }, LIVE)).toEqual({ ok: true, value: { all: true, circleIds: [] } });
  });

  it("refuses a circle that is not a live one, and anything that is not a name", () => {
    expect(cleanFollow({ circleIds: ["moon"] }, LIVE)).toMatchObject({ ok: false, status: 400, error: CALENDAR_REFUSALS.circleUnknown });
    expect(cleanFollow({ circleIds: [7] }, LIVE)).toMatchObject({ ok: false, error: CALENDAR_REFUSALS.circleUnknown });
  });
});

describe("the address", () => {
  it("knows a key by its shape alone", () => {
    expect(looksLikeFeedKey(KEY)).toBe(true);
    expect(looksLikeFeedKey("A".repeat(64))).toBe(false);
    expect(looksLikeFeedKey(KEY.slice(1))).toBe(false);
    expect(looksLikeFeedKey(["x"])).toBe(false);
  });

  it("gives a calendar app the address three ways: as it is, to subscribe, and through Google", () => {
    const url = feedUrl("https://village.example.test/", KEY);
    expect(url).toBe(`https://village.example.test${CIRCLE_FEED_PATH}?key=${KEY}`);
    expect(webcalUrl(url)).toBe(`webcal://village.example.test${CIRCLE_FEED_PATH}?key=${KEY}`);
    expect(googleAddUrl(url)).toBe(`https://calendar.google.com/calendar/render?cid=${encodeURIComponent(webcalUrl(url))}`);
  });
});

describe("the words", () => {
  it("names a meeting by its circle", () => {
    expect(meetingTitle("Garden")).toBe("Garden circle meeting");
    expect(meetingTitle("Kitchen circle")).toBe("Kitchen circle meeting");
  });

  it("says what a save did", () => {
    expect(CALENDAR_COPY.saved(0, true)).toBe("Saved. Your calendar follows every circle.");
    expect(CALENDAR_COPY.saved(0, false)).toBe("Saved. Your calendar follows no circle now.");
    expect(CALENDAR_COPY.saved(1, false)).toBe("Saved. Your calendar follows 1 circle.");
    expect(CALENDAR_COPY.saved(3, false)).toBe("Saved. Your calendar follows 3 circles.");
  });
});
