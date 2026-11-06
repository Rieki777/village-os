/**
 * ONE IDENTITY BOX ON MAKE THIS YOURS, and on two of them a way to say "none".
 *
 * Every box here inherits the platform default when it is left blank, and the
 * caption says which default. That stays. What a village could not do was
 * show NOTHING where the Tagline or the Footer introduction goes: emptying the
 * box brought the platform's own sentence back (readiness R088). Those two
 * carry a "Show nothing here" choice, stored as `project.cleared`, whose rule
 * and reasons are in shared/brandCleared.ts.
 *
 * ITS OWN FILE because `client/src/pages/Admin.tsx` sits at its line ceiling
 * (scripts/check-file-lines.mjs). Admin keeps `brandField`, which now hands
 * this the project and takes the next one back. Light-only, like the rest of
 * this folder.
 */
import { isClearable, isCleared, withCleared, type ClearableBrandField } from "@shared/brandCleared";

export default function BrandTextField({
  fieldKey,
  label,
  defaultVal,
  project,
  onProject,
}: {
  fieldKey: string;
  label: string;
  /** The platform's own value, shown as the placeholder and named under the box. */
  defaultVal: string;
  project: Record<string, any>;
  onProject: (next: Record<string, any>) => void;
}) {
  const id = `brand-${fieldKey}`;
  const clearable = isClearable(fieldKey);
  const cleared = clearable && isCleared(project, fieldKey);
  return (
    <div>
      <label htmlFor={id} className="text-xs font-medium text-muted-foreground block mb-1">{label}</label>
      <input
        id={id}
        type="text"
        value={cleared ? "" : project?.[fieldKey] ?? ""}
        disabled={cleared}
        onChange={(e) => onProject({ ...project, [fieldKey]: e.target.value })}
        placeholder={cleared ? "Nothing shows here" : defaultVal}
        className="w-full px-3 py-2 text-sm border border-border rounded-lg disabled:bg-muted"
      />
      <p className="text-[11px] text-muted-foreground mt-0.5">
        {cleared ? "Nothing shows on the site here." : `Platform default: ${defaultVal}`}
      </p>
      {clearable && (
        <label className="mt-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <input
            type="checkbox"
            checked={cleared}
            onChange={(e) => onProject(withCleared(project, fieldKey as ClearableBrandField, e.target.checked))}
          />
          Show nothing here
        </label>
      )}
    </div>
  );
}
