/**
 * THE FIELD OF SILHOUETTES: participation, drawn as the village showing up.
 *
 * The founder's design: "for quorum a small icon with many silhouettes of
 * people that fill up as we get more of the quorum (what % of all voice
 * tokens/voters) met". This is that icon, and four decisions carry it.
 *
 * A FIGURE IS A SHARE, NEVER A PERSON. Twenty figures, five percent of the
 * frozen total weight each, fixed for every village. The reasoning lives with
 * the arithmetic in `voteBars.ts` under `CROWD_FIGURES`, and the short version
 * is that under `token` weight mode one member can carry a hundred times
 * another's weight, so a field of one figure per member would fill by heads
 * and state something the ballot does not count. `crowdFill` says how full
 * each figure stands and `crowdFront` says where the wipe's edge is, so this
 * drawing has no arithmetic of its own.
 *
 * IT IS GREY, ALWAYS. Participation is not agreement. A field that turned
 * green when quorum cleared would tell a member "it passed" about a number
 * that only says the question is answerable. Its met state is carried by the
 * notch, by the mark glyph the caller draws, and by the sentence, which is
 * what the accessibility rule asks for anyway.
 *
 * THE NOTCH IS PLACED BY THE SAME FUNCTION AS THE FILL. Both go through
 * `crowdFront`, so the line sits exactly where the fill front would sit at the
 * threshold. Positioning the notch as a plain percentage of the row's width
 * would drift by however much gap sits between the figures, and by a different
 * amount at every value.
 *
 * MOTION. The field wipes when a vote lands, which is motion that answers the
 * person (`docs/modules/natural-interface.md`). It is one transform on one
 * clip rectangle, so nothing animates per figure, and the transition is
 * dropped for anyone who asked for less motion. The value still lands.
 */
import { useId } from "react";
import { CROWD_FIGURES, crowdFront, pctText } from "./voteBars";
import { useReducedMotion } from "@/components/natural";

/** One figure's cell: 7 units of body, 3 of air. */
const FIG_W = 7;
const PITCH = 10;
const BOX_H = 24;
const FIELD_W = (CROWD_FIGURES - 1) * PITCH + FIG_W;
/** The smallest visible fill, in viewBox units. See the note where it is used. */
const MIN_FRONT = 1.4;

/**
 * One silhouette in a 7 by 23 box: a head, and shoulders that fall to the
 * ground. Two subpaths in one string, so a figure is one element.
 */
const FIGURE =
  "M6.1 3.4A2.6 2.6 0 1 1 0.9 3.4A2.6 2.6 0 1 1 6.1 3.4Z" +
  "M0.3 23.7V13.6C0.3 9.2 1.7 7.4 3.5 7.4S6.7 9.2 6.7 13.6V23.7Z";

/**
 * Grey, and grey again. The pair is a contrast step and not a hue step, so the
 * field reads the same in greyscale as it does in colour.
 */
/*
 * FROM THE THEME'S TOKENS (decider calm, Phase D). These were fixed greys
 * measured on a light page, and on the night ground the pair inverted: the
 * silent figures drew pale and bright and the spoken ones dark, so the field
 * read the wrong way round. The step stays a contrast step and never a hue:
 * silent is the raised surface on its edge, spoken is the dim ink on the full
 * ink, and the notch is the ink on a halo of the ground, on either ground.
 */
const SILENT_FILL = "var(--muted)";
const SILENT_EDGE = "var(--border)";
const SPOKEN_FILL = "var(--muted-foreground)";
const SPOKEN_EDGE = "var(--foreground)";
const NOTCH = "var(--foreground)";
const NOTCH_HALO = "var(--background)";

const positions = Array.from({ length: CROWD_FIGURES }, (_, i) => i * PITCH);

export default function QuorumField({
  /** Where the fill stands. Take it off `quorumBar`, never off a percentage
   *  the caller worked out. */
  valuePct,
  /** Where the notch stands. Null draws no notch, for a field that averages
   *  several votes and therefore has no single bar to reach. */
  thresholdPct,
  /** Names the picture for a screen reader, before the reading. */
  title,
  /** What the field says, in words. `quorumBar` writes this sentence. */
  reading,
  /** The village's own numbers, read out after the sentence. */
  detail,
  /** The card size: smaller, for a list of decisions in flight. */
  compact = false,
}: {
  valuePct: number;
  thresholdPct: number | null;
  title: string;
  reading: string;
  detail: string;
  compact?: boolean;
}) {
  // A page can carry a dozen of these, and a shared clip id would leave
  // eleven of them wearing the first one's fill.
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const reduced = useReducedMotion();
  const front = crowdFront(valuePct);
  const notch = thresholdPct == null ? null : crowdFront(thresholdPct);
  const notchX = notch === null ? null : notch.figure * PITCH + notch.within * FIG_W;

  // SOMEBODY HAS SPOKEN IS A DIFFERENT PICTURE FROM NOBODY HAS SPOKEN.
  //
  // One voice of weight 1 in a village of 400 is 0.05 of one figure, which is
  // half a pixel at any size a card can spare, so the exact drawing renders an
  // empty field beside a sentence saying a vote has been cast. The arithmetic
  // stays exact in `crowdFill`; this is a rendering floor of 1.4 units, which
  // is 0.7% of the row, and it can never carry the fill to the notch: a short
  // quorum must never look met, so the floor is capped short of the line.
  const rawX = front.figure * PITCH + front.within * FIG_W;
  const floor = notchX === null ? MIN_FRONT : Math.max(0, Math.min(MIN_FRONT, notchX - 0.6));
  const frontX = rawX > 0 ? Math.max(rawX, floor) : 0;

  return (
    <div
      role="progressbar"
      aria-valuenow={Math.round(valuePct)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={`${title}: ${pctText(valuePct)}. ${reading}. ${detail}`}
    >
      <svg
        viewBox={`0 0 ${FIELD_W} ${BOX_H}`}
        aria-hidden="true"
        focusable="false"
        style={{
          display: "block",
          width: "100%",
          maxWidth: compact ? 224 : 320,
          // The height comes from the viewBox's own ratio. `aspectRatio` says
          // the same thing a second way, for a browser that does not derive an
          // intrinsic ratio from a viewBox on its own.
          aspectRatio: `${FIELD_W} / ${BOX_H}`,
        }}
      >
        <defs>
          <clipPath id={`gov-field-${uid}`}>
            {/* One rectangle, scaled from the left edge. The whole field wipes
                on one transform, so twenty figures cost one animation and a
                member on a slow phone still sees it land.

                The rect sits at 0,0 AND the viewBox starts at 0,0, so every
                plausible reading of `transform-box` puts the origin in the
                same place and the wipe cannot start from the middle on a
                browser that resolves the box differently. */}
            <rect
              x="0"
              y="0"
              width={FIELD_W}
              height={BOX_H}
              style={{
                transform: `scaleX(${frontX / FIELD_W})`,
                transformBox: "view-box",
                transformOrigin: "0 0",
                transition: reduced ? "none" : "transform 500ms ease-out",
              }}
            />
          </clipPath>
        </defs>

        {/* The village that could speak. Drawn whole, always, so the field has
            a size before anybody has voted. */}
        <g style={{ fill: SILENT_FILL, stroke: SILENT_EDGE }} strokeWidth="0.5">
          {positions.map((x) => (
            <path key={x} d={FIGURE} transform={`translate(${x} 0)`} />
          ))}
        </g>

        {/* The weight that has spoken, cut to the front. */}
        <g style={{ fill: SPOKEN_FILL, stroke: SPOKEN_EDGE }} strokeWidth="0.5" clipPath={`url(#gov-field-${uid})`}>
          {positions.map((x) => (
            <path key={x} d={FIGURE} transform={`translate(${x} 0)`} />
          ))}
        </g>

        {/* The bar this vote has to reach. A line, so it survives greyscale,
            and the caller prints the number it stands for.

            It carries a pale halo because a dark line over the dark spoken
            figures disappeared exactly when it mattered most: once a village
            passes its quorum, "how far past the bar" is the reading, and the
            first drive of this field lost it at 47%. The halo is invisible in
            the air between figures and does its work over a filled one. */}
        {notchX !== null && (
          <>
            <line x1={notchX} y1={0} x2={notchX} y2={BOX_H} style={{ stroke: NOTCH_HALO }} strokeWidth="3.4" />
            <line
              x1={notchX}
              y1={0}
              x2={notchX}
              y2={BOX_H}
              style={{ stroke: NOTCH }}
              strokeWidth="1.2"
              strokeOpacity="0.85"
            />
          </>
        )}
      </svg>
    </div>
  );
}

/**
 * ONE FIGURE, alone, for a surface that talks about weight without drawing a
 * whole ballot. It is the same silhouette, so a member who learns what the
 * field means on a decision reads the same shape wherever else it turns up.
 */
export function CrowdFigure({ size = 20, className = "" }: { size?: number; className?: string }) {
  return (
    <svg
      viewBox="0 0 7 24"
      width={(size * 7) / 24}
      height={size}
      aria-hidden="true"
      focusable="false"
      className={className}
      style={{ display: "block", flex: "0 0 auto" }}
    >
      <path d={FIGURE} style={{ fill: SPOKEN_FILL, stroke: SPOKEN_EDGE }} strokeWidth="0.5" />
    </svg>
  );
}
