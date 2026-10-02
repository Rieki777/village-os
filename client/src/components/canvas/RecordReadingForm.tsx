/**
 * Recording one reading of one block: a level, a sentence, and the occasion.
 *
 * Rendered only for the canvas pen, which the server decides (`mayRecord` on
 * GET /api/canvas, from the one capability gate). The page being wrong about
 * that costs nothing, because the write is refused by the same gate.
 *
 * The form checks with `parseCanvasReading`, the validator the route itself
 * runs, so a person sees the server's own words before anything is sent and
 * never a second, different refusal after. The network call belongs to the
 * view above; this component only hands it a checked reading.
 */
import { useState } from "react";
import {
  CANVAS_LEVELS,
  CANVAS_MOMENTS,
  CANVAS_SENTENCE_MAX,
  LEVEL_MEANINGS,
  LEVEL_WORDS,
  MOMENT_LABELS,
  parseCanvasReading,
  type CanvasBlock,
  type CanvasLevel,
  type CanvasMoment,
  type CanvasReadingInput,
} from "@shared/governanceCanvas";

export function RecordReadingForm({
  block,
  firstReading,
  onSave,
  onCancel,
}: {
  block: CanvasBlock;
  /** No reading of this block exists yet, so this one is its baseline. */
  firstReading: boolean;
  /** Sends the reading. Resolves to null when saved, or to the sentence that refused it. */
  onSave: (reading: CanvasReadingInput) => Promise<string | null>;
  onCancel: () => void;
}) {
  const [level, setLevel] = useState<CanvasLevel | null>(null);
  const [sentence, setSentence] = useState("");
  const [moment, setMoment] = useState<CanvasMoment>(firstReading ? "baseline" : "canvas-moon");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const parsed = parseCanvasReading({ blockId: block.id, level, sentence, moment });
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }
    setBusy(true);
    setError(null);
    const refused = await onSave(parsed.reading);
    setBusy(false);
    if (refused) setError(refused);
  };

  return (
    <form
      className="mt-4 space-y-3 border-t border-stone-100 pt-4"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <fieldset>
        <legend className="text-sm font-medium text-stone-900">Where does {block.name} stand today?</legend>
        <div className="mt-2 space-y-1.5">
          {CANVAS_LEVELS.map((l) => (
            <label key={l} className="flex items-start gap-2 text-sm text-stone-700 cursor-pointer">
              <input
                type="radio"
                name={`canvas-level-${block.id}`}
                value={l}
                checked={level === l}
                onChange={() => setLevel(l)}
                className="mt-1"
              />
              <span>
                <span className="font-medium text-stone-900">{LEVEL_WORDS[l]}</span>
                <span className="text-stone-600">. {LEVEL_MEANINGS[l]}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <label className="block text-sm">
        <span className="font-medium text-stone-900">Why, in one sentence</span>
        <textarea
          value={sentence}
          onChange={(e) => setSentence(e.target.value)}
          maxLength={CANVAS_SENTENCE_MAX}
          rows={3}
          className="mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900"
        />
      </label>

      <label className="block text-sm">
        <span className="font-medium text-stone-900">The occasion</span>
        <select
          value={moment}
          onChange={(e) => setMoment(e.target.value as CanvasMoment)}
          className="mt-1 block rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900"
        >
          {CANVAS_MOMENTS.map((m) => (
            <option key={m} value={m}>
              {MOMENT_LABELS[m]}
            </option>
          ))}
        </select>
      </label>

      {error && (
        <p role="alert" className="text-sm text-red-700 bg-red-50 rounded-lg px-3 py-2">
          {error}
        </p>
      )}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={busy}
          className="text-sm font-medium rounded-lg px-3 py-1.5 text-white bg-teal-deep border border-teal-deep disabled:opacity-60"
        >
          {busy ? "Saving" : "Save this reading"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="text-sm font-medium rounded-lg px-3 py-1.5 text-stone-700 border border-stone-200 hover:bg-stone-50"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
