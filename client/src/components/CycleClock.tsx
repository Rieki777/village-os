import { useEffect, useState } from "react";
import { SYNODIC_MONTH_DAYS, moonPhase, moonPhaseName } from "@shared/lunar";
import { quarterMarks, wheelState, type Hemisphere } from "@shared/wheel";
import MoonGlyph from "@/components/calendar/MoonGlyph";

/**
 * THE CYCLE CLOCK: the year as one circle, the lunation inside it, the real
 * moon at the centre, and today as a mark that actually moves.
 *
 * Wheel-of-the-year STRUCTURE, nobody's liturgy: the quarter labels are
 * astronomy (equal days, longest, shortest), true everywhere and
 * hemisphere-aware. It shows REAL state, which is the clock the economy runs
 * on: the current lunation, and the days until sending budgets refill.
 *
 * ── THE CYCLE COMES FROM THE SERVER, NEVER FROM ARITHMETIC HERE ──────────
 *
 * This component used to call `daysRemainingInCycle` directly, which is right
 * for every village keeping the moon and wrong for one that voted for calendar
 * months: the ring would count down to a new moon the village no longer
 * settles on. `/api/game/cycle` answers under whichever clock the village
 * keeps, and the caption says which one it is reading. The moon PHASE stays
 * local, because the sky is the sky whatever a village decides.
 *
 * ── WHY THE WORDS LEFT THE DIAL ──────────────────────────────────────────
 *
 * They used to sit in a small disc at the centre as three lines of 8 to 10px
 * SVG text, and the reason to move them shows the moment a village names a
 * season anything longer than a word: "Season of Foundations" is about 115
 * units wide in a 220 viewBox and the disc it sat in is 92 across, so it ran
 * out over both edges. SVG text does not wrap, so no font size makes that
 * safe, and the next village to write "The Long Green Rising" breaks it again.
 *
 * So the dial is a GRAPHIC and the words are real HTML underneath, where they
 * wrap and take the page's own type scale. That also deletes a class of bug
 * rather than one instance of it: text on a small coloured disc has to pair
 * its ink with that disc, and this page shipped two versions of that pairing
 * going wrong. There is no disc now, so there is nothing left to pair.
 *
 * ── THE PALETTE IS SEMANTIC, WHICH IS WHY IT IS AT HOME AT NIGHT ─────────
 *
 * Every value below is a semantic token, so `.sheet-night` re-themes the whole
 * dial with no edit here. The previous version drew from the TONE layer
 * (`--tone-mist-light`, `--tone-cream`), which is derived for light surfaces
 * and stays light in every theme: a pale mint ring and a cream disc on a deep
 * forest ground read as a daylight object pasted onto the night.
 *
 * TWO DRAFTS OF THE LUNATION RING WERE MEASURED AND THROWN AWAY. The brand as
 * the ARC came out at 2.9:1 on its track, under the 3:1 a meaningful non-text
 * mark needs, and that is structural: `--tone-brand` is derived to clear AA
 * against WHITE, so it is dark by construction, and a colour chosen to be dark
 * cannot be the bright mark on a dark ground. The brand as the TRACK then
 * measured 1.8:1 against the ground, because the fallback when a village has
 * set no seed is #404040, and an invisible track takes the PROPORTION with it.
 * Both are semantic now, and the village's colour lives where it always
 * worked: `MoonGlyph` draws the moon's shadowed half in `--tone-brand-band`.
 *
 * ── THE MOON IS DRAWN, NOT NAMED ─────────────────────────────────────────
 *
 * `MoonGlyph` is the component the character sheet's MoonDock uses, so the
 * moon at the centre of this dial and the moon in the corner of that page are
 * the same moon, lit on the same side for the hemisphere.
 */
const CENTRE = 110;
const YEAR_R = 86;
const LUNAR_R = 58;

/** angle 0 = top of the wheel (Jan 1), clockwise. */
const pt = (angle: number, r: number) => {
  const a = angle * 2 * Math.PI - Math.PI / 2;
  return [CENTRE + r * Math.cos(a), CENTRE + r * Math.sin(a)] as const;
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
  const [tx, ty] = pt(state.yearAngle, YEAR_R);
  const lunarSweep = state.lunationFraction;
  const phaseName = moonPhaseName(phase);

  return (
    <figure className="mx-auto max-w-[280px]">
      <svg
        viewBox="0 0 220 220"
        aria-hidden="true"
        style={{ display: "block", width: "100%" }}
      >
        {/* THE YEAR. A quiet track: this is context, not the reading. */}
        <circle
          cx={CENTRE} cy={CENTRE} r={YEAR_R}
          fill="none" stroke="var(--border)" strokeWidth="1.5" strokeOpacity="0.55"
        />

        {/* The four turnings, astronomy and not liturgy. Ticks and no words:
            "Equinox" and "Solstice" were set at 7.5px, under half the size of
            the smallest body text here and never really readable at any width
            this figure renders at. Four evenly spaced marks on a year ring say
            "the four turnings" structurally, and the caption carries what a
            reader actually needs, which is where in the cycle they stand. */}
        {quarterMarks(hemisphere).map((q) => {
          const [x1, y1] = pt(q.angle, YEAR_R - 6);
          const [x2, y2] = pt(q.angle, YEAR_R + 6);
          return (
            <line
              key={`${q.month}-${q.day}`}
              x1={x1} y1={y1} x2={x2} y2={y2}
              stroke="var(--border)" strokeWidth="1.5" strokeLinecap="round"
            />
          );
        })}

        {/* TODAY, on the year. The one point of gold on the dial, because it is
            the one mark that answers "where are we now". */}
        <circle cx={tx} cy={ty} r="8" fill="var(--sheet-notice, #dfab4d)" fillOpacity="0.18" />
        <circle cx={tx} cy={ty} r="3.5" fill="var(--sheet-notice, #dfab4d)" />

        {/* THE LUNATION. `pathLength` normalises the dash to 0..1 so the sweep
            IS the fraction and no arithmetic here can drift from the
            circumference. */}
        <circle
          cx={CENTRE} cy={CENTRE} r={LUNAR_R}
          fill="none" stroke="var(--muted)" strokeWidth="9"
        />
        {/* Two hairlines on the track's edges, so the ring has a boundary even
            where the fill is close to the ground behind it. */}
        <circle
          cx={CENTRE} cy={CENTRE} r={LUNAR_R + 4.5}
          fill="none" stroke="var(--border)" strokeWidth="1" strokeOpacity="0.5"
        />
        <circle
          cx={CENTRE} cy={CENTRE} r={LUNAR_R - 4.5}
          fill="none" stroke="var(--border)" strokeWidth="1" strokeOpacity="0.5"
        />
        <circle
          cx={CENTRE} cy={CENTRE} r={LUNAR_R}
          fill="none" stroke="var(--foreground)" strokeWidth="9"
          pathLength={1}
          strokeDasharray={`${lunarSweep} 1`}
          strokeLinecap="round"
          transform={`rotate(-90 ${CENTRE} ${CENTRE})`}
        />

        {/* THE MOON ITSELF, at the centre where the text used to crowd. */}
        <g transform={`translate(${CENTRE - 34} ${CENTRE - 34})`}>
          <MoonGlyph phase={phase} size={68} hemisphere={hemisphere} />
        </g>
      </svg>

      {/*
        THE WORDS, in real type.

        `figcaption` rather than an aria-label on the figure, because this is
        the same sentence a sighted reader gets: the dial is decorative and
        hidden, and everything it means is written here once. The season can be
        any length a village chooses and simply wraps.

        The last line names the village's OWN clock. A village that voted for
        calendar months is not counting down to a new moon, and saying "cycle"
        without saying which cycle is how the old copy managed to be wrong for
        them while looking right.
      */}
      <figcaption className="mt-4 text-center">
        {season && (
          <p className="font-display text-lg leading-snug text-foreground">{season}</p>
        )}
        <p className="mt-1 text-sm text-muted-foreground">{phaseName}</p>
        <p className="mt-0.5 text-sm text-notice">
          {daysLeft === null
            ? "Counting the days until budgets refill"
            : `${daysLeft} day${daysLeft === 1 ? "" : "s"} until budgets refill, when this ${
                cycle?.clock === "calendar" ? "calendar month" : "moon"
              } turns`}
        </p>
      </figcaption>
    </figure>
  );
}
