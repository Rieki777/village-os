/**
 * The comms settings document's pure rules: the back-fill every reader goes
 * through, and the checks every edit goes through (shared/comms/settings.ts).
 *
 * The database half, that a read never writes and that two saves merge, is in
 * server/lib/comms/settings.db.test.ts against a real schema.
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_COMMS_SETTINGS,
  DEFAULT_CONSENT_TEXT,
  DEFAULT_RECAP_QUESTIONS,
  addressOnDomain,
  applyMergePatch,
  backfillCommsSettings,
  domainProblem,
  normalizeDomain,
  senderNameProblem,
  validateCommsSettingsPatch,
} from "./settings";

const PATHS = ["resident", "investor", "steward", "prosperity-creator"];

describe("backfillCommsSettings", () => {
  it("reads an OLD stored shape with every newer field filled from its default", () => {
    // What a village that saved two fields in an earlier release holds.
    const old = { postalAddress: "1 Orchard Lane", senderName: "Hill Village" };
    const s = backfillCommsSettings(old);
    expect(s.postalAddress).toBe("1 Orchard Lane");
    expect(s.senderName).toBe("Hill Village");
    expect(s.consentText).toBe(DEFAULT_CONSENT_TEXT);
    expect(s.recapQuestions).toEqual([...DEFAULT_RECAP_QUESTIONS]);
    expect(s.pathContacts).toEqual({});
    expect(s.rehearsalTo).toEqual([]);
    expect(s.paused).toBe(false);
    expect(s.investorWordsReviewed).toBeNull();
    expect(s.domain).toBe("");
    expect(s.domainStatus).toBe("none");
    expect(s.webhookConnectedAt).toBeNull();
    // Every field the type declares is present, so no reader meets undefined.
    expect(Object.keys(s).sort()).toEqual(Object.keys(DEFAULT_COMMS_SETTINGS).sort());
    // And the input is not touched: back-fill is a reading, never an edit.
    expect(old).toEqual({ postalAddress: "1 Orchard Lane", senderName: "Hill Village" });
  });

  it("reads nothing at all as the defaults", () => {
    for (const nothing of [null, undefined, "", 42, [], "not json"]) {
      expect(backfillCommsSettings(nothing)).toEqual({ ...DEFAULT_COMMS_SETTINGS, recapQuestions: [...DEFAULT_RECAP_QUESTIONS] });
    }
  });

  it("reads a field of the wrong shape as its default, never as a crash", () => {
    const s = backfillCommsSettings({
      recapQuestions: "one question",
      consentText: 7,
      pathContacts: ["resident"],
      rehearsalTo: "a@example.test",
      paused: "true",
      investorWordsReviewed: { by: "", at: "yesterday" },
      webhookConnectedAt: "not a date",
    });
    expect(s.recapQuestions).toEqual([...DEFAULT_RECAP_QUESTIONS]);
    expect(s.consentText).toBe(DEFAULT_CONSENT_TEXT);
    expect(s.pathContacts).toEqual({});
    expect(s.rehearsalTo).toEqual([]);
    // Only a real `true` pauses. A string that says so is not a press of the button.
    expect(s.paused).toBe(false);
    expect(s.investorWordsReviewed).toBeNull();
    expect(s.webhookConnectedAt).toBeNull();
  });

  it("keeps the good parts of a half-good field", () => {
    const s = backfillCommsSettings({
      recapQuestions: ["Did it help?", ""],
      pathContacts: { resident: "u1", investor: 5, steward: "  " },
      rehearsalTo: ["a@example.test", "not an address", "A@example.test", "b@example.test"],
    });
    expect(s.recapQuestions).toEqual(["Did it help?", DEFAULT_RECAP_QUESTIONS[1]]);
    expect(s.pathContacts).toEqual({ resident: "u1" });
    // One per person: the second spelling of the same address is the same inbox.
    expect(s.rehearsalTo).toEqual(["a@example.test", "b@example.test"]);
  });

  it("says a domain's status only when there is a domain", () => {
    expect(backfillCommsSettings({ domainStatus: "verified" }).domainStatus).toBe("none");
    expect(backfillCommsSettings({ domain: "Example.ORG", domainStatus: "verified" })).toMatchObject({
      domain: "example.org",
      domainStatus: "verified",
    });
    // Kept to the letters a status word is made of, so a stored tag can never render as markup.
    expect(backfillCommsSettings({ domain: "example.org", domainStatus: "<b>odd</b>" }).domainStatus).toBe("boddb");
    expect(backfillCommsSettings({ domain: "example.org" }).domainStatus).toBe("unknown");
  });
});

describe("validateCommsSettingsPatch", () => {
  const ctx = { pathIds: PATHS, reviewer: "Ada", now: new Date("2026-10-02T12:00:00Z") };

  it("refuses a field it does not know, by name", () => {
    const r = validateCommsSettingsPatch({ postalAddres: "typo" }, ctx);
    expect(r).toEqual({ ok: false, error: '"postalAddres" is not a setting this screen can change.' });
  });

  it("refuses the fields only the server writes", () => {
    for (const field of ["senderName", "domain", "domainStatus", "webhookConnectedAt"]) {
      expect(validateCommsSettingsPatch({ [field]: "x" }, ctx).ok, field).toBe(false);
    }
  });

  it("refuses an empty edit", () => {
    expect(validateCommsSettingsPatch({}, ctx)).toEqual({ ok: false, error: "Nothing to change was sent." });
    expect(validateCommsSettingsPatch(null, ctx).ok).toBe(false);
  });

  it("keeps a postal address and refuses one too long to print", () => {
    const r = validateCommsSettingsPatch({ postalAddress: "  1 Orchard Lane\nHill Valley  " }, ctx);
    expect(r).toEqual({ ok: true, patch: { postalAddress: "1 Orchard Lane\nHill Valley" }, changed: ["postalAddress"] });
    expect(validateCommsSettingsPatch({ postalAddress: "x".repeat(501) }, ctx).ok).toBe(false);
  });

  it("turns empty tick-box words into a return to the platform's", () => {
    expect(validateCommsSettingsPatch({ consentText: "" }, ctx)).toMatchObject({ ok: true, patch: { consentText: null } });
    expect(validateCommsSettingsPatch({ consentText: "Yes please" }, ctx).ok).toBe(true);
    expect(validateCommsSettingsPatch({ consentText: "ok" }, ctx).ok).toBe(false);
  });

  it("takes exactly two recap questions, or null to go back to the platform's", () => {
    expect(validateCommsSettingsPatch({ recapQuestions: ["Come again?", "What would help?"] }, ctx)).toMatchObject({
      ok: true,
      patch: { recapQuestions: ["Come again?", "What would help?"] },
    });
    expect(validateCommsSettingsPatch({ recapQuestions: null }, ctx)).toMatchObject({ ok: true, patch: { recapQuestions: null } });
    expect(validateCommsSettingsPatch({ recapQuestions: ["Only one"] }, ctx).ok).toBe(false);
    expect(validateCommsSettingsPatch({ recapQuestions: ["One", " "] }, ctx).ok).toBe(false);
  });

  it("names a contact per known path, and clears one with an empty value", () => {
    expect(validateCommsSettingsPatch({ pathContacts: { resident: "u1", investor: "" } }, ctx)).toMatchObject({
      ok: true,
      patch: { pathContacts: { resident: "u1", investor: null } },
    });
    expect(validateCommsSettingsPatch({ pathContacts: { gardener: "u1" } }, ctx)).toEqual({
      ok: false,
      error: 'This village has no path called "gardener".',
    });
  });

  it("checks every rehearsal address, and an empty list means the admins again", () => {
    expect(validateCommsSettingsPatch({ rehearsalTo: ["a@example.test", "A@example.test"] }, ctx)).toMatchObject({
      ok: true,
      patch: { rehearsalTo: ["a@example.test"] },
    });
    expect(validateCommsSettingsPatch({ rehearsalTo: [] }, ctx)).toMatchObject({ ok: true, patch: { rehearsalTo: null } });
    expect(validateCommsSettingsPatch({ rehearsalTo: ["nobody"] }, ctx)).toEqual({
      ok: false,
      error: '"nobody" does not look like an email address.',
    });
    const eleven = Array.from({ length: 11 }, (_, i) => `p${i}@example.test`);
    expect(validateCommsSettingsPatch({ rehearsalTo: eleven }, ctx).ok).toBe(false);
  });

  it("takes Pause all only as true or false", () => {
    expect(validateCommsSettingsPatch({ paused: true }, ctx)).toMatchObject({ ok: true, patch: { paused: true } });
    expect(validateCommsSettingsPatch({ paused: "yes" }, ctx).ok).toBe(false);
  });

  it("stamps who reviewed the investor words and when, and needs a name to do it", () => {
    expect(validateCommsSettingsPatch({ investorWordsReviewed: true }, ctx)).toMatchObject({
      ok: true,
      patch: { investorWordsReviewed: { by: "Ada", at: "2026-10-02T12:00:00.000Z" } },
    });
    expect(validateCommsSettingsPatch({ investorWordsReviewed: false }, ctx)).toMatchObject({
      ok: true,
      patch: { investorWordsReviewed: null },
    });
    expect(validateCommsSettingsPatch({ investorWordsReviewed: true }, { pathIds: PATHS }).ok).toBe(false);
  });
});

describe("applyMergePatch, the RFC 7396 rule the database applies", () => {
  it("changes only what the patch names, and null removes a key", () => {
    const stored = { postalAddress: "1 Lane", paused: true, pathContacts: { resident: "u1", investor: "u2" } };
    expect(applyMergePatch(stored, { postalAddress: "2 Lane", pathContacts: { investor: null } })).toEqual({
      postalAddress: "2 Lane",
      paused: true,
      pathContacts: { resident: "u1" },
    });
    expect(applyMergePatch(stored, { consentText: null })).toEqual(stored);
  });
});

describe("the sender and the domain", () => {
  it("refuses a sender name that would break the From line", () => {
    expect(senderNameProblem("Hill Village")).toBeNull();
    expect(senderNameProblem("")).not.toBeNull();
    for (const bad of ["Hill <Village>", 'Hill "Village"', "Hill, Village", "Hill; Village", "Hill\nVillage"]) {
      expect(senderNameProblem(bad), bad).not.toBeNull();
    }
  });

  it("cleans a pasted domain and refuses what is not one", () => {
    expect(normalizeDomain(" https://Mail.Example.org/path ")).toBe("mail.example.org");
    expect(normalizeDomain("@example.org.")).toBe("example.org");
    expect(domainProblem("example.org")).toBeNull();
    expect(domainProblem("mail.example.org")).toBeNull();
    for (const bad of ["", "localhost", "exa mple.org", "-bad.org", "bad-.org"]) {
      expect(domainProblem(bad), bad).not.toBeNull();
    }
  });

  it("checks the address is on the domain itself, without case", () => {
    expect(addressOnDomain("Hello@Example.org", "example.org")).toBe(true);
    expect(addressOnDomain("hello@mail.example.org", "example.org")).toBe(false);
    expect(addressOnDomain("hello@example.org.evil.test", "example.org")).toBe(false);
    expect(addressOnDomain("", "example.org")).toBe(false);
  });
});
