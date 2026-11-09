/**
 * The Admin helper's one village reader (server/routes/adminHelper.ts): the
 * SHAPE of the org chart. Kept out of server/index.ts, which only hands it its
 * sources.
 *
 * Structure only (the coordinator's guardrail, 2026-11-09): roles, their aims
 * and circles, how many seats each takes and how many are filled, and the
 * circles. No person, no name, no term dates, no pay. The assignments are read
 * for a COUNT and nothing else leaves this function.
 */
import type { CircleView } from "../../shared/circleView";
import type { OrgAssignment, OrgRole } from "./orgChart";

export function orgStructureForHelper(input: {
  roles: readonly OrgRole[];
  assignments: readonly Pick<OrgAssignment, "orgRoleId">[];
  circles: readonly CircleView[];
}) {
  const circleName = new Map(input.circles.map((c) => [c.id, c.name]));
  const filled = new Map<string, number>();
  for (const a of input.assignments) filled.set(a.orgRoleId, (filled.get(a.orgRoleId) ?? 0) + 1);
  return {
    roles: input.roles
      .filter((r) => !r.isExample)
      .map((r) => ({
        role: r.name,
        circle: r.circleId ? circleName.get(r.circleId) ?? null : null,
        aim: r.aim ? r.aim.slice(0, 200) : null,
        seats: r.seats,
        filled: filled.get(r.id) ?? 0,
        active: r.active,
      })),
    circles: input.circles
      .filter((c) => !c.isExample)
      .map((c) => ({ name: c.name, purpose: c.purpose ? c.purpose.slice(0, 200) : null, status: c.status })),
  };
}
