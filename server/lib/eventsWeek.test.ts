/**
 * The week-ahead reader, its template, its router entry, and the member draft
 * kind (round 4, lane L6). Harm metric 5's pure half: "what is on this week"
 * routes to the deterministic road, so the route writes a zero-token row.
 * Harm metric 2's guarantee that `event_rsvp` never enters assistant_drafts is
 * proven here against `checkDraft` itself.
 */
import { describe, expect, it } from "vitest";
import { READERS, READER_KEYS, villageTimezone, wireReaders } from "./villageReaders";
import { RENDERERS, clockIn, renderWeek } from "./assistantTemplates";
import { routeQuestion } from "./assistantRouter";
import { checkDraft } from "./drafts";
import { ALL_DRAFT_KINDS, DRAFT_KINDS, MEMBER_DRAFT_KINDS, validateDraftPayload } from "../../shared/draftKinds";

const ALL = [...READER_KEYS];

describe("the reader", () => {
  it("is registered for members behind the events module", () => {
    const r = READERS.find((x) => x.key === "events.week")!;
    expect(r).toBeTruthy();
    expect(r.audience).toBe("member");
    expect(r.module).toBe("events");
    expect(r.maxTokens).toBe(500);
  });

  it("reads the village timezone from the deps, and UTC when none was wired", () => {
    wireReaders({ moduleIsOn: () => true, boolVar: () => true });
    expect(villageTimezone()).toBe("UTC");
    wireReaders({ moduleIsOn: () => true, boolVar: () => true, timezone: () => "America/Costa_Rica" });
    expect(villageTimezone()).toBe("America/Costa_Rica");
    wireReaders({ moduleIsOn: () => true, boolVar: () => true });
  });
});

describe("the template", () => {
  it("says the week in village time", () => {
    // 2026-08-18T18:00Z is Tuesday 12:00 in Costa Rica (UTC-6) and Tue 18:00 in UTC.
    expect(clockIn("2026-08-18T18:00:00.000Z", "UTC")).toBe("Tue 18:00");
    expect(clockIn("2026-08-18T18:00:00.000Z", "America/Costa_Rica")).toBe("Tue 12:00");
    const out = renderWeek([
      { id: "ev-1", title: "Kitchen crew", startsAt: "2026-08-18T18:00:00.000Z" },
      { id: "ev-2", title: "Land walk", startsAt: "2026-08-20T13:30:00.000Z" },
    ], "UTC");
    expect(out?.reply).toBe("This week: 2 gatherings: Kitchen crew (Tue 18:00), Land walk (Thu 13:30).");
    expect(out?.consulted.readers).toEqual(["events.week"]);
  });

  it("says when nothing is on, and refuses a shape it does not know", () => {
    expect(renderWeek([], "UTC")?.reply).toBe("Nothing is on the calendar for the next seven days.");
    expect(renderWeek({ truncated: true, note: "too big" }, "UTC")).toBeNull();
    expect(renderWeek([{ id: "ev-1" }], "UTC")).toBeNull();
  });

  it("falls back to UTC on a bad zone instead of throwing", () => {
    expect(clockIn("2026-08-18T18:00:00.000Z", "Mars/Olympus")).toBe("Tue 18:00");
  });

  it("is in the RENDERERS table", () => {
    expect(typeof RENDERERS["events.week"]).toBe("function");
  });
});

describe("the router (harm metric 5, pure half)", () => {
  for (const q of ["what is on this week", "what's on this week", "show me the calendar", "what gatherings are coming up", "are there any events this week"]) {
    it(`answers "${q}" from events.week with no model`, () => {
      const road = routeQuestion(q, ALL);
      expect(road.kind).toBe("deterministic");
      if (road.kind === "deterministic") expect(road.reader).toBe("events.week");
    });
  }

  it("does not steal the calendar question from a member who cannot see the reader", () => {
    const road = routeQuestion("what is on this week", ALL.filter((k) => k !== "events.week"));
    expect(road.kind).not.toBe("deterministic");
  });

  it("still routes the old questions to the old readers", () => {
    expect(routeQuestion("what roles do we have", ALL)).toMatchObject({ kind: "deterministic", reader: "roles.all" });
    expect(routeQuestion("what have we decided", ALL)).toMatchObject({ kind: "deterministic", reader: "record.decisions" });
  });
});

describe("the member draft kind", () => {
  it("is a sibling of DRAFT_KINDS, never a member of it", () => {
    expect(DRAFT_KINDS).toEqual(["role", "circle"]);
    expect(MEMBER_DRAFT_KINDS).toEqual(["event_rsvp"]);
    // `admin_edit` is a member's suggested edit (shared/suggestions.ts), a third sibling.
    expect(ALL_DRAFT_KINDS).toEqual(["role", "circle", "event_rsvp", "admin_edit"]);
    expect(checkDraft({ kind: "admin_edit", payload: {}, proposerHolds: [] }).ok).toBe(false);
  });

  it("validates an event_rsvp payload", () => {
    expect(validateDraftPayload("event_rsvp", { eventId: "ev-1", status: "going" })).toBeNull();
    expect(validateDraftPayload("event_rsvp", { eventId: "ev-1", status: "going", occurrenceKey: "2026-08-18" })).toBeNull();
    expect(validateDraftPayload("event_rsvp", { eventId: "ev-1", status: "yes" })).toContain("status");
    expect(validateDraftPayload("event_rsvp", { eventId: "", status: "going" })).toContain("eventId");
    expect(validateDraftPayload("event_rsvp", { eventId: "ev-1", status: "going", userId: "u-2" })).toContain("unexpected field");
  });

  it("can never enter assistant_drafts: checkDraft refuses it by kind", () => {
    expect(checkDraft({ kind: "event_rsvp", payload: { eventId: "ev-1", status: "going" }, proposerHolds: [] })).toEqual({
      ok: false,
      error: "unknown draft kind: event_rsvp",
    });
  });
});
