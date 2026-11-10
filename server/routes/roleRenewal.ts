/**
 * Moon renewal and the access bundle, over HTTP.
 *
 *   GET    /api/me/role-renewals                 my carry-on cards (last week of a one-moon term)
 *   POST   /api/me/role-renewals                 file "carry on" with next moon's contribution
 *   DELETE /api/me/role-renewals/:assignmentId   take it back
 *   GET    /api/me/role-access                   each access item of my roles and its state
 *   GET    /api/admin/role-renewals              filed carry-ons         (org.seat)
 *   POST   /api/admin/role-renewals/renew-all    renew every filed role  (org.seat)
 *   GET    /api/role-access-tasks                open tasks for roles I grant, or all with org.seat
 *   POST   /api/role-access-tasks/:id            mark a task done or not needed
 *
 * "The holder of the power to fill roles" is `org.seat`. Nothing here is
 * reached by a job.
 */
import type { Express } from "express";
import type { AppDeps } from "../lib/appDeps";
import { hasCapability } from "../../shared/capabilities";
import { ACCESS_STATES } from "../../shared/accessBundle";
import { carryOnCardsFor, fileCarryOn, renewAllFiled, withdrawCarryOn } from "../lib/moonRenewal";
import { holderView } from "../lib/roleAccess";
import { villageClock } from "../lib/stewardship";
import { filedRenewals, openTasksForRoles, setTaskState, taskById, tasksForHolder } from "../repos/roleAccess";
import { grantingRolesWithOpenTasks, liveHolderIds, liveRoleIdsOfUser } from "../repos/roleAccess";

type Deps = Pick<AppDeps, "authedUser" | "guardCapability" | "getPool" | "notify" | "capabilityCtx">;

export function register(app: Express, deps: Deps): void {
  const { authedUser, guardCapability, getPool, notify, capabilityCtx } = deps;

  app.get("/api/me/role-renewals", async (req, res) => {
    const user = await authedUser(req);
    if (!user) return res.status(401).json({ error: "Sign in" });
    res.json({ cards: await carryOnCardsFor(getPool(), String(user.id), new Date(), villageClock()) });
  });

  app.post("/api/me/role-renewals", async (req, res) => {
    const user = await authedUser(req);
    if (!user) return res.status(401).json({ error: "Sign in" });
    const r = await fileCarryOn(getPool(), String(user.id), String(req.body?.assignmentId ?? ""), String(req.body?.contribution ?? ""), new Date(), villageClock());
    if (!r.ok) return res.status(r.status).json({ error: r.error });
    res.json({ success: true });
  });

  app.delete("/api/me/role-renewals/:assignmentId", async (req, res) => {
    const user = await authedUser(req);
    if (!user) return res.status(401).json({ error: "Sign in" });
    const ok = await withdrawCarryOn(getPool(), String(user.id), req.params.assignmentId);
    if (!ok) return res.status(404).json({ error: "Nothing filed to take back" });
    res.json({ success: true });
  });

  app.get("/api/me/role-access", async (req, res) => {
    const user = await authedUser(req);
    if (!user) return res.status(401).json({ error: "Sign in" });
    res.json({ items: holderView(await tasksForHolder(getPool(), String(user.id))) });
  });

  app.get("/api/admin/role-renewals", async (req, res) => {
    if (!(await guardCapability(req, res, "org.seat"))) return;
    res.json({ filed: (await filedRenewals(getPool())).map((r) => ({ ...r, forTermEndsAt: r.forTermEndsAt.toISOString() })) });
  });

  app.post("/api/admin/role-renewals/renew-all", async (req, res) => {
    if (!(await guardCapability(req, res, "org.seat"))) return;
    const user = await authedUser(req);
    const out = await renewAllFiled(getPool(), String(user?.id ?? "unknown"), villageClock(), notify);
    res.json({ success: true, ...out });
  });

  /** May this person act on a task: they hold the granting role, or the power to fill roles. */
  async function mayHandle(req: any, user: any, grantingRoleId: string | null): Promise<boolean> {
    if (hasCapability("org.seat", await capabilityCtx(user))) return true;
    if (!grantingRoleId) return false;
    return (await liveHolderIds(getPool(), grantingRoleId)).includes(String(user.id));
  }

  app.get("/api/role-access-tasks", async (req, res) => {
    const user = await authedUser(req);
    if (!user) return res.status(401).json({ error: "Sign in" });
    const pool = getPool();
    const all = hasCapability("org.seat", await capabilityCtx(user));
    let roleIds: string[] = [];
    if (all) {
      roleIds = await grantingRolesWithOpenTasks(pool);
    } else {
      roleIds = await liveRoleIdsOfUser(pool, String(user.id));
    }
    const tasks = await openTasksForRoles(pool, roleIds);
    res.json({ tasks: tasks.map((t) => ({ id: t.id, kind: t.kind, label: t.itemLabel, roleId: t.orgRoleId, state: t.state })) });
  });

  app.post("/api/role-access-tasks/:id", async (req, res) => {
    const user = await authedUser(req);
    if (!user) return res.status(401).json({ error: "Sign in" });
    const state = String(req.body?.state ?? "");
    if (!(ACCESS_STATES as readonly string[]).includes(state)) return res.status(400).json({ error: "State must be open, done or not_needed" });
    const task = await taskById(getPool(), req.params.id);
    if (!task) return res.status(404).json({ error: "No such task" });
    if (!(await mayHandle(req, user, task.grantingRoleId))) return res.status(403).json({ error: "Only the granting role or the holder of the power to fill roles" });
    await setTaskState(getPool(), task.id, state as any, String(user.id));
    res.json({ success: true });
  });
}
