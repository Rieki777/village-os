/**
 * Step 2: EACH ROLE'S WORDS (role proposals PR C).
 *
 * Every role word the player card shows, prefilled from the posted role, one
 * role at a time. A field whose words differ from the POSTED role is gold and
 * says "Changed from the posted role", with the posted words a tap away. A
 * new role has nothing posted, so every field of it reads "New". Each heading
 * keeps its CCOS term on hover or tap, through the card's own CcosTerm.
 *
 * Proposing for a role somebody holds now, the step shows that role's runbook
 * and its handover meter (`roleHandover`, the card's own four checks) as they
 * stand on the posted role.
 *
 * Each field is checked by the function the save runs (`fieldProblem`), so
 * the line under it is the server's own sentence: "A role answers for 3 to 6
 * things" among them.
 */
import { useId, useState } from "react";
import { CcosTerm, LABEL_TAP } from "@/components/playerCard/CcosTerm";
import { CARD_WORDS as W } from "@shared/playerCard";
import { roleTerm } from "@shared/playerCardCcos";
import { roleHandover } from "@shared/playerCardHealth";
import { runbookIsLink } from "@shared/roleHandover";
import type { WordValue } from "@shared/roleProposals";
import AiHelpButton from "./AiHelpButton";
import type { WordFieldOut } from "./proposalApi";
import { RP_WORDS } from "./proposalWords";
import { EDIT_FIELDS, fieldProblem, NAME_FIELD, stateFrom, shownText, differs, type EditField } from "./roleWords";
import { FieldFrame, FOCUS, INPUT, LEDE, PANEL } from "./parts";

export interface WordsRole {
  /** The role id, or a new role's draft id. */
  id: string;
  name: string;
  isNew: boolean;
  /** The payload's word fields, or null until the role's first save comes back. */
  fields: WordFieldOut[] | null;
  reviewOn: string;
  circle: { id: string; name: string } | null;
  /** Live holders now, from the chart; 0 when nobody holds it. */
  holderCount: number;
}

export interface StepWordsProps {
  roles: readonly WordsRole[];
  typed: Readonly<Record<string, Record<string, string>>>;
  frameworkTerms: boolean;
  onType: (roleId: string, field: string, text: string) => void;
  onReview: (roleId: string, day: string) => void;
}

const list = (v: WordValue | undefined): string[] => (Array.isArray(v) ? v : typeof v === "string" && v ? [v] : []);
const text = (v: WordValue | undefined): string | null => (typeof v === "string" ? v : Array.isArray(v) ? v.join("\n") : null);

/** The runbook and the handover meter of a role somebody holds now, as posted. */
function FromHolder({ role }: { role: WordsRole }) {
  const posted = Object.fromEntries((role.fields ?? []).map((f) => [f.field, f.posted]));
  const handover = roleHandover({
    aim: text(posted.aim),
    domain: text(posted.domain),
    accountabilities: list(posted.accountabilities),
    bringMe: list(posted.bringMe).length ? list(posted.bringMe) : null,
    notMine: list(posted.notMine).length ? list(posted.notMine) : null,
    runbook: text(posted.runbook),
    circle: role.circle,
    holderCount: role.holderCount,
  });
  const runbook = text(posted.runbook);
  return (
    <div className={`${PANEL} grid gap-3 bg-stone-50`} data-from-holder={role.id}>
      <div>
        <h3 className="font-semibold text-stone-900">{RP_WORDS.fromHolder}</h3>
        <p className={LEDE}>{RP_WORDS.fromHolderLede}</p>
      </div>
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-stone-500">{W.runbook}</p>
        {runbook ? (
          runbookIsLink(runbook) ? (
            <a href={runbook} target="_blank" rel="noopener noreferrer" className={`inline-flex min-h-[44px] items-center break-all text-sm font-medium text-teal-deep underline ${FOCUS}`}>
              {runbook}
            </a>
          ) : (
            <p className="mt-1 whitespace-pre-line break-words text-sm text-stone-800">{runbook}</p>
          )
        ) : (
          <p className="mt-1 text-sm text-stone-600">{RP_WORDS.noRunbook}</p>
        )}
      </div>
      <div data-handover-meter="">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-stone-500">{handover.heading}</p>
          <span className="text-sm font-semibold text-stone-900">{handover.summary}</span>
        </div>
        <ul className="mt-1 grid gap-1 text-sm">
          {handover.checks.map((c) => (
            <li key={c.key} data-check={c.key} className="flex items-start gap-2">
              <span aria-hidden="true" className={c.state === "ready" ? "text-teal-deep" : "text-stone-400"}>
                {c.state === "ready" ? "✓" : "○"}
              </span>
              <span className="min-w-0">
                <span className="font-medium text-stone-800">{c.label}:</span> <span className="text-stone-600">{c.words}</span>
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function WordInput({
  role,
  f,
  value,
  posted,
  frameworkTerms,
  onType,
}: {
  role: WordsRole;
  f: EditField;
  value: string;
  posted: WordValue | undefined;
  frameworkTerms: boolean;
  onType: (text: string) => void;
}) {
  const id = useId();
  const changed = role.isNew ? true : differs(f.field, value, posted);
  const problem = fieldProblem(f.field, value, posted, role.isNew);
  const hint = f.hint ?? (f.list ? RP_WORDS.onePerLine : undefined);
  return (
    <FieldFrame changed={changed} isNew={role.isNew} posted={posted} field={f.field}>
      <div className="text-sm font-semibold text-stone-900">
        <CcosTerm term={f.term ? roleTerm(f.term, frameworkTerms) : null} tap={LABEL_TAP}>
          {f.label}
        </CcosTerm>
      </div>
      {hint && (
        <p id={`${id}-hint`} className="text-xs text-stone-600">
          {hint}
        </p>
      )}
      {f.multiline ? (
        <textarea
          id={id}
          aria-label={f.label}
          aria-describedby={hint ? `${id}-hint` : undefined}
          aria-invalid={problem ? true : undefined}
          rows={f.list ? 4 : 3}
          value={value}
          onChange={(e) => onType(e.target.value)}
          className={`mt-1 ${INPUT}`}
        />
      ) : (
        <input
          id={id}
          aria-label={f.label}
          aria-describedby={hint ? `${id}-hint` : undefined}
          aria-invalid={problem ? true : undefined}
          value={value}
          onChange={(e) => onType(e.target.value)}
          className={`mt-1 min-h-[44px] ${INPUT}`}
        />
      )}
      {problem && (
        <p className="mt-1 text-sm font-medium text-coral" data-field-problem={f.field}>
          {problem}
        </p>
      )}
    </FieldFrame>
  );
}

export default function StepWords({ roles, typed, frameworkTerms, onType, onReview }: StepWordsProps) {
  const [current, setCurrent] = useState(0);
  if (!roles.length) return <p className="text-stone-700">{RP_WORDS.pickRoleFirst}</p>;
  const role = roles[Math.min(current, roles.length - 1)];
  const state = stateFrom(role.fields ?? [], typed[role.id] ?? {});
  const holding = EDIT_FIELDS.filter((f) => f.group === "holding");

  const input = (f: EditField) => (
    <WordInput
      key={f.field}
      role={role}
      f={f}
      value={shownText(state, f.field)}
      posted={state.posted[f.field]}
      frameworkTerms={frameworkTerms}
      onType={(t) => onType(role.id, f.field, t)}
    />
  );

  return (
    <div className="grid gap-4">
      <p className={LEDE}>{RP_WORDS.wordsLede}</p>
      {roles.length > 1 && (
        <div role="group" aria-label={RP_WORDS.whichRole} className="flex flex-wrap gap-2">
          {roles.map((r, i) => (
            <button
              key={r.id}
              type="button"
              aria-pressed={r.id === role.id}
              onClick={() => setCurrent(i)}
              className={`inline-flex min-h-[44px] max-w-full items-center rounded-lg border px-3 text-left text-sm font-medium ${FOCUS} ${
                r.id === role.id ? "border-teal-deep bg-teal-deep/5 text-stone-900" : "border-stone-300 bg-white text-stone-700"
              }`}
            >
              <span className="break-words">{r.name}</span>
            </button>
          ))}
        </div>
      )}

      <section aria-label={role.name} className="grid gap-3" data-words-role={role.id}>
        <h3 className="break-words font-display text-2xl font-bold text-stone-900">{role.name}</h3>
        {!role.isNew && role.holderCount > 0 && role.fields && <FromHolder role={role} />}
        {role.fields === null ? (
          <p className="text-sm text-stone-600">{RP_WORDS.saving}</p>
        ) : (
          <>
            {role.isNew && (
              <FieldFrame changed isNew posted={null} field={NAME_FIELD}>
                <label className="grid gap-1 text-sm font-semibold text-stone-900">
                  {RP_WORDS.roleName}
                  <input
                    value={shownText(state, NAME_FIELD)}
                    maxLength={120}
                    onChange={(e) => onType(role.id, NAME_FIELD, e.target.value)}
                    className={`min-h-[44px] ${INPUT}`}
                  />
                </label>
                {!shownText(state, NAME_FIELD).trim() && <p className="mt-1 text-sm font-medium text-coral">{fieldProblem(NAME_FIELD, "", null, true) ?? ""}</p>}
              </FieldFrame>
            )}
            {EDIT_FIELDS.filter((f) => !f.group).slice(0, 8).map(input)}
            <fieldset className="grid min-w-0 gap-2" data-holding-well="">
              <legend className="mb-1 text-sm font-semibold uppercase tracking-wide text-notice">{W.holdingWell}</legend>
              {holding.map(input)}
            </fieldset>
            {EDIT_FIELDS.filter((f) => !f.group).slice(8).map(input)}
            <label className="grid gap-1 rounded-xl border border-stone-200 bg-white p-3 text-sm font-semibold text-stone-900">
              {RP_WORDS.reviewOn}
              <span className="text-xs font-normal text-stone-600">{RP_WORDS.reviewHint}</span>
              <input type="date" value={role.reviewOn} onChange={(e) => onReview(role.id, e.target.value)} className={`min-h-[44px] ${INPUT}`} />
            </label>
          </>
        )}
        <AiHelpButton
          step="words"
          words={Object.fromEntries(EDIT_FIELDS.map((f) => [f.field, shownText(state, f.field)]))}
          onAccept={(field, words) => onType(role.id, field, words)}
        />
      </section>
    </div>
  );
}
