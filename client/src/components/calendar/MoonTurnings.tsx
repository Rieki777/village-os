/**
 * THIS MOON'S TURNINGS (Phase C, decision 3): the new moon that opens it, the
 * full moon at its middle, and the new moon that opens the next one. Each is a
 * door to its day on the spiral. The sky names these days; nothing here is a
 * countdown, only dates.
 */
import { useLingui } from "@lingui/react/macro";
import { litPath } from "@/components/natural/moonGeometry";
import { CARD } from "@/components/journey/look";
import type { CivilDay } from "./calendarTime";
import type { MoonOfDays } from "./moonSpiral";

export interface MoonTurningsProps {
  moon: MoonOfDays;
  /** Turns a YYYY-MM-DD key into the civil day the page can select. */
  dayFor: (key: string) => CivilDay;
  onSelect: (day: CivilDay) => void;
  /** "Tuesday 24 November", in the reader's language. */
  dayName: (day: CivilDay) => string;
  className?: string;
}

/** A small moon at an illuminated fraction, for a turning's row. */
function Disc({ fraction }: { fraction: number }) {
  const d = fraction > 0.005 ? litPath({ cx: 14, cy: 14, r: 11, fraction, side: "right" }) : "";
  return (
    <svg viewBox="0 0 28 28" className="size-7 shrink-0" aria-hidden="true">
      <circle cx={14} cy={14} r={11} className="text-muted" fill="currentColor" />
      {d && <path d={d} className="text-foreground" fill="currentColor" fillOpacity={0.92} />}
      <circle cx={14} cy={14} r={11} className="text-border" fill="none" stroke="currentColor" strokeWidth={1} />
    </svg>
  );
}

export default function MoonTurnings({ moon, dayFor, onSelect, dayName, className = "" }: MoonTurningsProps) {
  const { t } = useLingui();
  const rows: Array<{ key: string; title: string; fraction: number }> = [
    { key: moon.newMoonKey, title: t({ message: "New moon, this moon opens", context: "calendar turnings" }), fraction: 0 },
  ];
  if (moon.fullMoonKey) rows.push({ key: moon.fullMoonKey, title: t({ message: "Full moon", context: "calendar turnings" }), fraction: 1 });
  rows.push({ key: moon.nextNewMoonKey, title: t({ message: "New moon, the next moon opens", context: "calendar turnings" }), fraction: 0 });

  return (
    <section className={`${CARD} ${className}`.trim()} aria-labelledby="moon-turnings-h" data-testid="moon-turnings">
      <p id="moon-turnings-h" className="text-xs font-semibold uppercase tracking-widest text-open">
        {t({ message: "This moon's turnings", context: "calendar turnings heading" })}
      </p>
      <ul className="mt-3 space-y-1">
        {rows.map((r) => {
          const day = dayFor(r.key);
          return (
            <li key={`${r.title}-${r.key}`}>
              <button
                type="button"
                onClick={() => onSelect(day)}
                className="jw-btn flex min-h-11 w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left hover:bg-muted"
              >
                <Disc fraction={r.fraction} />
                <span className="min-w-0">
                  <span className="block text-foreground">{r.title}</span>
                  <span className="block text-sm text-muted-foreground">{dayName(day)}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
