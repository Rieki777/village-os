/**
 * THE LIVE ROOM, at /sessions/:id: one circle holding a working call together.
 *
 * Six stages the facilitator moves the room through: drop in, arrival,
 * agenda, items, actions, close. Everyone sees the stage the room is on, and
 * can open another on their own screen; only the facilitator's choice moves
 * the room. The words, shapes and rules all come from shared/sessions.ts, the
 * contract the server reads too.
 *
 * Behind the `sessions` module and a session: members only, no guests. The
 * room is kept current by a versioned poll (components/sessions/
 * useSessionRoom.ts). A closed session shows its record, which only the people
 * who were in it and the village's admins can read; anybody else gets that
 * sentence and nothing more.
 */
import { useCallback, useState } from "react";
import { Link, useParams } from "wouter";
import { ArrowLeft } from "lucide-react";
import { ROOM_COPY, SESSION_COPY, STAGE_DEFS, type SessionStage } from "@shared/sessions";
import Layout from "@/components/Layout";
import BreathingLoader from "@/components/natural/BreathingLoader";
import ModuleGate, { SignInToSee } from "@/components/modules/ModuleGate";
import { useAuth } from "@/contexts/AuthContext";
import { useModules } from "@/modules/ModuleProvider";
import ClosedRecord from "@/components/sessions/ClosedRecord";
import FacilitatorBar from "@/components/sessions/FacilitatorBar";
import RoomHeader from "@/components/sessions/RoomHeader";
import StageActions from "@/components/sessions/StageActions";
import StageAgenda from "@/components/sessions/StageAgenda";
import StageArrival from "@/components/sessions/StageArrival";
import StageClose from "@/components/sessions/StageClose";
import StageDropIn from "@/components/sessions/StageDropIn";
import StageItems from "@/components/sessions/StageItems";
import StageRail from "@/components/sessions/StageRail";
import TensionCatcher from "@/components/sessions/TensionCatcher";
import { useRoomNow, useSessionRoom } from "@/components/sessions/useSessionRoom";

const NAME = SESSION_COPY.listTitle;

function roomId(raw: string | undefined): number | null {
  if (!raw || !/^[1-9]\d{0,9}$/.test(raw)) return null;
  return Number(raw);
}

/** A quiet card that says one thing: loading, refused, gone. Anything but loading offers the way back. */
function Notice({ children, busy = false }: { children: string; busy?: boolean }) {
  return (
    <Layout>
      <div className="container flex min-h-[50vh] max-w-xl flex-col items-center justify-center gap-4 py-12 text-center">
        {busy ? <BreathingLoader label={children} showLabel /> : <p className="text-lg text-foreground">{children}</p>}
        {!busy && (
          <Link
            href="/sessions"
            className="inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-sm font-medium text-teal-deep underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-deep"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            {ROOM_COPY.allSessions}
          </Link>
        )}
      </div>
    </Layout>
  );
}

export default function SessionRoom() {
  const params = useParams<{ id: string }>();
  const id = roomId(params.id);
  const { user } = useAuth();
  const modules = useModules();
  const on = (modules.modules ?? []).some((m) => m.id === "sessions" && m.lifecycle !== "off");
  const room = useSessionRoom(id, { enabled: modules.loaded && on && !!user && id != null });
  const now = useRoomNow(room.offset, 1000);
  const [browsing, setBrowsing] = useState<SessionStage | null>(null);
  const [highlight, setHighlight] = useState<number[]>([]);
  const [refusal, setRefusal] = useState<string | null>(null);
  const { actions } = room;

  // A refused close moves the room to the actions it named, and says why there.
  const onRefused = useCallback(
    (unowned: number[], sentence: string) => {
      setHighlight(unowned);
      setRefusal(sentence);
      setBrowsing(null);
      void actions.act({ type: "go", stage: "actions" });
    },
    [actions],
  );

  if (!modules.loaded) return <Notice busy>{ROOM_COPY.opening}</Notice>;
  if (!on) return <ModuleGate moduleId="sessions" name={NAME} />;
  if (!user) return <SignInToSee moduleId="sessions" name={NAME} />;
  if (id == null || room.status === "missing") return <Notice>{ROOM_COPY.missing}</Notice>;
  if (room.status === "refused") return <Notice>{SESSION_COPY.closedNoAccess}</Notice>;
  if (room.status === "signed-out") return <Notice>{ROOM_COPY.signedOut}</Notice>;
  if (room.status === "failed" && !room.view) return <Notice>{ROOM_COPY.failed}</Notice>;
  if (!room.view) return <Notice busy>{ROOM_COPY.opening}</Notice>;

  const view = room.view;
  const roomStage = view.state.stage;
  const shown = browsing ?? roomStage;
  const def = STAGE_DEFS[shown];
  const stageProps = { view, now, actions };

  return (
    <Layout>
      <div className="bg-gradient-to-b from-teal-deep/5 to-background">
        <div className="container max-w-5xl py-6 md:py-10">
          <RoomHeader view={view} now={now} actions={actions} />
        </div>
      </div>

      <div className="container max-w-5xl space-y-5 pb-16">
        {view.status === "closed" ? (
          <ClosedRecord view={view} />
        ) : (
          <>
            {room.lagging && (
              <p role="status" className="rounded-xl bg-muted/60 px-4 py-2 text-sm text-muted-foreground">
                {ROOM_COPY.failed}
              </p>
            )}

            <StageRail roomStage={roomStage} shown={shown} onShow={(s) => setBrowsing(s === roomStage ? null : s)} />

            {view.me.facilitates && <FacilitatorBar view={view} actions={actions} shown={shown} onMoved={() => setBrowsing(null)} />}

            {!view.me.facilitates && view.me.admin && view.me.joined && view.status === "open" && (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-muted/60 px-4 py-2 text-sm">
                <span className="text-muted-foreground">{ROOM_COPY.takeOverHint}</span>
                <button
                  type="button"
                  className="min-h-11 rounded-lg border border-border bg-card px-3 font-medium text-foreground hover:bg-muted"
                  onClick={() => void actions.hosts({ facilitatorUserId: view.me.userId })}
                >
                  {ROOM_COPY.takeOver}
                </button>
              </div>
            )}

            {shown !== roomStage && !view.me.facilitates && (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-muted/60 px-4 py-2 text-sm">
                <span className="text-muted-foreground">{ROOM_COPY.browsing(def.short, STAGE_DEFS[roomStage].short)}</span>
                <button
                  type="button"
                  onClick={() => setBrowsing(null)}
                  className="min-h-11 rounded-lg px-2 font-medium text-teal-deep underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-deep"
                >
                  {ROOM_COPY.backToRoom}
                </button>
              </div>
            )}

            <section aria-labelledby="stage-title" className="space-y-5">
              <div>
                <h2 id="stage-title" className="font-display text-2xl font-bold text-foreground sm:text-3xl">
                  {def.title}
                </h2>
                <p className="mt-1 max-w-3xl text-muted-foreground">{def.lede}</p>
              </div>

              {shown === "dropin" && <StageDropIn {...stageProps} offset={room.offset} />}
              {shown === "arrival" && <StageArrival {...stageProps} />}
              {shown === "agenda" && <StageAgenda {...stageProps} />}
              {shown === "items" && <StageItems {...stageProps} />}
              {shown === "actions" && <StageActions {...stageProps} highlight={highlight} refusal={refusal} />}
              {shown === "close" && <StageClose view={view} actions={actions} onRefused={onRefused} />}
            </section>

            <TensionCatcher view={view} actions={actions} />
          </>
        )}
      </div>
    </Layout>
  );
}
