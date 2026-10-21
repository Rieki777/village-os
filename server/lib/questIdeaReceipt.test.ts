/**
 * What the Propose a Quest page is told about an idea the inbox kept, for the
 * outcomes the DB-backed cases in publicForms.test.ts cannot produce on demand:
 * a database error and an allowance shared by visitors. Pure, no database.
 */
import { describe, expect, it } from "vitest";
import { OPEN_VISITOR_IDEAS } from "./publicForms";
import { ideaReceipt } from "./questIdeaReceipt";

describe("the receipt for a quest idea", () => {
  it("names the visitors' shared allowance for a visitor", () => {
    expect(ideaReceipt({ ok: false, error: "full", heldBack: "over_allowance" }, false)).toEqual({
      idea: { queued: false, held: "over_allowance", member: false, allowance: OPEN_VISITOR_IDEAS },
    });
  });

  it("says not_filed for a queue that could not be written, which names no hold-back", () => {
    expect(ideaReceipt({ ok: false, error: "The review queue could not be written." }, true)).toEqual({
      idea: { queued: false, held: "not_filed", member: true, allowance: null },
    });
  });

  it("says not_filed for a hold-back this form never names, so the page never renders an empty reason", () => {
    expect(ideaReceipt({ ok: false, error: "x", heldBack: "unknown_kind" }, true).idea).toMatchObject({ held: "not_filed" });
  });

  it("reads a duplicate as queued, because the idea is already in the queue", () => {
    expect(ideaReceipt({ ok: true, id: "qp-1", outcome: "duplicate" }, true)).toEqual({ idea: { queued: true } });
  });
});
