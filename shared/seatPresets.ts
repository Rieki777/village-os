/**
 * THE PLATFORM'S SEAT PRESETS: shapes every village starts from.
 *
 * A member setting a seat's terms picks each group from a library and tweaks
 * it. This is the platform half of that library, and it is brand neutral by
 * rule: SHAPES WITH BLANK AMOUNTS. No village's name, no person's name, no
 * currency and no figure appears here (decision 4, defaulted to shapes only).
 * Figures are one village's economics, and a figure in platform code would
 * read as a norm in every other village. A village's own presets, amounts
 * included, are village data in the `seat-presets` app_config document (PR3).
 *
 * A "whole" preset fills every group in one pick by naming one group preset
 * per group, so a whole seat can never drift from the group presets it is
 * made of.
 *
 * PICKING COPIES. `applyPreset` deep-copies a preset's values into the
 * settings and records `{group, presetId, presetVersion}` as provenance.
 * Editing the result never reaches back into SEAT_PRESETS, which a test holds.
 */
import { canonicalJson } from "./canonicalJson";
import {
  SETTINGS_GROUPS,
  SEAT_SETTINGS_VERSION,
  type PresetProvenance,
  type SeatSettings,
  type SettingsGroup,
} from "./seatSettings";

export interface SeatPreset<G extends SettingsGroup = SettingsGroup> {
  /** `platform:<slug>` here; a village's own carry `custom:<slug>`. */
  id: string;
  group: G;
  label: string;
  /** One sentence a member reads on the preset card. */
  blurb: string;
  version: number;
  values: NonNullable<SeatSettings[G]>;
  /** Retired presets stay stored and leave the picker. */
  retiredAt?: string | null;
}

export interface WholeSeatPreset {
  id: string;
  group: "whole";
  label: string;
  blurb: string;
  version: number;
  /** One group preset id per group. */
  picks: Record<SettingsGroup, string>;
}

const p = <G extends SettingsGroup>(preset: SeatPreset<G>): SeatPreset<G> => preset;

export const SEAT_PRESETS: readonly SeatPreset[] = [
  // ── term
  p({
    id: "platform:until-season-end",
    group: "term",
    label: "Until the season ends",
    blurb: "The seat runs to the end of the season it starts in.",
    version: 1,
    values: { endsOn: null, noticeDays: 14 },
  }),
  p({
    id: "platform:three-moons",
    group: "term",
    label: "Three moons",
    blurb: "Three moons from the day of seating, then a review.",
    version: 1,
    values: { lengthMoons: 3, noticeDays: 14 },
  }),
  p({
    id: "platform:one-moon-trial",
    group: "term",
    label: "One moon trial",
    blurb: "One moon to try the seat on, with a short notice either way.",
    version: 1,
    values: { lengthMoons: 1, noticeDays: 7 },
  }),
  // ── clocks
  p({
    id: "platform:pay-month-work-moon",
    group: "clocks",
    label: "Paid monthly, works by the moon",
    blurb: "Money keeps the calendar month. The work keeps the moon.",
    version: 1,
    values: { pay: "calendar-month", work: "moon" },
  }),
  p({
    id: "platform:all-moon",
    group: "clocks",
    label: "Everything by the moon",
    blurb: "Pay and work both keep the moon.",
    version: 1,
    values: { pay: "moon", work: "moon" },
  }),
  // ── rhythm
  p({
    id: "platform:weekly-sync-plus-core-call",
    group: "rhythm",
    label: "Weekly sync and a core call",
    blurb: "A short sync early in the week and a core call midweek.",
    version: 1,
    values: {
      gatherings: [
        { label: "Weekly sync", weekday: 1, time: "09:30", every: "week" },
        { label: "Core call", weekday: 3, time: "16:00", every: "week" },
      ],
      quietDays: [0],
    },
  }),
  p({
    id: "platform:fortnightly",
    group: "rhythm",
    label: "Fortnightly",
    blurb: "One gathering every other week.",
    version: 1,
    values: { gatherings: [{ label: "Fortnightly gathering", weekday: 2, time: "10:00", every: "fortnight" }] },
  }),
  p({
    id: "platform:async-first",
    group: "rhythm",
    label: "Async first",
    blurb: "No standing gatherings. The work is written down and picked up when it suits.",
    version: 1,
    values: { gatherings: [] },
  }),
  // ── pay
  p({
    id: "platform:unpaid",
    group: "pay",
    label: "Unpaid",
    blurb: "The seat is held for the love of it. Nothing is owed.",
    version: 1,
    values: { kind: "none" },
  }),
  p({
    id: "platform:honorary",
    group: "pay",
    label: "Honorary",
    blurb: "An honour the village gives. Nothing is owed.",
    version: 1,
    values: { kind: "honorary" },
  }),
  p({
    id: "platform:fixed-monthly-stipend",
    group: "pay",
    label: "Fixed monthly stipend",
    blurb: "One amount each month. The village writes in the amount.",
    version: 1,
    values: { kind: "fixed", per: "month" },
  }),
  p({
    id: "platform:stipend-range",
    group: "pay",
    label: "Stipend range",
    blurb: "A lowest and a highest amount each month, settled as the season goes.",
    version: 1,
    values: { kind: "range", per: "month" },
  }),
  p({
    id: "platform:in-kind-or-deferred",
    group: "pay",
    label: "In kind or deferred",
    blurb: "Room, board or other support now, with any cash part owed for later.",
    version: 1,
    values: { kind: "in-kind", note: "Support in kind now. Any cash part is owed and paid when the village can." },
  }),
  // ── allowance
  p({
    id: "platform:no-allowance",
    group: "allowance",
    label: "No allowance",
    blurb: "Nothing on top of pay.",
    version: 1,
    values: { kind: "none" },
  }),
  p({
    id: "platform:flat-monthly-allowance",
    group: "allowance",
    label: "Flat monthly allowance",
    blurb: "One amount each month for the costs of the seat.",
    version: 1,
    values: { kind: "flat", per: "month" },
  }),
  p({
    id: "platform:reimbursed",
    group: "allowance",
    label: "Costs reimbursed",
    blurb: "Agreed costs are paid back against receipts.",
    version: 1,
    values: { kind: "reimbursed" },
  }),
  // ── bonus
  p({
    id: "platform:no-bonus",
    group: "bonus",
    label: "No bonus",
    blurb: "No bonus on top.",
    version: 1,
    values: { kind: "none" },
  }),
  p({
    id: "platform:rated-equity-in-words",
    group: "bonus",
    label: "Rated equity, in words",
    blurb: "A share of equity, capped and rated in words the funders agree.",
    version: 1,
    // The cap is the member's own words to write: a template sentence stored
    // as a value would be aligned with as if it were a term (red team U7). The
    // editor shows the hint as a placeholder.
    values: {
      kind: "equity",
      ratedBy: "the people who fund the seat",
      cadence: "Rated each month",
    },
  }),
  // ── quests
  p({
    id: "platform:three-to-five-done-when-by-consent",
    group: "quests",
    label: "Three to five a moon, by consent",
    blurb: "Three to five quests each moon, each with a done when, agreed by consent.",
    version: 1,
    values: { perMoonMin: 3, perMoonMax: 5, agreedHow: "by consent with the circle", doneWhenRequired: true },
  }),
  // ── scoreboard
  p({
    id: "platform:starter-measures",
    group: "scoreboard",
    label: "Starter measures",
    blurb: "Two plain measures of the work, each read from somewhere anyone can check.",
    version: 1,
    // No measure counts gatherings: a seat may have none, and its terms would
    // then measure something they never set (red team U7).
    values: {
      measures: [
        { measure: "Quests done", target: "every agreed quest done by the moon's end", readFrom: "the quest board" },
        { measure: "Handoffs written", target: "one handoff note each moon", readFrom: "the seat's notes" },
      ],
    },
  }),
  // ── ending
  p({
    id: "platform:fourteen-days-notice",
    group: "ending",
    label: "Fourteen days notice",
    blurb: "Either side gives fourteen days notice, and pay runs through it.",
    version: 1,
    values: { noticeDays: 14, payThroughNotice: true },
  }),
];

export const WHOLE_PRESETS: readonly WholeSeatPreset[] = [
  {
    id: "platform:whole-volunteer-seat",
    group: "whole",
    label: "Volunteer seat",
    blurb: "Unpaid, async first, a few quests a moon, until the season ends.",
    version: 1,
    picks: {
      term: "platform:until-season-end",
      clocks: "platform:all-moon",
      rhythm: "platform:async-first",
      pay: "platform:unpaid",
      allowance: "platform:no-allowance",
      bonus: "platform:no-bonus",
      quests: "platform:three-to-five-done-when-by-consent",
      scoreboard: "platform:starter-measures",
      ending: "platform:fourteen-days-notice",
    },
  },
  {
    id: "platform:whole-stipend-seat",
    group: "whole",
    label: "Stipend seat",
    blurb: "A fixed monthly stipend and allowance for three moons, with a weekly rhythm.",
    version: 1,
    picks: {
      term: "platform:three-moons",
      clocks: "platform:pay-month-work-moon",
      rhythm: "platform:weekly-sync-plus-core-call",
      pay: "platform:fixed-monthly-stipend",
      allowance: "platform:flat-monthly-allowance",
      bonus: "platform:no-bonus",
      quests: "platform:three-to-five-done-when-by-consent",
      scoreboard: "platform:starter-measures",
      ending: "platform:fourteen-days-notice",
    },
  },
  {
    id: "platform:whole-core-team-seat",
    group: "whole",
    label: "Core team seat",
    blurb: "A stipend range, costs reimbursed and a rated equity bonus, for the season.",
    version: 1,
    picks: {
      term: "platform:until-season-end",
      clocks: "platform:pay-month-work-moon",
      rhythm: "platform:weekly-sync-plus-core-call",
      pay: "platform:stipend-range",
      allowance: "platform:reimbursed",
      bonus: "platform:rated-equity-in-words",
      quests: "platform:three-to-five-done-when-by-consent",
      scoreboard: "platform:starter-measures",
      ending: "platform:fourteen-days-notice",
    },
  },
  {
    id: "platform:whole-trial-moon",
    group: "whole",
    label: "Trial moon",
    blurb: "One honorary moon to try the seat on before anything else is set.",
    version: 1,
    picks: {
      term: "platform:one-moon-trial",
      clocks: "platform:all-moon",
      rhythm: "platform:fortnightly",
      pay: "platform:honorary",
      allowance: "platform:no-allowance",
      bonus: "platform:no-bonus",
      quests: "platform:three-to-five-done-when-by-consent",
      scoreboard: "platform:starter-measures",
      ending: "platform:fourteen-days-notice",
    },
  },
];

/** A deep copy that cannot share a single object with its source. */
const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** Platform presets first, then the village's own, retired ones left out. */
export function presetsFor(group: SettingsGroup, village: readonly SeatPreset[] = []): SeatPreset[] {
  return [...SEAT_PRESETS, ...village].filter((x) => x.group === group && !x.retiredAt);
}

export function presetById(id: string, village: readonly SeatPreset[] = []): SeatPreset | null {
  return [...SEAT_PRESETS, ...village].find((x) => x.id === id) ?? null;
}

export function wholePresetById(id: string): WholeSeatPreset | null {
  return WHOLE_PRESETS.find((x) => x.id === id) ?? null;
}

function withProvenance(settings: SeatSettings, entry: PresetProvenance): PresetProvenance[] {
  return [...(settings.presets ?? []).filter((x) => x.group !== entry.group), entry].sort(
    (a, b) => SETTINGS_GROUPS.indexOf(a.group) - SETTINGS_GROUPS.indexOf(b.group),
  );
}

/** A new settings object with one group copied from a preset. The input is untouched. */
export function applyPreset(settings: SeatSettings | null | undefined, preset: SeatPreset): SeatSettings {
  const base: SeatSettings = settings ? copy(settings) : { v: SEAT_SETTINGS_VERSION };
  (base as any)[preset.group] = copy(preset.values);
  base.presets = withProvenance(base, { group: preset.group, presetId: preset.id, presetVersion: preset.version });
  return base;
}

/** Every group filled from a whole preset's picks. The input is untouched. */
export function applyWholePreset(
  settings: SeatSettings | null | undefined,
  whole: WholeSeatPreset,
  village: readonly SeatPreset[] = [],
): SeatSettings {
  let next: SeatSettings = settings ? copy(settings) : { v: SEAT_SETTINGS_VERSION };
  for (const group of SETTINGS_GROUPS) {
    const preset = presetById(whole.picks[group], village);
    if (preset && preset.group === group) next = applyPreset(next, preset);
  }
  return next;
}

/** The preset a group started from, when that preset is still known. */
export function presetFor(settings: SeatSettings | null | undefined, group: SettingsGroup, village: readonly SeatPreset[] = []): SeatPreset | null {
  const entry = settings?.presets?.find((x) => x.group === group);
  if (!entry) return null;
  const preset = presetById(entry.presetId, village);
  return preset && preset.group === group ? preset : null;
}

/** True when a group has moved away from the preset it started from. */
export function isCustomised(settings: SeatSettings | null | undefined, group: SettingsGroup, village: readonly SeatPreset[] = []): boolean {
  const preset = presetFor(settings, group, village);
  if (!preset || !settings) return false;
  return canonicalJson(settings[group] ?? null) !== canonicalJson(preset.values);
}

/** The group put back to its preset's values. Unchanged when it has none. */
export function resetGroup(settings: SeatSettings, group: SettingsGroup, village: readonly SeatPreset[] = []): SeatSettings {
  const preset = presetFor(settings, group, village);
  return preset ? applyPreset(settings, preset) : copy(settings);
}

/** The group cleared: not set, and no longer tied to a preset. */
export function clearGroup(settings: SeatSettings, group: SettingsGroup): SeatSettings {
  const next = copy(settings);
  delete (next as any)[group];
  const presets = (next.presets ?? []).filter((x) => x.group !== group);
  if (presets.length > 0) next.presets = presets;
  else delete next.presets;
  return next;
}
