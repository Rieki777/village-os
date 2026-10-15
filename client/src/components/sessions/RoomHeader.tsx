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
 */
import { useState } from "react";
import { Link } from "wouter";
import { ArrowLeft } from "lucide-react";
import { ROOM_COPY, SESSION_COPY, type SessionStage, type SessionView } from "@shared/sessions";
import PeopleHere from "./PeopleHere";
import RoomMoon from "./RoomMoon";
import { BTN_PRIMARY, BTN_QUIET, CHIP, dayLabel, nameOf } from "./roomUi";
import type { RoomActions } from "./useSessionRoom";

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

  const join = async () => {
    setBusy(true);
    try {
      await actions.join();
    } finally {
      setBusy(false);
    }
  };

  return (
    <header className="space-y-4">
      <Link href="/sessions" className={`${BTN_QUIET} -ml-2 no-underline`}>
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        {ROOM_COPY.allSessions}
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            {view.circleName && <span className={CHIP}>{view.circleName}</span>}
            <RoomMoon stamp={view.stamp} />
          </p>
          <h1 className="mt-1 font-display text-3xl font-bold text-foreground sm:text-4xl">{view.title}</h1>
          {facilitator && <p className="mt-1 text-sm text-muted-foreground">{ROOM_COPY.facilitatedBy(facilitator)}</p>}
          {!open && view.closedAt && <p className="mt-1 text-sm text-muted-foreground">{ROOM_COPY.closedOn(dayLabel(view.closedAt))}</p>}
        </div>
        {open && (
          <div className="w-full sm:w-auto sm:min-w-[12rem] sm:text-right">
            {started ? (
              <>
                <p className="font-display text-2xl font-bold tabular-nums text-foreground">
                  {ROOM_COPY.clockLine(elapsedMin, view.durationMin)}
                </p>
                <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted" aria-hidden="true">
                  <div
                    className={`h-full rounded-full ${share >= 1 ? "bg-coral" : share >= 0.8 ? "bg-notice" : "bg-teal-deep"}`}
                    style={{ width: `${Math.round(share * 100)}%`, transition: "width 900ms linear" }}
                  />
                </div>
              </>
            ) : (
              <p className="max-w-xs text-sm text-muted-foreground sm:ml-auto">
                {view.me.facilitates ? ROOM_COPY.clockWaitingYou : ROOM_COPY.clockWaiting}
              </p>
            )}
          </div>
        )}
      </div>

      {open && shown !== "dropin" && <PeopleHere view={view} compact />}

      {open && !view.me.joined && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-teal-deep/30 bg-teal-deep/5 px-5 py-4">
          <p className="text-sm text-foreground">{ROOM_COPY.joinLede}</p>
          <button type="button" className={BTN_PRIMARY} disabled={busy} onClick={() => void join()}>
            {SESSION_COPY.joinButton}
          </button>
        </div>
      )}
    </header>
  );
}
