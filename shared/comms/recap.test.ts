import { describe, expect, it } from "vitest";
import {
  draftRecap,
  nextGatheringOrder,
  recapAudience,
  recapComposerPath,
  recapSendRefusal,
  recapWindowClosesAt,
  type AttendanceMark,
  type NextCandidate,
  type RecapSendFacts,
} from "./recap";

const marks = (entries: Array<[string, AttendanceMark]>) => new Map<string, AttendanceMark>(entries);

describe("who gets which recap (5.9)", () => {
  it("sends the came version to everybody who said yes when nobody is marked", () => {
    expect(recapAudience(["u1", "guest:ct1", "u2"], marks([]))).toEqual({ came: ["u1", "guest:ct1", "u2"], missed: [] });
  });

  it("sends the missed version only to people the host marked missed", () => {
    const out = recapAudience(["u1", "guest:ct1", "u2", "u3"], marks([["u1", "came"], ["guest:ct1", "missed"], ["u2", "missed"]]));
    expect(out.missed).toEqual(["guest:ct1", "u2"]);
    // u3 was never ticked either way: nobody is told they were missed unless the host said so.
    expect(out.came).toEqual(["u1", "u3"]);
  });

  it("includes somebody marked came who never said yes, after the people who did", () => {
    expect(recapAudience(["u1"], marks([["walk-in", "came"], ["u1", "came"]]))).toEqual({ came: ["u1", "walk-in"], missed: [] });
  });

  it("never sends a marked-missed person who did not say yes anything at all", () => {
    expect(recapAudience(["u1"], marks([["stranger", "missed"]]))).toEqual({ came: ["u1"], missed: [] });
  });

  it("sends one version per person however often they appear", () => {
    expect(recapAudience(["u1", "u1"], marks([["u1", "missed"]]))).toEqual({ came: [], missed: ["u1"] });
  });
});

describe("when a recap may go", () => {
  const T = Date.parse("2026-10-05T18:00:00Z");
  const H = 3_600_000;
  const facts = (over: Partial<RecapSendFacts> = {}): RecapSendFacts => ({
    state: "draft",
    bodyMd: "We planted the bed.",
    startsAt: T - 3 * H,
    endsAt: T - H,
    now: T,
    windowDays: 3,
    commsLifecycle: "public",
    ...over,
  });

  it("sends a written draft inside the window", () => {
    expect(recapSendRefusal(facts())).toBeNull();
    expect(recapSendRefusal(facts({ commsLifecycle: "preview" }))).toBeNull();
  });

  it("refuses a recap already sent, an empty one, a switched-off module, an early one and a late one", () => {
    expect(recapSendRefusal(facts({ state: "sent" }))).toContain("already gone out");
    expect(recapSendRefusal(facts({ bodyMd: "  \n " }))).toContain("Write the recap first");
    expect(recapSendRefusal(facts({ state: null, bodyMd: "" }))).toContain("Write the recap first");
    expect(recapSendRefusal(facts({ commsLifecycle: "off" }))).toContain("switched off");
    expect(recapSendRefusal(facts({ startsAt: T + H, endsAt: T + 2 * H }))).toContain("once the gathering has begun");
    expect(recapSendRefusal(facts({ now: T - H + 3 * 86_400_000 + 1 }))).toContain("has passed");
  });

  it("measures the window from the end, or from the start when there is no end", () => {
    expect(recapWindowClosesAt({ startsAt: 0, endsAt: 1000, windowDays: 3 })).toBe(1000 + 3 * 86_400_000);
    expect(recapWindowClosesAt({ startsAt: 0, endsAt: null, windowDays: 2 })).toBe(2 * 86_400_000);
    // A dial read as nonsense still leaves a day.
    expect(recapWindowClosesAt({ startsAt: 0, endsAt: null, windowDays: 0 })).toBe(86_400_000);
  });
});

describe("Draft it for me", () => {
  it("counts who came, keeps the host's notes, and says thank you", () => {
    const md = draftRecap({ title: "Seed swap", dateLine: "Saturday, October 4", came: 14, going: 16, notes: "We sorted the seed bank." });
    expect(md).toBe("14 of us came to Seed swap on Saturday, October 4.\n\nWe sorted the seed bank.\n\nThank you to everyone who came.");
  });

  it("counts the people who said yes when nobody is marked, and says which count it is", () => {
    expect(draftRecap({ title: "Supper", dateLine: "Friday", came: null, going: 1, notes: "" })).toBe(
      "One person said yes to Supper on Friday.\n\nThank you to everyone who came.",
    );
    expect(draftRecap({ title: "Supper", dateLine: "", came: 0, going: 0, notes: "" })).toBe("We met for Supper.\n\nThank you to everyone who came.");
    expect(draftRecap({ title: "Supper", dateLine: "Friday", came: 1, going: 3, notes: "" })).toMatch(/^One of us came to Supper on Friday\./);
  });
});

describe("the next gathering a recap offers", () => {
  const NOW = Date.parse("2026-10-05T12:00:00Z");
  const day = (d: number) => new Date(NOW + d * 86_400_000).toISOString();
  const item = (over: Partial<NextCandidate>): NextCandidate => ({
    id: "ev-x",
    occurrenceKey: "",
    title: "Thing",
    startsAt: day(2),
    status: "scheduled",
    layer: "public",
    kind: "gathering",
    ...over,
  });

  it("offers the same series' next evening first, then the soonest other gathering", () => {
    const items = [
      item({ id: "other", startsAt: day(1) }),
      item({ id: "weekly", occurrenceKey: "2026-10-12", startsAt: day(7) }),
      item({ id: "weekly", occurrenceKey: "2026-10-19", startsAt: day(14) }),
    ];
    const order = nextGatheringOrder(items, { eventId: "weekly", occurrenceKey: "2026-10-05", now: NOW, layers: ["public", "village"] });
    expect(order.map((c) => `${c.id}:${c.occurrenceKey}`)).toEqual(["weekly:2026-10-12", "weekly:2026-10-19", "other:"]);
  });

  it("never offers the evening being recapped, one that started, a draft, a cancelled one, the sky, or a layer the reader cannot answer", () => {
    const items = [
      item({ id: "this", occurrenceKey: "" }),
      item({ id: "past", startsAt: day(-1) }),
      item({ id: "draft", status: "draft" }),
      item({ id: "off", status: "cancelled" }),
      item({ id: "sky", kind: "sky" }),
      item({ id: "members", layer: "village" }),
      item({ id: "ok", startsAt: day(3) }),
    ];
    expect(nextGatheringOrder(items, { eventId: "this", occurrenceKey: "", now: NOW, layers: ["public"] }).map((c) => c.id)).toEqual(["ok"]);
    expect(nextGatheringOrder(items, { eventId: "this", occurrenceKey: "", now: NOW, layers: ["public", "village"] }).map((c) => c.id)).toEqual([
      "members",
      "ok",
    ]);
  });

  it("opens the composer at a path the calendar reads", () => {
    expect(recapComposerPath("ev-1", "")).toBe("/events?recap=ev-1");
    expect(recapComposerPath("ev-1", "2026-10-05")).toBe("/events?recap=ev-1&occ=2026-10-05");
  });
});
