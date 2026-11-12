/**
 * THE TWO PICTURES, drawn.
 *
 * One picture for agreement among those who voted, one for participation
 * against the whole electorate, and never a third that merges them. The
 * arithmetic and the wording live in voteBars.ts, tested; this file is the
 * drawing, and its only job is to keep the two apart on the page as firmly as
 * they are kept apart in the module.
 *
 * THE FOUNDER'S DESIGN, which is the spec:
 *
 *   > "for quorum a small icon with many silhouettes of people that fill up as
 *   > we get more of the quorum (what % of all voice tokens/voters) met and
 *   > unity (what % for or against) is a moon so a 80% threshold would show a
 *   > red line needing the moon to get to that 80% illumination (if first
 *   > person votes yes we're at 100% moon illumination but very little of the
 *   > silhouettes, etc."
 *
 * The last clause is the whole teaching, and it is why there are two shapes
 * and not two bars. A FULL MOON OVER AN ALMOST EMPTY FIELD is a picture a
 * member reads once and never has to be taught again: everyone who spoke
 * agrees, and hardly anyone has spoken. Two bars of different lengths say the
 * same thing and say it in a language that has to be learned. That sentence
 * ships on the page, in the explainer under both pictures.
 *
 * THIS SUPERSEDES THE EARLIER RULING IN THIS FILE, deliberately. The previous
 * comment argued that `MoonProgress` was for completion displays and that a
 * disc had nowhere to put a threshold. The second half was the real objection
 * and it is now false: `terminatorPath` draws the terminator the moon WOULD
 * have at the threshold, so the line and the lit edge are one curve at two
 * values, and the moon crossing it is exactly the number crossing.
 *
 * WHY THE FIELD IS ALWAYS GREY. It is tempting to turn it green when it
 * clears, and that is the bug: green on this page means "this is carrying",
 * and a met quorum means only that enough people showed up for the question to
 * be answerable. Its met state is carried by the notch, the check mark and the
 * sentence, which is what the accessibility rule asks for anyway.
 *
 * WHY A CONSENT BALLOT HAS NO MOON. `dialsForMethod` stores `unityPct: 0` for
 * consent and `evaluateBallot` returns on objections before unity is read at
 * all, so a moon there would draw a threshold that decides nothing. The
 * objection state stands in its place, beside the field, which DOES apply.
 * `objectionState` in voteBars.ts holds that reading.
 *
 * ACCESSIBILITY. Each picture is a `progressbar` with aria-valuenow and an
 * accessible name that already contains the number and the verdict, so a
 * screen reader never has to infer anything from a colour or a shape. The
 * threshold is drawn AND named in words. Every transition is dropped for
 * anyone who asked for less motion, and the value still lands.
 */
import { Check, Minus, X } from "lucide-react";
import type { BallotMethod, BallotTallies } from "@shared/governanceEngine";
import { MoonProgress } from "@/components/natural";
import InfoTip from "@/components/InfoTip";
import QuorumField from "./QuorumField";
import {
  objectionState,
  pctText,
  quorumBar,
  spoken,
  unityBar,
  weightText,
  type BarMark,
  type BarReading,
} from "./voteBars";

const MARK_ICON = { met: Check, short: X, none: Minus } as const;
const MARK_TONE = { met: "text-open", short: "text-destructive", none: "text-muted-foreground" } as const;

/**
 * A new moon with nobody yet decided is NOT zero percent agreement, and
 * printing "0%" there is the same lie as painting it red: it tells a member
 * the village disagreed about a question nobody has answered. Quorum keeps its
 * zero, because zero of the weight really has spoken.
 */
const unityValueText = (bar: BarReading): string =>
  bar.mark === "none" ? "none yet" : pctText(bar.valuePct);

/** The one sentence that teaches the whole system, in the founder's own case. */
const TWO_PICTURES =
  "Two pictures, because a vote asks two questions. If one member votes yes and nobody else has voted yet, the moon is full and the field is nearly empty: everyone who took a side agrees, and hardly any of the village has spoken. Abstaining fills a silhouette and leaves the moon alone.";

/**
 * The same lesson on a ballot that has no moon. Saying "two pictures" over one
 * picture teaches a member to look for something this method never draws.
 */
const ONE_PICTURE =
  "One picture, because a consent decision does not count agreement. It carries when enough of the village has spoken and nothing stands in the way. Abstaining fills a silhouette and takes no side.";

const UNITY_TIP =
  "Of the weight that took a side, how much sided yes. The moon fills with that share, and the dashed line is where this vote needs it to reach. People who abstained are left out of this number on purpose.";

const QUORUM_TIP =
  "How much of the frozen electorate has voted, counting abstentions. Each silhouette is a twentieth of the frozen weight, so a member carrying more weight fills more of the field. This is how much showed up, never how much agreed.";

const CONSENT_TIP =
  "This is a consent decision. It does not count how many agree, so it has no moon. It carries unless somebody names a consequence the village should avoid.";

function Heading({
  title,
  tip,
  mark,
  value,
}: {
  title: string;
  tip: string;
  mark: BarMark;
  /** The percent beside the picture. Consent has none, so it passes null. */
  value: string | null;
}) {
  const Mark = MARK_ICON[mark];
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-sm font-semibold text-foreground">
        {title}
        <InfoTip tip={tip} label={`What ${title.toLowerCase()} means`} />
      </span>
      <span className="flex items-center gap-1.5 text-sm font-bold tabular-nums text-foreground">
        <Mark className={`w-4 h-4 ${MARK_TONE[mark]}`} aria-hidden="true" />
        {value}
      </span>
    </div>
  );
}

/** The agreement moon, with the line it has to reach drawn on the disc. */
function UnityMoon({ bar, size }: { bar: BarReading; size: number }) {
  return (
    <MoonProgress
      value={bar.valuePct / 100}
      size={size}
      showNumber={false}
      showRing={false}
      label="Agreement"
      threshold={bar.thresholdPct / 100}
      thresholdTone={bar.mark}
      thresholdLabel={`This vote needs ${pctText(bar.thresholdPct)}`}
      description={bar.reading}
    />
  );
}

export interface VoteResultProps {
  tallies: BallotTallies;
  totalWeight: number;
  unityPct: number;
  quorumPct: number;
  method: BallotMethod;
  electorateCount: number;
  votedCount: number;
  /** Consent only: objections still standing open. Ignored elsewhere. */
  openObjections?: number;
}

export default function VoteResult({
  tallies,
  totalWeight,
  unityPct,
  quorumPct,
  method,
  electorateCount,
  votedCount,
  openObjections = 0,
}: VoteResultProps) {
  const unity = unityBar(tallies, unityPct, method);
  const quorum = quorumBar(tallies, totalWeight, quorumPct);
  const { spokenWeight } = spoken(tallies, totalWeight);
  const consent = method === "consent";
  const objections = objectionState(openObjections);
  const ObjectionMark = MARK_ICON[objections.mark];

  const fieldDetail = `${weightText(spokenWeight)} of ${weightText(totalWeight)} weight has spoken, from ${votedCount} of ${electorateCount} ${electorateCount === 1 ? "member" : "members"}.`;

  return (
    <div className="space-y-5">
      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          {consent ? (
            <>
              <Heading title="Objections" tip={CONSENT_TIP} mark={objections.mark} value={null} />
              <div className="mt-3 flex items-start gap-3 rounded-lg border border-border bg-muted px-3 py-3">
                <ObjectionMark
                  className={`mt-0.5 w-5 h-5 shrink-0 ${MARK_TONE[objections.mark]}`}
                  aria-hidden="true"
                />
                <p className="text-sm text-muted-foreground leading-relaxed">
                  {objections.reading}. <span className="text-muted-foreground">Consent is decided by what stands in the way, so it carries no percentage of agreement.</span>
                </p>
              </div>
            </>
          ) : (
            <>
              <Heading title="Agreement" tip={UNITY_TIP} mark={unity.mark} value={unityValueText(unity)} />
              <div className="mt-3 flex items-center gap-4">
                <UnityMoon bar={unity} size={96} />
                <p className="text-xs text-muted-foreground leading-relaxed">
                  {unity.reading}.{" "}
                  <span className="text-muted-foreground">
                    {weightText(tallies.yesW)} yes, {weightText(tallies.noW)} no.
                  </span>
                </p>
              </div>
            </>
          )}
        </div>

        <div>
          <Heading
            title="Participation"
            tip={QUORUM_TIP}
            mark={quorum.mark}
            value={pctText(quorum.valuePct)}
          />
          <div className="mt-3">
            <QuorumField
              valuePct={quorum.valuePct}
              thresholdPct={quorum.thresholdPct}
              title="Participation"
              reading={quorum.reading}
              detail={fieldDetail}
            />
          </div>
          <p className="mt-2 text-xs text-muted-foreground leading-relaxed">
            {quorum.reading}. <span className="text-muted-foreground">{fieldDetail}</span>
          </p>
        </div>
      </div>

      <p className="border-t border-border pt-3 text-xs text-muted-foreground leading-relaxed">
        {consent ? ONE_PICTURE : TWO_PICTURES}
      </p>
    </div>
  );
}

/**
 * The card variant: the same two pictures, small, for a list of decisions in
 * flight. Still two, still marked, still never merged, and still no moon on a
 * consent ballot.
 */
export function VoteResultMini({
  tallies,
  totalWeight,
  unityPct,
  quorumPct,
  method,
  standingObjections,
}: Pick<VoteResultProps, "tallies" | "totalWeight" | "unityPct" | "quorumPct" | "method"> & {
  /**
   * The server's count, which the list payload started sending for exactly
   * this spot. A consent card named objections as the deciding thing and then
   * had nothing to say about whether one stood, so a member read the rule and
   * was shown nothing about the only fact that settles the answer.
   */
  standingObjections: number;
}) {
  const unity = unityBar(tallies, unityPct, method);
  const quorum = quorumBar(tallies, totalWeight, quorumPct);
  const consent = method === "consent";
  const objections = objectionState(standingObjections);
  const UnityMark = MARK_ICON[unity.mark];
  const ObjectionMark = MARK_ICON[objections.mark];
  const QuorumMark = MARK_ICON[quorum.mark];

  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
      {consent ? (
        // No moon on a consent ballot, because agreement is not what decides
        // it. What stands in the moon's place is the thing that DOES decide
        // it, with a mark beside it so it is never colour alone.
        <div className="flex flex-col leading-tight">
          <span className="text-xs font-medium text-muted-foreground">Objections decide this one</span>
          <span className="flex items-center gap-1 text-xs font-bold text-foreground">
            <ObjectionMark className={`w-3 h-3 ${MARK_TONE[objections.mark]}`} aria-hidden="true" />
            {standingObjections > 0
              ? `${standingObjections} standing`
              : "None standing"}
          </span>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <UnityMoon bar={unity} size={36} />
          <div className="flex flex-col leading-tight">
            <span className="text-xs font-medium text-muted-foreground">Agreement</span>
            <span className="flex items-center gap-1 text-xs font-bold tabular-nums text-foreground">
              <UnityMark className={`w-3 h-3 ${MARK_TONE[unity.mark]}`} aria-hidden="true" />
              {unityValueText(unity)}
            </span>
          </div>
        </div>
      )}

      <div className="flex min-w-[12rem] flex-1 items-center gap-2">
        <div className="min-w-0 flex-1">
          <QuorumField
            valuePct={quorum.valuePct}
            thresholdPct={quorum.thresholdPct}
            title="Participation"
            reading={quorum.reading}
            detail={`Of the frozen weight, ${pctText(quorum.valuePct)} has spoken.`}
            compact
          />
        </div>
        <div className="flex flex-col leading-tight">
          <span className="text-xs font-medium text-muted-foreground">Participation</span>
          <span className="flex items-center gap-1 text-xs font-bold tabular-nums text-foreground">
            <QuorumMark className={`w-3 h-3 ${MARK_TONE[quorum.mark]}`} aria-hidden="true" />
            {pctText(quorum.valuePct)}
          </span>
        </div>
      </div>
    </div>
  );
}
