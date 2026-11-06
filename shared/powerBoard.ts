/**
 * THE BOARD OF EVERY POWER (ROLE_POWERS_DESIGN.md §4.1, §4.1b; Rye Q5 and Q11).
 *
 * Every key the one gate knows, in plain words, grouped into families, with
 * who holds it now and where a suggestion about it goes. Every member reads it
 * (Q5: "the admin panel should be open to ALL members to see"); changing a
 * power still needs the power.
 *
 * Both maps below are `Record<Capability, …>` on purpose: a new key is a type
 * error until somebody decides its family and its guidance, which is the
 * shape `TRANSFERABLE` and `BADGE_GRANTABLE` already keep.
 */
import { ALL_CAPABILITIES, CAPABILITY_LABELS, STAGE_UNLOCKS, TRANSFERABLE, type Capability } from "./capabilities";
import { CAPABILITY_CONSEQUENCE } from "./draftKinds";

export type PowerFamily =
  | "structure"
  | "decisions"
  | "membership"
  | "money"
  | "work"
  | "land"
  | "voice"
  | "gatherings";

/** The families, in the order the board shows them. */
export const POWER_FAMILIES: ReadonlyArray<{ id: PowerFamily; title: string }> = [
  { id: "structure", title: "Roles, circles and structure" },
  { id: "decisions", title: "Decisions" },
  { id: "membership", title: "Membership" },
  { id: "money", title: "Money and tokens" },
  { id: "work", title: "Work and recognition" },
  { id: "land", title: "Land and map" },
  { id: "voice", title: "Voice and communication" },
  { id: "gatherings", title: "Gatherings, library, sessions and companions" },
];

export const POWER_FAMILY: Record<Capability, PowerFamily> = {
  "org.declare": "structure",
  "org.decide": "structure",
  "org.seat": "structure",
  "org.seatAgent": "structure",
  "power.assign": "structure",
  "dial.set": "structure",
  "module.switch": "structure",
  "proposal.open": "decisions",
  "proposal.decide": "decisions",
  "steward.veto": "decisions",
  "mechanics.propose": "decisions",
  "ballot.vote": "decisions",
  "member.vouch": "membership",
  "member.superVouch": "membership",
  "intake.moderate": "membership",
  "exchange.manage": "money",
  "cash.pay": "money",
  "redemption.confirm": "money",
  "exchange.buy": "money",
  "exchange.swap": "money",
  "stay.member_rate": "money",
  "quest.approve": "work",
  "quest.consent": "work",
  "moon.approve": "work",
  "moon.approve_alone": "work",
  "moon.approve_own": "work",
  "map.edit": "land",
  "map.publish": "land",
  "map.photograph": "land",
  "map.curatePhotos": "land",
  "map.viewPeople": "land",
  "map.contact": "land",
  "health.record": "land",
  "story.tell": "voice",
  "feed.announce": "voice",
  "comms.manage": "voice",
  "forum.moderate": "voice",
  "forum.post": "voice",
  "message.send": "voice",
  "terms.read": "voice",
  "event.manage": "gatherings",
  "event.rsvp": "gatherings",
  "library.keep": "gatherings",
  "session.template": "gatherings",
  "companion.use": "gatherings",
};

/** What a village commonly does with a power at launch (Q11). Advice, never a default. */
export type HandoverGuidance = "often-at-launch" | "after-practice" | "usually-last" | "mature-only" | "everyday";

export const GUIDANCE_WORDS: Record<HandoverGuidance, string> = {
  "often-at-launch": "Often passed at launch: everyday shared care, easy to take back by a vote.",
  "after-practice": "Usually passed once its holders have practised: judgement calls about other members' work or words.",
  "usually-last": "Usually passed last: structure, and the powers that hand out powers.",
  "mature-only": "Mature villages only: passing it lets the village run with no stewards. It always asks for a stronger confirm.",
  everyday: "Every member holds it from a stage. Passing it lets the village set that stage.",
};

export const HANDOVER_GUIDANCE: Record<Capability, HandoverGuidance> = {
  "event.manage": "often-at-launch",
  "library.keep": "often-at-launch",
  "health.record": "often-at-launch",
  "map.curatePhotos": "often-at-launch",
  "feed.announce": "often-at-launch",
  "story.tell": "often-at-launch",
  "quest.approve": "after-practice",
  "quest.consent": "after-practice",
  "intake.moderate": "after-practice",
  "forum.moderate": "after-practice",
  "map.publish": "after-practice",
  "proposal.decide": "after-practice",
  "comms.manage": "after-practice",
  "moon.approve": "after-practice",
  "org.declare": "usually-last",
  "org.decide": "usually-last",
  "org.seat": "usually-last",
  "org.seatAgent": "usually-last",
  "redemption.confirm": "usually-last",
  "moon.approve_alone": "usually-last",
  "moon.approve_own": "usually-last",
  "steward.veto": "mature-only",
  "power.assign": "mature-only",
  "member.superVouch": "mature-only",
  "exchange.manage": "mature-only",
  "cash.pay": "mature-only",
  "module.switch": "mature-only",
  "dial.set": "mature-only",
  "proposal.open": "everyday",
  "mechanics.propose": "everyday",
  "ballot.vote": "everyday",
  "member.vouch": "everyday",
  "exchange.buy": "everyday",
  "exchange.swap": "everyday",
  "stay.member_rate": "everyday",
  "map.edit": "everyday",
  "map.photograph": "everyday",
  "map.viewPeople": "everyday",
  "map.contact": "everyday",
  "forum.post": "everyday",
  "message.send": "everyday",
  "terms.read": "everyday",
  "event.rsvp": "everyday",
  "session.template": "everyday",
  "companion.use": "everyday",
};

/** One holder of a power through a role, as the board names them: "Role (FirstName)". */
export interface BoardHolder {
  role: string;
  firstName: string;
}

export interface PowerBoardRow {
  key: Capability;
  family: PowerFamily;
  label: string;
  consequence: string;
  guidance: HandoverGuidance;
  /** The stage that opens it to every member, or null. */
  stage: string | null;
  /** The Power groups that carry it. */
  groups: string[];
  /** The org roles whose holders hold it through a linked group. */
  roles: string[];
  /** Everybody who holds it now through a group or a role, admin short-circuit left out. */
  holders: BoardHolder[];
  /** The village holds it, looked after by this group, or null. */
  villageHolds: { lookedAfterBy: string } | null;
  /** Today the passable set is TRANSFERABLE; every power becomes passable in a later change. */
  passable: boolean;
  /**
   * Where a suggested change goes (§4.5): the holders review it, or it goes to
   * a village vote because the village holds the power or nobody does.
   */
  suggestionsGoTo: "holders" | "vote";
}

export interface PowerBoardInput {
  groups: ReadonlyArray<{ id: string; name: string; capabilities: readonly string[] }>;
  /** Which groups carry a key, greater keys included (`rolesCarryingCapability`). */
  carrying: (capability: Capability) => ReadonlyArray<{ id: string; name: string }>;
  /** Org role name by id, and the groups each role is linked to. */
  roleLinks: ReadonlyArray<{ orgRoleName: string; groupId: string }>;
  /** Everybody who holds a key now, as "Role (FirstName)". */
  holdersOf: (capability: Capability) => BoardHolder[];
  /** Keys the village holds, and the group that looks after each. */
  villageHeld: ReadonlyMap<string, string>;
  /** The stage each key unlocks at, overrides applied. */
  stageOf?: (capability: Capability) => string | null;
}

/** The whole board, every key in the gate's own order. Pure. */
export function buildPowerBoard(input: PowerBoardInput): PowerBoardRow[] {
  return ALL_CAPABILITIES.map((key) => {
    const groups = input.carrying(key);
    const groupIds = new Set(groups.map((g) => g.id));
    const roles = Array.from(new Set(input.roleLinks.filter((l) => groupIds.has(l.groupId)).map((l) => l.orgRoleName))).sort();
    const holders = input.holdersOf(key);
    const looked = input.villageHeld.get(key);
    return {
      key,
      family: POWER_FAMILY[key],
      label: CAPABILITY_LABELS[key],
      consequence: CAPABILITY_CONSEQUENCE[key],
      guidance: HANDOVER_GUIDANCE[key],
      stage: input.stageOf ? input.stageOf(key) : STAGE_UNLOCKS[key] ?? null,
      groups: groups.map((g) => g.name),
      roles,
      holders,
      villageHolds: looked !== undefined ? { lookedAfterBy: looked } : null,
      passable: TRANSFERABLE[key],
      suggestionsGoTo: looked !== undefined || holders.length === 0 ? "vote" : "holders",
    };
  });
}
