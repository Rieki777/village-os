/**
 * BUILD THE AGENDA. From last time first (actions to check in on, the
 * backlog, parked items), then what members brought for this circle from the
 * agenda library (RoomBrought), then the agenda itself, what it asks for against the
 * time the session has left, and the consent to it, which makes the agenda the
 * circle's and not only the facilitator's.
 *
 * The consent round is this stage's one foil card: it is the moment the
 * agenda becomes the circle's, so it wears the same frame the item page and
 * the role card wear.
 */
import { ROOM_COPY, SESSION_COPY, STAGE_DEFS, agendaFit } from "@shared/sessions";
import AgendaList, { AddItem } from "./AgendaList";
import ConsentRound from "./ConsentRound";
import FromLastTime from "./FromLastTime";
import RoomBrought from "./RoomBrought";
import { CARD, H3, HERO_CONTENT, HERO_INNER, HERO_SHELL, HINT, type StageProps } from "./roomUi";

export default function StageAgenda({ view, now, actions }: StageProps) {
  const fit = agendaFit(view.items, view.durationMin, view.state.startedAt, now);
  return (
    <div className="space-y-5">
      <FromLastTime view={view} actions={actions} />

      <RoomBrought view={view} actions={actions} />

      <section className={CARD} aria-labelledby="agenda-title">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 id="agenda-title" className={H3}>
            {STAGE_DEFS.agenda.short}
          </h3>
          <p className={`text-sm tabular-nums ${fit.over ? "font-semibold text-notice" : "text-muted-foreground"}`}>
            {ROOM_COPY.agendaFitLine(fit.planned, fit.left)}
          </p>
        </div>
        {fit.over && (
          <p role="status" className="mt-2 rounded-lg border border-notice/50 bg-muted px-3 py-2 text-sm text-foreground">
            {SESSION_COPY.agendaOver}
          </p>
        )}
        <div className="mt-4">
          <AgendaList view={view} actions={actions} />
        </div>
        <div className="mt-5 border-t border-border pt-5">
          <AddItem view={view} actions={actions} />
          {!view.me.joined && <p className={HINT}>{ROOM_COPY.joinFirst}</p>}
        </div>
      </section>

      <section className={HERO_SHELL}>
        <div className={HERO_INNER}>
          <div className={HERO_CONTENT}>
            <ConsentRound
              view={view}
              actions={actions}
              now={now}
              target="agenda"
              ask={SESSION_COPY.agendaConsentAsk}
              readOnly={!view.me.joined || view.status !== "open"}
            />
          </div>
        </div>
      </section>
    </div>
  );
}
