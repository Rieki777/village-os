/**
 * THE CO-SIGN'S DOORS, `/api/admin/planting-requests*`, and the job that lands
 * cooling-offs and expires unsigned co-signs (server/lib/plantingRequests.ts).
 *
 *   GET  /api/admin/planting-requests              what is waiting, never a value
 *   POST /api/admin/planting-requests/:id/cosign   another admin, own login, never an agent
 *   POST /api/admin/planting-requests/:id/decline  an admin or a steward or founder
 *                                                  role holder; the asker withdraws
 *
 * `plantingDoor` is the half `PUT /api/admin/integrations/:key` asks before it
 * saves: after launch, a keystone slot becomes a request and the route answers
 * 202. It is set up here at register time, so server/index.ts carries one line.
 *
 * Registered from server/routes/moduleLibrary.ts, beside the setup game's map,
 * so server/index.ts does not grow by a route.
 */
import type { Express, Request } from "express";
import type { AppDeps } from "../lib/appDeps";
import { getPool } from "../db/pool";
import { registerJob } from "../lib/scheduler";
import { TOKEN_PREFIX } from "../lib/agentTokens";
import {
  askToPlant,
  cosignPhase,
  cosignPlanting,
  declinePlanting,
  needsCosign,
  sweepPlantings,
  waitingPlantings,
  type Asked,
  type Person,
} from "../lib/plantingRequests";

export interface PlantingDeps extends Pick<AppDeps, "isAdmin" | "authedUser" | "notify"> {
  /** Every admin with their own login, as people. */
  plantingAdmins: () => Promise<Person[]>;
  /** Steward and founder role holders, by id: told during a cooling-off, and may decline. */
  plantingObjectors: () => Promise<string[]>;
}

let door: PlantingDeps | null = null;

/** After launch, a keystone save becomes a request. Null means save as before. */
export async function plantingDoor(key: string, value: string, actorId: string): Promise<Asked | null> {
  if (!door || !value.trim()) return null;
  if (!needsCosign(key, await cosignPhase(getPool()))) return null;
  const admins = await door.plantingAdmins();
  const requestedBy = admins.find((a) => a.id === actorId) ?? { id: actorId, name: "An admin" };
  return askToPlant(getPool(), {
    slot: key,
    value,
    requestedBy,
    admins,
    objectors: await door.plantingObjectors(),
    notify: door.notify,
  });
}

const SWEEP_EVERY_MS = 15 * 60 * 1000;

/** A person, by their own login. An agent token never co-signs: a co-sign is a second person. */
async function person(req: Request, deps: PlantingDeps): Promise<Person | null> {
  if (String(req.headers.authorization ?? "").startsWith(`Bearer ${TOKEN_PREFIX}`)) return null;
  const user: any = await deps.authedUser(req);
  return user ? { id: String(user.id), name: String(user.name ?? user.handle ?? "A member") } : null;
}

export function register(app: Express, deps: PlantingDeps): void {
  door = deps;
  registerJob("planting-requests", SWEEP_EVERY_MS, async () => {
    const r = await sweepPlantings(getPool());
    return r.landed || r.expired ? `landed ${r.landed}, expired ${r.expired}` : undefined;
  });

  app.get("/api/admin/planting-requests", async (req, res) => {
    const me = await person(req, deps);
    const objector = me ? (await deps.plantingObjectors()).includes(me.id) : false;
    if (!(await deps.isAdmin(req)) && !objector) return res.status(401).json({ error: "auth_required" });
    res.json({ waiting: await waitingPlantings(getPool()), me: me?.id ?? null });
  });

  app.post("/api/admin/planting-requests/:id/cosign", async (req, res) => {
    const me = await person(req, deps);
    if (!me) return res.status(401).json({ error: "A co-sign is a second person, signed in with their own login. An agent cannot give one." });
    if (!(await deps.plantingAdmins()).some((a) => a.id === me.id)) {
      return res.status(403).json({ error: "Co-signing a key is for an admin with their own login." });
    }
    const out = await cosignPlanting(getPool(), String(req.params.id), me);
    if (!out.ok) return res.status(out.status).json({ error: out.error });
    res.json({ success: true, waiting: await waitingPlantings(getPool()) });
  });

  app.post("/api/admin/planting-requests/:id/decline", async (req, res) => {
    const me = await person(req, deps);
    if (!me) return res.status(401).json({ error: "Sign in with your own login to decline a key." });
    const may = (await deps.plantingAdmins()).some((a) => a.id === me.id) || (await deps.plantingObjectors()).includes(me.id);
    if (!may) return res.status(403).json({ error: "Declining a key is for an admin, or a steward or founder role holder." });
    const out = await declinePlanting(getPool(), String(req.params.id), me);
    if (!out.ok) return res.status(out.status).json({ error: out.error });
    res.json({ success: true, waiting: await waitingPlantings(getPool()) });
  });
}
