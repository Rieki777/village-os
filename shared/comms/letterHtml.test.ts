import { describe, expect, it } from "vitest";
import { deriveTheme } from "../brandTokens";
import { composeEmail, emailLook, NEUTRAL_STYLE, type EmailVillage } from "./letterHtml";

/**
 * The whole email: the village's look, its footer, a preheader and a plain-text
 * part, always.
 */

const VILLAGE: EmailVillage = {
  name: "Test Village",
  url: "https://village.example",
  logoUrl: null,
  seed: null,
  character: null,
  postalAddress: "1 Lane, Somewhere 1234",
};

const compose = (over: Partial<Parameters<typeof composeEmail>[0]> = {}) =>
  composeEmail({
    words: { subject: "Hello {{person.firstName}}", preheader: null, bodyMd: "Hi {{person.firstName}},\n\nThe garden is planted.\n\n[See it]({{village.url}}/events)" },
    values: { "person.firstName": "Ada", "links.preferences": "https://village.example/email/preferences?t=abc" },
    village: VILLAGE,
    kind: "events",
    templateKey: "gathering.confirm",
    ...over,
  });

describe("the email document", () => {
  it("ends with the village's name, its postal address, why the reader got it, and their preferences link", () => {
    const email = compose();
    const footer = email.html.slice(email.html.indexOf('<tr><td style="padding:16px'));
    expect(footer).toContain("Test Village");
    expect(footer).toContain("1 Lane, Somewhere 1234");
    expect(footer).toContain("You&#39;re getting this because you said yes to a gathering at Test Village.");
    expect(footer).toContain('href="https://village.example/email/preferences?t=abc"');
    expect(footer).toContain("Choose which emails you get");
    expect(email.text).toMatch(
      /--\nTest Village\n1 Lane, Somewhere 1234\nYou're getting this because you said yes to a gathering at Test Village\.\nChoose which emails you get: https:\/\/village\.example\/email\/preferences\?t=abc\n$/,
    );
  });

  it("leaves the postal line out when the village has not written one", () => {
    const email = compose({ village: { ...VILLAGE, postalAddress: "" } });
    expect(email.text).toContain("--\nTest Village\nYou're getting this");
  });

  it("always carries a preheader: its own, else the opening words past the greeting, else the subject", () => {
    expect(compose({ words: { subject: "S", preheader: "Own words", bodyMd: "Body" } }).preheader).toBe("Own words");
    expect(compose().preheader).toBe("The garden is planted. See it: https://village.example/events");
    expect(compose({ words: { subject: "Only a subject", preheader: null, bodyMd: "" } }).preheader).toBe("Only a subject");
    const email = compose({ words: { subject: "S", preheader: "Hidden line", bodyMd: "Body" } });
    expect(email.html).toMatch(/<div style="display:none;[^"]*">Hidden line/);
  });

  it("draws the button in the village's derived brand colour, and in neutral grey with no seed", () => {
    const seeded = compose({ village: { ...VILLAGE, seed: "#2d6a4f", character: "field" } });
    const brand = deriveTheme("#2d6a4f", "field")!.vars["--tone-brand"];
    expect(seeded.html).toContain(`bgcolor="${brand}"`);
    expect(emailLook("#2d6a4f", "field").style.brand).toBe(brand);
    expect(compose().html).toContain(`bgcolor="${NEUTRAL_STYLE.brand}"`);
    expect(emailLook(null, null).style).toBe(NEUTRAL_STYLE);
  });

  it("shows the logo when the village has one, and the name either way", () => {
    const withLogo = compose({ village: { ...VILLAGE, logoUrl: "https://village.example/api/uploads/logo.webp" } });
    expect(withLogo.html).toContain('<img src="https://village.example/api/uploads/logo.webp" alt="Test Village"');
    expect(compose().html).not.toContain("<img");
  });

  it("escapes the village's own name, and lets no value claim to be another village", () => {
    const email = compose({
      village: { ...VILLAGE, name: "<Ours & Theirs>" },
      values: { "village.name": "Somebody Else", "village.url": "https://evil.example", "person.firstName": "Ada" },
      words: { subject: "{{village.name}}", preheader: null, bodyMd: "[Go]({{village.url}}/x) {{village.name}}" },
    });
    expect(email.html).toContain("&lt;Ours &amp; Theirs&gt;");
    expect(email.html).not.toContain("<Ours");
    expect(email.html).not.toContain("Somebody Else");
    expect(email.html).not.toContain("evil.example");
    expect(email.subject).toBe("<Ours & Theirs>");
  });

  it("is one line of subject however the words are typed", () => {
    expect(compose({ words: { subject: "  Two\nlines\tand  spaces ", preheader: null, bodyMd: "x" } }).subject).toBe("Two lines and spaces");
  });
});
