/**
 * THE END DATE A RAISED HAND ASKED FOR, IN THE SUBMISSIONS INBOX.
 *
 * `POST /api/map/roles/:id/raise-hand` stores `termEndsOn`, `followsSeason`
 * and `caution` in the submission's data since 0199 (server/lib/raisedHandTerm.ts).
 * The inbox's generic table would print them as three raw rows, one of them
 * the word "true", so this says them as one sentence and gives the caution a
 * line of its own where a founder reads it before seating anybody.
 *
 * The hand does not seat anybody, and nothing copies its date onto the seat.
 * The sentence says what to do on the seating screen to honour it.
 *
 * Light-only, like the rest of the admin panel.
 */

/** The data keys this component says, which the generic table leaves out. */
export const RAISED_HAND_TERM_KEYS: readonly string[] = ["termEndsOn", "followsSeason", "caution"];

export function raisedHandTermSentence(data: Record<string, unknown>): string {
  const endsOn = typeof data.termEndsOn === "string" ? data.termEndsOn.trim() : "";
  if (!endsOn) {
    return "This hand was raised before a hand could name an end date. Seat them with no end date and the seat ends with the season.";
  }
  if (data.followsSeason === true) {
    return `Asks to sit until the season ends, which was ${endsOn} when the hand was raised. Seat them with no end date to honour it.`;
  }
  return `Asks to sit until ${endsOn}. Give the seat that end date when you seat them.`;
}

export function RaisedHandTerm({ data }: { data: Record<string, unknown> }) {
  const caution = typeof data.caution === "string" && data.caution.trim() ? data.caution : null;
  return (
    <div className="mb-4 rounded-lg border border-gray-200 bg-white px-3 py-2" data-raised-hand-term>
      <p className="text-xs font-medium text-gray-500">How long</p>
      <p className="text-sm text-gray-800">{raisedHandTermSentence(data)}</p>
      {caution && <p className="mt-1 text-sm text-amber-800">{caution}</p>}
    </div>
  );
}
