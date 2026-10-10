/**
 * Season plans, the parts with no database (shared/seasonPlans.ts).
 *
 * Pinned: the window opens EXACTLY at the term warning's instant for the
 * season's first instant, on both clocks; it closes a whole cycle after the
 * start; a hand-set window wins and its last day is inside it; the season a
 * member plans is the latest whose window has opened and which has not ended,
 * and there is none before any window opens; reminders send only the latest
 * mark; and a plan refuses payment details, words that rank people, quest
 * counts out of bounds, a goal the season does not have, and terms.
 */
import { describe, expect, it } from "vitest";
import { CALENDAR_CLOCK, LUNAR_CLOCK, termWarningOpensAt } from "./cycleClock";
import {
  applyHref,
  dueReminderMark,
  fileRefusal,
  parsePlanInput,
  planOpenCopy,
  planReminderCopy,
  planTargetAt,
  planWindowFor,
  planWindowPayload,
  wholeCycleAfter,
  windowState,
  type PlanSeason,
} from "./seasonPlans";

const at = (iso: string) => new Date(iso);
const DAY = 86_400_000;

describe("the window", () => {
  it("opens exactly at termWarningOpensAt of the season's first instant, on the calendar clock", () => {
    const season: PlanSeason = { id: "s-2", startsOn: "2027-03-01", endsOn: "2027-06-01" };
    const w = planWindowFor(season, null, CALENDAR_CLOCK, "UTC")!;
    expect(w.opensAt.getTime()).toBe(termWarningOpensAt(at("2027-03-01T00:00:00Z"), CALENDAR_CLOCK).getTime());
    expect(w.opensOn).toBe("2027-02-01");
    // On a boundary, a whole cycle after the start is the next boundary, and its last day is the day before.
    expect(w.closesAt.toISOString()).toBe("2027-04-01T00:00:00.000Z");
    expect(w.closesOn).toBe("2027-03-31");
    expect(w.setByHand).toBe(false);
  });

  it("opens exactly at termWarningOpensAt on the lunar clock, and closes on a new moon at least a lunation after the start", () => {
    const season: PlanSeason = { id: "s-l", startsOn: "2027-03-21", endsOn: "2027-06-21" };
    const start = at("2027-03-21T00:00:00Z");
    const w = planWindowFor(season, null, LUNAR_CLOCK, "UTC")!;
    expect(w.opensAt.getTime()).toBe(termWarningOpensAt(start, LUNAR_CLOCK).getTime());
    expect(w.opensAt.getTime()).toBeLessThan(start.getTime());
    expect(w.closesAt.getTime() - start.getTime()).toBeGreaterThanOrEqual(29 * DAY);
    expect(LUNAR_CLOCK.startOf(LUNAR_CLOCK.cycleNumberAt(w.closesAt)).getTime()).toBe(w.closesAt.getTime());
  });

  it("a start part way into a cycle closes at the boundary after next, so a whole cycle always fits", () => {
    expect(wholeCycleAfter(at("2027-03-21T00:00:00Z"), CALENDAR_CLOCK).toISOString()).toBe("2027-05-01T00:00:00.000Z");
    expect(wholeCycleAfter(at("2027-03-01T00:00:00Z"), CALENDAR_CLOCK).toISOString()).toBe("2027-04-01T00:00:00.000Z");
  });

  it("never opens before the previous season began", () => {
    const prev: PlanSeason = { id: "s-1", startsOn: "2027-02-15", endsOn: "2027-03-01" };
    const w = planWindowFor({ id: "s-2", startsOn: "2027-03-01" }, prev, CALENDAR_CLOCK, "UTC")!;
    expect(w.opensOn).toBe("2027-02-15");
  });

  it("a window set by hand wins, both days inside it, in the village's zone", () => {
    const foundations: PlanSeason = {
      id: "s-found",
      name: "First Season",
      startsOn: "2026-06-21",
      endsOn: "2027-03-21",
      planWindow: { opensOn: "2026-10-10", closesOn: "2026-11-09" },
    };
    const w = planWindowFor(foundations, null, LUNAR_CLOCK, "America/Regina")!;
    expect(w.setByHand).toBe(true);
    expect(w.opensAt.toISOString()).toBe("2026-10-10T06:00:00.000Z");
    expect(w.closesAt.toISOString()).toBe("2026-11-10T06:00:00.000Z");
    expect(windowState(w, at("2026-11-09T23:00:00Z"))).toBe("open");
    expect(windowState(w, at("2026-11-10T07:00:00Z"))).toBe("closed");
    // A hand-set pair that does not read falls back to the worked-out window.
    const broken = planWindowFor({ ...foundations, planWindow: { opensOn: "soon", closesOn: "2026-11-09" } }, null, LUNAR_CLOCK, "UTC")!;
    expect(broken.setByHand).toBe(false);
  });
});

describe("the season a member plans", () => {
  const seasons: PlanSeason[] = [
    { id: "s-1", name: "First", startsOn: "2027-01-01", endsOn: "2027-03-01" },
    { id: "s-2", name: "Second", startsOn: "2027-03-01", endsOn: "2027-06-01" },
  ];

  it("is none before any window opens, so filing has nothing to file against", () => {
    expect(planTargetAt(seasons, CALENDAR_CLOCK, "UTC", at("2026-11-15T00:00:00Z"))).toBeNull();
    expect(planTargetAt([], CALENDAR_CLOCK, "UTC", at("2027-01-15T00:00:00Z"))).toBeNull();
  });

  it("moves to the next season the moment its window opens, and stays there late", () => {
    expect(planTargetAt(seasons, CALENDAR_CLOCK, "UTC", at("2027-01-20T00:00:00Z"))?.season.id).toBe("s-1");
    expect(planTargetAt(seasons, CALENDAR_CLOCK, "UTC", at("2027-02-01T00:00:00Z"))?.season.id).toBe("s-2");
    // Long after the window closed: a late plan is still for the season the member is in.
    expect(planTargetAt(seasons, CALENDAR_CLOCK, "UTC", at("2027-05-20T00:00:00Z"))?.season.id).toBe("s-2");
    // Once every season has ended there is nothing to plan.
    expect(planTargetAt(seasons, CALENDAR_CLOCK, "UTC", at("2027-06-02T00:00:00Z"))).toBeNull();
  });

  it("the first run: a hand-set window on the running season opens it on its first day and not before", () => {
    const firstRun: PlanSeason[] = [{ id: "s-found", name: "First Season", startsOn: "2026-06-21", endsOn: "2027-03-21", planWindow: { opensOn: "2026-10-10", closesOn: "2026-11-09" } }];
    expect(planTargetAt(firstRun, LUNAR_CLOCK, "America/Regina", at("2026-10-09T12:00:00Z"))).toBeNull();
    const t = planTargetAt(firstRun, LUNAR_CLOCK, "America/Regina", at("2026-10-12T12:00:00Z"))!;
    expect(planWindowPayload(t, at("2026-10-12T12:00:00Z"))).toEqual({
      seasonId: "s-found",
      seasonName: "First Season",
      opensOn: "2026-10-10",
      closesOn: "2026-11-09",
      state: "open",
    });
  });
});

describe("reminders", () => {
  const w = planWindowFor({ id: "s-2", startsOn: "2027-03-01" }, null, CALENDAR_CLOCK, "UTC")!; // 2027-02-01 to 2027-04-01

  it("sends nothing before halfway, then halfway, then three days before the close, then nothing", () => {
    expect(dueReminderMark(w, at("2027-01-31T00:00:00Z"))).toBeNull();
    expect(dueReminderMark(w, at("2027-02-20T00:00:00Z"))).toBeNull();
    expect(dueReminderMark(w, at("2027-03-03T00:00:00Z"))).toBe("halfway");
    expect(dueReminderMark(w, at("2027-03-29T00:00:00Z"))).toBe("three-days");
    expect(dueReminderMark(w, at("2027-04-01T00:00:00Z"))).toBeNull();
  });

  it("catch-up sends only the latest mark: a sweep that missed halfway and lands in the last three days says three days", () => {
    expect(dueReminderMark(w, at("2027-03-30T12:00:00Z"))).toBe("three-days");
  });

  it("says the words the design names", () => {
    expect(planOpenCopy("Second Season", "2027-03-31")).toEqual({
      title: "Plan your season: Second Season",
      body: "Choose your seats and what you will do. Open until 31 March 2027.",
    });
    expect(planReminderCopy(4)).toEqual({ title: "Your season is not filed yet", body: "4 days left." });
    expect(planReminderCopy(1).body).toBe("1 day left.");
  });
});

describe("a plan", () => {
  const goals = ["Plant the north orchard", "Open the guest kitchen"];
  const ok = {
    aim: "The north orchard is planted and two more people can prune it.",
    servesGoal: "Plant the north orchard",
    commitments: { quests: { perMoonMin: 2, perMoonMax: 4 }, scoreboard: { measures: [{ measure: "Trees planted", target: "40 by the turn" }] } },
    handingBack: ["seat-a", "seat-a", ""],
  };

  it("reads a whole plan, keeping the quest and scoreboard groups and nothing else", () => {
    const p = parsePlanInput(ok, { goals });
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.plan.commitments.quests).toEqual({ perMoonMin: 2, perMoonMax: 4, doneWhenRequired: true });
    expect(p.plan.commitments.scoreboard?.measures).toEqual([{ measure: "Trees planted", target: "40 by the turn" }]);
    expect(p.plan.handingBack).toEqual(["seat-a"]);
    expect(fileRefusal(p.plan)).toBeNull();
    expect(fileRefusal({ aim: null })).toMatch(/Write your aim/);
  });

  it("refuses a run of digits and an IBAN in the aim", () => {
    const digits = parsePlanInput({ ...ok, aim: "Pay me at 1234 5678 9012 please." }, { goals });
    expect(digits).toMatchObject({ ok: false, field: "aim" });
    const iban = parsePlanInput({ ...ok, aim: "Send it to GB29NWBK60161331926819 each moon." }, { goals });
    expect(iban).toMatchObject({ ok: false, field: "aim" });
    expect(parsePlanInput({ ...ok, aim: "x".repeat(601) }, { goals })).toMatchObject({ ok: false, field: "aim" });
  });

  it("refuses a measure that ranks people", () => {
    const r = parsePlanInput({ ...ok, commitments: { scoreboard: { measures: [{ measure: "Top 3 on the leaderboard" }] } } }, { goals });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/never ranks people/);
  });

  it("refuses quest counts out of bounds, and the most below the fewest", () => {
    for (const quests of [{ perMoonMin: 0 }, { perMoonMax: 13 }, { perMoonMin: 5, perMoonMax: 2 }, { perMoonMin: 1.5 }]) {
      expect(parsePlanInput({ ...ok, commitments: { quests } }, { goals }).ok, JSON.stringify(quests)).toBe(false);
    }
  });

  it("refuses a goal the season does not have, and a fourth measure", () => {
    expect(parsePlanInput({ ...ok, servesGoal: "Win the league" }, { goals })).toMatchObject({ ok: false, field: "servesGoal" });
    const four = Array.from({ length: 4 }, (_, i) => ({ measure: `Measure ${i}` }));
    expect(parsePlanInput({ ...ok, commitments: { scoreboard: { measures: four } } }, { goals })).toMatchObject({ ok: false });
  });

  it("refuses terms: money belongs on a seat application", () => {
    const r = parsePlanInput({ ...ok, commitments: { ...ok.commitments, pay: { kind: "fixed", currency: "XTS", amountMinor: 100 } } }, { goals });
    expect(r).toMatchObject({ ok: false, field: "commitments.pay" });
  });
});

describe("the door it opens", () => {
  it("opens the member door on a held seat for this season, or with no seat picked", () => {
    expect(applyHref({ seasonId: "s-2", renew: "seat-host" })).toBe("/propose?type=role_application&seat=seat-host&renew=seat-host&season=s-2");
    expect(applyHref({ seasonId: "s-2" })).toBe("/propose?type=role_application&season=s-2");
  });
});
