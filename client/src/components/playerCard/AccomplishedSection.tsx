/**
 * "Accomplished": the owner's tasks whose work was accepted, grouped by the
 * moon the work was done in, each with the day it was accepted and the note
 * the person who accepted it left. Drawn straight from `card.accomplished`
 * (shared/playerCard.ts), which the server fills from `accomplishmentsOf`'s
 * rule: the owner and an admin read every one, anybody else only the tasks
 * they may read as cards. Unread draws nothing.
 *
 * Phone first: one column, the moons stacked, no row wider than the screen.
 */
import type { PlayerCard } from "@shared/playerCard";
import { BOX, H2, SECTION, SlotView } from "./cardParts";

export function AccomplishedSection({ accomplished }: { accomplished: PlayerCard["accomplished"] }) {
  if (accomplished.moons.kind === "unread") return null;
  return (
    <section aria-labelledby="pc-done-h" data-card-accomplished className={`${SECTION} grid gap-4`}>
      <h3 id="pc-done-h" className={H2}>
        {accomplished.heading}
      </h3>
      <SlotView slot={accomplished.moons}>
        {(moons) => (
          <ol className="grid gap-4">
            {moons.map((m) => (
              <li key={m.startsAt} className="grid gap-2">
                <h4 className="text-sm font-semibold text-muted-foreground">{m.label}</h4>
                <ul className="grid gap-2">
                  {m.items.map((a) => (
                    <li key={a.id} className={`${BOX} grid min-w-0 gap-0.5`}>
                      <span className="break-words font-semibold">{a.title}</span>
                      {a.roleTitle ? <span className="text-sm text-muted-foreground">{a.roleTitle}</span> : null}
                      <span className="text-sm">{a.accepted}</span>
                      {a.note ? <span className="break-words text-sm text-muted-foreground">{a.note}</span> : null}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
        )}
      </SlotView>
    </section>
  );
}
