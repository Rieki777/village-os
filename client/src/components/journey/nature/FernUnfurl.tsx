/**
 * THE FERN, unfurling once (nature kit, game feel wave 2).
 *
 * The frond is computed in code, a Lindenmayer system rewritten a few times
 * (`fern` in geometry.ts), so the same rule draws it at every scale. It
 * uncurls from its base and draws stem first, then each order of leaflet, in
 * 1.5s, once. Under reduced motion it is a still drawing of the open frond.
 *
 * Phone and desktop: a wide screen has a larger field for the geometry, so
 * `detail="auto"` grows one more generation of leaflets there (min-width
 * 1024px) and keeps the lighter frond on a phone.
 */
import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { useReducedMotion } from "@/components/natural/useReducedMotion";
import { fern, fx } from "./geometry";
import "./nature.css";

export interface FernUnfurlProps {
  /** What a screen reader hears; absent, the fern is decoration. */
  label?: string;
  /** Generations of the rule: 2 is a sprig, 3 a frond, 4 a full fern. auto picks by screen. */
  detail?: 2 | 3 | 4 | "auto";
  /** Lean the frond, in radians. */
  lean?: number;
  /** Grow toward the left. */
  mirror?: boolean;
  size?: "sm" | "md" | "lg";
  className?: string;
}

const SIZES = {
  sm: "size-12",
  md: "size-32 sm:size-40",
  lg: "size-56 sm:size-72 lg:size-96",
} as const;

const WIDE = "(min-width: 1024px)";

function useWide(): boolean {
  const [wide, setWide] = useState(() => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(WIDE).matches);
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mql = window.matchMedia(WIDE);
    const on = () => setWide(mql.matches);
    mql.addEventListener?.("change", on);
    return () => mql.removeEventListener?.("change", on);
  }, []);
  return wide;
}

export default function FernUnfurl({ label, detail = "auto", lean = 0.12, mirror = false, size = "md", className = "" }: FernUnfurlProps) {
  const still = useReducedMotion();
  const wide = useWide();
  const iterations = detail === "auto" ? (wide ? 4 : 3) : detail;
  const drawing = useMemo(() => fern(iterations, lean, mirror), [iterations, lean, mirror]);
  const deepest = drawing.layers.length - 1 || 1;

  return (
    <span
      className={`nk relative inline-block shrink-0 ${SIZES[size]} ${className}`.trim()}
      data-motion={still ? "still" : "live"}
      data-iterations={iterations}
    >
      <svg
        viewBox="0 0 100 100"
        className="block size-full overflow-visible text-open"
        role={label ? "img" : undefined}
        aria-label={label}
        aria-hidden={label ? undefined : true}
      >
        <g
          className="nk-fern-frond"
          style={{ transformOrigin: `${fx(drawing.base.x)}px ${fx(drawing.base.y)}px` } as CSSProperties}
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {drawing.layers.map((layer) => (
            <path
              key={layer.depth}
              d={layer.d}
              pathLength={1}
              data-depth={layer.depth}
              className="nk-draw"
              strokeWidth={Math.max(0.35, 1.6 - layer.depth * 0.22)}
              strokeOpacity={1 - (layer.depth / deepest) * 0.35}
              style={{ "--nk-delay": `${(layer.depth / deepest) * 0.5}s` } as CSSProperties}
            />
          ))}
        </g>
      </svg>
    </span>
  );
}
