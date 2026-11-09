/**
 * Living places routes: `/api/place-registry/**`, behind
 * `requireModule("places")`.
 *
 *   GET  /api/place-registry            the index: every place, in two tiers
 *   GET  /api/place-registry/orphans    what names a place the registry does not hold (place.tend)
 *   GET  /api/place-registry/:key       one place's card, for members
 *   POST /api/place-registry/import     write the village's place seed (place.tend)
 *
 * Mounted under its own prefix so it can never collide with the map's
 * `/api/places/photos`.
 *
 * THE TIERS ARE THE MAP'S. A visitor reads the index only while
 * `map.public_structure` allows it, and reads structure only. A signed-in
 * member reads the members' tier. Holder first names ride only on a card, and
 * only for an admin or a holder of `map.viewPeople`, asked through the one
 * capability gate. Each tier hashes its own body, so a cached answer never
 * crosses between them; every answer revalidates and is never shared.
 *
 * The import and the orphan report ask the gate with `guardCapability` for
 * `place.tend`, so a village with no holder decides by its vote path and the
 * gate writes its record.
 */
import type { Express } from "express";
import { hasCapability } from "../../shared/capabilities";
import type { AppDeps } from "../lib/appDeps";
import { villageId } from "../lib/economy";
import { publishedScene } from "../lib/mapScene";
import { projectMapOrg, type MapOrgRole } from "../lib/mapOrg";
import { listOrgAssignments, listOrgRoles } from "../lib/orgChart";
import { requireModule } from "../lib/modules";
import {
  anchorsFromScene, importPlacesSeed, indexEtag, MODULE_ID, orphanReport, placeCard, placeIndex, looksLikeKey,
  type ReadCtx,
} from "../lib/places";
import { boolVar } from "../lib/variables";

type Deps = Pick<
  AppDeps,
  "authedUser" | "isAdmin" | "capabilityCtx" | "guardCapability" | "getPool" | "overLimit" | "members" | "firstName" | "lapseContext" | "circlesRepo"
>;

const HOUR_MS = 60 * 60 * 1000;
/** Imports one holder may press in an hour. One is the norm; a typo fixed is a second. */
const IMPORTS_PER_HOUR = 6;
/** The largest seed body the import reads. Amora's 66 places are about 40 KB. */
export const SEED_MAX_BYTES = 512 * 1024;

export function register(app: Express, deps: Deps): void {
  const { authedUser, isAdmin, capabilityCtx, guardCapability, getPool, overLimit, members, firstName, lapseContext, circlesRepo } = deps;

  /** The org chart as the map projects it. Names are read only when they will be sent. */
  const rolesFor = (viewPeople: boolean) => async (): Promise<readonly MapOrgRole[]> => {
    const pool = getPool();
    const [roles, assignments] = await Promise.all([listOrgRoles(pool), listOrgAssignments(pool, lapseContext())]);
    const people = viewPeople && assignments.some((a) => a.userId) ? await members.all() : [];
    const nameOf = new Map(people.map((u: any) => [String(u.id), firstName(u.name ?? "Member")]));
    return projectMapOrg({
      circles: circlesRepo.all() as any[],
      roles,
      assignments,
      viewPeople,
      memberName: (id) => nameOf.get(id) ?? firstName("Member"),
    }).roles;
  };

  const ctxFor = (viewPeople: boolean): ReadCtx => ({
    pool: getPool(),
    villageId: villageId(),
    scene: async () => (await publishedScene(getPool()))?.scene ?? null,
    roles: rolesFor(viewPeople),
    now: new Date(),
  });

  const mayViewPeople = async (req: any, viewer: any): Promise<boolean> => {
    if (await isAdmin(req)) return true;
    return viewer ? hasCapability("map.viewPeople", await capabilityCtx(viewer)) : false;
  };

  app.use("/api/place-registry", requireModule(MODULE_ID));

  app.get("/api/place-registry", async (req, res) => {
    const viewer = await authedUser(req);
    if (!viewer && !boolVar("map.public_structure")) {
      return res.status(401).json({ error: "auth_required", message: "Sign in to see the village's places" });
    }
    const index = await placeIndex(ctxFor(false), viewer ? "members" : "public");
    res.setHeader("ETag", indexEtag(index.version));
    res.setHeader("Cache-Control", "private, no-cache");
    res.setHeader("Vary", "Authorization");
    const sent = req.headers?.["if-none-match"];
    const raw = Array.isArray(sent) ? sent.join(",") : String(sent ?? "");
    if (raw.split(",").map((t) => t.trim().replace(/^W\//, "")).some((t) => t === "*" || t === indexEtag(index.version))) {
      return res.status(304).end();
    }
    res.json(index);
  });

  app.get("/api/place-registry/orphans", async (req, res) => {
    if (!(await authedUser(req))) return res.status(401).json({ error: "auth_required" });
    if (!(await guardCapability(req, res, "place.tend"))) return;
    res.json(await orphanReport(ctxFor(false)));
  });

  app.get("/api/place-registry/:key", async (req, res) => {
    const viewer = await authedUser(req);
    if (!viewer) return res.status(401).json({ error: "auth_required" });
    const key = req.params?.key;
    if (!looksLikeKey(key)) return res.status(404).json({ error: "No such place." });
    const viewPeople = await mayViewPeople(req, viewer);
    const card = await placeCard(ctxFor(viewPeople), key, viewPeople);
    if (!card) return res.status(404).json({ error: "No such place." });
    res.setHeader("Cache-Control", "private, no-cache");
    res.json(card);
  });

  app.post("/api/place-registry/import", async (req, res) => {
    const me = await authedUser(req);
    if (!me) return res.status(401).json({ error: "auth_required" });
    if (!(await guardCapability(req, res, "place.tend"))) return;
    if (await overLimit(`place-import:${String(me.id)}`, IMPORTS_PER_HOUR, HOUR_MS)) {
      return res.status(429).json({ error: "That is a lot of seed loads for one hour. Try again a little later." });
    }
    const seed = req.body?.seed;
    if (JSON.stringify(seed ?? null).length > SEED_MAX_BYTES) {
      return res.status(413).json({ error: "That seed is larger than the registry reads." });
    }
    const pool = getPool();
    const scene = (await publishedScene(pool))?.scene ?? null;
    const out = await importPlacesSeed(pool, {
      villageId: villageId(),
      by: String(me.id),
      seed,
      liveKeys: scene === null ? null : Array.from(anchorsFromScene(scene).keys()),
      roles: (await listOrgRoles(pool)).filter((r) => r.active && !r.isExample).map((r) => ({ id: r.id, name: r.name })),
      now: new Date(),
    });
    if (!out.ok) return res.status(400).json({ error: "The seed was not loaded.", problems: out.problems });
    res.status(201).json(out);
  });
}
