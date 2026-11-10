/**
 * SET UP YOUR AI GUIDE FIRST (Rye, 2026-11-09): "when the Anthropic API key
 * isn't set up, this should be a warning right at the very beginning of Make
 * this yours and on the first page of admin."
 *
 * Shown at the top of Admin Home and Make This Yours while no AI can answer:
 * no Anthropic key of the village's own and no working Sera connection. It
 * asks for the key first because the guide then helps with the rest of the
 * journey, and the helper turns on by itself the moment a key is saved (its
 * switch, `platform.admin_helper`, ships on).
 *
 * It reads the helper's own status (`GET /api/admin/helper`), so the banner and
 * the panel can never disagree about whether the guide is connected. A village
 * that switched the helper off on purpose (`off: "switch"`) is not nagged.
 */
import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
import { Trans } from "@lingui/react/macro";
import { guideNameAtSentenceStart } from "@shared/guideName";
import type { HelperStatus } from "@shared/adminHelper";
import { fetchHelperStatus } from "./adminHelperApi";

export default function AiSetupBanner({
  password,
  onOpenTab,
  onOpenHelper,
  initialStatus,
}: {
  password: string;
  onOpenTab: (key: string) => void;
  onOpenHelper: () => void;
  /** For tests: skip the fetch. */
  initialStatus?: HelperStatus;
}) {
  const [status, setStatus] = useState<HelperStatus | null>(initialStatus ?? null);

  useEffect(() => {
    if (initialStatus) return;
    const ctrl = new AbortController();
    fetchHelperStatus(password, ctrl.signal).then(setStatus).catch(() => { /* no banner rather than a wrong one */ });
    return () => ctrl.abort();
  }, [password, initialStatus]);

  if (!status || status.off !== "key") return null;
  const guide = guideNameAtSentenceStart(status.guide || "your village guide");

  return (
    <section
      data-testid="ai-setup-banner"
      aria-labelledby="ai-setup-banner-title"
      className="mb-6 rounded-xl border border-border bg-amber-light p-4 text-foreground"
    >
      <div className="flex items-start gap-3">
        <Sparkles className="mt-0.5 h-5 w-5 shrink-0 text-notice" aria-hidden="true" />
        <div className="min-w-0 space-y-2">
          <h2 id="ai-setup-banner-title" className="font-semibold">
            <Trans context="admin, AI setup banner">Set up your AI guide first</Trans>
          </h2>
          <p className="text-sm">
            <GuideSentence guide={guide} />
          </p>
          <div className="flex flex-wrap gap-2 pt-1">
            <button
              type="button"
              onClick={() => onOpenTab("integrations")}
              className="inline-flex min-h-11 items-center rounded-full bg-primary px-4 text-sm font-medium text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Trans context="admin, AI setup banner: opens Integrations to paste the key">Add your Anthropic key</Trans>
            </button>
            <button
              type="button"
              onClick={onOpenHelper}
              className="inline-flex min-h-11 items-center rounded-full border border-border bg-card px-4 text-sm font-medium text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Trans context="admin, AI setup banner: opens the helper's setup steps">Show me how</Trans>
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

function GuideSentence({ guide }: { guide: string }) {
  return (
    <Trans context="admin, AI setup banner">
      Connect an Anthropic key (or Sera, if your village uses it for org memory) and {guide} helps you through the rest of setup: finding settings, explaining them and proposing changes for you to approve. It turns on by itself once the key is saved.
    </Trans>
  );
}
