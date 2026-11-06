/**
 * "Accomplished": the owner's tasks whose work was accepted, grouped by the
 * moon the work was done in, each with the day it was accepted and the note
 * the person who accepted it left. Drawn straight from `card.accomplished`
 * (shared/playerCard.ts), which the server fills from `accomplishmentsOf`'s
 * rule: the owner and an admin read every one, anybody else only the tasks
 * they may read as cards. Unread draws nothing.
 *
 * The approved design's page has no section of its own for this, so it is
 * drawn in the design's marks: a panel, the moon's dates in gold, and each
 * accomplishment in the design's goal box.
 */
import type { PlayerCard } from "@shared/playerCard";
import { SlotView } from "./cardParts";

export function AccomplishedSection({ accomplished }: { accomplished: PlayerCard["accomplished"] }) {
  if (accomplished.moons.kind === "unread") return null;
  return (
    <section aria-labelledby="pc-done-h" data-card-accomplished className="pc-panel">
      <h3 id="pc-done-h" className="pc-h2">
        {accomplished.heading}
      </h3>
      <SlotView slot={accomplished.moons}>
        {(moons) => (
          <ol className="pc-goals">
            {moons.map((m) => (
              <li key={m.startsAt} className="pc-donemoon">
                <h4>{m.label}</h4>
                <ul className="pc-goals">
                  {m.items.map((a) => (
                    <li key={a.id} className="pc-goal">
                      <b>{a.title}</b>
                      {a.roleTitle ? <span>{a.roleTitle}</span> : null}
                      <i>{a.accepted}</i>
                      {a.note ? <span>{a.note}</span> : null}
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
