/**
 * The member's own data settings say where their words go when they talk to a
 * guide (the coordinator, 2026-11-09), in the same plain lines the guide
 * surfaces carry (GuideDataLine), named by this village's own guides.
 */
import { useLingui } from "@lingui/react/macro";
import GuideDataLine from "./GuideDataLine";
import { useGuideState } from "./MyGuide";

export default function GuideDataSection() {
  const { t } = useLingui();
  const [state] = useGuideState();
  const answering = state?.options.find((o) => o.id === state.answering) ?? null;
  const outside = state?.options.find((o) => o.id === "saberra") ?? null;
  return (
    <div className="border-t border-border pt-4 space-y-1" data-testid="guide-data-section">
      <p className="text-sm font-medium text-card-foreground">
        {t({ message: "Your words and the guides", context: "data settings: heading for where guide conversations go" })}
      </p>
      <GuideDataLine guide={answering?.name ?? null} outside={outside?.name ?? null} />
    </div>
  );
}
