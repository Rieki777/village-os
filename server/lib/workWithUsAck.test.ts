/**
 * The Work With Us acknowledgement email reads the village's own words
 * (Admin, Pages, Work With Us), and escapes them.
 *
 * Until 2026-10-22 its subject and paragraph were typed into server/index.ts,
 * so every village sent "Please allow up to a month" under its own name,
 * whatever its team could actually promise.
 */
import { describe, expect, it } from "vitest";
import { workWithUsAckEmail } from "./workWithUsAck";
import { markerDocument } from "../../shared/pageContent/resolve";
import { WORK_WITH_US_PAGE } from "../../shared/pageContent/workWithUs";

const vars = { village: "Willowbrook" };

describe("the acknowledgement email", () => {
  it("says today's words until the village writes its own", () => {
    const mail = workWithUsAckEmail({}, vars, "Ana");
    expect(mail.subject).toBe("We've received your proposal");
    expect(mail.html).toContain("Your proposal is with us");
    expect(mail.html).toContain("<p>Hi Ana,</p>");
    // escapeHtml turns the apostrophe in "We" into an entity, so the
    // paragraph is checked on a run of words that carries none.
    expect(mail.html).toContain("Please allow up to a month for a thoughtful response");
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
