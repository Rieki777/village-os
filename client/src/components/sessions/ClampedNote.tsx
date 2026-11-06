/**
 * A NOTE HELD TO THREE LINES, with "Show all" whenever the three lines hide
 * something. Whether they do is read off the rendered box (its scroll height
 * against its height) after layout and again when the window changes size,
 * so a short note of many lines and a long one on a narrow phone both get the
 * toggle, and one that fits never does. Once the toggle has shown it stays,
 * so the note can be closed again after it is opened.
 *
 * Used by the cards on /sessions (WaitingForCircle) and in the room's agenda
 * stage (RoomBrought). Words come from shared/sessionLibrary.ts.
 */
import { useLayoutEffect, useRef, useState } from "react";
import { LIBRARY_COPY } from "@shared/sessionLibrary";
import { BTN_QUIET } from "./roomUi";

export default function ClampedNote({ text }: { text: string }) {
  const [whole, setWhole] = useState(false);
  const [hides, setHides] = useState(false);
  const box = useRef<HTMLParagraphElement>(null);

  useLayoutEffect(() => {
    if (whole) return;
    const measure = () => {
      const el = box.current;
      if (el && el.scrollHeight > el.clientHeight + 1) setHides(true);
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [text, whole]);

  return (
    <div className="mt-2">
      <p ref={box} className={`whitespace-pre-line break-words text-foreground ${whole ? "" : "line-clamp-3"}`}>
        {text}
      </p>
      {hides && (
        <button type="button" className={BTN_QUIET} aria-expanded={whole} onClick={() => setWhole((w) => !w)}>
          {whole ? LIBRARY_COPY.showLess : LIBRARY_COPY.showAll}
        </button>
      )}
    </div>
  );
}
