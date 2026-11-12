/**
 * MOONS ON THE LAND, AS A STRING OF MOONS (the prune, wave 2, C5).
 *
 * `moonsOnTheLand` is a fact about a person, never a score: it is never sorted
 * on, compared or celebrated. The hero already says it in words ("8 moons on
 * the land"); this draws the same fact as a quiet string of small moons, one
 * per moon, with the newest a little brighter, the way a firefly sits on the
 * one that is still turning. A year is thirteen moons, so the string holds at
 * most one year and the words carry the rest. Decoration only: the words are
 * what a screen reader hears.
 */
export const MOONS_IN_A_YEAR = 13;

/** How many moons the string draws: none for none, never more than a year. */
export function moonsToDraw(moons: number | null | undefined): number {
  if (moons == null || !Number.isFinite(moons) || moons <= 0) return 0;
  return Math.min(MOONS_IN_A_YEAR, Math.floor(moons));
}

export default function MoonString({ moons, className = "" }: { moons: number | null | undefined; className?: string }) {
  const n = moonsToDraw(moons);
  if (n === 0) return null;
  return (
    <span aria-hidden="true" data-testid="moon-string" className={`items-center gap-1.5 text-notice ${className}`}>
      {Array.from({ length: n }, (_, i) => {
        const newest = i === n - 1;
        return (
          <svg key={i} viewBox="0 0 12 12" className={newest ? "size-3" : "size-2.5"}>
            <circle cx="6" cy="6" r="5" fill="currentColor" fillOpacity={newest ? 0.9 : 0.35} />
            {newest ? <circle cx="6" cy="6" r="5.5" fill="none" stroke="currentColor" strokeOpacity="0.4" /> : null}
          </svg>
        );
      })}
    </span>
  );
}
