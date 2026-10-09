import ICAL from "ical.js";
import { describe, expect, it } from "vitest";
import { safeUrl } from "../../../shared/comms/mergeFields";
import { buildGatheringIcs, calendarLinks, hostOf, icsAttachment, icsUid, type IcsGathering } from "./ics";

/**
 * The calendar file a gathering email carries (the comms build spec 5.7),
 * read back through an independent parser (ical.js), and the add-to-calendar
 * links beside it.
 */

const CRLF = String.fromCharCode(13, 10);
const NOW = new Date("2026-10-01T12:00:00Z");

const supper: IcsGathering = {
  eventId: "ev-1759-abcd",
  occurrenceKey: "",
  title: "Community supper; bring a dish, if you can",
  startsAt: new Date("2026-10-04T23:00:00Z"),
  endsAt: new Date("2026-10-05T01:00:00Z"),
  allDay: false,
  timezone: "America/Costa_Rica",
  location: "The common house",
  url: "https://village.example.test/events",
  description: "Everyone eats.\nLine two.",
  joinUrl: null,
};

const invite = { host: "village.example.test", organizer: { name: "Test Village", email: "hello@village.example.test" }, attendee: { name: "Sam Rivers", email: "sam@example.test" }, now: NOW };

function parse(text: string) {
  const cal = new ICAL.Component(ICAL.parse(text));
  const ev = cal.getFirstSubcomponent("vevent")!;
  return { cal, ev };
}

describe("the calendar file for one gathering", () => {
  it("is a REQUEST an independent parser reads, with the occurrence's UID, SEQUENCE and times", () => {
    const text = buildGatheringIcs(supper, { ...invite, method: "REQUEST", sequence: 0 });
    const { cal, ev } = parse(text);
    expect(cal.getFirstPropertyValue("method")).toBe("REQUEST");
    expect(ev.getFirstPropertyValue("uid")).toBe("ev-1759-abcd-@village.example.test");
    expect(ev.getFirstPropertyValue("sequence")).toBe(0);
    expect((ev.getFirstPropertyValue("dtstart") as any).toJSDate().toISOString()).toBe("2026-10-04T23:00:00.000Z");
    expect((ev.getFirstPropertyValue("dtend") as any).toJSDate().toISOString()).toBe("2026-10-05T01:00:00.000Z");
    // Escaped on the way out and unescaped by the parser: the semicolon and comma survive as text.
    expect(ev.getFirstPropertyValue("summary")).toBe(supper.title);
    expect(ev.getFirstPropertyValue("location")).toBe("The common house");
    expect(ev.getFirstPropertyValue("status")).toBe("CONFIRMED");
    expect(String(ev.getFirstPropertyValue("organizer"))).toBe("mailto:hello@village.example.test");
    expect(String(ev.getFirstPropertyValue("attendee"))).toBe("mailto:sam@example.test");
    expect(ev.getFirstProperty("attendee")!.getParameter("partstat")).toBe("ACCEPTED");
    expect(text.split("\r\n").every((line) => Buffer.byteLength(line, "utf8") <= 75)).toBe(true);
    expect(text.endsWith("\r\n")).toBe(true);
  });

  it("names an evening of a series by its date, and a CANCEL keeps the same UID with a higher SEQUENCE", () => {
    const evening = { ...supper, occurrenceKey: "2026-10-04" };
    const first = parse(buildGatheringIcs(evening, { ...invite, method: "REQUEST", sequence: 2 })).ev;
    const cancel = parse(buildGatheringIcs(evening, { ...invite, method: "CANCEL", sequence: 3 }));
    expect(first.getFirstPropertyValue("uid")).toBe(icsUid("ev-1759-abcd", "2026-10-04", "village.example.test"));
    expect(cancel.ev.getFirstPropertyValue("uid")).toBe(first.getFirstPropertyValue("uid"));
    expect(cancel.cal.getFirstPropertyValue("method")).toBe("CANCEL");
    expect(cancel.ev.getFirstPropertyValue("status")).toBe("CANCELLED");
    expect(cancel.ev.getFirstPropertyValue("sequence")).toBe(3);
  });

  it("writes an all-day gathering as dates in the village's zone, and a gathering with no end with no DTEND", () => {
    const allDay = { ...supper, allDay: true, startsAt: new Date("2026-10-04T06:00:00Z"), endsAt: null };
    const ev = parse(buildGatheringIcs(allDay, { ...invite, method: "REQUEST", sequence: 0 })).ev;
    expect(String(ev.getFirstPropertyValue("dtstart"))).toBe("2026-10-04");
    expect(String(ev.getFirstPropertyValue("dtend"))).toBe("2026-10-05");
    const open = parse(buildGatheringIcs({ ...supper, endsAt: null }, { ...invite, method: "REQUEST", sequence: 0 })).ev;
    expect(open.getFirstPropertyValue("dtend")).toBeNull();
  });

  it("carries the online room in its description, and drops a link or a name that could break a line", () => {
    const text = buildGatheringIcs(
      { ...supper, joinUrl: "https://village.example.test/api/events/ev-1759-abcd/join", url: "https://x.test/a\r\nATTENDEE:mailto:evil@x.test" },
      { ...invite, attendee: { name: "Sam\r\nORGANIZER:mailto:evil@x.test", email: "sam@example.test" }, method: "REQUEST", sequence: 0 },
    );
    const { ev } = parse(text);
    expect(String(ev.getFirstPropertyValue("description"))).toContain("Join online: https://village.example.test/api/events/ev-1759-abcd/join");
    expect(ev.getFirstPropertyValue("url")).toBeNull();
    expect(ev.getAllProperties("attendee")).toHaveLength(1);
    expect(ev.getAllProperties("organizer")).toHaveLength(1);
    // What survives is text inside a value, never a line of its own.
    expect(text.split(CRLF).filter((l) => /^(ATTENDEE|ORGANIZER)/.test(l))).toHaveLength(2);
    expect(String(ev.getFirstPropertyValue("description"))).not.toContain("evil@x.test");
  });

  it("leaves the organizer out when the village has no sender, and still reads", () => {
    const { ev } = parse(buildGatheringIcs(supper, { host: "v.test", method: "REQUEST", sequence: 1, organizer: null, now: NOW }));
    expect(ev.getFirstProperty("organizer")).toBeNull();
  });

  it("travels as a text/calendar attachment whose method matches the file", () => {
    const a = icsAttachment("BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n", "CANCEL");
    expect(a.contentType).toBe("text/calendar; charset=utf-8; method=CANCEL");
    expect(Buffer.from(a.contentBase64, "base64").toString("utf8")).toContain("BEGIN:VCALENDAR");
    expect(hostOf("https://village.example.test/")).toBe("village.example.test");
    expect(hostOf("")).toBe("village");
  });
});

describe("the add-to-calendar links", () => {
  it("fill in Google's and Outlook's own pages with the title, times and place", () => {
    const [google, outlook] = calendarLinks(supper);
    expect(google.label).toBe("Google Calendar");
    const g = new URL(google.href);
    expect(g.host).toBe("calendar.google.com");
    expect(g.searchParams.get("text")).toBe(supper.title);
    expect(g.searchParams.get("dates")).toBe("20261004T230000Z/20261005T010000Z");
    expect(g.searchParams.get("location")).toBe("The common house");
    const o = new URL(outlook.href);
    expect(o.host).toBe("outlook.live.com");
    expect(o.searchParams.get("startdt")).toBe("2026-10-04T23:00:00.000Z");
    expect(o.searchParams.get("subject")).toBe(supper.title);
    // A space is %20, never a plus, which Outlook would show.
    expect(outlook.href).not.toContain("+");
  });

  it("stay short enough for an email to keep them, however long the description", () => {
    const long = { ...supper, description: "A long description. ".repeat(400) };
    for (const link of calendarLinks(long)) {
      expect(link.href.length).toBeLessThanOrEqual(1900);
      expect(safeUrl(link.href), link.label).not.toBeNull();
    }
  });

  it("give an all-day gathering its dates", () => {
    const [google, outlook] = calendarLinks({ ...supper, allDay: true, startsAt: new Date("2026-10-04T06:00:00Z"), endsAt: null });
    expect(new URL(google.href).searchParams.get("dates")).toBe("20261004/20261005");
    expect(new URL(outlook.href).searchParams.get("allday")).toBe("true");
  });
});
