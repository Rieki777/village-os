import type { KeyboardEvent } from "react";

/**
 * ARROW KEYS INSIDE A RADIOGROUP, because saying `role="radio"` is a promise.
 *
 * A group that announces itself as radios and then behaves like a row of
 * buttons is worse than the row of buttons was: a screen reader user is told
 * to expect arrow-key selection and does not get it. So a group carries the
 * whole pattern, which is this handler plus a roving tabindex
 * (`tabIndex={selected ? 0 : -1}`), the same shape the ARIA authoring
 * practices describe. Use it only on a group that always has exactly one
 * selected value, so the roving index can never leave the group unreachable.
 *
 * Focus moves by index within the group's own DOM, so it does not care which
 * group it is in or how many options that one has.
 *
 * Lifted out of the character picker (client/src/pages/Characters.tsx) when
 * the live room's breath controls became radios too, so both share one
 * keyboard behaviour.
 */
export function radioArrows<T>(
  values: readonly T[],
  current: T,
  pick: (v: T) => void,
): (e: KeyboardEvent<HTMLButtonElement>) => void {
  return (e) => {
    const forward = e.key === "ArrowRight" || e.key === "ArrowDown";
    const back = e.key === "ArrowLeft" || e.key === "ArrowUp";
    if (!forward && !back) return;
    e.preventDefault();
    const at = values.indexOf(current);
    const nextAt = (at + (forward ? 1 : -1) + values.length) % values.length;
    pick(values[nextAt]);
    const group = e.currentTarget.closest("[role='radiogroup']");
    const radios = group ? Array.from(group.querySelectorAll<HTMLElement>("[role='radio']")) : [];
    radios[nextAt]?.focus();
  };
}
