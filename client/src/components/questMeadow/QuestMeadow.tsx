/**
 * THE QUEST MEADOW (Phase C, decision 5): the whole board as one field, a
 * bed per circle, each quest a seed, a bud or a flower.
 *
 * Phone and desktop, each at its best (docs/DESIGN_RULE.md):
 *   - On a phone the beds are one band that runs off the screen's edge, a
 *     swipe from circle to circle. A tap chooses a plant, and the panel under
 *     the band shows it, with the one act within the thumb's reach.
 *   - On a desktop the beds lie side by side in a wide field beside a panel
 *     that stays. Hovering a plant names it under its bed; the arrow keys walk
 *     the meadow plant by plant, and Enter opens the chosen quest.
 *
 * Every plant is a real button with a 44px box (a thumb apart, by
 * `bedLayout`), named by its quest, its circle and its state. One plant is
 * in the tab order at a time (a roving tab stop), so the meadow is one stop
 * for the keyboard however many quests it holds.
 *
 * What the meadow never does: count anyone, name who carried what, or order a
 * bed by anything but the board's own order. The plants describe the work.
 */
import { useRef, useState, type KeyboardEvent } from "react";
import { useLingui } from "@lingui/react/macro";
import {
  bedLayout,
  meadowOrder,
  PLANT_STATES,
  stepThrough,
  type MeadowBed,
} from "@/lib/questMeadow";
import { PlantGlyph, PlantShape } from "./Plant";
import { usePlantWords } from "./plantWords";

/** The space each plant keeps: a thumb's width (rule 8, the 44px floor). */
export const PLANT_GAP = 48;
const PLANT_SCALE = 1.55;
const TARGET = 44;

export interface QuestMeadowProps {
  beds: MeadowBed[];
  /** The plant the panel shows. */
  selectedId: string | null;
  onSelect: (questId: string) => void;
  /** Enter on a plant: go to the quest's own page. */
  onOpen: (questId: string) => void;
  className?: string;
}

export default function QuestMeadow({ beds, selectedId, onSelect, onOpen, className = "" }: QuestMeadowProps) {
  const { t } = useLingui();
  const words = usePlantWords();
  const order = meadowOrder(beds);
  const tabStop = order.some((p) => p.quest.id === selectedId) ? selectedId : order[0]?.quest.id ?? null;
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const [hovered, setHovered] = useState<string | null>(null);
  const looseName = t({ message: "Open to every circle", context: "quest meadow: the bed for quests with no circle" });

  const onKey = (e: KeyboardEvent<HTMLButtonElement>, id: string) => {
    if (e.key === "Enter") {
      e.preventDefault();
      onOpen(id);
      return;
    }
    const next = stepThrough(order, id, e.key);
    if (!next) return;
    e.preventDefault();
    onSelect(next);
    buttons.current.get(next)?.focus();
  };

  if (!order.length) return null;

  return (
    <div className={className}>
      <div
        role="group"
        aria-label={t({ message: "The meadow: every quest, one bed per circle", context: "quest meadow, the field" })}
        data-scroll-contain
        className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-3 sm:mx-0 sm:px-0 lg:flex-wrap lg:overflow-visible lg:pb-0"
      >
        {beds.map((bed) => {
          const layout = bedLayout(bed.plants.length, PLANT_GAP);
          const name = bed.circle ?? looseName;
          const named = bed.plants.find((p) => p.quest.id === hovered);
          return (
            <figure
              key={bed.circle ?? ""}
              data-bed={name}
              className="flex shrink-0 snap-start flex-col items-center rounded-2xl border border-border/60 bg-muted/40 px-2 pt-2 pb-3"
            >
              <div className="relative" style={{ width: layout.width, height: layout.height }}>
                <svg
                  width={layout.width}
                  height={layout.height}
                  viewBox={`0 0 ${layout.width} ${layout.height}`}
                  aria-hidden="true"
                  focusable="false"
                  className="absolute inset-0"
                >
                  <ellipse
                    className="text-open"
                    cx={layout.width / 2}
                    cy={layout.height / 2 + 6}
                    rx={layout.width / 2 - 4}
                    ry={layout.height / 2 - 8}
                    fill="currentColor"
                    fillOpacity={0.07}
                    stroke="currentColor"
                    strokeOpacity={0.22}
                  />
                  {bed.plants.map((p, i) => {
                    const at = layout.spots[i];
                    const lifted = hovered === p.quest.id || selectedId === p.quest.id;
                    return (
                      <g key={p.quest.id} transform={`translate(${at.x.toFixed(1)} ${(at.y + 12).toFixed(1)})`}>
                        {selectedId === p.quest.id && (
                          <ellipse className="text-notice" cx={0} cy={1} rx={15} ry={4.5} fill="currentColor" fillOpacity={0.25} />
                        )}
                        <g
                          className="transition-transform duration-500 motion-reduce:transition-none"
                          style={{ transform: lifted ? "translateY(-3px)" : undefined }}
                        >
                          <PlantShape state={p.state} scale={PLANT_SCALE} />
                        </g>
                      </g>
                    );
                  })}
                </svg>
                {bed.plants.map((p, i) => {
                  const at = layout.spots[i];
                  const id = p.quest.id;
                  const title = p.quest.title;
                  const state = words[p.state].long;
                  return (
                    <button
                      key={id}
                      ref={(el) => {
                        if (el) buttons.current.set(id, el);
                        else buttons.current.delete(id);
                      }}
                      type="button"
                      data-quest={id}
                      data-plant={p.state}
                      tabIndex={id === tabStop ? 0 : -1}
                      aria-pressed={id === selectedId}
                      aria-label={t({
                        message: `${title}, ${name}. ${state}`,
                        context: "quest meadow: one plant, named by its quest, its circle and its state",
                      })}
                      onClick={() => onSelect(id)}
                      onKeyDown={(e) => onKey(e, id)}
                      onMouseEnter={() => setHovered(id)}
                      onMouseLeave={() => setHovered((h) => (h === id ? null : h))}
                      onFocus={() => setHovered(id)}
                      onBlur={() => setHovered((h) => (h === id ? null : h))}
                      className="absolute rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      style={{ left: at.x - TARGET / 2, top: at.y - TARGET / 2, width: TARGET, height: TARGET }}
                    />
                  );
                })}
              </div>
              {/* The bed's name; a hovered or focused plant names itself here instead. */}
              <figcaption
                className={`mt-1 max-w-[14rem] text-center text-xs leading-snug ${named ? "text-foreground" : "text-muted-foreground"}`}
                style={{ minWidth: Math.min(layout.width, 160) }}
              >
                {named ? named.quest.title : name}
              </figcaption>
            </figure>
          );
        })}
      </div>

      <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground" aria-label={t({ message: "What the plants mean", context: "quest meadow legend" })}>
        {PLANT_STATES.map((s) => (
          <li key={s} className="inline-flex items-center gap-1.5">
            <PlantGlyph state={s} className="size-5" />
            {words[s].long}
          </li>
        ))}
      </ul>
    </div>
  );
}
