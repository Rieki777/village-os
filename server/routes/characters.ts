/**
 * Character routes (extracted from server/index.ts).
 *
 * Four routes:
 *
 *   GET    /api/me/characters             your party (all characters you play)
 *   POST   /api/me/characters             walk a path, or change how a character looks
 *   POST   /api/me/characters/:id/primary which character fronts the sheet
 *   DELETE /api/me/characters/:id         leave a path (primary hands the crown on)
 *
 * Multi-class is the point, so POST adds rather than replaces. Validation
 * lives in the service: presentation and tone are closed sets and the
 * archetype is checked against this village's own rows.
 */
import type { Express, Request } from "express";
import type { Pool } from "mysql2/promise";
import {
  addCharacter,
  partyFor,
  removeCharacter,
  setPrimary,
} from "../lib/characters";

export interface CharacterDeps {
  authedUser: (req: Request) => Promise<any | null>;
  getPool: () => Pool;
  villageId: () => string;
}

export function register(app: Express, deps: CharacterDeps): void {
  const { authedUser, getPool, villageId } = deps;

  app.get("/api/me/characters", async (req, res) => {
    const user = await authedUser(req);
    if (!user) return res.status(401).json({ error: "auth_required", message: "Sign in first" });
    res.json({ party: await partyFor(getPool(), villageId(), user.id, user.id) });
  });

  app.post("/api/me/characters", async (req, res) => {
    const user = await authedUser(req);
    if (!user) return res.status(401).json({ error: "auth_required", message: "Sign in first" });
    const outcome = await addCharacter(getPool(), villageId(), user.id, req.body ?? {});
    if (!outcome.ok) return res.status(outcome.status).json({ error: outcome.error });
    res.json({ success: true, character: outcome.character });
  });

  app.post("/api/me/characters/:id/primary", async (req, res) => {
    const user = await authedUser(req);
    if (!user) return res.status(401).json({ error: "auth_required", message: "Sign in first" });
    const ok = await setPrimary(getPool(), villageId(), user.id, req.params.id);
    if (!ok) return res.status(404).json({ error: "Not one of your characters" });
    res.json({ success: true, party: await partyFor(getPool(), villageId(), user.id, user.id) });
  });

  app.delete("/api/me/characters/:id", async (req, res) => {
    const user = await authedUser(req);
    if (!user) return res.status(401).json({ error: "auth_required", message: "Sign in first" });
    const removed = await removeCharacter(getPool(), villageId(), user.id, req.params.id);
    if (!removed) return res.status(404).json({ error: "Not one of your characters" });
    res.json({ success: true, party: await partyFor(getPool(), villageId(), user.id, user.id) });
  });
}
