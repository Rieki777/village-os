/**
 * Gathers the facts the next-step box needs and hands them to the pure
 * `nextStepFor` (shared/questNextStep.ts), then resolves the talk-to role's
 * name and live holders for the one member asking.
 *
 * WHY THE NAMES ARE RESOLVED HERE AND NEVER STORED: the reply goes to a
 * signed-in member who just claimed, which is a live view, so "Role
 * (FirstName)" is allowed there (constitution III.2). The `quest_claimed`
 * notification stores only the quest link; anyone reopening the box asks
 * `GET /api/game/quests/:id/next` and gets today's holders, never a name
 * frozen into stored text.
 *
 * A place's steward comes from the place registry when it answers
 * (`placeSteward`, wired once the places lane's `getPlaceStewardship` lands on
 * main); until then the quest's circle lead decides, which is what the map's
 * concierge already does for a quest (server/index.ts, /api/assistant/coordinate).
 */
import type { Pool } from "mysql2/promise";
import { questStructureKey } from "../repos/quests";
import { nextStepFor, type NextStepInput, type ResolvedNextStep } from "../../shared/questNextStep";
import { holderFirstName } from "../../shared/roleHolderLabel";
import { listOrgAssignments, listOrgRoles, type LapseContext } from "./orgChart";
import type { CrewWithMembers } from "./crews";

export interface PlaceStewardRead {
  roleId: string | null;
  state: "filled" | "held" | "open" | "paused";
}

export type { ResolvedNextStep };

export interface QuestNextStepDeps {
  getPool(): Pool;
  circles(): Array<{ id: string; name?: string; aliases?: string[]; leadRoleId?: string | null }>;
  crewsForQuest(questId: string): Promise<CrewWithMembers[]>;
  lapseContext(): LapseContext;
  memberName(userId: string): Promise<string | null>;
  /** The place registry's steward read. Absent until the places lane's read is on main. */
  placeSteward?: (structureKey: string) => Promise<PlaceStewardRead | null>;
}

interface QuestFacts {
  id: string;
  circle?: string | null;
  firstStep?: string | null;
  steps?: string[];
  startsAt?: string | null;
  dueAt?: string | null;
}

/** A quest's free-text circle name to a circle, the same alias rule the concierge uses. */
export function circleForQuestName<C extends { id: string; name?: string; aliases?: string[] }>(
  circles: readonly C[],
  circleName: string | null | undefined,
): C | null {
  const wanted = String(circleName ?? "").trim().toLowerCase();
  if (!wanted) return null;
  for (const c of circles) {
    if (String(c.name ?? "").toLowerCase() === wanted) return c;
    if ((c.aliases ?? []).some((a) => String(a).toLowerCase() === wanted)) return c;
  }
  return null;
}

export function makeQuestNextStep(deps: QuestNextStepDeps) {
  return async function questNextStep(quest: QuestFacts, userId: string): Promise<ResolvedNextStep> {
    const pool = deps.getPool();
    const circle = circleForQuestName(deps.circles(), quest.circle);
    const structureKey = await questStructureKey(pool, quest.id);
    const steward = structureKey && deps.placeSteward ? await deps.placeSteward(structureKey) : null;
    const crews = await deps.crewsForQuest(quest.id);
    const mine = crews.find((c) => c.status !== "disbanded" && c.members.some((m) => m.userId === userId)) ?? null;

    const input: NextStepInput = {
      quest: { id: quest.id, firstStep: quest.firstStep, steps: quest.steps, startsAt: quest.startsAt, dueAt: quest.dueAt },
      place: structureKey && steward ? { structureKey, roleId: steward.roleId, state: steward.state } : null,
      circle: circle ? { circleId: circle.id, leadRoleId: circle.leadRoleId ?? null } : null,
      crew: mine ? { id: mine.id, inviteCode: mine.inviteCode, size: mine.members.length } : null,
      crewAllowed: true,
      nextBuildDayAt: null,
    };
    const next = nextStepFor(input);

    if (next.talkTo.kind === "none") return { ...next, talkToLive: null };
    if (next.talkTo.kind === "circle") return { ...next, talkToLive: { roleName: null, circleName: circle?.name ?? null, holders: [] } };

    const roleId = next.talkTo.roleId;
    const [roles, seatings] = await Promise.all([listOrgRoles(pool), listOrgAssignments(pool, deps.lapseContext())]);
    const role = roles.find((r) => r.id === roleId) ?? null;
    // A lapsed term ends the role's powers (I.12), and a documented holder has
    // no account to reach, so only live member seatings count as someone to talk to.
    const live = seatings.filter((s) => s.orgRoleId === roleId && s.holderKind === "member" && s.userId && !s.lapsed);
    const holders: string[] = [];
    for (const s of live) {
      const first = holderFirstName(await deps.memberName(String(s.userId)));
      if (first) holders.push(first);
    }
    const talkTo = next.talkTo.source === "circle" ? { ...next.talkTo, vacant: holders.length === 0 } : next.talkTo;
    return {
      ...next,
      talkTo,
      talkToLive: { roleName: role ? String(role.name) : null, circleName: circle?.name ?? null, holders },
    };
  };
}

/**
 * One bell for the claimer, so the box can be found again from the bell. It
 * names the quest and nobody else: the box's people are resolved live when it
 * is opened (III.2), never written into stored text. Both claim doors ring it.
 */
export async function bellQuestClaimed(
  notify: (input: { userId: string; type: string; title: string; body: string; link: string; dedupeKey: string }) => Promise<unknown>,
  userId: string,
  claimId: string,
  quest: { id: string; title: string },
): Promise<void> {
  try {
    await notify({
      userId,
      type: "quest_claimed",
      title: `You took on ${quest.title}`,
      body: "Your next step, who to talk to and your crew link are on the quest.",
      link: `/quests/${encodeURIComponent(quest.id)}`,
      dedupeKey: `quest_claimed:${claimId}`,
    });
  } catch (bell) {
    console.error(`[quests] claim ${claimId}: the claim bell did not send`, bell);
  }
}
