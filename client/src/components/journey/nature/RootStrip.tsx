/**
 * THE ROOT STRIP, as a shell (nature kit, game feel wave 2): a slim mycelial
 * root under the header with a slot for the seed glyph and a slot for the
 * words. The Root lane fills both and decides when it shows; this file draws
 * only the strip.
 *
 * The root is grown once (its stroke draws in) and then still; under reduced
 * motion it is simply there.
 *
 * Phone and desktop, each at its best:
 *   - a phone gets one slim line within thumb reach: the seed, one sentence
 *     cut to fit, and the whole strip is the target when `onOpen` is given;
 *   - a desktop has the width, so the root reaches further with more hyphae,
 *     the `detail` slot shows beside the sentence, and hovering lifts the
 *     open arrow.
 */
import type { CSSProperties, ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { useReducedMotion } from "@/components/natural/useReducedMotion";
import { rootStrip } from "./geometry";
import "./nature.css";

export interface RootStripProps {
  /** The seed glyph, usually a small SeedOfLife. */
  seed?: ReactNode;
  /** The one line: the next step. */
  children: ReactNode;
  /** A second line a desktop has room for (hidden on a phone). */
  detail?: ReactNode;
  /** What a desktop has room for at the far end: the step stops, a door to the whole path. Hidden on a phone. */
  aside?: ReactNode;
  /** Make the whole strip a button that opens the path. */
  onOpen?: () => void;
  /** The button's accessible name when `onOpen` is given. */
  openLabel?: string;
  className?: string;
}

// The root grows in its own band UNDER the words (D-02): it once ran through the sentence it carries.
const BAND = 16;

function Root({ width, branches, className }: { width: number; branches: number; className: string }) {
  const { main, hyphae } = rootStrip(width, BAND, branches, 11, 0.5);
  // slice, never stretch: the root keeps its own proportions and is cut to the strip's width.
  return (
    <svg viewBox={`0 0 ${width} ${BAND}`} preserveAspectRatio="xMinYMid slice" aria-hidden="true" className={`nk-root-svg ${className}`} style={{ top: "auto", height: BAND }} data-root-band="">
      <g fill="none" stroke="currentColor" strokeLinecap="round" className="text-open">
        <path d={main} pathLength={1} className="nk-draw" strokeWidth={1.2} strokeOpacity={0.55} />
        {hyphae.map((h, i) => (
          <path
            key={i}
            d={h}
            pathLength={1}
            className="nk-draw"
            strokeWidth={0.8}
            strokeOpacity={0.35}
            style={{ "--nk-delay": `${0.3 + (i % 8) * 0.08}s` } as CSSProperties}
          />
        ))}
      </g>
    </svg>
  );
}

export default function RootStrip({ seed, children, detail, aside, onOpen, openLabel, className = "" }: RootStripProps) {
  const still = useReducedMotion();
  const body = (
    <>
      <Root width={420} branches={5} className="sm:hidden" />
      <Root width={1400} branches={16} className="hidden sm:block" />
      {seed ? <span className="relative shrink-0">{seed}</span> : null}
      <span className="relative min-w-0 flex-1">
        {/* A phone cuts the one line to fit; a desktop has the room for the whole sentence (D-02). */}
        <span className="block truncate text-sm text-foreground sm:overflow-visible sm:whitespace-normal sm:text-base">{children}</span>
        {detail ? <span className="hidden truncate text-sm text-muted-foreground lg:block lg:overflow-visible lg:whitespace-normal">{detail}</span> : null}
      </span>
      {aside ? <span className="relative hidden shrink-0 items-center gap-4 lg:flex">{aside}</span> : null}
      {onOpen ? (
        <ChevronRight aria-hidden="true" className="relative size-5 shrink-0 text-muted-foreground motion-safe:transition-transform group-hover:translate-x-0.5 group-hover:text-notice" />
      ) : null}
    </>
  );
  const shell = `nk group relative flex min-h-14 w-full items-center gap-3 overflow-hidden border-b border-border bg-card px-4 pb-5 pt-2 text-left sm:px-6 ${className}`.trim();
  if (onOpen) {
    return (
      <button
        type="button"
        onClick={onOpen}
        aria-label={openLabel}
        className={`${shell} focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring`}
        data-motion={still ? "still" : "live"}
        data-testid="root-strip"
      >
        {body}
      </button>
    );
  }
  return (
    <div className={shell} data-motion={still ? "still" : "live"} data-testid="root-strip">
      {body}
    </div>
  );
}
