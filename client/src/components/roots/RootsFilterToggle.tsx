/**
 * THE ONE SWITCH: "Show only what matches my roots" (build list 10.3).
 *
 * On by default once somebody has picked roots, and one press turns it off
 * (`useRootsFilter`). It says what it is doing in numbers about the LIST, never
 * about the person ("Showing 6 of 20", counting work not tagged yet, which
 * always shows), and when it hides everything it offers
 * the way back in the same sentence, so a filter can never read as an empty
 * village.
 *
 * Phone: one full-width row, the switch at the right edge where a thumb sits.
 * Desktop: the switch, the roots it is matching (drawn as roots), and the
 * count, side by side on one line.
 *
 * A real switch: `role="switch"` with `aria-checked`, a 44px target, a visible
 * focus ring, and its state in words beside it for anybody who cannot see the
 * knob move.
 */
import { useLingui } from "@lingui/react/macro";
import { Link } from "wouter";
import RootTags from "./RootTags";
import type { RootsFilter } from "./useRootsFilter";

/** Where a person picks their roots: the profile's characters page. */
export const ROOTS_PAGE = "/profile/characters";

export interface RootsFilterToggleProps {
  filter: RootsFilter;
  /** How many the list holds, and how many it shows under the filter. */
  total: number;
  shown: number;
  /** What the list holds, for the sentence: "quests", "roles". */
  noun: string;
  className?: string;
}

export default function RootsFilterToggle({ filter, total, shown, noun, className = "" }: RootsFilterToggleProps) {
  const { t } = useLingui();
  if (!filter.available) return null;
  const label = t({ message: "Show only what matches my roots", context: "roots filter switch" });
  return (
    <div
      className={`flex flex-col gap-2 rounded-xl border border-border bg-card px-4 py-3 sm:flex-row sm:items-center sm:gap-4 ${className}`.trim()}
      data-testid="roots-filter"
    >
      <div className="flex min-h-11 items-center justify-between gap-3 sm:justify-start">
        <span id="roots-filter-label" className="text-sm font-semibold text-foreground">
          {label}
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={filter.on}
          aria-labelledby="roots-filter-label"
          onClick={() => filter.setOn(!filter.on)}
          className="jw-btn relative inline-flex h-11 w-16 shrink-0 items-center rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <span aria-hidden="true" className={`absolute inset-x-1 inset-y-2.5 rounded-full border ${filter.on ? "border-notice bg-notice/30" : "border-border bg-muted"}`} />
          <span
            aria-hidden="true"
            className={`absolute top-3.5 size-4 rounded-full motion-safe:transition-transform ${filter.on ? "translate-x-10 bg-notice" : "translate-x-2 bg-muted-foreground"}`}
          />
        </button>
      </div>
      <RootTags roots={filter.mine} size="sm" className="hidden sm:flex" />
      <p className="text-sm text-muted-foreground sm:ml-auto" aria-live="polite">
        {filter.on
          ? t({ message: `Showing ${shown} of ${total} ${noun}: the ones that grow from your roots, and the ones not tagged yet.`, context: "roots filter count" })
          : t({ message: `Showing all ${total} ${noun}.`, context: "roots filter count, filter off" })}{" "}
        <Link href={ROOTS_PAGE} className="font-medium text-notice underline underline-offset-2 hover:text-foreground">
          {t({ message: "Change my roots", context: "roots filter, link to the profile's characters page" })}
        </Link>
      </p>
    </div>
  );
}
