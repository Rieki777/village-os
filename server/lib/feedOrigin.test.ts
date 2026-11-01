/**
 * THE CALENDAR FEED LIVES ON THE APP, NOT ON THE VILLAGE'S OUTSIDE WEBSITE.
 *
 * `project.siteUrl` is the village's "Main website" link, which on a real
 * village is a static marketing site. The feed preferred it, so production
 * handed members https://<marketing site>/api/events/calendar.ics, an address
 * nothing answers (sweep, 2026-10-31). The feed is served by this app, so its
 * address is FRONTEND_URL, the app's own configured address (as every email,
 * invite and sign-in link already is), or failing that the request's origin.
 *
 * Event UIDs are `<id>@<host>` and every subscribed calendar keys on them.
 * Their host stays the one they were minted with, so moving the feed's
 * ADDRESS does not make a subscriber's calendar drop and re-add every event.
 */
import { describe, expect, it } from "vitest";
import { feedOrigin, feedUidHost } from "./feedOrigin";

const req = (host: string, headers: Record<string, unknown> = {}) => ({
  headers: { host, ...headers },
  protocol: "http",
  get: (name: string) => (name.toLowerCase() === "host" ? host : undefined),
});

const MARKETING = "https://village-marketing.example";
const APP = "https://app.village.example";

describe("the calendar feed's address", () => {
  it("never points at the outside website", () => {
    expect(feedOrigin({ siteUrl: MARKETING, frontendUrl: APP }, req("app.village.example"))).toBe(APP);
    expect(feedOrigin({ siteUrl: MARKETING }, req("app.village.example", { "x-forwarded-proto": "https" }))).toBe(APP);
  });

  it("uses FRONTEND_URL, trimmed, over the request", () => {
    expect(feedOrigin({ frontendUrl: ` ${APP}/ ` }, req("10.0.0.5:8080"))).toBe(APP);
  });

  it("falls back to the request's origin behind a proxy", () => {
    expect(feedOrigin({}, req("app.village.example", { "x-forwarded-proto": "https, http" }))).toBe(APP);
    expect(feedOrigin({}, req("127.0.0.1:5000"))).toBe("http://127.0.0.1:5000");
  });
});

describe("the feed's event UIDs", () => {
  it("keep the host they were minted with when the outside website is set", () => {
    expect(feedUidHost({ siteUrl: MARKETING }, APP)).toBe("village-marketing.example");
  });

  it("use the app's host when there is no outside website", () => {
    expect(feedUidHost({ siteUrl: "" }, APP)).toBe("app.village.example");
    expect(feedUidHost({}, "not a url")).toBe("village");
  });
});
