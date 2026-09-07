/**
 * A DECISION IN FLIGHT, as a card.
 *
 * This is the unit the Decisions page is built from, and its whole job is to
 * be a live thing rather than a row in a table. So it carries the two bars in
 * miniature, a running clock, and the one fact a member most wants from a list
 * of votes, which is whether they have voted in this one yet.
 *
 * The "you" state is deliberately the loudest thing on the card after the
 * title. A member scanning ten open decisions is asking "which of these is
 * waiting on me", and answering that question is the difference between a
 * governance surface people use and one people admire.
 */
import { Link } from "wouter";
import { ArrowRight, CircleCheck, CircleMinus, CircleX } from "lucide-react";
import type { VoteChoice } from "@shared/governanceEngine";
import { subjectNoun } from "./wizardConfig";
import { VoteResultMini } from "./VoteResult";
import VoteClock from "./VoteClock";
import type { BallotCard as BallotCardData } from "./governanceApi";

const MINE: Record<VoteChoice, { label: string; icon: typeof CircleCheck; tone: string }> = {
  yes: { label: "You voted yes", icon: CircleCheck, tone: "text-sage" },
  abstain: { label: "You abstained", icon: CircleMinus, tone: "text-stone-600" },
  no: { label: "You voted no", icon: CircleX, tone: "text-coral" },
};

const CLOSED_WORD: Record<string, string> = {
  passed: "Carried",
  failed: "Did not carry",
  no_quorum: "Too few spoke",
  withdrawn: "Withdrawn",
};

export default function DecisionCard({ ballot }: { ballot: BallotCardData }) {
  const open = ballot.status === "open";
  // A DELEGATED ROW ON A LIVE VOTE HAS NO CHOICE TO SHOW (0175). It was cast,
  // and what it said belongs to the member who decided it until the vote
  // closes. So the card says it was cast and leaves the badge alone, rather
  // than reading a missing choice as "waiting on you", which would be the one
  // wrong sentence: this member has already answered.
  const cast = !!ballot.myVote;
  const mine = ballot.myVote?.choice ? MINE[ballot.myVote.choice] : null;
  const MineIcon = mine?.icon;
  const inRoll = ballot.myWeight !== null;
  const expired = open && Date.parse(ballot.closesAt) <= Date.now();

  return (
    <article className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm transition-shadow hover:shadow-md">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-stone-100 px-2.5 py-0.5 text-xs font-medium text-stone-700">
          {subjectNoun(ballot.subjectType)}
        </span>
        {open ? (
          expired ? (
            <span className="rounded-full bg-amber-light px-2.5 py-0.5 text-xs font-semibold text-gold">
              Waiting to be closed
            </span>
          ) : (
            <span className="rounded-full bg-sage-light px-2.5 py-0.5 text-xs font-semibold text-sage">Voting now</span>
          )
        ) : (
          <span className="rounded-full bg-stone-200 px-2.5 py-0.5 text-xs font-semibold text-stone-800">
            {CLOSED_WORD[ballot.status] ?? "Closed"}
          </span>
        )}
      </div>

      <h3 className="mt-2 text-lg font-bold leading-snug text-stone-900">
        <Link
          href={`/decisions/${ballot.id}`}
          className="rounded-sm hover:text-teal-deep focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-deep"
        >
          {ballot.title}
        </Link>
      </h3>

      {/* WHETHER THIS ONE BINDS, before the bars and before the vote button.
          A card that showed a real clock, real weights and a real quorum over
          a vote that executes nothing was telling a member they were deciding
          something. The fact comes from the server, which reads it off the
          close route's own subject table, so the card cannot be wrong about
          it. */}
      {!ballot.binding && (
        <p className="mt-1.5 text-sm text-stone-600 leading-relaxed">
          {open
            ? "This one asks what the village thinks. Nothing changes by itself when it closes."
            : "This one asked what the village thinks. Nothing changed by itself."}
        </p>
      )}

      {!open && ballot.outcomeNote && (
        <p className="mt-1.5 text-sm italic text-stone-700 leading-relaxed">{ballot.outcomeNote}</p>
      )}

      <div className="mt-3">
        <VoteResultMini
          tallies={ballot.tallies}
          totalWeight={ballot.totalWeight}
          unityPct={ballot.unityPct}
          quorumPct={ballot.quorumPct}
          method={ballot.method}
          standingObjections={ballot.standingObjections}
        />
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-stone-100 pt-3">
        <span className="flex items-center gap-3">
          {open && <VoteClock closesAt={ballot.closesAt} />}
          {mine && MineIcon ? (
            <span className={`inline-flex items-center gap-1.5 text-sm font-medium ${mine.tone}`}>
              <MineIcon className="w-4 h-4" aria-hidden="true" />
              {mine.label}
            </span>
          ) : cast ? (
            <span className="inline-flex items-center gap-1.5 text-sm font-medium text-stone-600">
              <CircleMinus className="w-4 h-4" aria-hidden="true" />
              {ballot.myVote?.sentence ?? "Cast"}
            </span>
          ) : open && inRoll && !expired ? (
            <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-teal-deep">
              Waiting on you
            </span>
          ) : null}
        </span>

        <Link
          href={`/decisions/${ballot.id}`}
          className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg px-3 text-sm font-semibold text-teal-deep hover:bg-stone-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-deep"
        >
          {open && inRoll && !cast && !expired ? "Vote on this" : "Open it"}
          <ArrowRight className="w-4 h-4" aria-hidden="true" />
        </Link>
      </div>
    </article>
  );
}
