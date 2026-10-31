/**
 * THE SEATED FIGURE. A person sitting cross-legged, drawn as a soft
 * silhouette, with the seven chakras set along the spine from the root to the
 * crown. Each one is a point of light whose brightness the shared sit sets.
 *
 * While the room sits, one light climbs slowly from the root to the crown and
 * falls back, a full rise and fall every WAVE_SECS, so the eye has something
 * slow to rest on. When the bowl rings, the lights fill from the root up to
 * the crown, then a brighter pulse falls from the crown back to the root, and
 * all seven rest lit.
 *
 * The chakra colours are traditional and the same in every village, so they
 * are tokens with fallbacks (`--chakra-1` to `--chakra-7`): a village that
 * wants its own can set them, and one that never does gets the rainbow.
 */
import { SIT_SETTLE_SECS, type SitMoment } from "@shared/sessions";

/** Root to crown. */
export const CHAKRAS = [
  { name: "Root", y: 190, color: "var(--chakra-1, #d8453a)" },
  { name: "Sacral", y: 166, color: "var(--chakra-2, #ec8a2f)" },
  { name: "Solar plexus", y: 140, color: "var(--chakra-3, #f2c53d)" },
  { name: "Heart", y: 110, color: "var(--chakra-4, #4fae6a)" },
  { name: "Throat", y: 70, color: "var(--chakra-5, #3d9fd9)" },
  { name: "Third eye", y: 40, color: "var(--chakra-6, #6a62d9)" },
  { name: "Crown", y: 16, color: "var(--chakra-7, #a86ad8)" },
] as const;

/** Seconds for one climb from root to crown and back down. */
export const WAVE_SECS = 16;

const DIM = 0.2;
const REST = 0.7;
const TOP = CHAKRAS.length - 1;

/** A point of light at `pos`, falling off over about a chakra and a half. */
const spot = (i: number, pos: number) => Math.max(0, 1 - Math.abs(i - pos) / 1.5);

/**
 * How bright each chakra is, root first, from 0 to 1. Pure, so the motion
 * can be tested without a clock.
 */
export function chakraLight(m: SitMoment, reduced: boolean): number[] {
  const all = (v: number) => CHAKRAS.map(() => v);
  if (m.state === "idle") return all(DIM);
  if (reduced) return all(m.state === "sitting" ? 0.55 : 0.85);
  if (m.state === "sitting") {
    const phase = (m.elapsed % WAVE_SECS) / WAVE_SECS;
    const pos = (phase < 0.5 ? phase * 2 : (1 - phase) * 2) * TOP;
    return CHAKRAS.map((_, i) => Math.max(DIM, spot(i, pos)));
  }
  const half = SIT_SETTLE_SECS / 2;
  if (m.sinceEnd < half) {
    // Filling upward: everything below the front is lit, the front glows in.
    const front = (m.sinceEnd / half) * (TOP + 1);
    return CHAKRAS.map((_, i) => Math.max(DIM, Math.min(1, front - i)));
  }
  if (m.sinceEnd < SIT_SETTLE_SECS) {
    // A brighter pulse falling from the crown to the root, over a lit body.
    const pos = TOP - ((m.sinceEnd - half) / half) * TOP;
    return CHAKRAS.map((_, i) => Math.max(REST, spot(i, pos)));
  }
  return all(REST);
}

export default function ChakraFigure({ light, motion }: { light: number[]; motion: boolean }) {
  const ease = motion ? "opacity 400ms linear, r 400ms linear" : "none";
  return (
    <svg viewBox="0 0 200 250" className="h-64 w-auto sm:h-72" aria-hidden="true">
      <defs>
        <filter id="chakra-blur" x="-100%" y="-100%" width="300%" height="300%">
          <feGaussianBlur stdDeviation="5" />
        </filter>
      </defs>
      {/* The body: head, then shoulders, arms resting on the knees and folded legs in one shape. */}
      <g className="fill-foreground/10 stroke-notice/50" strokeWidth={1.2}>
        <circle cx={100} cy={42} r={16} />
        <path d="M94 58 L106 58 L107 68 Q128 70 136 82 Q144 96 145 120 Q148 150 158 170 Q176 184 181 204 Q184 228 150 234 L50 234 Q16 228 19 204 Q24 184 42 170 Q52 150 55 120 Q56 96 64 82 Q72 70 93 68 Z" />
      </g>
      {/* Where the arms part from the body, so the figure reads as seated. */}
      <g className="fill-none stroke-notice/30" strokeWidth={1}>
        <path d="M72 96 Q72 150 90 192" />
        <path d="M128 96 Q128 150 110 192" />
        <path d="M42 214 Q100 196 158 214" />
      </g>
      {/* A faint line of the spine, so the lights read as one channel. */}
      <line x1={100} y1={16} x2={100} y2={190} className="stroke-notice/20" strokeWidth={1} />
      {CHAKRAS.map((c, i) => {
        const b = light[i] ?? DIM;
        return (
          <g key={c.name}>
            <circle cx={100} cy={c.y} r={6 + 9 * b} filter="url(#chakra-blur)" style={{ fill: c.color, opacity: 0.75 * b, transition: ease }} />
            <circle cx={100} cy={c.y} r={5} style={{ fill: c.color, opacity: 0.35 + 0.65 * b, transition: ease }} />
          </g>
        );
      })}
    </svg>
  );
}
