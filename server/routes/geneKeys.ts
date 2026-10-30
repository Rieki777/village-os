/**
 * Gene Keys routes: `/api/gene-keys/**`, behind `requireModule("gene-keys")`.
 *
 *   GET    /api/gene-keys/me              the member's own lines and settings, or null
 *   PUT    /api/gene-keys/me              save a chart read in their browser
 *   PATCH  /api/gene-keys/me              show or hide, and Maia's yes or no
 *   DELETE /api/gene-keys/me              remove their Gene Keys
 *   GET    /api/gene-keys/people?ids=a,b  other members' shown lines, for a circle or a card
 *   GET    /api/gene-keys/people/:handle  one member's shown lines, for their profile
 *   GET    /api/gene-keys/places          the birth-town list the form searches on the device
 *
 * Every door needs a signed-in member. Another member's lines are read only
 * when their owner shows them, and the SQL itself filters on that
 * (server/repos/geneKeys.ts), so no route here can leak a hidden row.
 *
 * NO BIRTH DATA REACHES ANY OF THESE. The chart is read from the sky in the
 * member's browser; a body carrying anything else is rebuilt from its 26
 * activations before it is stored (`parseSave`).
 */
import type { Express } from "express";
import fs from "node:fs";
import path from "node:path";
import type { AppDeps } from "../lib/appDeps";
import {
  PEOPLE_READ_MAX, changeGeneKeysSettings, geneKeysOfHandle, geneKeysOfPeople, ownGeneKeys, parseSave, parseSettings,
  removeGeneKeys, saveGeneKeys,
} from "../lib/geneKeys";
import { requireModule } from "../lib/modules";

/** Re-exported so server/index.ts reaches them on its one exempt import line for this module. */
export { exportMemberGeneKeys, geneKeysForAssistant, geneKeysMissing } from "../lib/geneKeys";

type Deps = Pick<AppDeps, "authedUser" | "getPool" | "overLimit">;

/**
 * The birth-town list, relative to the repository root and to /app in the image
 * (scripts/gen-gene-keys-places.mjs has why it lives here and not in client/public).
 */
export const PLACES_FILE = path.join("server", "assets", "places", "cities15000.txt");
/** A day, the same as the stock avatars: the list changes only with a release. */
const PLACES_MAX_AGE_SECONDS = 86400;

const HOUR_MS = 60 * 60 * 1000;
/** Saves one member may make in an hour. Trying a few birth times is ten. */
const SAVES_PER_HOUR = 30;

export function register(app: Express, deps: Deps): void {
  const { authedUser, getPool, overLimit } = deps;
  let places: string | null = null;

  app.use("/api/gene-keys", requireModule("gene-keys"));

  app.get("/api/gene-keys/me", async (req, res) => {
    const me = await authedUser(req);
    if (!me) return res.status(401).json({ error: "auth_required" });
    res.json({ geneKeys: await ownGeneKeys(getPool(), String(me.id)) });
  });

  app.put("/api/gene-keys/me", async (req, res) => {
    const me = await authedUser(req);
    if (!me) return res.status(401).json({ error: "auth_required" });
    const uid = String(me.id);
    if (await overLimit(`gene-keys-save:${uid}`, SAVES_PER_HOUR, HOUR_MS)) {
      return res.status(429).json({ error: "That is a lot of saves for one hour. Try again a little later." });
    }
    const save = parseSave(req.body);
    if (!save.ok) return res.status(400).json({ error: save.problem });
    const geneKeys = await saveGeneKeys(getPool(), uid, save);
    if (!geneKeys) return res.status(500).json({ error: "Your lines did not save. Try again." });
    res.json({ geneKeys });
  });

  app.patch("/api/gene-keys/me", async (req, res) => {
    const me = await authedUser(req);
    if (!me) return res.status(401).json({ error: "auth_required" });
    const patch = parseSettings(req.body);
    if (!patch.ok) return res.status(400).json({ error: patch.problem });
    const geneKeys = await changeGeneKeysSettings(getPool(), String(me.id), { visibility: patch.visibility, maia: patch.maia });
    if (!geneKeys) return res.status(404).json({ error: "You have no Gene Keys saved yet." });
    res.json({ geneKeys });
  });

  app.delete("/api/gene-keys/me", async (req, res) => {
    const me = await authedUser(req);
    if (!me) return res.status(401).json({ error: "auth_required" });
    res.json({ removed: await removeGeneKeys(getPool(), String(me.id)) });
  });

  app.get("/api/gene-keys/people", async (req, res) => {
    if (!(await authedUser(req))) return res.status(401).json({ error: "auth_required" });
    const ids = String(req.query?.ids ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    if (ids.length > PEOPLE_READ_MAX) return res.status(400).json({ error: `Ask for at most ${PEOPLE_READ_MAX} people at once.` });
    res.json({ people: await geneKeysOfPeople(getPool(), ids) });
  });

  app.get("/api/gene-keys/people/:handle", async (req, res) => {
    if (!(await authedUser(req))) return res.status(401).json({ error: "auth_required" });
    const handle = String(req.params.handle ?? "").trim();
    if (!handle) return res.status(400).json({ error: "Name a member." });
    res.json({ geneKeys: await geneKeysOfHandle(getPool(), handle) });
  });

  /**
   * The whole list, once per day per browser. The member's search runs on
   * their own device, so what they type never reaches this server.
   */
  app.get("/api/gene-keys/places", async (req, res) => {
    if (!(await authedUser(req))) return res.status(401).json({ error: "auth_required" });
    if (places === null) {
      try {
        places = await fs.promises.readFile(PLACES_FILE, "utf8");
      } catch {
        return res.status(503).json({ error: "The town list is missing from this build." });
      }
    }
    res.setHeader("Cache-Control", `private, max-age=${PLACES_MAX_AGE_SECONDS}`);
    res.type("text/plain; charset=utf-8").send(places);
  });
}
