/**
 * THE MOON TONIGHT: the real phase for a date, computed here with no network
 * (nature kit, game feel wave 2).
 *
 * The phase comes from shared/lunar's `moonPhase` (its table of new moons,
 * then the mean synodic month), and the lit outline from the moon geometry
 * the progress moon already proves (`litPath`, `readLunation`): a waxing moon
 * is lit on the right, a waning one on the left, in exactly the proportion
 * the sky shows. Drawn in the night world's own moonlight on its panel.
 *
 * It does not move, so reduced motion changes nothing. Phone and desktop:
 * with a fine pointer, hovering the disc names the phase; `showName` prints
 * the name under it for a phone, which has no hover.
 */
import { moonPhase } from "@shared/lunar";
import { litPath, readLunation } from "@/components/natural/moonGeometry";
import "./nature.css";

export interface MoonPhaseProps {
  /** The night to draw. Defaults to now. */
  date?: Date;
  /** What a screen reader hears; defaults to the phase's own reading ("62 percent, waxing gibbous"). */
  label?: string;
  /** Print the phase name under the disc. */
  showName?: boolean;
  size?: "sm" | "md" | "lg";
  className?: string;
}

const SIZES = {
  sm: "size-6",
  md: "size-16 sm:size-20",
  lg: "size-32 sm:size-40 lg:size-56",
} as const;

export const NEW_MOON_BELOW = 0.005;

/** The phase and its reading for a date, as numbers a test can check. */
export function moonFor(date: Date) {
  const phase = moonPhase(date);
  return { phase, reading: readLunation(phase) };
}

export default function MoonPhase({ date, label, showName = false, size = "md", className = "" }: MoonPhaseProps) {
  const { reading } = moonFor(date ?? new Date());
  // Under half a percent lit the sliver is thinner than the edge drawn round it, so the night shows a new moon.
  const d = reading.fraction < NEW_MOON_BELOW ? "" : litPath({ cx: 50, cy: 50, r: 44, fraction: reading.fraction, side: reading.side });
  return (
    <span className={`nk inline-flex flex-col items-center gap-1 ${className}`.trim()} data-phase={reading.phase.toFixed(3)} data-side={reading.side}>
      <svg viewBox="0 0 100 100" role="img" aria-label={label ?? reading.label} className={`block shrink-0 ${SIZES[size]}`}>
        <title>{reading.phaseName}</title>
        <circle cx={50} cy={50} r={44} className="text-muted" fill="currentColor" />
        {d ? <path d={d} className="text-foreground" fill="currentColor" fillOpacity={0.92} data-testid="moon-lit" /> : null}
        <circle cx={50} cy={50} r={44} className="text-border" fill="none" stroke="currentColor" strokeWidth={1.2} />
      </svg>
      {showName ? <span className="text-xs text-muted-foreground">{reading.phaseName}</span> : null}
    </span>
  );
}
