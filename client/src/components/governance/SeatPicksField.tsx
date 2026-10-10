/**
 * PICK ONE TO FIVE SEATS, FOR ONE APPLICATION (seat settings PR4).
 *
 * A member who holds several seats records their terms once, so "Apply for a
 * seat" picks a LIST of seats from the org chart, the same `seats` source and
 * the same `/api/org` read the single seat picker uses. The first seat picked
 * is the one the preview card shows and whose terms on offer prefill the terms
 * step.
 *
 * A checkbox per seat, each a 44px target with its own label, inside one
 * fieldset whose legend is the field's label. Once five are picked the rest are
 * disabled, and the count says why. A seat picked earlier that the list no
 * longer offers stays listed under its id, so a saved draft never loses a seat
 * without the member seeing it.
 */
import { useEffect, useState } from "react";
import InfoTip from "@/components/InfoTip";
import type { FieldSpec } from "./wizardConfig";
import { loadPickOptions, type PickOption } from "./pickSources";
import { MAX_SEATS } from "@shared/seatApplications";

/** The picked ids out of whatever the answer holds: a list, or one id from an older draft. */
export function pickedSeats(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((v) => String(v ?? "").trim()).filter(Boolean);
  const one = String(value ?? "").trim();
  return one ? [one] : [];
}

export default function SeatPicksField({
  field,
  value,
  onChange,
  describedBy,
  invalid,
  footerNode,
}: {
  field: FieldSpec;
  value: unknown;
  onChange: (next: unknown) => void;
  describedBy?: string;
  invalid: boolean;
  footerNode: React.ReactNode;
}) {
  const [options, setOptions] = useState<PickOption[] | null>(null);
  useEffect(() => {
    let alive = true;
    void loadPickOptions("seats").then((o) => {
      if (alive) setOptions(o);
    });
    return () => {
      alive = false;
    };
  }, []);

  const picked = pickedSeats(value);
  const max = field.max ?? MAX_SEATS;
  const atMost = picked.length >= max;
  const listed = options ?? [];
  const strays = picked.filter((id) => !listed.some((o) => o.value === id)).map((id) => ({ value: id, label: id }) as PickOption);

  const toggle = (id: string) => {
    const next = picked.includes(id) ? picked.filter((p) => p !== id) : atMost ? picked : [...picked, id];
    onChange(next);
  };

  return (
    <fieldset aria-describedby={describedBy} aria-invalid={invalid} className="min-w-0">
      <legend className="block text-sm font-semibold text-stone-900">
        {field.label}
        {field.required && <span className="ml-1 text-coral" aria-hidden="true">*</span>}
        {field.required && <span className="sr-only"> (required)</span>}
        {field.tip && <InfoTip tip={field.tip} label={`What ${field.label.toLowerCase()} means`} />}
      </legend>
      <p className="mt-0.5 text-xs text-stone-600" aria-live="polite">
        {picked.length} of at most {max} picked.
      </p>
      {options === null ? (
        <p className="mt-2 text-sm text-stone-600">Loading the seats</p>
      ) : listed.length === 0 && strays.length === 0 ? (
        <p className="mt-2 text-sm text-stone-600">
          This village has no seats in its org chart yet, so there is nothing to apply for.
        </p>
      ) : (
        <ul className="mt-2 space-y-1">
          {[...listed, ...strays].map((o) => {
            const on = picked.includes(o.value);
            const id = `seat-pick-${o.value}`;
            return (
              <li key={o.value}>
                <label
                  htmlFor={id}
                  className={`flex min-h-[44px] cursor-pointer items-center gap-3 rounded-lg border px-3 text-sm ${
                    on ? "border-teal-deep bg-teal-deep/5 font-semibold text-stone-900" : "border-stone-200 text-stone-700 hover:bg-stone-50"
                  }`}
                >
                  <input
                    id={id}
                    type="checkbox"
                    checked={on}
                    disabled={!on && atMost}
                    onChange={() => toggle(o.value)}
                    className="size-4 accent-teal-deep focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-deep"
                  />
                  <span className="min-w-0 flex-1">{o.label}</span>
                  {o.hint && <span className="text-xs text-stone-500">{o.hint}</span>}
                </label>
              </li>
            );
          })}
        </ul>
      )}
      {footerNode}
    </fieldset>
  );
}
