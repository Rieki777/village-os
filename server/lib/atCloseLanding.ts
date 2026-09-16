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
import { executesAtPassWithNoWindow } from "../../shared/governanceKinds";
import { notifyRollRows, type RollNotice, type RollNoticeDeps } from "./ballotNotices";

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

// ── What a steward reads, and what the roll hears afterwards ───────────────

/**
 * THE VETO REFUSAL ON ONE OF THESE ROWS.
 *
 * Both shapes refuse a veto, and that part was right. The sentence was not. A
 * stalled row has no `lands_at`, so `recordVeto` and `vetoWindowOn` in
 * `server/lib/applyDue.ts` read "took effect the moment it carried" about a
 * decision that has not taken effect. A retrying `village_launch` carries the
 * instant this module wrote and the veto lock every no-window row is stamped
 * with, so it read the sentence about decisions on what a steward may stop,
 * which is about a different subject entirely.
 *
 * Decided from what `notYetInEffectSentence` reads, plus the clock, and from no
 * column of its own. A pending row with a failed attempt whose instant is still
 * AHEAD is a window the brake handed back (`reopenStalledWindow` leaves the
 * failed attempt open), and a steward may act inside it, so that row gets
 * nothing from here. The retrying sentence is also true of an ordinary landing
 * that failed in the job after its window shut, where the old refusal said it
 * had landed.
 */
export const VETO_REFUSED_NEEDS_A_PERSON =
  "This decision has not taken effect yet, and no steward can stop it. It was due to take effect the moment it carried, " +
  "so it never had a window. The step that carries it out stopped with an error, and it waits for a person to check " +
  "what took place and finish it.";

/** The refusal on a row the landing job is trying again, once its moment has passed. */
export const VETO_REFUSED_RETRYING =
  "This decision has not taken effect yet, and no steward can stop it now, because the moment it was due to take effect " +
  "has passed. The step that carries it out stopped with an error, and the landing job is trying it again.";

/** Which refusal a veto on this landing reads, or null when none of these shapes applies. */
export function notYetInEffectVetoRefusal(input: Parameters<typeof notYetInEffectSentence>[0], now: Date): string | null {
  const sentence = notYetInEffectSentence(input);
  if (sentence === NOT_YET_NEEDS_A_PERSON) return VETO_REFUSED_NEEDS_A_PERSON;
  if (sentence === NOT_YET_RETRYING && input.landsAt !== null && input.landsAt.getTime() <= now.getTime()) {
    return VETO_REFUSED_RETRYING;
  }
  return null;
}

/** The same refusal for a landing row. The newest attempt is read only when the row could be one of the shapes. */
export async function notYetInEffectVetoRefusalFor(pool: Pool, row: LandingRow, now: Date): Promise<string | null> {
  if (row.status !== "passed") return null;
  const stalledShape = row.landingStatus === "stalled" && row.landsAt === null;
  const retryingShape = row.landingStatus === "pending" && row.landsAt !== null && row.landsAt.getTime() <= now.getTime();
  if (!stalledShape && !retryingShape) return null;
  return notYetInEffectVetoRefusal(
    {
      status: row.status,
      landingStatus: row.landingStatus,
      landsAt: row.landsAt,
      newestAttempt: await newestAttemptOf(pool, row.ballotId),
    },
    now,
  );
}

/**
 * A ROW THE CLOSE PARKED, STILL WAITING FOR THE LANDING JOB.
 *
 * A no-window subject is stamped with no instant everywhere except
 * `queueFailedAtCloseLanding`, so a no-window row waiting as pending with an
 * instant and a failed attempt names exactly the rows whose close told the roll
 * "not yet in effect", and no ordinary landing. Read it BEFORE the job claims the
 * row: `openPending` adds an attempt with no error, and after that the failure
 * is no longer the newest attempt. `atCloseNotice.test.ts` pins that every subject
 * this module retries is a no-window subject, which keeps the pairing exact.
 */
export async function parkedAtCloseAndRetrying(pool: Pool, row: LandingRow): Promise<boolean> {
  if (!executesAtPassWithNoWindow(row.subjectType) || row.landingStatus !== "pending" || row.landsAt === null) return false;
  return (await notYetInEffectFor(pool, row)) === NOT_YET_RETRYING;
}

/** What the roll reads when a parked row finally takes effect. */
export const TOOK_EFFECT_BODY =
  "The vote carried earlier and the step that carries it out stopped with an error. It has now taken effect.";

/** The decision page, the same one `ballotLink` in `server/index.ts` names. */
const decisionLink = (b: { id: string }): string => `/decisions/${b.id}`;

/**
 * WHEN A PARKED ROW TAKES EFFECT, THE ROLL HEARS IT, ONCE.
 *
 * WHAT AN ORDINARY DELAYED LANDING DOES, read in `applyDueGovernance`: the job
 * announces nothing to the roll. The roll heard `ballot_carried` at the close,
 * and the closer's `execute` tells the proposer in its own words and writes its
 * own pulse line when it runs. `village_launch`'s executor does both on the retry
 * that works (`bal:<id>:launch-carried`, then "The village started its Game"),
 * so that path is reused as it stands.
 *
 * What a parked row still owes is the roll's `ballot_carried`, which the close
 * withheld because it was not true yet (`tellRollTheOutcome` in
 * `server/lib/ballotNotices.ts`). It is sent here at the moment it is true, as
 * the same kind, so the bell groups and celebrates it the way an ordinary close
 * would have. Keyed `took-effect` per member, apart from the close's `outcome`
 * key. Whoever the executor already told is skipped, as the close skips them. The
 * proposer is told even off the roll, with the roll's own key shape, so a
 * proposer on the roll gets one row. Never throws.
 */
export async function tellRollItTookEffect(
  deps: Pick<RollNoticeDeps, "pool" | "notify">,
  b: { id: string; title: string; openedBy?: string | null },
  proposerTold: string | null,
): Promise<number> {
  const rollDeps: RollNoticeDeps = { ...deps, link: decisionLink };
  const notifyRoll = (ballot: { id: string }, notice: RollNotice) => notifyRollRows(rollDeps, ballot, notice);
  const title = `Now in effect: ${b.title}`;
  const rung = await notifyRoll(b, {
    type: "ballot_carried",
    title,
    body: TOOK_EFFECT_BODY,
    keySuffix: "took-effect",
    except: [proposerTold],
  });
  if (!b.openedBy || b.openedBy === proposerTold) return rung;
  try {
    await deps.notify({
      userId: b.openedBy,
      type: "ballot_carried",
      title,
      body: TOOK_EFFECT_BODY,
      link: decisionLink(b),
      dedupeKey: `bal:${b.id}:took-effect:u${b.openedBy}`,
    });
  } catch (e) {
    console.error(`[governance] telling the proposer that ballot ${b.id} took effect failed (the landing stands)`, e);
  }
  return rung;
}
