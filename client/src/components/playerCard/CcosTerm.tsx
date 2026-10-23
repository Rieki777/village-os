/**
 * A plain heading with its CCOS term on hover or tap, the circle card's own
 * pattern (client/src/components/circleCard/CircleCardView.tsx): the words
 * are an `InfoTip` trigger, so hover, tap, Tab and Enter all show
 * "CCOS: <term>", and a screen reader hears it as the trigger's description.
 * With no term, because the village turned them off (`org.ccos_terms`), the
 * words draw exactly as they are and nothing is underlined.
 *
 * TAP TARGETS, 44px on a phone without moving any layout: an invisible inset
 * pseudo-element grows the touch area around the words, the bare InfoTip's
 * own trick. An eyebrow is text-xs (a 16px line), so it grows 14px each way;
 * a phrase inside a sentence is text-sm (20px), so it grows 12px each way,
 * the circle card's `INLINE_TAP`. A button resets `text-transform`, so the
 * eyebrow's trigger says uppercase again itself.
 *
 * These classes match the circle card's and are spelled here until the two
 * cards share one file: a later extraction, after the circle cards lane lands
 * its parts (the merge session's call, 2026-10-22).
 */
import type { ReactNode } from "react";
import InfoTip from "@/components/InfoTip";

/** An eyebrow heading: text-xs, so a 16px line grown to 44px. */
export const EYEBROW_TAP = "relative uppercase before:absolute before:-inset-x-1 before:-inset-y-3.5 before:content-['']";
/** A phrase inside a text-sm sentence, as the circle card's "This circle exists while". */
export const INLINE_TAP = "relative before:absolute before:-inset-x-1 before:-inset-y-3 before:content-['']";
/** A bold label inside a text-sm block, its own 44px row like the circle card's headings. */
export const LABEL_TAP = "inline-flex min-h-11 items-center text-left";

export function CcosTerm({ term, children, tap = EYEBROW_TAP }: { term: string | null | undefined; children: ReactNode; tap?: string }) {
  if (!term) return <>{children}</>;
  return (
    <InfoTip tip={term} triggerClassName={tap}>
      {children}
    </InfoTip>
  );
}
