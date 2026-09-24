/**
 * THE CURRENCY QUESTION, beside the box that answers it.
 *
 * An empty currency box behind a placeholder reads like an answered one, so a
 * village inherits whatever the platform ships and nobody is ever asked. Blank
 * means INHERIT, which is a real state and not an error, so this asks and
 * blocks nothing.
 *
 * IT NAMES NO CODE, deliberately. The platform's own is already shown beside
 * the box, and it is not a constant: a code written into this sentence would
 * be a second copy, wrong the day the default moves. Typing is the answer
 * here, which is why there is no confirm button: the box is empty until
 * somebody types one, unlike the timezone, whose inherited value is already
 * showing and needs a way to agree with it.
 *
 * Its own file because `client/src/pages/Admin.tsx` is on a line ratchet that
 * only turns down, and because the picker beside it belongs to another lane:
 * this owns the question, that owns the field. Light-only, like the rest of
 * this folder.
 */
export default function CurrencyAnswerNote({ answered }: { answered: boolean }) {
  if (answered) return null;
  return (
    <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mt-2">
      Needs your answer. Until somebody here types a code, prices follow the platform's own
      currency, which is where it starts and not something this village chose. Type yours, even if
      it is already the one shown.
    </p>
  );
}
