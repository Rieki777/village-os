/**
 * Which Power groups an org seat carries (0322; ROLE_POWERS_DESIGN.md §3, §4).
 *
 *   GET /api/admin/org-roles/:id/power-groups   the seat's links, and every group it could carry
 *   PUT /api/admin/org-roles/:id/power-groups   { roleIds: string[] }, the whole set
 *
 * What a link MEANS lives in server/lib/seatGrants.ts: whoever holds the seat,
 * right now, holds the group. This module decides who may change the links and
 * refuses the changes that would break a rule the group plane already keeps.
 *
 * ── WHO MAY CHANGE THEM, FOR NOW ───────────────────────────────────────────
 *
 * An admin, as `PUT /api/admin/roles/:id/capabilities` asks today. Linking a
 * group to a seat hands its powers to whoever sits there, which is the same act
 * as editing that group's list, so it cannot be easier to reach. The design
 * moves this to holders of a new `power.assign` key (§6); that is its own
 * change, and this route is the one it swaps.
 *
 * ── WHAT IT REFUSES ────────────────────────────────────────────────────────
 *
 *   - a group carrying `steward.veto`, either way. The steward's seat is filled
 *     and emptied by the `role_seat` and `role_unseat` ballots and by nothing
 *     else (server/lib/roleGrants.ts), and a link is a seating by another name.
 *   - an example seat or an example group.
 *   - a group with admin access, before the Game starts, from anybody but a
 *     founder: the rule `PUT /api/admin/roles/:id/admin-access` keeps.
 *   - an unlink that would leave nobody able to open the admin panel, by the
 *     same count the role and departure routes use.
 *
 * A NEW MODULE, NOT A NEW LINE IN server/index.ts: route modules are free on
 * the index ratchet by construction.
 */
import type { Express, Request, Response, NextFunction } from "express";
import type { Pool } from "mysql2/promise";
import { recordEvent } from "../lib/events";
import { holdingHasLapsed } from "../lib/stewardship";
import { founderPowerStands } from "../lib/gameStart";
import { EXAMPLE_REFUSAL_BODY, isExampleUser } from "../lib/examples";
import { accountsWithReach, LAST_ADMIN_REFUSAL, type AdminGroup, type GroupHolding } from "../lib/groupAdmin";
import { stewardSeatRefusal } from "../lib/roleGrants";
import {
  bridgedHoldings,
  effectiveHoldings,
  listSeatGroupLinks,
  type SeatGrantCache,
} from "../lib/seatGrants";
import { onSeatingsChanged, type LapseContext } from "../lib/orgChart";
import { CAPABILITY_CONSEQUENCE } from "../../shared/draftKinds";
import type { Capability } from "../../shared/capabilities";

interface Deps {
  isAdmin(req: any): Promise<boolean>;
  getPool(): Pool;
  members: { all(): Promise<any[]> };
  rolesRepo: { all(): any[] };
  loadRoleHolders(): GroupHolding[];
  lapseContext(): LapseContext;
  seatGrants: SeatGrantCache;
  addActivity(kind: string, text: string, extra?: { actorUserId?: string | null; entityType?: string | null; entityRef?: string | null }): Promise<void>;
}

/**
 * Keep the seat grants fresh for every API request. Registered before the
 * routes, so the synchronous gate reads a snapshot at most `maxAgeMs` old. A
 * village with no links pays one small query a second at most. Also refreshed
 * at boot and every `everyMs`, for the jobs and closers that run outside a request.
 */
export function registerSeatGrantFreshness(app: Express, cache: SeatGrantCache, everyMs = 30_000): void {
  // At boot, and on a timer for the jobs and closers that run outside a request.
  void cache.refresh();
  setInterval(() => void cache.refresh(), everyMs).unref();
  // A seating written anywhere marks the snapshot stale, so a power ends on the next request.
  onSeatingsChanged(() => cache.invalidate());
  app.use("/api", (_req: Request, _res: Response, next: NextFunction) => {
    cache.ensureFresh().then(() => next(), () => next());
  });
}

export function register(app: Express, deps: Deps): void {
  const { isAdmin, getPool, members, rolesRepo, loadRoleHolders, lapseContext, seatGrants, addActivity } = deps;

  async function seatRow(id: string): Promise<{ id: string; name: string; isExample: boolean } | null> {
    const [rows]: any = await getPool().query("SELECT id, name, is_example FROM org_roles WHERE id = ?", [id]);
    const r = (rows as any[])[0];
    return r ? { id: String(r.id), name: String(r.name), isExample: !!r.is_example } : null;
  }

  app.get("/api/admin/org-roles/:id/power-groups", async (req, res) => {
    if (!(await isAdmin(req))) return res.status(401).json({ error: "auth_required" });
    const seat = await seatRow(String(req.params.id));
    if (!seat) return res.status(404).json({ error: "Role not found" });
    const linked = (await listSeatGroupLinks(getPool())).filter((l) => l.orgRoleId === seat.id).map((l) => l.roleId);
    res.json({
      seat,
      roleIds: linked,
      groups: rolesRepo.all().map((g: any) => ({
        id: g.id,
        name: g.name ?? g.id,
        capabilities: (g.capabilities ?? []) as string[],
        grantsAdmin: g.grantsAdmin === true,
        isExample: !!g.isExample,
        linked: linked.includes(g.id),
      })),
    });
  });

  app.put("/api/admin/org-roles/:id/power-groups", async (req, res) => {
    if (!(await isAdmin(req))) return res.status(401).json({ error: "auth_required" });
    const actor = (req as any).adminUser;
    if (!Array.isArray(req.body?.roleIds)) return res.status(400).json({ error: "Send roleIds: the list of Power group ids this role carries" });
    const wanted = Array.from(new Set((req.body.roleIds as unknown[]).map(String)));
    const seat = await seatRow(String(req.params.id));
    if (!seat) return res.status(404).json({ error: "Role not found" });
    if (seat.isExample) return res.status(409).json(EXAMPLE_REFUSAL_BODY);

    const groups = rolesRepo.all() as any[];
    const byId = new Map(groups.map((g) => [String(g.id), g]));
    const before = (await listSeatGroupLinks(getPool())).filter((l) => l.orgRoleId === seat.id).map((l) => l.roleId);
    const added = wanted.filter((id) => !before.includes(id));
    const removed = before.filter((id) => !wanted.includes(id));

    for (const id of added) {
      const g = byId.get(id);
      if (!g) return res.status(404).json({ error: `There is no Power group called ${id}` });
      if (g.isExample) return res.status(409).json(EXAMPLE_REFUSAL_BODY);
    }
    for (const id of [...added, ...removed]) {
      const locked = stewardSeatRefusal(byId.get(id));
      if (locked) return res.status(locked.status).json(locked.body);
    }
    if (added.some((id) => byId.get(id)?.grantsAdmin === true) && (await founderPowerStands(getPool())) && actor?.role !== "founder") {
      return res.status(403).json({ error: "Until the village starts its Game, only a founder decides which roles can open the admin panel" });
    }
    if (removed.some((id) => byId.get(id)?.grantsAdmin === true)) {
      // The state the change WOULD leave: this seat's links as asked, every other link as it is.
      const snap = seatGrants.snapshot();
      const after = {
        ...snap,
        links: [...snap.links.filter((l) => l.orgRoleId !== seat.id), ...wanted.map((roleId) => ({ orgRoleId: seat.id, roleId }))],
      };
      const holdings = effectiveHoldings(loadRoleHolders(), bridgedHoldings(after, lapseContext()));
      if (!accountsWithReach(await members.all(), groups as AdminGroup[], holdings, new Date(), holdingHasLapsed, isExampleUser).length) {
        return res.status(409).json({ error: LAST_ADMIN_REFUSAL });
      }
    }

    if (added.length || removed.length) {
      const conn = await getPool().getConnection();
      try {
        await conn.beginTransaction();
        if (removed.length) await conn.query("DELETE FROM org_role_power_groups WHERE org_role_id = ? AND role_id IN (?)", [seat.id, removed]);
        for (const id of added) {
          await conn.query("INSERT IGNORE INTO org_role_power_groups (org_role_id, role_id, created_by) VALUES (?, ?, ?)", [seat.id, id, actor?.id ?? null]);
        }
        await conn.commit();
      } catch (err) {
        await conn.rollback();
        throw err;
      } finally {
        conn.release();
      }
      // The gate reads the cache synchronously: refresh before answering, so
      // the very next request already sees the change.
      await seatGrants.refresh();
      void recordEvent(getPool(), {
        kind: "audit",
        text: `org_role:groups:${seat.id}:+${added.join("|") || "none"}:-${removed.join("|") || "none"}`,
        actorUserId: actor?.id ?? null,
        entityType: "org_role",
        entityRef: seat.id,
        audience: "admin",
      });
      // The village hears about a power arriving, as it does on the group
      // route; removals stay in the admin trail for the reason given there.
      const caps = Array.from(new Set(added.flatMap((id) => (byId.get(id)?.capabilities ?? []) as string[])));
      if (caps.length) {
        await addActivity(
          "governance",
          `${seat.name} can now ${caps.map((c) => CAPABILITY_CONSEQUENCE[c as Capability] ?? c).join(", and ")}.`,
          { actorUserId: actor?.id ?? null, entityType: "org_role", entityRef: seat.id },
        );
      }
    }
    res.json({ id: seat.id, roleIds: wanted, added, removed });
  });
}
