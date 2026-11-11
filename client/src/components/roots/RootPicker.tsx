/**
 * TAG A ROLE OR A QUEST WITH THE ROOTS IT GROWS FROM (build list 4.7, 10.4,
 * 10.5): one to three of the village's roots, with the coverage check beside
 * the boxes so an editor can tag from the kind of work.
 *
 * Used by the quest editor (Admin, Quests) and ready for the role editor: it
 * holds no save of its own, it reports the list through `onChange` and the
 * editor saves it with its own button.
 *
 * Phone: one root per row, the whole row is the target, and the coverage
 * check folds away under its own summary. Desktop: the roots sit side by side
 * and the coverage check opens as a table with "Use these" on every row.
 *
 * Never a dead box: a fourth root is not disabled silently. Its box stays
 * live and the line under the boxes says to take one off first.
 */
import { useId, useState } from "react";
import { useLingui } from "@lingui/react/macro";
import { MAX_ROOTS_ON_WORK, ROOT_COVERAGE, rootsOfCoverage, shortRootName } from "@shared/archetypeRoots";
import { RootGlyph } from "./RootTags";
import { useRootCast } from "./rootCast";

export interface RootPickerProps {
  value: string[];
  onChange: (next: string[]) => void;
  /** Shown amber while the roots are still the boot seed's guess. */
  suggested?: boolean;
  className?: string;
}

export default function RootPicker({ value, onChange, suggested = false, className = "" }: RootPickerProps) {
  const { t } = useLingui();
  const cast = useRootCast();
  const id = useId();
  const [said, setSaid] = useState("");
  if (!cast.length) return null;
  const name = (key: string) => shortRootName(cast.find((c) => c.key === key)?.name ?? key);

  const toggle = (key: string, checked: boolean) => {
    if (!checked) {
      setSaid("");
      onChange(value.filter((k) => k !== key));
      return;
    }
    if (value.length >= MAX_ROOTS_ON_WORK) {
      setSaid(t({ message: `Up to ${MAX_ROOTS_ON_WORK} roots. Take one off first.`, context: "root picker, a fourth root" }));
      return;
    }
    setSaid("");
    onChange([...value, key]);
  };

  return (
    <fieldset className={`space-y-2 ${className}`.trim()} data-testid="root-picker">
      <legend className="text-sm font-semibold text-foreground">
        {t({ message: "Roots it grows from", context: "root picker legend" })}
      </legend>
      <p className="text-xs text-muted-foreground">
        {t({ message: `Pick one to ${MAX_ROOTS_ON_WORK}. Members who play these roots see this first.`, context: "root picker hint" })}
        {suggested ? (
          <span className="ml-1 font-semibold text-notice">
            {t({ message: "These are a suggestion until someone saves them.", context: "root picker, seeded guess" })}
          </span>
        ) : null}
      </p>
      <div className="flex flex-col gap-1 sm:flex-row sm:flex-wrap sm:gap-x-4">
        {cast.map((c) => (
          <label key={c.key} className="flex min-h-11 cursor-pointer items-center gap-2 text-sm text-foreground">
            <input
              type="checkbox"
              className="size-5 accent-notice"
              checked={value.includes(c.key)}
              onChange={(e) => toggle(c.key, e.target.checked)}
            />
            <RootGlyph rootKey={c.key} className="size-5" />
            <span>{shortRootName(c.name)}</span>
          </label>
        ))}
      </div>
      <p role="status" className="min-h-5 text-xs text-notice">
        {said}
      </p>
      <details className="rounded-lg border border-border px-3 py-2">
        <summary className="min-h-11 cursor-pointer py-2 text-sm font-medium text-foreground">
          {t({ message: "Not sure? Tag it from the kind of work", context: "root picker coverage summary" })}
        </summary>
        <table className="mt-2 w-full text-left text-sm" aria-labelledby={`${id}-cov`}>
          <caption id={`${id}-cov`} className="sr-only">
            {t({ message: "Every kind of work and the roots it grows from", context: "root picker coverage caption" })}
          </caption>
          <thead className="hidden sm:table-header-group">
            <tr className="text-xs text-muted-foreground">
              <th scope="col" className="py-1 pr-3 font-semibold">{t({ message: "Work", context: "coverage column" })}</th>
              <th scope="col" className="py-1 pr-3 font-semibold">{t({ message: "Roots", context: "coverage column" })}</th>
              <th scope="col" className="py-1"><span className="sr-only">{t({ message: "Use", context: "coverage column" })}</span></th>
            </tr>
          </thead>
          <tbody>
            {ROOT_COVERAGE.map((row) => (
              <tr key={row.work} className="flex flex-col border-t border-border py-2 sm:table-row sm:py-0">
                <th scope="row" className="font-medium text-foreground sm:py-2 sm:pr-3">{row.work}</th>
                <td className="text-muted-foreground sm:py-2 sm:pr-3">
                  {row.roots.map((r) => (r.note ? `${name(r.key)} (${r.note})` : name(r.key))).join(", ")}
                </td>
                <td className="sm:py-2">
                  <button
                    type="button"
                    onClick={() => {
                      setSaid("");
                      onChange(rootsOfCoverage(row).filter((k) => cast.some((c) => c.key === k)));
                    }}
                    className="jw-btn inline-flex min-h-11 items-center rounded-lg border border-border px-3 text-xs font-medium text-foreground hover:bg-muted"
                    aria-label={t({ message: `Use the roots for ${row.work}`, context: "coverage row button" })}
                  >
                    {t({ message: "Use these", context: "coverage row button" })}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </fieldset>
  );
}
