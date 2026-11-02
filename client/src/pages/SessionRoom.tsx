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
 *
 * WHEN THE ROOM MOVES, it is said out loud: a polite live region, mounted for
 * as long as the room is on screen, reads "The room moved on to ...". If the
 * move took away the control somebody was on, so focus would fall to the
 * page, focus goes to the new stage's heading instead, unless they are
 * reading another stage on their own screen.
 *
 * THE ROOM IS A WORLD WHILE IT IS OPEN. The open room carries `sheet-night`
 * and `room-night` (client/src/index.css): the character sheet's night, tuned
 * to the village's own band and gold, with the sheet's slow motes drifting
 * behind it. `room-world` sits on the wrapper outside it, so the village's
 * display face is read before the night swaps its own in. The closed record
 * is a document and stays on the light linen, with neither.
 *
 * A ROOM CAN GO WHILE IT IS ON SCREEN. Its facilitator or an admin can
 * discard an open session, and an admin can delete a closed record
 * (DiscardSession). Whoever pressed it, and everybody else on their next poll
 * (`gone`, useSessionRoom), lands on the list, which says the session was
 * discarded (roomGone.ts carries that one sentence across).
 *
 * Each stage settles in as it opens, a short fade and a small rise. A member
 * who asked for less motion gets the fade alone, and the motes hold still.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useLocation, useParams } from "wouter";
import { m } from "framer-motion";
import { ArrowLeft } from "lucide-react";
import { ROOM_COPY, SESSION_COPY, SESSION_DISCARD_COPY, STAGE_DEFS, type SessionStage } from "@shared/sessions";
import Layout from "@/components/Layout";
import BreathingLoader from "@/components/natural/BreathingLoader";
import { useReducedMotion } from "@/components/natural/useReducedMotion";
import NightMotes from "@/components/profile/NightMotes";
import ModuleGate, { SignInToSee } from "@/components/modules/ModuleGate";
import { useAuth } from "@/contexts/AuthContext";
import { useModules } from "@/modules/ModuleProvider";
import ClosedRecord from "@/components/sessions/ClosedRecord";
import DiscardSession from "@/components/sessions/DiscardSession";
import FacilitatorBar from "@/components/sessions/FacilitatorBar";
import NextStepBar from "@/components/sessions/NextStepBar";
import RoomHeader from "@/components/sessions/RoomHeader";
import TemplatePanel from "@/components/sessions/TemplatePanel";
import StageActions from "@/components/sessions/StageActions";
import StageAgenda from "@/components/sessions/StageAgenda";
import StageArrival from "@/components/sessions/StageArrival";
import StageClose from "@/components/sessions/StageClose";
import StageDropIn from "@/components/sessions/StageDropIn";
import StageItems from "@/components/sessions/StageItems";
import StageRail from "@/components/sessions/StageRail";
import TensionCatcher from "@/components/sessions/TensionCatcher";
import { leaveRoomGone } from "@/components/sessions/roomGone";
import { BTN_QUIET, H2, STAGE_LEDE } from "@/components/sessions/roomUi";
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
          <Link href="/sessions" className={BTN_QUIET}>
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
  const [moved, setMoved] = useState("");
  const stageHeading = useRef<HTMLHeadingElement>(null);
  const reduced = useReducedMotion();
  const lastStage = useRef<SessionStage | null>(null);
  const { actions } = room;
  const liveStage = room.view?.status === "open" ? room.view.state.stage : null;
  const [, navigate] = useLocation();
  const left = useRef(false);
  // What the list says once this room is gone: a discarded session, or a deleted record.
  const goneSentence = room.view?.status === "closed" ? SESSION_DISCARD_COPY.deleted : SESSION_DISCARD_COPY.discarded;

  /** Leave a room that is gone for the list, once, with the sentence that says why. */
  const leave = useCallback(() => {
    if (left.current) return;
    left.current = true;
    leaveRoomGone(goneSentence);
    navigate("/sessions");
  }, [goneSentence, navigate]);

  // Somebody else discarded the room under this page: the poll found it gone.
  useEffect(() => {
    if (room.status === "gone") leave();
  }, [room.status, leave]);

  useEffect(() => {
    // No open room on screen (loading another one, or closed): the next stage seen is a first sight, not a move.
    if (liveStage == null) {
      lastStage.current = null;
      return;
    }
    const prev = lastStage.current;
    lastStage.current = liveStage;
    if (prev == null || prev === liveStage) return;
    setMoved(ROOM_COPY.roomMovedTo(STAGE_DEFS[liveStage].title));
    if (browsing != null) return;
    const at = document.activeElement;
    if (!at || at === document.body || !at.isConnected) stageHeading.current?.focus();
    // Only a move of the room runs this; `browsing` is read as it stands at that moment.
  }, [liveStage]);

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
  if (room.status === "gone") return <Notice>{goneSentence}</Notice>;
  if (room.status === "refused") return <Notice>{SESSION_COPY.closedNoAccess}</Notice>;
  if (room.status === "signed-out") return <Notice>{ROOM_COPY.signedOut}</Notice>;
  if (room.status === "failed" && !room.view) return <Notice>{ROOM_COPY.failed}</Notice>;
  if (!room.view) return <Notice busy>{ROOM_COPY.opening}</Notice>;

  const view = room.view;
  const roomStage = view.state.stage;
  const shown = browsing ?? roomStage;
  const def = STAGE_DEFS[shown];
  const stageProps = { view, now, actions };

  const open = view.status === "open";
  const discardAnswer = async () => {
    const r = await actions.discard();
    return r.ok ? ({ ok: true } as const) : ({ ok: false, error: r.error } as const);
  };
  // The facilitator and an admin, joined or not, may discard an open room; only an admin may delete a closed record.
  const discard = open && (view.me.facilitates || view.me.admin) ? <DiscardSession kind="discard" onConfirm={discardAnswer} onGone={leave} /> : null;
  const rail = <StageRail roomStage={roomStage} shown={shown} onShow={(s) => setBrowsing(s === roomStage ? null : s)} />;

  return (
    <Layout>
      <div className={open ? "room-world" : undefined}>
        <div className={open ? "relative sheet-night room-night min-h-screen bg-background" : undefined} data-room={open ? "open" : "closed"}>
          {open && <NightMotes />}
          <div className="relative container max-w-6xl py-6 md:py-10">
            <RoomHeader view={view} now={now} actions={actions} shown={shown} />
          </div>

          <div className="relative container max-w-6xl space-y-6 pb-16">
            <p className="sr-only" aria-live="polite" aria-atomic="true">
              {moved}
            </p>
            {view.status === "closed" ? (
              <ClosedRecord
                view={view}
                actions={actions}
                now={now}
                deleteRecord={view.me.admin ? <DiscardSession kind="delete" onConfirm={discardAnswer} onGone={leave} /> : null}
              />
            ) : (
              <>
                {room.lagging && (
                  <p role="status" className="rounded-xl border border-border bg-muted px-4 py-2 text-sm text-muted-foreground">
                    {ROOM_COPY.failed}
                  </p>
                )}

                {view.me.facilitates ? (
                  <FacilitatorBar view={view} actions={actions} shown={shown} onMoved={() => setBrowsing(null)} rail={rail} discard={discard} />
                ) : (
                  rail
                )}

                {!view.me.facilitates && view.me.admin && view.me.joined && view.status === "open" && (
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-muted px-4 py-2 text-sm">
                    <span className="text-muted-foreground">{ROOM_COPY.takeOverHint}</span>
                    <div className="flex flex-wrap items-center gap-2">
                      {discard}
                      <button
                        type="button"
                        className="min-h-11 rounded-xl border border-notice/55 bg-card px-3 font-medium text-foreground hover:border-notice focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        onClick={() => void actions.hosts({ facilitatorUserId: view.me.userId })}
                      >
                        {ROOM_COPY.takeOver}
                      </button>
                    </div>
                  </div>
                )}

                {/* An admin who has not joined holds no seat, and may still discard a room opened by mistake. */}
                {!view.me.facilitates && view.me.admin && !view.me.joined && view.status === "open" && <div className="flex justify-end">{discard}</div>}

                {shown !== roomStage && !view.me.facilitates && (
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-muted px-4 py-2 text-sm">
                    <span className="text-muted-foreground">{ROOM_COPY.browsing(def.short, STAGE_DEFS[roomStage].short)}</span>
                    <button type="button" onClick={() => setBrowsing(null)} className={BTN_QUIET}>
                      {ROOM_COPY.backToRoom}
                    </button>
                  </div>
                )}

                {/* A session opened from a meeting template: its flow, and what the flow asks for (shared/sessionTemplates.ts). */}
                <TemplatePanel sessionId={view.id} agenda={view.items} />

                <m.section
                  key={shown}
                  aria-labelledby="stage-title"
                  className="space-y-6"
                  initial={reduced ? { opacity: 0 } : { opacity: 0, y: 8 }}
                  animate={reduced ? { opacity: 1 } : { opacity: 1, y: 0 }}
                  transition={{ duration: 0.3 }}
                >
                  <div className="pt-2">
                    <h2 id="stage-title" ref={stageHeading} tabIndex={-1} className={`${H2} outline-none`}>
                      {def.title}
                    </h2>
                    <p className={STAGE_LEDE}>{def.lede}</p>
                  </div>

                  {shown === "dropin" && <StageDropIn {...stageProps} offset={room.offset} />}
                  {shown === "arrival" && <StageArrival {...stageProps} />}
                  {shown === "agenda" && <StageAgenda {...stageProps} />}
                  {shown === "items" && <StageItems {...stageProps} />}
                  {shown === "actions" && <StageActions {...stageProps} highlight={highlight} refusal={refusal} />}
                  {shown === "close" && <StageClose view={view} actions={actions} onRefused={onRefused} />}
                </m.section>

                {view.me.facilitates && <NextStepBar view={view} now={now} actions={actions} shown={shown} onMoved={() => setBrowsing(null)} />}

                <TensionCatcher view={view} actions={actions} />
              </>
            )}
          </div>
        </div>
      </div>
    </Layout>
  );
}
