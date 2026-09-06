/**
 * THE VOTE WIDGET: a small state machine with one job, which is to make
 * changing your mind feel safe.
 *
 * The engine allows a re-vote until the ballot closes (`castVote` upserts on
 * the primary key), and a permission nobody can see is a permission nobody
 * uses. Hypha carries this as a tooltip on the voted button (harvest section
 * 2: "You can change your vote until the voting period closes"); here it is
 * that tooltip AND a line of standing copy AND the fact that the three
 * choices stay on screen after you pick one, greyed but live. A widget that
 * collapses to "You voted yes" and hides the other two has told the member
 * their vote is final while the engine says it is not.
 *
 * The states, in order of how a member meets them:
 *
 *   OUTSIDE     not on the frozen roll. Says so plainly, and says only what
 *               this card can know: how a roll is set. WHY THIS READER is off
 *               it belongs to "Your weight" in the rail, which reads the gate.
 *   OPEN        three buttons. Consent mode opens a reason box on `no`,
 *               because a no there is an objection and an objection carries
 *               its reasoning.
 *   VOTED       the same three buttons with yours marked, and the change
 *               permission stated rather than implied.
 *   LOCKED      the period ended. Votes are frozen and the ballot is waiting
 *               for a person, which is a different sentence from "closed".
 *   DECIDED     the ballot is closed. The widget stands down entirely.
 *
 * ACCESSIBILITY. The three choices are toggle buttons in a named group, and
 * that is deliberate rather than a radiogroup. A radiogroup promises roving
 * focus, where Tab reaches the group and arrows move inside it, and each of
 * these buttons is a separate ACT that sends a request, so all three stay
 * individually reachable by Tab. `aria-pressed` carries which one is yours.
 * The choice is named in text beside a shape, never by colour alone, and
 * every target clears 44px.
 */
import { useState } from "react";
import { CircleCheck, CircleMinus, CircleX, Loader2 } from "lucide-react";
import type { VoteChoice } from "@shared/governanceEngine";
import InfoTip from "@/components/InfoTip";
import type { Ballot } from "./governanceApi";

const CHOICES: Array<{ id: VoteChoice; label: string; icon: typeof CircleCheck; meaning: string }> = [
  { id: "yes", label: "Yes", icon: CircleCheck, meaning: "I am for this" },
  { id: "abstain", label: "Abstain", icon: CircleMinus, meaning: "Count me present, without a side" },
  { id: "no", label: "No", icon: CircleX, meaning: "I am against this" },
];

const CHOSEN_STYLE: Record<VoteChoice, string> = {
  yes: "border-sage bg-sage-light text-sage",
  abstain: "border-stone-500 bg-stone-100 text-stone-700",
  no: "border-coral bg-red-50 text-coral",
};

export default function VoteWidget({
  ballot,
  onVote,
  busy,
}: {
  ballot: Ballot;
  onVote: (choice: VoteChoice, reason?: string) => Promise<void>;
  busy: boolean;
}) {
  const [reason, setReason] = useState(ballot.myVote?.reason ?? "");
  const [reasonFor, setReasonFor] = useState<VoteChoice | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const consent = ballot.method === "consent";
  const decided = ballot.status !== "open";
  const locked = !decided && Date.parse(ballot.closesAt) <= Date.now();
  const outside = ballot.myWeight === null;
  const mine = ballot.myVote?.choice ?? null;

  if (decided) return null;

  if (outside) {
    return (
      <div className="rounded-xl border border-stone-200 bg-stone-50 p-4">
        <p className="text-sm font-semibold text-stone-800">You are not on this ballot's roll</p>
        {/* WHAT THIS CARD KNOWS, AND NOTHING MORE. It used to say the roll
            froze when the vote opened and leave the reader to read that as
            the reason. It is the reason for a member who joined afterwards
            and it is false for a member a warning badge is holding back, who
            would have been left off a roll built at any hour of any day. All
            this card holds is a null weight, so it states the rule and stops.
            "Your weight", in the rail beside it, is where the reader's own
            standing is named. */}
        <p className="mt-1 text-sm text-stone-600 leading-relaxed">
          A roll is set when a vote opens, from everyone who could vote at that moment, and you were not on this one.
          The roll is below, so you can see exactly who the village is waiting on.
        </p>
      </div>
    );
  }

  if (locked) {
    return (
      <div className="rounded-xl border border-stone-300 bg-stone-50 p-4">
        <p className="text-sm font-semibold text-stone-800">The voting period has ended</p>
        <p className="mt-1 text-sm text-stone-600 leading-relaxed">
          Votes are locked. Nothing happens on a timer here: this decision is waiting for a person to close it and say
          what the village decided.
        </p>
        {mine ? (
          <p className="mt-2 text-sm text-stone-700">Your vote stands as {mine}.</p>
        ) : ballot.myVote ? (
          <p className="mt-2 text-sm text-stone-700">{ballot.myVote.sentence}.</p>
        ) : null}
      </div>
    );
  }

  const submit = async (choice: VoteChoice) => {
    setProblem(null);
    // A no in consent mode IS an objection, so the reasoning comes first.
    if (consent && choice === "no" && !reason.trim()) {
      setReasonFor("no");
      setProblem("A no here is an objection, and an objection carries its reasoning. Say what you see.");
      return;
    }
    await onVote(choice, reason.trim() || undefined);
    setReasonFor(null);
  };

  return (
    <div className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-base font-bold text-stone-900">{mine ? "Your vote" : "Your vote is open"}</h3>
        {ballot.myWeight !== null && (
          <span className="text-xs text-stone-600">
            weighs {ballot.myWeight}
            <InfoTip
              tip="This is the weight frozen for you when this ballot opened. Changing the village's settings now does not change it."
              label="What your weight means here"
            />
          </span>
        )}
      </div>

      {/* A VOTE SOMEBODY ELSE DECIDED, WHILE THIS ONE IS STILL RUNNING (0175).
          The row is cast and the choice is not this member's to read yet, so
          none of the three buttons is lit and the state is said in a sentence
          instead. Voting here still works and takes the row back, which is the
          right the whole feature was built around. */}
      {ballot.myVote?.state === "cast_following" && (
        <p className="mt-2 rounded-lg bg-stone-50 px-3 py-2 text-sm text-stone-700">
          {ballot.myVote.sentence}. Vote below whenever you want to decide this one yourself.
        </p>
      )}

      {ballot.myWeight === 0 && (
        <p className="mt-2 rounded-lg bg-amber-light px-3 py-2 text-sm text-gold">
          You are on this roll holding no weight, so your vote is recorded and counts for nothing. Ask a steward why,
          and point them at the weight record.
        </p>
      )}

      <div role="group" aria-label="Your vote" className="mt-3 grid gap-2 sm:grid-cols-3">
        {CHOICES.map((c) => {
          const Icon = c.icon;
          const chosen = mine === c.id;
          return (
            <button
              key={c.id}
              type="button"
              aria-pressed={chosen}
              disabled={busy}
              onClick={() => submit(c.id)}
              className={`flex min-h-[44px] items-center justify-center gap-2 rounded-lg border-2 px-4 py-2.5 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-deep focus-visible:ring-offset-2 disabled:opacity-60 ${
                chosen ? CHOSEN_STYLE[c.id] : "border-stone-300 bg-white text-stone-700 hover:border-stone-400 hover:bg-stone-50"
              }`}
            >
              {busy && chosen ? (
                <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
              ) : (
                <Icon className="w-4 h-4" aria-hidden="true" />
              )}
              <span>{c.label}</span>
              {chosen && <span className="sr-only">, your current vote</span>}
            </button>
          );
        })}
      </div>

      <p className="mt-2 text-xs text-stone-500">
        {CHOICES.map((c) => `${c.label}: ${c.meaning}`).join(" · ")}
      </p>

      {(consent || reasonFor === "no" || (mine === "no" && reason)) && (
        <div className="mt-3">
          <label htmlFor="vote-reason" className="block text-sm font-medium text-stone-800">
            {consent ? "Your objection, if you have one" : "Say why, if you want to"}
          </label>
          <textarea
            id="vote-reason"
            rows={3}
            value={reason}
            maxLength={2000}
            onChange={(e) => setReason(e.target.value)}
            placeholder="What consequence or risk do you see that the village should avoid?"
            className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-deep"
          />
        </div>
      )}

      {problem && (
        <p role="alert" className="mt-2 text-sm font-medium text-coral">
          {problem}
        </p>
      )}

      <p className="mt-3 border-t border-stone-100 pt-3 text-sm text-stone-600 leading-relaxed">
        {mine ? (
          <>
            You voted <strong className="text-stone-900">{mine}</strong>. You can change it as many times as you like
            until the voting period closes. Pick another and it simply replaces this one.
          </>
        ) : (
          <>Nothing is final here. You can change your vote as often as you like until the voting period closes.</>
        )}
      </p>
    </div>
  );
}
