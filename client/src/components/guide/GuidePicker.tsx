/**
 * WHO YOU'RE TALKING TO, on every guide surface (Rye, 2026-10-24).
 *
 * It always says who is answering, so a member is never answered by one guide
 * while believing it was the other. When both guides can answer it offers the
 * other one in a single tap, and the choice is saved for the member and read
 * by every guide here. When the member's choice cannot answer right now, it
 * says so in one sentence. With nobody to answer it draws nothing, because the
 * surface around it draws no button either.
 */
import { useState } from "react";
import { MessageCircle } from "lucide-react";
import { GUIDE_WORDS, type GuideState } from "@shared/guideChoice";
import { saveGuide } from "@/lib/guideApi";

const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-deep";
const SWITCH = `inline-flex min-h-[44px] items-center gap-1.5 rounded-lg px-3 text-sm font-medium text-teal-deep hover:bg-teal-deep/5 disabled:opacity-50 ${FOCUS}`;

export default function GuidePicker({ state, onChange }: { state: GuideState; onChange: (next: GuideState) => void }) {
  const [busy, setBusy] = useState(false);
  const answering = state.options.find((o) => o.id === state.answering);
  if (!answering) return null;
  const other = state.canChoose ? state.options.find((o) => o.id !== answering.id && o.available) : undefined;
  // An unnamed village guide needs no second line saying it is the village's guide.
  const about = answering.id === "saberra" ? GUIDE_WORDS.saberra(answering.name) : answering.named ? GUIDE_WORDS.village(answering.name) : null;

  const switchTo = async () => {
    if (!other) return;
    setBusy(true);
    const next = await saveGuide(other.id);
    setBusy(false);
    if (next) onChange(next);
  };

  return (
    <div className="grid gap-1 rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-sm" data-guide-answering={answering.id}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 font-medium text-stone-800">
          <MessageCircle className="h-4 w-4 text-teal-deep" aria-hidden="true" />
          {GUIDE_WORDS.answering(answering.name)}
        </p>
        {other && (
          <button type="button" className={SWITCH} disabled={busy} onClick={() => void switchTo()} data-guide-switch={other.id}>
            {GUIDE_WORDS.switchTo(other.name)}
          </button>
        )}
      </div>
      {about && <p className="text-stone-600">{about}</p>}
      {state.note && (
        <p className="text-stone-700" role="status">
          {state.note}
        </p>
      )}
    </div>
  );
}
