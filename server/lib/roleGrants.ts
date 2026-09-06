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
 * The seat is filled and emptied by the `role_seat` and `role_unseat` ballots
 * and by nothing else. The refusal says so by name, so an administrator who
 * meets it is told where the door actually is rather than being told no.
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
import { ALL_CAPABILITIES, type Capability } from "../../shared/capabilities";
import { STEWARD_VETO, roleCapabilityList } from "./stewardship";

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
    return {
      refusal: {
        status: 409,
        body: {
          error:
            `This would be the first role in the village to carry ${refused.length === 1 ? "a power" : "powers"} nothing else grants. ` +
            "Tick the ones you mean and send them back.",
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
