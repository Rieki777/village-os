/**
 * THE SEAL: a person's two lines, sitting on their portrait.
 *
 * Rye, 2026-10-22: the portrait seal, where "a click on mobile or a hover on
 * desktop reveals the names (in this case experimenter/fixer) and opens" the
 * lines card. So the seal is a real button:
 *
 *   - hover or keyboard focus shows the two Life's Work words beside it;
 *   - a click, or a tap on a phone, opens the card: a dialog on a wide screen
 *     and a sheet from the bottom on a phone, the same split TaskAnswerSheet
 *     makes, and the sheet leads with the two words so a tap reveals them too.
 *
 * It sits opposite the stage chip (top right of the portrait), wears the night
 * sheet's moonlight ring, and is at least 44px for a thumb. The words come from
 * the Life's Work sphere for both numbers, so the seal and the circle view share
 * one set of six (Creator, Dancer, Changer, Server, Fixer, Teacher).
 */
import { useState } from "react";
import type { GeneKeysView, OwnGeneKeysView } from "@shared/geneKeys";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { GeneKeysLines, GeneKeysOwnerControls } from "./GeneKeysLines";
import { EYEBROW } from "./ui";

function wideScreen(): boolean {
  return typeof window !== "undefined" && !!window.matchMedia?.("(min-width: 768px)").matches;
}

export interface SealProps {
  view: GeneKeysView;
  /** The person's first name for "How Wren works best", or null on the member's own seal. */
  whose: string | null;
  /** The owner's copy, which adds their controls inside the card. */
  mine?: OwnGeneKeysView | null;
  /** Placement on the portrait; the parent is `relative`. */
  className?: string;
}

export default function GeneKeysSeal({ view, whose, mine = null, className = "absolute -right-1 top-1" }: SealProps) {
  const [open, setOpen] = useState(false);
  const [wide, setWide] = useState(wideScreen);
  const label = `Gene Keys lines ${view.lines[0]} and ${view.lines[1]}, ${view.names.replace(" · ", " and ")}. Open the lines card.`;

  const body = (
    <>
      <GeneKeysLines view={view} whose={whose} />
      {mine ? <GeneKeysOwnerControls mine={mine} /> : null}
    </>
  );

  return (
    <>
      <span className={`group ${className}`}>
        <button
          type="button"
          aria-label={label}
          aria-haspopup="dialog"
          onClick={() => {
            setWide(wideScreen());
            setOpen(true);
          }}
          className="sheet-night flex h-12 w-12 items-center justify-center rounded-full border-[1.5px] border-foreground bg-card text-sm font-medium text-foreground shadow-sm ring-[3px] ring-background hover:border-notice focus-visible:outline-none focus-visible:ring-notice"
        >
          {view.profile}
        </button>
        <span
          aria-hidden="true"
          className="sheet-night pointer-events-none absolute bottom-full left-1/2 mb-2 hidden -translate-x-1/2 whitespace-nowrap rounded-lg border border-border bg-muted px-3 py-1.5 text-sm text-foreground shadow-sm group-focus-within:block group-hover:block"
        >
          {view.names}
        </span>
      </span>
      {open && wide ? (
        <Dialog open onOpenChange={setOpen}>
          <DialogContent className="sheet-night max-h-[90vh] overflow-y-auto rounded-2xl border-border bg-card p-6 text-card-foreground sm:max-w-2xl">
            <p className={EYEBROW}>Gene Keys {view.profile}</p>
            <DialogTitle className="font-display text-3xl font-normal text-foreground">{view.names}</DialogTitle>
            <DialogDescription className="sr-only">Gene Keys lines and how this person works best.</DialogDescription>
            {body}
          </DialogContent>
        </Dialog>
      ) : null}
      {open && !wide ? (
        <Sheet open onOpenChange={setOpen}>
          <SheetContent
            side="bottom"
            className="sheet-night max-h-[90vh] overflow-y-auto rounded-t-2xl border-border bg-card px-4 pt-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] text-card-foreground"
          >
            <p className={EYEBROW}>Gene Keys {view.profile}</p>
            <SheetTitle className="font-display text-3xl font-normal text-foreground">{view.names}</SheetTitle>
            <SheetDescription className="sr-only">Gene Keys lines and how this person works best.</SheetDescription>
            {body}
          </SheetContent>
        </Sheet>
      ) : null}
    </>
  );
}
