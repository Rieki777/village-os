/**
 * LIVE SESSIONS, at /sessions: the front door to a circle's working calls.
 *
 * Four things on one page. The rooms open right now, to join. What members
 * brought for a circle's next session (components/sessions/WaitingForCircle,
 * the agenda library in shared/sessionLibrary.ts). The closed sessions this
 * member can read (the ones they were in; an admin reads every one). And a
 * short form to open a new room: a title, which circle is meeting, how long,
 * and which of the brought items this session takes up (StartChecklist).
 * Opening a room or joining one moves straight into it at /sessions/:id
 * (pages/SessionRoom.tsx), and only once the server has said yes.
 *
 * COMING UP. Each circle's next meeting from its rhythm (components/sessions/
 * ComingUp, shared/sessionRhythm.ts). "Get the room ready" on a row fills the
 * start card for that meeting: its title, its circle, its length, and the
 * circle's waiting agenda items ticked. A person still opens the room.
 *
 * THE TICKS FOLLOW THE CIRCLE. A tick on an item that no longer fits (the
 * circle changed, or the list was read again and the item went elsewhere) is
 * dropped, never kept out of sight. An item that went elsewhere between the
 * read and the press refuses the open with one sentence, and the page reads
 * the list again so what it shows is what can be taken.
 *
 * Behind the `sessions` module and a session token. Members only, no guests:
 * a signed-out visitor gets the sign-in card and nothing is fetched for them.
 * Every call goes through `gameFetch`, so every call carries the member's
 * token, and every write reads `res.ok` before it claims anything.
 *
 * The list asks again every half minute while the tab is visible, and once
 * when it becomes visible again, so a room a circle-mate just opened shows up
 * without a reload. The room itself polls far faster (ROOM_POLL_MS); a list
 * of who is meeting does not need that.
 *
 * A ROOM THAT WENT. Somebody who was in a room when it was discarded, or on a
 * record when it was deleted, lands here, and the page says so once, above
 * the lists (components/sessions/roomGone.ts carries the sentence over).
 *
 * Shapes, limits and words all come from shared/sessions.ts, the contract the
 * server reads too.
 *
 * The page stays on the light linen, a document beside the room's night: the
 * title in the village's display face set large and light, each session its
 * own panel (SessionList), and the title box the room's own growing box, so a
 * long title is seen whole while it is typed.
 */
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useLocation } from "wouter";
import {
  SESSION_COPY,
  SESSION_LIMITS,
  SESSION_LIST_COPY,
  SESSION_REFUSALS,
  SESSIONS_API,
  cleanLine,
  type SessionListRow,
} from "@shared/sessions";
import { LIBRARY_COPY, LIBRARY_REFUSALS, offeredFor, type LibraryCard, type LibraryPayload } from "@shared/sessionLibrary";
import { RHYTHM_COPY, type ComingUpPayload, type ComingUpRow } from "@shared/sessionRhythm";
import Layout from "@/components/Layout";
import BreathingLoader from "@/components/natural/BreathingLoader";
import ModuleGate, { SignInToSee } from "@/components/modules/ModuleGate";
import GrowingText from "@/components/sessions/GrowingText";
import { LIST_UI, OpenSessions, RecentSessions, type JoinState } from "@/components/sessions/SessionList";
import ComingUp from "@/components/sessions/ComingUp";
import StartChecklist from "@/components/sessions/StartChecklist";
import WaitingForCircle from "@/components/sessions/WaitingForCircle";
import { clearRoomGone, peekRoomGone } from "@/components/sessions/roomGone";
import { STAGE_LEDE, STAGE_TITLE } from "@/components/sessions/roomUi";
import { useAuth } from "@/contexts/AuthContext";
import { gameFetch } from "@/lib/gameApi";
import { useModules } from "@/modules/ModuleProvider";

/** How often the list asks whether a room opened or closed, while the tab is visible. */
const LIST_POLL_MS = 30_000;

interface CircleOption {
  id: string;
  name: string;
}

/**
 * What `GET /api/sessions` answers (the Doors list in shared/sessions.ts).
 *
 * `defaultMinutes` is the village's usual length (`sessions.default_minutes`),
 * read when the server sends it. Either way the form never shows a number the
 * server would not use: with it, the field starts at the village's length and
 * sends what it shows; without it, the field starts empty under the words
 * "the village's usual length", and an empty field sends no length at all, so
 * the server applies the village's dial itself.
 */
interface ListPayload {
  open: SessionListRow[];
  recent: SessionListRow[];
  circles: CircleOption[];
  defaultMinutes: number | null;
  /** What members brought for a circle's next session. Empty from a server before the library. */
  library: LibraryPayload;
  /** Each circle's next meeting. Empty from a server before the rhythm. */
  comingUp: ComingUpPayload;
}

type LoadState =
  | { kind: "loading" }
  | { kind: "ready"; data: ListPayload }
  | { kind: "failed"; text: string }
  | { kind: "signedOut" };

const inRange = (n: number) =>
  Number.isInteger(n) && n >= SESSION_LIMITS.durationMin && n <= SESSION_LIMITS.durationMax;

/** Tolerant read: a missing or odd field reads as empty, never as a crash. */
function readPayload(body: unknown): ListPayload {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const rows = (v: unknown): SessionListRow[] =>
    Array.isArray(v) ? (v as SessionListRow[]).filter((r) => r && typeof r.id === "number" && typeof r.title === "string") : [];
  const circles = Array.isArray(b.circles)
    ? (b.circles as CircleOption[]).filter((c) => c && typeof c.id === "string" && typeof c.name === "string")
    : [];
  const dm = typeof b.defaultMinutes === "number" && inRange(b.defaultMinutes) ? b.defaultMinutes : null;
  const lib = (b.library && typeof b.library === "object" ? b.library : {}) as Record<string, unknown>;
  const library: LibraryPayload = {
    items: Array.isArray(lib.items) ? (lib.items as LibraryCard[]).filter((c) => c && typeof c.id === "number" && typeof c.title === "string") : [],
    myCircleIds: Array.isArray(lib.myCircleIds) ? (lib.myCircleIds as unknown[]).filter((id): id is string => typeof id === "string") : [],
  };
  const cu = (b.comingUp && typeof b.comingUp === "object" ? b.comingUp : {}) as Record<string, unknown>;
  const comingUp: ComingUpPayload = {
    rows: Array.isArray(cu.rows) ? (cu.rows as ComingUpRow[]).filter((r) => r && typeof r.circleId === "string" && r.next && typeof r.next.at === "string") : [],
    zone: typeof cu.zone === "string" ? cu.zone : "UTC",
    keepCircleIds: Array.isArray(cu.keepCircleIds) ? (cu.keepCircleIds as unknown[]).filter((id): id is string => typeof id === "string") : [],
  };
  return { open: rows(b.open), recent: rows(b.recent), circles, defaultMinutes: dm, library, comingUp };
}

/** The server's own sentence when it sent one (`{ error: <a sentence> }`), or the fallback. */
async function refusal(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.json()) as { error?: unknown };
    const text = typeof body?.error === "string" ? body.error.trim() : "";
    // A sentence has a space in it; a bare code like `auth_required` is for machines.
    return /\s/.test(text) ? text : fallback;
  } catch {
    return fallback;
  }
}

export default function Sessions() {
  const { user } = useAuth();
  const modules = useModules();
  const [, navigate] = useLocation();
  const on = (modules.modules ?? []).some((m) => m.id === "sessions" && m.lifecycle !== "off");
  const signedIn = !!user;

  const [load, setLoad] = useState<LoadState>({ kind: "loading" });
  const [join, setJoin] = useState<JoinState>({ joiningId: null, error: null });
  // A room that went while this member had it open: said once, on this visit.
  const [gone] = useState(peekRoomGone);
  useEffect(() => {
    clearRoomGone();
  }, []);

  const [title, setTitle] = useState("");
  const [circleId, setCircleId] = useState("");
  const [duration, setDuration] = useState("");
  const [durationTouched, setDurationTouched] = useState(false);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  // The brought items this session will take up, in the order the checklist shows them.
  const [picked, setPicked] = useState<number[]>([]);

  // A poll that answers after the page has gone must not set state on it.
  const alive = useRef(true);
  const startForm = useRef<HTMLFormElement>(null);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const fetchList = useCallback(async () => {
    let res: Response;
    try {
      res = await gameFetch(SESSIONS_API);
    } catch {
      // Offline. A list already on screen stays; a first load says so.
      if (alive.current) setLoad((prev) => (prev.kind === "ready" ? prev : { kind: "failed", text: SESSION_LIST_COPY.loadFailed }));
      return;
    }
    if (!alive.current) return;
    if (res.status === 401) {
      setLoad({ kind: "signedOut" });
      return;
    }
    if (!res.ok) {
      const text = await refusal(res, SESSION_LIST_COPY.loadFailed);
      if (alive.current) setLoad((prev) => (prev.kind === "ready" && res.status >= 500 ? prev : { kind: "failed", text }));
      return;
    }
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    if (alive.current) setLoad({ kind: "ready", data: readPayload(body) });
  }, []);

  // Ask on open, every half minute while visible, and once on coming back.
  useEffect(() => {
    if (!on || !signedIn) return;
    void fetchList();
    const tick = () => {
      if (document.visibilityState === "visible") void fetchList();
    };
    const timer = window.setInterval(tick, LIST_POLL_MS);
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [on, signedIn, fetchList]);

  // The village's usual length, once it arrives, unless the member already chose one.
  const villageMinutes = load.kind === "ready" ? load.data.defaultMinutes : null;
  useEffect(() => {
    if (villageMinutes != null && !durationTouched) setDuration(String(villageMinutes));
  }, [villageMinutes, durationTouched]);

  // A tick that no longer fits the circle chosen, or an item that went elsewhere, is dropped.
  const brought = load.kind === "ready" ? load.data.library.items : null;
  useEffect(() => {
    if (!brought) return;
    const fits = new Set(offeredFor(brought, circleId || null).map((c) => c.id));
    setPicked((prev) => (prev.every((id) => fits.has(id)) ? prev : prev.filter((id) => fits.has(id))));
  }, [brought, circleId]);

  const onJoin = useCallback(
    async (id: number) => {
      setJoin({ joiningId: id, error: null });
      let res: Response;
      try {
        res = await gameFetch(`${SESSIONS_API}/${id}/join`, { method: "POST", body: "{}" });
      } catch {
        if (alive.current) setJoin({ joiningId: null, error: { id, text: SESSION_LIST_COPY.joinFailed } });
        return;
      }
      if (!res.ok) {
        const text = res.status === 401 ? SESSION_LIST_COPY.signedOut : await refusal(res, SESSION_LIST_COPY.joinFailed);
        if (alive.current) setJoin({ joiningId: null, error: { id, text } });
        return;
      }
      if (!alive.current) return;
      setJoin({ joiningId: null, error: null });
      navigate(`/sessions/${id}`);
    },
    [navigate],
  );

  /**
   * "Get the room ready" from a meeting coming up: the start card takes that
   * meeting's title, circle and length, and the circle's own waiting agenda
   * items ticked in the checklist's order; then the card is brought into view
   * with its title box focused. Nothing is sent until the person opens it.
   */
  const getReady = (row: ComingUpRow) => {
    const day = new Date(row.next.at).toLocaleDateString(undefined, { day: "numeric", month: "long", timeZone: load.kind === "ready" ? load.data.comingUp.zone : undefined });
    setTitle(RHYTHM_COPY.roomTitle(row.circleName, day));
    setCircleId(row.circleId);
    setDuration(String(row.durationMin));
    setDurationTouched(true);
    const items = load.kind === "ready" ? load.data.library.items : [];
    setPicked(offeredFor(items, row.circleId).filter((c) => c.circleId === row.circleId).map((c) => c.id));
    setStartError(null);
    startForm.current?.closest("section")?.scrollIntoView?.({ block: "start" });
    window.requestAnimationFrame(() => document.getElementById("sessions-start-title")?.focus({ preventScroll: true }));
  };

  const onStart = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (starting) return;
    const clean = cleanLine(title, SESSION_LIMITS.title);
    if (!clean) {
      // The server's own sentence for the same refusal, said before the trip.
      setStartError(SESSION_REFUSALS.titleNeeded);
      return;
    }
    // Empty means the village's usual length, which the server fills in.
    const minutes = duration.trim() === "" ? null : Number(duration);
    if (minutes != null && !inRange(minutes)) {
      setStartError(SESSION_REFUSALS.durationRange);
      return;
    }
    setStartError(null);
    setStarting(true);
    let res: Response;
    try {
      res = await gameFetch(SESSIONS_API, {
        method: "POST",
        body: JSON.stringify({
          title: clean,
          circleId: circleId || undefined,
          durationMin: minutes ?? undefined,
          libraryIds: picked.length ? picked : undefined,
        }),
      });
    } catch {
      if (alive.current) {
        setStarting(false);
        setStartError(SESSION_LIST_COPY.startFailed);
      }
      return;
    }
    if (!res.ok) {
      const text = res.status === 401 ? SESSION_LIST_COPY.signedOut : await refusal(res, SESSION_LIST_COPY.startFailed);
      if (alive.current) {
        setStarting(false);
        setStartError(text);
      }
      // A ticked item went elsewhere a moment ago: read the list again, so the ticks left are ones that can be taken.
      if (text === LIBRARY_REFUSALS.moved) void fetchList();
      return;
    }
    let id: unknown = null;
    try {
      id = ((await res.json()) as { id?: unknown })?.id;
    } catch {
      id = null;
    }
    if (!alive.current) return;
    setStarting(false);
    if (typeof id !== "number") {
      setStartError(SESSION_LIST_COPY.startFailed);
      return;
    }
    navigate(`/sessions/${id}`);
  };

  // The catalog is still arriving: hold the shell, ask nothing yet.
  if (!modules.loaded) {
    return (
      <Layout>
        <div className="flex min-h-[50vh] items-center justify-center">
          <BreathingLoader label={SESSION_LIST_COPY.loading} />
        </div>
      </Layout>
    );
  }
  if (!on) return <ModuleGate moduleId="sessions" name={SESSION_LIST_COPY.moduleName} />;
  if (!user) return <SignInToSee moduleId="sessions" name={SESSION_LIST_COPY.moduleName} />;

  const circles = load.kind === "ready" ? load.data.circles : [];
  // The length the checklist weighs its minutes against: what the field shows, or the village's usual one.
  const typed = duration.trim() === "" ? null : Number(duration);
  const plannedLength = typed != null && inRange(typed) ? typed : villageMinutes;

  return (
    <Layout>
      <section className="py-8 md:py-12">
        <div className="container max-w-5xl">
          <h1 className={STAGE_TITLE}>{SESSION_COPY.listTitle}</h1>
          <p className={STAGE_LEDE}>{SESSION_COPY.listLede}</p>
        </div>
      </section>

      <div className="container max-w-5xl pb-16">
        <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_20rem] md:items-start">
          <div className="space-y-6">
            {gone && (
              <p role="status" className={`${LIST_UI.card} text-foreground`}>
                {gone}
              </p>
            )}
            {load.kind === "loading" && (
              <div className={`${LIST_UI.card} flex justify-center py-10`}>
                <BreathingLoader label={SESSION_LIST_COPY.loading} showLabel />
              </div>
            )}
            {load.kind === "signedOut" && (
              <p role="status" className={`${LIST_UI.card} text-foreground`}>
                {SESSION_LIST_COPY.signedOut}
              </p>
            )}
            {load.kind === "failed" && (
              <div role="alert" className={LIST_UI.card}>
                <p className="text-foreground">{load.text}</p>
                <button
                  type="button"
                  className={`mt-3 ${LIST_UI.secondary}`}
                  onClick={() => {
                    setLoad({ kind: "loading" });
                    void fetchList();
                  }}
                >
                  {SESSION_LIST_COPY.retry}
                </button>
              </div>
            )}
            {load.kind === "ready" && (
              <>
                <OpenSessions rows={load.data.open} join={join} onJoin={(id) => void onJoin(id)} />
                <ComingUp
                  comingUp={load.data.comingUp}
                  circles={load.data.circles}
                  defaultMinutes={load.data.defaultMinutes}
                  onGetReady={getReady}
                  onChanged={fetchList}
                />
                <WaitingForCircle library={load.data.library} circles={load.data.circles} onChanged={fetchList} />
                <RecentSessions rows={load.data.recent} />
              </>
            )}
          </div>

          <section
            aria-labelledby="sessions-start-heading"
            /* Sticky, and never taller than the window, so "Open the room" is always one scroll inside the card away. */
            className={`${LIST_UI.card} md:sticky md:top-24 md:max-h-[calc(100dvh-7rem)] md:overflow-y-auto`}
          >
            <h2 id="sessions-start-heading" className={LIST_UI.heading}>
              {SESSION_COPY.startTitle}
            </h2>
            <form ref={startForm} className="mt-4 space-y-4" onSubmit={(e) => void onStart(e)} noValidate>
              <div>
                <label htmlFor="sessions-start-title" className={LIST_UI.label}>
                  {SESSION_LIST_COPY.titleLabel}
                </label>
                <div className="mt-1">
                  <GrowingText
                    id="sessions-start-title"
                    value={title}
                    onValue={setTitle}
                    onSubmit={() => startForm.current?.requestSubmit()}
                    label={SESSION_COPY.titlePlaceholder}
                    max={SESSION_LIMITS.title}
                    minRows={1}
                    singleLine
                  />
                </div>
              </div>
              <div>
                <label htmlFor="sessions-start-circle" className={LIST_UI.label}>
                  {SESSION_COPY.circleLabel}
                </label>
                <select
                  id="sessions-start-circle"
                  className={LIST_UI.input}
                  value={circleId}
                  onChange={(e) => setCircleId(e.target.value)}
                >
                  <option value="">{SESSION_COPY.noCircle}</option>
                  {circles.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="sessions-start-duration" className={LIST_UI.label}>
                  {SESSION_COPY.durationLabel}
                </label>
                <input
                  id="sessions-start-duration"
                  className={LIST_UI.input}
                  type="number"
                  inputMode="numeric"
                  min={SESSION_LIMITS.durationMin}
                  max={SESSION_LIMITS.durationMax}
                  placeholder={SESSION_LIST_COPY.usualLength}
                  value={duration}
                  onChange={(e) => {
                    setDurationTouched(true);
                    setDuration(e.target.value);
                  }}
                />
              </div>
              {brought && (
                <StartChecklist
                  items={brought}
                  circleId={circleId || null}
                  circleName={circles.find((c) => c.id === circleId)?.name ?? null}
                  picked={picked}
                  onPicked={setPicked}
                  durationMin={plannedLength}
                />
              )}
              {startError && (
                <p role="alert" className="text-sm font-medium text-destructive">
                  {startError}
                </p>
              )}
              <button type="submit" className={`w-full ${LIST_UI.primary}`} disabled={starting}>
                {starting ? SESSION_LIST_COPY.opening : picked.length ? LIBRARY_COPY.startWith(picked.length) : SESSION_COPY.startButton}
              </button>
            </form>
          </section>
        </div>
      </div>
    </Layout>
  );
}
