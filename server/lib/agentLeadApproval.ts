/**
 * THE SERVER HALF OF THE LEAD-APPROVED WRITES (shared/agentAdmin.ts, LEAD_APPROVED_WRITES).
 *
 * The lead's ruling of 10 and 11 November 2026, binding: "I want you to extend agent powers to be able to make
 * these changes - they're text changes and I'm still approving them here." And on seating: "they should be
 * seated already and this is again one of those powers our connector should have. Especially when I'm giving the
 * approval in chat here - this is the 'human decides' when I give the comment or approval in a prompt here."
 *
 * Two things live here, and the decision itself does not: `leadApprovedBodyProblem` in shared/agentAdmin.ts is
 * pure and decides. This file only reads the facts it needs and leaves the record.
 *
 *   `readLeadSeatFacts`  what a seat carries: every capability on its linked power groups, and whether one of
 *                        them opens the admin panel. Read fresh at both calls of the two-call write.
 *   `recordLeadApproval` one admin-audience event naming who approved the seating and quoting the approval, and
 *                        one notice to every admin and founder, keyed on the spent confirm token so a retry is a
 *                        no-op.
 */
import type { Pool } from "mysql2/promise";
import type { LeadSeatFacts } from "../../shared/agentAdmin";
import { listSeatGroupLinks, liveSeatingHeader, seatHeader } from "../repos/seatPowerGroups";
import { recordEvent } from "./events";

/** A power group as the roles plane holds it, the two fields read here. */
export interface PowerGroupFacts {
  id: string;
  capabilities?: unknown;
  grantsAdmin?: unknown;
}

/** The seat a seating names (by role id) or an unseating names (by seating id), with what it carries. */
export async function readLeadSeatFacts(
  pool: Pool,
  groups: () => readonly PowerGroupFacts[],
  target: { roleId: string } | { seatingId: string },
): Promise<LeadSeatFacts> {
  const none: LeadSeatFacts = { found: false, isExample: false, capabilities: [], grantsAdmin: false };
  let roleId: string;
  let seating: Awaited<ReturnType<typeof liveSeatingHeader>> = null;
  if ("seatingId" in target) {
    seating = await liveSeatingHeader(pool, target.seatingId);
    if (!seating) return none;
    roleId = seating.orgRoleId;
  } else {
    roleId = target.roleId;
  }
  const seat = await seatHeader(pool, roleId);
  if (!seat) return none;
  const linked = (await listSeatGroupLinks(pool)).filter((l) => l.orgRoleId === seat.id).map((l) => l.roleId);
  const byId = new Map(groups().map((g) => [String(g.id), g]));
  const capabilities = new Set<string>();
  let grantsAdmin = false;
  for (const id of linked) {
    const g = byId.get(id);
    // A link to a group that cannot be read is treated as carrying the most, which is the safe direction.
    if (!g) {
      grantsAdmin = true;
      continue;
    }
    for (const c of Array.isArray(g.capabilities) ? g.capabilities : []) capabilities.add(String(c));
    if (g.grantsAdmin === true) grantsAdmin = true;
  }
  return {
    found: true,
    roleId: seat.id,
    isExample: seat.isExample || !!seating?.isExample,
    capabilities: Array.from(capabilities),
    grantsAdmin,
    ...(seating ? { seatingIsAgent: seating.isAgent, seatingUserId: seating.userId } : {}),
  };
}

export interface LeadApprovalRecord {
  kind: "seat" | "unseat";
  roleId: string | null;
  path: string;
  approvedBy: string;
  approvalNote: string;
  /** One key per write: derived from the spent confirm token. */
  writeKey: string;
}

/** The event and the notices a seating or unseating through the connector leaves. */
export async function recordLeadApproval(
  deps: {
    pool: Pool;
    agentUserId: string;
    tokenPrefix: string;
    notifyAdmins: (type: string, title: string, dedupeKey: string, link?: string) => Promise<void>;
  },
  a: LeadApprovalRecord,
): Promise<void> {
  const act = a.kind === "seat" ? "seated a person" : "ended a seating";
  // The approval can name people, so the line is admin-audience, and it names the agent as the actor.
  await recordEvent(deps.pool, {
    kind: "audit",
    text: `connector (${deps.tokenPrefix}...) ${act} in ${a.roleId ?? "a role"} with approval from ${a.approvedBy}: "${a.approvalNote.slice(0, 1000)}"`,
    actorUserId: deps.agentUserId,
    actorKind: "agent",
    entityType: "org_role",
    entityRef: a.roleId ?? a.path.slice(0, 64),
    audience: "admin",
  });
  await deps.notifyAdmins(
    "governance",
    `Our agent ${act} in ${a.roleId ?? "a role"}, approved by ${a.approvedBy.slice(0, 80)}`,
    `agent-lead-${a.kind}:${a.writeKey}`,
    "/admin",
  );
}
