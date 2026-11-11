/**
 * THE DECISION, WITHIN THUMB REACH (nightly rehearsal, 11 Nov 2026).
 *
 * On a phone the steward reads a whole proposal before the card that holds
 * Adopt and Decline: the rehearsal measured that row about seven screens below
 * where a person arrives. This keeps the SAME buttons pinned to the bottom of
 * the screen, above the member tab bar, in the save bar's look, until the
 * person scrolls down to the card. Then the row rests in its own place in the
 * card, where the note and anything still waiting sit just above it.
 *
 * One set of buttons, never a copy: the row is the card's own row, so tab
 * order, screen readers and every disabled rule stay exactly as the card has
 * them. A slot keeps the row's height while it floats, so nothing jumps.
 *
 * It never floats:
 * - on a desktop (768px and wider), where the card sits beside a wider read;
 * - while changes on the page wait to be saved, because the save bar owns the
 *   bottom of the screen then, and the terms should be saved before deciding;
 * - once the card has been scrolled past;
 * - where IntersectionObserver is missing (tests, old browsers): the row
 *   simply stays in the card.
 */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { bottomBarHeight } from "@/components/SaveBar";
import { useUnsavedTotal } from "@/lib/unsavedChanges";

const PHONE = "(max-width: 767px)";

export default function DecideDock({ label, note, children }: {
  /** Words above the floating row, so it says what it is for. */
  label: string;
  /** A line under the label while floating, such as why Adopt waits. */
  note?: ReactNode;
  children: ReactNode;
}) {
  const slot = useRef<HTMLDivElement | null>(null);
  const row = useRef<HTMLDivElement | null>(null);
  const [below, setBelow] = useState(false);
  const [phone, setPhone] = useState(false);
  const [lift, setLift] = useState(0);
  const [height, setHeight] = useState<number | undefined>(undefined);
  const unsaved = useUnsavedTotal();
  const docked = phone && below && unsaved === 0;

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia(PHONE);
    const read = () => setPhone(mq.matches);
    read();
    mq.addEventListener?.("change", read);
    return () => mq.removeEventListener?.("change", read);
  }, []);

  useEffect(() => {
    if (!phone) return;
    const measure = () => setLift(bottomBarHeight());
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [phone]);

  // The slot is "below" while its top is still under the visible part of the
  // screen (the tab bar's strip does not count as visible).
  useEffect(() => {
    const el = slot.current;
    if (!phone || !el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      ([entry]) => setBelow(!entry.isIntersecting && entry.boundingClientRect.top > 0),
      { rootMargin: `0px 0px -${Math.round(lift)}px 0px` },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [phone, lift]);

  // Keep the row's resting height on the slot, measured while it rests.
  useLayoutEffect(() => {
    if (docked || !row.current) return;
    setHeight(row.current.getBoundingClientRect().height);
  });

  return (
    <div ref={slot} data-decide-dock={docked ? "floating" : "resting"} style={docked ? { minHeight: height } : undefined}>
      <div
        ref={row}
        role={docked ? "region" : undefined}
        aria-label={docked ? label : undefined}
        style={docked ? { bottom: lift } : undefined}
        className={docked ? "fixed inset-x-0 z-50 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]" : undefined}
      >
        <div
          style={docked ? { maxWidth: "48rem" } : undefined}
          className={docked ? "mx-auto rounded-2xl border border-border bg-card px-4 py-3 text-card-foreground shadow-sm" : undefined}
        >
          {docked && (
            <div className="mb-2 text-sm">
              <p className="font-medium text-foreground">{label}</p>
              {note && <div className="text-muted-foreground">{note}</div>}
            </div>
          )}
          {children}
        </div>
      </div>
    </div>
  );
}
