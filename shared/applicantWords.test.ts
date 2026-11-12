import { describe, expect, it } from "vitest";
import { APPLICANT_LANGUAGES, APPLICANT_NOTE_MAX, LANGUAGES, STATUS_LINK_STARTS, cleanNote, statusView, type ApplicantLanguage } from "./applicantWords";
import { bookingWords, statusFor } from "./applicationReview";
import { chooseApplicantLanguage } from "./applicantLanguage";
import { offeredLocaleTags } from "./i18nLocales";
import { adoptedAccountLetter, adoptedInviteLetter, applicantUpdate, declinedLetter, invitedLetter, type ApplicantUpdateKind } from "./openProposalDecide";
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
    // Two lines per language: the pointer to the first email, and the line that carries the link itself.
    expect(new Set(STATUS_LINK_STARTS).size).toBe(APPLICANT_LANGUAGES.length * 2);
    for (const lang of APPLICANT_LANGUAGES) {
      expect(STATUS_LINK_STARTS.some((s) => LANGUAGES[lang].keepStatusLink.startsWith(s))).toBe(true);
      expect(STATUS_LINK_STARTS.some((s) => LANGUAGES[lang].statusLinkLine("https://x.test").startsWith(s))).toBe(true);
    }
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

describe("the Spanish list word", () => {
  it("uses e before an i sound and y otherwise", () => {
    expect(LANGUAGES.es.list(["Guardia", "Isla"])).toBe("Guardia e Isla");
    expect(LANGUAGES.es.list(["Guardia", "Hogar"])).toBe("Guardia y Hogar");
    expect(LANGUAGES.es.list(["A", "B", "Hierba"])).toBe("A, B y Hierba");
    expect(LANGUAGES.en.list(["A", "B", "C"])).toBe("A, B and C");
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

describe("the status page's words (statusView)", () => {
  const confirmedAt = new Date("2026-11-02T12:00:00Z");
  const iv = (position: number, roleName: string, minutes: number, state: "waiting" | "open" | "scored" | "skipped") => ({ position, state, roleName, minutes, final: false, dueAt: null });
  const input = (over: Partial<Parameters<typeof statusFor>[0]> = {}) => ({
    decided: null,
    firstReplyAt: null,
    confirmedAt,
    interviews: [iv(1, "Welcome Role", 60, "open"), iv(2, "Water Role", 20, "waiting")],
    consentOpen: false,
    consentClosesAt: null,
    timeZone: "America/Costa_Rica",
    ...over,
  });
  const served = (i: Parameters<typeof statusFor>[0], extra: Record<string, unknown> = {}) => {
    const s = statusFor(i);
    return { step: s.step, actsNext: s.actsNext, path: s.path, booking: "x", mode: "block" as const, outcome: i.decided, referencesGiven: null, ...extra };
  };

  it("only one step reads now, where the server marks two (first reply and an open conversation)", () => {
    const raw = served(input());
    expect(raw.path.filter((p) => p.state === "now").length).toBe(2);
    for (const lang of APPLICANT_LANGUAGES) expect(statusView(lang, raw).path.filter((p) => p.state === "now").length).toBe(1);
  });

  it("a decline leaves out the steps that never happened, and the circle's consent with them", () => {
    const raw = served(input({ decided: "declined", firstReplyAt: confirmedAt }));
    expect(raw.path.some((p) => p.label === "The circle's consent")).toBe(true);
    const v = statusView("en", raw);
    expect(v.path.map((p) => p.label)).toEqual(["Received", "First reply", "Decision"]);
    expect(v.path.every((p) => p.state === "done")).toBe(true);
    expect(v.move).toBe(LANGUAGES.en.status.move.declined);
    expect(v.booking).toBeNull();
  });

  it("every path label and move line the server writes is said in Spanish, with no English left", () => {
    const cases = [
      input(),
      input({ firstReplyAt: confirmedAt }),
      input({ firstReplyAt: confirmedAt, interviews: [iv(1, "Welcome Role", 60, "scored"), iv(2, "Water Role", 20, "open")] }),
      input({ firstReplyAt: confirmedAt, interviews: [iv(1, "Welcome Role", 60, "scored"), iv(2, "Water Role", 20, "scored")], consentOpen: true }),
      input({ firstReplyAt: confirmedAt, decided: "adopted", interviews: [iv(1, "Welcome Role", 60, "scored")] }),
      input({ decided: "withdrawn" }),
    ];
    for (const c of cases) {
      const v = statusView("es", served(c));
      const said = [v.stepWords, v.move, ...v.path.map((p) => p.label)].join(" | ");
      expect(said, said).not.toMatch(/Conversation|Received|First reply|Decision|circle|Our move|Your move|talks with you|Nothing more/);
    }
    expect(statusView("es", served(input())).path.map((p) => p.label)).toContain("Conversación con Water Role (20 minutos)");
  });

  it("the booking line tells one story: the applicant books each conversation at times they choose, in order", () => {
    const en = statusView("en", served(input())).booking!;
    expect(en.text).toBe(
      "After the invitation, you book each conversation at times you choose, in this order: Welcome Role first, then Water Role. Each one opens once the one before it is written up.",
    );
    // The same story whatever the role's conversationMode holds (old cards may carry "split").
    expect(statusView("en", served(input(), { mode: "split" })).booking!.text).toBe(en.text);
    expect(statusView("es", served(input())).booking!.text).toContain("primero Welcome Role, luego Water Role");
    // The words the server sends for the reviewer and the status read are the applicant's English, word for word.
    expect(bookingWords(["Welcome Role", "Water Role"])).toBe(en.text);
    expect(bookingWords(["Welcome Role"])).toBe(LANGUAGES.en.status.booking.order(["Welcome Role"]));
    // Nothing about one block, splitting, or asking for the conversations to be moved.
    for (const lang of APPLICANT_LANGUAGES) {
      const said = JSON.stringify(LANGUAGES[lang].status.booking) + LANGUAGES[lang].status.booking.order(["A", "B"]) + LANGUAGES[lang].invite.booking;
      expect(said).not.toMatch(/block|split|bloque|repart/i);
    }
  });

  it("offers only the open conversation's way to book: its role's link, or our letter with times", () => {
    const withLink = statusView("en", served(input(), { bookNow: { role: "Welcome Role", url: "https://cal.example.test/welcome" } })).booking!;
    expect(withLink.book).toEqual({ label: "Book your conversation with Welcome Role", url: "https://cal.example.test/welcome" });
    const noLink = statusView("en", served(input(), { bookNow: { role: "Welcome Role", url: null } })).booking!;
    expect(noLink.book).toEqual({ text: "We'll write to you with times for your conversation with Welcome Role." });
    expect(statusView("en", served(input())).booking!.book, "control: nothing open, nothing to book").toBeNull();
    expect(statusView("es", served(input(), { bookNow: { role: "Welcome Role", url: null } })).booking!.book).toEqual({ text: "Te escribiremos con horarios para tu conversación con Welcome Role." });
  });

  it("the invitation gives the first interviewer's booking link, and says the later ones open in order", () => {
    const conversations = [
      { role: "Ops Role", minutes: 60, bookingUrl: "https://cal.example.test/ops" },
      { role: "Hiring Role", minutes: 20, bookingUrl: "https://cal.example.test/hiring" },
    ];
    const letter = invitedLetter({ firstName: "Ada", village: "V", roleNames: ["Lead Role"], conversations, statusLink: null, lang: "en" });
    expect(letter.text).toContain("Book your first conversation, with Ops Role, here: https://cal.example.test/ops");
    expect(letter.text).toContain("Each later conversation opens once the one before it is written up");
    expect(letter.text, "a later conversation's link waits until it opens").not.toContain("cal.example.test/hiring");
    const none = invitedLetter({ firstName: "Ada", village: "V", roleNames: ["Lead Role"], conversations: [{ role: "Ops Role", minutes: 60, bookingUrl: null }], statusLink: null, lang: "en" });
    expect(none.text).toContain("We'll write to you with times for your first conversation, with Ops Role.");
    expect(none.text, "control: one conversation has no later ones").not.toContain("Each later conversation");
    const es = invitedLetter({ firstName: "Ada", village: "V", roleNames: ["Lead Role"], conversations, statusLink: null, lang: "es" });
    expect(es.text).toContain("Reserva tu primera conversación, con Ops Role, aquí: https://cal.example.test/ops");
    // The opened later conversation's letter carries its own role's link, or our letter with times.
    expect(applicantUpdate("conversation", { firstName: null, village: "V", roleNames: ["Lead Role"], replyDays: 7, withRole: "Hiring Role", minutes: 20, bookingUrl: "https://cal.example.test/hiring" }).text).toContain("Book it at a time you choose: https://cal.example.test/hiring");
    expect(applicantUpdate("conversation", { firstName: null, village: "V", roleNames: ["Lead Role"], replyDays: 7, withRole: "Hiring Role", minutes: 20 }).text).toContain("We'll write to you with times.");
  });

  it("the references line says what we know, never 'no references' after a decision", () => {
    expect(statusView("en", served(input(), { referencesGiven: 0 })).references).toBe(LANGUAGES.en.status.references.none);
    expect(statusView("en", served(input(), { referencesGiven: 2 })).references).toContain("only after our first conversation");
    expect(statusView("en", served(input(), { referencesGiven: null })).references).toBeNull();
    expect(statusView("en", served(input({ decided: "declined" }), { referencesGiven: 0 })).references).toBeNull();
  });
});
