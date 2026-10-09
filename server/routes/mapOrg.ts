/**
 * The village's live organisation, for the Living Map to follow (Rye, D3).
 *
 *   GET /api/map/org   circles, active seats, their state and (by tier) holders
 *
 * The map polls this while it is on screen and stops while the tab is hidden
 * (client/src/components/map/orgFollow.ts). Every answer carries a version
 * and an ETag, and a reader who sends the version back gets a bodyless 304
 * until something the map would draw has changed. The projection and the
 * version are server/lib/mapOrg.ts, which says why the version is a hash of
 * the answer and not a counter.
 *
 * WHY A POLL AND NOT A PUSH. There is no push channel to a browser in this
 * server today (the one stream is Saberra's, and it is a client), and every
 * route here authenticates by a Bearer header, which an EventSource cannot
 * send. A versioned GET on a timer goes through the same gate as every other
 * read, survives a proxy that buffers, and costs one round trip and no body
 * when nothing moved. A seat created in the org tools reaches an open map
 * within one interval, which is the whole requirement.
 *
 * THE TIERS ARE `/api/map`'s, asked the same way through the one capability
 * gate: a visitor reads structure only while `map.public_structure` allows it,
 * and holder names ride only for an admin or a reader holding
 * `map.viewPeople`. Two tiers read two different bodies, so they carry two
 * different versions and a cached answer can never cross between them.
 *
 * Behind `requireModule("map")` because it is registered after the
 * `app.use("/api/map", ...)` that gates the prefix.
 */
import type { Express } from "express";
import { hasCapability } from "../../shared/capabilities";
import type { AppDeps } from "../lib/appDeps";
import { etagHits, mapOrgEtag, projectMapOrg } from "../lib/mapOrg";
import { listOrgAssignments, listOrgRoles } from "../lib/orgChart";
import { boolVar } from "../lib/variables";

type Deps = Pick<
  AppDeps,
  "authedUser" | "isAdmin" | "capabilityCtx" | "circlesRepo" | "members" | "firstName" | "lapseContext" | "getPool"
>;

export function register(app: Express, deps: Deps): void {
  const { authedUser, isAdmin, capabilityCtx, circlesRepo, members, firstName, lapseContext, getPool } = deps;

  app.get("/api/map/org", async (req, res) => {
    const viewer = await authedUser(req);
    let viewPeople = await isAdmin(req);
    if (!viewPeople && viewer) viewPeople = hasCapability("map.viewPeople", await capabilityCtx(viewer));
    if (!viewer && !boolVar("map.public_structure")) {
      return res.status(401).json({ error: "auth_required", message: "Sign in to see the village map" });
    }
    const [roles, assignments] = await Promise.all([
      listOrgRoles(getPool()),
      listOrgAssignments(getPool(), lapseContext()),
    ]);
    // Names are read only when a name will be sent: a visitor's poll never
    // touches the users table.
    const people = viewPeople && assignments.some((a) => a.userId) ? await members.all() : [];
    const nameOf = new Map(people.map((u: any) => [String(u.id), firstName(u.name ?? "Member")]));
    const snapshot = projectMapOrg({
      circles: circlesRepo.all() as any[],
      roles,
      assignments,
      viewPeople,
      memberName: (id) => nameOf.get(id) ?? firstName("Member"),
    });
    res.setHeader("ETag", mapOrgEtag(snapshot.version));
    // Revalidate every time, and never share: the body depends on who asks.
    res.setHeader("Cache-Control", "private, no-cache");
    res.setHeader("Vary", "Authorization");
    if (etagHits(req.headers["if-none-match"], snapshot.version)) return res.status(304).end();
    res.json(snapshot);
  });
}
