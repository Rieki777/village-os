/**
 * CLOSING IS A HUMAN ACT.
 *
 * Nothing here happens on a timer. When the voting period ends the votes lock
 * and the decision waits for a person, and that person has to write a sentence
 * saying what the village decided before the engine will take the transition.
 * The route requires `outcome_note` and refuses without it; this surface is
 * that requirement made to feel like what it is, which is the closer's one
 * genuine contribution to the record.
 *
 * So the note is not a "comment" field under a button. It is the whole
 * dialog: the tallies are shown as read-only facts above it, the outcome the
 * engine will reach is stated before anything is typed, and the field asks for
 * a sentence a member will read in a year.
 *
 * WHY THE OUTCOME IS SHOWN BEFORE THE NOTE IS WRITTEN. A closer who does not
 * know whether they are recording a pass or a failure writes a hedge. The
 * engine's verdict is arithmetic on frozen numbers, so it can be previewed
 * honestly, and previewing it is what lets the sentence be about what happens
 * next rather than about what the numbers were.
 *
 * The preview uses the SAME function the server closes with
 * (`evaluateBallot`, shared/governanceEngine), so the two cannot disagree.
 */
import { useState } from "react";
import { Loader2, Scale } from "lucide-react";
import { evaluateBallot, type BallotOutcome } from "@shared/governanceEngine";
import { pctText, weightText } from "./voteBars";
import type { Ballot } from "./governanceApi";

/**
 * WHAT CLOSING DOES, and why there are two sets of words.
 *
 * The binding set said "Closing it makes it the village's decision and does
 * whatever the decision says to do", which is true of a rule change and FALSE
 * of an advisory vote. An advisory ballot runs on this same engine with the
 * same frozen roll and the same weights, and closing it executes nothing: the
 * server reads that off the close route's own subject table and sends it as
 * `binding`. A closer reading the binding sentence over a practice vote would
 * be told they had just changed something, at the exact moment they are
 * putting their name to the record.
 *
 * The advisory words say what actually happened: the village answered, the
 * answer is kept, and nothing moved on its own.
 */
// Keyed by the union `evaluateBallot` returns, so an outcome added to the engine
// cannot reach this dialog without words to say.
const OUTCOME_WORDS: Record<BallotOutcome, { heading: string; blurb: string }> = {
  passed: {
    heading: "This carries",
    blurb: "Closing it makes it the village's decision and does whatever the decision says to do.",
  },
  failed: {
    heading: "This does not carry",
    blurb: "The village looked at it and did not agree. Closing records that, and the subject can be amended and brought back.",
  },
  no_quorum: {
    heading: "Not enough of the village spoke",
    blurb: "Too little of the electorate voted for this to be an answer either way. Closing records that, and it is not the same thing as a rejection.",
  },
};

const ADVISORY_WORDS: Record<BallotOutcome, { heading: string; blurb: string }> = {
  passed: {
    heading: "The village would say yes",
    blurb: "This vote was advisory, so nothing changes by itself. Closing it records what the village thinks, and somebody still has to decide what to do about it.",
  },
  failed: {
    heading: "The village would say no",
    blurb: "This vote was advisory, so nothing changes by itself. Closing it records that the village did not agree, which is worth knowing before anyone builds on it.",
  },
  no_quorum: {
    heading: "Not enough of the village spoke",
    blurb: "Too few voted for this to be an answer either way. Nothing changes by itself here, and a quiet advisory vote is its own useful fact about what the village is ready to weigh in on.",
  },
};

export default function CloseBeat({
  ballot,
  busy,
  onClose,
  onCancel,
}: {
  ballot: Ballot;
  busy: boolean;
  onClose: (outcomeNote: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [note, setNote] = useState("");
  const [problem, setProblem] = useState<string | null>(null);

  // The server's count, from the same function the close route evaluates
  // with. This used to filter the objections array here, which made the close
  // preview a second opinion about whether the ballot carries.
  const standingObjections = ballot.standingObjections;

  const outcome = evaluateBallot({
    method: ballot.method,
    unityPct: ballot.unityPct,
    quorumPct: ballot.quorumPct,
    totalWeight: ballot.totalWeight,
    tallies: ballot.tallies,
    openObjections: standingObjections,
  });
  const words = (ballot.binding ? OUTCOME_WORDS : ADVISORY_WORDS)[outcome];

  // A seat application's ballot records fixed words (red team U12): typed words
  // could name the member who applied on a record built never to name them.
  const fixedWords = ballot.subjectType === "role_application";

  const submit = async () => {
    if (fixedWords) {
      setProblem(null);
      await onClose("");
      return;
    }
    if (note.trim().length < 10) {
      setProblem("Write the sentence somebody will read in a year. A few words is not a record.");
      return;
    }
    setProblem(null);
    await onClose(note.trim());
  };

  return (
    <section className="rounded-xl border-2 border-teal-deep bg-white p-5">
      <h3 className="flex items-center gap-2 text-lg font-bold text-stone-900">
        <Scale className="w-5 h-5 text-teal-deep" aria-hidden="true" />
        {ballot.binding ? "Close this decision" : "Close this advisory vote"}
      </h3>
      <p className="mt-1 text-sm text-stone-600 leading-relaxed">
        You are the person doing this. Nothing closed it while you were away, and nothing will.
      </p>

      <div className="mt-4 rounded-lg bg-stone-50 p-4">
        <p className="text-base font-bold text-stone-900">{words.heading}</p>
        <p className="mt-1 text-sm text-stone-700 leading-relaxed">{words.blurb}</p>
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm sm:grid-cols-4">
          <div>
            <dt className="text-xs text-stone-500">Yes</dt>
            <dd className="font-semibold tabular-nums text-stone-900">{weightText(ballot.tallies.yesW)}</dd>
          </div>
          <div>
            <dt className="text-xs text-stone-500">No</dt>
            <dd className="font-semibold tabular-nums text-stone-900">{weightText(ballot.tallies.noW)}</dd>
          </div>
          <div>
            <dt className="text-xs text-stone-500">Abstain</dt>
            <dd className="font-semibold tabular-nums text-stone-900">{weightText(ballot.tallies.abstainW)}</dd>
          </div>
          <div>
            <dt className="text-xs text-stone-500">Of a possible</dt>
            <dd className="font-semibold tabular-nums text-stone-900">{weightText(ballot.totalWeight)}</dd>
          </div>
        </dl>
        <p className="mt-2 text-xs text-stone-600">
          Agreement {pctText(ballot.unity)} against {pctText(ballot.unityPct)} needed · participation{" "}
          {pctText(ballot.quorum)} against {pctText(ballot.quorumPct)} needed.
          {standingObjections > 0 && ` ${standingObjections} objection${standingObjections === 1 ? "" : "s"} still standing.`}
        </p>
      </div>

      {fixedWords ? (
        <p className="mt-4 text-sm text-stone-700 leading-relaxed">
          The record keeps fixed words for a seat application, so it never names the member who applied. Members read the
          application on its own page.
        </p>
      ) : (
      <div className="mt-4">
        <label htmlFor="outcome-note" className="block text-sm font-semibold text-stone-900">
          {ballot.binding ? "What did the village decide?" : "What did the village say?"}
        </label>
        <p className="mt-0.5 text-xs text-stone-600 leading-relaxed">
          {ballot.binding
            ? "One or two sentences, in plain words, saying what was decided and what happens next. This is what the record keeps. The numbers are already kept."
            : "One or two sentences, in plain words, saying what the village said and what you make of it. Nothing here changes anything on its own, and that is what makes it safe to be plain."}
        </p>
        <textarea
          id="outcome-note"
          rows={4}
          value={note}
          maxLength={4000}
          onChange={(e) => setNote(e.target.value)}
          placeholder={
            ballot.binding
              ? "The village agreed to give proposals nine days of sensing instead of seven, starting now."
              : "Most of the village would back a shared tool shelf. Nothing is decided by this, and it is worth writing up as a real proposal."
          }
          className="mt-2 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-deep"
        />
      </div>
      )}

      {problem && (
        <p role="alert" className="mt-2 text-sm font-medium text-coral">
          {problem}
        </p>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={submit}
          className="inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-teal-deep px-5 text-sm font-semibold text-white hover:bg-teal-deep-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-deep focus-visible:ring-offset-2 disabled:opacity-60"
        >
          {busy && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />}
          Close it and record this
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="min-h-[44px] rounded-lg border border-stone-300 px-5 text-sm font-medium text-stone-700 hover:bg-stone-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-deep"
        >
          Not yet
        </button>
      </div>
    </section>
  );
}
