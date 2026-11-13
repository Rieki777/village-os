/**
 * A BLOOM, once, when something is chosen (game feel wave 2, 11 Nov 2026). It
 * was a gust of leaves, and sparks before that; the art direction says a
 * ceremony is a bloom and never a burst, so this is the nature kit's Seed of
 * Life opening its six petals over what was just chosen, inside 1.6s, and
 * then gone.
 *
 * It plays once each time `play` changes to a new positive number. Under
 * reduced motion it is the same drawing, still, for the same moment
 * (the kit draws its own still form). Decoration: hidden from a screen
 * reader, which hears the choice from the control itself.
 *
 * The name and the `play` contract stay, so every caller that asked for a
 * burst now gets a bloom with no other change.
 */
import { useEffect, useState } from "react";
import { SeedOfLife } from "@/components/journey/nature";

/** How long the bloom stays: the kit's petals open inside 1.6s. */
export const BLOOM_MS = 1600;

export function reducedMotion(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export default function Burst({ play, size = "md" }: { play: number; size?: "sm" | "md" }) {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    if (!play) return;
    setShown(play);
    const id = window.setTimeout(() => setShown(0), BLOOM_MS);
    return () => window.clearTimeout(id);
  }, [play]);
  if (!shown) return null;
  return (
    <span aria-hidden="true" key={shown} className="pointer-events-none absolute inset-0 z-10 grid place-items-center overflow-visible" data-bloom="">
      <SeedOfLife total={7} walked={7} bloom size={size === "sm" ? "sm" : "md"} label="" className="opacity-90" />
    </span>
  );
}
