/**
 * A sentence box that wraps and grows with what is typed.
 *
 * A single-line input cuts a sentence off at the edge of the screen. This
 * stays at least 44px tall, wraps long words, and grows to the text.
 */
import { useLayoutEffect, useRef, type TextareaHTMLAttributes } from "react";

export default function GrowingField({
  value,
  onChange,
  minRows = 2,
  className = "",
  ...rest
}: Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "value" | "onChange"> & {
  value: string;
  onChange: (value: string) => void;
  minRows?: number;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);
  return (
    <textarea
      ref={ref}
      rows={minRows}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`min-h-[44px] w-full max-w-full resize-none overflow-hidden whitespace-pre-wrap break-words ${className}`}
      {...rest}
    />
  );
}
