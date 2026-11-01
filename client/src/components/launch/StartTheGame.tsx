/**
 * STARTING THE GAME: the card on Journey to Launch that opens the village's
 * vote on starting its Game (R74). Moved out of pages/JourneyToLaunch.tsx when
 * the founder-path pass of 2026-11-01 gave it the governance gate and an
 * in-page refusal, and the page crossed the monolith ratchet's 1,000 lines.
 * Nothing about it changed in the move except those two additions.
 */
import { Link } from "wouter";
import { Rocket } from "lucide-react";
import StewardSlatePicker, { type StewardCandidate } from "@/components/governance/StewardSlatePicker";

/** What `/api/admin/launch` says about the launch vote itself (R74). */
export interface LaunchVote {
  /**
   * Whether the governance module is on for members. The vote is held there,
   * and `POST /api/admin/launch/propose` refuses while it is off, a refusal
   * this card used to learn about only by asking and getting a browser alert.
   * Absent on a server older than the field, which reads as "not known".
   */
  governanceOn?: boolean;
  /** How many people hold a voice today. Null when the roll could not be read. */
  onTheRoll: number | null;
  /** The roll is short of the floor, said as a fact. Null when it is not. */
  tooFew: string | null;
  unityPct: number | null;
  quorumPct: number | null;
  minElectorate: number | null;
  why: string | null;
  openBallot: { id: string; title: string; closesAt: string; electorateCount: number; voted: number } | null;
  past: Array<{ id: string; status: string; closedAt: string | null; outcomeNote: string | null }>;
}

/**
 * STARTING THE GAME (R74). The card that used to mark a village launched.
 *
 * Four states and one of them is new, so each gets its own words and nothing
 * is inferred from a missing field:
 *
 *   a vote is running     what it is waiting for, and where to go and vote
 *   the roll is short     how many hold a voice, and how many more
 *   ready to ask          the ask, with what carrying it needs
 *   items still open      how many, unchanged from before
 *
 * R55 and R56 govern every sentence here. A village that has not started is
 * YOUNG. There is no countdown, nothing is late, no village is compared to
 * another, and the one cautionary-looking line is a count of people, which is
 * a thing the founder cannot otherwise see.
 */
export default function StartTheGame({
  status,
  vote,
  isFounder,
  busy,
  onAsk,
  candidates,
  powerCount,
  slate,
  onToggleSlate,
  refusal,
}: {
  status: any;
  vote: LaunchVote | null;
  isFounder: boolean;
  busy: boolean;
  onAsk: () => void;
  candidates: StewardCandidate[];
  powerCount: number;
  slate: string[];
  onToggleSlate: (id: string) => void;
  /** What the server said when it refused the ask, shown on the card. */
  refusal: string;
}) {
  const running = vote?.openBallot ?? null;
  const shortOfPeople = !!vote?.tooFew;
  const governanceOff = vote?.governanceOn === false;
  const canAsk = !!status.readyToLaunch && !shortOfPeople && !governanceOff && !running && isFounder;

  return (
    <section
      className={`rounded-xl border p-5 ${
        status.readyToLaunch && !shortOfPeople ? "bg-teal-deep/5 border-teal-deep/30" : "bg-white border-stone-200"
      }`}
    >
      <div className="flex items-center gap-3 flex-wrap justify-between">
        <div>
          <p className="font-semibold text-stone-900 flex items-center gap-2">
            <Rocket className="w-4 h-4 text-teal-deep" /> Start the Game
          </p>
          {!running && governanceOff && (
            <p className="text-xs text-stone-700 mt-1 max-w-md">
              The vote is held in the governance module, and it is off for members.{" "}
              <Link href="/modules/governance" className="text-teal-deep underline">
                Turn it on for members first
              </Link>
              .
            </p>
          )}
          {!running && !status.readyToLaunch && shortOfPeople && (
            <p className="text-xs text-stone-700 mt-1 max-w-md">{vote?.tooFew}</p>
          )}
          <p className="text-xs text-stone-500 mt-1 max-w-md">
            {running
              ? `The village is voting on this now. ${running.voted} of ${running.electorateCount} have answered, and it closes on ${new Date(running.closesAt).toLocaleDateString()}.`
              : !status.readyToLaunch
                ? `${status.blockingOpen} item(s) on the journey still block the vote. The button opens when they read done.`
                : shortOfPeople
                  ? vote?.tooFew
                  : vote?.why ?? "This opens the village's vote on starting its Game."}
          </p>
          {!running && status.readyToLaunch && !shortOfPeople && vote?.unityPct != null && vote?.quorumPct != null && (
            <p className="text-xs text-stone-500 mt-1 max-w-md">
              It carries when {vote.quorumPct}% of the roll has answered and {vote.unityPct}% of those who take a side agree.
              {vote.onTheRoll != null && ` ${vote.onTheRoll} people hold a voice today.`}
            </p>
          )}
        </div>
        {running ? (
          <Link
            href={`/decisions/${running.id}`}
            className="text-sm bg-teal-deep text-white rounded-lg px-5 py-2.5 font-semibold"
          >
            Open the vote
          </Link>
        ) : (
          <button
            onClick={onAsk}
            disabled={!canAsk || busy}
            title={isFounder ? undefined : "Opening this vote is a founder's act"}
            className="text-sm bg-teal-deep text-white rounded-lg px-5 py-2.5 font-semibold disabled:opacity-40"
          >
            Ask the village
          </button>
        )}
      </div>

      {/* THE SLATE IS PART OF THE PROPOSAL, so it is picked on the same card
          that opens it and never in a step of its own. It is hidden once a
          vote is running, because the slate froze when that vote opened and an
          editable list beside a frozen one would read as a list somebody could
          still change. */}
      {refusal && (
        <p role="alert" className="mt-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          {refusal}
        </p>
      )}
      {!running && isFounder && <StewardSlatePicker candidates={candidates} powerCount={powerCount} chosen={slate} onToggle={onToggleSlate} disabled={busy} />}

      {/*
        * Every time this village has asked before. A vote that closed without
        * starting the Game is part of the journey and belongs on the record,
        * so nobody has to wonder whether the last one happened.
        */}
      {vote && vote.past.length > 0 && (
        <ul className="mt-4 border-t border-stone-900/10 pt-3 space-y-1.5">
          {vote.past.map((p) => (
            <li key={p.id} className="text-xs text-stone-600">
              <Link href={`/decisions/${p.id}`} className="font-medium text-teal-deep hover:underline">
                {p.closedAt ? new Date(p.closedAt).toLocaleDateString() : "Closed"}
              </Link>
              {": "}
              {p.status === "no_quorum"
                ? "not everyone answered"
                : p.status === "withdrawn"
                  ? "called off"
                  : p.status === "failed"
                    ? "did not carry"
                    : p.status}
              {p.outcomeNote ? `. ${p.outcomeNote}` : ""}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
