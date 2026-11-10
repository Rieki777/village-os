/**
 * A sentence box that wraps and grows with what is typed.
 *
 * A single-line input cuts a sentence off at the edge of the screen. This
 * stays at least 44px tall, wraps long words, and grows to the text.
 */
import { useLayoutEffect, useRef, type TextareaHTMLAttributes } from "react";
import MicButton from "@/components/MicButton";
import { appendSpoken } from "@/components/journal/GrowingTextarea";

export default function GrowingField({
  value,
  onChange,
  minRows = 2,
  className = "",
  mic = true,
  ...rest
}: Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "value" | "onChange"> & {
  value: string;
  onChange: (value: string) => void;
  minRows?: number;
  /** The voice button in the box's corner (MicButton; the browser's own speech engine). On unless the page says otherwise. */
  mic?: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);
  const box = (
    <textarea
      ref={ref}
      rows={minRows}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`min-h-[44px] w-full max-w-full resize-none overflow-hidden whitespace-pre-wrap break-words ${mic ? "pr-12" : ""} ${className}`}
      {...rest}
    />
  );
  if (!mic) return box;
  return (
    <div className="relative">
      {box}
      <MicButton className="absolute bottom-1 right-1" disabled={rest.disabled} onText={(chunk) => onChange(appendSpoken(value, chunk))} />
    </div>
  );
}
