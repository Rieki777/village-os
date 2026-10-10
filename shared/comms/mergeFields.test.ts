import { describe, expect, it } from "vitest";
import {
  fieldProblems,
  fieldsForTemplate,
  fill,
  gatheringWhen,
  groupsForTemplate,
  kindForTemplate,
  MERGE_FIELDS,
  newTracker,
  resolveLink,
  safeUrl,
  sampleValues,
  tokensIn,
} from "./mergeFields";

/**
 * The merge-field catalogue and `fill`: values go in once, escaped for HTML and
 * left alone for text, and a missing value renders its fallback and says so.
 */

describe("fill", () => {
  it("escapes a merge value carrying HTML in html, and keeps it plain in text", () => {
    const values = { "person.firstName": `<b onmouseover="x()">Sam</b> & Co` };
    const html = fill("Hi {{person.firstName}},", values, { mode: "html" });
    expect(html.out).toBe("Hi &lt;b onmouseover=&quot;x()&quot;&gt;Sam&lt;/b&gt; &amp; Co,");
    const text = fill("Hi {{person.firstName}},", values, { mode: "text" });
    expect(text.out).toBe(`Hi <b onmouseover="x()">Sam</b> & Co,`);
    expect(html.missing).toEqual([]);
  });

  it("renders a missing field's fallback and reports it", () => {
    const result = fill("Hi {{person.firstName}}, see you at {{gathering.title}}.", {}, { mode: "text" });
    expect(result.out).toBe("Hi there, see you at the gathering.");
    expect(result.missing.sort()).toEqual(["gathering.title", "person.firstName"]);
    expect(result.unknown).toEqual([]);
  });

  it("fills a fallback that names another field, and ends a chain that loops", () => {
    const one = fill("{{gathering.recapLink}}", { "village.url": "https://village.example" }, { mode: "text" });
    // recapLink falls back to the gathering page, which falls back to the calendar.
    expect(one.out).toBe("https://village.example/events");
    expect(one.missing.sort()).toEqual(["gathering.recapLink", "gathering.url"]);
  });

  it("reports a token that names no field and renders nothing for it", () => {
    const result = fill("A {{gathering.titel}} B", {}, { mode: "html" });
    expect(result.out).toBe("A  B");
    expect(result.unknown).toEqual(["gathering.titel"]);
  });

  it("puts values in once, so a value carrying a token is never expanded", () => {
    const result = fill("{{person.firstName}}", { "person.firstName": "{{village.name}}", "village.name": "Secret" }, { mode: "text" });
    expect(result.out).toBe("{{village.name}}");
  });

  it("writes a link value as a link in html and as its address in text", () => {
    const values = { "recap.recording": "https://village.example/rec?a=1&b=2" };
    expect(fill("Watch: {{recap.recording}}", values, { mode: "html", linkStyle: "color:red;" }).out).toBe(
      'Watch: <a href="https://village.example/rec?a=1&amp;b=2" style="color:red;">https://village.example/rec?a=1&amp;b=2</a>',
    );
    expect(fill("Watch: {{recap.recording}}", values, { mode: "text" }).out).toBe("Watch: https://village.example/rec?a=1&b=2");
  });

  it("refuses a link value that is not http, https or mailto, and falls back", () => {
    const result = fill("{{recap.recording}}", { "recap.recording": "javascript:alert(1)" }, { mode: "html" });
    expect(result.out).toBe("");
    expect(result.omitted).toEqual(["recap.recording"]);
  });

  it("writes a list of links as a sentence: a, b or c", () => {
    const values = {
      "gathering.calendarLinks": {
        links: [
          { label: "Google Calendar", href: "https://calendar.example/g" },
          { label: "Outlook", href: "https://calendar.example/o" },
        ],
      },
    };
    expect(fill("Add it to {{gathering.calendarLinks}}.", values, { mode: "text" }).out).toBe(
      "Add it to Google Calendar (https://calendar.example/g) or Outlook (https://calendar.example/o).",
    );
  });
});

describe("links", () => {
  it("allows only http, https and mailto, and resolves a path against the village's site", () => {
    expect(safeUrl("javascript:alert(1)")).toBeNull();
    expect(safeUrl("data:text/html,x")).toBeNull();
    expect(safeUrl("/events")).toBeNull();
    expect(safeUrl("/events", "https://village.example")).toBe("https://village.example/events");
    expect(safeUrl("mailto:hello@village.example")).toBe("mailto:hello@village.example");
    expect(safeUrl("https://village.example/a b")).toBeNull();
  });

  it("percent-encodes a value inside an address, and never lets a brace through", () => {
    const tracker = newTracker();
    const values = { "village.url": "https://village.example", "person.name": "Ann & Bo/{{x}}" };
    expect(resolveLink("{{village.url}}/hello?n={{person.name}}", values, null, tracker)).toBe(
      "https://village.example/hello?n=Ann%20%26%20Bo%2F%7B%7Bx%7D%7D",
    );
  });
});

describe("the catalogue", () => {
  it("names each field once, with a label, a hint and a well-formed key", () => {
    const keys = MERGE_FIELDS.map((f) => f.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const f of MERGE_FIELDS) {
      expect(f.key, f.key).toMatch(/^[a-z][a-zA-Z]*(\.[a-z][a-zA-Z]*)+$/);
      expect(f.label.trim(), f.key).not.toBe("");
      expect(f.hint.trim(), f.key).not.toBe("");
      for (const inner of tokensIn(f.fallback)) expect(keys, `${f.key} falls back to ${inner}`).toContain(inner);
    }
  });

  it("holds every field the spec's table names", () => {
    const spec = [
      "village.name", "village.url", "person.firstName", "person.name", "links.preferences", "footer.address",
      "gathering.title", "gathering.when", "gathering.whenLocal", "gathering.where", "gathering.joinLink", "gathering.url",
      "gathering.cantMakeIt", "gathering.calendarLinks", "gathering.hostName", "gathering.description",
      "poll.options", "poll.closesAt", "poll.leading",
      "recap.body", "recap.recording", "recap.questions", "nextGathering.title", "nextGathering.when", "nextGathering.rsvpLink",
      "path.name", "path.nextStep", "path.nextStepLink", "path.pageUrl", "path.contactName", "path.contactEmail",
      "letter.body",
    ];
    const keys = MERGE_FIELDS.map((f) => f.key);
    for (const key of spec) expect(keys).toContain(key);
  });

  it("gives each email the facts of what made it and no others", () => {
    expect(groupsForTemplate("gathering.confirm")).toEqual(["common", "gathering"]);
    expect(groupsForTemplate("gathering.guest_confirm")).toContain("action");
    expect(groupsForTemplate("gathering.recap_came")).toEqual(["common", "gathering", "recap", "nextGathering"]);
    expect(groupsForTemplate("poll.invite")).toContain("poll");
    expect(groupsForTemplate("path.resident.welcome")).toEqual(["common", "path", "nextGathering"]);
    expect(groupsForTemplate("letter.layout")).toEqual(["common", "letter"]);
    // Each confirmation email knows only its own confirm link.
    expect(groupsForTemplate("letters.confirm")).toEqual(["common", "lettersConfirm"]);
    expect(fieldProblems("letters.confirm", "{{links.confirm}} {{links.lettersConfirm}}")).toEqual({ unknown: [], unavailable: ["links.confirm"] });
    expect(fieldProblems("gathering.guest_confirm", "{{links.lettersConfirm}} {{links.confirm}}")).toEqual({ unknown: [], unavailable: ["links.lettersConfirm"] });
    expect(fieldsForTemplate("member.welcome.day0").some((f) => f.group === "path")).toBe(false);
    expect(fieldProblems("path.resident.welcome", "{{poll.options}} {{path.nmae}} {{path.name}}")).toEqual({
      unknown: ["path.nmae"],
      unavailable: ["poll.options"],
    });
  });

  it("says which kind each email is posted as", () => {
    expect(kindForTemplate("gathering.confirm")).toBe("events");
    expect(kindForTemplate("gathering.guest_confirm")).toBe("essential");
    expect(kindForTemplate("poll.moved")).toBe("events");
    expect(kindForTemplate("path.steward.stories")).toBe("paths");
    expect(kindForTemplate("member.welcome.check_in")).toBe("paths");
    expect(kindForTemplate("letters.confirm")).toBe("essential");
    expect(kindForTemplate("letter.layout")).toBe("letters");
  });

  it("has a sample for every field a preview could need, all on the village's own site", () => {
    const sample = sampleValues({ villageUrl: "https://village.example", firstName: "Ada", fullName: "Ada Lovelace" });
    const needed = MERGE_FIELDS.filter((f) => !["village.name", "village.url", "footer.address", "path.name"].includes(f.key));
    for (const f of needed) expect(sample[f.key], f.key).toBeTruthy();
    expect(sample["person.firstName"]).toBe("Ada");
    for (const [key, value] of Object.entries(sample)) {
      if (typeof value === "string" && /^https?:/.test(value)) expect(value.startsWith("https://village.example"), key).toBe(true);
    }
  });
});

describe("gatheringWhen", () => {
  const start = new Date(Date.UTC(2026, 9, 3, 16, 0)); // Saturday 3 October 2026, 16:00 UTC

  it("writes the village's time, and the reader's when it differs", () => {
    const both = gatheringWhen(start, "America/Costa_Rica", "Europe/Lisbon");
    expect(both.when).toBe("Saturday, October 3 at 10:00 AM");
    expect(both.whenLocal).toBe("Saturday, October 3 at 5:00 PM");
  });

  it("leaves the reader's time empty when it is unknown or the same", () => {
    expect(gatheringWhen(start, "America/Costa_Rica").whenLocal).toBe("");
    expect(gatheringWhen(start, "America/Costa_Rica", "America/Costa_Rica").whenLocal).toBe("");
    expect(gatheringWhen(start, "America/Costa_Rica", "Not/A_Zone").whenLocal).toBe("");
  });
});
