/**
 * A JOURNEY'S STEPS AS PEOPLE READ AND EDIT THEM (the comms build spec 5.6):
 * the words for when a step goes and why one is skipped, which skip rules fit
 * which journey, how the reminder dials shape the gathering journeys, and the
 * one check an edited step must pass before it is saved.
 *
 * Pure and isomorphic. The Journeys screen and its routes read the same
 * labels and the same rules, so the screen never offers an edit the server
 * would refuse.
 *
 * ── THE REMINDER DIALS ──────────────────────────────────────────────────────
 *
 * `comms.event_reminder_minutes` ("1440,120") and `comms.host_nudge_minutes`
 * (60) are the village's own reminder times. While a village runs the
 * platform's gathering journeys unedited, those journeys are built from the
 * dials (`withReminderDials`), so a founder who changes the dial changes the
 * reminders. At the dials' defaults the result is exactly the platform's
 * definition. Once a village edits a gathering journey on the Journeys screen,
 * its own steps hold and the dial no longer reaches them; the screen says so.
 *
 * Reminder keys stay stable across a dial change: the first reminder of 12
 * hours or more is `day`, the first under 12 hours is `soon`, and any others
 * are `remind_<minutes>`. A reminder already sent under `day` is never sent
 * again because the dial moved it.
 */
import type { ConditionKey, JourneyDefinition, JourneyKind, JourneyStep, StopKey } from "./contracts";
import type { StepSkipReason, StepWaitReason } from "./journeyPlan";
import { kindForTemplate } from "./mergeFields";

// ── Which skip rules fit which journey ──────────────────────────────────────

export const CONDITIONS_FOR_KIND: Record<JourneyKind, readonly ConditionKey[]> = {
  event: ["time_still_being_voted", "signed_up_within_36_hours", "recap_already_sent", "nobody_answered"],
  path: [
    "resident_first_step_done",
    "investor_first_step_done",
    "steward_first_step_done",
    "prosperity_first_step_done",
    "going_to_next_gathering",
    "investor_words_unreviewed",
  ],
  member: ["member_first_step_done", "going_to_next_gathering"],
  joining: ["going_to_next_gathering"],
  poll: ["time_still_being_voted"],
};

export const CONDITION_LABELS: Record<ConditionKey, string> = {
  time_still_being_voted: "The time is still being voted on (the email waits)",
  signed_up_within_36_hours: "They said yes less than 36 hours before",
  recap_already_sent: "The recap has already gone out",
  nobody_answered: "Nobody said yes",
  resident_first_step_done: "They already asked about a home or a visit",
  investor_first_step_done: "They already asked for the investor packet",
  steward_first_step_done: "They already raised a hand for a seat",
  prosperity_first_step_done: "They already sent a Work With Us proposal",
  member_first_step_done: "They already took a first Quest",
  going_to_next_gathering: "They already said yes to the next gathering",
  investor_words_unreviewed: "The investor words are not reviewed yet",
};

export const STOP_LABELS: Record<StopKey, string> = {
  withdrew: "They took their yes back",
  gathering_cancelled: "The gathering was called off",
  gathering_removed: "The gathering was deleted",
  left_path: "They left the path",
  resident_reserved: "Their home was reserved",
  investor_committed: "They committed as an investor",
  steward_seated: "They took a seat",
  prosperity_venture_listed: "Their venture was listed",
  joining_admitted: "They were admitted",
  joining_declined: "Their request was declined",
  member_took_part: "They took part",
  unsubscribed: "They said no to these emails",
  suppressed: "Their address stopped taking email",
};

/** Why a step is skipped or waiting, as one plain line. */
export function reasonLabel(reason: StepSkipReason | StepWaitReason | undefined, condition?: ConditionKey): string {
  switch (reason) {
    case "turned_off":
      return "Turned off for this gathering";
    case "no_time":
      return "There is no time to plan it from";
    case "before_enrollment":
      return "Its moment passed before they started";
    case "too_late":
      return "Too late to be worth sending";
    case "audience":
      return "Not for someone with their attendance";
    case "superseded":
      return "A newer email went instead";
    case "condition":
      return condition ? CONDITION_LABELS[condition] : "A skip rule holds";
    case "not_yet":
      return "Its moment has not come";
    case "daytime":
      return "Waiting for daytime where they are";
    case "unanswered":
      return condition ? `Waiting until this can be checked: ${CONDITION_LABELS[condition]}` : "Waiting until a rule can be checked";
    case "paused":
      return "They paused these emails";
    default:
      return "";
  }
}

// ── When a step goes, in words ──────────────────────────────────────────────

const ENROLLED_PHRASE: Record<JourneyKind, string> = {
  event: "they say yes",
  path: "they start the path",
  member: "they join",
  joining: "they ask to join",
  poll: "they vote",
};

/** A span of minutes as days, hours or minutes. */
export function spanLabel(minutes: number): string {
  const m = Math.abs(Math.trunc(minutes));
  const unit = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;
  if (m > 0 && m % 1440 === 0) return unit(m / 1440, "day");
  if (m > 0 && m % 60 === 0) return unit(m / 60, "hour");
  return unit(m, "minute");
}

/** When one step goes, relative to its anchor: "1 day before it starts". */
export function timingLabel(kind: JourneyKind, step: Pick<JourneyStep, "anchor" | "offsetMinutes">): string {
  const o = Math.trunc(step.offsetMinutes);
  if (step.anchor === "enrolled") return o === 0 ? `When ${ENROLLED_PHRASE[kind]}` : `${spanLabel(o)} after ${ENROLLED_PHRASE[kind]}`;
  const what = step.anchor === "event_start" ? "it starts" : "it ends";
  if (o === 0) return `When ${what}`;
  return `${spanLabel(o)} ${o < 0 ? "before" : "after"} ${what}`;
}

// ── The reminder dials ──────────────────────────────────────────────────────

/** Reminders at least this many minutes before the start use the day-before words. */
export const DAY_REMINDER_MINUTES = 720;

/**
 * `comms.event_reminder_minutes` read as minutes before the start, largest
 * first. Empty text is no reminders. Text the dial's own check would refuse
 * reads as null, and the platform's steps stand.
 */
export function parseReminderMinutes(raw: unknown): number[] | null {
  const text = typeof raw === "string" ? raw.trim() : "";
  if (!text) return [];
  const parts = text.split(",").map((p) => p.trim());
  if (!parts.every((p) => /^\d+$/.test(p))) return null;
  const minutes = parts.map(Number);
  if (minutes.length > 4 || new Set(minutes).size !== minutes.length || minutes.some((m) => m < 10 || m > 20160)) return null;
  return minutes.sort((a, b) => b - a);
}

/** The village's reminder dials, read. Null leaves that part of the definition as it is. */
export interface ReminderDials {
  reminderMinutes: number[] | null;
  hostNudgeMinutes: number | null;
}

/**
 * The platform's gathering journeys with the village's reminder dials applied
 * (see the header). Any other journey comes back as it was.
 */
export function withReminderDials(def: JourneyDefinition, dials: ReminderDials): JourneyDefinition {
  if (def.key === "gathering.host" && dials.hostNudgeMinutes !== null && Number.isFinite(dials.hostNudgeMinutes)) {
    const nudge = Math.max(0, Math.trunc(dials.hostNudgeMinutes));
    return { ...def, steps: def.steps.map((s) => (s.key === "nudge" ? { ...s, offsetMinutes: nudge } : s)) };
  }
  if (def.key !== "gathering.going" || dials.reminderMinutes === null) return def;
  const day = def.steps.find((s) => s.key === "day");
  const soon = def.steps.find((s) => s.key === "soon");
  if (!day || !soon) return def;
  const reminders: JourneyStep[] = [];
  let dayTaken = false;
  let soonTaken = false;
  for (const minutes of dials.reminderMinutes) {
    const long = minutes >= DAY_REMINDER_MINUTES;
    const shape = long ? day : soon;
    const key = long ? (dayTaken ? `remind_${minutes}` : "day") : soonTaken ? `remind_${minutes}` : "soon";
    if (key === "day") dayTaken = true;
    if (key === "soon") soonTaken = true;
    const late = key === "day" || key === "soon" ? shape.maxLateMinutes : long ? day.maxLateMinutes : Math.min(soon.maxLateMinutes, Math.floor(minutes / 2));
    reminders.push({ ...shape, key, offsetMinutes: -minutes, maxLateMinutes: late, skipIf: [...shape.skipIf] });
  }
  return { ...def, steps: [...def.steps.filter((s) => s.anchor !== "event_start"), ...reminders] };
}

/** The steps of a gathering journey that are reminders: every step on the gathering's start. */
export function reminderStepKeys(def: Pick<JourneyDefinition, "steps">): string[] {
  return def.steps.filter((s) => s.anchor === "event_start").map((s) => s.key);
}

// ── Editing one step ────────────────────────────────────────────────────────

/** What the Journeys screen may change about a step. */
export interface StepPatch {
  offsetMinutes?: number;
  window?: JourneyStep["window"];
  audience?: JourneyStep["audience"];
  templateKey?: string;
  skipIf?: ConditionKey[];
}

/** The longest a step may sit from its anchor: sixty days. */
export const MAX_OFFSET_MINUTES = 60 * 1440;

const TEMPLATE_KEY = /^[a-z][a-z0-9_.-]{0,99}$/;

/**
 * One step changed, or the reasons it cannot be. `templateKnown` says whether
 * words exist for a key (the platform's, or the village's own).
 */
export function editStep(
  def: JourneyDefinition,
  stepKey: string,
  patch: StepPatch,
  opts: { templateKnown(key: string): boolean },
): { definition: JourneyDefinition } | { problems: string[] } {
  const step = def.steps.find((s) => s.key === stepKey);
  if (!step) return { problems: [`This journey has no step called "${String(stepKey).slice(0, 64)}".`] };
  const problems: string[] = [];
  const next: JourneyStep = { ...step, skipIf: [...step.skipIf] };

  if (patch.offsetMinutes !== undefined) {
    const o = Number(patch.offsetMinutes);
    if (!Number.isInteger(o) || Math.abs(o) > MAX_OFFSET_MINUTES) problems.push("Choose a time within sixty days, in whole minutes.");
    else if (step.anchor === "enrolled" && o < 0) problems.push("A step can't go before the person starts the journey.");
    else next.offsetMinutes = o;
  }
  if (patch.window !== undefined) {
    if (patch.window !== "any" && patch.window !== "daytime") problems.push("Choose any time or daytime only.");
    else next.window = patch.window;
  }
  if (patch.audience !== undefined) {
    if (patch.audience !== "all" && patch.audience !== "came" && patch.audience !== "missed") problems.push("Choose who the step is for.");
    else if (patch.audience !== "all" && step.anchor !== "event_end") problems.push("Only a step after a gathering ends can go to just the people who came, or just the people who missed it.");
    else next.audience = patch.audience;
  }
  if (patch.templateKey !== undefined) {
    const key = String(patch.templateKey);
    if (!TEMPLATE_KEY.test(key) || !opts.templateKnown(key)) problems.push("Choose words that exist on the Words screen.");
    else if (kindForTemplate(key) !== def.emailKind) problems.push("Choose words written for this kind of email.");
    else next.templateKey = key;
  }
  if (patch.skipIf !== undefined) {
    const allowed = CONDITIONS_FOR_KIND[def.kind];
    const asked = Array.isArray(patch.skipIf) ? patch.skipIf : [];
    const unknown = asked.filter((k) => !allowed.includes(k));
    if (!Array.isArray(patch.skipIf) || unknown.length) problems.push("Choose skip rules from the list for this journey.");
    else next.skipIf = Array.from(new Set(asked));
  }
  if (problems.length) return { problems };
  return { definition: { ...def, steps: def.steps.map((s) => (s.key === stepKey ? next : s)) } };
}
