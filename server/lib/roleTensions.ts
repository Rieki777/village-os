/**
 * RAISE A TENSION WITH A ROLE: the rules (player role card, PR 5 of 7). The
 * contract and every sentence is shared/roleTensions.ts; the statements are
 * server/repos/roleTensions.ts; the doors are server/routes/roleTensions.ts.
 *
 *   raiseTension          a member raises one; every live holder hears once
 *   respondToTension      a live holder takes it, answers it, or brings it
 *                         to the role's circle
 *   heldTensionsFor       the open ones a member holds, for Waiting on you
 *   roleTensionsFor       one role's tensions as one reader may see them
 *   tensionsForRoles      the same, for many roles at once, shaped for the
 *                         player card (PR 2 feeds `PlayerRoleIn.tensions`)
 *   remindTensionHolders  the reminder after two business days, once
 *   forgetRoleTensionsFor erasure
 *
 * ── PRIVATE UNTIL A HOLDER SAYS OTHERWISE ────────────────────────────────
 *
 * A tension often names a person. So its words go to exactly two kinds of
 * reader: the member who raised it and the role's live holders. Answering it
 * changes nothing about that; the card shows answered tensions as a count.
 * Only a bring to the circle makes the words readable to every member, and it
 * does so by making them one of the circle's agenda items
 * (server/lib/sessionLibrary.ts), where the circle's next session finds them.
 * `mayReadTensionWords` is the one rule every read here asks.
 *
 * NOTHING HERE NAMES THE RAISER to anybody but themselves. A row carries
 * `mine`, never an id or a name, and the notices say "a tension was raised".
 *
 * ── BRING TO THE CIRCLE, AS ONE OF ITS AGENDA ITEMS ──────────────────────
 *
 * Every tension becomes an agenda item (sessions feature 2, Rye 2026-10-22).
 * A bring makes one item waiting for the role's circle, brought by the holder
 * who brought it, with the tension's words and where it came from (0279), so
 * the circle's members see it with the rest, the start card ticks it, and the
 * room takes it up. It works for a circle that has never met, and it never
 * writes into a closed session's record. `circle_entry_id` (0269) stays as it
 * is for the brings made before; a new bring leaves it null.
 *
 * No `recordEvent`, no `addActivity`: both reach the village's public record
 * by default, and the words are private. The row is the record.
 */
import crypto from "node:crypto";
import type { Pool } from "mysql2/promise";
import {
  isOpenTension,
  mayReadTensionWords,
  parseRespond,
  parseTensionText,
  respondRefusal,
  statusAfter,
  TENSION_COPY,
  TENSION_REFUSALS,
  TENSION_REMINDER_BUSINESS_DAYS,
  type HeldTension,
  type RoleTensionsPayload,
  type TensionCard,
  type TensionStatus,
} from "../../shared/roleTensions";
import type { TensionIn } from "../../shared/playerCard";
import { TASK_BOARD_PATH } from "../../shared/sessionTasks";
import { addBusinessDays } from "../../shared/businessDays";
import { civilDateKey } from "../../shared/lunar";
import * as store from "../repos/roleTensions";
import { inTransaction } from "../repos/liveSessions";
import { ensureMemberNo } from "./liveSessions";
import { TensionSentAlready, itemFromTension } from "./sessionLibrary";
import type { NotifyInput } from "./notify";
import type { TensionRow } from "../repos/roleTensions";

export type Outcome<T> = { ok: true; value: T } | { ok: false; status: number; error: string };
const refuse = (status: number, error: string): { ok: false; status: number; error: string } => ({ ok: false, status, error });
const done = <T>(value: T): Outcome<T> => ({ ok: true, value });

/** Who is asking. `member` is a signed-in member, never a guest. */
export interface TensionViewer {
  userId: string | null;
  member: boolean;
}

export interface TensionDeps {
  notify(input: NotifyInput): Promise<unknown>;
  /** The village's IANA zone, for civil dates and business days. */
  timeZone(): string;
  /** Whether Live Sessions is on, so a circle backlog has a reader. */
  sessionsOn(): boolean;
}

const newId = (): string => `rt-${crypto.randomBytes(8).toString("hex")}`;
const day = (d: Date, tz: string): string => civilDateKey(d, tz || "UTC");

/** Past the reminder line: two business days after it was raised, on the village's clock. */
export function isOverdue(raisedAt: Date, now: Date, timeZone: string): boolean {
  return addBusinessDays(raisedAt, TENSION_REMINDER_BUSINESS_DAYS, timeZone || "UTC").getTime() <= now.getTime();
}

/** Role id to its live holders, for these roles. */
async function holdersByRole(pool: Pool, roleIds: readonly string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  for (const h of await store.liveHoldings(pool, { roleIds })) {
    const list = out.get(h.roleId) ?? [];
    if (!list.includes(h.userId)) list.push(h.userId);
    out.set(h.roleId, list);
  }
  return out;
}

function cardOf(t: TensionRow, viewerId: string, tz: string): TensionCard {
  return {
    id: t.id,
    roleId: t.roleId,
    status: t.status,
    text: t.text,
    mine: t.raisedBy !== null && t.raisedBy === viewerId,
    answerNote: t.answerNote,
    raisedOn: day(t.createdAt, tz),
    answeredOn: t.answeredAt ? day(t.answeredAt, tz) : null,
  };
}

// ── Raise ───────────────────────────────────────────────────────────────────

/** A member raises a tension with a role. The caller has checked they are a member and bounded the rate. */
export async function raiseTension(
  pool: Pool,
  who: { userId: string },
  roleId: string,
  body: unknown,
  deps: TensionDeps,
  now = new Date(),
): Promise<Outcome<TensionCard>> {
  const parsed = parseTensionText(body && typeof body === "object" ? (body as { text?: unknown }).text : undefined);
  if (!parsed.ok) return refuse(400, TENSION_REFUSALS[parsed.refusal]);
  const role = await store.roleForTension(pool, roleId);
  if (!role) return refuse(404, TENSION_REFUSALS.noRole);
  const holders = (await holdersByRole(pool, [role.id])).get(role.id) ?? [];
  if (!holders.length) return refuse(409, TENSION_REFUSALS.noHolders);

  const id = newId();
  await store.insertTension(pool, { id, roleId: role.id, raisedBy: who.userId, text: parsed.text, now });
  // One notice per holder. A holder who raised it does not hear about their own words.
  for (const holder of holders) {
    if (holder === who.userId) continue;
    await deps.notify({
      userId: holder,
      type: "role_tension_raised",
      title: TENSION_COPY.noticeTitle(role.name),
      body: TENSION_COPY.noticeBody,
      link: TASK_BOARD_PATH,
      actorUserId: null,
      dedupeKey: `rt:${id}:raised:${holder}`,
    });
  }
  const stored = await store.tensionById(pool, id);
  if (!stored) throw new Error("role tensions: a tension just written could not be read back");
  return done(cardOf(stored, who.userId, deps.timeZone()));
}

// ── Respond ─────────────────────────────────────────────────────────────────

/** A live holder takes a tension, answers it, or brings it to the circle. */
export async function respondToTension(
  pool: Pool,
  who: { userId: string },
  id: string,
  body: unknown,
  deps: TensionDeps,
  now = new Date(),
): Promise<Outcome<TensionCard>> {
  const parsed = parseRespond(body);
  const first = await store.tensionById(pool, id);
  if (!first) return refuse(404, TENSION_REFUSALS.notFound);
  const holders = (await holdersByRole(pool, [first.roleId])).get(first.roleId) ?? [];
  // A stranger learns nothing about the tension, not even that the body was wrong.
  if (!holders.includes(who.userId)) return refuse(403, TENSION_REFUSALS.notHolder);
  if (!parsed.ok) return refuse(400, TENSION_REFUSALS[parsed.refusal]);
  const { action, note } = parsed;

  // Everything a bring needs from outside the transaction, asked first.
  let circleId: string | null = null;
  let roleName = "";
  let authorNo = 0;
  if (action === "bring_to_circle") {
    if (!deps.sessionsOn()) return refuse(409, TENSION_REFUSALS.sessionsOff);
    const role = await store.roleForTension(pool, first.roleId);
    circleId = role?.circleId ?? null;
    roleName = role?.name ?? "";
    if (!circleId) return refuse(409, TENSION_REFUSALS.noCircle);
    authorNo = await ensureMemberNo(pool, who.userId, now);
  }

  const respond = () => inTransaction(pool, async (conn): Promise<Outcome<null>> => {
    const t = await store.tensionById(conn, id, true);
    if (!t) return refuse(404, TENSION_REFUSALS.notFound);
    const why = respondRefusal(t.status, action);
    if (why) return refuse(409, TENSION_REFUSALS[why]);
    if (action === "bring_to_circle" && circleId) {
      if (!t.text.trim()) return refuse(409, TENSION_REFUSALS.wordsCleared);
      // One item per tension: the status check above already refuses a second bring, and the source key holds it too.
      const item = await itemFromTension(conn, { circleId, text: t.text, broughtByNo: authorNo, source: { kind: "role_tension", ref: t.id, label: roleName }, now });
      if (item == null) return refuse(409, TENSION_REFUSALS.alreadyAnswered);
    }
    const status: TensionStatus = statusAfter(action);
    await store.writeResponse(conn, id, {
      status,
      answeredBy: who.userId,
      answerNote: action === "take" ? null : note,
      answeredAt: status === "taken" ? null : now,
      circleEntryId: null,
    });
    return done(null);
  });
  let out: Outcome<null>;
  try {
    out = await respond();
  } catch (e) {
    // A bring that lost the race to the same tension's agenda item: rolled back whole, and refused as answered already.
    if (e instanceof TensionSentAlready) return refuse(409, TENSION_REFUSALS.alreadyAnswered);
    throw e;
  }
  if (!out.ok) return out;
  const stored = await store.tensionById(pool, id);
  if (!stored) return refuse(404, TENSION_REFUSALS.notFound);
  return done(cardOf(stored, who.userId, deps.timeZone()));
}

// ── Reads ───────────────────────────────────────────────────────────────────

/** The open tensions raised with roles `userId` holds now, oldest first, for Waiting on you. */
export async function heldTensionsFor(pool: Pool, userId: string, opts: { timeZone: string; now?: Date }): Promise<HeldTension[]> {
  const roleIds = Array.from(new Set((await store.liveHoldings(pool, { userId })).map((h) => h.roleId)));
  if (!roleIds.length) return [];
  const open = await store.openTensionsForRoleIds(pool, roleIds);
  if (!open.length) return [];
  const roles = await store.rolesWithCircles(pool, Array.from(new Set(open.map((t) => t.roleId))));
  const now = opts.now ?? new Date();
  return open
    .filter((t) => t.text.trim().length > 0)
    .map((t) => {
      const role = roles.get(t.roleId);
      return {
        id: t.id,
        roleId: t.roleId,
        role: role?.name || t.roleId,
        circle: role?.circle ?? null,
        text: t.text,
        status: t.status === "taken" ? "taken" : "open",
        raisedOn: day(t.createdAt, opts.timeZone),
        overdue: t.status === "open" && isOverdue(t.createdAt, now, opts.timeZone),
      };
    });
}

/** One role's tensions as `viewer` may see them. Counts for members only. */
export async function roleTensionsFor(pool: Pool, roleId: string, viewer: TensionViewer, timeZone: string): Promise<RoleTensionsPayload> {
  const mayRaise = viewer.userId !== null && viewer.member;
  if (!viewer.userId || !viewer.member) return { mayRaise, open: 0, answered: 0, tensions: [] };
  const rows = await store.tensionsForRoleIds(pool, [roleId]);
  const holds = ((await holdersByRole(pool, [roleId])).get(roleId) ?? []).includes(viewer.userId);
  const tensions = rows
    .filter((t) => t.text.trim() && mayReadTensionWords(t, { ...viewer, holdsRole: holds }))
    .map((t) => cardOf(t, viewer.userId as string, timeZone));
  return {
    mayRaise,
    open: rows.filter((t) => isOpenTension(t.status)).length,
    answered: rows.filter((t) => !isOpenTension(t.status)).length,
    tensions,
  };
}

/** What `tensionsForRoles` answers for one role. */
export interface RoleTensions {
  /** Unanswered: open or taken. */
  open: number;
  /** Answered, brought to the circle or not. */
  answered: number;
  /** Of the answered, how many went to the circle. Their words are member-readable. */
  broughtToCircle: number;
  /**
   * Every tension with the role in the card's own shape, newest first. Words
   * and `raisedBy` are filled only where this viewer may read them; anywhere
   * else both are "", which the card reads as nothing to show and still counts.
   */
  tensions: TensionIn[];
}

/**
 * TENSIONS FOR THE PLAYER CARD, many roles in three reads (the tensions, the
 * holders, nothing per row). For PR 2's card host: pass each role's entry as
 * `PlayerRoleIn.tensions`, and `tensions: undefined` for a role missing from
 * the map, which the card draws as not read.
 *
 * A viewer who is not a signed-in member gets an EMPTY map: a guest and a
 * visitor read no tensions at all, not even a count.
 *
 * The card's own rule (shared/playerCard.ts `tensionsFor`) prints open words
 * only to the card's owner and to the raiser; this map gives open words only
 * to the role's holders and the raiser, so the two agree. Answered words come
 * through only when brought to the circle, or to the holders and the raiser.
 */
export async function tensionsForRoles(pool: Pool, roleIds: readonly string[], viewer: TensionViewer): Promise<Map<string, RoleTensions>> {
  const out = new Map<string, RoleTensions>();
  const ids = Array.from(new Set(roleIds.filter((r) => typeof r === "string" && r)));
  if (!viewer.userId || !viewer.member || !ids.length) return out;
  const [rows, holders] = await Promise.all([store.tensionsForRoleIds(pool, ids), holdersByRole(pool, ids)]);
  for (const id of ids) out.set(id, { open: 0, answered: 0, broughtToCircle: 0, tensions: [] });
  for (const t of rows) {
    const slot = out.get(t.roleId);
    if (!slot) continue;
    const open = isOpenTension(t.status);
    if (open) slot.open += 1;
    else slot.answered += 1;
    if (t.status === "brought_to_circle") slot.broughtToCircle += 1;
    const holds = (holders.get(t.roleId) ?? []).includes(viewer.userId);
    const may = mayReadTensionWords(t, { ...viewer, holdsRole: holds });
    slot.tensions.push({
      id: t.id,
      status: open ? "open" : "answered",
      // Only ever the viewer's own id: the card compares it to the viewer, and no other id leaves here.
      raisedBy: may && t.raisedBy === viewer.userId ? viewer.userId : "",
      text: may ? t.text : "",
      broughtToCircle: t.status === "brought_to_circle",
      answeredAt: !open && t.answeredAt ? t.answeredAt.toISOString() : null,
    });
  }
  return out;
}

/**
 * How many tensions are open with each of these roles, for the role tiles on
 * `/roles` (server/lib/orgRoleHealth.ts). The same statement and the same
 * open rule `tensionsForRoles` counts by, so a tile and the card agree. A
 * count only: no words, no raiser, so the caller's tier is the only gate.
 */
export async function openTensionCountsFor(pool: Pool, roleIds: readonly string[]): Promise<Map<string, number>> {
  const ids = Array.from(new Set(roleIds.filter((r) => typeof r === "string" && r)));
  const out = new Map<string, number>();
  if (!ids.length) return out;
  for (const t of await store.tensionsForRoleIds(pool, ids)) {
    if (isOpenTension(t.status)) out.set(t.roleId, (out.get(t.roleId) ?? 0) + 1);
  }
  return out;
}

// ── The reminder ────────────────────────────────────────────────────────────

export interface ReminderDeps {
  pool: Pool;
  notify(input: NotifyInput): Promise<unknown>;
  timeZone(): string;
}

/**
 * Each live holder of a tension nobody has taken hears once more after two
 * business days on the village's clock. The dedupe key is per tension and
 * holder, so the hourly job can run as often as it likes and the spine writes
 * one row. A tension somebody took or answered is never read here.
 */
export async function remindTensionHolders(deps: ReminderDeps, now = new Date()): Promise<number> {
  const tz = deps.timeZone() || "UTC";
  // Two business days are never fewer than 48 hours, so older rows are the only candidates.
  const aged = (await store.untakenOlderThan(deps.pool, new Date(now.getTime() - 48 * 60 * 60 * 1000))).filter(
    (t) => t.text.trim() && isOverdue(t.createdAt, now, tz),
  );
  if (!aged.length) return 0;
  const roleIds = Array.from(new Set(aged.map((t) => t.roleId)));
  const [holders, roles] = await Promise.all([holdersByRole(deps.pool, roleIds), store.rolesWithCircles(deps.pool, roleIds)]);
  let asked = 0;
  for (const t of aged) {
    for (const holder of holders.get(t.roleId) ?? []) {
      if (holder === t.raisedBy) continue;
      await deps.notify({
        userId: holder,
        type: "role_tension_reminder",
        title: TENSION_COPY.reminderTitle(roles.get(t.roleId)?.name || t.roleId),
        body: TENSION_COPY.reminderBody,
        link: TASK_BOARD_PATH,
        actorUserId: null,
        dedupeKey: `rt:${t.id}:remind:${holder}`,
      });
      asked += 1;
    }
  }
  return asked;
}

// ── Erasure ─────────────────────────────────────────────────────────────────

/**
 * A member leaves. The raiser comes off every tension they raised, and the
 * words of each one nobody answered are cleared; their answer notes go and
 * they come off every tension they answered. Answered words stay,
 * de-attributed, as the role's record.
 */
export async function forgetRoleTensionsFor(pool: Pool, userId: string): Promise<number> {
  return store.forgetTensionsOf(pool, userId);
}
