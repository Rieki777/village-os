/**
 * The advice process, without a database: reading a request, a piece of
 * advice and a decision from a body, and the words. The doors run against a
 * real schema in server/sessionAdvice.db.test.ts.
 */
import { describe, expect, it } from "vitest";
import { ADVICE_COPY, ADVICE_LIMITS, ADVICE_NOTICES, ADVICE_REFUSALS, adviceGiveUrl, cleanAdvice, cleanAdviceAsk, cleanDecision } from "./sessionAdvice";

const TODAY = "2026-10-24";
const LIVE = new Set(["garden"]);
const ask = (over: Record<string, unknown> = {}) => cleanAdviceAsk({ circleId: "garden", intent: "  Move the compost bays\nnext to the gate. ", context: "", decideBy: "2026-10-31", ...over }, LIVE, TODAY);

describe("reading a request for advice", () => {
  it("reads a live circle, what and why, and a decide-by date", () => {
    expect(ask()).toEqual({ ok: true, value: { circleId: "garden", intent: "Move the compost bays\nnext to the gate.", context: null, decideBy: "2026-10-31" } });
    expect(ask({ context: "The gate is closer to the beds." })).toMatchObject({ ok: true, value: { context: "The gate is closer to the beds." } });
  });

  it("refuses a circle that is not live, no intent, and a date out of bounds", () => {
    expect(ask({ circleId: "moon" })).toEqual({ ok: false, error: ADVICE_REFUSALS.circleUnknown });
    expect(ask({ intent: "   " })).toEqual({ ok: false, error: ADVICE_REFUSALS.intentNeeded });
    expect(ask({ decideBy: "soon" })).toEqual({ ok: false, error: ADVICE_REFUSALS.dateNeeded });
    expect(ask({ decideBy: "2026-02-30" })).toEqual({ ok: false, error: ADVICE_REFUSALS.dateNeeded });
    expect(ask({ decideBy: TODAY })).toEqual({ ok: false, error: ADVICE_REFUSALS.pastDate });
    expect(ask({ decideBy: "2026-12-24" })).toEqual({ ok: false, error: ADVICE_REFUSALS.tooFar });
    expect(ask({ decideBy: "2026-12-23" })).toMatchObject({ ok: true });
  });

  it("keeps the words to their limits", () => {
    const out = ask({ intent: "x".repeat(ADVICE_LIMITS.intent + 50) });
    expect(out.ok && out.value.intent.length).toBe(ADVICE_LIMITS.intent);
  });
});

describe("reading advice and a decision", () => {
  it("needs words for each", () => {
    expect(cleanAdvice({ advice: " Ask the kitchen first. " })).toEqual({ ok: true, value: "Ask the kitchen first." });
    expect(cleanAdvice({ advice: "" })).toEqual({ ok: false, error: ADVICE_REFUSALS.adviceNeeded });
    expect(cleanDecision({ decision: "The bays move in spring." })).toEqual({ ok: true, value: "The bays move in spring." });
    expect(cleanDecision({})).toEqual({ ok: false, error: ADVICE_REFUSALS.decisionNeeded });
  });
});

describe("the words", () => {
  it("names the doors, the quick choices and the bells", () => {
    expect(adviceGiveUrl(7)).toBe("/api/sessions/advice/requests/7/advice");
    expect([ADVICE_COPY.inDays(3), ADVICE_COPY.inDays(7), ADVICE_COPY.inDays(14)]).toEqual(["In 3 days", "In a week", "In two weeks"]);
    expect(ADVICE_COPY.asked("Garden", 1)).toBe("Asked the Garden circle: 1 person.");
    expect(ADVICE_COPY.fromWho("Ana Reyes", "Kitchen circle")).toBe("Ana Reyes asks the Kitchen circle");
    expect(ADVICE_NOTICES.asked("Ana Reyes", "Garden")).toBe("Ana Reyes asks the Garden circle for advice");
    expect(ADVICE_COPY.adviceCount(1, 2)).toBe("1 of 2 people gave advice");
  });
});
