import { describe, expect, it } from "vitest";
import { defaultJourney } from "./defaults/journeys";
import {
  effectiveGuests,
  effectiveReminders,
  extraReminderStep,
  guestSettingFromColumn,
  guestSettingToColumn,
  journeyReminderMinutes,
  parseReminderDial,
  reminderLabel,
  reminderListProblem,
  reminderPlan,
  reminderSettingFromColumn,
  reminderSettingToColumn,
  reminderTemplateFor,
  REMINDER_CHOICES,
  settingsChangeOf,
} from "./gatheringSettings";

/**
 * One gathering's own email settings and the rule that turns its reminder
 * times into what the journey planner reads (the comms build spec 5.7).
 */

const going = defaultJourney("gathering.going")!;

describe("a gathering's reminder times, as the planner reads them", () => {
  it("keeps both of the journey's own steps for the village default, and adds nothing", () => {
    const plan = reminderPlan([1440, 120], going);
    expect(plan.stepOverrides).toEqual({ day: { skip: false }, soon: { skip: false } });
    expect(plan.extraSteps).toEqual([]);
  });

  it("skips both reminder steps when reminders are off, and never the confirmation", () => {
    const plan = reminderPlan([], going);
    expect(plan.stepOverrides).toEqual({ day: { skip: true }, soon: { skip: true } });
    expect(plan.stepOverrides.confirm).toBeUndefined();
    expect(plan.extraSteps).toEqual([]);
  });

  it("keeps a step whose time is still wanted, skips the other, and adds a time no step sits at", () => {
    const plan = reminderPlan([120, 30], going);
    expect(plan.stepOverrides).toEqual({ day: { skip: true }, soon: { skip: false } });
    expect(plan.extraSteps.map((s) => s.key)).toEqual(["remind_30"]);
    expect(plan.extraSteps[0]).toMatchObject({
      anchor: "event_start",
      offsetMinutes: -30,
      templateKey: "gathering.reminder_soon",
      catchUp: "skip",
      skipIf: ["time_still_being_voted"],
    });
    // Never late enough to land after the start.
    expect(plan.extraSteps[0].maxLateMinutes).toBeLessThan(30);
  });

  it("sends a far reminder with the day-before words and the soon ones with the starting-soon words", () => {
    expect(reminderTemplateFor(360)).toBe("gathering.reminder_soon");
    expect(reminderTemplateFor(361)).toBe("gathering.reminder_day");
    const plan = reminderPlan([2880], going);
    expect(plan.extraSteps[0]).toMatchObject({ key: "remind_2880", templateKey: "gathering.reminder_day", offsetMinutes: -2880 });
  });

  it("follows a village that edited its own steps: a time matches whichever step sits at it", () => {
    const edited = { steps: going.steps.map((s) => (s.key === "day" ? { ...s, offsetMinutes: -2880 } : s)) };
    const plan = reminderPlan([2880, 120], edited);
    expect(plan.stepOverrides).toEqual({ day: { skip: false }, soon: { skip: false } });
    expect(plan.extraSteps).toEqual([]);
  });

  it("keeps an admin's edited reminder for a gathering on default, where the dial would have moved it", () => {
    // The dial says 1440,120; the village moved its day-before reminder to two days on the Journeys screen.
    const edited = { steps: going.steps.map((s) => (s.key === "day" ? { ...s, offsetMinutes: -2880 } : s)) };
    expect(journeyReminderMinutes(edited)).toEqual([2880, 120]);
    const plan = reminderPlan(effectiveReminders({ mode: "default" }, journeyReminderMinutes(edited)), edited);
    expect(plan.stepOverrides).toEqual({ day: { skip: false }, soon: { skip: false } });
    expect(plan.extraSteps).toEqual([]);
    // A host's own choice still wins over the journey.
    const off = reminderPlan(effectiveReminders({ mode: "off" }, journeyReminderMinutes(edited)), edited);
    expect(off.stepOverrides).toEqual({ day: { skip: true }, soon: { skip: true } });
  });

  it("offers only times whose words fit them in the picker", () => {
    for (const m of REMINDER_CHOICES) {
      const words = reminderTemplateFor(m);
      expect(m === 1440 ? words === "gathering.reminder_day" : words === "gathering.reminder_soon", String(m)).toBe(true);
    }
  });

  it("gives every extra step a key no default step has", () => {
    const keys = new Set(going.steps.map((s) => s.key));
    for (const m of [10, 45, 600, 20160]) expect(keys.has(extraReminderStep(m).key)).toBe(false);
  });
});

describe("the settings as stored", () => {
  it("reads NULL as the village, an empty list as off, and a list as the gathering's own", () => {
    expect(reminderSettingFromColumn(null)).toEqual({ mode: "default" });
    expect(reminderSettingFromColumn([])).toEqual({ mode: "off" });
    expect(reminderSettingFromColumn("[]")).toEqual({ mode: "off" });
    expect(reminderSettingFromColumn([120, 1440])).toEqual({ mode: "custom", minutes: [1440, 120] });
    expect(reminderSettingFromColumn("[60]")).toEqual({ mode: "custom", minutes: [60] });
    // A list of nothing usable is not a deliberate "off".
    expect(reminderSettingFromColumn(["x", 5])).toEqual({ mode: "default" });
    expect(reminderSettingFromColumn("not json")).toEqual({ mode: "default" });
  });

  it("writes each setting back as it reads", () => {
    for (const s of [{ mode: "default" as const }, { mode: "off" as const }, { mode: "custom" as const, minutes: [1440, 60] }]) {
      expect(reminderSettingFromColumn(reminderSettingToColumn(s))).toEqual(s);
    }
  });

  it("reads the village dial the way the variable stores it", () => {
    expect(parseReminderDial("1440,120")).toEqual([1440, 120]);
    expect(parseReminderDial(" 120 , 1440 ")).toEqual([1440, 120]);
    expect(parseReminderDial("")).toEqual([]);
    expect(parseReminderDial("1440;120")).toEqual([]);
    expect(parseReminderDial("5,60")).toEqual([60]);
  });

  it("decides the effective times and the guests from the village when a gathering follows it", () => {
    expect(effectiveReminders({ mode: "default" }, [1440, 120])).toEqual([1440, 120]);
    expect(effectiveReminders({ mode: "off" }, [1440, 120])).toEqual([]);
    expect(effectiveReminders({ mode: "custom", minutes: [60] }, [1440, 120])).toEqual([60]);
    expect(guestSettingFromColumn(null)).toBe("default");
    expect(guestSettingFromColumn(1)).toBe("on");
    expect(guestSettingFromColumn(0)).toBe("off");
    expect(guestSettingToColumn("default")).toBeNull();
    expect(effectiveGuests("default", true)).toBe(true);
    expect(effectiveGuests("off", true)).toBe(false);
    expect(effectiveGuests("on", false)).toBe(true);
  });

  it("names a time in words", () => {
    expect(reminderLabel(1440)).toBe("1 day before");
    expect(reminderLabel(2880)).toBe("2 days before");
    expect(reminderLabel(120)).toBe("2 hours before");
    expect(reminderLabel(60)).toBe("1 hour before");
    expect(reminderLabel(30)).toBe("30 minutes before");
    expect(reminderLabel(90)).toBe("1 hour and 30 minutes before");
  });
});

describe("a change the settings route takes", () => {
  it("takes each field alone, and refuses what the dial would refuse", () => {
    expect(settingsChangeOf({ reminders: { mode: "off" } })).toEqual({ ok: true, change: { reminders: { mode: "off" } } });
    expect(settingsChangeOf({ reminders: { mode: "custom", minutes: [120, 1440] } })).toEqual({
      ok: true,
      change: { reminders: { mode: "custom", minutes: [1440, 120] } },
    });
    expect(settingsChangeOf({ guests: "on", hostUserId: null })).toEqual({ ok: true, change: { guests: "on", hostUserId: null } });
    expect(settingsChangeOf({ reminders: { mode: "custom", minutes: [5] } }).ok).toBe(false);
    expect(settingsChangeOf({ reminders: { mode: "custom", minutes: [60, 60] } }).ok).toBe(false);
    expect(settingsChangeOf({ reminders: { mode: "custom", minutes: [10, 20, 30, 40, 50] } }).ok).toBe(false);
    expect(settingsChangeOf({ reminders: { mode: "custom", minutes: [] } }).ok).toBe(false);
    expect(settingsChangeOf({ reminders: { mode: "sometimes" } }).ok).toBe(false);
    expect(settingsChangeOf({ guests: "maybe" }).ok).toBe(false);
    expect(settingsChangeOf({ hostUserId: "" }).ok).toBe(false);
    expect(settingsChangeOf({}).ok).toBe(false);
    expect(settingsChangeOf(null).ok).toBe(false);
  });

  it("holds the same bounds as the village dial", () => {
    expect(reminderListProblem([10, 20160])).toBeNull();
    expect(reminderListProblem([9])).not.toBeNull();
    expect(reminderListProblem([20161])).not.toBeNull();
    expect(reminderListProblem([1.5])).not.toBeNull();
    expect(reminderListProblem("1440")).not.toBeNull();
  });
});
