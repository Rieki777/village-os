/**
 * THE HOLDER'S DOOR: ONE ANSWER FOR A POWER, BEFORE AND AFTER LAUNCH
 * (coordinator ruling, 2026-11-09; the Saberra lane's budgets review, G-B3).
 *
 * `guardCapability` lets an admin through on any key the village has not taken
 * on, and it should: before launch the admin panel is the scaffolding a village
 * runs on. After the launch vote carries, that short-circuit became a second
 * answer to the same power. The pay doors (a role's pay, a quest's price, the
 * pricing desk) let a passing admin set pay that the Budgets door refused them,
 * so one power said yes and no at once. Every door for a power asks this check,
 * so the answers cannot drift apart again.
 *
 * The order, each step asked of the one thing that already answers it:
 *
 *   1. The gate (`guardCapability`) first, unchanged. A warning badge's deny, a
 *      key the village holds (the 409 that names the holder and offers the
 *      break-glass), and a member with no standing all meet the gate's refusal.
 *   2. A live holder of the power (`liveHoldersOf`: a role or a badge, admins
 *      left out) goes through.
 *   3. On a key the village holds, the only non-holder the gate passes is the
 *      founder-steward who broke the glass, which the gate records in public.
 *      Through.
 *   4. Anybody else the gate passed came by the admin short-circuit. Before the
 *      launch vote carries (`launchedByVote`), that is the panel's door, open as
 *      it always was. After it, the door is closed while a steward sits in the
 *      seat, the same rule as `adminDoorRefusal` (server/routes/stewardHandover.ts):
 *      a village with nobody in the steward's seat must still be able to run its
 *      own panel.
 *   5. Closed: a 403 that says who decides now, a holder or the village, and
 *      names the vote path, so nothing is a dead end (constitution 0.4).
 *
 * `holderStanding` asks the same question without a request, for the pages that
 * say which door the reader is using.
 */
import type { Pool } from "mysql2/promise";
import { BREAK_GLASS_SEAT, isVillageHeld, type Capability, type CapabilityCtx } from "../../shared/capabilities";
import { launchedByVote as launchedByVoteOf } from "./orgDraftDecide";

/** Where a change goes when nobody may make it alone: the village, by an org draft. */
export const VOTE_PATH = "/api/org/drafts/:id/put-to-village";

export interface HolderDoorDeps {
  authedUser(req: any): Promise<any | null>;
  getPool(): Pool;
  guardCapability(req: any, res: any, cap: Capability, refusal?: { status: number; body: Record<string, unknown> }): Promise<boolean>;
  capabilityCtx(user: any): Promise<Pick<CapabilityCtx, "villageHeld">>;
  liveHoldersOf(capability: string): Promise<string[]>;
  /** Whether the launch vote has carried. Defaults to `launchedByVote` on the pool. */
  launchedByVote?: () => Promise<boolean>;
}

/**
 * How this person reaches the power, or null when they do not.
 *   holder        a live holder, through a role or a badge;
 *   admin-before-launch  an admin, before the launch vote carries;
 *   admin-no-steward     an admin after launch, with nobody in the steward's seat.
 */
export type HolderStanding = "holder" | "admin-before-launch" | "admin-no-steward" | null;

const launched = (deps: Pick<HolderDoorDeps, "getPool" | "launchedByVote">): Promise<boolean> =>
  deps.launchedByVote ? deps.launchedByVote() : launchedByVoteOf(deps.getPool());

/** Which door this person reaches the power through, for a page that says so. Answers nothing. */
export async function holderStanding(
  deps: Pick<HolderDoorDeps, "getPool" | "liveHoldersOf" | "launchedByVote">,
  user: { id: unknown; isAdmin?: boolean } | null,
  cap: Capability,
): Promise<HolderStanding> {
  if (!user) return null;
  if ((await deps.liveHoldersOf(cap)).includes(String(user.id))) return "holder";
  if (!user.isAdmin) return null;
  if (!(await launched(deps))) return "admin-before-launch";
  return (await deps.liveHoldersOf(BREAK_GLASS_SEAT)).length === 0 ? "admin-no-steward" : null;
}

/** The refusal after launch, written once for every door. */
export function notAHolderBody(cap: Capability, holders: readonly string[]): Record<string, unknown> {
  const nobody = holders.length === 0;
  return {
    error: "not_a_holder",
    capability: cap,
    message: nobody
      ? "The launch vote has carried and nobody holds this power, so the village decides. Put it to the village in an org draft."
      : "The launch vote has carried, so this is for whoever holds the power now. Ask one of them, or put it to the village in an org draft.",
    ballotNeeded: nobody,
    votePath: VOTE_PATH,
  };
}

/**
 * May this request go through the door for `cap`. Answers the request when
 * the answer is no, the way `guardCapability` does, and the caller returns.
 */
export async function holderDoor(req: any, res: any, deps: HolderDoorDeps, cap: Capability): Promise<boolean> {
  const user = await deps.authedUser(req);
  if (!user) {
    res.status(401).json({ error: "auth_required" });
    return false;
  }
  const holders = (await deps.liveHoldersOf(cap)).filter((h) => h !== "");
  if (!(await deps.guardCapability(req, res, cap, { status: 403, body: notAHolderBody(cap, holders) }))) return false;
  if (holders.includes(String(user.id))) return true;
  if (isVillageHeld(cap, (await deps.capabilityCtx(user)).villageHeld)) return true;
  if (!(await launched(deps))) return true;
  if ((await deps.liveHoldersOf(BREAK_GLASS_SEAT)).length === 0) return true;
  res.status(403).json(notAHolderBody(cap, holders));
  return false;
}
