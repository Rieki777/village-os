/**
 * THE STAGE RAIL: the six stages in order, with the one the room is on
 * marked. Anyone can open an earlier or later stage on their own screen; only
 * the facilitator's "Move the room here" moves everybody.
 *
 * Two rows of three on a phone, one row of six on a wider screen, so it never
 * scrolls sideways.
 */
import { SESSION_STAGES, STAGE_DEFS, ROOM_COPY, type SessionStage } from "@shared/sessions";

export default function StageRail({
  roomStage,
  shown,
  onShow,
}: {
  roomStage: SessionStage;
  shown: SessionStage;
  onShow: (stage: SessionStage) => void;
}) {
  const roomAt = SESSION_STAGES.indexOf(roomStage);
  return (
    <nav aria-label={ROOM_COPY.stagesLabel}>
      <ol className="grid grid-cols-3 gap-1.5 rounded-2xl bg-muted p-1.5 sm:grid-cols-6">
        {SESSION_STAGES.map((s, i) => {
          const isRoom = s === roomStage;
          const isShown = s === shown;
          return (
            <li key={s}>
              <button
                type="button"
                aria-current={isShown ? "step" : undefined}
                onClick={() => onShow(s)}
                className={`relative flex min-h-12 w-full flex-col items-center justify-center rounded-xl px-2 py-1.5 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-deep ${
                  isShown ? "bg-card text-foreground shadow-sm" : i < roomAt ? "text-muted-foreground hover:text-foreground" : "text-foreground/80 hover:text-foreground"
                }`}
              >
                <span className="flex items-center gap-1.5">
                  {isRoom && <span aria-hidden="true" className="h-2 w-2 rounded-full bg-teal-deep motion-safe:animate-pulse" />}
                  {STAGE_DEFS[s].short}
                </span>
                {isRoom && <span className="text-[11px] font-medium uppercase tracking-wide text-teal-deep">{ROOM_COPY.liveBadge}</span>}
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
