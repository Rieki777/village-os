/**
 * The exit-policy editor's shared parts, moved out of client/src/pages/Admin.tsx.
 *
 * They came out together because they are one idea: the controls and the
 * comparison that let a founder see which of the published exit terms are
 * still the platform's starting words and which the village has made its own.
 * Nothing outside the Departures tab uses them.
 *
 * The move was forced by scripts/check-file-lines.mjs, which holds Admin.tsx
 * to a ratchet it was already sitting exactly on, and it is the move that
 * guard asks for: an admin surface belongs in client/src/components/admin/.
 */
import { useId } from "react";

/**
 * An ordered list of sentences, editable. Used by the exit policy for the two
 * step lists /exit-policy prints as numbered lists.
 *
 * Rows are addressed by index, so a step keeps its position while it is being
 * retyped. Every control clears 44px and carries a text label, because "the
 * red one deletes" is not a label.
 */
export function StepListEditor({
  label, hint, steps, onChange,
}: {
  label: string;
  hint?: string;
  steps: string[];
  onChange: (next: string[]) => void;
}) {
  const set = (i: number, v: string) => onChange(steps.map((s, j) => (j === i ? v : s)));
  const remove = (i: number) => onChange(steps.filter((_, j) => j !== i));
  const move = (i: number, by: number) => {
    const j = i + by;
    if (j < 0 || j >= steps.length) return;
    const next = [...steps];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };
  const btn = "min-h-[44px] min-w-[44px] px-3 text-xs rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-teal-deep disabled:opacity-40";
  // An HTML id may not contain whitespace, and the label is a sentence.
  const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return (
    <fieldset className="mb-4 border-0 p-0 m-0">
      <legend className="text-xs font-medium text-gray-700">{label}</legend>
      {hint && <p className="text-[11px] text-gray-500 mb-2">{hint}</p>}
      <ol className="space-y-2">
        {steps.map((s, i) => (
          <li key={i} className="flex items-start gap-2">
            <span className="text-xs text-gray-400 mt-3 w-4 text-right shrink-0">{i + 1}.</span>
            <label className="sr-only" htmlFor={`step-${slug}-${i}`}>{`Step ${i + 1} of ${label}`}</label>
            <textarea id={`step-${slug}-${i}`} rows={2} value={s} onChange={(e) => set(i, e.target.value)}
              className="flex-1 min-h-[44px] border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-deep" />
            <div className="flex flex-col gap-1 shrink-0">
              <button type="button" className={btn} onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Move step ${i + 1} up`}>Up</button>
              <button type="button" className={btn} onClick={() => move(i, 1)} disabled={i === steps.length - 1} aria-label={`Move step ${i + 1} down`}>Down</button>
            </div>
            <button type="button" className={`${btn} text-red-600 border-red-200`} onClick={() => remove(i)} aria-label={`Remove step ${i + 1}`}>Remove</button>
          </li>
        ))}
      </ol>
      <button type="button" onClick={() => onChange([...steps, ""])}
        className="mt-2 min-h-[44px] px-3 text-xs rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-teal-deep">
        Add a step
      </button>
    </fieldset>
  );
}

/** Whitespace and case are formatting, so they never count as new words. */
export const sameWords = (a: unknown, b: unknown) =>
  String(a ?? "").replace(/\s+/g, " ").trim().toLowerCase() === String(b ?? "").replace(/\s+/g, " ").trim().toLowerCase();

const sameSteps = (a: unknown, b: unknown) => {
  const x = Array.isArray(a) ? a : [];
  const y = Array.isArray(b) ? b : [];
  return x.length === y.length && x.every((s, i) => sameWords(s, y[i]));
};

/**
 * The rendered terms of the exit policy that are still word for word the
 * platform's. The same four the server checks, computed from the SAME defaults
 * the server sends down, so the editor can never disagree with the refusal.
 */
export function stalePolicyTerms(draft: any, defaults: any): string[] {
  if (!draft || !defaults) return [];
  const out: string[] = [];
  if (sameWords(draft.voluntary?.valuationMethod, defaults.voluntary?.valuationMethod)) out.push("How contributed value is honored");
  if (sameSteps(draft.voluntary?.unwindSteps, defaults.voluntary?.unwindSteps)) out.push("The steps of a voluntary departure");
  if (sameWords(draft.involuntary?.process, defaults.involuntary?.process)) out.push("If the village asks someone to leave");
  if (sameSteps(draft.restorative?.steps, defaults.restorative?.steps)) out.push("The restorative path");
  return out;
}
