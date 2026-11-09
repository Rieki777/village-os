/**
 * The Admin helper's two village readers (server/routes/adminHelper.ts): the
 * org chart and the requests still waiting. Kept out of server/index.ts, which
 * only hands them their sources.
 *
 * First names only, and no contact details at all: the result goes to a model
 * provider, and the admin asking can open the full record in Admin anyway.
 */
import type { CircleView } from "../../shared/circleView";
import type { OrgAssignment, OrgRole } from "./orgChart";

const firstName = (name: unknown) => String(name ?? "").trim().split(/\s+/)[0] || "Member";

/** Roles with their holders written "Role (FirstName)", plus the circles. */
export function orgForHelper(input: {
  roles: readonly OrgRole[];
  assignments: readonly (OrgAssignment & { lapsed?: boolean })[];
  nameOf(userId: string): string | null;
  circles: readonly CircleView[];
}) {
  const circleName = new Map(input.circles.map((c) => [c.id, c.name]));
  return {
    roles: input.roles
      .filter((r) => !r.isExample)
      .map((r) => {
        const holders = input.assignments
          .filter((a) => a.orgRoleId === r.id)
          .map((a) => firstName(a.userId ? input.nameOf(a.userId) ?? a.displayName : a.displayName) + (a.lapsed ? " (term ran out)" : ""));
        return {
          role: r.name,
          shown: holders.length ? holders.map((h) => `${r.name} (${h})`) : [`${r.name} (open)`],
          circle: r.circleId ? circleName.get(r.circleId) ?? null : null,
          aim: r.aim ? r.aim.slice(0, 200) : null,
          seats: r.seats,
          held: holders.length,
          active: r.active,
          recruiting: r.recruiting,
        };
      }),
    circles: input.circles
      .filter((c) => !c.isExample)
      .map((c) => ({ name: c.name, purpose: c.purpose ? c.purpose.slice(0, 200) : null, status: c.status })),
  };
}

const SETTLED = new Set(["accepted", "declined"]);

/** Requests still waiting on a steward, newest first, at most 25. */
export function requestsForHelper(rows: readonly any[]) {
  const waiting = rows.filter((r) => !SETTLED.has(String(r?.status || "new").toLowerCase()));
  return {
    waiting: waiting.length,
    newest: waiting
      .slice()
      .sort((a, b) => new Date(b?.submittedAt ?? 0).getTime() - new Date(a?.submittedAt ?? 0).getTime())
      .slice(0, 25)
      .map((r) => ({
        kind: String(r?.type ?? "request"),
        from: firstName(r?.name),
        status: String(r?.status || "new"),
        arrived: r?.submittedAt ? String(r.submittedAt).slice(0, 10) : null,
      })),
    where: "Admin, Inbox",
  };
}
