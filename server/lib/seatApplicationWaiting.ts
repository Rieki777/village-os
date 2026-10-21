/**
 * WHAT WAITS ON A HOLDER: the task board's "Waiting on you" group, and the
 * one reminder (shared/waitingOnYou.ts holds the contract and the words).
 *
 * ── WHO AN APPLICATION WAITS ON ────────────────────────────────────────────
 *
 * `waitsOn` is `adoptRefusal` asked of every live holder, the very rule the
 * adopt route and the application page's button ask. So the board lists an
 * application exactly when its page would offer that holder "Align for the
 * village", and never to its own candidate.
 *
 * ── A FIXED NUMBER OF READS ────────────────────────────────────────────────
 *
 * The board reads the waiting applications once, their seats and circles
 * once, and the members once, however many rows come back. The drafts half
 * reads the open drafts with their changes (two statements) and their batches
 * (one). Nothing is read per row.
 *
 * ── ONE REMINDER, NEVER MORE ───────────────────────────────────────────────
 *
 * Forty eight hours after an application was written, a holder it still waits
 * on hears once more, in the bell only: the type has no email cadence in
 * server/lib/notify.ts. The dedupe key is per application and holder, so the
 * hourly job can run as often as it likes and the spine writes one row. A
 * holder who acted moved the application out of `awaiting-holder`, and the
 * job reads nothing else, so nobody is reminded of a decision already made.
 */
import type { Pool } from "mysql2/promise";
import type { HandOpenerRule } from "../../shared/powerHands";
import { whoMayPutHandToVillage } from "../../shared/powerHands";
import { isVillageHeld, type Capability } from "../../shared/capabilities";
import { ADOPTING_POWER, adoptRefusal, applicationHref } from "../../shared/seatApplications";
import { civilDateKey } from "../../shared/lunar";
import {
  draftAdds,
  REMINDER_AFTER_MS,
  REVIEW_QUEUE_HREF,
  structureReviewHref,
  WAITING_COPY,
  type WaitingApplication,
  type WaitingDraft,
} from "../../shared/waitingOnYou";
import { awaitingHolderApplications, seatsWithCircles, type StoredApplication } from "../repos/seatApplications";
import { batchIdsOf } from "../repos/externalProposals";
import { villageHeldCapabilities } from "./capabilityHolding";
import { listDrafts } from "./orgDrafts";
import type { NotifyInput } from "./notify";

/** The live holders who may adopt this application: every holder `adoptRefusal` lets through. */
export function waitsOn(rule: HandOpenerRule, a: Pick<StoredApplication, "candidateUserId">): string[] {
  if (rule.who !== "live-holders") return [];
  return rule.holders.filter((h) => adoptRefusal(rule, h, a.candidateUserId) === null);
}

export interface WaitingReadDeps {
  pool: Pool;
  /** Every member, read once: the first name on each row. */
  allMembers(): Promise<Array<{ id: string; name?: string | null }>>;
  firstName(name: string): string;
  timezone: string;
}

/** The applications waiting on `viewerId`, oldest first, in three reads. */
export async function applicationsWaitingOn(deps: WaitingReadDeps, rule: HandOpenerRule, viewerId: string): Promise<WaitingApplication[]> {
  // Not a holder: nothing waits on them, and nothing is read.
  if (rule.who !== "live-holders" || !rule.holders.includes(viewerId)) return [];
  const mine = (await awaitingHolderApplications(deps.pool)).filter((a) => waitsOn(rule, a).includes(viewerId));
  if (mine.length === 0) return [];
  const seats = await seatsWithCircles(deps.pool, Array.from(new Set(mine.flatMap((a) => a.seatIds))));
  const byId = new Map(seats.map((s) => [s.id, s]));
  const people = new Map((await deps.allMembers()).map((m) => [String(m.id), String(m.name ?? "")]));
  return mine.map((a) => {
    const here = a.seatIds.map((id) => byId.get(id));
    const circles: string[] = [];
    for (const s of here) if (s?.circle && !circles.includes(s.circle)) circles.push(s.circle);
    return {
      id: a.id,
      href: applicationHref(a.id),
      seats: a.seatIds.map((id, i) => here[i]?.name ?? id),
      circles,
      applicant: deps.firstName(people.get(a.candidateUserId) ?? ""),
      appliedOn: civilDateKey(a.createdAt, deps.timezone || "UTC"),
    };
  });
}

/**
 * The open drafts a submitted proposal made, for a reader who may publish
 * them. A draft somebody typed by hand is their own work in progress and
 * waits on nobody, so only drafts with a source proposal are listed.
 */
export async function draftsWaiting(pool: Pool): Promise<WaitingDraft[]> {
  const open = (await listDrafts(pool, { status: "open" })).filter((d) => !!d.sourceProposalId);
  if (open.length === 0) return [];
  const batches = await batchIdsOf(pool, open.map((d) => d.sourceProposalId as string));
  return open.map((d) => {
    const batch = batches.get(d.sourceProposalId as string);
    return { id: d.id, title: String(d.title ?? ""), ...draftAdds(d.changes), href: batch ? structureReviewHref(batch) : REVIEW_QUEUE_HREF };
  });
}

export interface ReminderDeps {
  pool: Pool;
  notify(input: NotifyInput): Promise<unknown>;
  liveHoldersOf(capability: string): Promise<string[]>;
}

/** Remind each holder an aged application still waits on, once. Answers how many reminders the spine was asked for. */
export async function remindWaitingHolders(deps: ReminderDeps): Promise<number> {
  const aged = await awaitingHolderApplications(deps.pool, REMINDER_AFTER_MS / 1000);
  if (aged.length === 0) return 0;
  const rule = whoMayPutHandToVillage(
    isVillageHeld(ADOPTING_POWER as Capability, await villageHeldCapabilities(deps.pool)),
    await deps.liveHoldersOf(ADOPTING_POWER),
  );
  const seats = await seatsWithCircles(deps.pool, Array.from(new Set(aged.flatMap((a) => a.seatIds))));
  const nameOf = new Map(seats.map((s) => [s.id, s.name]));
  let asked = 0;
  for (const a of aged) {
    for (const holder of waitsOn(rule, a)) {
      await deps.notify({
        userId: holder,
        type: "seat_application_reminder",
        title: WAITING_COPY.reminderTitle(a.seatIds.map((id) => nameOf.get(id) ?? id)),
        body: WAITING_COPY.reminderBody,
        link: applicationHref(a.id),
        actorUserId: null,
        dedupeKey: `sa:${a.id}:remind:${holder}`,
      });
      asked += 1;
    }
  }
  return asked;
}
