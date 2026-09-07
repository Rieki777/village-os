/**
 * A section of the sheet that is present, and not yet yours.
 *
 * ONE LINE, AND THAT IS THE WHOLE POINT. The plan only works if a section a
 * member cannot use yet costs a line rather than a card: at eight thousand
 * pixels "show the whole map" is a scroll, and at one line per unopened
 * section it is a map you can read. Everything about this component is in
 * service of staying small.
 *
 * It says what would open it, and where that is done. A locked thing that does
 * not say what unlocks it is just an absence with a border.
 */
import { motion } from "framer-motion";
import { Lock } from "lucide-react";

export default function QuietSection({
  title,
  quiet,
  action,
  onAction,
  busy,
}: {
  title: string;
  /** The one sentence naming what opens this. */
  quiet: string;
  /** The words on the control, when there is something a member can press. */
  action?: string;
  onAction?: () => void;
  busy?: boolean;
}) {
  return (
    <motion.section
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      aria-label={title}
      className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-border/60 px-4 py-3"
    >
      <Lock className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <span className="font-medium text-card-foreground">{title}</span>
      {/* The sentence is muted and the title is not, so a reader skimming the
          map reads the titles and stops only where something interests them. */}
      <span className="min-w-0 flex-1 text-sm text-muted-foreground">{quiet}</span>
      {action && onAction ? (
        <button
          type="button"
          onClick={onAction}
          disabled={busy}
          className="min-h-11 shrink-0 rounded-lg border border-notice/70 px-4 py-2 text-sm font-medium text-notice hover:bg-notice/10 disabled:opacity-50"
        >
          {busy ? "Opening…" : action}
        </button>
      ) : null}
    </motion.section>
  );
}
