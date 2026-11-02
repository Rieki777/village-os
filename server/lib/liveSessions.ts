/**
 * Live Sessions: the rules of the room, against the six tables in
 * server/repos/liveSessions.ts. The routes (server/routes/liveSessions.ts)
 * read a request and call one function here; the shapes, limits and words
 * are all shared/sessions.ts, which is the contract.
 *
 * ── A PERSON IS A NUMBER ─────────────────────────────────────────────────
 *
 * The room's wire shapes carry people as numbers, and a member's id in this
 * village is a string. `memberNo` / `ensureMemberNo` give each member one
 * number the first time they touch a session, and `namesFor` turns numbers
 * back into names. The client never sees a member's own id.
 *
 * ── WHO MAY DO WHAT ──────────────────────────────────────────────────────
 *
 * Seeing: an open session is seen by any admitted member, and any of them may
 * join it (a signed-in guest is refused at the route's members-only gate). A
 * closed one is seen by the people who were in it and by admins.
 *
 * Writing: every write needs the session open and the writer in it. On top
 * of that (`rolesIn`):
 *   runs   the facilitator, or an admin: moves the room (act), names the
 *          hosts, reorders the agenda, sets an item's status, closes, and
 *          marks a proposal decided once its consent round has consented.
 *          A decided proposal is final: its words, its status and the row
 *          itself stay as they are, and a proposal whose words change while
 *          open starts its consent round again.
 *   notes  runs, or the secretary: renames the session, edits any item's
 *          words, and any entry's text, status, seat and date. An admin is
 *          here too, through runs, once they have joined.
 *   author the person who wrote an entry edits or deletes it; the person who
 *          added an item changes its title until it is done, and its aim,
 *          minutes and presenter while it is still waiting, because the
 *          item's clock reads its minutes once it starts.
 *   anyone in the room claims an action nobody holds; the holder or the
 *          facilitator lets it go.
 *
 * Removing (`discardSession`, the one write that needs no seat): an open
 * session is discarded by its facilitator or an admin, joined or not; a
 * closed record is deleted by an admin only.
 *
 * EVERY WRITE LOCKS THE SESSION ROW AND BUMPS ITS VERSION in the same
 * transaction (`inRoom`), so the version is the room's whole history and a
 * page that sends it back as an ETag gets a 304 until something moved.
 * Presence (`markHere`) is the one write that bumps nothing: the ETag carries
 * a presence bucket instead, so "who is here" refreshes about every 20 s.
 *
 * ── THE PRIVACY LINE ─────────────────────────────────────────────────────
 *
 * Arrival numbers and words are seen only by the people in an open room,
 * and the close erases them after storing the spread. Feedback on the
 * facilitation is read with no person attached (the repo's
 * `facilitationRows` has no column for one), only by the facilitator and
 * admins, and only once the session has closed, so it arrives as one sorted
 * batch and never answer by answer while the room can still see who pressed
 * send. Nothing here calls `recordEvent`.
 *
 * ── A ROOM NOBODY CLOSES ─────────────────────────────────────────────────
 *
 * The arrival round is erased only by a close, so a room left open would
 * keep it for anybody who joins later. `closeStaleRooms` closes an open room
 * nobody has been seen in for `staleAfterMs` (its length plus two hours, and
 * never less than six), the same way a facilitator would: it parks the
 * actions nobody holds and runs the close. The routes run it lazily, as the
 * list is read and before a room is read or joined.
 */
import { createHash } from "node:crypto";
import type { Pool, PoolConnection } from "mysql2/promise";
import * as repo from "../repos/liveSessions";
import { deleteTaskRowsForSession, exportTaskRowsFor, forgetTaskRowsFor, seedStateForSession } from "../repos/sessionTasks";
import { avatarFor } from "./characters";
import { listOrgAssignments, listOrgRoles, type LapseContext } from "./orgChart";
import { keptSeat, lastTimeIn } from "./circleStanding";
import { circleTasksFor, villageDate } from "./sessionTasks";
import {
  broughtByItem,
  exportLibraryFor,
  forgetLibraryFor,
  libraryItemIdsFor,
  libraryViewer,
  lockForTaking,
  noteAuthor,
  noticesAfterSettle,
  releaseForDiscard,
  sentTensionsFor,
  settleForClose,
  takenBySession,
  writeTakes,
  type SettledRecord,
  type TakenRecord,
} from "./sessionLibrary";
import { exportRhythmsFor, forgetRhythmsFor } from "./sessionRhythm";
import { exportTemplatesFor, forgetTemplatesFor } from "./sessionTemplates";
import { exportFollowsFor, forgetFollowsFor } from "./sessionCalendar";
import { exportReviewsFor, forgetReviewsFor } from "./sessionDecisions";
import { exportAdviceFor, forgetAdviceFor } from "./sessionAdvice";
import { fillFor, filledInOut, fillKey, keepFills, latestStanding, mapFill, mayUndo, readFor, recordFill, standingFills } from "./sessionOnBehalf";
import * as fillsRepo from "../repos/sessionOnBehalf";
import * as votesRepo from "../repos/sessionVotes";
import * as checksRepo from "../repos/sessionChecks";
import { CHECK_REFUSALS as CR, instantRead, readCheckRead, seatsNamed, type CheckView, type EntryCheck, type HolderPlace } from "../../shared/sessionCheck";
import { governingPurpose } from "./governingPurpose";
import { mapVote, noVotes, sortByVotes, talliesFor } from "./sessionVotes";
import { VOTE_REFUSALS as VR, isAgendaVote } from "../../shared/sessionVotes";
import { ON_BEHALF_REFUSALS as OB } from "../../shared/sessionOnBehalf";
import { liveHoldersOf, taskBoardLink, taskDateWords } from "../../shared/sessionTasks";
import { holderFirstName } from "../../shared/roleHolderLabel";
import { LIBRARY_REFUSALS, cleanIds } from "../../shared/sessionLibrary";
import { numberVar, stringVar } from "./variables";
import { moonOneCycle, villageMoonFor } from "./villageMoon";
import { civilDate, moonPhase, moonPhaseGlyph, moonPhaseName, seasonInstants } from "../../shared/lunar";
import { orderParcels } from "../../shared/land";
import { isTropicalLatitude, parseVillageSeasons, villageSeasonOn } from "../../shared/villageSeasons";
import { naturalSeasonStart, villageSeasonStartKey } from "../../shared/sessionPulse";
import { civilDayStart } from "../../shared/seasonPlans";
import { villageKey } from "../../shared/sessionRhythm";
import { villageLandRows } from "../repos/villageLand";
import { villageTimezone } from "./villageReaders";
import { effectiveLifecycle } from "./modules";
import { LIFECYCLE_RANK, type ModuleLifecycle } from "../../shared/modules";
import {
  CLOSE_REFUSAL,
  ENTRY_STATUSES,
  FACILITATION_VALUES,
  HERE_EVERY_MS,
  ITEM_STATUSES,
  PRESENT_WINDOW_MS,
  SESSION_COPY,
  SESSION_LIMITS,
  SESSION_NOTICES,
  SESSION_REFUSALS as R,
  SESSION_SEASONS,
  SESSION_SOMEONE,
  applySessionAction,
  arrivalSummary,
  buildMinutes,
  cleanDueOn,
  cleanAnswerBy,
  cleanLine,
  cleanText,
  consentNeedsWords,
  consentTally,
  consentWaiting,
  defaultSessionState,
  isArrivalScore,
  isConsentValue,
  isEntryKind,
  isItemAim,
  nightAtWords,
  nightLasts,
  nightRoundState,
  normalizeSessionState,
  parseResponseTarget,
  unownedActions,
  type ArrivalSummary,
  type ConsentTally,
  type ConsentAnswer,
  type ResponseTarget,
  type ConsentValue,
  type ConsentWaiting,
  type EntryKind,
  type EntryStatus,
  type FacilitationValue,
  type ItemAim,
  type ItemStatus,
  type MinutesAudience,
  type NightRound,
  type SeatOption,
  type SessionAction,
  type SessionEntry,
  type SessionItem,
  type SessionListRow,
  type SessionPerson,
  type SessionResponse,
  type SessionSeason,
  type SessionStamp,
  type SessionState,
  type SessionView,
} from "../../shared/sessions";

// ── Outcomes ────────────────────────────────────────────────────────────────

export type Refusal = { ok: false; status: number; error: string; body?: Record<string, unknown> };
export type Outcome<T> = { ok: true; value: T } | Refusal;

const refuse = (status: number, error: string, body?: Record<string, unknown>): Refusal => ({ ok: false, status, error, body });
const done = <T>(value: T): Outcome<T> => ({ ok: true, value });

/** Who is asking: their number (null when they have never touched a session) and whether they are an admin. */
export interface Viewer {
  no: number | null;
  admin: boolean;
  /**
   * Their own member id, when the door has it. The task layer reads their seats
   * by it, so a member who sits in one of a circle's seats and has never joined
   * a session still has standing there (server/lib/sessionTasks.ts `standingIn`).
   */
  userId?: string | null;
}

/** Who is writing. A writer always has a number, because writing needs a seat in the room. */
export interface Actor {
  no: number;
  admin: boolean;
}

// ── Rows, as the lib reads them ─────────────────────────────────────────────

const toIso = (v: unknown): string | null => {
  if (v == null) return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
};
const toMs = (v: unknown): number | null => {
  const iso = toIso(v);
  return iso ? Date.parse(iso) : null;
};
const intOrNull = (v: unknown): number | null => (v == null ? null : Number.isFinite(Number(v)) ? Number(v) : null);

/** What `summary` holds once a session closes: numbers, and the circle's name at the time. */
export interface StoredSummary {
  arrival: ArrivalSummary;
  tallies: Record<number, ConsentTally>;
  circleName: string | null;
  counts: { people: number; items: number; entries: number; actions: number; decisions: number };
  /**
   * The proposals whose round outlived the call (0281): open at the close with
   * somebody sleeping on it. `waiting` is how many people at the close had not
   * answered; `settled` is set once no night lasts, so the job reads it once.
   */
  nights?: Record<number, { waiting: number; settled: boolean }>;
}

export interface SessionRec {
  id: number;
  title: string;
  circleId: string | null;
  status: "open" | "closed";
  facilitatorNo: number;
  secretaryNo: number | null;
  createdByNo: number;
  durationMin: number;
  state: SessionState;
  version: number;
  stamp: SessionStamp;
  summary: StoredSummary | null;
  createdAt: string;
  closedAt: string | null;
}

const parseJson = (raw: unknown): any => {
  if (raw == null) return null;
  if (typeof raw === "object") return raw;
  try {
    return JSON.parse(String(raw));
  } catch {
    return null;
  }
};

export function readStamp(raw: unknown): SessionStamp {
  const s = parseJson(raw) ?? {};
  return {
    moonName: typeof s.moonName === "string" ? s.moonName : "",
    moonGlyph: typeof s.moonGlyph === "string" ? s.moonGlyph : "",
    // Both arrived later than the stamp itself, so a stamp stored before them
    // reads null, and so does anything that is not what the room can draw.
    moonPhase: typeof s.moonPhase === "number" && Number.isFinite(s.moonPhase) && s.moonPhase >= 0 && s.moonPhase <= 1 ? s.moonPhase : null,
    hemisphere: s.hemisphere === "north" || s.hemisphere === "south" ? s.hemisphere : null,
    moonOrdinal: Number.isInteger(s.moonOrdinal) ? s.moonOrdinal : null,
    season: typeof s.season === "string" ? s.season : null,
    placeLine: typeof s.placeLine === "string" && s.placeLine ? s.placeLine : null,
  };
}

function readSummary(raw: unknown): StoredSummary | null {
  const s = parseJson(raw);
  if (!s || typeof s !== "object") return null;
  const arrival = s.arrival && typeof s.arrival === "object" ? s.arrival : null;
  return {
    arrival: {
      count: Number(arrival?.count ?? 0) || 0,
      median: typeof arrival?.median === "number" ? arrival.median : null,
      low: typeof arrival?.low === "number" ? arrival.low : null,
      high: typeof arrival?.high === "number" ? arrival.high : null,
    },
    tallies: s.tallies && typeof s.tallies === "object" ? s.tallies : {},
    nights: s.nights && typeof s.nights === "object" ? s.nights : {},
    circleName: typeof s.circleName === "string" ? s.circleName : null,
    counts: {
      people: Number(s.counts?.people ?? 0) || 0,
      items: Number(s.counts?.items ?? 0) || 0,
      entries: Number(s.counts?.entries ?? 0) || 0,
      actions: Number(s.counts?.actions ?? 0) || 0,
      decisions: Number(s.counts?.decisions ?? 0) || 0,
    },
  };
}

export function mapSession(r: any): SessionRec {
  return {
    id: Number(r.id),
    title: String(r.title ?? ""),
    circleId: r.circle_id == null ? null : String(r.circle_id),
    status: r.status === "closed" ? "closed" : "open",
    facilitatorNo: Number(r.facilitator_no ?? 0),
    secretaryNo: intOrNull(r.secretary_no),
    createdByNo: Number(r.created_by_no ?? 0),
    durationMin: Number(r.duration_min ?? SESSION_LIMITS.durationDefault),
    state: normalizeSessionState(r.state),
    version: Number(r.version ?? 1),
    stamp: readStamp(r.stamp),
    summary: readSummary(r.summary),
    createdAt: toIso(r.created_at) ?? new Date(0).toISOString(),
    closedAt: toIso(r.closed_at),
  };
}

interface PersonRec {
  no: number;
  lastSeenMs: number | null;
  arrival: number | null;
  wish: string | null;
}

const mapPerson = (r: any): PersonRec => ({
  no: Number(r.member_no),
  lastSeenMs: toMs(r.last_seen_at),
  arrival: intOrNull(r.arrival_score),
  wish: r.arrival_wish == null ? null : String(r.arrival_wish),
});

export const isPresentAt = (p: { lastSeenMs: number | null }, now: number): boolean =>
  p.lastSeenMs != null && now - p.lastSeenMs <= PRESENT_WINDOW_MS;

interface ItemRec extends SessionItem {
  startedMs: number | null;
}

const asAim = (v: unknown): ItemAim => (isItemAim(v) ? v : "report");
const asItemStatus = (v: unknown): ItemStatus => ((ITEM_STATUSES as readonly string[]).includes(String(v)) ? (v as ItemStatus) : "waiting");
const asEntryStatus = (v: unknown): EntryStatus => ((ENTRY_STATUSES as readonly string[]).includes(String(v)) ? (v as EntryStatus) : "open");

const mapItem = (r: any): ItemRec => ({
  id: Number(r.id),
  title: String(r.title ?? ""),
  aim: asAim(r.aim),
  minutes: Number(r.minutes ?? 0),
  position: Number(r.position ?? 0),
  status: asItemStatus(r.status),
  presenterUserId: intOrNull(r.presenter_no),
  addedBy: Number(r.added_by_no ?? 0),
  startedAt: toIso(r.started_at),
  endedAt: toIso(r.ended_at),
  usedSeconds: Number(r.used_seconds ?? 0),
  fromSessionId: intOrNull(r.from_session_id),
  startedMs: toMs(r.started_at),
});

/** An item on the wire: the row without the lib's own clock field. */
const itemOut = ({ startedMs: _startedMs, ...item }: ItemRec): SessionItem => item;

interface EntryRec {
  id: number;
  sessionId: number;
  itemId: number | null;
  kind: EntryKind;
  text: string;
  status: EntryStatus;
  authorNo: number;
  ownerNo: number | null;
  ownerSeatId: string | null;
  dueOn: string | null;
  claimedAt: string | null;
  createdAt: string;
  /** A win's season priority, by its id (0298, server/lib/sessionTemplates.ts). */
  servesGoalId: string | null;
}

const mapEntry = (r: any): EntryRec => ({
  id: Number(r.id),
  sessionId: Number(r.session_id),
  itemId: intOrNull(r.item_id),
  kind: isEntryKind(r.kind) ? r.kind : "note",
  text: String(r.text ?? ""),
  status: asEntryStatus(r.status),
  authorNo: Number(r.author_no ?? 0),
  ownerNo: intOrNull(r.owner_no),
  ownerSeatId: r.owner_seat_id == null || r.owner_seat_id === "" ? null : String(r.owner_seat_id),
  dueOn: r.due_on == null ? null : String(r.due_on),
  claimedAt: toIso(r.claimed_at),
  createdAt: toIso(r.created_at) ?? new Date(0).toISOString(),
  servesGoalId: r.serves_goal_id == null || r.serves_goal_id === "" ? null : String(r.serves_goal_id),
});

interface ResponseRec {
  target: string;
  no: number;
  value: string;
  text: string | null;
  /** A night's answer-by time in ms (0281), null on every other answer. */
  answerBy: number | null;
}

const mapResponse = (r: any): ResponseRec => ({
  target: String(r.target),
  no: Number(r.member_no),
  value: String(r.value),
  text: r.text == null ? null : String(r.text),
  answerBy: r.answer_by_s == null ? null : Math.round(Number(r.answer_by_s) * 1000),
});

/** One consent answer of a round, from a response row. */
const asAnswer = (r: ResponseRec): ConsentAnswer => ({ who: r.no, value: r.value as ConsentValue, answerBy: r.answerBy });

// ── A member's number, and names for numbers ────────────────────────────────

/** The member's number, or null when they have never touched a session. */
export async function memberNo(pool: Pool | PoolConnection, userId: string): Promise<number | null> {
  const rows = await repo.memberNoRows(pool, userId);
  return rows.length ? Number(rows[0].no) : null;
}

/** The member's number, given one the first time. */
export async function ensureMemberNo(pool: Pool, userId: string, now = new Date()): Promise<number> {
  const found = await memberNo(pool, userId);
  if (found != null) return found;
  await repo.insertMemberNo(pool, userId, now);
  const again = await memberNo(pool, userId);
  if (again == null) throw new Error("live sessions: a member number could not be given");
  return again;
}

/**
 * What the lib needs to know about a member to name them: any record with a
 * `name` and a `handle`, read defensively, so the members repo's own record
 * and a route's small cached copy both fit.
 */
export type MemberLookup = (userId: string) => Promise<Record<string, unknown> | null>;

export interface Named {
  name: string;
  handle: string | null;
  userId: string | null;
}

/** A name for every number. A number nobody holds any more reads as `SESSION_SOMEONE`. */
export async function namesFor(q: Pool | PoolConnection, nos: Iterable<number>, lookup: MemberLookup): Promise<Map<number, Named>> {
  const wanted = Array.from(new Set(Array.from(nos).filter((n) => Number.isInteger(n) && n > 0)));
  const out = new Map<number, Named>();
  const rows = await repo.memberUserIdRows(q, wanted);
  const userOf = new Map(rows.map((r) => [Number(r.no), String(r.user_id)]));
  await Promise.all(
    wanted.map(async (no) => {
      const userId = userOf.get(no) ?? null;
      const m = userId ? await lookup(userId).catch(() => null) : null;
      const name = m && typeof m.name === "string" && m.name.trim() ? m.name.trim() : SESSION_SOMEONE;
      const handle = m && typeof m.handle === "string" && m.handle ? m.handle : null;
      out.set(no, { name, handle, userId });
    }),
  );
  return out;
}

const nameIn = (names: Map<number, Named>, no: number | null | undefined): string | null =>
  no == null ? null : (names.get(no)?.name ?? SESSION_SOMEONE);

// ── Seats ───────────────────────────────────────────────────────────────────

interface SeatBook {
  /** Every seat's name, active or not, so an old record still names its seats. */
  nameOf: Map<string, string>;
  /** The active seats that are not standing examples, as the room offers them. */
  options: SeatOption[];
  active: Set<string>;
  /** First names of who sits in each owning seat now. Only the room view fills it, never the minutes. */
  holdersOf?: Map<string, string[]>;
}

/** The org chart's seats. The circle's own seats first when a circle is meeting. */
export async function seatBook(pool: Pool | PoolConnection, circleId: string | null): Promise<SeatBook> {
  const roles = await listOrgRoles(pool as Pool);
  const nameOf = new Map(roles.map((r) => [r.id, r.name]));
  // A standing example seat holds nothing real, and an action left with one
  // would reach nobody, so the room offers live seats only, the same reading
  // the org chart's own seat map makes.
  const active = roles.filter(keptSeat);
  const options: SeatOption[] = active.map((r) => ({ id: r.id, name: r.name, circleId: r.circleId }));
  if (circleId) options.sort((a, b) => Number(b.circleId === circleId) - Number(a.circleId === circleId));
  return { nameOf, options, active: new Set(active.map((r) => r.id)) };
}

/**
 * Who sits in each of these seats now, as first names, for "Treasurer (Rick)" (Rye, 2026-10-30).
 * Read from the roster on every read, so a handover renames the line by itself. A lapsed term,
 * an ended seating and a standing example name nobody, the same reading the task board makes.
 */
export async function seatHoldersFor(
  pool: Pool | PoolConnection,
  seatIds: Iterable<string>,
  lookup: MemberLookup,
  lapseContext?: () => LapseContext,
): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  const wanted = Array.from(new Set(seatIds));
  if (wanted.length === 0) return out;
  const seatings = await listOrgAssignments(pool as Pool, lapseContext?.());
  await Promise.all(
    wanted.map(async (seat) => {
      const names = await Promise.all(
        liveHoldersOf(seatings, seat).map(async (userId) => {
          const m = await lookup(userId).catch(() => null);
          return m && typeof m.name === "string" ? holderFirstName(m.name) : "";
        }),
      );
      out.set(seat, names.filter(Boolean));
    }),
  );
  return out;
}

const entryOut = (e: EntryRec, names: Map<number, Named>, seats: SeatBook): SessionEntry => ({
  id: e.id,
  itemId: e.itemId,
  kind: e.kind,
  text: e.text,
  status: e.status,
  authorUserId: e.authorNo,
  ownerUserId: e.ownerNo,
  ownerName: nameIn(names, e.ownerNo),
  ownerSeatId: e.ownerSeatId,
  ownerSeatName: e.ownerSeatId ? (seats.nameOf.get(e.ownerSeatId) ?? null) : null,
  ...(seats.holdersOf && e.ownerSeatId ? { ownerSeatHolders: seats.holdersOf.get(e.ownerSeatId) ?? [] } : {}),
  dueOn: e.dueOn,
  createdAt: e.createdAt,
  // Only a win serves the season, so only a win carries the field.
  ...(e.kind === "win" ? { servesGoalId: e.servesGoalId } : {}),
});

// ── Roles in a room ─────────────────────────────────────────────────────────

export interface Roles {
  facilitates: boolean;
  secretary: boolean;
  admin: boolean;
  /** The facilitator, or an admin. */
  runs: boolean;
  /** The facilitator, an admin, or the secretary. */
  notes: boolean;
}

export function rolesIn(s: Pick<SessionRec, "facilitatorNo" | "secretaryNo">, who: Viewer): Roles {
  const facilitates = who.no != null && who.no > 0 && s.facilitatorNo === who.no;
  const secretary = who.no != null && who.no > 0 && s.secretaryNo === who.no;
  const runs = facilitates || who.admin;
  return { facilitates, secretary, admin: who.admin, runs, notes: runs || secretary };
}

/** May this person read the session at all. */
export function maySee(s: Pick<SessionRec, "status">, joined: boolean, admin: boolean): boolean {
  return s.status === "open" || joined || admin;
}

/**
 * What one person may change on one entry. Pure, so the matrix is read and
 * tested in one place.
 */
export function entryRights(e: Pick<EntryRec, "authorNo" | "ownerNo">, actorNo: number, roles: Roles) {
  const author = e.authorNo === actorNo;
  const holder = e.ownerNo != null && e.ownerNo === actorNo;
  return {
    text: author || roles.notes,
    seat: author || roles.notes,
    dueOn: author || holder || roles.notes,
    status: author || roles.notes,
    remove: author || roles.notes,
    claim: true,
    release: holder || roles.runs,
  };
}

/**
 * May this person change an item's title: notes always, and the person who
 * added it until it is done. A typo in a title is fixed while the item runs;
 * a finished item's title is what the record says was talked about.
 */
export function mayEditItemTitle(item: Pick<SessionItem, "addedBy" | "status">, actorNo: number, roles: Roles): boolean {
  return roles.notes || (item.addedBy === actorNo && item.status !== "done");
}

/**
 * May this person change an item's plan (its aim, minutes and presenter):
 * notes always, and the person who added it only while it waits. Once the
 * item starts, its clock reads the minutes, so the hosts hold them.
 */
export function mayEditItemPlan(item: Pick<SessionItem, "addedBy" | "status">, actorNo: number, roles: Roles): boolean {
  return roles.notes || (item.addedBy === actorNo && item.status === "waiting");
}

// ── The ETag ────────────────────────────────────────────────────────────────

/**
 * The room's tag for one viewer. The version moves on every write; the
 * presence bucket moves every HERE_EVERY_MS while the room is open, so
 * "who is here" refreshes without a write; the viewer part keeps one person's
 * view from answering for another's, since what an admin or the facilitator
 * receives differs.
 */
export function sessionEtag(s: Pick<SessionRec, "id" | "version" | "status">, viewer: Viewer, now: number): string {
  const bucket = s.status === "open" ? Math.floor(now / HERE_EVERY_MS) : 0;
  const who = createHash("sha1").update(`${viewer.no ?? 0}|${viewer.admin ? 1 : 0}`).digest("hex").slice(0, 10);
  return `"ls-${s.id}-${s.version}-${bucket}-${who}"`;
}

/**
 * Does an If-None-Match header name this tag? The weak comparison a GET uses
 * (RFC 9110 13.1.2): a proxy may weaken the tag on the way out, a list may
 * carry several, and `*` matches anything. Same reading as `etagHits` in
 * server/lib/mapOrg.ts, whose tag carries the org's own prefix.
 */
export function etagMatches(header: string | string[] | undefined, tag: string): boolean {
  if (!header || !tag) return false;
  const raw = Array.isArray(header) ? header.join(",") : header;
  return raw
    .split(",")
    .map((t) => t.trim().replace(/^W\//, ""))
    .some((t) => t === "*" || t === tag);
}

// ── The stamp: moon, season, place ──────────────────────────────────────────

/** The season an instant falls in, by hemisphere. The table's own instants when it has the year. */
export function seasonAt(date: Date, hemisphere: "north" | "south"): SessionSeason {
  const year = date.getUTCFullYear();
  const t = date.getTime();
  const table = seasonInstants(year);
  const at = (month: number, day: number) => Date.UTC(year, month - 1, day);
  const mar = table?.marEquinox.getTime() ?? at(3, 20);
  const jun = table?.junSolstice.getTime() ?? at(6, 21);
  const sep = table?.sepEquinox.getTime() ?? at(9, 22);
  const dec = table?.decSolstice.getTime() ?? at(12, 21);
  // In the north: spring from the March equinox, summer from June, autumn
  // from September, winter from December. The south turns the other way.
  const north: SessionSeason = t >= dec || t < mar ? "winter" : t < jun ? "spring" : t < sep ? "summer" : "autumn";
  if (hemisphere === "north") return north;
  const flip: Record<SessionSeason, SessionSeason> = { spring: "autumn", summer: "winter", autumn: "spring", winter: "summer" };
  return flip[north];
}

/** The village's place line, cleaned to one line, or null when it has none. */
export function placeLine(): string | null {
  try {
    return cleanLine(stringVar("sessions.place_line"), 255);
  } catch {
    return null;
  }
}

/** How long a session runs unless its opener says otherwise. */
export function defaultDuration(): number {
  let n: number = SESSION_LIMITS.durationDefault;
  try {
    n = Math.round(numberVar("sessions.default_minutes"));
  } catch {
    /* the registry's own default stands */
  }
  return Math.min(SESSION_LIMITS.durationMax, Math.max(SESSION_LIMITS.durationMin, n || SESSION_LIMITS.durationDefault));
}

/**
 * The season a stamp names, in this order:
 *
 *   1. The village's own seasons (`calendar.seasons`), when it has written a
 *      list the room can read whole: the one whose start most recently passed
 *      on the village's own calendar day, wrapping the year.
 *   2. None, when the village's land sits between the tropics and it has
 *      named no seasons. Spring and autumn do not describe a year that turns
 *      on rain, and a wrong word on every record is worse than no word.
 *   3. The temperate four by hemisphere, as before, when the land is outside
 *      the tropics or the village has not said where it is.
 *
 * Pure, so each branch is tested without a database: the caller reads the
 * dial, the latitude and the zone.
 */
export function stampSeason(
  now: Date,
  village: { seasons: string | null; latitude: number | null; hemisphere: "north" | "south"; timeZone: string },
): string | null {
  const own = parseVillageSeasons(village.seasons);
  if (own) {
    let day: { month: number; day: number };
    try {
      day = civilDate(now, village.timeZone);
    } catch {
      day = civilDate(now, "UTC");
    }
    return villageSeasonOn(own, day.month, day.day);
  }
  if (village.latitude != null && isTropicalLatitude(village.latitude)) return null;
  return seasonAt(now, village.hemisphere);
}

/**
 * The season a session opened now would be stamped with, and the instant it
 * began. The village's own seasons when it has written them: the latest start
 * on or before today in the village's clock, or last year's last start before
 * the year's first. The natural ones otherwise: the latest equinox or
 * solstice. Null for both where the village keeps no seasons (the tropics), or
 * the stamp cannot tell.
 */
export async function seasonNow(pool: Pool, now: Date): Promise<{ season: string | null; startedAt: Date | null }> {
  const season = (await sessionStamp(pool, now)).season ?? null;
  if (!season) return { season: null, startedAt: null };
  try {
    const own = parseVillageSeasons(stringVar("calendar.seasons"));
    if (own) {
      const zone = villageTimezone();
      const key = villageSeasonStartKey(own, villageKey(now, zone));
      return { season, startedAt: key ? civilDayStart(key, zone) : null };
    }
  } catch {
    return { season, startedAt: null };
  }
  return { season, startedAt: naturalSeasonStart(now) };
}

/** This deployment is one village; the land table keys its rows by it (0069). */
const VILLAGE = "local";

/**
 * The latitude of the village's first parcel of land, or null when it has not
 * said where it is. Read only to tell the tropics from the rest; the stamp
 * carries no coordinate. `=== null` against the column, never a truthiness
 * test, because a village on the equator stands at latitude 0.
 */
export async function villageLatitude(pool: Pool): Promise<number | null> {
  try {
    const parcels = orderParcels(
      (await villageLandRows(pool, VILLAGE)).map((r) => ({
        sortOrder: Number(r.sort_order ?? 0),
        createdAt: r.created_at ? String(r.created_at) : null,
        lat: r.centre_lat === null || r.centre_lat === undefined ? null : Number(r.centre_lat),
      })),
    );
    const placed = parcels.find((p) => p.lat !== null && Number.isFinite(p.lat));
    return placed?.lat ?? null;
  } catch {
    return null;
  }
}

/** What the sky and the place say as a session opens. Each part degrades to null on its own. */
export async function sessionStamp(pool: Pool, now: Date): Promise<SessionStamp> {
  const phase = moonPhase(now);
  let moonOrdinal: number | null = null;
  try {
    moonOrdinal = villageMoonFor(now, await moonOneCycle(pool)).ordinal;
  } catch {
    moonOrdinal = null;
  }
  let hemisphere: "north" | "south" | null = null;
  try {
    hemisphere = stringVar("calendar.hemisphere") === "south" ? "south" : "north";
  } catch {
    hemisphere = null;
  }
  let season: string | null = null;
  try {
    const seasons = stringVar("calendar.seasons");
    // The land is read only when the village has named no seasons of its own.
    const latitude = parseVillageSeasons(seasons) ? null : await villageLatitude(pool);
    season = hemisphere ? stampSeason(now, { seasons, latitude, hemisphere, timeZone: villageTimezone() }) : null;
  } catch {
    season = null;
  }
  return {
    moonName: moonPhaseName(phase),
    moonGlyph: moonPhaseGlyph(phase),
    moonPhase: Math.round(phase * 10_000) / 10_000,
    hemisphere,
    moonOrdinal,
    season,
    placeLine: placeLine(),
  };
}

// ── Reading a body ──────────────────────────────────────────────────────────

const has = (b: Record<string, unknown>, k: string) => Object.prototype.hasOwnProperty.call(b, k) && b[k] !== undefined;
const bodyOf = (raw: unknown): Record<string, unknown> => (raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {});
const posInt = (v: unknown): number | null => (typeof v === "number" && Number.isInteger(v) && v > 0 && v < 2 ** 31 ? v : null);

/** A route's `:id`, or null for anything that is not a positive whole number. */
export function parseId(raw: unknown): number | null {
  const s = String(raw ?? "");
  return /^[1-9]\d{0,9}$/.test(s) && Number(s) < 2 ** 31 ? Number(s) : null;
}

export interface StartInput {
  title: string;
  circleId: string | null;
  durationMin: number;
}

/** A new session's three fields. The circle is checked against the village's own list. */
export function cleanStart(raw: unknown, circleIds: ReadonlySet<string>): Outcome<StartInput> {
  const b = bodyOf(raw);
  const title = cleanLine(b.title, SESSION_LIMITS.title);
  if (!title) return refuse(400, R.titleNeeded);
  let circleId: string | null = null;
  if (b.circleId != null && b.circleId !== "") {
    if (typeof b.circleId !== "string" || !circleIds.has(b.circleId)) return refuse(400, R.circleUnknown);
    circleId = b.circleId;
  }
  let durationMin = defaultDuration();
  if (b.durationMin != null && b.durationMin !== "") {
    const n = Number(b.durationMin);
    if (!Number.isInteger(n) || n < SESSION_LIMITS.durationMin || n > SESSION_LIMITS.durationMax) return refuse(400, R.durationRange);
    durationMin = n;
  }
  return done({ title, circleId, durationMin });
}

const cleanMinutes = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isInteger(n) && n >= SESSION_LIMITS.minutesMin && n <= SESSION_LIMITS.minutesMax ? n : null;
};

// ── The room's transaction ──────────────────────────────────────────────────

interface Room {
  conn: PoolConnection;
  s: SessionRec;
  roles: Roles;
  /**
   * Set by work that found nothing to change, so the version stays where it
   * is and every open page keeps its 304. A yes that moved nothing.
   */
  still: boolean;
}

/**
 * Lock the session, check it is open and the writer is in it, run `work`,
 * and bump the version if the work succeeded and moved something. A refusal
 * writes nothing.
 */
async function inRoom<T>(pool: Pool, sessionId: number, actor: Actor, work: (room: Room) => Promise<Outcome<T>>): Promise<Outcome<T>> {
  return repo.inTransaction(pool, async (conn) => {
    const rows = await repo.sessionRow(conn, sessionId, true);
    if (!rows.length) return refuse(404, R.notFound);
    const s = mapSession(rows[0]);
    if (s.status !== "open") return refuse(409, R.closed);
    if (!(await repo.personRow(conn, sessionId, actor.no)).length) return refuse(403, R.joinFirst);
    const room: Room = { conn, s, roles: rolesIn(s, actor), still: false };
    const out = await work(room);
    if (out.ok && !room.still) await repo.bumpVersion(conn, sessionId);
    return out;
  });
}

// ── Starting, joining, presence, arrival ────────────────────────────────────

/** The session row and its opener's seat in it, inside the caller's transaction. */
async function insertOpenSession(conn: PoolConnection, openerNo: number, input: StartInput, stamp: SessionStamp, now: Date): Promise<number> {
  const id = await repo.insertSessionRow(conn, {
    title: input.title,
    circleId: input.circleId,
    facilitatorNo: openerNo,
    durationMin: input.durationMin,
    state: JSON.stringify(defaultSessionState()),
    stamp: JSON.stringify(stamp),
    now,
  });
  await repo.insertPerson(conn, id, openerNo, now);
  return id;
}

/** Open a session. The opener facilitates and is in the room. */
export async function startSession(pool: Pool, openerNo: number, input: StartInput, now = new Date()): Promise<number> {
  const stamp = await sessionStamp(pool, now);
  return repo.inTransaction(pool, (conn) => insertOpenSession(conn, openerNo, input, stamp, now));
}

/**
 * Open a session with items from the agenda library on its agenda, in the
 * order the opener ticked them (`libraryIds`, shared/sessionLibrary.ts). No
 * list, or an empty one, opens the room the way `startSession` does.
 *
 * All or none, and nothing written on a refusal: every item is locked and
 * checked (it waits, the opener may see it, it is for this circle or for none)
 * before the session row exists, because this transaction commits whatever it
 * wrote before a refusal returns. One that went elsewhere a moment ago refuses
 * the open with one sentence that names no item, and the page reads the list
 * again. The session row is new, so nobody else can wait on it, and the
 * library rows are the only locks this takes before it.
 */
export async function openSession(
  pool: Pool,
  opener: { no: number; userId: string; admin: boolean },
  input: StartInput,
  libraryIds: unknown,
  deps: { lapseContext?: () => LapseContext },
  now = new Date(),
): Promise<Outcome<{ id: number; taken: TakenRecord[] }>> {
  const ids = libraryIds == null ? [] : cleanIds(libraryIds);
  if (ids == null) return refuse(400, LIBRARY_REFUSALS.idsNeeded);
  if (!ids.length) return done({ id: await startSession(pool, opener.no, input, now), taken: [] });
  const viewer = await libraryViewer(pool, { userId: opener.userId, no: opener.no, admin: opener.admin }, deps);
  const stamp = await sessionStamp(pool, now);
  return repo.inTransaction(pool, async (conn) => {
    const plan = await lockForTaking(conn, ids, viewer, input.circleId);
    if (!plan.ok) return refuse(409, LIBRARY_REFUSALS.moved);
    const id = await insertOpenSession(conn, opener.no, input, stamp, now);
    const taken = await writeTakes(conn, { sessionId: id, take: plan.take, position: 1, takerNo: opener.no, inRoom: new Set([opener.no]), now });
    return done({ id, taken });
  });
}

/**
 * Bring items from the agenda library onto an open room's agenda: anyone in
 * the room, for the items they may see that fit its circle, the way anyone in
 * the room brings an item over from last time. The room's consent to the
 * agenda is the circle's check.
 *
 * All or none, and every refusal before the first write: the items are locked
 * after the session row and checked, the agenda's room (`maxAgenda`) and the
 * entries' room (each note is an entry, counted for the session and for
 * whoever wrote it) are measured, and only then is anything written. An item
 * already on this agenda is a quiet yes, so a second tap moves nothing.
 */
export async function bringFromLibrary(
  pool: Pool,
  sessionId: number,
  actor: Actor & { userId: string },
  raw: unknown,
  deps: { lapseContext?: () => LapseContext },
  now = new Date(),
): Promise<Outcome<{ ids: number[]; taken: TakenRecord[]; title: string }>> {
  const ids = cleanIds(bodyOf(raw).ids);
  if (ids == null || !ids.length) return refuse(400, LIBRARY_REFUSALS.idsNeeded);
  const viewer = await libraryViewer(pool, { userId: actor.userId, no: actor.no, admin: actor.admin }, deps);
  return inRoom(pool, sessionId, actor, async (room) => {
    const { conn, s } = room;
    const plan = await lockForTaking(conn, ids, viewer, s.circleId, await takenBySession(conn, sessionId));
    if (!plan.ok) return refuse(409, LIBRARY_REFUSALS.moved);
    if (!plan.take.length) {
      room.still = true;
      return done({ ids: [], taken: [], title: s.title });
    }
    const items = (await repo.itemRows(conn, sessionId)).map(mapItem);
    if (items.length + plan.take.length > SESSION_LIMITS.maxAgenda) return refuse(409, R.agendaFull);
    const noted = plan.take.filter((r) => r.note);
    if (noted.length) {
      const all = (await repo.entryCounts(conn, sessionId, 0)).all;
      if (all + noted.length > SESSION_LIMITS.maxEntries) return refuse(409, R.entriesFull);
      for (const by of Array.from(new Set(noted.map(noteAuthor)))) {
        const theirs = noted.filter((r) => noteAuthor(r) === by).length;
        if ((await repo.entryCounts(conn, sessionId, by)).mine + theirs > SESSION_LIMITS.maxEntriesPerPerson) return refuse(409, R.entriesFull);
      }
    }
    const people = new Set((await repo.peopleRows(conn, sessionId)).map((r) => Number(r.member_no)));
    const position = items.reduce((m, i) => Math.max(m, i.position), 0) + 1;
    const taken = await writeTakes(conn, { sessionId, take: plan.take, position, takerNo: actor.no, inRoom: people, now });
    return done({ ids: taken.map((t) => t.libraryId), taken, title: s.title });
  });
}

/** Join an open session. Joining twice is a quiet yes. */
export async function joinSession(pool: Pool, sessionId: number, no: number, now = new Date()): Promise<Outcome<{ joined: boolean }>> {
  return repo.inTransaction(pool, async (conn) => {
    const rows = await repo.sessionRow(conn, sessionId, true);
    if (!rows.length) return refuse(404, R.notFound);
    if (mapSession(rows[0]).status !== "open") return refuse(409, R.closed);
    if ((await repo.personRow(conn, sessionId, no)).length) {
      await repo.touchPerson(conn, sessionId, no, now);
      return done({ joined: false });
    }
    if ((await repo.countPeople(conn, sessionId)) >= SESSION_LIMITS.maxPeople) return refuse(409, R.full);
    await repo.insertPerson(conn, sessionId, no, now);
    await repo.bumpVersion(conn, sessionId);
    return done({ joined: true });
  });
}

/** "Still here." No version moves; the ETag's presence bucket carries it. */
export async function markHere(pool: Pool, sessionId: number, no: number | null, now = new Date()): Promise<Outcome<null>> {
  const rows = await repo.sessionRow(pool, sessionId);
  if (!rows.length) return refuse(404, R.notFound);
  if (mapSession(rows[0]).status !== "open") return refuse(409, R.closed);
  if (no == null || !(await repo.touchPerson(pool, sessionId, no, now))) return refuse(403, R.joinFirst);
  return done(null);
}

export async function saveArrival(pool: Pool, sessionId: number, actor: Actor, raw: unknown, now = new Date()): Promise<Outcome<null>> {
  const b = bodyOf(raw);
  if (!isArrivalScore(b.score)) return refuse(400, R.arrivalScore);
  const score = b.score;
  const wish = cleanLine(b.wish, SESSION_LIMITS.wish);
  const forNo = readFor(b);
  if (!forNo.ok) return forNo;
  return inRoom(pool, sessionId, actor, async ({ conn, roles }) => {
    const who = await fillFor(conn, sessionId, roles.facilitates, actor.no, forNo.value);
    if (!who.ok) return who;
    if (who.value == null) {
      await repo.writeArrival(conn, sessionId, actor.no, score, wish, now);
      await keepFills(conn, sessionId, "arrival", actor.no, actor.no, now);
      return done(null);
    }
    // Given for somebody else (0288): what they had goes in the row, so an undo can put it back.
    const had = mapPerson((await repo.personRow(conn, sessionId, who.value))[0]);
    await fillsRepo.writeArrivalFor(conn, sessionId, who.value, score, wish);
    await recordFill(
      conn,
      {
        sessionId,
        actorNo: actor.no,
        personNo: who.value,
        target: "arrival",
        // An arrival is keyed by whose it is.
        targetId: who.value,
        act: had.arrival == null ? "added" : "changed",
        before: had.arrival == null ? null : { score: had.arrival, wish: had.wish },
      },
      now,
    );
    return done(null);
  });
}

// ── The session's own words ─────────────────────────────────────────────────

/**
 * Rename the session: the facilitator, the secretary, or an admin who has
 * joined. The title is cleaned to one line and cut to its limit, the same way
 * the start cleans it; any other key in the body is ignored. Sending the title
 * it already has is a quiet yes that moves no version, so a save pressed twice
 * costs every open page nothing.
 */
export async function patchSession(pool: Pool, sessionId: number, actor: Actor, raw: unknown): Promise<Outcome<null>> {
  const title = cleanLine(bodyOf(raw).title, SESSION_LIMITS.title);
  if (!title) return refuse(400, R.titleNeeded);
  return inRoom(pool, sessionId, actor, async (room) => {
    if (!room.roles.notes) return refuse(403, R.notesOnly);
    if (title === room.s.title) {
      room.still = true;
      return done(null);
    }
    await repo.writeSessionTitle(room.conn, sessionId, title);
    return done(null);
  });
}

// ── The agenda ──────────────────────────────────────────────────────────────

export async function addItem(pool: Pool, sessionId: number, actor: Actor, raw: unknown, now = new Date()): Promise<Outcome<{ id: number }>> {
  const b = bodyOf(raw);
  const title = cleanLine(b.title, SESSION_LIMITS.agendaTitle);
  if (!title) return refuse(400, R.itemTitleNeeded);
  if (!isItemAim(b.aim)) return refuse(400, R.aimNeeded);
  const aim = b.aim;
  const minutes = cleanMinutes(b.minutes);
  if (minutes == null) return refuse(400, R.minutesRange);
  let fromSessionId: number | null = null;
  if (b.fromSessionId != null) {
    fromSessionId = posInt(b.fromSessionId);
    if (fromSessionId == null) return refuse(400, R.fromSession);
  }
  const forNo = readFor(b);
  if (!forNo.ok) return forNo;
  return inRoom(pool, sessionId, actor, async ({ conn, s, roles }) => {
    const who = await fillFor(conn, sessionId, roles.facilitates, actor.no, forNo.value);
    if (!who.ok) return who;
    const items = (await repo.itemRows(conn, sessionId)).map(mapItem);
    if (items.length >= SESSION_LIMITS.maxAgenda) return refuse(409, R.agendaFull);
    if (fromSessionId != null) {
      const from = await repo.sessionRow(conn, fromSessionId);
      const prev = from.length ? mapSession(from[0]) : null;
      if (!prev || prev.status !== "closed" || !s.circleId || prev.circleId !== s.circleId) return refuse(400, R.fromSession);
      // One copy of each thing brought over. The session row is held, so two
      // taps at once are decided one after the other, against the same list.
      const key = title.toLowerCase();
      if (items.some((i) => i.fromSessionId === fromSessionId && i.title.toLowerCase() === key)) return refuse(409, R.alreadyOnAgenda);
    }
    const position = items.reduce((m, i) => Math.max(m, i.position), 0) + 1;
    const addedByNo = who.value ?? actor.no;
    const id = await repo.insertItem(conn, { sessionId, title, aim, minutes, position, addedByNo, fromSessionId, now });
    if (who.value != null) await recordFill(conn, { sessionId, actorNo: actor.no, personNo: who.value, target: "item", targetId: id, act: "added" }, now);
    // While the room votes (0290), a new item takes its place by the score, which is none yet.
    if (!s.state.orderSet) await sortByVotes(conn, sessionId, [...items, { id, status: "waiting", position }]);
    return done({ id });
  });
}

/** Seconds an active item has run since it last started, added to what it ran before. */
function usedAfter(item: ItemRec, state: SessionState, now: number): number {
  const started = item.startedMs ?? (state.activeItemId === item.id ? state.itemStartedAt : null);
  const extra = started == null ? 0 : Math.max(0, Math.round((now - started) / 1000));
  return item.usedSeconds + extra;
}

export async function patchItem(
  pool: Pool,
  sessionId: number,
  actor: Actor,
  itemId: number,
  raw: unknown,
  now = new Date(),
): Promise<Outcome<null>> {
  const b = bodyOf(raw);
  const words: { title?: string; aim?: ItemAim; minutes?: number; presenter?: number | null } = {};
  if (has(b, "title")) {
    const t = cleanLine(b.title, SESSION_LIMITS.agendaTitle);
    if (!t) return refuse(400, R.itemTitleNeeded);
    words.title = t;
  }
  if (has(b, "aim")) {
    if (!isItemAim(b.aim)) return refuse(400, R.aimNeeded);
    words.aim = b.aim;
  }
  if (has(b, "minutes")) {
    const m = cleanMinutes(b.minutes);
    if (m == null) return refuse(400, R.minutesRange);
    words.minutes = m;
  }
  if (has(b, "presenterUserId")) {
    if (b.presenterUserId !== null && posInt(b.presenterUserId) == null) return refuse(400, R.hostsPerson);
    words.presenter = b.presenterUserId as number | null;
  }
  let position: number | null = null;
  if (has(b, "position")) {
    position = typeof b.position === "number" && Number.isInteger(b.position) ? b.position : null;
    if (position == null) return refuse(400, R.positionNeeded);
  }
  let status: ItemStatus | null = null;
  if (has(b, "status")) {
    if (b.status !== "waiting" && b.status !== "done" && b.status !== "parked") return refuse(400, R.itemStatusUnknown);
    status = b.status;
  }

  return inRoom(pool, sessionId, actor, async ({ conn, s, roles }) => {
    const items = (await repo.itemRows(conn, sessionId)).map(mapItem);
    const item = items.find((i) => i.id === itemId);
    if (!item) return refuse(404, R.itemUnknown);
    // The title and the plan answer to different rules. A field sent with the
    // value it already has changes nothing, so it asks for no right: a form
    // that sends the whole item back with only the title retyped still works
    // for the person who added it.
    const titleMoves = words.title !== undefined && words.title !== item.title;
    const planMoves =
      (words.aim !== undefined && words.aim !== item.aim) ||
      (words.minutes !== undefined && words.minutes !== item.minutes) ||
      (words.presenter !== undefined && words.presenter !== item.presenterUserId);
    if (titleMoves && !mayEditItemTitle(item, actor.no, roles)) return refuse(403, R.notesOnly);
    if (planMoves && !mayEditItemPlan(item, actor.no, roles)) {
      return refuse(403, item.addedBy === actor.no ? R.aimMinutesNotes : R.notesOnly);
    }
    if ((position != null || status != null) && !roles.runs) return refuse(403, R.facilitatorOnly);
    if (words.presenter != null && !(await repo.personRow(conn, sessionId, words.presenter)).length) return refuse(400, R.hostsPerson);

    if (titleMoves || planMoves) {
      // The facilitator changing what somebody else added is a fill-in (0288);
      // the person changing it themselves makes it theirs again.
      if (roles.facilitates && item.addedBy !== actor.no && item.addedBy > 0) {
        await recordFill(
          conn,
          {
            sessionId,
            actorNo: actor.no,
            personNo: item.addedBy,
            target: "item",
            targetId: item.id,
            act: "changed",
            before: { title: item.title, aim: item.aim, minutes: item.minutes, presenterNo: item.presenterUserId },
          },
          now,
        );
      } else if (item.addedBy === actor.no) {
        await keepFills(conn, sessionId, "item", item.id, actor.no, now);
      }
      await repo.writeItemWords(conn, item.id, {
        title: words.title ?? item.title,
        aim: words.aim ?? item.aim,
        minutes: words.minutes ?? item.minutes,
        presenterNo: words.presenter === undefined ? item.presenterUserId : words.presenter,
      });
    }
    if (position != null) {
      // Move it, then number the agenda 1..n again, so positions never tie.
      const order = items.filter((i) => i.id !== item.id);
      const at = Math.max(0, Math.min(order.length, position - 1));
      order.splice(at, 0, item);
      for (let i = 0; i < order.length; i += 1) {
        if (order[i].position !== i + 1) await repo.writeItemPosition(conn, order[i].id, i + 1);
      }
    }
    if (status != null && status !== item.status) {
      const nowMs = now.getTime();
      if (item.status === "active" || s.state.activeItemId === item.id) {
        // The active item stops: its clock adds up and the room has no item on screen.
        await repo.finishItemClock(conn, item.id, status, usedAfter(item, s.state, nowMs), now);
        if (s.state.activeItemId === item.id) {
          const state = applySessionAction(s.state, { type: "item", itemId: null }, nowMs);
          await repo.writeState(conn, sessionId, JSON.stringify(state));
        }
      } else {
        await repo.writeItemStatus(conn, item.id, status);
      }
    }
    return done(null);
  });
}

// ── The room votes its agenda (0290, shared/sessionVotes.ts) ────────────────

/**
 * One person's vote on a waiting item: 1 up, -1 down, 0 to take it back. Their
 * own, the same as a consent answer: nobody votes for anybody else. While the
 * order is not set, the agenda sorts itself again by the score.
 */
export async function voteOnItem(pool: Pool, sessionId: number, actor: Actor, itemId: number, raw: unknown, now = new Date()): Promise<Outcome<null>> {
  const b = bodyOf(raw);
  if (!isAgendaVote(b.vote)) return refuse(400, VR.voteValue);
  if (has(b, "forUserId") && b.forUserId !== actor.no) return refuse(403, OB.ownAnswer);
  const vote = b.vote;
  return inRoom(pool, sessionId, actor, async ({ conn, s }) => {
    const items = (await repo.itemRows(conn, sessionId)).map(mapItem);
    const item = items.find((i) => i.id === itemId);
    if (!item) return refuse(404, R.itemUnknown);
    if (s.state.orderSet) return refuse(409, VR.voteClosed);
    if (item.status !== "waiting") return refuse(409, VR.waitingOnly);
    if (vote === 0) await votesRepo.deleteVote(conn, itemId, actor.no);
    else await votesRepo.writeVote(conn, { sessionId, itemId, no: actor.no, vote, now });
    await sortByVotes(conn, sessionId, items);
    return done(null);
  });
}

/**
 * The facilitator sets the order the room voted (`set` true: the vote closes
 * and the order stands), or opens the vote again (`set` false: the agenda
 * sorts by the score once more).
 */
export async function setAgendaOrder(pool: Pool, sessionId: number, actor: Actor, raw: unknown): Promise<Outcome<{ state: SessionState }>> {
  const b = bodyOf(raw);
  if (typeof b.set !== "boolean") return refuse(400, VR.setValue);
  const set = b.set;
  return inRoom(pool, sessionId, actor, async (room) => {
    const { conn, s, roles } = room;
    if (!roles.runs) return refuse(403, R.facilitatorOnly);
    if (s.state.orderSet === set) {
      room.still = true;
      return done({ state: s.state });
    }
    const items = (await repo.itemRows(conn, sessionId)).map(mapItem);
    await sortByVotes(conn, sessionId, items);
    const state = { ...s.state, orderSet: set };
    await repo.writeState(conn, sessionId, JSON.stringify(state));
    return done({ state });
  });
}

// ── The room's state ────────────────────────────────────────────────────────

/**
 * The facilitator moves the room. Choosing an item is the one move that also
 * writes rows: the item that was active becomes done with its seconds added
 * up, and the chosen one becomes active with its clock started.
 */
export async function actInRoom(
  pool: Pool,
  sessionId: number,
  actor: Actor,
  action: SessionAction,
  now = new Date(),
): Promise<Outcome<{ state: SessionState }>> {
  return inRoom(pool, sessionId, actor, async ({ conn, s, roles }) => {
    if (!roles.runs) return refuse(403, R.facilitatorOnly);
    const nowMs = now.getTime();
    let move: SessionAction = action;
    // Going on to the actions or the close leaves the items behind, so the
    // item on screen stops there, exactly as wrapping it up would stop it.
    const leavesItems = action.type === "go" && (action.stage === "actions" || action.stage === "close");
    if (action.type === "item" || leavesItems) {
      const chosenId = action.type === "item" ? action.itemId : null;
      const items = (await repo.itemRows(conn, sessionId)).map(mapItem);
      if (chosenId != null && !items.some((i) => i.id === chosenId)) return refuse(404, R.itemUnknown);
      for (const item of items) {
        const isActive = item.status === "active" || s.state.activeItemId === item.id;
        if (isActive && item.id !== chosenId) {
          await repo.finishItemClock(conn, item.id, "done", usedAfter(item, s.state, nowMs), now);
        }
      }
      const chosen = items.find((i) => i.id === chosenId);
      if (chosen && chosen.status !== "active") await repo.startItemClock(conn, chosen.id, now);
    }
    if (action.type === "round") {
      // A round is spoken by people who are in the room.
      const inRoomNos = new Set((await repo.peopleRows(conn, sessionId)).map((r) => Number(r.member_no)));
      move = { ...action, order: action.order.filter((n) => inRoomNos.has(n)) };
    }
    const from = leavesItems ? applySessionAction(s.state, { type: "item", itemId: null }, nowMs) : s.state;
    const state = applySessionAction(from, move, nowMs);
    await repo.writeState(conn, sessionId, JSON.stringify(state));
    return done({ state });
  });
}

/** Hand the facilitation on, or name a secretary. The facilitator, or an admin. */
export async function setHosts(pool: Pool, sessionId: number, actor: Actor, raw: unknown): Promise<Outcome<null>> {
  const b = bodyOf(raw);
  let facilitator: number | undefined;
  let secretary: number | null | undefined;
  if (has(b, "facilitatorUserId")) {
    const n = posInt(b.facilitatorUserId);
    if (n == null) return refuse(400, R.hostsPerson);
    facilitator = n;
  }
  if (has(b, "secretaryUserId")) {
    if (b.secretaryUserId === null) secretary = null;
    else {
      const n = posInt(b.secretaryUserId);
      if (n == null) return refuse(400, R.hostsPerson);
      secretary = n;
    }
  }
  if (facilitator === undefined && secretary === undefined) return refuse(400, R.hostsPerson);
  return inRoom(pool, sessionId, actor, async ({ conn, s, roles }) => {
    if (!roles.runs) return refuse(403, R.facilitatorOnly);
    for (const n of [facilitator, secretary]) {
      if (n != null && !(await repo.personRow(conn, sessionId, n)).length) return refuse(400, R.hostsPerson);
    }
    await repo.writeHosts(conn, sessionId, facilitator ?? s.facilitatorNo, secretary === undefined ? s.secretaryNo : secretary);
    return done(null);
  });
}

// ── Entries ─────────────────────────────────────────────────────────────────

/** A seat id from a body: undefined when absent, null to clear, a string to check. */
function readSeat(b: Record<string, unknown>): Outcome<string | null | undefined> {
  if (!has(b, "ownerSeatId")) return done(undefined);
  if (b.ownerSeatId === null || b.ownerSeatId === "") return done(null);
  if (typeof b.ownerSeatId !== "string" || b.ownerSeatId.length > 64) return refuse(400, R.seatUnknown);
  return done(b.ownerSeatId);
}

function readDue(b: Record<string, unknown>): Outcome<string | null | undefined> {
  if (!has(b, "dueOn")) return done(undefined);
  if (b.dueOn === null || b.dueOn === "") return done(null);
  const d = cleanDueOn(b.dueOn);
  return d ? done(d) : refuse(400, R.dueOn);
}

export async function addEntry(pool: Pool, sessionId: number, actor: Actor, raw: unknown, now = new Date()): Promise<Outcome<{ id: number }>> {
  const b = bodyOf(raw);
  if (!isEntryKind(b.kind)) return refuse(400, R.entryKind);
  const kind = b.kind;
  const text = cleanText(b.text, SESSION_LIMITS.text);
  if (!text) return refuse(400, R.textNeeded);
  let itemId: number | null = null;
  if (b.itemId != null) {
    itemId = posInt(b.itemId);
    if (itemId == null) return refuse(400, R.itemUnknown);
  }
  const seat = readSeat(b);
  if (!seat.ok) return seat;
  const due = readDue(b);
  if (!due.ok) return due;
  if (seat.value && !(await seatBook(pool, null)).active.has(seat.value)) return refuse(400, R.seatUnknown);
  const forNo = readFor(b);
  if (!forNo.ok) return forNo;
  return inRoom(pool, sessionId, actor, async ({ conn, roles }) => {
    const who = await fillFor(conn, sessionId, roles.facilitates, actor.no, forNo.value);
    if (!who.ok) return who;
    const authorNo = who.value ?? actor.no;
    if (itemId != null && !(await repo.itemRows(conn, sessionId)).some((r) => Number(r.id) === itemId)) return refuse(404, R.itemUnknown);
    // Written in their name, it counts against their share of the session.
    const counts = await repo.entryCounts(conn, sessionId, authorNo);
    if (counts.all >= SESSION_LIMITS.maxEntries) return refuse(409, R.entriesFull);
    if (counts.mine >= SESSION_LIMITS.maxEntriesPerPerson) return refuse(409, R.yoursFull);
    const id = await repo.insertEntry(conn, {
      sessionId,
      itemId,
      kind,
      text,
      authorNo,
      ownerSeatId: seat.value ?? null,
      dueOn: due.value ?? null,
      now,
    });
    if (who.value != null) await recordFill(conn, { sessionId, actorNo: actor.no, personNo: who.value, target: "entry", targetId: id, act: "added" }, now);
    return done({ id });
  });
}

/** The consent round on one proposal, counted over the people here now. */
async function decisionTally(conn: PoolConnection, sessionId: number, entryId: number, now: number): Promise<ConsentTally> {
  const people = (await repo.peopleRows(conn, sessionId)).map(mapPerson);
  const here = people.filter((p) => isPresentAt(p, now)).map((p) => p.no);
  const target = `decision:${entryId}`;
  const answers = (await repo.responseRows(conn, sessionId))
    .map(mapResponse)
    .filter((r) => r.target === target && isConsentValue(r.value))
    .map(asAnswer);
  return consentTally(answers, here, now);
}

export async function patchEntry(
  pool: Pool,
  sessionId: number,
  actor: Actor,
  entryId: number,
  raw: unknown,
  now = new Date(),
): Promise<Outcome<null>> {
  const b = bodyOf(raw);
  const claim = b.claim === true;
  const release = b.release === true;
  // The facilitator hands an action to somebody in the room (0288).
  let handTo: number | undefined;
  if (has(b, "ownerUserId")) {
    const n = posInt(b.ownerUserId);
    if (n == null) return refuse(400, OB.personNotHere);
    handTo = n;
  }
  let text: string | undefined;
  if (has(b, "text")) {
    const t = cleanText(b.text, SESSION_LIMITS.text);
    if (!t) return refuse(400, R.textNeeded);
    text = t;
  }
  const seat = readSeat(b);
  if (!seat.ok) return seat;
  const due = readDue(b);
  if (!due.ok) return due;
  let status: EntryStatus | undefined;
  if (has(b, "status")) {
    if (!(ENTRY_STATUSES as readonly string[]).includes(String(b.status))) return refuse(400, R.entryStatusUnknown);
    status = b.status as EntryStatus;
  }
  if (seat.value && !(await seatBook(pool, null)).active.has(seat.value)) return refuse(400, R.seatUnknown);

  return inRoom(pool, sessionId, actor, async ({ conn, roles }) => {
    const rows = await repo.entryRow(conn, sessionId, entryId);
    if (!rows.length) return refuse(404, R.entryUnknown);
    const e = mapEntry(rows[0]);
    const may = entryRights(e, actor.no, roles);
    const next = { text: e.text, status: e.status, ownerNo: e.ownerNo, ownerSeatId: e.ownerSeatId, dueOn: e.dueOn, claimedAt: e.claimedAt ? new Date(e.claimedAt) : null };

    if (handTo !== undefined) {
      if (e.kind !== "action") return refuse(400, OB.holderNotAction);
      if (handTo !== actor.no) {
        const who = await fillFor(conn, sessionId, roles.facilitates, actor.no, handTo);
        if (!who.ok) return who;
      }
      if (e.ownerNo != null && e.ownerNo !== handTo) return refuse(409, R.heldAlready);
      next.ownerNo = handTo;
      next.claimedAt = e.ownerNo === handTo ? next.claimedAt : now;
    }
    if (claim || release) {
      if (e.kind !== "action") return refuse(400, R.notAction);
      if (claim) {
        if (e.ownerNo != null && e.ownerNo !== actor.no) return refuse(409, R.heldAlready);
        next.ownerNo = actor.no;
        next.claimedAt = e.ownerNo === actor.no ? next.claimedAt : now;
      } else {
        if (e.ownerNo == null) return refuse(409, R.notHeld);
        if (!may.release) return refuse(403, R.releaseNotYours);
        next.ownerNo = null;
        next.claimedAt = null;
      }
    }
    // A proposal decided by consent is final. New words on an open one need a
    // new consent round, so the answers given to the old words are cleared.
    const decided = e.kind === "decision" && e.status === "done";
    const newWords = text !== undefined && text !== e.text;
    if (text !== undefined) {
      if (!may.text) return refuse(403, R.notYours);
      if (decided && newWords) return refuse(409, R.decisionFinal);
      next.text = text;
    }
    if (seat.value !== undefined) {
      if (!may.seat) return refuse(403, R.notYours);
      next.ownerSeatId = seat.value;
    }
    if (due.value !== undefined) {
      if (!may.dueOn) return refuse(403, R.notYours);
      next.dueOn = due.value;
    }
    if (status !== undefined && status !== e.status) {
      if (!may.status) return refuse(403, R.notYours);
      // Into "decided" or out of it is the facilitator's move, and out of it is never made.
      if (e.kind === "decision" && (status === "done" || decided) && !roles.runs) return refuse(403, R.facilitatorOnly);
      if (decided) return refuse(409, R.decisionFinal);
      if (e.kind === "decision" && status === "done") {
        // Words changed in this same request have had no round at all.
        if (newWords || !(await decisionTally(conn, sessionId, e.id, now.getTime())).consented) return refuse(409, R.decisionNotConsented);
      }
      next.status = status;
    }
    // Whose it is: an action's holder, or else whoever wrote it. The facilitator
    // filling in its holder, words, role or date for them is a fill-in (0288),
    // and what it replaced goes in the row for an undo. Its status is running
    // the room, and is not.
    const filled =
      next.text !== e.text || next.ownerNo !== e.ownerNo || next.ownerSeatId !== e.ownerSeatId || next.dueOn !== e.dueOn;
    if (filled) {
      const whose = e.kind === "action" && next.ownerNo != null ? next.ownerNo : e.authorNo;
      if (roles.facilitates && whose !== actor.no && whose > 0) {
        await recordFill(
          conn,
          {
            sessionId,
            actorNo: actor.no,
            personNo: whose,
            target: "entry",
            targetId: e.id,
            act: "changed",
            before: { text: e.text, ownerNo: e.ownerNo, ownerSeatId: e.ownerSeatId, dueOn: e.dueOn, claimedAt: e.claimedAt },
          },
          now,
        );
      } else if (whose === actor.no || e.authorNo === actor.no || e.ownerNo === actor.no) {
        await keepFills(conn, sessionId, "entry", e.id, actor.no, now);
      }
    }
    await repo.writeEntry(conn, e.id, next);
    if (e.kind === "decision" && newWords) await repo.deleteResponsesForTargets(conn, sessionId, [`decision:${e.id}`]);
    return done(null);
  });
}

export async function removeEntry(pool: Pool, sessionId: number, actor: Actor, entryId: number): Promise<Outcome<null>> {
  return inRoom(pool, sessionId, actor, async ({ conn, roles }) => {
    const rows = await repo.entryRow(conn, sessionId, entryId);
    if (!rows.length) return refuse(404, R.entryUnknown);
    const e = mapEntry(rows[0]);
    if (!entryRights(e, actor.no, roles).remove) return refuse(403, R.notYours);
    if (e.kind === "decision" && e.status === "done") return refuse(409, R.decisionFinal);
    await repo.deleteEntryRow(conn, e.id);
    if (e.kind === "decision") await repo.deleteResponsesForTargets(conn, sessionId, [`decision:${e.id}`]);
    return done(null);
  });
}

// ── Checking a proposal (0297) ──────────────────────────────────────────────

/** The words a check read, kept as a hash so the check holds no earlier draft of them. */
const wordsHash = (text: string): string => createHash("sha256").update(text, "utf8").digest("hex");

/** What a check reads besides the room: the running season, and whose terms still run. */
export interface CheckContext {
  season: { name: string; goals: readonly string[] } | null;
  lapseContext?: () => LapseContext;
}

/**
 * Check an open proposal (shared/sessionCheck.ts): the facilitator, or the
 * person who proposed it, asks for the village's own read, and everybody in
 * the room sees the same read. A second check replaces the first. The read
 * holds no person: a named role's holder is a place, never a name.
 */
export async function checkEntry(
  pool: Pool,
  sessionId: number,
  actor: Actor,
  entryId: number,
  ctx: CheckContext,
  now = new Date(),
): Promise<Outcome<null>> {
  // Read before the room's lock: the transaction holds the session row on one
  // of the pool's few connections, and a read that reached back to the pool
  // from inside it could wait behind writers queued on that same row.
  const purpose = await governingPurpose(pool);
  const seatings = await listOrgAssignments(pool, ctx.lapseContext?.());
  return inRoom(pool, sessionId, actor, async ({ conn, s, roles }) => {
    const rows = await repo.entryRow(conn, sessionId, entryId);
    if (!rows.length) return refuse(404, R.entryUnknown);
    const e = mapEntry(rows[0]);
    if (e.kind !== "decision") return refuse(409, CR.notAProposal);
    if (!roles.runs && e.authorNo !== actor.no) return refuse(403, CR.notYours);
    if (e.status === "done") return refuse(409, CR.decided);
    if (e.status !== "open") return refuse(409, CR.notOpen);
    const seats = (await seatBook(conn, s.circleId)).options;
    const nowMs = now.getTime();
    const here = new Set((await repo.peopleRows(conn, sessionId)).map(mapPerson).filter((p) => isPresentAt(p, nowMs)).map((p) => p.no));
    // Only the roles the words name are asked after: one read of who sits where, and a number per holder.
    const places = new Map<string, HolderPlace>();
    for (const seat of seatsNamed(e.text, seats, e.ownerSeatId)) {
      const holders = liveHoldersOf(seatings, seat.id);
      if (!holders.length) continue;
      const nos = await Promise.all(holders.map((u) => memberNo(conn, u)));
      places.set(seat.id, nos.some((n) => n != null && here.has(n)) ? "here" : "away");
    }
    const read = instantRead({
      text: e.text,
      season: ctx.season,
      seats,
      ownerSeatId: e.ownerSeatId,
      holderOf: (id) => places.get(id) ?? "open",
      purpose: { statement: purpose.statement ?? "", writtenAt: purpose.writtenAt ?? "" },
    });
    await checksRepo.writeCheck(conn, { entryId: e.id, sessionId, hash: wordsHash(e.text), read: JSON.stringify(read), now });
    return done(null);
  });
}

// ── Filled in for somebody: the undo (0288) ─────────────────────────────────

/**
 * Take back a fill-in: the person it was for, or whoever filled it in, while
 * the room is open. It puts back what was there, and only the latest fill-in
 * still standing on a thing can be taken back, so a run of them unwinds in
 * order. Something talked about or decided since stays as it is.
 */
export async function undoFill(pool: Pool, sessionId: number, actor: Actor, fillId: number, now = new Date()): Promise<Outcome<null>> {
  return inRoom(pool, sessionId, actor, async ({ conn, s }) => {
    const rows = (await fillsRepo.fillRows(conn, sessionId)).map(mapFill);
    const f = rows.find((r) => r.id === fillId);
    if (!f) return refuse(404, OB.fillUnknown);
    if (!mayUndo(f, actor.no, true)) return refuse(403, OB.undoNotYours);
    if (f.undone) return refuse(409, OB.undoneAlready);
    if (f.kept || latestStanding(rows, f)?.id !== f.id) return refuse(409, OB.pastUndoing);
    const before = f.before ?? {};

    if (f.target === "arrival") {
      const score = before.score;
      if (f.act === "changed" && isArrivalScore(score)) {
        await fillsRepo.writeArrivalFor(conn, sessionId, f.personNo, score, typeof before.wish === "string" ? before.wish : null);
      } else {
        await fillsRepo.clearArrival(conn, sessionId, f.personNo);
      }
    } else if (f.target === "item") {
      const item = (await repo.itemRows(conn, sessionId)).map(mapItem).find((i) => i.id === f.targetId);
      if (!item) return refuse(409, OB.pastUndoing);
      if (f.act === "added") {
        // Only an item still waiting goes: one the room has started has a clock and a record.
        if (item.status !== "waiting" || s.state.activeItemId === item.id) return refuse(409, OB.pastUndoing);
        await fillsRepo.deleteItemRow(conn, sessionId, item.id);
      } else {
        if (item.status === "done") return refuse(409, OB.pastUndoing);
        const title = typeof before.title === "string" && before.title ? before.title : item.title;
        const presenter = before.presenterNo;
        await repo.writeItemWords(conn, item.id, {
          title,
          aim: isItemAim(before.aim) ? before.aim : item.aim,
          minutes: typeof before.minutes === "number" ? before.minutes : item.minutes,
          presenterNo: typeof presenter === "number" ? presenter : null,
        });
      }
    } else {
      const rowsE = await repo.entryRow(conn, sessionId, f.targetId);
      if (!rowsE.length) return refuse(409, OB.pastUndoing);
      const e = mapEntry(rowsE[0]);
      if (e.kind === "decision" && e.status === "done") return refuse(409, OB.pastUndoing);
      if (f.act === "added") {
        await repo.deleteEntryRow(conn, e.id);
        if (e.kind === "decision") await repo.deleteResponsesForTargets(conn, sessionId, [`decision:${e.id}`]);
      } else {
        const text = typeof before.text === "string" && before.text ? before.text : e.text;
        const claimedAt = typeof before.claimedAt === "string" ? new Date(before.claimedAt) : null;
        await repo.writeEntry(conn, e.id, {
          text,
          status: e.status,
          ownerNo: typeof before.ownerNo === "number" ? before.ownerNo : null,
          ownerSeatId: typeof before.ownerSeatId === "string" ? before.ownerSeatId : null,
          dueOn: typeof before.dueOn === "string" ? before.dueOn : null,
          claimedAt,
        });
        // Its words back where they were, the consent round on them starts again.
        if (e.kind === "decision" && text !== e.text) await repo.deleteResponsesForTargets(conn, sessionId, [`decision:${e.id}`]);
      }
    }
    await fillsRepo.markUndone(conn, f.id, now);
    return done(null);
  });
}

// ── Answers ─────────────────────────────────────────────────────────────────

export async function respond(pool: Pool, sessionId: number, actor: Actor, raw: unknown, now = new Date()): Promise<Outcome<null>> {
  const b = bodyOf(raw);
  // Every answer is the answerer's own (0288): a consent, a concern, an
  // objection, a night or a word is never given for somebody else, by the
  // facilitator or anybody. Naming anyone but yourself is refused outright.
  const forNo = readFor(b);
  if (!forNo.ok || (forNo.value !== undefined && forNo.value !== actor.no)) return refuse(403, OB.ownAnswer);
  const target = parseResponseTarget(b.target);
  if (!target) return refuse(400, R.targetUnknown);
  let value: string;
  let text: string | null = null;
  let answerBy: Date | null = null;
  if (target === "agenda" || target.startsWith("decision:")) {
    if (!isConsentValue(b.value)) return refuse(400, R.consentValue);
    value = b.value;
    if (consentNeedsWords(b.value)) {
      text = cleanLine(b.text, SESSION_LIMITS.text);
      if (!text) return refuse(400, R.consentWords);
    }
    // A night names when it ends (Rye, 2026-10-23): no time, no night.
    if (b.value === "sleep") {
      const by = cleanAnswerBy(b.answerBy, now.getTime());
      if (!by.ok) return refuse(400, by.error);
      answerBy = new Date(by.value);
    }
  } else if (target === "word") {
    const w = cleanLine(b.value, SESSION_LIMITS.word);
    if (!w) return refuse(400, R.wordNeeded);
    value = w;
  } else {
    if (!(FACILITATION_VALUES as readonly string[]).includes(String(b.value))) return refuse(400, R.facilitationValue);
    value = String(b.value);
    text = cleanText(b.text, SESSION_LIMITS.text);
  }
  return inRoom(pool, sessionId, actor, async ({ conn }) => {
    if (target.startsWith("decision:")) {
      const rows = await repo.entryRow(conn, sessionId, Number(target.slice("decision:".length)));
      const e = rows.length ? mapEntry(rows[0]) : null;
      if (!e || e.kind !== "decision") return refuse(404, R.entryUnknown);
      if (e.status !== "open") return refuse(409, R.decisionClosed);
    }
    await repo.upsertResponse(conn, { sessionId, target, memberNo: actor.no, value, text, answerBy, now });
    return done(null);
  });
}

// ── The record ──────────────────────────────────────────────────────────────

interface RecordParts {
  s: SessionRec;
  items: ItemRec[];
  entries: EntryRec[];
  peopleNos: number[];
  tallies: Record<number, ConsentTally>;
  arrival: ArrivalSummary | null;
  circleName: string | null;
}

/** Both minutes, from rows. The close writes them; an erasure writes them again. */
async function composeMinutes(q: Pool | PoolConnection, p: RecordParts, lookup: MemberLookup): Promise<{ people: string; shareable: string }> {
  const nos = new Set<number>([...p.peopleNos, p.s.facilitatorNo, ...(p.s.secretaryNo ? [p.s.secretaryNo] : [])]);
  for (const e of p.entries) if (e.ownerNo != null) nos.add(e.ownerNo);
  const names = await namesFor(q, nos, lookup);
  const seats = await seatBook(q, p.s.circleId);
  const input = {
    title: p.s.title,
    circleName: p.circleName,
    createdAt: p.s.createdAt,
    closedAt: p.s.closedAt,
    durationMin: p.s.durationMin,
    stamp: p.s.stamp,
    facilitatorName: nameIn(names, p.s.facilitatorNo) ?? SESSION_SOMEONE,
    secretaryName: nameIn(names, p.s.secretaryNo),
    peopleNames: p.peopleNos.map((n) => nameIn(names, n) ?? SESSION_SOMEONE),
    arrival: p.arrival,
    items: p.items.map(itemOut),
    entries: p.entries.map((e) => entryOut(e, names, seats)),
    tallies: p.tallies,
  };
  return { people: buildMinutes(input, "people"), shareable: buildMinutes(input, "shareable") };
}

/**
 * What a close works out from the room's rows before it writes anything.
 * Pure, so the arithmetic is tested without a database.
 *
 *   unowned  actions nobody holds; a close is refused while there are any
 *   arrival  the arrival round as numbers only, which is what the record keeps
 *   present  people seen within PRESENT_WINDOW_MS
 *   tallies  each proposal's consent round, counted over the people present
 */
export function closePlan(
  entries: readonly { id: number; kind: EntryKind; status: EntryStatus; ownerNo: number | null; ownerSeatId: string | null }[],
  people: readonly { no: number; arrival: number | null; lastSeenMs: number | null }[],
  responses: readonly { no: number; target: string; value: string; answerBy?: number | null }[],
  now: number,
): { unowned: number[]; arrival: ArrivalSummary; present: number; tallies: Record<number, ConsentTally> } {
  const unowned = unownedActions(entries.map((e) => ({ id: e.id, kind: e.kind, status: e.status, ownerUserId: e.ownerNo, ownerSeatId: e.ownerSeatId })));
  const arrival = arrivalSummary(people.map((p) => p.arrival));
  const here = people.filter((p) => isPresentAt(p, now)).map((p) => p.no);
  const present = here.length;
  const tallies: Record<number, ConsentTally> = {};
  for (const d of entries.filter((e) => e.kind === "decision")) {
    const answers = responses
      .filter((r) => r.target === `decision:${d.id}` && isConsentValue(r.value))
      .map((r) => ({ who: r.no, value: r.value as ConsentValue, answerBy: r.answerBy ?? null }));
    tallies[d.id] = consentTally(answers, here, now);
  }
  return { unowned, arrival, present, tallies };
}

/** What a close hands back, for the notices that go out after it commits. */
export interface ClosedRecord {
  id: number;
  title: string;
  /** The actions that left with a person or a seat on them. */
  held: { entryId: number; text: string; dueOn: string | null; ownerNo: number | null; ownerSeatId: string | null }[];
  /** The items the session took from the agenda library, and how each left it. */
  brought?: SettledRecord[];
  /** Everybody who was in the room, so a notice skips whoever saw it happen. */
  peopleNos?: number[];
  /** The nights that outlive the call, each told to whoever asked for it (0281). */
  nights?: { entryId: number; text: string; sleeperNo: number; answerBy: number }[];
}

/**
 * What a close and the view need from the routes: names, circles' names, and
 * the season's reading of who still sits in a seat (the task cards' seats).
 */
export interface RoomContext {
  lookup: MemberLookup;
  circleName: (id: string | null) => string | null;
  lapseContext?: () => LapseContext;
}

/**
 * The close itself, inside a transaction that already holds the session row
 * and has seen it open. Refused while any action has nobody holding it. Then:
 * the active item stops at `clockStops` (now, unless the room went quiet
 * earlier), the arrival spread is stored and every arrival number and word
 * erased, each proposal's tally is kept, the minutes are written in both
 * audiences, and the session closes. The caller bumps the version.
 */
async function closeLocked(conn: PoolConnection, s: SessionRec, ctx: RoomContext, now: Date, clockStops: Date = now): Promise<Outcome<ClosedRecord>> {
  const sessionId = s.id;
  const nowMs = now.getTime();
  const entries = (await repo.entryRows(conn, sessionId)).map(mapEntry);
  const people = (await repo.peopleRows(conn, sessionId)).map(mapPerson);
  const responses = (await repo.responseRows(conn, sessionId)).map(mapResponse);
  const { unowned, arrival, tallies } = closePlan(entries, people, responses, nowMs);
  if (unowned.length) return refuse(409, CLOSE_REFUSAL, { unowned });

  let items = (await repo.itemRows(conn, sessionId)).map(mapItem);
  for (const item of items) {
    if (item.status === "active" || s.state.activeItemId === item.id) {
      await repo.finishItemClock(conn, item.id, "done", usedAfter(item, s.state, clockStops.getTime()), clockStops);
    }
  }
  items = (await repo.itemRows(conn, sessionId)).map(mapItem);
  await repo.eraseArrivals(conn, sessionId);
  // Nothing is undone after the close, so what an undo would put back goes too (0288).
  await fillsRepo.forgetBefores(conn, sessionId);

  const closedState = applySessionAction(s.state, { type: "item", itemId: null }, nowMs);
  const closed: SessionRec = { ...s, status: "closed", closedAt: now.toISOString(), state: closedState };
  const circleName = ctx.circleName(s.circleId);
  const minutes = await composeMinutes(
    conn,
    { s: closed, items, entries, peopleNos: people.map((p) => p.no), tallies, arrival, circleName },
    ctx.lookup,
  );
  // A proposal still open with somebody sleeping on it keeps its round after the call (0281).
  const nights: Record<number, { waiting: number; settled: boolean }> = {};
  for (const e of entries) {
    const t = tallies[e.id];
    if (e.kind === "decision" && e.status === "open" && t && t.sleeping > 0) nights[e.id] = { waiting: t.waiting, settled: false };
  }
  const summary: StoredSummary = {
    arrival,
    tallies,
    nights,
    circleName,
    counts: {
      people: people.length,
      items: items.length,
      entries: entries.length,
      actions: entries.filter((e) => e.kind === "action").length,
      decisions: entries.filter((e) => e.kind === "decision").length,
    },
  };
  await repo.writeClosed(conn, sessionId, {
    state: JSON.stringify(closedState),
    summary: JSON.stringify(summary),
    minutesPeople: minutes.people,
    minutesShareable: minutes.shareable,
    closedAt: now,
  });
  // The task layer's state rows (0255), in this transaction: a task exists the
  // moment the close does, whichever close it was. A second run adds nothing.
  await seedStateForSession(conn, sessionId);
  // The agenda library (0264), in this transaction too, read from the items as
  // the record now has them: what the session finished is taken up, and what
  // it did not reach waits for next time.
  const brought = await settleForClose(conn, sessionId, items, now);
  return done({
    id: sessionId,
    title: s.title,
    held: entries
      .filter((e) => e.kind === "action" && e.status === "open" && (e.ownerNo != null || e.ownerSeatId))
      .map((e) => ({ entryId: e.id, text: e.text, dueOn: e.dueOn, ownerNo: e.ownerNo, ownerSeatId: e.ownerSeatId })),
    brought,
    peopleNos: people.map((p) => p.no),
    nights: responses
      .filter((r) => r.target.startsWith("decision:") && nights[Number(r.target.slice("decision:".length))] != null)
      .filter((r) => nightLasts({ value: r.value as ConsentValue, answerBy: r.answerBy }, nowMs))
      .map((r) => {
        const entryId = Number(r.target.slice("decision:".length));
        return { entryId, text: entries.find((e) => e.id === entryId)?.text ?? "", sleeperNo: r.no, answerBy: r.answerBy! };
      }),
  });
}

/** Close the session: the facilitator, or an admin, from inside the room. */
export async function closeSession(pool: Pool, sessionId: number, actor: Actor, ctx: RoomContext, now = new Date()): Promise<Outcome<ClosedRecord>> {
  return inRoom(pool, sessionId, actor, async ({ conn, s, roles }) => {
    if (!roles.runs) return refuse(403, R.facilitatorOnly);
    return closeLocked(conn, s, ctx, now);
  });
}

// ── A round that outlives its call (0281) ───────────────────────────────────
//
// Rye, 2026-10-23: somebody who sleeps on a proposal names a time to answer
// by, and a night left unanswered by then counts as no objection. A session
// usually closes before the night ends, and Rye chose that the round outlives
// the call: whoever asked for a night answers from the record until their
// time; once no night lasts, the facilitator hears how the round went, and
// marking a consented proposal decided stays their act. The rule is
// shared/sessions.ts `nightRoundState`.

/** The answers on one proposal's round. */
function roundAnswers(responses: readonly ResponseRec[], entryId: number): ConsentAnswer[] {
  const target = `decision:${entryId}`;
  return responses.filter((r) => r.target === target && isConsentValue(r.value)).map(asAnswer);
}

/** Where each round that outlived the call stands, for one viewer of the record. */
function nightRoundsFor(s: SessionRec, entries: readonly EntryRec[], responses: readonly ResponseRec[], viewer: Viewer, now: number): NightRound[] {
  if (s.status !== "closed") return [];
  const runs = rolesIn(s, viewer).runs;
  const out: NightRound[] = [];
  for (const e of entries) {
    const night = s.summary?.nights?.[e.id];
    if (e.kind !== "decision" || e.status !== "open" || !night) continue;
    const answers = roundAnswers(responses, e.id);
    const st = nightRoundState(night, answers, now);
    const mine = viewer.no != null ? answers.find((a) => a.who === viewer.no) : undefined;
    out.push({ entryId: e.id, open: st.open, consented: st.consented, canAnswer: !!mine && nightLasts(mine, now), canDecide: st.consented && runs });
  }
  return out;
}

/**
 * Write some rounds of a closed record again, in one write, inside the
 * caller's transaction that holds the session row: each one's tally now, the
 * minutes from them, and, once no night lasts on a round, that it is settled.
 * Hands back where each round stands.
 */
async function rewriteRounds(
  conn: PoolConnection,
  s: SessionRec,
  entryIds: readonly number[],
  lookup: MemberLookup,
  now: number,
): Promise<Map<number, ReturnType<typeof nightRoundState>>> {
  const responses = (await repo.responseRows(conn, s.id)).map(mapResponse);
  const base = s.summary ?? readSummary("{}")!;
  const tallies = { ...base.tallies };
  const nights = { ...(base.nights ?? {}) };
  const states = new Map<number, ReturnType<typeof nightRoundState>>();
  for (const entryId of entryIds) {
    const night = base.nights?.[entryId];
    const st = nightRoundState(night, roundAnswers(responses, entryId), now);
    states.set(entryId, st);
    tallies[entryId] = st.tally;
    if (night) nights[entryId] = { waiting: night.waiting, settled: night.settled || !st.open };
  }
  const summary: StoredSummary = { ...base, tallies, nights };
  await repo.writeSummary(conn, s.id, JSON.stringify(summary));
  const minutes = await composeMinutes(
    conn,
    {
      s,
      items: (await repo.itemRows(conn, s.id)).map(mapItem),
      entries: (await repo.entryRows(conn, s.id)).map(mapEntry),
      peopleNos: (await repo.peopleRows(conn, s.id)).map((r) => Number(r.member_no)),
      tallies: summary.tallies,
      arrival: summary.arrival,
      circleName: summary.circleName,
    },
    lookup,
  );
  await repo.writeMinutes(conn, s.id, minutes.people, minutes.shareable);
  return states;
}

/** One round of a closed record, written again. */
async function rewriteRound(conn: PoolConnection, s: SessionRec, entryId: number, lookup: MemberLookup, now: number): Promise<ReturnType<typeof nightRoundState>> {
  return (await rewriteRounds(conn, s, [entryId], lookup, now)).get(entryId)!;
}

/** A round no night holds any more, for the facilitator's notice. */
export interface SettledNight {
  sessionId: number;
  title: string;
  entryId: number;
  text: string;
  facilitatorNo: number;
  consented: boolean;
}

/**
 * The closed record's row and one of its open proposals that kept its round,
 * inside a transaction. Somebody who may not read the record hears what the
 * record's own door says, before anything about what is in it; a door only
 * the facilitator may use (`needRuns`) refuses anybody else before that too.
 * `who` is null for the job.
 */
async function recordRound(
  conn: PoolConnection,
  sessionId: number,
  entryId: number,
  who: Actor | null,
  needRuns = false,
): Promise<Outcome<{ s: SessionRec; e: EntryRec }>> {
  const rows = await repo.sessionRow(conn, sessionId, true);
  if (!rows.length) return refuse(404, R.notFound);
  const s = mapSession(rows[0]);
  if (who) {
    const joined = (await repo.personRow(conn, sessionId, who.no)).length > 0;
    if (!maySee(s, joined, who.admin)) return refuse(403, SESSION_COPY.closedNoAccess);
  }
  if (s.status === "open") return refuse(409, R.nightInRoom);
  if (who && needRuns && !rolesIn(s, who).runs) return refuse(403, R.facilitatorOnly);
  const [row] = Number.isInteger(entryId) && entryId > 0 ? await repo.entryRow(conn, sessionId, entryId) : [];
  const e = row ? mapEntry(row) : null;
  if (!e || e.kind !== "decision") return refuse(404, R.entryUnknown);
  if (e.status !== "open") return refuse(409, R.decisionFinal);
  if (!s.summary?.nights?.[entryId]) return refuse(409, R.noNight);
  return done({ s, e });
}

/**
 * Somebody who asked for a night answers the round from the closed record, by
 * their time: I consent, a concern or an objection (each of the last two in
 * one sentence). Refused in this order: a body that does not read (400), no
 * such record (404), an asker who may not read it (403), a session still open
 * (409), no such proposal (404), a proposal decided already or that kept no
 * round (409), an asker who asked for no night on it (403), and a night that
 * has ended (409).
 */
export async function answerAfterNight(
  pool: Pool,
  sessionId: number,
  actor: Actor,
  raw: unknown,
  lookup: MemberLookup,
  now = new Date(),
): Promise<Outcome<{ settled: SettledNight | null }>> {
  const b = bodyOf(raw);
  const entryId = Number(b.entryId);
  if (!isConsentValue(b.value) || b.value === "sleep") return refuse(400, R.nightValue);
  const value = b.value;
  let text: string | null = null;
  if (consentNeedsWords(value)) {
    text = cleanLine(b.text, SESSION_LIMITS.text);
    if (!text) return refuse(400, R.consentWords);
  }
  return repo.inTransaction(pool, async (conn) => {
    const found = await recordRound(conn, sessionId, entryId, actor);
    if (!found.ok) return found;
    const { s, e } = found.value;
    const target = `decision:${entryId}`;
    const mine = (await repo.responseRows(conn, sessionId)).map(mapResponse).find((r) => r.target === target && r.no === actor.no);
    if (!mine || mine.value !== "sleep") return refuse(403, R.nightNotYours);
    if (!nightLasts(asAnswer(mine), now.getTime())) return refuse(409, R.nightOver);
    await repo.upsertResponse(conn, { sessionId, target, memberNo: actor.no, value, text, answerBy: null, now });
    const st = await rewriteRound(conn, s, entryId, lookup, now.getTime());
    await repo.bumpVersion(conn, sessionId);
    return done({
      settled: st.open ? null : { sessionId, title: s.title, entryId, text: e.text, facilitatorNo: s.facilitatorNo, consented: st.consented },
    });
  });
}

/**
 * The facilitator, or an admin, marks a round that consented after the call
 * decided, from the record. Refused in this order: no such record (404), an
 * asker who may not read it (403), a session still open (409), an asker who
 * does not run the session (403), no such proposal (404), a proposal decided
 * already or that kept no round (409), and a round that has not consented
 * (409).
 */
export async function decideAfterNight(pool: Pool, sessionId: number, entryId: number, actor: Actor, lookup: MemberLookup, now = new Date()): Promise<Outcome<null>> {
  return repo.inTransaction(pool, async (conn) => {
    const found = await recordRound(conn, sessionId, entryId, actor, true);
    if (!found.ok) return found;
    const { s, e } = found.value;
    const responses = (await repo.responseRows(conn, sessionId)).map(mapResponse);
    if (!nightRoundState(s.summary?.nights?.[entryId], roundAnswers(responses, entryId), now.getTime()).consented) return refuse(409, R.decisionNotConsented);
    await repo.writeEntry(conn, e.id, { text: e.text, status: "done", ownerNo: e.ownerNo, ownerSeatId: e.ownerSeatId, dueOn: e.dueOn, claimedAt: e.claimedAt ? new Date(e.claimedAt) : null });
    await rewriteRound(conn, s, entryId, lookup, now.getTime());
    await repo.bumpVersion(conn, sessionId);
    return done(null);
  });
}

/** The job's name and pace: a quarter of an hour, so a night that ended is heard about soon after. */
export const NIGHT_JOB = "session-nights";
export const NIGHT_EVERY_MS = 15 * 60 * 1000;
const NIGHT_LOOKBACK_MS = 30 * 86_400_000;

/**
 * Every round on a closed record whose nights have all ended, and that nobody
 * answered into settling, is settled now: its tally and minutes written again,
 * and its facilitator told. Nothing runs before the module is open to members.
 */
export async function settleNights(
  pool: Pool,
  lookup: MemberLookup,
  deps: Pick<NoticeDeps, "notify"> & { lifecycle?: () => string },
  now = new Date(),
): Promise<string> {
  const lifecycle = deps.lifecycle ?? (() => effectiveLifecycle("sessions"));
  if ((LIFECYCLE_RANK[lifecycle() as ModuleLifecycle] ?? 0) < LIFECYCLE_RANK.members) return "the sessions module is not open to members";
  let settled = 0;
  for (const row of await repo.endedNightRows(pool, now, new Date(now.getTime() - NIGHT_LOOKBACK_MS))) {
    const target = String(row.target);
    if (!target.startsWith("decision:")) continue;
    const sessionId = Number(row.session_id);
    const entryId = Number(target.slice("decision:".length));
    // Each round on its own, its notice after its own commit, so one record
    // that fails never holds up the rest or loses a notice already earned.
    try {
      const out = await repo.inTransaction(pool, async (conn): Promise<Outcome<SettledNight | null>> => {
        const found = await recordRound(conn, sessionId, entryId, null);
        if (!found.ok) return done(null);
        const { s, e } = found.value;
        const night = s.summary?.nights?.[entryId];
        if (!night || night.settled) return done(null);
        const responses = (await repo.responseRows(conn, sessionId)).map(mapResponse);
        // Another night on it still lasts: its own end brings the job back.
        if (nightRoundState(night, roundAnswers(responses, entryId), now.getTime()).open) return done(null);
        const st = await rewriteRound(conn, s, entryId, lookup, now.getTime());
        await repo.bumpVersion(conn, sessionId);
        return done({ sessionId, title: s.title, entryId, text: e.text, facilitatorNo: s.facilitatorNo, consented: st.consented });
      });
      if (out.ok && out.value) {
        settled += 1;
        await noticesAfterNights(pool, [out.value], deps);
      }
    } catch (err) {
      console.error(`[sessions] the round on proposal ${entryId} of session ${sessionId} did not settle; the next run tries again`, err);
    }
  }
  return `${settled} round(s) settled after a night`;
}

/** Each settled round's facilitator hears how it went, once. Never fails the write it follows. */
export async function noticesAfterNights(pool: Pool, settled: readonly SettledNight[], deps: Pick<NoticeDeps, "notify">): Promise<void> {
  if (!settled.length) return;
  try {
    const userOf = new Map((await repo.memberUserIdRows(pool, settled.map((n) => n.facilitatorNo))).map((r) => [Number(r.no), String(r.user_id)]));
    for (const n of settled) {
      const userId = userOf.get(n.facilitatorNo);
      if (!userId) continue;
      await deps.notify({
        userId,
        type: "session_night_settled",
        title: SESSION_NOTICES.nightSettled(n.title, n.consented),
        body: n.text,
        link: `/sessions/${n.sessionId}`,
        dedupeKey: `session-night:${n.sessionId}:${n.entryId}:${userId}`,
      });
    }
  } catch (e) {
    console.error("[sessions] a facilitator was not told a night is over", e);
  }
}

// ── Discarding a session, deleting a record ─────────────────────────────────

/** Who may remove a session, by its status. Pure, so the matrix is read and tested in one place. */
export function mayDiscard(s: Pick<SessionRec, "status" | "facilitatorNo" | "secretaryNo">, viewer: Viewer): Outcome<null> {
  const roles = rolesIn(s, viewer);
  if (s.status === "closed") return roles.admin ? done(null) : refuse(403, R.recordAdminOnly);
  return roles.runs ? done(null) : refuse(403, R.discardNotYours);
}

/**
 * Remove a session and everything in it: a real delete, nothing kept. While
 * it is open, its facilitator or an admin may (an admin need not have joined,
 * nor hold a number at all); once it has closed, only an admin may, because a
 * closed record belongs to everybody who was in it.
 *
 * One transaction. The session row is locked first, so a write to the room,
 * the close, or a quiet room's own close that waits on it finds the room gone
 * and refuses with `notFound`; and the status is read under that lock, so a
 * facilitator can never delete a record that closed a moment before. Then the
 * task layer's rows for its entries (0255), then the room's own rows (0238).
 * Notifications and emails that already went out carry the session's link as
 * text, and stay as they were sent. Nothing is recorded: there is no event
 * for a session that is meant never to have been.
 */
export async function discardSession(pool: Pool, sessionId: number, viewer: Viewer): Promise<Outcome<{ status: SessionRec["status"] }>> {
  return repo.inTransaction(pool, async (conn) => {
    const rows = await repo.sessionRow(conn, sessionId, true);
    if (!rows.length) return refuse(404, R.notFound);
    const s = mapSession(rows[0]);
    const may = mayDiscard(s, viewer);
    if (!may.ok) return may;
    // The agenda library (0264): an open session's items wait again; a deleted record's keep their status and lose the link.
    await releaseForDiscard(conn, sessionId, s.status);
    await deleteTaskRowsForSession(conn, sessionId, await repo.sessionEntryIds(conn, sessionId));
    await fillsRepo.deleteFillsForSession(conn, sessionId);
    await votesRepo.deleteVotesForSession(conn, sessionId);
    if (!(await repo.deleteSessionRows(conn, sessionId))) return refuse(404, R.notFound);
    return done({ status: s.status });
  });
}

// ── A room nobody closes ────────────────────────────────────────────────────

/** Minutes past a room's own length that it may sit with nobody in it. */
export const STALE_GRACE_MIN = 120;
/** And never less than this, however short the session was meant to be. */
export const STALE_FLOOR_MIN = 360;
/** Rooms one sweep closes at most. The next read closes the rest. */
const STALE_SWEEP_MAX = 20;

/** How long a room may go with nobody seen in it before it closes on its own. */
export function staleAfterMs(durationMin: number): number {
  return Math.max(durationMin + STALE_GRACE_MIN, STALE_FLOOR_MIN) * 60_000;
}

/** Could this room have gone quiet for good? Read off its row alone, so a fresh room costs nothing more. */
export function mayBeStale(s: Pick<SessionRec, "status" | "createdAt" | "durationMin">, now: number): boolean {
  return s.status === "open" && Date.parse(s.createdAt) < now - staleAfterMs(s.durationMin);
}

/**
 * Has this room gone quiet for good: open, older than its quiet window, and
 * nobody seen in it within that window. `lastSeenMs` is the latest anybody
 * in it was seen, or null when nobody ever was.
 */
export function isStaleRoom(s: Pick<SessionRec, "status" | "createdAt" | "durationMin">, lastSeenMs: number | null, now: number): boolean {
  return mayBeStale(s, now) && (lastSeenMs == null || lastSeenMs < now - staleAfterMs(s.durationMin));
}

/**
 * Close every room that has gone quiet for good, or only `onlyId`. One indexed
 * read finds them, then each is locked and read again: two requests that find
 * the same room close it once, and a room somebody came back to in between
 * stays open. Actions nobody holds are parked, because nobody is there to
 * claim them, and the room closes the way a facilitator closes it. The
 * notices go out after each commit. Best effort: a room that fails to close
 * is a log line, and the read that asked carries on. Hands back the ids it
 * closed.
 */
export async function closeStaleRooms(pool: Pool, ctx: RoomContext, deps: NoticeDeps, now = new Date(), onlyId: number | null = null): Promise<number[]> {
  const closedIds: number[] = [];
  let ids: number[] = [];
  try {
    ids = await repo.staleOpenSessionIds(pool, { now, graceMin: STALE_GRACE_MIN, floorMin: STALE_FLOOR_MIN, onlyId, limit: STALE_SWEEP_MAX });
  } catch (e) {
    console.error("[sessions] the quiet rooms could not be read", e);
    return closedIds;
  }
  const nowMs = now.getTime();
  for (const id of ids) {
    try {
      const record = await repo.inTransaction(pool, async (conn) => {
        const rows = await repo.sessionRow(conn, id, true);
        if (!rows.length) return null;
        const s = mapSession(rows[0]);
        const seen = (await repo.peopleRows(conn, id))
          .map(mapPerson)
          .reduce<number | null>((m, p) => (p.lastSeenMs == null ? m : Math.max(m ?? p.lastSeenMs, p.lastSeenMs)), null);
        if (!isStaleRoom(s, seen, nowMs)) return null;
        const entries = (await repo.entryRows(conn, id)).map(mapEntry);
        const unowned = unownedActions(entries.map((e) => ({ id: e.id, kind: e.kind, status: e.status, ownerUserId: e.ownerNo, ownerSeatId: e.ownerSeatId })));
        await repo.parkEntries(conn, id, unowned);
        // The item on screen stopped when the room went quiet, not hours later.
        const clockStops = new Date(Math.min(nowMs, seen ?? Date.parse(s.createdAt)));
        const out = await closeLocked(conn, s, ctx, now, clockStops);
        // Unreachable once every unheld action is parked; thrown so the parking rolls back with it.
        if (!out.ok) throw new Error(`live sessions: quiet room ${id} would not close: ${out.error}`);
        await repo.bumpVersion(conn, id);
        return out.value;
      });
      if (!record) continue;
      closedIds.push(id);
      await noticesAfterClose(pool, record, deps);
    } catch (e) {
      console.error(`[sessions] quiet room ${id} was not closed`, e);
    }
  }
  return closedIds;
}

export interface NoticeDeps {
  notify(input: { userId: string; type: string; title: string; body?: string | null; link?: string | null; dedupeKey: string }): Promise<unknown>;
  notifyAdmins(type: string, title: string, dedupeKey: string, link?: string): Promise<void>;
  /** The season's reading of who still sits in a seat. Absent: every live seating counts. */
  lapseContext?: () => LapseContext;
  /**
   * Start the closed session's task emails (server/lib/sessionTaskMail.ts
   * `queueCloseMail`). Started and never waited on: the caller's function
   * returns at once and catches its own failure. Absent: no task emails.
   */
  closeMail?: (sessionId: number) => void;
}

/**
 * After a close commits, best effort: every admin hears the record is ready,
 * and every member holding an action hears it is theirs, as does every member
 * sitting in a seat that holds one. Each (action, member) pair has one stable
 * dedupe key, so a person who holds an action and sits in its seat hears once.
 * Every one of those notices opens that task on the holder's own board
 * (`taskBoardLink`), the seat holders who were not in the room included: the
 * board is theirs to read, and the card itself carries the record link only
 * for the people the record opens to (the people who were in the room, and
 * admins), so nobody is sent to a page that would refuse them.
 * A seat counts its members whose term has not lapsed: a lapsed holder is
 * still in the chart, and a task is a new ask that waits for the next term.
 * A failure is a log line; the session is closed either way.
 *
 * THE ONE SITE THE TASK EMAILS START FROM. Both closes, the facilitator's and
 * a quiet room's, come through here, so the last thing this does is start
 * `deps.closeMail`, and it never waits for it.
 */
export async function noticesAfterClose(pool: Pool, closed: ClosedRecord, deps: NoticeDeps): Promise<void> {
  const link = `/sessions/${closed.id}`;
  try {
    await deps.notifyAdmins("session_record_ready", SESSION_NOTICES.recordReady(closed.title), `session-record:${closed.id}`, link);
  } catch (e) {
    console.error("[sessions] the admins were not told a record is ready", e);
  }
  try {
    const nos = closed.held.map((h) => h.ownerNo).filter((n): n is number => n != null);
    const userOf = new Map((await repo.memberUserIdRows(pool, nos)).map((r) => [Number(r.no), String(r.user_id)]));
    const seated = closed.held.some((h) => h.ownerSeatId)
      ? (await listOrgAssignments(pool, deps.lapseContext?.())).filter((a) => a.holderKind === "member" && a.userId && !a.isExample && !a.lapsed)
      : [];
    // Dates in words, measured where the circle lives, with the year only when it is not this one.
    const today = villageDate(new Date());
    for (const h of closed.held) {
      const to = new Set<string>();
      const own = h.ownerNo != null ? userOf.get(h.ownerNo) : undefined;
      if (own) to.add(own);
      if (h.ownerSeatId) for (const a of seated) if (a.orgRoleId === h.ownerSeatId && a.userId) to.add(a.userId);
      for (const userId of Array.from(to)) {
        await deps.notify({
          userId,
          type: "session_action_held",
          title: SESSION_NOTICES.actionHeld(closed.title),
          body: SESSION_NOTICES.actionBody(h.text, h.dueOn ? taskDateWords(h.dueOn, today) || null : null),
          link: taskBoardLink(h.entryId),
          dedupeKey: `session-action:${h.entryId}:${userId}`,
        });
      }
    }
  } catch (e) {
    console.error("[sessions] the people holding actions were not all told", e);
  }
  // Whoever brought an item the session took, and was not in the room, hears how it left.
  await noticesAfterSettle(pool, deps, { settled: closed.brought ?? [], inRoom: new Set(closed.peopleNos ?? []) });
  // Whoever asked for a night that outlives the call hears where to answer, and by when (0281).
  try {
    const nights = closed.nights ?? [];
    const userOf = new Map((await repo.memberUserIdRows(pool, nights.map((n) => n.sleeperNo))).map((r) => [Number(r.no), String(r.user_id)]));
    const zone = villageTimezone();
    for (const n of nights) {
      const userId = userOf.get(n.sleeperNo);
      if (!userId) continue;
      await deps.notify({
        userId,
        type: "session_night_open",
        title: SESSION_NOTICES.nightOpen(closed.title),
        body: SESSION_NOTICES.nightOpenBody(n.text, nightAtWords(n.answerBy, zone)),
        link: `/sessions/${closed.id}`,
        dedupeKey: `session-night-open:${closed.id}:${n.entryId}:${userId}`,
      });
    }
  } catch (e) {
    console.error("[sessions] somebody sleeping on a proposal was not told where to answer", e);
  }
  try {
    deps.closeMail?.(closed.id);
  } catch (e) {
    console.error("[sessions] the task emails were not started", e);
  }
}

/** The stored minutes. Closed sessions only, for their people and admins. */
export async function readMinutes(pool: Pool, sessionId: number, viewer: Viewer, audience: MinutesAudience): Promise<Outcome<string>> {
  const rows = await repo.sessionRow(pool, sessionId);
  if (!rows.length) return refuse(404, R.notFound);
  const s = mapSession(rows[0]);
  if (s.status !== "closed") return refuse(409, R.notClosedYet);
  const joined = viewer.no != null && (await repo.personRow(pool, sessionId, viewer.no)).length > 0;
  if (!maySee(s, joined, viewer.admin)) return refuse(403, SESSION_COPY.closedNoAccess);
  const m = await repo.minutesRow(pool, sessionId);
  const text = audience === "shareable" ? m[0]?.minutes_shareable : m[0]?.minutes_people;
  return done(String(text ?? ""));
}

// ── What carries over ───────────────────────────────────────────────────────

/**
 * From a closed session: its actions still open, its backlog (tensions not
 * done, and anything parked), and the items it parked or never reached. An
 * item or a backlog entry already brought into this session from there is not
 * offered again. An entry is matched by the title the room gives it when it is
 * brought over, which is its text cleaned and cut to an agenda title's length.
 * An item that session took from the agenda library (`fromLibrary`, its item
 * ids) went back there at its close, so it is offered there and not twice.
 */
export function selectCarried(
  prev: { items: readonly SessionItem[]; entries: readonly SessionEntry[] },
  current: readonly SessionItem[],
  prevId: number,
  fromLibrary: ReadonlySet<number> = new Set(),
  sent: ReadonlySet<number> = new Set(),
): { actions: SessionEntry[]; backlog: SessionEntry[]; parkedItems: { title: string; aim: ItemAim; minutes: number }[] } {
  const broughtOver = new Set(current.filter((i) => i.fromSessionId === prevId).map((i) => i.title.toLowerCase()));
  const asTitle = (text: string) => (cleanLine(text, SESSION_LIMITS.agendaTitle) ?? "").toLowerCase();
  return {
    actions: prev.entries.filter((e) => e.kind === "action" && e.status === "open"),
    backlog: prev.entries.filter(
      (e) => ((e.kind === "tension" && e.status !== "done") || e.status === "parked") && !broughtOver.has(asTitle(e.text)) && !sent.has(e.id),
    ),
    parkedItems: [...prev.items]
      .sort((a, b) => a.position - b.position)
      .filter((i) => (i.status === "parked" || i.status === "waiting") && !broughtOver.has(i.title.toLowerCase()) && !fromLibrary.has(i.id))
      .map((i) => ({ title: i.title, aim: i.aim, minutes: i.minutes })),
  };
}

// ── The view ────────────────────────────────────────────────────────────────

/** The session row for a GET, with whether the viewer is in it. Null when there is no such session. */
export async function sessionForViewer(pool: Pool, sessionId: number, viewer: Viewer): Promise<{ s: SessionRec; joined: boolean } | null> {
  const rows = await repo.sessionRow(pool, sessionId);
  if (!rows.length) return null;
  const joined = viewer.no != null && (await repo.personRow(pool, sessionId, viewer.no)).length > 0;
  return { s: mapSession(rows[0]), joined };
}

/**
 * The face each person in the room fronts: the stock art of their primary
 * character, keyed by their member id. One query for the whole room, never
 * one per person. Only the village's own character art can come back from
 * here (`avatarFor` answers from a fixed set of shipped files), so a portrait
 * a member uploaded never reaches the room this way. A member who fronts no
 * character, or whose character has no art, is simply absent.
 */
async function facesFor(pool: Pool, userIds: readonly (string | null)[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const wanted = Array.from(new Set(userIds.filter((u): u is string => !!u)));
  for (const r of await repo.avatarRows(pool, wanted)) {
    const face = r.archetype_key ? avatarFor(String(r.archetype_key), String(r.presentation), String(r.tone)) : null;
    if (face) out.set(String(r.id), face);
  }
  return out;
}

/** Everything the room shows one viewer. The caller has already decided they may see it. */
export async function buildView(
  pool: Pool,
  s: SessionRec,
  viewer: Viewer,
  joined: boolean,
  ctx: {
    lookup: MemberLookup;
    circleName: (id: string | null) => string | null;
    lapseContext?: () => LapseContext;
    circles?: () => { id: string; name: string }[];
    /** Checks on proposals (0297): the agent's name while the module that offers them is open, null otherwise. */
    check?: () => { agent: string } | null;
  },
  now = Date.now(),
): Promise<SessionView> {
  const roles = rolesIn(s, viewer);
  const [peopleRaw, itemsRaw, entriesRaw, fillsRaw, votesRaw] = await Promise.all([
    repo.peopleRows(pool, s.id),
    repo.itemRows(pool, s.id),
    repo.entryRows(pool, s.id),
    fillsRepo.fillRows(pool, s.id),
    votesRepo.voteRows(pool, s.id),
  ]);
  // The room's vote on its agenda (0290): every tally is the room's to see, and each viewer reads their own vote.
  const tallies = talliesFor(votesRaw.map(mapVote), viewer.no);
  // What the facilitator filled in for somebody and still stands (0288): marked for everyone who reads the room.
  const standing = standingFills(fillsRaw.map(mapFill));
  const people = peopleRaw.map(mapPerson);
  const items = itemsRaw.map(mapItem);
  const entries = entriesRaw.map(mapEntry);
  const seesAnswers = joined || viewer.admin;
  const responses: ResponseRec[] = seesAnswers ? (await repo.responseRows(pool, s.id)).map(mapResponse) : [];
  // Read once the session has closed, as one sorted batch: while the room is
  // open, an answer turning up on the next poll would say who just sent it.
  const facilitation =
    s.status === "closed" && (roles.facilitates || viewer.admin)
      ? (await repo.facilitationRows(pool, s.id))
          .filter((r) => (FACILITATION_VALUES as readonly string[]).includes(String(r.value)))
          .map((r) => ({ value: r.value as FacilitationValue, text: r.text == null ? null : String(r.text) }))
      : null;

  // What carries over, for a viewer who may read the earlier record: from the
  // circle's last close, passing over a session one person was in that left
  // nothing behind (`lastTimeIn`, server/lib/circleStanding.ts).
  let carriedFrom: { prev: SessionRec; items: ItemRec[]; entries: EntryRec[]; fromLibrary: Set<number> } | null = null;
  if (s.status === "open" && s.circleId) {
    const prevRow = await lastTimeIn(pool, s.circleId, s.id);
    if (prevRow) {
      const prev = mapSession(prevRow);
      const wasThere = viewer.no != null && (await repo.personRow(pool, prev.id, viewer.no)).length > 0;
      if (wasThere || viewer.admin) {
        carriedFrom = {
          prev,
          items: (await repo.itemRows(pool, prev.id)).map(mapItem),
          entries: (await repo.entryRows(pool, prev.id)).map(mapEntry),
          fromLibrary: await libraryItemIdsFor(pool, prev.id),
        };
      }
    }
  }
  // Who brought each item this session took from the agenda library.
  const brought = await broughtByItem(pool, s.id, ctx.lookup);

  const nos = new Set<number>([s.facilitatorNo, ...people.map((p) => p.no)]);
  if (s.secretaryNo) nos.add(s.secretaryNo);
  for (const e of [...entries, ...(carriedFrom?.entries ?? [])]) if (e.ownerNo != null) nos.add(e.ownerNo);
  const owningSeats = [...entries, ...(carriedFrom?.entries ?? [])].map((e) => e.ownerSeatId).filter((id): id is string => !!id);
  const [names, book, holdersOf] = await Promise.all([
    namesFor(pool, nos, ctx.lookup),
    seatBook(pool, s.circleId),
    seatHoldersFor(pool, owningSeats, ctx.lookup, ctx.lapseContext),
  ]);
  const seats: SeatBook = { ...book, holdersOf };
  const faces = await facesFor(pool, people.map((p) => names.get(p.no)?.userId ?? null));

  const open = s.status === "open";
  const markOf = (target: "arrival" | "item" | "entry", id: number) => {
    const f = standing.get(fillKey(target, id));
    return f ? filledInOut(f, viewer.no, open) : null;
  };
  const peopleOut: SessionPerson[] = people.map((p) => ({
    userId: p.no,
    name: nameIn(names, p.no) ?? SESSION_SOMEONE,
    handle: names.get(p.no)?.handle ?? null,
    avatar: faces.get(names.get(p.no)?.userId ?? "") ?? null,
    present: open && isPresentAt(p, now),
    // The arrival round is heard by the people in the room, and only while it is open.
    arrival: open && joined ? p.arrival : null,
    wish: open && joined ? p.wish : null,
    // An arrival is erased by the close, and so is the mark on it.
    arrivalFilledIn: open && joined ? markOf("arrival", p.no) : null,
  }));
  const responsesOut: SessionResponse[] = responses
    .map((r): Omit<SessionResponse, "target"> & { target: ResponseTarget | null } => ({
      target: parseResponseTarget(r.target),
      userId: r.no,
      value: r.value,
      text: r.text,
      answerBy: r.answerBy == null ? null : new Date(r.answerBy).toISOString(),
    }))
    .filter((r): r is SessionResponse => r.target != null && r.target !== "facilitation");
  // Who each open consent question is still waiting on, named the way the
  // room names people. Only for a viewer who sees the answers: anyone else
  // receives no answers to count from, and would read everyone as waiting.
  const waiting: ConsentWaiting = open && seesAnswers ? consentWaiting(peopleOut, entries, responsesOut) : {};

  // Tensions sent on to a circle's agenda items (0279): this room says where each went, and "From last time" offers it no more.
  const tensionIds = [...entries, ...(carriedFrom?.entries ?? [])].filter((e) => e.kind === "tension").map((e) => e.id);
  const sent = await sentTensionsFor(pool, tensionIds);
  const sentTensions: SessionView["sentTensions"] = {};
  for (const e of entries) if (sent.has(e.id)) sentTensions[String(e.id)] = { circleName: ctx.circleName(sent.get(e.id) ?? null) };

  let carried: SessionView["carried"] = null;
  if (carriedFrom) {
    const picked = selectCarried(
      { items: carriedFrom.items.map(itemOut), entries: carriedFrom.entries.map((e) => entryOut(e, names, seats)) },
      items,
      carriedFrom.prev.id,
      carriedFrom.fromLibrary,
      new Set(sent.keys()),
    );
    if (picked.actions.length || picked.backlog.length || picked.parkedItems.length) {
      carried = { sessionId: carriedFrom.prev.id, title: carriedFrom.prev.title, ...picked };
    }
  }

  // Every open task of the circle's earlier sessions, as this viewer may see it.
  const circle = await circleTasksFor(pool, s, viewer, ctx);

  // Each checked proposal's read (0297), for everybody who sees the room. The purpose is read only when a check exists.
  const offer = ctx.check?.() ?? null;
  let check: CheckView | null = null;
  if (offer) {
    const byEntry: Record<string, EntryCheck> = {};
    let purpose: string | null = null;
    const checkRaw = await checksRepo.checkRows(pool, s.id);
    if (checkRaw.length) {
      const gps = await governingPurpose(pool);
      purpose = gps.statement.trim() ? gps.statement : null;
      const textOf = new Map(entries.map((e) => [e.id, e.text]));
      for (const r of checkRaw) {
        const entryId = Number(r.entry_id);
        const read = readCheckRead(r.read_json);
        const text = textOf.get(entryId);
        if (!read || text === undefined) continue;
        byEntry[String(entryId)] = {
          at: toIso(r.checked_at) ?? new Date(0).toISOString(),
          read,
          changed: wordsHash(text) !== String(r.checked_hash),
          purposeChanged: read.purposeWrittenAt !== gps.writtenAt,
        };
      }
    }
    check = { agent: offer.agent, purpose, byEntry };
  }

  return {
    id: s.id,
    title: s.title,
    circleId: s.circleId,
    circleName: s.status === "closed" && s.summary?.circleName ? s.summary.circleName : ctx.circleName(s.circleId),
    status: s.status,
    version: s.version,
    serverNow: now,
    durationMin: s.durationMin,
    state: s.state,
    stamp: s.stamp,
    facilitatorUserId: s.facilitatorNo,
    secretaryUserId: s.secretaryNo,
    createdAt: s.createdAt,
    closedAt: s.closedAt,
    people: peopleOut,
    items: items.map((i) => {
      const from = brought.get(i.id);
      return { ...itemOut(i), libraryId: from?.libraryId ?? null, broughtBy: from?.broughtBy ?? null, filledIn: markOf("item", i.id), votes: tallies.get(i.id) ?? noVotes() };
    }),
    entries: entries.map((e) => ({ ...entryOut(e, names, seats), filledIn: markOf("entry", e.id) })),
    responses: responsesOut,
    nights: nightRoundsFor(s, entries, responses, viewer, now),
    facilitation,
    waiting,
    seats: seats.options,
    arrival: s.status === "closed" ? (s.summary?.arrival ?? null) : null,
    carried,
    sentTensions,
    // Only somebody in the room, an admin, or somebody From last time is shown to sends a tension on, so only they are handed the list.
    circleOptions: joined || viewer.admin || carriedFrom != null ? (ctx.circles?.() ?? []) : [],
    circleTasks: circle.cards,
    circleLastMetAt: circle.lastMetAt,
    check,
    me: { userId: viewer.no ?? 0, joined, facilitates: roles.facilitates, secretary: roles.secretary, admin: viewer.admin },
  };
}

/** The list page: what is open now, and the closed sessions this viewer may read. */
export async function listSessions(
  pool: Pool,
  viewer: Viewer,
  ctx: { lookup: MemberLookup; circleName: (id: string | null) => string | null },
): Promise<{ open: SessionListRow[]; recent: SessionListRow[] }> {
  const open = (await repo.openSessionRows(pool, 50)).map(mapSession);
  const recent = (
    viewer.admin ? await repo.closedSessionRows(pool, 30) : viewer.no != null ? await repo.closedSessionRowsFor(pool, viewer.no, 30) : []
  ).map(mapSession);
  const all = [...open, ...recent];
  const ids = all.map((s) => s.id);
  const counts = new Map((await repo.peopleCountRows(pool, ids)).map((r) => [Number(r.session_id), Number(r.n)]));
  const mine = new Set(viewer.no != null ? (await repo.joinedRows(pool, viewer.no, ids)).map((r) => Number(r.session_id)) : []);
  const names = await namesFor(pool, all.map((s) => s.facilitatorNo), ctx.lookup);
  const row = (s: SessionRec): SessionListRow => ({
    id: s.id,
    title: s.title,
    circleId: s.circleId,
    circleName: s.status === "closed" && s.summary?.circleName ? s.summary.circleName : ctx.circleName(s.circleId),
    status: s.status,
    createdAt: s.createdAt,
    closedAt: s.closedAt,
    facilitatorName: nameIn(names, s.facilitatorNo) ?? SESSION_SOMEONE,
    peopleCount: counts.get(s.id) ?? 0,
    joined: mine.has(s.id),
  });
  return { open: open.map(row), recent: recent.map(row) };
}

// ── The member's own: export and erasure ────────────────────────────────────

/**
 * Everything this module holds about one member, for GET /api/profile/export:
 * the sessions they were in, the agenda items they added or present, the
 * entries they wrote or hold, and their own answers, feedback on the
 * facilitation included, because it is theirs. From the task layer: the tasks
 * they hold now, and every answer they gave a task, with its words. A note
 * somebody else left on a task they hold is that person's, and stays out.
 * From the agenda library: the items they brought, and the times they put an
 * item on an agenda (server/lib/sessionLibrary.ts `exportLibraryFor`).
 */
export async function exportMemberSessions(pool: Pool, userId: string): Promise<{
  sessions: Record<string, unknown>[];
  items: Record<string, unknown>[];
  entries: Record<string, unknown>[];
  responses: Record<string, unknown>[];
  tasks: Record<string, unknown>[];
  taskAnswers: Record<string, unknown>[];
  library: Record<string, unknown>[];
  libraryTakes: Record<string, unknown>[];
  libraryNotes: Record<string, unknown>[];
  rhythmsSet: Record<string, unknown>[];
  circlesFollowed: Record<string, unknown>[];
  calendarAddress: Record<string, unknown>[];
  ownCalendarsAttached: Record<string, unknown>[];
  reviewsSet: Record<string, unknown>[];
  /** The advice process (0284): the requests they made, and the advice they gave. */
  adviceAsked: Record<string, unknown>[];
  adviceGiven: Record<string, unknown>[];
  /** Filled in by the facilitator (0288): what was filled in for them, and what they filled in for somebody, with nobody else's number. */
  filledIn: Record<string, unknown>[];
  agendaVotes: Record<string, unknown>[];
  /** Meeting templates (0291): what they shared around the talking stick, and the priorities they wrote. */
  heartShares: Record<string, unknown>[];
  prioritiesWritten: Record<string, unknown>[];
}> {
  const no = await memberNo(pool, userId);
  if (no == null) return { sessions: [], items: [], entries: [], responses: [], tasks: [], taskAnswers: [], library: [], libraryTakes: [], libraryNotes: [], rhythmsSet: [], circlesFollowed: [], calendarAddress: [], ownCalendarsAttached: [], reviewsSet: [], adviceAsked: [], adviceGiven: [], filledIn: [], agendaVotes: [], heartShares: [], prioritiesWritten: [] };
  const sessions = (await repo.memberSessionRows(pool, no)).map((r) => ({
    id: Number(r.id),
    title: String(r.title ?? ""),
    circleId: r.circle_id == null ? null : String(r.circle_id),
    status: String(r.status),
    facilitated: Number(r.facilitator_no) === no,
    tookNotes: r.secretary_no != null && Number(r.secretary_no) === no,
    joinedAt: toIso(r.joined_at),
    createdAt: toIso(r.created_at),
    closedAt: toIso(r.closed_at),
    // Only while the session is open; the close erased these for everybody.
    arrival: intOrNull(r.arrival_score),
    wish: r.arrival_wish == null ? null : String(r.arrival_wish),
  }));
  // The titles they typed and the items they speak to. Nobody else's number travels with them.
  const items = (await repo.memberItemRows(pool, no)).map((r) => {
    const i = mapItem(r);
    return {
      sessionId: Number(r.session_id),
      id: i.id,
      title: i.title,
      aim: i.aim,
      minutes: i.minutes,
      status: i.status,
      usedSeconds: i.usedSeconds,
      fromSessionId: i.fromSessionId,
      added: i.addedBy === no,
      presents: i.presenterUserId === no,
      createdAt: toIso(r.created_at),
    };
  });
  const entries = (await repo.memberEntryRows(pool, no)).map(mapEntry).map((e) => ({
    sessionId: e.sessionId,
    id: e.id,
    kind: e.kind,
    text: e.text,
    status: e.status,
    wrote: e.authorNo === no,
    holds: e.ownerNo === no,
    ownerSeatId: e.ownerSeatId,
    dueOn: e.dueOn,
    createdAt: e.createdAt,
  }));
  const responses = (await repo.memberResponseRows(pool, no)).map((r) => ({
    sessionId: Number(r.session_id),
    target: String(r.target),
    value: String(r.value),
    text: r.text == null ? null : String(r.text),
    answerBy: r.answer_by_s == null ? null : new Date(Math.round(Number(r.answer_by_s) * 1000)).toISOString(),
    at: toIso(r.updated_at),
  }));
  const taskRows = await exportTaskRowsFor(pool, no);
  const tasks = taskRows.held.map((r) => ({
    sessionId: Number(r.session_id),
    entryId: Number(r.entry_id),
    sessionTitle: String(r.title ?? ""),
    text: String(r.text ?? ""),
    status: String(r.status),
    dueOn: r.due_on == null ? null : String(r.due_on),
    latestKind: String(r.latest_kind),
    latestNote: Number(r.changed_by_no) === no && r.latest_note != null ? String(r.latest_note) : null,
    changedAt: toIso(r.changed_at),
  }));
  const taskAnswers = taskRows.answers.map((r) => ({
    sessionId: Number(r.session_id),
    entryId: Number(r.entry_id),
    kind: String(r.kind),
    dueOn: r.due_on == null ? null : String(r.due_on),
    note: r.note == null ? null : String(r.note),
    at: toIso(r.created_at),
  }));
  // The agenda library (0264): what they brought, in their own words, and the times they put an item on an agenda.
  const { library, libraryTakes, libraryNotes } = await exportLibraryFor(pool, no);
  // A circle's rhythm (0271): the ones they set last.
  const rhythmsSet = await exportRhythmsFor(pool, no);
  const { circlesFollowed, calendarAddress, ownCalendarsAttached } = await exportFollowsFor(pool, no);
  const reviewsSet = await exportReviewsFor(pool, no);
  const { adviceAsked, adviceGiven } = await exportAdviceFor(pool, no);
  const filledIn = (await fillsRepo.memberFillRows(pool, no)).map((r) => ({
    sessionId: Number(r.session_id),
    target: String(r.target),
    act: String(r.act),
    forYou: Number(r.for_me) === 1,
    byYou: Number(r.by_me) === 1,
    at: toIso(r.created_at),
    undoneAt: toIso(r.undone_at),
  }));
  const agendaVotes = (await votesRepo.memberVoteRows(pool, no)).map((r) => ({
    sessionId: Number(r.session_id),
    itemId: Number(r.item_id),
    vote: Number(r.vote),
    at: toIso(r.updated_at),
  }));
  // Meeting templates (0291): what they shared around the talking stick, and the priorities they wrote.
  const { shares: heartShares, priorities: prioritiesWritten } = await exportTemplatesFor(pool, no);
  return { sessions, items, entries, responses, tasks, taskAnswers, library, libraryTakes, libraryNotes, rhythmsSet, circlesFollowed, calendarAddress, ownCalendarsAttached, reviewsSet, adviceAsked, adviceGiven, filledIn, agendaVotes, heartShares, prioritiesWritten };
}

/**
 * The member leaves every session, for the erasure sweep (server/lib/erasure.ts,
 * after the tombstone). Their people rows, answers and the entries they wrote
 * are deleted, with every answer to a proposal they wrote; the actions they
 * held go back to nobody; where they facilitated, opened a session or added an
 * item the record says 0; and every closed session that named them has its
 * minutes written again from what is left, so their name is gone from the
 * record and not only from the rows. Their number is deleted last.
 *
 * IDEMPOTENT. One transaction does everything but the last delete, so a death
 * part way leaves either nothing done or only the number left to delete, and a
 * resume finishes either.
 */
export async function forgetMemberSessions(pool: Pool, userId: string, lookup: MemberLookup): Promise<void> {
  const no = await memberNo(pool, userId);
  if (no == null) return;
  await repo.inTransaction(pool, async (conn) => {
    const touched = await repo.sessionIdsNaming(conn, no);
    const written = await repo.authoredEntryIds(conn, no);
    const decisionTargets = new Map<number, string[]>();
    for (const e of written) {
      if (String(e.kind) !== "decision") continue;
      const sid = Number(e.session_id);
      decisionTargets.set(sid, [...(decisionTargets.get(sid) ?? []), `decision:${Number(e.id)}`]);
    }
    for (const [sid, targets] of Array.from(decisionTargets)) await repo.deleteResponsesForTargets(conn, sid, targets);
    // The task layer first: the tasks of the entries about to go, and the
    // leaver's number wherever else a task names it.
    await forgetTaskRowsFor(conn, no, written.map((e) => Number(e.id)));
    await repo.forgetMemberRows(conn, no, written.map((e) => Number(e.id)));

    for (const sid of touched) {
      const rows = await repo.sessionRow(conn, sid, true);
      if (!rows.length) continue;
      const s = mapSession(rows[0]);
      if (s.status !== "closed") {
        await repo.bumpVersion(conn, sid);
        continue;
      }
      const entries = (await repo.entryRows(conn, sid)).map(mapEntry);
      const tallies: Record<number, ConsentTally> = {};
      for (const e of entries) {
        const t = s.summary?.tallies?.[e.id];
        if (e.kind === "decision" && t) tallies[e.id] = t;
      }
      const minutes = await composeMinutes(
        conn,
        {
          s,
          items: (await repo.itemRows(conn, sid)).map(mapItem),
          entries,
          peopleNos: (await repo.peopleRows(conn, sid)).map((r) => Number(r.member_no)),
          tallies,
          arrival: s.summary?.arrival ?? null,
          circleName: s.summary?.circleName ?? null,
        },
        // The leaver's number is still in the map until the last step, and
        // nothing names them any more, so no lookup reaches them.
        lookup,
      );
      await repo.writeMinutes(conn, sid, minutes.people, minutes.shareable);
      // A round that outlived its call (0281) and that the leaver's night held
      // open is written again from the answers left: its tally, its minutes,
      // and settled once no night lasts. No notice goes from an erasure; the
      // facilitator finds the round settled on the record.
      const held = Object.entries(s.summary?.nights ?? {})
        .filter(([id, n]) => !n.settled && entries.some((e) => e.id === Number(id) && e.kind === "decision" && e.status === "open"))
        .map(([id]) => Number(id));
      if (held.length) {
        const [fresh] = await repo.sessionRow(conn, sid, true);
        if (fresh) await rewriteRounds(conn, mapSession(fresh), held, lookup, Date.now());
      }
    }
    // The agenda library (0264) last, after every session row above is held,
    // the order every other writer takes them in: the items they brought go
    // with every take of them, and their number leaves the takes and the
    // changes they made. A note they brought into a room is an entry they
    // wrote, so it already went with the rest.
    await forgetLibraryFor(conn, no);
    // A circle's rhythm (0271): one they set last says it was set by nobody.
    await forgetRhythmsFor(conn, no);
    await forgetFollowsFor(conn, no);
    // A decision's review (0280): the date and its items go with a decision they wrote.
    await forgetReviewsFor(
      conn,
      no,
      written.filter((e) => String(e.kind) === "decision").map((e) => Number(e.id)),
    );
    // The advice process (0284): the requests they made go with every answer to them, and their own advice goes.
    await forgetAdviceFor(conn, no);
    // Filled in by the facilitator (0288): what was filled in for them goes; what they filled in says nobody did.
    await fillsRepo.forgetFillsFor(conn, no);
    // The agenda vote (0290): their votes go.
    await votesRepo.forgetVotesFor(conn, no);
    // Meeting templates (0291): what they shared around the stick goes; a priority they wrote stays the circle's, by nobody.
    await forgetTemplatesFor(conn, no);
  });
  await repo.deleteMemberNo(pool, no);
}
