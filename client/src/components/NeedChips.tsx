/**
 * "Meets: Growth, Play", as chips, wherever a village shows a piece of work.
 *
 * WHAT THIS IS FOR (R1, R18). A village is a business designed to meet the
 * needs of the people in it, and until now nothing on a quest or a seat said
 * which need it was for. `need_links` (migration 0186) holds the answer and
 * this is the half a member reads.
 *
 * IT IS A DESCRIPTION AND NEVER A GATE, which is rule A.1.7 of the design and
 * is enforced on the server: the claim handler in server/routes/quests.ts
 * reads a quest's stage floor and its role gate and nothing else. Nothing
 * here is a permission, a price or a promise, so it renders for every reader
 * the payload reaches.
 *
 * THE LABEL IS THE VILLAGE'S OWN. `village_needs.label` is COPIED from the
 * taxonomy when a village takes a need on, so a later platform rename cannot
 * silently rewrite what this village said it was for. That copy is what the
 * chip prints. shared/needs.ts supplies the long name for the tooltip and
 * nothing else here, so the two can never fight over the short word.
 *
 * AN EMPTY LIST RENDERS NOTHING AT ALL, and that is the point. A quest with no
 * tags and a quest whose reader could not load its tags look the same from
 * here, so the honest move is silence: a "Meets: nothing" line would state a
 * fact this component cannot know.
 */
import { HUMAN_NEEDS_BY_ID, type NeedWeight } from "@shared/needs";

/** One row of `need_links`, joined to the need it points at. */
export interface NeedTag {
  id: string;
  needKey: string;
  needLabel: string;
  weight: NeedWeight;
  /** False once the village took this need back out of scope. */
  needActive?: boolean;
}

/** The long name for a tooltip, when the platform has one for this key. */
export function needTitle(tag: NeedTag): string | undefined {
  const platform = HUMAN_NEEDS_BY_ID[tag.needKey];
  return platform ? platform.formal : undefined;
}

export default function NeedChips({
  tags,
  className = "",
}: {
  tags: NeedTag[];
  /** Layout only. Colour belongs to the tokens below. */
  className?: string;
}) {
  const live = tags.filter((t) => t.needActive !== false);
  if (live.length === 0) return null;
  const primary = live.filter((t) => t.weight === "primary");
  const partial = live.filter((t) => t.weight === "partial");
  return (
    <div className={`flex flex-wrap items-center gap-2 ${className}`}>
      {primary.length > 0 && (
        <span className="text-sm text-muted-foreground">Meets:</span>
      )}
      {primary.map((t) => (
        <span
          key={t.id}
          title={needTitle(t)}
          className="inline-flex items-center px-2.5 py-1 rounded-full bg-primary/10 text-primary text-xs font-semibold"
        >
          {t.needLabel}
        </span>
      ))}
      {partial.length > 0 && (
        <span className="text-sm text-muted-foreground">Helps with:</span>
      )}
      {partial.map((t) => (
        <span
          key={t.id}
          title={needTitle(t)}
          className="inline-flex items-center px-2.5 py-1 rounded-full bg-muted text-muted-foreground text-xs font-medium"
        >
          {t.needLabel}
        </span>
      ))}
    </div>
  );
}
