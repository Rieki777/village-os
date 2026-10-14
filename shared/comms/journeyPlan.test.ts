import { describe, expect, it } from "vitest";
import type { JourneyDefinition, JourneyStep } from "./contracts";
import { DEFAULT_JOURNEYS_BY_KEY } from "./defaults/journeys";
import { ASSUMED_DURATION_MINUTES, planJourney, signedUpLate, walkJourney, WAIT_RECHECK_MINUTES, type PlanInput } from "./journeyPlan";
import { knownZone, nextInWindow, windowZone } from "./quietHours";

/**
 * The journey planner and the send window (the comms build spec 5.6): every
 * case the journeys lane names, and the rules each one rests on.
 */

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const GOING = DEFAULT_JOURNEYS_BY_KEY["gathering.going"];
const HOST = DEFAULT_JOURNEYS_BY_KEY["gathering.host"];
const WELCOME = DEFAULT_JOURNEYS_BY_KEY["member.welcome"];

/** A gathering on a fixed Saturday evening, UTC. */
const START = new Date("2026-10-17T18:00:00Z");
const at = (ms: number) => new Date(START.getTime() + ms);

const input = (over: Partial<PlanInput> & { definition?: JourneyDefinition }): PlanInput => ({
  definition: GOING,
  enrolledAt: at(-4 * DAY),
  now: at(-4 * DAY),
  facts: { eventStart: START, eventEnd: at(2 * HOUR), conditions: { time_still_being_voted: false, signed_up_within_36_hours: false } },
  posted: [],
  readerZone: null,
  villageZone: "UTC",
  quietStartHour: 8,
  quietEndHour: 20,
  ...over,
});

const statusOf = (p: ReturnType<typeof planJourney>) => Object.fromEntries(p.steps.map((s) => [s.key, s.reason ? `${s.status}:${s.reason}` : s.status]));

function step(key: string, over: Partial<JourneyStep> = {}): JourneyStep {
  return { key, anchor: "enrolled", offsetMinutes: 0, window: "any", audience: "all", templateKey: `member.welcome.${key}`, skipIf: [], catchUp: "latest", maxLateMinutes: 3 * 24 * 60, ...over };
}

describe("the planner: the cases the journeys lane names", () => {
  it("a late sign-up three hours before start gets only the starting-soon reminder", () => {
    const enrolled = at(-3 * HOUR);
    const plan = planJourney(
      input({
        enrolledAt: enrolled,
        now: enrolled,
        facts: { eventStart: START, conditions: { time_still_being_voted: false, signed_up_within_36_hours: signedUpLate(enrolled, START) } },
      }),
    );
    expect(statusOf(plan)).toEqual({ day: "skipped:before_enrollment", confirm: "due", soon: "waiting:not_yet" });
    expect(plan.nextCheckAt).toEqual(at(-2 * HOUR));
    const walk = walkJourney(input({ enrolledAt: enrolled, now: enrolled, facts: { eventStart: START, conditions: { time_still_being_voted: false, signed_up_within_36_hours: true } } }));
    const reminders = walk.entries.filter((e) => e.key !== "confirm" && e.outcome === "sent").map((e) => e.key);
    expect(reminders).toEqual(["soon"]);
  });

  it("'latest' sends only the newest of three overdue steps", () => {
    const def: JourneyDefinition = { ...WELCOME, steps: [step("a", { offsetMinutes: 0 }), step("b", { offsetMinutes: 24 * 60 }), step("c", { offsetMinutes: 2 * 24 * 60 })] };
    const enrolled = new Date("2026-10-01T12:00:00Z");
    const plan = planJourney(input({ definition: def, enrolledAt: enrolled, now: new Date(enrolled.getTime() + 2.5 * DAY), facts: {} }));
    expect(statusOf(plan)).toEqual({ a: "skipped:superseded", b: "skipped:superseded", c: "due" });
    expect(plan.due.map((s) => s.key)).toEqual(["c"]);
    // Once the newest went, the older two stay given way, so a second tick sends nothing.
    const again = planJourney(input({ definition: def, enrolledAt: enrolled, now: new Date(enrolled.getTime() + 2.6 * DAY), facts: {}, posted: ["c"] }));
    expect(again.due).toEqual([]);
    expect(again.finished).toBe(true);
  });

  it("a moved start re-plans: the reminders follow the new time, and one skipped as already past comes back", () => {
    const first = planJourney(input({}));
    expect(first.steps.find((s) => s.key === "day")?.at).toEqual(at(-DAY));
    const later = new Date(START.getTime() + 7 * DAY);
    const moved = planJourney(input({ facts: { eventStart: later, conditions: { time_still_being_voted: false, signed_up_within_36_hours: false } } }));
    expect(moved.steps.find((s) => s.key === "day")?.at).toEqual(new Date(later.getTime() - DAY));
    expect(moved.steps.find((s) => s.key === "soon")?.at).toEqual(new Date(later.getTime() - 2 * HOUR));

    // Somebody who said yes an hour before: no day-before reminder...
    const enrolled = at(-HOUR);
    const late = planJourney(input({ enrolledAt: enrolled, now: enrolled }));
    expect(statusOf(late).day).toBe("skipped:before_enrollment");
    // ...until the gathering moves a week later, when it is ahead of them again.
    const movedLate = planJourney(input({ enrolledAt: enrolled, now: enrolled, facts: { eventStart: later, conditions: { time_still_being_voted: false, signed_up_within_36_hours: false } } }));
    expect(statusOf(movedLate).day).toBe("waiting:not_yet");
  });

  it("a daytime step at 06:00 village time waits until the quiet start", () => {
    // 06:00 in Costa Rica (UTC-6) is 12:00 UTC.
    const enrolled = new Date("2026-10-05T12:00:00Z");
    const plan = planJourney(input({ definition: WELCOME, enrolledAt: enrolled, now: enrolled, villageZone: "America/Costa_Rica", facts: { conditions: { member_first_step_done: false, going_to_next_gathering: false } } }));
    const day0 = plan.steps.find((s) => s.key === "day0")!;
    expect(day0.status).toBe("waiting");
    expect(day0.reason).toBe("daytime");
    expect(day0.sendAfter).toEqual(new Date("2026-10-05T14:00:00Z"));
    expect(plan.nextCheckAt).toEqual(new Date("2026-10-05T14:00:00Z"));
    expect(plan.zone).toBe("America/Costa_Rica");
  });

  it("a step for a person whose zone is known uses that zone", () => {
    // 06:00 UTC: early morning in the village, mid-afternoon in Tokyo.
    const enrolled = new Date("2026-10-05T06:00:00Z");
    const facts = { conditions: { member_first_step_done: false, going_to_next_gathering: false } };
    const theirs = planJourney(input({ definition: WELCOME, enrolledAt: enrolled, now: enrolled, villageZone: "UTC", readerZone: "Asia/Tokyo", facts }));
    expect(theirs.zone).toBe("Asia/Tokyo");
    expect(theirs.due.map((s) => s.key)).toEqual(["day0"]);
    const unknown = planJourney(input({ definition: WELCOME, enrolledAt: enrolled, now: enrolled, villageZone: "UTC", readerZone: null, facts }));
    expect(unknown.zone).toBe("UTC");
    expect(unknown.steps.find((s) => s.key === "day0")?.sendAfter).toEqual(new Date("2026-10-05T08:00:00Z"));
    // A zone the runtime cannot read is treated as unknown.
    const typo = planJourney(input({ definition: WELCOME, enrolledAt: enrolled, now: enrolled, villageZone: "UTC", readerZone: "Mars/Olympus", facts }));
    expect(typo.zone).toBe("UTC");
  });
});

describe("the planner: holds, skips and the facts providers' levers", () => {
  it("waits while the time is still being voted, goes once the vote locks, and is too late past its lateness", () => {
    const voting = planJourney(input({ facts: { eventStart: START, conditions: { time_still_being_voted: true, signed_up_within_36_hours: false } } }));
    expect(statusOf(voting).confirm).toBe("waiting:condition");
    expect(voting.nextCheckAt).toEqual(new Date(at(-4 * DAY).getTime() + WAIT_RECHECK_MINUTES * MIN));
    expect(voting.finished).toBe(false);
    const locked = planJourney(input({ now: at(-3.5 * DAY) }));
    expect(statusOf(locked).confirm).toBe("due");
    const tooLate = planJourney(input({ now: at(-2.5 * DAY) }));
    expect(statusOf(tooLate).confirm).toBe("skipped:too_late");
  });

  it("holds a step whose rule could not be answered, and skips one whose rule holds", () => {
    const unanswered = planJourney(input({ facts: { eventStart: START, conditions: {} } }));
    expect(statusOf(unanswered).confirm).toBe("waiting:unanswered");
    expect(unanswered.steps.find((s) => s.key === "confirm")?.condition).toBe("time_still_being_voted");
    const day = planJourney(input({ now: at(-DAY + 10 * MIN), posted: ["confirm"], facts: { eventStart: START, conditions: { time_still_being_voted: false, signed_up_within_36_hours: true } } }));
    expect(statusOf(day).day).toBe("skipped:condition");
    expect(day.steps.find((s) => s.key === "day")?.condition).toBe("signed_up_within_36_hours");
  });

  it("takes a provider's step overrides and extra steps", () => {
    const plan = planJourney(
      input({
        now: at(-4 * DAY),
        facts: {
          eventStart: START,
          conditions: { time_still_being_voted: false, signed_up_within_36_hours: false },
          stepOverrides: { day: { skip: true }, soon: { offsetMinutes: -30 } },
          extraSteps: [
            { ...GOING.steps[2], key: "week", offsetMinutes: -7 * 24 * 60 },
            { ...GOING.steps[2], key: "day", offsetMinutes: -5 },
          ],
        },
      }),
    );
    const s = statusOf(plan);
    expect(s.day).toBe("skipped:turned_off");
    expect(plan.steps.find((p) => p.key === "soon")?.at).toEqual(at(-30 * MIN));
    expect(s.week).toBe("skipped:before_enrollment");
    expect(plan.steps.find((p) => p.key === "week")?.extra).toBe(true);
    // An extra step cannot replace a defined one.
    expect(plan.steps.filter((p) => p.key === "day")).toHaveLength(1);
  });

  it("sends a came or missed step by attendance, counting nobody's marks as came", () => {
    const def: JourneyDefinition = {
      ...HOST,
      steps: [
        { ...HOST.steps[0], key: "came", audience: "came", skipIf: [] },
        { ...HOST.steps[0], key: "missed", audience: "missed", skipIf: [] },
      ],
    };
    const after = at(3 * HOUR + 10 * MIN);
    const unmarked = planJourney(input({ definition: def, now: after, facts: { eventStart: START, eventEnd: at(2 * HOUR) } }));
    expect(statusOf(unmarked)).toEqual({ came: "due", missed: "skipped:audience" });
    const missed = planJourney(input({ definition: def, now: after, facts: { eventStart: START, eventEnd: at(2 * HOUR), attendance: "missed" } }));
    expect(statusOf(missed)).toEqual({ came: "skipped:audience", missed: "due" });
  });

  it("takes an unknown end as the start plus the assumed length, and skips a step with no time at all", () => {
    const def: JourneyDefinition = { ...HOST, steps: [{ ...HOST.steps[0], skipIf: [] }] };
    const plan = planJourney(input({ definition: def, facts: { eventStart: START, eventEnd: null } }));
    expect(plan.steps[0].at).toEqual(new Date(START.getTime() + (ASSUMED_DURATION_MINUTES + 60) * MIN));
    const none = planJourney(input({ definition: def, facts: {} }));
    expect(statusOf(none).nudge).toBe("skipped:no_time");
    expect(none.finished).toBe(true);
  });

  it("holds every due step while the person has paused, and looks again when the pause ends", () => {
    const until = at(-3 * DAY);
    const plan = planJourney(input({ facts: { eventStart: START, conditions: { time_still_being_voted: false, signed_up_within_36_hours: false }, pausedUntil: until } }));
    expect(statusOf(plan).confirm).toBe("waiting:paused");
    expect(plan.nextCheckAt).toEqual(until);
  });

  it("never plans a posted step again, and is finished once nothing waits", () => {
    const plan = planJourney(input({ now: at(-90 * MIN), posted: ["confirm", "day", "soon"] }));
    expect(plan.due).toEqual([]);
    expect(plan.finished).toBe(true);
    expect(plan.nextCheckAt).toBeNull();
  });
});

describe("walking somebody through a journey", () => {
  it("sends each step at its own moment, the way the tick would", () => {
    const walk = walkJourney(input({}));
    expect(walk.entries.map((e) => [e.key, e.outcome, e.sendsAt?.toISOString()])).toEqual([
      ["confirm", "sent", at(-4 * DAY).toISOString()],
      ["day", "sent", at(-DAY).toISOString()],
      ["soon", "sent", at(-2 * HOUR).toISOString()],
    ]);
  });

  it("marks steps already sent, and says why one is skipped", () => {
    const enrolled = at(-3 * HOUR);
    const walk = walkJourney(input({ enrolledAt: enrolled, now: at(-150 * MIN), posted: ["confirm"], facts: { eventStart: START, conditions: { time_still_being_voted: false, signed_up_within_36_hours: true } } }));
    const byKey = Object.fromEntries(walk.entries.map((e) => [e.key, e]));
    expect(byKey.confirm).toMatchObject({ outcome: "sent", alreadySent: true });
    expect(byKey.day).toMatchObject({ outcome: "skipped", reason: "before_enrollment" });
    expect(byKey.soon).toMatchObject({ outcome: "sent", sendsAt: at(-2 * HOUR) });
  });

  it("leaves a step pending when it waits on something the walk cannot see change", () => {
    const walk = walkJourney(input({ facts: { eventStart: START, conditions: {} } }));
    // Unanswered holds until each step is too late; the walk reports what that means.
    expect(walk.entries.every((e) => e.outcome !== "sent")).toBe(true);
    expect(walk.entries.map((e) => e.reason)).toContain("too_late");
  });
});

describe("the send window", () => {
  it("leaves a moment inside the window alone and moves one outside it to the next start", () => {
    expect(nextInWindow(new Date("2026-10-05T09:30:00Z"), "UTC", 8, 20)).toEqual(new Date("2026-10-05T09:30:00Z"));
    expect(nextInWindow(new Date("2026-10-05T06:15:00Z"), "UTC", 8, 20)).toEqual(new Date("2026-10-05T08:00:00Z"));
    expect(nextInWindow(new Date("2026-10-05T20:00:00Z"), "UTC", 8, 20)).toEqual(new Date("2026-10-06T08:00:00Z"));
    expect(nextInWindow(new Date("2026-10-05T23:59:00Z"), "UTC", 8, 20)).toEqual(new Date("2026-10-06T08:00:00Z"));
  });

  it("walks to the next civil day across a daylight change", () => {
    // New York leaves daylight time on 2026-11-01; 21:00 local on Oct 31 is 01:00 UTC on Nov 1.
    expect(nextInWindow(new Date("2026-11-01T01:00:00Z"), "America/New_York", 8, 20)).toEqual(new Date("2026-11-01T13:00:00Z"));
  });

  it("holds nothing when the window is not one", () => {
    const t = new Date("2026-10-05T03:00:00Z");
    expect(nextInWindow(t, "UTC", 20, 8)).toEqual(t);
    expect(nextInWindow(t, "UTC", 9, 9)).toEqual(t);
  });

  it("reads a zone only when the runtime knows it", () => {
    expect(knownZone("Europe/Lisbon")).toBe("Europe/Lisbon");
    expect(knownZone("Nowhere/Atlantis")).toBeNull();
    expect(knownZone("")).toBeNull();
    expect(windowZone(null, "Europe/Lisbon")).toBe("Europe/Lisbon");
    expect(windowZone("Bad/Zone", "Also/Bad")).toBe("UTC");
  });
});
