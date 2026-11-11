/**
 * A circle's name wherever it is shown. The anchor circle carries an anchor
 * before its name. Whether a circle is the anchor comes from the village's
 * data (shared/circlePicker.ts), never from a name typed here.
 */
import { useLingui } from "@lingui/react/macro";
import { ANCHOR_MARK } from "@shared/circlePicker";

export default function CircleName({ name, anchor, className }: { name: string; anchor?: boolean | null; className?: string }) {
  const { t } = useLingui();
  if (!anchor) return <span className={className}>{name}</span>;
  return (
    <span className={className}>
      <span role="img" aria-label={t({ message: "Anchor circle", context: "circle name" })} title={t({ message: "Anchor circle", context: "circle name" })}>
        {ANCHOR_MARK}
      </span>{" "}
      {name}
    </span>
  );
}

/** Plain text for an option or a label. */
export function circleLabel(c: { name: string; anchor?: boolean | null }): string {
  return c.anchor ? `${ANCHOR_MARK} ${c.name}` : c.name;
}
