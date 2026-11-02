/**
 * The Events module's pure logic.
 *
 * `daysUntil` is the one the map depends on: it brightens a building by how
 * soon the next gathering there is, so an off-by-one here is a lantern lit on
 * the wrong evening. The capacity helpers are tested for the two answers that
 * are easy to get wrong, null and zero, because both are real and they mean
 * opposite things.
 */
import { describe, expect, it } from "vitest";
import {
  daysUntil,
  isFull,
  spotsLeft,
  toSchemaOrg,
  type Gathering,
} from "./gatherings";

const at = (iso: string) => new Date(iso);

describe("daysUntil", () => {
  it("counts calendar days, not 24-hour blocks", () => {
    // 13 hours apart and still "tomorrow" to a person. Dividing the gap by
    // 86400000 would floor this to 0 and call both the same day.
    const now = at("2026-08-08T21:00:00Z");
    expect(daysUntil("2026-08-09T10:00:00Z", now)).toBe(1);
  });

  it("is 0 for anything later today, including the past hour", () => {
    const now = at("2026-08-08T21:00:00Z");
    expect(daysUntil("2026-08-08T23:30:00Z", now)).toBe(0);
    expect(daysUntil("2026-08-08T08:00:00Z", now)).toBe(0);
  });

  it("goes negative once the day has passed", () => {
    expect(daysUntil("2026-08-05T12:00:00Z", at("2026-08-08T00:30:00Z"))).toBe(-3);
  });

  it("crosses months and years without drifting", () => {
    expect(daysUntil("2026-09-01T00:00:00Z", at("2026-08-31T23:00:00Z"))).toBe(1);
    expect(daysUntil("2027-01-01T00:00:00Z", at("2026-12-31T12:00:00Z"))).toBe(1);
    // 2028 is a leap year, so February has a 29th to step over.
    expect(daysUntil("2028-03-01T00:00:00Z", at("2028-02-28T00:00:00Z"))).toBe(2);
  });

  it("reads an unparseable date as today instead of throwing", () => {
    expect(daysUntil("not a date", at("2026-08-08T00:00:00Z"))).toBe(0);
  });
});

describe("capacity", () => {
  it("treats null as uncapped and 0 as nobody", () => {
    expect(spotsLeft(null, 40)).toBeNull();
    expect(isFull(null, 40)).toBe(false);
    // The trap: `if (!capacity)` would read 0 as uncapped and let the whole
    // village in to a gathering explicitly capped at nobody.
    expect(spotsLeft(0, 0)).toBe(0);
    expect(isFull(0, 0)).toBe(true);
  });

  it("never reports negative spots when a cap was lowered under a crowd", () => {
    expect(spotsLeft(5, 9)).toBe(0);
    expect(isFull(5, 9)).toBe(true);
  });

  it("is full at exactly the cap, not one past it", () => {
    expect(isFull(10, 9)).toBe(false);
    expect(isFull(10, 10)).toBe(true);
  });
});

const gathering = (over: Partial<Gathering> = {}): Gathering => ({
  id: "ev-1",
  title: "Harvest work party",
  description: "Bring gloves.",
  startsAt: "2026-09-01T09:00:00.000Z",
  endsAt: "2026-09-01T13:00:00.000Z",
  locationText: "The greenhouse",
  structureKeys: ["greenhouse"],
  visitTypeId: null,
  capacity: 20,
  status: "scheduled",
  attendanceMode: "offline",
  onlineUrl: null,
  goingCount: 3,
  spotsLeft: 17,
  daysUntil: 24,
  ...over,
});

describe("toSchemaOrg", () => {
  it("emits the fields a crawler needs, with full status URLs", () => {
    const doc = toSchemaOrg(gathering())!;
    expect(doc["@type"]).toBe("Event");
    expect(doc.name).toBe("Harvest work party");
    expect(doc.startDate).toBe("2026-09-01T09:00:00.000Z");
    expect(doc.endDate).toBe("2026-09-01T13:00:00.000Z");
    expect(doc.eventStatus).toBe("https://schema.org/EventScheduled");
    expect(doc.eventAttendanceMode).toBe("https://schema.org/OfflineEventAttendanceMode");
    expect(doc.maximumAttendeeCapacity).toBe(20);
    expect(doc.location).toEqual({ "@type": "Place", name: "The greenhouse" });
  });

  it("names no page for the event, because no host serves one", () => {
    // It read `<siteUrl>/events/<id>`: the outside website has no such page and
    // the app shows events only on its calendar, `/events`, which is not this
    // event's page (sweep, 2026-10-31). A url schema.org reads as the event's
    // own page is left out until one exists. `as any` passes what the server
    // used to, to prove it is ignored.
    const doc = (toSchemaOrg as any)(gathering(), { siteUrl: "https://village.example" });
    expect(doc).not.toHaveProperty("url");
  });

  it("refuses to mark up a draft", () => {
    // An unpublished gathering must never reach a search index.
    expect(toSchemaOrg(gathering({ status: "draft" }))).toBeNull();
  });

  it("maps cancelled and postponed to their own schema.org states", () => {
    expect(toSchemaOrg(gathering({ status: "cancelled" }))!.eventStatus)
      .toBe("https://schema.org/EventCancelled");
    expect(toSchemaOrg(gathering({ status: "postponed" }))!.eventStatus)
      .toBe("https://schema.org/EventPostponed");
  });

  it("gives an online gathering a VirtualLocation and a mixed one both", () => {
    const online = toSchemaOrg(gathering({
      attendanceMode: "online", locationText: null, onlineUrl: "https://meet.example/abc",
    }))!;
    expect(online.location).toEqual({ "@type": "VirtualLocation", url: "https://meet.example/abc" });

    const mixed = toSchemaOrg(gathering({
      attendanceMode: "mixed", onlineUrl: "https://meet.example/abc",
    }))!;
    expect(mixed.location).toEqual([
      { "@type": "Place", name: "The greenhouse" },
      { "@type": "VirtualLocation", url: "https://meet.example/abc" },
    ]);
  });

  it("omits what it does not know instead of emitting empty keys", () => {
    const doc = toSchemaOrg(gathering({
      description: null, endsAt: null, capacity: null, locationText: null,
    }))!;
    expect(doc).not.toHaveProperty("description");
    expect(doc).not.toHaveProperty("endDate");
    expect(doc).not.toHaveProperty("maximumAttendeeCapacity");
    expect(doc).not.toHaveProperty("location");
  });

});
