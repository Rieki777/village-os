/**
 * The small parts the role proposal steps draw with (role proposals PR C):
 * the classes, the save line, the gold frame a changed field sits in, and the
 * posted words behind it.
 *
 * The steps sit on the profile's night sheet. Colours are tokens, so a
 * heading stays moonlight on the dark ground and a card stays a card.
 * Gold is the card's own `notice` token. Phone first: every control is
 * at least 44px and nothing is wider than the screen.
 */
import type { ReactNode } from "react";
import { textOf } from "./roleWords";
import { RP_WORDS } from "./proposalWords";
import type { SaveStatus } from "./useAutosave";
import type { WordValue } from "@shared/roleProposals";

export const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
export const INPUT = `w-full rounded-lg border border-border bg-card px-3 py-2 text-base text-foreground ${FOCUS}`;
export const PRIMARY = `inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg bg-dash-gold px-4 font-semibold text-dash-gold-ink hover:opacity-90 disabled:opacity-50 ${FOCUS}`;
export const SECONDARY = `inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg border border-border bg-card px-4 font-medium text-foreground hover:bg-muted disabled:opacity-50 ${FOCUS}`;
export const QUIET = `inline-flex min-h-[44px] items-center gap-1.5 rounded-lg px-3 text-sm font-medium text-dash-gold-lit hover:bg-muted ${FOCUS}`;
export const PANEL = "rounded-xl border border-border bg-card p-4 text-foreground";
export const H2 = "font-display text-xl text-foreground";
export const LEDE = "text-sm leading-relaxed text-muted-foreground";

/** "Saved", "Saving" or "Not saved, try again", said where a screen reader hears it. */
export function SaveLine({ status, error, onRetry }: { status: SaveStatus; error: string | null; onRetry: () => void }) {
  if (status === "idle") return <div role="status" data-save-status="idle" className="sr-only" />;
  return (
    <div role="status" aria-live="polite" data-save-status={status} className="flex min-h-11 flex-wrap items-center gap-x-3 text-sm">
      {status === "saving" && <span className="text-muted-foreground">{RP_WORDS.saving}</span>}
      {status === "saved" && (
        <>
          <span className="font-medium text-dash-gold-lit">{RP_WORDS.saved}</span>
          <span>{RP_WORDS.savedReturn}</span>
        </>
      )}
      {status === "failed" && (
        <>
          <span className="font-semibold text-coral">{RP_WORDS.notSaved}</span>
          {error && <span className="text-muted-foreground">{error}</span>}
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
      className={`min-w-0 rounded-xl border p-3 ${gold ? "border-notice border-l-4 bg-notice/10" : "border-border bg-card"}`}
    >
      {children}
      {gold && (
        <div className="mt-2 grid gap-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-notice" data-changed-label="">
            {isNew ? RP_WORDS.isNew : RP_WORDS.changed}
          </p>
          {!isNew && (
            <details className="text-sm">
              <summary className={`inline-flex min-h-[44px] cursor-pointer items-center font-medium text-foreground ${FOCUS}`}>{RP_WORDS.seePosted}</summary>
              <div className="mt-1 rounded-lg border border-border bg-muted p-3" data-posted-words="">
                <p className="text-xs font-semibold text-muted-foreground">{RP_WORDS.posted}</p>
                {textOf(posted) ? (
                  <p className="mt-1 whitespace-pre-line break-words text-foreground">{textOf(posted)}</p>
                ) : (
                  <p className="mt-1 text-muted-foreground">{RP_WORDS.nothingPosted}</p>
                )}
              </div>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
