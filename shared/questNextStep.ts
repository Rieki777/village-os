/**
 * THE NEXT-STEP BOX AFTER A CLAIM: who to talk to, the first task, the crew
 * invite and the date.
 *
 * Before this, claiming a quest on the board turned the button into "Turn in
 * your work" and claiming on the map showed a toast. Nothing told a member who
 * to find, what to do first, how to bring friends, or when. Both claim doors
 * (`POST /api/game/quests/:id/claim` and the map's `POST /api/map/promise`)
 * now answer with this object, and `GET /api/game/quests/:id/next` serves it
 * again later.
 *
 * Pure on purpose: the server gathers the facts and this decides. Every part
 * has an honest empty state, and none of them invents a person or a date.
 *
 * ROLE IDS ONLY. A holder's first name is read from the roster when the view
 * renders, never stored here, so a notification carrying this object never
 * goes stale and never names a person in stored text (constitution III.2).
 */

export interface NextStepInput {
  quest: {
    id: string;
    firstStep?: string | null;
    steps?: readonly string[] | null;
    startsAt?: string | null;
    dueAt?: string | null;
  };
  /** The quest's place and its steward role, from the place registry, when the quest sits at a place. */
  place: { structureKey: string; roleId: string | null; state: "filled" | "held" | "open" | "paused" } | null;
  /** The quest's circle, resolved from its circle name, and that circle's lead role. */
  circle: { circleId: string; leadRoleId: string | null } | null;
  /** The crew this member is in for this quest, if any. */
  crew: { id: string; inviteCode: string; size: number } | null;
  /** False for solo work, where a crew makes no sense. */
  crewAllowed: boolean;
  /** The next scheduled build day for this member's crew, an ISO instant. */
  nextBuildDayAt: string | null;
}

export type NextTalkTo =
  | { kind: "role"; roleId: string; circleId: string | null; source: "place" | "circle"; vacant: boolean; structureKey: string | null }
  | { kind: "circle"; circleId: string }
  | { kind: "none" };

export type NextFirstTask = { kind: "step"; text: string } | { kind: "read"; questId: string };

export type NextCrew =
  | { kind: "invite"; crewId: string; path: string; size: number }
  | { kind: "start"; questId: string }
  | { kind: "solo" };

export type NextWhen = { kind: "date"; at: string; source: "build_day" | "starts" | "due" } | { kind: "none" };

export interface NextStep {
  talkTo: NextTalkTo;
  firstTask: NextFirstTask;
  crew: NextCrew;
  when: NextWhen;
}

function instant(v: string | null | undefined): string | null {
  if (v == null || String(v).trim() === "") return null;
  const t = new Date(String(v)).getTime();
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

function talkToFor(input: NextStepInput): NextTalkTo {
  const { place, circle } = input;
  if (place?.roleId) {
    return {
      kind: "role",
      roleId: place.roleId,
      circleId: null,
      source: "place",
      vacant: place.state === "open" || place.state === "paused",
      structureKey: place.structureKey,
    };
  }
  if (circle?.leadRoleId) {
    // Vacancy of a circle lead is decided where the roster is read: the
    // server marks it after resolving holders (see server/lib/questNextStep.ts).
    return { kind: "role", roleId: circle.leadRoleId, circleId: circle.circleId, source: "circle", vacant: false, structureKey: null };
  }
  if (circle) return { kind: "circle", circleId: circle.circleId };
  return { kind: "none" };
}

function firstTaskFor(input: NextStepInput): NextFirstTask {
  const first = String(input.quest.firstStep ?? "").trim();
  if (first) return { kind: "step", text: first };
  const step = (input.quest.steps ?? []).map((s) => String(s ?? "").trim()).find((s) => s.length > 0);
  if (step) return { kind: "step", text: step };
  return { kind: "read", questId: input.quest.id };
}

function crewFor(input: NextStepInput): NextCrew {
  if (input.crew) {
    return {
      kind: "invite",
      crewId: input.crew.id,
      // The same shape client/src/lib/crewLinks.ts builds, so the link auto-joins.
      path: `/quests/${encodeURIComponent(input.quest.id)}?crew=${encodeURIComponent(input.crew.inviteCode)}`,
      size: input.crew.size,
    };
  }
  return input.crewAllowed ? { kind: "start", questId: input.quest.id } : { kind: "solo" };
}

function whenFor(input: NextStepInput): NextWhen {
  const day = instant(input.nextBuildDayAt);
  if (day) return { kind: "date", at: day, source: "build_day" };
  const starts = instant(input.quest.startsAt);
  if (starts) return { kind: "date", at: starts, source: "starts" };
  const due = instant(input.quest.dueAt);
  if (due) return { kind: "date", at: due, source: "due" };
  return { kind: "none" };
}

/**
 * What a reply carries: the box, plus the talk-to role's name and live
 * holders' first names, resolved for the reader at the moment of reading and
 * never stored (III.2).
 */
export interface ResolvedNextStep extends NextStep {
  talkToLive: { roleName: string | null; circleName: string | null; holders: string[] } | null;
}

export function nextStepFor(input: NextStepInput): NextStep {
  return {
    talkTo: talkToFor(input),
    firstTask: firstTaskFor(input),
    crew: crewFor(input),
    when: whenFor(input),
  };
}
