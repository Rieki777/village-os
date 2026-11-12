/**
 * THE STRIP OF DAYS under the moon spiral (Phase C, decision 3): every day of
 * this moon as a stone the thumb swipes along, the chosen day held in view.
 *
 * It is the phone's way along the moon: one row, scroll-snapped, each stone a
 * 44px target or larger. A day a gathering falls on wears the same gold edge
 * as its seed on the spiral, today is filled gold, and the full moon carries
 * a small full moon. On a desktop the arrow keys on the spiral do this work,
 * so the page shows the strip only below the desktop breakpoint.
 */
import { useEffect, useRef } from "react";
import { useLingui } from "@lingui/react/macro";
import { prefersReducedMotion } from "@/components/natural/useReducedMotion";
import type { CivilDay } from "./calendarTime";
import type { MoonDay } from "./moonSpiral";

export interface DayStripProps {
  days: MoonDay[];
  selectedKey: string | null;
  onSelect: (day: CivilDay) => void;
  /** "Wed", in the reader's language. */
  weekdayShort: (day: CivilDay) => string;
  /** "Wednesday 11 November", for the screen reader. */
  dayName: (day: CivilDay) => string;
  className?: string;
}

export default function DayStrip({ days, selectedKey, onSelect, weekdayShort, dayName, className = "" }: DayStripProps) {
  const { t } = useLingui();
  const row = useRef<HTMLDivElement>(null);

  // Keep the chosen stone in view by moving the row only, never the page.
  useEffect(() => {
    const el = row.current;
    if (!el || !selectedKey) return;
    const btn = el.querySelector<HTMLElement>(`[data-day="${selectedKey}"]`);
    if (!btn) return;
    const left = btn.offsetLeft - (el.clientWidth - btn.offsetWidth) / 2;
    if (typeof el.scrollTo === "function") el.scrollTo({ left: Math.max(0, left), behavior: prefersReducedMotion() ? "auto" : "smooth" });
    else el.scrollLeft = Math.max(0, left);
  }, [selectedKey, days]);

  return (
    <div
      ref={row}
      role="group"
      aria-label={t({ message: "The days of this moon", context: "calendar day strip" })}
      className={`-mx-4 flex snap-x snap-mandatory gap-2 overflow-x-auto px-4 py-3 [scrollbar-width:none] ${className}`.trim()}
      data-testid="day-strip"
    >
      {days.map((d) => {
        const chosen = d.day.key === selectedKey;
        const edge = d.today
          ? "border-notice bg-notice text-background"
          : chosen
            ? "border-foreground bg-muted text-foreground"
            : d.gathering
              ? "border-notice/70 bg-card text-foreground"
              : "border-border/60 bg-card text-foreground";
        return (
          <button
            key={d.day.key}
            type="button"
            data-day={d.day.key}
            aria-pressed={chosen}
            aria-label={[
              dayName(d.day),
              d.today ? t({ message: "today", context: "calendar day strip: this day is today" }) : "",
              d.fullMoon ? t({ message: "full moon", context: "calendar day strip: a turning" }) : "",
              d.gathering ? t({ message: "a gathering", context: "calendar day strip: what is on a day" }) : "",
            ].filter(Boolean).join(", ")}
            onClick={() => onSelect(d.day)}
            className={`jw-btn relative flex min-h-16 w-14 shrink-0 snap-center flex-col items-center justify-center gap-0.5 rounded-xl border ${edge}`}
          >
            <span className={`text-xs ${d.today ? "" : "text-muted-foreground"}`}>{weekdayShort(d.day)}</span>
            <span className="font-display text-xl leading-none">{d.day.day}</span>
            {d.fullMoon && <span aria-hidden="true" className="absolute right-1.5 top-1.5 size-2 rounded-full bg-foreground" />}
            {d.marked && !d.today && <span aria-hidden="true" className="absolute bottom-1.5 size-1 rounded-full bg-notice" />}
          </button>
        );
      })}
    </div>
  );
}
