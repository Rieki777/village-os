/**
 * A CHIP THAT EXPLAINS ITSELF, ON TOUCH AS WELL AS ON HOVER.
 *
 * A chip like "Key seat" or "Suits The Builder" is a claim, and a claim with
 * only a `title` tooltip has no explanation on a phone, where most of these
 * cards are read. So the chip is a button: a tap opens one plain line under
 * the row that holds it, and `aria-expanded` / `aria-controls` tell a screen
 * reader the same thing.
 *
 * ONE GLOSS OPEN PER CARD. `useGlossGroup` holds which one, so opening a
 * second closes the first, and the card renders one `Gloss` per chip (hidden
 * until open) so every `aria-controls` points at an element that exists.
 *
 * The `before:` pseudo-element stretches the hit area to 44px tall without
 * growing the chip.
 */
import { useCallback, useState, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

export type GlossTone = "notice" | "open" | "suggestion" | "edge";

const BASE =
  "relative inline-flex items-center gap-1.5 rounded-full bg-card px-2.5 py-[3px] text-[11.5px] font-semibold leading-snug before:absolute before:-inset-y-2.5 before:inset-x-0 before:content-[''] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

const TONES: Record<GlossTone, string> = {
  notice: "text-notice border border-notice/60",
  open: "text-open border border-open/55",
  suggestion: "whitespace-normal text-muted-foreground border border-dashed border-border",
  edge: "text-foreground border border-border",
};

export function GlossChip({
  tone,
  icon: Icon,
  tag,
  open,
  glossId,
  onToggle,
  onClose,
  children,
}: {
  tone: GlossTone;
  icon?: LucideIcon;
  /** A divided tag after the label, as in "Suggested". */
  tag?: string;
  open: boolean;
  /** The id of this chip's `Gloss`. */
  glossId: string;
  onToggle: () => void;
  /** Escape closes an open gloss. */
  onClose?: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-expanded={open}
      aria-controls={glossId}
      onClick={onToggle}
      onKeyDown={(e) => {
        if (e.key === "Escape" && open && onClose) {
          e.stopPropagation();
          onClose();
        }
      }}
      className={`${BASE} ${TONES[tone]}`}
    >
      {Icon ? <Icon className="size-3.5 shrink-0" aria-hidden="true" /> : null}
      <span>{children}</span>
      {tag ? (
        <span className="border-l border-border/60 pl-1.5 text-[11px] uppercase tracking-[0.14em]">{tag}</span>
      ) : null}
    </button>
  );
}

/** The one plain line a chip opens. Always mounted, hidden until open. */
export function Gloss({ id, open, children }: { id: string; open: boolean; children: ReactNode }) {
  return (
    <p id={id} hidden={!open} className="px-1 text-[12.5px] leading-snug text-muted-foreground">
      {children}
    </p>
  );
}

/** Which gloss on this card is open: at most one. */
export function useGlossGroup() {
  const [openKey, setOpenKey] = useState<string | null>(null);
  const toggle = useCallback((key: string) => setOpenKey((k) => (k === key ? null : key)), []);
  const close = useCallback(() => setOpenKey(null), []);
  const isOpen = useCallback((key: string) => openKey === key, [openKey]);
  return { openKey, toggle, close, isOpen };
}

export default GlossChip;
