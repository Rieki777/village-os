/**
 * ONE FIELD RENDERER FOR THE WHOLE WIZARD.
 *
 * Hypha's StepPayout serves payout, assignment, archetype and badge flavours
 * from one component by reading `fields.X` (harvest section 1). This is that,
 * generalized: every step of every proposal type renders through the switch
 * below, so a new proposal type adds entries to a config and no JSX anywhere.
 *
 * The field kinds, and why each exists:
 *
 *   text / textarea   ordinary words, with a live character count where a
 *                     length limit exists, because discovering a limit by
 *                     being truncated is a bad way to discover it.
 *   percent           a slider AND a number box. The slider is for choosing,
 *                     the box is for meaning 40 exactly. Sliders alone are
 *                     unusable with a keyboard at fine grain and unreadable
 *                     to anyone who needs the number.
 *   number / date     native inputs, because the platform's audience is on
 *                     phones and the native pickers are better than ours.
 *   choice            a select over declared options.
 *   pick              a select over a REMOTE list, or a search for members.
 *   changeSet         the mechanics dial editor, the one field with real
 *                     machinery behind it.
 *
 * ACCESSIBILITY. Every control has a real <label> tied by id, every problem is
 * announced through aria-describedby and role="alert", every target clears
 * 44px, and focus is always visible. A field in error is marked with
 * aria-invalid as well as colour.
 */
import { useEffect, useId, useState } from "react";
import { Plus, X } from "lucide-react";
import InfoTip from "@/components/InfoTip";
import type { FieldSpec } from "./wizardConfig";
import { isSearchSource, loadPickOptions, searchMembers, type PickOption } from "./pickSources";
import { SeatTermForRole, type SeatTermLook } from "@/components/power/SeatTermField";

export interface MechanicsVariableLite {
  key: string;
  category: string;
  label: string;
  description: string;
  unit: string | null;
  min: number | null;
  max: number | null;
  choices: Array<{ value: string; label: string }> | null;
  value: string;
  ring: "open" | "founder";
}

const inputClass =
  "w-full min-h-[44px] rounded-lg border border-stone-300 px-3 py-2 text-sm text-stone-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-deep aria-[invalid=true]:border-coral";

/** The wizard's look for a seat's end date: the same inputs as every other field. */
const TERM_LOOK: SeatTermLook = {
  label: "block text-sm font-semibold text-stone-900",
  input: `mt-1 ${inputClass}`,
  line: "text-xs text-stone-600 leading-relaxed",
  caution: "text-sm font-medium text-amber-800 leading-relaxed",
  refusal: "text-sm font-medium text-coral",
};

export default function WizardField({
  field,
  value,
  problem,
  onChange,
  /** The open dials, loaded once by the wizard and passed down. */
  dials,
  /** Every answer so far, for a field whose meaning depends on another one. */
  answers,
}: {
  field: FieldSpec;
  value: unknown;
  problem?: string;
  onChange: (next: unknown) => void;
  dials?: MechanicsVariableLite[];
  answers?: Record<string, unknown>;
}) {
  const id = useId();
  const errorId = `${id}-problem`;
  const helpId = `${id}-help`;
  const describedBy = [problem ? errorId : null, field.help ? helpId : null].filter(Boolean).join(" ") || undefined;

  const label = (
    <label htmlFor={id} className="block text-sm font-semibold text-stone-900">
      {field.label}
      {field.required && <span className="ml-1 text-coral" aria-hidden="true">*</span>}
      {field.required && <span className="sr-only"> (required)</span>}
      {field.tip && <InfoTip tip={field.tip} label={`What ${field.label.toLowerCase()} means`} />}
    </label>
  );

  const footer = (
    <>
      {field.help && (
        <p id={helpId} className="mt-1 text-xs text-stone-600 leading-relaxed">
          {field.help}
        </p>
      )}
      {problem && (
        <p id={errorId} role="alert" className="mt-1 text-sm font-medium text-coral">
          {problem}
        </p>
      )}
    </>
  );

  const common = {
    id,
    "aria-invalid": !!problem,
    "aria-describedby": describedBy,
    className: inputClass,
  } as const;

  switch (field.kind) {
    case "textarea": {
      const text = String(value ?? "");
      return (
        <div>
          {label}
          <textarea
            {...common}
            rows={field.rows ?? 4}
            maxLength={field.maxLength}
            placeholder={field.placeholder}
            value={text}
            onChange={(e) => onChange(e.target.value)}
          />
          {field.maxLength && (
            <p className="mt-1 text-right text-xs tabular-nums text-stone-500">
              {text.length} of {field.maxLength}
            </p>
          )}
          {footer}
        </div>
      );
    }

    case "percent": {
      const n = Number(value ?? 0);
      const safe = Number.isFinite(n) ? n : 0;
      return (
        <div>
          {label}
          <div className="mt-1 flex items-center gap-3">
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={safe}
              aria-labelledby={undefined}
              aria-label={`${field.label}, percent`}
              onChange={(e) => onChange(Number(e.target.value))}
              className="h-11 flex-1 accent-teal-deep focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-deep"
            />
            <span className="flex items-center gap-1">
              <input
                {...common}
                type="number"
                min={0}
                max={100}
                value={safe}
                onChange={(e) => onChange(Number(e.target.value))}
                className={`${inputClass} w-20 text-right tabular-nums`}
              />
              <span className="text-sm text-stone-600">%</span>
            </span>
          </div>
          {footer}
        </div>
      );
    }

    case "number":
      return (
        <div>
          {label}
          <input
            {...common}
            type="number"
            min={field.min}
            max={field.max}
            value={value === undefined || value === null ? "" : String(value)}
            placeholder={field.placeholder}
            onChange={(e) => onChange(e.target.value === "" ? "" : Number(e.target.value))}
          />
          {footer}
        </div>
      );

    case "date":
      return (
        <div>
          {label}
          <input {...common} type="date" value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} />
          {footer}
        </div>
      );

    case "seatTerm":
      return (
        <div>
          <SeatTermForRole
            roleId={field.roleKey ? String(answers?.[field.roleKey] ?? "") : ""}
            value={String(value ?? "")}
            onChange={onChange}
            inputId={id}
            labelNode={label}
            describedBy={describedBy}
            look={TERM_LOOK}
            byVote
          />
          {footer}
        </div>
      );

    case "choice":
      return (
        <div>
          {label}
          <select {...common} value={String(value ?? "")} onChange={(e) => onChange(e.target.value)}>
            {(field.options ?? []).map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          {footer}
        </div>
      );

    case "pick":
      return (
        <PickField
          field={field}
          value={value}
          onChange={onChange}
          labelNode={label}
          footerNode={footer}
          inputId={id}
          describedBy={describedBy}
          invalid={!!problem}
        />
      );

    case "changeSet":
      return (
        <div>
          {label}
          <ChangeSetField
            value={Array.isArray(value) ? (value as Array<{ key: string; to: string }>) : []}
            dials={dials ?? []}
            onChange={onChange}
          />
          {footer}
        </div>
      );

    case "text":
    default: {
      const text = String(value ?? "");
      return (
        <div>
          {label}
          <input
            {...common}
            type="text"
            maxLength={field.maxLength}
            placeholder={field.placeholder}
            value={text}
            onChange={(e) => onChange(e.target.value)}
          />
          {footer}
        </div>
      );
    }
  }
}

/** A select over a remote list, or a search where listing everyone is wrong. */
function PickField({
  field,
  value,
  onChange,
  labelNode,
  footerNode,
  inputId,
  describedBy,
  invalid,
}: {
  field: FieldSpec;
  value: unknown;
  onChange: (next: unknown) => void;
  labelNode: React.ReactNode;
  footerNode: React.ReactNode;
  inputId: string;
  describedBy?: string;
  invalid: boolean;
}) {
  const [options, setOptions] = useState<PickOption[] | null>(null);
  const [query, setQuery] = useState("");
  const searched = field.source ? isSearchSource(field.source) : false;

  useEffect(() => {
    if (!field.source || searched) {
      setOptions([]);
      return;
    }
    let alive = true;
    loadPickOptions(field.source).then((o) => {
      if (alive) setOptions(o);
    });
    return () => {
      alive = false;
    };
  }, [field.source, searched]);

  useEffect(() => {
    if (!searched) return;
    let alive = true;
    const t = setTimeout(() => {
      searchMembers(query).then((o) => {
        if (alive) setOptions(o);
      });
    }, 250);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [query, searched]);

  if (searched) {
    return (
      <div>
        {labelNode}
        <input
          id={inputId}
          type="search"
          value={query}
          aria-describedby={describedBy}
          aria-invalid={invalid}
          placeholder="Type two letters of a name"
          onChange={(e) => setQuery(e.target.value)}
          className={inputClass}
        />
        {(options ?? []).length > 0 && (
          <ul className="mt-1 space-y-1">
            {(options ?? []).map((o) => (
              <li key={o.value}>
                <button
                  type="button"
                  onClick={() => onChange(o.value)}
                  aria-pressed={String(value ?? "") === o.value}
                  className={`flex min-h-[44px] w-full items-center justify-between rounded-lg border px-3 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-deep ${
                    String(value ?? "") === o.value
                      ? "border-teal-deep bg-teal-deep/5 font-semibold text-stone-900"
                      : "border-stone-200 text-stone-700 hover:bg-stone-50"
                  }`}
                >
                  <span>{o.label}</span>
                  {o.hint && <span className="text-xs text-stone-500">{o.hint}</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
        {footerNode}
      </div>
    );
  }

  const empty = options !== null && options.length === 0;
  return (
    <div>
      {labelNode}
      <select
        id={inputId}
        value={String(value ?? "")}
        aria-describedby={describedBy}
        aria-invalid={invalid}
        disabled={options === null || empty}
        onChange={(e) => onChange(e.target.value)}
        className={inputClass}
      >
        <option value="">{options === null ? "Loading" : empty ? "Nothing to pick yet" : "Choose one"}</option>
        {(options ?? []).map((o) => (
          <option key={o.value} value={o.value}>
            {o.hint ? `${o.label} (${o.hint})` : o.label}
          </option>
        ))}
      </select>
      {empty && (
        <p className="mt-1 text-xs text-stone-600">
          This village has nothing here yet, so this kind of proposal has nothing to point at.
        </p>
      )}
      {footerNode}
    </div>
  );
}

/**
 * THE DIAL EDITOR: pick a rule the village governs, say what it becomes.
 *
 * Only `ring: "open"` variables appear. Founder-held dials and the
 * constitution are not proposals a member can make, and offering them here
 * would be an invitation the server would refuse.
 *
 * Each staged change shows the value it is moving FROM, because a proposal to
 * set something to 9 means nothing until you know it is 7 today.
 */
function ChangeSetField({
  value,
  dials,
  onChange,
}: {
  value: Array<{ key: string; to: string }>;
  dials: MechanicsVariableLite[];
  onChange: (next: Array<{ key: string; to: string }>) => void;
}) {
  const [adding, setAdding] = useState("");
  const open = dials.filter((d) => d.ring === "open");
  const staged = new Set(value.map((c) => c.key));
  const available = open.filter((d) => !staged.has(d.key));
  const byKey = new Map(open.map((d) => [d.key, d]));

  const add = (key: string) => {
    const dial = byKey.get(key);
    if (!dial) return;
    onChange([...value, { key, to: dial.value }]);
    setAdding("");
  };

  return (
    <div className="mt-1 space-y-3">
      {value.length > 0 && (
        <ul className="space-y-2">
          {value.map((change) => {
            const dial = byKey.get(change.key);
            return (
              <li key={change.key} className="rounded-lg border border-stone-200 p-3">
                <div className="flex items-start justify-between gap-2">
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-stone-900">{dial?.label ?? change.key}</span>
                    {dial?.description && (
                      <span className="block text-xs text-stone-600 leading-relaxed">{dial.description}</span>
                    )}
                  </span>
                  <button
                    type="button"
                    onClick={() => onChange(value.filter((c) => c.key !== change.key))}
                    aria-label={`Take ${dial?.label ?? change.key} out of this proposal`}
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-stone-500 hover:bg-stone-100 hover:text-stone-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-deep"
                  >
                    <X className="w-4 h-4" aria-hidden="true" />
                  </button>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <span className="text-xs text-stone-600">
                    now <strong className="tabular-nums text-stone-800">{dial?.value ?? "?"}</strong>
                    {dial?.unit ? ` ${dial.unit}` : ""}
                  </span>
                  <span className="text-xs text-stone-400" aria-hidden="true">
                    to
                  </span>
                  {dial?.choices ? (
                    <select
                      value={change.to}
                      aria-label={`New value for ${dial.label}`}
                      onChange={(e) =>
                        onChange(value.map((c) => (c.key === change.key ? { ...c, to: e.target.value } : c)))
                      }
                      className={`${inputClass} w-auto`}
                    >
                      {dial.choices.map((ch) => (
                        <option key={ch.value} value={ch.value}>
                          {ch.label}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type="text"
                      inputMode="decimal"
                      value={change.to}
                      aria-label={`New value for ${dial?.label ?? change.key}`}
                      min={dial?.min ?? undefined}
                      max={dial?.max ?? undefined}
                      onChange={(e) =>
                        onChange(value.map((c) => (c.key === change.key ? { ...c, to: e.target.value } : c)))
                      }
                      className={`${inputClass} w-32 tabular-nums`}
                    />
                  )}
                  {dial && (dial.min !== null || dial.max !== null) && (
                    <span className="text-xs text-stone-500">
                      allowed {dial.min ?? "any"} to {dial.max ?? "any"}
                    </span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {available.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="add-dial" className="sr-only">
            Add a rule to this proposal
          </label>
          <select
            id="add-dial"
            value={adding}
            onChange={(e) => add(e.target.value)}
            className={`${inputClass} sm:w-auto sm:min-w-[16rem]`}
          >
            <option value="">Add a rule to change</option>
            {available.map((d) => (
              <option key={d.key} value={d.key}>
                {d.category}: {d.label}
              </option>
            ))}
          </select>
          <span className="inline-flex items-center gap-1 text-xs text-stone-500">
            <Plus className="w-3 h-3" aria-hidden="true" />
            {available.length} more the village governs
          </span>
        </div>
      ) : (
        <p className="text-xs text-stone-600">
          {open.length === 0
            ? "The list of dials has not loaded, or this village governs none of them yet."
            : "Every rule the village governs is already in this proposal."}
        </p>
      )}
    </div>
  );
}
