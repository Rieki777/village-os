/**
 * THE SHEET ONE ANSWER OPENS: It's done, Not yet, Let go, Hand it back, I'll
 * take it, Open it again.
 *
 * One tap on a card opens it, and one tap on its confirm button sends. On
 * a phone it rises from the bottom of the screen, where the thumb already is;
 * from `md` up it is a dialog in the middle. Both are the same Radix dialog
 * underneath, so focus is held inside while it is open and returns to the
 * button that opened it. Both portal to <body>, outside the `.sheet-night`
 * wrapper of the page that opened them, so each panel takes `sheet-night`
 * itself: the profile's board and the open room are night surfaces, and the
 * sheet reads as part of them.
 *
 * Every word comes from `TASK_COPY.sheets[op]`. A null field there is not
 * drawn, so the sheet for I'll take it is only its question and its button.
 *
 * The confirm button stays off until the answer is one the server takes: Let
 * go needs a sentence, Not yet needs a date after today. The sentence box is
 * the room's own growing box, so a long line stays readable while it is typed.
 */
import { useId, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import GrowingText from "@/components/sessions/GrowingText";
import { BTN_PRIMARY, BTN_QUIET, CHIP, HINT, INPUT, LABEL, UNDER_BOX, tile } from "@/components/sessions/roomUi";
import { TASK_COPY, TASK_NOTE_MAX, addCivilDays, taskDateWords, type TaskCard, type TaskOp } from "@shared/sessionTasks";
import { chipDates, isAfterToday } from "./dateWords";
import { useTaskAnswer } from "./useTaskAnswer";

export interface TaskAnswerSheetProps {
  task: TaskCard;
  op: TaskOp;
  /** Village-local YYYY-MM-DD, from the payload that drew the card. */
  today: string;
  /** The card the server handed back: after the answer landed, or after someone else's answer got there first. */
  onDone(t: TaskCard): void;
  onClose(): void;
}

/** From `md` up the sheet is a dialog. Read once, so it never swaps shape under a finger. */
function wideScreen(): boolean {
  try {
    return typeof window !== "undefined" && !!window.matchMedia?.("(min-width: 768px)").matches;
  } catch {
    return false;
  }
}

const CHIP_KEYS = ["thisFriday", "nextWeek", "nextNewMoon", "nextFullMoon"] as const;

export default function TaskAnswerSheet({ task, op, today, onDone, onClose }: TaskAnswerSheetProps) {
  const copy = TASK_COPY.sheets[op];
  const [wide] = useState(wideScreen);
  const [chips] = useState(() => chipDates(today));
  const [note, setNote] = useState("");
  const [dueOn, setDueOn] = useState("");
  const { send, busy, error } = useTaskAnswer();
  const ids = useId();
  const hintId = `${ids}-hint`;
  const dateId = `${ids}-date`;
  const errorId = `${ids}-error`;

  const needsDate = !!copy.datePrompt;
  const ready = (!copy.noteRequired || note.trim().length > 0) && (!needsDate || isAfterToday(dueOn, today));

  const confirm = async () => {
    if (!ready || busy) return;
    const outcome = await send(task, op, {
      ...(needsDate ? { dueOn } : {}),
      ...(copy.notePrompt ? { note } : {}),
    });
    if (outcome.kind === "ok" || outcome.kind === "moved") onDone(outcome.task);
  };

  const body = (
    <div className="space-y-5">
      {copy.lede && <p className="text-base leading-relaxed text-foreground">{copy.lede}</p>}

      {needsDate && (
        <fieldset className="space-y-3">
          <legend className={LABEL}>{copy.datePrompt}</legend>
          <div className="flex flex-wrap gap-2">
            {CHIP_KEYS.map((key) => {
              const date = chips[key];
              if (!date) return null;
              const on = dueOn === date;
              return (
                <button
                  key={key}
                  type="button"
                  aria-pressed={on}
                  aria-label={`${TASK_COPY.dateChips[key]}, ${taskDateWords(date, today)}`}
                  className={tile(on)}
                  onClick={() => setDueOn(date)}
                >
                  {TASK_COPY.dateChips[key]}
                </button>
              );
            })}
          </div>
          <div>
            <label htmlFor={dateId} className={HINT}>
              {TASK_COPY.datePick}
            </label>
            <input
              id={dateId}
              type="date"
              min={addCivilDays(today, 1)}
              value={dueOn}
              onChange={(e) => setDueOn(e.target.value)}
              className={`${INPUT} mt-1 max-w-[16rem]`}
            />
          </div>
          {isAfterToday(dueOn, today) && (
            <p className={CHIP} aria-live="polite">
              {TASK_COPY.newDate(taskDateWords(dueOn, today))}
            </p>
          )}
        </fieldset>
      )}

      {copy.notePrompt && (
        <div className="space-y-2">
          <GrowingText
            value={note}
            onValue={setNote}
            onSubmit={() => void confirm()}
            label={copy.notePrompt}
            max={TASK_NOTE_MAX}
            singleLine
            minRows={2}
            describedBy={copy.hint ? hintId : undefined}
            autoFocus={!needsDate}
          />
          {copy.hint && (
            <p id={hintId} className={HINT}>
              {copy.hint}
            </p>
          )}
        </div>
      )}

      {error && (
        <p id={errorId} role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      <div className={`${UNDER_BOX} justify-end`}>
        <button type="button" className={BTN_QUIET} onClick={onClose} disabled={busy}>
          {TASK_COPY.cancel}
        </button>
        <button
          type="button"
          className={BTN_PRIMARY}
          disabled={!ready || busy}
          aria-describedby={error ? errorId : undefined}
          onClick={() => void confirm()}
        >
          {copy.confirm}
        </button>
      </div>
    </div>
  );

  // The task's own words are the description, so a screen reader hears which
  // task this answer is for the moment the sheet opens.
  const title = TASK_COPY.buttons[op];
  const onOpenChange = (open: boolean) => {
    if (!open && !busy) onClose();
  };

  if (wide) {
    return (
      <Dialog open onOpenChange={onOpenChange}>
        <DialogContent className="sheet-night max-h-[90vh] overflow-y-auto rounded-2xl border-border bg-card p-6 text-card-foreground sm:max-w-lg">
          <DialogTitle className="font-display text-2xl font-normal text-foreground">{title}</DialogTitle>
          <DialogDescription className="text-base text-muted-foreground">{task.text}</DialogDescription>
          {body}
        </DialogContent>
      </Dialog>
    );
  }
  return (
    <Sheet open onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="sheet-night max-h-[90vh] overflow-y-auto rounded-t-2xl border-border bg-card px-4 pt-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] text-card-foreground">
        <SheetTitle className="font-display text-2xl font-normal text-foreground">{title}</SheetTitle>
        <SheetDescription className="text-base text-muted-foreground">{task.text}</SheetDescription>
        {body}
      </SheetContent>
    </Sheet>
  );
}
