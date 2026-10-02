/**
 * A textarea that grows with what is written in it, with the voice button
 * beside it. Each finished spoken phrase is appended to the text; where the
 * browser cannot listen, MicButton renders nothing and typing works as ever.
 */
import { useLayoutEffect, useRef, type TextareaHTMLAttributes } from "react";
import MicButton from "@/components/MicButton";
import { INPUT } from "./ui";

/** Add a spoken phrase to the end of what is already written. */
export function appendSpoken(text: string, chunk: string): string {
  const said = chunk.trim();
  if (!said) return text;
  if (!text.trim()) return said;
  return /\s$/.test(text) ? `${text}${said}` : `${text} ${said}`;
}

export default function GrowingTextarea({
  value,
  onValue,
  minRows = 3,
  mic = true,
  className = "",
  ...rest
}: Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "value" | "onChange"> & {
  value: string;
  onValue: (next: string) => void;
  minRows?: number;
  mic?: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight + 2}px`;
  }, [value]);

  return (
    <div className="flex items-start gap-2">
      <textarea
        ref={ref}
        rows={minRows}
        value={value}
        onChange={(e) => onValue(e.target.value)}
        className={`${INPUT} resize-none overflow-hidden text-base leading-relaxed ${className}`}
        {...rest}
      />
      {mic && <MicButton onText={(chunk) => onValue(appendSpoken(value, chunk))} />}
    </div>
  );
}
