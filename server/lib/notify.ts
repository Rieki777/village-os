/**
 * The notification spine (S16). The RULES are ported from regen-civics; the
 * code is not — this is a fresh implementation that deliberately avoids the
 * warts its own author documented:
 *
 *  - dedupe_key is NOT NULL with a real unique index; a duplicate insert is
 *    detected by the unique violation, never by driver-specific affectedRows
 *    sniffing;
 *  - delivery (email now, push when VAPID keys exist) is an EXPLICIT dispatch
 *    step after a fresh insert, not a side effect buried inside it;
 *  - preferences are ONE typed model, validated field-by-field from the
 *    member's prefs JSON — no split-brain parsing.
 *
 * Ported rules, verbatim where they were sound:
 *  - dedupe grammar: one stable key per (event, recipient) — a retried
 *    producer inserts exactly once, forever;
 *  - DAILY_EMAIL_CAP = 20 per user per rolling 24h (counted via emailed_at) —
 *    over the cap the in-app row still exists, only the email drops;
 *  - per-type cadence with 'never' as the global kill switch: quest and role
 *    events default IMMEDIATE, gratitude and stage default DAILY (a digest),
 *    unknown types are in-app only;
 *  - precedence (mention > direct reply > follow) ships with the forum in
 *    Block 5 — the spine carries the alreadyNotified pattern's home, not a
 *    speculative implementation of surfaces that don't exist yet.
 */
import crypto from "node:crypto";
import type { Pool, RowDataPacket } from "mysql2/promise";
import { numberVar } from "./variables";

/**
 * Fallback only — the live ceiling is the notify.daily_email_cap game
 * variable, read per check so an admin change needs no deploy. The variables
 * cache serves platform defaults before boot loads overrides, so this path
 * never throws.
 */
export const DAILY_EMAIL_CAP = 20;
/** Digest looks back this many days for unread, un-emailed rows. */
export const DIGEST_LOOKBACK_DAYS = 3;

export interface NotifyInput {
  userId: string;
  type: string;
  title: string;
  body?: string | null;
  link?: string | null;
  actorUserId?: string | null;
  dedupeKey: string;
}

export interface NotifyPrefs {
  /** Global email kill switch. */
  emailsOff: boolean;
  gratitudeEmail: "daily" | "off";
  questsEmail: "immediate" | "daily" | "off";
  rolesEmail: "immediate" | "daily" | "off";
  /** Forum (S24): the regen defaults — mentions and replies immediate. */
  mentionsEmail: "immediate" | "daily" | "off";
  repliesEmail: "immediate" | "daily" | "off";
  /**
   * Messaging: immediate by default. Somebody wrote to you personally, and
   * the spine's own dedupe already collapses a whole unread run into one
   * row, so "immediate" here cannot become a flood however busy the thread.
   */
  messagesEmail: "immediate" | "daily" | "off";
  /**
   * Governance (round 5, lane NOTIFY): a vote opened, a vote closing with
   * your answer still owed, a vote carried or failed, a proposal you raised
   * moving a step. ONE preference for the whole family, defaulting to DAILY.
   *
   * Daily and not immediate on purpose. A ballot's window is measured in
   * days, so a digest tomorrow still leaves time to vote, and a village that
   * opens four ballots in an afternoon would otherwise send four emails to
   * everybody on the roll. The one nudge that is genuinely time-shaped, the
   * closing-soon notice, fires 48 hours out precisely so a daily digest still
   * arrives in time to be acted on.
   */
  governanceEmail: "immediate" | "daily" | "off";
  /**
   * The weekly brief (L5b): the whole digest, in-app, email and agent inbox
   * together. One switch, default on, because the brief is the village
   * saying what the week holds and off must be one honest click.
   */
  weeklyBrief: "on" | "off";
  /**
   * The in-app celebration surface. Nothing to do with email: this is the
   * moment that shows up on the page when one of the four rare things
   * happens (shared/notificationKinds.ts holds the ration). Default on, off
   * in one click, and the notification itself lands either way.
   */
  celebrations: "on" | "off";
}

/** Junk-tolerant, field-by-field: a malformed blob degrades to defaults. */
export function resolveNotifyPrefs(prefs: any): NotifyPrefs {
  const n = prefs?.notify ?? {};
  const pick = <T extends string>(v: unknown, allowed: T[], fallback: T): T =>
    allowed.includes(v as T) ? (v as T) : fallback;
  return {
    emailsOff: n.emailsOff === true,
    gratitudeEmail: pick(n.gratitudeEmail, ["daily", "off"], "daily"),
    questsEmail: pick(n.questsEmail, ["immediate", "daily", "off"], "immediate"),
    rolesEmail: pick(n.rolesEmail, ["immediate", "daily", "off"], "immediate"),
    mentionsEmail: pick(n.mentionsEmail, ["immediate", "daily", "off"], "immediate"),
    repliesEmail: pick(n.repliesEmail, ["immediate", "daily", "off"], "immediate"),
    messagesEmail: pick(n.messagesEmail, ["immediate", "daily", "off"], "immediate"),
    governanceEmail: pick(n.governanceEmail, ["immediate", "daily", "off"], "daily"),
    weeklyBrief: pick(n.weeklyBrief, ["on", "off"], "on"),
    celebrations: pick(n.celebrations, ["on", "off"], "on"),
  };
}

/**
 * THE THREE STEWARD WINDOW NOTICES, PINNED, and they sit above the global
 * switch on purpose.
 *
 * A carried decision lands at its instant whether or not anybody is looking,
 * and these three are the only warning the one person who can stop it gets:
 * at the carry, at the half-way point, and two hours out. Every other
 * governance type resolves to `governanceEmail`, which defaults to DAILY, so
 * riding that preference meant the last warning arrived hours after the change
 * had landed.
 *
 * WHY ABOVE `emailsOff` AS WELL. The preference route refuses to turn mail off
 * while a member holds a steward-capable role (`stewardMailRefusal`), so the
 * only way a seated steward reaches this line with mail off is by having
 * turned it off BEFORE the village seated them. A silence they chose about
 * something they were not yet accountable for is not consent to miss the
 * window, and the seat is one they can hand back at any time.
 */
const STEWARD_WINDOW_TYPES: ReadonlySet<string> = new Set([
  "veto_window_opened",
  "veto_window_halfway",
  "veto_window_closing",
]);

/**
 * The refusal that keeps the pin honest lives beside the seat it is about:
 * `stewardMailRefusal` in server/lib/stewardship.ts, called by the preference
 * route before it writes.
 */

/** Which email cadence a type resolves to. Unknown types: in-app only. */
export function emailCadenceFor(type: string, p: NotifyPrefs): "immediate" | "daily" | "off" {
  if (STEWARD_WINDOW_TYPES.has(type)) return "immediate";
  if (p.emailsOff) return "off";
  switch (type) {
    case "gratitude":
      return p.gratitudeEmail;
    case "quest_consented":
    case "quest_declined":
    // Work arriving for consent is the same conversation as consent itself,
    // read from the steward's side, so it rides the same preference and needs
    // no new knob. The default is IMMEDIATE, which is the point: this is the
    // step the whole loop stalls on, and a digest tomorrow means a member who
    // finished work today waits a day for anyone to know.
    case "quest_submitted":
    // Somebody flagged themselves at risk or stuck on work they took on.
    // Same preference, same reasoning: asking for help must not cost a week,
    // and a steward who turned quest emails off has said what they want.
    case "quest_help":
      return p.questsEmail;
    case "role_appointed":
    // A mandate running out is the same conversation as being appointed to it,
    // so it rides the same preference. Somebody who turned role emails off
    // does not want this one either, and it needs no new knob to say so.
    case "term_expiring":
      return p.rolesEmail;
    // Governance, the whole family on one preference. `governance` moved off
    // the silent default here: a proposer whose proposal was sponsored,
    // voted on, applied or refused was getting an in-app row and nothing
    // else, which is a week of silence on the thing they raised.
    case "governance":
    case "ballot_opened":
    case "ballot_closing":
    case "ballot_carried":
    case "ballot_failed":
    case "ballot_no_quorum":
    case "ballot_withdrawn":
    case "ballot_advisory_closed":
    case "ballot_expired":
    // A steward's veto is the same conversation as the ballot it is about, so
    // it rides the same preference. REGISTERED HERE ON PURPOSE: a kind with no
    // case in this switch is in-app only and silently so, which for the one
    // act that stops a decision the village carried would mean the proposer
    // finds out by refreshing a page.
    case "ballot_vetoed":
    // The calendar the terms hang on. Governance, because that is what it is
    // about: a stopped season is a steward's mandate that cannot end.
    case "season":
      return p.governanceEmail;
    // A lunation's pool landed in somebody's wallet. Fixed daily for the
    // same reason stage_advanced is: welcome, never urgent, and nobody is
    // blocked waiting to hear it.
    case "cycle_settled":
      return "daily";
    case "mention":
      return p.mentionsEmail;
    case "forum_reply":
      return p.repliesEmail;
    case "message":
      return p.messagesEmail;
    case "weekly_brief":
      // "off" ON PURPOSE: runWeeklyBrief sends its own full HTML and stamps
      // emailed_at itself. If this said "immediate", the insert path would
      // race it with a flattened one-line version of the same brief.
      return "off";
    case "thread_activity":
      return "off"; // in-app only by design — follows are ambient, never urgent
    case "contact_request":
      return "off"; // the relay already sent its own email with Reply-To
    case "stage_advanced":
      return "daily"; // fixed: celebratory, never urgent
    // Triage on a bug or an idea a member sent in. Welcome news, never
    // urgent news: the member is not blocked on hearing it, and a village
    // clearing a backlog of forty items in one sitting would otherwise send
    // forty emails. The digest collapses that run into one line each.
    case "feedback":
      return "daily";
    // A decision on something the member applied for, offered, or raised a
    // hand for. Immediate on purpose: this is the answer they have been
    // waiting weeks for, and it only ever fires on a real transition.
    case "submission_status":
      return "immediate";
    case "payments_alert":
      return "immediate"; // ops: sig-fails and disputes cannot wait for a digest
    case "restorative_intake":
      return "immediate"; // a human reached out about a rupture — same day matters
    // Moderation: a report waiting for a steward, and the reply to the member
    // who filed it. Same reasoning as restorative_intake — somebody flagged
    // harassment and the clock on the first look starts now. It rides the
    // global emailsOff switch and the daily cap like everything else; the
    // in-app row survives either way. Note the SUBJECT is all an email can
    // carry here: notification emails render the title, and the title is
    // written to name no one and quote nothing.
    case "moderation":
      return "immediate";
    default:
      return "off";
  }
}

export interface NotifyDeps {
  pool: Pool;
  /** Load the recipient (email + prefs). Injected so the spine never imports the server. */
  memberById(id: string): Promise<any | null>;
  /** The one mailer. Never throws. */
  sendEmail(opts: { to: string[]; subject: string; html: string }): Promise<void>;
  /** Absolute origin for links in emails, e.g. https://amora.regencivics.earth */
  origin(): string;
  projectName(): string;
}

export interface NotifyResult {
  fresh: boolean;
  id?: string;
}

/**
 * Insert exactly once (the dedupe key decides), then explicitly dispatch
 * immediate email when the recipient's cadence says so. Never throws into
 * the producing mutation: a notification is a trace, not the deed.
 */
export async function insertNotification(deps: NotifyDeps, input: NotifyInput): Promise<NotifyResult> {
  /*
   * Four base36 characters of randomness inside one millisecond is about one
   * collision in 1.7 million, and a collision here is invisible in the worst
   * way: the insert fails with ER_DUP_ENTRY on the PRIMARY key, the catch
   * below reads that as "already sent", and a real notification is dropped as
   * a successful dedupe. notifyRoll sends one of these per member of an
   * electorate in a tight loop, which is exactly the shape that generates
   * same-millisecond ids. Twelve hex characters makes the id's own collision
   * negligible beside the dedupe key, which is the thing that is supposed to
   * decide.
   */
  const id = `ntf-${Date.now()}-${crypto.randomBytes(6).toString("hex")}`;
  try {
    await deps.pool.query(
      "INSERT INTO notifications (id, user_id, type, title, body, link, actor_user_id, dedupe_key) VALUES (?,?,?,?,?,?,?,?)",
      [id, input.userId, input.type, input.title.slice(0, 255), input.body ?? null, input.link ?? null, input.actorUserId ?? null, input.dedupeKey],
    );
  } catch (e: any) {
    if (e?.code === "ER_DUP_ENTRY") return { fresh: false };
    console.error("[notify] insert failed (mutation unaffected)", e);
    return { fresh: false };
  }

  // Explicit dispatch — a failure here never un-inserts the row.
  try {
    await maybeEmailImmediate(deps, { ...input, id });
  } catch (e) {
    console.error("[notify] immediate email dispatch failed", e);
  }
  return { fresh: true, id };
}

async function underDailyCap(pool: Pool, userId: string): Promise<boolean> {
  const [[row]] = await pool.query<any[]>(
    "SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND emailed_at >= (NOW() - INTERVAL 1 DAY)",
    [userId],
  );
  return Number(row?.n ?? 0) < Math.max(1, numberVar("notify.daily_email_cap") || DAILY_EMAIL_CAP);
}

function emailShell(projectName: string, inner: string): string {
  return `<!doctype html><html><body style="font-family:system-ui,-apple-system,sans-serif;background:#f9fafb;padding:24px;color:#1f2937"><div style="max-width:520px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb"><div style="background:#2D5A5A;color:#fff;padding:18px 24px"><div style="font-size:16px;font-weight:700">${projectName}</div></div><div style="padding:22px 24px;line-height:1.6">${inner}</div></div></body></html>`;
}

async function maybeEmailImmediate(deps: NotifyDeps, n: NotifyInput & { id: string }) {
  const user = await deps.memberById(n.userId);
  if (!user?.email || !user.passwordHash) return; // tombstones and claim-pending accounts get no email
  const prefs = resolveNotifyPrefs(user.prefs);
  if (emailCadenceFor(n.type, prefs) !== "immediate") return;
  /*
   * THE DAILY CAP IS THE LAST DOOR THE WINDOW NOTICE FELL THROUGH.
   *
   * `STEWARD_WINDOW_TYPES` already outranks the governance preference and the
   * global `emailsOff` switch, for the reason written above it: these three are
   * the only warning the one person who can stop a landing ever gets. The cap
   * was the remaining silent drop, and it is the worst of the three, because it
   * fires precisely on the busiest stewards and drops the two-hours-left
   * warning while the decision lands anyway.
   *
   * A cap exists to stop a member being flooded. This is not volume: it is at
   * most three notices per carried decision, each on a deadline the recipient
   * cannot extend, and a dropped one cannot be caught up by tomorrow's digest
   * because the thing it warned about has already happened.
   */
  if (!STEWARD_WINDOW_TYPES.has(n.type) && !(await underDailyCap(deps.pool, n.userId))) return;

  const url = deps.origin() + (n.link ?? "/profile");
  await deps.sendEmail({
    to: [user.email],
    subject: n.title,
    html: emailShell(
      deps.projectName(),
      `<h2 style="margin:0 0 8px;font-size:17px">${escapeHtml(n.title)}</h2>` +
        (n.body ? `<p style="margin:0 0 14px;color:#4b5563;border-left:3px solid #2D5A5A;padding-left:10px">${escapeHtml(n.body)}</p>` : "") +
        `<p><a href="${escapeHtml(url)}" style="display:inline-block;background:#2D5A5A;color:#fff;border-radius:8px;padding:9px 16px;text-decoration:none;font-weight:600">See it on your profile</a></p>` +
        `<p style="color:#9ca3af;font-size:12px;margin-top:18px">Choose which emails you get on your profile page.</p>`,
    ),
  });
  // Stamped even when the provider quietly declined — a late retry email
  // surprises more than a missed one (regen's rule, kept deliberately).
  await deps.pool.query("UPDATE notifications SET emailed_at = CURRENT_TIMESTAMP WHERE id = ? AND emailed_at IS NULL", [n.id]);
}

/**
 * The daily digest: unread, never-emailed rows from the last few days whose
 * type resolves to 'daily' for that member. One email per member per run.
 */
export async function runNotificationDigest(deps: NotifyDeps): Promise<{ users: number; rows: number }> {
  const [rows] = await deps.pool.query<RowDataPacket[]>(
    "SELECT id, user_id, type, title, link FROM notifications " +
      "WHERE emailed_at IS NULL AND is_read = 0 AND created_at >= (NOW() - INTERVAL ? DAY) " +
      "ORDER BY user_id, created_at",
    [DIGEST_LOOKBACK_DAYS],
  );
  const byUser = new Map<string, RowDataPacket[]>();
  for (const r of rows) {
    const list = byUser.get(String(r.user_id)) ?? [];
    list.push(r);
    byUser.set(String(r.user_id), list);
  }

  let sent = 0;
  let included = 0;
  for (const [userId, list] of Array.from(byUser.entries())) {
    const user = await deps.memberById(userId);
    if (!user?.email || !user.passwordHash) continue;
    const prefs = resolveNotifyPrefs(user.prefs);
    if (prefs.emailsOff) continue;
    const daily = list.filter((r) => emailCadenceFor(String(r.type), prefs) === "daily");
    if (!daily.length) continue;

    const subject = daily.length === 1 ? String(daily[0].title) : `${daily.length} things happened while you were away`;
    const items = daily
      .slice(0, 10)
      .map((r) => `<li style="margin:4px 0"><a href="${escapeHtml(deps.origin() + (r.link ?? "/profile"))}" style="color:#2D5A5A">${escapeHtml(String(r.title))}</a></li>`)
      .join("");
    const more = daily.length > 10 ? `<p style="color:#6b7280">…and ${daily.length - 10} more.</p>` : "";
    await deps.sendEmail({
      to: [user.email],
      subject,
      html: emailShell(deps.projectName(), `<h2 style="margin:0 0 10px;font-size:17px">While you were away</h2><ul style="padding-left:18px;margin:0 0 10px">${items}</ul>${more}<p><a href="${escapeHtml(deps.origin() + "/profile")}" style="color:#2D5A5A;font-weight:600">See everything</a></p>`),
    });
    await deps.pool.query(
      `UPDATE notifications SET emailed_at = CURRENT_TIMESTAMP WHERE id IN (${daily.map(() => "?").join(",")})`,
      daily.map((r) => r.id),
    );
    sent++;
    included += daily.length;
    // Be gentle with the mail provider's rate limits.
    await new Promise((r) => setTimeout(r, 300));
  }
  return { users: sent, rows: included };
}

// ── The weekly brief sender (round 4, lane L5b) ─────────────────────────────

export interface WeeklyBriefRendered {
  subject: string;
  /** One line for the in-app row's body. */
  line: string;
  text: string;
  html: string;
  /** The gathered facts, as the agent inbox envelope's data. */
  data: unknown;
}

export interface RunWeeklyBriefOpts {
  weekKey: string;
  /** Who could receive one. The caller decides the population; this filters by prefs. */
  members: Array<{ id: string }>;
  /** Build one member's brief. Null skips them quietly. NEVER calls a model. */
  gather(member: any): Promise<WeeklyBriefRendered | null>;
  /**
   * Queue the digest to the member's agent inbox (L6's enqueueAgentDelivery,
   * bound by the caller). Every non-ok answer is tolerated silently: the
   * brief lands in-app and by email whether or not an agent is listening.
   */
  enqueueAgent?(userId: string, data: unknown): Promise<{ ok: boolean } | unknown>;
}

export interface WeeklyBriefSummary {
  eligible: number;
  fresh: number;
  emailed: number;
  agents: number;
  optedOut: number;
}

/**
 * Deliver the weekly brief: one in-app row per opted-in member (dedupe key
 * `brief:<weekKey>:<userId>`, so a second run in the same week inserts and
 * sends NOTHING), an email with the full HTML for those the cap and their
 * prefs allow, and one agent-inbox delivery per member whose agent listens.
 *
 * `emailCadenceFor("weekly_brief")` answers "off" on purpose, so the insert's
 * own immediate path never emails a flattened body; the email leaves from
 * here, once, and stamps `emailed_at` on the same row.
 */
export async function runWeeklyBrief(deps: NotifyDeps, opts: RunWeeklyBriefOpts): Promise<WeeklyBriefSummary> {
  const summary: WeeklyBriefSummary = { eligible: 0, fresh: 0, emailed: 0, agents: 0, optedOut: 0 };
  for (const m of opts.members) {
    const user = await deps.memberById(m.id);
    if (!user) continue;
    const prefs = resolveNotifyPrefs(user.prefs);
    if (prefs.weeklyBrief === "off") {
      summary.optedOut += 1;
      continue;
    }
    summary.eligible += 1;

    let rendered: WeeklyBriefRendered | null = null;
    try {
      rendered = await opts.gather(user);
    } catch (e) {
      console.error("[brief] gather failed for one member (the rest continue)", e);
    }
    if (!rendered) continue;

    const inserted = await insertNotification(deps, {
      userId: user.id,
      type: "weekly_brief",
      title: rendered.subject,
      body: rendered.line,
      link: `/events?brief=${opts.weekKey}`,
      dedupeKey: `brief:${opts.weekKey}:${user.id}`,
    });
    if (!inserted.fresh) continue;
    summary.fresh += 1;

    if (!prefs.emailsOff && user.email && user.passwordHash && (await underDailyCap(deps.pool, user.id))) {
      try {
        await deps.sendEmail({
          to: [user.email],
          subject: rendered.subject,
          html: emailShell(
            deps.projectName(),
            `<h2 style="margin:0 0 6px;font-size:17px">${escapeHtml(rendered.subject)}</h2>` +
              rendered.html +
              `<p style="margin:16px 0 0"><a href="${escapeHtml(deps.origin() + `/events?brief=${opts.weekKey}`)}" style="display:inline-block;background:#2D5A5A;color:#fff;border-radius:8px;padding:9px 16px;text-decoration:none;font-weight:600">Open the calendar</a></p>` +
              `<p style="color:#9ca3af;font-size:12px;margin-top:18px">You can turn the weekly brief off on the calendar page, under the brief itself.</p>`,
          ),
        });
        if (inserted.id) {
          await deps.pool.query("UPDATE notifications SET emailed_at = CURRENT_TIMESTAMP WHERE id = ? AND emailed_at IS NULL", [inserted.id]);
        }
        summary.emailed += 1;
        // Be gentle with the mail provider's rate limits, same as the digest.
        await new Promise((r) => setTimeout(r, 300));
      } catch (e) {
        console.error("[brief] email failed (in-app row stands)", e);
      }
    }

    if (opts.enqueueAgent) {
      try {
        const q: any = await opts.enqueueAgent(user.id, rendered.data);
        if (q && q.ok === true) summary.agents += 1;
        // Every non-ok reason (no inbox, disabled, bad kind) passes in silence.
      } catch (e) {
        console.error("[brief] agent enqueue failed (delivery elsewhere stands)", e);
      }
    }
  }
  return summary;
}

// ── Reads ────────────────────────────────────────────────────────────────────

/**
 * SEEN IS NOT READ, and the badge counts the first one.
 *
 * Three states, which is what every notification product that has thought
 * about this converged on (Knock and Novu name them identically; the argument
 * is in docs/NOTIFICATION_RESEARCH.md part 1 section 2):
 *
 *   UNSEEN  the member has not even looked at the bell since it arrived.
 *           THIS is what the badge counts.
 *   SEEN    the panel was opened, so the badge goes quiet. Nothing is
 *           destroyed and the row still reads as unread.
 *   READ    the member went to the thing, or pressed Mark all read.
 *
 * Collapsing seen into read is the antipattern: a member who glances at the
 * bell loses the record of what they had actually dealt with. Keeping them
 * apart costs one timestamp, held in the member's prefs blob so it needs no
 * column and no migration, and it is what stops a permanent number sitting on
 * a bell that nobody can clear without pretending to have read things.
 *
 * Unseen is a SUBSET of unread, deliberately: something already dealt with can
 * never come back as new.
 */
function unseenClause(seenAt: unknown): { sql: string; params: unknown[] } {
  if (!seenAt) return { sql: "COUNT(CASE WHEN is_read = 0 THEN 1 END)", params: [] };
  return { sql: "COUNT(CASE WHEN is_read = 0 AND created_at > ? THEN 1 END)", params: [new Date(String(seenAt))] };
}

export async function notificationsFor(pool: Pool, userId: string, limit = 50, seenAt?: unknown) {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT id, type, title, body, link, is_read, actor_user_id, created_at FROM notifications " +
      "WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT ?",
    [userId, Math.max(1, Math.min(200, limit))],
  );
  const unseen = unseenClause(seenAt);
  const [[unread]] = await pool.query<any[]>(
    `SELECT COUNT(CASE WHEN is_read = 0 THEN 1 END) AS n, ${unseen.sql} AS unseen ` +
      "FROM notifications WHERE user_id = ?",
    [...unseen.params, userId],
  );
  return {
    unreadCount: Number(unread?.n ?? 0),
    unseenCount: Number(unread?.unseen ?? 0),
    notifications: rows.map((r) => ({
      id: String(r.id),
      type: String(r.type),
      title: String(r.title),
      body: r.body ?? null,
      link: r.link ?? null,
      isRead: !!r.is_read,
      actorUserId: r.actor_user_id ?? null,
      at: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
    })),
  };
}

/**
 * The cheap read behind the poll: how many are unread, and when the newest
 * one landed. ONE indexed pass over this member's rows, no list built and no
 * body columns touched.
 *
 * This is what let the bell poll four times as often for less work than it
 * cost before. The client asks this every twenty-five seconds while somebody
 * is actually on the page, and only fetches the list when `latestAt` moves or
 * the panel opens.
 */
export async function notificationPulse(pool: Pool, userId: string, seenAt?: unknown) {
  const unseen = unseenClause(seenAt);
  const [[row]] = await pool.query<any[]>(
    `SELECT COUNT(CASE WHEN is_read = 0 THEN 1 END) AS unread, ${unseen.sql} AS unseen, MAX(created_at) AS latest ` +
      "FROM notifications WHERE user_id = ?",
    [...unseen.params, userId],
  );
  const latest = row?.latest ?? null;
  return {
    unreadCount: Number(row?.unread ?? 0),
    unseenCount: Number(row?.unseen ?? 0),
    latestAt: latest === null ? null : latest instanceof Date ? latest.toISOString() : String(latest),
  };
}

export async function markNotificationsRead(pool: Pool, userId: string, ids?: string[]): Promise<number> {
  if (ids?.length) {
    const [r]: any = await pool.query(
      `UPDATE notifications SET is_read = 1 WHERE user_id = ? AND id IN (${ids.map(() => "?").join(",")})`,
      [userId, ...ids],
    );
    return r.affectedRows ?? 0;
  }
  const [r]: any = await pool.query("UPDATE notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0", [userId]);
  return r.affectedRows ?? 0;
}

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
