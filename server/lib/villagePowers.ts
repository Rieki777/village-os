/**
 * WHAT THE MEMBERS' POWERS PAGE SAYS ABOUT EACH POWER (0098, extended for role
 * powers; ROLE_POWERS_DESIGN.md §4.1; Rye Q5 and Q11, the coordinator's yes of
 * 2026-11-05).
 *
 * `GET /api/village/powers` used to list the registry's powers and say "The
 * admin panel looks after this one" for every power the village had not taken
 * on. Once roles carry powers that sentence is false: Ops lead (Rye) or
 * Steward Circle (Sam) holds it today, for the stewards. So every row now says
 * who holds it through a role, and the list covers EVERY power the gate knows.
 *
 * THE R55 RULES STILL HOLD, AND THIS IS WHERE THEY ARE KEPT FOR THE SERVER:
 *
 *   - one FIXED order: the registry's own, then every other key in the gate's
 *     order. Never sorted by who holds what, and the same for every village;
 *   - no count, no total, no fraction anywhere in the payload;
 *   - a family groups by what a power DOES (shared/powerBoard.ts), never by
 *     whether it is held.
 *
 * Pure, so the order and the sentences' inputs are testable without a server.
 */
import { ALL_CAPABILITIES, CAPABILITY_LABELS, TRANSFERABLE, type Capability } from "../../shared/capabilities";
import { CAPABILITY_CONSEQUENCE } from "../../shared/draftKinds";
import { HANDOVER_GUIDANCE, POWER_FAMILY, type HandoverGuidance, type PowerFamily } from "../../shared/powerBoard";
import { powersForReading, type PowerHolder } from "./capabilityRegistry";
import { rolesCarryingCapability } from "./roleGrants";
import { holdingHasLapsed } from "./stewardship";

export interface VillagePowerRow {
  capability: Capability;
  title: string;
  surface: string;
  consequence: string;
  movable: boolean;
  family: PowerFamily;
  guidance: HandoverGuidance;
  /** The village holds it: the looking-after group and the full names sitting there. */
  heldBy: { roleName: string; byBallot: boolean; movedAt: string; people: string[] } | null;
  /** Before the village holds it: who holds it today through a role, as "Role (FirstName)". */
  heldToday: string[];
  /** The stage that gives it to every member, by its name, or null. */
  stage: string | null;
  /** Where a suggested change goes (§4.5). */
  suggestionsGoTo: "holders" | "vote";
}

export interface VillagePowerInput {
  holders: ReadonlyMap<string, PowerHolder>;
  groups: ReadonlyArray<{ id: unknown; name?: unknown; capabilities?: unknown; isExample?: unknown }>;
  holdings: ReadonlyArray<{ roleId: string; userId: string; termEndsAt?: string | Date | null; viaOrgRoleId?: string }>;
  orgRoleName: (id: string) => string | undefined;
  /** A member's full name and first name; null leaves them out (an example, a tombstone). */
  nameOf: (userId: string) => { full: string; first: string } | null;
  stageName: (capability: Capability) => string | null;
  now?: Date;
}

export function villagePowerRows(input: VillagePowerInput): VillagePowerRow[] {
  const now = input.now ?? new Date();
  const live = input.holdings.filter((h) => !holdingHasLapsed(h, now));
  const groupName = new Map(input.groups.map((g) => [String(g.id), String(g.name ?? g.id)]));
  const fromRegistry = powersForReading(input.holders);
  const registered = new Set<string>(fromRegistry.map((p) => p.capability));
  const base = [
    ...fromRegistry.map((p) => ({ capability: p.capability, title: p.title, surface: p.surface, consequence: p.consequence })),
    ...ALL_CAPABILITIES.filter((c) => !registered.has(c)).map((c) => ({
      capability: c,
      title: CAPABILITY_LABELS[c],
      surface: "",
      consequence: CAPABILITY_CONSEQUENCE[c],
    })),
  ];
  return base.map((p) => {
    const held = input.holders.get(p.capability) ?? null;
    const heldBy = held
      ? {
          roleName: held.roleName ?? held.roleId,
          byBallot: held.byBallot,
          movedAt: held.movedAt,
          people: live
            .filter((h) => h.roleId === held.roleId)
            .map((h) => input.nameOf(String(h.userId))?.full ?? null)
            .filter((n): n is string => !!n),
        }
      : null;
    const heldToday: string[] = [];
    if (!held) {
      const carrying = new Set(rolesCarryingCapability(input.groups, p.capability).map((g) => g.id));
      for (const h of live) {
        if (!carrying.has(h.roleId)) continue;
        const who = input.nameOf(String(h.userId));
        if (!who) continue;
        const role = (h.viaOrgRoleId && input.orgRoleName(h.viaOrgRoleId)) || groupName.get(h.roleId) || h.roleId;
        const line = `${role} (${who.first})`;
        if (!heldToday.includes(line)) heldToday.push(line);
      }
    }
    const holderCount = heldBy ? heldBy.people.length : heldToday.length;
    return {
      ...p,
      movable: TRANSFERABLE[p.capability] === true,
      family: POWER_FAMILY[p.capability],
      guidance: HANDOVER_GUIDANCE[p.capability],
      heldBy,
      heldToday,
      stage: input.stageName(p.capability),
      suggestionsGoTo: held || holderCount === 0 ? "vote" : "holders",
    };
  });
}
