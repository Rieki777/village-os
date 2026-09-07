/**
 * Profile routes (extracted from server/index.ts).
 *
 * Two routes:
 *
 *   GET /api/me/profile      your own sheet: everything, because it is yours
 *   GET /api/profiles/:handle somebody else's sheet, privacy-filtered
 *
 * The privacy filter runs in publicView, which builds a stranger's copy by
 * adding what the flags permit rather than by deleting from a full one. The
 * expensive reads are still done first and then dropped, which is a little
 * wasteful and much harder to get wrong than deciding twice.
 *
 * A member reading their OWN handle gets the full sheet, because being told
 * your own home is private by you is absurd.
 */
import type { Express, Request } from "express";
import type { Pool } from "mysql2/promise";
import { loadGratitude, loadProfile, loadStanding, publicView, userIdForHandle } from "../lib/profile";

export interface ProfileDeps {
  authedUser: (req: Request) => Promise<any | null>;
  getPool: () => Pool;
  villageId: () => string;
  cycleWindow: () => { startsAt: Date };
  partyFor: (pool: Pool, villageId: string, userId: string, viewerId: string | null) => Promise<any>;
  gratitudeAllowance: (user: any) => Promise<any>;
  claimReadiness: (pool: Pool, userId: string) => Promise<any>;
}

export function register(app: Express, deps: ProfileDeps): void {
  const { authedUser, getPool, villageId, cycleWindow, partyFor, gratitudeAllowance, claimReadiness } = deps;

  /** Your own sheet. Everything, because it is yours. */
  app.get("/api/me/profile", async (req, res) => {
    const user = await authedUser(req);
    if (!user) return res.status(401).json({ error: "auth_required", message: "Sign in first" });
    const loaded = await loadProfile(getPool(), villageId(), user.id);
    if (!loaded) return res.status(404).json({ error: "Not found" });
    const { startsAt } = cycleWindow();
    res.json({
      ...loaded.view,
      standing: await loadStanding(getPool(), user.id),
      gratitude: await loadGratitude(getPool(), villageId(), user.id, startsAt),
      party: await partyFor(getPool(), villageId(), user.id, user.id),
      allowance: await gratitudeAllowance(user),
      voice: await claimReadiness(getPool(), user.id),
    });
  });

  /**
   * Somebody else's sheet.
   *
   * The privacy filter runs in `publicView`, which builds a stranger's copy by
   * adding what the flags permit rather than by deleting from a full one. The
   * expensive reads are still done first and then dropped, which is a little
   * wasteful and much harder to get wrong than deciding twice.
   *
   * A member reading their OWN handle gets the full sheet, because being told
   * your own home is private by you is absurd.
   */
  app.get("/api/profiles/:handle", async (req, res) => {
    const targetId = await userIdForHandle(getPool(), req.params.handle);
    if (!targetId) return res.status(404).json({ error: "Not found" });
    const loaded = await loadProfile(getPool(), villageId(), targetId);
    if (!loaded) return res.status(404).json({ error: "Not found" });

    const viewer = await authedUser(req);
    const { startsAt } = cycleWindow();
    const full = {
      ...loaded.view,
      standing: await loadStanding(getPool(), targetId),
      gratitude: await loadGratitude(getPool(), villageId(), targetId, startsAt),
    };
    if (viewer?.id === targetId) {
      return res.json({ ...full, party: await partyFor(getPool(), villageId(), targetId, viewer?.id ?? null) });
    }
    res.json({
      ...publicView(full, loaded.privacy),
      party: await partyFor(getPool(), villageId(), targetId, viewer?.id ?? null),
    });
  });
}
