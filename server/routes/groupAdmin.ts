/**
 * The "Admin access" switch on a power group (sheet 19, 0307).
 *
 *   PUT /api/admin/roles/:id/admin-access   { on: boolean }
 *
 * What the switch means is server/lib/groupAdmin.ts. This route only decides
 * who may flip it and refuses the one flip that would lock the village out.
 *
 * ── WHO MAY FLIP IT ─────────────────────────────────────────────────────────
 *
 * The same people who may change an account's own role, by the same rule
 * (`PUT /api/admin/users/:id/role`): while the founder role stands, only a
 * founder; after the village starts its Game, any admin. Turning a group on
 * hands everyone in it the panel, which is the same act as making each of them
 * an admin, so it cannot be easier to reach than that.
 *
 * ── THE ONE FLIP IT REFUSES ─────────────────────────────────────────────────
 *
 * Turning a group off when that group is the last way anybody can open the
 * panel. The question is asked of the state the change would leave, through
 * the same count the role route and the departure routes use.
 *
 * A NEW MODULE, NOT A NEW LINE IN server/index.ts: route modules are free on
 * the index ratchet by construction.
 */
import type { Express } from "express";
import type { Pool } from "mysql2/promise";
import { founderPowerStands } from "../lib/gameStart";
import { recordEvent } from "../lib/events";
import { holdingHasLapsed } from "../lib/stewardship";
import { EXAMPLE_REFUSAL_BODY, isExampleUser } from "../lib/examples";
import { accountsWithReach, LAST_ADMIN_REFUSAL, type AdminGroup, type GroupHolding } from "../lib/groupAdmin";

interface GroupStore {
  all(): any[];
  replaceAll(rows: any[]): Promise<unknown>;
}

interface Deps {
  isAdmin(req: any): Promise<boolean>;
  getPool(): Pool;
  members: { all(): Promise<any[]> };
  rolesRepo: GroupStore;
  loadRoleHolders(): GroupHolding[];
}

export function register(app: Express, deps: Deps): void {
  const { isAdmin, getPool, members, rolesRepo, loadRoleHolders } = deps;

  app.put("/api/admin/roles/:id/admin-access", async (req, res) => {
    if (!(await isAdmin(req))) return res.status(401).json({ error: "auth_required" });
    const actor = (req as any).adminUser;
    const on = req.body?.on;
    if (typeof on !== "boolean") return res.status(400).json({ error: "Send on: true or on: false" });
    if ((await founderPowerStands(getPool())) && actor?.role !== "founder") {
      return res.status(403).json({ error: "Until the village starts its Game, only a founder decides which groups can open the admin panel" });
    }
    const all = rolesRepo.all();
    const idx = all.findIndex((r: any) => r.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: "Group not found" });
    if (all[idx].isExample) return res.status(409).json(EXAMPLE_REFUSAL_BODY);

    if (!on) {
      const after = all.map((r: any) => (r.id === req.params.id ? { ...r, grantsAdmin: false } : r)) as AdminGroup[];
      const left = accountsWithReach(await members.all(), after, loadRoleHolders(), new Date(), holdingHasLapsed, isExampleUser);
      if (left.length === 0) return res.status(409).json({ error: LAST_ADMIN_REFUSAL });
    }

    all[idx] = { ...all[idx], grantsAdmin: on };
    await rolesRepo.replaceAll(all);
    void recordEvent(getPool(), {
      kind: "audit",
      text: `group-admin:${req.params.id}:${on ? "on" : "off"}`,
      actorUserId: actor?.id ?? null,
      entityType: "role",
      entityRef: String(req.params.id),
      audience: "admin",
    });
    res.json({ id: req.params.id, grantsAdmin: on });
  });
}
