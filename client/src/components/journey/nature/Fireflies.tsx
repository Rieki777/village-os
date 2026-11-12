/**
 * FIREFLIES: five to eight points of warm light around the one next act, or
 * inside an illustration (nature kit, game feel wave 2).
 *
 * They sit where a sunflower puts its seeds (Vogel's golden-angle model,
 * `fireflySpots`), drift and pulse slowly, and rest after about twenty
 * seconds without input. Under reduced motion they are a still drawing of
 * the same lights in the same places.
 *
 * Phone and desktop each at their best: with a fine pointer that can hover,
 * the lights drift in toward the act when it is hovered or focused; on a
 * touch screen at most five stay, and a press gathers them.
 *
 * Wrap the act (`<Fireflies><button/></Fireflies>`), or give no child and
 * place it inside a positioned illustration. The lights are decoration only
 * (aria-hidden): the act says what it does.
 */
import { useEffect, type CSSProperties, type ReactNode } from "react";
import { holdPageLight } from "@/lib/pageLight";
import { useReducedMotion } from "@/components/natural/useReducedMotion";
import { fireflySpots } from "./geometry";
import { useRest } from "./useRest";
import "./nature.css";

export interface FirefliesProps {
  /** How many lights, held to five to eight. */
  count?: number;
  /** The act they gather around. Absent, the layer fills its positioned parent. */
  children?: ReactNode;
  /** A full-width act (a block button) rather than an inline one. */
  block?: boolean;
  /** Larger lights for an illustration field. */
  size?: "md" | "lg";
  /** Lift the spiral off the act's centre: 0 sits on it, 1 rings its edge. */
  inner?: number;
  /** How far past the act's edge the outermost light reaches. */
  reach?: number;
  className?: string;
}

export default function Fireflies({ count = 6, children, block = false, size = "md", inner, reach, className = "" }: FirefliesProps) {
  const still = useReducedMotion();
  const resting = useRest(!still);
  const spots = fireflySpots(count, inner, reach);
  const motion = still ? "still" : "live";
  // Around an act, these are the page's one light: the shell's lights go still while they show (lib/pageLight.ts).
  const isAct = children !== undefined;
  useEffect(() => (isAct ? holdPageLight() : undefined), [isAct]);

  const layer = (
    <span aria-hidden="true" className="nk-ff-layer" data-testid="fireflies" data-count={spots.length}>
      {spots.map((s, i) => (
        <span
          key={i}
          className="nk-ff"
          style={{ "--nk-fx": s.fx.toFixed(3), "--nk-fy": s.fy.toFixed(3) } as CSSProperties}
        >
          <span
            className="nk-ff-dot"
            style={
              {
                "--nk-drift": `${s.drift}s`,
                "--nk-pulse": `${s.pulse}s`,
                "--nk-delay": `${s.delay.toFixed(2)}s`,
                "--nk-dx": `${((i % 3) - 1) * 4}px`,
                "--nk-dy": `${i % 2 ? -5 : 5}px`,
              } as CSSProperties
            }
          />
        </span>
      ))}
    </span>
  );

  if (children === undefined) {
    return (
      <span className={`nk absolute inset-0 ${className}`.trim()} data-motion={motion} data-rest={resting ? "true" : "false"} aria-hidden="true">
        {layer}
      </span>
    );
  }
  return (
    <span
      className={`nk nk-ff-host ${className}`.trim()}
      data-motion={motion}
      data-rest={resting ? "true" : "false"}
      data-block={block ? "true" : "false"}
      data-size={size}
    >
      {layer}
      {children}
    </span>
  );
}
