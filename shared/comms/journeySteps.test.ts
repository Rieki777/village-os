import { describe, expect, it } from "vitest";
import { CONDITION_KEYS, JOURNEY_KINDS, STOP_KEYS } from "./contracts";
import { DEFAULT_JOURNEYS, DEFAULT_JOURNEYS_BY_KEY } from "./defaults/journeys";
import {
  CONDITION_LABELS,
  CONDITIONS_FOR_KIND,
  editStep,
  parseReminderMinutes,
  reminderStepKeys,
  STOP_LABELS,
  timingLabel,
  withReminderDials,
} from "./journeySteps";

/**
 * How a journey's steps read on the Journeys screen, how the reminder dials
 * shape the gathering journeys, and the one check every step edit passes
 * (the comms build spec 5.6 and 5.18).
 */

const GOING = DEFAULT_JOURNEYS_BY_KEY["gathering.going"];
const HOST = DEFAULT_JOURNEYS_BY_KEY["gathering.host"];
const WELCOME = DEFAULT_JOURNEYS_BY_KEY["member.welcome"];
const known = () => true;

describe("the reminder dials", () => {
  it("at their defaults, build exactly the platform's gathering journeys", () => {
    const dials = { reminderMinutes: parseReminderMinutes("1440,120"), hostNudgeMinutes: 60 };
    expect(withReminderDials(GOING, dials)).toEqual(GOING);
    expect(withReminderDials(HOST, dials)).toEqual(HOST);
  });

  it("move the reminders and keep their keys, so a reminder already sent is never sent again", () => {
    const def = withReminderDials(GOING, { reminderMinutes: parseReminderMinutes("60, 2880 ,1440"), hostNudgeMinutes: null });
    expect(def.steps.map((s) => [s.key, s.offsetMinutes, s.templateKey])).toEqual([
      ["confirm", 0, "gathering.confirm"],
      ["day", -2880, "gathering.reminder_day"],
      ["remind_1440", -1440, "gathering.reminder_day"],
      ["soon", -60, "gathering.reminder_soon"],
    ]);
    expect(reminderStepKeys(def)).toEqual(["day", "remind_1440", "soon"]);
  });

  it("send no reminder when the dial is empty, and leave the steps alone when it cannot be read", () => {
    expect(withReminderDials(GOING, { reminderMinutes: parseReminderMinutes(""), hostNudgeMinutes: null }).steps.map((s) => s.key)).toEqual(["confirm"]);
    expect(parseReminderMinutes("1440,abc")).toBeNull();
    expect(parseReminderMinutes("5")).toBeNull();
    expect(parseReminderMinutes("120,120")).toBeNull();
    expect(withReminderDials(GOING, { reminderMinutes: null, hostNudgeMinutes: null })).toEqual(GOING);
  });

  it("move the host's nudge, and touch no other journey", () => {
    expect(withReminderDials(HOST, { reminderMinutes: null, hostNudgeMinutes: 180 }).steps[0].offsetMinutes).toBe(180);
    expect(withReminderDials(WELCOME, { reminderMinutes: [60], hostNudgeMinutes: 5 })).toBe(WELCOME);
  });
});

describe("a step's timing in words", () => {
  it("says when each default step goes", () => {
    expect(GOING.steps.map((s) => timingLabel("event", s))).toEqual(["When they say yes", "1 day before it starts", "2 hours before it starts"]);
    expect(timingLabel("event", HOST.steps[0])).toBe("1 hour after it ends");
    expect(WELCOME.steps.map((s) => timingLabel("member", s))).toEqual(["When they join", "3 days after they join", "7 days after they join", "14 days after they join"]);
    expect(timingLabel("path", { anchor: "enrolled", offsetMinutes: 90 })).toBe("90 minutes after they start the path");
  });
});

describe("editing one step", () => {
  it("saves a valid edit and leaves the other steps as they were", () => {
    const out = editStep(GOING, "day", { offsetMinutes: -2880, window: "daytime", skipIf: ["time_still_being_voted"] }, { templateKnown: known });
    expect("definition" in out).toBe(true);
    if (!("definition" in out)) return;
    expect(out.definition.steps.find((s) => s.key === "day")).toMatchObject({ offsetMinutes: -2880, window: "daytime", skipIf: ["time_still_being_voted"] });
    expect(out.definition.steps.find((s) => s.key === "soon")).toEqual(GOING.steps.find((s) => s.key === "soon"));
  });

  it("refuses what cannot be sent, each with a sentence", () => {
    const problems = (patch: Parameters<typeof editStep>[2], def = GOING, step = "day") => {
      const out = editStep(def, step, patch, { templateKnown: (k) => k !== "gathering.nowhere" });
      return "problems" in out ? out.problems : [];
    };
    expect(problems({ offsetMinutes: 61 * 24 * 60 })[0]).toContain("sixty days");
    expect(problems({ offsetMinutes: 1.5 })).toHaveLength(1);
    expect(problems({ offsetMinutes: -60 }, WELCOME, "day0")[0]).toContain("before the person starts");
    expect(problems({ audience: "came" })[0]).toContain("after a gathering ends");
    expect(problems({ audience: "missed" }, HOST, "nudge")).toEqual([]);
    expect(problems({ templateKey: "gathering.nowhere" })[0]).toContain("Words screen");
    expect(problems({ templateKey: "path.resident.welcome" })[0]).toContain("this kind of email");
    expect(problems({ skipIf: ["member_first_step_done"] })[0]).toContain("skip rules");
    expect(problems({ window: "night" as never })).toHaveLength(1);
    expect(problems({}, GOING, "nope")[0]).toContain("no step");
  });
});

describe("the labels", () => {
  it("name every condition and stop, and offer each journey kind only its own rules", () => {
    for (const k of CONDITION_KEYS) expect(CONDITION_LABELS[k], k).toBeTruthy();
    for (const k of STOP_KEYS) expect(STOP_LABELS[k], k).toBeTruthy();
    for (const kind of JOURNEY_KINDS) for (const k of CONDITIONS_FOR_KIND[kind]) expect(CONDITION_KEYS).toContain(k);
    // Every skip rule a default journey uses is offered for its kind, so an edit can keep it.
    for (const j of DEFAULT_JOURNEYS) for (const s of j.steps) for (const k of s.skipIf) expect(CONDITIONS_FOR_KIND[j.kind], `${j.key}/${s.key}`).toContain(k);
  });
});
