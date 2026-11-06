/**
 * THE BOARD OF EVERY POWER, FOR EVERY MEMBER (ROLE_POWERS_DESIGN.md §4.1, §4.5).
 *
 *   GET /api/powers/board
 *
 * Rye, 2026-11-01 (Q5): "the admin panel should be open to ALL members to see.
 * They need the power to change something without a vote." This is the first
 * piece of that, read-only: every power the one gate knows, in plain words,
 * with who holds it now, whether the village holds it, and where a suggestion
 * about it would go. Suggesting a change is its own change.
 *
 * WHO READS IT. A signed-in account at the member stage or past it. A visitor,
 * a guest and a former member read nothing, which is the line Q5 draws ("all
 * members"). The names it serves are first names beside the role, in the
 * "Role (FirstName)" form, which `map.viewPeople` already shows every account.
 *
 * HOLDERS ARE COUNTED THE WAY THE GATE COUNTS, minus the admin short-circuit:
 * groups held directly or through a seat (`loadPowerHoldings`), lapsed
 * holdings out, examples out.
 */
import type { Express } from "express";
import type { Pool } from "mysql2/promise";
import { stageIndex } from "../../shared/gameConfig";
import { buildPowerBoard, GUIDANCE_WORDS, POWER_FAMILIES, type BoardHolder } from "../../shared/powerBoard";
import { STAGE_UNLOCKS, type Capability } from "../../shared/capabilities";
import { rolesCarryingCapability } from "../lib/roleGrants";
import { holdingHasLapsed } from "../lib/stewardship";
import { capabilityHoldings } from "../lib/capabilityHolding";
import { listOrgRoles } from "../lib/orgChart";
import { listSeatGroupLinks } from "../repos/seatPowerGroups";
import { isExampleUser } from "../lib/examples";
import { leftTheVillage } from "../lib/formerMember";

interface Holding {
  roleId: string;
  userId: string;
  termEndsAt?: string | null;
  viaOrgRoleId?: string;
}

interface Deps {
  getPool(): Pool;
  authedUser(req: any): Promise<any>;
  stageOf(user: any): Promise<string>;
  members: { all(): Promise<any[]> };
  rolesRepo: { all(): any[] };
  loadPowerHoldings(): Holding[];
  stageUnlockOverrides(): Partial<Record<Capability, string>>;
}

const firstNameOf = (name: unknown) => String(name ?? "").trim().split(/\s+/)[0] || "Member";

export function register(app: Express, deps: Deps): void {
  app.get("/api/powers/board", async (req, res) => {
    const user = await deps.authedUser(req);
    if (!user) return res.status(401).json({ error: "Sign in to read the village's powers" });
    if (stageIndex(await deps.stageOf(user)) < stageIndex("member") || (await leftTheVillage(deps.getPool(), user))) {
      return res.status(403).json({ error: "The board of the village's powers opens to members" });
    }
    const pool = deps.getPool();
    const groups = deps.rolesRepo.all().filter((g: any) => !g.isExample);
    const groupName = new Map(groups.map((g: any) => [String(g.id), String(g.name ?? g.id)]));
    const orgRoles = await listOrgRoles(pool);
    const orgRoleName = new Map(orgRoles.map((r) => [r.id, r.name]));
    const links = (await listSeatGroupLinks(pool)).filter((l) => orgRoleName.has(l.orgRoleId) && groupName.has(l.roleId));
    const people = await deps.members.all();
    const named = new Map(people.filter((m: any) => !isExampleUser(m)).map((m: any) => [String(m.id), firstNameOf(m.name)]));
    const now = new Date();
    const live = deps.loadPowerHoldings().filter((h) => !holdingHasLapsed(h, now) && named.has(String(h.userId)));
    const held = new Map((await capabilityHoldings(pool)).map((h: any) => [String(h.capability), String(h.holderRoleName ?? h.holderRoleId)]));
    const overrides = deps.stageUnlockOverrides();

    const rows = buildPowerBoard({
      groups: groups.map((g: any) => ({ id: String(g.id), name: String(g.name ?? g.id), capabilities: (g.capabilities ?? []) as string[] })),
      carrying: (cap) => rolesCarryingCapability(groups, cap),
      roleLinks: links.map((l) => ({ orgRoleName: orgRoleName.get(l.orgRoleId)!, groupId: l.roleId })),
      holdersOf: (cap) => {
        const carrying = new Set(rolesCarryingCapability(groups, cap).map((g) => g.id));
        const out: BoardHolder[] = [];
        const seen = new Set<string>();
        for (const h of live) {
          if (!carrying.has(h.roleId)) continue;
          const role = h.viaOrgRoleId ? orgRoleName.get(h.viaOrgRoleId) ?? groupName.get(h.roleId)! : groupName.get(h.roleId)!;
          const k = `${role}\u0000${h.userId}`;
          if (seen.has(k)) continue;
          seen.add(k);
          out.push({ role, firstName: named.get(String(h.userId))! });
        }
        return out.sort((a, b) => a.role.localeCompare(b.role) || a.firstName.localeCompare(b.firstName));
      },
      villageHeld: held,
      stageOf: (cap) => overrides[cap] ?? STAGE_UNLOCKS[cap] ?? null,
    });
    res.json({ families: POWER_FAMILIES, guidance: GUIDANCE_WORDS, rows });
  });
}
