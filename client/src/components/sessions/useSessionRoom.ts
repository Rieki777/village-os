/**
 * THE ROOM, KEPT CURRENT: one live session as every screen in it sees it.
 *
 * There is no push channel to a browser in this server (server/routes/mapOrg.ts
 * says why: every route authenticates by a Bearer header and an EventSource
 * cannot send one), so the room is a versioned poll, the same shape as the
 * map's org follow (components/map/orgFollow.ts):
 *
 *   ASKS every ROOM_POLL_MS while the tab is in front of somebody, with the
 *   ETag it last saw as If-None-Match. A room where nothing moved answers 304
 *   with no body, and the view on screen stays exactly as it is.
 *
 *   PAUSED WHILE HIDDEN. A hidden tab asks nothing, and the moment it is shown
 *   again it asks once at once.
 *
 *   STOPPED BY A REFUSAL. A 401, 403 or 404 will not change on its own, so the
 *   poll stops and the page says which one it was. A network failure or a 5xx
 *   is not that: the poll carries on and catches up when the village answers,
 *   and while it does `lagging` says the room on screen may be behind.
 *
 *   GONE IS NOT MISSING. A 404 for a room this page already held means the
 *   room was discarded (or its record deleted) while it was on screen, and the
 *   status says "gone", so the page can take its reader to the list and say
 *   so. A 404 for a room that never arrived is "missing", as before.
 *
 *   QUIET ONCE CLOSED. A closed session's record stays as it was, so the poll
 *   asks nothing more once it holds one.
 *
 *   ONE CLOCK FOR THE ROOM. Every answer carries `serverNow`. The difference
 *   from this device's clock (taken at the midpoint of the round trip) is kept
 *   as an offset, so a breath, an item's timebox and the session clock read the
 *   same second on every screen however wrong a phone's own clock is. The ask
 *   goes past the browser's own cache (`no-store`): a cached answer would
 *   carry a `serverNow` from whenever it was cached and move the room's clock.
 *   The ETag this hook sends itself still gets a real 304.
 *
 *   SAYS IT IS HERE every HERE_EVERY_MS while visible and joined, which is what
 *   the room's "here now" is made of.
 *
 * EVERY WRITE READS ITS ANSWER. Each door in the contract's list is one typed
 * action here. A refusal carries the server's own sentence, which is shown as a
 * toast (unless the caller asks to say it inline itself) and returned, and
 * every write asks for the room again afterwards, so the screen shows what the
 * server now holds and never what this device hoped it would.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/** How often a closed record with a round still outliving its call is asked for again. */
const CLOSED_NIGHT_ASK_MS = 60_000;
import { toast } from "sonner";
import { gameFetch } from "@/lib/gameApi";
import {
  HERE_EVERY_MS,
  ROOM_COPY,
  ROOM_POLL_MS,
  SESSIONS_API,
  type ItemAim,
  type ItemStatus,
  type EntryKind,
  type EntryStatus,
  type ResponseTarget,
  type SessionAction,
  type SessionPatch,
  type SessionState,
  type SessionView,
} from "@shared/sessions";
import { LIBRARY_TENSION_API, type LibraryCard } from "@shared/sessionLibrary";
import { onBehalfUndoPath } from "@shared/sessionOnBehalf";
import { agendaOrderPath, itemVotePath, type AgendaVote } from "@shared/sessionVotes";
import { entryCheckPath } from "@shared/sessionCheck";

export type RoomStatus = "loading" | "ready" | "signed-out" | "refused" | "missing" | "gone" | "failed";

/** A write's answer, with the room as the server holds it afterwards. */
export type WriteResult<T = Record<string, unknown>> =
  | { ok: true; body: T; room: SessionView | null }
  | { ok: false; status: number; error: string; body: Record<string, unknown>; room: SessionView | null };

export interface ItemInput {
  title: string;
  aim: ItemAim;
  minutes: number;
  fromSessionId?: number;
}

export interface ItemPatch {
  title?: string;
  aim?: ItemAim;
  minutes?: number;
  position?: number;
  status?: ItemStatus;
}

export interface EntryInput {
  kind: EntryKind;
  text: string;
  itemId?: number | null;
  ownerSeatId?: string | null;
  dueOn?: string | null;
}

export interface EntryPatch {
  claim?: boolean;
  release?: boolean;
  ownerSeatId?: string | null;
  /** The facilitator hands an action to somebody in the room (0288). */
  ownerUserId?: number;
  text?: string;
  dueOn?: string | null;
  status?: EntryStatus;
}

export interface WriteOptions {
  /** The caller shows the refusal inline itself, so no toast. */
  quiet?: boolean;
}

export interface RoomActions {
  join(): Promise<WriteResult>;
  /** PATCH the session itself: its title, for whoever edits the room's words. */
  patchSession(patch: SessionPatch, opts?: WriteOptions): Promise<WriteResult>;
  arrival(score: number, wish: string | null): Promise<WriteResult>;
  addItem(input: ItemInput, opts?: WriteOptions): Promise<WriteResult<{ id?: number }>>;
  patchItem(itemId: number, patch: ItemPatch, opts?: WriteOptions): Promise<WriteResult>;
  addEntry(input: EntryInput, opts?: WriteOptions): Promise<WriteResult<{ id?: number }>>;
  patchEntry(entryId: number, patch: EntryPatch, opts?: WriteOptions): Promise<WriteResult>;
  deleteEntry(entryId: number, opts?: WriteOptions): Promise<WriteResult>;
  /** `answerBy` (an ISO instant) goes with a night, `sleep`, and with nothing else. */
  respond(target: ResponseTarget, value: string, text?: string | null, opts?: WriteOptions, answerBy?: string): Promise<WriteResult>;
  /** On a closed record (0281): answer a round you slept on, by your time. */
  answerNight(entryId: number, value: string, text: string | null, opts?: WriteOptions): Promise<WriteResult>;
  /** On a closed record (0281): the facilitator marks a round that consented after the call decided. */
  decideAfterNight(entryId: number, opts?: WriteOptions): Promise<WriteResult>;
  act(action: SessionAction, opts?: WriteOptions): Promise<WriteResult<{ state?: SessionState }>>;
  hosts(input: { facilitatorUserId?: number; secretaryUserId?: number | null }, opts?: WriteOptions): Promise<WriteResult>;
  close(opts?: WriteOptions): Promise<WriteResult & { unowned?: number[] }>;
  toolFeedback(text: string, opts?: WriteOptions): Promise<WriteResult>;
  /** DELETE the session: discard an open room, or delete a closed record. Never toasts; the confirm says a refusal itself. */
  discard(): Promise<WriteResult>;
  /**
   * What this viewer may bring into this open room from the agenda library
   * (shared/sessionLibrary.ts). A read, so it asks for nothing else after it;
   * null when the village did not answer.
   */
  library(): Promise<LibraryCard[] | null>;
  /** Bring items from the agenda library onto this room's agenda, all or none. */
  bringFromLibrary(ids: number[], opts?: WriteOptions): Promise<WriteResult<{ ids?: number[] }>>;
  /**
   * Send one of this room's tensions, or one from "From last time" (`sessionId`
   * is the session it was named in), to a circle's agenda items, or to none in
   * particular. The door is the agenda library's own; the room is read again
   * after it, as after every write, so it shows where the tension went.
   */
  sendTension(input: { sessionId: number; entryId: number; circleId: string | null }, opts?: WriteOptions): Promise<WriteResult<{ item?: LibraryCard }>>;
  /**
   * FILLING IN FOR SOMEBODY (0288, shared/sessionOnBehalf.ts). While the
   * facilitator has chosen a person, the arrival, a new agenda item and a new
   * entry go in as that person's (`forUserId`). Null: the writer's own. It
   * goes back to null by itself when the viewer stops facilitating or the
   * person leaves the room. Optional so a fixture that predates it still types.
   */
  fillingFor?: number | null;
  fillFor?(userId: number | null): void;
  /** Take back something filled in: the person it was for, or the facilitator who filled it in. */
  undoFill?(fillId: number, opts?: WriteOptions): Promise<WriteResult>;
  /**
   * THE ROOM VOTES ITS AGENDA (0290, shared/sessionVotes.ts). The viewer's own
   * vote on a waiting item, 0 to take it back; never for somebody else, even
   * while filling in. Optional so a fixture that predates it still types.
   */
  vote?(itemId: number, vote: AgendaVote, opts?: WriteOptions): Promise<WriteResult>;
  /** Whoever runs the room sets the voted order (true), or opens the vote again (false). */
  setOrder?(set: boolean, opts?: WriteOptions): Promise<WriteResult<{ state?: SessionState }>>;
  /** Check an open proposal (0297, shared/sessionCheck.ts): its facilitator or its proposer. Optional so older fixtures still type. */
  checkEntry?(entryId: number, opts?: WriteOptions): Promise<WriteResult>;
}

export interface SessionRoom {
  view: SessionView | null;
  status: RoomStatus;
  /** The room is on screen, and the last ask for it went unanswered: what shows may be behind. */
  lagging: boolean;
  /** The room's clock offset from this device's, in ms. */
  offset: number;
  /** Ask for the room now, ignoring the ETag. Resolves to whatever is on screen afterwards. */
  refresh(): Promise<SessionView | null>;
  actions: RoomActions;
}

/** The tab is in front of somebody. jsdom and an old engine with no API count as yes. */
export function tabVisible(): boolean {
  return typeof document === "undefined" || document.visibilityState !== "hidden";
}

/**
 * The server's own sentence out of a refusal. A bare code (`auth_required`,
 * `not_found`) is machinery and not a sentence, so it reads as the house line.
 */
export function refusalSentence(body: unknown, status: number): string {
  const b = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  for (const key of ["error", "message"]) {
    const v = b[key];
    if (typeof v === "string" && /\s/.test(v.trim())) return v.trim();
  }
  if (status === 401) return ROOM_COPY.signedOut;
  return ROOM_COPY.writeFailed;
}

const isView = (v: unknown): v is SessionView =>
  !!v && typeof v === "object" && typeof (v as SessionView).id === "number" && Array.isArray((v as SessionView).people);

export function useSessionRoom(
  id: number | null,
  { enabled = true, pollMs = ROOM_POLL_MS, hereMs = HERE_EVERY_MS }: { enabled?: boolean; pollMs?: number; hereMs?: number } = {},
): SessionRoom {
  const [view, setView] = useState<SessionView | null>(null);
  const [status, setStatus] = useState<RoomStatus>("loading");
  const [lagging, setLagging] = useState(false);
  const [offset, setOffset] = useState(0);
  const etag = useRef<string | null>(null);
  const stopped = useRef(false);
  /** The room a poll is out asking for, so polls never stack; null when none is out. */
  const asking = useRef<number | null>(null);
  /** When a closed record was last asked for, so one with a night still on it is asked again slowly. */
  const closedAskedAt = useRef(0);
  const current = useRef<SessionView | null>(null);
  /** The shortest round trip the offset was measured on: the steadiest reading wins. */
  const bestTrip = useRef(Number.POSITIVE_INFINITY);
  /**
   * Which room this page is in. It moves on every change of room and on
   * unmount, so an answer that left for an earlier room (or a page that is
   * gone) is dropped on arrival and never painted over the room on screen.
   */
  const generation = useRef(0);

  const base = id != null ? `${SESSIONS_API}/${id}` : null;

  // A new room is a new conversation: forget everything the last one said.
  useEffect(() => {
    generation.current += 1;
    etag.current = null;
    stopped.current = false;
    current.current = null;
    bestTrip.current = Number.POSITIVE_INFINITY;
    setView(null);
    setStatus("loading");
    setLagging(false);
    return () => {
      generation.current += 1;
    };
  }, [base]);

  const take = useCallback((next: SessionView) => {
    // A slow poll that left before a write can land after the write's own
    // refetch. The version only goes up, so an older answer never wins.
    const held = current.current;
    if (held && held.id === next.id && next.version < held.version) return;
    current.current = next;
    setView(next);
    setStatus("ready");
  }, []);

  const ask = useCallback(
    async (force: boolean): Promise<SessionView | null> => {
      if (!base || !enabled) return current.current;
      const mine = generation.current;
      const stale = () => mine !== generation.current;
      // A room that is on screen and stopped answering is said quietly; one
      // that never arrived is the page's whole message.
      const missed = () => {
        if (current.current) setLagging(true);
        else setStatus("failed");
        return current.current;
      };
      const sentAt = Date.now();
      try {
        const headers: Record<string, string> = {};
        if (!force && etag.current && current.current) headers["If-None-Match"] = etag.current;
        const res = await gameFetch(base, { headers, cache: "no-store" });
        if (stale()) return current.current;
        if (res.status === 304) {
          setLagging(false);
          return current.current;
        }
        if (res.status === 401 || res.status === 403 || res.status === 404) {
          stopped.current = true;
          // A room that was on screen and now is not there was discarded under this page.
          setStatus(res.status === 401 ? "signed-out" : res.status === 403 ? "refused" : current.current ? "gone" : "missing");
          return current.current;
        }
        if (!res.ok) return missed();
        const body = await res.json().catch(() => null);
        if (stale()) return current.current;
        if (!isView(body)) return missed();
        const tag = res.headers.get("ETag");
        if (tag) etag.current = tag;
        if (typeof body.serverNow === "number" && Number.isFinite(body.serverNow)) {
          // The server's clock is read at the midpoint of the round trip, so
          // the error is at most half the trip. Keep the reading taken on the
          // shortest trip, so a breath does not jump each time a slow answer
          // lands; a jump of more than a second is a clock that really moved.
          const arrived = Date.now();
          const trip = arrived - sentAt;
          const next = body.serverNow - (sentAt + arrived) / 2;
          setOffset((held) => {
            if (trip <= bestTrip.current || Math.abs(next - held) > 1000) {
              bestTrip.current = Math.min(bestTrip.current, trip);
              return next;
            }
            return held;
          });
        }
        setLagging(false);
        take(body);
        return current.current;
      } catch {
        if (stale()) return current.current;
        return missed();
      }
    },
    [base, enabled, take],
  );

  const poll = useCallback(async () => {
    // A closed session's record stays as it was, so there is nothing to ask for,
    // unless a round on it outlived the call (0281): then it is asked for once a
    // minute, so a night that ends or an answer that lands shows without a reload.
    // A poll still out for an earlier room does not hold up this one.
    if (stopped.current || asking.current === generation.current || !tabVisible()) return;
    const record = current.current;
    if (record?.status === "closed") {
      const live = record.nights?.some((n) => n.open || n.canDecide);
      if (!live || Date.now() - closedAskedAt.current < CLOSED_NIGHT_ASK_MS) return;
      closedAskedAt.current = Date.now();
    }
    const mine = generation.current;
    asking.current = mine;
    try {
      await ask(false);
    } finally {
      if (asking.current === mine) asking.current = null;
    }
  }, [ask]);

  // The first ask, then the interval, paused while hidden.
  useEffect(() => {
    if (!base || !enabled) return;
    void poll();
    const timer = window.setInterval(() => void poll(), pollMs);
    const onShow = () => {
      if (tabVisible()) void poll();
    };
    document.addEventListener("visibilitychange", onShow);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onShow);
    };
  }, [base, enabled, pollMs, poll]);

  const joined = !!view?.me.joined && view.status === "open";

  // Presence: said at once, then every hereMs while visible and joined.
  useEffect(() => {
    if (!base || !enabled || !joined) return;
    let quiet = false;
    const sayHere = async () => {
      if (quiet || stopped.current || !tabVisible()) return;
      try {
        const res = await gameFetch(`${base}/here`, { method: "POST", body: "{}" });
        // Presence is best effort and the next beat repairs a miss, but a
        // refusal will not change on its own, so it stops the beat.
        if (res.status === 401 || res.status === 403 || res.status === 404) quiet = true;
      } catch {
        /* the next beat tries again */
      }
    };
    void sayHere();
    const timer = window.setInterval(() => void sayHere(), hereMs);
    const onShow = () => {
      if (tabVisible()) void sayHere();
    };
    document.addEventListener("visibilitychange", onShow);
    return () => {
      quiet = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onShow);
    };
  }, [base, enabled, joined, hereMs]);

  const refresh = useCallback(() => ask(true), [ask]);

  // Who the facilitator is filling in for, if anybody. Kept only while it still
  // makes sense: they facilitate, and the person is in the room.
  const [fillingFor, setFillingFor] = useState<number | null>(null);
  const fillRef = useRef<number | null>(null);
  fillRef.current = fillingFor;
  const fillStillFits = !!view && view.me.facilitates && view.status === "open" && view.people.some((p) => p.userId === fillingFor);
  useEffect(() => {
    if (fillingFor != null && view && !fillStillFits) setFillingFor(null);
  }, [fillingFor, view, fillStillFits]);
  const withFor = useCallback(<P extends object>(payload: P): P | (P & { forUserId: number }) => {
    const v = current.current;
    const n = fillRef.current;
    return n != null && v?.me.facilitates && n !== v.me.userId ? { ...payload, forUserId: n } : payload;
  }, []);

  const write = useCallback(
    async <T,>(method: string, path: string, payload: unknown, opts?: WriteOptions, url?: string): Promise<WriteResult<T>> => {
      if (!base) return { ok: false, status: 0, error: ROOM_COPY.writeFailed, body: {}, room: null };
      let result: WriteResult<T>;
      try {
        const res = await gameFetch(url ?? `${base}${path}`, {
          method,
          ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
        });
        const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
        result = res.ok
          ? { ok: true, body: body as T, room: null }
          : { ok: false, status: res.status, error: refusalSentence(body, res.status), body, room: null };
      } catch {
        result = { ok: false, status: 0, error: ROOM_COPY.offline, body: {}, room: null };
      }
      if (!result.ok && !opts?.quiet) toast.error(result.error);
      // Whatever happened, show what the server now holds, and hand it back.
      result.room = await ask(true);
      return result;
    },
    [base, ask],
  );

  const actions = useMemo<RoomActions>(() => ({
    join: () => write("POST", "/join", {}),
    patchSession: (patch, opts) => write("PATCH", "", patch, opts),
    arrival: (score, wish) => write("POST", "/arrival", withFor(wish ? { score, wish } : { score })),
    addItem: (input, opts) => write("POST", "/items", withFor(input), opts),
    patchItem: (itemId, patch, opts) => write("PATCH", `/items/${itemId}`, patch, opts),
    addEntry: (input, opts) => write("POST", "/entries", withFor(input), opts),
    patchEntry: (entryId, patch, opts) => write("PATCH", `/entries/${entryId}`, patch, opts),
    deleteEntry: (entryId, opts) => write("DELETE", `/entries/${entryId}`, undefined, opts),
    respond: (target, value, text, opts, answerBy) =>
      write("POST", "/respond", { target, value, ...(text ? { text } : {}), ...(answerBy ? { answerBy } : {}) }, opts),
    answerNight: (entryId, value, text, opts) => write("POST", "/night", { entryId, value, ...(text ? { text } : {}) }, opts),
    decideAfterNight: (entryId, opts) => write("POST", `/entries/${entryId}/decide`, {}, opts),
    act: (action, opts) => write<{ state?: SessionState }>("POST", "/act", { action }, opts),
    hosts: (input, opts) => write("POST", "/hosts", input, opts),
    close: async (opts) => {
      const r = await write<Record<string, unknown>>("POST", "/close", {}, opts);
      if (r.ok) return r;
      const unowned = Array.isArray(r.body.unowned) ? (r.body.unowned as unknown[]).filter((x): x is number => typeof x === "number") : undefined;
      return { ...r, unowned };
    },
    toolFeedback: (text, opts) => write("POST", "/tool-feedback", { text }, opts),
    discard: () => write("DELETE", "", undefined, { quiet: true }),
    library: async () => {
      if (!base) return null;
      try {
        const res = await gameFetch(`${base}/library`);
        if (!res.ok) return null;
        const body = (await res.json().catch(() => null)) as { items?: unknown } | null;
        return Array.isArray(body?.items) ? (body!.items as LibraryCard[]).filter((c) => c && typeof c.id === "number" && typeof c.title === "string") : [];
      } catch {
        return null;
      }
    },
    bringFromLibrary: (ids, opts) => write<{ ids?: number[] }>("POST", "/library", { ids }, opts),
    sendTension: (input, opts) => write<{ item?: LibraryCard }>("POST", "", input, opts, LIBRARY_TENSION_API),
    fillingFor,
    fillFor: (userId) => setFillingFor(userId),
    undoFill: (fillId, opts) => write("POST", "", {}, opts, id == null ? undefined : onBehalfUndoPath(id, fillId)),
    vote: (itemId, vote, opts) => write("POST", "", { vote }, opts, id == null ? undefined : itemVotePath(id, itemId)),
    setOrder: (set, opts) => write<{ state?: SessionState }>("POST", "", { set }, opts, id == null ? undefined : agendaOrderPath(id)),
    checkEntry: (entryId, opts) => write("POST", "", {}, opts, id == null ? undefined : entryCheckPath(id, entryId)),
  }), [write, base, withFor, fillingFor, id]);

  return { view, status, lagging, offset, refresh, actions };
}

/**
 * The room's clock, ticking. Re-renders every `everyMs` and answers the room's
 * own time (this device's clock plus the offset). `everyMs` of 0 stops it.
 */
export function useRoomNow(offset: number, everyMs = 1000): number {
  const [now, setNow] = useState(() => Date.now() + offset);
  useEffect(() => {
    setNow(Date.now() + offset);
    if (!everyMs) return;
    const timer = window.setInterval(() => setNow(Date.now() + offset), everyMs);
    return () => window.clearInterval(timer);
  }, [offset, everyMs]);
  return now;
}
