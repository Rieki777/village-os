/**
 * Acting on many of the outside service's differences at once (spec R30, R31,
 * R37; the approved "Take many at once" board).
 *
 * THE BAR appears only once something is ticked, with Keep in its overflow
 * (R37). It sits above the phone's tab bar and asks the floating shortcuts
 * button to step aside while it shows (`data-hides-fab`), which otherwise sat
 * on its menu button.
 *
 * THE SHEET says what a take will do before it does it, in R30's words: how
 * many go into the draft, how many marked Check first are left out, and which
 * new circle leaves its roles out with it (R31). It is the app's shared Sheet
 * (Radix Dialog underneath, review 20): focus is trapped inside it, Escape
 * closes it from anywhere, the page behind is inert, and focus goes back to
 * the button that opened it. It sits on the modal sheets' tier (z-[70],
 * MobileFab's ladder), over the header and the tab bar. What a bulk take never
 * takes is decided by the same rule the server holds it to (shared
 * `bulkPlan`, R2): a row with a reason to check first, an unknown base among
 * them, pay, and a new role apart from its new circle. A bulk keep confirms
 * first too (R16).
 *
 * Nothing goes live from here in this release: every take goes into the draft
 * (the "go live now" line of the board belongs to the automatic lane, later).
 */
import { useId, useRef, useState } from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { possessive } from "@/lib/seraReview";
import type { SeraActs } from "@/components/review/useSeraActs";
import { primary, secondary } from "@/components/review/seraStyles";

/** The bar along the bottom once anything is ticked. */
export function BulkBar({ acts, agent }: { acts: SeraActs; agent: string }) {
  const { t } = useLingui();
  const [more, setMore] = useState(false);
  const moreButton = useRef<HTMLButtonElement>(null);
  const n = acts.ticked.size;
  const id = useId();
  if (n === 0) return null;
  const owner = possessive(agent);
  return (
    // Above the phone's tab bar (`--tabbar-h`, 0 from 768 px), on the app's ladder just over it (MobileFab.tsx).
    <div data-hides-fab="" className="sticky bottom-[var(--tabbar-h)] z-[52] -mx-4 px-4 py-3 bg-card border-t border-border shadow-sm flex flex-wrap items-center gap-2">
      <p className="text-sm font-semibold text-foreground mr-auto">{n === 1 ? <Trans context="sera answers">1 ticked</Trans> : <Trans context="sera answers">{n} ticked</Trans>}</p>
      <button type="button" data-bulk="take" aria-disabled={acts.busy || undefined} onClick={(e) => !acts.busy && acts.openSheet("take", e.currentTarget)} className={primary}>
        {t({ message: `Take ${owner} for ${n}`, context: "sera answers" })}
      </button>
      <div
        className="relative"
        onKeyDown={(e) => {
          if (e.key === "Escape" && more) {
            e.stopPropagation();
            setMore(false);
          }
        }}
      >
        <button ref={moreButton} type="button" aria-expanded={more} aria-controls={`${id}-more`} onClick={() => setMore((m) => !m)} className={secondary}>
          <Trans context="sera answers">Keep or untick</Trans>
        </button>
        {more && (
          <div id={`${id}-more`} className="absolute right-0 bottom-full mb-2 w-56 bg-card border border-border rounded-lg shadow-md p-1 flex flex-col">
            <button type="button" data-bulk="keep" onClick={() => { setMore(false); acts.openSheet("keep", moreButton.current); }} className="min-h-[44px] px-3 text-left text-sm rounded-md hover:bg-muted">
              {t({ message: `Keep ours for ${n}`, context: "sera answers" })}
            </button>
            <button type="button" onClick={() => { setMore(false); acts.untickAll(); }} className="min-h-[44px] px-3 text-left text-sm rounded-md hover:bg-muted">
              <Trans context="sera answers">Untick all</Trans>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/** The sheet a bulk act opens, with the split in words, and its confirm. */
export function BulkSheet({ acts, agent }: { acts: SeraActs; agent: string }) {
  const { t } = useLingui();
  const sheet = acts.sheet;
  const owner = possessive(agent);
  const plan = acts.plan;
  const keep = sheet?.kind === "keep";
  const n = keep ? acts.tickedRows.length : plan.take.length;
  const checks = plan.leftOut.filter((l) => l.why === "checkFirst" || l.why === "notTakeable").length;
  const pays = plan.leftOut.filter((l) => l.why === "pay").length;
  const named = plan.leftOut.filter((l) => l.why !== "withCircle").map((l) => l.d.subject.name);
  const title = keep
    ? n === 1
      ? t({ message: "Keep ours for 1 change?", context: "sera answers" })
      : t({ message: `Keep ours for ${n} changes?`, context: "sera answers" })
    : n === 0
      ? t({ message: "Nothing ticked can be taken together", context: "sera answers" })
      : n === 1
        ? t({ message: `Take ${owner} for 1 change?`, context: "sera answers" })
        : t({ message: `Take ${owner} for ${n} changes?`, context: "sera answers" });
  return (
    <Sheet open={!!sheet} onOpenChange={(open) => !open && acts.closeSheet()}>
      <SheetContent
        side="bottom"
        // Opened from state, with no Radix trigger: hand focus back to the button that opened it, or the strip (review 20, 23).
        onCloseAutoFocus={(e) => {
          e.preventDefault();
          const opener = acts.sheetOpener.current;
          if (opener?.isConnected) opener.focus();
          else (document.querySelector<HTMLElement>("[data-sera-strip]") ?? undefined)?.focus();
        }}
        overlayClassName="z-[70]"
        className="z-[70] md:left-1/2 md:right-auto md:bottom-6 md:-translate-x-1/2 md:w-[440px] md:rounded-2xl bg-card rounded-t-2xl px-4 pt-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] gap-3 text-card-foreground [overflow-wrap:anywhere]"
      >
        <SheetTitle className="text-[19px] leading-snug font-bold text-foreground pr-8">{title}</SheetTitle>
        <SheetDescription className="sr-only">
          <Trans context="sera answers">What happens to each ticked change before anything is written.</Trans>
        </SheetDescription>
        <ul className="pl-5 list-disc flex flex-col gap-2 text-[15px] leading-normal text-foreground">
          {keep ? (
            <>
              <li>{t({ message: `Each one leaves the list until ${agent} changes it again.`, context: "sera answers" })}</li>
              <li><Trans context="sera answers">The line that follows has Undo, to bring them back.</Trans></li>
            </>
          ) : (
            <>
              {n > 0 && (
                <li>{n === 1 ? <Trans context="sera answers">It goes into a draft. It goes live when the draft is published.</Trans> : <Trans context="sera answers">{n} go into a draft. They go live when the draft is published.</Trans>}</li>
              )}
              {checks > 0 && (
                <li>{checks === 1 ? <Trans context="sera answers">1 marked Check first is left out. Take it on its own.</Trans> : <Trans context="sera answers">{checks} marked Check first are left out. Take each of them on its own.</Trans>}</li>
              )}
              {pays > 0 && (
                <li>{pays === 1 ? <Trans context="sera answers">1 pay change is left out. Pay is set by a person.</Trans> : <Trans context="sera answers">{pays} pay changes are left out. Pay is set by a person.</Trans>}</li>
              )}
              {plan.cascades.map((c) => {
                const circle = c.circle.subject.name;
                const k = c.roles.length;
                return (
                  <li key={c.circle.key}>
                    {k === 1 ? <Trans context="sera answers">Leaving out {circle} also leaves out its role.</Trans> : <Trans context="sera answers">Leaving out {circle} also leaves out its {k} roles.</Trans>}
                  </li>
                );
              })}
              {named.length > 0 && <li>{t({ message: `Left out: ${named.join(", ")}.`, context: "sera answers" })}</li>}
            </>
          )}
        </ul>
        <div className="flex flex-col gap-2">
          {n > 0 && (
            <button type="button" data-bulk="confirm" aria-disabled={acts.busy || undefined} onClick={() => !acts.busy && void acts.confirmSheet()} className={`${primary} min-h-[48px] text-[15px]`}>
              {keep ? t({ message: `Keep ${n}`, context: "sera answers" }) : t({ message: `Take ${n}`, context: "sera answers" })}
            </button>
          )}
          <button type="button" onClick={() => acts.closeSheet()} className={`${secondary} min-h-[48px] text-[15px]`}>
            <Trans context="sera answers">Not yet</Trans>
          </button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
