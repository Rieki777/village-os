/**
 * ONE RUNG OF A LADDER: an icon, a name, and the words a screen reader needs.
 *
 * Extracted from the profile's MaturityLadder, which still renders exactly the
 * markup it did: the base classes, the look classes and the icon are the ones
 * it wrote inline, in the same order. The role card's commitments ladder and
 * the permission face's rung ladder draw the same part.
 *
 * A LOOK IS A VISUAL NAME, NEVER A MEANING. "lit" is a walked rung on the
 * profile and a rung that also qualifies on a permission role; what it means
 * is said by the caller, in `srWords`, which every chip ends with. The rung
 * ladder never uses `dashed`, so the two ladders on the two faces of a card
 * never share a look that means "missing".
 *
 * No separator character between chips: a literal dot is announced, and the
 * ladder used to read as "Visitor dot Guest dot Immersant".
 */
import { CheckCircle2, Circle, Link2, type LucideIcon } from "lucide-react";

export type LadderLook = "inverted" | "lit" | "plain" | "gilded" | "edged" | "dashed";

const BASE = "flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium";

const LOOKS: Record<LadderLook, { chip: string; icon: LucideIcon; iconInk?: string }> = {
  inverted: { chip: "bg-foreground text-background", icon: CheckCircle2 },
  lit: { chip: "bg-muted text-foreground", icon: CheckCircle2 },
  plain: { chip: "text-muted-foreground", icon: Circle },
  gilded: { chip: "bg-muted text-foreground ring-1 ring-inset ring-notice/60", icon: CheckCircle2, iconInk: "text-notice" },
  edged: { chip: "text-foreground ring-1 ring-inset ring-border", icon: Link2 },
  dashed: { chip: "border border-dashed border-border text-muted-foreground", icon: Circle },
};

export default function LadderChip({
  look,
  icon,
  label,
  suffix,
  srWords,
  current,
  title,
  className,
}: {
  look: LadderLook;
  /** Overrides the look's own icon. */
  icon?: LucideIcon;
  label: string;
  /** A quieter word after the label, as in "Term set at seating". */
  suffix?: string;
  /** What the look means here, for a reader who gets no icon and no colour. */
  srWords: string;
  /** This is the step the ladder is about: `aria-current="step"`. */
  current?: boolean;
  title?: string;
  /** Appended after the look's classes. */
  className?: string;
}) {
  const shape = LOOKS[look];
  const Icon = icon ?? shape.icon;
  return (
    <span
      aria-current={current ? "step" : undefined}
      title={title}
      className={[BASE, shape.chip, className].filter(Boolean).join(" ")}
    >
      <Icon className={shape.iconInk ? `h-3.5 w-3.5 shrink-0 ${shape.iconInk}` : "h-3.5 w-3.5 shrink-0"} aria-hidden="true" />
      {label}
      {/* The space is a text node of its own: a flex container drops it from
          the layout (the gap spaces the chip), and the chip's text still reads
          "Term set at seating" rather than "Termset at seating". */}
      {suffix ? (
        <>
          {" "}
          <span className="text-muted-foreground">{suffix}</span>
        </>
      ) : null}
      <span className="sr-only">{srWords}</span>
    </span>
  );
}
