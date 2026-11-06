/**
 * Live Sessions, after the call: the task emails and the gentle notes near a
 * due date. The words are shared/sessionTasks.ts (`buildTaskEmail`,
 * `buildDueNote`, `buildAfterNote`); this file decides who gets one, escapes
 * the words into the village's email shell, and hands each to the post office.
 *
 * ── THE KIND IS `notices` ────────────────────────────────────────────────
 *
 * Every email here is posted directly with kind `notices`: it goes only to
 * members, it still goes when the Village Comms module is off, and it keeps
 * suppression and the one-click unsubscribe the post office adds to every
 * non-essential email. No Words template is used on purpose: the template
 * path reads an unknown key as `essential` mail, which skips suppression.
 *
 * ── ONE EMAIL PER PERSON PER SEND, BY KEY ────────────────────────────────
 *
 * A send has a number per session (`live_session_task_sends`): 1 is the close
 * itself, and every press of Send the task emails takes the next one. Each
 * person's email in a send is keyed `session-tasks:<session>:<user>:<send>`,
 * so the same send run twice is one email each (the second comes back
 * `duplicate`), and a later press, under a new number, really goes again.
 *
 * ── WHO GETS ONE ─────────────────────────────────────────────────────────
 *
 * Read again at send time, never remembered from the close: the person who
 * holds the task, and every member who sits in its seat now (live, held as a
 * member, term not lapsed, not a standing example). A member with task emails
 * set to daily or off, or with every email off, is counted and skipped; the
 * in-app notice the close sends still reaches them, and the daily digest
 * carries it for `daily`. A seat nobody sits in tells the admins and the
 * facilitator, once per task per send. Counts are numbers by reason, never an
 * address.
 *
 * ── NEVER INSIDE A REQUEST ───────────────────────────────────────────────
 *
 * The close runs inside a request (a room can close itself while somebody
 * reads the list), so `queueCloseMail` is started and left: the caller hands
 * it a `.catch` and never waits for it. A press of the button waits, because
 * its answer is the count.
 */
import type { Pool } from "mysql2/promise";
import type { AppDeps } from "./appDeps";
import { post } from "./comms/postOffice";
import { effectiveLifecycle } from "./modules";
import { emailShell, escapeHtml, resolveNotifyPrefs } from "./notify";
import { emailAccent } from "./emailAccent";
import { listOrgAssignments, listOrgRoles, type OrgAssignment } from "./orgChart";
import { numberVar } from "./variables";
import { villageTimezone } from "./villageReaders";
import { mapSession } from "./liveSessions";
import { villageDate } from "./sessionTasks";
import * as repo from "../repos/liveSessions";
import * as store from "../repos/sessionTasks";
import type { ModuleLifecycle } from "../../shared/modules";
import { nextInWindow } from "../../shared/comms/quietHours";
import {
  TASK_BOARD_PATH,
  TASK_DUE_MARKS,
  TASK_NOTICES,
  TASK_COPY,
  addCivilDays,
  buildAfterNote,
  buildDueNote,
  buildTaskEmail,
  civilDaysFrom,
  liveHoldersOf,
  taskBoardLink,
  type TaskEmail,
  type TaskMailLine,
  type TaskMailResult,
} from "../../shared/sessionTasks";

/** What the task emails need from the server. Every field is a member of AppDeps. */
export type TaskMailDeps = Pick<
  AppDeps,
  "getPool" | "commsPostOffice" | "notifyDeps" | "notify" | "notifyAdmins" | "lapseContext" | "deploymentOrigin" | "projectName"
>;

/** The job's own seams: the module's lifecycle and the send window. Absent: the live ones. */
export type TaskNoteDeps = Pick<TaskMailDeps, "getPool" | "commsPostOffice" | "notifyDeps" | "notify" | "lapseContext" | "deploymentOrigin" | "projectName"> & {
  lifecycle?: () => ModuleLifecycle;
  window?: () => { start: number; end: number };
};

/** The scheduler's name for the gentle notes, and how often it looks. */
export const TASK_NOTES_JOB = "session-task-notes";
export const TASK_NOTES_EVERY_MS = 60 * 60 * 1000;

/** A task email waits a day for the drain at most; past that the list may have moved. */
const TASK_MAIL_EXPIRY_MS = 24 * 60 * 60 * 1000;

/** What the post office answers that means the email is on its way, or already went. */
const ON_ITS_WAY: ReadonlySet<string> = new Set(["queued", "sending", "sent", "delivered", "rehearsed"]);

// ── The email, as HTML ──────────────────────────────────────────────────────

const INK = "#1f2937";
const QUIET = "#9ca3af";

/**
 * The builder's blocks, escaped, in the shell every notice wears. The
 * village's name and its brand colour come from the caller; the colour is the
 * platform's neutral when none is given (server/lib/emailAccent.ts).
 */
export function taskEmailHtml(projectName: string, email: TaskEmail, brandColour?: string): string {
  const accent = emailAccent(brandColour);
  const inner = email.blocks
    .map((b) => {
      switch (b.kind) {
        case "p":
          return `<p style="margin:0 0 14px;color:${INK}">${escapeHtml(b.text)}</p>`;
        case "list":
          return `<ul style="padding-left:18px;margin:0 0 14px">${b.items.map((i) => `<li style="margin:4px 0">${escapeHtml(i)}</li>`).join("")}</ul>`;
        case "button":
          return (
            `<p style="margin:0 0 14px"><a href="${escapeHtml(b.href)}" style="display:inline-block;background:${accent};color:#fff;` +
            `border-radius:8px;padding:9px 16px;text-decoration:none;font-weight:600">${escapeHtml(b.label)}</a></p>`
          );
        case "note":
          return `<p style="color:${QUIET};font-size:12px;margin-top:18px">${escapeHtml(b.text)}</p>`;
      }
    })
    .join("");
  return emailShell(escapeHtml(projectName), inner, accent);
}

// ── Who holds what, now ─────────────────────────────────────────────────────

/** One person's tasks in one send: their own, and each of their seats'. */
interface Bundle {
  own: TaskMailLine[];
  seats: Map<string, TaskMailLine[]>;
}

/** A task, as the mail reads its row. */
interface MailRow {
  entryId: number;
  text: string;
  dueOn: string | null;
  ownerNo: number | null;
  ownerSeatId: string | null;
}

const mailRow = (r: any): MailRow => ({
  entryId: Number(r.entry_id),
  text: String(r.text ?? ""),
  dueOn: r.due_on == null ? null : String(r.due_on),
  ownerNo: r.owner_no != null && Number(r.owner_no) > 0 ? Number(r.owner_no) : null,
  ownerSeatId: r.owner_seat_id == null || r.owner_seat_id === "" ? null : String(r.owner_seat_id),
});

/**
 * Each task's people, read now: the person who holds it, and every member who
 * sits in its seat. `vacant` lists the tasks a seat holds that nobody sits in
 * and no person holds, so somebody can give them out.
 */
async function holdersNow(
  pool: Pool,
  rows: readonly MailRow[],
  seatings: readonly OrgAssignment[],
): Promise<{ people: Map<number, { own: string | null; seat: string[] }>; vacant: MailRow[]; seatName: Map<string, string> }> {
  const owners = Array.from(new Set(rows.map((r) => r.ownerNo).filter((n): n is number => n != null)));
  const userOf = new Map((await repo.memberUserIdRows(pool, owners)).map((r) => [Number(r.no), String(r.user_id)]));
  const seatName = new Map<string, string>();
  if (rows.some((r) => r.ownerSeatId)) for (const role of await listOrgRoles(pool)) seatName.set(role.id, role.name);
  const people = new Map<number, { own: string | null; seat: string[] }>();
  const vacant: MailRow[] = [];
  for (const r of rows) {
    const own = r.ownerNo != null ? (userOf.get(r.ownerNo) ?? null) : null;
    const seat = r.ownerSeatId ? liveHoldersOf(seatings, r.ownerSeatId).filter((u) => u !== own) : [];
    people.set(r.entryId, { own, seat });
    if (r.ownerSeatId && !own && seat.length === 0) vacant.push(r);
  }
  return { people, vacant, seatName };
}

/** The member's own choice, read the way the notification spine reads it. Null when they get this email. */
function skipReason(member: any, isPresent: (m: any) => boolean): string | null {
  if (!member || !isPresent(member)) return "no_member";
  if (!member.email) return "no_email";
  const prefs = resolveNotifyPrefs(member.prefs);
  if (prefs.emailsOff) return "emails_off";
  if (prefs.tasksEmail === "daily") return "pref_daily";
  if (prefs.tasksEmail === "off") return "pref_off";
  return null;
}

const firstName = (m: any): string | null => (m && typeof m.name === "string" && m.name.trim() ? m.name.trim() : null);

// ── A send ──────────────────────────────────────────────────────────────────

/**
 * Take the next send number for a session and record the send, in one
 * transaction that holds the session row, so two presses at once each get
 * their own number. The counts are written once the emails are posted.
 */
export async function reserveSend(pool: Pool, sessionId: number, sentByNo: number, now = new Date()): Promise<number> {
  return repo.inTransaction(pool, async (conn) => {
    const sendNo = await store.nextSendNo(conn, sessionId);
    await store.insertSend(conn, { sessionId, sendNo, sentByNo, sentAt: now, counts: "{}" });
    return sendNo;
  });
}

/**
 * One send of a closed session's task emails: one email per person, listing
 * every open task they hold and every one their seats hold. The send number
 * is already taken (`reserveSend`, or the close's own 1). Answers the counts,
 * which are also written on the send's row.
 */
export async function sendTaskEmails(
  deps: TaskMailDeps,
  sessionId: number,
  opts: { sendNo: number; sentByNo: number },
  now = new Date(),
): Promise<TaskMailResult> {
  const pool = deps.getPool();
  const result: TaskMailResult = { sendNo: opts.sendNo, people: 0, queued: 0, skipped: {} };
  const skip = (reason: string) => {
    result.skipped[reason] = (result.skipped[reason] ?? 0) + 1;
  };
  const [sessionRaw] = await repo.sessionRow(pool, sessionId);
  if (!sessionRaw) return result;
  const s = mapSession(sessionRaw);
  const rows = (await store.sessionTaskRows(pool, sessionId, { openOnly: true })).map(mailRow);
  const seatings = await listOrgAssignments(pool, deps.lapseContext());
  const { people, vacant, seatName } = await holdersNow(pool, rows, seatings);

  const bundles = new Map<string, Bundle>();
  const bundle = (userId: string): Bundle => {
    const b = bundles.get(userId) ?? { own: [], seats: new Map<string, TaskMailLine[]>() };
    bundles.set(userId, b);
    return b;
  };
  for (const r of rows) {
    const who = people.get(r.entryId);
    if (!who) continue;
    const line: TaskMailLine = { text: r.text, dueOn: r.dueOn };
    if (who.own) bundle(who.own).own.push(line);
    const name = r.ownerSeatId ? (seatName.get(r.ownerSeatId) ?? TASK_COPY.seatUnnamed) : "";
    for (const userId of who.seat) {
      const seats = bundle(userId).seats;
      seats.set(name, [...(seats.get(name) ?? []), line]);
    }
  }

  const zone = villageTimezone();
  const today = villageDate(now, zone);
  const closedOn = villageDate(s.closedAt ?? now, zone);
  const origin = deps.deploymentOrigin();
  const roomNos = (await repo.peopleRows(pool, sessionId)).map((r) => Number(r.member_no));
  const wasThere = new Set((await repo.memberUserIdRows(pool, roomNos)).map((r) => String(r.user_id)));
  let askedBy: string | null = null;
  if (opts.sentByNo > 0) {
    const [asker] = await repo.memberUserIdRows(pool, [opts.sentByNo]);
    askedBy = asker ? firstName(await deps.notifyDeps.memberById(String(asker.user_id)).catch(() => null)) : null;
  }

  result.people = bundles.size;
  for (const [userId, b] of Array.from(bundles)) {
    try {
      const member = await deps.notifyDeps.memberById(userId);
      const reason = skipReason(member, deps.notifyDeps.isPresent);
      if (reason) {
        skip(reason);
        continue;
      }
      const inRoom = wasThere.has(userId);
      const email = buildTaskEmail({
        name: firstName(member),
        sessionTitle: s.title,
        circleName: s.summary?.circleName ?? null,
        closedOn,
        today,
        wasInRoom: inRoom,
        sendNo: opts.sendNo,
        askedBy,
        own: b.own,
        seats: Array.from(b.seats).map(([seatName, tasks]) => ({ seatName, tasks })),
        boardUrl: `${origin}${TASK_BOARD_PATH}`,
        recordUrl: inRoom ? `${origin}/sessions/${sessionId}` : null,
      });
      const out = await post(deps.commsPostOffice, {
        idempotencyKey: `session-tasks:${sessionId}:${userId}:${opts.sendNo}`,
        kind: "notices",
        origin: "sessions.tasks",
        to: { email: String(member.email), name: firstName(member), userId },
        subject: email.subject,
        html: taskEmailHtml(deps.projectName(), email, deps.notifyDeps.brandColour?.()),
        text: email.text,
        urgent: false,
        expiresAt: new Date(now.getTime() + TASK_MAIL_EXPIRY_MS),
      });
      if (ON_ITS_WAY.has(out.status)) result.queued += 1;
      else skip(out.status === "skipped" ? (out.reason ?? "skipped") : out.status);
    } catch (e) {
      console.error(`[sessions] a task email for session ${sessionId} was not posted`, e);
      skip("failed");
    }
  }

  // A seat nobody sits in: the admins and the facilitator hear it, once per task per send.
  const link = `/sessions/${sessionId}`;
  const [facilitator] = await repo.memberUserIdRows(pool, s.facilitatorNo > 0 ? [s.facilitatorNo] : []);
  for (const r of vacant) {
    const title = TASK_NOTICES.unheld(s.title, seatName.get(r.ownerSeatId ?? "") ?? TASK_COPY.seatUnnamed);
    const key = `session-task-unheld:${r.entryId}:${opts.sendNo}`;
    try {
      await deps.notifyAdmins("session_task_unheld", title, key, link);
      if (facilitator) {
        const userId = String(facilitator.user_id);
        await deps.notify({ userId, type: "session_task_unheld", title, link, dedupeKey: `${key}:${userId}` });
      }
    } catch (e) {
      console.error(`[sessions] nobody was told task ${r.entryId} sits with an empty role`, e);
    }
  }

  await store.writeSendCounts(pool, sessionId, opts.sendNo, JSON.stringify({ people: result.people, queued: result.queued, skipped: result.skipped }));
  return result;
}

/**
 * The close's own send, number 1. Recorded first and only once: a close that
 * runs twice, or a second caller, finds the number taken and sends nothing.
 * Started by the close and never waited on; the caller catches.
 */
export async function queueCloseMail(deps: TaskMailDeps, sessionId: number, now = new Date()): Promise<TaskMailResult | null> {
  const fresh = await store.insertSend(deps.getPool(), { sessionId, sendNo: 1, sentByNo: 0, sentAt: now, counts: "{}" });
  if (!fresh) return null;
  return sendTaskEmails(deps, sessionId, { sendNo: 1, sentByNo: 0 }, now);
}

// ── The gentle notes ────────────────────────────────────────────────────────

/**
 * The hourly job: one note two days before a task's date, and one the morning
 * after it, to whoever holds it now. Nothing for a task with no date, a task
 * that is done or let go, or a task back with the circle.
 *
 *   1. Nothing while the module is off.
 *   2. Nothing outside the village's daytime window (`comms.quiet_start_hour`
 *      to `comms.quiet_end_hour`, 8 to 20 by default), so a note never
 *      arrives at night.
 *   3. Every open task due from yesterday to the day after tomorrow is read
 *      through the due index; each person holding it gets the in-app notice
 *      `session_action_due`, and, when their task emails are immediate, the
 *      note itself by email. Both open that one task on the board
 *      (`taskBoardLink`), so the answer is one tap away.
 *
 * IDEMPOTENT across hours and restarts. The notice and the email share one
 * key per (task, person, date, mark): `session-due:<entry>:<user>:<date>:<mark>`.
 * The notification spine inserts a key once and the post office takes it
 * once, so the job can run every hour of both days and each person hears at
 * most twice per date. A new date (Not yet) is a new key, which is the point.
 *
 * The notice's own email cadence is "off" for immediate (this email is the
 * richer one) and "daily" for daily (server/lib/notify.ts).
 */
export async function runTaskNotes(deps: TaskNoteDeps, now = new Date()): Promise<string> {
  const lifecycle = deps.lifecycle ?? (() => effectiveLifecycle("sessions"));
  if (lifecycle() === "off") return "the sessions module is off";
  const zone = villageTimezone();
  const hours = deps.window?.() ?? { start: numberVar("comms.quiet_start_hour"), end: numberVar("comms.quiet_end_hour") };
  if (nextInWindow(now, zone, hours.start, hours.end).getTime() !== now.getTime()) return "outside the village's daytime window";

  const pool = deps.getPool();
  const today = villageDate(now, zone);
  const rows = await store.dueRows(pool, addCivilDays(today, TASK_DUE_MARKS.after), addCivilDays(today, TASK_DUE_MARKS.before));
  if (!rows.length) return "no task is near its date";
  const seatings = await listOrgAssignments(pool, deps.lapseContext());
  const tasks = rows.map(mailRow);
  const { people } = await holdersNow(pool, tasks, seatings);
  const origin = deps.deploymentOrigin();
  let notes = 0;
  let emails = 0;

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const t = tasks[i];
    if (!t.dueOn) continue;
    const days = civilDaysFrom(today, t.dueOn);
    const mark = days === TASK_DUE_MARKS.before ? "before" : days === TASK_DUE_MARKS.after ? "after" : null;
    if (!mark) continue;
    const who = people.get(t.entryId);
    const userIds = Array.from(new Set([...(who?.own ? [who.own] : []), ...(who?.seat ?? [])]));
    for (const userId of userIds) {
      try {
        const member = await deps.notifyDeps.memberById(userId);
        const input = {
          name: firstName(member),
          text: t.text,
          dueOn: t.dueOn,
          sessionTitle: String(r.title ?? ""),
          circleName: storedCircle(r.summary),
          saidOn: villageDate(r.closed_at, zone),
          today,
          boardUrl: `${origin}${taskBoardLink(t.entryId)}`,
        };
        const email = mark === "before" ? buildDueNote(input) : buildAfterNote(input);
        const key = `session-due:${t.entryId}:${userId}:${t.dueOn}:${mark}`;
        const line = email.blocks.find((b) => b.kind === "list");
        const fresh = await deps.notify({
          userId,
          type: "session_action_due",
          title: email.subject,
          body: line && line.kind === "list" ? (line.items[0] ?? null) : null,
          link: taskBoardLink(t.entryId),
          dedupeKey: key,
        });
        if ((fresh as { fresh?: boolean } | null)?.fresh) notes += 1;
        // Daily and off read the in-app notice only, and the digest carries it for daily.
        if (skipReason(member, deps.notifyDeps.isPresent)) continue;
        const out = await post(deps.commsPostOffice, {
          idempotencyKey: key,
          kind: "notices",
          origin: "sessions.tasks",
          to: { email: String(member.email), name: firstName(member), userId },
          subject: email.subject,
          html: taskEmailHtml(deps.projectName(), email, deps.notifyDeps.brandColour?.()),
          text: email.text,
          urgent: false,
          expiresAt: new Date(now.getTime() + TASK_MAIL_EXPIRY_MS),
        });
        if (ON_ITS_WAY.has(out.status)) emails += 1;
      } catch (e) {
        console.error(`[sessions] a note about task ${t.entryId} was not sent`, e);
      }
    }
  }
  return `${notes} notes, ${emails} emails`;
}

/** The circle's name as the session stored it at close. */
function storedCircle(raw: unknown): string | null {
  if (raw == null) return null;
  try {
    const s = typeof raw === "string" ? JSON.parse(raw) : raw;
    return s && typeof s.circleName === "string" ? s.circleName : null;
  } catch {
    return null;
  }
}
