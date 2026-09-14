/**
 * "This just opened for you." The one section lifted to the top, for one visit.
 *
 * It is a POINTER, not a copy of the section. Rendering the section itself up
 * here would put the same thing on the page twice and leave a member unsure
 * whether they were looking at two things or one. So this names it, says the
 * one sentence about why it is new, and takes them to it. The section stays in
 * its fixed home the whole time, which is the point: the order never actually
 * changes, a signpost appears above it for a visit or two.
 *
 * Pressing it settles the section for good, wherever the member is reading
 * from, because using a thing is the strongest possible signal they have met
 * it.
 */
import { motion } from "framer-motion";
import { Sparkles, ArrowDown } from "lucide-react";

export default function SurfacedBanner({
  title,
  because,
  onGo,
}: {
  title: string;
  /** Why it is open now, in the village's own terms. */
  because: string;
  onGo: () => void;
}) {
  return (
    <motion.aside
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      /* `role="status"` and not an alert: this is worth hearing on arrival and
         is never urgent, and an alert interrupts whatever a screen reader is
         part-way through saying. */
      role="status"
      className="mb-6 flex flex-wrap items-center gap-x-4 gap-y-3 rounded-2xl border border-notice/60 bg-notice/10 px-5 py-4"
    >
      <Sparkles className="h-5 w-5 shrink-0 text-notice" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold uppercase tracking-widest text-notice">Newly open to you</p>
        <p className="font-display text-lg font-semibold leading-snug text-card-foreground">{title}</p>
        {because ? <p className="mt-0.5 text-sm text-muted-foreground">{because}</p> : null}
      </div>
      <button
        type="button"
        onClick={onGo}
        className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-lg bg-notice px-4 py-2 font-medium text-background"
      >
        Take a look
        <ArrowDown className="h-4 w-4" aria-hidden="true" />
      </button>
    </motion.aside>
  );
}
