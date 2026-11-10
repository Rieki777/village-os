import { describe, expect, it } from "vitest";
import { APPLICANT_LANGUAGES, APPLICANT_NOTE_MAX, LANGUAGES, STATUS_LINK_LINES, cleanNote, type ApplicantLanguage } from "./applicantWords";
import { chooseApplicantLanguage } from "./applicantLanguage";
import { offeredLocaleTags } from "./i18nLocales";
import { adoptedAccountLetter, adoptedInviteLetter, applicantUpdate, declinedLetter, type ApplicantUpdateKind } from "./openProposalDecide";
import { confirmLetter } from "./openProposals";

/** Every leaf of a table as `path: kind`, so two languages must agree on the shape of every line, not only on its name. */
function shape(v: unknown, path = ""): string[] {
  if (typeof v === "function") return [`${path}: fn/${(v as (...a: unknown[]) => unknown).length}`];
  if (typeof v === "string") return [`${path}: text`];
  return Object.entries(v as Record<string, unknown>).flatMap(([k, x]) => shape(x, path ? `${path}.${k}` : k));
}

describe("every applicant line exists in every language", () => {
  const source = shape(LANGUAGES.en);
  for (const lang of APPLICANT_LANGUAGES) {
    it(`${lang} has the same lines as the English source`, () => {
      expect(shape(LANGUAGES[lang])).toEqual(source);
    });
  }
  it("a language we write in is one the site offers", () => {
    for (const lang of APPLICANT_LANGUAGES) expect(offeredLocaleTags()).toContain(lang);
  });
  it("no line of any language is empty", () => {
    const empties = (v: unknown, path: string): string[] =>
      typeof v === "string" ? (v.trim() ? [] : [path]) : typeof v === "function" ? [] : Object.entries(v as object).flatMap(([k, x]) => empties(x, `${path}.${k}`));
    for (const lang of APPLICANT_LANGUAGES) expect(empties(LANGUAGES[lang], lang)).toEqual([]);
  });
});

describe("each template, built in each language", () => {
  const kinds: ApplicantUpdateKind[] = ["confirmed", "first_reply", "conversation", "consent", "terms", "adopted", "declined"];
  const base = { firstName: "Ana", village: "Test Village", roleNames: ["Gate Keeper", "Well Keeper"], replyDays: 3 };
  const lead = (lang: ApplicantLanguage) => (lang === "es" ? "Hola Ana," : "Hi Ana,");
  for (const lang of APPLICANT_LANGUAGES) {
    it(`${lang}: the letters and the updates read as that language, with the roles and the note`, () => {
      const note = "We would love to read your next one.";
      const texts: string[] = [];
      for (const kind of kinds) {
        const u = applicantUpdate(kind, { ...base, lang, note, withRole: "Gate Keeper", minutes: 30 });
        expect(u.title.length).toBeGreaterThan(3);
        if (kind !== "confirmed") expect(u.text).toContain(note);
        texts.push(u.text);
      }
      const c = confirmLetter({ firstName: "Ana", village: "Test Village", roleNames: base.roleNames, link: "https://x.test/c?token=1", lang });
      const a = adoptedInviteLetter({ ...base, lang, season: "Roots", startsOn: "1 January 2099", link: "https://x.test/i", days: 7, loveLetter: "https://x.test/love-letter", note });
      const b = adoptedAccountLetter({ ...base, lang, season: null, startsOn: "x", moon: { from: "a", to: "b" }, signIn: "https://x.test/profile", note });
      const d = declinedLetter({ firstName: "Ana", village: "Test Village", roleNames: base.roleNames, site: "https://x.test", lang, note });
      for (const t of [c.text, a.text, b.text, d.text]) {
        expect(t.startsWith(lead(lang))).toBe(true);
        expect(t).toContain("https://x.test");
      }
      expect(d.text).toContain(note);
      expect(a.button.label).toBe(LANGUAGES[lang].adopt.button);
      texts.push(c.text, a.text, b.text, d.text);
      // No raw template hole or undefined leaks into any line.
      for (const t of texts) expect(t).not.toMatch(/undefined|\[object|\$\{/);
    });
  }
  it("Spanish is Spanish and English is English", () => {
    expect(declinedLetter({ firstName: null, village: "V", roleNames: ["R"], site: "https://x.test", lang: "es" }).text).toContain("Gracias por proponerte");
    expect(declinedLetter({ firstName: null, village: "V", roleNames: ["R"], site: "https://x.test" }).text).toContain("Thank you for proposing");
  });
  it("a notice can drop the status link line in any language", () => {
    expect(STATUS_LINK_LINES.size).toBe(APPLICANT_LANGUAGES.length);
  });
});

describe("the language rule, each fallback", () => {
  it("1. the language chosen on the site wins over everything", () => {
    expect(chooseApplicantLanguage({ chosenOnSite: "es", emailList: "en", profile: "en", browser: ["en"], villageDefault: "en" })).toEqual({ language: "es", source: "chosen_on_site" });
  });
  it("2. else the email list", () => {
    expect(chooseApplicantLanguage({ emailList: "es", profile: "en", browser: ["en"] })).toEqual({ language: "es", source: "email_list" });
  });
  it("3. else the member profile", () => {
    expect(chooseApplicantLanguage({ profile: "es", browser: ["en"], villageDefault: "en" })).toEqual({ language: "es", source: "profile" });
  });
  it("4. else the browser, first one we write in, regional tags matched", () => {
    expect(chooseApplicantLanguage({ browser: ["fr-FR", "es-CR", "en"], villageDefault: "en" })).toEqual({ language: "es", source: "browser" });
  });
  it("5. else the village default", () => {
    expect(chooseApplicantLanguage({ browser: ["fr"], villageDefault: "es" })).toEqual({ language: "es", source: "village_default" });
  });
  it("6. else English", () => {
    expect(chooseApplicantLanguage({ browser: ["fr"], villageDefault: "de" })).toEqual({ language: "en", source: "english" });
    expect(chooseApplicantLanguage({})).toEqual({ language: "en", source: "english" });
  });
  it("a tag we cannot write in is skipped, not stopped at", () => {
    expect(chooseApplicantLanguage({ chosenOnSite: "fr", emailList: "es" }).source).toBe("email_list");
  });
});

describe("a decider's note", () => {
  it("is plain text, trimmed, capped, and empty means none", () => {
    expect(cleanNote("  hello \r\n\r\n\r\n\r\nthere  ")).toBe("hello\n\nthere");
    expect(cleanNote("   ")).toBeNull();
    expect(cleanNote(42)).toBeNull();
    expect(cleanNote("x".repeat(APPLICANT_NOTE_MAX + 50))?.length).toBe(APPLICANT_NOTE_MAX);
  });
});
