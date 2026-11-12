/**
 * THE HARVEST, on Friday (Phase C, the Gathering): Monday's priorities read
 * back as plants. A priority Monday kept is a seed; on Friday the room says
 * how it grew, and the words are the garden's:
 *
 *   done     flowered     a flower open on its stem
 *   partly   in bud       a closed bud, carried to Monday
 *   carried  seed kept    the seed itself, carried to Monday
 *   (none)   a seed       not read back yet
 *
 * The answer underneath is the same three outcomes the series has always
 * kept (`PRIORITY_OUTCOMES`, shared/sessionTemplates.ts), so the count of
 * the season's priorities, the carry to Monday and the record do not move.
 * Nothing is marked as failed: what did not grow goes back to Monday's soil.
 * The plants describe the work, never a person, and nothing sums them up.
 *
 * Drawn with two strokes and a fill in the theme's own tokens: the flower in
 * the earned gold, the bud and the seed in the living green. Still by nature:
 * a plant does not move here, so there is nothing for reduced motion to stop.
 */
import { msg } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import type { MessageDescriptor } from "@lingui/core";
import type { PriorityOutcome } from "@shared/sessionTemplates";

export type HarvestStage = "seed" | "bud" | "flower";

/** Which plant an outcome grows into; a priority not read back yet is still a seed. */
export const STAGE_OF: Record<PriorityOutcome, HarvestStage> = {
  done: "flower",
  partly: "bud",
  carried: "seed",
};

export function harvestStage(outcome: PriorityOutcome | null): HarvestStage {
  return outcome ? STAGE_OF[outcome] : "seed";
}

/** The harvest's own word for each outcome, the button and the chip. */
export const HARVEST_WORD: Record<PriorityOutcome, MessageDescriptor> = {
  done: msg({
    message: "Flowered",
    context: "friday harvest, a priority that was done",
  }),
  partly: msg({
    message: "In bud",
    context: "friday harvest, a priority partly done, carried to monday",
  }),
  carried: msg({
    message: "Seed kept",
    context: "friday harvest, a priority not started, carried to monday",
  }),
};

export const HARVEST_UNREAD: MessageDescriptor = msg({
  message: "A seed, not read back yet",
  context: "friday harvest, a priority with no answer yet",
});

export const HARVEST_SOIL: MessageDescriptor = msg({
  message:
    "Nothing is marked as failed. What did not grow goes back to Monday's soil.",
  context: "friday harvest, the line under the read back",
});

/**
 * The harvest's word for an outcome, or "a seed, not read back yet". It reads
 * the descriptors above through the runtime, which is also what lets the build
 * compile them ahead of time (precompileEnglish only rewrites a file that
 * imports the runtime).
 */
export function HarvestWord({ outcome }: { outcome: PriorityOutcome | null }) {
  const { i18n } = useLingui();
  return <>{i18n._(outcome ? HARVEST_WORD[outcome] : HARVEST_UNREAD)}</>;
}

/** The line under the read back. */
export function HarvestSoil({ className = "" }: { className?: string }) {
  const { i18n } = useLingui();
  return <p className={className}>{i18n._(HARVEST_SOIL)}</p>;
}

export default function HarvestPlant({
  outcome,
  className = "",
}: {
  outcome: PriorityOutcome | null;
  className?: string;
}) {
  const stage = harvestStage(outcome);
  return (
    <svg
      viewBox="-12 -14 24 28"
      className={`size-7 shrink-0 ${className}`.trim()}
      aria-hidden="true"
      data-stage={stage}
      data-testid="harvest-plant"
    >
      {stage === "flower" ? (
        <g className="text-notice" stroke="currentColor" fill="currentColor">
          <path
            d="M0 12 V1"
            fill="none"
            strokeWidth={1.4}
            className="text-open"
            stroke="currentColor"
          />
          {[0, 72, 144, 216, 288].map(a => (
            <ellipse
              key={a}
              cx={0}
              cy={-6}
              rx={2.4}
              ry={4}
              fillOpacity={0.35}
              strokeWidth={0.9}
              transform={`rotate(${a} 0 -2)`}
            />
          ))}
          <circle cx={0} cy={-2} r={1.8} />
        </g>
      ) : stage === "bud" ? (
        <g
          className="text-open"
          stroke="currentColor"
          fill="none"
          strokeWidth={1.4}
        >
          <path d="M0 12 V0" />
          <path
            d="M0 -1 C -3.5 -4 -2.5 -9 0 -11 C 2.5 -9 3.5 -4 0 -1 Z"
            fill="currentColor"
            fillOpacity={0.3}
          />
          <path d="M0 6 C 3 5 5 3 5.5 1" />
        </g>
      ) : (
        <g className="text-open" stroke="currentColor" strokeWidth={1.4}>
          <ellipse
            cx={0}
            cy={4}
            rx={3.6}
            ry={5}
            fill="currentColor"
            fillOpacity={outcome ? 0.3 : 0}
          />
        </g>
      )}
    </svg>
  );
}
