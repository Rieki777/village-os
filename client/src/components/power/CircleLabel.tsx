/**
 * A CIRCLE'S NAME ON THE MAP, its "forming" caption, and what hover adds.
 *
 * Moved out of `PowerMap.tsx` (2026-09-23) when that file reached 996 of its
 * 1000 lines and every one of these three texts needed the same change.
 *
 * EVERY NAME CARRIES THE GROUND AS A HALO, not only one pushed outside its
 * circle. A name is drawn over a stack of translucent discs whose tone the
 * village picks, and measured on the live village's own shape the ink came out
 * at 2.6 to 3.9 against them: 22 of 24 names under 4.5:1, and a forming
 * circle's caption at 1.6. A halo of the page's own ground is what the glyphs
 * then sit on, which is why a promoted label has always had one, and against it
 * the same names read at 5.5 and better. `paint-order` puts the stroke UNDER
 * the glyphs; without it the stroke draws over them and the text thins to
 * nothing at small sizes.
 *
 * The halo is sized from the label, not fixed: these sizes are world units and
 * the camera scales them, so a fixed width is a hairline on one circle and a
 * smear on the next.
 */
import { motion } from "framer-motion";
import { captionSize } from "./labelFit";
import type { PowerSeat } from "./types";

/** The halo under a text of this size, in the same world units. */
export function haloWidth(fontSize: number): number {
  return Math.max(1.5, fontSize * 0.16);
}

export default function CircleLabel({
  circleId,
  x,
  labelTop,
  label,
  show,
  hovered,
  drop,
  forming,
  hasChildren,
  pxPerWorld,
  morph,
  roles,
}: {
  circleId: string;
  x: number;
  labelTop: number;
  label: { lines: string[]; fontSize: number; lineHeight: number };
  /** Whether this circle is one the camera is naming at all. */
  show: boolean;
  hovered: boolean;
  /** A promoted label on a compact stage is dropped rather than piled on its neighbours. */
  drop: boolean;
  forming: boolean;
  hasChildren: boolean;
  pxPerWorld: number;
  morph: object;
  roles: PowerSeat[];
}) {
  const halo = {
    paintOrder: "stroke" as const,
    stroke: "var(--background)",
    strokeWidth: haloWidth(label.fontSize),
    strokeLinejoin: "round" as const,
  };
  const captionY = labelTop + (label.lines.length - (hasChildren ? 0 : 1)) * label.lineHeight;
  return (
    <>
      {(show || hovered) && !drop && (
        <motion.text
          animate={{ x, y: labelTop }}
          initial={false}
          transition={morph}
          textAnchor="middle"
          className="fill-foreground font-semibold pointer-events-none"
          /*
           * fontSize IS AN ATTRIBUTE HERE, NOT A STYLE, AND THAT IS THE WHOLE
           * FIX. framer-motion owns the `style` object on a motion component,
           * and a static style value that CHANGES between renders is not
           * reliably re-applied: the first render happens before the
           * ResizeObserver has measured, so pxPerWorld is 0, the label takes
           * its raw wrapLabel size, and framer wrote that; the second render
           * computed the correct size and framer kept the first one. Measured
           * live at build f045f3c: the tspan `dy` (a plain SVG attribute React
           * owns) updated to the fitted 23 while `font-size` stayed at the
           * unfitted 12, on the same element in the same render. The halo
           * attributes below are here for the same reason.
           */
          fontSize={label.fontSize}
          {...halo}
        >
          {/* x=0, NOT the circle's x, AND THAT IS A BUG FIX. The <text> is
              already moved by framer's `animate={{x, y}}`, which is a
              transform, and a tspan's `x` is ABSOLUTE inside that already
              moved frame, so setting it again put every label at twice the
              circle's x. Measured live at 9b41ae0: all 15 labels displaced,
              each by exactly its own `x * scale`. Zero re-centres each line on
              the text's own origin, which textAnchor="middle" then centres. */}
          {label.lines.map((ln, i) => (
            <tspan key={ln + i} x={0} dy={i === 0 ? 0 : label.lineHeight}>
              {ln}
            </tspan>
          ))}
        </motion.text>
      )}

      {forming && show && !drop && (
        <text
          x={x}
          y={captionY + (hasChildren ? 14 : 16)}
          textAnchor="middle"
          className="fill-foreground pointer-events-none"
          style={{
            // This caption was the worst offender on the live page twice: a
            // hard floor of 9 WORLD units measured 6px on screen, and then a
            // muted ink on a faded circle measured 1.6:1. Its floor is a
            // screen size, its ink is the same as the name's, and the fade a
            // forming circle carries is on the DISC, not on this.
            fontSize: captionSize(label.fontSize, pxPerWorld),
            ...halo,
            strokeWidth: haloWidth(captionSize(label.fontSize, pxPerWorld)),
          }}
        >
          forming
        </text>
      )}

      {/* WHAT HOVER ACTUALLY ANSWERS: is this the circle I want. Name plus the
          two counts a reader weighs before deciding to step in, so surveying
          the village no longer means entering and leaving every circle in
          turn. Pointer only, and never on the circle you are already inside. */}
      {hovered && (
        <text
          x={x}
          y={captionY + (forming ? 30 : 16)}
          textAnchor="middle"
          className="fill-muted-foreground pointer-events-none"
          style={{
            fontSize: captionSize(label.fontSize, pxPerWorld),
            ...halo,
            strokeWidth: haloWidth(captionSize(label.fontSize, pxPerWorld)),
          }}
        >
          {(() => {
            const mine = roles.filter((r) => r.circleId === circleId);
            const places = mine.reduce((n, r) => n + r.seats, 0);
            const openN = places - mine.reduce((n, r) => n + r.holderCount, 0);
            return `${mine.length} role${mine.length === 1 ? "" : "s"}${openN > 0 ? `, ${openN} open` : ""}`;
          })()}
        </text>
      )}
    </>
  );
}
