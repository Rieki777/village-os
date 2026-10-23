/**
 * The small parts the role proposal steps draw with (role proposals PR C):
 * the classes, the save line, the gold frame a changed field sits in, and the
 * posted words behind it.
 *
 * The steps are on the light page, as the season plan page is (no dark mode,
 * Rye 2026-09-21). Gold is the card's own `notice` token, so a changed word
 * reads the same here as in the preview card. Phone first: every control is
 * at least 44px and nothing is wider than the screen.
 */
import type { ReactNode } from "react";
import { textOf } from "./roleWords";
import { RP_WORDS } from "./proposalWords";
import type { SaveStatus } from "./useAutosave";
import type { WordValue } from "@shared/roleProposals";

export const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-deep";
export const INPUT = `w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-base text-stone-900 ${FOCUS}`;
export const PRIMARY = `inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg bg-teal-deep px-4 font-semibold text-white hover:bg-teal-deep-dark disabled:opacity-50 ${FOCUS}`;
export const SECONDARY = `inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg border border-stone-300 bg-white px-4 font-medium text-stone-800 hover:bg-stone-50 disabled:opacity-50 ${FOCUS}`;
export const QUIET = `inline-flex min-h-[44px] items-center gap-1.5 rounded-lg px-3 text-sm font-medium text-teal-deep hover:bg-teal-deep/5 ${FOCUS}`;
export const PANEL = "rounded-xl border border-stone-200 bg-white p-4";
export const H2 = "font-display text-xl font-bold text-stone-900";
export const LEDE = "text-sm leading-relaxed text-stone-600";

/** "Saved", "Saving" or "Not saved, try again", said where a screen reader hears it. */
export function SaveLine({ status, error, onRetry }: { status: SaveStatus; error: string | null; onRetry: () => void }) {
  return (
    <div role="status" aria-live="polite" data-save-status={status} className="flex min-h-[44px] flex-wrap items-center gap-x-3 text-sm">
      {status === "saving" && <span className="text-stone-600">{RP_WORDS.saving}</span>}
      {status === "saved" && <span className="font-medium text-teal-deep">{RP_WORDS.saved}</span>}
      {status === "failed" && (
        <>
          <span className="font-semibold text-coral">{RP_WORDS.notSaved}</span>
          {error && <span className="text-stone-700">{error}</span>}
          <button type="button" onClick={onRetry} className={QUIET}>
            {RP_WORDS.tryAgain}
          </button>
        </>
      )}
    </div>
  );
}

/**
 * One field's frame. Changed from the posted role, it is gold and says so,
 * with the posted words a tap away; on a new role it says "New".
 */
export function FieldFrame({
  changed,
  isNew,
  posted,
  field,
  children,
}: {
  changed: boolean;
  isNew: boolean;
  posted: WordValue | undefined;
  field: string;
  children: ReactNode;
}) {
  // A new role has nothing posted, so every field of it reads "New".
  const gold = isNew || changed;
  return (
    <div
      data-field={field}
      data-changed={gold ? "true" : "false"}
      className={`min-w-0 rounded-xl border p-3 ${gold ? "border-notice border-l-4 bg-notice/10" : "border-stone-200 bg-white"}`}
    >
      {children}
      {gold && (
        <div className="mt-2 grid gap-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-notice" data-changed-label="">
            {isNew ? RP_WORDS.isNew : RP_WORDS.changed}
          </p>
          {!isNew && (
            <details className="text-sm">
              <summary className={`inline-flex min-h-[44px] cursor-pointer items-center font-medium text-stone-700 ${FOCUS}`}>{RP_WORDS.seePosted}</summary>
              <div className="mt-1 rounded-lg border border-stone-200 bg-white p-3" data-posted-words="">
                <p className="text-xs font-semibold text-stone-500">{RP_WORDS.posted}</p>
                {textOf(posted) ? (
                  <p className="mt-1 whitespace-pre-line break-words text-stone-800">{textOf(posted)}</p>
                ) : (
                  <p className="mt-1 text-stone-600">{RP_WORDS.nothingPosted}</p>
                )}
              </div>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
