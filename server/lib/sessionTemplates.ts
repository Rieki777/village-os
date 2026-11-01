/**
 * MEETING TEMPLATES, the rules (0291). The contract is shared/sessionTemplates.ts;
 * every statement is server/repos/sessionTemplates.ts; the doors are
 * server/routes/sessionTemplates.ts.
 *
 * Three things live here.
 *
 *   1. The templates: seeded once, then listed, made, changed, duplicated,
 *      ordered and archived. Who may keep them is the gate's answer, asked by
 *      the route before anything here runs.
 *   2. The series: a session opened from a template is linked to it, and a
 *      template that feeds from another reads the latest session of that one
 *      opened before this session. "Last Monday's priorities" and "Carried
 *      over from Friday" are both that one read.
 *   3. The room's panel: the talking stick, the priorities and the shares,
 *      each written only while the session is open, by the people the
 *      contract names.
 */
import type { Pool, PoolConnection, RowDataPacket } from "mysql2/promise";
import * as repo from "../repos/sessionTemplates";
import * as rooms from "../repos/liveSessions";
import {
  CARRIES,
  DEFAULT_TEMPLATES,
  TEMPLATE_LIMITS,
  TEMPLATE_REFUSALS as R,
  cleanStickMove,
  cleanTemplate,
  cleanTemplatePatch,
  copyName,
  flowHas,
  isPriorityOutcome,
  isShareKind,
  moveStick,
  nextPosition,
  readFlow,
  readStick,
  stickHolders,
  type PriorityOutcome,
  type PriorityRow,
  type SeriesReadBack,
  type SessionTemplate,
  type ShareKind,
  type ShareRow,
  type TemplateInput,
  type TemplateRoomView,
  cleanServesGoal,
  groupTensions,
  resolveGoal,
  type SeasonGoalRef,
  weekOf,
  type SeasonPriorityItem,
  type SeasonRef,
  type SeasonView,
  type SeasonWeek,
  type SeasonWin,
} from "../../shared/sessionTemplates";
import { seasonEndInstant } from "./governanceWindows";
import { assignGoalIds } from "./seasonGoals";
import { cleanLine, cleanText } from "../../shared/sessions";
import { isPresentAt, mapSession, namesFor, rolesIn, type MemberLookup, type Outcome, type Refusal } from "./liveSessions";

const refuse = (status: number, error: string): Refusal => ({ ok: false, status, error });
const done = <T>(value: T): Outcome<T> => ({ ok: true, value });
const bodyOf = (raw: unknown): Record<string, unknown> => (raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {});

const toIso = (v: unknown): string => {
  const d = v instanceof Date ? v : new Date(String(v ?? ""));
  return Number.isFinite(d.getTime()) ? d.toISOString() : new Date(0).toISOString();
};
const intOrNull = (v: unknown): number | null => (v == null ? null : Number.isInteger(Number(v)) ? Number(v) : null);

// ── Templates ───────────────────────────────────────────────────────────────

export function mapTemplate(r: RowDataPacket | Record<string, unknown>): SessionTemplate {
  return {
    id: Number(r.id),
    name: String(r.name ?? ""),
    category: String(r.category ?? ""),
    summary: String(r.summary ?? ""),
    circleId: r.circle_id == null ? null : String(r.circle_id),
    durationMin: intOrNull(r.duration_min),
    flow: readFlow(r.flow),
    position: Number(r.position ?? 1),
    status: r.status === "archived" ? "archived" : "active",
    feedsFromId: intOrNull(r.feeds_from_id),
    updatedAt: toIso(r.updated_at),
  };
}

/**
 * Write the three default templates once. A seed row that already exists is
 * left as it is, edited or archived, so seeding never undoes anybody's
 * feedback. Each seed's "feeds from" is linked by key after all are written.
 */
export async function ensureSeeded(pool: Pool, now = new Date()): Promise<void> {
  if ((await repo.seededCount(pool)) >= DEFAULT_TEMPLATES.length) return;
  for (const s of DEFAULT_TEMPLATES) {
    await repo.insertSeed(pool, {
      seedKey: s.seedKey,
      name: s.name,
      category: s.category,
      summary: s.summary,
      durationMin: s.durationMin,
      flow: JSON.stringify(s.flow),
      position: s.position,
      now,
    });
  }
  const ids = new Map((await repo.seedIdRows(pool)).map((r) => [String(r.seed_key), Number(r.id)]));
  for (const s of DEFAULT_TEMPLATES) {
    const id = ids.get(s.seedKey);
    const from = s.feedsFrom ? ids.get(s.feedsFrom) : undefined;
    if (id != null && from != null) await repo.linkSeed(pool, id, from);
  }
}

export async function listTemplates(pool: Pool | PoolConnection): Promise<SessionTemplate[]> {
  return (await repo.templateRows(pool)).map(mapTemplate);
}

async function oneTemplate(q: Pool | PoolConnection, id: number, lock = false): Promise<SessionTemplate | null> {
  const rows = await repo.templateRow(q, id, lock);
  return rows.length ? mapTemplate(rows[0]) : null;
}

/** A "feeds from" that names a template the village keeps, never itself. */
async function checkFeeds(q: Pool | PoolConnection, feedsFromId: number | null, selfId: number | null): Promise<Refusal | null> {
  if (feedsFromId == null) return null;
  if (selfId != null && feedsFromId === selfId) return refuse(400, R.feedsSelf);
  return (await oneTemplate(q, feedsFromId)) ? null : refuse(400, R.feedsUnknown);
}

export async function createTemplate(
  pool: Pool,
  byNo: number,
  raw: unknown,
  circleIds: ReadonlySet<string>,
  now = new Date(),
): Promise<Outcome<{ template: SessionTemplate }>> {
  const input = cleanTemplate(raw, circleIds);
  if (!input.ok) return refuse(input.status, input.error);
  return rooms.inTransaction(pool, async (conn) => {
    if ((await repo.templateCount(conn)) >= TEMPLATE_LIMITS.templates) return refuse(409, R.tooMany);
    const feeds = await checkFeeds(conn, input.value.feedsFromId, null);
    if (feeds) return feeds;
    const all = await listTemplates(conn);
    const id = await repo.insertTemplate(conn, { ...rowOf(input.value), position: nextPosition(all, input.value.category), byNo, now });
    const template = await oneTemplate(conn, id);
    if (!template) throw new Error("session templates: a template just made could not be read back");
    return done({ template });
  });
}

const rowOf = (t: TemplateInput) => ({
  name: t.name,
  category: t.category,
  summary: t.summary,
  circleId: t.circleId,
  durationMin: t.durationMin,
  flow: JSON.stringify(t.flow),
  feedsFromId: t.feedsFromId,
});

export async function changeTemplate(
  pool: Pool,
  byNo: number,
  id: number,
  raw: unknown,
  circleIds: ReadonlySet<string>,
  now = new Date(),
): Promise<Outcome<{ template: SessionTemplate }>> {
  const patch = cleanTemplatePatch(raw, circleIds);
  if (!patch.ok) return refuse(patch.status, patch.error);
  return rooms.inTransaction(pool, async (conn) => {
    const was = await oneTemplate(conn, id, true);
    if (!was) return refuse(404, R.notFound);
    const next: TemplateInput = {
      name: patch.value.name ?? was.name,
      category: patch.value.category ?? was.category,
      summary: patch.value.summary ?? was.summary,
      circleId: patch.value.circleId !== undefined ? patch.value.circleId : was.circleId,
      durationMin: patch.value.durationMin !== undefined ? patch.value.durationMin : was.durationMin,
      flow: patch.value.flow ?? was.flow,
      feedsFromId: patch.value.feedsFromId !== undefined ? patch.value.feedsFromId : was.feedsFromId,
    };
    const feeds = await checkFeeds(conn, next.feedsFromId, id);
    if (feeds) return feeds;
    // A template that moves category goes to the end of its new one.
    const position = next.category === was.category ? was.position : nextPosition(await listTemplates(conn), next.category);
    await repo.writeTemplate(conn, id, { ...rowOf(next), position, byNo, now });
    const template = await oneTemplate(conn, id);
    if (!template) throw new Error("session templates: a template just changed could not be read back");
    return done({ template });
  });
}

/** A copy, active, at the end of its category, reading back from what the original read back from. */
export async function duplicateTemplate(pool: Pool, byNo: number, id: number, now = new Date()): Promise<Outcome<{ template: SessionTemplate }>> {
  return rooms.inTransaction(pool, async (conn) => {
    const was = await oneTemplate(conn, id);
    if (!was) return refuse(404, R.notFound);
    if ((await repo.templateCount(conn)) >= TEMPLATE_LIMITS.templates) return refuse(409, R.tooMany);
    const copy: TemplateInput = { ...was, name: copyName(was.name) };
    const newId = await repo.insertTemplate(conn, { ...rowOf(copy), position: nextPosition(await listTemplates(conn), was.category), byNo, now });
    const template = await oneTemplate(conn, newId);
    if (!template) throw new Error("session templates: a copy just made could not be read back");
    return done({ template });
  });
}

export async function archiveTemplate(pool: Pool, byNo: number, id: number, raw: unknown, now = new Date()): Promise<Outcome<{ template: SessionTemplate }>> {
  const archived = bodyOf(raw).archived !== false;
  const was = await oneTemplate(pool, id);
  if (!was) return refuse(404, R.notFound);
  await repo.writeStatus(pool, id, archived ? "archived" : "active", byNo, now);
  return done({ template: { ...was, status: archived ? "archived" : "active" } });
}

/**
 * Move a template one place earlier or later among the active templates of
 * its category, by swapping positions with its neighbour. Positions are made
 * distinct first, so two templates that share a number still move.
 */
export async function moveTemplate(pool: Pool, id: number, raw: unknown, now = new Date()): Promise<Outcome<{ templates: SessionTemplate[] }>> {
  const direction = bodyOf(raw).direction;
  if (direction !== "up" && direction !== "down") return refuse(400, R.notFound);
  return rooms.inTransaction(pool, async (conn) => {
    const all = await listTemplates(conn);
    const me = all.find((t) => t.id === id);
    if (!me) return refuse(404, R.notFound);
    const peers = all
      .filter((t) => t.category === me.category && t.status === "active")
      .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name) || a.id - b.id);
    const i = peers.findIndex((t) => t.id === id);
    const j = direction === "up" ? i - 1 : i + 1;
    if (i < 0 || j < 0 || j >= peers.length) return done({ templates: all });
    [peers[i], peers[j]] = [peers[j], peers[i]];
    for (let k = 0; k < peers.length; k++) {
      if (peers[k].position !== k + 1) await repo.writePosition(conn, peers[k].id, k + 1, now);
    }
    return done({ templates: await listTemplates(conn) });
  });
}

// ── The series ──────────────────────────────────────────────────────────────

/** The template a new session asks to be opened from: absent is none; anything else must be an active template. */
export async function templateForStart(pool: Pool, raw: unknown): Promise<Outcome<SessionTemplate | null>> {
  if (raw == null || raw === "") return done(null);
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0 || id >= 2 ** 31) return refuse(400, R.notFound);
  const t = await oneTemplate(pool, id);
  if (!t) return refuse(400, R.notFound);
  if (t.status !== "active") return refuse(400, R.archived);
  return done(t);
}

/** Link a session to the template it was opened from. Linking twice is a quiet yes. */
export async function linkSession(pool: Pool, sessionId: number, templateId: number, now = new Date()): Promise<void> {
  await repo.insertUse(pool, sessionId, templateId, now);
}

const mapPriority = (r: RowDataPacket): PriorityRow => ({
  id: Number(r.id),
  text: String(r.text ?? ""),
  position: Number(r.position ?? 1),
  outcome: isPriorityOutcome(r.outcome) ? r.outcome : null,
  servesGoalId: r.serves_goal_id == null || r.serves_goal_id === "" ? null : String(r.serves_goal_id),
  servesGoal: r.serves_goal == null || r.serves_goal === "" ? null : String(r.serves_goal),
});

/** A link's words as the season says them now, when it still holds the goal; else the words it was linked with. */
function currentWords<T extends { servesGoalId: string | null; servesGoal: string | null }>(row: T, goals: readonly SeasonGoalRef[]): T {
  const goal = resolveGoal(goals, row.servesGoalId, row.servesGoal);
  return goal ? { ...row, servesGoalId: goal.id, servesGoal: goal.text } : row;
}

/** The session of the fed-from template that this one reads back: the latest opened before it. */
async function fedFromSession(q: Pool | PoolConnection, template: SessionTemplate | null, sessionId: number) {
  if (!template?.feedsFromId) return null;
  const rows = await repo.latestOfTemplateBefore(q, template.feedsFromId, sessionId);
  return rows.length ? { id: Number(rows[0].id), title: String(rows[0].title ?? ""), openedAt: toIso(rows[0].created_at) } : null;
}

/**
 * What one session reads back from its series.
 *
 * `review` (a `priorities_review` section): the priorities the fed-from
 * session chose, with whatever outcome they hold now.
 *
 * `carried` (a `carried_over` section): of the priorities the fed-from
 * session MARKED, the ones that come back (partly done, carried over). This is
 * the Monday that reads Friday: Friday marked Monday's priorities, and the
 * ones it carried return here, minus any this session already took up again.
 */
export async function seriesReadBack(
  q: Pool | PoolConnection,
  template: SessionTemplate | null,
  sessionId: number,
): Promise<{ review: SeriesReadBack | null; carried: SeriesReadBack | null }> {
  if (!template) return { review: null, carried: null };
  const wantsReview = flowHas(template.flow, "priorities_review");
  const wantsCarried = flowHas(template.flow, "carried_over");
  if (!wantsReview && !wantsCarried) return { review: null, carried: null };
  const from = await fedFromSession(q, template, sessionId);
  if (!from) return { review: null, carried: null };
  const base = { sessionId: from.id, sessionTitle: from.title, openedAt: from.openedAt };
  const review = wantsReview ? { ...base, rows: (await repo.priorityRows(q, from.id)).map(mapPriority) } : null;
  let carried: SeriesReadBack | null = null;
  if (wantsCarried) {
    const taken = new Set((await repo.carriedInto(q, sessionId)).map((r) => Number(r.carried_from_id)));
    const rows = (await repo.markedBy(q, from.id)).map(mapPriority).filter((p) => p.outcome && CARRIES.has(p.outcome) && !taken.has(p.id));
    carried = { ...base, rows };
  }
  return { review, carried };
}

// ── The room's panel ────────────────────────────────────────────────────────

export interface RoomAsker {
  no: number | null;
  admin: boolean;
}

interface RoomFacts {
  s: ReturnType<typeof mapSession>;
  joined: boolean;
  hosts: boolean;
  template: SessionTemplate | null;
  stickRaw: unknown;
}

async function roomFacts(q: Pool | PoolConnection, sessionId: number, who: RoomAsker, lock = false): Promise<RoomFacts | null> {
  const rows = await rooms.sessionRow(q, sessionId, lock);
  if (!rows.length) return null;
  const s = mapSession(rows[0]);
  const joined = who.no != null && (await rooms.personRow(q, sessionId, who.no)).length > 0;
  const roles = rolesIn(s, { no: who.no, admin: who.admin });
  const use = await repo.useRow(q, sessionId, lock);
  const template = use.length ? await oneTemplate(q, Number(use[0].template_id)) : null;
  return { s, joined, hosts: joined && roles.notes, template, stickRaw: use.length ? use[0].stick : null };
}

/** The room's panel, as this viewer may see it. Null: no such session, or one this viewer may not read. */
export async function roomView(
  pool: Pool,
  sessionId: number,
  who: RoomAsker,
  lookup: MemberLookup,
  season: SeasonRef | null = null,
  now = Date.now(),
): Promise<TemplateRoomView | null> {
  const f = await roomFacts(pool, sessionId, who);
  if (!f) return null;
  if (!(f.s.status === "open" || f.joined || who.admin)) return null;
  const people = (await rooms.peopleRows(pool, sessionId)).map((r) => ({ no: Number(r.member_no), lastSeenMs: r.last_seen_at == null ? null : new Date(r.last_seen_at).getTime() }));
  const hereNos = people.filter((p) => isPresentAt(p, now)).map((p) => p.no);
  const stick = readStick(f.stickRaw);
  const shareRows = f.template ? await repo.shareRows(pool, sessionId) : [];
  const names = await namesFor(
    pool,
    [...hereNos, ...stick.order, ...shareRows.map((r) => Number(r.speaker_no))],
    lookup,
  );
  const nameOf = (no: number) => names.get(no)?.name ?? "";
  const { review, carried } = await seriesReadBack(pool, f.template, sessionId);
  const { holder, next } = stickHolders(stick);
  const shares: ShareRow[] = shareRows.map((r) => ({
    id: Number(r.id),
    kind: (isShareKind(r.kind) ? r.kind : "grateful") as ShareKind,
    text: String(r.text ?? ""),
    speaker: Number(r.speaker_no) > 0 ? nameOf(Number(r.speaker_no)) : null,
    broughtAs: intOrNull(r.library_id),
    servesGoalId: r.serves_goal_id == null || r.serves_goal_id === "" ? null : String(r.serves_goal_id),
    servesGoal: r.serves_goal == null || r.serves_goal === "" ? null : String(r.serves_goal),
    at: toIso(r.created_at),
  }));
  const goals = season?.goals ?? [];
  const words = <T extends { servesGoalId: string | null; servesGoal: string | null }>(rows: T[]) => rows.map((r) => currentWords(r, goals));
  const readBack = (r: SeriesReadBack | null) => (r ? { ...r, rows: words(r.rows) } : null);
  return {
    template: f.template
      ? { id: f.template.id, name: f.template.name, category: f.template.category, summary: f.template.summary, flow: f.template.flow }
      : null,
    hosts: f.hosts,
    joined: f.joined,
    open: f.s.status === "open",
    here: hereNos.map((no) => ({ no, name: nameOf(no) })),
    stick: stick.order.length ? { people: stick.order.map((no) => ({ no, name: nameOf(no) })), holder, next, rounds: stick.rounds } : null,
    priorities: f.template ? words((await repo.priorityRows(pool, sessionId)).map(mapPriority)) : [],
    review: readBack(review),
    carried: readBack(carried),
    shares: words(shares),
    season: f.template && season && season.goals.length ? season : null,
  };
}

/**
 * Run a write against one open, templated room: the session row is locked
 * first (the order every room writer takes), the room must be open, the
 * writer in it, and `hostsOnly` writes need the facilitator, the secretary or
 * a joined admin.
 */
async function inTemplatedRoom<T>(
  pool: Pool,
  sessionId: number,
  who: RoomAsker,
  hostsOnly: boolean,
  work: (conn: PoolConnection, f: RoomFacts & { no: number }) => Promise<Outcome<T>>,
): Promise<Outcome<T>> {
  return rooms.inTransaction(pool, async (conn) => {
    const f = await roomFacts(conn, sessionId, who, true);
    if (!f || !f.template) return refuse(404, R.roomNotFound);
    if (f.s.status !== "open") return refuse(409, R.roomClosed);
    if (!f.joined || who.no == null) return refuse(403, R.joinFirst);
    if (hostsOnly && !f.hosts) return refuse(403, R.hostsOnly);
    return work(conn, { ...f, no: who.no });
  });
}

export async function stickAct(pool: Pool, sessionId: number, who: RoomAsker, raw: unknown, now = new Date()): Promise<Outcome<null>> {
  const m = cleanStickMove(raw);
  if (!m.ok) return refuse(m.status, m.error);
  return inTemplatedRoom(pool, sessionId, who, true, async (conn, f) => {
    if (m.value.move === "start" || m.value.move === "give") {
      const inRoom = new Set((await rooms.peopleRows(conn, sessionId)).map((r) => Number(r.member_no)));
      const wanted = m.value.move === "start" ? m.value.order : [m.value.to];
      if (!wanted.every((n) => inRoom.has(n))) return refuse(400, R.stickNotHere);
    }
    const next = moveStick(readStick(f.stickRaw), m.value);
    await repo.writeStick(conn, sessionId, next.order.length ? JSON.stringify(next) : null, now);
    return done(null);
  });
}

/** Add a priority to this session: in a few words, or taken up again from what the series carried over. */
export async function addPriority(
  pool: Pool,
  sessionId: number,
  who: RoomAsker,
  raw: unknown,
  goals: readonly SeasonGoalRef[] = [],
  now = new Date(),
): Promise<Outcome<null>> {
  const b = bodyOf(raw);
  const serves = cleanServesGoal(b, goals);
  if (!serves.ok) return refuse(400, R.goalUnknown);
  return inTemplatedRoom(pool, sessionId, who, true, async (conn, f) => {
    const mine = (await repo.priorityRows(conn, sessionId)).map(mapPriority);
    if (mine.length >= TEMPLATE_LIMITS.priorities) return refuse(409, R.prioritiesFull);
    const position = mine.reduce((m, p) => Math.max(m, p.position), 0) + 1;
    if (b.fromCarried != null) {
      const { carried } = await seriesReadBack(conn, f.template, sessionId);
      const from = carried?.rows.find((p) => p.id === Number(b.fromCarried));
      if (!from) return refuse(404, R.priorityNotFound);
      // A priority taken up again keeps the season priority it served, unless the room names another.
      const kept = serves.value ?? resolveGoal(goals, from.servesGoalId, from.servesGoal);
      await repo.insertPriority(conn, {
        sessionId,
        position,
        text: from.text,
        authorNo: f.no,
        carriedFromId: from.id,
        servesGoal: kept?.text ?? from.servesGoal,
        servesGoalId: kept?.id ?? from.servesGoalId,
        now,
      });
      return done(null);
    }
    const text = cleanLine(b.text, TEMPLATE_LIMITS.priorityText);
    if (!text) return refuse(400, R.priorityNeeded);
    await repo.insertPriority(conn, {
      sessionId,
      position,
      text,
      authorNo: f.no,
      carriedFromId: null,
      servesGoal: serves.value?.text ?? null,
      servesGoalId: serves.value?.id ?? null,
      now,
    });
    return done(null);
  });
}

/**
 * Change one priority. This session's own: new words, or taken off. The
 * read-back's (the fed-from session's): an outcome, done, partly or carried
 * over, or `null` to clear it. Nothing else is reachable from this room.
 */
export async function patchPriority(
  pool: Pool,
  sessionId: number,
  who: RoomAsker,
  priorityId: number,
  raw: unknown,
  goals: readonly SeasonGoalRef[] = [],
  now = new Date(),
): Promise<Outcome<null>> {
  const b = bodyOf(raw);
  return inTemplatedRoom(pool, sessionId, who, true, async (conn, f) => {
    const rows = await repo.priorityRow(conn, priorityId, true);
    if (!rows.length) return refuse(404, R.priorityNotFound);
    const ownerSession = Number(rows[0].session_id);
    if (ownerSession === sessionId) {
      if (b.remove === true) {
        await repo.deletePriority(conn, priorityId);
        return done(null);
      }
      if ("servesGoalId" in b || "servesGoal" in b) {
        const serves = cleanServesGoal(b, goals);
        if (!serves.ok) return refuse(400, R.goalUnknown);
        await repo.writePriorityServes(conn, priorityId, serves.value, now);
        return done(null);
      }
      const text = cleanLine(b.text, TEMPLATE_LIMITS.priorityText);
      if (!text) return refuse(400, R.priorityNeeded);
      await repo.writePriorityText(conn, priorityId, text, now);
      return done(null);
    }
    const { review } = await seriesReadBack(conn, f.template, sessionId);
    if (!review || review.sessionId !== ownerSession) return refuse(403, R.priorityNotOurs);
    if (!("outcome" in b)) return refuse(400, R.outcomeUnknown);
    let outcome: PriorityOutcome | null = null;
    if (b.outcome != null) {
      if (!isPriorityOutcome(b.outcome)) return refuse(400, R.outcomeUnknown);
      outcome = b.outcome;
    }
    await repo.writeOutcome(conn, priorityId, outcome, outcome ? sessionId : null, outcome ? f.no : 0, now);
    return done(null);
  });
}

/** Capture what was shared around the stick. Anyone in the room. The speaker is whoever holds the stick, unless one is named. */
export async function addShare(
  pool: Pool,
  sessionId: number,
  who: RoomAsker,
  raw: unknown,
  goals: readonly SeasonGoalRef[] = [],
  now = new Date(),
): Promise<Outcome<null>> {
  const b = bodyOf(raw);
  if (!isShareKind(b.kind)) return refuse(400, R.shareKind);
  const serves = cleanServesGoal(b, goals);
  if (!serves.ok) return refuse(400, R.goalUnknown);
  const kind = b.kind;
  const text = cleanText(b.text, TEMPLATE_LIMITS.shareText);
  if (!text) return refuse(400, R.shareNeeded);
  return inTemplatedRoom(pool, sessionId, who, false, async (conn, f) => {
    if ((await repo.shareCount(conn, sessionId)) >= TEMPLATE_LIMITS.shares) return refuse(409, R.sharesFull);
    const stick = readStick(f.stickRaw);
    const named = typeof b.speakerNo === "number" && stick.order.includes(b.speakerNo) ? b.speakerNo : null;
    const speakerNo = named ?? stickHolders(stick).holder ?? 0;
    await repo.insertShare(conn, { sessionId, kind, text, speakerNo, authorNo: f.no, servesGoal: serves.value?.text ?? null, servesGoalId: serves.value?.id ?? null, now });
    return done(null);
  });
}

/** Name, change or clear the season priority a share (a win, most often) serves. Anyone in the open room. */
export async function patchShare(
  pool: Pool,
  sessionId: number,
  who: RoomAsker,
  shareId: number,
  raw: unknown,
  goals: readonly SeasonGoalRef[] = [],
): Promise<Outcome<null>> {
  const serves = cleanServesGoal(bodyOf(raw), goals);
  if (!serves.ok) return refuse(400, R.goalUnknown);
  return inTemplatedRoom(pool, sessionId, who, false, async (conn) => {
    if (!(await repo.shareRow(conn, sessionId, shareId, true)).length) return refuse(404, R.shareNotFound);
    await repo.writeShareServes(conn, shareId, serves.value);
    return done(null);
  });
}

/**
 * Name, change or clear the season priority a WIN on an agenda item serves
 * (0298). The room's own entries, any session, templated or not: anybody in
 * the open room, the people who may add a win there. Only a win serves the
 * season. Answers with every win's link in that session.
 */
export async function patchEntryServes(
  pool: Pool,
  sessionId: number,
  who: RoomAsker,
  entryId: number,
  raw: unknown,
  goals: readonly SeasonGoalRef[] = [],
): Promise<Outcome<{ entryLinks: Record<number, string> }>> {
  const serves = cleanServesGoal(bodyOf(raw), goals);
  if (!serves.ok) return refuse(400, R.goalUnknown);
  return rooms.inTransaction(pool, async (conn) => {
    const f = await roomFacts(conn, sessionId, who, true);
    if (!f) return refuse(404, R.roomNotFound);
    if (f.s.status !== "open") return refuse(409, R.roomClosed);
    if (!f.joined) return refuse(403, R.joinFirst);
    const rows = await repo.entryKindRow(conn, sessionId, entryId, true);
    if (!rows.length) return refuse(404, R.entryNotFound);
    if (String(rows[0].kind) !== "win") return refuse(400, R.onlyWins);
    await repo.writeEntryServes(conn, entryId, serves.value);
    // The room's own view reads the link off the entry, so its version moves and every open page sees it.
    await rooms.bumpVersion(conn, sessionId);
    return done({ entryLinks: Object.fromEntries((await repo.entryLinkRows(conn, sessionId)).map((r) => [Number(r.id), String(r.serves_goal_id)])) });
  });
}

/**
 * Bring a share to a later session: it becomes an item in the agenda library
 * for the session's circle (or the one named), a tension as an Explore and
 * anything else as a Report. `bring` is the library's own door, handed in by
 * the route, so the library keeps its own limits and words. Once only.
 */
export async function bringShare(
  pool: Pool,
  sessionId: number,
  who: RoomAsker,
  shareId: number,
  raw: unknown,
  bring: (input: { title: string; aim: "report" | "explore"; note: string | null; circleId: string | null }) => Promise<Outcome<{ id: number }>>,
): Promise<Outcome<null>> {
  const facts = await roomFacts(pool, sessionId, who);
  if (!facts || !facts.template) return refuse(404, R.roomNotFound);
  if (!facts.joined) return refuse(403, R.joinFirst);
  const rows = await repo.shareRow(pool, sessionId, shareId);
  if (!rows.length) return refuse(404, R.shareNotFound);
  if (rows[0].library_id != null) return refuse(409, R.broughtAlready);
  const text = String(rows[0].text ?? "");
  const kind = String(rows[0].kind);
  const b = bodyOf(raw);
  const circleId = typeof b.circleId === "string" && b.circleId ? b.circleId : facts.s.circleId;
  const title = cleanLine(text, 120) ?? text.slice(0, 120);
  const out = await bring({ title, aim: kind === "tension" ? "explore" : "report", note: text.length > title.length ? text : null, circleId });
  if (!out.ok) return out;
  await repo.writeShareLibrary(pool, shareId, out.value.id);
  return done(null);
}

// ── The season view (0292) ──────────────────────────────────────────────────

/** A season as the view reads it, from the season document (`seasonState().seasons`). */
export interface SeasonEntry {
  id: string;
  name: string;
  focus: string;
  startsOn: string;
  endsOn: string | null;
  goals: { id: string; text: string; done: boolean }[];
}

/** The season document's list, read tolerantly. */
export function readSeasons(raw: unknown): SeasonEntry[] {
  return (Array.isArray(raw) ? raw : [])
    .filter((x): x is Record<string, unknown> => !!x && typeof x === "object" && typeof (x as any).id === "string" && /^\d{4}-\d{2}-\d{2}$/.test(String((x as any).startsOn ?? "")))
    .map((x) => ({
      id: String(x.id),
      name: String(x.name ?? x.id),
      focus: typeof x.focus === "string" ? x.focus : "",
      startsOn: String(x.startsOn),
      endsOn: typeof x.endsOn === "string" && x.endsOn ? x.endsOn : null,
      // Ids come with the document since 0298; one read before then derives them the same way.
      goals: assignGoalIds(Array.isArray(x.goals) ? x.goals : [])
        .filter((g) => g.text.trim())
        .map((g) => ({ id: g.id, text: g.text.trim(), done: g.done })),
    }))
    .sort((a, b) => a.startsOn.localeCompare(b.startsOn));
}

/** The running season as a room reads it: its id, name and its goals' ids and words. */
export function seasonRefOf(current: unknown): SeasonRef | null {
  const [s] = readSeasons(current ? [current] : []);
  return s ? { id: s.id, name: s.name, goals: s.goals.map((g) => ({ id: g.id, text: g.text })) } : null;
}

/**
 * The season so far: priorities set against priorities done for each season
 * priority, wins over time, and the tensions that keep coming up in Heart
 * share. Counts and words only. No score, no ranking, no person's name.
 *
 * The window is the season's own dates in the village's zone: from its first
 * day to its `endsOn`, or to the next season's first day, or open. A session
 * belongs to the season it was opened in.
 *
 * A tension's words reach only the people who were in a Heart share it came
 * up in, and admins; everybody else reads that it came up, and how often.
 */
export async function seasonView(
  pool: Pool,
  source: { seasons: unknown; current: unknown; timezone: string },
  seasonId: string | null,
  viewer: RoomAsker,
): Promise<Outcome<SeasonView | null>> {
  const seasons = readSeasons(source.seasons);
  const currentId = seasonRefOf(source.current)?.id ?? null;
  const pick = seasonId ?? currentId ?? seasons[seasons.length - 1]?.id ?? null;
  if (pick == null) return done(null);
  const i = seasons.findIndex((x) => x.id === pick);
  if (i < 0) return refuse(404, R.seasonUnknown);
  const season = seasons[i];
  const tz = source.timezone || "UTC";
  const from = seasonEndInstant(season.startsOn, tz) ?? new Date(`${season.startsOn}T00:00:00Z`);
  const endDay = season.endsOn ?? seasons[i + 1]?.startsOn ?? null;
  const to = (endDay ? seasonEndInstant(endDay, tz) : null) ?? new Date("9999-12-31T00:00:00Z");

  // Every link finds its goal by id, or, for a link from before ids, by its words.
  const refs: SeasonGoalRef[] = season.goals.map((g) => ({ id: g.id, text: g.text }));
  const text = (v: unknown) => (v == null || v === "" ? null : String(v));
  const goalOf = (r: RowDataPacket) => resolveGoal(refs, text(r.serves_goal_id), text(r.serves_goal));

  type Linked<T> = T & { goalId: string | null; linkedWords: string | null };
  const priorities: Linked<SeasonPriorityItem>[] = (await repo.prioritiesInWindow(pool, from, to)).map((r) => ({
    text: String(r.text ?? ""),
    outcome: isPriorityOutcome(r.outcome) ? r.outcome : null,
    sessionId: Number(r.session_id),
    sessionTitle: String(r.session_title ?? ""),
    at: toIso(r.session_at),
    goalId: goalOf(r)?.id ?? null,
    linkedWords: text(r.serves_goal),
  }));
  const shareRows = await repo.sharesInWindow(pool, ["win", "tension", "not_working"], from, to);
  const winOf = (r: RowDataPacket, source: SeasonWin["source"]): Linked<SeasonWin> => {
    const goal = goalOf(r);
    return {
      text: String(r.text ?? ""),
      servesGoal: goal?.text ?? text(r.serves_goal),
      source,
      sessionTitle: String(r.session_title ?? ""),
      at: toIso(r.session_at),
      goalId: goal?.id ?? null,
      linkedWords: text(r.serves_goal),
    };
  };
  // Wins from a meeting's wins section and from agenda items alike, in the order their meetings were held.
  const wins = [
    ...shareRows.filter((r) => r.kind === "win").map((r) => winOf(r, "meeting")),
    ...(await repo.itemWinsInWindow(pool, from, to)).map((r) => winOf(r, "item")),
  ].sort((a, b) => a.at.localeCompare(b.at));
  const plainPriority = ({ goalId: _g, linkedWords: _w, ...p }: Linked<SeasonPriorityItem>): SeasonPriorityItem => p;
  const plainWin = ({ goalId: _g, linkedWords: _w, ...w }: Linked<SeasonWin>): SeasonWin => w;
  const goals = season.goals.map((g) => ({
    id: g.id,
    text: g.text,
    done: g.done,
    priorities: priorities.filter((p) => p.goalId === g.id).map(plainPriority),
    wins: wins.filter((w) => w.goalId === g.id).map(plainWin),
  }));

  // Wins over time, a row per week that had any, oldest first. Everything is dated by the
  // meeting it came up in, so a week means the meetings held in it.
  const weeks = new Map<string, SeasonWeek>();
  const week = (iso: string): SeasonWeek => {
    const k = weekOf(iso);
    let w = weeks.get(k);
    if (!w) weeks.set(k, (w = { weekOf: k, wins: [], prioritiesSet: 0, prioritiesDone: 0 }));
    return w;
  };
  for (const w of wins) week(w.at).wins.push(plainWin(w));
  for (const p of priorities) {
    const w = week(p.at);
    w.prioritiesSet++;
    if (p.outcome === "done") w.prioritiesDone++;
  }

  // Tensions from Heart share: what was named a tension, or as not working, around a talking stick.
  const groups = groupTensions(
    shareRows
      .filter((r) => r.kind !== "win")
      .map((r) => ({
        shareId: Number(r.id),
        text: String(r.text ?? ""),
        sessionId: Number(r.session_id),
        at: toIso(r.session_at),
        sameAsId: intOrNull(r.same_as_id),
        standsAlone: Number(r.stands_alone) === 1,
      })),
  );
  const wereIn = await sessionsSeen(pool, viewer, groups.flatMap((g) => g.sessionIds));
  // The words reach people who were in a Heart share the tension came up in; each wording only for its own Heart share.
  const tensions = groups.map((g) => {
    const seen = g.sessionIds.some((id) => wereIn(id));
    return { ...g, text: seen ? g.text : null, members: seen ? (g.members ?? []).filter((m) => wereIn(m.sessionId)) : null };
  });

  return done({
    season: { id: season.id, name: season.name, focus: season.focus, startsOn: season.startsOn, endsOn: endDay },
    seasons: seasons.map((x) => ({ id: x.id, name: x.name, startsOn: x.startsOn })),
    goals,
    unlinked: priorities.filter((p) => !p.goalId).map((p) => ({ ...plainPriority(p), servedGoal: p.linkedWords })),
    unlinkedWins: wins.filter((w) => !w.goalId).map(plainWin),
    weeks: Array.from(weeks.values()).sort((a, b) => a.weekOf.localeCompare(b.weekOf)),
    tensions,
  });
}

/**
 * After the season document is saved: every link to a goal takes the goal's
 * words as the season says them now (0298). Called by the season's save door
 * (server/routes/seasons.ts), so a goal reworded and later removed leaves its
 * links saying what it was last called.
 */
export async function refreshLinkedGoalWords(pool: Pool, seasons: unknown): Promise<void> {
  for (const s of readSeasons(seasons)) {
    for (const g of s.goals) await repo.refreshGoalWords(pool, g.id, g.text);
  }
}

/** Whether a viewer was in a session: an admin reads all; anybody else, the ones they joined. */
async function sessionsSeen(pool: Pool | PoolConnection, viewer: RoomAsker, sessionIds: readonly number[]): Promise<(id: number) => boolean> {
  if (viewer.admin) return () => true;
  if (viewer.no == null || !sessionIds.length) return () => false;
  const ids = new Set((await repo.sessionsWith(pool, viewer.no, Array.from(new Set(sessionIds)))).map((r) => Number(r.session_id)));
  return (id) => ids.has(id);
}

/**
 * Say how a Heart share tension groups (0298): `{ sameAsId }` joins it to
 * another tension (null lets go), `{ standsAlone }` keeps the word guess away
 * from it. Only people who were in that Heart share, and admins; joining two
 * needs both. A tension is something captured as a tension or as not working.
 */
export async function regroupTension(pool: Pool, shareId: number, raw: unknown, viewer: RoomAsker): Promise<Outcome<null>> {
  const b = bodyOf(raw);
  const one = await repo.shareById(pool, shareId);
  const isTension = (r: RowDataPacket | undefined) => !!r && (r.kind === "tension" || r.kind === "not_working");
  if (!isTension(one[0])) return refuse(404, R.tensionNotFound);
  if ("standsAlone" in b) {
    const seen = await sessionsSeen(pool, viewer, [Number(one[0].session_id)]);
    if (!seen(Number(one[0].session_id))) return refuse(403, R.tensionNotYours);
    await repo.writeStandsAlone(pool, shareId, b.standsAlone === true);
    if (b.standsAlone === true) await repo.releaseSameAs(pool, shareId);
    return done(null);
  }
  if (!("sameAsId" in b)) return refuse(400, R.tensionNotFound);
  if (b.sameAsId == null) {
    const seen = await sessionsSeen(pool, viewer, [Number(one[0].session_id)]);
    if (!seen(Number(one[0].session_id))) return refuse(403, R.tensionNotYours);
    await repo.writeSameAs(pool, shareId, null);
    return done(null);
  }
  const otherId = Number(b.sameAsId);
  const other = Number.isInteger(otherId) && otherId > 0 && otherId !== shareId ? await repo.shareById(pool, otherId) : [];
  if (!isTension(other[0])) return refuse(404, R.tensionNotFound);
  const seen = await sessionsSeen(pool, viewer, [Number(one[0].session_id), Number(other[0].session_id)]);
  if (!seen(Number(one[0].session_id)) || !seen(Number(other[0].session_id))) return refuse(403, R.tensionNotYours);
  await repo.writeSameAs(pool, shareId, otherId);
  // The other one is joined too, so a "stands alone" on it gives way to the people's word.
  await repo.writeStandsAlone(pool, otherId, false);
  return done(null);
}

// ── One member: the export and the erasure ──────────────────────────────────

export async function exportTemplatesFor(pool: Pool, no: number): Promise<{ shares: Record<string, unknown>[]; priorities: Record<string, unknown>[] }> {
  const shares = (await repo.memberShareRows(pool, no)).map((r) => ({ sessionId: Number(r.session_id), kind: String(r.kind), text: String(r.text), at: toIso(r.created_at) }));
  const priorities = (await repo.memberPriorityRows(pool, no)).map((r) => ({ sessionId: Number(r.session_id), text: String(r.text), at: toIso(r.created_at) }));
  return { shares, priorities };
}

export async function forgetTemplatesFor(conn: PoolConnection, no: number): Promise<void> {
  await repo.forgetMember(conn, no);
}
