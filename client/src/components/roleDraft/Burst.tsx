/**
 * A small gust of leaves (it was sparks until the game feel lane: fire is not
 * this world's vocabulary), drawn with CSS only (index.css, .sel-spark), so no
 * animation library ships for it. Each leaf is a box with two opposite corners
 * rounded, which is a leaf in profile; it drifts out, turns and sinks. It plays once each time `play` changes to a
 * new positive number, and draws nothing at all for someone who asked for
 * reduced motion. Decoration: hidden from a screen reader.
 */
import { useEffect, useState } from "react";

const SPARKS = 12;

export function reducedMotion(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export default function Burst({ play }: { play: number }) {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    if (!play || reducedMotion()) return;
    setShown(play);
    const id = window.setTimeout(() => setShown(0), 900);
    return () => window.clearTimeout(id);
  }, [play]);
  if (!shown) return null;
  return (
    <span aria-hidden="true" key={shown} className="pointer-events-none absolute inset-0 z-10 overflow-visible">
      {Array.from({ length: SPARKS }, (_, i) => {
        const a = (i / SPARKS) * Math.PI * 2;
        const d = 40 + (i % 3) * 16;
        return (
          <span
            key={i}
            className={`sel-spark absolute left-1/2 top-1/2 h-2 w-3 rounded-tr-full rounded-bl-full ${i % 3 === 0 ? "bg-notice" : "bg-open"}`}
            style={{
              ["--sx" as string]: `${Math.round(Math.cos(a) * d)}px`,
              ["--sy" as string]: `${Math.round(Math.sin(a) * d)}px`,
              ["--sr" as string]: `${(i % 2 ? 1 : -1) * (90 + (i % 4) * 30)}deg`,
            }}
          />
        );
      })}
    </span>
  );
}
