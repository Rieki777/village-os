/**
 * Live Sessions, after the call: the rules of the task layer, against the
 * three tables in server/repos/sessionTasks.ts. The routes
 * (server/routes/sessionTasks.ts) read a request and call one function here;
 * the shapes, the rights and the words are shared/sessionTasks.ts, which is
 * the contract. The task emails and the due-date notes are
 * server/lib/sessionTaskMail.ts.
 *
 * ── WHAT LIVES HERE ──────────────────────────────────────────────────────
 *
 *   taskBoard       one member's board: what they hold, what their seats
 *                   hold, and what they finished.
 *   answerTask      one answer, in one transaction: the state row moves, an
 *                   event is appended, the circle's open room reads it.
 *   circleTasksFor  the "From last time" cards of an open room.
 *   taskRecord      one session's tasks as its record shows them.
 *
 * ── THE RECORD STAYS AS SAID ─────────────────────────────────────────────
 *
 * Nothing here writes `live_session_entries` or goes through the room's
 * `inRoom`, which refuses a closed session. An answer moves the state row,
 * which is the point: a task is answered weeks after its call closed.
 *
 * ── RIGHTS ARE THE CONTRACT'S, MEASURED HERE ─────────────────────────────
 *
 * Every door decides with the pure functions in the contract (`canSeeTask`,
 * `taskRights`, `mayGive`). This file only measures the `TaskViewer` they
 * read: the asker's number, their live seats (lapsed terms left out), the
 * sessions they were in, and the open rooms they host in a circle where they
 * have standing (they were in its last closed session, or sit in one of its
 * seats). A task the asker may not see answers 404, the same as a task that
 * is not there, so a refusal never says a task exists.
 *
 * ── A PERSON IS A NUMBER, AND A CARD CARRIES NAMES ───────────────────────
 *
 * The state rows hold `live_session_members` numbers. A card carries names
 * and nothing else about a person: no user id, no email, no count.
 *
 * This file and server/lib/liveSessions.ts import each other: the room's view
 * reads `circleTasksFor`, and this file reads the room's names and roles.
 * Each only calls the other's functions when a request runs, never while the
 * modules load, so the cycle is safe.
 */
import type { Pool, PoolConnection, RowDataPacket } from "mysql2/promise";
import * as repo from "../repos/liveSessions";
import * as store from "../repos/sessionTasks";
import { listOrgAssignments, listOrgRoles, type LapseContext, type OrgAssignment } from "./orgChart";
import { villageTimezone } from "./villageReaders";
import { ensureMemberNo, mapSession, maySee, memberNo, namesFor, rolesIn, type MemberLookup, type Named, type Outcome, type Refusal, type SessionRec, type Viewer } from "./liveSessions";
import { civilDateKey } from "../../shared/lunar";
import { SESSION_COPY, SESSION_REFUSALS, SESSION_SOMEONE } from "../../shared/sessions";
import {
  TASK_COPY,
  TASK_FINISHED_DAYS,
  TASK_NOTICES,
  TASK_REFUSALS,
  applyAnswer,
  canSeeTask,
  compareByDue,
  eventFor,
  isTaskEventKind,
  isTaskStatus,
  liveHoldersOf,
  liveSeatIdsFor,
  mayGive,
  parseTaskAnswer,
  taskCardFor,
  taskRights,
  validateAnswer,
  type TaskBoardPayload,
  type TaskCard,
  type TaskRecordPayload,
  type TaskState,
  type TaskViewer,
} from "../../shared/sessionTasks";

const refuse = (status: number, error: string, body?: Record<string, unknown>): Refusal => ({ ok: false, status, error, body });
const done = <T>(value: T): Outcome<T> => ({ ok: true, value });

/**
 * What the task layer needs from the routes: names, circles' names, and the
 * season's reading of who still sits in a seat. Without `lapseContext` every
 * live seating counts as current, which is the org chart's old reading.
 */
export interface TaskDeps {
  lookup: MemberLookup;
  circleName: (id: string | null) => string | null;
  lapseContext?: () => LapseContext;
  /** For the in-app notice a hand-back sends the facilitator. Absent: no notice. */
  notify?: (input: { userId: string; type: string; title: string; body?: string | null; link?: string | null; dedupeKey: string }) => Promise<unknown>;
}

/** Who is asking, before any task is read. */
export interface Asker {
  userId: string;
  admin: boolean;
}

// ── Rows, as the lib reads them ─────────────────────────────────────────────

const toIso = (v: unknown): string | null => {
  if (v == null) return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
};
const intOrNull = (v: unknown): number | null => (v == null ? null : Number.isFinite(Number(v)) ? Number(v) : null);
/** A holder's number: 0 and NULL both mean nobody. */
const holderNo = (v: unknown): number | null => {
  const n = intOrNull(v);
  return n != null && n > 0 ? n : null;
};
const seatOf = (v: unknown): string | null => (v == null || v === "" ? null : String(v));

/** The village-local YYYY-MM-DD of an instant. */
export function villageDate(at: Date | string | null | undefined, zone = villageTimezone()): string {
  const d = at instanceof Date ? at : new Date(String(at ?? ""));
  return civilDateKey(Number.isFinite(d.getTime()) ? d : new Date(), zone);
}

/** One row of `live_session_task_state`, in the contract's names. */
export function stateOf(r: RowDataPacket | Record<string, unknown>): TaskState {
  return {
    entryId: Number(r.entry_id),
    sessionId: Number(r.session_id),
    circleId: r.circle_id == null ? null : String(r.circle_id),
    status: isTaskStatus(r.status) ? r.status : "open",
    ownerNo: holderNo(r.owner_no),
    ownerSeatId: seatOf(r.owner_seat_id),
    dueOn: r.due_on == null ? null : String(r.due_on),
    latestKind: isTaskEventKind(r.latest_kind) ? r.latest_kind : "closed",
    latestNote: r.latest_note == null ? null : String(r.latest_note),
    changedByNo: Number(r.changed_by_no ?? 0) || 0,
    changedAt: toIso(r.changed_at) ?? new Date(0).toISOString(),
    doneAt: toIso(r.done_at),
    version: Number(r.version ?? 1) || 1,
  };
}

/**
 * How many emails a send put on their way, from its stored counts. Null while
 * the send is still going out: its counts are written once every email is posted.
 */
const queuedIn = (raw: unknown): number | null => {
  try {
    const c = typeof raw === "string" ? JSON.parse(raw) : raw;
    const n = c && typeof c === "object" ? Number((c as any).queued) : Number.NaN;
    return Number.isFinite(n) && (c as any).queued != null ? n : null;
  } catch {
    return null;
  }
};

/** The circle's name as the session stored it at close, when it did. */
const storedCircleName = (raw: unknown): string | null => {
  if (raw == null) return null;
  try {
    const s = typeof raw === "string" ? JSON.parse(raw) : raw;
    return s && typeof s === "object" && typeof (s as any).circleName === "string" ? (s as any).circleName : null;
  } catch {
    return null;
  }
};

// ── Who is asking, as the rights read it ────────────────────────────────────

/** The asker, measured once per request. Each task then reads its own flags off this. */
interface Seen {
  no: number | null;
  admin: boolean;
  liveSeatIds: string[];
  /** The sessions, among the ones read, the asker was in. */
  joined: Set<number>;
  /** The circles in which the asker facilitates or keeps notes for an open room. */
  hostsOpenIn: Set<string>;
}

/** Every live seating, with lapsed terms marked when the season's reading is at hand. */
async function seatingsNow(pool: Pool | PoolConnection, deps: Pick<TaskDeps, "lapseContext">): Promise<OrgAssignment[]> {
  return listOrgAssignments(pool as Pool, deps.lapseContext?.());
}

async function seenBy(
  pool: Pool | PoolConnection,
  who: { userId: string | null; no: number | null; admin: boolean },
  sessionIds: readonly number[],
  seatings: readonly OrgAssignment[],
): Promise<Seen> {
  const ids = Array.from(new Set(sessionIds));
  const joined = new Set<number>(who.no != null ? (await repo.joinedRows(pool, who.no, ids)).map((r) => Number(r.session_id)) : []);
  const liveSeatIds = who.userId ? liveSeatIdsFor(seatings, who.userId) : [];
  const hostsOpenIn = new Set<string>();
  if (who.no != null) {
    let seatCircles: Set<string> | null = null;
    for (const r of await repo.openSessionRows(pool, 50)) {
      const hosts = Number(r.facilitator_no) === who.no || (r.secretary_no != null && Number(r.secretary_no) === who.no);
      if (!hosts || !r.circle_id) continue;
      const circleId = String(r.circle_id);
      if (hostsOpenIn.has(circleId)) continue;
      // Any member may open a room in any circle, so hosting one is not enough
      // on its own. The host also needs standing there, the rule the room's
      // `carried` keeps: they were in the circle's last closed session, or they
      // sit in one of its seats now.
      const [prev] = await repo.lastClosedInCircle(pool, circleId, Number(r.id));
      if (prev && (await repo.personRow(pool, Number(prev.id), who.no)).length > 0) {
        hostsOpenIn.add(circleId);
        continue;
      }
      if (liveSeatIds.length) {
        seatCircles ??= new Set(
          (await listOrgRoles(pool as Pool)).filter((role) => role.circleId && liveSeatIds.includes(role.id)).map((role) => String(role.circleId)),
        );
        if (seatCircles.has(circleId)) hostsOpenIn.add(circleId);
      }
    }
  }
  return {
    no: who.no,
    admin: who.admin,
    liveSeatIds,
    joined,
    hostsOpenIn,
  };
}

/** The asker as the contract's rights read them, for the task on this row. */
function viewerFor(seen: Seen, r: RowDataPacket | Record<string, unknown>): TaskViewer {
  const no = seen.no != null && seen.no > 0 ? seen.no : null;
  const hostsSource = no != null && (Number(r.facilitator_no) === no || (r.secretary_no != null && Number(r.secretary_no) === no));
  return {
    no: seen.no,
    admin: seen.admin,
    liveSeatIds: seen.liveSeatIds,
    inSourceSession: seen.joined.has(Number(r.session_id)),
    hostsSource,
    hostsOpenRoomInCircle: r.circle_id != null && seen.hostsOpenIn.has(String(r.circle_id)),
  };
}

// ── Cards ───────────────────────────────────────────────────────────────────

/** Names for every number and seat the rows mention, read once. */
interface Book {
  names: Map<number, Named>;
  seatName: Map<string, string>;
  seatHolders: Map<string, string[]>;
}

async function bookFor(
  pool: Pool | PoolConnection,
  rows: readonly (RowDataPacket | Record<string, unknown>)[],
  seatings: readonly OrgAssignment[],
  lookup: MemberLookup,
): Promise<Book> {
  const nos = new Set<number>();
  const seats = new Set<string>();
  for (const r of rows) {
    const owner = holderNo(r.owner_no);
    if (owner != null) nos.add(owner);
    const by = holderNo(r.changed_by_no);
    if (by != null) nos.add(by);
    const seat = seatOf(r.owner_seat_id);
    if (seat) seats.add(seat);
  }
  const names = await namesFor(pool, nos, lookup);
  const seatName = new Map<string, string>();
  const seatHolders = new Map<string, string[]>();
  if (seats.size) {
    for (const role of await listOrgRoles(pool as Pool)) if (seats.has(role.id)) seatName.set(role.id, role.name);
    for (const seat of Array.from(seats)) {
      const holders = await Promise.all(
        liveHoldersOf(seatings, seat).map(async (userId) => {
          const m = await lookup(userId).catch(() => null);
          return m && typeof m.name === "string" && m.name.trim() ? m.name.trim() : SESSION_SOMEONE;
        }),
      );
      seatHolders.set(seat, holders);
    }
  }
  return { names, seatName, seatHolders };
}

const nameIn = (book: Book, no: number | null): string | null => (no == null ? null : (book.names.get(no)?.name ?? SESSION_SOMEONE));

const seatCard = (book: Book, seat: string | null): TaskCard["seat"] =>
  seat ? { id: seat, name: book.seatName.get(seat) ?? TASK_COPY.seatUnnamed, holders: book.seatHolders.get(seat) ?? [] } : null;

/** A task with a state row, as one asker sees it. */
function stateCard(r: RowDataPacket | Record<string, unknown>, seen: Seen, book: Book, deps: Pick<TaskDeps, "circleName">): TaskCard {
  const state = stateOf(r);
  const by = state.changedByNo > 0 ? state.changedByNo : null;
  const hosts = [Number(r.facilitator_no ?? 0), Number(r.secretary_no ?? 0)].filter((n) => n > 0);
  return taskCardFor(
    {
      state,
      text: String(r.text ?? ""),
      sessionTitle: String(r.title ?? ""),
      circleName: storedCircleName(r.summary) ?? deps.circleName(state.circleId),
      saidOn: villageDate(r.closed_at as any),
      holderName: nameIn(book, state.ownerNo),
      seat: seatCard(book, state.ownerSeatId),
      latestByName: nameIn(book, by),
      // The facilitator or the secretary answered for somebody else: the card says so.
      latestByFacilitator: by != null && by !== state.ownerNo && hosts.includes(by),
    },
    viewerFor(seen, r),
  );
}

/** An action still in an open session: no state yet, read-only, answered in the room. */
function liveCard(r: RowDataPacket | Record<string, unknown>, seen: Seen, book: Book, deps: Pick<TaskDeps, "circleName">): TaskCard {
  const ownerNo = holderNo(r.owner_no);
  const ownerSeatId = seatOf(r.owner_seat_id);
  const circleId = r.circle_id == null ? null : String(r.circle_id);
  return taskCardFor(
    {
      state: null,
      live: { entryId: Number(r.entry_id), sessionId: Number(r.session_id), circleId, ownerNo, ownerSeatId, dueOn: r.due_on == null ? null : String(r.due_on) },
      text: String(r.text ?? ""),
      sessionTitle: String(r.title ?? ""),
      circleName: deps.circleName(circleId),
      saidOn: villageDate(r.created_at as any),
      holderName: nameIn(book, ownerNo),
      seat: seatCard(book, ownerSeatId),
      latestByName: null,
      latestByFacilitator: false,
    },
    viewerFor(seen, r),
  );
}

const newestFirst = (a: TaskCard, b: TaskCard): number => Date.parse(b.latest?.at ?? "") - Date.parse(a.latest?.at ?? "") || b.entryId - a.entryId;

// ── The board ───────────────────────────────────────────────────────────────

const DAY_MS = 86_400_000;

/**
 * One member's board. Their number may be missing: a seat holder who has never
 * joined a session still sees what their seat holds. Somebody with neither a
 * number nor a seat has an empty board, read from nothing.
 *
 * `earlier` reads every finished task, the ones before the three moons too:
 * `finished` then holds them all, newest first, and `earlierCount` is 0
 * because nothing is left unread.
 */
export async function taskBoard(pool: Pool, who: Asker, deps: TaskDeps, opts: { earlier?: boolean } = {}, now = new Date()): Promise<TaskBoardPayload> {
  const today = villageDate(now);
  const earlier = opts.earlier === true;
  const no = await memberNo(pool, who.userId);
  const seatings = await seatingsNow(pool, deps);
  const seats = liveSeatIdsFor(seatings, who.userId);
  if (no == null && seats.length === 0) return { holding: [], seatsHold: [], finished: [], earlierCount: 0, today };

  const finishedSince = new Date(now.getTime() - TASK_FINISHED_DAYS * DAY_MS);
  const [rows, liveRows, earlierCount] = await Promise.all([
    store.boardRows(pool, no, seats, { finishedSince, earlier }),
    store.openSessionActionRows(pool, no, seats),
    earlier ? Promise.resolve(0) : store.boardEarlierCount(pool, no, seats, finishedSince),
  ]);
  const seen = await seenBy(pool, { userId: who.userId, no, admin: who.admin }, [...rows, ...liveRows].map((r) => Number(r.session_id)), seatings);
  const book = await bookFor(pool, [...rows, ...liveRows], seatings, deps.lookup);

  const holding: TaskCard[] = [];
  const seatsHold: TaskCard[] = [];
  const finished: TaskCard[] = [];
  const place = (card: TaskCard, seat: string | null) => {
    if (card.status !== "open") finished.push(card);
    else if (card.heldAs === "you") holding.push(card);
    else if (seat && seats.includes(seat)) seatsHold.push(card);
  };
  for (const r of rows) place(stateCard(r, seen, book, deps), seatOf(r.owner_seat_id));
  for (const r of liveRows) place(liveCard(r, seen, book, deps), seatOf(r.owner_seat_id));
  return {
    holding: holding.sort(compareByDue),
    seatsHold: seatsHold.sort(compareByDue),
    finished: finished.sort(newestFirst),
    earlierCount,
    today,
  };
}

// ── An answer ───────────────────────────────────────────────────────────────

type AnswerStep =
  | { kind: "refused"; refusal: Refusal; withCard: boolean }
  | { kind: "answered"; state: TaskState; eventId: number; facilitatorNo: number; text: string; actorNo: number };

/**
 * One answer to one task, in one transaction, never through the room:
 *
 *   1. the state row is taken (`FOR UPDATE`); no row, or a task this person
 *      may not see, answers 404
 *   2. a version other than the one stored answers 409 with the card as it
 *      stands now, so the page shows what moved
 *   3. `taskRights` and `mayGive` decide; a refusal answers 403
 *   4. `validateAnswer` decides; a refusal answers 400 with its sentence
 *   5. `applyAnswer` gives the next state; it is written, its event appended,
 *      and the circle's open rooms move their version so their next poll
 *      reads it; then the commit
 *
 * After the commit, a task handed back tells the facilitator of the session
 * it came from, once per hand-back. The fresh card comes back either way.
 *
 * Somebody answering through a seat who has never touched a session gets
 * their number here, once they have passed every check, so the answer can
 * say who gave it.
 */
export async function answerTask(pool: Pool, who: Asker, entryId: number, raw: unknown, deps: TaskDeps, now = new Date()): Promise<Outcome<{ task: TaskCard }>> {
  const answer = parseTaskAnswer(raw);
  if (!answer) return refuse(400, TASK_REFUSALS.answerShape);
  const today = villageDate(now);
  const no = await memberNo(pool, who.userId);
  const seatings = await seatingsNow(pool, deps);

  const step: AnswerStep = await repo.inTransaction(pool, async (conn): Promise<AnswerStep> => {
    const locked = await store.stateForUpdate(conn, entryId);
    const [row] = locked.length ? await store.taskRowsFor(conn, [entryId]) : [];
    if (!row) return { kind: "refused", refusal: refuse(404, TASK_REFUSALS.notFound), withCard: false };
    const current = stateOf(locked[0]);
    const seen = await seenBy(conn, { userId: who.userId, no, admin: who.admin }, [current.sessionId], seatings);
    const viewer = viewerFor(seen, row);
    if (!canSeeTask(current, viewer)) return { kind: "refused", refusal: refuse(404, TASK_REFUSALS.notFound), withCard: false };
    if (answer.version !== current.version) return { kind: "refused", refusal: refuse(409, TASK_REFUSALS.moved), withCard: true };
    if (!mayGive(answer.op, taskRights(current, viewer))) return { kind: "refused", refusal: refuse(403, TASK_REFUSALS.notYours), withCard: false };
    const problem = validateAnswer(answer, current, today);
    if (problem) return { kind: "refused", refusal: refuse(400, TASK_REFUSALS[problem]), withCard: false };

    const actorNo = no ?? (await ensureMemberNo(pool, who.userId, now));
    const next = applyAnswer(current, answer, actorNo, now);
    await store.writeState(conn, next);
    const eventId = await store.appendEvent(conn, eventFor(next, answer.op), now);
    if (next.circleId) await store.bumpOpenRooms(conn, next.circleId);
    return { kind: "answered", state: next, eventId, facilitatorNo: Number(row.facilitator_no ?? 0), text: String(row.text ?? ""), actorNo };
  });

  if (step.kind === "refused") {
    if (!step.withCard) return step.refusal;
    const card = await cardFor(pool, entryId, { userId: who.userId, no, admin: who.admin }, seatings, deps);
    return card ? refuse(409, step.refusal.error, { task: card }) : refuse(404, TASK_REFUSALS.notFound);
  }

  if (step.state.latestKind === "handed_back" && step.facilitatorNo > 0 && step.facilitatorNo !== step.actorNo && deps.notify) {
    try {
      const [fac] = await repo.memberUserIdRows(pool, [step.facilitatorNo]);
      if (fac) {
        await deps.notify({
          userId: String(fac.user_id),
          type: "session_task_back",
          title: TASK_NOTICES.back(step.text),
          link: `/sessions/${step.state.sessionId}`,
          dedupeKey: `session-task-back:${entryId}:${step.eventId}`,
        });
      }
    } catch (e) {
      console.error("[sessions] the facilitator was not told a task came back", e);
    }
  }

  const card = await cardFor(pool, entryId, { userId: who.userId, no: step.actorNo, admin: who.admin }, seatings, deps);
  return card ? done({ task: card }) : refuse(404, TASK_REFUSALS.notFound);
}

/** One task's card, as it stands now, for one asker. */
async function cardFor(
  pool: Pool,
  entryId: number,
  who: { userId: string; no: number | null; admin: boolean },
  seatings: readonly OrgAssignment[],
  deps: TaskDeps,
): Promise<TaskCard | null> {
  const [row] = await store.taskRowsFor(pool, [entryId]);
  if (!row) return null;
  const seen = await seenBy(pool, who, [Number(row.session_id)], seatings);
  return stateCard(row, seen, await bookFor(pool, [row], seatings, deps.lookup), deps);
}

// ── From last time, and one record ──────────────────────────────────────────

/** The user id behind a room viewer's number, for their seats. */
async function userIdOf(pool: Pool | PoolConnection, no: number | null): Promise<string | null> {
  if (no == null) return null;
  const [r] = await repo.memberUserIdRows(pool, [no]);
  return r ? String(r.user_id) : null;
}

/**
 * The cards an open room's "From last time" reads: every task of the circle's
 * earlier sessions that is still open, and every one answered since the
 * circle last met, kept to the ones this viewer may see (`canSeeTask`). A
 * closed session, or one with no circle, has none: its record reads
 * `taskRecord` instead.
 *
 * `lastMetAt` is the close of the circle's last session, the line the check
 * groups by. It comes only with cards, so a viewer who may see none of the
 * circle's tasks learns nothing about when it met.
 *
 * Best effort. The room is the thing a viewer came for, so a task layer that
 * cannot be read is a log line and an empty list, never a room that will not
 * open.
 */
export async function circleTasksFor(
  pool: Pool,
  s: Pick<SessionRec, "id" | "status" | "circleId">,
  viewer: Viewer,
  deps: TaskDeps,
): Promise<{ cards: TaskCard[]; lastMetAt: string | null }> {
  const none = { cards: [], lastMetAt: null };
  if (s.status !== "open" || !s.circleId) return none;
  try {
    const [prev] = await repo.lastClosedInCircle(pool, s.circleId, s.id);
    const lastMet = prev?.closed_at ? new Date(prev.closed_at) : null;
    const metAt = lastMet && Number.isFinite(lastMet.getTime()) ? lastMet : null;
    const rows = await store.circleTaskRows(pool, s.circleId, metAt);
    if (!rows.length) return none;
    const seatings = await seatingsNow(pool, deps);
    const seen = await seenBy(pool, { userId: await userIdOf(pool, viewer.no), no: viewer.no, admin: viewer.admin }, rows.map((r) => Number(r.session_id)), seatings);
    const visible = rows.filter((r) => canSeeTask(stateOf(r), viewerFor(seen, r)));
    if (!visible.length) return none;
    const book = await bookFor(pool, visible, seatings, deps.lookup);
    return { cards: visible.map((r) => stateCard(r, seen, book, deps)), lastMetAt: metAt ? metAt.toISOString() : null };
  } catch (e) {
    console.error(`[sessions] the circle's tasks could not be read for session ${s.id}`, e);
    return none;
  }
}

/**
 * One session's tasks as its record shows them, and whether this viewer may
 * send its task emails again. The record's own reading rule holds: an open
 * session is seen by any member, a closed one by the people who were in it
 * and admins. `canSend` is the closed session's facilitator, or an admin.
 */
export async function taskRecord(pool: Pool, sessionId: number, viewer: Viewer, deps: TaskDeps): Promise<Outcome<TaskRecordPayload>> {
  const rows = await repo.sessionRow(pool, sessionId);
  if (!rows.length) return refuse(404, SESSION_REFUSALS.notFound);
  const s = mapSession(rows[0]);
  const joined = viewer.no != null && (await repo.personRow(pool, sessionId, viewer.no)).length > 0;
  if (!maySee(s, joined, viewer.admin)) return refuse(403, SESSION_COPY.closedNoAccess);

  const taskRows = await store.sessionTaskRows(pool, sessionId);
  const seatings = taskRows.length ? await seatingsNow(pool, deps) : [];
  const seen = await seenBy(pool, { userId: await userIdOf(pool, viewer.no), no: viewer.no, admin: viewer.admin }, [sessionId], seatings);
  const [last] = await store.lastSend(pool, sessionId);
  const sentBy = last ? holderNo(last.sent_by_no) : null;
  const book = await bookFor(pool, sentBy != null ? [...taskRows, { changed_by_no: sentBy }] : taskRows, seatings, deps.lookup);
  return done({
    tasks: taskRows.map((r) => stateCard(r, seen, book, deps)),
    mail: {
      canSend: s.status === "closed" && rolesIn(s, viewer).runs,
      lastSend: last
        ? { sendNo: Number(last.send_no), at: toIso(last.sent_at) ?? new Date(0).toISOString(), byName: nameIn(book, sentBy), queued: queuedIn(last.counts) }
        : null,
    },
  });
}
