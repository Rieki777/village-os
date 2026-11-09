/**
 * SUGGEST-TO-EDIT, THE PURE HALF (ROLE_POWERS_DESIGN.md §4.5; Rye made it GO
 * on 2026-11-06).
 *
 * A member without the power behind an admin control may still suggest a
 * change. Where the suggestion goes is decided here, by who holds the power
 * right now, and nowhere else:
 *
 *   - the village holds the power   -> a village ballot
 *   - nobody holds it               -> a village ballot
 *   - a live role holder holds it   -> the holders' review queue
 *
 * with two keys that never go to holders: the steward's veto, and any control
 * that passes powers to the village.
 */
import { describe, expect, it } from "vitest";
import { ALL_CAPABILITIES, type Capability } from "./capabilities";
import {
  ADMIN_EDIT_CONTROLS,
  SUGGESTION_RAISE_AFTER_DAYS,
  SUGGESTION_ROUTE,
  declineReasonProblem,
  mayRaiseToBallot,
  routeSuggestion,
  suggestionDiff,
} from "./suggestions";
import {
  ALL_DRAFT_KINDS,
  DRAFT_KINDS,
  SUGGESTION_DRAFT_KINDS,
  SUGGESTION_KIND_CONSEQUENCE,
  validateDraftPayload,
} from "./draftKinds";

describe("SUGGESTION_ROUTE", () => {
  it("names every capability, so a new key is a choice somebody makes", () => {
    expect(Object.keys(SUGGESTION_ROUTE).sort()).toEqual([...ALL_CAPABILITIES].sort());
  });

  it("defaults to the holders, and sends the steward's veto to a ballot", () => {
    for (const cap of ALL_CAPABILITIES) {
      expect(SUGGESTION_ROUTE[cap], cap).toBe(cap === "steward.veto" ? "ballot" : "holders");
    }
  });
});

describe("routeSuggestion", () => {
  const base = { capability: "story.tell" as Capability, villageHolds: false, liveHolders: ["u-holder"] };

  it("sends a suggestion to the live holders' queue", () => {
    expect(routeSuggestion(base)).toBe("holders");
  });

  it("sends it to a ballot when the village holds the power", () => {
    expect(routeSuggestion({ ...base, villageHolds: true })).toBe("ballot");
  });

  it("sends it to a ballot when nobody holds the power", () => {
    expect(routeSuggestion({ ...base, liveHolders: [] })).toBe("ballot");
  });

  it("sends a suggestion on the steward's veto to a ballot, whatever the table says", () => {
    const flipped = { ...SUGGESTION_ROUTE, "steward.veto": "holders" as const };
    expect(routeSuggestion({ ...base, capability: "steward.veto" }, flipped)).toBe("ballot");
  });

  it("sends a suggestion that passes powers to the village to a ballot, with holders seated", () => {
    expect(routeSuggestion({ ...base, passesPowers: true })).toBe("ballot");
  });

  it("honours a per-power override to a ballot", () => {
    const override = { ...SUGGESTION_ROUTE, "story.tell": "ballot" as const };
    expect(routeSuggestion(base, override)).toBe("ballot");
  });
});

describe("the admin controls a suggestion may name", () => {
  it("wires the paths and stages words behind story.tell, and the cash budget's four controls behind role.pay", () => {
    expect(Object.keys(ADMIN_EDIT_CONTROLS)).toEqual(["village_paths", "budget_lines", "budget_envelopes", "budget_notes", "budget_sources"]);
    expect(ADMIN_EDIT_CONTROLS.village_paths.capability).toBe("story.tell");
    expect(ADMIN_EDIT_CONTROLS.village_paths.passesPowers).toBe(false);
    // Budgets spec R22: its Accept and its ballot closer call importBudgetLines (server/routes/budgets.test.ts).
    expect(ADMIN_EDIT_CONTROLS.budget_lines.capability).toBe("role.pay");
    expect(ADMIN_EDIT_CONTROLS.budget_lines.passesPowers).toBe(false);
    // B3: the budget's other writes have the same vote path, behind the same power.
    for (const id of ["budget_envelopes", "budget_notes", "budget_sources"] as const) {
      expect(ADMIN_EDIT_CONTROLS[id].capability, id).toBe("role.pay");
      expect(ADMIN_EDIT_CONTROLS[id].passesPowers, id).toBe(false);
    }
  });
});

describe("the admin_edit draft kind", () => {
  const ok = { control: "village_paths", capability: "story.tell", version: "0a1b2c3d", base: {}, payload: { ladder: { title: "Our way" } } };

  it("is a draft kind of its own, kept out of the assistant's queue", () => {
    expect(SUGGESTION_DRAFT_KINDS).toEqual(["admin_edit"]);
    expect((DRAFT_KINDS as readonly string[]).includes("admin_edit")).toBe(false);
    expect(ALL_DRAFT_KINDS).toContain("admin_edit");
    expect(SUGGESTION_KIND_CONSEQUENCE.admin_edit.length).toBeGreaterThan(20);
  });

  it("accepts the control, the payload, the power it needs and the version it was made on", () => {
    expect(validateDraftPayload("admin_edit", ok)).toBeNull();
  });

  it("refuses a control nobody wired", () => {
    expect(validateDraftPayload("admin_edit", { ...ok, control: "secrets" })).toContain("control");
  });

  it("refuses a power that is not the control's own", () => {
    expect(validateDraftPayload("admin_edit", { ...ok, capability: "cash.pay" })).toContain("story.tell");
  });

  it("refuses a missing version, so a stale accept can always be seen", () => {
    expect(validateDraftPayload("admin_edit", { ...ok, version: "" })).toContain("version");
  });

  it("refuses a field it does not know", () => {
    expect(validateDraftPayload("admin_edit", { ...ok, extra: 1 })).toContain("unexpected");
  });
});

describe("a decline's reason", () => {
  it("is required", () => {
    expect(declineReasonProblem(undefined)).not.toBeNull();
    expect(declineReasonProblem("   ")).not.toBeNull();
  });

  it("is one line", () => {
    expect(declineReasonProblem("first line\nsecond line")).toContain("one line");
  });

  it("is short", () => {
    expect(declineReasonProblem("x".repeat(281))).not.toBeNull();
  });

  it("passes a plain sentence", () => {
    expect(declineReasonProblem("We renamed the stages last week, let us wait a moon.")).toBeNull();
  });
});

describe("raising a suggestion to a ballot", () => {
  const made = new Date("2026-11-01T00:00:00Z");
  const day = 24 * 60 * 60 * 1000;

  it("waits 14 days while holders could review it", () => {
    expect(SUGGESTION_RAISE_AFTER_DAYS).toBe(14);
    expect(mayRaiseToBallot(made, new Date(made.getTime() + 13 * day), "holders")).toBe(false);
    expect(mayRaiseToBallot(made, new Date(made.getTime() + 14 * day), "holders")).toBe(true);
  });

  it("needs no wait once nobody is left to review it", () => {
    expect(mayRaiseToBallot(made, new Date(made.getTime() + day), "ballot")).toBe(true);
  });
});

describe("suggestionDiff", () => {
  it("names each leaf that differs, with both values", () => {
    const d = suggestionDiff({ ladder: { title: "A" }, paths: { x: { label: "L" } } }, { ladder: { title: "B" }, paths: { x: { label: "L" } } });
    expect(d).toEqual([{ path: "ladder.title", from: "A", to: "B" }]);
  });

  it("reads a field that is absent on one side as missing", () => {
    expect(suggestionDiff({}, { ladder: { title: "B" } })).toEqual([{ path: "ladder.title", from: null, to: "B" }]);
  });

  it("is empty for two equal documents", () => {
    expect(suggestionDiff({ a: [1, 2] }, { a: [1, 2] })).toEqual([]);
  });
});
