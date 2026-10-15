/**
 * The conflict agreement on the server (server/lib/conflictAgreement.ts), with
 * no database: the exit policy reading through it, an old policy that never
 * saw one, the founders' pen before and after the Birthing, the public view
 * refusing members' names, and the ombuds door keeping a pointer and no words.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_EXIT_POLICY, platformDefaultTermKeys, withPolicyDefaults } from "./exitPolicy";
import {
  AGREEMENT_BALLOT_NOW,
  NAME_WITHHELD,
  adoptedByBallot,
  anyOf,
  asksBy,
  conflictAgreementWrite,
  contactsMatcher,
  effectiveAgreement,
  memberNameMatcher,
  ombudsAskProblem,
  ombudsPointer,
  publicAgreementView,
  restorativeForPublic,
  sameRestorative,
  withConflictAgreement,
} from "./conflictAgreement";
import { agreementOf, parseAgreementContent } from "../../shared/conflictAgreement";

const ROLES = [
  { id: "care", name: "Care Holder" },
  { id: "cover", name: "Care Cover" },
  { id: "stewards", name: "Stewards" },
];
const ROLE_IDS = ROLES.map((r) => r.id);
const NOW = new Date("2026-09-28T12:00:00.000Z");
const MEMBERS = ["Mara Lind", "Tomás Vey", "May Holt"];

const body = (over: Record<string, unknown> = {}) => ({
  steps: [
    { what: "We talk it out", whoInRoom: "the two of us" },
    { what: "We bring it to the care holder", whoInRoom: "the two of us and the Care Holder" },
  ],
  careRole: "care",
  coverRole: "cover",
  replyHours: 48,
  outsideContacts: [{ id: "oc-1", name: "Ada Quill", organisation: "Cohort Care", role: "Ombuds", howToReach: "ada@example.invalid" }],
  whenPowerInvolved: { roleId: "stewards", outsideContactId: "", words: "" },
  safetyContacts: [{ name: "Crisis line", howToReach: "0800 000 000", when: "" }],
  consequencesLadder: { rungs: [{ rung: 1, words: "We ask for a change." }], appeal: "" },
  practices: [],
  reviewDate: "2027-01-15",
  ...over,
});

const write = (b: unknown, over: Partial<Parameters<typeof conflictAgreementWrite>[1]> = {}) =>
  conflictAgreementWrite(b, {
    storedRaw: null,
    roleIds: ROLE_IDS,
    platformSteps: DEFAULT_EXIT_POLICY.restorative.steps,
    actorId: "founder-1",
    now: NOW,
    gameStarted: false,
    ...over,
  });

const storedDoc = (over: Record<string, unknown> = {}) => {
  const w = write({ agreement: body(over), adopt: true });
  if (!w.ok) throw new Error(w.error);
  return w.doc;
};

/** A policy exactly as a release before the conflict-door fields saved it. */
const OLD_POLICY = {
  placeholder: false,
  voluntary: { noticePeriodDays: 30, valuationMethod: "Ours", unwindSteps: ["Hand off"] },
  involuntary: { decidingDomainId: "", appealDomainId: "", process: "Ours too" },
  restorative: { intakeContactRole: "care", steps: ["We talk first", "Then we ask the care holder"] },
};

describe("read-through: the exit policy's restorative block", () => {
  it("an old policy with no agreement reads exactly as it did", () => {
    const before = withPolicyDefaults(OLD_POLICY);
    const after = withConflictAgreement(before, null);
    expect(after).toBe(before);
    expect(after.restorative.steps).toEqual(OLD_POLICY.restorative.steps);
    expect(after.restorative.intakeContactRole).toBe("care");
  });

  it("an old policy's restorative fields are the agreement a village starts from, and nothing is written", () => {
    const frozen = JSON.stringify(OLD_POLICY);
    const { agreement, stored } = effectiveAgreement(null, withPolicyDefaults(OLD_POLICY).restorative, ROLE_IDS);
    expect(stored).toBe(false);
    expect(agreement.steps.map((s) => s.what)).toEqual(OLD_POLICY.restorative.steps);
    expect(agreement.careRole).toBe("care");
    expect(agreement.replyHours).toBeNull();
    expect(agreement.version).toBe(0);
    expect(JSON.stringify(OLD_POLICY)).toBe(frozen);
  });

  it("once saved, the agreement answers all five restorative fields and nothing else", () => {
    const doc = storedDoc();
    const policy = withConflictAgreement(withPolicyDefaults(OLD_POLICY), doc) as any;
    expect(policy.restorative).toMatchObject({
      intakeContactRole: "care",
      coverRole: "cover",
      replyHours: 48,
      steps: ["We talk it out. In the room: the two of us", "We bring it to the care holder. In the room: the two of us and the Care Holder"],
      outsideContact: { name: "Ada Quill", organisation: "Ombuds, Cohort Care", howToReach: "ada@example.invalid" },
    });
    expect(policy.voluntary).toEqual(withPolicyDefaults(OLD_POLICY).voluntary);
    expect(policy.placeholder).toBe(false);
    expect(policy.conflictAgreement).toEqual({ version: 1, adopted: true });
  });

  it("the platform-words check still sees the agreement's steps, so the publish gate judges what is printed", () => {
    // An adoption refuses these; a draft may hold them, and the gate then flags them.
    expect(write({ agreement: body({ steps: DEFAULT_EXIT_POLICY.restorative.steps.map((what) => ({ what, whoInRoom: "" })) }), adopt: true })).toMatchObject({ ok: false, frame: "steps" });
    const draft = write({ agreement: body({ steps: DEFAULT_EXIT_POLICY.restorative.steps.map((what) => ({ what, whoInRoom: "" })) }) });
    if (!draft.ok) throw new Error(draft.error);
    const policy = withConflictAgreement(withPolicyDefaults(OLD_POLICY), draft.doc) as any;
    expect(platformDefaultTermKeys(policy)).toContain("restorativeSteps");
  });

  it("a stored document that does not parse leaves the policy as it was", () => {
    const before = withPolicyDefaults(OLD_POLICY);
    expect(withConflictAgreement(before, { steps: "garbage" })).toBe(before);
  });
});

describe("the founders' pen, before the Birthing", () => {
  it("saves a draft with no stamp, and an adoption with who and when", () => {
    const draft = write({ agreement: body() });
    expect(draft).toMatchObject({ ok: true, changed: true });
    if (!draft.ok) return;
    expect(draft.doc).toMatchObject({ version: 1, adoptedAt: null, adoptedBy: null, adoptedHow: null });

    const adopted = write({ agreement: body(), adopt: true }, { storedRaw: draft.doc });
    if (!adopted.ok) throw new Error(adopted.error);
    expect(adopted.doc).toMatchObject({ version: 2, adoptedBy: "founder-1", adoptedHow: "founders", adoptedAt: NOW.toISOString() });
  });

  it("refuses an adoption that fails any adoption rule, and names the frame", () => {
    const r = write({ agreement: body({ reviewDate: "" }), adopt: true });
    expect(r).toMatchObject({ ok: false, status: 400, frame: "adoption" });
    const r2 = write({ agreement: body({ replyHours: null }), adopt: true });
    expect(r2).toMatchObject({ ok: false, status: 400, frame: "reply" });
  });

  it("refuses a draft over an adopted agreement, so a typo fix cannot withdraw the promise", () => {
    const adopted = storedDoc();
    const r = write({ agreement: body({ replyHours: 24 }) }, { storedRaw: adopted });
    expect(r).toMatchObject({ ok: false, status: 409, frame: "adoption" });
    const again = write({ agreement: body({ replyHours: 24 }), adopt: true }, { storedRaw: adopted, now: new Date("2026-09-29T00:00:00Z") });
    expect(again).toMatchObject({ ok: true, changed: true });
  });

  it("re-adopting the same words keeps the first stamp and changes nothing", () => {
    const adopted = storedDoc();
    const r = write({ agreement: body(), adopt: true }, { storedRaw: adopted, now: new Date("2026-10-05T00:00:00Z"), actorId: "someone-else" });
    expect(r).toMatchObject({ ok: true, changed: false });
    if (r.ok) expect(r.doc.adoptedAt).toBe(adopted.adoptedAt);
  });

  it("refuses the admin once the Game has started: the pen is a ballot now", () => {
    expect(write({ agreement: body(), adopt: true }, { gameStarted: true })).toEqual({ ok: false, status: 409, error: AGREEMENT_BALLOT_NOW });
  });

  it("a carried ballot stamps the ballot, never a person", () => {
    const parsed = parseAgreementContent(body(), { roleIds: ROLE_IDS });
    if (!parsed.ok) throw new Error(parsed.error);
    const doc = adoptedByBallot(parsed.content, storedDoc(), "b-42", NOW);
    expect(doc).toMatchObject({ version: 2, adoptedBy: "ballot:b-42", adoptedHow: "ballot" });
  });
});

describe("names: the public view refuses to print a member", () => {
  const names = memberNameMatcher(MEMBERS);

  it("matches a member's full name in any case, and a first name only as written", () => {
    expect(names("then we ask mara lind")).toBe(true);
    expect(names("then we ask Mara")).toBe(true);
    expect(names("then we ask mara")).toBe(false);
    expect(names("we may talk")).toBe(false);
    expect(names("May sits with us")).toBe(true);
    expect(names("Tomás")).toBe(true);
    expect(names("Marathon")).toBe(false);
    expect(names("")).toBe(false);
  });

  it("matches a first name or surname Capitalised or in CAPITALS however the member typed it, past a title, a hyphen or an accent", () => {
    const m = memberNameMatcher(["mara lopez", "Dr. Nia Okafor", "Rhea-Jane Moss", "José García"]);
    // A display name typed in lower case.
    expect(m("then we ask Mara")).toBe(true);
    expect(m("THEN WE ASK MARA")).toBe(true);
    // The surname.
    expect(m("Then Lopez joins us")).toBe(true);
    expect(m("Moss sits in")).toBe(true);
    // Past the title, which is never the name itself.
    expect(m("ask Nia")).toBe(true);
    expect(m("Dr. on call sits in")).toBe(false);
    // Each half of a hyphenated first name.
    expect(m("ask Rhea")).toBe(true);
    // Accents folded on both sides.
    expect(m("ask Jose")).toBe(true);
    expect(m("then Garcia")).toBe(true);
    // Whole words, and never lower case.
    expect(m("Mossy banks")).toBe(false);
    expect(m("we sit on the moss")).toBe(false);
  });

  it("withholds every string that names a member, and says so", () => {
    const doc = storedDoc({
      steps: [
        { what: "We talk it out", whoInRoom: "the two of us" },
        { what: "Then we ask Mara", whoInRoom: "Mara and us" },
      ],
      consequencesLadder: { rungs: [{ rung: 1, words: "Tomás asks for a change." }], appeal: "" },
    });
    const view = publicAgreementView(doc, ROLES, names);
    expect(view.withheld).toBe(true);
    expect(view.steps[0]).toEqual({ what: "We talk it out", whoInRoom: "the two of us" });
    expect(view.steps[1]).toEqual({ what: null, whoInRoom: null });
    expect(view.consequencesLadder.rungs[0].words).toBeNull();
    const text = JSON.stringify(view);
    for (const n of ["Mara", "Tomás", "Ada Quill", "ada@example.invalid", "Crisis line", "founder-1"]) expect(text).not.toContain(n);
  });

  it("names roles and outside contacts by organisation or role, and leaves the safety contacts out", () => {
    const view = publicAgreementView(storedDoc(), ROLES, names, (id) => id === "care");
    expect(view.withheld).toBe(false);
    expect(view.careRole).toEqual({ id: "care", name: "Care Holder", heldToday: true });
    expect(view.coverRole).toEqual({ id: "cover", name: "Care Cover", heldToday: false });
    expect(view.outsideContacts).toEqual([{ id: "oc-1", label: "Ombuds at Cohort Care" }]);
    expect(view.whenPowerInvolved.role).toBe("Stewards");
    expect("safetyContacts" in view).toBe(false);
    expect("adoptedBy" in view).toBe(false);
  });

  it("knows the agreement's own contacts by name and by how to reach them, spaced or not, and ignores a phrase too short to mean anything", () => {
    const own = contactsMatcher([
      {
        outsideContacts: [{ id: "oc-1", name: "Maria Lopez", organisation: "Harbour Mediation", role: "Mediator", howToReach: "0412 555 000" }],
        safetyContacts: [
          { name: "Sam Reid", howToReach: "sam.reid@example.org", when: "" },
          { name: "Gp", howToReach: "999", when: "" },
        ],
      },
    ]);
    expect(own("We call Maria first")).toBe(true);
    expect(own("Ring 0412555000 any time")).toBe(true);
    expect(own("Appeal to sam reid")).toBe(true);
    expect(own("Write to SAM.REID@example.org")).toBe(true);
    expect(own("We talk it out, the two of us")).toBe(false);
    expect(own("Call 999 in an emergency")).toBe(false);
    expect(anyOf(names, own)("Then Mara sits with us")).toBe(true);
    expect(contactsMatcher([null])("Anything at all")).toBe(false);
  });

  it("the exit policy's block, for somebody who is not a member, withholds named steps and the contact's person", () => {
    const r = restorativeForPublic(
      { intakeContactRole: "care", steps: ["We talk", "Then Mara sits with us"], outsideContact: { name: "Ada Quill", organisation: "Cohort Care", howToReach: "ada@x" } },
      names,
    );
    expect(r.steps).toEqual(["We talk", NAME_WITHHELD]);
    expect(r.outsideContact).toEqual({ name: "", organisation: "Cohort Care", howToReach: "" });
    expect(r.intakeContactRole).toBe("care");
  });
});

describe("the exit policy's own save while the agreement holds the block", () => {
  it("matches a body that changed nothing in the block, and not one that did", () => {
    const served = (withConflictAgreement(withPolicyDefaults(OLD_POLICY), storedDoc()) as any).restorative;
    expect(sameRestorative({ ...served, intakeRole: { id: "care" } }, served)).toBe(true);
    expect(sameRestorative({ ...served, replyHours: "48" }, served)).toBe(true);
    expect(sameRestorative({ ...served, steps: [...served.steps, "One more"] }, served)).toBe(false);
    expect(sameRestorative({ ...served, intakeContactRole: "cover" }, served)).toBe(false);
  });
});

describe("the ombuds door", () => {
  const a = agreementOf(storedDoc(), ROLE_IDS)!;

  it("refuses any words at all, whatever the field is called", () => {
    for (const extra of [{ message: "He shouted at me" }, { note: "x" }, { words: "y" }]) {
      expect(ombudsAskProblem({ contactId: "oc-1", ...extra }, a)).toMatchObject({ status: 400, error: expect.stringContaining("carries no words") });
    }
  });

  it("refuses a contact the agreement does not name, and an agreement that names none", () => {
    expect(ombudsAskProblem({ contactId: "oc-9" }, a)?.status).toBe(400);
    const none = agreementOf(storedDoc({ outsideContacts: [], whenPowerInvolved: { roleId: "", outsideContactId: "", words: "" } }), ROLE_IDS)!;
    expect(ombudsAskProblem({ contactId: "oc-1" }, none)?.status).toBe(404);
  });

  it("keeps who asked, when and which contact, and nothing else", () => {
    expect(ombudsAskProblem({ contactId: "OC-1" }, a)).toBeNull();
    const p = ombudsPointer(a, "OC-1", "member-7", NOW, "oa-1");
    expect(p).toEqual({ id: "oa-1", askedBy: "member-7", askedAt: NOW.toISOString(), contactId: "oc-1", contactLabel: "Ombuds at Cohort Care" });
    expect(Object.keys(p).sort()).toEqual(["askedAt", "askedBy", "contactId", "contactLabel", "id"]);
  });

  it("reads back one member's own asks, never another's", () => {
    const stored = { asks: [ombudsPointer(a, "oc-1", "m-1", NOW, "oa-1"), ombudsPointer(a, "oc-1", "m-2", NOW, "oa-2")] };
    expect(asksBy(stored, "m-1").map((x) => x.id)).toEqual(["oa-1"]);
    expect(JSON.stringify(asksBy(stored, "m-1"))).not.toContain("m-2");
    expect(asksBy(null, "m-1")).toEqual([]);
  });
});
