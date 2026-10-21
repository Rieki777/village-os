/**
 * Live Sessions, before the call: the rules of the agenda library, against the
 * two tables in server/repos/sessionLibrary.ts. The doors that only touch an
 * item are server/routes/sessionLibrary.ts; opening a room with items, bringing
 * one into an open room, the close and the discard run inside the room's own
 * transactions in server/lib/liveSessions.ts, which calls the functions here.
 * The shapes, the rights and the words are shared/sessionLibrary.ts, the
 * contract.
 *
 * ── WHAT LIVES HERE ──────────────────────────────────────────────────────
 *
 *   libraryViewer      the asker as the contract's rights read them: their
 *                      number, and the circles they have standing in and host.
 *   libraryFor         the list on /sessions.
 *   bringItem, changeItem, withdrawItem, bringItemAgain   one item's doors.
 *   roomLibrary        what one viewer may bring into one open room.
 *   lockForTaking, writeTakes                             a take, inside the
 *                      caller's transaction, after the session row.
 *   settleForClose     what a close does to the items it took.
 *   releaseForDiscard  what removing a session does to them.
 *   reconcileLibrary   mends items a session left on its agenda without
 *                      settling them (a release from before the library).
 *   broughtByItem, libraryItemIdsFor   what the room's view reads.
 *   exportLibraryFor, forgetLibraryFor  the member's own.
 *
 * ── STANDING IS THE TASK LAYER'S RULE, FOR EVERY CIRCLE AT ONCE ──────────
 *
 * A member has standing in a circle when they were in its last closed session,
 * or sit in one of its seats now: a seating live and not lapsed, in a seat that
 * is active and not a standing example (the task layer's measure in
 * server/lib/sessionTasks.ts, which asks it of one circle at a time, and
 * `seatBook`'s reading of a live seat). The list asks it of every circle in one
 * read (`lastClosedPerCircle`), one step tighter (`libraryViewer` says why).
 *
 * ── EVERY REFUSAL COMES BEFORE THE FIRST WRITE ───────────────────────────
 *
 * The room's transactions commit whenever their work returns, a refusal
 * included (server/repos/liveSessions.ts `inTransaction`). So a take locks and
 * checks every item it was asked for, all or none, before it writes one row.
 *
 * ── A PERSON IS A NUMBER, AND A CARD CARRIES NAMES ───────────────────────
 *
 * The rows hold `live_session_members` numbers. A card carries names and
 * nothing else about a person.
 *
 * This file and server/lib/liveSessions.ts import each other, the way
 * server/lib/sessionTasks.ts does: each calls the other only while a request
 * runs, never while the modules load.
 */
import type { Pool, PoolConnection, RowDataPacket } from "mysql2/promise";
import * as room from "../repos/liveSessions";
import * as store from "../repos/sessionLibrary";
import { listOrgAssignments, listOrgRoles, type LapseContext } from "./orgChart";
import { ensureMemberNo, memberNo, namesFor, type MemberLookup, type Outcome, type Refusal } from "./liveSessions";
import { SESSION_SOMEONE, isItemAim, type ItemAim } from "../../shared/sessions";
import { liveSeatIdsFor } from "../../shared/sessionTasks";
import {
  LIBRARY_LIMITS,
  LIBRARY_MINUTES,
  LIBRARY_NOTICES,
  LIBRARY_REFUSALS,
  agendaAimFor,
  broughtLink,
  broughtRights,
  canSeeBrought,
  cleanBrought,
  cleanBroughtPatch,
  isLibraryStatus,
  mayTakeInto,
  planTakes,
  type LibraryCard,
  type LibraryPayload,
  type LibrarySubject,
  type LibraryViewer,
} from "../../shared/sessionLibrary";

const refuse = (status: number, error: string): Refusal => ({ ok: false, status, error });
const done = <T>(value: T): Outcome<T> => ({ ok: true, value });

const toIso = (v: unknown): string | null => {
  if (v == null) return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
};

/** What the rules need from the routes: names, circles' names, and whose seat terms still run. */
export interface LibraryDeps {
  lookup: MemberLookup;
  circleName: (id: string | null) => string | null;
  lapseContext?: () => LapseContext;
}

/** Who is asking, before the rights are measured. */
export interface LibraryAsker {
  userId: string;
  admin: boolean;
}

// ── Rows, as the lib reads them ─────────────────────────────────────────────

export interface LibraryRec extends LibrarySubject {
  id: number;
  title: string;
  aim: ItemAim | null;
  note: string | null;
  /** Who wrote the note as it stands, when that was not whoever brought it. */
  noteByNo: number | null;
  sessionId: number | null;
  sessionItemId: number | null;
  editedByNo: number | null;
  createdAt: string;
  settledAt: string | null;
}

export function mapLibrary(r: RowDataPacket | Record<string, unknown>): LibraryRec {
  return {
    id: Number(r.id),
    circleId: r.circle_id == null ? null : String(r.circle_id),
    title: String(r.title ?? ""),
    aim: isItemAim(r.aim) ? r.aim : null,
    note: r.note == null || r.note === "" ? null : String(r.note),
    noteByNo: r.note_by_no == null ? null : Number(r.note_by_no),
    broughtByNo: Number(r.brought_by_no),
    status: isLibraryStatus(r.status) ? r.status : "waiting",
    sessionId: r.session_id == null ? null : Number(r.session_id),
    sessionItemId: r.session_item_id == null ? null : Number(r.session_item_id),
    editedByNo: r.edited_by_no == null ? null : Number(r.edited_by_no),
    createdAt: toIso(r.created_at) ?? new Date(0).toISOString(),
    settledAt: toIso(r.settled_at),
  };
}

// ── Standing ────────────────────────────────────────────────────────────────

/**
 * The asker as the contract's rights read them. Admins see everything, so
 * their standing is not measured. `hostsIn` is the circles of the open
 * sessions they facilitate or keep notes for, where they also have standing.
 *
 * ONE STEP TIGHTER THAN THE TASK LAYER, on purpose: the circle's last closed
 * session counts only when at least two people were in it
 * (`lastClosedPerCircle`). Any member may open a room for any circle and
 * close it alone, and under the plain rule that one close would hand them
 * every waiting item of the circle, with the words of the people who brought
 * them, and take the list from everybody who was at the circle's last real
 * meeting. The task layer reads only task cards through the same rule; whether
 * it should take the same step is the founder's to say.
 */
export async function libraryViewer(
  pool: Pool | PoolConnection,
  who: { userId: string | null; no: number | null; admin: boolean },
  deps: Pick<LibraryDeps, "lapseContext">,
): Promise<LibraryViewer> {
  const standing = new Set<string>();
  const hostsIn = new Set<string>();
  if (who.admin) return { no: who.no, admin: true, standing, hostsIn };
  if (who.userId) {
    const seats = liveSeatIdsFor(await listOrgAssignments(pool as Pool, deps.lapseContext?.()), who.userId);
    if (seats.length) {
      // A rested seat, or a standing example, puts nobody in its circle.
      for (const role of await listOrgRoles(pool as Pool)) {
        if (role.circleId && role.active && !role.isExample && seats.includes(role.id)) standing.add(String(role.circleId));
      }
    }
  }
  if (who.no != null && who.no > 0) {
    const last = await store.lastClosedPerCircle(pool);
    const circleOf = new Map(last.map((r) => [Number(r.id), String(r.circle_id)]));
    for (const r of await room.joinedRows(pool, who.no, Array.from(circleOf.keys()))) {
      const circleId = circleOf.get(Number(r.session_id));
      if (circleId) standing.add(circleId);
    }
    for (const r of await room.openSessionRows(pool, 50)) {
      const hosts = Number(r.facilitator_no) === who.no || (r.secretary_no != null && Number(r.secretary_no) === who.no);
      if (hosts && r.circle_id != null && standing.has(String(r.circle_id))) hostsIn.add(String(r.circle_id));
    }
  }
  return { no: who.no, admin: false, standing, hostsIn };
}

// ── Cards ───────────────────────────────────────────────────────────────────

async function cardsFor(pool: Pool, recs: readonly LibraryRec[], viewer: LibraryViewer, deps: LibraryDeps): Promise<LibraryCard[]> {
  if (!recs.length) return [];
  const nos = new Set<number>();
  for (const r of recs) {
    nos.add(r.broughtByNo);
    if (r.editedByNo != null) nos.add(r.editedByNo);
  }
  const names = await namesFor(pool, nos, deps.lookup);
  const sessionIds = Array.from(new Set(recs.map((r) => r.sessionId).filter((id): id is number => id != null)));
  const sessions = new Map((await store.sessionTitleRows(pool, sessionIds)).map((r) => [Number(r.id), { title: String(r.title ?? ""), open: String(r.status) === "open" }]));
  const closedIds = sessionIds.filter((id) => sessions.get(id) && !sessions.get(id)!.open);
  const joined = new Set<number>(
    viewer.no != null && viewer.no > 0 && !viewer.admin ? (await room.joinedRows(pool, viewer.no, closedIds)).map((r) => Number(r.session_id)) : [],
  );
  // How each waiting item last left a session: only a `back` there means it came back on its own.
  const backAt = new Map<number, string | null>();
  for (const t of await store.settledTakeRows(pool, recs.filter((r) => r.status === "waiting").map((r) => r.id))) {
    const id = Number(t.library_id);
    if (!backAt.has(id)) backAt.set(id, String(t.outcome) === "back" ? toIso(t.settled_at) : null);
  }
  return recs.map((r) => {
    const s = r.sessionId != null ? sessions.get(r.sessionId) : undefined;
    // An open room is read by every member; a closed record by its people and admins.
    const readable = !!s && (s.open || viewer.admin || joined.has(r.sessionId!));
    const rights = broughtRights(r, viewer);
    const mine = viewer.no != null && viewer.no > 0 && r.broughtByNo === viewer.no;
    return {
      id: r.id,
      title: r.title,
      aim: r.aim,
      note: r.note,
      circleId: r.circleId,
      circleName: deps.circleName(r.circleId),
      broughtBy: names.get(r.broughtByNo)?.name ?? SESSION_SOMEONE,
      mine,
      broughtAt: r.createdAt,
      status: r.status,
      session: s && readable && r.sessionId != null ? { id: r.sessionId, title: s.title, open: s.open } : null,
      settledAt: r.settledAt,
      backAt: r.status === "waiting" ? (backAt.get(r.id) ?? null) : null,
      changedBy: r.editedByNo != null && r.editedByNo !== r.broughtByNo ? (names.get(r.editedByNo)?.name ?? SESSION_SOMEONE) : null,
      canEdit: rights.words && r.status === "waiting",
      canMoveCircle: rights.circle && r.status === "waiting",
      canWithdraw: rights.withdraw,
      canBringAgain: rights.bringAgain && r.status === "taken_up",
    };
  });
}

/** How many items the list reads at most. A village with more waiting than this has a different problem. */
const LIVE_LIMIT = 500;

/** The list on /sessions: what waits, what sits on an open agenda, and what was taken up lately, as this viewer may see it. */
export async function libraryFor(pool: Pool, who: LibraryAsker, deps: LibraryDeps, now = new Date()): Promise<LibraryPayload> {
  const no = await memberNo(pool, who.userId);
  const viewer = await libraryViewer(pool, { userId: who.userId, no, admin: who.admin }, deps);
  const since = new Date(now.getTime() - LIBRARY_LIMITS.takenUpDays * 24 * 60 * 60 * 1000);
  const live = (await store.liveRows(pool, { admin: viewer.admin, no, standing: Array.from(viewer.standing), limit: LIVE_LIMIT })).map(mapLibrary);
  const up = (await store.takenUpRows(pool, { admin: viewer.admin, no, since, limit: LIBRARY_LIMITS.takenUpShown })).map(mapLibrary);
  // The SQL already asked who may see each row; the contract's rule says it again, so a change to one is caught by the other.
  const items = await cardsFor(pool, [...live.filter((r) => canSeeBrought(r, viewer)), ...up], viewer, deps);
  return { items, myCircleIds: Array.from(viewer.standing).sort() };
}

// ── One item's doors ────────────────────────────────────────────────────────

/**
 * The item, if the asker may see it. A hidden item reads the same as a missing
 * one. The list's rule for what a session took up holds here too: a taken-up
 * item reaches whoever brought it, admins, and the people who were in the
 * session that took it up (`takenUpRows`), so no door hands its card to
 * anybody else.
 */
async function visible(q: Pool | PoolConnection, id: number, viewer: LibraryViewer, lock = false): Promise<LibraryRec | null> {
  const rows = await store.itemRow(q, id, lock);
  if (!rows.length) return null;
  const rec = mapLibrary(rows[0]);
  if (!canSeeBrought(rec, viewer)) return null;
  if (rec.status !== "taken_up" || viewer.admin) return rec;
  if (viewer.no != null && viewer.no > 0 && rec.broughtByNo === viewer.no) return rec;
  const was = viewer.no != null && viewer.no > 0 && rec.sessionId != null && (await room.personRow(q, rec.sessionId, viewer.no)).length > 0;
  return was ? rec : null;
}

async function oneCard(pool: Pool, id: number, viewer: LibraryViewer, deps: LibraryDeps): Promise<LibraryCard | null> {
  const rec = await visible(pool, id, viewer);
  return rec ? ((await cardsFor(pool, [rec], viewer, deps))[0] ?? null) : null;
}

/** Bring an item. Any admitted member, for any live circle or none; they always see their own. */
export async function bringItem(
  pool: Pool,
  who: LibraryAsker,
  raw: unknown,
  circleIds: ReadonlySet<string>,
  deps: LibraryDeps,
  now = new Date(),
): Promise<Outcome<{ item: LibraryCard }>> {
  const input = cleanBrought(raw, circleIds);
  if (!input.ok) return refuse(input.status, input.error);
  const no = await ensureMemberNo(pool, who.userId, now);
  if ((await store.waitingCountBy(pool, no)) >= LIBRARY_LIMITS.waitingPerMember) return refuse(409, LIBRARY_REFUSALS.tooManyWaiting);
  const id = await store.insertItemRow(pool, { ...input.value, broughtByNo: no, now });
  const viewer = await libraryViewer(pool, { userId: who.userId, no, admin: who.admin }, deps);
  const item = await oneCard(pool, id, viewer, deps);
  if (!item) throw new Error("live sessions: an item just brought could not be read back");
  return done({ item });
}

/**
 * Change a waiting item. Refused in this order, so a refusal never says an
 * item exists: a body that does not read (400), an item the asker may not see
 * (404), a change they have no right to (403), an item that no longer waits
 * (409). A field sent with the value it already has asks for no right, and a
 * change that moves nothing is a quiet yes.
 *
 * The row is locked and read inside the transaction that writes it, so the
 * rights are measured against the item as it is and a field this change does
 * not touch keeps whatever another change just wrote: a host's new title can
 * never put back a circle the bringer had just moved it out of.
 */
export async function changeItem(
  pool: Pool,
  who: LibraryAsker,
  id: number,
  raw: unknown,
  circleIds: ReadonlySet<string>,
  deps: LibraryDeps,
  now = new Date(),
): Promise<Outcome<{ item: LibraryCard }>> {
  const patch = cleanBroughtPatch(raw, circleIds);
  if (!patch.ok) return refuse(patch.status, patch.error);
  const known = await memberNo(pool, who.userId);
  const viewer = await libraryViewer(pool, { userId: who.userId, no: known, admin: who.admin }, deps);
  const out = await room.inTransaction(pool, async (conn): Promise<Outcome<null>> => {
    const rec = await visible(conn, id, viewer, true);
    if (!rec) return refuse(404, LIBRARY_REFUSALS.notFound);
    const p = patch.value;
    const words = {
      title: p.title ?? rec.title,
      aim: p.aim === undefined ? rec.aim : p.aim,
      note: p.note === undefined ? rec.note : p.note,
    };
    const circleId = p.circleId === undefined ? rec.circleId : p.circleId;
    const noteMoves = words.note !== rec.note;
    const wordsMove = words.title !== rec.title || words.aim !== rec.aim || noteMoves;
    const circleMoves = circleId !== rec.circleId;
    const rights = broughtRights(rec, viewer);
    if (wordsMove && !rights.words) return refuse(403, LIBRARY_REFUSALS.wordsNotYours);
    if (circleMoves && !rights.circle) return refuse(403, LIBRARY_REFUSALS.circleNotYours);
    if (!wordsMove && !circleMoves) return done(null);
    if (rec.status !== "waiting") return refuse(409, LIBRARY_REFUSALS.notWaiting);
    const own = known != null && known > 0 && rec.broughtByNo === known;
    // An admin who never touched a session gets their number now, so the card can say who changed it.
    const editor = own ? known! : (known ?? (await ensureMemberNo(pool, who.userId, now)));
    await store.writeWords(conn, id, {
      ...words,
      // The note becomes an entry in the room, and the entry is whoever wrote these words.
      noteByNo: noteMoves ? (own || words.note == null ? null : editor) : rec.noteByNo,
      circleId,
      // Who last changed it, when that was somebody else; the bringer's own change keeps the mark that is there.
      editedByNo: own ? rec.editedByNo : editor,
      now,
    });
    return done(null);
  });
  if (!out.ok) return out;
  // Only whoever brought it or an admin moves its circle, and both still read it after.
  const item = await oneCard(pool, id, viewer, deps);
  return item ? done({ item }) : refuse(404, LIBRARY_REFUSALS.notFound);
}

/**
 * Withdraw an item: whoever brought it, or an admin, at any time. The row and
 * every take of it go. On an agenda, the room keeps its agenda item as it
 * stands, the way an item brought over from a deleted record keeps its words.
 */
export async function withdrawItem(pool: Pool, who: LibraryAsker, id: number, deps: LibraryDeps): Promise<Outcome<null>> {
  const no = await memberNo(pool, who.userId);
  const viewer = await libraryViewer(pool, { userId: who.userId, no, admin: who.admin }, deps);
  return room.inTransaction(pool, async (conn) => {
    const rec = await visible(conn, id, viewer, true);
    if (!rec) return refuse(404, LIBRARY_REFUSALS.notFound);
    if (!broughtRights(rec, viewer).withdraw) return refuse(403, LIBRARY_REFUSALS.withdrawNotYours);
    await store.deleteItems(conn, [id]);
    return done(null);
  });
}

/** A taken-up item waits again: whoever brought it, or an admin. Its history stays. */
export async function bringItemAgain(pool: Pool, who: LibraryAsker, id: number, deps: LibraryDeps, now = new Date()): Promise<Outcome<{ item: LibraryCard }>> {
  const no = await memberNo(pool, who.userId);
  const viewer = await libraryViewer(pool, { userId: who.userId, no, admin: who.admin }, deps);
  const rec = await visible(pool, id, viewer);
  if (!rec) return refuse(404, LIBRARY_REFUSALS.notFound);
  if (!broughtRights(rec, viewer).bringAgain) return refuse(403, LIBRARY_REFUSALS.againNotYours);
  if (rec.status !== "taken_up") return refuse(409, LIBRARY_REFUSALS.notTakenUp);
  if ((await store.waitingCountBy(pool, rec.broughtByNo)) >= LIBRARY_LIMITS.waitingPerMember) return refuse(409, LIBRARY_REFUSALS.tooManyWaiting);
  if (!(await store.bringAgain(pool, id, now))) return refuse(409, LIBRARY_REFUSALS.notTakenUp);
  const item = await oneCard(pool, id, viewer, deps);
  return item ? done({ item }) : refuse(404, LIBRARY_REFUSALS.notFound);
}

// ── An open room's own list ─────────────────────────────────────────────────

/**
 * What this viewer may bring into this open room: the waiting items of its
 * circle they may see, and the ones for no circle in particular. Each viewer
 * reads their own list, because joining a room asks nothing about its circle.
 * A closed session, or a missing one, offers nothing.
 */
export async function roomLibrary(pool: Pool, sessionId: number, who: LibraryAsker, deps: LibraryDeps): Promise<LibraryCard[]> {
  const rows = await room.sessionRow(pool, sessionId);
  if (!rows.length || String(rows[0].status) !== "open") return [];
  const roomCircleId = rows[0].circle_id == null ? null : String(rows[0].circle_id);
  const no = await memberNo(pool, who.userId);
  const viewer = await libraryViewer(pool, { userId: who.userId, no, admin: who.admin }, deps);
  const live = (await store.liveRows(pool, { admin: viewer.admin, no, standing: Array.from(viewer.standing), limit: LIVE_LIMIT })).map(mapLibrary);
  return cardsFor(pool, live.filter((r) => mayTakeInto(r, viewer, roomCircleId)), viewer, deps);
}

// ── Taking, inside the room's transaction ───────────────────────────────────

/** One item a session took, for the notices that go out after the commit. */
export interface TakenRecord {
  takeId: number;
  libraryId: number;
  broughtByNo: number;
  title: string;
}

/**
 * Lock the items asked for, in id order, after the session row, and say which
 * may be taken. All or none: `planTakes` in the contract.
 */
export async function lockForTaking(
  conn: PoolConnection,
  ids: readonly number[],
  viewer: LibraryViewer,
  roomCircleId: string | null,
  alreadyHere: ReadonlySet<number> = new Set(),
): Promise<{ ok: true; take: LibraryRec[] } | { ok: false }> {
  const wanted = ids.filter((id) => !alreadyHere.has(id));
  const locked = (await store.rowsByIds(conn, wanted, true)).map(mapLibrary);
  return planTakes(ids, locked, viewer, roomCircleId, alreadyHere);
}

/**
 * The items onto the agenda, in the order given, from `position` on. Each
 * becomes an ordinary agenda item added by whoever took it, presented by
 * whoever brought it when they are in the room, with the aim it was brought
 * with (or explore) and the minutes that aim usually gets. Its note becomes
 * the item's first note, written by whoever brought it, so the record keeps it
 * as it was said. The caller holds the session row and has checked the
 * agenda's and the entries' room.
 */
export async function writeTakes(
  conn: PoolConnection,
  t: { sessionId: number; take: readonly LibraryRec[]; position: number; takerNo: number; inRoom: ReadonlySet<number>; now: Date },
): Promise<TakenRecord[]> {
  const out: TakenRecord[] = [];
  let position = t.position;
  for (const rec of t.take) {
    const aim = agendaAimFor(rec.aim);
    const itemId = await room.insertItem(conn, {
      sessionId: t.sessionId,
      title: rec.title,
      aim,
      minutes: LIBRARY_MINUTES[aim],
      position,
      addedByNo: t.takerNo,
      presenterNo: t.inRoom.has(rec.broughtByNo) ? rec.broughtByNo : null,
      fromSessionId: null,
      now: t.now,
    });
    position += 1;
    if (rec.note) {
      await room.insertEntry(conn, {
        sessionId: t.sessionId,
        itemId,
        kind: "note",
        text: rec.note,
        // Whoever wrote the note as it stands: the bringer, unless a host or an admin reworded it.
        authorNo: noteAuthor(rec),
        ownerSeatId: null,
        dueOn: null,
        now: t.now,
      });
    }
    const takeId = await store.takeOnto(conn, { libraryId: rec.id, sessionId: t.sessionId, itemId, takenByNo: t.takerNo, now: t.now });
    out.push({ takeId, libraryId: rec.id, broughtByNo: rec.broughtByNo, title: rec.title });
  }
  return out;
}

/** Whoever wrote an item's note as it stands, and so whose entry it becomes in the room. */
export function noteAuthor(rec: Pick<LibraryRec, "noteByNo" | "broughtByNo">): number {
  return rec.noteByNo ?? rec.broughtByNo;
}

/** The ids of the items this session has already taken, every outcome. */
export async function takenBySession(q: Pool | PoolConnection, sessionId: number): Promise<Set<number>> {
  return new Set((await store.takesForSession(q, sessionId)).map((r) => Number(r.library_id)));
}

// ── Settling, releasing, mending ────────────────────────────────────────────

/** One take a close settled, for the notice to whoever brought it. */
export interface SettledRecord {
  takeId: number;
  libraryId: number;
  broughtByNo: number;
  title: string;
  outcome: "taken_up" | "back";
}

/**
 * What a close does to the items it took, inside the close's own transaction,
 * after the close has stopped the item on screen and written the record. An
 * item the record says is done is taken up; an item it did not reach (waiting
 * or parked) waits again. The library follows the record: the item on screen
 * when the room closed, a quiet room's included, is done in the minutes, and so
 * it is taken up here, and whoever brought it can bring it again. An item
 * withdrawn while it sat on the agenda has no row left and is passed over.
 */
export async function settleForClose(
  conn: PoolConnection,
  sessionId: number,
  items: readonly { id: number; status: string }[],
  now: Date,
): Promise<SettledRecord[]> {
  const open = (await store.takesForSession(conn, sessionId)).filter((r) => r.outcome == null);
  if (!open.length) return [];
  const recs = new Map((await store.rowsByIds(conn, open.map((r) => Number(r.library_id)), true)).map((r) => [Number(r.id), mapLibrary(r)]));
  const statusOf = new Map(items.map((i) => [i.id, i.status]));
  const out: SettledRecord[] = [];
  for (const take of open) {
    const libraryId = Number(take.library_id);
    const outcome = statusOf.get(Number(take.item_id)) === "done" ? "taken_up" : "back";
    const moved = await store.settleTake(conn, { takeId: Number(take.id), libraryId, sessionId, outcome, now });
    const rec = recs.get(libraryId);
    if (moved && rec) out.push({ takeId: Number(take.id), libraryId, broughtByNo: rec.broughtByNo, title: rec.title, outcome });
  }
  return out;
}

/**
 * A session is removed, inside the discard's transaction after its row is
 * locked. Open: what it held waits again and its takes go. Closed: what it
 * took up keeps its status and loses the link.
 */
export async function releaseForDiscard(conn: PoolConnection, sessionId: number, status: "open" | "closed", now = new Date()): Promise<void> {
  const ids = await store.itemIdsNaming(conn, sessionId);
  await store.rowsByIds(conn, ids, true);
  if (status === "open") await store.releaseFromSession(conn, sessionId, ids, now);
  else await store.unlinkDeletedSession(conn, sessionId, ids, now);
}

/** Stranded items one read mends at most. The next read mends the rest. */
const MEND_MAX = 20;

/**
 * Items left on an agenda whose session closed or went without settling them,
 * which a release from before the library leaves behind. Each is mended the
 * way its session would have: a closed session settles it by its item's
 * status, a missing one sends it back to wait. Each session row is locked
 * before the item, the same order every other writer keeps, and the item is
 * read again under the lock. Best effort: a failure is a log line.
 */
export async function reconcileLibrary(pool: Pool, now = new Date()): Promise<number> {
  let mended = 0;
  let stranded: RowDataPacket[] = [];
  try {
    stranded = await store.strandedRows(pool, MEND_MAX);
  } catch (e) {
    console.error("[sessions] the library could not be read for mending", e);
    return 0;
  }
  for (const s of stranded) {
    const libraryId = Number(s.id);
    const sessionId = s.session_id == null ? null : Number(s.session_id);
    try {
      mended += await room.inTransaction(pool, async (conn) => {
        const session = sessionId != null ? await room.sessionRow(conn, sessionId, true) : [];
        const [row] = await store.itemRow(conn, libraryId, true);
        if (!row || String(row.status) !== "on_agenda" || (row.session_id == null ? null : Number(row.session_id)) !== sessionId) return 0;
        if (!session.length) return store.strandedBackToWaiting(conn, libraryId, sessionId, now);
        if (String(session[0].status) === "open") return 0;
        const [take] = await store.openTakeRow(conn, libraryId);
        if (!take || Number(take.session_id) !== sessionId) return store.strandedBackToWaiting(conn, libraryId, null, now);
        const item = row.session_item_id == null ? [] : (await room.itemRows(conn, sessionId!)).filter((i) => Number(i.id) === Number(row.session_item_id));
        const outcome = item.length && String(item[0].status) === "done" ? "taken_up" : "back";
        return store.settleTake(conn, { takeId: Number(take.id), libraryId, sessionId: sessionId!, outcome, now });
      });
    } catch (e) {
      console.error(`[sessions] library item ${libraryId} was not mended`, e);
    }
  }
  return mended;
}

// ── What the room's view reads ──────────────────────────────────────────────

/** Each agenda item this session took from the library, and the name of whoever brought it. */
export async function broughtByItem(q: Pool | PoolConnection, sessionId: number, lookup: MemberLookup): Promise<Map<number, { libraryId: number; broughtBy: string }>> {
  const rows = await store.broughtForSession(q, sessionId);
  if (!rows.length) return new Map();
  const names = await namesFor(q, rows.map((r) => Number(r.brought_by_no)), lookup);
  return new Map(rows.map((r) => [Number(r.item_id), { libraryId: Number(r.library_id), broughtBy: names.get(Number(r.brought_by_no))?.name ?? SESSION_SOMEONE }]));
}

/** The agenda items of a session that came from the library, so "From last time" does not offer them twice. */
export async function libraryItemIdsFor(q: Pool | PoolConnection, sessionId: number): Promise<Set<number>> {
  return new Set((await store.takesForSession(q, sessionId)).map((r) => Number(r.item_id)));
}

// ── Notices ─────────────────────────────────────────────────────────────────

export interface LibraryNoticeDeps {
  notify(input: { userId: string; type: string; title: string; body?: string | null; link?: string | null; dedupeKey: string }): Promise<unknown>;
}

/**
 * After a take commits, best effort: whoever brought each item hears it is on
 * the agenda of the session that took it, unless they took it themselves. The
 * notice opens the item's own card on /sessions, which links the room while it
 * is open. One stable key per take and person, so a retry is one notice.
 */
export async function noticesAfterTakes(
  pool: Pool,
  deps: LibraryNoticeDeps,
  s: { sessionTitle: string; takerNo: number; taken: readonly TakenRecord[] },
): Promise<void> {
  const others = s.taken.filter((t) => t.broughtByNo !== s.takerNo);
  if (!others.length) return;
  try {
    const userOf = new Map((await room.memberUserIdRows(pool, others.map((t) => t.broughtByNo))).map((r) => [Number(r.no), String(r.user_id)]));
    for (const t of others) {
      const userId = userOf.get(t.broughtByNo);
      if (!userId) continue;
      await deps.notify({
        userId,
        type: "session_item_taken",
        title: LIBRARY_NOTICES.taken(s.sessionTitle),
        body: t.title,
        link: broughtLink(t.libraryId),
        dedupeKey: `session-library:${t.takeId}:${userId}`,
      });
    }
  } catch (e) {
    console.error("[sessions] the people whose items were taken were not all told", e);
  }
}

/**
 * After a close commits, best effort: whoever brought an item the session took
 * hears how it left, unless they were in the room and saw it. The notice never
 * names the closed session, whose title is for its people and admins.
 */
export async function noticesAfterSettle(
  pool: Pool,
  deps: LibraryNoticeDeps,
  s: { settled: readonly SettledRecord[]; inRoom: ReadonlySet<number> },
): Promise<void> {
  const absent = s.settled.filter((t) => !s.inRoom.has(t.broughtByNo));
  if (!absent.length) return;
  try {
    const userOf = new Map((await room.memberUserIdRows(pool, absent.map((t) => t.broughtByNo))).map((r) => [Number(r.no), String(r.user_id)]));
    for (const t of absent) {
      const userId = userOf.get(t.broughtByNo);
      if (!userId) continue;
      await deps.notify({
        userId,
        type: "session_item_settled",
        title: t.outcome === "taken_up" ? LIBRARY_NOTICES.takenUp : LIBRARY_NOTICES.back,
        body: t.title,
        link: broughtLink(t.libraryId),
        dedupeKey: `session-library-close:${t.takeId}:${userId}`,
      });
    }
  } catch (e) {
    console.error("[sessions] the people whose items a session took were not all told how they left", e);
  }
}

// ── The member's own ────────────────────────────────────────────────────────

/**
 * What the library holds about one member, for GET /api/profile/export: the
 * items they brought, with their own words, and the times they put an item on
 * an agenda. A session's id travels only where they may read that session.
 */
export async function exportLibraryFor(
  pool: Pool,
  no: number,
): Promise<{ library: Record<string, unknown>[]; libraryTakes: Record<string, unknown>[]; libraryNotes: Record<string, unknown>[] }> {
  const recs = (await store.memberRows(pool, no)).map(mapLibrary);
  // A note they wrote on an item somebody else brought: their words, and nothing else of the item.
  const libraryNotes = (await store.memberNoteRows(pool, no)).map((r) => ({ libraryId: Number(r.id), note: r.note == null ? null : String(r.note) }));
  const takes = await store.memberTakeRows(pool, no);
  const ids = Array.from(new Set([...recs.map((r) => r.sessionId), ...takes.map((t) => Number(t.session_id))].filter((id): id is number => id != null)));
  const open = new Set((await store.sessionTitleRows(pool, ids)).filter((r) => String(r.status) === "open").map((r) => Number(r.id)));
  const joined = new Set((await room.joinedRows(pool, no, ids)).map((r) => Number(r.session_id)));
  const readable = (id: number | null) => (id != null && (open.has(id) || joined.has(id)) ? id : null);
  return {
    library: recs.map((r) => ({
      id: r.id,
      title: r.title,
      aim: r.aim,
      note: r.note,
      circleId: r.circleId,
      status: r.status,
      sessionId: readable(r.sessionId),
      broughtAt: r.createdAt,
      takenUpAt: r.settledAt,
    })),
    libraryTakes: takes.map((t) => ({
      libraryId: Number(t.library_id),
      sessionId: readable(Number(t.session_id)),
      takenAt: toIso(t.taken_at),
      outcome: t.outcome == null ? null : String(t.outcome),
      settledAt: toIso(t.settled_at),
    })),
    libraryNotes,
  };
}

/** The member leaves the library, inside the erasure's own transaction (`forgetMemberSessions`). */
export async function forgetLibraryFor(conn: PoolConnection, no: number): Promise<void> {
  await store.forgetMember(conn, no);
}
