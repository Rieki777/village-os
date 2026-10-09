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
 * Seeing: an open session is seen by any signed-in member, and anybody may
 * join it. A closed one is seen by the people who were in it and by admins.
 *
 * Writing: every write needs the session open and the writer in it. On top
 * of that (`rolesIn`):
 *   runs   the facilitator, or an admin: moves the room (act), names the
 *          hosts, reorders the agenda, sets an item's status, closes, and
 *          marks a proposal decided once its consent round has consented.
 *   notes  runs, or the secretary: edits any item's words, and any entry's
 *          text, status, seat and date.
 *   author the person who wrote an entry edits or deletes it; the person who
 *          added an item edits its words while it is still waiting.
 *   anyone in the room claims an action nobody holds; the holder or the
 *          facilitator lets it go.
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
 * `facilitationRows` has no column for one), and only by the facilitator and
 * admins. Nothing here calls `recordEvent`.
 */
import { createHash } from "node:crypto";
import type { Pool, PoolConnection } from "mysql2/promise";
import * as repo from "../repos/liveSessions";
import { listOrgAssignments, listOrgRoles } from "./orgChart";
import { numberVar, stringVar } from "./variables";
import { moonOneCycle, villageMoonFor } from "./villageMoon";
import { moonPhase, moonPhaseGlyph, moonPhaseName, seasonInstants } from "../../shared/lunar";
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
  cleanLine,
  cleanText,
  consentNeedsWords,
  consentTally,
  defaultSessionState,
  isArrivalScore,
  isConsentValue,
  isEntryKind,
  isItemAim,
  normalizeSessionState,
  parseResponseTarget,
  unownedActions,
  type ArrivalSummary,
  type ConsentTally,
  type ConsentValue,
  type EntryKind,
  type EntryStatus,
  type FacilitationValue,
  type ItemAim,
  type ItemStatus,
  type MinutesAudience,
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
});

interface ResponseRec {
  target: string;
  no: number;
  value: string;
  text: string | null;
}

const mapResponse = (r: any): ResponseRec => ({
  target: String(r.target),
  no: Number(r.member_no),
  value: String(r.value),
  text: r.text == null ? null : String(r.text),
});

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
}

/** The org chart's seats. The circle's own seats first when a circle is meeting. */
export async function seatBook(pool: Pool | PoolConnection, circleId: string | null): Promise<SeatBook> {
  const roles = await listOrgRoles(pool as Pool);
  const nameOf = new Map(roles.map((r) => [r.id, r.name]));
  // A standing example seat holds nothing real, and an action left with one
  // would reach nobody, so the room offers live seats only, the same reading
  // the org chart's own seat map makes.
  const active = roles.filter((r) => r.active && !r.isExample);
  const options: SeatOption[] = active.map((r) => ({ id: r.id, name: r.name, circleId: r.circleId }));
  if (circleId) options.sort((a, b) => Number(b.circleId === circleId) - Number(a.circleId === circleId));
  return { nameOf, options, active: new Set(active.map((r) => r.id)) };
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
  dueOn: e.dueOn,
  createdAt: e.createdAt,
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

/** May this person change an item's words: notes always, its adder while it waits. */
export function mayEditItemWords(item: Pick<SessionItem, "addedBy" | "status">, actorNo: number, roles: Roles): boolean {
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

/** What the sky and the place say as a session opens. Each part degrades to null on its own. */
export async function sessionStamp(pool: Pool, now: Date): Promise<SessionStamp> {
  const phase = moonPhase(now);
  let moonOrdinal: number | null = null;
  try {
    moonOrdinal = villageMoonFor(now, await moonOneCycle(pool)).ordinal;
  } catch {
    moonOrdinal = null;
  }
  let season: SessionSeason | null = null;
  try {
    season = seasonAt(now, stringVar("calendar.hemisphere") === "south" ? "south" : "north");
  } catch {
    season = null;
  }
  return { moonName: moonPhaseName(phase), moonGlyph: moonPhaseGlyph(phase), moonOrdinal, season, placeLine: placeLine() };
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
}

/**
 * Lock the session, check it is open and the writer is in it, run `work`,
 * and bump the version if the work succeeded. A refusal writes nothing.
 */
async function inRoom<T>(pool: Pool, sessionId: number, actor: Actor, work: (room: Room) => Promise<Outcome<T>>): Promise<Outcome<T>> {
  return repo.inTransaction(pool, async (conn) => {
    const rows = await repo.sessionRow(conn, sessionId, true);
    if (!rows.length) return refuse(404, R.notFound);
    const s = mapSession(rows[0]);
    if (s.status !== "open") return refuse(409, R.closed);
    if (!(await repo.personRow(conn, sessionId, actor.no)).length) return refuse(403, R.joinFirst);
    const out = await work({ conn, s, roles: rolesIn(s, actor) });
    if (out.ok) await repo.bumpVersion(conn, sessionId);
    return out;
  });
}

// ── Starting, joining, presence, arrival ────────────────────────────────────

/** Open a session. The opener facilitates and is in the room. */
export async function startSession(pool: Pool, openerNo: number, input: StartInput, now = new Date()): Promise<number> {
  const stamp = await sessionStamp(pool, now);
  return repo.inTransaction(pool, async (conn) => {
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
  return inRoom(pool, sessionId, actor, async ({ conn }) => {
    await repo.writeArrival(conn, sessionId, actor.no, score, wish, now);
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
  return inRoom(pool, sessionId, actor, async ({ conn, s }) => {
    const items = (await repo.itemRows(conn, sessionId)).map(mapItem);
    if (items.length >= SESSION_LIMITS.maxAgenda) return refuse(409, R.agendaFull);
    if (fromSessionId != null) {
      const from = await repo.sessionRow(conn, fromSessionId);
      const prev = from.length ? mapSession(from[0]) : null;
      if (!prev || prev.status !== "closed" || !s.circleId || prev.circleId !== s.circleId) return refuse(400, R.fromSession);
    }
    const position = items.reduce((m, i) => Math.max(m, i.position), 0) + 1;
    const id = await repo.insertItem(conn, { sessionId, title, aim, minutes, position, addedByNo: actor.no, fromSessionId, now });
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
    const changesWords = Object.keys(words).length > 0;
    if (changesWords && !mayEditItemWords(item, actor.no, roles)) return refuse(403, R.notesOnly);
    if ((position != null || status != null) && !roles.runs) return refuse(403, R.facilitatorOnly);
    if (words.presenter != null && !(await repo.personRow(conn, sessionId, words.presenter)).length) return refuse(400, R.hostsPerson);

    if (changesWords) {
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
    if (action.type === "item") {
      const items = (await repo.itemRows(conn, sessionId)).map(mapItem);
      if (action.itemId != null && !items.some((i) => i.id === action.itemId)) return refuse(404, R.itemUnknown);
      for (const item of items) {
        const isActive = item.status === "active" || s.state.activeItemId === item.id;
        if (isActive && item.id !== action.itemId) {
          await repo.finishItemClock(conn, item.id, "done", usedAfter(item, s.state, nowMs), now);
        }
      }
      const chosen = items.find((i) => i.id === action.itemId);
      if (chosen && chosen.status !== "active") await repo.startItemClock(conn, chosen.id, now);
    }
    if (action.type === "round") {
      // A round is spoken by people who are in the room.
      const inRoomNos = new Set((await repo.peopleRows(conn, sessionId)).map((r) => Number(r.member_no)));
      move = { ...action, order: action.order.filter((n) => inRoomNos.has(n)) };
    }
    const state = applySessionAction(s.state, move, nowMs);
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
  return inRoom(pool, sessionId, actor, async ({ conn }) => {
    if (itemId != null && !(await repo.itemRows(conn, sessionId)).some((r) => Number(r.id) === itemId)) return refuse(404, R.itemUnknown);
    const counts = await repo.entryCounts(conn, sessionId, actor.no);
    if (counts.all >= SESSION_LIMITS.maxEntries) return refuse(409, R.entriesFull);
    if (counts.mine >= SESSION_LIMITS.maxEntriesPerPerson) return refuse(409, R.yoursFull);
    const id = await repo.insertEntry(conn, {
      sessionId,
      itemId,
      kind,
      text,
      authorNo: actor.no,
      ownerSeatId: seat.value ?? null,
      dueOn: due.value ?? null,
      now,
    });
    return done({ id });
  });
}

/** The consent round on one proposal, counted over the people here now. */
async function decisionTally(conn: PoolConnection, sessionId: number, entryId: number, now: number): Promise<ConsentTally> {
  const people = (await repo.peopleRows(conn, sessionId)).map(mapPerson);
  const present = people.filter((p) => isPresentAt(p, now)).length;
  const target = `decision:${entryId}`;
  const values = (await repo.responseRows(conn, sessionId))
    .map(mapResponse)
    .filter((r) => r.target === target && isConsentValue(r.value))
    .map((r) => r.value as ConsentValue);
  return consentTally(values, present);
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
    if (text !== undefined) {
      if (!may.text) return refuse(403, R.notYours);
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
      if (e.kind === "decision" && status === "done") {
        if (!roles.runs) return refuse(403, R.facilitatorOnly);
        if (!(await decisionTally(conn, sessionId, e.id, now.getTime())).consented) return refuse(409, R.decisionNotConsented);
      }
      next.status = status;
    }
    await repo.writeEntry(conn, e.id, next);
    return done(null);
  });
}

export async function removeEntry(pool: Pool, sessionId: number, actor: Actor, entryId: number): Promise<Outcome<null>> {
  return inRoom(pool, sessionId, actor, async ({ conn, roles }) => {
    const rows = await repo.entryRow(conn, sessionId, entryId);
    if (!rows.length) return refuse(404, R.entryUnknown);
    const e = mapEntry(rows[0]);
    if (!entryRights(e, actor.no, roles).remove) return refuse(403, R.notYours);
    await repo.deleteEntryRow(conn, e.id);
    if (e.kind === "decision") await repo.deleteResponsesForTargets(conn, sessionId, [`decision:${e.id}`]);
    return done(null);
  });
}

// ── Answers ─────────────────────────────────────────────────────────────────

export async function respond(pool: Pool, sessionId: number, actor: Actor, raw: unknown, now = new Date()): Promise<Outcome<null>> {
  const b = bodyOf(raw);
  const target = parseResponseTarget(b.target);
  if (!target) return refuse(400, R.targetUnknown);
  let value: string;
  let text: string | null = null;
  if (target === "agenda" || target.startsWith("decision:")) {
    if (!isConsentValue(b.value)) return refuse(400, R.consentValue);
    value = b.value;
    if (consentNeedsWords(b.value)) {
      text = cleanLine(b.text, SESSION_LIMITS.text);
      if (!text) return refuse(400, R.consentWords);
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
    await repo.upsertResponse(conn, { sessionId, target, memberNo: actor.no, value, text, now });
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
  people: readonly { arrival: number | null; lastSeenMs: number | null }[],
  responses: readonly { target: string; value: string }[],
  now: number,
): { unowned: number[]; arrival: ArrivalSummary; present: number; tallies: Record<number, ConsentTally> } {
  const unowned = unownedActions(entries.map((e) => ({ id: e.id, kind: e.kind, status: e.status, ownerUserId: e.ownerNo, ownerSeatId: e.ownerSeatId })));
  const arrival = arrivalSummary(people.map((p) => p.arrival));
  const present = people.filter((p) => isPresentAt(p, now)).length;
  const tallies: Record<number, ConsentTally> = {};
  for (const d of entries.filter((e) => e.kind === "decision")) {
    const values = responses.filter((r) => r.target === `decision:${d.id}` && isConsentValue(r.value)).map((r) => r.value as ConsentValue);
    tallies[d.id] = consentTally(values, present);
  }
  return { unowned, arrival, present, tallies };
}

/** What a close hands back, for the notices that go out after it commits. */
export interface ClosedRecord {
  id: number;
  title: string;
  /** The actions that left with a person or a seat on them. */
  held: { entryId: number; text: string; dueOn: string | null; ownerNo: number | null; ownerSeatId: string | null }[];
}

/**
 * Close the session. Refused while any action has nobody holding it. Then, in
 * one transaction: the active item stops, the arrival spread is stored and
 * every arrival number and word erased, each proposal's tally is kept, the
 * minutes are written in both audiences, and the session closes.
 */
export async function closeSession(
  pool: Pool,
  sessionId: number,
  actor: Actor,
  ctx: { lookup: MemberLookup; circleName: (id: string | null) => string | null },
  now = new Date(),
): Promise<Outcome<ClosedRecord>> {
  return inRoom(pool, sessionId, actor, async ({ conn, s, roles }) => {
    if (!roles.runs) return refuse(403, R.facilitatorOnly);
    const nowMs = now.getTime();
    const entries = (await repo.entryRows(conn, sessionId)).map(mapEntry);
    const people = (await repo.peopleRows(conn, sessionId)).map(mapPerson);
    const responses = (await repo.responseRows(conn, sessionId)).map(mapResponse);
    const { unowned, arrival, tallies } = closePlan(entries, people, responses, nowMs);
    if (unowned.length) return refuse(409, CLOSE_REFUSAL, { unowned });

    let items = (await repo.itemRows(conn, sessionId)).map(mapItem);
    for (const item of items) {
      if (item.status === "active" || s.state.activeItemId === item.id) {
        await repo.finishItemClock(conn, item.id, "done", usedAfter(item, s.state, nowMs), now);
      }
    }
    items = (await repo.itemRows(conn, sessionId)).map(mapItem);
    await repo.eraseArrivals(conn, sessionId);

    const closedState = applySessionAction(s.state, { type: "item", itemId: null }, nowMs);
    const closed: SessionRec = { ...s, status: "closed", closedAt: now.toISOString(), state: closedState };
    const circleName = ctx.circleName(s.circleId);
    const minutes = await composeMinutes(
      conn,
      { s: closed, items, entries, peopleNos: people.map((p) => p.no), tallies, arrival, circleName },
      ctx.lookup,
    );
    const summary: StoredSummary = {
      arrival,
      tallies,
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
    return done({
      id: sessionId,
      title: s.title,
      held: entries
        .filter((e) => e.kind === "action" && e.status === "open" && (e.ownerNo != null || e.ownerSeatId))
        .map((e) => ({ entryId: e.id, text: e.text, dueOn: e.dueOn, ownerNo: e.ownerNo, ownerSeatId: e.ownerSeatId })),
    });
  });
}

export interface NoticeDeps {
  notify(input: { userId: string; type: string; title: string; body?: string | null; link?: string | null; dedupeKey: string }): Promise<unknown>;
  notifyAdmins(type: string, title: string, dedupeKey: string, link?: string): Promise<void>;
}

/**
 * After a close commits, best effort: every admin hears the record is ready,
 * and every member holding an action hears it is theirs, as does every member
 * sitting in a seat that holds one. Each (action, member) pair has one stable
 * dedupe key, so a person who holds an action and sits in its seat hears once.
 * A failure is a log line; the session is closed either way.
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
      ? (await listOrgAssignments(pool)).filter((a) => a.holderKind === "member" && a.userId && !a.isExample)
      : [];
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
          body: SESSION_NOTICES.actionBody(h.text, h.dueOn),
          link,
          dedupeKey: `session-action:${h.entryId}:${userId}`,
        });
      }
    }
  } catch (e) {
    console.error("[sessions] the people holding actions were not all told", e);
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
 * item already brought into this session from there is not offered again.
 */
export function selectCarried(
  prev: { items: readonly SessionItem[]; entries: readonly SessionEntry[] },
  current: readonly SessionItem[],
  prevId: number,
): { actions: SessionEntry[]; backlog: SessionEntry[]; parkedItems: { title: string; aim: ItemAim; minutes: number }[] } {
  const broughtOver = new Set(current.filter((i) => i.fromSessionId === prevId).map((i) => i.title.toLowerCase()));
  return {
    actions: prev.entries.filter((e) => e.kind === "action" && e.status === "open"),
    backlog: prev.entries.filter((e) => (e.kind === "tension" && e.status !== "done") || e.status === "parked"),
    parkedItems: [...prev.items]
      .sort((a, b) => a.position - b.position)
      .filter((i) => (i.status === "parked" || i.status === "waiting") && !broughtOver.has(i.title.toLowerCase()))
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

/** Everything the room shows one viewer. The caller has already decided they may see it. */
export async function buildView(
  pool: Pool,
  s: SessionRec,
  viewer: Viewer,
  joined: boolean,
  ctx: { lookup: MemberLookup; circleName: (id: string | null) => string | null },
  now = Date.now(),
): Promise<SessionView> {
  const roles = rolesIn(s, viewer);
  const [peopleRaw, itemsRaw, entriesRaw] = await Promise.all([
    repo.peopleRows(pool, s.id),
    repo.itemRows(pool, s.id),
    repo.entryRows(pool, s.id),
  ]);
  const people = peopleRaw.map(mapPerson);
  const items = itemsRaw.map(mapItem);
  const entries = entriesRaw.map(mapEntry);
  const seesAnswers = joined || viewer.admin;
  const responses: ResponseRec[] = seesAnswers ? (await repo.responseRows(pool, s.id)).map(mapResponse) : [];
  const facilitation =
    roles.facilitates || viewer.admin
      ? (await repo.facilitationRows(pool, s.id))
          .filter((r) => (FACILITATION_VALUES as readonly string[]).includes(String(r.value)))
          .map((r) => ({ value: r.value as FacilitationValue, text: r.text == null ? null : String(r.text) }))
      : null;

  // What carries over, for a viewer who may read the earlier record.
  let carriedFrom: { prev: SessionRec; items: ItemRec[]; entries: EntryRec[] } | null = null;
  if (s.status === "open" && s.circleId) {
    const prevRows = await repo.lastClosedInCircle(pool, s.circleId, s.id);
    if (prevRows.length) {
      const prev = mapSession(prevRows[0]);
      const wasThere = viewer.no != null && (await repo.personRow(pool, prev.id, viewer.no)).length > 0;
      if (wasThere || viewer.admin) {
        carriedFrom = {
          prev,
          items: (await repo.itemRows(pool, prev.id)).map(mapItem),
          entries: (await repo.entryRows(pool, prev.id)).map(mapEntry),
        };
      }
    }
  }

  const nos = new Set<number>([s.facilitatorNo, ...people.map((p) => p.no)]);
  if (s.secretaryNo) nos.add(s.secretaryNo);
  for (const e of [...entries, ...(carriedFrom?.entries ?? [])]) if (e.ownerNo != null) nos.add(e.ownerNo);
  const [names, seats] = await Promise.all([namesFor(pool, nos, ctx.lookup), seatBook(pool, s.circleId)]);

  const open = s.status === "open";
  const peopleOut: SessionPerson[] = people.map((p) => ({
    userId: p.no,
    name: nameIn(names, p.no) ?? SESSION_SOMEONE,
    handle: names.get(p.no)?.handle ?? null,
    present: open && isPresentAt(p, now),
    // The arrival round is heard by the people in the room, and only while it is open.
    arrival: open && joined ? p.arrival : null,
    wish: open && joined ? p.wish : null,
  }));
  const responsesOut: SessionResponse[] = responses
    .map((r) => ({ target: parseResponseTarget(r.target), userId: r.no, value: r.value, text: r.text }))
    .filter((r): r is SessionResponse => r.target != null && r.target !== "facilitation");

  let carried: SessionView["carried"] = null;
  if (carriedFrom) {
    const picked = selectCarried(
      { items: carriedFrom.items.map(itemOut), entries: carriedFrom.entries.map((e) => entryOut(e, names, seats)) },
      items,
      carriedFrom.prev.id,
    );
    if (picked.actions.length || picked.backlog.length || picked.parkedItems.length) {
      carried = { sessionId: carriedFrom.prev.id, title: carriedFrom.prev.title, ...picked };
    }
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
    items: items.map(itemOut),
    entries: entries.map((e) => entryOut(e, names, seats)),
    responses: responsesOut,
    facilitation,
    seats: seats.options,
    arrival: s.status === "closed" ? (s.summary?.arrival ?? null) : null,
    carried,
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
 * the sessions they were in, the entries they wrote or hold, and their own
 * answers, feedback on the facilitation included, because it is theirs.
 */
export async function exportMemberSessions(pool: Pool, userId: string): Promise<{
  sessions: Record<string, unknown>[];
  entries: Record<string, unknown>[];
  responses: Record<string, unknown>[];
}> {
  const no = await memberNo(pool, userId);
  if (no == null) return { sessions: [], entries: [], responses: [] };
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
    at: toIso(r.updated_at),
  }));
  return { sessions, entries, responses };
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
    }
  });
  await repo.deleteMemberNo(pool, no);
}
