/**
 * Live Sessions, after the call: a task keeps going once the session closes.
 *
 * ONE FILE IS THE CONTRACT for the task board, the same way shared/sessions.ts
 * is for the room. The store (server/repos/sessionTasks.ts), the logic
 * (server/lib/sessionTasks.ts), the mail (server/lib/sessionTaskMail.ts), the
 * profile's board and the room's "From last time" read their shapes, rules
 * and words from here.
 *
 * THE RECORD STAYS AS SAID. The words a session wrote down never change after
 * close: `live_session_entries` and the frozen minutes are left alone, and the
 * room keeps refusing writes to a closed session. What happens to an action
 * afterwards lives in a separate state layer (drizzle/0255): one row per task
 * with where it stands now, and an append-only list of every answer given to
 * it. Each answer moves the state by one step, through `applyAnswer` below.
 *
 * THE STATUSES are open, done and let go. "Back with the circle" is not a
 * status: it is an open task that no person and no seat holds.
 *
 * TWO DECISIONS LIVE IN ONE PURE FUNCTION EACH, so a ruling changes one line:
 *   `canSeeTask`  who may read a task card at all.
 *   `taskRights`  who may answer it, open it again, or take it.
 * Both read a `TaskViewer` the server fills in. The pure functions never reach
 * a database and never see a member's own id: a person here is the number
 * `live_session_members` gave them, the same as in the room.
 *
 * THE PRIVACY LINE. A task card carries names, never a user id, an email
 * address, or a count per person. Nothing here keeps a streak, a total, or a
 * red mark for a date gone by.
 *
 * COPY RULES. Platform code carries no village's name. No em-dashes, and every
 * string a member reads lives in this file so the voice gate reads it. Dates
 * a member reads are written in words, never as YYYY-MM-DD.
 */
import { cleanDueOn, cleanLine } from "./sessions";

// ── Doors ────────────────────────────────────────────────────────────────────

/**
 * Every door, so the pages and the routes agree. A refusal is `{ error: <a
 * sentence> }` with a 4xx status.
 *
 *   GET   /api/sessions/tasks/mine            TaskBoardPayload (?earlier=1 adds older finished tasks)
 *   GET   /api/sessions/tasks/count           TaskCountPayload, for the signed-in member only
 *   PATCH /api/sessions/tasks/:entryId        TaskAnswer -> { task: TaskCard }, or 409 { error, task }
 *   POST  /api/sessions/tasks/:entryId/done   {} -> { task: TaskCard }; already done answers 200 and changes
 *                                             nothing; 403 { error } without the right; 409 { error, task } once let go
 *   GET   /api/sessions/:id/task-record       TaskRecordPayload
 *   POST  /api/sessions/:id/task-emails       {} -> TaskMailResult, or 409 { error } while the session is open
 */
export const TASKS_API = "/api/sessions/tasks";

/** The signed-in member's own board. */
export const TASKS_MINE_URL = `${TASKS_API}/mine`;

/** One task's door, for an answer. */
export function taskUrl(entryId: number): string {
  return `${TASKS_API}/${entryId}`;
}

/** One closed session's tasks, as its record shows them. */
export function taskRecordUrl(sessionId: number): string {
  return `/api/sessions/${sessionId}/task-record`;
}

/** Send one session's task emails again. */
export function taskEmailsUrl(sessionId: number): string {
  return `/api/sessions/${sessionId}/task-emails`;
}

/** How many tasks wait on the signed-in member, and the nearest date among them. */
export const TASKS_COUNT_URL = `${TASKS_API}/count`;

/** One task marked done from a notice: the server reads the version itself. */
export function taskDoneUrl(entryId: number): string {
  return `${TASKS_API}/${entryId}/done`;
}

/** The board's anchor on the profile, so an email and a notice can land on it. */
export const TASK_BOARD_ANCHOR = "my-tasks";
export const TASK_BOARD_PATH = `/profile#${TASK_BOARD_ANCHOR}`;

/** One card's anchor on the board is `task-<entryId>`. */
export const TASK_CARD_ANCHOR_PREFIX = "task-";

/** The id one card carries on the board, so a link can land on it. */
export function taskCardAnchor(entryId: number): string {
  return `${TASK_CARD_ANCHOR_PREFIX}${entryId}`;
}

/** The link that opens one task on the board: every task notice carries it. */
export function taskBoardLink(entryId: number): string {
  return `/profile#${taskCardAnchor(entryId)}`;
}

/** The task a location hash names ("#task-12" or "task-12"), or null. */
export function taskIdFromHash(hash: string | null | undefined): number | null {
  const m = /^#?task-([1-9]\d{0,15})$/.exec(typeof hash === "string" ? hash.trim() : "");
  const id = m ? Number(m[1]) : Number.NaN;
  return Number.isSafeInteger(id) ? id : null;
}

/** The task a notice's link opens, when it is a `taskBoardLink`, or null. */
export function taskIdFromLink(link: string | null | undefined): number | null {
  const m = /^\/profile(#.*)$/.exec(typeof link === "string" ? link.trim() : "");
  return m ? taskIdFromHash(m[1]) : null;
}

// ── Statuses, answers and limits ─────────────────────────────────────────────

export const TASK_STATUSES = ["open", "done", "let_go"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export function isTaskStatus(v: unknown): v is TaskStatus {
  return typeof v === "string" && (TASK_STATUSES as readonly string[]).includes(v);
}

/** Every answer a task can be given. Each one is also the kind of the event it writes. */
export const TASK_EVENT_KINDS = ["done", "not_yet", "let_go", "handed_back", "taken", "reopened"] as const;
export type TaskEventKind = (typeof TASK_EVENT_KINDS)[number];

export function isTaskEventKind(v: unknown): v is TaskEventKind {
  return typeof v === "string" && (TASK_EVENT_KINDS as readonly string[]).includes(v);
}

/** The PATCH ops are the event kinds. */
export type TaskOp = TaskEventKind;

/** The kind a state row carries before anybody has answered it: as the session closed. */
export type TaskLatestKind = TaskEventKind | "closed";

/** The one line an answer may carry, and the width of its column. */
export const TASK_NOTE_MAX = 300;

/** A finished task stays in Finished for three moons, then moves to Earlier. */
export const TASK_FINISHED_DAYS = 89;

/** How many answers one member may give in an hour, and how many task sends one person may press. */
export const TASK_LIMITS = { answersPerHour: 120, sendsPerHour: 3 } as const;

/** The gentle notes around a due date: two days before, and the morning after. */
export const TASK_DUE_MARKS = { before: 2, after: -1 } as const;

/** A member's choice about task emails. `immediate` is the default. */
export const TASK_EMAIL_PREFS = ["immediate", "daily", "off"] as const;
export type TaskEmailPref = (typeof TASK_EMAIL_PREFS)[number];

export function isTaskEmailPref(v: unknown): v is TaskEmailPref {
  return typeof v === "string" && (TASK_EMAIL_PREFS as readonly string[]).includes(v);
}

// ── Wire shapes ──────────────────────────────────────────────────────────────

/** One task as any reader sees it. Never carries a user id, an email, or a per-person count. */
export interface TaskCard {
  entryId: number;
  sessionId: number;
  sessionTitle: string;
  circleId: string | null;
  circleName: string | null;
  /** YYYY-MM-DD, the session's close date in the village zone. */
  saidOn: string;
  text: string;
  status: TaskStatus;
  /** "you" | "person" | "seat" | "circle" (back with the circle) */
  heldAs: "you" | "person" | "seat" | "circle";
  /** A person's display name, or null. */
  holderName: string | null;
  seat: { id: string; name: string; holders: string[] } | null;
  /** YYYY-MM-DD */
  dueOn: string | null;
  /**
   * The last answer. A task nobody has answered yet carries kind "closed" and
   * the moment its session closed. Null only on a card still in an open
   * session, which has no state yet.
   */
  latest: { kind: TaskLatestKind; note: string | null; byName: string | null; byFacilitator: boolean; at: string } | null;
  /** Still in an open session: read-only here, answered in the room. */
  inSessionNow: boolean;
  canAnswer: boolean;
  canReopen: boolean;
  canTake: boolean;
  /** True only for people who were in the room, and admins. */
  recordLink: boolean;
  version: number;
}

export interface TaskBoardPayload {
  /** Held by you, by date, undated last. */
  holding: TaskCard[];
  /** Held by a seat you sit in now. */
  seatsHold: TaskCard[];
  /** Done or let go within the last TASK_FINISHED_DAYS days (three moons). */
  finished: TaskCard[];
  /** Finished before that. The rows load on demand (?earlier=1). */
  earlierCount: number;
  /** Village-local YYYY-MM-DD, so the client never guesses the zone. */
  today: string;
}

/**
 * What waits on one member: the open tasks they hold in person or through a
 * seat they sit in now, the same set the board's Holding and seat groups show.
 * Their own count, for their own menu and profile. Never shown to anyone else
 * and never compared with anybody's.
 */
export interface TaskCountPayload {
  waiting: number;
  /** YYYY-MM-DD, the nearest date among them, or null when none has a date. */
  nextDue: string | null;
}

export interface TaskAnswer {
  op: TaskOp;
  /** The version the answerer saw. A different one answers 409 with the card as it is now. */
  version: number;
  /** Required for not_yet: a date after today (village zone). */
  dueOn?: string;
  /** Required for let_go (1 to 300 characters after trim); optional for done, not_yet and handed_back. */
  note?: string;
}

export interface TaskRecordPayload {
  tasks: TaskCard[];
  mail: {
    canSend: boolean;
    /** `queued` is how many emails that send put on their way; null while it is still going out. */
    lastSend: { sendNo: number; at: string; byName: string | null; queued: number | null } | null;
  };
}

export interface TaskMailResult {
  sendNo: number;
  people: number;
  queued: number;
  /** By reason: emails_off, pref_daily, pref_off, no_member, suppressed, no_api_key, duplicate and the like. Numbers only. */
  skipped: Record<string, number>;
}

/** Skip reasons that are the member's own: a choice they made, or no address on file. */
export const TASK_MAIL_MEMBER_SKIPS: readonly string[] = ["emails_off", "pref_daily", "pref_off", "no_email", "no_member"];
/** Skip reasons that are the village's: its email is not set up to send. */
export const TASK_MAIL_SETUP_SKIPS: readonly string[] = ["no_api_key", "no_sender"];

export interface TaskMailSkips {
  /** People whose own setting or missing address kept the email back. */
  members: number;
  /** Emails the village's email setup could not send. */
  setup: number;
  /** Every other email that did not go out (suppressed, bad address, failed and the like). */
  other: number;
}

/**
 * A send's skips, split by whose they are, so the result line blames nobody
 * for what was not theirs. A duplicate is an email already on its way, so it
 * is counted nowhere.
 */
export function splitMailSkips(skipped: Record<string, number>): TaskMailSkips {
  const out: TaskMailSkips = { members: 0, setup: 0, other: 0 };
  for (const [reason, count] of Object.entries(skipped)) {
    if (reason === "duplicate" || !Number.isFinite(count) || count <= 0) continue;
    if (TASK_MAIL_MEMBER_SKIPS.includes(reason)) out.members += count;
    else if (TASK_MAIL_SETUP_SKIPS.includes(reason)) out.setup += count;
    else out.other += count;
  }
  return out;
}

// ── The state, as the pure functions read it ─────────────────────────────────

/**
 * One row of `live_session_task_state`, in the lib's own names. People are
 * numbers. Times are ISO instants; dates are YYYY-MM-DD.
 */
export interface TaskState {
  entryId: number;
  sessionId: number;
  circleId: string | null;
  status: TaskStatus;
  ownerNo: number | null;
  ownerSeatId: string | null;
  dueOn: string | null;
  latestKind: TaskLatestKind;
  latestNote: string | null;
  /** Who answered last. 0 means as closed, or a member who has since left. */
  changedByNo: number;
  changedAt: string;
  doneAt: string | null;
  version: number;
}

/** One row of `live_session_task_events`: the answer, and the state it left. */
export interface TaskEventRow {
  entryId: number;
  sessionId: number;
  kind: TaskEventKind;
  byNo: number;
  status: TaskStatus;
  ownerNo: number | null;
  ownerSeatId: string | null;
  dueOn: string | null;
  note: string | null;
}

/** What the rights functions need to know about a task. */
export type TaskSubject = Pick<TaskState, "status" | "ownerNo" | "ownerSeatId">;

/**
 * Who is asking, as the server measured it. Every flag is about THIS task:
 * the source session is the one the task came from, and the open room is any
 * open session of the task's circle.
 */
export interface TaskViewer {
  /** Their number in `live_session_members`, or null when they have never touched a session. */
  no: number | null;
  admin: boolean;
  /** The seats they sit in now, through `liveSeatIdsFor`. */
  liveSeatIds: readonly string[];
  /** They were in the session the task came from. */
  inSourceSession: boolean;
  /** They facilitate or keep notes for the session the task came from. */
  hostsSource: boolean;
  /**
   * They facilitate or keep notes for an open session of the same circle, and
   * have standing there: they were in the circle's last closed session, or
   * they sit in one of its seats now. The server measures both.
   */
  hostsOpenRoomInCircle: boolean;
}

/**
 * A seating, as the org chart reads it (server/lib/orgChart.ts `OrgAssignment`
 * fits this shape). Only the fields the filter needs.
 */
export interface TaskSeating {
  orgRoleId: string;
  holderKind: string;
  userId: string | null;
  lapsed?: boolean;
  isExample: boolean;
  endedAt?: unknown;
}

/**
 * The seats one member sits in now: live, held as a member, not lapsed, not a
 * standing example. Give it `listOrgAssignments(pool, lapseContext())`, so a
 * term that ran out reads as lapsed. A lapsed holder is still in the chart and
 * still acting, and a task is a new ask, so it waits for the seat's next term.
 */
export function liveSeatIdsFor(seatings: readonly TaskSeating[], userId: string): string[] {
  const out: string[] = [];
  for (const a of seatings) {
    if (a.holderKind !== "member" || !a.userId || a.userId !== userId) continue;
    if (a.lapsed || a.isExample || a.endedAt) continue;
    if (!out.includes(a.orgRoleId)) out.push(a.orgRoleId);
  }
  return out;
}

/** The members who sit in one seat now, by the same rule. User ids, for the server's own use only. */
export function liveHoldersOf(seatings: readonly TaskSeating[], seatId: string): string[] {
  const out: string[] = [];
  for (const a of seatings) {
    if (a.orgRoleId !== seatId || a.holderKind !== "member" || !a.userId) continue;
    if (a.lapsed || a.isExample || a.endedAt) continue;
    if (!out.includes(a.userId)) out.push(a.userId);
  }
  return out;
}

/** An open task that no person and no seat holds. */
export function isBackWithCircle(t: TaskSubject): boolean {
  return t.status === "open" && t.ownerNo == null && !t.ownerSeatId;
}

/** The viewer holds this task, in person or through a seat they sit in now. */
export function holdsTask(t: TaskSubject, viewer: TaskViewer): boolean {
  const person = t.ownerNo != null && viewer.no != null && viewer.no > 0 && t.ownerNo === viewer.no;
  const seat = !!t.ownerSeatId && viewer.liveSeatIds.includes(t.ownerSeatId);
  return person || seat;
}

/**
 * Who may read a task card at all. The people who were in the session it came
 * from, whoever holds it now (person or seat), the facilitator or secretary
 * of an open session in the same circle, and admins.
 *
 * A seat holder who was not in the room reads the text, title, circle, date
 * and status, and gets no record link (`recordLink` on the card). Whether a
 * whole circle may read its task cards waits on a ruling; it changes here.
 */
export function canSeeTask(t: TaskSubject, viewer: TaskViewer): boolean {
  return viewer.inSourceSession || holdsTask(t, viewer) || viewer.hostsOpenRoomInCircle || viewer.admin;
}

export interface TaskRights {
  /** Give an open task an answer: done, not yet, let go, hand it back. */
  answer: boolean;
  /** Open a finished task again. */
  reopen: boolean;
  /** Take a task that is back with the circle. */
  take: boolean;
}

/**
 * Who may do what to one task.
 *
 *   rights   the holder, a live member holder of the holding seat, the
 *            facilitator or secretary of the session it came from or of an
 *            open session in the same circle (facilitation rotates), and
 *            admins. Anyone else has none.
 *   answer   anyone with rights, while the task is open.
 *   reopen   a done task: anyone with rights, the holder included, for a
 *            mistaken tap. A let go task: the hosts and admins only, because
 *            letting go was the holder's answer to the circle.
 *   take     anyone who can see the task, once it is back with the circle.
 */
export function taskRights(t: TaskSubject, viewer: TaskViewer): TaskRights {
  const hosts = viewer.hostsSource || viewer.hostsOpenRoomInCircle;
  const any = holdsTask(t, viewer) || hosts || viewer.admin;
  const someone = viewer.no != null && viewer.no > 0;
  return {
    answer: t.status === "open" && any,
    reopen: t.status === "done" ? any : t.status === "let_go" ? hosts || viewer.admin : false,
    take: isBackWithCircle(t) && someone && canSeeTask(t, viewer),
  };
}

/** May this viewer give this op at all. The rule `taskRights` states, per op. */
export function mayGive(op: TaskOp, rights: TaskRights): boolean {
  if (op === "taken") return rights.take;
  if (op === "reopened") return rights.reopen;
  return rights.answer;
}

// ── Answers ──────────────────────────────────────────────────────────────────

/** A PATCH body read defensively: the op, the version, and a clean note and date. Null when it is not an answer. */
export function parseTaskAnswer(raw: unknown): TaskAnswer | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const b = raw as Record<string, unknown>;
  if (!isTaskEventKind(b.op)) return null;
  const version = b.version;
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1) return null;
  const out: TaskAnswer = { op: b.op, version };
  const dueOn = cleanDueOn(b.dueOn);
  if (dueOn) out.dueOn = dueOn;
  const note = cleanLine(b.note, TASK_NOTE_MAX);
  if (note) out.note = note;
  return out;
}

export type TaskRefusalKey = keyof typeof TASK_REFUSALS;

/**
 * Whether this answer fits this task today. Null when it does, or the key of
 * the refusal in `TASK_REFUSALS`. `today` is the village-local YYYY-MM-DD.
 * Rights are a separate question (`taskRights`); this reads only the task.
 */
export function validateAnswer(answer: TaskAnswer, current: TaskSubject, today: string): TaskRefusalKey | null {
  if (!isTaskEventKind(answer.op)) return "answerShape";
  const note = typeof answer.note === "string" ? answer.note.trim() : "";
  if (note.length > TASK_NOTE_MAX) return "noteLong";
  const open = current.status === "open";
  switch (answer.op) {
    case "done":
      if (current.status === "done") return "alreadyDone";
      return open ? null : "finished";
    case "not_yet":
      if (!open) return "finished";
      return answer.dueOn && cleanDueOn(answer.dueOn) && answer.dueOn > today ? null : "needDate";
    case "let_go":
      if (!open) return "finished";
      return note ? null : "needSentence";
    case "handed_back":
      if (!open) return "finished";
      return isBackWithCircle(current) ? "nobodyHolds" : null;
    case "taken":
      return isBackWithCircle(current) ? null : "notWithCircle";
    case "reopened":
      return open ? "alreadyOpen" : null;
  }
}

/**
 * The state after one answer. The caller has checked the version, the rights
 * and `validateAnswer` first. The version goes up by one, and the answer
 * becomes the latest: its kind, its note, who gave it and when.
 *
 *   done         status done, and when.
 *   not_yet      the date moves; the task stays open.
 *   let_go       status let go.
 *   handed_back  nobody holds it: back with the circle, still open.
 *   taken        the person who took it holds it.
 *   reopened     open again, and no longer done.
 */
export function applyAnswer(current: TaskState, answer: TaskAnswer, actorNo: number, now: Date = new Date()): TaskState {
  const at = now.toISOString();
  const note = typeof answer.note === "string" && answer.note.trim() ? answer.note.trim().slice(0, TASK_NOTE_MAX) : null;
  const next: TaskState = {
    ...current,
    latestKind: answer.op,
    latestNote: note,
    changedByNo: actorNo,
    changedAt: at,
    version: current.version + 1,
  };
  switch (answer.op) {
    case "done":
      return { ...next, status: "done", doneAt: at };
    case "not_yet":
      return { ...next, status: "open", dueOn: answer.dueOn ?? current.dueOn };
    case "let_go":
      return { ...next, status: "let_go", doneAt: null };
    case "handed_back":
      return { ...next, status: "open", ownerNo: null, ownerSeatId: null };
    case "taken":
      return { ...next, status: "open", ownerNo: actorNo, ownerSeatId: null };
    case "reopened":
      return { ...next, status: "open", doneAt: null };
  }
}

/** The event row an answer appends: its kind, who gave it, and the state it left (`applyAnswer`'s result). */
export function eventFor(next: TaskState, op: TaskOp): TaskEventRow {
  return {
    entryId: next.entryId,
    sessionId: next.sessionId,
    kind: op,
    byNo: next.changedByNo,
    status: next.status,
    ownerNo: next.ownerNo,
    ownerSeatId: next.ownerSeatId,
    dueOn: next.dueOn,
    note: next.latestNote,
  };
}

// ── Cards ────────────────────────────────────────────────────────────────────

/** Everything about a task a card shows, with the names already looked up. */
export interface TaskCardParts {
  /** The state row. Null for an action still in an open session. */
  state: TaskState | null;
  /** For a card still in an open session: the entry's own holders and date. */
  live?: { entryId: number; sessionId: number; circleId: string | null; ownerNo: number | null; ownerSeatId: string | null; dueOn: string | null };
  text: string;
  sessionTitle: string;
  circleName: string | null;
  saidOn: string;
  holderName: string | null;
  seat: { id: string; name: string; holders: string[] } | null;
  latestByName: string | null;
  latestByFacilitator: boolean;
}

/**
 * One card for one viewer. The viewer's rights become three flags, and the
 * record link is set only for people who were in the room, and admins. A card
 * still in an open session carries no rights: it is answered in the room.
 */
export function taskCardFor(parts: TaskCardParts, viewer: TaskViewer): TaskCard {
  const s = parts.state;
  const subject: TaskSubject = s ?? { status: "open", ownerNo: parts.live?.ownerNo ?? null, ownerSeatId: parts.live?.ownerSeatId ?? null };
  const rights = s ? taskRights(s, viewer) : { answer: false, reopen: false, take: false };
  const mine = subject.ownerNo != null && viewer.no != null && viewer.no > 0 && subject.ownerNo === viewer.no;
  const heldAs: TaskCard["heldAs"] = mine ? "you" : subject.ownerNo != null ? "person" : subject.ownerSeatId ? "seat" : "circle";
  return {
    entryId: s?.entryId ?? parts.live?.entryId ?? 0,
    sessionId: s?.sessionId ?? parts.live?.sessionId ?? 0,
    sessionTitle: parts.sessionTitle,
    circleId: s?.circleId ?? parts.live?.circleId ?? null,
    circleName: parts.circleName,
    saidOn: parts.saidOn,
    text: parts.text,
    status: subject.status,
    heldAs,
    holderName: subject.ownerNo != null ? parts.holderName : null,
    seat: subject.ownerSeatId ? parts.seat : null,
    dueOn: s ? s.dueOn : (parts.live?.dueOn ?? null),
    latest: s
      ? { kind: s.latestKind, note: s.latestNote, byName: parts.latestByName, byFacilitator: parts.latestByFacilitator, at: s.changedAt }
      : null,
    inSessionNow: !s,
    canAnswer: rights.answer,
    canReopen: rights.reopen,
    canTake: rights.take,
    recordLink: viewer.inSourceSession || viewer.admin,
    version: s?.version ?? 0,
  };
}

/** By date, undated last, then in the order they were said. */
export function compareByDue(a: Pick<TaskCard, "dueOn" | "entryId">, b: Pick<TaskCard, "dueOn" | "entryId">): number {
  if (a.dueOn !== b.dueOn) {
    if (a.dueOn == null) return 1;
    if (b.dueOn == null) return -1;
    return a.dueOn < b.dueOn ? -1 : 1;
  }
  return a.entryId - b.entryId;
}

// ── From last time: the order of the action check ────────────────────────────

export const TASK_CHECK_GROUPS = ["doneSince", "backWithCircle", "newDates", "letGo", "stillHolding"] as const;
export type TaskCheckGroup = (typeof TASK_CHECK_GROUPS)[number];

/**
 * The action check at the start of a circle's next call, in the order the
 * room reads it:
 *   1. done since last time      done, answered after the circle last met
 *   2. back with the circle      open, and nobody holds it
 *   3. new dates                 open, moved by Not yet since the circle last met
 *   4. let go                    let go since the circle last met
 *   5. still holding             every other open task, by date
 * A finished task from before the last meeting was heard then, so it is left
 * out. A group with no cards is not returned. `lastMetAt` is the close of the
 * circle's last session, or null when it has none.
 */
export function groupForCheck(cards: readonly TaskCard[], lastMetAt: string | null): { key: TaskCheckGroup; cards: TaskCard[] }[] {
  const met = lastMetAt ? Date.parse(lastMetAt) : Number.NaN;
  const since = (c: TaskCard): boolean => {
    if (!Number.isFinite(met)) return true;
    const at = c.latest ? Date.parse(c.latest.at) : Number.NaN;
    return Number.isFinite(at) && at > met;
  };
  const groups: Record<TaskCheckGroup, TaskCard[]> = { doneSince: [], backWithCircle: [], newDates: [], letGo: [], stillHolding: [] };
  for (const c of cards) {
    if (c.status === "done") {
      if (since(c)) groups.doneSince.push(c);
    } else if (c.status === "let_go") {
      if (since(c)) groups.letGo.push(c);
    } else if (c.heldAs === "circle") {
      groups.backWithCircle.push(c);
    } else if (c.latest?.kind === "not_yet" && since(c)) {
      groups.newDates.push(c);
    } else {
      groups.stillHolding.push(c);
    }
  }
  return TASK_CHECK_GROUPS.map((key) => ({ key, cards: groups[key].slice().sort(compareByDue) })).filter((g) => g.cards.length > 0);
}

// ── Dates in words ───────────────────────────────────────────────────────────

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

const civilUtc = (ymd: string): Date | null => {
  const clean = cleanDueOn(ymd);
  return clean ? new Date(`${clean}T00:00:00Z`) : null;
};

/** "Friday", from YYYY-MM-DD. Empty for anything that is not a date. */
export function taskWeekday(ymd: string): string {
  const d = civilUtc(ymd);
  return d ? WEEKDAYS[d.getUTCDay()] : "";
}

/**
 * "Friday 16 October", from YYYY-MM-DD, with the year added when it is not
 * the year of `today`. Never an ISO date: something that is not a date reads
 * as nothing.
 */
export function taskDateWords(ymd: string, today?: string): string {
  const d = civilUtc(ymd);
  if (!d) return "";
  const words = `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
  const thisYear = today ? civilUtc(today)?.getUTCFullYear() : undefined;
  return thisYear != null && thisYear !== d.getUTCFullYear() ? `${words} ${d.getUTCFullYear()}` : words;
}

/** YYYY-MM-DD moved by whole days. */
export function addCivilDays(ymd: string, days: number): string {
  const d = civilUtc(ymd);
  if (!d) return ymd;
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Whole days from one YYYY-MM-DD to another: 2 when `to` is the day after tomorrow, -1 for yesterday. Null when either is not a date. */
export function civilDaysFrom(from: string, to: string): number | null {
  const a = civilUtc(from);
  const b = civilUtc(to);
  return a && b ? Math.round((b.getTime() - a.getTime()) / 86_400_000) : null;
}

// ── Emails ───────────────────────────────────────────────────────────────────

/**
 * A task email as blocks of plain text. The server escapes every string and
 * wraps the blocks in its email shell; the text part is `text`, built from
 * the same blocks, so the two parts always say the same thing.
 */
export type TaskEmailBlock =
  | { kind: "p"; text: string }
  | { kind: "list"; items: string[] }
  | { kind: "button"; label: string; href: string }
  /** The small line at the foot of every task email. */
  | { kind: "note"; text: string };

export interface TaskEmail {
  subject: string;
  text: string;
  blocks: TaskEmailBlock[];
}

/** One task, as an email lists it. */
export interface TaskMailLine {
  text: string;
  dueOn: string | null;
}

export interface TaskEmailInput {
  /** The member's display name. The first word greets them. */
  name: string | null;
  sessionTitle: string;
  circleName: string | null;
  /** Village-local YYYY-MM-DD the session closed. */
  closedOn: string;
  /** Village-local YYYY-MM-DD. */
  today: string;
  /** They were in the room, so the email links the record. */
  wasInRoom: boolean;
  /** 1 is the close itself. Above 1, somebody asked for the list to go out again. */
  sendNo: number;
  /** The display name of who pressed Send the task emails, for a send above 1. */
  askedBy: string | null;
  /** The tasks they hold in person. */
  own: TaskMailLine[];
  /** The tasks each of their seats holds. */
  seats: { seatName: string; tasks: TaskMailLine[] }[];
  boardUrl: string;
  /** The session's own page. Used only when they were in the room. */
  recordUrl: string | null;
}

export interface TaskNoteInput {
  name: string | null;
  text: string;
  dueOn: string;
  sessionTitle: string;
  circleName: string | null;
  saidOn: string;
  today: string;
  boardUrl: string;
}

const firstWord = (name: string | null | undefined): string => {
  const w = typeof name === "string" ? name.trim().split(/\s+/)[0] : "";
  return w ?? "";
};

const greet = (name: string | null): string => {
  const first = firstWord(name);
  return first ? `Hi ${first},` : "Hi there,";
};

/** "Garden circle" stays as it is; "Garden" becomes "Garden circle". */
export function circleWords(name: string): string {
  const n = name.trim();
  return /\bcircle$/i.test(n) ? n : `${n} circle`;
}

/** "the Garden circle call", or "the Weekly planning call" for a session with no circle. */
const callOf = (circleName: string | null, sessionTitle: string): string =>
  circleName ? `the ${circleWords(circleName)} call` : `the ${sessionTitle.trim()} call`;

const sentence = (text: string): string => text.trim().replace(/[.!?]+$/, "");

/** A string cut to `max` characters, with an ellipsis when it was longer. */
export function cutText(text: string, max: number): string {
  const t = text.trim().replace(/\s+/g, " ");
  return t.length <= max ? t : `${t.slice(0, Math.max(1, max - 1)).trimEnd()}…`;
}

const capital = (s: string): string => (s ? s[0].toUpperCase() + s.slice(1) : s);

const taskLine = (t: TaskMailLine, today: string): string =>
  t.dueOn && taskDateWords(t.dueOn, today)
    ? TASK_EMAIL_COPY.lineBy(sentence(t.text), taskDateWords(t.dueOn, today))
    : TASK_EMAIL_COPY.lineNoDate(sentence(t.text));

const textOf = (blocks: TaskEmailBlock[]): string =>
  blocks
    .map((b) => (b.kind === "list" ? b.items.map((i) => `- ${i}`).join("\n") : b.kind === "button" ? `${b.label}: ${b.href}` : b.text))
    .join("\n\n");

const email = (subject: string, blocks: TaskEmailBlock[]): TaskEmail => ({ subject, blocks, text: textOf(blocks) });

/**
 * A. The email at close, and on every Send the task emails. One per person,
 * listing what they hold in person and what each of their seats holds. A seat
 * holder who holds nothing in person gets the seat's opening instead, and
 * someone who was not in the room gets no record link.
 */
export function buildTaskEmail(input: TaskEmailInput): TaskEmail {
  const C = TASK_EMAIL_COPY;
  const today = input.today;
  const seats = input.seats.filter((s) => s.tasks.length > 0);
  const seatCount = seats.reduce((n, s) => n + s.tasks.length, 0);
  const total = input.own.length + seatCount;
  const when = input.closedOn === today ? C.today : C.onDate(taskDateWords(input.closedOn, today));
  const blocks: TaskEmailBlock[] = [];
  if (input.sendNo > 1) blocks.push({ kind: "p", text: C.resend(firstWord(input.askedBy) || null) });
  blocks.push({ kind: "p", text: greet(input.name) });
  if (input.own.length > 0) {
    blocks.push({ kind: "p", text: C.opening(capital(callOf(input.circleName, input.sessionTitle)), when) });
    blocks.push({ kind: "list", items: input.own.map((t) => taskLine(t, today)) });
    for (const s of seats) {
      blocks.push({ kind: "p", text: C.seatHoldsMore(s.seatName, s.tasks.length) });
      blocks.push({ kind: "list", items: s.tasks.map((t) => taskLine(t, today)) });
    }
  } else {
    const who = input.circleName ? `The ${circleWords(input.circleName)}` : capital(callOf(null, input.sessionTitle));
    blocks.push({ kind: "p", text: C.seatOpening(who, when, seatCount, seats.map((s) => s.seatName)) });
    if (seats.length === 1) {
      blocks.push({ kind: "list", items: seats[0].tasks.map((t) => taskLine(t, today)) });
    } else {
      for (const s of seats) {
        blocks.push({ kind: "p", text: C.seatHolds(s.seatName, s.tasks.length) });
        blocks.push({ kind: "list", items: s.tasks.map((t) => taskLine(t, today)) });
      }
    }
  }
  blocks.push({ kind: "p", text: C.howToAnswer });
  blocks.push({ kind: "button", label: C.openBoard, href: input.boardUrl });
  if (input.wasInRoom && input.recordUrl) blocks.push({ kind: "button", label: C.openRecord, href: input.recordUrl });
  blocks.push({ kind: "p", text: total === 1 ? C.thanksOne : C.thanks });
  blocks.push({ kind: "note", text: C.footer });
  return email(C.subject(input.sessionTitle), blocks);
}

/** B. Two days before a due date. */
export function buildDueNote(input: TaskNoteInput): TaskEmail {
  const C = TASK_EMAIL_COPY;
  const blocks: TaskEmailBlock[] = [
    { kind: "p", text: C.dueOpening(greet(input.name), taskDateWords(input.dueOn, input.today)) },
    { kind: "list", items: [C.dueLine(sentence(input.text), callOf(input.circleName, input.sessionTitle), taskDateWords(input.saidOn, input.today))] },
    { kind: "p", text: C.dueHow },
    { kind: "button", label: C.openBoard, href: input.boardUrl },
    { kind: "note", text: C.footer },
  ];
  return email(C.dueSubject(taskWeekday(input.dueOn), input.text), blocks);
}

/** C. The morning after a due date. The last email about it. */
export function buildAfterNote(input: TaskNoteInput): TaskEmail {
  const C = TASK_EMAIL_COPY;
  const blocks: TaskEmailBlock[] = [
    { kind: "p", text: C.afterOpening(greet(input.name), taskWeekday(input.dueOn)) },
    { kind: "list", items: [`${sentence(input.text)}.`] },
    { kind: "p", text: C.afterHow },
    { kind: "button", label: C.answerBoard, href: input.boardUrl },
    { kind: "p", text: C.afterLast },
    { kind: "note", text: C.footer },
  ];
  return email(C.afterSubject, blocks);
}

// ── The words ────────────────────────────────────────────────────────────────

/** The board, the card, the sheets, the mail button and the preference. */
export const TASK_COPY = {
  heading: "Your task board",
  lede: "What you took on in your circles' calls, and what your seats hold.",
  groups: { holding: "Holding", seatsHold: "Your seats hold", finished: "Finished", earlier: "Earlier" },
  empty: "Nothing in your hands right now. Tasks you take on in a live session land here.",
  loadFailed: "The task board did not load.",
  retry: "Try again",
  from: (circle: string, date: string): string => `From the ${circleWords(circle)} · ${date}`,
  fromNoCircle: (sessionTitle: string, date: string): string => `From ${sessionTitle} · ${date}`,
  heldYou: "Held by you",
  heldPerson: (name: string): string => `Held by ${name}`,
  heldSeat: (seat: string, names: readonly string[]): string => `${seat} holds it · ${names.join(", ")}`,
  heldSeatVacant: (seat: string): string => `${seat} holds it · nobody sits there yet`,
  heldCircle: "Back with the circle",
  /** A seat the org chart no longer names. */
  seatUnnamed: "A seat",
  due:(date: string): string => `By ${date}`,
  noDate: "No date",
  /** Normal ink. A date gone by is a question, never a red mark. */
  duePassed: (date: string): string => `The date was ${date}. Done, not yet, or let go?`,
  /** The same date gone by, for someone who cannot answer it: a plain line, no question. */
  duePast: (date: string): string => `The date was ${date}`,
  latest: (note: string): string => `Latest: "${note}"`,
  latestByFacilitator: (note: string): string => `Latest: "${note}" (noted by the facilitator)`,
  statusLabels: { open: "Holding", done: "Done", let_go: "Let go", circle: "Back with the circle", newDate: "Holding, new date" },
  newDate: (date: string): string => `New date: ${date}`,
  inSessionNow: "In a session now. Answer it in the room.",
  buttons: {
    done: "It's done",
    not_yet: "Not yet",
    let_go: "Let go",
    handed_back: "Hand it back",
    reopened: "Open it again",
    taken: "I'll take it",
    record: "Open the record",
  },
  /** The sheet each answer opens. A null field is not shown. */
  sheets: {
    done: {
      lede: null,
      notePrompt: "What came of it? One line the circle will hear.",
      noteRequired: false,
      hint: null,
      datePrompt: null,
      confirm: "Mark it done",
      toast: "Marked done. The circle sees it at the next action check.",
    },
    not_yet: {
      lede: null,
      notePrompt: "Anything the circle should know?",
      noteRequired: false,
      hint: null,
      datePrompt: "When, then?",
      confirm: "Move the date",
      toast: "New date set. Nobody needs a reason.",
    },
    let_go: {
      lede: null,
      notePrompt: "Say why, in one sentence.",
      noteRequired: true,
      hint: "Letting go is a real answer. It frees the circle to choose again.",
      datePrompt: null,
      confirm: "Let it go",
      toast: "Let go. The circle hears your sentence at the next action check.",
    },
    handed_back: {
      lede: "It goes back to the circle and shows in the next action check as needing someone.",
      notePrompt: "Anything the circle should know?",
      noteRequired: false,
      hint: null,
      datePrompt: null,
      confirm: "Hand it back",
      toast: "Handed back. Thank you for holding it this far.",
    },
    taken: { lede: null, notePrompt: null, noteRequired: false, hint: null, datePrompt: null, confirm: "I'll take it", toast: "It's yours now." },
    reopened: { lede: null, notePrompt: null, noteRequired: false, hint: null, datePrompt: null, confirm: "Open it again", toast: "Open again." },
  },
  dateChips: { thisFriday: "This Friday", nextWeek: "Next week", nextNewMoon: "Next new moon", nextFullMoon: "Next full moon" },
  datePick: "Or pick a date",
  cancel: "Not now",
  checkCue: "Read what got done first. Then the tasks back with the circle.",
  checkGroups: {
    doneSince: "Done since last time",
    backWithCircle: "Back with the circle",
    newDates: "New dates",
    letGo: "Let go",
    stillHolding: "Still holding",
  },
  /** A count for the whole circle, never for one person. */
  doneSince: (n: number): string => `${n} done since last time`,
  mail: {
    button: "Send the task emails",
    sending: "Sending",
    confirm: "Everyone holding an open task from this session gets an email with their tasks. Send now?",
    confirmButton: "Send them",
    cancel: "Not now",
    result: (queued: number, people: number, skips: TaskMailSkips): string =>
      `Sent to ${queued} of ${people} people.` +
      (skips.setup > 0 ? ` The village's email is not set up yet, so ${skips.setup} could not go out.` : "") +
      (skips.members > 0 ? ` ${skips.members} have task emails turned off or have no email on file.` : "") +
      (skips.other > 0 ? ` ${skips.other} did not go out.` : ""),
    lastSent: (when: string, name: string): string => `Last sent ${when} by ${name}`,
    sentAtClose: "Sent when the session closed",
    /** A send that put no email on its way. */
    lastTried: (when: string, name: string): string => `Tried ${when} by ${name}. No email went out.`,
    triedAtClose: "Tried when the session closed. No email went out.",
  },
  /** The avatar menu and the mobile menu: the board's entry, with the member's own count beside it. */
  menu: {
    label: "My tasks",
    /** The count's name for a screen reader. The count is hidden when nothing waits. */
    waiting: (n: number): string => (n === 1 ? "1 task waits on you" : `${n} tasks wait on you`),
  },
  /** The small card near the top of the member's own profile. Nothing shows when nothing waits. */
  waitingCard: {
    heading: "Waiting on you",
    count: (n: number): string => (n === 1 ? "One task waits on you." : `${n} tasks wait on you.`),
    nextDue: (date: string): string => `The nearest date is ${date}.`,
    /** The nearest date is already behind today. Normal ink, never a red mark. */
    nextDuePassed: (date: string): string => `The earliest date was ${date}.`,
    noDate: "None of them has a date yet.",
    button: "Open my task board",
  },
  /** Under a task notice in the bell. A batched row opens the board and carries no buttons. */
  bell: {
    done: "It's done",
    open: "Open",
    /** The buttons' names for a screen reader, with the task the notice is about. */
    doneLabel: (what: string): string => `It's done: ${what}`,
    openLabel: (what: string): string => `Open it on your task board: ${what}`,
    working: "Saving",
    marked: "Done. The circle sees it at the next action check.",
    undo: "Open it again",
    undoLabel: (what: string): string => `Open it again: ${what}`,
    reopened: "Open again. It is back on your task board.",
    failed: "That did not save. Try again.",
  },
  pref: {
    label: "Task emails",
    options: {
      immediate: "When a call closes, and a gentle note near the date",
      daily: "Only in my daily digest",
      off: "Off",
    },
  },
} as const;

/** The sentence each refusal carries in `{ error }`. */
export const TASK_REFUSALS = {
  needSentence: "Letting go needs one sentence.",
  needDate: "Pick a date after today.",
  notYours: "Only the person or seat holding this, the facilitator, or an admin can answer it.",
  moved: "Someone answered this a moment ago. Here is where it stands now.",
  stillOpen: "The session is still open. Task emails go out when it closes.",
  notFound: "That task isn't here.",
  tooMany: "That's a lot of answers in an hour. Try again soon.",
  answerShape: "An answer is done, not yet, let go, hand it back, take it, or open it again, with the version you saw.",
  noteLong: `Keep it to ${TASK_NOTE_MAX} characters.`,
  alreadyDone: "This one is already marked done.",
  /** "It's done" from a notice, on a task that was let go. */
  letGoNotDone: "This one was let go. Open it on your task board to read why.",
  finished: "This one is finished. Open it again first.",
  alreadyOpen: "This one is already open.",
  notWithCircle: "Someone already holds this one.",
  nobodyHolds: "Nobody holds this one. It is already back with the circle.",
  sendsTooMany: "The task emails went out a few times this hour already. Try again later.",
} as const;

/** Every task email's words. The village's name never comes from here. */
export const TASK_EMAIL_COPY = {
  footer: "You get this because you took on a task in a live session. Change task emails in your profile, under Notifications.",
  subject: (sessionTitle: string): string => `Your tasks from ${sessionTitle}`,
  today: "today",
  onDate: (date: string): string => `on ${date}`,
  opening: (theCall: string, when: string): string =>
    `${theCall} closed ${when}. Here is what you took on, written down so you don't have to hold it in your head.`,
  seatOpening: (who: string, when: string, n: number, seatNames: readonly string[]): string =>
    `${who} met ${when} and ${n === 1 ? "a task" : `${n} tasks`} landed with ${seatNames.length === 1 ? "your seat" : "your seats"}, ` +
    `${joinNames(seatNames)}. Here ${n === 1 ? "it is" : "they are"}:`,
  seatHoldsMore: (seatName: string, n: number): string => `Your seat, ${seatName}, holds ${n === 1 ? "one more" : `${n} more`}:`,
  seatHolds: (seatName: string, n: number): string => `Your seat, ${seatName}, holds ${n === 1 ? "one task" : `${n} tasks`}:`,
  lineBy: (text: string, date: string): string => `${text}. By ${date}.`,
  lineNoDate: (text: string): string => `${text}. No date.`,
  resend: (firstName: string | null): string =>
    `${firstName ?? "The facilitator"} asked for this list to go out again. Here is where your tasks stand now.`,
  howToAnswer:
    "When one is done, mark it on your task board. If the timing changed, choose Not yet and pick a new date. " +
    "If it no longer makes sense, let it go with one sentence. The circle hears each answer at the next action check.",
  openBoard: "Open my task board",
  openRecord: "Open the record",
  thanks: "Thank you for carrying these.",
  thanksOne: "Thank you for carrying this.",
  dueSubject: (weekday: string, text: string): string => `Coming up ${weekday}: ${cutText(text, 60)}`,
  dueOpening: (hi: string, date: string): string => `${hi.replace(/,$/, "")}, a gentle note. This one is due on ${date}:`,
  dueLine: (text: string, theCall: string, saidOn: string): string => `${text}. From ${theCall} on ${saidOn}.`,
  dueHow: "If it's done, mark it done. If you need more time, Not yet takes a new date, and nobody needs a reason.",
  afterSubject: "Checking in on what you're holding",
  afterOpening: (hi: string, weekday: string): string => `${hi.replace(/,$/, "")}, ${weekday} came and went for this one. This is only a check-in:`,
  afterHow: "Done, Not yet with a new date, or Let go with a sentence: any answer helps the circle plan.",
  answerBoard: "Answer on my task board",
  afterLast: "This is the last email about it. The circle picks it up at the next action check.",
} as const;

/** "A", "A and B", "A, B and C". */
function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** The words on the in-app notices the task layer sends. */
export const TASK_NOTICES = {
  /** To the source session's facilitator, when a task is handed back. */
  back: (text: string): string => `${cutText(text, 80)} is back with the circle. It will be in the next action check.`,
  /** To admins and the facilitator, when a task sits with a seat nobody holds. */
  unheld: (sessionTitle: string, seatName: string): string =>
    `A task from "${sessionTitle}" sits with ${seatName}, and nobody holds that seat now. Give it to someone at the next call.`,
} as const;
