/**
 * Live Sessions: a circle's decisions and their review dates. The store is
 * server/repos/sessionDecisions.ts; the doors are server/routes/sessionDecisions.ts;
 * the shapes, rules and words are shared/sessionDecisions.ts.
 *
 *   circleDecisionLog   a circle's decisions, newest first, with their reviews
 *   setReview           give a decision a review date, change it, or take it off
 *   runDecisionReviews  the reviews that have come become agenda items (job)
 *
 * ── WHO ──────────────────────────────────────────────────────────────────
 *
 * The circle's members by standing, and admins, read its log and set review
 * dates (`mayKeepRhythm`, the rule a circle's rhythm keeps). A session's
 * title travels only to somebody who was in it, or an admin; a decision's
 * words are the circle's agreement, and its members read them.
 *
 * ── A REVIEW BECOMES AN AGENDA ITEM ──────────────────────────────────────
 *
 * When a review date has come, the job makes "Review: <the decision>" an item
 * waiting for the circle (server/lib/sessionLibrary.ts `itemFromTension`, which
 * makes any sourced item), its source the decision and that date (0279), so
 * each review cycle is its own item and none is made twice. It is added by
 * nobody in particular: it is the circle's, and stays when the member who set
 * the date leaves. The decision's record is never written to.
 */
import type { Pool, PoolConnection } from "mysql2/promise";
import * as store from "../repos/sessionDecisions";
import * as room from "../repos/liveSessions";
import * as libraryStore from "../repos/sessionLibrary";
import { ensureMemberNo, memberNo, type Outcome, type Refusal } from "./liveSessions";
import { TensionSentAlready, itemFromTension, libraryViewer } from "./sessionLibrary";
import { villageTimezone } from "./villageReaders";
import { effectiveLifecycle } from "./modules";
import type { LapseContext } from "./orgChart";
import { LIFECYCLE_RANK, type ModuleLifecycle } from "../../shared/modules";
import { mayKeepRhythm, villageKey } from "../../shared/sessionRhythm";
import { DECISION_LIMITS, DECISION_REFUSALS, cleanReviewOn, reviewItemText, type CircleDecision, type CircleDecisionLog } from "../../shared/sessionDecisions";

const refuse = (status: number, error: string): Refusal => ({ ok: false, status, error });
const done = <T>(value: T): Outcome<T> => ({ ok: true, value });

const asDate = (v: unknown): Date => (v instanceof Date ? v : new Date(String(v)));

export interface DecisionDeps {
  circles: () => { id: string; name: string }[];
  lapseContext?: () => LapseContext;
}

export interface DecisionAsker {
  userId: string;
  admin: boolean;
}

/** May this asker keep this circle's decisions: its members by standing, and admins. */
async function keeper(pool: Pool, who: DecisionAsker, circleId: string, deps: DecisionDeps): Promise<{ no: number | null; may: boolean }> {
  const no = await memberNo(pool, who.userId);
  const lib = await libraryViewer(pool, { userId: who.userId, no, admin: who.admin }, deps);
  return { no, may: mayKeepRhythm(circleId, lib) };
}

function asDecision(
  row: Record<string, unknown>,
  review: Record<string, unknown> | undefined,
  readable: boolean,
  today: string,
  zone: string,
): CircleDecision {
  const on = review ? String(review.review_on) : null;
  return {
    entryId: Number(row.id),
    text: String(row.text ?? ""),
    decidedOn: villageKey(asDate(row.closed_at), zone),
    session: readable ? { id: Number(row.session_id), title: String(row.title ?? "") } : null,
    review: on ? { on, due: on <= today, brought: review!.library_id != null } : null,
  };
}

/**
 * A circle's decisions, newest first, each with its review. Refused in this
 * order: a circle that is not a live one (404), an asker who is not one of its
 * members or an admin (403).
 */
export async function circleDecisionLog(pool: Pool, who: DecisionAsker, circleId: string, deps: DecisionDeps, now = new Date()): Promise<Outcome<CircleDecisionLog>> {
  if (!deps.circles().some((c) => c.id === circleId)) return refuse(404, DECISION_REFUSALS.circleUnknown);
  const { no, may } = await keeper(pool, who, circleId, deps);
  if (!may) return refuse(403, DECISION_REFUSALS.notYours);
  const zone = villageTimezone();
  const today = villageKey(now, zone);
  const rows = await store.decisionRows(pool, circleId, DECISION_LIMITS.logSize);
  const reviews = new Map((await store.reviewRows(pool, rows.map((r) => Number(r.id)))).map((r) => [Number(r.entry_id), r] as const));
  const sessionIds = Array.from(new Set(rows.map((r) => Number(r.session_id))));
  const joined = new Set(who.admin || no == null ? [] : (await room.joinedRows(pool, no, sessionIds)).map((r) => Number(r.session_id)));
  return done({
    circleId,
    decisions: rows.map((r) => asDecision(r, reviews.get(Number(r.id)), who.admin || joined.has(Number(r.session_id)), today, zone)),
    canSetReview: true,
    today,
  });
}

/**
 * Give one of a circle's decisions a review date, change it, or take it off
 * (`reviewOn: null`). A new date starts a new cycle. Refused in this order: a
 * circle that is not a live one (404), an asker who may not keep it (403), a
 * decision that is not one of its decided ones (404), a date that does not
 * read, has passed or is too far ahead (400).
 */
export async function setReview(
  pool: Pool,
  who: DecisionAsker,
  circleId: string,
  entryId: number,
  raw: unknown,
  deps: DecisionDeps,
  now = new Date(),
): Promise<Outcome<{ decision: CircleDecision }>> {
  if (!deps.circles().some((c) => c.id === circleId)) return refuse(404, DECISION_REFUSALS.circleUnknown);
  const { no, may } = await keeper(pool, who, circleId, deps);
  if (!may) return refuse(403, DECISION_REFUSALS.notYours);
  const [decision] = Number.isInteger(entryId) && entryId > 0 ? await store.decisionRow(pool, entryId) : [];
  if (!decision || String(decision.circle_id) !== circleId) return refuse(404, DECISION_REFUSALS.notFound);
  const zone = villageTimezone();
  const today = villageKey(now, zone);
  const input = cleanReviewOn(raw, today);
  if (!input.ok) return refuse(400, input.error);
  if (input.value == null) await store.deleteReview(pool, entryId);
  else await store.putReview(pool, { entryId, reviewOn: input.value, setByNo: no ?? (await ensureMemberNo(pool, who.userId, now)), now });
  const log = await circleDecisionLog(pool, who, circleId, deps, now);
  const found = log.ok ? log.value.decisions.find((d) => d.entryId === entryId) : undefined;
  if (!found) throw new Error("live sessions: a decision just reviewed could not be read back");
  return done({ decision: found });
}

/** The job's name and pace: hourly, so a review that has come is on the agenda items the same day. */
export const DECISION_REVIEW_JOB = "session-decision-reviews";
export const DECISION_REVIEW_EVERY_MS = 60 * 60 * 1000;

/**
 * Every review that has come and is not yet an agenda item becomes one,
 * waiting for its circle. A decision of a circle that is no longer live
 * waits; nothing runs before the module is open to members.
 */
export async function runDecisionReviews(deps: DecisionDeps & { getPool: () => Pool; lifecycle?: () => string }, now = new Date()): Promise<string> {
  const lifecycle = deps.lifecycle ?? (() => effectiveLifecycle("sessions"));
  if ((LIFECYCLE_RANK[lifecycle() as ModuleLifecycle] ?? 0) < LIFECYCLE_RANK.members) return "the sessions module is not open to members";
  const pool = deps.getPool();
  const live = new Map(deps.circles().map((c) => [c.id, c]));
  const today = villageKey(now, villageTimezone());
  let made = 0;
  for (const due of await store.dueRows(pool, today)) {
    const circle = due.circle_id == null ? undefined : live.get(String(due.circle_id));
    if (!circle) continue;
    const entryId = Number(due.entry_id);
    const reviewOn = String(due.review_on);
    const ref = `${entryId}:${reviewOn}`;
    try {
      await room.inTransaction(pool, async (conn: PoolConnection): Promise<Outcome<null>> => {
        const id = await itemFromTension(conn, {
          circleId: circle.id,
          text: reviewItemText(String(due.text ?? "")),
          broughtByNo: 0,
          origin: { kind: "decision_review", ref, label: circle.name },
          now,
        });
        // Made already in an earlier run that did not get as far as marking it: mark the one there is.
        const libraryId = id ?? Number((await libraryStore.sourceByRef(conn, "decision_review", ref))[0]?.library_id ?? 0);
        if (libraryId > 0 && (await store.markBrought(conn, entryId, reviewOn, libraryId, now))) made += id != null ? 1 : 0;
        return done(null);
      });
    } catch (e) {
      if (e instanceof TensionSentAlready) continue;
      throw e;
    }
  }
  return `${made} decision review(s) on the agenda items`;
}

// ── The member's own ────────────────────────────────────────────────────────

/** The review dates a member set last, for the export. */
export async function exportReviewsFor(pool: Pool, no: number): Promise<Record<string, unknown>[]> {
  return (await store.memberRows(pool, no)).map((r) => ({ entryId: Number(r.entry_id), reviewOn: String(r.review_on), setAt: asDate(r.updated_at).toISOString() }));
}

/** The member leaves, inside the erasure's transaction. */
export async function forgetReviewsFor(conn: PoolConnection, no: number): Promise<void> {
  await store.forgetMember(conn, no);
}
