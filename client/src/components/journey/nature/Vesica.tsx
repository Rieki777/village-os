/**
 * THE VESICA: two circles meeting, the threshold (nature kit, game feel wave 2).
 *
 * Apart, the two circles just touch. `met` brings their centres one radius
 * apart, the vesica piscis, and the lens where they overlap fills softly:
 * you and the village, each still whole, sharing a part. The meeting moves
 * once, when `met` turns true; under reduced motion each state is simply
 * drawn, apart or met, with nothing moving between them.
 *
 * Phone and desktop: the drawing scales to its field (`size`), wider on a
 * large screen; the two `names` sit side by side under the circles on a
 * phone and either side of them, in the width a desktop has, from sm up.
 */
import type { CSSProperties } from "react";
import { useReducedMotion } from "@/components/natural/useReducedMotion";
import { fx, vesica } from "./geometry";
import "./nature.css";

export interface VesicaProps {
  /** True once the two have met. */
  met: boolean;
  /** What a screen reader hears, in the caller's words. */
  label: string;
  /** The two circles' names, left and right, shown beside the drawing. */
  names?: readonly [string, string];
  size?: "sm" | "md" | "lg";
  className?: string;
}

const SIZES = {
  sm: "h-10 w-16",
  md: "h-24 w-36 sm:h-28 sm:w-44",
  lg: "h-36 w-56 sm:h-48 sm:w-72 lg:h-56 lg:w-[22rem]",
} as const;

const R = 22;
const CX = 60;
const CY = 30;

export default function Vesica({ met, label, names, size = "md", className = "" }: VesicaProps) {
  const still = useReducedMotion();
  const shape = vesica(CX, CY, R, R);
  // Apart, each circle sits half a radius further out: the centres are 2r apart and the circles touch.
  const shift = met ? 0 : R / 2;

  const drawing = (
    <svg viewBox="0 0 120 60" role="img" aria-label={label} className={`block shrink-0 overflow-visible ${SIZES[size]}`}>
      <path
        d={shape.lens}
        className="nk-lens text-notice"
        fill="currentColor"
        fillOpacity={0.18}
        stroke="none"
        opacity={met ? 1 : 0}
        data-testid="vesica-lens"
      />
      <circle
        cx={fx(shape.left.x)}
        cy={CY}
        r={R}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.4}
        className="text-open"
        style={{ transform: `translateX(${-shift}px)` } as CSSProperties}
      />
      <circle
        cx={fx(shape.right.x)}
        cy={CY}
        r={R}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.4}
        className="text-notice"
        style={{ transform: `translateX(${shift}px)` } as CSSProperties}
      />
    </svg>
  );

  return (
    <span
      className={`nk nk-vesica inline-grid grid-cols-2 items-center gap-x-4 gap-y-2 sm:grid-cols-[1fr_auto_1fr] ${className}`.trim()}
      data-motion={still ? "still" : "live"}
      data-met={met ? "true" : "false"}
    >
      <span className="order-1 col-span-2 justify-self-center sm:order-2 sm:col-span-1">{drawing}</span>
      {names ? <span className="order-2 text-right text-sm text-muted-foreground sm:order-1">{names[0]}</span> : null}
      {names ? <span className="order-3 text-sm text-muted-foreground">{names[1]}</span> : null}
    </span>
  );
}
