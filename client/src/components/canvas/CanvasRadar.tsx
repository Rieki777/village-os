/**
 * THE CANVAS RADAR: twelve axes in canvas order, five rings, one shape.
 *
 * THIS IS THE ONE RADAR R55 ALLOWS. Rye, 2026-09-24: a canvas-style 1 to 5
 * radar is an explicit exception to the no-scorecard rule, for the canvas
 * baseline only. So it plots each block's newest level on its own axis and
 * does nothing else: no number in the middle, no area, no average, no ring
 * labelled as a target. client/src/lib/canvasCopy.test.ts holds that line and
 * also holds that nothing outside the Baseline view imports this file.
 *
 * Inline SVG, because recharts is declared in package.json and imported by
 * nothing, so reaching for it would add a whole charting library to the
 * bundle for twelve lines and a polygon.
 *
 * Colour comes from `currentColor` and the theme's own utilities, so a
 * village's brand seed reaches the shape and no literal is compiled in.
 *
 * An axis with no reading yet runs to the centre and its label is set in
 * italic, and the view says so in words under the chart. The centre is below
 * the first ring on purpose: "nobody has read this yet" must not look like
 * "Absent", which is a reading somebody gave.
 */
import { CANVAS_ORDER, CANVAS_LEVELS, type CanvasBlockId, type CanvasLevel } from "@shared/governanceCanvas";

const WIDTH = 460;
const HEIGHT = 400;
const CX = WIDTH / 2;
const CY = HEIGHT / 2;
/** The radius of the outermost ring, level five. */
const RADIUS = 130;
const LABEL_GAP = 20;
/**
 * Label size in viewBox units. The chart scales to its box, so 13 read as
 * about 9px on a 390px phone, measured in Chromium; 15 is about 10px there
 * and still keeps "Stakeholders" and "Resourcing" inside the box at every
 * width, which the same measurement checked.
 */
const LABEL_SIZE = 15;

/** Degrees clockwise from twelve o'clock, one axis every thirty degrees. */
function angleOf(index: number): number {
  return ((-90 + index * (360 / CANVAS_ORDER.length)) * Math.PI) / 180;
}

function at(index: number, radius: number): [number, number] {
  const a = angleOf(index);
  return [CX + radius * Math.cos(a), CY + radius * Math.sin(a)];
}

const ringRadius = (level: number) => (RADIUS * level) / CANVAS_LEVELS.length;

const pointsFor = (radiusOf: (index: number) => number) =>
  CANVAS_ORDER.map((_, i) => at(i, radiusOf(i)).map((n) => n.toFixed(1)).join(",")).join(" ");

export function CanvasRadar({
  levels,
  description,
}: {
  levels: Record<CanvasBlockId, CanvasLevel | null>;
  /** The chart in words, block by block. It becomes the image's accessible description. */
  description: string;
}) {
  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      className="w-full max-w-md mx-auto block"
      role="img"
      aria-labelledby="canvas-radar-title canvas-radar-desc"
      data-testid="canvas-radar"
    >
      <title id="canvas-radar-title">The canvas radar, one axis per block</title>
      <desc id="canvas-radar-desc">{description}</desc>

      <g className="text-stone-300" fill="none" stroke="currentColor" strokeWidth={1}>
        {CANVAS_LEVELS.map((level) => (
          <polygon key={level} points={pointsFor(() => ringRadius(level))} />
        ))}
        {CANVAS_ORDER.map((block, i) => {
          const [x, y] = at(i, RADIUS);
          return <line key={block.id} x1={CX} y1={CY} x2={x} y2={y} />;
        })}
      </g>

      <g className="text-teal-deep">
        <polygon
          points={pointsFor((i) => ringRadius(levels[CANVAS_ORDER[i].id] ?? 0))}
          fill="currentColor"
          fillOpacity={0.16}
          stroke="currentColor"
          strokeWidth={2}
          strokeLinejoin="round"
        />
        {CANVAS_ORDER.map((block, i) => {
          const level = levels[block.id];
          if (level === null) return null;
          const [x, y] = at(i, ringRadius(level));
          return <circle key={block.id} cx={x} cy={y} r={4} fill="currentColor" />;
        })}
      </g>

      {CANVAS_ORDER.map((block, i) => {
        const [x, y] = at(i, RADIUS + LABEL_GAP);
        const cos = Math.cos(angleOf(i));
        const sin = Math.sin(angleOf(i));
        const anchor = cos > 0.3 ? "start" : cos < -0.3 ? "end" : "middle";
        const dy = sin > 0.3 ? 12 : sin < -0.3 ? -2 : 4;
        const unread = levels[block.id] === null;
        return (
          <text
            key={block.id}
            x={x}
            y={y + dy}
            textAnchor={anchor}
            fontSize={LABEL_SIZE}
            fill="currentColor"
            className={unread ? "text-stone-500 italic" : "text-stone-800 font-medium"}
          >
            {block.name}
          </text>
        );
      })}
    </svg>
  );
}
