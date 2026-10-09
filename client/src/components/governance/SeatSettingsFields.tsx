/**
 * THE FIELDS OF ONE SETTINGS GROUP, for SeatSettingsEditor.
 *
 * Each group of a seat's terms (shared/seatSettings.ts) is a handful of
 * ordinary inputs. They write straight into the group's object and hand the
 * whole settings back up; `parseSeatSettings` judges the result, so a field
 * here never invents a rule of its own. Absent stays absent: clearing a box
 * removes the key, and the words then read "not set", never 0.
 *
 * AMOUNTS ARE TYPED WHOLE, in the currency's own units, and stored as whole
 * minor units. A decimal typed here is kept as typed so the parser can say
 * "Whole numbers only" where the member is looking.
 */
import { useId, type ReactNode } from "react";
import { Plus, X } from "lucide-react";
import {
  ALLOWANCE_KINDS,
  BONUS_KINDS,
  GATHERING_EVERY,
  LIMITS,
  MONEY_PER,
  PAY_CLOCKS,
  PAY_KINDS,
  WORK_CLOCKS,
  minorDigits,
  type SeatSettings,
  type SettingsGroup,
} from "@shared/seatSettings";

const input =
  "w-full min-h-[44px] rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-deep";
const labelClass = "block text-xs font-semibold text-stone-700";
const smallButton =
  "inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border border-stone-300 px-3 text-sm font-medium text-stone-700 hover:bg-stone-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-deep disabled:opacity-50";

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const WORDS: Record<string, string> = {
  "calendar-month": "Calendar month",
  moon: "Moon",
  week: "Week",
  fortnight: "Fortnight",
  month: "Month",
  none: "None",
  fixed: "Fixed amount",
  range: "A range",
  honorary: "Honorary",
  "in-kind": "In kind",
  deferred: "Deferred",
  flat: "Flat amount",
  reimbursed: "Costs reimbursed",
  equity: "Equity, in words",
};

type Obj = Record<string, any>;

/** Set or remove one key, returning a new object. */
const put = (obj: Obj | undefined, key: string, v: unknown): Obj => {
  const next: Obj = { ...(obj ?? {}) };
  if (v === undefined || v === "") delete next[key];
  else next[key] = v;
  return next;
};

/** A whole-number box: empty removes the key, anything else is kept as a number. */
const wholeFrom = (raw: string): number | undefined => (raw.trim() === "" ? undefined : Number(raw));

function Field({ label, children, wide = false }: { label: string; children: (id: string) => ReactNode; wide?: boolean }) {
  const id = useId();
  return (
    <div className={wide ? "sm:col-span-2" : ""}>
      <label htmlFor={id} className={labelClass}>
        {label}
      </label>
      <div className="mt-1">{children(id)}</div>
    </div>
  );
}

function Choice({
  label,
  value,
  options,
  onChange,
  blank = "Not set",
}: {
  label: string;
  value: unknown;
  options: readonly string[];
  onChange: (v: string | undefined) => void;
  blank?: string | null;
}) {
  return (
    <Field label={label}>
      {(id) => (
        <select id={id} className={input} value={String(value ?? "")} onChange={(e) => onChange(e.target.value || undefined)}>
          {blank !== null && <option value="">{blank}</option>}
          {options.map((o) => (
            <option key={o} value={o}>
              {WORDS[o] ?? o}
            </option>
          ))}
        </select>
      )}
    </Field>
  );
}

function Whole({ label, value, onChange, min = 0, max }: { label: string; value: unknown; onChange: (v: number | undefined) => void; min?: number; max?: number }) {
  return (
    <Field label={label}>
      {(id) => (
        <input
          id={id}
          className={input}
          type="number"
          inputMode="numeric"
          step={1}
          min={min}
          max={max}
          value={value === undefined || value === null ? "" : String(value)}
          onChange={(e) => onChange(wholeFrom(e.target.value))}
        />
      )}
    </Field>
  );
}

function Words({ label, value, onChange, max, wide = true, area = false }: { label: string; value: unknown; onChange: (v: string | undefined) => void; max: number; wide?: boolean; area?: boolean }) {
  return (
    <Field label={label} wide={wide}>
      {(id) =>
        area ? (
          <textarea id={id} className={input} rows={2} maxLength={max} value={String(value ?? "")} onChange={(e) => onChange(e.target.value || undefined)} />
        ) : (
          <input id={id} className={input} type="text" maxLength={max} value={String(value ?? "")} onChange={(e) => onChange(e.target.value || undefined)} />
        )
      }
    </Field>
  );
}

function DateBox({ label, value, onChange }: { label: string; value: unknown; onChange: (v: string | undefined) => void }) {
  return (
    <Field label={label}>
      {(id) => <input id={id} className={input} type="date" value={String(value ?? "")} onChange={(e) => onChange(e.target.value || undefined)} />}
    </Field>
  );
}

/**
 * An amount typed in whole units of the currency, stored as whole minor units.
 *
 * Only digits are ever scaled. Anything else ("12.5", "1e3") is stored as the
 * exact text typed, so the box keeps showing it, the parser refuses it with
 * "Whole numbers only.", and no headline ever shows a rescaled figure.
 */
function Amount({ label, minor, currency, onChange }: { label: string; minor: unknown; currency: string | undefined; onChange: (v: number | string | undefined) => void }) {
  const digits = minorDigits(currency);
  const shown =
    typeof minor === "string"
      ? minor
      : typeof minor === "number" && Number.isInteger(minor)
        ? String(minor / 10 ** digits)
        : "";
  return (
    <Field label={currency ? `${label}, in ${currency}` : label}>
      {(id) => (
        <input
          id={id}
          className={input}
          type="number"
          inputMode="numeric"
          step={1}
          min={0}
          value={shown}
          onChange={(e) => {
            const typed = e.target.value.trim();
            if (typed === "") return onChange(undefined);
            onChange(/^\d+$/.test(typed) ? Number(typed) * 10 ** digits : typed);
          }}
        />
      )}
    </Field>
  );
}

function TermFields({ g, set }: { g: Obj; set: (next: Obj) => void }) {
  const mode = g.endsOn === null ? "season" : typeof g.endsOn === "string" ? "date" : g.lengthMoons !== undefined ? "moons" : "";
  return (
    <>
      <Field label="How it ends">
        {(id) => (
          <select
            id={id}
            className={input}
            value={mode}
            onChange={(e) => {
              const v = e.target.value;
              let next = put(put(g, "endsOn", undefined), "lengthMoons", undefined);
              if (v === "season") next = { ...next, endsOn: null };
              if (v === "date") next = { ...next, endsOn: "" };
              if (v === "moons") next = { ...next, lengthMoons: 3 };
              set(next);
            }}
          >
            <option value="">Not set</option>
            <option value="season">When the season ends</option>
            <option value="date">On a date</option>
            <option value="moons">After a number of moons</option>
          </select>
        )}
      </Field>
      {mode === "date" && <DateBox label="Ends on" value={g.endsOn} onChange={(v) => set({ ...g, endsOn: v ?? "" })} />}
      {mode === "moons" && <Whole label="Moons from seating" min={1} max={LIMITS.lengthMoons} value={g.lengthMoons} onChange={(v) => set(put(g, "lengthMoons", v))} />}
      <Whole label="Notice, in days" max={LIMITS.noticeDays} value={g.noticeDays} onChange={(v) => set(put(g, "noticeDays", v))} />
      <DateBox label="Review on" value={g.reviewOn} onChange={(v) => set(put(g, "reviewOn", v))} />
      <DateBox label="Renewal on" value={g.renewalOn} onChange={(v) => set(put(g, "renewalOn", v))} />
    </>
  );
}

function RhythmFields({ g, set }: { g: Obj; set: (next: Obj) => void }) {
  const gatherings: Obj[] = Array.isArray(g.gatherings) ? g.gatherings : [];
  const quiet: number[] = Array.isArray(g.quietDays) ? g.quietDays : [];
  const setRow = (i: number, row: Obj) => set({ ...g, gatherings: gatherings.map((x, j) => (j === i ? row : x)) });
  return (
    <>
      <div className="space-y-3 sm:col-span-2">
        {gatherings.map((row, i) => (
          <fieldset key={i} className="grid gap-2 rounded-lg border border-stone-200 p-3 sm:grid-cols-2">
            <legend className="px-1 text-xs font-semibold text-stone-700">Gathering {i + 1}</legend>
            <Words label="Name" max={LIMITS.labelChars} wide={false} value={row.label} onChange={(v) => setRow(i, put(row, "label", v))} />
            <Field label="Day">
              {(id) => (
                <select id={id} className={input} value={row.weekday === undefined ? "" : String(row.weekday)} onChange={(e) => setRow(i, put(row, "weekday", wholeFrom(e.target.value)))}>
                  <option value="">Pick a day</option>
                  {WEEKDAYS.map((d, n) => (
                    <option key={d} value={n}>
                      {d}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <Field label="Time">
              {(id) => <input id={id} className={input} type="time" value={String(row.time ?? "")} onChange={(e) => setRow(i, put(row, "time", e.target.value))} />}
            </Field>
            <Choice label="How often" value={row.every} options={GATHERING_EVERY} blank={null} onChange={(v) => setRow(i, put(row, "every", v))} />
            <div className="sm:col-span-2">
              <button type="button" className={smallButton} onClick={() => set({ ...g, gatherings: gatherings.filter((_, j) => j !== i) })}>
                <X className="size-4" aria-hidden="true" />
                Remove this gathering
              </button>
            </div>
          </fieldset>
        ))}
        <button
          type="button"
          className={smallButton}
          disabled={gatherings.length >= LIMITS.gatherings}
          onClick={() => set({ ...g, gatherings: [...gatherings, { label: "", weekday: 1, time: "10:00", every: "week" }] })}
        >
          <Plus className="size-4" aria-hidden="true" />
          Add a gathering
        </button>
      </div>
      <fieldset className="sm:col-span-2">
        <legend className={labelClass}>Quiet days</legend>
        <div className="mt-1 flex flex-wrap gap-2">
          {WEEKDAYS.map((d, n) => (
            <label key={d} className="inline-flex min-h-[44px] items-center gap-2 rounded-lg border border-stone-200 px-3 text-sm text-stone-800">
              <input
                type="checkbox"
                checked={quiet.includes(n)}
                onChange={(e) => {
                  const days = e.target.checked ? [...quiet, n] : quiet.filter((x) => x !== n);
                  set(put(g, "quietDays", days.length > 0 ? days.sort((a, b) => a - b) : undefined));
                }}
              />
              {d}
            </label>
          ))}
        </div>
      </fieldset>
      <Words label="Time zone (leave empty for the season's own)" max={64} value={g.tz} onChange={(v) => set(put(g, "tz", v))} />
    </>
  );
}

function MoneyFields({ group, g, set }: { group: "pay" | "allowance"; g: Obj; set: (next: Obj) => void }) {
  const kinds = group === "pay" ? PAY_KINDS : ALLOWANCE_KINDS;
  const kind = String(g.kind ?? "");
  const amountKinds = group === "pay" ? ["fixed", "in-kind", "deferred"] : ["flat"];
  return (
    <>
      <Choice label="Kind" value={g.kind} options={kinds} onChange={(v) => set(put(g, "kind", v))} />
      <Words
        label="Currency code"
        max={3}
        wide={false}
        value={g.currency}
        onChange={(v) => set(put(g, "currency", v ? v.toUpperCase() : undefined))}
      />
      {amountKinds.includes(kind) && <Amount label="Amount" minor={g.amountMinor} currency={g.currency} onChange={(v) => set(put(g, "amountMinor", v))} />}
      {group === "pay" && kind === "range" && (
        <>
          <Amount label="Lowest" minor={g.minMinor} currency={g.currency} onChange={(v) => set(put(g, "minMinor", v))} />
          <Amount label="Highest" minor={g.maxMinor} currency={g.currency} onChange={(v) => set(put(g, "maxMinor", v))} />
        </>
      )}
      {kind !== "none" && kind !== "honorary" && kind !== "reimbursed" && (
        <Choice label="Each" value={g.per} options={MONEY_PER} onChange={(v) => set(put(g, "per", v))} />
      )}
      <Words label="Note" area max={LIMITS.noteChars} value={g.note} onChange={(v) => set(put(g, "note", v))} />
    </>
  );
}

function BonusFields({ g, set }: { g: Obj; set: (next: Obj) => void }) {
  return (
    <>
      <Choice label="Kind" value={g.kind} options={BONUS_KINDS} onChange={(v) => set(put(g, "kind", v))} />
      {g.kind === "equity" && (
        <>
          <Words label="The cap, in words" max={LIMITS.wordsChars} value={g.capWords} onChange={(v) => set(put(g, "capWords", v))} />
          <Words label="Rated by" max={LIMITS.wordsChars} value={g.ratedBy} onChange={(v) => set(put(g, "ratedBy", v))} />
          <Words label="How often it is rated" max={LIMITS.wordsChars} value={g.cadence} onChange={(v) => set(put(g, "cadence", v))} />
        </>
      )}
    </>
  );
}

function QuestFields({ g, set }: { g: Obj; set: (next: Obj) => void }) {
  return (
    <>
      <Whole label="Fewest quests a moon" min={1} max={LIMITS.questsPerMoon} value={g.perMoonMin} onChange={(v) => set({ ...put(g, "perMoonMin", v), doneWhenRequired: true })} />
      <Whole label="Most quests a moon" min={1} max={LIMITS.questsPerMoon} value={g.perMoonMax} onChange={(v) => set({ ...put(g, "perMoonMax", v), doneWhenRequired: true })} />
      <Words label="How quests are agreed" max={LIMITS.wordsChars} value={g.agreedHow} onChange={(v) => set({ ...put(g, "agreedHow", v), doneWhenRequired: true })} />
      <p className="text-xs text-stone-600 sm:col-span-2">Every quest has a done when. That part is always on.</p>
    </>
  );
}

function ScoreboardFields({ g, set }: { g: Obj; set: (next: Obj) => void }) {
  const measures: Obj[] = Array.isArray(g.measures) ? g.measures : [];
  const setRow = (i: number, row: Obj) => set({ ...g, measures: measures.map((x, j) => (j === i ? row : x)) });
  return (
    <div className="space-y-3 sm:col-span-2">
      <p className="text-xs text-stone-600">A scoreboard measures the work. It never ranks people.</p>
      {measures.map((row, i) => (
        <fieldset key={i} className="grid gap-2 rounded-lg border border-stone-200 p-3 sm:grid-cols-2">
          <legend className="px-1 text-xs font-semibold text-stone-700">Measure {i + 1}</legend>
          <Words label="What is measured" max={LIMITS.measureChars} value={row.measure} onChange={(v) => setRow(i, put(row, "measure", v))} />
          <Words label="Target, in words" max={LIMITS.measureChars} wide={false} value={row.target} onChange={(v) => setRow(i, put(row, "target", v))} />
          <Words label="Read from" max={LIMITS.measureChars} wide={false} value={row.readFrom} onChange={(v) => setRow(i, put(row, "readFrom", v))} />
          <div className="sm:col-span-2">
            <button type="button" className={smallButton} onClick={() => set({ ...g, measures: measures.filter((_, j) => j !== i) })}>
              <X className="size-4" aria-hidden="true" />
              Remove this measure
            </button>
          </div>
        </fieldset>
      ))}
      <button
        type="button"
        className={smallButton}
        disabled={measures.length >= LIMITS.scoreMeasures}
        onClick={() => set({ ...g, measures: [...measures, { measure: "" }] })}
      >
        <Plus className="size-4" aria-hidden="true" />
        Add a measure
      </button>
    </div>
  );
}

function EndingFields({ g, set }: { g: Obj; set: (next: Obj) => void }) {
  const id = useId();
  return (
    <>
      <Whole label="Notice, in days" max={LIMITS.noticeDays} value={g.noticeDays} onChange={(v) => set(put(g, "noticeDays", v))} />
      <div className="flex items-end">
        <label htmlFor={id} className="inline-flex min-h-[44px] items-center gap-2 text-sm text-stone-800">
          <input id={id} type="checkbox" checked={g.payThroughNotice === true} onChange={(e) => set({ ...g, payThroughNotice: e.target.checked })} />
          Pay runs through the notice
        </label>
      </div>
    </>
  );
}

export default function SeatSettingsFields({
  group,
  settings,
  onChange,
}: {
  group: SettingsGroup;
  settings: SeatSettings;
  onChange: (next: SeatSettings) => void;
}) {
  const g: Obj = ((settings as Obj)[group] as Obj | undefined) ?? (group === "scoreboard" ? { measures: [] } : group === "quests" ? { doneWhenRequired: true } : {});
  const set = (next: Obj) => onChange({ ...settings, [group]: next } as SeatSettings);
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {group === "term" && <TermFields g={g} set={set} />}
      {group === "clocks" && (
        <>
          <Choice label="Money keeps" value={g.pay} options={PAY_CLOCKS} onChange={(v) => set(put(g, "pay", v))} />
          <Choice label="The work keeps" value={g.work} options={WORK_CLOCKS} onChange={(v) => set(put(g, "work", v))} />
        </>
      )}
      {group === "rhythm" && <RhythmFields g={g} set={set} />}
      {(group === "pay" || group === "allowance") && <MoneyFields group={group} g={g} set={set} />}
      {group === "bonus" && <BonusFields g={g} set={set} />}
      {group === "quests" && <QuestFields g={g} set={set} />}
      {group === "scoreboard" && <ScoreboardFields g={g} set={set} />}
      {group === "ending" && <EndingFields g={g} set={set} />}
    </div>
  );
}
