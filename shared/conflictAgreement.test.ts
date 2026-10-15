/**
 * The conflict agreement's shape and adoption rules (shared/conflictAgreement.ts):
 * every required field and every refusal, the defaults read from an old exit
 * policy, and the check a consequence past a request asks.
 */
import { describe, expect, it } from "vitest";
import {
  AGREEMENT_FRAMES,
  AGREEMENT_REPLY_HOURS_MAX,
  LADDER_RUNGS,
  OUTSIDE_CONTACTS_MAX,
  STEPS_MAX,
  adoptionProblem,
  agreementFromRestorative,
  agreementOf,
  agreementForReaders,
  calendarDate,
  consequenceBeyondRequestProblem,
  contactLabel,
  parseAgreementContent,
  restorativeFromAgreement,
  sameContent,
  stepLine,
  type ConflictAgreementContent,
} from "./conflictAgreement";

const ROLES = ["care", "cover", "stewards"];
const PLATFORM = ["Private intake with the contact role", "A facilitated repair conversation"];
const TODAY = "2026-09-28";

/** An agreement a village could adopt today. Each case breaks one thing. */
const good = () => ({
  steps: [
    { what: "We talk it out", whoInRoom: "the two of us" },
    { what: "We ask the care holder to sit with us", whoInRoom: "the two of us and the Care role" },
  ],
  careRole: "care",
  coverRole: "cover",
  replyHours: 48,
  outsideContacts: [{ id: "oc-1", name: "Ada Quill", organisation: "Cohort Care", role: "Ombuds", howToReach: "ada@example.invalid" }],
  whenPowerInvolved: { roleId: "stewards", outsideContactId: "", words: "The stewards hold it, or the ombuds." },
  safetyContacts: [{ name: "Local crisis line", howToReach: "0800 000 000", when: "Any time" }],
  consequencesLadder: {
    rungs: [
      { rung: 1, words: "We ask for a change." },
      { rung: 3, words: "Some keys pause for up to a moon." },
    ],
    appeal: "A panel of three members who are not involved hears it.",
  },
  practices: [{ name: "Beginning Anew", when: "Each new moon" }],
  reviewDate: "2027-01-15",
});

const parse = (body: unknown) => parseAgreementContent(body, { roleIds: ROLES });
const refusal = (body: unknown) => {
  const r = parse(body);
  if (r.ok) throw new Error("expected a refusal");
  return r;
};
const content = (body: unknown = good()): ConflictAgreementContent => {
  const r = parse(body);
  if (!r.ok) throw new Error(r.error);
  return r.content;
};

describe("the eight frames", () => {
  it("walks eight frames in the plan's order, each with its question", () => {
    expect(AGREEMENT_FRAMES.map((f) => f.id)).toEqual(["steps", "care", "reply", "power", "safety", "ladder", "practices", "adoption"]);
    for (const f of AGREEMENT_FRAMES) expect(f.question.length).toBeGreaterThan(20);
  });
});

describe("parseAgreementContent: the shape every save passes", () => {
  it("accepts a whole agreement and keeps every field", () => {
    const c = content();
    expect(c.steps).toHaveLength(2);
    expect(c.careRole).toBe("care");
    expect(c.replyHours).toBe(48);
    expect(c.outsideContacts[0]).toMatchObject({ id: "oc-1", role: "Ombuds" });
    expect(c.consequencesLadder.rungs.map((r) => r.rung)).toEqual([1, 3]);
    expect(c.reviewDate).toBe("2027-01-15");
  });

  it("drops blank rows the editor leaves behind, and keeps nothing it did not get", () => {
    const c = content({
      ...good(),
      steps: [{ what: "", whoInRoom: "" }, ...good().steps, { what: " ", whoInRoom: " " }],
      safetyContacts: [{ name: "", howToReach: "", when: "" }],
      practices: [{ name: "", when: "" }],
    });
    expect(c.steps).toHaveLength(2);
    expect(c.safetyContacts).toEqual([]);
    expect(c.practices).toEqual([]);
  });

  it("requires at least one step, and refuses a step that says who and not what", () => {
    expect(refusal({ ...good(), steps: [] })).toMatchObject({ frame: "steps", error: expect.stringContaining("at least one step") });
    expect(refusal({ ...good(), steps: [{ what: "", whoInRoom: "us" }] })).toMatchObject({
      frame: "steps",
      error: expect.stringContaining("The first step says who is in the room and not what happens"),
    });
    const many = Array.from({ length: STEPS_MAX + 1 }, (_, i) => ({ what: `Step ${i}`, whoInRoom: "us" }));
    expect(refusal({ ...good(), steps: many }).frame).toBe("steps");
    expect(refusal({ ...good(), steps: [{ what: "x".repeat(301), whoInRoom: "" }] }).error).toContain("300 characters");
  });

  it("refuses an unknown care or cover role, a cover without a care role, and a cover that is the care role", () => {
    expect(refusal({ ...good(), careRole: "ghost" })).toEqual({ ok: false, frame: "care", error: "The care role chosen here no longer exists. Choose another role, or none." });
    expect(refusal({ ...good(), coverRole: "ghost" }).error).toBe("The cover role chosen here no longer exists. Choose another role, or none.");
    expect(refusal({ ...good(), careRole: "", coverRole: "cover" }).error).toContain("choose the care role first");
    expect(refusal({ ...good(), coverRole: "care" }).error).toContain("The cover role is the care role itself");
  });

  it("asks an outside contact for a name, a way to reach them, and an organisation or role", () => {
    const one = (c: Record<string, string>) => ({ ...good(), outsideContacts: [c], whenPowerInvolved: { roleId: "", outsideContactId: "", words: "" } });
    expect(refusal(one({ name: "Ada", organisation: "Org", role: "", howToReach: "" })).error).toContain("a name and a way to reach them");
    expect(refusal(one({ name: "", organisation: "Org", role: "", howToReach: "x" })).error).toContain("a name and a way to reach them");
    expect(refusal(one({ name: "Ada", organisation: "", role: "", howToReach: "x" })).error).toContain("never by name");
    expect(content(one({ name: "Ada", organisation: "", role: "Ombuds", howToReach: "x" })).outsideContacts).toHaveLength(1);
    const four = Array.from({ length: OUTSIDE_CONTACTS_MAX + 1 }, (_, i) => ({ name: `N${i}`, organisation: "O", role: "", howToReach: "x" }));
    expect(refusal({ ...good(), outsideContacts: four, whenPowerInvolved: { roleId: "", outsideContactId: "", words: "" } }).frame).toBe("care");
  });

  it("gives every outside contact a stable id, keeping a valid one and never reusing one", () => {
    const c = content({
      ...good(),
      outsideContacts: [
        { id: "oc-2", name: "A", organisation: "O", role: "", howToReach: "x" },
        { name: "B", organisation: "O", role: "", howToReach: "y" },
        { id: "oc-2", name: "C", organisation: "O", role: "", howToReach: "z" },
      ],
      whenPowerInvolved: { roleId: "", outsideContactId: "", words: "" },
    });
    const ids = c.outsideContacts.map((o) => o.id);
    expect(ids[0]).toBe("oc-2");
    expect(new Set(ids).size).toBe(3);
  });

  it("takes a reply time as whole hours from 1 to the maximum, and a blank as not promised", () => {
    expect(content({ ...good(), replyHours: "72" }).replyHours).toBe(72);
    expect(content({ ...good(), replyHours: "" }).replyHours).toBeNull();
    expect(content({ ...good(), replyHours: null }).replyHours).toBeNull();
    for (const bad of [0, -1, 1.5, AGREEMENT_REPLY_HOURS_MAX + 1, "soon"]) {
      expect(refusal({ ...good(), replyHours: bad }).frame, String(bad)).toBe("reply");
    }
  });

  it("holds the power clause to one holder, never the care role, and only a named contact", () => {
    expect(refusal({ ...good(), whenPowerInvolved: { roleId: "stewards", outsideContactId: "oc-1", words: "" } }).error).toContain("Choose one");
    expect(refusal({ ...good(), whenPowerInvolved: { roleId: "care", outsideContactId: "", words: "" } }).error).toContain("The care role cannot hold it instead");
    expect(refusal({ ...good(), whenPowerInvolved: { roleId: "ghost", outsideContactId: "", words: "" } }).error).toBe('Unknown role "ghost"');
    expect(refusal({ ...good(), whenPowerInvolved: { roleId: "", outsideContactId: "oc-9", words: "" } }).frame).toBe("power");
    expect(content({ ...good(), whenPowerInvolved: { roleId: "", outsideContactId: "oc-1", words: "" } }).whenPowerInvolved.outsideContactId).toBe("oc-1");
  });

  it("asks a safety contact for a name and a way to reach them", () => {
    expect(refusal({ ...good(), safetyContacts: [{ name: "Line", howToReach: "", when: "" }] })).toMatchObject({ frame: "safety" });
  });

  it("refuses any rung past a request without an appeal, a rung the page does not offer, and a rung written twice", () => {
    const ladder = (rungs: unknown[], appeal = "") => ({ ...good(), consequencesLadder: { rungs, appeal } });
    expect(refusal(ladder([{ rung: 1, words: "Ask" }, { rung: 2, words: "Write it" }]))).toMatchObject({
      frame: "ladder",
      error: expect.stringContaining("needs a way to appeal it"),
    });
    expect(content(ladder([{ rung: 1, words: "Ask" }])).consequencesLadder.appeal).toBe("");
    expect(refusal(ladder([{ rung: 5, words: "x" }], "a")).frame).toBe("ladder");
    expect(refusal(ladder([{ rung: 2, words: "x" }, { rung: 2, words: "y" }], "a")).error).toContain("written twice");
    expect(content(ladder([{ rung: 4, words: "Leave" }, { rung: 1, words: "Ask" }], "a")).consequencesLadder.rungs.map((r) => r.rung)).toEqual([1, 4]);
  });

  it("refuses a practice with no name, and a review date that is not a calendar day", () => {
    expect(refusal({ ...good(), practices: [{ name: "", when: "Mondays" }] }).frame).toBe("practices");
    expect(refusal({ ...good(), reviewDate: "2027-02-30" }).frame).toBe("adoption");
    expect(content({ ...good(), reviewDate: "" }).reviewDate).toBeNull();
  });
});

describe("adoptionProblem: what adopting asks on top", () => {
  const ctx = { today: TODAY, platformSteps: PLATFORM };

  it("passes a whole agreement", () => {
    expect(adoptionProblem(content(), ctx)).toBeNull();
  });

  it("refuses the platform's own steps word for word", () => {
    const c = content({ ...good(), steps: PLATFORM.map((what) => ({ what: `  ${what.toUpperCase()} `, whoInRoom: "" })) });
    expect(adoptionProblem(c, ctx)).toMatchObject({ frame: "steps", error: expect.stringContaining("word for word the platform's") });
  });

  it("asks who is in the room at every step", () => {
    const c = content({ ...good(), steps: [{ what: "We talk", whoInRoom: "us" }, { what: "We ask", whoInRoom: "" }] });
    expect(adoptionProblem(c, ctx)).toMatchObject({ frame: "steps", error: expect.stringContaining("The second step") });
  });

  it("needs a door: a care role or a named outside contact, either one", () => {
    const none = content({ ...good(), careRole: "", coverRole: "", outsideContacts: [], whenPowerInvolved: { roleId: "", outsideContactId: "", words: "" } });
    expect(adoptionProblem(none, ctx)?.frame).toBe("care");
    expect(adoptionProblem(content({ ...good(), careRole: "", coverRole: "" }), ctx)).toBeNull();
    expect(adoptionProblem(content({ ...good(), outsideContacts: [], whenPowerInvolved: { roleId: "", outsideContactId: "", words: "" } }), ctx)).toBeNull();
  });

  it("needs a reply time, with no default", () => {
    expect(adoptionProblem(content({ ...good(), replyHours: null }), ctx)?.frame).toBe("reply");
  });

  it("needs a review date after today and within five years", () => {
    expect(adoptionProblem(content({ ...good(), reviewDate: null }), ctx)).toMatchObject({ frame: "adoption", error: expect.stringContaining("Adopting needs one") });
    expect(adoptionProblem(content({ ...good(), reviewDate: TODAY }), ctx)?.error).toContain("after today");
    expect(adoptionProblem(content({ ...good(), reviewDate: "2031-09-29" }), ctx)?.error).toContain("within 5 years");
    expect(adoptionProblem(content({ ...good(), reviewDate: "2031-09-28" }), ctx)).toBeNull();
  });
});

describe("consequenceBeyondRequestProblem", () => {
  const adopted = { ...content(), adoptedAt: "2026-09-01T00:00:00.000Z" };
  it("refuses with no adopted agreement, a rung the ladder does not include, or no appeal", () => {
    expect(consequenceBeyondRequestProblem(null, 3)).toContain("has not adopted");
    expect(consequenceBeyondRequestProblem({ ...adopted, adoptedAt: null }, 3)).toContain("has not adopted");
    expect(consequenceBeyondRequestProblem(adopted, 2)).toContain(LADDER_RUNGS[2].name);
    expect(consequenceBeyondRequestProblem({ ...adopted, consequencesLadder: { ...adopted.consequencesLadder, appeal: " " } }, 3)).toContain("names no appeal");
  });
  it("allows a rung the adopted ladder includes, with its appeal", () => {
    expect(consequenceBeyondRequestProblem(adopted, 3)).toBeNull();
  });
});

describe("from an old exit policy, and back", () => {
  it("reads an old policy's restorative fields as the agreement's defaults", () => {
    const d = agreementFromRestorative({
      intakeContactRole: "care",
      steps: ["Talk", " ", "Ask the care holder"],
      coverRole: "cover",
      replyHours: 24,
      outsideContact: { name: "Ada", organisation: "Cohort Care", howToReach: "ada@x" },
    });
    expect(d.steps).toEqual([
      { what: "Talk", whoInRoom: "" },
      { what: "Ask the care holder", whoInRoom: "" },
    ]);
    expect(d).toMatchObject({ careRole: "care", coverRole: "cover", replyHours: 24 });
    expect(d.outsideContacts).toEqual([{ id: "oc-1", name: "Ada", organisation: "Cohort Care", role: "", howToReach: "ada@x" }]);
    expect(d.practices).toEqual([]);
    expect(d.reviewDate).toBeNull();
  });

  it("reads a policy saved before the conflict-door fields existed with them empty", () => {
    const d = agreementFromRestorative({ intakeContactRole: "", steps: ["Talk"] });
    expect(d).toMatchObject({ coverRole: "", replyHours: null, outsideContacts: [] });
  });

  it("writes the steps back as lines, with who is in the room", () => {
    expect(stepLine({ what: "We talk it out", whoInRoom: "the two of us" })).toBe("We talk it out. In the room: the two of us");
    expect(stepLine({ what: "We talk.", whoInRoom: "us" })).toBe("We talk. In the room: us");
    expect(stepLine({ what: "We talk", whoInRoom: "" })).toBe("We talk");
    const r = restorativeFromAgreement(content());
    expect(r.intakeContactRole).toBe("care");
    expect(r.outsideContact).toEqual({ name: "Ada Quill", organisation: "Ombuds, Cohort Care", howToReach: "ada@example.invalid" });
    expect(restorativeFromAgreement(content({ ...good(), outsideContacts: [], whenPowerInvolved: { roleId: "", outsideContactId: "", words: "" } })).outsideContact).toEqual({ name: "", organisation: "", howToReach: "" });
  });

  it("names an outside contact publicly by role and organisation, never by name", () => {
    expect(contactLabel({ organisation: "Cohort Care", role: "Ombuds" })).toBe("Ombuds at Cohort Care");
    expect(contactLabel({ organisation: "Cohort Care", role: "" })).toBe("Cohort Care");
    expect(contactLabel({ organisation: "", role: "" })).toBe("An outside contact");
  });
});

describe("a stored document", () => {
  it("reads back whole, and a corrupt one reads as none", () => {
    const stored = { ...content(), version: 3, adoptedBy: "u-1", adoptedHow: "founders", adoptedAt: "2026-09-01T00:00:00.000Z", updatedAt: "x" };
    const a = agreementOf(stored, ROLES)!;
    expect(a.version).toBe(3);
    expect(a.adoptedHow).toBe("founders");
    expect(agreementOf({ steps: [] }, ROLES)).toBeNull();
    expect(agreementOf("nonsense", ROLES)).toBeNull();
    expect(agreementOf(null, ROLES)).toBeNull();
  });

  it("stays readable after a role it names is deleted", () => {
    const a = agreementOf({ ...content(), version: 1 }, []);
    expect(a?.careRole).toBe("care");
  });

  it("serves readers everything but who adopted it", () => {
    const a = agreementOf({ ...content(), version: 1, adoptedBy: "ballot:b-9", adoptedHow: "ballot", adoptedAt: "t" }, ROLES)!;
    const r = agreementForReaders(a);
    expect("adoptedBy" in r).toBe(false);
    expect(r.ballotId).toBe("b-9");
  });

  it("compares content, and not the stamp", () => {
    const a = content();
    expect(sameContent(a, { ...a })).toBe(true);
    expect(sameContent(a, { ...a, replyHours: 12 })).toBe(false);
  });

  it("checks review dates against the calendar", () => {
    expect(calendarDate("2028-02-29")).toBe("2028-02-29");
    expect(calendarDate("2027-02-29")).toBeNull();
    expect(calendarDate("tomorrow")).toBeNull();
  });
});
