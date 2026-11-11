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
import { agentKeySlug, endSeating, seatHolder } from "./orgChart";
import { resolveSeatTerm, type SeatCalendar } from "../../shared/seatTerms";
import type { StoredOpenProposal } from "../repos/openProposals";
import type { Pool } from "mysql2/promise";

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
