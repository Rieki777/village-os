/**
 * THE ONE PLACE A CIRCLE IS PICKED FROM A LIST.
 *
 * Operating circles first, the anchor leading them with its mark. Circles
 * still forming follow in a quiet group in muted text and stay selectable.
 * Dormant circles are not offered, except the one already chosen, which stays
 * visible so a form never shows a different circle than the one it holds.
 * A search box appears only above eight circles. When exactly one circle is
 * operating, `autoDefault` chooses it for a form with an empty value.
 * Ordering and grouping live in shared/circlePicker.ts.
 */
import { useEffect, useId, useMemo, useState, type ReactNode } from "react";
import { useLingui } from "@lingui/react/macro";
import { SEARCH_ABOVE, groupCircles, matchCircles, soleOperatingId, withAnchor, type PickableCircle } from "@shared/circlePicker";
import { circleLabel } from "./CircleName";

export interface CirclePickerProps {
  circles: readonly (PickableCircle & { anchor?: boolean })[];
  value: string;
  onChange(id: string): void;
  id?: string;
  className?: string;
  disabled?: boolean;
  /** The disabled first option, for an unanswered choice. */
  placeholder?: string;
  /** Options after the circles, such as "No circle in particular". */
  extra?: ReactNode;
  /** Options before the circles, such as "Any circle". */
  leading?: ReactNode;
  /** Choose the only operating circle when nothing is chosen yet. */
  autoDefault?: boolean;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
  /** The chosen circle when it is no longer among the offered ones. */
  keepName?: string | null;
}

export default function CirclePicker({ circles, value, onChange, id, className, disabled, placeholder, extra, leading, autoDefault, keepName, ...aria }: CirclePickerProps) {
  const { t } = useLingui();
  const auto = useId();
  const [q, setQ] = useState("");
  // The anchor is read from the whole list, so a search never changes who it is.
  const all = useMemo(() => {
    const flagged = circles.some((c) => "anchor" in c && (c as { anchor?: boolean }).anchor !== undefined);
    return flagged ? (circles as (PickableCircle & { anchor?: boolean })[]) : withAnchor(circles as PickableCircle[]);
  }, [circles]);
  const sole = autoDefault ? soleOperatingId(all) : null;
  useEffect(() => {
    if (sole && !value) onChange(sole);
  }, [sole, value, onChange]);
  const groups = groupCircles(all);
  const count = groups.operating.length + groups.forming.length;
  const searching = count > SEARCH_ABOVE;
  const operating = matchCircles(groups.operating, q);
  const forming = matchCircles(groups.forming, q);
  const offered = new Set([...groups.operating, ...groups.forming].map((c) => String(c.id)));
  const held = value && value !== "none" && !offered.has(value) ? (all.find((c) => String(c.id) === value)?.name ?? keepName ?? value) : null;
  return (
    <div>
      {searching && (
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t({ message: "Find a circle", context: "circle picker" })}
          aria-label={t({ message: "Find a circle", context: "circle picker" })}
          className={`mb-2 ${className ?? ""}`}
        />
      )}
      <select
        id={id ?? auto}
        className={className}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        {...aria}
      >
        {placeholder != null && (
          <option value="" disabled>
            {placeholder}
          </option>
        )}
        {leading}
        {held && (
          <option value={value} disabled>
            {held}
          </option>
        )}
        {operating.map((c) => (
          <option key={c.id} value={c.id}>
            {circleLabel(c)}
          </option>
        ))}
        {forming.length > 0 && (
          <optgroup label={t({ message: "Forming", context: "circle picker" })} className="text-muted-foreground">
            {forming.map((c) => (
              <option key={c.id} value={c.id} className="text-muted-foreground">
                {circleLabel(c)}
              </option>
            ))}
          </optgroup>
        )}
        {extra}
      </select>
      {searching && operating.length + forming.length === 0 && (
        <p className="mt-1 text-xs text-muted-foreground">{t({ message: "No circle matches.", context: "circle picker" })}</p>
      )}
    </div>
  );
}
