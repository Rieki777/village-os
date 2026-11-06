/**
 * Who a member talks to, as two routes: read the choice and who answers, and
 * save the choice.
 *
 * Rye, 2026-10-24: every member chooses between the village's own guide and
 * the outside governance service's agent, the choice is remembered, and every
 * answer says who gave it (shared/guideChoice.ts holds the rule).
 *
 * THE CHOICE LIVES IN THE MEMBER'S PREFERENCES, under `prefs.guide`, beside
 * their mail and currency choices. That column is JSON on purpose
 * (drizzle/0017), so a new preference needs no migration, and erasure already
 * resets it whole (server/lib/erasure.ts).
 *
 * VISITORS ARE OFFERED THE VILLAGE GUIDE ONLY. The outside agent knows a
 * member by their role titles, and a visitor holds none, so for a visitor it
 * is never an option (Rye agreed 2026-10-24).
 */
import type { Express } from "express";
import type { AppDeps } from "../lib/appDeps";
import { resolveKey } from "../lib/assistant";
import { saberraGuideReach } from "../lib/saberraGuide";
import { parseGuideId, resolveGuide, type GuideOption, type GuideState } from "@shared/guideChoice";
import { guideAudience, guideName } from "@shared/guideName";

type Deps = Pick<AppDeps, "authedUser" | "members" | "overLimit"> & {
  /** The name the village gave its own guide as stored, or "" when it gave none. */
  villageGuideName: () => string;
};

const HOUR_MS = 60 * 60 * 1000;
/** Choices one member may save in an hour. A member comparing guides switches often. */
const SAVES_PER_HOUR = 60;
/**
 * The guides one viewer may be answered by, and who answers them now.
 *
 * The village guide's name is the one the village typed, or the neutral label
 * while it has none, worded for this reader (shared/guideName.ts): "your
 * village guide" to a founder or admin, "the village guide" to everyone else.
 */
export function guideStateFor(viewer: { role?: string | null } | null, stored: unknown, villageGuideSource: unknown): GuideState {
  const own = guideName(villageGuideSource, guideAudience(viewer));
  const options: GuideOption[] = [{ id: "village", name: own.name, named: own.named, available: resolveKey() !== null }];
  if (viewer) {
    const sera = saberraGuideReach();
    options.push({ id: "saberra", name: sera.name, named: true, available: sera.available });
  }
  return resolveGuide(viewer ? parseGuideId(stored) : null, options);
}

export function register(app: Express, deps: Deps): void {
  const { authedUser, members, overLimit, villageGuideName } = deps;

  /** The choice, the guides on offer, and who answers now. Anybody may ask; a visitor is offered the village guide. */
  app.get("/api/guide", async (req, res) => {
    const me = await authedUser(req);
    res.json(guideStateFor(me ?? null, me?.prefs?.guide, villageGuideName()));
  });

  /** Save who this member talks to. Either guide may be chosen, reachable or not: the page says when it falls back. */
  app.put("/api/guide", async (req, res) => {
    const me = await authedUser(req);
    if (!me) return res.status(401).json({ error: "auth_required" });
    const guide = parseGuideId(req.body?.guide);
    if (!guide) return res.status(400).json({ error: "Choose the village guide or the outside agent." });
    if (await overLimit(`guide-choice:${me.id}`, SAVES_PER_HOUR, HOUR_MS)) {
      return res.status(429).json({ error: "That's a lot of switching. Try again in a little while." });
    }
    const updated = await members.update(me.id, (u: any) => {
      u.prefs = { ...(u.prefs ?? {}), guide };
    });
    if (!updated) return res.status(404).json({ error: "User not found" });
    res.json(guideStateFor(me, updated.prefs?.guide, villageGuideName()));
  });
}
