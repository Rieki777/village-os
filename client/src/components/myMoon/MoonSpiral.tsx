/**
 * THE MOON BOARD'S HEADER: this moon on a golden spiral, told in four
 * chapters (Phase C, lane C2; sitewide plan E, the Moon Garden).
 *
 * The spiral is time, never a measure of anybody: each dot is a day, the new
 * moon at the centre and the closing day at the edge. Days walked are a soft
 * green, today is gold, the full moon is drawn as itself and the walkthrough
 * day as a flower. Beside it (on a desktop) or under it (on a phone) the
 * chapter we are in, its sentence, the four chapters, and the one next act
 * with fireflies on it while the recap is still the member's to send.
 *
 * Phone: the spiral is a full-width band on top, the act sits right under
 * it within thumb reach, and the four chapters fold into a 2 by 2 grid.
 * Desktop: the spiral is a large field on the left and the chapter, act and
 * list stay beside it; hovering a day names it (`<title>`).
 *
 * Nothing here moves except the fireflies on the act, which rest after about
 * twenty seconds and are still under reduced motion.
 */
import type { MoonRef } from "@shared/moonRecap";
import { dayWords } from "@shared/moonRecap";
import Fireflies from "@/components/journey/nature/Fireflies";
import { BTN_GOLD, KICKER } from "./moonUi";
import {
  CHAPTERS,
  MOON_GARDEN_WORDS as W,
  chapterOf,
  chapterWhen,
  moonDays,
  nextAct,
  spiralDays,
  spiralPath,
  standing,
  type Chapter,
} from "./moonGarden";

const SIZE = 100;
const PAD = 22;

function Flower({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x.toFixed(2)} ${y.toFixed(2)})`} className="fill-notice">
      {[0, 72, 144, 216, 288].map((a) => (
        <circle key={a} cx={(3.2 * Math.cos((a * Math.PI) / 180)).toFixed(2)} cy={(3.2 * Math.sin((a * Math.PI) / 180)).toFixed(2)} r="2.4" />
      ))}
      <circle r="1.7" className="fill-background" />
    </g>
  );
}

export interface MoonSpiralProps {
  moon: MoonRef;
  /** The member's civil date (YYYY-MM-DD). */
  today: string;
  /** False once the recap is sent: then there is no act and no fireflies. */
  editable: boolean;
}

export function SpiralDrawing({ moon, today }: Pick<MoonSpiralProps, "moon" | "today">) {
  const days = moonDays(moon);
  const pts = spiralDays(days.length, SIZE);
  const label = W.spiralLabel(days.length);
  const last = days.length - 1;
  // Fit the box to the curve itself: a golden spiral is lopsided, so a square around its centre wastes half the field.
  const curve = spiralDays(120, SIZE);
  const xs = curve.map((p) => p.x);
  const ys = curve.map((p) => p.y);
  const box = { x: Math.min(...xs) - PAD, y: Math.min(...ys) - PAD, w: Math.max(...xs) - Math.min(...xs) + 2 * PAD, h: Math.max(...ys) - Math.min(...ys) + 2 * PAD };
  const todayAt = days.indexOf(today);
  // The new moon's label stays off while today sits beside it at the centre.
  const showNewMoon = last > 0 && (todayAt < 0 || todayAt > 5);
  return (
    <svg
      viewBox={`${box.x.toFixed(2)} ${box.y.toFixed(2)} ${box.w.toFixed(2)} ${box.h.toFixed(2)}`}
      role="img"
      aria-label={label}
      data-testid="moon-spiral"
      className="block h-auto w-full max-w-[22rem] lg:max-w-[30rem]"
    >
      <path d={spiralPath(SIZE)} fill="none" className="stroke-open" strokeOpacity="0.35" strokeWidth="1.2" />
      {days.map((d, i) => {
        const p = pts[i];
        const x = p.x.toFixed(2);
        const y = p.y.toFixed(2);
        const isToday = d === today;
        const kind = isToday ? "today" : d === moon.halfwayDay ? "full" : d === moon.endOfMoonFriday ? "harvest" : i === 0 ? "new" : d < today ? "walked" : "ahead";
        return (
          <g key={d} data-day={d} data-kind={kind}>
            <title>{`${dayWords(d)}${isToday ? `, ${W.today.toLowerCase()}` : ""}`}</title>
            {kind === "harvest" ? (
              <Flower x={p.x} y={p.y} />
            ) : kind === "full" ? (
              <circle cx={x} cy={y} r="6" className="fill-foreground" fillOpacity="0.92" />
            ) : kind === "new" ? (
              <circle cx={x} cy={y} r="4.5" className="fill-background stroke-foreground" strokeOpacity="0.7" strokeWidth="1.2" />
            ) : kind === "today" ? (
              <>
                <circle cx={x} cy={y} r="10" className="fill-notice" fillOpacity="0.18" />
                <circle cx={x} cy={y} r="5" className="fill-notice" />
              </>
            ) : kind === "walked" ? (
              <circle cx={x} cy={y} r="3" className="fill-open" fillOpacity="0.85" />
            ) : (
              <circle cx={x} cy={y} r="3" fill="none" className="stroke-muted-foreground" strokeOpacity="0.7" strokeWidth="1" />
            )}
            {/* A wider invisible target so a pointer can hover a day. */}
            <circle cx={x} cy={y} r="7" fill="transparent" />
          </g>
        );
      })}
      {moon.halfwayDay && days.includes(moon.halfwayDay) ? (
        <SpiralLabel at={pts[days.indexOf(moon.halfwayDay)]} text={W.fullMoon} />
      ) : null}
      {days.includes(moon.endOfMoonFriday) ? <SpiralLabel at={pts[days.indexOf(moon.endOfMoonFriday)]} text={W.harvest} /> : null}
      {days.includes(today) ? <SpiralLabel at={pts[days.indexOf(today)]} text={W.today} gold /> : null}
      {showNewMoon ? <SpiralLabel at={pts[0]} text={W.newMoon} /> : null}
    </svg>
  );
}

function SpiralLabel({ at, text, gold = false }: { at: { x: number; y: number }; text: string; gold?: boolean }) {
  // Labels sit outward from the centre, so they never cover the curve's inner turns.
  const len = Math.hypot(at.x, at.y) || 1;
  const x = at.x + (at.x / len) * 13;
  const y = at.y + (at.y / len) * 13 + 3;
  const anchor = at.x > 8 ? "start" : at.x < -8 ? "end" : "middle";
  return (
    <text x={x.toFixed(2)} y={y.toFixed(2)} textAnchor={anchor} className={gold ? "fill-notice text-[9px] font-semibold" : "fill-muted-foreground text-[8px]"} aria-hidden="true">
      {text}
    </text>
  );
}

/** The header: spiral, chapter, act and the four chapters. */
export default function MoonSpiral({ moon, today, editable }: MoonSpiralProps) {
  const where = standing(today, moon);
  const chapter: Chapter = where.kind === "before" ? "sow" : where.kind === "after" ? "harvest" : chapterOf(today, moon);
  const index = CHAPTERS.indexOf(chapter);
  const act = where.kind === "after" ? null : nextAct(chapter, editable);
  const when = where.kind === "in" ? W.dayOf(where.day, where.of) : where.kind === "after" ? W.closed : W.notYet;
  const words = W.chapters[chapter];

  return (
    <div className="grid grid-cols-1 items-center gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-8" data-testid="moon-garden-header" data-chapter={chapter}>
      <div className="-mx-2 flex justify-center rounded-2xl border border-border bg-muted/40 px-2 py-3 sm:mx-0">
        <SpiralDrawing moon={moon} today={today} />
      </div>
      <div className="flex flex-col gap-3">
        <p className={KICKER}>
          {moon.periodWords} · {W.chapterKicker(index)}
        </p>
        <h3 className="m-0 font-display text-[26px] leading-tight text-foreground sm:text-[30px]" data-testid="moon-chapter">{words.name}</h3>
        <p className="m-0 text-sm text-muted-foreground">{when}</p>
        <p className="m-0 text-base text-foreground">{words.line}</p>
        {act ? (
          <div className="py-2">
            <Fireflies>
              <a href={act.href} className={BTN_GOLD} data-testid="moon-act">{act.label}</a>
            </Fireflies>
          </div>
        ) : null}
        <div className="flex flex-col gap-2">
          <p className="m-0 text-xs font-semibold uppercase tracking-widest text-muted-foreground">{W.chaptersHeading}</p>
          <ol className="m-0 grid list-none grid-cols-2 gap-2 p-0 lg:grid-cols-1" data-testid="moon-chapters">
            {CHAPTERS.map((c, i) => {
              const on = c === chapter;
              return (
                <li
                  key={c}
                  aria-current={on ? "step" : undefined}
                  className={`flex min-h-11 items-start gap-2 rounded-xl border p-2 sm:p-3 ${on ? "border-notice bg-muted" : "border-border bg-transparent"}`}
                >
                  <span className={`inline-flex size-6 shrink-0 items-center justify-center rounded-full border text-xs ${on ? "border-notice text-notice" : "border-border text-muted-foreground"}`}>
                    {i + 1}
                  </span>
                  <span className="flex min-w-0 flex-col">
                    <span className="text-sm font-semibold text-foreground">
                      {W.chapters[c].name}
                      {on ? <span className="sr-only">, {W.now}</span> : null}
                    </span>
                    <span className="text-xs text-muted-foreground">{chapterWhen(c, moon)}</span>
                  </span>
                </li>
              );
            })}
          </ol>
        </div>
      </div>
    </div>
  );
}
