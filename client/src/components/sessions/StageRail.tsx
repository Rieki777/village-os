/**
 * THE STAGE RAIL: the six stages as a path of glyph nodes, the way the
 * profile's powers map draws "the climb", run across the page. Anyone can open
 * an earlier or later stage on their own screen; only the facilitator's "Move
 * the room here" moves everybody.
 *
 * Each node is a small round mark joined to the next by a hairline:
 *
 *   passed       a check, in the living green
 *   the room's   the stage's own glyph in a gold ring, softly breathing, and
 *                a "Now" badge under its name
 *   ahead        the stage's own glyph, quiet
 *
 * The glyphs are named in the shared contract as plain keys (`STAGE_DEFS[s]
 * .glyph`), so the contract carries no icon set and this file maps each key to
 * the monoline mark it draws.
 *
 * The node on this screen carries `aria-current="step"`, and every node is a
 * button whose name is the stage's name, so a screen reader walks the path by
 * name, and the room's "Now" sits under its node as plain text. The breath
 * on the room's node runs only when motion is welcome.
 *
 * Two rows of three on a phone, with the hairlines dropped, and one row of six
 * on a wider screen, so it never scrolls sideways. The facilitator's bar sets
 * its forward button at the end of this row, so on a wide screen the next step
 * reads as the next node on the path.
 */
import type { LucideIcon } from "lucide-react";
import { CheckCircle, HandHeart, ListOrdered, Moon, Sprout, Sunrise, Wind } from "lucide-react";
import { SESSION_STAGES, STAGE_DEFS, ROOM_COPY, type SessionStage, type StageGlyph } from "@shared/sessions";
import { useReducedMotion } from "@/components/natural/useReducedMotion";
import { GLYPH_STROKE, LABEL_CAPS } from "./roomUi";

const STAGE_GLYPH: Record<StageGlyph, LucideIcon> = {
  wind: Wind,
  sunrise: Sunrise,
  list: ListOrdered,
  sprout: Sprout,
  hands: HandHeart,
  moon: Moon,
};

export default function StageRail({
  roomStage,
  shown,
  onShow,
}: {
  roomStage: SessionStage;
  shown: SessionStage;
  onShow: (stage: SessionStage) => void;
}) {
  const reduced = useReducedMotion();
  const roomAt = SESSION_STAGES.indexOf(roomStage);
  return (
    <nav aria-label={ROOM_COPY.stagesLabel} className="min-w-0">
      <ol className="grid grid-cols-3 gap-y-4 sm:flex sm:items-start">
        {SESSION_STAGES.map((s, i) => {
          const isRoom = s === roomStage;
          const isShown = s === shown;
          const passed = i < roomAt;
          const Glyph = passed ? CheckCircle : STAGE_GLYPH[STAGE_DEFS[s].glyph];
          const node = isRoom
            ? `border-notice bg-notice/15 text-notice ring-1 ring-notice ${reduced ? "" : "nat-breathe"}`
            : passed
              ? "border-border bg-card text-open"
              : "border-border bg-card text-muted-foreground";
          return (
            <li key={s} className="flex min-w-0 items-start sm:flex-1 sm:last:flex-none">
              <div className="flex w-full min-w-0 flex-col items-center gap-1 sm:w-20">
                <button
                  type="button"
                  aria-current={isShown ? "step" : undefined}
                  onClick={() => onShow(s)}
                  data-stage={s}
                  data-passed={passed ? "true" : undefined}
                  className={`flex min-h-11 w-full min-w-0 flex-col items-center gap-1.5 rounded-xl px-1 py-1 text-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                    isShown ? "bg-muted" : "hover:bg-muted"
                  }`}
                >
                  <span aria-hidden="true" className={`grid size-9 place-items-center rounded-full border ${node}`}>
                    <Glyph className="size-4" strokeWidth={GLYPH_STROKE} />
                  </span>
                  <span className={`${LABEL_CAPS} ${isShown || isRoom ? "!text-foreground" : ""}`}>{STAGE_DEFS[s].short}</span>
                </button>
                {isRoom && (
                  <span className="rounded-full bg-notice/15 px-2 py-0.5 text-xs font-semibold text-notice">{ROOM_COPY.liveBadge}</span>
                )}
              </div>
              {i < SESSION_STAGES.length - 1 && <span aria-hidden="true" className="mt-[22px] hidden h-px min-w-3 flex-1 bg-border sm:block" />}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
