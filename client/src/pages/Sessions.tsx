/**
 * LIVE SESSIONS, at /sessions: the front door to a circle's working calls.
 *
 * Three things on one page. The rooms open right now, to join. The closed
 * sessions this member can read (the ones they were in; an admin reads every
 * one). And a short form to open a new room: a title, which circle is
 * meeting, and how long. Opening a room or joining one moves straight into it
 * at /sessions/:id (pages/SessionRoom.tsx), and only once the server has said
 * yes.
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
 * Shapes, limits and words all come from shared/sessions.ts, the contract the
 * server reads too.
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
import Layout from "@/components/Layout";
import BreathingLoader from "@/components/natural/BreathingLoader";
import ModuleGate, { SignInToSee } from "@/components/modules/ModuleGate";
import { LIST_UI, OpenSessions, RecentSessions, type JoinState } from "@/components/sessions/SessionList";
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
  return { open: rows(b.open), recent: rows(b.recent), circles, defaultMinutes: dm };
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

  const [title, setTitle] = useState("");
  const [circleId, setCircleId] = useState("");
  const [duration, setDuration] = useState("");
  const [durationTouched, setDurationTouched] = useState(false);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  // A poll that answers after the page has gone must not set state on it.
  const alive = useRef(true);
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
        body: JSON.stringify({ title: clean, circleId: circleId || undefined, durationMin: minutes ?? undefined }),
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

  return (
    <Layout>
      <section className="bg-gradient-to-b from-teal-deep/5 to-background py-8 md:py-12">
        <div className="container max-w-5xl">
          <h1 className="font-display text-4xl font-bold text-foreground">{SESSION_COPY.listTitle}</h1>
          <p className="mt-2 max-w-2xl text-muted-foreground">{SESSION_COPY.listLede}</p>
        </div>
      </section>

      <div className="container max-w-5xl pb-16">
        <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_20rem] md:items-start">
          <div className="space-y-6">
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
                <RecentSessions rows={load.data.recent} />
              </>
            )}
          </div>

          <section aria-labelledby="sessions-start-heading" className={`${LIST_UI.card} md:sticky md:top-24`}>
            <h2 id="sessions-start-heading" className={LIST_UI.heading}>
              {SESSION_COPY.startTitle}
            </h2>
            <form className="mt-4 space-y-4" onSubmit={(e) => void onStart(e)} noValidate>
              <div>
                <label htmlFor="sessions-start-title" className={LIST_UI.label}>
                  {SESSION_LIST_COPY.titleLabel}
                </label>
                <input
                  id="sessions-start-title"
                  className={LIST_UI.input}
                  value={title}
                  maxLength={SESSION_LIMITS.title}
                  placeholder={SESSION_COPY.titlePlaceholder}
                  onChange={(e) => setTitle(e.target.value)}
                  autoComplete="off"
                />
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
              {startError && (
                <p role="alert" className="text-sm font-medium text-destructive">
                  {startError}
                </p>
              )}
              <button type="submit" className={`w-full ${LIST_UI.primary}`} disabled={starting}>
                {starting ? SESSION_LIST_COPY.opening : SESSION_COPY.startButton}
              </button>
            </form>
          </section>
        </div>
      </div>
    </Layout>
  );
}
