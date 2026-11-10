/**
 * WHO HELPS YOU, chosen once on the profile (2026-11-09). Every guide surface
 * (the journal, Talk it out beside long boxes, companions, the role guide)
 * reads the same saved choice, so this is the one obvious place to pick Maia
 * or Sera; each surface still shows who is answering and can switch.
 */
import { useLingui } from "@lingui/react/macro";
import MyGuide, { useGuideState } from "./MyGuide";

export default function GuideChoiceCard() {
  const { t } = useLingui();
  const [state, setState] = useGuideState();
  // Only worth a card when there is a choice to make.
  if (!state || state.options.filter((o) => o.available).length < 2) return null;
  return (
    <section aria-labelledby="guide-choice-title" className="rounded-xl border border-border bg-card p-4">
      <h2 id="guide-choice-title" className="font-display text-lg font-semibold text-foreground">
        {t({ message: "Who helps you", context: "profile: the member's guide choice card" })}
      </h2>
      <p className="mb-2 text-sm text-muted-foreground">
        {t({ message: "Your guide answers in the journal, beside long boxes when you talk it out, and with your companions.", context: "profile: guide choice explainer" })}
      </p>
      <MyGuide state={state} onChange={setState} />
    </section>
  );
}
