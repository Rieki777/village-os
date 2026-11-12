/**
 * THE MOON, DRAWN AS A GOLDEN SPIRAL OF DAYS (Phase C, decision 3): the
 * calendar's glance. The new moon sits at the centre with tonight's moon
 * drawn as itself, and each day of the moon is a seed further out along the
 * golden spiral (`moonSpiral.ts` holds the maths and its tests).
 *
 * What each mark means, and nothing else:
 *   - the days already walked this moon are a quiet living green;
 *   - today is filled gold;
 *   - a day a gathering falls on wears a gold ring, a day with anything else
 *     dated on it carries a small dot;
 *   - the full moon is drawn as the full moon.
 * Nothing here is about a person: it shows the moon's days and what is on them.
 *
 * Phone: the spiral is a full-width glance and a tap on a seed opens its day
 * (the strip of days under it is the thumb's main way along). Desktop: the
 * spiral is drawn large with the turning points named beside their seeds; the
 * arrow keys walk the days (across into the next moon at either end), Home and
 * End go to the moon's first and last day, and hovering a seed names it.
 *
 * It does not loop or glow. The chosen day's ring settles with an opacity
 * change inside 300ms, and under reduced motion even that is still.
 */
import { useEffect, useRef, useState } from "react";
import { useLingui } from "@lingui/react/macro";
import { litPath, readLunation } from "@/components/natural/moonGeometry";
import { moonPhase } from "@shared/lunar";
import type { CivilDay } from "./calendarTime";
import { goldenSpiralDays, stepDay, type MoonDay, type MoonOfDays } from "./moonSpiral";

const WIDE_QUERY = "(min-width: 1024px)";

/** True from the desktop breakpoint up, kept current as the window changes. */
function useWide(): boolean {
  const [wide, setWide] = useState(() => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(WIDE_QUERY).matches);
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mql = window.matchMedia(WIDE_QUERY);
    const on = () => setWide(mql.matches);
    on();
    mql.addEventListener?.("change", on);
    return () => mql.removeEventListener?.("change", on);
  }, []);
  return wide;
}

export interface MoonSpiralProps {
  moon: MoonOfDays;
  selectedKey: string | null;
  onSelect: (day: CivilDay) => void;
  timezone: string;
  hemisphere: "north" | "south";
  /** "Wednesday 11 November" for a day, in the reader's language. */
  dayName: (day: CivilDay) => string;
  /** "24 Nov", for the labels beside the turning points. */
  shortDate: (day: CivilDay) => string;
}

export default function MoonSpiral({ moon, selectedKey, onSelect, timezone, hemisphere, dayName, shortDate }: MoonSpiralProps) {
  const { t } = useLingui();
  const wide = useWide();
  const W = wide ? 720 : 360;
  const H = wide ? 580 : 340;
  const fit = goldenSpiralDays(moon.days.length, W, H, { margin: wide ? 64 : 22 });
  const refs = useRef<Map<string, SVGGElement>>(new Map());
  const focusNext = useRef<string | null>(null);

  // After a key moves the choice, the newly chosen seed takes the focus, so
  // the keyboard keeps walking from where the eye is.
  useEffect(() => {
    if (!focusNext.current || focusNext.current !== selectedKey) return;
    refs.current.get(focusNext.current)?.focus();
    focusNext.current = null;
  }, [selectedKey, moon]);

  const n = moon.days.length;
  const first = moon.days[0]?.day;
  const last = moon.days[n - 1]?.day;
  const todayInMoon = moon.days.find((d) => d.today);
  const tabbableKey = moon.days.some((d) => d.day.key === selectedKey) ? selectedKey : (todayInMoon ?? moon.days[0])?.day.key;

  // The heart of the spiral: tonight's moon when today is in this moon, else
  // the moon on the chosen day, drawn by the same equation as the sky.
  const heartDay = todayInMoon?.day ?? moon.days.find((d) => d.day.key === selectedKey)?.day ?? first;
  const heart = heartDay ? readLunation(moonPhaseAt(heartDay)) : null;
  const heartR = wide ? 26 : 17;
  const litSide = (side: "left" | "right") => (hemisphere === "north" ? side : side === "right" ? "left" : "right");

  const onKey = (e: React.KeyboardEvent, d: MoonDay) => {
    let next: CivilDay | null = null;
    if (e.key === "Home" && first) next = first;
    else if (e.key === "End" && last) next = last;
    else if (e.key === "Enter" || e.key === " ") next = d.day;
    else next = stepDay(d.day, e.key, timezone);
    if (!next) return;
    e.preventDefault();
    focusNext.current = next.key;
    onSelect(next);
  };

  const describe = (d: MoonDay): string => {
    const lunarDay = d.lunarDay;
    const parts = [dayName(d.day), t({ message: `day ${lunarDay} of ${n}`, context: "calendar spiral: a day's place in the moon" })];
    if (d.today) parts.push(t({ message: "today", context: "calendar spiral: this day is today" }));
    if (d.newMoon) parts.push(t({ message: "new moon", context: "calendar spiral: a turning" }));
    if (d.fullMoon) parts.push(t({ message: "full moon", context: "calendar spiral: a turning" }));
    if (d.gathering) parts.push(t({ message: "a gathering", context: "calendar spiral: what is on a day" }));
    else if (d.marked) parts.push(t({ message: "something on the calendar", context: "calendar spiral: what is on a day" }));
    return parts.join(", ");
  };

  // A seed's tap target: half the gap to its nearest neighbour, at least the
  // seed itself and no more than a fingertip.
  const hitR = (i: number): number => {
    const p = fit.days[i];
    let gap = Infinity;
    for (const j of [i - 1, i + 1]) {
      const q = fit.days[j];
      if (q) gap = Math.min(gap, Math.hypot(p.x - q.x, p.y - q.y));
    }
    return Math.max(8, Math.min(wide ? 18 : 16, (Number.isFinite(gap) ? gap : 32) / 2));
  };

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="block h-auto w-full select-none"
      role="group"
      aria-label={t({ message: `This moon's ${n} days on a golden spiral, the new moon at the centre`, context: "calendar spiral: what the drawing is" })}
      data-testid="moon-spiral"
    >
      <path d={fit.path} fill="none" stroke="currentColor" strokeWidth={wide ? 1.4 : 1.2} className="text-open" strokeOpacity={0.5} data-testid="spiral-thread" />
      {heart && (
        <g aria-hidden="true">
          <circle cx={fit.centre.x} cy={fit.centre.y} r={heartR} className="text-muted" fill="currentColor" />
          {heart.fraction > 0.005 && (
            <path d={litPath({ cx: fit.centre.x, cy: fit.centre.y, r: heartR, fraction: heart.fraction, side: litSide(heart.side) })} className="text-foreground" fill="currentColor" fillOpacity={0.9} />
          )}
          <circle cx={fit.centre.x} cy={fit.centre.y} r={heartR} className="text-border" fill="none" stroke="currentColor" strokeWidth={1} />
        </g>
      )}
      {moon.days.map((d, i) => {
        const p = fit.days[i];
        const base = (wide ? 7.5 : 5.6) * (0.78 + (0.35 * (i + 1)) / n);
        const r = d.today ? base * 1.35 : base;
        const chosen = d.day.key === selectedKey;
        const label = describe(d);
        const showName = wide && (d.today || d.fullMoon || d.newMoon);
        const outward = p.x >= fit.centre.x;
        const date = shortDate(d.day);
        return (
          <g
            key={d.day.key}
            ref={(el) => { if (el) refs.current.set(d.day.key, el); else refs.current.delete(d.day.key); }}
            role="button"
            tabIndex={d.day.key === tabbableKey ? 0 : -1}
            aria-label={label}
            aria-pressed={chosen}
            data-day={d.day.key}
            data-today={d.today || undefined}
            data-walked={d.walked || undefined}
            data-gathering={d.gathering || undefined}
            data-full={d.fullMoon || undefined}
            className="cursor-pointer outline-none [&:focus-visible>.focus]:opacity-100"
            onClick={() => onSelect(d.day)}
            onKeyDown={(e) => onKey(e, d)}
          >
            <title>{label}</title>
            <circle cx={p.x} cy={p.y} r={hitR(i)} fill="transparent" />
            <circle className="focus text-ring opacity-0" cx={p.x} cy={p.y} r={r + 6} fill="none" stroke="currentColor" strokeWidth={2} />
            {d.fullMoon ? (
              <circle cx={p.x} cy={p.y} r={r * 1.6} className="text-foreground" fill="currentColor" fillOpacity={0.92} data-testid="spiral-full-moon" />
            ) : (
              <circle
                cx={p.x}
                cy={p.y}
                r={r}
                className={d.today ? "text-notice" : d.walked ? "text-open" : "text-card"}
                fill="currentColor"
                fillOpacity={d.walked && !d.today ? 0.55 : 1}
              />
            )}
            {!d.fullMoon && (
              <circle
                cx={p.x}
                cy={p.y}
                r={r}
                fill="none"
                stroke="currentColor"
                strokeWidth={d.gathering ? 1.8 : 1}
                className={d.today ? "text-notice" : d.gathering ? "text-notice" : "text-border"}
                strokeOpacity={d.gathering || d.today ? 1 : 0.7}
              />
            )}
            {d.marked && !d.today && !d.fullMoon && <circle cx={p.x} cy={p.y} r={1.7} className="text-notice" fill="currentColor" />}
            {d.today && <circle cx={p.x} cy={p.y} r={r * 2.3} fill="none" stroke="currentColor" className="text-notice" strokeOpacity={0.4} />}
            <circle
              cx={p.x}
              cy={p.y}
              r={r * (d.fullMoon ? 2.4 : 2)}
              fill="none"
              stroke="currentColor"
              strokeDasharray="2 3"
              className={`text-notice transition-opacity duration-300 motion-reduce:transition-none ${chosen && !d.today ? "opacity-80" : "opacity-0"}`}
              data-testid={chosen ? "spiral-chosen" : undefined}
            />
            {showName && (
              <text
                x={p.x + (outward ? r * 2.6 + 6 : -(r * 2.6 + 6))}
                y={p.y + 4}
                textAnchor={outward ? "start" : "end"}
                className={d.today ? "fill-notice" : "fill-muted-foreground"}
                fontSize={13}
                aria-hidden="true"
              >
                {d.today
                  ? t({ message: "Today", context: "calendar spiral: label beside today's seed" })
                  : d.fullMoon
                    ? t({ message: `Full moon, ${date}`, context: "calendar spiral: label beside the full moon" })
                    : t({ message: `New moon, ${date}`, context: "calendar spiral: label beside the first day" })}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

/** The phase at a civil day's noon, by the same table every moon on the calendar reads. */
function moonPhaseAt(day: CivilDay): number {
  return moonPhase(day.noon);
}
