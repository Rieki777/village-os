/**
 * THE SETTINGS EDITOR: a seat's terms, written, one group at a time.
 *
 * The wizard's `seatSettings` field kind. Each group of the terms
 * (shared/seatSettings.ts) is a collapsed row saying what it holds now, the
 * preset it started from, and a "customised" mark once it moves away from
 * that preset. Three doors on each row:
 *
 *   Change            a sheet of preset cards, each previewing its own
 *                     headline: the platform's shapes first, the village's
 *                     own second, retired ones hidden.
 *   Edit              the group's own fields (SeatSettingsFields).
 *   Reset to preset   back to exactly what the preset said.
 *
 * A "whole seat" preset at the top fills every group in one pick.
 *
 * ONE JUDGE. `parseSeatSettings` decides what is wrong, and the same function
 * will refuse it at the route (PR4), so the line a member reads here is the
 * sentence the server would answer with. An unknown currency code is said
 * out loud and kept, never blocked.
 *
 * MONEY IS A RECORD. Every money group says so under its headline, and the
 * pay group's help carries the sentence the old cash field said: nothing
 * here moves value.
 */
import { useEffect, useId, useRef, useState } from "react";
import { Check, RotateCcw } from "lucide-react";
import {
  GROUP_LABELS,
  SETTINGS_GROUPS,
  emptySettings,
  parseSeatSettings,
  settingsWords,
  type SeatSettings,
  type SettingsGroup,
} from "@shared/seatSettings";
import {
  WHOLE_PRESETS,
  applyPreset,
  applyWholePreset,
  clearGroup,
  isCustomised,
  presetFor,
  presetsFor,
  resetGroup,
  wholePresetById,
  type SeatPreset,
} from "@shared/seatPresets";
import SeatSettingsFields from "./SeatSettingsFields";

export const EDITOR_WORDS = {
  wholeLead: "Start from a whole seat",
  wholeSub: "Fills every group at once. Change any of them after.",
  change: "Change",
  edit: "Edit",
  reset: "Reset to preset",
  clear: "Clear",
  customised: "customised",
  startedFrom: "Started from",
  noPreset: "No preset",
  choosePreset: (group: string) => `Choose a ${group.toLowerCase()} preset`,
  payHelp: "Recorded here and settled off the platform. Money never flows out of this village through this software.",
} as const;

const quietButton =
  "inline-flex min-h-[44px] items-center gap-1.5 rounded-lg px-3 text-sm font-medium text-teal-deep hover:bg-stone-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-deep";

const asSettings = (v: unknown): SeatSettings =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as SeatSettings) : emptySettings();

/** A preset's own headline, for its card. Null when it would only repeat the title. */
const previewOf = (preset: SeatPreset): string | null => {
  const row = settingsWords({ v: 1, [preset.group]: preset.values } as SeatSettings).find((r) => r.group === preset.group);
  const headline = row?.headline ?? "";
  return headline && headline.trim().toLowerCase() !== preset.label.trim().toLowerCase() ? headline : null;
};

function GroupRow({
  group,
  settings,
  villagePresets,
  problems,
  onChange,
}: {
  group: SettingsGroup;
  settings: SeatSettings;
  villagePresets: readonly SeatPreset[];
  problems: string[];
  onChange: (next: SeatSettings) => void;
}) {
  const [panel, setPanel] = useState<"none" | "presets" | "fields">("none");
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const headId = `${uid}-head`;
  const presetsId = `${uid}-presets`;
  const fieldsId = `${uid}-fields`;
  const row = settingsWords(settings).find((r) => r.group === group)!;
  const preset = presetFor(settings, group, villagePresets);
  const customised = isCustomised(settings, group, villagePresets);
  const options = presetsFor(group, villagePresets);

  return (
    <section aria-labelledby={headId} className="rounded-xl border border-stone-200 bg-white p-3" data-settings-group={group}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h4 id={headId} className="text-xs font-semibold uppercase tracking-wide text-stone-500">
            {GROUP_LABELS[group]}
          </h4>
          <p className={`mt-0.5 text-sm ${row.set ? "text-stone-900" : "text-stone-500"}`}>{row.headline}</p>
          {row.moneyLine && <p className="mt-0.5 text-xs text-stone-600">{row.moneyLine}</p>}
          <p className="mt-0.5 text-xs text-stone-500">
            {preset ? `${EDITOR_WORDS.startedFrom} ${preset.label}` : EDITOR_WORDS.noPreset}
            {customised && (
              <span className="ml-1.5 rounded-full border border-stone-300 px-2 py-0.5 text-[11px] font-semibold text-stone-700">
                {EDITOR_WORDS.customised}
              </span>
            )}
          </p>
        </div>
        <div className="flex flex-wrap gap-1">
          {options.length > 0 && (
            <button
              type="button"
              aria-expanded={panel === "presets"}
              aria-controls={presetsId}
              onClick={() => setPanel((p) => (p === "presets" ? "none" : "presets"))}
              className={quietButton}
            >
              {EDITOR_WORDS.change}
              <span className="sr-only"> {GROUP_LABELS[group]}</span>
            </button>
          )}
          <button
            type="button"
            aria-expanded={panel === "fields"}
            aria-controls={fieldsId}
            onClick={() => setPanel((p) => (p === "fields" ? "none" : "fields"))}
            className={quietButton}
          >
            {EDITOR_WORDS.edit}
            <span className="sr-only"> {GROUP_LABELS[group]}</span>
          </button>
          {customised && (
            <button type="button" onClick={() => onChange(resetGroup(settings, group, villagePresets))} className={quietButton}>
              <RotateCcw className="size-4" aria-hidden="true" />
              {EDITOR_WORDS.reset}
              <span className="sr-only"> for {GROUP_LABELS[group]}</span>
            </button>
          )}
          {row.set && (
            <button type="button" onClick={() => onChange(clearGroup(settings, group))} className={quietButton}>
              {EDITOR_WORDS.clear}
              <span className="sr-only"> {GROUP_LABELS[group]}</span>
            </button>
          )}
        </div>
      </div>

      <div id={presetsId} role="group" aria-labelledby={`${presetsId}-head`} hidden={panel !== "presets"} className="mt-3">
        <p id={`${presetsId}-head`} className="mb-2 text-sm font-semibold text-stone-900">
          {EDITOR_WORDS.choosePreset(GROUP_LABELS[group])}
        </p>
        <ul className="grid gap-2 sm:grid-cols-2">
          {options.map((o) => {
            const current = preset?.id === o.id;
            return (
              <li key={o.id}>
                <button
                  type="button"
                  aria-pressed={current}
                  onClick={() => {
                    onChange(applyPreset(settings, o));
                    setPanel("none");
                  }}
                  className={`flex min-h-[44px] w-full flex-col items-start rounded-lg border-2 p-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-deep ${
                    current ? "border-teal-deep bg-teal-deep/5" : "border-stone-200 hover:border-stone-400"
                  }`}
                >
                  <span className="flex items-center gap-1.5 text-sm font-semibold text-stone-900">
                    {o.label}
                    {current && <Check className="size-4 text-teal-deep" aria-hidden="true" />}
                  </span>
                  <span className="mt-0.5 text-xs text-stone-600">{o.blurb}</span>
                  {previewOf(o) && <span className="mt-1 text-xs font-medium text-stone-800">{previewOf(o)}</span>}
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      <div id={fieldsId} hidden={panel !== "fields"} className="mt-3">
        {group === "pay" && <p className="mb-2 text-xs text-stone-600 leading-relaxed">{EDITOR_WORDS.payHelp}</p>}
        {panel === "fields" && <SeatSettingsFields group={group} settings={settings} onChange={onChange} />}
      </div>

      {problems.length > 0 && (
        <ul role="alert" className="mt-2 space-y-1">
          {problems.map((p, i) => (
            <li key={i} className="text-sm font-medium text-coral">
              {p}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default function SeatSettingsEditor({
  value,
  onChange,
  villagePresets = [],
  prefillWholeId,
}: {
  /** The settings as the wizard holds them. May be mid-edit and not yet valid. */
  value: unknown;
  onChange: (next: SeatSettings) => void;
  /** The village's own presets (PR3). The platform's are always offered. */
  villagePresets?: readonly SeatPreset[];
  /** A whole preset to start from when nothing has been written yet. */
  prefillWholeId?: string;
}) {
  const settings = asSettings(value);
  const parsed = parseSeatSettings(value);

  // Start from the platform's defaults once, when the field arrives empty.
  const prefilled = useRef(false);
  useEffect(() => {
    if (prefilled.current || value !== undefined || !prefillWholeId) return;
    prefilled.current = true;
    const whole = wholePresetById(prefillWholeId);
    if (whole) onChange(applyWholePreset(null, whole, villagePresets));
  }, [value, prefillWholeId, onChange, villagePresets]);

  const problemsFor = (group: SettingsGroup): string[] =>
    [...parsed.problems, ...parsed.flags]
      .filter((p) => p.path === group || p.path.startsWith(`${group}.`))
      .map((p) => p.message);
  const loose = parsed.problems.filter((p) => !SETTINGS_GROUPS.some((g) => p.path === g || p.path.startsWith(`${g}.`)));

  return (
    <div className="space-y-3" data-seat-settings-editor="">
      <div className="rounded-xl border border-stone-200 bg-stone-50 p-3">
        <p className="text-sm font-semibold text-stone-900">{EDITOR_WORDS.wholeLead}</p>
        <p className="text-xs text-stone-600">{EDITOR_WORDS.wholeSub}</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {WHOLE_PRESETS.map((w) => (
            <button
              key={w.id}
              type="button"
              title={w.blurb}
              onClick={() => onChange(applyWholePreset(settings, w, villagePresets))}
              className="inline-flex min-h-[44px] items-center rounded-lg border border-stone-300 bg-white px-3 text-sm font-medium text-stone-800 hover:bg-stone-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-deep"
            >
              {w.label}
            </button>
          ))}
        </div>
      </div>
      {SETTINGS_GROUPS.map((group) => (
        <GroupRow
          key={group}
          group={group}
          settings={settings}
          villagePresets={villagePresets}
          problems={problemsFor(group)}
          onChange={onChange}
        />
      ))}
      {loose.length > 0 && (
        <ul role="alert" className="space-y-1">
          {loose.map((p, i) => (
            <li key={i} className="text-sm font-medium text-coral">
              {p.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
