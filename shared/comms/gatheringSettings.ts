/**
 * ONE GATHERING'S OWN EMAIL SETTINGS, and the rule that turns its reminder
 * times into what the journey planner reads (the comms build spec 5.7).
 *
 * Each gathering keeps three choices in `event_comms` (drizzle/0229):
 *
 *   reminders   NULL follows the village (`comms.event_reminder_minutes`),
 *               an empty list is off, and a list of minutes before the start
 *               is this gathering's own.
 *   guests      NULL follows the village (`comms.guests_default`), 1 is on,
 *               0 is off. The guests lane reads it; this file only names it.
 *   host        the member asked for the recap. Nobody named means the person
 *               who put the gathering on the calendar.
 *
 * ── HOW REMINDER TIMES REACH THE PLANNER ───────────────────────────────────
 *
 * The `gathering.going` journey carries two reminder steps, `day` (a day
 * before, the "Tomorrow" words) and `soon` (two hours before, the "Starting
 * soon" words). A gathering's reminder times are matched against those steps
 * by their offset:
 *
 *   - a time equal to a step's own offset keeps that step, unchanged
 *     (`stepOverrides[step] = { skip: false }`);
 *   - a step whose offset is not among the times is skipped
 *     (`stepOverrides[step] = { skip: true }`);
 *   - a time no step matches becomes an extra step, `remind_<minutes>`
 *     (`extraSteps`), with the "Starting soon" words up to six hours before
 *     and the "Tomorrow" words further out.
 *
 * Every one of the journey's reminder steps gets an answer, kept or skipped,
 * because the engine merges what several providers say key by key: an answer
 * left out would let an older one (stored when the person said yes, before a
 * host turned reminders off and on again) stand.
 *
 * So the default ("1440,120") skips nothing, "off" skips both steps, and a
 * custom list that keeps two hours before still sends the very step that was
 * always going to go, under the same idempotency key, so changing a setting
 * never sends one reminder twice.
 *
 * THE WORDS ARE THE LIMIT. The platform has two reminder emails, written for a
 * day before and for a few hours before. A time further out than a day still
 * gets the "Tomorrow" words. The per-gathering picker offers only times the
 * words fit; the village dial accepts any time the variable allows, and a
 * founder who sets one two days out reads "Tomorrow" two days early.
 *
 * Pure and isomorphic: the server plans with it and the client draws the
 * picker from it.
 */
import type { ConditionKey, JourneyDefinition, JourneyStep } from "./contracts";

// ── Names ───────────────────────────────────────────────────────────────────

/** The journey everybody who says yes walks: a confirmation and the reminders. */
export const GATHERING_GOING_JOURNEY = "gathering.going";
/** The host's journey: one nudge to write the recap after the gathering ends. */
export const GATHERING_HOST_JOURNEY = "gathering.host";

/** The key every extra reminder step is given, by its minutes before the start. */
export const EXTRA_REMINDER_PREFIX = "remind_";

// ── Reminders ───────────────────────────────────────────────────────────────

/** The bounds the village dial holds to (shared/gameVariables.ts), held here too. */
export const REMINDER_MIN_MINUTES = 10;
export const REMINDER_MAX_MINUTES = 20160;
export const MAX_REMINDERS = 4;

/** Up to this many minutes before the start, a reminder reads "Starting soon". */
export const SOON_REMINDER_MAX_MINUTES = 360;

/** The reminder times the per-gathering picker offers: each one has words that fit it. */
export const REMINDER_CHOICES: readonly number[] = [1440, 240, 120, 60, 30];

export type ReminderSetting =
  | { mode: "default" }
  | { mode: "off" }
  | { mode: "custom"; minutes: number[] };

/** Why a list of reminder times cannot be kept, or null when it can. The dial's own rule. */
export function reminderListProblem(minutes: unknown): string | null {
  if (!Array.isArray(minutes)) return "Reminder times are a list of minutes before the start.";
  if (minutes.length > MAX_REMINDERS) return `At most ${MAX_REMINDERS} reminders for one gathering.`;
  for (const m of minutes) {
    if (typeof m !== "number" || !Number.isInteger(m) || m < REMINDER_MIN_MINUTES || m > REMINDER_MAX_MINUTES) {
      return `Each reminder is whole minutes before the start, from ${REMINDER_MIN_MINUTES} to ${REMINDER_MAX_MINUTES}.`;
    }
  }
  if (new Set(minutes).size !== minutes.length) return "Each reminder time can only be listed once.";
  return null;
}

/** A list sorted earliest reminder first (most minutes before the start), each once. */
export function sortedReminders(minutes: readonly number[]): number[] {
  return Array.from(new Set(minutes)).sort((a, b) => b - a);
}

/**
 * The dial's text read as minutes. Blank is none. The variable refuses a
 * malformed value when it is saved, so a part that is not whole minutes here
 * can only be a hand-edited row, and it is left out rather than guessed at.
 */
export function parseReminderDial(raw: unknown): number[] {
  const text = typeof raw === "string" ? raw.trim() : "";
  if (!text) return [];
  const out: number[] = [];
  for (const part of text.split(",")) {
    const p = part.trim();
    if (!/^\d+$/.test(p)) continue;
    const m = Number(p);
    if (m >= REMINDER_MIN_MINUTES && m <= REMINDER_MAX_MINUTES && !out.includes(m)) out.push(m);
  }
  return sortedReminders(out).slice(0, MAX_REMINDERS);
}

/** `event_comms.reminders` as stored, read as a setting. Anything unreadable follows the village. */
export function reminderSettingFromColumn(raw: unknown): ReminderSetting {
  let v: unknown = raw;
  if (typeof v === "string") {
    try {
      v = JSON.parse(v);
    } catch {
      return { mode: "default" };
    }
  }
  if (!Array.isArray(v)) return { mode: "default" };
  if (v.length === 0) return { mode: "off" };
  const minutes = v.filter((m): m is number => typeof m === "number" && Number.isInteger(m) && m >= REMINDER_MIN_MINUTES && m <= REMINDER_MAX_MINUTES);
  return minutes.length ? { mode: "custom", minutes: sortedReminders(minutes).slice(0, MAX_REMINDERS) } : { mode: "default" };
}

/** A setting as `event_comms.reminders` stores it: null, an empty list, or the minutes. */
export function reminderSettingToColumn(s: ReminderSetting): number[] | null {
  if (s.mode === "default") return null;
  if (s.mode === "off") return [];
  return sortedReminders(s.minutes);
}

/** The reminder times a gathering actually gets, given the village dial's. */
export function effectiveReminders(s: ReminderSetting, villageMinutes: readonly number[]): number[] {
  if (s.mode === "off") return [];
  if (s.mode === "custom") return sortedReminders(s.minutes);
  return sortedReminders(villageMinutes);
}

/** A reminder time in words: "1 day before", "2 hours before", "30 minutes before". */
export function reminderLabel(minutes: number): string {
  const m = Math.max(0, Math.trunc(minutes));
  const unit = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"} before`;
  if (m % 1440 === 0) return unit(m / 1440, "day");
  if (m % 60 === 0) return unit(m / 60, "hour");
  if (m > 60) return `${unit(Math.floor(m / 60), "hour").replace(" before", "")} and ${unit(m % 60, "minute")}`;
  return unit(m, "minute");
}

/** The words a reminder that many minutes ahead is sent with. */
export function reminderTemplateFor(minutes: number): "gathering.reminder_soon" | "gathering.reminder_day" {
  return minutes <= SOON_REMINDER_MAX_MINUTES ? "gathering.reminder_soon" : "gathering.reminder_day";
}

/** What the planner may be told about one of a journey's own steps. */
export interface GatheringStepOverride {
  offsetMinutes?: number;
  skip?: boolean;
}

/** What one gathering's reminder times add to an enrollment's facts. */
export interface GatheringReminderFacts {
  stepOverrides: Record<string, GatheringStepOverride>;
  extraSteps: JourneyStep[];
}

/** A journey's own reminder steps: every step on the gathering's start, before it. */
export function reminderStepsOf(def: Pick<JourneyDefinition, "steps">): JourneyStep[] {
  return def.steps.filter((s) => s.anchor === "event_start" && s.offsetMinutes < 0);
}

/**
 * The reminder times a journey's own steps carry, in minutes before the start.
 * This is what "default" means for a gathering: the village's journey. While
 * the village has not edited the journey, the engine builds those steps from
 * the reminder dial (`withReminderDials`, ./journeySteps.ts), so the dial is
 * heard; once an admin edits a reminder on the Journeys screen, the edit is.
 */
export function journeyReminderMinutes(def: Pick<JourneyDefinition, "steps">): number[] {
  return sortedReminders(reminderStepsOf(def).map((s) => -s.offsetMinutes));
}

/** One extra reminder, for a time none of the journey's own steps sits at. */
export function extraReminderStep(minutes: number): JourneyStep {
  const soon = minutes <= SOON_REMINDER_MAX_MINUTES;
  const skipIf: ConditionKey[] = ["time_still_being_voted"];
  return {
    key: `${EXTRA_REMINDER_PREFIX}${minutes}`,
    anchor: "event_start",
    offsetMinutes: -minutes,
    window: "any",
    audience: "all",
    templateKey: reminderTemplateFor(minutes),
    skipIf,
    // A reminder whose moment passed before the person said yes is noise.
    catchUp: "skip",
    // Late enough to still be useful, never so late it lands after the start.
    maxLateMinutes: soon ? Math.max(5, Math.min(60, Math.floor(minutes / 2))) : Math.min(360, Math.floor(minutes / 4)),
  };
}

/**
 * What a gathering's reminder times tell the planner, against the journey
 * definition the enrollment runs on. The header says how the matching works.
 */
export function reminderPlan(minutes: readonly number[], def: Pick<JourneyDefinition, "steps">): GatheringReminderFacts {
  const wanted = sortedReminders(minutes);
  const own = reminderStepsOf(def);
  const stepOverrides: Record<string, GatheringStepOverride> = {};
  for (const step of own) stepOverrides[step.key] = { skip: !wanted.includes(-step.offsetMinutes) };
  const covered = new Set(own.map((s) => -s.offsetMinutes));
  const extraSteps = wanted.filter((m) => !covered.has(m)).map(extraReminderStep);
  return { stepOverrides, extraSteps };
}

// ── Guests ──────────────────────────────────────────────────────────────────

export type GuestSetting = "default" | "on" | "off";
export const GUEST_SETTINGS: readonly GuestSetting[] = ["default", "on", "off"];

/** `event_comms.guests` as stored, read as a setting. */
export function guestSettingFromColumn(raw: unknown): GuestSetting {
  if (raw === null || raw === undefined) return "default";
  return Number(raw) === 1 || raw === true ? "on" : "off";
}

/** A setting as `event_comms.guests` stores it. */
export function guestSettingToColumn(s: GuestSetting): 0 | 1 | null {
  return s === "default" ? null : s === "on" ? 1 : 0;
}

/** Whether guests may say yes, given the village dial. */
export function effectiveGuests(s: GuestSetting, villageOn: boolean): boolean {
  return s === "default" ? villageOn : s === "on";
}

// ── What the settings routes answer ─────────────────────────────────────────

/** One person a host can be chosen from. Members only: a guest cannot host. */
export interface HostChoice {
  id: string;
  name: string;
}

/** Everything the per-gathering email controls show and edit. */
export interface GatheringEmailSettingsView {
  eventId: string;
  title: string;
  reminders: ReminderSetting;
  guests: GuestSetting;
  /** The member named as host, or null when it falls to whoever created the gathering. */
  hostUserId: string | null;
  effective: { reminderMinutes: number[]; guests: boolean; hostName: string | null };
  village: { reminderMinutes: number[]; guests: boolean };
  hostChoices: HostChoice[];
  /** How many times the gathering's time or place has been sent out again. */
  icsSequence: number;
}

/** A change the PUT route takes. Every field is optional; what is absent stays. */
export interface GatheringEmailSettingsChange {
  reminders?: ReminderSetting;
  guests?: GuestSetting;
  hostUserId?: string | null;
}

/** A request body read as a change, or the sentence that refuses it. */
export function settingsChangeOf(body: unknown): { ok: true; change: GatheringEmailSettingsChange } | { ok: false; error: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, error: "Send the settings to change." };
  const b = body as Record<string, unknown>;
  const change: GatheringEmailSettingsChange = {};
  if (b.reminders !== undefined) {
    const r = b.reminders as Record<string, unknown> | null;
    const mode = r && typeof r === "object" ? r.mode : null;
    if (mode === "default") change.reminders = { mode: "default" };
    else if (mode === "off") change.reminders = { mode: "off" };
    else if (mode === "custom") {
      const problem = reminderListProblem(r?.minutes);
      if (problem) return { ok: false, error: problem };
      const minutes = r?.minutes as number[];
      if (!minutes.length) return { ok: false, error: "Choose at least one reminder time, or turn reminders off." };
      change.reminders = { mode: "custom", minutes: sortedReminders(minutes) };
    } else return { ok: false, error: "Reminders follow the village, are off, or are this gathering's own times." };
  }
  if (b.guests !== undefined) {
    if (!(GUEST_SETTINGS as readonly unknown[]).includes(b.guests)) return { ok: false, error: "Guests follow the village, are on, or are off." };
    change.guests = b.guests as GuestSetting;
  }
  if (b.hostUserId !== undefined) {
    if (b.hostUserId !== null && (typeof b.hostUserId !== "string" || !b.hostUserId.trim() || b.hostUserId.length > 64)) {
      return { ok: false, error: "Choose a member to host, or nobody." };
    }
    change.hostUserId = b.hostUserId === null ? null : b.hostUserId.trim();
  }
  if (!Object.keys(change).length) return { ok: false, error: "Nothing to change." };
  return { ok: true, change };
}
