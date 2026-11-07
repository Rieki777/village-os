/**
 * WHICH POWER OPENS EACH ADMIN-ONLY ROUTE (ROLE_POWERS_DESIGN.md §9a; the mapping
 * village-os-ops/internal/OPERATOR_POWERS_MAPPING.md proposes for Rye).
 *
 * These routes asked only `isAdmin`, so a village that held every power still
 * needed an administrator to reach them. Each one now names the power that
 * already describes the act, or one of the four operator powers where none does,
 * and `isAdmin` lets a HOLDER of that power through as well.
 *
 * WIDENING ONLY. Every account that reached a route before reaches it now:
 * `adminOrRouteHolder` asks the admin question first and unchanged. Narrowing a
 * route once the village holds its power is a later step, and Rye's.
 *
 * NO KEY HERE MAY OPEN AT A STAGE. A key the ladder gives every member would hand
 * every member the route. `operatorRoutes.test.ts` pins that, and pins that every
 * entry is a route that exists.
 *
 * Generated from the routes at the time of writing; a new admin route is not in
 * this map until somebody decides its power, so it stays admin-only, the safe direction.
 */
import type { Capability } from "../../shared/capabilities";

/** `METHOD /api/admin/...` as Express registers it, to the power that opens it. */
export const ROUTE_POWERS: Readonly<Record<string, Capability>> = {
  "DELETE /api/admin/submissions/:id": "intake.moderate",
  "POST /api/admin/users/:id/send-password-link": "operator.accounts",
  "POST /api/admin/users/:id/revoke-sessions": "operator.accounts",
  "PUT /api/admin/users/:id/role": "operator.accounts",
  "PUT /api/admin/modules/:id/image": "module.switch",
  "POST /api/admin/modules/:id/examples/clear": "module.switch",
  "PUT /api/admin/modules/:id/config": "module.switch",
  "PUT /api/admin/roles/:id": "power.assign",
  "POST /api/admin/tools": "operator.config",
  "PUT /api/admin/tools/order": "operator.config",
  "PUT /api/admin/tools/:id": "operator.config",
  "DELETE /api/admin/tools/:id": "operator.config",
  "POST /api/admin/tools/check-links": "operator.config",
  "POST /api/admin/events/calendars": "event.manage",
  "POST /api/admin/events/calendars/:id/poll": "event.manage",
  "DELETE /api/admin/events/calendars/:id": "event.manage",
  "POST /api/admin/assistant/launch": "operator.config",
  "POST /api/admin/products": "exchange.manage",
  "PUT /api/admin/products/:id": "exchange.manage",
  "POST /api/admin/products/purchases/:id/confirm": "exchange.manage",
  "POST /api/admin/network/share": "story.tell",
  "PUT /api/admin/network/share/:id": "story.tell",
  "POST /api/admin/network/peers": "story.tell",
  "DELETE /api/admin/network/peers/:id": "story.tell",
  "POST /api/admin/network/peers/:id/resume": "story.tell",
  "POST /api/admin/network/sync": "story.tell",
  "POST /api/admin/assistant/organize": "operator.config",
  "PUT /api/admin/brain/:section": "story.tell",
  "POST /api/admin/brain/:section/confirm": "story.tell",
  "POST /api/admin/assistant/studio": "operator.config",
  "POST /api/admin/drafts/:id/accept": "operator.config",
  "POST /api/admin/drafts/:id/reject": "operator.config",
  "POST /api/admin/recordings": "story.tell",
  "PUT /api/admin/recordings/:id/transcript": "story.tell",
  "POST /api/admin/recordings/:id/synthesize": "story.tell",
  "PUT /api/admin/syntheses/:id/body": "story.tell",
  "POST /api/admin/syntheses/:id/publish": "story.tell",
  "POST /api/admin/call-tasks/:id/:action": "intake.moderate",
  "PUT /api/admin/exit-policy": "operator.accounts",
  "POST /api/admin/exits": "operator.accounts",
  "POST /api/admin/exits/:id/settle-balances": "operator.accounts",
  "POST /api/admin/exits/:id/resolve": "operator.accounts",
  "POST /api/admin/exits/:id/cancel": "operator.accounts",
  "POST /api/admin/health/regen/:id/retract": "health.record",
  "POST /api/admin/library/categories": "library.keep",
  "POST /api/admin/library/intake": "library.keep",
  "POST /api/admin/library/sweep": "library.keep",
  "POST /api/admin/exchange/reconcile": "operator.recover",
  "POST /api/admin/tokens": "exchange.manage",
  "POST /api/admin/tokens/:slug/mint": "exchange.manage",
  "POST /api/admin/mint-requests/:id/approve": "exchange.manage",
  "POST /api/admin/mint-requests/:id/decline": "exchange.manage",
  "PUT /api/admin/email-config": "operator.secrets",
  "PUT /api/admin/integrations/:key": "operator.secrets",
  "PUT /api/admin/work-with-us-config": "story.tell",
  "POST /api/admin/brand/font": "story.tell",
  "PATCH /api/admin/investor-docs/:id": "story.tell",
  "DELETE /api/admin/investor-docs/:id": "story.tell",
  "POST /api/admin/uploads/orphans/remove": "operator.recover",
  "PUT /api/admin/settings": "operator.config",
  "PUT /api/admin/visit-config": "story.tell",
  "PUT /api/admin/investor-summary": "story.tell",
  "PATCH /api/admin/economy/rules/:id": "exchange.manage",
  "POST /api/admin/cycles/close": "operator.config",
  "POST /api/admin/hypha/candidates": "exchange.manage",
  "POST /api/admin/hypha/bind": "exchange.manage",
  "DELETE /api/admin/hypha/bindings/:slug": "exchange.manage",
  "POST /api/admin/hypha/refresh": "exchange.manage",
  "POST /api/admin/hypha/outcomes/:id/resolve": "exchange.manage",
  "POST /api/admin/mechanics/proposals/:id/apply": "dial.set",
  "POST /api/admin/seasons/patterns": "dial.set",
  "POST /api/admin/seasons/patterns/:id/members": "dial.set",
  "DELETE /api/admin/seasons/patterns/:id/members": "dial.set",
  "POST /api/admin/seasons/roll": "dial.set",
  "POST /api/admin/roles/:id/holders": "power.assign",
  "DELETE /api/admin/players/:id": "operator.accounts",
  "POST /api/admin/badges": "power.assign",
  "PUT /api/admin/badges/:id": "power.assign",
  "POST /api/admin/badges/:id/award": "power.assign",
  "DELETE /api/admin/badges/:id/award/:userId": "power.assign",
  "POST /api/admin/badges/evaluate": "power.assign",
  "PUT /api/admin/brand": "story.tell",
  "POST /api/admin/brand/resync": "story.tell",
  "POST /api/admin/brand/image": "story.tell",
  "POST /api/admin/circles": "org.declare",
  "PUT /api/admin/circles/:id": "org.declare",
  "DELETE /api/admin/circles/:id": "org.declare",
  "PUT /api/admin/feedback/:id": "intake.moderate",
  "PUT /api/admin/governance/weights/:userId": "org.declare",
  "POST /api/admin/governance/weights/bulk": "org.declare",
  "PUT /api/admin/purpose": "story.tell",
  "PUT /api/admin/roles/:id/admin-access": "operator.accounts",
  "PUT /api/admin/map/chips": "map.publish",
  "PUT /api/admin/map/walk": "map.publish",
  "PUT /api/admin/map/vocabulary": "map.publish",
  "PUT /api/admin/member-tasks/bridge/notes": "intake.moderate",
  "POST /api/admin/member-tasks/bridge/send": "intake.moderate",
  "POST /api/admin/member-tasks/bridge/sync": "intake.moderate",
  "POST /api/admin/member-tasks/:userId/sera-hard-delete": "intake.moderate",
  "POST /api/admin/member-tasks/review/:feedbackId": "intake.moderate",
  "POST /api/admin/member-tasks/role-queue/:id": "intake.moderate",
  "PUT /api/admin/member-tasks/access/:userId": "intake.moderate",
  "POST /api/admin/member-tasks/import": "intake.moderate",
  "POST /api/admin/member-tasks/import/:batch/remove": "intake.moderate",
  "POST /api/admin/cycles/settlement-proposal": "operator.config",
  "POST /api/admin/governance/land-due": "operator.recover",
  "PUT /api/admin/needs/scope": "map.publish",
  "POST /api/admin/needs/retire": "map.publish",
  "POST /api/admin/needs/links": "map.publish",
  "DELETE /api/admin/needs/links/:id": "map.publish",
  "POST /api/admin/org/drafts": "org.decide",
  "POST /api/admin/org/drafts/:id/changes": "org.decide",
  "PUT /api/admin/org/drafts/:id/vision": "org.decide",
  "POST /api/admin/org/drafts/:id/publish": "org.decide",
  "POST /api/admin/org/drafts/:id/revert": "org.decide",
  "POST /api/admin/org/relations": "org.declare",
  "DELETE /api/admin/org/relations/:id": "org.declare",
  "POST /api/admin/org/roles": "org.decide",
  "PUT /api/admin/org/roles/:id": "org.decide",
  "POST /api/admin/org/seatings/:id/forget": "org.seat",
  "PUT /api/admin/players/:id/stage": "operator.accounts",
  "POST /api/admin/quests": "quest.approve",
  "PUT /api/admin/quests/:id": "quest.approve",
  "POST /api/admin/quests/:id/keep": "quest.approve",
  "DELETE /api/admin/quests/:id": "quest.approve",
  "PUT /api/admin/seasons": "dial.set",
  "PUT /api/admin/seat-presets": "org.declare",
  "POST /api/admin/site-pull": "operator.config",
  "POST /api/admin/site-pull/assets": "operator.config",
  "POST /api/admin/stays/accommodations": "exchange.manage",
  "PUT /api/admin/stays/accommodations/:id": "exchange.manage",
  "PUT /api/admin/stays/accommodations/:id/prices": "exchange.manage",
  "POST /api/admin/stays/:id/activate": "exchange.manage",
  "POST /api/admin/stays/:id/end": "exchange.manage",
  "PUT /api/admin/stays/:id": "exchange.manage",
  "POST /api/admin/stays/post-nights": "exchange.manage",
  "POST /api/admin/stays/comp": "exchange.manage",
  "POST /api/admin/stays/adjust": "exchange.manage",
  "POST /api/admin/stays/purchases/manual": "exchange.manage",
  "POST /api/admin/stays/purchases/:id/refund": "exchange.manage",
  "POST /api/admin/payments/suspensions/:id/lift": "operator.accounts",
  "POST /api/admin/submissions/:id/handling": "intake.moderate",
  "PUT /api/admin/tokens/:slug": "exchange.manage",
  "POST /api/admin/training-modules": "operator.config",
  "PUT /api/admin/training-modules/:id": "operator.config",
  "DELETE /api/admin/training-modules/:id": "operator.config",
};

/** Routes left to the admin on purpose, and why. */
export const ADMIN_ONLY_ROUTES: Readonly<Record<string, string>> = {
  "POST /api/admin/launch/confirm": "the launch is the stewards' act, with its own selection and signatures",
  "PUT /api/admin/capabilities/:capability/holding": "passing a power to the village: stewards only, two signatures (Q10, Q12)",
  "DELETE /api/admin/capabilities/:capability/holding": "a power comes back to the panel only by the village's vote",
};

/** The power that opens this route, or null. */
export function routePower(method: string, routePath: unknown): Capability | null {
  if (typeof routePath !== "string") return null;
  return ROUTE_POWERS[`${method.toUpperCase()} ${routePath}`] ?? null;
}

/**
 * The admin question, then the holder question. Pure: the caller supplies both
 * answers, and the admin one is asked first and on its own, so nobody who
 * reached a route before this map existed can lose it.
 */
export async function adminOrRouteHolder(
  isAdminUser: boolean,
  power: Capability | null,
  holds: (cap: Capability) => Promise<boolean>,
): Promise<boolean> {
  if (isAdminUser) return true;
  if (!power) return false;
  return holds(power);
}
