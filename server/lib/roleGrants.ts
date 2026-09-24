/**
 * WHAT AN ADMIN ROUTE MAY DO TO A ROLE, AND THE ONE POWER IT MAY NOT TOUCH.
 *
 * Two rules live here, and they are here rather than inline in server/index.ts
 * for two different reasons.
 *
 * ── RULE ONE: THE STEWARD'S SEAT IS THE VILLAGE'S, NOT THE PANEL'S ─────────
 *
 * The adversarial audit of 2026-09-03 opened with this. Once the steward is a
 * veto rather than an approval, the veto is the ONLY human brake on a Game
 * change the village carried. That brake lives on the roles plane, and the
 * roles plane has an admin path: `POST /api/admin/roles/:id/holders` seats
 * people and `PUT /api/admin/roles/:id/capabilities` decides what a role can
 * do. Any admin may make another admin. So one account could seat itself as
 * steward, unseat the elected one, and veto whatever it liked, with a record
 * that reads as ordinary administration.
 *
 * The fix is not a bigger warning. It is that `steward.veto` is UNGRANTABLE
 * and UNREMOVABLE by any admin route, admin path included, in both directions:
 *
 *   - a role that carries the key cannot have anybody seated into it or taken
 *     out of it through the holders route;
 *   - a role that carries the key cannot have its capability list edited at
 *     all, and no capability list may gain the key.
 *
 * ── THE SENTENCE ABOVE WAS FALSE FOR AS LONG AS IT STOOD HERE ─────────────
 *
 * "By any admin route" is what it claimed, and the two bullets under it are
 * both about ROLES, because `stewardSeatRefusal` below guards exactly two
 * routes. THE BADGE PLANE WAS NEVER FENCED. `POST /api/admin/badges` took
 * `capabilities: ["steward.veto"]`, `badgeProblem` checked only that the key
 * was known, and step 4 of the gate answered `decided(true, "badge")` for it.
 * So the one power this file exists to keep out of an administrator's hands
 * had an administrator's route that handed it over, and the claim that it did
 * not lived three directories from the code that did.
 *
 * It is true NOW, and by a map rather than by this paragraph: `BADGE_GRANTABLE`
 * in shared/capabilities.ts marks the key ungrantable, the gate reads it, and
 * `badgeProblem` refuses to store such a badge (Rye, 2026-09-23: seats only,
 * "so that an admin cannot mint a badge and give themselves a veto").
 *
 * The seat is filled and emptied by the `role_seat` and `role_unseat` ballots
 * and by nothing else. The refusal says so by name, so an administrator who
 * meets it is told where the door actually is rather than being told no, and
 * the badge panel now sends back the same sentence.
 *
 * FREEZING THE WHOLE LIST, not only the key, is deliberate. An admin who could
 * still edit the rest of a steward-capable role's capabilities could strip
 * `ballot.vote` off the seat, or bolt `proposal.decide` onto it so one account
 * closes the vote and vetoes the result. A steward-capable role changes shape
 * through the village's own ballots, whole.
 *
 * ── RULE TWO: THE ESCALATION MATH, MOVED OUT OF THE MONOLITH ──────────────
 *
 * `decideRoleCapabilities` is the capability route's own arithmetic, lifted
 * verbatim out of server/index.ts so the ratchet on that file could pay for
 * the guard above. Nothing about it changed. It is here rather than in
 * server/lib/drafts.ts beside `computeEscalations` because it is the ROUTE's
 * policy (what to refuse, what to ask again, what sentence to send back), and
 * drafts.ts holds the arithmetic both callers share.
 */
import { applyEscalationChoices, computeEscalations } from "./drafts";
import {
  ALL_CAPABILITIES,
  carriedBy,
  isBadgeGrantable,
  isDeniable,
  type Capability,
} from "../../shared/capabilities";
import { STEWARD_VETO, holdingHasLapsed, roleCapabilityList } from "./stewardship";

/**
 * How many people hold a role right now, counted the way the gate counts.
 *
 * `roleCapabilitiesFor` in server/index.ts gives a member a role's powers only
 * while `holdingHasLapsed` says their seat has not run out, so a row whose term
 * has ended is nobody. `GET /api/roles` serves a raw row count, which is right
 * for "seats filled" on a public page and wrong for the question the handover
 * tab asks: can anybody act through this role today. Served on
 * `GET /api/admin/capabilities/holding` so the tab warns about an empty role
 * from the same number the gate would use (Rye, 2026-09-14).
 */
export function liveHolderCount(
  holders: ReadonlyArray<Parameters<typeof holdingHasLapsed>[0] & { roleId: string }>,
  roleId: string,
  now: Date = new Date(),
): number {
  return holders.filter((h) => h.roleId === roleId && !holdingHasLapsed(h, now)).length;
}

/**
 * WHO CAN ACTUALLY USE THIS POWER RIGHT NOW, counted the way the gate counts.
 *
 * Rye's rule for redemption (2026-09-15) is "a steward confirms, but if there
 * isn't a steward the village can vote on these things", and org decide asks
 * the same question, so this answers it once for both: how many PEOPLE hold a
 * capability today.
 *
 * ── WHAT IT COUNTS, AND WHAT IT LEAVES OUT ────────────────────────────────
 *
 * `capabilityDecision` in shared/capabilities.ts is the order of authority and
 * this walks the same planes in the same order, minus one:
 *
 *   counted    a role the person holds, whose capability list carries the key,
 *              on a holding that has not lapsed (`holdingHasLapsed`)
 *   counted    a capability a greater key carries, through `carriedBy`
 *   counted    a badge grant, on a key `BADGE_GRANTABLE` lets a badge reach
 *   subtracted a warning badge that DENIES the key, which beats a role, exactly
 *              as the gate has it, and only where the key may be denied at all
 *   EXCLUDED   the admin short-circuit
 *
 * The exclusion is the whole point rather than a simplification. Every admin
 * passes every gate, so counting them would make the answer "somebody holds it"
 * in every village that has an administrator, which is every village. Rye's
 * rule REPLACES the fall-through to admins: the question is whether the village
 * has given this power to anybody, and an admin who was never given it is
 * precisely the case that has to answer no.
 *
 * Stage-granted capabilities are not counted either, and `redemption.confirm`
 * has no stage that grants it (STAGE_UNLOCKS). A caller asking about a key a
 * stage unlocks would be asking a different question, and this header says so
 * instead of quietly answering it.
 *
 * ── WHY THE BADGE PLANE ARRIVES AS AN ARGUMENT ────────────────────────────
 *
 * Roles and holdings are cached in memory and synchronous; badges are rows and
 * are read per member. Taking them as data keeps this pure and testable, and
 * lets the caller pay for the read only when it has one to make. Absent means
 * "no badge grants and no denies", which is what a village with the badges
 * module off actually has.
 */
export function liveHoldersOfCapability(
  holders: ReadonlyArray<Parameters<typeof holdingHasLapsed>[0] & { roleId: string; userId: string }>,
  roles: ReadonlyArray<{ id: string; capabilities?: unknown }>,
  capability: string,
  now: Date = new Date(),
  badges: Readonly<Record<string, { grants?: readonly string[]; denies?: readonly string[] }>> = {},
): string[] {
  const grantingRoles = new Set(
    roles.filter((r) => carriesCapability(roleCapabilityList(r.capabilities), capability)).map((r) => r.id),
  );
  const held = new Set<string>();
  for (const h of holders) {
    if (!grantingRoles.has(h.roleId)) continue;
    if (holdingHasLapsed(h, now)) continue;
    held.add(String(h.userId));
  }
  // A BADGE GRANT COUNTS ONLY WHERE THE GATE WOULD COUNT IT. `BADGE_GRANTABLE`
  // refuses the steward's seat to the badge plane, and a counter that added a
  // holder the gate answers no for is the twin this function's header exists
  // to refuse: it would report that somebody could veto while the veto route
  // turned them away.
  if (isBadgeGrantable(capability)) {
    for (const [userId, plane] of Object.entries(badges)) {
      if ((plane.grants ?? []).includes(capability)) held.add(userId);
    }
  }
  // A DENY BEATS A ROLE, which is the gate's own order, and it only lands on a
  // key that may be taken away (`isDeniable`). A warning badge naming a key
  // that may not be denied is ignored here for the same reason it is ignored
  // there: the row was written by hand and the gate refuses to trust it.
  if (isDeniable(capability as Capability)) {
    for (const [userId, plane] of Object.entries(badges)) {
      if ((plane.denies ?? []).includes(capability)) held.delete(userId);
    }
  }
  return Array.from(held).sort();
}

/** A role's list, or a greater key on it that carries the asked-for one. */
function carriesCapability(list: readonly string[], capability: string): boolean {
  if (list.includes(capability)) return true;
  return carriedBy(list, capability as Capability);
}

/** A refusal a route can send straight back: a status and a body. */
export interface RouteRefusal {
  status: number;
  body: Record<string, unknown>;
}

/**
 * The sentence an administrator meets, and it names the two ballots.
 *
 * Written as one exported constant so the holders route, the capabilities
 * route and the tests all read the same words. A refusal that says only "no"
 * teaches nobody where the door is.
 */
export const STEWARD_SEAT_REFUSAL =
  "The steward's veto is not an administrator's to give or take. A village fills this seat with a " +
  "role_seat ballot and empties it with a role_unseat ballot, so the record shows the village doing it. " +
  "Open one of those instead.";

/**
 * May this admin route touch this role at all?
 *
 * `requested` is the capability list a caller is trying to write, when the
 * route writes one. The holders route passes nothing, because seating does not
 * change a list: for that route the question is only whether the role already
 * carries the key.
 *
 * Returns null when the route may carry on, which is the shape every other
 * guard in this codebase uses so a caller reads as
 * `const no = ...; if (no) return res.status(no.status).json(no.body);`
 */
export function stewardSeatRefusal(
  role: { id?: string; capabilities?: unknown } | null | undefined,
  requested?: readonly string[] | null,
): RouteRefusal | null {
  const has = roleCapabilityList(role?.capabilities).includes(STEWARD_VETO);
  const wants = (requested ?? []).map(String).includes(STEWARD_VETO);
  if (!has && !wants) return null;
  return {
    status: 409,
    body: {
      error: STEWARD_SEAT_REFUSAL,
      code: "steward_seat_is_the_villages",
      capability: STEWARD_VETO,
      ballots: ["role_seat", "role_unseat"],
    },
  };
}

export interface RoleCapabilityDecision {
  /** Send this and stop, when it is not null. */
  refusal: RouteRefusal | null;
  /** The list to write, when there is no refusal. */
  granted: string[];
  /** Keys asked for and not granted, because nobody ticked them. */
  refused: string[];
}

/**
 * What a capability edit resolves to: the list to write, or the refusal.
 *
 * WHAT COUNTS AS AN ESCALATION HERE, and the version of this that was wrong
 * for one test run. The draft path compares a NEW role against every existing
 * one, because a new role introducing a power nothing else has is a governance
 * change wearing a job title. This edits an EXISTING role, so the baseline has
 * to include what that role already carries. Without it, every capability the
 * role uniquely held came back as an escalation, and "silence is refusal" then
 * stripped the lot.
 */
export function decideRoleCapabilities(input: {
  role: { id: string; capabilities?: unknown };
  everyRole: ReadonlyArray<{ id: string; capabilities?: unknown }>;
  requested: readonly string[];
  grantedEscalations?: readonly string[] | undefined;
  /** True when the caller sent no `grantedEscalations` field at all. */
  answered: boolean;
}): RoleCapabilityDecision {
  const requested = input.requested.map(String);
  const unknown = requested.filter((c) => !ALL_CAPABILITIES.includes(c as Capability));
  if (unknown.length) {
    return {
      refusal: { status: 400, body: { error: `Not capabilities this platform knows about: ${unknown.join(", ")}` } },
      granted: [],
      refused: [],
    };
  }
  const elsewhere = new Set<string>(roleCapabilityList(input.role.capabilities));
  for (const r of input.everyRole) {
    if (r.id === input.role.id) continue;
    for (const c of roleCapabilityList(r.capabilities)) elsewhere.add(c);
  }
  const escalations = computeEscalations(requested, Array.from(elsewhere));
  const granted = applyEscalationChoices(requested, escalations, {
    grantedEscalations: (input.grantedEscalations ?? []).map(String),
  });
  const refused = escalations.filter((e) => !granted.includes(e.capability));
  if (refused.length > 0 && !input.answered) {
    // First call with no answer at all: say what is being asked for, in
    // sentences, and change nothing. The same warn-and-proceed shape the badge
    // kind change uses, for the same reason: what may never happen is the
    // change landing silently.
    //
    // THE SENTENCE NAMES NO CONTROL. It used to end "Tick the ones you mean
    // and send them back", copied from the draft review screen, which has a
    // checkbox per escalation. This route's only caller in the client is the
    // handover tab, which asks in an OK/Cancel box with nothing to tick, and
    // it printed the sentence there verbatim (seen on live, 2026-09-14). A
    // refusal body is read by whatever client sent the request, so it states
    // the fact and what the request needs (`grantedEscalations`, one key per
    // power), and each client asks in words that fit its own buttons.
    return {
      refusal: {
        status: 409,
        body: {
          error:
            `This would be the first role in the village to carry ${refused.length === 1 ? "a power" : "powers"} nothing else grants, so nothing has changed yet. ` +
            "Each one lands only once it is confirmed by name.",
          escalations: escalations.map((e) => ({ capability: e.capability, consequence: e.consequence })),
          requiresConfirmation: true,
        },
      },
      granted: [],
      refused: refused.map((e) => e.capability),
    };
  }
  return { refusal: null, granted, refused: refused.map((e) => e.capability) };
}
