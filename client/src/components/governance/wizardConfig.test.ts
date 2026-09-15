/**
 * The wizard as data: the walk, the skips, and the drift guard.
 *
 * The claim this file holds is lane G2's own metric: ALL FIVE PROPOSAL TYPES
 * COMPLETE END TO END. A wizard driven by a config is only as complete as the
 * config, so completeness is proven here, type by type, rather than by clicking
 * one of them in a browser and assuming the other four.
 *
 * It also holds the seam that would otherwise rot silently: the type list lives
 * in two files (the server validates drafts without importing React; the client
 * config carries icons and components). Two lists that must agree and nothing
 * checking is how a member saves a draft the server refuses.
 */
import { describe, expect, it } from "vitest";
import {
  TYPE_GROUPS,
  WIZARD_STEPS,
  WIZARD_TYPES,
  WIZARD_TYPE_CONFIGS,
  subjectNoun,
  typeConfig,
} from "./wizardConfig";
import {
  fieldsFor,
  nextStep,
  positionOf,
  prevStep,
  problemsFor,
  problemsInStep,
  readyToPublish,
  stepAtIndex,
  walkFor,
} from "./wizardWalk";
import {
  CONDUCTABLE_TYPES as SERVER_CONDUCTABLE_TYPES,
  WIZARD_TYPES as SERVER_WIZARD_TYPES,
} from "../../../../server/lib/proposalDrafts";
import { MINT_RULE, SUBJECT_THRESHOLDS, VILLAGE_LAUNCH } from "../../../../shared/ballotSubjects";

/** Answers that satisfy every validator a type declares, built from the config
 *  itself so a new required field fails this suite instead of shipping. */
const completeAnswersFor = (typeId: string): Record<string, unknown> => {
  const answers: Record<string, unknown> = {};
  for (const step of walkFor(typeId)) {
    for (const f of fieldsFor(typeId, step.key)) {
      if (!f.problem) continue;
      if (f.kind === "changeSet") answers[f.key] = [{ key: "governance.sensing_days", to: "10" }];
      else if (f.kind === "percent") answers[f.key] = 50;
      else if (f.kind === "number") answers[f.key] = 12;
      else answers[f.key] = "x".repeat(80);
    }
  }
  return answers;
};

describe("the wizard config", () => {
  it("holds the same type list as the server's draft validator", () => {
    expect([...WIZARD_TYPES]).toEqual([...SERVER_WIZARD_TYPES]);
  });

  it("has one config per declared type, and no orphans", () => {
    expect(WIZARD_TYPE_CONFIGS.map((t) => t.id).sort()).toEqual([...WIZARD_TYPES].sort());
    for (const id of WIZARD_TYPES) expect(typeConfig(id), id).toBeTruthy();
  });

  it("names every subject type as a noun for the decision cards", () => {
    for (const id of WIZARD_TYPES) {
      expect(subjectNoun(id), id).not.toBe("Decision");
    }
    // An id from a lane that has not landed still renders something readable.
    expect(subjectNoun("something_new")).toBe("Decision");
  });

  /**
   * THE SUBJECT TYPES THAT ARE NOT WIZARD TYPES, which the loop above cannot
   * see. `ballots.subject_type` carries these too, and each one reached the
   * decision card reading "Decision" until somebody noticed: the advisory
   * vote did, and `mint_rule` did again the moment minting became a thing the
   * village votes on.
   *
   * Bound to `SUBJECT_THRESHOLDS` rather than to a hand-copied list, so a
   * subject type that arrives with its own threshold has to arrive with a
   * name as well. `advisory` sets no threshold of its own, so it is named
   * here on purpose.
   */
  it("names the subject types that never pass through the wizard", () => {
    for (const id of Object.keys(SUBJECT_THRESHOLDS)) {
      expect(subjectNoun(id), id).not.toBe("Decision");
    }
    expect(subjectNoun(VILLAGE_LAUNCH)).toBe("Starting the Game");
    expect(subjectNoun(MINT_RULE)).toBe("Minting rule change");
    expect(subjectNoun("advisory")).toBe("Advisory vote");
  });

  it("puts every type in a group the type step renders", () => {
    for (const t of WIZARD_TYPE_CONFIGS) {
      expect(TYPE_GROUPS, t.id).toContain(t.group);
    }
  });

  it("gives every type a publish target and a sentence saying what publishing does", () => {
    for (const t of WIZARD_TYPE_CONFIGS) {
      expect(t.publish.path, t.id).toMatch(/^\/api\//);
      expect(t.consequence.length, t.id).toBeGreaterThan(20);
      // The body mapper runs on whatever the wizard collected, including
      // nothing: a mapper that throws on an empty draft breaks the review step.
      expect(() => t.publish.body({}), t.id).not.toThrow();
    }
  });
});

describe("the walk", () => {
  it("starts on the type step and ends on review, for every type", () => {
    for (const id of WIZARD_TYPES) {
      const walk = walkFor(id);
      expect(walk[0].key, id).toBe("type");
      expect(walk[walk.length - 1].key, id).toBe("review");
    }
  });

  it("keeps the canonical order, only ever removing steps", () => {
    const canonical = WIZARD_STEPS.map((s) => s.key);
    for (const id of WIZARD_TYPES) {
      const keys = walkFor(id).map((s) => s.key);
      expect(keys, id).toEqual(canonical.filter((k) => keys.includes(k)));
    }
  });

  it("prunes the steps a type declares it does not have", () => {
    // A rule change has no terms: the dials ARE the terms.
    expect(walkFor("mechanics").map((s) => s.key)).not.toContain("terms");
    // An agreement has no subject to pick: writing it is picking it.
    expect(walkFor("agreement").map((s) => s.key)).not.toContain("subject");
    // And a type that skips nothing walks all five.
    expect(walkFor("role_application")).toHaveLength(WIZARD_STEPS.length);
  });

  it("steps over a gap in BOTH directions", () => {
    // Forward across the skipped terms step.
    expect(nextStep("mechanics", "details")).toBe("review");
    // Backward across it, which is where the one-line while-loop goes wrong.
    expect(prevStep("mechanics", "review")).toBe("details");
    // And across the skipped subject step at the front.
    expect(nextStep("agreement", "type")).toBe("details");
    expect(prevStep("agreement", "details")).toBe("type");
  });

  it("stops at both ends rather than running off them", () => {
    expect(prevStep("mechanics", "type")).toBeNull();
    expect(nextStep("mechanics", "review")).toBeNull();
  });

  it("recovers from a step the type does not have", () => {
    // A draft written before the config pruned this step points at nothing.
    expect(positionOf("mechanics", "terms")).toBe(-1);
    expect(nextStep("mechanics", "terms")).toBe("type");
    expect(prevStep("agreement", "subject")).toBe("type");
  });

  it("clamps a stored draft index into a step the type really has", () => {
    expect(stepAtIndex("mechanics", 0)).toBe("type");
    expect(stepAtIndex("mechanics", 3)).toBe("review");
    // Out of range in both directions, and fractional.
    expect(stepAtIndex("mechanics", 99)).toBe("review");
    expect(stepAtIndex("mechanics", -4)).toBe("type");
    expect(stepAtIndex("mechanics", 1.7)).toBe("subject");
    // An unknown type lands somewhere it can recover from, never nowhere.
    expect(stepAtIndex("no-such-type", 3)).toBe("type");
    expect(walkFor(null)).toHaveLength(1);
  });
});

describe("validation across the whole walk", () => {
  it("every type refuses an empty draft and names what is missing", () => {
    for (const id of WIZARD_TYPES) {
      const problems = problemsFor(id, {});
      expect(problems.length, `${id} should refuse an empty draft`).toBeGreaterThan(0);
      for (const p of problems) {
        expect(p.message.length, `${id}.${p.field}`).toBeGreaterThan(10);
        // Every problem points at a step the member can actually reach.
        expect(positionOf(id, p.step), `${id}.${p.field}`).toBeGreaterThanOrEqual(0);
      }
      expect(readyToPublish(id, {}), id).toBe(false);
    }
  });

  it("every type completes end to end once its fields are answered", () => {
    for (const id of WIZARD_TYPES) {
      const answers = completeAnswersFor(id);
      expect(problemsFor(id, answers), `${id}: ${JSON.stringify(problemsFor(id, answers))}`).toEqual([]);
      expect(readyToPublish(id, answers), id).toBe(true);
      // And the finished answers map onto the publish body without throwing.
      expect(() => typeConfig(id)!.publish.body(answers), id).not.toThrow();
    }
  });

  it("reports a step's own problems for the inline hints", () => {
    const inStep = problemsInStep("mechanics", "details", {});
    expect(inStep.has("title")).toBe(true);
    expect(inStep.has("rationale")).toBe(true);
    // The dial picker's problem belongs to the subject step, not this one.
    expect(inStep.has("changes")).toBe(false);
  });

  it("refuses an unknown type outright", () => {
    expect(readyToPublish("coup", { title: "x".repeat(80) })).toBe(false);
    expect(readyToPublish(null, {})).toBe(false);
  });

  it("holds percentages to 0 through 100", () => {
    const answers = completeAnswersFor("role_application");
    expect(problemsFor("role_application", { ...answers, commitmentPct: 101 })).toHaveLength(1);
    expect(problemsFor("role_application", { ...answers, commitmentPct: -1 })).toHaveLength(1);
    expect(problemsFor("role_application", { ...answers, commitmentPct: 0 })).toEqual([]);
    expect(problemsFor("role_application", { ...answers, commitmentPct: 100 })).toEqual([]);
  });
});

/**
 * SEATING SOMEBODY BY VOTE, WITH THE TERM THEY WOULD SIT FOR.
 *
 * Rye, 2026-09-14: every seat has a term, and a seat with no date asked ends
 * with the season. The wizard type is the first screen that opens a seat vote,
 * so the contract with `POST /api/governance/role-seats` is pinned here.
 */
describe("the seat vote", () => {
  const cfg = typeConfig("role_seat")!;
  const base = { userId: "u-1", roleId: "role-water", reason: "She has kept the spring running for three seasons now." };

  it("publishes to the route that opens a seat vote, and the server can conduct it", () => {
    expect(cfg.publish.path).toBe("/api/governance/role-seats");
    expect(SERVER_CONDUCTABLE_TYPES).toContain("role_seat");
    expect(cfg.opensVote).toBe(true);
    expect(subjectNoun("role_seat")).toBe("Who sits in a role");
  });

  it("sends an end date only when one was picked, so a blank one ends with the season", () => {
    expect(cfg.publish.body(base)).toEqual(base);
    expect(cfg.publish.body({ ...base, termEndsOn: "  " })).toEqual(base);
    expect(cfg.publish.body({ ...base, termEndsOn: "2027-03-21" })).toEqual({ ...base, termEndsOn: "2027-03-21" });
  });

  it("asks the end date on the terms step, tied to the role a steward's cap is read from", () => {
    const terms = fieldsFor("role_seat", "terms");
    expect(terms.map((f) => [f.key, f.kind, f.roleKey])).toEqual([["termEndsOn", "seatTerm", "roleId"]]);
    // Optional: an empty date is the season's end, and never a problem.
    expect(problemsFor("role_seat", { ...base, termEndsOn: "" })).toEqual([]);
  });

  it("asks for the reason the route asks for, at the length it asks for", () => {
    const short = problemsFor("role_seat", { ...base, reason: "x".repeat(39) });
    expect(short.map((p) => p.field)).toEqual(["reason"]);
  });
});
