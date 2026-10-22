import { describe, expect, it } from "vitest";
import {
  mayReadTensionWords,
  parseRespond,
  parseTensionText,
  readHeldTensions,
  respondRefusal,
  statusAfter,
  TENSION_COPY,
  TENSION_REFUSALS,
} from "./roleTensions";
import { readWaiting } from "./waitingOnYou";

const HELD = { id: "rt-0123456789abcdef", roleId: "seat-water", role: "Water keeper", circle: "Garden circle", text: "Sundays", status: "open", raisedOn: "2026-10-16", overdue: true };

describe("who reads a tension's words", () => {
  const open = { status: "open" as const, raisedBy: "u-ana" };
  it("the raiser and the holders, while it is open or answered", () => {
    expect(mayReadTensionWords(open, { userId: "u-ana", member: true, holdsRole: false })).toBe(true);
    expect(mayReadTensionWords(open, { userId: "u-cai", member: true, holdsRole: true })).toBe(true);
    expect(mayReadTensionWords(open, { userId: "u-dee", member: true, holdsRole: false })).toBe(false);
    expect(mayReadTensionWords({ ...open, status: "answered" }, { userId: "u-dee", member: true, holdsRole: false })).toBe(false);
  });
  it("every member once brought to the circle, and never a guest or a visitor", () => {
    const brought = { status: "brought_to_circle" as const, raisedBy: null };
    expect(mayReadTensionWords(brought, { userId: "u-dee", member: true, holdsRole: false })).toBe(true);
    expect(mayReadTensionWords(brought, { userId: "u-gus", member: false, holdsRole: false })).toBe(false);
    expect(mayReadTensionWords(brought, { userId: null, member: false, holdsRole: false })).toBe(false);
  });
  it("a raiser erased to null is nobody's match", () => {
    expect(mayReadTensionWords({ status: "open", raisedBy: null }, { userId: "u-dee", member: true, holdsRole: false })).toBe(false);
  });
});

describe("the moves a holder may make", () => {
  it("take once, answer once, bring an answered one once", () => {
    expect(respondRefusal("open", "take")).toBeNull();
    expect(respondRefusal("taken", "take")).toBe("alreadyTaken");
    expect(respondRefusal("taken", "answer")).toBeNull();
    expect(respondRefusal("answered", "answer")).toBe("alreadyAnswered");
    expect(respondRefusal("answered", "bring_to_circle")).toBeNull();
    expect(respondRefusal("brought_to_circle", "bring_to_circle")).toBe("alreadyAnswered");
    expect(statusAfter("take")).toBe("taken");
    expect(statusAfter("bring_to_circle")).toBe("brought_to_circle");
  });
  it("reads a body, and refuses a long or payment-shaped note", () => {
    expect(parseRespond({ action: "answer", note: "  fine  " })).toEqual({ ok: true, action: "answer", note: "fine" });
    expect(parseRespond({ action: "nope" })).toEqual({ ok: false, refusal: "badAction" });
    expect(parseRespond({ action: "answer", note: "a".repeat(301) })).toEqual({ ok: false, refusal: "noteLong" });
    expect(parseRespond({ action: "answer", note: "card 4111 1111 1111 1111" })).toEqual({ ok: false, refusal: "paymentDetails" });
  });
  it("takes 1 to 600 characters, never cutting", () => {
    expect(parseTensionText("x".repeat(600))).toMatchObject({ ok: true });
    expect(parseTensionText("x".repeat(601))).toEqual({ ok: false, refusal: "textLong" });
    expect(parseTensionText(" \n ")).toEqual({ ok: false, refusal: "textEmpty" });
    expect(parseTensionText(42)).toEqual({ ok: false, refusal: "textEmpty" });
  });
});

describe("Waiting on you carries the tensions, and tolerates a server without them", () => {
  it("reads the group as none when the server is from before it", () => {
    const old = readWaiting({ applications: [], drafts: [], toAccept: [] });
    expect(old?.raisedWithYou).toEqual([]);
    const older = readWaiting({ applications: [], drafts: [] });
    expect(older?.raisedWithYou).toEqual([]);
  });
  it("keeps good rows, drops broken ones, and never invents a raiser", () => {
    const got = readWaiting({ applications: [], drafts: [], raisedWithYou: [HELD, { ...HELD, id: 7 }, { ...HELD, status: "answered" }, null, { ...HELD, raisedBy: "u-ana", circle: " " }] });
    expect(got?.raisedWithYou).toEqual([HELD, { ...HELD, circle: null }]);
    expect(JSON.stringify(got)).not.toContain("u-ana");
    expect(readHeldTensions("nope")).toEqual([]);
  });
});

describe("the words", () => {
  it("say what the rulings say, with no dashes and no seat as a noun", () => {
    expect(TENSION_COPY.privacy).toBe("Only the role's holders and you can read this until it's answered.");
    expect(TENSION_COPY.overdue).toBe("Waiting 2 business days");
    expect(TENSION_COPY.groupHeading).toBe("Raised with your roles");
    const all = JSON.stringify({ TENSION_COPY, TENSION_REFUSALS }) + TENSION_COPY.noticeTitle("X") + TENSION_COPY.reminderTitle("X");
    expect(all).not.toMatch(/[–—]/);
    expect(all).not.toMatch(/\bseats?\b/i);
  });
});
