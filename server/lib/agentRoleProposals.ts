/**
 * AN AGENT PROPOSED FOR A ROLE, AND SEATED WHEN THE CIRCLE ADOPTS IT (0374;
 * the lead, 11 Nov 2026: humans AND agents can apply for and fill roles).
 * The words and the rules are shared/agentHolders.ts; the member door is
 * server/routes/agentRoleProposals.ts; adoption is the decider page's own adopt
 * door (server/routes/openProposalDecide.ts), which calls `seatAdoptedAgent`.
 *
 * ── THE SAME PROPOSAL A PERSON'S IS ─────────────────────────────────────────
 *
 * An agent's proposal is a row in `open_role_proposals` with `body.agent`, so
 * the circle is asked by `confirmAndAsk`, the review begins as it does for a
 * person, and the page, consent, adoption and decline are the decider page's.
 * Its keeper is the proposal's own account (`ownAccountOf`): never asked,
 * never deciding. It is confirmed at once: the keeper is signed in, so there
 * is no address to prove.
 *
 * ── SEATED THROUGH THE ONE AGENT SEATING PATH ───────────────────────────────
 *
 * `seatHolder` with `isAgent`, an `agentSlug` and NO user id, exactly as the
 * admin's agent seating does: a documented holder keyed `agent:<slug>`, which
 * the settlement job's `holder_kind = 'member'` filter and the declare door
 * never see. The keeper rides on the seating (`keeper_user_id`) so the chart
 * can say who keeps it. The adopt door asks `org.seatAgent` on top of the
 * raised-hand rule over `org.seat`, as the admin door asks both.
 */
import { agentKeySlug, endSeating, listOrgAssignments, seatHolder } from "./orgChart";
import { resolveSeatTerm, type SeatCalendar } from "../../shared/seatTerms";
import { listOpenProposals, type StoredOpenProposal } from "../repos/openProposals";
import type { Pool } from "mysql2/promise";

/**
 * WHO THE DATA SAYS KEEPS THIS AGENT (audit B8c, 11 Nov 2026). Nothing on the
 * agent's account records a keeper: an admin marks an existing account as an
 * agent's and no creator or owner column exists. So keeping is read from what
 * the village has already recorded about the agent:
 *
 *   - a live seating of the agent (`agent:<slug>`) with `keeper_user_id`;
 *   - a proposal for it that is waiting or was adopted, with its keeper.
 *
 * An agent nobody has recorded as kept may be proposed by any member, and that
 * proposal is then the record. One with a recorded keeper is proposed only by
 * that keeper, so no member can say they keep somebody else's agent.
 */
export async function recordedKeepers(pool: Pool, agent: { id: string; name: string }): Promise<Set<string>> {
  const keepers = new Set<string>();
  const key = `agent:${agentKeySlug(agent.name || agent.id)}`;
  for (const a of await listOrgAssignments(pool)) {
    if (a.isAgent && !a.endedAt && a.holderKey === key && a.keeperUserId) keepers.add(a.keeperUserId);
  }
  for (const p of await listOpenProposals(pool, ["confirmed", "adopted"], 2000)) {
    if (p.body.agent?.agentUserId === agent.id && p.body.agent.keeperUserId) keepers.add(p.body.agent.keeperUserId);
  }
  return keepers;
}

/** Whether this member may say they keep the agent: nobody recorded yet, or only them. */
export function mayKeep(keepers: ReadonlySet<string>, memberId: string): boolean {
  return Array.from(keepers).every((k) => k === memberId);
}

/**
 * THE ROLES THIS AGENT IS ALREADY ON THE WAY TO, OR IN (audit B8b): a proposal
 * for it still waiting on the circle, or a live seating. Proposing it again for
 * one of these is refused, so the circle never weighs the same agent twice.
 */
export async function rolesAlreadyAsked(pool: Pool, agent: { id: string; name: string }, roleIds: readonly string[]): Promise<string[]> {
  const wanted = new Set(roleIds);
  const hit = new Set<string>();
  for (const p of await listOpenProposals(pool, ["unconfirmed", "confirmed"], 2000)) {
    if (p.body.agent?.agentUserId !== agent.id) continue;
    for (const r of p.body.roles) if (wanted.has(r.roleId)) hit.add(r.roleId);
  }
  const key = `agent:${agentKeySlug(agent.name || agent.id)}`;
  for (const a of await listOrgAssignments(pool)) {
    if (a.isAgent && !a.endedAt && a.holderKey === key && wanted.has(a.orgRoleId)) hit.add(a.orgRoleId);
  }
  return Array.from(hit);
}

export type SeatedAgent = { ok: true; seated: number } | { ok: false; error: string };

/**
 * Seat the agent of an adopted proposal on each of its roles, or on none: a
 * role that refuses (its card now says a person, it is full, the agent already
 * holds it) ends the seatings already made in this call and says why.
 */
export async function seatAdoptedAgent(
  pool: Pool,
  p: { proposal: StoredOpenProposal; adopterId: string; calendar: SeatCalendar; now: Date },
): Promise<SeatedAgent> {
  const agent = p.proposal.body.agent;
  if (!agent) return { ok: false, error: "This proposal is not an agent's." };
  const slug = agentKeySlug(agent.name || agent.agentUserId);
  // The term: the moon it was proposed for, else the target season's end, else the running season's.
  const target = p.calendar.seasons.find((s) => s.id === p.proposal.targetSeasonId);
  const requestedEndsOn = p.proposal.body.term?.endsOn ?? (target && target.id !== p.calendar.currentSeasonId ? (target.endsOn ?? null) : null);
  const term = resolveSeatTerm({ requestedEndsOn, calendar: p.calendar, capAtSeasonEnd: false, now: p.now });
  if (!term.ok) return { ok: false, error: term.error };
  const made: string[] = [];
  for (const r of p.proposal.body.roles) {
    const out = await seatHolder(pool, r.roleId, {
      isAgent: true,
      agentSlug: slug,
      displayName: agent.name,
      keeperUserId: agent.keeperUserId,
      grantedBy: p.adopterId,
      seasonId: term.seasonId,
      termEndsAt: term.endsAt,
      termFollowsSeason: term.followsSeason,
    });
    if (!out.ok || !out.assignmentId) {
      for (const id of made) await endSeating(pool, id, "the adoption could not place it on every role");
      return { ok: false, error: out.reason ?? "The agent could not be seated." };
    }
    made.push(out.assignmentId);
  }
  return { ok: true, seated: made.length };
}
