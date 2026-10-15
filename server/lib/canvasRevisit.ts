/**
 * THE FOUR KEY MOMENTS, DELIVERED (plan section 4.2; Wave 4, 2026-09-28).
 *
 * shared/canvasRevisit.ts says what a moment is and what its notice says.
 * This file says who hears it, writes the rows, and holds the seam every call
 * site raises a moment through.
 *
 * ── WHO HEARS IT ───────────────────────────────────────────────────────────
 *
 * Three of the moments follow `story.tell`, the canvas prose pen, through the
 * ONE predicate this build has for "who may act on a power":
 * `whoMayPutHandToVillage` in shared/powerHands.ts, asked with the admins as
 * the scaffolding. So:
 *
 *   the village holds the power      every member the village has admitted,
 *                                    told "anyone may raise this"
 *   a role holds it, somebody seated its live holders, counted the way the
 *                                    gate counts (`liveHoldersOfCapability`,
 *                                    through the host's `liveHoldersOf`)
 *   neither, before the handover     the admins
 *
 * Conflict follows a ROLE: the care holder the exit policy names
 * (`restorative.intakeContactRole`), the same people a restorative intake
 * reaches (`liveIntakeRecipients`, server/lib/restorativeIntake.ts), and
 * nobody else. WHEN NOBODY HOLDS THE CARE ROLE the notice goes to the admins,
 * who are where an intake sends a member in the same case ("Write to the
 * stewards directly"). It never widens to the village: a conflict notice
 * reaching everybody would tell the whole village that something happened.
 * That fallback is a reading of the plan, which says "to the care holder
 * only" and does not say what happens when there is none.
 *
 * ── NOTHING IN A ROW BUT THE MOMENT AND THE BLOCK ──────────────────────────
 *
 * `canvasRevisitNotice` below is the one builder. It takes the moment, the
 * block, the moon, the recipient and the rule that chose them, and nothing
 * else: no trigger detail, no actor, no count. The trigger is known here only
 * to pick the moment, and it is dropped before a row is built.
 *
 * ── FIRE AND FORGET, AND WHY ───────────────────────────────────────────────
 *
 * `raiseCanvasRevisit` returns at once and delivers afterwards. A moment is a
 * trace of an act that already happened (a circle created, an exit opened),
 * and the act must never wait on, or fail because of, the notices that hang
 * off it. Reaching every member of a village that holds the pen is a row per
 * member per block, so it is not a thing a request should sit through either.
 * A delivery that throws is logged and the act stands.
 */
import type { Pool } from "mysql2/promise";
import type { EventInput } from "./events";
import { observeEvents } from "./events";
import type { NotifyInput, NotifyResult } from "./notify";
import { latestLifecycleMove } from "../repos/moduleEvents";
import { cycleBoundsFor } from "../../shared/lunar";
import { isVillageHeld } from "../../shared/capabilities";
import { whoMayPutHandToVillage } from "../../shared/powerHands";
import { LIFECYCLE_RANK, type ModuleLifecycle } from "../../shared/modules";
import type { CanvasBlockId } from "../../shared/governanceCanvas";
import {
  MOMENT_POWER,
  blocksForRaise,
  momentOfTrigger,
  revisitBody,
  revisitDedupeKey,
  revisitLink,
  revisitTitle,
  type KeyMoment,
  type MomentTrigger,
  type RevisitAudience,
} from "../../shared/canvasRevisit";

/** What delivery needs from the host. Every read is one the host already makes elsewhere. */
export interface CanvasRevisitDeps {
  /** The notification spine, bound to the host's deps. */
  notify(input: NotifyInput): Promise<NotifyResult>;
  /** The powers this village holds (`villageHeldCapabilities`). */
  villageHeld(): Promise<readonly string[]>;
  /** Who holds a power today, counted the way the gate counts. */
  liveHoldersOf(capability: string): Promise<string[]>;
  /** Every present member the village has admitted. */
  everyMember(): Promise<string[]>;
  /** Every admin and founder account, as `notifyAdmins` reaches them. */
  admins(): Promise<string[]>;
  /** The care role's live holders, or nobody when no care role is set or nobody holds it. */
  careHolders(): Promise<string[]>;
  now?(): Date;
}

/** One raise, as a call site makes it. */
export interface RevisitRequest {
  trigger: MomentTrigger;
  /** A narrower set of blocks than the moment's own. Never wider (`blocksForRaise`). */
  blocks?: readonly string[];
}

export interface RevisitResult {
  moment: KeyMoment;
  trigger: MomentTrigger;
  /** The absolute lunation number the rows are keyed to. */
  moon: number;
  audience: RevisitAudience;
  blocks: CanvasBlockId[];
  /** How many people the rule chose. */
  recipients: number;
  /** How many rows were written for the first time. A repeat in the same moon writes none. */
  fresh: number;
}

const unique = (ids: readonly string[]): string[] =>
  Array.from(new Set(ids.map(String).filter((id) => id !== "")));

/** Who hears this moment, and which of the rules chose them. */
export async function revisitAudience(
  deps: CanvasRevisitDeps,
  moment: KeyMoment,
): Promise<{ audience: RevisitAudience; userIds: string[] }> {
  const power = MOMENT_POWER[moment];
  if (power === "care") {
    const care = unique(await deps.careHolders());
    if (care.length) return { audience: "care-holders", userIds: care };
    return { audience: "admins", userIds: unique(await deps.admins()) };
  }
  const rule = whoMayPutHandToVillage(
    isVillageHeld(power, await deps.villageHeld()),
    await deps.liveHoldersOf(power),
    "admins",
  );
  if (rule.who === "any-member") return { audience: "every-member", userIds: unique(await deps.everyMember()) };
  if (rule.who === "live-holders") return { audience: "live-holders", userIds: unique(rule.holders) };
  return { audience: "admins", userIds: unique(await deps.admins()) };
}

/**
 * ONE ROW, WHOLE. The only builder of a `canvas_revisit` notification, and it
 * takes nothing a person wrote: the words are `revisitTitle` and `revisitBody`
 * in shared/canvasRevisit.ts, and there is no actor.
 */
export function canvasRevisitNotice(input: {
  moment: KeyMoment;
  block: CanvasBlockId;
  moon: number;
  userId: string;
  audience: RevisitAudience;
}): NotifyInput {
  return {
    userId: input.userId,
    type: "canvas_revisit",
    title: revisitTitle(input.moment, input.block),
    body: revisitBody(input.moment, input.audience),
    link: revisitLink(input.block),
    // Never an actor. The person whose act fired a conflict moment is exactly
    // who that notice must not name, and no moment needs one.
    actorUserId: null,
    dedupeKey: revisitDedupeKey(input.moment, input.block, input.moon, input.userId),
  };
}

/** The moon a raise at this instant is keyed to: the absolute lunation number. */
export function moonOf(at: Date): number {
  return cycleBoundsFor(at).cycleNumber;
}

/** Deliver one raise now, and say what it did. Throws only on a trigger this build does not know. */
export async function deliverCanvasRevisit(deps: CanvasRevisitDeps, req: RevisitRequest): Promise<RevisitResult> {
  const moment = momentOfTrigger(req.trigger);
  if (!moment) throw new Error(`"${String(req.trigger)}" is not a key moment this build knows`);
  const moon = moonOf(deps.now?.() ?? new Date());
  const blocks = blocksForRaise(moment, req.blocks);
  const { audience, userIds } = await revisitAudience(deps, moment);
  let fresh = 0;
  for (const userId of userIds) {
    for (const block of blocks) {
      const written = await deps.notify(canvasRevisitNotice({ moment, block, moon, userId, audience }));
      if (written.fresh) fresh += 1;
    }
  }
  return { moment, trigger: req.trigger, moon, audience, blocks, recipients: userIds.length, fresh };
}

// ── The seam every call site raises through ─────────────────────────────────

type Delivery = (req: RevisitRequest) => Promise<unknown>;

let delivery: Delivery | null = null;
const inFlight = new Set<Promise<void>>();

/**
 * The host hands over its delivery once, at boot (server/routes/canvasRevisit.ts).
 * Until it does, every raise is a no-op, so a lib that raises a moment works
 * the same in a unit test, a script and a server that never registered one.
 */
export function setCanvasRevisitDelivery(fn: Delivery | null): void {
  delivery = fn;
}

/**
 * Raise a key moment. Returns at once; the notices follow. Never throws, and
 * never tells the caller anything, because the act that raised it has already
 * happened and nothing here may undo or delay it.
 */
export function raiseCanvasRevisit(trigger: MomentTrigger, opts: { blocks?: readonly string[] } = {}): void {
  const send = delivery;
  if (!send) return;
  track(
    Promise.resolve().then(() => send({ trigger, blocks: opts.blocks })),
    `delivering "${trigger}" failed (the act that raised it stands)`,
  );
}

/**
 * Keep a piece of fire-and-forget work where `settleCanvasRevisits` can see
 * it, and log it if it fails. A step that raises another moment does so
 * before it leaves the set, so waiting for the set waits for the whole chain.
 */
function track(work: Promise<unknown>, failure: string): void {
  const p: Promise<void> = work
    .then(
      () => undefined,
      (e) => {
        console.error(`[canvas-revisit] ${failure}`, e);
      },
    )
    .finally(() => {
      inFlight.delete(p);
    });
  inFlight.add(p);
}

/** Wait for every raise already started to finish. For tests and for a graceful stop; never on a request. */
export async function settleCanvasRevisits(): Promise<void> {
  while (inFlight.size) await Promise.all(Array.from(inFlight));
}

// ── The call sites that need a word of translation ──────────────────────────

/**
 * WHICH RECORDED EVENTS ARE A KEY MOMENT.
 *
 * Four acts in `server/index.ts` already record an audit event, and the
 * moment hangs off the event (`observeEvents`, server/lib/events.ts) so those
 * routes gain no line. Each match is the event's own shape as the route
 * records it today. ONLY TWO ARE DRIVEN THROUGH THEIR REAL ROUTE: rewording
 * `bootstrap:founder` turns a case in server/canvasRevisit.routes.e2e.test.ts
 * red, and rewording `launch:proposed:` turns one in
 * server/launchVote.routes.e2e.test.ts red. The other two are pinned only by
 * hand-typed literals in ./canvasRevisit.test.ts, which model the route's
 * text and do not read it, so rewording either at its route (server/index.ts)
 * silently stops the moment while every test stays green:
 * `network:peer-added:` because no local peer can answer the handshake, and
 * `draft:accept:circle:` because no e2e case accepts a circle draft yet.
 *
 *   bootstrap:founder                 a founder claims a fresh instance
 *                                     (`bootstrap:break-glass`, a re-run on a
 *                                     claimed one, is not a claim)
 *   network:peer-added:<name>         a peer village added (NOT driven)
 *   draft:accept:circle:<id>          a circle accepted from a draft (NOT driven)
 *   launch:proposed:<ballot>          the Birthing vote opened
 */
export function triggerForEvent(e: Pick<EventInput, "kind" | "text" | "entityType">): MomentTrigger | null {
  if (e.kind !== "audit") return null;
  const text = String(e.text ?? "");
  if (text === "bootstrap:founder") return "instance-claimed";
  if (e.entityType === "peer" && text.startsWith("network:peer-added:")) return "peer-added";
  if (text.startsWith("draft:accept:circle:")) return "circle-declared";
  if (e.entityType === "launch" && text.startsWith("launch:proposed:")) return "birthing-opened";
  return null;
}

/** Start raising a moment for every event that is one. Returns the way to stop. */
export function observeKeyMoments(): () => void {
  return observeEvents((e) => {
    const trigger = triggerForEvent(e);
    if (trigger) raiseCanvasRevisit(trigger);
  });
}

/**
 * A module moved across the line that makes it a funding moment: governance
 * reaching members or wider from below, or the crowdpool leaving off. A move
 * that stays on one side (members to public, preview to preview) is not one.
 */
export function triggerForLifecycle(moduleId: string, from: string, to: string): MomentTrigger | null {
  const rank = (v: string): number => LIFECYCLE_RANK[v as ModuleLifecycle] ?? 0;
  if (moduleId === "governance" && rank(from) < LIFECYCLE_RANK.members && rank(to) >= LIFECYCLE_RANK.members) {
    return "governance-on";
  }
  if (moduleId === "crowdpool" && from === "off" && to !== "off") return "crowdpool-on";
  return null;
}

/**
 * For a caller that has just written a module's lifecycle and does not hold
 * where it stood before: read the move the write itself left in
 * `module_events` and raise the moment if it crossed. Fire and forget, like
 * every raise. Only governance and the crowdpool can be a moment, so every
 * other module costs nothing.
 */
export function raiseCanvasRevisitForLifecycle(pool: Pool, moduleId: string): void {
  if (moduleId !== "governance" && moduleId !== "crowdpool") return;
  // No delivery means no moment, so the read is not worth making.
  if (!delivery) return;
  track(
    latestLifecycleMove(pool, moduleId).then((move) => {
      const trigger = move ? triggerForLifecycle(moduleId, move.from, move.to) : null;
      if (trigger) raiseCanvasRevisit(trigger);
    }),
    `reading the lifecycle move of "${moduleId}" failed (the move stands)`,
  );
}

/**
 * An accepted submission that is a new partner: a Work With Us inquiry
 * accepted, or a Love Letter whose signer the village just admitted. A Love
 * Letter signed without an account admits nobody, so it is not a partner
 * arriving.
 */
export function triggerForSubmission(type: string, admitted: boolean): MomentTrigger | null {
  if (type === "work-with-us") return "partner-accepted";
  if (type === "membership-508" && admitted) return "love-letter-admitted";
  return null;
}

/** The submission-status route's one line: raise the partners moment when the accepted row is one. */
export function raiseCanvasRevisitForSubmission(type: string, admitted: boolean): void {
  const trigger = triggerForSubmission(type, admitted);
  if (trigger) raiseCanvasRevisit(trigger);
}
