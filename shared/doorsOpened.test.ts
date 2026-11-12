/**
 * Doors, never rungs: the words a crossing and a growing badge are told in.
 * Each assertion names what it guards; the break-the-fix controls for this
 * file put "advanced to", "Stage" or a "×" back and watch these fail.
 */
import { describe, expect, it } from "vitest";
import { badgeNoticeTitle, doorNotice, doorsWalked, youCanNow } from "./doorsOpened";

describe("youCanNow", () => {
  it("turns an imperative label into a door", () => {
    expect(youCanNow("Cast a vote on a ballot")).toBe("You can now cast a vote on a ballot");
  });
  it("keeps an acronym's capitals", () => {
    expect(youCanNow("AI companions, kept")).toBe("You can now AI companions, kept");
  });
  it("says nothing for nothing", () => {
    expect(youCanNow("  ")).toBe("");
  });
});

describe("doorNotice", () => {
  it("names the one door in the title and never the rung", () => {
    const n = doorNotice(["Cast a vote on a ballot"]);
    expect(n.title).toBe("A door opened: you can now cast a vote on a ballot");
    expect(n.body).toBeNull();
    expect(n.title).not.toMatch(/advanced|stage|level/i);
  });
  it("lists every door when a crossing opened several", () => {
    const n = doorNotice(["Cast a vote on a ballot", "Start a thread in the forum"]);
    expect(n.title).toBe("A door opened: you can now cast a vote on a ballot");
    expect(n.body).toBe("You can now cast a vote on a ballot. You can now start a thread in the forum.");
  });
  it("is kind and true when nothing opened", () => {
    expect(doorNotice([])).toEqual({ title: "A new step on your walk", body: null });
  });
});

describe("badgeNoticeTitle", () => {
  it("draws a tier as fuller, never as a number", () => {
    expect(badgeNoticeTitle("Seed keeper", 3)).toBe("Your Seed keeper badge grew fuller");
    expect(badgeNoticeTitle("Seed keeper", 3)).not.toMatch(/[×x]\s*\d|\d/);
    expect(badgeNoticeTitle("Seed keeper", 1)).toBe("Badge earned: Seed keeper");
  });
});

describe("doorsWalked", () => {
  const stages = [{ id: "guest" }, { id: "member" }, { id: "contributor" }];
  const cap = (label: string, held: boolean, stage: string | null) => ({
    label,
    held,
    opens: stage ? ({ via: "stage", stage } as const) : ({ via: "appointment" } as const),
  });
  it("groups held stage doors in ladder order and leaves out the rest", () => {
    const got = doorsWalked(
      [
        cap("Vouch for an applicant", true, "contributor"),
        cap("Cast a vote on a ballot", true, "member"),
        cap("Say you are coming to a gathering", true, "guest"),
        cap("Open a governance decision", false, "contributor"),
        cap("Record a decision's outcome", true, null),
        cap("Start a thread in the forum", true, "member"),
      ],
      stages,
    );
    expect(got).toEqual([
      { stage: "guest", doors: ["Say you are coming to a gathering"] },
      { stage: "member", doors: ["Cast a vote on a ballot", "Start a thread in the forum"] },
      { stage: "contributor", doors: ["Vouch for an applicant"] },
    ]);
  });
  it("keeps a door on a stage the ladder no longer names, last", () => {
    const got = doorsWalked([cap("A", true, "gone"), cap("B", true, "guest")], stages);
    expect(got.map((g) => g.stage)).toEqual(["guest", "gone"]);
  });
});
