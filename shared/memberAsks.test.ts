import { describe, expect, it } from "vitest";
import {
  MAX_OPEN_BLOCKING,
  cleanDueOn,
  cleanLink,
  rankAsks,
  refuseAskInput,
  refuseBlockingCap,
  refuseHandedBackAgain,
  tierOf,
} from "./memberAsks";

describe("asks: what a link may be", () => {
  it("takes a web address or a path on this site", () => {
    expect(cleanLink("https://docs.example.org/d/1")).toBe("https://docs.example.org/d/1");
    expect(cleanLink("http://example.org")).toBe("http://example.org");
    expect(cleanLink(" /role-applications/7 ")).toBe("/role-applications/7");
  });
  it("refuses anything a click could turn against the member", () => {
    for (const bad of ["javascript:alert(1)", "data:text/html,x", "//evil.example", "/\\evil.example", "", "   ", "not a link", null, undefined]) {
      expect(cleanLink(bad)).toBeNull();
    }
    expect(cleanLink(`https://x.org/${"a".repeat(1000)}`)).toBeNull();
  });
});

describe("asks: the input", () => {
  const ok = { askedUserId: "u2", link: "/quests/3", why: "Review the quest before Friday" };
  it("passes a whole ask", () => {
    expect(refuseAskInput("u1", ok)).toBeNull();
    expect(refuseAskInput("u1", { ...ok, dueOn: "2026-11-07", blocking: true })).toBeNull();
  });
  it("refuses asking yourself", () => {
    expect(refuseAskInput("u1", { ...ok, askedUserId: "u1" })?.status).toBe(400);
  });
  it("refuses a missing person, link or reason, a long reason and a date that is not a day", () => {
    expect(refuseAskInput("u1", { ...ok, askedUserId: "" })?.status).toBe(400);
    expect(refuseAskInput("u1", { ...ok, link: "javascript:x" })?.status).toBe(400);
    expect(refuseAskInput("u1", { ...ok, why: "  " })?.status).toBe(400);
    expect(refuseAskInput("u1", { ...ok, why: "x".repeat(301) })?.status).toBe(400);
    expect(refuseAskInput("u1", { ...ok, dueOn: "next friday" })?.status).toBe(400);
    expect(refuseAskInput("u1", { ...ok, dueOn: "2026-02-30" })?.status).toBe(400);
  });
  it("reads an empty due date as none", () => {
    expect(cleanDueOn("")).toBeNull();
    expect(cleanDueOn(null)).toBeNull();
    expect(cleanDueOn("2026-11-07")).toBe("2026-11-07");
  });
});

describe("asks: the blocking cap", () => {
  it("lets a blocking ask through below the cap, and refuses the next", () => {
    expect(MAX_OPEN_BLOCKING).toBe(3);
    expect(refuseBlockingCap(2, true)).toBeNull();
    expect(refuseBlockingCap(3, true)?.status).toBe(409);
  });
  it("never caps an ask that does not block", () => {
    expect(refuseBlockingCap(3, false)).toBeNull();
    expect(refuseBlockingCap(50, false)).toBeNull();
  });
});

describe("asks: a hand-back does not loop", () => {
  it("refuses sending the same link back to a member who handed it back", () => {
    expect(refuseHandedBackAgain(true)?.status).toBe(409);
    expect(refuseHandedBackAgain(false)).toBeNull();
  });
});

describe("asks: the order Waiting on you draws them in", () => {
  const today = "2026-10-31";
  it("puts blocking first, then due within seven days or overdue, then whenever", () => {
    expect(tierOf({ blocking: true, dueOn: null }, today)).toBe("blocking");
    expect(tierOf({ blocking: false, dueOn: "2026-11-07" }, today)).toBe("this-week");
    expect(tierOf({ blocking: false, dueOn: "2026-10-20" }, today)).toBe("this-week");
    expect(tierOf({ blocking: false, dueOn: "2026-11-08" }, today)).toBe("whenever");
    expect(tierOf({ blocking: false, dueOn: null }, today)).toBe("whenever");
  });
  it("ranks by tier, then the nearest due date, then the oldest ask", () => {
    const row = (id: string, tier: "blocking" | "this-week" | "whenever", dueOn: string | null, askedOn: string) => ({ id, tier, dueOn, askedOn });
    const ranked = rankAsks([
      row("w-new", "whenever", null, "2026-10-30"),
      row("week-late", "this-week", "2026-11-06", "2026-10-01"),
      row("block", "blocking", null, "2026-10-29"),
      row("w-old", "whenever", null, "2026-10-01"),
      row("week-soon", "this-week", "2026-11-01", "2026-10-29"),
    ]);
    expect(ranked.map((r) => r.id)).toEqual(["block", "week-soon", "week-late", "w-old", "w-new"]);
  });
});
