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
  yes: { label: "You voted yes", icon: CircleCheck, tone: "text-open" },
  abstain: { label: "You abstained", icon: CircleMinus, tone: "text-muted-foreground" },
  no: { label: "You voted no", icon: CircleX, tone: "text-destructive" },
};

const CLOSED_WORD: Record<string, string> = {
  passed: "Carried",
  failed: "Did not carry",
  no_quorum: "Too few spoke",
  no_quorum_rerun: "Asked again",
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
    <article className="rounded-xl border border-border bg-card p-4 shadow-sm transition-shadow hover:shadow-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
          {subjectNoun(ballot.subjectType)}
        </span>
        {open ? (
          expired ? (
            <span className="rounded-full bg-notice/10 px-2.5 py-0.5 text-xs font-semibold text-notice">
              Waiting to be closed
            </span>
          ) : (
            <span className="rounded-full bg-open/10 px-2.5 py-0.5 text-xs font-semibold text-open">Voting now</span>
          )
        ) : (
          <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-semibold text-foreground">
            {CLOSED_WORD[ballot.status] ?? "Closed"}
          </span>
        )}
      </div>

      <h3 className="mt-2 text-lg font-bold leading-snug text-foreground">
        <Link
          href={`/decisions/${ballot.id}`}
          className="rounded-lg hover:text-notice focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
        <p className="mt-1.5 text-sm text-muted-foreground leading-relaxed">
          {open
            ? "This one asks what the village thinks. Nothing changes by itself when it closes."
            : "This one asked what the village thinks. Nothing changed by itself."}
        </p>
      )}

      {!open && ballot.outcomeNote && (
        <p className="mt-1.5 text-sm italic text-muted-foreground leading-relaxed">{ballot.outcomeNote}</p>
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

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
        <span className="flex items-center gap-3">
          {open && <VoteClock calm closesAt={ballot.closesAt} />}
          {mine && MineIcon ? (
            <span className={`inline-flex items-center gap-1.5 text-sm font-medium ${mine.tone}`}>
              <MineIcon className="w-4 h-4" aria-hidden="true" />
              {mine.label}
            </span>
          ) : cast ? (
            <span className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
              <CircleMinus className="w-4 h-4" aria-hidden="true" />
              {ballot.myVote?.sentence ?? "Cast"}
            </span>
          ) : open && inRoll && !expired ? (
            <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-notice">
              Waiting on you
            </span>
          ) : null}
        </span>

        <Link
          href={`/decisions/${ballot.id}`}
          className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg px-3 text-sm font-semibold text-notice hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {open && inRoll && !cast && !expired ? "Vote on this" : "Open it"}
          <ArrowRight className="w-4 h-4" aria-hidden="true" />
        </Link>
      </div>
    </article>
  );
}
