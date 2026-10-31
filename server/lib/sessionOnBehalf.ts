/**
 * A facilitator fills in for a member (0288): the pieces every door in
 * server/lib/liveSessions.ts shares. The contract, its words and its rules in
 * plain language are shared/sessionOnBehalf.ts; the statements are
 * server/repos/sessionOnBehalf.ts.
 *
 * The doors keep their own permission checks. A fill-in adds one question in
 * front of them (`fillFor`: is this the person facilitating, and is the other
 * person in the room) and one row behind them (`recordFill`). Nothing here
 * opens a door the facilitator did not already have, except writing a new
 * thing in another person's name and handing an action to someone.
 *
 * THE NOTICE GOES AFTER THE COMMIT. A write records its row with
 * `noticed_at` NULL; the route then calls `noticesAfterFills`, which tells
 * each person and marks the row. The dedupe key is the row, so a notice
 * retried after a crash between the two is a no-op.
 */
import type { Pool, PoolConnection } from "mysql2/promise";
import * as repo from "../repos/liveSessions";
import * as fills from "../repos/sessionOnBehalf";
import { ON_BEHALF_NOTICES, ON_BEHALF_REFUSALS as OB, onBehalfWhat, type FilledIn, type OnBehalfTarget } from "../../shared/sessionOnBehalf";
import { isEntryKind, type EntryKind } from "../../shared/sessions";

type Refusal = { ok: false; status: number; error: string };
type Outcome<T> = { ok: true; value: T } | Refusal;
const refuse = (status: number, error: string): Refusal => ({ ok: false, status, error });
const done = <T>(value: T): Outcome<T> => ({ ok: true, value });

export interface FillRec {
  id: number;
  sessionId: number;
  actorNo: number;
  personNo: number;
  target: OnBehalfTarget;
  targetId: number;
  act: "added" | "changed";
  before: Record<string, unknown> | null;
  noticed: boolean;
  undone: boolean;
  kept: boolean;
}

const asTarget = (v: unknown): OnBehalfTarget => (v === "arrival" || v === "item" ? v : "entry");

export const mapFill = (r: any): FillRec => {
  let before: Record<string, unknown> | null = null;
  if (r.before_json != null) {
    try {
      const parsed = JSON.parse(String(r.before_json));
      before = parsed && typeof parsed === "object" ? parsed : null;
    } catch {
      before = null;
    }
  }
  return {
    id: Number(r.id),
    sessionId: Number(r.session_id),
    actorNo: Number(r.actor_no ?? 0),
    personNo: Number(r.person_no ?? 0),
    target: asTarget(r.target),
    targetId: Number(r.target_id ?? 0),
    act: r.act === "changed" ? "changed" : "added",
    before,
    noticed: r.noticed_at != null,
    undone: r.undone_at != null,
    kept: r.kept_at != null,
  };
};

/** `forUserId` from a body: undefined when absent, a number to check, or a refusal. */
export function readFor(b: Record<string, unknown>): Outcome<number | undefined> {
  if (!Object.prototype.hasOwnProperty.call(b, "forUserId") || b.forUserId === undefined || b.forUserId === null) return done(undefined);
  const n = b.forUserId;
  return typeof n === "number" && Number.isInteger(n) && n > 0 && n < 2 ** 31 ? done(n) : refuse(400, OB.personNotHere);
}

/**
 * Whose this write is. Null: the writer's own (no `forUserId`, or their own
 * number). A number: a fill-in, allowed only to the person facilitating and
 * only for somebody who has joined the room.
 */
export async function fillFor(
  conn: PoolConnection,
  sessionId: number,
  facilitates: boolean,
  actorNo: number,
  forNo: number | undefined,
): Promise<Outcome<number | null>> {
  if (forNo === undefined || forNo === actorNo) return done(null);
  if (!facilitates) return refuse(403, OB.facilitatorOnly);
  if (!(await repo.personRow(conn, sessionId, forNo)).length) return refuse(400, OB.personNotHere);
  return done(forNo);
}

export async function recordFill(
  conn: PoolConnection,
  row: { sessionId: number; actorNo: number; personNo: number; target: OnBehalfTarget; targetId: number; act: "added" | "changed"; before?: Record<string, unknown> | null },
  now: Date,
): Promise<number> {
  return fills.insertFill(conn, { ...row, before: row.before ? JSON.stringify(row.before) : null, now });
}

/** The person changed it themselves: it is theirs now, and the room stops marking it. */
export async function keepFills(conn: PoolConnection, sessionId: number, target: OnBehalfTarget, targetId: number, personNo: number, now: Date): Promise<void> {
  await fills.keepFills(conn, sessionId, target, targetId, personNo, now);
}

export const fillKey = (target: OnBehalfTarget, targetId: number): string => `${target}:${targetId}`;

/** The latest fill-in still standing on each target (not undone, not made theirs since). */
export function standingFills(rows: readonly FillRec[]): Map<string, FillRec> {
  const out = new Map<string, FillRec>();
  for (const f of rows) {
    const key = fillKey(f.target, f.targetId);
    if (f.undone || f.kept) {
      // A later undone or kept row does not bring an earlier one back unless that one still stands.
      continue;
    }
    const prev = out.get(key);
    if (!prev || prev.id < f.id) out.set(key, f);
  }
  return out;
}

/** The latest row on the same target that is neither undone nor kept: the only one an undo may take back. */
export function latestStanding(rows: readonly FillRec[], f: Pick<FillRec, "target" | "targetId">): FillRec | null {
  return standingFills(rows).get(fillKey(f.target, f.targetId)) ?? null;
}

/** May this viewer undo this fill-in now: the person, or whoever filled it in, while the room is open. */
export const mayUndo = (f: Pick<FillRec, "personNo" | "actorNo">, viewerNo: number | null, open: boolean): boolean =>
  open && viewerNo != null && viewerNo > 0 && (f.personNo === viewerNo || f.actorNo === viewerNo);

export function filledInOut(f: FillRec, viewerNo: number | null, open: boolean): FilledIn {
  return { id: f.id, personUserId: f.personNo, act: f.act, canUndo: mayUndo(f, viewerNo, open) };
}

/**
 * Tell each person what was filled in for them, once per row, after the
 * write committed. Best effort: a failure is a log line and the row stays
 * unnoticed, so the next write in the room tries it again.
 */
export async function noticesAfterFills(
  pool: Pool,
  sessionId: number,
  deps: { notify(input: { userId: string; type: string; title: string; body?: string | null; link?: string | null; dedupeKey: string }): Promise<unknown> },
): Promise<void> {
  try {
    const rows = (await fills.unnoticedRows(pool, sessionId)).map(mapFill);
    if (!rows.length) return;
    const [srow] = await repo.sessionRow(pool, sessionId);
    const title = srow ? String(srow.title ?? "") : "";
    const userOf = new Map((await repo.memberUserIdRows(pool, rows.map((f) => f.personNo))).map((r) => [Number(r.no), String(r.user_id)]));
    const kinds = new Map<number, EntryKind>();
    if (rows.some((f) => f.target === "entry")) {
      for (const e of await repo.entryRows(pool, sessionId)) if (isEntryKind(e.kind)) kinds.set(Number(e.id), e.kind);
    }
    for (const f of rows) {
      const userId = userOf.get(f.personNo);
      if (userId) {
        await deps.notify({
          userId,
          type: "session_filled_in",
          title: ON_BEHALF_NOTICES.title(title, onBehalfWhat(f.target, f.act, kinds.get(f.targetId) ?? null), f.act),
          body: ON_BEHALF_NOTICES.body,
          link: `/sessions/${sessionId}`,
          dedupeKey: `session-filled-in:${f.id}`,
        });
      }
      await fills.markNoticed(pool, f.id, new Date());
    }
  } catch (e) {
    console.error(`[sessions] somebody was not told what was filled in for them in session ${sessionId}`, e);
  }
}
