/**
 * A PRACTICE VOTE: the village asks itself something, for real, and nothing
 * moves.
 *
 * This is the founder-facing half of the advisory route. The type step used to
 * end four of its five cards in a locked rectangle saying this village cannot
 * open that kind of decision yet, which is true and is also a dead end: it
 * told a member what the village lacks and offered them nothing to do about
 * it. The same member can now put the same question to the whole village on
 * the real engine, with the real frozen roll and the real weights and a real
 * quorum to reach, and read a real answer that changes nothing on its own.
 *
 * WHY THAT IS WORTH BUILDING AND NOT A CONSOLATION PRIZE. The part of taking
 * a governance power that cannot be built for anybody is the nerve to use it.
 * A village that has watched its own quorum arrive, or fail to arrive, on a
 * question it cared about knows something it could not have been told. So the
 * engine underneath is deliberately identical to the binding one: practising
 * on a softer engine would teach the wrong lesson twice, once about how hard
 * quorum is and once about what its village actually thinks.
 *
 * THE WORDS ARE GOVERNED BY R55 AND R56. Nothing here counts what the village
 * has not got, ranks it, or implies it is behind: a village holding one
 * binding power is a village at the beginning of something, and a village of
 * ten years sounding out a hard question is doing the same act as a village of
 * ten days finding its feet. So this says what a practice vote IS and what
 * pressing the button does, and stops.
 *
 * THE METHOD IS OFFERED HERE and is not offered on a binding ballot, because
 * finding out how consent feels compared with majority is most of what a
 * village practises. Leaving it alone uses the village's own setting, which is
 * the honest default: the point is to feel what this village's own rules do.
 *
 * ── THE SECOND WAY IN: A FIXED ASK ────────────────────────────────────────
 *
 * The module library opens this same screen with the question already written
 * (`asking`), because a member wanting a module their village does not run is
 * asking the village one answerable thing and the sentence is the same for
 * everybody who asks it. That sameness is load-bearing: an advisory ballot's
 * `subject_ref` is a server-side uuid, so the title is the only thing a second
 * asker can match on, and a member who reworded the sentence would ring the
 * whole roll a second time about one switch.
 *
 * `asking` is ONE object and never a scatter of optional strings, so there is
 * no half-configured state where a fixed question arrives under a heading
 * written for a free one. Absent, this is exactly the screen it was.
 */
import { useState } from "react";
import { MessageCircleQuestion } from "lucide-react";
import InfoTip from "@/components/InfoTip";
import { openAdvisory } from "./governanceApi";
import { subjectNoun, type WizardType } from "./wizardConfig";
import BreathingLoader from "@/components/natural/BreathingLoader";

/**
 * The methods a practice vote may run, in the order a member meets them.
 * "" leaves it to the village's own setting, which is why it is first.
 */
const METHOD_CHOICES: Array<{ id: string; label: string; help: string }> = [
  { id: "", label: "However this village usually decides", help: "The village's own setting, which is what a real vote here would use." },
  { id: "majority", label: "Majority", help: "More than half of the weight that took a side carries it." },
  { id: "consensus", label: "Consensus", help: "Everyone who takes a side has to agree. One no stops it." },
  { id: "consent", label: "Consent", help: "Nobody has to agree. It carries unless somebody names a consequence to avoid." },
  { id: "custom", label: "This village's own dials", help: "The unity and turnout numbers the village set for itself." },
];

/**
 * A practice vote opened with its question already written.
 *
 * All of it or none of it. Every string a member reads on this screen is here,
 * so a caller cannot supply a fixed question and leave the surrounding words
 * describing the free-text one.
 */
export interface FixedAsk {
  /** The exact sentence the village votes on. Not editable by the member. */
  question: string;
  heading: string;
  /** The paragraph under the heading: what pressing the button does. */
  lead: string;
  detailLabel: string;
  detailHelp: string;
  submitLabel: string;
  cancelLabel: string;
}

export default function PracticeVote({
  about,
  onOpened,
  onCancel,
  asking,
}: {
  /**
   * The kind of decision being practised, or null when the question is the
   * village's own rather than a rehearsal of a wizard type. The server takes
   * the same two states: it records the kind in the frozen document and
   * ignores anything outside its advisory list.
   */
  about: WizardType | null;
  /** The new ballot's id, so the caller can take the member to it. */
  onOpened: (ballotId: string) => void;
  onCancel: () => void;
  /** Present when the module library opened this with the question written. */
  asking?: FixedAsk;
}) {
  const Heading = asking ? "h2" : "h3";
  const noun = about ? subjectNoun(about) : "";
  const [question, setQuestion] = useState(asking?.question ?? "");
  const [detail, setDetail] = useState("");
  const [method, setMethod] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const chosenHelp = METHOD_CHOICES.find((m) => m.id === method)?.help ?? "";

  const ask = async () => {
    if (question.trim().length < 10) {
      setProblem("Ask it in a full sentence. The whole village reads this one line.");
      return;
    }
    setBusy(true);
    setProblem(null);
    const answer = await openAdvisory({
      question: question.trim(),
      detail: detail.trim() || undefined,
      about: about ?? undefined,
      method: method || undefined,
    });
    setBusy(false);
    if (!answer.ok) {
      setProblem(answer.error);
      return;
    }
    onOpened(answer.data.ballot.id);
  };

  return (
    <section className="rounded-xl border-2 border-teal-deep bg-white p-5">
      {/* A fixed ask is the main thing on its own page, under that page's h1.
          The free practice vote is nested inside the wizard's type step, which
          already carries an h2, so the two states take different levels rather
          than one of them skipping one. */}
      <Heading className="flex items-center gap-2 text-lg font-bold text-stone-900">
        <MessageCircleQuestion className="w-5 h-5 text-teal-deep" aria-hidden="true" />
        {asking ? asking.heading : "Ask the village about this"}
        <InfoTip
          tip="A practice vote runs on the same engine a binding one does: the same roll, the same weights, the same turnout to reach. Closing it records the answer and changes nothing on its own."
          label="What a practice vote is"
        />
      </Heading>
      {/* The type is named as a CHIP and never inside a sentence. The wizard
          cards are verb phrases ("Write an agreement"), so folding one into
          prose produced "does not carry write an agreement by vote today",
          and the noun map has an article problem of its own ("a agreement").
          A label beside a type-free sentence has neither. */}
      {noun && (
        <span className="mt-2 inline-block rounded-full bg-stone-100 px-2.5 py-0.5 text-xs font-medium text-stone-700">
          {noun}
        </span>
      )}
      <p className="mt-2 text-sm text-stone-600 leading-relaxed">
        {asking
          ? asking.lead
          : "This kind of decision does not carry a binding vote in this village yet. A practice vote is real in every other way: the whole roll, the real weights, and an answer the village can act on when it chooses to."}
      </p>

      <div className="mt-4">
        <p className="block text-sm font-semibold text-stone-900">
          {asking ? "What the village is asked" : "What are you asking the village?"}
        </p>
        <p className="mt-0.5 text-xs text-stone-600 leading-relaxed">
          {asking
            ? "This is the line every member sees in their bell and on the decision. It reads the same for everyone who asks for this one, which is how a second ask finds the first."
            : "One sentence. This is the line every member sees in their bell and on the decision."}
        </p>
        {asking ? (
          /* Shown, never typed. The sameness of this sentence is what makes
             "somebody already asked" answerable, so it is not an input. */
          <p className="mt-2 rounded-lg border border-stone-300 bg-stone-50 px-3 py-2 text-sm font-medium text-stone-900">
            {asking.question}
          </p>
        ) : (
          <input
            id="practice-question"
            type="text"
            value={question}
            maxLength={200}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="Should the repair shed hold a shared tool library?"
            className="mt-2 min-h-[44px] w-full rounded-lg border border-stone-300 px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-deep"
          />
        )}
      </div>

      <div className="mt-4">
        <label htmlFor="practice-detail" className="block text-sm font-semibold text-stone-900">
          {asking ? asking.detailLabel : "Anything the village should read first"}
        </label>
        <p className="mt-0.5 text-xs text-stone-600 leading-relaxed">
          {asking
            ? asking.detailHelp
            : "Optional. It is frozen into the document when the vote opens, so it cannot change while people are voting."}
        </p>
        <textarea
          id="practice-detail"
          rows={4}
          value={detail}
          maxLength={20000}
          onChange={(e) => setDetail(e.target.value)}
          className="mt-2 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-deep"
        />
      </div>

      <div className="mt-4">
        <label htmlFor="practice-method" className="block text-sm font-semibold text-stone-900">
          How should it be decided?
        </label>
        <select
          id="practice-method"
          value={method}
          onChange={(e) => setMethod(e.target.value)}
          className="mt-2 min-h-[44px] w-full rounded-lg border border-stone-300 px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-deep"
        >
          {METHOD_CHOICES.map((m) => (
            <option key={m.id || "village"} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
        {chosenHelp && <p className="mt-1 text-xs text-stone-600 leading-relaxed">{chosenHelp}</p>}
      </div>

      {problem && (
        <p role="alert" className="mt-3 text-sm font-medium text-coral">
          {problem}
        </p>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={ask}
          className="inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-teal-deep px-5 text-sm font-semibold text-white hover:bg-teal-deep-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-deep focus-visible:ring-offset-2 disabled:opacity-60"
        >
          {busy && <BreathingLoader decorative size={16} />}
          {asking ? asking.submitLabel : "Open the practice vote"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="min-h-[44px] rounded-lg border border-stone-300 px-5 text-sm font-medium text-stone-700 hover:bg-stone-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-deep"
        >
          {asking ? asking.cancelLabel : "Back to the kinds"}
        </button>
      </div>

      <p className="mt-3 text-xs text-stone-500 leading-relaxed">
        Opening it rings everyone on the roll once, and closing it rings them once more. One practice vote at a time,
        each, so a village's attention is spent on questions it can answer.
      </p>
    </section>
  );
}
