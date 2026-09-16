/**
 * A DECISION THAT SHOULD TAKE EFFECT AT THE CLOSE, AND DID NOT.
 *
 * ── THE DEFECT THIS CLOSES ─────────────────────────────────────────────────
 *
 * `routeOutcome` in `server/lib/applyDue.ts` runs a closer's `execute` inside
 * the close for the two shapes `landingFor` executes at close: a no-window
 * subject (`village_launch`, rule 1) and a token send chosen at acceptance
 * (rule 2). It used to annotate the executor-pending attempt and RETHROW. The
 * human close route has no catch around that call, so the member who closed
 * the vote was answered with a 500 after the vote had already closed. The
 * ballot sat at `passed` with `landing_status = 'not_applicable'` and no
 * `lands_at`, which `dueBallotIds` never selects, so nothing tried again, and
 * nothing a member could read said the decision had not happened.
 *
 * ── WHAT HAPPENS NOW ───────────────────────────────────────────────────────
 *
 * A failed at-close landing never throws out of the close. The vote result
 * stands, the error stays on the attempt row, and the ballot is parked in ONE
 * of two shapes:
 *
 *   RETRYING  `landing_status = 'pending'`, `lands_at` = the moment it failed.
 *             The five-minute landing job (`applyDueGovernance`) selects it on
 *             its next tick and runs `execute` through its own claim, its own
 *             brake and its own write-off. There is no second retry path.
 *
 *   STALLED   `landing_status = 'stalled'`, `lands_at` left NULL. Every
 *             selector the landing job has (`dueBallotIds`, the reopen path
 *             inside it, `expiryCandidates`) requires `lands_at IS NOT NULL`,
 *             so no job ever runs this row again. A person acts.
 *
 * `lands_at` NULL is also what tells this stall apart from the brake's stall,
 * which always carries an instant and whose window the job hands back once.
 *
 * ── WHICH SHAPE, DECIDED FROM WHAT THE EXECUTOR ACTUALLY DOES ──────────────
 *
 * Only a subject whose at-close executor has been READ and found safe to run
 * twice is retried. The list is by subject type and ABSENCE STALLS, so an
 * at-close executor a later lane adds waits for a person until somebody reads
 * it and adds it here.
 *
 *   `village_launch`: SAFE TO RUN TWICE. Its closer in `server/index.ts` moves
 *   no value. `recordGameStart` is an INSERT IGNORE on `app_config['game-start']`
 *   read straight back, and `recordLaunchCarried` is a JSON_SET guarded on
 *   `launchedAt` being absent, so a second run leaves the first instant and the
 *   first ballot. Both notices and the admin bell in its held branch carry a
 *   dedupe key on the ballot, so a second send is a no-op. The pulse line comes
 *   after every write that can throw, and the audit event after it is not
 *   awaited, so a throw that reaches the landing path happened before either.
 *
 *   A token send at acceptance: NOT SAFE, so it stalls. No executor for one
 *   exists in this build. `token_send`, `quest_payout` and `founding_allocation`
 *   have no `SUBJECT_CLOSERS` entry, so a binding ballot on one is refused at
 *   open (`noCloserRefusal`), and `token_send` is outside
 *   `EXECUTABLE_ITEM_KINDS`, so a mechanics set holding one is refused at
 *   validation. There is no code to read, so nothing can be shown safe.
 *   `postTransfer` treats a replayed idempotency key as the money having moved
 *   once, and that only protects a retry whose executor derives the same key on
 *   both runs, which is a property of an executor nobody has written yet. A send
 *   that may have posted is the one case where a retry costs value.
 *
 * ── WHERE THE FAILURE IS SEEN ──────────────────────────────────────────────
 *
 * The attempt row keeps the error and stays open. The failed-actions report
 * (`wt/failed-actions`, PR #247) lists a ballot whose NEWEST attempt recorded an
 * error while `landing_status` is `pending` or `stalled`, so both shapes appear
 * there without that report knowing this module exists.
 *
 * A member reads `notYetInEffectSentence` on the decision page, through
 * `GET /api/governance/ballots/:id/landing`. The raw error is deliberately not
 * in that sentence: it can carry a database message, and that route answers
 * anybody who can open the decision. The error is for the person who fixes it.
 */
import type { Pool } from "mysql2/promise";
import type { LandingRow } from "../repos/ballotLandings";
import { newestAttemptOf } from "../repos/governanceExecutorPending";

/** Subjects whose at-close executor has been read and is safe to run twice. */
export const AT_CLOSE_RETRY_SAFE_SUBJECTS: ReadonlySet<string> = new Set(["village_launch"]);

export type AtCloseFailureShape = "retrying" | "stalled";

/** Which shape a failed at-close landing of this subject is parked in. Absent stalls. */
export function atCloseFailureShape(subjectType: string): AtCloseFailureShape {
  return AT_CLOSE_RETRY_SAFE_SUBJECTS.has(String(subjectType ?? "").trim().toLowerCase()) ? "retrying" : "stalled";
}

/** What a member reads while the landing job is trying again. */
export const NOT_YET_RETRYING =
  "The vote carried and the decision has not taken effect yet. The step that carries it out stopped with an error, " +
  "so the landing job tries it again every few minutes while automatic landing is on, until it takes effect.";

/** What a member reads when trying again by itself could repeat something that already happened. */
export const NOT_YET_NEEDS_A_PERSON =
  "The vote carried and the decision has not taken effect yet. The step that carries it out stopped with an error, " +
  "and running it again by itself could repeat something that already happened, such as a token send. " +
  "It waits for a person to check what took place and finish it.";

/** The sentence for a landing, from the columns that already hold the answer. Null when nothing failed. */
export function notYetInEffectSentence(input: {
  status: string;
  landingStatus: string;
  landsAt: Date | null;
  newestAttempt: { lastError: string | null; cleared: boolean } | null;
}): string | null {
  if (input.status !== "passed") return null;
  const a = input.newestAttempt;
  if (!a || a.cleared || a.lastError === null) return null;
  if (input.landingStatus === "stalled" && input.landsAt === null) return NOT_YET_NEEDS_A_PERSON;
  if (input.landingStatus === "pending") return NOT_YET_RETRYING;
  return null;
}

/** The same sentence, reading the newest attempt for the row. */
export async function notYetInEffectFor(pool: Pool, row: LandingRow): Promise<string | null> {
  return notYetInEffectSentence({
    status: row.status,
    landingStatus: row.landingStatus,
    landsAt: row.landsAt,
    newestAttempt: await newestAttemptOf(pool, row.ballotId),
  });
}
