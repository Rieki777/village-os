/**
 * WHO A LAUNCH PROPOSAL NAMES FOR THE STEWARD'S SEAT, AND WHAT EACH OF THEM
 * SAID BACK.
 *
 * Rye, 2026-09-24, choosing between two designs: "is whoever is clicking the
 * 'launch village' button then selects from a list of members in the proposal
 * to carry the steward role so then it's there in the proposal to be voted on.
 * I like this second route better." And: "founders only for this first season
 * (after that anyone can raise their hand for a steward role and fill it if
 * voted in), and show the declines".
 *
 * ── TWO THINGS THIS PANEL IS HONEST ABOUT, AND THEY ARE THE WHOLE POINT ────
 *
 * ONE PERSON CHOSE THIS LIST. The village is voting on somebody else's
 * choice, and the heading says whose. A slate that appeared without a name
 * attached would read as the village's own decision, which it is not until the
 * vote carries.
 *
 * EVERY DECLINE IS VISIBLE TO EVERYBODY. Not to an administrator, not to the
 * person who declined: to the village. This village does not run secret
 * ballots and the decision page already shows every vote and every weight, so
 * hiding "I was asked to hold every power here and said no" would be the one
 * thing on the page a member could not see. It is also the fact a village most
 * needs before it votes: a slate whose members have all declined seats nobody.
 *
 * ── WHY DECLINING IS HERE AND ACCEPTING IS NOT ────────────────────────────
 *
 * Accepting lives on the vote (`VoteWidget`), because the acceptance is
 * carried on the vote row and there is no row until somebody votes. Declining
 * cannot wait for that: being named for nineteen powers you do not want is
 * exactly the state somebody should be able to answer the moment they read it,
 * and a decline is recorded on the nomination's own row.
 */
import { CircleCheck, CircleSlash, Clock, Loader2 } from "lucide-react";
import type { StewardSlate as StewardSlateData } from "./governanceApi";

const ANSWER_STYLE: Record<StewardSlateData["members"][number]["answer"], string> = {
  accepted: "border-sage bg-sage-light text-sage",
  declined: "border-stone-400 bg-stone-100 text-stone-700",
  waiting: "border-stone-300 bg-white text-stone-600",
};

const ANSWER_ICON: Record<StewardSlateData["members"][number]["answer"], typeof CircleCheck> = {
  accepted: CircleCheck,
  declined: CircleSlash,
  waiting: Clock,
};

/**
 * ONE SENTENCE PER STATE, keyed by the union the server sends.
 *
 * A `Record` keyed by the union and not by `string`, which is the house rule
 * for a lookup table beside a server union: a state added on the server with no
 * sentence here becomes a compile error instead of a blank space where a
 * sentence belonged.
 */
const ANSWER_WORD: Record<StewardSlateData["members"][number]["answer"], string> = {
  accepted: "accepted",
  declined: "declined",
  waiting: "has not answered yet",
};

export default function StewardSlate({
  slate,
  onAnswer,
  busy,
}: {
  slate: StewardSlateData;
  onAnswer: (accept: boolean) => Promise<void>;
  busy: boolean;
}) {
  const mine = slate.members.find((m) => m.mine) ?? null;
  const accepted = slate.members.filter((m) => m.answer === "accepted").length;
  const declined = slate.members.filter((m) => m.answer === "declined").length;

  if (slate.members.length === 0) {
    return (
      <section className="rounded-xl border border-stone-200 bg-white p-5">
        <h2 className="text-base font-bold text-stone-900">The steward's seat</h2>
        <p className="mt-1 text-sm text-stone-600 leading-relaxed">
          This proposal names nobody for the steward's seat, so the village starts with it empty. That stops nothing:
          decisions land at their landing time either way, and the village can vote anybody into the seat whenever it
          likes.
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-stone-200 bg-white p-5">
      <h2 className="text-base font-bold text-stone-900">Who carries the steward's seat</h2>
      <p className="mt-1 text-sm text-stone-600 leading-relaxed">
        {slate.proposedBy
          ? `${slate.proposedBy} opened this vote and chose this list. Voting yes is voting for it as well as for starting the Game.`
          : "This list was chosen when the vote opened. Voting yes is voting for it as well as for starting the Game."}{" "}
        Each person answers for themselves, and carrying the seat for this first season means holding all{" "}
        {slate.powerCount} of the powers this village has to give.
      </p>

      <ul className="mt-4 space-y-2">
        {slate.members.map((m) => {
          const Icon = ANSWER_ICON[m.answer];
          return (
            <li
              key={m.id}
              className={`flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5 ${ANSWER_STYLE[m.answer]}`}
            >
              <span className="text-sm font-semibold text-stone-900">
                {m.name}
                {m.mine && <span className="ml-1 text-xs font-normal text-stone-600">(you)</span>}
              </span>
              <span className="flex items-center gap-1.5 text-sm">
                <Icon className="h-4 w-4" aria-hidden="true" />
                <span>{ANSWER_WORD[m.answer]}</span>
              </span>
            </li>
          );
        })}
      </ul>

      {/* THE COUNT THE VILLAGE IS ACTUALLY VOTING ON, said in words so nobody
          has to add up a list of chips. A slate everybody declined is the one
          state a member most needs before they vote, and it is one sentence. */}
      <p className="mt-3 text-sm text-stone-600 leading-relaxed">
        {accepted === 0 && declined === slate.members.length
          ? "Everybody named has declined, so this vote seats nobody and the seat starts empty."
          : accepted === 0
            ? "Nobody has accepted yet. Whoever accepts before this vote closes is seated when it carries."
            : `${accepted} of ${slate.members.length} ${accepted === 1 ? "has" : "have"} accepted. Whoever has accepted when this vote carries is seated.`}
      </p>

      {mine && slate.open && (
        <div className="mt-4 border-t border-stone-100 pt-4">
          {mine.answer === "declined" ? (
            <>
              <p className="text-sm text-stone-700 leading-relaxed">
                You declined the steward's seat, and the village can see that. You can change your mind until this vote
                closes.
              </p>
              <button
                type="button"
                disabled={busy}
                onClick={() => void onAnswer(true)}
                className="mt-2 inline-flex min-h-[44px] items-center gap-2 rounded-lg border-2 border-stone-300 bg-white px-4 py-2.5 text-sm font-semibold text-stone-800 hover:border-stone-400 hover:bg-stone-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-deep focus-visible:ring-offset-2 disabled:opacity-60"
              >
                {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                <span>I have changed my mind</span>
              </button>
            </>
          ) : (
            <>
              <p className="text-sm text-stone-700 leading-relaxed">
                This proposal names you. Accepting happens with your vote, above. If you do not want the seat, say so
                here and the village sees your answer.
              </p>
              <button
                type="button"
                disabled={busy}
                onClick={() => void onAnswer(false)}
                className="mt-2 inline-flex min-h-[44px] items-center gap-2 rounded-lg border-2 border-coral bg-white px-4 py-2.5 text-sm font-semibold text-coral hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-deep focus-visible:ring-offset-2 disabled:opacity-60"
              >
                {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                <span>Decline the steward's seat</span>
              </button>
            </>
          )}
        </div>
      )}
    </section>
  );
}
