import { useEffect, useState } from "react";
import { SYNODIC_MONTH_DAYS, moonPhase, moonPhaseName } from "@shared/lunar";
import { quarterMarks, wheelState, type Hemisphere } from "@shared/wheel";

/**
 * THE CYCLE CLOCK: the year as one circle, the lunation inside it, today as
 * a mark that actually moves. Wheel-of-the-year STRUCTURE, nobody's
 * liturgy — the quarter labels are astronomy (equal days, longest, shortest),
 * true everywhere, hemisphere-aware, and the village's own season name sits
 * at the centre. It shows REAL state: the current lunar cycle and the days
 * until budgets refill — the clock the economy already runs on, drawn.
 *
 * Token-driven like the circle scenes: pick a seed in Admin → Look and the
 * clock is already in your palette.
 *
 * THE CYCLE COMES FROM THE SERVER, never from lunar arithmetic here. This
 * component used to call `daysRemainingInCycle` directly, which is right for
 * every village keeping the moon and wrong for one that voted for calendar
 * months: the ring would have counted down to a new moon the village no
 * longer settles on. `/api/game/cycle` answers under whichever clock the
 * village keeps, and the copy below says which one it is reading. The moon
 * phase stays local because the sky is the sky whatever a village decides.
 */
const T = {
  brand: "var(--tone-brand, #157f7d)",
  soft: "var(--tone-brand-soft, #7fb8ac)",
  mist: "var(--tone-mist-light, #c6dde0)",
  sun: "var(--tone-sun, #ecb163)",
  cream: "var(--tone-cream, #efe8d7)",
};

const pt = (angle: number, r: number) => {
  // angle 0 = top of the wheel (Jan 1), clockwise.
  const a = angle * 2 * Math.PI - Math.PI / 2;
  return [110 + r * Math.cos(a), 110 + r * Math.sin(a)] as const;
};

export default function CycleClock({ hemisphere = "north" }: { hemisphere?: Hemisphere }) {
  const [season, setSeason] = useState<string>("");
  const [cycle, setCycle] = useState<{ daysRemaining: number; clock?: string } | null>(null);
  useEffect(() => {
    fetch("/api/season").then((r) => (r.ok ? r.json() : null))
      .then((d) => setSeason(d?.current?.name ?? "")).catch(() => {});
    fetch("/api/game/cycle").then((r) => (r.ok ? r.json() : null))
      .then((d) => setCycle(d ? { daysRemaining: Number(d.daysRemaining) || 0, clock: d.clock } : null))
      .catch(() => {});
  }, []);

  const now = new Date();
  const phase = moonPhase(now);
  // wheelState wants the moon's AGE IN DAYS and divides by 29.53 itself.
  // This passed the 0..1 phase straight in, so the ring never filled past
  // 3% (round 4 measured it); the age is the phase times the month.
  const state = wheelState(now, phase * SYNODIC_MONTH_DAYS, hemisphere);
  // Null until the server answers. "Counting" says the number is on its way,
  // which is a different sentence from a confident zero.
  const daysLeft = cycle?.daysRemaining ?? null;
  const [tx, ty] = pt(state.yearAngle, 86);
  const lunarSweep = state.lunationFraction;

  return (
    <figure className="mx-auto max-w-[260px]" aria-label={`Cycle clock: ${moonPhaseName(phase)}, ${daysLeft === null ? "counting the days left in this cycle" : `${daysLeft} days left in this cycle`}`}>
      <svg viewBox="0 0 220 220" role="img" aria-hidden="true" style={{ display: "block", width: "100%" }}>
        {/* the year ring */}
        <circle cx="110" cy="110" r="86" fill="none" stroke={T.mist} strokeWidth="10" />
        {/* the four turnings — astronomy, not liturgy */}
        {quarterMarks(hemisphere).map((q) => {
          const [x1, y1] = pt(q.angle, 78);
          const [x2, y2] = pt(q.angle, 94);
          const [lx, ly] = pt(q.angle, 104);
          return (
            <g key={`${q.month}-${q.day}`}>
              <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={T.brand} strokeWidth="2.5" />
              <text x={lx} y={ly} textAnchor="middle" dominantBaseline="middle"
                fontSize="7.5" fill={T.brand} opacity="0.9">
                {q.label === "Equal Day & Night" ? "Equinox" : "Solstice"}
              </text>
            </g>
          );
        })}
        {/* today, on the year */}
        <circle cx={tx} cy={ty} r="6" fill={T.sun} stroke="#fff" strokeWidth="1.5" />
        {/* the lunation ring: how far this cycle has turned */}
        <circle cx="110" cy="110" r="58" fill="none" stroke={T.cream} strokeWidth="8" />
        <circle cx="110" cy="110" r="58" fill="none" stroke={T.brand} strokeWidth="8"
          strokeDasharray={`${lunarSweep * 2 * Math.PI * 58} ${2 * Math.PI * 58}`}
          strokeLinecap="round" transform="rotate(-90 110 110)" />
        {/* the centre: the village's season, the cycle's truth */}
        <circle cx="110" cy="110" r="46" fill={T.cream} opacity="0.85" />
        <text x="110" y="98" textAnchor="middle" fontSize="10" fill={T.brand} fontWeight="600">
          {season || "This season"}
        </text>
        <text x="110" y="114" textAnchor="middle" fontSize="8.5" fill="var(--foreground, #1a3a39)" opacity="0.8">
          {moonPhaseName(phase)}
        </text>
        <text x="110" y="128" textAnchor="middle" fontSize="8" fill="var(--foreground, #1a3a39)" opacity="0.6">
          {daysLeft === null ? "Counting the days" : `${daysLeft} day${daysLeft === 1 ? "" : "s"} to cycle close`}
        </text>
      </svg>
      <figcaption className="sr-only">
        The year as a circle with the four solar turnings, today's position, and the moon's
        progress through its lunation. The countdown at the centre is this village's own cycle,
        {cycle?.clock === "calendar" ? " a calendar month," : " a moon,"} and budgets refill when
        it turns.
      </figcaption>
    </figure>
  );
}
