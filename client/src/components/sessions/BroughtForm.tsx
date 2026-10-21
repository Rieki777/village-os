/**
 * THE FORM FOR BRINGING AN ITEM, and for changing one that waits. The room's
 * own add form (AgendaList's ItemFields) without the minutes, because the
 * minutes come from the aim and the room changes them as it likes: the title in
 * the room's growing box, the aim with its one-line hint, an optional note, and
 * the circle it is for.
 *
 * THE CIRCLE MUST BE ANSWERED. It starts on "Choose a circle", or on the one
 * circle the member has standing in when there is exactly one, and "No circle
 * in particular" is the last choice. An item for no circle is offered to every
 * circle's next session, so it is a choice, never a default somebody skipped
 * past. When the circle is not this person's to change (a host rewording
 * somebody else's item), the select shows it and stays still.
 *
 * Enter in the title saves; Escape puts the form away. Words come from
 * shared/sessionLibrary.ts.
 */
import { useState, type FormEvent } from "react";
import { AIM_DEFS, cleanLine, type ItemAim } from "@shared/sessions";
import { LIBRARY_AIMS, LIBRARY_COPY, LIBRARY_LIMITS } from "@shared/sessionLibrary";
import GrowingText from "./GrowingText";
import { BTN_PRIMARY, BTN_QUIET, HINT, INPUT, LABEL, UNDER_BOX } from "./roomUi";

/** The value the circle select sends for "No circle in particular". "" is "not chosen yet". */
const NO_CIRCLE = "none";

export interface BroughtValues {
  title: string;
  aim: ItemAim | null;
  note: string | null;
  circleId: string | null;
}

export interface BroughtFormProps {
  idBase: string;
  circles: { id: string; name: string }[];
  /** The circles the member has standing in: one of them alone is chosen for them. */
  myCircleIds: readonly string[];
  /** Absent: a new item. */
  initial?: BroughtValues;
  /** The circle is shown and cannot be changed by this person. */
  circleLocked?: boolean;
  busy: boolean;
  error: string | null;
  onSubmit(values: BroughtValues): void;
  onCancel(): void;
}

export default function BroughtForm({ idBase, circles, myCircleIds, initial, circleLocked, busy, error, onSubmit, onCancel }: BroughtFormProps) {
  const adding = !initial;
  const only = myCircleIds.filter((id) => circles.some((c) => c.id === id));
  const [title, setTitle] = useState(initial?.title ?? "");
  const [aim, setAim] = useState<ItemAim | "">(initial?.aim ?? "");
  const [note, setNote] = useState(initial?.note ?? "");
  const [circle, setCircle] = useState<string>(initial ? (initial.circleId ?? NO_CIRCLE) : only.length === 1 ? only[0] : "");
  const [asked, setAsked] = useState(false);

  const clean = cleanLine(title, LIBRARY_LIMITS.title);
  const circleMissing = circle === "";
  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    setAsked(true);
    if (!clean || circleMissing || busy) return;
    onSubmit({ title: clean, aim: aim || null, note: note.trim() ? note : null, circleId: circle === NO_CIRCLE ? null : circle });
  };

  return (
    <form className="space-y-4" onSubmit={submit} noValidate>
      <div>
        <label htmlFor={`${idBase}-title`} className={LABEL}>
          {LIBRARY_COPY.titleLabel}
        </label>
        <div className="mt-1">
          <GrowingText
            id={`${idBase}-title`}
            value={title}
            onValue={setTitle}
            onSubmit={() => submit()}
            onCancel={onCancel}
            label={LIBRARY_COPY.titlePlaceholder}
            max={LIBRARY_LIMITS.title}
            minRows={1}
            singleLine
            mic
            autoFocus
          />
        </div>
      </div>
      <div>
        <label htmlFor={`${idBase}-aim`} className={LABEL}>
          {LIBRARY_COPY.aimLabel}
        </label>
        <select id={`${idBase}-aim`} className={`mt-1 ${INPUT}`} value={aim} onChange={(e) => setAim(e.target.value as ItemAim | "")}>
          <option value="">{LIBRARY_COPY.aimNotSure}</option>
          {LIBRARY_AIMS.map((a) => (
            <option key={a} value={a}>
              {AIM_DEFS[a].label}
            </option>
          ))}
        </select>
        <p className={`${HINT} mt-1`}>{aim ? AIM_DEFS[aim].hint : LIBRARY_COPY.aimNotSureHint}</p>
      </div>
      <div>
        <label htmlFor={`${idBase}-note`} className={LABEL}>
          {LIBRARY_COPY.noteLabel}
        </label>
        <div className="mt-1">
          <GrowingText
            id={`${idBase}-note`}
            value={note}
            onValue={setNote}
            onCancel={onCancel}
            label={LIBRARY_COPY.notePlaceholder}
            max={LIBRARY_LIMITS.note}
            minRows={2}
            mic
          />
        </div>
      </div>
      <div>
        <label htmlFor={`${idBase}-circle`} className={LABEL}>
          {LIBRARY_COPY.circleLabel}
        </label>
        <select
          id={`${idBase}-circle`}
          className={`mt-1 ${INPUT}`}
          value={circle}
          disabled={circleLocked}
          aria-invalid={asked && circleMissing ? true : undefined}
          onChange={(e) => setCircle(e.target.value)}
        >
          <option value="" disabled>
            {LIBRARY_COPY.circleChoose}
          </option>
          {circles.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
          <option value={NO_CIRCLE}>{LIBRARY_COPY.noCircle}</option>
        </select>
        <p className={`${HINT} mt-1`}>{LIBRARY_COPY.seenHint}</p>
      </div>
      {(error || (asked && circleMissing)) && (
        <p role="alert" className="text-sm font-medium text-destructive">
          {error ?? LIBRARY_COPY.circleNeeded}
        </p>
      )}
      <div className={UNDER_BOX}>
        <button type="submit" className={BTN_PRIMARY} disabled={busy || !clean}>
          {busy ? (adding ? LIBRARY_COPY.adding : LIBRARY_COPY.saving) : adding ? LIBRARY_COPY.addButton : LIBRARY_COPY.save}
        </button>
        <button type="button" className={BTN_QUIET} onClick={onCancel}>
          {LIBRARY_COPY.cancel}
        </button>
      </div>
    </form>
  );
}
