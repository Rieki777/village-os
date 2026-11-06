/**
 * THE KEY UNDER THE PICTURE (2026-10-23).
 *
 * From the whole village the map draws four marks a first-time reader has no
 * way to decode alone: a circle's border filling as a meter, the thin amber
 * runs that are openings, the dashed and hatched discs still forming, and the
 * band the named-but-not-started circles ride. This names those four, right
 * under the canvas, at every width. The fuller legend (each role glyph, with
 * counts) stays in the panel, because the glyphs only appear once you step in,
 * and the last line here says so.
 */
import type { ReactNode } from "react";

const AMBER = "var(--color-amber)";
const HELD = "var(--color-teal)";

function Swatch({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 28 16" width={28} height={16} aria-hidden="true" className="shrink-0">
      {children}
    </svg>
  );
}

export default function MapKey({ className = "" }: { className?: string }) {
  return (
    <div data-power-key className={`flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground ${className}`}>
      <span className="inline-flex items-center gap-1.5">
        <Swatch>
          <path d="M 3 12 A 11 11 0 0 1 25 12" fill="none" stroke={HELD} strokeOpacity={0.2} strokeWidth={4} />
          <path d="M 3 12 A 11 11 0 0 1 11 2.5" fill="none" stroke={HELD} strokeWidth={4} />
        </Swatch>
        held
      </span>
      <span className="inline-flex items-center gap-1.5">
        <Swatch>
          <path d="M 3 12 A 11 11 0 0 1 25 12" fill="none" stroke={AMBER} strokeWidth={2.2} />
        </Swatch>
        open
      </span>
      <span className="inline-flex items-center gap-1.5">
        <Swatch>
          <circle cx={14} cy={8} r={6.5} fill="var(--foreground)" fillOpacity={0.08} stroke="var(--foreground)" strokeOpacity={0.7} strokeWidth={1.2} strokeDasharray="2.5 1.8" />
          <line x1={10} y1={12} x2={18} y2={4} stroke="var(--foreground)" strokeOpacity={0.25} strokeWidth={1.2} />
        </Swatch>
        forming
      </span>
      <span className="inline-flex items-center gap-1.5">
        <Swatch>
          <path d="M 2 13 A 14 14 0 0 1 26 13 L 21 13 A 9 9 0 0 0 7 13 Z" fill="var(--foreground)" fillOpacity={0.1} stroke="var(--foreground)" strokeOpacity={0.55} strokeWidth={1} strokeDasharray="2.5 1.8" />
        </Swatch>
        the forming band: named, no roles yet
      </span>
      <span className="basis-full sm:basis-auto">Step into a circle to meet each role.</span>
    </div>
  );
}
