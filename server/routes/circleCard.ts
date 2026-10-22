/**
 * THE CIRCLE CARD, one page per circle (`/circles/:id`), the circle-level
 * sibling of the player role card, shaped by the CCOS Circle Charter.
 *
 *   GET /api/org/circles/:id/card    the card, at the reader's tier
 *
 * ── WHY UNDER /api/org ─────────────────────────────────────────────────────
 *
 * `/api/circles` sits behind the map module, because it serves the map's own
 * shape. A circle's name and words are core data that /circles, /roles and
 * /team print from the ungated `/api/org`, so the card is read beside them and
 * stays readable with the map module off.
 *
 * ── THE READ ───────────────────────────────────────────────────────────────
 *
 * One builder (server/lib/circleCardData.ts) over each table once, then the
 * pure model (shared/circleCard.ts). The tier is `/api/org`'s, by the same
 * three functions, `orgSeatTier`, `mapShowsStructureTo` and the `terms.read`
 * key, so a role on this card shows no more and no less than it does on /roles.
 *
 * The circle's words change only by consent, through an org draft. This route
 * writes nothing.
 */
import type { Express } from "express";
import { hasCapability } from "../../shared/capabilities";
import type { ModuleLifecycle } from "../../shared/modules";
import type { AppDeps } from "../lib/appDeps";
import { buildCircleCardFor, type StoredCircle } from "../lib/circleCardData";
import type { LapseContext } from "../lib/orgChart";
import { mapShowsStructureTo, orgSeatTier, type SeatTier } from "../lib/seatProjection";

type Deps = Pick<AppDeps, "authedUser" | "isAdmin" | "capabilityCtx" | "getPool"> & {
  /** Every circle in the store (`circlesRepo.all()`). */
  circles(): readonly StoredCircle[];
  /** `seasonState()`, read for the village's zone. */
  seasonState(): { timezone?: string };
  lapse(): LapseContext;
  /** The map module's effective lifecycle, for the structure rule. */
  mapLifecycle(): ModuleLifecycle;
  boolVar(key: string): boolean;
  /** Tests hand in a fixed instant. */
  now?: () => Date;
};

/** `/api/org`'s tier for this reader, by the same three functions. */
async function orgTierFor(deps: Deps, req: any): Promise<SeatTier> {
  const viewer = await deps.authedUser(req);
  const admin = await deps.isAdmin(req);
  const ctx = viewer ? await deps.capabilityCtx(viewer) : null;
  return orgSeatTier({
    editing: false,
    terms: ctx ? hasCapability("terms.read", ctx) : false,
    viewPeople: admin || (ctx ? hasCapability("map.viewPeople", ctx) : false),
    peopleArePublic: deps.boolVar("org.public_people"),
    mapStructure: mapShowsStructureTo({
      lifecycle: deps.mapLifecycle(),
      publicStructure: deps.boolVar("map.public_structure"),
      signedIn: !!viewer,
      admin,
    }),
  });
}

export function register(app: Express, deps: Deps): void {
  app.get("/api/org/circles/:id/card", async (req, res) => {
    const circles = deps.circles();
    const circle = circles.find((c) => c.id === String(req.params.id ?? ""));
    if (!circle) return res.status(404).json({ error: "not_found", message: "There is no circle here." });
    const card = await buildCircleCardFor(deps.getPool(), circle, circles, {
      now: deps.now ? deps.now() : new Date(),
      timeZone: deps.seasonState().timezone || "UTC",
      lapse: deps.lapse(),
      tier: await orgTierFor(deps, req),
      frameworkTerms: deps.boolVar("org.ccos_terms"),
    });
    res.json({ circleId: circle.id, card });
  });
}
