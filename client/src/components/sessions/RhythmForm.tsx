/**
 * THE FORM FOR A CIRCLE'S MEETING RHYTHM: which circle, how often (every one
 * to four weeks on a weekday, at each new or full moon, or once), the day or
 * the date, the time, and how long. Times are the village's own, and the form
 * says whose.
 *
 * The circle is chosen only when setting a new rhythm; changing one keeps its
 * circle. "Stop this rhythm" clears it. Every field reads the room's own
 * sizes (44px), and the words come from shared/sessionRhythm.ts.
 */
import { useState, type FormEvent } from "react";
import { SESSION_LIMITS } from "@shared/sessions";
import { RHYTHM_COPY, WEEKDAYS, type RhythmInput } from "@shared/sessionRhythm";
import { BTN_DANGER_QUIET, BTN_PRIMARY, BTN_QUIET, HINT, INPUT, LABEL, UNDER_BOX } from "./roomUi";

type HowOften = keyof typeof RHYTHM_COPY.howOften;

const HOW_OFTEN: HowOften[] = ["every1", "every2", "every3", "every4", "new_moon", "full_moon", "once"];

function howOftenOf(r: RhythmInput | null): HowOften {
  if (!r || r.kind === "none") return "every1";
  if (r.kind === "weekly") return `every${Math.min(4, Math.max(1, r.everyWeeks))}` as HowOften;
  if (r.kind === "moon") return r.on;
  return "once";
}

export interface RhythmFormProps {
  idBase: string;
  /** The circles this person may set a rhythm for. */
  circles: { id: string; name: string }[];
  /** Changing an existing rhythm: its circle, fixed, and the rhythm as it is. */
  fixedCircleId?: string;
  initial?: RhythmInput | null;
  defaultMinutes: number | null;
  zone: string;
  busy: boolean;
  error: string | null;
  onSubmit(circleId: string, input: RhythmInput): void;
  onCancel(): void;
}

export default function RhythmForm({ idBase, circles, fixedCircleId, initial, defaultMinutes, zone, busy, error, onSubmit, onCancel }: RhythmFormProps) {
  const [circleId, setCircleId] = useState(fixedCircleId ?? (circles.length === 1 ? circles[0].id : ""));
  const [howOften, setHowOften] = useState<HowOften>(howOftenOf(initial ?? null));
  const [weekday, setWeekday] = useState(initial && initial.kind === "weekly" ? initial.weekday : 4);
  const [startsOn, setStartsOn] = useState("");
  const [on, setOn] = useState(initial && initial.kind === "once" ? initial.on : "");
  const [time, setTime] = useState(initial && initial.kind !== "none" ? initial.time : "18:00");
  const [minutes, setMinutes] = useState(String(initial && initial.kind !== "none" ? (initial.durationMin ?? "") : (defaultMinutes ?? SESSION_LIMITS.durationDefault)));

  const weekly = howOften.startsWith("every");
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!circleId || busy) return;
    const durationMin = Number(minutes) || undefined;
    let input: RhythmInput;
    if (weekly) input = { kind: "weekly", weekday, everyWeeks: Number(howOften.slice(5)), time, ...(startsOn ? { startsOn } : {}), durationMin };
    else if (howOften === "once") input = { kind: "once", on, time, durationMin };
    else input = { kind: "moon", on: howOften as "new_moon" | "full_moon", time, durationMin };
    onSubmit(circleId, input);
  };

  return (
    <form className="space-y-4" onSubmit={submit} noValidate>
      {!fixedCircleId && (
        <div>
          <label htmlFor={`${idBase}-circle`} className={LABEL}>
            {RHYTHM_COPY.circleLabel}
          </label>
          <select id={`${idBase}-circle`} className={`mt-1 ${INPUT}`} value={circleId} onChange={(e) => setCircleId(e.target.value)}>
            <option value="" disabled>
              {RHYTHM_COPY.circleChoose}
            </option>
            {circles.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
      )}
      <div>
        <label htmlFor={`${idBase}-often`} className={LABEL}>
          {RHYTHM_COPY.howOftenLabel}
        </label>
        <select id={`${idBase}-often`} className={`mt-1 ${INPUT}`} value={howOften} onChange={(e) => setHowOften(e.target.value as HowOften)}>
          {HOW_OFTEN.map((h) => (
            <option key={h} value={h}>
              {RHYTHM_COPY.howOften[h]}
            </option>
          ))}
        </select>
      </div>
      {weekly && (
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor={`${idBase}-weekday`} className={LABEL}>
              {RHYTHM_COPY.weekdayLabel}
            </label>
            <select id={`${idBase}-weekday`} className={`mt-1 ${INPUT}`} value={weekday} onChange={(e) => setWeekday(Number(e.target.value))}>
              {WEEKDAYS.map((d, i) => (
                <option key={d} value={i}>
                  {d}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor={`${idBase}-from`} className={LABEL}>
              {RHYTHM_COPY.startsOnLabel}
            </label>
            <input id={`${idBase}-from`} type="date" className={`mt-1 ${INPUT}`} value={startsOn} onChange={(e) => setStartsOn(e.target.value)} />
          </div>
        </div>
      )}
      {howOften === "once" && (
        <div>
          <label htmlFor={`${idBase}-on`} className={LABEL}>
            {RHYTHM_COPY.onLabel}
          </label>
          <input id={`${idBase}-on`} type="date" className={`mt-1 ${INPUT}`} value={on} onChange={(e) => setOn(e.target.value)} />
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor={`${idBase}-time`} className={LABEL}>
            {RHYTHM_COPY.timeLabel}
          </label>
          <input id={`${idBase}-time`} type="time" className={`mt-1 ${INPUT}`} value={time} onChange={(e) => setTime(e.target.value)} />
        </div>
        <div>
          <label htmlFor={`${idBase}-length`} className={LABEL}>
            {RHYTHM_COPY.durationLabel}
          </label>
          <input
            id={`${idBase}-length`}
            type="number"
            inputMode="numeric"
            min={SESSION_LIMITS.durationMin}
            max={SESSION_LIMITS.durationMax}
            className={`mt-1 ${INPUT}`}
            value={minutes}
            onChange={(e) => setMinutes(e.target.value)}
          />
        </div>
      </div>
      <p className={HINT}>{RHYTHM_COPY.zoneHint(zone)}</p>
      {error && (
        <p role="alert" className="text-sm font-medium text-destructive">
          {error}
        </p>
      )}
      <div className={UNDER_BOX}>
        <button type="submit" className={BTN_PRIMARY} disabled={busy || !circleId}>
          {busy ? RHYTHM_COPY.saving : RHYTHM_COPY.save}
        </button>
        <button type="button" className={BTN_QUIET} onClick={onCancel}>
          {RHYTHM_COPY.cancel}
        </button>
        {fixedCircleId && (
          <button type="button" className={BTN_DANGER_QUIET} disabled={busy} onClick={() => onSubmit(fixedCircleId, { kind: "none" })}>
            {RHYTHM_COPY.clear}
          </button>
        )}
      </div>
    </form>
  );
}
