/**
 * RETIRING THE OLD DELIVERIES ONCE THE DIFFERENCES LIST HOLDS THEM (spec R28,
 * C9, US1.7).
 *
 * The review page lists the ways the outside service's chart and ours differ
 * now (shared/seraDifferences.ts). A delivery still waiting in the review
 * queue from before says the same things again, so once the newest read holds
 * every record a waiting delivery carries, that delivery is retired: each of
 * its waiting records is marked superseded with the reason "replaced by the
 * differences list", and stays in the history.
 *
 * WHEN. Inside the sync's own lock, after a landing, and never on a page load:
 * a read of the page writes nothing anywhere. Only `runLocked` in
 * server/lib/saberraSync.ts calls this, after the read is kept.
 *
 * WHAT IS LEFT ALONE.
 * - The delivery this landing made. The landing keeps running for one release,
 *   so a rollback to the release before still has a queue to work.
 * - A delivery the newest read does not hold whole: any record of a kind that
 *   is not a chart kind, any record whose page id the read did not read
 *   itself, and any delivery newer than the read (the fold rule PR B keeps on
 *   the page, `batchLinks`).
 * - A delivery somebody is working on: a record of it accepted into a draft
 *   that is still open, or a record of it decided in the last day.
 * - Every other module's deliveries.
 *
 * NEVER UN-RETIRED. The reason column is what `reopenSuperseded` refuses on,
 * so the same claim sent again never brings a retired record back.
 *
 * A retire that fails never stops the sync: it is said once in the log, and
 * the next landing tries again.
 */
import type { Pool } from "mysql2/promise";
import { STRUCTURE_KINDS } from "../../shared/structurePlan";
import { recordEvent } from "./events";
import { batchLinks, heldPageIdsOf } from "./seraDifferencesRead";
import { batchesInReview, retireWaitingBatch } from "../repos/externalProposals";
import { recentSnapshots } from "../repos/saberraSnapshots";
import { waitingFromModule } from "../repos/seraDifferences";

const MODULE_ID = "saberra";
/** The reason a retired record carries. */
export const RETIRED_REASON = "replaced by the differences list";
/** A delivery decided on within this long is somebody's review in progress. */
export const RECENT_REVIEW_HOURS = 24;

/** Retire the waiting deliveries the newest read holds whole, except `keep`. Answers the deliveries it retired. */
export async function retireReplacedBatches(pool: Pool, keep: string | null, now: Date = new Date()): Promise<string[]> {
  const [newest] = await recentSnapshots(pool, 1);
  if (!newest) return [];
  const waiting = await waitingFromModule(pool, MODULE_ID);
  if (waiting.length === 0) return [];
  // A delivery holding anything that is not a chart kind keeps its cards: notes are read there.
  const chartKinds: readonly string[] = STRUCTURE_KINDS;
  const notChart = new Set(waiting.filter((w) => !chartKinds.includes(w.kind)).map((w) => w.batchId));
  const { held } = batchLinks([], waiting, heldPageIdsOf(newest.snapshot), newest.snapshot.takenAt);
  const candidates = held.filter((b) => b !== keep && !notChart.has(b));
  if (candidates.length === 0) return [];
  const busy = await batchesInReview(pool, MODULE_ID, candidates, Math.floor(now.getTime() / 1000) - RECENT_REVIEW_HOURS * 3600);
  const retired: string[] = [];
  for (const batchId of candidates) {
    if (busy.has(batchId)) continue;
    const n = await retireWaitingBatch(pool, { moduleId: MODULE_ID, batchId, reason: RETIRED_REASON });
    if (n === 0) continue;
    retired.push(batchId);
    void recordEvent(pool, {
      kind: "external_proposal",
      text: `a waiting delivery was retired: the differences list holds every record in it (${n} record(s))`,
      actorKind: "agent",
      originModuleId: MODULE_ID,
      entityType: "external_proposal_batch",
      entityRef: batchId,
      audience: "admin",
    });
  }
  return retired;
}
