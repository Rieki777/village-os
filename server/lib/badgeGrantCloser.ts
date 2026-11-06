/**
 * A BADGE BY THE VILLAGE'S VOTE (vote-path gap 6), and the one closer for it.
 *
 * Rye, 2026-11-06: "EVERYTHING can change with the highest village vote." A
 * power the village holds moves to anyone only by a village vote, and any act
 * whose power has no live holder has a village-vote path. Badges had neither:
 * every write was behind `isAdmin`, and `badge_grant` was a wizard type the
 * village could only practise on. This file is what a carried `badge_grant`
 * ballot DOES, and the checks it and its opening route share.
 *
 * ── THE SUBJECT REF ────────────────────────────────────────────────────────
 *
 *   `<userId>@<badgeId>`    award this badge to this member
 *   `<userId>@-<badgeId>`   take it back
 *
 * The member comes first, the shape `role_seat` uses, so the erasure finds a
 * departed member's badge votes the way it finds their seat votes
 * (`SUBJECTS_ABOUT_A_MEMBER`, server/repos/ballotWords.ts). A badge id is a
 * slug (letters, digits, dashes, never a leading dash), so the dash cannot be
 * part of one.
 *
 * ── WHAT IT RE-READS AT THE LANDING ────────────────────────────────────────
 *
 * Everything. The badge, the member and what the village holds are read when
 * the decision lands, never trusted from the opening: a badge retired or
 * reshaped in between, a member who left, or a power the village took on
 * after the roll was frozen at ordinary dials all HOLD with a sentence, and
 * nothing is written.
 *
 * ── WHICH BADGES A VOTE MAY MOVE ───────────────────────────────────────────
 *
 * Only `granted` ones. A self badge is the member's own act, an earned badge is
 * the engine's, a hypha badge mirrors an outside fact, and a warning is a
 * steward's act with a note owed to its member. The keys `badge_grant` refuses
 * (`TYPE_CAPABILITY_REFUSALS`, server/lib/proposalDrafts.ts) stay refused,
 * `steward.veto` among them, and so does any key `BADGE_GRANTABLE` refuses.
 */
import type { Pool } from "mysql2/promise";
import { capabilityLabel, isBadgeGrantable, type Capability } from "../../shared/capabilities";
import { overrideDials, thresholdSettingsFrom } from "../../shared/ballotSubjects";
import { raiseDials, type MethodDials } from "../../shared/governanceEngine";
import type { CloseRouting, SubjectCloser } from "./applyDue";
import type { BallotRow } from "./ballots";
import { decisionLink } from "./ballotNotices";
import { awardBadge, awardsFor, badgeById, revokeBadge, villageHeldKeysOf, type BadgeDef, type BadgeNotify } from "./badges";
import { recordEvent } from "./events";
import { isExampleUser } from "./examples";
import { typeRefusesCapability } from "./proposalDrafts";
import { numberVar, stringVar } from "./variables";

export const BADGE_GRANT = "badge_grant";

export interface BadgeGrantAsk {
  badgeId: string;
  userId: string;
  revoke: boolean;
}

export function badgeGrantRef(ask: BadgeGrantAsk): string {
  return `${ask.userId}@${ask.revoke ? "-" : ""}${ask.badgeId}`;
}

export function parseBadgeGrantRef(ref: string): BadgeGrantAsk | null {
  const at = ref.indexOf("@");
  if (at <= 0) return null;
  const tail = ref.slice(at + 1);
  const revoke = tail.startsWith("-");
  const badgeId = revoke ? tail.slice(1) : tail;
  if (!badgeId) return null;
  return { userId: ref.slice(0, at), badgeId, revoke };
}

/** The title a badge vote opens with. `nameInTitle` (server/lib/ballotErasure.ts) reads the name back off it. */
export function badgeGrantTitle(badgeName: string, who: string, revoke: boolean): string {
  return revoke
    ? `${badgeName}: the village asks to take it back from ${who}`
    : `${badgeName}: the village asks to give it to ${who}`;
}

/**
 * The village's highest set tier, as dials. A badge carrying a power the
 * village holds moves that power, so it clears this bar and nothing less: the
 * same bar a re-point of a held power clears, read the same way.
 */
export function highestTierBar(): MethodDials {
  return overrideDials(thresholdSettingsFrom((key) => numberVar(key), (key) => stringVar(key)));
}

/** The ordinary dials, raised to the highest tier when the badge carries a power the village holds. */
export function badgeVoteDials(ordinary: MethodDials, carriesVillagePower: boolean): MethodDials {
  return carriesVillagePower ? raiseDials(ordinary, highestTierBar()) : ordinary;
}

/** Why a vote may not move this badge, or null. The same answer at the opening and at the landing. */
export function badgeVoteProblem(badge: BadgeDef | null): string | null {
  if (!badge) return "There is no badge by that name.";
  if (badge.isExample) return "That is one of the platform's example badges, not one of this village's.";
  if (!badge.active) return "That badge is retired, so there is nothing to give or take back.";
  if (badge.kind !== "granted") {
    return `"${badge.name}" is a ${badge.kind} badge. A village vote gives or takes back granted badges only.`;
  }
  for (const c of badge.capabilities) {
    const refused = typeRefusesCapability(BADGE_GRANT, c);
    if (refused) return refused;
    if (!isBadgeGrantable(c)) return `A badge cannot grant "${capabilityLabel(c as Capability)}", by a vote or any other way.`;
  }
  return null;
}

/** Whether this member wears this badge today: an award that has not run out. */
export async function wearsBadge(pool: Pool, userId: string, badgeId: string): Promise<boolean> {
  return (await awardsFor(pool, userId)).some((a) => a.badgeId === badgeId && !a.expired);
}

export interface BadgeGrantCloserDeps {
  getPool: () => Pool;
  notify: BadgeNotify;
  notifyAdmins: (type: string, title: string, dedupeKey: string) => Promise<unknown>;
  members: { byId(id: string): Promise<any | null> };
  firstName: (name: string) => string;
}

/** What closing a `badge_grant` ballot does: settle on every outcome, execute when a pass lands. */
export function badgeGrantCloser(deps: BadgeGrantCloserDeps): SubjectCloser {
  const run = async (b: BallotRow, outcome: "passed" | "failed" | "no_quorum", outcomeNote: string, actorId: string): Promise<CloseRouting> => {
    const out: CloseRouting = { applied: [], held: null, proposerTold: null };
    const pool = deps.getPool();
    const ask = parseBadgeGrantRef(b.subjectRef);
    const told = (title: string, body: string, key: string) =>
      deps.notify({ userId: b.openedBy, type: "governance", title, body, link: decisionLink(b), actorUserId: actorId, dedupeKey: `bal:${b.id}:${key}` });
    if (!ask) {
      out.held = "the ballot does not name a badge and a member this build can read";
      return out;
    }
    if (outcome !== "passed") {
      out.proposerTold = b.openedBy;
      await told(
        outcome === "no_quorum" ? `Too few of the village voted: ${b.title}` : `The village did not carry this one: ${b.title}`,
        outcome === "no_quorum"
          ? "Nothing has changed. The ask can go to the village again whenever it is more gathered."
          : `${outcomeNote}\n\nNothing has changed, and the village can ask again.`,
        "badge-not-carried",
      );
      return out;
    }
    const hold = async (why: string) => {
      out.held = why;
      await deps.notifyAdmins("governance", `A carried badge vote could not land: ${b.title}`, `bal:${b.id}:badge-held`);
      return out;
    };
    const badge = await badgeById(pool, ask.badgeId);
    const problem = badgeVoteProblem(badge);
    if (problem || !badge) return hold(problem ?? "There is no badge by that name.");
    const member = await deps.members.byId(ask.userId);
    if (!member || isExampleUser(member)) return hold("The member this vote names is no longer one of this village's members.");
    const villageHeld = await villageHeldKeysOf(pool, badge.capabilities);
    const bar = highestTierBar();
    if (villageHeld.length && (b.unityPct < bar.unityPct || b.quorumPct < bar.quorumPct)) {
      return hold(
        "This badge carries a power the village took on after this vote opened, so it needs the village's highest tier. Nothing was written. Open it again and the roll decides it at that bar.",
      );
    }
    const who = deps.firstName(String(member.name ?? "A member"));
    if (ask.revoke) {
      const took = await revokeBadge(pool, { badgeId: badge.id, userId: ask.userId, actorUserId: actorId, ballotId: b.id });
      if (took) out.applied = [`badge:${badge.id}`];
    } else {
      await awardBadge(pool, deps.notify, {
        badge, userId: ask.userId, awardedBy: null, actorUserId: actorId, ballotId: b.id, expiresAt: null,
        note: `By a vote of the whole village (${b.id}).`,
      });
      out.applied = [`badge:${badge.id}`];
    }
    out.proposerTold = b.openedBy;
    const fact = ask.revoke ? `${who} no longer wears ${badge.name}` : `${who} wears ${badge.name}`;
    await told(`The village carried this: ${b.title}`, `${fact} from today.`, ask.revoke ? "badge-revoked" : "badge-granted");
    // On the public pulse: a badge that moves a power moves it in the open.
    void recordEvent(pool, {
      kind: "governance",
      text: `${fact}, by a vote of the whole village.`,
      actorUserId: actorId, entityType: "ballot", entityRef: b.id,
    });
    return out;
  };
  return {
    settle: async (b, outcome, outcomeNote, actorId) =>
      outcome === "passed" ? { applied: [], held: null, proposerTold: null } : run(b, outcome, outcomeNote, actorId),
    execute: (b, actorId) => run(b, "passed", b.outcomeNote ?? "", actorId),
  };
}
