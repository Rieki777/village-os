/**
 * A CARRIED DECISION IS VILLAGE LAW, so it is shown as law and not as a receipt.
 *
 * The order on this card is the whole argument. First the human sentence
 * somebody wrote when they closed it, at the size of a heading, because that
 * sentence is what a member will quote in six months. Then who closed it and
 * when, because law has an author. Then the numbers, small, underneath, where
 * numbers belong once they have done their job. Then what actually changed in
 * the world.
 *
 * Hypha closes with numbers only (harvest section 3). Loomio's facilitator
 * publishes an outcome and it becomes the permanent record (sweep item 2).
 * This card is that borrowing, and inverting the usual hierarchy is how the
 * borrowing shows.
 *
 * THE CELEBRATION. `docs/modules/natural-interface.md` rations `moment`
 * intensity to four events and names "a ballot carrying" as one of them, so
 * this is the sanctioned use rather than a lane reaching for confetti. It runs
 * once, on a decision that carried, and it is decorative: the same news is in
 * the live-region message and in every word on the card, so the moment lands
 * for a reader with no animation at all.
 */
import { CheckCircle2, CircleSlash, MinusCircle } from "lucide-react";
import { Celebration } from "@/components/natural";
import { pctText, weightText } from "./voteBars";
import type { Ballot, Landing } from "./governanceApi";
import LandingClock from "./LandingClock";

/**
 * WHAT A CLOSED DECISION READS AS.
 *
 * The authority is `ballots.status` as the server declares it, which is the
 * union on `BallotRow` in `server/lib/ballots.ts`: the column is a varchar,
 * so no migration constrains it and the server's own type is the only
 * enumeration there is. `ballotStates.test.ts` reads that union out of source
 * and holds this map to it, the way objectionStates.test.ts does for rulings.
 *
 * Typed against the client's own copy of the union rather than `string`, so
 * the compiler catches the half of the drift it can see and the test catches
 * the half it cannot.
 */
const OUTCOME: Record<
  Ballot["status"],
  { word: string; icon: typeof CheckCircle2; frame: string; chip: string; law: boolean }
> = {
  open: {
    word: "Still open",
    icon: MinusCircle,
    frame: "border-stone-300 bg-stone-50",
    chip: "bg-stone-600 text-white",
    law: false,
  },
  passed: {
    word: "Carried",
    icon: CheckCircle2,
    frame: "border-sage bg-sage-light",
    chip: "bg-sage text-white",
    law: true,
  },
  failed: {
    word: "Did not carry",
    icon: CircleSlash,
    frame: "border-stone-300 bg-stone-50",
    chip: "bg-stone-600 text-white",
    law: false,
  },
  no_quorum: {
    word: "Too few spoke",
    icon: MinusCircle,
    frame: "border-stone-300 bg-stone-50",
    chip: "bg-stone-600 text-white",
    law: false,
  },
  withdrawn: {
    word: "Withdrawn",
    icon: CircleSlash,
    frame: "border-stone-300 bg-stone-50",
    chip: "bg-stone-600 text-white",
    law: false,
  },
};

/**
 * A status nobody has taught this card yet.
 *
 * This used to fall back to `failed`, and that was the whole defect in one
 * word: a decision the village CARRIED under a status this build has not
 * heard of would have been shown to every member as "Did not carry". A
 * fallback that invents an outcome is worse than one that admits it does not
 * know, because nothing on the page tells the reader which they are looking
 * at. `law` stays false so nothing downstream treats an unread status as
 * settled law.
 */
const UNKNOWN_OUTCOME = {
  word: "Closed",
  icon: MinusCircle,
  frame: "border-stone-300 bg-stone-50",
  chip: "bg-stone-600 text-white",
  law: false,
};

export const DECISION_OUTCOME_COPY = OUTCOME;

/**
 * WHAT THE CHIP SAYS once the landing is known.
 *
 * Rye, 2026-09-08: a decision "should never pass until the veto window expires",
 * and vetoed proposals must "clearly show that they didn't pass". Rye,
 * 2026-09-14: "a member can see a countdown timer until it passes". So a
 * decision that carried and is still counting down is not yet law: it reads
 * "Carried, not yet in effect", takes no celebration, and shows the countdown.
 * One a steward stopped reads as stopped even on a build where the ballot row
 * still says passed. `ballots.status` itself is never reinterpreted here; the
 * landing is what moves the word, exactly as 0172 separates the two questions.
 */
export function outcomeFor(status: Ballot["status"], landing?: Landing | null, nowMs: number = Date.now()) {
  const base = OUTCOME[status] ?? UNKNOWN_OUTCOME;
  if (status !== "passed" || !landing) return base;
  if (landing.landingStatus === "vetoed" || landing.vetoedAt) {
    return { ...OUTCOME.failed, word: "Stopped by a steward" };
  }
  if (landing.landingStatus === "pending" && landing.landsAt && Date.parse(landing.landsAt) > nowMs) {
    return { ...base, word: "Carried, not yet in effect", law: false };
  }
  return base;
}

export default function DecisionOutcome({
  ballot,
  /** What the close actually changed. Empty is normal and says so. */
  applied,
  held,
  /** True only in the session that just closed it, so the moment is rare. */
  fresh = false,
  /** The countdown, once the page has read it. Absent renders exactly as before. */
  landing = null,
}: {
  ballot: Ballot;
  applied?: string[];
  held?: string | null;
  fresh?: boolean;
  landing?: Landing | null;
}) {
  const o = outcomeFor(ballot.status, landing);
  const counting = ballot.status === "passed" && landing?.landingStatus === "pending" && !!landing.landsAt && !o.law;
  const Icon = o.icon;
  const closedOn = ballot.closedAt
    ? new Date(ballot.closedAt).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })
    : null;

  return (
    <section className={`relative overflow-hidden rounded-xl border-2 p-5 ${o.frame}`}>
      {fresh && o.law && (
        <div className="pointer-events-none absolute inset-0 flex items-start justify-end opacity-70">
          <Celebration
            kind="dawn"
            intensity="moment"
            size={160}
            message={`The village decided. ${ballot.outcomeNote ?? ""}`}
          />
        </div>
      )}

      <div className="relative">
        <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wide ${o.chip}`}>
          <Icon className="w-3.5 h-3.5" aria-hidden="true" />
          {o.word}
        </span>

        {counting && landing?.landsAt && <LandingClock landsAt={landing.landsAt} sentence={landing.countdownSentence} />}

        {/* The human sentence, at the size the sentence deserves. */}
        {ballot.outcomeNote ? (
          <p className="mt-3 font-display text-xl font-bold leading-snug text-stone-900 sm:text-2xl">
            {ballot.outcomeNote}
          </p>
        ) : (
          <p className="mt-3 text-lg text-stone-700">This closed without a sentence on it.</p>
        )}

        <p className="mt-2 text-sm text-stone-700">
          {ballot.closedBy ? <>Closed by {ballot.closedBy}</> : <>Closed</>}
          {closedOn ? ` on ${closedOn}` : ""}
          {o.law ? ", and it stands until the village decides otherwise." : "."}
        </p>

        {/* The numbers, once they have done their job. */}
        <dl className="mt-4 flex flex-wrap gap-x-6 gap-y-2 border-t border-stone-900/10 pt-3 text-sm">
          <div>
            <dt className="text-xs text-stone-600">Yes</dt>
            <dd className="font-semibold tabular-nums text-stone-900">{weightText(ballot.tallies.yesW)}</dd>
          </div>
          <div>
            <dt className="text-xs text-stone-600">No</dt>
            <dd className="font-semibold tabular-nums text-stone-900">{weightText(ballot.tallies.noW)}</dd>
          </div>
          <div>
            <dt className="text-xs text-stone-600">Abstain</dt>
            <dd className="font-semibold tabular-nums text-stone-900">{weightText(ballot.tallies.abstainW)}</dd>
          </div>
          <div>
            <dt className="text-xs text-stone-600">Agreement</dt>
            <dd className="font-semibold tabular-nums text-stone-900">
              {pctText(ballot.unity)} <span className="font-normal text-stone-600">of {pctText(ballot.unityPct)}</span>
            </dd>
          </div>
          <div>
            <dt className="text-xs text-stone-600">Participation</dt>
            <dd className="font-semibold tabular-nums text-stone-900">
              {pctText(ballot.quorum)} <span className="font-normal text-stone-600">of {pctText(ballot.quorumPct)}</span>
            </dd>
          </div>
        </dl>

        {/* What changed in the world. */}
        {(applied?.length || held) && (
          <div className="mt-4 border-t border-stone-900/10 pt-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-stone-600">What changed</p>
            {applied && applied.length > 0 && (
              <ul className="mt-1.5 space-y-1">
                {applied.map((key) => (
                  <li key={key} className="text-sm text-stone-800">
                    <code className="rounded bg-stone-900/5 px-1.5 py-0.5 text-xs">{key}</code> now holds the value the
                    village voted for.
                  </li>
                ))}
              </ul>
            )}
            {held && (
              <p className="mt-1.5 text-sm text-stone-800">
                Nothing has moved yet: {held}. The change is recorded and waiting.
              </p>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
