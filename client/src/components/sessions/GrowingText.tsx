/**
 * THE GROWING TEXT BOX, used for every sentence anybody writes in the room.
 *
 * Rye's first call in the room found the boxes too small to see what he was
 * typing: the action box squeezed to one visible letter, a note cut off after
 * a line. So every box here is full width and grows with its words, up to a
 * height that still leaves the room on screen (roomUi's TEXTBOX_MAX), and
 * scrolls from there.
 *
 * A sessions-owned sibling of the journal's GrowingTextarea, which keeps the
 * journal's look and has no cap. This one wears the room's TEXTBOX, carries a
 * cap the server also enforces, and speaks the room's keys:
 *
 *   Enter          calls `onSubmit`, unless an input method is composing
 *   Shift+Enter    a new line, or nothing at all in a one-line box
 *   Escape         calls `onCancel`
 *
 * A one-line box (`singleLine`) also turns any line break that arrives by
 * paste or by voice into a space, so a sentence stays one sentence.
 *
 * The counter shows "n of max" while the box has focus, and stays once the
 * words pass three quarters of the cap, so nobody is cut off by surprise.
 *
 * `label` is both the placeholder and the accessible name, so a box is found
 * by its words the same way a sighted reader finds it. With `mic`, the voice
 * button sits beside the box and each finished phrase is added to the end.
 */
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import MicButton from "@/components/MicButton";
import { appendSpoken } from "@/components/journal/GrowingTextarea";
import { ROOM_COPY } from "@shared/sessions";
import { COUNTER, TEXTBOX, TEXTBOX_MAX } from "./roomUi";

export interface GrowingTextProps {
  value: string;
  onValue(next: string): void;
  /** Enter (without Shift, not composing) */
  onSubmit?(): void;
  /** Escape */
  onCancel?(): void;
  /** Shown as placeholder AND aria-label, so tests still find boxes by placeholder. */
  label: string;
  /** maxLength and the counter */
  max: number;
  /** default 2 */
  minRows?: number;
  /** strips newlines on input, Shift+Enter does nothing */
  singleLine?: boolean;
  /** MicButton beside the box, appending with appendSpoken */
  mic?: boolean;
  id?: string;
  autoFocus?: boolean;
  disabled?: boolean;
  describedBy?: string;
}

const oneLine = (text: string) => text.replace(/\r?\n|\r/g, " ");

export default function GrowingText({
  value,
  onValue,
  onSubmit,
  onCancel,
  label,
  max,
  minRows = 2,
  singleLine = false,
  mic = false,
  id,
  autoFocus = false,
  disabled = false,
  describedBy,
}: GrowingTextProps) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [focused, setFocused] = useState(false);

  // Grow with the words: measure from nothing each time, so it shrinks too.
  // Past the cap the stylesheet's max height takes over and the box scrolls.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight + 2}px`;
  }, [value]);

  // An editor that opens on its words puts the caret after them, ready to go on.
  useEffect(() => {
    const el = ref.current;
    if (!autoFocus || !el) return;
    el.focus();
    const end = el.value.length;
    el.setSelectionRange(end, end);
    // Only on the first mount: a later render must never move the caret.
  }, []);

  const set = (next: string) => onValue((singleLine ? oneLine(next) : next).slice(0, max));

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Escape") {
      if (onCancel) {
        e.preventDefault();
        onCancel();
      }
      return;
    }
    if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
    if (e.shiftKey) {
      // A new line, except in a box that holds one.
      if (singleLine) e.preventDefault();
      return;
    }
    if (onSubmit) {
      e.preventDefault();
      onSubmit();
    } else if (singleLine) {
      e.preventDefault();
    }
  };

  const showCount = focused || value.length >= 0.75 * max;

  const box = (
    <div className="min-w-0 flex-1">
      <textarea
        ref={ref}
        id={id}
        rows={minRows}
        value={value}
        maxLength={max}
        placeholder={label}
        aria-label={label}
        aria-describedby={describedBy}
        disabled={disabled}
        onChange={(e) => set(e.target.value)}
        onKeyDown={onKeyDown}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        className={`${TEXTBOX} ${TEXTBOX_MAX}`}
      />
      {showCount && (
        <p className={`${COUNTER} mt-1 text-right`} aria-hidden={!focused}>
          {ROOM_COPY.countOf(value.length, max)}
        </p>
      )}
    </div>
  );

  if (!mic) return box;
  return (
    <div className="flex items-start gap-2">
      {box}
      <MicButton onText={(chunk) => set(appendSpoken(value, chunk))} disabled={disabled} />
    </div>
  );
}
