/**
 * A small leaf, the journey kit's mark for "grown" or "kept": a sprout on a
 * reached stone, a filled seed slot, a path you chose. Inline SVG in
 * currentColor, so it takes the colour of wherever it sits. Decoration only:
 * hidden from a screen reader, which hears the state from the control itself.
 *
 * `unfurl` plays the one-time unfurl (index.css, .jw-unfurl). Pass false where
 * the leaf should simply be there, such as a still form for reduced motion.
 */
export default function Leaf({ size = 14, unfurl = true, className = "" }: { size?: number; unfurl?: boolean; className?: string }) {
  return (
    <svg viewBox="0 0 20 20" width={size} height={size} aria-hidden="true" focusable="false" className={`${unfurl ? "jw-unfurl " : ""}${className}`.trim()}>
      <path d="M3 17 C 3 9 8 3 17 3 C 17 11 11 17 3 17 Z" fill="currentColor" />
      <path d="M3.5 16.5 L 12.5 7.5" stroke="var(--card, #fff)" strokeWidth="1.2" strokeLinecap="round" opacity="0.7" fill="none" />
    </svg>
  );
}
