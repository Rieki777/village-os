/**
 * WHO MAY VOTE, and who has spoken.
 *
 * The engine freezes an electorate at open and stores each member's weight
 * beside their name. That roll is the answer to the question a member actually
 * has when they look at a live decision, which is not "what is the percentage"
 * but "who is this, and where do I sit in it".
 *
 * So this renders the WHOLE roll, not only the voters: everyone who has spoken
 * with what they said, then everyone the village is still waiting on. Hypha
 * ships a voter list (harvest section 2, `voter-list.vue`); the silent half is
 * ours, because a quorum bar that is short is a fact about specific people who
 * have not answered yet, and naming them is how a village chases a vote
 * instead of watching a bar.
 *
 * THIS VILLAGE DOES NOT RUN SECRET BALLOTS, and the card says so rather than
 * letting a member discover it after voting. Design section 9 names that as a
 * shipped limitation; a limitation nobody is told about is a trap.
 */
import { useState } from "react";
import { CircleCheck, CircleHelp, CircleMinus, CircleX, Users } from "lucide-react";
import type { VoteChoice } from "@shared/governanceEngine";
import InfoTip from "@/components/InfoTip";
import { weightText } from "./voteBars";
import type { BallotSilent, BallotVote } from "./governanceApi";

/**
 * What each vote reads as. The authority is `VOTE_CHOICES` in
 * `shared/governanceEngine.ts`, and because that union is in this same
 * TypeScript program the compiler holds this map complete against it: a
 * fourth choice added there turns this declaration red.
 *
 * The FALLBACK below is for the case the compiler cannot see, which is the
 * one that took two pages down today. `v.choice` arrives over HTTP and is
 * typed by assertion, so `Record<Union, T>` types this index as total while
 * only asserting a claim about the server. A client build older than the
 * server it is talking to meets a choice this union never held, and read
 * straight the next line throws inside the list and takes the whole decision
 * page to the error boundary for every member.
 */
const CHOICE_MARK: Record<VoteChoice, { icon: typeof CircleCheck; label: string; tone: string }> = {
  yes: { icon: CircleCheck, label: "Yes", tone: "text-open" },
  abstain: { icon: CircleMinus, label: "Abstain", tone: "text-muted-foreground" },
  no: { icon: CircleX, label: "No", tone: "text-destructive" },
};

/**
 * A choice nobody has taught this roll yet, read as itself. Never guessed into
 * one of the three above: what this member said is on the ballot's record, and
 * printing "Abstain" over a yes would be a false statement about their vote.
 */
const UNKNOWN_CHOICE = { icon: CircleHelp, label: "Recorded", tone: "text-muted-foreground" };

export const VOTER_ROLL_CHOICES = CHOICE_MARK;

/** The mark beside a name, never undefined. */
export function choiceMark(choice: VoteChoice): { icon: typeof CircleCheck; label: string; tone: string } {
  return CHOICE_MARK[choice] ?? UNKNOWN_CHOICE;
}

const SHOWN_AT_FIRST = 8;

export default function VoterRoll({
  votes,
  silent,
  live,
}: {
  votes: BallotVote[];
  silent: BallotSilent[];
  /** An open ballot is still waiting; a closed one has finished waiting. */
  live: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const total = votes.length + silent.length;
  const shownVotes = expanded ? votes : votes.slice(0, SHOWN_AT_FIRST);
  const shownSilent = expanded ? silent : silent.slice(0, SHOWN_AT_FIRST);
  const hidden = total - shownVotes.length - shownSilent.length;

  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <h3 className="flex items-center gap-2 text-base font-bold text-foreground">
        <Users className="w-4 h-4 text-notice" aria-hidden="true" />
        Who may vote
        <InfoTip
          tip="This roll froze when the ballot opened. Members who joined since are not on it, and members who left still are."
          label="How the roll is decided"
        />
      </h3>
      <p className="mt-1 text-sm text-muted-foreground">
        {total} {total === 1 ? "member" : "members"}, {votes.length} spoken, {silent.length} yet to.
      </p>

      {votes.length > 0 && (
        <ul className="mt-3 divide-y divide-border">
          {shownVotes.map((v) => {
            const mark = choiceMark(v.choice);
            const Icon = mark.icon;
            return (
              <li key={`${v.name}-${v.castAt}`} className="flex items-center justify-between gap-3 py-2">
                <span className="flex min-w-0 items-center gap-2">
                  <Icon className={`w-4 h-4 shrink-0 ${mark.tone}`} aria-hidden="true" />
                  <span className="truncate text-sm text-foreground">{v.name}</span>
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">{mark.label}</span>
                  <span className="text-muted-foreground"> · </span>
                  weighs {weightText(v.weight)}
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {silent.length > 0 && (
        <>
          <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {live ? "Still to speak" : "Never spoke"}
          </p>
          <ul className="mt-1 divide-y divide-border">
            {shownSilent.map((s) => (
              <li key={s.name} className="flex items-center justify-between gap-3 py-2">
                <span className="flex min-w-0 items-center gap-2">
                  <span
                    className="w-4 h-4 shrink-0 rounded-full border border-dashed border-border"
                    aria-hidden="true"
                  />
                  <span className="truncate text-sm text-muted-foreground">{s.name}</span>
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">weighs {weightText(s.weight)}</span>
              </li>
            ))}
          </ul>
        </>
      )}

      {hidden > 0 && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="mt-3 min-h-[44px] w-full rounded-lg border border-border px-4 text-sm font-medium text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Show the other {hidden}
        </button>
      )}

      <p className="mt-3 border-t border-border pt-3 text-xs text-muted-foreground leading-relaxed">
        Votes here are on the record with a name against them. This village does not run secret ballots.
      </p>
    </section>
  );
}
