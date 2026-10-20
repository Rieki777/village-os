/**
 * The room's header: what this session is, which circle, under which moon and
 * season, who is facilitating, and how far into its time it is. Someone who
 * has not joined yet is offered the door here, once, at the top.
 *
 * The header holds no forward button. Beginning the session and moving the
 * room on both live in the facilitator's bar, in one slot, so the facilitator
 * never meets two primary buttons asking for the same thing.
 *
 * Each thing is said once on the screen. Drop in carries who is here in full,
 * beside the place line and the breath, so on that stage the header leaves the
 * people out; on every other stage it keeps a compact row of them, because a
 * consent round is counted against who is here.
 *
 * THE TITLE IS A DOOR. The session's name is set large in the village's
 * display face, and whoever edits the room's words (the facilitator, the note
 * taker, an admin who joined) can change it in place: a pencil beside it, or a
 * tap on the words. EditableText owns the editing and closes only once the
 * server said yes, so the heading never shows a name the room does not hold.
 *
 * THE CLOCK IS A FIGURE. "0 of 60 min" is set the way the role card sets its
 * counts, in the body face, because the display serif draws 0 as O and 1 as I
 * and a clock reads in exactly those digits. A screen reader hears the whole
 * sentence once, and the drawn figure is hidden from it.
 */
import { useState } from "react";
import { Link } from "wouter";
import { ArrowLeft } from "lucide-react";
import { ROOM_COPY, SESSION_COPY, SESSION_LIMITS, SESSION_REFUSALS, cleanLine, type SessionStage, type SessionView } from "@shared/sessions";
import Figure from "@/components/sheet/Figure";
import EditableText from "./EditableText";
import PeopleHere from "./PeopleHere";
import RoomMoon from "./RoomMoon";
import { BTN_PRIMARY, BTN_QUIET, EYEBROW, dayLabel, mayRenameSession, nameOf } from "./roomUi";
import type { RoomActions } from "./useSessionRoom";

/** The session's name: the room's largest words. */
const SESSION_TITLE = "font-display text-4xl font-normal leading-[1.08] lining-nums text-balance break-words text-foreground sm:text-6xl";

export default function RoomHeader({
  view,
  now,
  actions,
  shown,
}: {
  view: SessionView;
  now: number;
  actions: RoomActions;
  /** The stage on this screen; Drop in shows the people itself. */
  shown?: SessionStage;
}) {
  const [busy, setBusy] = useState(false);
  const open = view.status === "open";
  const started = view.state.startedAt != null;
  const elapsedMin = started ? Math.max(0, Math.floor((now - (view.state.startedAt as number)) / 60000)) : 0;
  const share = started ? Math.min(1, elapsedMin / Math.max(1, view.durationMin)) : 0;
  const facilitator = nameOf(view, view.facilitatorUserId);
  // "0 of 60 min" as a figure: the count, and the rest of the same sentence as its label.
  const clock = ROOM_COPY.clockLine(elapsedMin, view.durationMin);
  const clockRest = clock.slice(String(elapsedMin).length).trim();

  const join = async () => {
    setBusy(true);
    try {
      await actions.join();
    } finally {
      setBusy(false);
    }
  };

  const rename = async (next: string) => {
    const title = cleanLine(next, SESSION_LIMITS.title);
    // The server's own sentence for an empty title, said before the trip.
    if (!title) return { ok: false, error: SESSION_REFUSALS.titleNeeded };
    const r = await actions.patchSession({ title }, { quiet: true });
    return r.ok ? { ok: true } : { ok: false, error: r.error };
  };

  return (
    <header className="space-y-5">
      <Link href="/sessions" className={`${BTN_QUIET} -ml-2 no-underline`}>
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        {ROOM_COPY.allSessions}
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-x-8 gap-y-5">
        <div className="min-w-0 flex-1 basis-[22rem]">
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
            {view.circleName && <span className={EYEBROW}>{view.circleName}</span>}
            <RoomMoon stamp={view.stamp} />
          </p>
          <div className="mt-2">
            <EditableText
              value={view.title}
              may={mayRenameSession(view)}
              label={ROOM_COPY.sessionTitleLabel}
              max={SESSION_LIMITS.title}
              singleLine
              draftKey={`session:${view.id}:title`}
              onSave={rename}
              render={(text) => <h1 className={SESSION_TITLE}>{text}</h1>}
            />
          </div>
          {facilitator && <p className="mt-2 text-sm text-muted-foreground">{ROOM_COPY.facilitatedBy(facilitator)}</p>}
          {!open && view.closedAt && <p className="mt-1 text-sm text-muted-foreground">{ROOM_COPY.closedOn(dayLabel(view.closedAt))}</p>}
        </div>
        {open && (
          <div className="w-full sm:w-auto sm:min-w-[12rem]">
            {started ? (
              <>
                <p className="sr-only">{clock}</p>
                <dl className="flex font-body sm:justify-end" aria-hidden="true" data-room-clock="">
                  <Figure layout="seat" face="body" tone="gold" value={String(elapsedMin)} label={clockRest} />
                </dl>
                <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-muted" aria-hidden="true">
                  <div
                    className={`h-full rounded-full ${share >= 1 ? "bg-destructive" : "bg-notice"}`}
                    style={{ width: `${Math.round(share * 100)}%`, transition: "width 900ms linear" }}
                  />
                </div>
              </>
            ) : (
              <p className="max-w-xs text-sm text-muted-foreground sm:ml-auto sm:text-right">
                {view.me.facilitates ? ROOM_COPY.clockWaitingYou : ROOM_COPY.clockWaiting}
              </p>
            )}
          </div>
        )}
      </div>

      {open && shown !== "dropin" && <PeopleHere view={view} compact />}

      {open && !view.me.joined && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-notice/55 bg-card px-5 py-4">
          <p className="text-sm text-foreground">{ROOM_COPY.joinLede}</p>
          <button type="button" className={BTN_PRIMARY} disabled={busy} onClick={() => void join()}>
            {SESSION_COPY.joinButton}
          </button>
        </div>
      )}
    </header>
  );
}
