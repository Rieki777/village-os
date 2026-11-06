/**
 * THE START CARD'S "MEETING TYPE": the village's meeting templates, grouped
 * by category and sorted the way their keepers ordered them
 * (shared/sessionTemplates.ts `groupByCategory`). Picking one fills the card's
 * title, circle and length (the page does that, `onPick`), and the flow the
 * room will follow shows under the picker, each section with its minutes.
 * "No template" stays the first choice, and picking it clears nothing the
 * person already typed.
 *
 * No templates at all: the picker draws nothing.
 */
import { SECTION_KIND_DEFS, TEMPLATE_COPY, flowMinutes, groupByCategory, type SessionTemplate } from "@shared/sessionTemplates";
import { CHIP, HINT, LABEL } from "./roomUi";
import { LIST_UI } from "./SessionList";

export default function MeetingTypePicker({
  templates,
  value,
  onPick,
}: {
  templates: readonly SessionTemplate[];
  value: number | null;
  onPick(t: SessionTemplate | null): void;
}) {
  const groups = groupByCategory(templates);
  if (!groups.length) return null;
  const chosen = templates.find((t) => t.id === value) ?? null;
  return (
    <div className="space-y-2">
      <label htmlFor="sessions-start-template" className={LABEL}>
        {TEMPLATE_COPY.pickerLabel}
      </label>
      <select
        id="sessions-start-template"
        className={LIST_UI.input}
        value={value == null ? "" : String(value)}
        onChange={(e) => onPick(templates.find((t) => String(t.id) === e.target.value) ?? null)}
      >
        <option value="">{TEMPLATE_COPY.noTemplate}</option>
        {groups.map((g) => (
          <optgroup key={g.category} label={g.category}>
            {g.templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      {chosen ? (
        <div className="space-y-2 rounded-xl border border-border bg-muted px-3 py-2.5">
          {chosen.summary && <p className="text-sm text-foreground">{chosen.summary}</p>}
          <p className={`${HINT} tabular-nums`}>{TEMPLATE_COPY.flowMinutes(flowMinutes(chosen.flow))}</p>
          <ol className="space-y-1">
            {chosen.flow.map((s, i) => (
              <li key={s.key} className="flex items-start gap-2 text-sm">
                <span className="w-5 shrink-0 text-right tabular-nums text-muted-foreground">{i + 1}.</span>
                <span className="min-w-0 flex-1">
                  <span className="text-foreground">{s.title}</span>{" "}
                  <span className={CHIP}>
                    {SECTION_KIND_DEFS[s.kind].label} · {s.minutes} min
                  </span>
                </span>
              </li>
            ))}
          </ol>
        </div>
      ) : (
        <p className={HINT}>{TEMPLATE_COPY.pickerHint}</p>
      )}
    </div>
  );
}
