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
 *   1b. A warning badge's deny on the power refuses anybody, the admin
 *      included, before and after launch (coordinator ruling, 2026-11-09). The
 *      general gate lets an admin past a deny on a key the village does not
 *      hold (Gate E: admin, then badge deny); this door narrows that for the
 *      powers it guards, because a deny on pay is a deliberate village act.
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
import { BREAK_GLASS_SEAT, isDeniable, isVillageHeld, type Capability, type CapabilityCtx } from "../../shared/capabilities";
import { launchedByVote as launchedByVoteOf } from "./orgDraftDecide";

/** Where a change goes when nobody may make it alone: the village, by an org draft. */
export const VOTE_PATH = "/api/org/drafts/:id/put-to-village";

export interface HolderDoorDeps {
  authedUser(req: any): Promise<any | null>;
  getPool(): Pool;
  guardCapability(req: any, res: any, cap: Capability, refusal?: { status: number; body: Record<string, unknown> }): Promise<boolean>;
  capabilityCtx(user: any): Promise<Pick<CapabilityCtx, "villageHeld" | "badgeDenies">>;
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

/**
 * Which door this person reaches the power through, for a page that says so.
 * Answers nothing. Null whenever `holderDoor` would refuse them, so a banner
 * never offers a door that is shut. The break-glass is left out on purpose: it
 * is an emergency act through the gate, written into the public record, and no
 * page should show it as a standing.
 */
export async function holderStanding(
  deps: Pick<HolderDoorDeps, "getPool" | "liveHoldersOf" | "launchedByVote" | "capabilityCtx">,
  user: { id: unknown; isAdmin?: boolean } | null,
  cap: Capability,
): Promise<HolderStanding> {
  if (!user) return null;
  const ctx = await deps.capabilityCtx(user);
  if (deniedBy(ctx, cap)) return null;
  if ((await deps.liveHoldersOf(cap)).includes(String(user.id))) return "holder";
  if (!user.isAdmin) return null;
  // On a key the village holds, the gate refuses an admin who is not a holder.
  if (isVillageHeld(cap, ctx.villageHeld)) return null;
  if (!(await launched(deps))) return "admin-before-launch";
  return (await deps.liveHoldersOf(BREAK_GLASS_SEAT)).length === 0 ? "admin-no-steward" : null;
}

/** Why the door refused, handed to a caller that answers in its own shape. */
export interface HolderRefusal {
  cap: Capability;
  /**
   * not-a-holder      a member with no standing, or an admin after launch with a steward holding the role;
   * denied            a warning badge's deny on the power, the admin included;
   * village-holds-it  the gate's refusal on a key the village holds (its 409, which may offer the break-glass).
   */
  reason: "not-a-holder" | "denied" | "village-holds-it";
  /** The status the door would answer with on its own. */
  status: number;
  /** The live holders of the power; empty means the village decides. */
  holders: readonly string[];
  /** The door's own answer (for village-holds-it, the gate's body, break-glass offer and all). */
  body: Record<string, unknown>;
}

export interface HolderDoorOptions {
  /**
   * Answer a refusal in the caller's own shape (Budgets: a 409 naming its
   * suggestion vote path). The decision and its order stay the door's; only
   * the response is the caller's. On village-holds-it the gate's own body
   * comes with it, so a caller can keep the break-glass offer it carries.
   */
  refuse?: (res: any, refusal: HolderRefusal) => void;
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

/** Whether a warning badge denies this power to the person. */
function deniedBy(ctx: Pick<CapabilityCtx, "badgeDenies">, cap: Capability): boolean {
  return isDeniable(cap) && (ctx.badgeDenies ?? []).includes(cap);
}

/** The refusal for a warning badge's deny, written once for every door. */
export function deniedBody(cap: Capability): Record<string, unknown> {
  return {
    error: "denied_by_warning_badge",
    capability: cap,
    message: "A warning badge stops you using this power for now. Ask whoever holds it, or put it to the village in an org draft.",
    votePath: VOTE_PATH,
  };
}

/** A response that only remembers what was sent, so the gate's answer can be read before it is passed on. */
function captured() {
  const out: { status: number; body: unknown; sent: boolean } = { status: 200, body: undefined, sent: false };
  const res: any = {
    status(code: number) {
      out.status = code;
      return res;
    },
    json(body: unknown) {
      out.body = body;
      out.sent = true;
      return res;
    },
  };
  return { res, out };
}

/**
 * May this request go through the door for `cap`. Answers the request when
 * the answer is no, the way `guardCapability` does, and the caller returns.
 */
export async function holderDoor(req: any, res: any, deps: HolderDoorDeps, cap: Capability, opts: HolderDoorOptions = {}): Promise<boolean> {
  const user = await deps.authedUser(req);
  if (!user) {
    res.status(401).json({ error: "auth_required" });
    return false;
  }
  const holders = (await deps.liveHoldersOf(cap)).filter((h) => h !== "");
  const ctx = await deps.capabilityCtx(user);
  const answer = (reason: HolderRefusal["reason"], status: number, body: Record<string, unknown>): false => {
    if (opts.refuse) opts.refuse(res, { cap, reason, status, holders, body });
    else res.status(status).json(body);
    return false;
  };
  // A deny on the power refuses anybody, the admin included, before the gate's
  // admin short-circuit can pass them (coordinator ruling, 2026-11-09).
  if (deniedBy(ctx, cap)) return answer("denied", 403, deniedBody(cap));
  const body = notAHolderBody(cap, holders);
  // The gate answers into a capture: its refusal for somebody with no standing
  // is this door's own body; anything else it wrote is the village-held 409.
  const gate = captured();
  if (!(await deps.guardCapability(req, gate.res, cap, { status: 403, body }))) {
    if (gate.out.body === body) return answer("not-a-holder", 403, body);
    return answer("village-holds-it", gate.out.status, gate.out.body as Record<string, unknown>);
  }
  if (holders.includes(String(user.id))) return true;
  if (isVillageHeld(cap, ctx.villageHeld)) return true;
  if (!(await launched(deps))) return true;
  if ((await deps.liveHoldersOf(BREAK_GLASS_SEAT)).length === 0) return true;
  return answer("not-a-holder", 403, body);
}
