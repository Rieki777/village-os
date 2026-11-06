/**
 * The Work With Us acknowledgement email reads the village's own words
 * (Admin, Pages, Work With Us), and escapes them.
 *
 * Until 2026-10-22 its subject and paragraph were typed into server/index.ts,
 * so every village sent "Please allow up to a month" under its own name,
 * whatever its team could actually promise.
 */
import { describe, expect, it } from "vitest";
import { greetingName, workWithUsAckEmail } from "./workWithUsAck";
import { markerDocument } from "../../shared/pageContent/resolve";
import { WORK_WITH_US_PAGE } from "../../shared/pageContent/workWithUs";

const vars = { village: "Willowbrook" };

describe("the acknowledgement email", () => {
  it("says the spec's starter words until the village writes its own", () => {
    const body = WORK_WITH_US_PAGE.sections.find((s) => s.id === "email")!.fields.find((f) => f.key === "body")!.default;
    const mail = workWithUsAckEmail({}, vars, "Ana");
    expect(mail.subject).toBe("We've received your proposal");
    expect(mail.html).toContain("Your proposal is with us");
    expect(mail.html).toContain("<p>Hi Ana,</p>");
    // escapeHtml would turn an apostrophe into an entity; the starter
    // paragraph carries none, so it is checked whole.
    expect(body).not.toMatch(/['&<>"]/);
    expect(mail.html).toContain(body);
    // A reply time is a promise only a village can make (2026-10-23).
    expect(mail.html).not.toContain("up to a month");
  });

  it("carries every word the village saved for it: subject, message and title", () => {
    const doc = markerDocument(WORK_WITH_US_PAGE) as Record<string, Record<string, string>>;
    const mail = workWithUsAckEmail({ "page-work-with-us": doc }, vars, "Ana");
    expect(mail.subject).toBe(doc.email.subject);
    expect(mail.html).toContain(doc.email.body);
    expect(mail.html).toContain(doc.thanks.heading);
    expect(mail.html).not.toContain("up to a month");
  });

  it("fills {village} and escapes whatever was typed", () => {
    const mail = workWithUsAckEmail(
      { "page-work-with-us": { email: { body: "<b>{village}</b> replies\nwithin a week." } } },
      vars,
      "<script>",
    );
    expect(mail.html).toContain("&lt;b&gt;Willowbrook&lt;/b&gt; replies<br>within a week.");
    expect(mail.html).toContain("Hi &lt;script&gt;,");
    expect(mail.html).not.toContain("<script>");
  });

  it("falls back to the defaults for a content document that is not an object", () => {
    expect(workWithUsAckEmail(null, vars, "Ana").subject).toBe("We've received your proposal");
  });
});

describe("the name a public form's mail greets its sender by (R106)", () => {
  it("is never longer than a name, however long the stranger typed it", () => {
    expect(greetingName({ name: "R".repeat(500) })).toBe("R".repeat(120));
  });

  it("takes the first field a form carries, and says Anonymous when none is there", () => {
    expect(greetingName({ name: "  Ana  ", email: "ana@example.test" })).toBe("Ana");
    expect(greetingName({ firstName: "Bo" })).toBe("Bo");
    expect(greetingName({ name: "", email: "cy@example.test" })).toBe("cy@example.test");
    expect(greetingName({})).toBe("Anonymous");
    expect(greetingName(null)).toBe("Anonymous");
    expect(greetingName({ name: ["a", "list"] })).toBe("Anonymous");
  });
});
