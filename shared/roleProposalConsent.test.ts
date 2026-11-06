/**
 * The circle's consent and the nudges (shared/roleProposalConsent.ts), with
 * no database.
 *
 * What is pinned: the window is 2 business days on the village's clock, a
 * weekend counting from Monday; the state machine, where an objection blocks
 * at once and a closed window carries only with a consent; an objection
 * needs a reason; the decision record names a role, never a person; the
 * tension an objection writes names the roles and the reason; and which
 * nudge is due, each with a trigger of its own.
 */
import { describe, expect, it } from "vitest";
import {
  CONSENT_WORDS,
  consentClosesAt,
  consentState,
  consentStateWords,
  decisionWords,
  dueNudges,
  NUDGE_WORDS,
  OBJECTION_MAX,
  objectionTension,
  parseConsentAnswer,
  powerPhrase,
  readNudge,
  TALLY_WORDS,
  tallyWords,
  type AskIn,
} from "./roleProposalConsent";

const at = (iso: string) => new Date(iso);

describe("the circle's window", () => {
  it("is 2 business days: Friday morning to Tuesday morning", () => {
    expect(consentClosesAt(at("2026-11-06T10:00:00Z"), "UTC").toISOString()).toBe("2026-11-10T10:00:00.000Z");
  });

  it("counts a weekend submit from Monday: all of Monday and Tuesday", () => {
    expect(consentClosesAt(at("2026-11-07T15:00:00Z"), "UTC").toISOString()).toBe("2026-11-11T00:00:00.000Z");
  });

  it("reads the days in the village's own zone", () => {
    // 23:30 on Friday in Costa Rica is a Friday there, whatever UTC says.
    const fridayNight = at("2026-11-07T05:30:00Z");
    expect(consentClosesAt(fridayNight, "America/Costa_Rica").toISOString()).toBe("2026-11-11T05:30:00.000Z");
  });
});

describe("where consent stands", () => {
  const closes = at("2026-11-10T10:00:00Z");
  const ask = (answer: AskIn["answer"]): AskIn => ({ answer, closesAt: closes });
  const during = at("2026-11-09T10:00:00Z");
  const after = at("2026-11-10T10:00:01Z");

  it("cannot run with nobody else in the circle", () => {
    expect(consentState([], during)).toBe("no-other-holders");
    expect(consentStateWords("no-other-holders", null)).toBe(CONSENT_WORDS.noOtherHolders);
  });

  it("is open inside the window, and an objection blocks it at once", () => {
    expect(consentState([ask(null), ask("consent")], during)).toBe("open");
    expect(consentState([ask("consent"), ask("object")], during)).toBe("objected");
    expect(consentState([ask("consent"), ask("object")], after)).toBe("objected");
  });

  it("carries when the window closes with a consent and no objection", () => {
    expect(consentState([ask("consent"), ask(null)], after)).toBe("consented");
    expect(consentStateWords("consented", null)).toBe("Consented by the circle");
  });

  it("lapses when the window closes with no consent", () => {
    expect(consentState([ask(null), ask(null)], after)).toBe("lapsed");
  });

  it("E8: every holder asked has consented, so the window has nothing left to wait for", () => {
    // One asked, one consented: consented now, inside the window.
    expect(consentState([ask("consent")], during)).toBe("consented");
    expect(consentState([ask("consent"), ask("consent")], during)).toBe("consented");
    // Control: one of two still to answer keeps it open until the window closes.
    expect(consentState([ask("consent"), ask(null)], during)).toBe("open");
    // An objection still blocks, whatever the others said.
    expect(consentState([ask("consent"), ask("consent"), ask("object")], during)).toBe("objected");
  });

  it("names the window's last day while it is open", () => {
    expect(consentStateWords("open", "2026-11-10")).toBe("The circle is asked to consent or object by 10 November 2026.");
  });
});

describe("an answer", () => {
  it("is consent, or an objection with its reason", () => {
    expect(parseConsentAnswer({ answer: "consent" })).toEqual({ ok: true, answer: "consent", reason: null });
    expect(parseConsentAnswer({ answer: "object" })).toEqual({ ok: false, field: "reason", error: CONSENT_WORDS.reasonNeeded });
    expect(parseConsentAnswer({ answer: "object", reason: "   " }).ok).toBe(false);
    expect(parseConsentAnswer({ answer: "object", reason: "The two roles overlap on the budget." })).toEqual({ ok: true, answer: "object", reason: "The two roles overlap on the budget." });
    expect(parseConsentAnswer({ answer: "maybe" }).ok).toBe(false);
  });

  it("refuses a long reason and one carrying payment details", () => {
    expect(parseConsentAnswer({ answer: "object", reason: "a".repeat(601) }).ok).toBe(false);
    expect(parseConsentAnswer({ answer: "object", reason: "Use 4111 1111 1111 1111" }).ok).toBe(false);
  });

  it("holds a reason to the 300 characters the page's box holds (PR D)", () => {
    expect(OBJECTION_MAX).toBe(300);
    expect(parseConsentAnswer({ answer: "object", reason: "a".repeat(300) }).ok).toBe(true);
    expect(parseConsentAnswer({ answer: "object", reason: "a".repeat(301) })).toEqual({ ok: false, field: "reason", error: "Keep the reason to 300 characters." });
    // The tension it writes keeps room for the roles' names in front of it.
    expect(objectionTension(["Kitchen keeper"], "a".repeat(300))).toHaveLength("An objection to a role proposal for Kitchen keeper: ".length + 300);
  });
});

describe("the tally (PR D)", () => {
  it("is a count with the roles' titles, never a name", () => {
    expect(tallyWords(2, ["Gate keeper", "Orchard keeper"])).toBe("2 (Gate keeper, Orchard keeper)");
    expect(tallyWords(1, ["Gate keeper"])).toBe("1 (Gate keeper)");
    // A holder who has left their role is counted with no title.
    expect(tallyWords(2, [])).toBe("2");
    expect(tallyWords(0, [])).toBe(TALLY_WORDS.none);
    expect(tallyWords(0, ["Gate keeper"])).toBe("None");
  });
});

describe("the decision record", () => {
  const day = at("2026-11-04T12:00:00Z");

  it("names the circle, or the role whose power adopted it, never a person", () => {
    expect(decisionWords("circle", day, "UTC", "Founder")).toBe("Adopted on 4 Nov after the circle consented");
    expect(decisionWords("power", day, "UTC", "Founder")).toBe("Adopted on 4 Nov by the founder's power");
    expect(decisionWords("power", day, "UTC", "Operations Lead")).toBe("Adopted on 4 Nov by the Operations Lead's power");
    expect(powerPhrase(null)).toBe("the power a badge grants");
  });

  it("writes the objection's tension with the roles and the reason only", () => {
    expect(objectionTension(["Garden Steward", "Seed Keeper"], "They overlap on the budget.")).toBe(
      "An objection to a role proposal for Garden Steward and Seed Keeper: They overlap on the budget.",
    );
  });
});

describe("which nudge is due", () => {
  const window = { seasonId: "s-next", opensAt: at("2026-11-01T00:00:00Z"), closesAt: at("2026-12-01T00:00:00Z") };
  const base = { timeZone: "UTC", window, proposals: [] as Array<{ status: "draft" | "submitted"; targetSeasonId: string | null }>, reviewDays: [] as Array<{ roleId: string; reviewOn: string }> };

  it("asks a member with no proposal while the window is open", () => {
    expect(dueNudges({ ...base, now: at("2026-11-05T09:00:00Z") })).toEqual([{ reason: "window-open", trigger: "s-next" }]);
    // Before it opens, and after it closes, nothing.
    expect(dueNudges({ ...base, now: at("2026-10-30T09:00:00Z") })).toEqual([]);
    expect(dueNudges({ ...base, now: at("2026-12-02T09:00:00Z") })).toEqual([]);
  });

  it("says nothing about the window to a member who has submitted", () => {
    expect(dueNudges({ ...base, now: at("2026-11-27T09:00:00Z"), proposals: [{ status: "submitted", targetSeasonId: "s-next" }] })).toEqual([]);
  });

  it("warns a draft 2 business days before the window closes, and not before", () => {
    const draft = [{ status: "draft" as const, targetSeasonId: "s-next" }];
    // Friday 27 Nov 09:00: two business days on is Tuesday 1 Dec 09:00, after the close at midnight.
    expect(dueNudges({ ...base, now: at("2026-11-27T09:00:00Z"), proposals: draft })).toEqual([{ reason: "window-closing", trigger: "s-next" }]);
    // Wednesday 25 Nov: two business days on is Friday, before the close.
    expect(dueNudges({ ...base, now: at("2026-11-25T09:00:00Z"), proposals: draft })).toEqual([]);
  });

  it("names each due review on its own trigger, for two weeks from its day", () => {
    const reviewDays = [
      { roleId: "role-a", reviewOn: "2026-11-09" },
      { roleId: "role-b", reviewOn: "2026-11-16" },
    ];
    expect(dueNudges({ ...base, window: null, now: at("2026-11-08T12:00:00Z"), reviewDays })).toEqual([]);
    expect(dueNudges({ ...base, window: null, now: at("2026-11-09T12:00:00Z"), reviewDays })).toEqual([{ reason: "review-due", trigger: "role-a:2026-11-09" }]);
    expect(dueNudges({ ...base, window: null, now: at("2026-11-17T12:00:00Z"), reviewDays }).map((n) => n.trigger)).toEqual(["role-a:2026-11-09", "role-b:2026-11-16"]);
    expect(dueNudges({ ...base, window: null, now: at("2026-11-24T12:00:00Z"), reviewDays }).map((n) => n.trigger)).toEqual(["role-b:2026-11-16"]);
  });

  it("puts the most pressing first", () => {
    const out = dueNudges({ ...base, now: at("2026-11-27T09:00:00Z"), proposals: [{ status: "draft", targetSeasonId: "s-next" }], reviewDays: [{ roleId: "role-a", reviewOn: "2026-11-20" }] });
    expect(out.map((n) => n.reason)).toEqual(["window-closing", "review-due"]);
  });
});

describe("the banner's payload", () => {
  it("is drawn in the contract's own words, and refused when it cannot be read", () => {
    expect(readNudge({ show: true, reason: "window-open", href: "/propose?type=role_application" })).toEqual({
      show: true,
      reason: "window-open",
      heading: "Propose your roles for next season",
      reasonWords: "The window is open",
      href: "/propose?type=role_application",
      linkWords: NUDGE_WORDS.link,
    });
    expect(readNudge({ show: true, reason: "nope", href: "/x" })?.show).toBe(false);
    expect(readNudge({ show: true, reason: "window-open", href: "https://elsewhere.test" })).toBeNull();
    expect(readNudge(null)).toBeNull();
  });
});
