export interface StewardCandidate {
  id: string;
  name: string;
}

/**
 * WHO THIS PROPOSAL PUTS FORWARD FOR THE STEWARD'S SEAT (0220).
 *
 * IN ITS OWN FILE because client/src/pages/JourneyToLaunch.tsx is under the
 * monolith ratchet (`scripts/check-file-lines.mjs`) and this picker took that
 * page across 1000 lines. It is one card with one job and nothing on the
 * launch page reads its internals, so it moved whole.
 *
 * Rye, 2026-09-24, choosing between two designs: "is whoever is clicking the
 * 'launch village' button then selects from a list of members in the proposal
 * to carry the steward role so then it's there in the proposal to be voted on.
 * I like this second route better." And: "founders only for this first season
 * (after that anyone can raise their hand for a steward role and fill it if
 * voted in), and show the declines".
 *
 * ── THREE THINGS THIS CARD HAS TO SAY OUT LOUD ────────────────────────────
 *
 * IT IS THIS PERSON'S CHOICE. Whoever is looking at this card is about to put
 * names in front of the whole village under their own name, and the ballot
 * page will say so. The card says it here first.
 *
 * IT IS FOUNDERS ONLY, AND ONLY FOR NOW. The list comes from the server so
 * the rule has one home, and the sentence says what happens after this season
 * so nobody reads a first-season mechanism as a permanent one.
 *
 * NOBODY IS SEATED BY BEING PICKED. Each person accepts or declines, and
 * picking nobody is a real choice with a real outcome. A card that read like
 * an appointment would be the exact harm the acceptance step exists to stop.
 */
export interface StewardCandidate {
  id: string;
  name: string;
}

export default function StewardSlatePicker({
  candidates,
  powerCount,
  chosen,
  onToggle,
  disabled,
}: {
  candidates: StewardCandidate[];
  powerCount: number;
  chosen: string[];
  onToggle: (id: string) => void;
  disabled: boolean;
}) {
  if (candidates.length === 0) return null;
  return (
    <div className="mt-4 border-t border-stone-900/10 pt-4">
      <p className="text-sm font-semibold text-stone-900">Who carries the steward's seat</p>
      <p className="mt-1 text-xs text-stone-600 max-w-lg leading-relaxed">
        You are choosing this list, and the proposal says so. Everyone you pick answers for themselves, and carrying the
        seat for this first season means holding all {powerCount} of the powers this village has to give. Founding
        members only for this first season. After it, anybody can raise their hand for the seat and the village votes
        them in.
      </p>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {candidates.map((c) => (
          <label
            key={c.id}
            className={`flex min-h-[44px] items-center gap-3 rounded-lg border px-3 py-2 text-sm ${
              chosen.includes(c.id) ? "border-teal-deep bg-teal-deep/10 text-stone-900" : "border-stone-300 bg-white text-stone-700"
            }`}
          >
            <input
              type="checkbox"
              checked={chosen.includes(c.id)}
              disabled={disabled}
              onChange={() => onToggle(c.id)}
              className="h-5 w-5 shrink-0 rounded border-stone-400 text-teal-deep focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-deep"
            />
            <span>{c.name}</span>
          </label>
        ))}
      </div>
      <p className="mt-2 text-xs text-stone-500">
        {chosen.length === 0
          ? "Nobody picked, so the village starts with the seat empty. That stops nothing, and the village can vote somebody into it whenever it likes."
          : `${chosen.length} named. Whoever accepts before the vote closes is seated when it carries.`}
      </p>
    </div>
  );
}
