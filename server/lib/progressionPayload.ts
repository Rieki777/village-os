/**
 * WHAT THE LADDER AND THE PERMISSION SPINE LOOK LIKE ON THE WIRE.
 *
 * Three payloads draw progression for a member: `/api/game/config` (the
 * public ladder), `/api/game/me` (the dashboard) and `/api/game/progression`
 * (the profile). Every helper they share to shape that lives here, out of
 * `server/index.ts`, which is a file that may only ever shrink.
 *
 * The through-line for all of it: SERVE WHAT THE GAME PLAYS BY, never what
 * the config file happens to say. Two of the ladder's numbers and the whole
 * unlock table became tunable variables, so a payload built from
 * `shared/gameConfig` alone would hand a member a figure styled exactly like
 * the gate's while the gate compared against a different one. Each function
 * below resolves the registry the same way the code that DECIDES resolves
 * it, so the promise and the decision cannot drift.
 *
 * Everything here is a pure function of (config, registry, module lifecycle,
 * capability ctx). No database, no clock, no request.
 */
import {
  ALL_CAPABILITIES,
  capabilityLabel,
  hasCapability,
  STAGE_UNLOCKS,
  type Capability,
  type CapabilityCtx,
} from "../../shared/capabilities";
import { GAME_CONFIG, getStage, type GameStage, type StageRule } from "../../shared/gameConfig";
import { MODULES } from "../../shared/modules";
import { effectiveLifecycle } from "./modules";
import { numberVar } from "./variables";

/**
 * LANE Q: which module a capability belongs to, if any.
 *
 * `ModuleDef.capabilities` is the declaration that a capability EXISTS because
 * a module exists. Built once from the registry, which is pure data with no
 * clock and no database, so this map is the same in every process.
 *
 * Capabilities that appear in no module's list (the stage-granted ones, the
 * admin ones) resolve to undefined and are never filtered.
 */
const MODULE_BY_CAPABILITY: Map<string, string> = new Map(
  MODULES.flatMap((m) => m.capabilities.map((c) => [c as string, m.id] as const)),
);

/**
 * LANE Q: a held capability whose module is OFF is not a power anyone holds.
 *
 * The gate (`hasCapability`) answers about the PERSON: their stage, their
 * roles, their badges. It has no opinion about module lifecycle, correctly,
 * because a role grant should survive a module being switched off and back
 * on. What was wrong is that `/api/game/me` and `/api/game/progression`
 * served that answer raw, and `ProfileJourney.tsx` paints each one as a chip.
 * A village whose module lapses kept advertising its capability as a held
 * power with no route behind it, which is the routes' own contract broken:
 * the module's API prefixes stopped mounting the moment it went off.
 *
 * Core modules are always `public` through `effectiveLifecycle`, so the four
 * core capabilities are never touched by this.
 *
 * FACTORED OUT because two surfaces answer from it now and they must never
 * disagree about which keys exist. `loop.e2e.test.ts` pins that the two
 * payloads never differ on what is held; deriving both projections from one
 * filter makes that structural instead of asserted. Order is
 * `ALL_CAPABILITIES` order and never held-first, so the list reads the same
 * for a member holding all of these and one holding none.
 */
export const visibleCapabilities = (): Capability[] =>
  ALL_CAPABILITIES.filter((c) => {
    const moduleId = MODULE_BY_CAPABILITY.get(c);
    return !moduleId || effectiveLifecycle(moduleId) !== "off";
  });

export const heldCapabilities = (ctx: CapabilityCtx): Capability[] =>
  visibleCapabilities().filter((c) => hasCapability(c, ctx));

/** How a capability opens for somebody who does not hold it yet. */
export type CapabilityRung = { via: "stage"; stage: string } | { via: "appointment" };

export interface CapabilityCatalogueRow {
  key: Capability;
  label: string;
  held: boolean;
  opens: CapabilityRung;
}

/**
 * THE WHOLE MAP, not only the part this member has walked.
 *
 * `heldCapabilities` answers what somebody has, which paints a wall of chips
 * with no direction in it: a member reads eleven things they can do and
 * learns nothing about what climbing is FOR. This adds the closed keys and
 * the rung that opens each one, so the profile can say "one more rung and
 * this opens" instead of listing today.
 *
 * TWO THINGS IT DELIBERATELY DOES NOT DO.
 *
 * It does not advertise an OFF module's key. That is LANE Q's rule above and
 * LANE Q's reason: the module's API prefixes stop mounting the moment it goes
 * off, so a rung promising to open one would name a door with nothing behind
 * it. Filtering the catalogue rather than marking those rows keeps the two
 * projections identical in membership, which is what lets `held` here and
 * `capabilities` there be the same answer by construction.
 *
 * It reads the EFFECTIVE rung, never the raw `STAGE_UNLOCKS` table. The
 * unlock table became a mechanic (progression.unlock.<cap>), so a village
 * that moved a rung would otherwise be told the platform default while the
 * gate compared against its own. Same expression `capabilityDecision` uses,
 * so the promise and the gate cannot say different things. The value "none"
 * disables the stage path, which makes the key an appointment.
 */
export const capabilityCatalogue = (ctx: CapabilityCtx): CapabilityCatalogueRow[] =>
  visibleCapabilities().map((key) => {
    const rung = ctx.stageUnlockOverrides?.[key] ?? STAGE_UNLOCKS[key];
    return {
      key,
      label: capabilityLabel(key),
      held: hasCapability(key, ctx),
      opens: rung && rung !== "none" ? { via: "stage", stage: rung } : { via: "appointment" },
    };
  });

/**
 * A MEMBER'S ROLES, carrying the name a member reads.
 *
 * The id is machinery and the seed has always held a name beside it
 * ("founders-circle" / "Founders Circle"), but the member-facing payloads
 * served the id alone, so the profile ran a prettifier over it and printed
 * "Founders-Circle" while the real name sat unused one field away. The id
 * stays on the row because the client keys and titles by it.
 *
 * A holder row naming a role that no longer exists falls back to the id
 * rather than rendering blank, the same posture `capabilityLabel` takes: an
 * unresolvable key prints itself and says so out loud.
 *
 * Takes both lists because the role repos live in the host: this stays a
 * pure function of what it is handed.
 */
export function namedRoles(
  roleIds: readonly string[],
  roles: readonly { id: string; name: string }[],
): Array<{ id: string; name: string }> {
  const byId = new Map(roles.map((r) => [r.id, r.name]));
  return roleIds.map((id) => ({ id, name: byId.get(id) ?? id }));
}

/**
 * A stage's RULE as served, with its threshold overlaid from the registry.
 *
 * `computeStage` stopped reading `rule.min` the moment the quests threshold
 * became a generated variable (progression.quests_for.<id>): the number in
 * gameConfig is that variable's DEFAULT now, and the ladder plays by the
 * registry. Serving the config number raw would tell a member "one more
 * consented quest" on a village that had raised the bar to five, which is
 * the fake-number-styled-like-a-real-one failure `servedStage` exists to
 * stop.
 *
 * Clamped the way computeStage clamps it, so the figure a member reads is
 * the figure the gate compares against and not a second opinion about it.
 */
export function servedRule(s: GameStage): StageRule {
  return s.rule.type === "quests"
    ? { type: "quests", min: Math.max(1, numberVar(`progression.quests_for.${s.id}`)) }
    : s.rule;
}

/**
 * A stage as SERVED: the config shape with its economics overlaid from the
 * registry. gameConfig's gratitudeMultiplier became the DEFAULT of a
 * generated variable (progression.multiplier.<id>), so serving the raw
 * config object would show a number the game no longer plays by the moment
 * a village tunes it, a fake number styled like a real one. Its `rule` is
 * overlaid by `servedRule` above, for the same reason.
 */
export function servedMultiplier(stageId: string): number {
  return Math.max(0, numberVar(`progression.multiplier.${stageId}`));
}

export function servedStage(stageId: string) {
  const s = getStage(stageId);
  return {
    ...s,
    rule: servedRule(s),
    gratitudeMultiplier: servedMultiplier(s.id),
  };
}

/**
 * THE LADDER AS SERVED, in one place because it was serialized in two.
 *
 * Both copies stripped the rule, so every surface drawing the ladder knew
 * the rungs' names and nothing about how any of them is earned: the profile
 * could not say "two more consented quests opens Quest Seeker" because the
 * only field that answers it never left the server. The rule ships now, as
 * PLAYED rather than as configured, and one function means the next field
 * cannot reach one payload and miss the other.
 */
export function servedLadder() {
  return GAME_CONFIG.stages.map((s) => ({
    id: s.id,
    name: s.name,
    description: s.description,
    rule: servedRule(s),
    // The multiplier ships on the LADDER too, through the same expression
    // `servedStage` uses, so the sheet can say what the next rung is worth.
    // Serving it only on the member's own stage let a page say what climbing
    // costs and never what it pays. `servedMultiplier` is shared rather than
    // copied for the reason the e2e test states about the two ladder
    // serializers: separate copies of one map literal is exactly how a field
    // reaches one payload and misses the other.
    gratitudeMultiplier: servedMultiplier(s.id),
  }));
}
