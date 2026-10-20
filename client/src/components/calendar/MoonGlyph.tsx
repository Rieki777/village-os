/**
 * A small moon at a given phase (0 new, 0.5 full), drawn, so every cell of
 * the calendar shows the same moon on every platform. Waxing lights the
 * right side in the north and the left in the south, which is how the sky
 * looks from each.
 */
export default function MoonGlyph({
  phase,
  size = 14,
  hemisphere = "north",
  className,
  title,
}: {
  phase: number;
  size?: number;
  hemisphere?: "north" | "south";
  className?: string;
  title?: string;
}) {
  const p = ((phase % 1) + 1) % 1;
  const r = 10;
  // The terminator is an ellipse whose x-radius runs from +r (new) through 0
  // (quarter) to -r (full) and back; the lit side flips at full.
  const waxing = p < 0.5;
  const k = Math.cos(p * 2 * Math.PI); // 1 at new, -1 at full
  const litRight = hemisphere === "north" ? waxing : !waxing;
  // Dark side dark enough to read at 12px on a pale cell; lit side cream.
  // The fallbacks are the platform neutrals index.css gives the same tokens
  // (--color-teal-band, --color-cream, --foreground), because the --tone-*
  // pair is only emitted for a village with a seed: an untouched fork draws
  // a grey moon, never somebody else's teal.
  const dark = "var(--tone-brand-band, #262626)";
  const light = "var(--tone-cream, #f2f2f2)";
  const stroke = "var(--foreground, #171717)";
  // Two half discs and an ellipse: the lit half, plus an ellipse of the
  // dark or lit colour that carves the terminator.
  const half = litRight
    ? `M 12 2 A ${r} ${r} 0 0 1 12 22 Z`
    : `M 12 2 A ${r} ${r} 0 0 0 12 22 Z`;
  const ellipseFill = k > 0 ? dark : light; // before quarter, the ellipse eats into the lit half
  const rx = Math.abs(k) * r;
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={className}
      role={title ? "img" : "presentation"}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      <circle cx="12" cy="12" r={r} fill={dark} stroke={stroke} strokeOpacity="0.35" strokeWidth="1" />
      <path d={half} fill={light} />
      {rx > 0.2 && <ellipse cx="12" cy="12" rx={rx} ry={r} fill={ellipseFill} />}
    </svg>
  );
}
