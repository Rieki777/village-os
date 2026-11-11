import { describe, expect, it } from "vitest";
import {
  ABOUT_WORDS,
  AI_SAFE_PROPOSAL_FIELDS,
  CHECK_WORDS,
  backgroundCheckOf,
  checkConsentVersion,
  checkLine,
  checkNeeded,
  forAssistants,
  parseAboutYou,
  parseReferences,
  referencesOf,
} from "./proposalAbout";
import { openBodyOf, parseOpenProposal } from "./openProposals";

const AT = new Date("2026-11-10T12:00:00Z");
const ref = (over: Record<string, string> = {}) => ({ name: "Ines Vargas", how: "We built a fence together", contact: "ines@example.org", ...over });
const consent = { given: true, version: checkConsentVersion() };

describe("references", () => {
  it("accepts up to three, with an email or a phone, and drops a wholly blank row", () => {
    const r = parseReferences([ref(), ref({ name: "Tomas", contact: "+506 8888 1234" }), { name: "", how: "", contact: "" }]);
    expect(r.ok && r.value.map((x) => x.name)).toEqual(["Ines Vargas", "Tomas"]);
  });
  it("allows all of them blank", () => {
    expect(parseReferences([])).toEqual({ ok: true, value: [] });
    expect(parseReferences([{ name: " ", how: "", contact: "" }])).toEqual({ ok: true, value: [] });
  });
  it("needs all three parts once a row is started", () => {
    for (const bad of [ref({ how: "" }), ref({ name: "" }), ref({ contact: "" })]) expect(parseReferences([bad])).toMatchObject({ ok: false, error: ABOUT_WORDS.referenceNeedsAll });
  });
  it("refuses a contact that is neither an email nor a phone, a fourth reference and the same one twice", () => {
    expect(parseReferences([ref({ contact: "see me" })])).toMatchObject({ ok: false, error: ABOUT_WORDS.referenceContact });
    expect(parseReferences([ref({ contact: "12345" })])).toMatchObject({ ok: false });
    expect(parseReferences([ref(), ref({ name: "A", contact: "a@example.org" }), ref({ name: "B", contact: "b@example.org" }), ref({ name: "C", contact: "c@example.org" })])).toMatchObject({ ok: false, error: ABOUT_WORDS.tooManyReferences });
    expect(parseReferences([ref(), ref({ name: "Other" })])).toMatchObject({ ok: false, error: ABOUT_WORDS.sameReferenceTwice });
  });
  it("reads a stored body back safely, whatever it holds", () => {
    expect(referencesOf("nonsense")).toEqual([]);
    expect(referencesOf([null, { name: "x" }, ref()])).toEqual([ref()]);
  });
});

describe("the background-check consent", () => {
  it("is required when the references are all blank", () => {
    expect(parseAboutYou({ references: [] }, { alwaysChecked: false, at: AT })).toMatchObject({ ok: false, field: "checkConsent", error: ABOUT_WORDS.needConsent });
    const ok = parseAboutYou({ references: [], consent }, { alwaysChecked: false, at: AT });
    expect(ok).toMatchObject({ ok: true });
    expect(ok.ok && ok.value.backgroundCheck).toEqual({ needed: true, because: "no_references", consent: { at: AT.toISOString(), version: checkConsentVersion() } });
  });
  it("is required for an always-checked role even with references given", () => {
    expect(parseAboutYou({ references: [ref()] }, { alwaysChecked: true, at: AT })).toMatchObject({ ok: false, field: "checkConsent" });
    const ok = parseAboutYou({ references: [ref()], consent }, { alwaysChecked: true, at: AT });
    expect(ok.ok && ok.value.backgroundCheck).toMatchObject({ needed: true, because: "role" });
  });
  it("is not required when references are given and no role is always checked", () => {
    const ok = parseAboutYou({ references: [ref()] }, { alwaysChecked: false, at: AT });
    expect(ok.ok && ok.value.backgroundCheck).toEqual({ needed: false, because: null });
  });
  it("is refused when it names an older wording", () => {
    expect(parseAboutYou({ references: [], consent: { given: true, version: "cc-00000000" } }, { alwaysChecked: false, at: AT })).toMatchObject({ ok: false, error: ABOUT_WORDS.consentChanged });
  });
  it("says the lead's words, and its version moves when a word does", () => {
    expect(CHECK_WORDS.lines[0]).toBe("If you leave the three references blank, we'll run a background check instead. Its cost comes out of your first contractor pay.");
    expect(CHECK_WORDS.lines[1]).toBe("If we don't seat you, we cover it.");
    expect(CHECK_WORDS.lines[2]).toBe("The cost and the provider depend on your country, and we keep the cost as low as we can.");
    expect(CHECK_WORDS.contactLine).toBe("We contact your references only after our first conversation, and only with your OK.");
    expect(checkConsentVersion()).toMatch(/^cc-[0-9a-f]{8}$/);
  });
  it("a role always checked wins the reason, and the deciders' line says which", () => {
    expect(checkNeeded([ref()], true)).toEqual({ needed: true, because: "role" });
    expect(checkNeeded([], true).because).toBe("role");
    expect(checkLine({ needed: true, because: "no_references" })).toBe(ABOUT_WORDS.checkNeededNoReferences);
    expect(checkLine({ needed: true, because: "role" })).toBe(ABOUT_WORDS.checkNeededRole);
    expect(checkLine({ needed: false, because: null })).toBe(ABOUT_WORDS.checkNotNeeded);
  });
  it("reads a stored check safely", () => {
    expect(backgroundCheckOf(null)).toBeUndefined();
    expect(backgroundCheckOf({ needed: true, because: "x", consent: { at: "not a day", version: "v" } })).toEqual({ needed: true, because: null });
  });
});

describe("the open proposal, with and without the section", () => {
  const base = { name: "Rowan", email: "rowan@example.org", roles: [{ roleId: "r1", note: "" }], why: "Because.", aim: "" };
  const ctx = { roleIds: new Set(["r1"]), address: (s: string) => s || null };
  it("LEGACY: a form from before the section is taken and keeps none of it", () => {
    const p = parseOpenProposal(base, ctx);
    expect(p.ok && p.value.body.backgroundCheck).toBeUndefined();
    expect(openBodyOf({ roles: [{ roleId: "r1", note: "" }], why: "w", aim: "a" })).toEqual({ roles: [{ roleId: "r1", note: "" }], why: "w", aim: "a" });
  });
  it("a form that sends the section is judged by the role flag", () => {
    expect(parseOpenProposal({ ...base, references: [ref()] }, { ...ctx, alwaysChecked: () => true, now: AT })).toMatchObject({ ok: false, field: "checkConsent" });
    const ok = parseOpenProposal({ ...base, references: [ref()], checkConsent: consent, about: { based: "Uvita" } }, { ...ctx, alwaysChecked: () => true, now: AT });
    expect(ok.ok && ok.value.body.references).toHaveLength(1);
    expect(ok.ok && ok.value.body.about).toEqual({ based: "Uvita" });
  });
});

describe("the allow-list of what a model may be handed", () => {
  const body = { roles: [{ roleId: "r1", note: "n" }], why: "w", aim: "a", references: [ref()], backgroundCheck: { needed: true, because: "role" }, about: { based: "Uvita" }, links: [{ label: "x", url: "https://x.example" }], files: [{ id: "pf-1" }], name: "Rowan", email: "rowan@example.org" };
  it("passes the roles, why and aim and nothing else", () => {
    expect(Object.keys(forAssistants(body)).sort()).toEqual([...AI_SAFE_PROPOSAL_FIELDS].sort());
    const out = JSON.stringify(forAssistants(body));
    for (const secret of ["Ines Vargas", "ines@example.org", "fence", "Uvita", "backgroundCheck", "references", "https://x.example", "rowan@example.org"]) expect(out).not.toContain(secret);
  });
});

describe("the always-checked role flag", () => {
  it("is a role parameter a card editor can set, read from its column and written as 0 or 1", async () => {
    const { parseRoleParams, roleParamColumns, roleParamsFromRow } = await import("./roleParams");
    const { readParameter, PARAMETER_KEYS, PARAMETER_COLUMNS } = await import("./roleParameters");
    expect(PARAMETER_KEYS).toContain("alwaysChecked");
    expect(PARAMETER_COLUMNS.alwaysChecked).toBe("always_checked");
    expect(readParameter("alwaysChecked", true)).toEqual({ ok: true, value: true });
    expect(readParameter("alwaysChecked", "no")).toEqual({ ok: true, value: false });
    expect(readParameter("alwaysChecked", "maybe")).toMatchObject({ ok: false });
    const parsed = parseRoleParams({ alwaysChecked: true });
    expect(parsed.ok && roleParamColumns(parsed.value)).toEqual([["always_checked", 1]]);
    expect(parseRoleParams({ alwaysChecked: "yes" })).toMatchObject({ ok: false });
    expect(roleParamsFromRow({ always_checked: 1 }).alwaysChecked).toBe(true);
    expect(roleParamsFromRow({}).alwaysChecked).toBe(false);
  });
});
