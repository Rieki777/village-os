/**
 * THE EIGHT SETTINGS, with the role's own suggestion for each (joining lane PR 3).
 *
 * Term, Clocks, Rhythm, Allowance, Bonus, Goals, Scoreboard, Ending. The role card holds a
 * suggested wording per setting; the candidate marks each "I accept" or "let's talk", with an
 * optional note. A setting the role has not written reads "We'll set this together." and asks
 * for no answer. Clocks also carries the candidate's commitment: a percentage of their energy
 * and attention, 0 to 100 in steps of ten, with no default. It is a planning signal, never hours.
 *
 * Drawn in the profile's look (docs/DESIGN_RULE.md): panels and tiles on the semantic tokens,
 * the eyebrow over each setting, gold focus, 44px targets. One component for both doors, the open
 * form and the member door, so they cannot drift apart.
 */
import { useLingui } from "@lingui/react/macro";
import {
  COMMITMENT_CHOICES,
  COMMITMENT_HINT,
  SET_TOGETHER,
  TERMS_HINT,
  TERM_KEYS,
  TERM_NOTE_MAX,
  commitmentWords,
  type TermAnswers,
  type TermKey,
  type TermsWords,
} from "@shared/termsWords";

export interface TermsRole {
  id: string;
  name: string;
  words?: TermsWords;
  /** The commitment the role asks, when its card says. */
  commitmentPct?: number | null;
}

export interface TermsStepValue {
  answers: TermAnswers;
  /** Null until the person chooses: there is no default. */
  commitmentPct: number | null;
}

export const EMPTY_TERMS_STEP: TermsStepValue = { answers: {}, commitmentPct: null };

// The profile's shapes (docs/DESIGN_RULE.md): a tile, the eyebrow, a field, a hint.
const TILE = "rounded-xl border border-border bg-muted p-4";
const EYEBROW = "text-xs font-semibold uppercase tracking-widest text-notice";
const HINT = "text-sm text-muted-foreground";
const FIELD = "w-full rounded-lg border border-border bg-background px-3 py-2 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring";

export default function TermsEight({
  roles,
  value,
  onChange,
  problem,
  idPrefix = "terms",
}: {
  roles: ReadonlyArray<TermsRole>;
  value: TermsStepValue;
  onChange: (next: TermsStepValue) => void;
  problem?: string | null;
  idPrefix?: string;
}) {
  const { t } = useLingui();
  const labels: Record<TermKey, string> = {
    term: t({ message: "Term", context: "terms setting" }),
    clocks: t({ message: "Clocks", context: "terms setting" }),
    rhythm: t({ message: "Rhythm", context: "terms setting" }),
    allowance: t({ message: "Allowance", context: "terms setting" }),
    bonus: t({ message: "Bonus", context: "terms setting" }),
    goals: t({ message: "Goals", context: "terms setting" }),
    scoreboard: t({ message: "Scoreboard", context: "terms setting" }),
    ending: t({ message: "Ending", context: "terms setting" }),
  };
  const several = roles.length > 1;
  const setAnswer = (k: TermKey, next: { choice: "accept" | "talk"; note: string } | undefined) => {
    const answers = { ...value.answers };
    if (next) answers[k] = next;
    else delete answers[k];
    onChange({ ...value, answers });
  };

  return (
    <fieldset className="grid gap-3" data-terms-eight="">
      <legend className="sr-only">{t`The terms`}</legend>
      <p className={HINT} data-terms-hint="">
        {t`Mark anything you'd like to talk through. Nothing is final until we agree together.`}
      </p>
      {TERM_KEYS.map((k) => {
        const lines = roles
          .map((r) => ({ role: r, text: r.words?.[k]?.trim() ?? "", commitment: k === "clocks" ? (r.commitmentPct ?? null) : null }))
          .filter((l) => l.text || l.commitment !== null);
        const written = lines.length > 0;
        const answer = value.answers[k];
        const name = `${idPrefix}-${k}`;
        return (
          <div key={k} className={TILE} data-term={k} data-written={written ? "yes" : "no"}>
            <p className={EYEBROW}>{labels[k]}</p>
            {written ? (
              <div className="mt-2 grid gap-2">
                {lines.map((l) => (
                  <div key={l.role.id} className="text-foreground">
                    {several && <p className="text-sm font-semibold text-foreground">{l.role.name}</p>}
                    {l.commitment !== null && <p className="font-medium">{commitmentWords(l.commitment)}</p>}
                    {l.text && <p className="whitespace-pre-line break-words leading-relaxed">{l.text}</p>}
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-2 text-foreground" data-set-together="">
                {t`We'll set this together.`}
              </p>
            )}
            {written && (
              <div className="mt-3 grid gap-1" role="radiogroup" aria-label={labels[k]}>
                <label className="flex min-h-11 items-center gap-2 text-sm text-foreground">
                  <input type="radio" name={name} className="size-4 accent-notice" checked={answer?.choice === "accept"} onChange={() => setAnswer(k, { choice: "accept", note: answer?.note ?? "" })} />
                  {t`I accept`}
                </label>
                <label className="flex min-h-11 items-center gap-2 text-sm text-foreground">
                  <input type="radio" name={name} className="size-4 accent-notice" checked={answer?.choice === "talk"} onChange={() => setAnswer(k, { choice: "talk", note: answer?.note ?? "" })} />
                  {t`Let's talk`}
                </label>
                {answer?.choice === "talk" && (
                  <textarea
                    aria-label={t`What you would like to talk about: ${labels[k]}`}
                    placeholder={t`A note, if you like`}
                    rows={2}
                    maxLength={TERM_NOTE_MAX}
                    value={answer.note}
                    onChange={(e) => setAnswer(k, { choice: "talk", note: e.target.value })}
                    className={FIELD}
                  />
                )}
              </div>
            )}
            {k === "clocks" && (
              <div className="mt-4 border-t border-border pt-4" data-commitment="">
                <label htmlFor={`${idPrefix}-commitment`} className="text-sm font-semibold text-foreground">
                  {t`Your commitment`}
                </label>
                <p className={`${HINT} mt-1`}>{t`How much of your energy and attention this role gets in a week. 100% is full commitment, and you manage your own workload.`}</p>
                <select
                  id={`${idPrefix}-commitment`}
                  value={value.commitmentPct === null ? "" : String(value.commitmentPct)}
                  onChange={(e) => onChange({ ...value, commitmentPct: e.target.value === "" ? null : Number(e.target.value) })}
                  className={`${FIELD} mt-2 min-h-11 sm:max-w-xs`}
                  required
                >
                  <option value="">{t`Choose your commitment`}</option>
                  {COMMITMENT_CHOICES.map((n) => (
                    <option key={n} value={n}>
                      {n}%
                    </option>
                  ))}
                </select>
                <p className={`${HINT} mt-2`} data-commitment-hint="">
                  {t`This is about energy and attention, never hours. You can change it later.`}
                </p>
              </div>
            )}
          </div>
        );
      })}
      {problem && (
        <p role="alert" className="text-sm font-medium text-destructive">
          {problem}
        </p>
      )}
    </fieldset>
  );
}

// Kept so a test can hold the lines the lead named word for word.
export { COMMITMENT_HINT, SET_TOGETHER, TERMS_HINT };
