/**
 * THE REVIEW ROUND'S PURE RULES (spec US3, US4, R3, R9, R20, R39, C3, C9).
 */
import { describe, expect, it } from "vitest";
import {
  NOTE_BODY_MAX,
  REVIEW_DAYS_KEY,
  notePostProblem,
  powersTouchedBy,
  readiness,
  reviewEndsAt,
} from "./changeRequestReview";
import { VARIABLES_BY_KEY } from "./gameVariables";
import { isMetaSetting } from "./ballotSubjects";

const day = 24 * 60 * 60 * 1000;
const t0 = new Date("2026-11-06T12:00:00Z");

describe("the review length dial (C3, R20)", () => {
  it("defaults to 3 days, 0 to 30, structural, and is never trialled", () => {
    const def = VARIABLES_BY_KEY[REVIEW_DAYS_KEY];
    expect(def).toMatchObject({ default: "3", min: 0, max: 30, criticality: "structural", type: "integer" });
    expect(isMetaSetting(REVIEW_DAYS_KEY)).toBe(true);
  });
});

describe("reviewEndsAt", () => {
  it("counts from when the clock last started", () => {
    expect(reviewEndsAt(t0, 3, 3).getTime()).toBe(t0.getTime() + 3 * day);
  });

  it("uses the longer of the length when review opened and the length now, so lowering the dial shortens nothing", () => {
    expect(reviewEndsAt(t0, 5, 1).getTime()).toBe(t0.getTime() + 5 * day);
    expect(reviewEndsAt(t0, 1, 4).getTime()).toBe(t0.getTime() + 4 * day);
  });

  it("lets a village that chose 0 skip the wait (Article 0)", () => {
    expect(reviewEndsAt(t0, 0, 0).getTime()).toBe(t0.getTime());
  });
});

describe("notePostProblem: who may say what, and when", () => {
  const ok = { kind: "question", body: "Why now?", state: "in_review", byAgent: false, openObjectionThisRevision: false } as const;

  it("takes a question, a concern, an objection or a consent while the change request is in review", () => {
    for (const kind of ["question", "concern", "objection", "consent"] as const) {
      expect(notePostProblem({ ...ok, kind, body: kind === "consent" ? "" : "words" })).toBeNull();
    }
  });

  it("refuses notes outside review", () => {
    expect(notePostProblem({ ...ok, state: "gathering" })).toMatch(/review/);
    expect(notePostProblem({ ...ok, state: "voting" })).toMatch(/vote/);
  });

  it("needs a reason with an objection, and words with a question or a concern", () => {
    expect(notePostProblem({ ...ok, kind: "objection", body: "  " })).toMatch(/harm/);
    expect(notePostProblem({ ...ok, kind: "question", body: "" })).not.toBeNull();
    expect(notePostProblem({ ...ok, body: "x".repeat(NOTE_BODY_MAX + 1) })).toMatch(String(NOTE_BODY_MAX));
  });

  it("allows one open objection per member per revision, so objections cannot filibuster (R9)", () => {
    expect(notePostProblem({ ...ok, kind: "objection", body: "It harms the kitchen.", openObjectionThisRevision: true })).toMatch(/already/);
  });

  it("never lets an agent consent or object, never by proxy (I.22, R4)", () => {
    expect(notePostProblem({ ...ok, kind: "consent", body: "", byAgent: true })).toMatch(/person/);
    expect(notePostProblem({ ...ok, kind: "objection", body: "x", byAgent: true })).toMatch(/person/);
    expect(notePostProblem({ ...ok, kind: "question", byAgent: true })).toBeNull();
  });

  it("refuses a kind it does not know", () => {
    expect(notePostProblem({ ...ok, kind: "answer" as any })).not.toBeNull();
  });
});

describe("readiness: the checklist before the vote (R39)", () => {
  const base = { now: new Date(t0.getTime() + 4 * day), endsAt: new Date(t0.getTime() + 3 * day), changes: 2, objections: [] as { answered: boolean; postedAfterEnd: boolean }[] };

  it("is ready when the review time is over, there are changes, and every objection has an answer", () => {
    const r = readiness({ ...base, objections: [{ answered: true, postedAfterEnd: false }] });
    expect(r.ready).toBe(true);
    expect(r.lines.every((l) => l.done)).toBe(true);
  });

  it("waits for the review time, and says until when in words", () => {
    const r = readiness({ ...base, now: new Date(t0.getTime() + 1 * day) });
    expect(r.ready).toBe(false);
    const line = r.lines.find((l) => l.key === "review_time")!;
    expect(line.done).toBe(false);
    expect(line.words).toMatch(/^Waits until /);
  });

  it("waits for an answer to every objection posted during the review", () => {
    const r = readiness({ ...base, objections: [{ answered: false, postedAfterEnd: false }] });
    expect(r.ready).toBe(false);
    expect(r.lines.find((l) => l.key === "objections")!.words).toMatch(/1 objection/);
  });

  it("does not wait for an objection posted after the review ended: it goes to the vote with the rest (R9)", () => {
    expect(readiness({ ...base, objections: [{ answered: false, postedAfterEnd: true }] }).ready).toBe(true);
  });

  it("needs at least one change", () => {
    expect(readiness({ ...base, changes: 0 }).ready).toBe(false);
  });
});

describe("powersTouchedBy: who is asked to review (C9)", () => {
  const moduleOf = (key: string) => (key === "journal.prompt_days" ? ["health.record"] : null);

  it("asks a module's powers about that module's dials, and dial.set about the rest", () => {
    expect(powersTouchedBy({ key: "journal.prompt_days", to: "3" }, moduleOf)).toEqual(["health.record"]);
    expect(powersTouchedBy({ kind: "dial", key: "governance.vote_days", to: "9" }, moduleOf)).toEqual(["dial.set"]);
  });

  it("asks module.switch about a switch, story.tell about the brand, and cash.pay about minting", () => {
    expect(powersTouchedBy({ kind: "module_lifecycle", moduleId: "journal", to: "members" }, moduleOf)).toEqual(["module.switch"]);
    expect(powersTouchedBy({ kind: "brand_field", field: "project.tagline", to: "x" }, moduleOf)).toEqual(["story.tell"]);
    expect(powersTouchedBy({ kind: "mint_rule", key: "mint:r1:amount", to: "5" }, moduleOf)).toEqual(["cash.pay"]);
    expect(powersTouchedBy({ kind: "mint_rule_create", trigger: "quest", tokenSlug: "c", amount: "1", ceiling: "0" }, moduleOf)).toEqual(["cash.pay"]);
  });
});
