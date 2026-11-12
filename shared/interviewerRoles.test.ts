import { describe, expect, it } from "vitest";
import {
  conversationMinutes,
  conversationModeOf,
  interviewLines,
  interviewTotalWords,
  parseConversationMode,
  parseInterviewSteps,
  readInterviewerRoles,
} from "./interviewerRoles";

/** The Lead Financial Steward's order, as Rye ruled it (9 Nov, corrected): 60, 20, 20, 20, the last the final approval. */
const ORDER = [
  { roleId: "human-operations-onboarding", minutes: 60 },
  { roleId: "technical-operations", minutes: 20 },
  { roleId: "to-be-confirmed", minutes: 20 },
  { roleId: "visionary-channel", minutes: 20, final: true },
];
const NAMES = ["Human Operations & Onboarding Lead Steward", "Technical Operations Steward", "A Role To Confirm", "Visionary Channel"];

describe("the ordered conversations", () => {
  it("keeps the order, each length and the final approval, and totals 120 minutes", () => {
    const r = parseInterviewSteps(ORDER);
    expect(r).toEqual({ ok: true, value: ORDER });
    expect(interviewTotalWords(ORDER)).toBe("120 minutes");
    expect(conversationMinutes(ORDER)).toBe(120);
    const lines = interviewLines(ORDER.map((s, i) => ({ ...s, roleName: NAMES[i] })));
    expect(lines[0]).toBe("1. Human Operations & Onboarding Lead Steward, 60 minutes");
    expect(lines[3]).toBe("4. Visionary Channel, 20 minutes, final approval");
  });
  it("reads a bare list of role ids as twenty minutes each, and a stored string", () => {
    expect(parseInterviewSteps(["a", "b"])).toEqual({ ok: true, value: [{ roleId: "a", minutes: 20 }, { roleId: "b", minutes: 20 }] });
    expect(parseInterviewSteps(JSON.stringify(ORDER))).toEqual({ ok: true, value: ORDER });
  });
  it("refuses two final approvals, a repeated role, a silly length and too many steps", () => {
    expect(parseInterviewSteps([{ roleId: "a", final: true }, { roleId: "b", final: true }]).ok).toBe(false);
    expect(parseInterviewSteps([{ roleId: "a" }, { roleId: "a" }]).ok).toBe(false);
    expect(parseInterviewSteps([{ roleId: "a", minutes: 2 }]).ok).toBe(false);
    expect(parseInterviewSteps([{ roleId: "a", minutes: 600 }]).ok).toBe(false);
    expect(parseInterviewSteps(Array.from({ length: 7 }, (_, i) => ({ roleId: `r${i}` }))).ok).toBe(false);
    // Control: the same shapes inside the limits pass.
    expect(parseInterviewSteps([{ roleId: "a", minutes: 5, final: true }, { roleId: "b", minutes: 240 }]).ok).toBe(true);
  });
  it("reads nothing written as null", () => {
    expect(parseInterviewSteps(null)).toEqual({ ok: true, value: null });
    expect(parseInterviewSteps([])).toEqual({ ok: true, value: null });
  });
});

describe("the tolerant reader", () => {
  it("drops what it cannot read and never throws", () => {
    expect(readInterviewerRoles("not json")).toEqual([]);
    expect(readInterviewerRoles({ roleId: "a" })).toEqual([]);
    expect(readInterviewerRoles(null)).toEqual([]);
    const messy = [
      { roleId: "a", minutes: 60 },
      { roleId: "", minutes: 20 },
      { roleId: "b", minutes: 2 },
      { roleId: "c", minutes: "x" },
      { roleId: "a", minutes: 30 },
      7,
      { roleId: "d", minutes: 20, final: true },
      { roleId: "e", minutes: 20, final: true },
    ];
    expect(readInterviewerRoles(messy)).toEqual([
      { roleId: "a", minutes: 60 },
      { roleId: "d", minutes: 20, final: true },
      { roleId: "e", minutes: 20 },
    ]);
  });
  it("reads a clean stored list exactly as written (control)", () => {
    expect(readInterviewerRoles(JSON.stringify(ORDER))).toEqual(ORDER);
  });
});

describe("the mode", () => {
  it("reads NULL or an unknown value as separately (the one booking story), and refuses an unknown mode on a write", () => {
    expect(conversationModeOf(null)).toBe("separate");
    expect(conversationModeOf("")).toBe("separate");
    expect(conversationModeOf("scatter")).toBe("separate");
    expect(conversationModeOf("block"), "control: a stored block is still read as written").toBe("block");
    expect(conversationModeOf("separate")).toBe("separate");
    expect(parseConversationMode("separate")).toEqual({ ok: true, value: "separate" });
    expect(parseConversationMode(null)).toEqual({ ok: true, value: null });
    expect(parseConversationMode("scatter").ok).toBe(false);
  });
});
