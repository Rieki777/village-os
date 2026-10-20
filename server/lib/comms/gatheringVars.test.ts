import { describe, expect, it } from "vitest";
import { platformTemplate } from "../../../shared/comms/defaults/templates";
import { composeEmail } from "../../../shared/comms/letterHtml";
import { fieldProblems, tokensIn } from "../../../shared/comms/mergeFields";
import type { CalendarRow } from "../calendar";
import { verifyLink } from "./links";
import { cantMakeItLink, gatheringValues, nextOccurrence, occurrenceOf, snapshotOf, whenValues, type GatheringSnapshot } from "./gatheringVars";
import { eventSubjectOf } from "./gatheringJourney";

/**
 * What a gathering email knows (the comms build spec 5.5 and 5.7): one
 * evening found by its key, the fields filled from it, and every default
 * gathering email rendered with them.
 */

const TZ = "America/Costa_Rica";
const ORIGIN = "https://village.example.test";
const NOW = new Date("2026-10-01T12:00:00Z");

const row = (over: Partial<CalendarRow> = {}): CalendarRow => ({
  id: "ev-1",
  title: "Community supper",
  description: "Bring a dish if you can.",
  startsAt: new Date("2026-10-05T00:00:00Z"),
  endsAt: new Date("2026-10-05T02:00:00Z"),
  locationText: "The common house",
  structureKeys: [],
  visitTypeId: null,
  capacity: null,
  status: "scheduled",
  attendanceMode: "mixed",
  onlineUrl: "https://meet.example.test/room",
  isExample: false,
  kind: "gathering",
  layer: "village",
  ownerUserId: null,
  allDay: false,
  sourceModule: null,
  sourceId: null,
  link: null,
  colour: null,
  recurrence: null,
  externalSourceId: null,
  externalUid: null,
  removedAt: null,
  updatedAt: NOW,
  seatPrice: 0,
  seatToken: null,
  ...over,
});

describe("one evening of a gathering", () => {
  it("is the one-off itself, whatever key it is asked for", () => {
    const occ = occurrenceOf(row(), "", TZ)!;
    expect(occ.occurrenceKey).toBe("");
    expect(occ.startsAt.toISOString()).toBe("2026-10-05T00:00:00.000Z");
  });

  it("is found by its village date in a weekly series, moved where the host moved it, and gone when taken out", () => {
    // Sunday 4 October 2026, 18:00 in Costa Rica, every Sunday.
    const weekly = row({ recurrence: { freq: "weekly", byWeekday: [0], interval: 1, overrides: { "2026-10-11": { startsAt: "2026-10-13T00:00:00.000Z" } }, exceptions: ["2026-10-18"] } as any });
    expect(occurrenceOf(weekly, "2026-10-04", TZ)!.startsAt.toISOString()).toBe("2026-10-05T00:00:00.000Z");
    expect(occurrenceOf(weekly, "2026-10-11", TZ)!.startsAt.toISOString()).toBe("2026-10-13T00:00:00.000Z");
    expect(occurrenceOf(weekly, "2026-10-18", TZ)).toBeNull();
    expect(occurrenceOf(weekly, "2026-10-05", TZ), "a Monday the rule never lands on").toBeNull();
    expect(occurrenceOf(weekly, "", TZ), "a series needs an evening's date").toBeNull();
    expect(nextOccurrence(weekly, TZ, NOW)!.occurrenceKey).toBe("2026-10-04");
  });

  it("writes an all-day gathering as its day alone", () => {
    const w = whenValues({ startsAt: new Date("2026-10-04T06:00:00Z"), allDay: true }, TZ, "Europe/Lisbon");
    expect(w.when).toBe("Sunday, October 4");
    expect(w.whenLocal).toBe("");
  });

  it("signs a can't make it link for one person and one evening, with ids only", () => {
    const link = cantMakeItLink(ORIGIN, { eventId: "ev-1", occurrenceKey: "2026-10-04", personKey: "guest:ct_abc", startsAt: NOW, endsAt: null }, NOW)!;
    const token = decodeURIComponent(link.split("t=")[1]);
    expect(verifyLink("cant_make_it", token, { now: NOW.getTime() })).toEqual({ e: "ev-1", p: "guest:ct_abc", o: "2026-10-04" });
    expect(verifyLink("unsubscribe", token, { now: NOW.getTime() })).toBeNull();
    // A person key that cannot go in a link leaves the line out instead of throwing.
    expect(cantMakeItLink(ORIGIN, { eventId: "ev-1", occurrenceKey: "", personKey: "a b@c", startsAt: NOW, endsAt: null }, NOW)).toBeNull();
  });

  it("reads a subject back into its gathering and evening", () => {
    expect(eventSubjectOf("event:ev-1:")).toEqual({ eventId: "ev-1", occurrenceKey: "" });
    expect(eventSubjectOf("event:ev-1-x:2026-10-04")).toEqual({ eventId: "ev-1-x", occurrenceKey: "2026-10-04" });
    expect(eventSubjectOf("path:resident")).toBeNull();
  });
});

describe("every default gathering email, with the fields this lane fills", () => {
  const KEYS = [
    "gathering.confirm",
    "gathering.reminder_day",
    "gathering.reminder_soon",
    "gathering.changed",
    "gathering.cancelled",
    "gathering.waitlisted",
    "gathering.promoted",
    "gathering.host_nudge",
  ];
  const village = { name: "Test Village", url: ORIGIN, logoUrl: null, seed: null, character: null, postalAddress: "1 Orchard Lane" };

  async function values(g: GatheringSnapshot) {
    // The host's name is handed in, so nothing here reads a database.
    return gatheringValues(null as never, g, { origin: ORIGIN, villageZone: TZ, readerZone: "Europe/Lisbon", personKey: "user-1", hostName: "Hana Host", now: NOW });
  }

  it("uses only fields the catalogue has, and only ones the email may know", () => {
    for (const key of KEYS) {
      const t = platformTemplate(key)!;
      const problems = fieldProblems(key, `${t.subject}\n${t.preheader ?? ""}\n${t.bodyMd}`);
      expect(problems, key).toEqual({ unknown: [], unavailable: [] });
    }
  });

  it("renders each one with every gathering field it names filled, nothing falling back", async () => {
    const g = snapshotOf(row(), occurrenceOf(row(), "", TZ)!);
    const v = { "person.firstName": "Sam", "person.name": "Sam Rivers", ...(await values(g)) };
    for (const key of KEYS) {
      const t = platformTemplate(key)!;
      const email = composeEmail({ words: { subject: t.subject, preheader: t.preheader, bodyMd: t.bodyMd }, values: v, village, kind: "events", templateKey: key });
      const named = tokensIn(`${t.subject}\n${t.preheader ?? ""}\n${t.bodyMd}`).filter((f) => f.startsWith("gathering."));
      expect(email.missing.filter((f) => named.includes(f)), key).toEqual([]);
      expect(email.omitted.filter((f) => named.includes(f)), key).toEqual([]);
      expect(email.unknown, key).toEqual([]);
      expect(email.subject, key).toContain("Community supper");
    }
  });

  it("leaves out the room for a gathering that meets in person, and the place for one only online", async () => {
    const inPerson = await values(snapshotOf(row({ attendanceMode: "offline" }), occurrenceOf(row(), "", TZ)!));
    expect(inPerson["gathering.joinLink"]).toBe("");
    const online = await values(snapshotOf(row({ attendanceMode: "online" }), occurrenceOf(row(), "", TZ)!));
    expect(online["gathering.where"]).toBe("");
    expect(online["gathering.joinLink"]).toBe(`${ORIGIN}/api/events/ev-1/join`);
  });
});
