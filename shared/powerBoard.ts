/**
 * WHICH FAMILY EACH POWER BELONGS TO, AND WHAT A VILLAGE USUALLY DOES WITH IT
 * (ROLE_POWERS_DESIGN.md §4.1, §4.1b; Rye Q5 and Q11).
 *
 * The members' powers page (`/powers`, GET /api/village/powers) shows every
 * power in families, in a fixed order, with a line of launch guidance. The
 * families group by WHAT a power does, never by who holds it: the page's R55
 * rules forbid any held-versus-unheld grouping, and a family is the same for a
 * village holding none of these and one holding all of them.
 *
 * Both maps below are `Record<Capability, …>` on purpose: a new key is a type
 * error until somebody decides its family and its guidance, which is the
 * shape `TRANSFERABLE` and `BADGE_GRANTABLE` already keep.
 */
import type { Capability } from "./capabilities";

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
  // The operator powers (PR 3): the admin routes that had no power of their own.
  "operator.config": "structure",
  "operator.secrets": "structure",
  "operator.recover": "structure",
  "operator.accounts": "membership",
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
  "role.pay": "money",
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
  "role.pay": "mature-only",
  "module.switch": "mature-only",
  "dial.set": "mature-only",
  // Settings with no power of their own are structure; accounts, secrets and repair let a village run with no admin at all.
  "operator.config": "usually-last",
  "operator.accounts": "mature-only",
  "operator.secrets": "mature-only",
  "operator.recover": "mature-only",
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
