/**
 * The four whole-role presets, plus Not sure yet, as tap cards.
 *
 * Plain label, then the official word, then one line of what it means and
 * one example. A card that records money says it is a proposal, not a promise.
 */
import { useId } from "react";
import { WHOLE_PRESETS, type WholeSeatPreset } from "@shared/seatPresets";
import { MONEY_PROMISE, NOT_SURE_YET, unsureLine, wholeCardCopy } from "@shared/termCards";

const card =
  "flex min-h-[44px] w-full max-w-full flex-col items-start gap-1 rounded-xl border border-border bg-card p-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export default function WholePresetCards({
  partner,
  onPick,
  onUnsure,
}: {
  partner?: string;
  onPick: (whole: WholeSeatPreset) => void;
  onUnsure: () => void;
}) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  return (
    <ul className="mt-2 grid gap-2 sm:grid-cols-2" data-whole-presets="">
      {WHOLE_PRESETS.map((w) => {
        const copy = wholeCardCopy(w);
        const labelId = `${uid}-${w.id}-label`;
        const descId = `${uid}-${w.id}-desc`;
        return (
          <li key={w.id} className="min-w-0">
            <button type="button" aria-labelledby={labelId} aria-describedby={descId} onClick={() => onPick(w)} className={card}>
              <span id={labelId} className="break-words text-base font-semibold text-foreground">
                {w.label}
              </span>
              <span className="break-words text-[13px] font-semibold uppercase tracking-wide text-foreground">{copy.official}</span>
              <span id={descId} className="grid gap-1">
                <span className="break-words text-[13px] leading-snug text-foreground">{w.blurb}</span>
                <span className="break-words text-[13px] leading-snug text-foreground">{copy.example}</span>
                <span className="break-words text-[13px] font-medium leading-snug text-foreground">{MONEY_PROMISE}</span>
              </span>
            </button>
          </li>
        );
      })}
      <li className="min-w-0">
        <button type="button" onClick={onUnsure} className={card} data-not-sure="">
          <span className="break-words text-base font-semibold text-foreground">{NOT_SURE_YET}</span>
          <span className="break-words text-[13px] leading-snug text-foreground">{unsureLine(partner)}</span>
        </button>
      </li>
    </ul>
  );
}
