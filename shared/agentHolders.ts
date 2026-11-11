/**
 * HUMANS AND AGENTS CAN APPLY FOR AND FILL ROLES (the lead, 11 Nov 2026: "the
 * Sera Secretary role IS held by Sera ... let's build this in that humans AND
 * agents can apply for and fill roles").
 *
 * Three things live here, pure, for the server and the client alike:
 *
 *   WHO MAY HOLD A ROLE. A role card says `person`, `agent` or `either`
 *   (org_roles.held_by, 0374). A card that has not said reads as `either`,
 *   because that is what every role already allowed: a person applies exactly
 *   as before, and an admin holding `org.seatAgent` could already seat an
 *   agent on any role. So the default changes nothing for people.
 *   `seatHolder` (server/lib/orgChart.ts) is the one place that refuses a
 *   holder the card does not allow, so every door that seats inherits it.
 *
 *   AN AGENT IS PROPOSED BY ITS KEEPER. An agent never proposes on its own
 *   say. A member who keeps the agent (and says so) proposes it from the
 *   member door, and is recorded on the proposal as its keeper. The proposal
 *   is an ordinary open proposal (`open_role_proposals`), so the circle asks,
 *   the review and the decider page are the ones a person's goes through.
 *   It carries no references, no background check, no confidentiality
 *   signature, no character and no personal details. It carries what the
 *   agent is, who keeps it, what it can reach and how to switch it off.
 *
 *   DECIDING STAYS HUMAN. Adoption is the circle's, by consent, recorded by a
 *   live holder of `org.seat`, and seating the agent also asks `org.seatAgent`.
 *   An agent account never proposes, adopts, seats or unseats.
 *
 * No AI selects, ranks or scores any applicant here, person or agent.
 */

// ── Who may hold a role ────────────────────────────────────────────────────

export const HELD_BY = ["person", "agent", "either"] as const;
export type HeldBy = (typeof HELD_BY)[number];

/** What a role card that has not said reads as. Changes nothing for people (see the header). */
export const HELD_BY_DEFAULT: HeldBy = "either";

/** The stored value, or null for a card that has not said. Anything unreadable is not said. */
export function readHeldBy(raw: unknown): HeldBy | null {
  const v = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  return (HELD_BY as readonly string[]).includes(v) ? (v as HeldBy) : null;
}

/** What the role allows, a card that has not said read as the default. */
export function heldByOf(raw: unknown): HeldBy {
  return readHeldBy(raw) ?? HELD_BY_DEFAULT;
}

/** Whether a holder of this kind may hold a role whose card says `heldBy`. */
export function mayHold(heldBy: unknown, kind: "person" | "agent"): boolean {
  const h = heldByOf(heldBy);
  return h === "either" || h === kind;
}

export const HELD_BY_WORDS: Record<HeldBy, string> = {
  person: "A person",
  agent: "An agent",
  either: "A person or an agent",
};

export const HELD_BY_LABEL = "Who can hold it";

/** The directory's chip, for a role card that says an agent may hold it. */
export const AGENT_MAY_HOLD_CHIP = "Can be held by an agent";

/** Why a seating was refused because of the card. */
export const HELD_BY_REFUSAL: Record<"person" | "agent", string> = {
  person: "This role's card says it is held by an agent, so a person is not seated on it.",
  agent: "This role's card says it is held by a person, so an agent is not seated on it.",
};

// ── What an agent can reach ────────────────────────────────────────────────

/**
 * The agent's reach in words, one per token scope it holds live (the closed
 * vocabulary in server/lib/agentTokens.ts). Third person: these are read by
 * the circle about somebody else's agent. A scope with no sentence here is
 * shown by its own name, so a new scope is never hidden.
 */
export const AGENT_SCOPE_WORDS: Readonly<Record<string, string>> = {
  "calendar.read": "Reads the calendar",
  "directory.read": "Reads circles, roles and the people its account may see",
  "me.read": "Reads its own profile",
  "rsvp.write": "Answers a gathering, after a yes",
  "intents.write": "Posts what it seeks or offers, after a yes",
  "map.draft": "Reads the masterplan and drafts the map for a person to publish",
  "moon.read": "Reads its own moon, roles, the season and task board",
  "tasks.write": "Marks its own board tasks, after a yes",
  admin: "Calls the admin paths the village has opened to agents",
  "sera.undoable": "Links people, suggests tasks and moon items, drafts agenda items and switches boards, each one undoable for 30 days",
  "moon.write": "Drafts its own moon recap, after a yes",
  "moon.review": "Reads the review queue and the role signals, never with amounts",
  "roles.read": "Reads the chart",
  "roles.propose": "Proposes a role change or a seating that waits for a person",
  "letters.draft": "Drafts a letter that waits for a person to send it",
  "applicants.read": "Reads the applicants waiting on its holder, with no contact details",
  "onboarding.write": "Writes its own onboarding path items",
  "settings.propose": "Proposes a setting change that waits for a person",
  "listing.propose": "Proposes a listing change that waits for a person",
  "pages.propose": "Proposes a page change that waits for a person",
  "map.propose": "Proposes a map change that waits for a person",
};

export function scopeWords(scope: string): string {
  return AGENT_SCOPE_WORDS[scope] ?? scope;
}

// ── The proposal ───────────────────────────────────────────────────────────

export const AGENT_WHAT_MAX = 600;
export const AGENT_SWITCH_OFF_MAX = 600;

/** What an agent proposal carries in `open_role_proposals.body_json.agent`. */
export interface AgentProposalPart {
  /** The agent's account here (users.is_agent = 1). The seating itself carries no account (orgChart.ts). */
  agentUserId: string;
  /** The agent's name as its account had it when proposed. */
  name: string;
  /** What the agent is, in its keeper's words. */
  what: string;
  /** How to switch it off, in its keeper's words. */
  switchOff: string;
  /** The member who keeps it and proposed it. */
  keeperUserId: string;
}

const line = (v: unknown, max: number): string => String(typeof v === "string" ? v : "").trim().slice(0, max + 1);

/** The stored part, read tolerantly, or null when it is not an agent proposal. */
export function agentPartOf(raw: unknown): AgentProposalPart | null {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
  if (!o) return null;
  const agentUserId = line(o.agentUserId, 64);
  const keeperUserId = line(o.keeperUserId, 64);
  if (!agentUserId || !keeperUserId) return null;
  return {
    agentUserId,
    keeperUserId,
    name: line(o.name, 120).slice(0, 120),
    what: line(o.what, AGENT_WHAT_MAX).slice(0, AGENT_WHAT_MAX),
    switchOff: line(o.switchOff, AGENT_SWITCH_OFF_MAX).slice(0, AGENT_SWITCH_OFF_MAX),
  };
}

export const AGENT_PROPOSAL_WORDS = {
  title: "Propose an agent for this role",
  proposeThisRole: "Propose an agent for this role",
  intro: "An agent never proposes itself. You propose it on its behalf, as the member who keeps it, and the circle decides by consent, the way it does for a person.",
  membersOnly: "Proposing an agent for a role opens at the member rung.",
  signIn: "Sign in to propose an agent.",
  notByAnAgent: "An agent never proposes on its own say. A person who keeps it proposes it.",
  needAgent: "Pick the agent you are proposing.",
  notAnAgent: "That account is not an agent's.",
  needKeeper: "Only the member who keeps the agent proposes it. Say that you keep it.",
  needWhat: "Say what the agent is.",
  needSwitchOff: "Say how to switch it off.",
  needRole: "Pick a role for the agent.",
  unknownRole: "That role is not one the village is filling now.",
  personOnly: "This role's card says it is held by a person, so an agent cannot be proposed for it.",
  needWhy: "Say why this agent suits the role.",
  tooLong: (field: string, max: number) => `${field} is at most ${max} characters.`,
  noSeason: "There is no season on the village's calendar to propose for yet.",
  noAgents: "There are no agent accounts in the village yet. An admin marks an account as an agent's first.",
  sent: "Sent. The circle is asked to consent, and you will hear when it is decided.",
  tooMany: "That is a lot of proposals for now. Try again in a little while.",
  sectionHeading: "The agent",
  whatLabel: "What it is",
  keeperLabel: "Who keeps it",
  reachLabel: "What it can reach",
  reachNone: "It holds no live access token, so it reaches nothing through the village's connector today.",
  switchOffLabel: "How to switch it off",
  switchOffPlatform: "An admin who is a person can end its access at once: Admin, Agents, mark the account as a person's again, which ends every token it holds. Whoever fills the village's roles can also take it off the role.",
  adoptedSeated: (n: number) => `Adopted. The agent is seated on ${n === 1 ? "the role" : `${n} roles`}, marked as an agent, with its keeper beside it.`,
  keeperTold: (agent: string, roles: string[]) => `The circle adopted ${agent} for ${roles.join(", ")}`,
  keeperDeclined: (agent: string, roles: string[]) => `The circle declined ${agent} for ${roles.join(", ")}`,
  noLongerAnAgent: "That account is no longer marked as an agent's, so nothing was seated.",
  agentNeverDecides: "An agent account never adopts or declines a proposal. A person does.",
  declined: "Declined. Its keeper has been told.",
} as const;

// ── Reading what the member door sent ──────────────────────────────────────

export interface AgentProposalInput {
  agentUserId: string;
  what: string;
  switchOff: string;
  why: string;
  aim: string;
  roles: Array<{ roleId: string; note: string }>;
}

export type AgentParsed = { ok: true; value: AgentProposalInput } | { ok: false; field: string; error: string; status: number };

/**
 * What the keeper sent, checked. `roles` are the roles the village fills now, each with what its card
 * says about who may hold it. The keeper's own "I keep this agent" is required: it is what records them
 * as responsible for it. Limits are the person's form's, so the two read the same.
 */
export function parseAgentProposal(
  raw: unknown,
  ctx: { roles: ReadonlyArray<{ id: string; heldBy: unknown }>; maxRoles: number; noteMax: number; whyMax: number; aimMax: number },
): AgentParsed {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const W = AGENT_PROPOSAL_WORDS;
  const agentUserId = line(o.agentUserId, 64);
  if (!agentUserId) return { ok: false, field: "agent", error: W.needAgent, status: 400 };
  if (o.keeper !== true) return { ok: false, field: "keeper", error: W.needKeeper, status: 400 };
  const what = line(o.what, AGENT_WHAT_MAX);
  if (!what) return { ok: false, field: "what", error: W.needWhat, status: 400 };
  if (what.length > AGENT_WHAT_MAX) return { ok: false, field: "what", error: W.tooLong("What it is", AGENT_WHAT_MAX), status: 400 };
  const switchOff = line(o.switchOff, AGENT_SWITCH_OFF_MAX);
  if (!switchOff) return { ok: false, field: "switchOff", error: W.needSwitchOff, status: 400 };
  if (switchOff.length > AGENT_SWITCH_OFF_MAX) return { ok: false, field: "switchOff", error: W.tooLong("How to switch it off", AGENT_SWITCH_OFF_MAX), status: 400 };
  const picked = Array.isArray(o.roles) ? o.roles : typeof o.roleId === "string" ? [{ roleId: o.roleId }] : [];
  if (!picked.length) return { ok: false, field: "roles", error: W.needRole, status: 400 };
  if (picked.length > ctx.maxRoles) return { ok: false, field: "roles", error: W.needRole, status: 400 };
  const roles: AgentProposalInput["roles"] = [];
  for (const r of picked as any[]) {
    const roleId = line(r?.roleId, 64);
    const role = ctx.roles.find((x) => x.id === roleId);
    if (!role) return { ok: false, field: "roles", error: W.unknownRole, status: 400 };
    if (!mayHold(role.heldBy, "agent")) return { ok: false, field: "roles", error: W.personOnly, status: 409 };
    if (roles.some((x) => x.roleId === roleId)) continue;
    const note = line(r?.note, ctx.noteMax);
    if (note.length > ctx.noteMax) return { ok: false, field: "roles", error: W.tooLong("What it brings to the role", ctx.noteMax), status: 400 };
    roles.push({ roleId, note });
  }
  const why = line(o.why, ctx.whyMax);
  if (!why) return { ok: false, field: "why", error: W.needWhy, status: 400 };
  if (why.length > ctx.whyMax) return { ok: false, field: "why", error: W.tooLong("Why this agent", ctx.whyMax), status: 400 };
  const aim = line(o.aim, ctx.aimMax);
  if (aim.length > ctx.aimMax) return { ok: false, field: "aim", error: W.tooLong("Its aim", ctx.aimMax), status: 400 };
  return { ok: true, value: { agentUserId, what, switchOff, why, aim, roles } };
}
