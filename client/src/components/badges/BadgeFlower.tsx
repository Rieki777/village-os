/**
 * THE BADGE FLOWER: a member's badges as petals round their portrait.
 *
 * Rye, 2026-10-30: the badges and powers a member holds sit on the edge of the
 * profile picture as petals, so the portrait reads as a flower, and clicking
 * the flower opens their whole roster. Where each petal goes is pure geometry
 * in shared/badgeFlower.ts; this file only draws it and opens the roster.
 *
 * THE PARENT IS THE PORTRAIT'S SQUARE, `relative`, and the flower overhangs it.
 * The geometry's portrait edge (PORTRAIT_R) is the XP ring's outer edge, which
 * is half of ProfileHero's 260 box, and the flower's box is 2 * VIEW_R. So the
 * flower is VIEW_R / PORTRAIT_R of the square and hangs past each side by the
 * difference. The portrait and the ring are drawn AFTER this and above it, and
 * they let clicks fall through to this button, so a tap anywhere on the flower,
 * face included, opens the roster.
 *
 * A PHONE SHOWS FEWER PETALS AND SAYS HOW MANY MORE. The 150px portrait cannot
 * carry a hundred legible petals, so it draws one even ring of the first
 * PHONE_CAP and a "+87" chip at the top left, opposite the Gene Keys seal and
 * lifted above the portrait; the wide one draws up to DESKTOP_CAP. Both are in
 * the DOM and CSS picks one, so there is no width read and no flash.
 *
 * Colours are the dashboard's tokens, one per badge kind. A petal knows its
 * kind already, which is the seam Rick's later idea (genres forming their own
 * sacred-geometry figures) plugs into.
 */
import { useReducedMotion, m } from "framer-motion";
import { PORTRAIT_R, VIEW_R, capPetals, flowerLayout, petalPath } from "@shared/badgeFlower";

export interface FlowerBadge {
  id: string;
  name: string;
  kind: string;
  description?: string | null;
  featured?: boolean;
}

/** One even ring on a phone. */
export const PHONE_CAP = 13;
/** A full sunflower on a wide screen; more than this is a count. */
export const DESKTOP_CAP = 144;

/** Each kind's petal colour, from the dashboard's own tokens. */
export function petalColour(kind: string): string {
  switch (kind) {
    case "earned":
      return "var(--color-dash-gold)";
    case "granted":
      return "var(--color-dash-voice)";
    case "self":
      return "var(--color-dash-thanks)";
    case "hypha":
      return "var(--color-dash-session)";
    default:
      return "var(--color-dash-gold-lit)";
  }
}

/** How far the flower hangs past the portrait's square, as a percentage of it. */
const OVERHANG = `${(((VIEW_R - PORTRAIT_R) / (2 * PORTRAIT_R)) * 100).toFixed(2)}%`;

function Petals({ badges, cap, className }: { badges: FlowerBadge[]; cap: number; className: string }) {
  const still = useReducedMotion();
  const { shown, more } = capPetals(badges, cap);
  const { petals } = flowerLayout(shown);
  return (
    <span className={className}>
      <svg viewBox={`${-VIEW_R} ${-VIEW_R} ${2 * VIEW_R} ${2 * VIEW_R}`} className="h-full w-full overflow-visible" aria-hidden="true">
        {petals.map((p) => (
          <m.g
            key={p.item.id}
            initial={still ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.35, delay: still ? 0 : Math.min(p.index, 40) * 0.015 }}
          >
            <path
              d={petalPath(p.length, p.width)}
              transform={`translate(${p.x} ${p.y}) rotate(${p.angle})`}
              fill={petalColour(p.item.kind)}
              stroke={p.item.featured ? "var(--color-dash-gold-lit)" : "var(--color-dash-gold-edge)"}
              strokeWidth={p.item.featured ? 2 : 1}
              data-kind={p.item.kind}
            >
              <title>{p.item.name}</title>
            </path>
          </m.g>
        ))}
      </svg>
      {more > 0 ? (
        <span
          aria-hidden="true"
          className="absolute left-[3%] top-[3%] z-10 rounded-full border-2 border-background bg-dash-chip px-2 py-0.5 text-xs font-bold text-dash-gold-lit"
        >
          +{more}
        </span>
      ) : null}
    </span>
  );
}

export default function BadgeFlower({
  badges,
  label,
  onOpen,
}: {
  badges: FlowerBadge[];
  /** What the button says to a screen reader, e.g. "Your badges, 12 held. Open the roster." */
  label: string;
  onOpen: () => void;
}) {
  if (badges.length === 0) return null;
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={label}
      aria-haspopup="dialog"
      data-testid="badge-flower"
      style={{ inset: `-${OVERHANG}` }}
      className="absolute rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dash-gold-lit"
    >
      <Petals badges={badges} cap={PHONE_CAP} className="absolute inset-0 sm:hidden" />
      <Petals badges={badges} cap={DESKTOP_CAP} className="absolute inset-0 hidden sm:block" />
    </button>
  );
}
