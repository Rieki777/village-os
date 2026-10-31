/**
 * Live Sessions, before the call, over HTTP: the agenda library, what members
 * bring for a circle's next session. Every door is the "Doors" list in
 * shared/sessionLibrary.ts, which is the contract, and every rule behind a door
 * is server/lib/sessionLibrary.ts, or server/lib/liveSessions.ts where the
 * door writes into a room:
 *
 *   POST   /api/sessions/library                 LibraryInput -> { item }
 *   PATCH  /api/sessions/library/:itemId         Partial<LibraryInput> -> { item }
 *   DELETE /api/sessions/library/:itemId         { ok }, withdraw it
 *   POST   /api/sessions/library/:itemId/again   {} -> { item }, bring a taken-up item again
 *   POST   /api/sessions/library/from-tension    { sessionId, entryId, circleId } -> { item }, a room's tension sent on
 *   GET    /api/sessions/:id/library             { items }, what this viewer may bring into this open room
 *   POST   /api/sessions/:id/library             { ids } -> { ids }, onto this room's agenda
 *
 * The list itself rides on `GET /api/sessions`, and opening a room with items
 * on `POST /api/sessions` (server/routes/liveSessions.ts), because a GET of
 * `/api/sessions/library` would be read as the room numbered "library".
 *
 * BEHIND THE ROOM'S OWN GATES. server/index.ts registers this module after
 * server/routes/liveSessions.ts, so the module gate and the members-only gate
 * that module mounts on `/api/sessions` stand in front of every door here: the
 * module off answers 404, and a guest answers 403 before any of this runs. This
 * module also mounts the module gate on its own prefix, the way the task doors
 * do, so its doors stay gated if the order ever changes.
 *
 * NO DOOR HERE IS SWALLOWED BY THE ROOM'S. `/api/sessions/:id` matches one
 * segment, and the room has no PATCH, DELETE or POST of `/api/sessions/:id`
 * with "library" anywhere in it; `/api/sessions/:id/library` is a fixed word of
 * its own beside `join`, `items` and the rest. The route suite proves it.
 *
 * NOTHING HERE RECORDS AN EVENT, and nothing here bumps a room: a change to a
 * waiting item takes no session lock, and a room reads its own list when its
 * agenda stage asks.
 */
import type { Express, Request, Response } from "express";
import type { AppDeps } from "../lib/appDeps";
import { bringFromLibrary, memberNo, parseId, type MemberLookup, type Outcome } from "../lib/liveSessions";
import { requireModule } from "../lib/modules";
import {
  bringItem,
  bringItemAgain,
  sendRoomTension,
  changeItem,
  noticesAfterTakes,
  roomLibrary,
  withdrawItem,
  type LibraryDeps,
} from "../lib/sessionLibrary";
import { SESSION_REFUSALS as R } from "../../shared/sessions";
import { LIBRARY_API, LIBRARY_LIMITS, LIBRARY_REFUSALS, LIBRARY_TENSION_API } from "../../shared/sessionLibrary";

/**
 * What this module touches, and why. `members` names the people on a card,
 * `circlesRepo` names a circle and says which circles are live. `notify`
 * tells whoever brought an item that a session took it. `lapseContext` reads
 * whose seat terms still run, for standing. `overLimit` bounds every write.
 */
type Deps = Pick<AppDeps, "authedUser" | "isAdmin" | "getPool" | "overLimit" | "members" | "circlesRepo" | "notify" | "lapseContext">;

const HOUR_MS = 60 * 60 * 1000;
/** How long a person's name is remembered between reads. */
const NAME_TTL_MS = 30_000;

export function register(app: Express, deps: Deps): void {
  const { authedUser, isAdmin, getPool, overLimit, members, circlesRepo, notify } = deps;

  app.use(LIBRARY_API, requireModule("sessions"));

  const nameCache = new Map<string, { at: number; m: { name: unknown; handle: unknown } | null }>();
  const lookup: MemberLookup = async (userId) => {
    const hit = nameCache.get(userId);
    if (hit && Date.now() - hit.at < NAME_TTL_MS) return hit.m;
    const m = await members.byId(userId);
    const v = m ? { name: m.name, handle: m.handle ?? null } : null;
    if (nameCache.size > 5000) nameCache.clear();
    nameCache.set(userId, { at: Date.now(), m: v });
    return v;
  };
  /** The circles an item can be for: live ones, never a dormant circle or a standing example, as a session's. */
  const liveCircleIds = (): Set<string> =>
    new Set(
      (circlesRepo.all() as Array<{ id?: unknown; status?: unknown; isExample?: unknown }>)
        .filter((c) => typeof c?.id === "string" && c.id && c.status !== "dormant" && !c.isExample)
        .map((c) => String(c.id)),
    );
  const circleName = (id: string | null): string | null => {
    if (!id) return null;
    const c = (circlesRepo.all() as Array<{ id?: unknown; name?: unknown }>).find((x) => x?.id === id);
    return c ? String(c.name ?? id) : null;
  };
  const lib: LibraryDeps = { lookup, circleName, lapseContext: deps.lapseContext };

  const answer = <T>(res: Response, out: Outcome<T>, ok: (v: T) => unknown) =>
    out.ok ? res.json(ok(out.value)) : res.status(out.status).json({ ...(out.body ?? {}), error: out.error });

  /** The signed-in member behind a request, or a 401 already sent; with a bucket, or a 429 already sent. */
  const signedIn = async (req: Request, res: Response, bucket?: { key: string; max: number }) => {
    const user = await authedUser(req);
    if (!user) {
      res.status(401).json({ error: "auth_required" });
      return null;
    }
    const userId = String(user.id);
    if (bucket && (await overLimit(`${bucket.key}:${userId}`, bucket.max, HOUR_MS))) {
      res.status(429).json({ error: LIBRARY_REFUSALS.slowDown });
      return null;
    }
    return { userId, admin: await isAdmin(req) };
  };
  const adds = { key: "sessions-library-add", max: LIBRARY_LIMITS.addsPerHour };
  const changes = { key: "sessions-library-change", max: LIBRARY_LIMITS.changesPerHour };

  // ── One item ──────────────────────────────────────────────────────────────

  app.post(LIBRARY_API, async (req, res) => {
    const who = await signedIn(req, res, adds);
    if (!who) return;
    answer(res, await bringItem(getPool(), who, req.body, liveCircleIds(), lib), (v) => ({ item: v.item }));
  });

  app.patch(`${LIBRARY_API}/:itemId`, async (req, res) => {
    const who = await signedIn(req, res, changes);
    if (!who) return;
    const id = parseId(req.params?.itemId);
    if (id == null) return res.status(404).json({ error: LIBRARY_REFUSALS.notFound });
    answer(res, await changeItem(getPool(), who, id, req.body, liveCircleIds(), lib), (v) => ({ item: v.item }));
  });

  app.delete(`${LIBRARY_API}/:itemId`, async (req, res) => {
    const who = await signedIn(req, res, changes);
    if (!who) return;
    const id = parseId(req.params?.itemId);
    if (id == null) return res.status(404).json({ error: LIBRARY_REFUSALS.notFound });
    answer(res, await withdrawItem(getPool(), who, id, lib), () => ({ ok: true }));
  });

  app.post(`${LIBRARY_API}/:itemId/again`, async (req, res) => {
    const who = await signedIn(req, res, changes);
    if (!who) return;
    const id = parseId(req.params?.itemId);
    if (id == null) return res.status(404).json({ error: LIBRARY_REFUSALS.notFound });
    answer(res, await bringItemAgain(getPool(), who, id, lib), (v) => ({ item: v.item }));
  });

  // ── A room's tension, sent on ─────────────────────────────────────────────

  /** One more agenda item, from a tension a room named: the same bucket as adding one. */
  app.post(LIBRARY_TENSION_API, async (req, res) => {
    const who = await signedIn(req, res, adds);
    if (!who) return;
    answer(res, await sendRoomTension(getPool(), who, req.body, liveCircleIds(), lib), (v) => ({ item: v.item }));
  });

  // ── An open room's own list ───────────────────────────────────────────────

  app.get("/api/sessions/:id/library", async (req, res) => {
    const who = await signedIn(req, res);
    if (!who) return;
    const id = parseId(req.params?.id);
    if (id == null) return res.status(404).json({ error: R.notFound });
    res.setHeader("Cache-Control", "private, no-cache");
    res.json({ items: await roomLibrary(getPool(), id, who, lib) });
  });

  /**
   * Bring items onto an open room's agenda: anyone in the room, all or none
   * (`bringFromLibrary`). Whoever brought each one hears it is on the agenda,
   * after the commit, unless they brought it in themselves.
   */
  app.post("/api/sessions/:id/library", async (req, res) => {
    const who = await signedIn(req, res, changes);
    if (!who) return;
    const id = parseId(req.params?.id);
    if (id == null) return res.status(404).json({ error: R.notFound });
    const pool = getPool();
    const no = await memberNo(pool, who.userId);
    if (no == null) return res.status(403).json({ error: R.joinFirst });
    const out = await bringFromLibrary(pool, id, { no, admin: who.admin, userId: who.userId }, req.body, lib);
    if (!out.ok) return res.status(out.status).json({ error: out.error });
    await noticesAfterTakes(pool, { notify }, { sessionTitle: out.value.title, takerNo: no, taken: out.value.taken });
    res.json({ ids: out.value.ids });
  });
}
