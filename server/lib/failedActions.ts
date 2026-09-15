/**
 * THE FAILED-ACTIONS JOB: what is failing in this village, since when, and what
 * to do about it.
 *
 * ── THE RULING ────────────────────────────────────────────────────────────────
 *
 * Rye, 2026-09-14: "all failed actions should have a single job that reruns
 * failed actions and creates a report for us to know why things are failing
 * and what needs to be fixed for us to act on."
 *
 * Before this, most failures were recorded nowhere, or where nobody reads them.
 * This job reads each of those places every hour, keeps one row per thing that
 * is failing in `failed_action_items` (migration 0207), and the admin tab
 * "What's Failing" reads that table.
 *
 * ── WHAT IT RERUNS, AND WHY IT IS ONE THING ─────────────────────────────────
 *
 * It reruns an account deletion that stopped AFTER the account was closed, and
 * nothing else. The plan was reviewed adversarially before it was built, and
 * every other candidate had a specific reason to stay a report:
 *
 *  - A deletion that stopped BEFORE the tombstone step leaves an account that
 *    still works, and somebody may be using it. Finishing it unattended could
 *    wipe an account in use, so a steward decides at /review.
 *  - A payment, a seat fee or a governance landing changes what somebody holds
 *    or may do. Each is already retried by its own mechanism or is a human
 *    act, and a second automatic path would race the first.
 *  - Re-asking an outside store stays the /review button's job, pressed by a
 *    person who can read what the store answered.
 *
 * After the tombstone, all a sweep has left is its audit line and the request
 * to every outside store to delete what it holds. Neither touches a loan, a
 * stay, an order or a balance, so the retry waits on none of those. An earlier
 * version held a deletion while the member's account showed a debt, which
 * protected nothing and kept outside stores holding a departed member's data for
 * as long as a dispute stayed open. The retry spaces its attempts out, claims
 * each sweep before running it so a steward's press is never run twice at once,
 * and stops after ten.
 *
 * ── EVERY SENTENCE WAS CHECKED AGAINST THE CODE ─────────────────────────────
 *
 * Each `advice` tells a founder where to go and what will happen. Before this
 * shipped, every one was checked against the code that settles it, and eleven
 * were wrong as first written: a "Payments tab" that shows no payments, an
 * "apply it again" with no route behind it, a relay that only runs when a dial
 * is on. A sentence here is a promise about another file, and no compiler
 * reads it, so a change to the page or the mechanism it names has to change it.
 *
 * ── WHAT IT KEEPS, AND FOR HOW LONG ─────────────────────────────────────────
 *
 * A key or a title never carries a member id, a name, an email or an inbox id.
 * The erasure sweep does not scrub `failed_action_items`, so an item naming a
 * departed member would outlive their erasure. Deletions are reported as
 * counts, the rule server/routes/erasureQueue.ts already keeps.
 *
 * `last_error` is different: it copies what the failing system recorded, and a
 * vendor's error or a thrown message can say anything. So it is kept only while
 * the item is open, when the table it was copied from holds the same text, and
 * it is scrubbed of addresses and member ids on the way in. It is cleared the
 * moment the item clears, and a cleared item is deleted after thirty days.
 *
 * ── HOW IT TELLS PEOPLE ──────────────────────────────────────────────────────
 *
 * At most one notice a day, to admins and founders, and only when something is
 * new or a week has passed since the last notice. A notice stamps EVERY open
 * item it covers, new and standing alike, so the reminders of failures first
 * seen on different days fall due together: stamping only the new ones gave
 * each its own reminder day, and a standing list sent a notice every day. The
 * first run on a village records silently, so thirteen villages deploying this
 * do not each notify every admin about every standing failure on one morning.
 * A finding can ask for quiet hours, counted from when it began failing and kept
 * on its row, so a feed that fails once overnight does not become a notice.
 *
 * Failures that cannot wait already alert on their own: `reportError` for a job
 * that threw, the payment sweeps for money behind a stuck purchase. This is the
 * one place that gathers the rest.
 *
 * ── ONE RUN AT A TIME, AND ITS OWN TROUBLE SAID ALOUD ───────────────────────
 *
 * A named database lock (server/repos/namedLock.ts) makes a second run return at
 * once. Each run stops reading after four minutes, and the retry gets at most
 * ninety seconds of those, so a slow retry cannot starve every area. An area a
 * run did not reach keeps its items exactly as they were, and a run that ran out
 * of time says so as an item of its own, so a half-read list never looks current.
 */
import type { Pool } from "mysql2/promise";

import { NO_MEMBER_SECRETS_KEY } from "./agentInbox";
import { resumeErasure, type ErasureDeps } from "./erasure";
import { keysFor as seatChargeLedgerKeys } from "./eventSeats";
import { isExampleUser } from "./examples";
import { feedbackIsShared } from "./feedback";
import { memberSecretsConfigured } from "./memberSecrets";
import { registeredJobs, TICK_MS } from "./scheduler";
import { halfErasedMembers } from "./subjectRefs";
import { landingStatusesFor } from "../repos/ballotLandings";
import {
  forgetResolvedBefore,
  itemCount,
  markNotified,
  noticeDay,
  openItems,
  reconcileSource,
  type Finding,
} from "../repos/failedActionItems";
import {
  droppedDeliveries,
  failedCalendars,
  failedSynthesisRecordings,
  failingIntegrations,
  keptSeatChargesBefore,
  ledgerKeysPresent,
  paymentRefusalCounts,
  recentQuarantines,
  scheduledJobRows,
  troubledPeers,
  unhealedSettleErrors,
  unrelayedFeedbackCount,
  type FailedCalendarRow,
  type FailingIntegrationRow,
  type KeptSeatChargeRow,
  type QuarantineEventRow,
  type ScheduledJobRow,
  type SettleErrorGroup,
  type TroubledPeerRow,
} from "../repos/failureSources";
import { stuckLandings, type StuckLanding } from "../repos/governanceExecutorPending";
import { claimResume, countUnfinishedErasures, unfinishedErasuresWithAge } from "../repos/memberErasure";
import { withNamedLock } from "../repos/namedLock";

export const FAILED_ACTIONS_JOB = "failed-actions";
export const FAILED_ACTIONS_EVERY_MS = 60 * 60 * 1000;
export const GIVE_UP_AFTER_ATTEMPTS = 10;
export const RUN_BUDGET_MS = 4 * 60 * 1000;
export const RETRY_BUDGET_MS = 90 * 1000;
const MAX_RESUMES_PER_RUN = 20;
const ERASURE_ROWS_READ = 1000;
const SETTLE_ORDERS_READ = 200;
const SEAT_FEE_PAGE = 200;
const SEAT_FEE_PAGES = 50;
const REMIND_AFTER_SECONDS = 7 * 24 * 60 * 60;
const UNREADABLE_QUIET_HOURS = 3;
const KEEP_CLEARED_DAYS = 30;
/** A landing attempt that has recorded no error gets this long before it counts as stuck. */
const LANDING_GRACE_MS = 10 * 60 * 1000;
/**
 * The landing statuses under which an unfinished attempt is still owed.
 * `not_applicable` is a decision that took effect when its vote closed, which
 * nothing tries again. A decision that landed, was vetoed or was written off is
 * governance's own record, and no longer this report's.
 */
const LANDING_STILL_OWED: ReadonlySet<string> = new Set(["not_applicable", "pending", "applying", "stalled"]);

/** The source that holds this report's own trouble: an area it could not read, or a run out of time. */
export const REPORT_SOURCE = "report";

/** A finding, as a source reports it. */
export type ReportFinding = Finding;

/** One place a failure is recorded. */
export interface FailureSource {
  key: string;
  find(): Promise<ReportFinding[]>;
}

/** What each area is called on the tab. */
export const SOURCE_LABELS: Readonly<Record<string, string>> = {
  erasures: "Account deletions",
  "erasure-stores": "Deletions waiting on outside services",
  jobs: "Scheduled jobs",
  governance: "Decisions taking effect",
  payments: "Payments",
  integrations: "Connections",
  quarantine: "Startup checks",
  peers: "Linked villages",
  calendars: "Calendar feeds",
  feedback: "Feedback relay",
  agents: "Members' agents",
  synthesis: "Recording summaries",
  "seat-fees": "Seat fees",
  [REPORT_SOURCE]: "This report",
};

export const labelFor = (source: string): string => SOURCE_LABELS[source] ?? source;

/**
 * What this report cannot see yet, said on the tab instead of hidden. An empty
 * report next to an unlisted blind spot reads as "nothing is wrong", which is
 * the failure this whole job exists to end.
 */
export const BLIND_SPOTS: readonly string[] = [
  "Emails that fail to send. Nothing records whether a send worked, so a failed one cannot show up here yet.",
  "Notifications and activity records that fail to save. Those go to the server log only.",
  "Web push notifications. Nothing sends them yet, so there is nothing to fail.",
  "A scheduled job that catches its own errors. It tells the scheduler it succeeded, so only its own alerts say anything.",
  "A card payment whose confirmation from Stripe never arrived. The hourly stay, product and exchange sweeps cancel that checkout as abandoned without an alert, so Stripe's own dashboard is the only place it shows.",
  "A purchase marked paid that never delivered. The hourly sweeps alert only about pending purchases with money already behind them, and only inside the app.",
  "This tab itself. If the scheduler is switched off, nothing here updates, and the tab says so when it can tell.",
];

const plural = (n: number, one: string, many: string): string => (n === 1 ? one : many);

const messageOf = (e: unknown): string => String((e as Error)?.message ?? e).slice(0, 500);

/** A duration a founder reads: "3 days", "5 hours", "20 minutes". */
export function readableDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const days = Math.floor(s / 86400);
  if (days >= 1) return `${days} ${plural(days, "day", "days")}`;
  const hours = Math.floor(s / 3600);
  if (hours >= 1) return `${hours} ${plural(hours, "hour", "hours")}`;
  const minutes = Math.max(1, Math.floor(s / 60));
  return `${minutes} ${plural(minutes, "minute", "minutes")}`;
}

/** What follows "every": "hour", "day", "6 hours". Never "every 1 hour". */
export function cadencePhrase(seconds: number): string {
  if (seconds === 60 * 60) return "hour";
  if (seconds === 24 * 60 * 60) return "day";
  return readableDuration(seconds);
}

// ── Account deletions ───────────────────────────────────────────────────────

export interface ErasureRowForReport {
  userId: string;
  attempts: number;
  stepsDone: readonly string[];
  failedStep: string | null;
  sinceLastAttemptSeconds: number | null;
  /** Seconds since the deletion first began, by the database's clock. */
  sinceStartSeconds?: number | null;
}

export type ErasureStanding = "running" | "before-close" | "after-close" | "needs-a-person";

/** A sweep with no failing step whose last attempt began this recently may still be going. */
const MAY_STILL_BE_RUNNING_SECONDS = 10 * 60;

/**
 * Where an unfinished deletion stands. The tombstone step is what closes the
 * account.
 *
 * `running` is a sweep that may still be going: it has recorded no failing
 * step, and its last attempt began under ten minutes ago. A sweep takes
 * seconds, so the hourly report meeting one mid-way is rare, and reporting it
 * as stopped or resuming it beside itself would both be wrong. It is neither.
 */
export function erasureStanding(r: ErasureRowForReport): ErasureStanding {
  const recent = r.sinceLastAttemptSeconds != null && r.sinceLastAttemptSeconds < MAY_STILL_BE_RUNNING_SECONDS;
  if (r.failedStep == null && recent) return "running";
  if (!r.stepsDone.includes("tombstone")) return "before-close";
  if (r.attempts >= GIVE_UP_AFTER_ATTEMPTS || r.failedStep === "load-member") return "needs-a-person";
  return "after-close";
}

/** Two hours after the first attempt, doubling, never more than a day apart. */
export function erasureBackoffSeconds(attempts: number): number {
  return Math.min(24, 2 ** Math.max(1, Math.trunc(attempts))) * 60 * 60;
}

/** Only a closed account, only below the attempt cap, and only once its wait is over. */
export function mayResumeUnattended(r: ErasureRowForReport): boolean {
  if (erasureStanding(r) !== "after-close") return false;
  return r.sinceLastAttemptSeconds == null || r.sinceLastAttemptSeconds >= erasureBackoffSeconds(r.attempts);
}

/** How long the oldest of these deletions has been going, when the rows say. */
const oldestStart = (rows: readonly ErasureRowForReport[]): number =>
  rows.reduce((oldest, r) => Math.max(oldest, r.sinceStartSeconds ?? 0), 0);

function stepTally(rows: readonly ErasureRowForReport[]): string {
  const counts = new Map<string, number>();
  for (const r of rows) {
    const step = r.failedStep ? `stopped at ${r.failedStep}` : "stopped without recording a step";
    counts.set(step, (counts.get(step) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([step, n]) => `${step} (${n})`)
    .join(", ");
}

/**
 * Counts only. A finding here never carries anything that identifies a person.
 * `total` is the database's count, so a village past the rows read is told so
 * instead of being handed the page size as its number.
 */
export function erasureFindings(rows: readonly ErasureRowForReport[], total: number = rows.length): ReportFinding[] {
  const by: Record<ErasureStanding, ErasureRowForReport[]> = {
    running: [],
    "before-close": [],
    "after-close": [],
    "needs-a-person": [],
  };
  for (const r of rows) by[erasureStanding(r)].push(r);
  const out: ReportFinding[] = [];
  const before = by["before-close"].length;
  if (before > 0) {
    out.push({
      key: "before-close",
      title: `${before} account ${plural(before, "deletion", "deletions")} stopped before the account was closed`,
      advice:
        "These accounts still work, so nothing finishes them on its own. Whoever works the review queue (/review) sees where they stopped and presses Finish them.",
      lastError: stepTally(by["before-close"]),
      failingForSeconds: oldestStart(by["before-close"]),
    });
  }
  const after = by["after-close"].length;
  if (after > 0) {
    out.push({
      key: "after-close",
      title: `${after} closed ${plural(after, "account still has", "accounts still have")} records waiting to be removed`,
      advice: "This job finishes these on its own, a few hours apart. The review queue (/review) shows the step each one stops at.",
      lastError: stepTally(by["after-close"]),
      failingForSeconds: oldestStart(by["after-close"]),
      quietHours: 24,
    });
  }
  const stuck = by["needs-a-person"].length;
  if (stuck > 0) {
    out.push({
      key: "needs-a-person",
      title: `${stuck} account ${plural(stuck, "deletion needs", "deletions need")} a person`,
      advice:
        "Automatic retries have stopped, after ten attempts or because the account's record is missing. Pressing Finish them on the review queue (/review) tries once more. A missing record needs whoever maintains the village's database.",
      lastError: stepTally(by["needs-a-person"]),
      failingForSeconds: oldestStart(by["needs-a-person"]),
    });
  }
  if (total > rows.length) {
    out.push({
      key: "unread",
      title: `${total} account deletions are unfinished, and this report read the oldest ${rows.length}`,
      advice: "The counts above cover only those. The review queue (/review) counts every one.",
    });
  }
  return out;
}

/**
 * Finish closed-account deletions that stopped part way.
 *
 * Only a row `mayResumeUnattended` allows, never an example account, and only
 * once `claimResume` has taken the row, so a sweep a steward pressed moments ago
 * is left to that press.
 */
export async function resumeClosedErasures(
  pool: Pool,
  erasureDeps: ErasureDeps,
  deadline: number,
  now: () => number = Date.now,
): Promise<string | null> {
  const rows = await unfinishedErasuresWithAge(pool, ERASURE_ROWS_READ);
  let resumed = 0;
  let finished = 0;
  for (const r of rows) {
    if (resumed >= MAX_RESUMES_PER_RUN || now() > deadline) break;
    if (!mayResumeUnattended(r)) continue;
    // resumeErasure refuses an example account too, but without recording the
    // refusal, so without this check the job would ask again every hour.
    if (isExampleUser(await erasureDeps.members.byId(r.userId))) continue;
    if (!(await claimResume(pool, r.userId, erasureBackoffSeconds(r.attempts)))) continue;
    resumed += 1;
    try {
      if ((await resumeErasure(pool, r.userId, erasureDeps)).finished) finished += 1;
    } catch {
      // resumeErasure has already recorded the failing step and what it said.
    }
  }
  return resumed === 0 ? null : `resumed ${resumed} closed ${plural(resumed, "deletion", "deletions")}, ${finished} finished`;
}

// ── Scheduled jobs ──────────────────────────────────────────────────────────

/**
 * A job whose last run threw, and a job that has not run within twice its own
 * cadence plus a tick. A job with no run at all is overdue only once this
 * process has been up long enough to have given it a turn.
 */
export function jobFindings(
  rows: readonly ScheduledJobRow[],
  registered: ReadonlyArray<{ name: string; everyMs: number }>,
  uptimeSeconds: number,
): ReportFinding[] {
  const byName = new Map(rows.map((r) => [r.job, r] as const));
  const out: ReportFinding[] = [];
  for (const job of registered) {
    if (job.name === FAILED_ACTIONS_JOB) continue;
    const row = byName.get(job.name);
    if (row?.lastResult?.startsWith("FAILED:")) {
      out.push({
        key: `${job.name}:failed`,
        title: `The ${job.name} job failed on its last run`,
        advice:
          "Admins and founders got a notice with the error when it first failed. The job tries again on its own schedule, and this clears when a run succeeds.",
        lastError: row.lastResult,
      });
    }
    const allowedSeconds = (2 * job.everyMs + TICK_MS) / 1000;
    const since = row?.sinceLastRunSeconds ?? null;
    const overdue = since == null ? uptimeSeconds > allowedSeconds : since > allowedSeconds;
    if (overdue) {
      out.push({
        key: `${job.name}:overdue`,
        title: since == null ? `The ${job.name} job has never run` : `The ${job.name} job has not run for ${readableDuration(since)}`,
        advice: `It should run every ${cadencePhrase(job.everyMs / 1000)}. The scheduler may be switched off with SCHEDULER_ENABLED, or the server may be restarting before the job gets a turn. The server log says which: every start prints a [scheduler] line.`,
      });
    }
  }
  return out;
}

// ── Governance ──────────────────────────────────────────────────────────────

/** Only attempts whose decision is still owed a landing. See `LANDING_STILL_OWED`. */
export function stillOwedLandings(rows: readonly StuckLanding[], statuses: ReadonlyMap<string, string>): StuckLanding[] {
  return rows.filter((r) => LANDING_STILL_OWED.has(statuses.get(r.ballotId) ?? ""));
}

export function landingFindings(rows: readonly StuckLanding[]): ReportFinding[] {
  return rows.map((r) => ({
    key: r.ballotId,
    title: `A decision the village carried started taking effect and did not finish (ballot ${r.ballotId})`,
    advice:
      "A decision set to take effect later is tried again by the landing job every few minutes while automatic landing is on, until it lands or is written off. One that took effect the moment its vote closed is never tried again, and no button in the admin panel reapplies it, so it needs whoever maintains the village's code or database. Check first whether the change is already in place: a server that stopped just after making it leaves this record open too.",
    lastError:
      r.lastError ?? "The attempt stopped without writing an error, which usually means the server restarted part way through it.",
  }));
}

// ── Payments ────────────────────────────────────────────────────────────────

/**
 * One finding per order that did not settle, and one for every failure that
 * named no order. Six quiet hours from the first error, because Stripe
 * redelivers a failed event for a few days.
 */
export function settleFindings(groups: readonly SettleErrorGroup[], more = false): ReportFinding[] {
  const out: ReportFinding[] = [];
  const orderless: SettleErrorGroup[] = [];
  for (const g of groups) {
    if (g.module == null || g.orderId == null) {
      orderless.push(g);
      continue;
    }
    out.push({
      key: `${g.module}:${g.orderId}`,
      title: `A payment for ${g.module} order ${g.orderId} did not settle`,
      advice:
        "Stripe redelivers a failed payment for a few days, and this clears when a delivery settles. If it stays, look the order up in Stripe: somebody may have paid for something they have not received. It leaves this list 30 days after its last failed delivery, fixed or not.",
      lastError: g.latestDetail,
      failingForSeconds: g.oldestAgeSeconds,
      quietHours: 6,
    });
  }
  if (orderless.length > 0) {
    const errors = orderless.reduce((n, g) => n + g.errors, 0);
    out.push({
      key: "no-order",
      title: `${errors} payment ${plural(errors, "delivery", "deliveries")} that named no order failed to settle in the last 30 days`,
      advice:
        "Renewals, refunds and disputes are logged without their order, so nothing here can tell when one of them later went through. Look each one up in Stripe by its date. This leaves the list 30 days after the last one.",
      lastError: orderless.map((g) => g.latestDetail).find((detail) => detail != null) ?? null,
      failingForSeconds: orderless.reduce((oldest, g) => Math.max(oldest, g.oldestAgeSeconds), 0),
      quietHours: 6,
    });
  }
  if (more) {
    out.push({
      key: "unread",
      title: `More orders failed to settle than this report reads, so it listed the oldest ${groups.length}`,
      advice: "Newer ones exist and are not listed here. The Stripe dashboard lists every payment by date.",
    });
  }
  return out;
}

/** Counts only. A signature failure needs three in a day, because strangers probe webhooks. */
export function refusalFindings(counts: Readonly<Record<string, number>>): ReportFinding[] {
  const out: ReportFinding[] = [];
  const sig = counts.sig_fail ?? 0;
  if (sig >= 3) {
    out.push({
      key: "sig_fail",
      title: `${sig} payment ${plural(sig, "delivery", "deliveries")} in the last day had a signature that did not match`,
      advice:
        "If these came from Stripe, the webhook signing secret on the Integrations tab is missing or does not match the one Stripe holds. A few from unknown senders are harmless and need nothing.",
    });
  }
  const noHandler = counts.no_handler ?? 0;
  if (noHandler >= 1) {
    out.push({
      key: "no_handler",
      title: `${noHandler} ${plural(noHandler, "payment", "payments")} in the last day named a module that cannot settle ${plural(noHandler, "it", "them")}`,
      advice:
        "This village's own checkouts always name a module that can settle them, so these most likely came from something else using the same Stripe account, or were renewals for a module that does not renew. Look each one up in Stripe.",
    });
  }
  const noOrder = counts.no_order ?? 0;
  if (noOrder >= 1) {
    out.push({
      key: "no_order",
      title: `${noOrder} ${plural(noOrder, "payment or refund", "payments or refunds")} in the last day matched nothing this village sold`,
      advice:
        "They named no module this village recognizes, or a refund or dispute named a charge it has no record of. If the Stripe account is shared with another site, they may belong there. Otherwise look each one up in Stripe.",
    });
  }
  return out;
}

// ── Everything else ─────────────────────────────────────────────────────────

export function integrationFindings(rows: readonly FailingIntegrationRow[]): ReportFinding[] {
  return rows.map((r) => ({
    key: `${r.moduleId}:${r.operation}`,
    title: `The ${r.moduleId} connection has failed ${r.consecutiveFailures} times in a row (${r.operation})`,
    advice: "Check this connection's card on the Integrations tab, and whether the service itself is up. This clears once a call to it succeeds.",
    lastError: [r.status, r.detail].filter(Boolean).join(": ") || null,
  }));
}

/**
 * Two kinds of startup check write the same event. One switches a module off;
 * the other finds rows that grant nothing and switches nothing off. Each is
 * titled for what it did, from the entity the event names.
 *
 * KEYED ON WHAT WAS CHECKED, NEVER ON THE EVENT. Every boot writes a new event,
 * so an event-keyed item cleared and reopened as new on each restart while the
 * module stayed switched off, and sent a fresh notice about it.
 *
 * THE EVENT'S TEXT IS NEVER COPIED. It quotes every line the check printed, and
 * a check that repairs rows on its way prints whose they were: the library's
 * orphan-loan repair names the member. The server log from that start holds the
 * same lines, so a fixed sentence pointing there loses the admin nothing.
 */
export function quarantineFindings(rows: readonly QuarantineEventRow[]): ReportFinding[] {
  const whereToLook = "The server log from this start names the rows the check found.";
  const out: ReportFinding[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    const key = `${r.entityType ?? "check"}:${r.entityRef ?? "unnamed"}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(
      r.entityType === "module"
        ? {
            key,
            title: "A module was switched off when the village started",
            advice: `Its own records did not add up, so it was turned off and the rest of the village kept running. ${whereToLook} Once the records are mended, restart the village and the module comes back on its own.`,
            lastError: `Module: ${r.entityRef ?? "not named"}`,
          }
        : {
            key,
            title: "A startup check found records that do not add up",
            advice: `The village kept serving, because these records grant nothing on their own. ${whereToLook} Mend those records and restart the village to clear this.`,
            lastError: `Check: ${r.entityRef ?? "not named"}`,
          },
    );
  }
  return out;
}

export function peerFindings(rows: readonly TroubledPeerRow[]): ReportFinding[] {
  return rows.map((r) =>
    r.status === "paused"
      ? {
          key: r.id,
          title: `The link to ${r.name} is paused`,
          advice:
            "The other village answered with a different identity or signing key, so the link stopped until a person trusts the change. An admin or founder opens Village Network (/network) and presses accept & resume.",
          lastError: r.lastError,
        }
      : {
          key: r.id,
          title: `${r.name} has not synced for ${readableDuration(r.sinceSyncSeconds)}`,
          advice: "The other village may be down, or its address may have changed. Village Network (/network) shows the last error.",
          lastError: r.lastError,
          failingForSeconds: r.sinceSyncSeconds,
          quietHours: 24,
        },
  );
}

/**
 * A feed's name is typed by an admin and can be anything, a person's name
 * included. So it rides in `last_error`, which is cleared the run the feed
 * recovers, and never in the title, which is kept for thirty days after.
 */
export function calendarFindings(rows: readonly FailedCalendarRow[]): ReportFinding[] {
  return rows.map((r) => ({
    key: r.id,
    title: "A calendar feed is failing",
    advice:
      "Open Calendars from elsewhere on the Calendar tab, where the error from the last fetch is shown. A wrong address cannot be edited: remove the feed and add it again.",
    lastError: `${r.name}: ${r.lastError ?? "the last fetch failed without saying why"}`,
    quietHours: 24,
  }));
}

/**
 * Fees marked kept whose transfer to the treasury never landed: each is still
 * in escrow. `checkedBeforeStopping` is set when the paging cap stopped the read,
 * so the tab says how far it looked.
 */
export function seatFeeFindings(stranded: readonly KeptSeatChargeRow[], checkedBeforeStopping: number | null = null): ReportFinding[] {
  const out: ReportFinding[] = stranded.map((r) => ({
    key: r.id,
    title: `A seat fee of ${r.amount} ${r.tokenType} was marked kept and never moved to the treasury`,
    failingForSeconds: r.settledAgeSeconds,
    advice:
      "Settlement marks a fee kept before it moves the fee to the treasury, and that move did not happen, so the fee is still held in escrow. Nothing in the admin panel can post it, so it needs whoever maintains the village's code or database.",
  }));
  if (checkedBeforeStopping != null) {
    out.push({
      key: "unread",
      title: `This report checked the newest ${checkedBeforeStopping} kept seat fees and stopped there`,
      advice: "Older kept fees were not checked this run. A fee whose transfer fails is found on the next run, while it is still among the newest.",
    });
  }
  return out;
}

const counted = (n: number, finding: (n: number) => ReportFinding): ReportFinding[] => (n > 0 ? [finding(n)] : []);

/** Every area the report reads, in the order the tab shows them. */
export function defaultSources(pool: Pool, now: () => number = Date.now): FailureSource[] {
  return [
    {
      key: "erasures",
      find: async () => erasureFindings(await unfinishedErasuresWithAge(pool, ERASURE_ROWS_READ), await countUnfinishedErasures(pool)),
    },
    {
      key: "erasure-stores",
      find: async () => {
        const half = await halfErasedMembers(pool);
        return counted(half.count, (n) => ({
          key: "waiting",
          title: `${n} departed ${plural(n, "member is", "members are")} still waiting on an outside service to confirm a deletion`,
          advice:
            "An outside service has not confirmed it deleted what it held about them. Whoever works the review queue (/review) presses Ask again.",
          lastError:
            Object.entries(half.waitingOn)
              .map(([module, count]) => `${module} (${count})`)
              .join(", ") || null,
        }));
      },
    },
    { key: "jobs", find: async () => jobFindings(await scheduledJobRows(pool), registeredJobs(), process.uptime()) },
    {
      key: "governance",
      find: async () => {
        const stuck = await stuckLandings(pool, new Date(now() - LANDING_GRACE_MS));
        return landingFindings(stillOwedLandings(stuck, await landingStatusesFor(pool, stuck.map((r) => r.ballotId))));
      },
    },
    {
      key: "payments",
      find: async () => {
        const settle = await unhealedSettleErrors(pool, 30, SETTLE_ORDERS_READ);
        return [...settleFindings(settle.groups, settle.more), ...refusalFindings(await paymentRefusalCounts(pool, 24))];
      },
    },
    { key: "integrations", find: async () => integrationFindings(await failingIntegrations(pool, 3)) },
    { key: "quarantine", find: async () => quarantineFindings(await recentQuarantines(pool, Math.ceil(process.uptime()) + 60)) },
    { key: "peers", find: async () => peerFindings(await troubledPeers(pool, 48)) },
    { key: "calendars", find: async () => calendarFindings(await failedCalendars(pool)) },
    {
      // Only while the relay is meant to run. With the dial off, feedback that
      // stays home is the village's choice, and nothing is failing.
      key: "feedback",
      find: async () =>
        feedbackIsShared()
          ? counted(await unrelayedFeedbackCount(pool, 24), (n) => ({
              key: "unrelayed",
              title: `${n} feedback ${plural(n, "item has", "items have")} not reached the hub for over a day`,
              advice:
                "The hub may be down, or FEEDBACK_HUB_URL may point at the wrong address, which must be a public https one. The relay tries every 15 minutes, so they send on their own once the hub answers.",
            }))
          : [],
    },
    {
      // Only while the key is still missing. Once it is set, the drops already
      // counted are history, and a report of them would outlive the fix by a month.
      key: "agents",
      find: async () =>
        memberSecretsConfigured()
          ? []
          : counted(await droppedDeliveries(pool, NO_MEMBER_SECRETS_KEY, 30), (n) => ({
              key: "no-secrets-key",
              title: `${n} ${plural(n, "delivery", "deliveries")} to members' agents ${plural(n, "was", "were")} dropped in the last 30 days, and this deployment still has no member-secrets key`,
              advice:
                "Set MEMBER_SECRETS_KEY for this deployment, as docs/FORK_RUNBOOK.md describes. Until then members' agents receive nothing. Dropped deliveries are not sent again, and a member whose inbox switched itself off saves its address again to turn it back on.",
            })),
    },
    {
      key: "synthesis",
      find: async () =>
        counted(await failedSynthesisRecordings(pool, 7), (n) => ({
          key: "failed",
          title: `${n} ${plural(n, "recording", "recordings")} failed to get a summary in the last week and still ${plural(n, "has", "have")} none`,
          advice:
            "They are not tried again on their own. Check the Anthropic key on the Integrations tab, then open each recording on the Calls tab and press Synthesize.",
        })),
    },
    {
      // Newest first, page by page, until a short page or the cap. See
      // `keptSeatChargesBefore` for why a single capped read went blind.
      key: "seat-fees",
      find: async () => {
        const stranded: KeptSeatChargeRow[] = [];
        let before: string | null = null;
        let checked = 0;
        for (let page = 0; page < SEAT_FEE_PAGES; page += 1) {
          const rows = await keptSeatChargesBefore(pool, before, SEAT_FEE_PAGE);
          checked += rows.length;
          const landed = await ledgerKeysPresent(pool, rows.map((r) => seatChargeLedgerKeys(r).keep));
          for (const r of rows) if (!landed.has(seatChargeLedgerKeys(r).keep)) stranded.push(r);
          if (rows.length < SEAT_FEE_PAGE) return seatFeeFindings(stranded);
          before = rows[rows.length - 1].id;
        }
        return seatFeeFindings(stranded, checked);
      },
    },
  ];
}

// ── The run ─────────────────────────────────────────────────────────────────

export interface RunDeps {
  pool: Pool;
  sources: readonly FailureSource[];
  /** Work this job may redo without a person. Each returns a sentence for the summary, or null. */
  retries: ReadonlyArray<(deadline: number) => Promise<string | null>>;
  notifyAdmins(type: string, title: string, dedupeKey: string, link?: string): Promise<void>;
  /** True the first time this job runs on a village. Defaults to `firstRunHere`. */
  isFirstRun?: () => Promise<boolean>;
  now?: () => number;
}

/**
 * The first run on a village: nothing has ever been recorded, AND the scheduler
 * has never written a result for this job. Both, so a run that crashed after
 * recording some items is not mistaken for a first one on the next try and
 * silently swallowed a second time.
 */
export async function firstRunHere(pool: Pool): Promise<boolean> {
  if ((await itemCount(pool)) > 0) return false;
  const row = (await scheduledJobRows(pool)).find((r) => r.job === FAILED_ACTIONS_JOB);
  return !row || row.lastResult == null;
}

/** The notice's one line: what is new, and how much is failing in all. */
export function noticeTitle(fresh: number, all: number): string {
  const each = plural(all, "it", "each");
  if (fresh === 0) return `${all} ${plural(all, "thing is", "things are")} still failing in the village. The report says what to do about ${each}.`;
  if (fresh >= all) return `${all} ${plural(all, "thing is", "things are")} failing in the village. The report says what to do about ${each}.`;
  return `${fresh} new ${plural(fresh, "failure", "failures")} in the village, ${all} in all. The report says what to do about each.`;
}

/**
 * Tell the admins, when there is something to tell: an item past its quiet
 * hours that no notice has carried this episode, or a week since the last
 * notice about something still failing.
 */
async function tellAdmins(deps: RunDeps, firstRun: boolean): Promise<string | null> {
  const open = await openItems(deps.pool);
  if (open.length === 0) return null;
  if (firstRun) {
    await markNotified(deps.pool, open);
    return `first run: ${open.length} recorded without a notice`;
  }
  // Today by the database's clock, the clock `notified_at` is stamped with, so
  // the day a notice is filed under is the day it is checked against.
  const today = await noticeDay(deps.pool);
  if (today.alreadySent) return null;
  const covered = open.filter((item) => item.ageSeconds >= item.quietSeconds);
  const fresh = covered.filter((item) => !item.toldThisEpisode);
  const reminderDue = covered.some((item) => item.toldThisEpisode && (item.notifiedAgeSeconds ?? 0) >= REMIND_AFTER_SECONDS);
  if (fresh.length === 0 && !reminderDue) return null;
  await deps.notifyAdmins("failed_action", noticeTitle(fresh.length, covered.length), `failed-actions:${today.day}`, "/admin?tab=failures");
  // Every item the notice covers is stamped, new and standing alike, so all of
  // their reminders fall due together a week from today.
  await markNotified(deps.pool, covered);
  return `told the admins: ${fresh.length} new, ${covered.length} in all`;
}

/**
 * One run: redo what may be redone, read every area, record what is failing,
 * and tell the admins when there is something new to tell.
 *
 * An area that cannot be read becomes a finding of its own under
 * `REPORT_SOURCE`, and its earlier items are left exactly as they were: an
 * unreadable area is not a fixed one. An area never reached because the run ran
 * out of time keeps its items, keeps whatever this report said about it before,
 * and the run adds an item saying which areas it did not reach.
 */
export async function runFailedActions(deps: RunDeps): Promise<string> {
  const now = deps.now ?? Date.now;
  const outcome = await withNamedLock(deps.pool, FAILED_ACTIONS_JOB, async () => {
    const deadline = now() + RUN_BUDGET_MS;
    const firstRun = await (deps.isFirstRun ?? (() => firstRunHere(deps.pool)))();
    const notes: string[] = [];

    const retryDeadline = Math.min(deadline, now() + RETRY_BUDGET_MS);
    for (const retry of deps.retries) {
      if (now() > retryDeadline) break;
      try {
        const note = await retry(retryDeadline);
        if (note) notes.push(note);
      } catch (e) {
        notes.push(`a retry failed: ${messageOf(e)}`);
      }
    }

    const unreadable: ReportFinding[] = [];
    const unreached: string[] = [];
    let read = 0;
    let failing = 0;
    for (const source of deps.sources) {
      if (now() > deadline) {
        unreached.push(source.key);
        continue;
      }
      let findings: ReportFinding[];
      try {
        findings = await source.find();
      } catch (e) {
        unreadable.push({
          key: source.key,
          title: `This report could not read ${labelFor(source.key).toLowerCase()}`,
          advice: "Whatever it listed for this area before stays listed until it can read the area again. The error below says why.",
          lastError: messageOf(e),
          quietHours: UNREADABLE_QUIET_HOURS,
        });
        continue;
      }
      read += 1;
      failing += findings.length;
      await reconcileSource(deps.pool, source.key, findings);
    }

    // What this report says about itself. An area never reached keeps its
    // "could not read" item from before, carried forward unchanged, so running
    // out of time never closes one as though the area had been read.
    const carried: ReportFinding[] =
      unreached.length === 0
        ? []
        : (await openItems(deps.pool))
            .filter((item) => item.source === REPORT_SOURCE && unreached.includes(item.key))
            .map((item) => ({
              key: item.key,
              title: item.title,
              advice: item.advice,
              lastError: item.lastError,
              quietHours: item.quietSeconds / (60 * 60),
            }));
    const outOfTime: ReportFinding[] =
      unreached.length === 0
        ? []
        : [
            {
              key: "out-of-time",
              title: `This report ran out of time before reading ${unreached.length} of ${deps.sources.length} areas`,
              advice:
                "The areas it did not reach keep what they listed before, so parts of this list may be out of date. If this keeps happening, something the report reads has become slow, and the server log's [scheduler] line for failed-actions says how long each run took.",
              lastError: `Not reached: ${unreached.map((key) => labelFor(key)).join(", ")}`,
              quietHours: UNREADABLE_QUIET_HOURS,
            },
          ];
    await reconcileSource(deps.pool, REPORT_SOURCE, [...unreadable, ...carried, ...outOfTime]);
    if (unreached.length > 0) {
      notes.push(`stopped after ${deps.sources.length - unreached.length} of ${deps.sources.length} areas, out of time`);
    }

    const told = await tellAdmins(deps, firstRun);
    if (told) notes.push(told);
    const forgotten = await forgetResolvedBefore(deps.pool, KEEP_CLEARED_DAYS);
    if (forgotten > 0) notes.push(`forgot ${forgotten} cleared ${plural(forgotten, "item", "items")}`);
    return [`${read} ${plural(read, "area", "areas")} read, ${failing} ${plural(failing, "thing", "things")} failing`, ...notes].join("; ");
  });
  return outcome.ran ? outcome.value : "skipped: another run holds the lock";
}
