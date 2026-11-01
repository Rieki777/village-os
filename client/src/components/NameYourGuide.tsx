import { Link } from "wouter";
import { ArrowRight, Sparkles } from "lucide-react";
import { UNNAMED_GUIDE, type GuideAudience, type GuideName } from "@shared/guideName";

/** Where the guide is named: Admin, Work With Us, the "AI guide's name" field. */
export const NAME_YOUR_GUIDE_HREF = "/admin?tab=work-with-us";

/**
 * "Name your guide": the note a FOUNDER sees where they meet their village's
 * guide before it has a name (Rye, 2026-10-22: every village adds and names
 * its own guide, and founders get this prompt).
 *
 * The rule lives here, so every surface that mounts it asks the same
 * question: only a founder, only while the guide is unnamed, and only once the
 * page knows the answer. Admins read "your village guide" too, but the
 * prompt is the founder's. Everyone else never sees it.
 */
export default function NameYourGuide({
  guide,
  audience,
  ready,
}: {
  guide: GuideName;
  audience: GuideAudience;
  /** False until the village's Work With Us document has answered. */
  ready: boolean;
}) {
  if (!ready || guide.named || audience !== "founder") return null;
  return (
    <aside
      aria-labelledby="name-your-guide-h"
      className="mb-6 flex flex-col gap-3 rounded-2xl border border-amber/30 bg-amber/10 px-5 py-4 sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="flex items-start gap-3">
        <Sparkles className="mt-0.5 h-5 w-5 shrink-0 text-teal-deep" aria-hidden="true" />
        <div>
          <p id="name-your-guide-h" className="font-semibold text-teal-deep">
            Your village guide has no name yet
          </p>
          <p className="text-sm text-stone-700">
            Visitors and members see “{UNNAMED_GUIDE.shared}” until you name it. Only founders see this note.
          </p>
        </div>
      </div>
      <Link
        href={NAME_YOUR_GUIDE_HREF}
        className="inline-flex shrink-0 items-center gap-2 self-start rounded-xl bg-teal-deep px-4 py-2 text-sm font-semibold text-white hover:bg-teal-deep-dark sm:self-center"
      >
        Name your guide <ArrowRight className="h-4 w-4" aria-hidden="true" />
      </Link>
    </aside>
  );
}
