/**
 * A small burst of sparks, drawn with CSS only (index.css, .sel-spark), so no
 * animation library ships for it. It plays once each time `play` changes to a
 * new positive number, and draws nothing at all for someone who asked for
 * reduced motion. Decoration: hidden from a screen reader.
 */
import { useEffect, useState } from "react";

const SPARKS = 14;

export function reducedMotion(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export default function Burst({ play }: { play: number }) {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    if (!play || reducedMotion()) return;
    setShown(play);
    const id = window.setTimeout(() => setShown(0), 1000);
    return () => window.clearTimeout(id);
  }, [play]);
  if (!shown) return null;
  return (
    <span aria-hidden="true" key={shown} className="pointer-events-none absolute inset-0 z-10 overflow-visible">
      {Array.from({ length: SPARKS }, (_, i) => {
        const a = (i / SPARKS) * Math.PI * 2;
        const d = 46 + (i % 3) * 18;
        return (
          <span
            key={i}
            className={`sel-spark absolute left-1/2 top-1/2 size-2 rounded-full ${i % 2 ? "bg-notice" : "bg-primary"}`}
            style={{ ["--sx" as string]: `${Math.round(Math.cos(a) * d)}px`, ["--sy" as string]: `${Math.round(Math.sin(a) * d)}px` }}
          />
        );
      })}
    </span>
  );
}
