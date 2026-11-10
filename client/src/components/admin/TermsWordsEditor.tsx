/**
 * THE ROLE'S SUGGESTED WORDING FOR EACH OF THE EIGHT SETTINGS, and the commitment it asks
 * (joining lane PR 3). Sits inside the terms-on-offer editor, so it saves through the same org
 * draft as the rest of the offer. A setting left empty shows the candidate "We'll set this
 * together." The platform ships none: a village writes its own.
 *
 * Light only, like its neighbours: the admin panel is a light workspace.
 */
import { COMMITMENT_CHOICES, TERM_KEYS, TERM_LABELS, type TermKey } from "@shared/termsWords";

type Offer = Record<string, any>;

export const WORDS_EDITOR = {
  title: "What we suggest, setting by setting",
  sub: "Candidates read these and accept each one or ask to talk. Leave a setting empty and they read: We'll set this together.",
  commitment: "Commitment this role asks",
  commitmentNone: "Not set",
  commitmentHint: "A share of energy and attention in a week, never hours. It is a planning signal and no pay is worked out from it.",
} as const;

export default function TermsWordsEditor({ value, onChange }: { value: unknown; onChange: (next: Offer) => void }) {
  const offer: Offer = value && typeof value === "object" ? (value as Offer) : { v: 1 };
  const words: Partial<Record<TermKey, string>> = offer.words ?? {};
  const pct: number | undefined = offer.clocks?.commitmentPct;
  const setWord = (k: TermKey, text: string) => {
    const next = { ...words, [k]: text };
    if (!text.trim()) delete next[k];
    onChange({ ...offer, v: 1, ...(Object.keys(next).length ? { words: next } : { words: undefined }) });
  };
  const setPct = (raw: string) => {
    const clocks = { ...(offer.clocks ?? {}) };
    if (raw === "") delete clocks.commitmentPct;
    else clocks.commitmentPct = Number(raw);
    onChange({ ...offer, v: 1, clocks: Object.keys(clocks).length ? clocks : undefined });
  };
  return (
    <div className="mb-4 grid gap-3 rounded-lg border border-gray-100 p-3" data-terms-words-editor="">
      <div>
        <p className="text-sm font-medium text-gray-800">{WORDS_EDITOR.title}</p>
        <p className="text-xs text-gray-500">{WORDS_EDITOR.sub}</p>
      </div>
      {TERM_KEYS.map((k) => (
        <label key={k} className="grid gap-1 text-sm text-gray-700">
          {TERM_LABELS[k]}
          <textarea rows={2} maxLength={600} value={words[k] ?? ""} onChange={(e) => setWord(k, e.target.value)} className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm" />
        </label>
      ))}
      <label className="grid gap-1 text-sm text-gray-700">
        {WORDS_EDITOR.commitment}
        <select value={pct === undefined ? "" : String(pct)} onChange={(e) => setPct(e.target.value)} className="min-h-[44px] w-full rounded-lg border border-gray-200 px-3 text-sm sm:max-w-xs">
          <option value="">{WORDS_EDITOR.commitmentNone}</option>
          {COMMITMENT_CHOICES.map((n) => (
            <option key={n} value={n}>
              {n}%
            </option>
          ))}
        </select>
        <span className="text-xs text-gray-500">{WORDS_EDITOR.commitmentHint}</span>
      </label>
    </div>
  );
}
