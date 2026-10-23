/**
 * THE CIRCLE CARD, one page per circle (`/circles/:id`), the circle-level
 * sibling of the player role card, shaped by the CCOS Circle Charter.
 *
 *   GET  /api/org/circles/:id/card            the card, at the reader's tier
 *   POST /api/org/circles/:id/card/propose    propose new words for the circle
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
 * ── THE WRITE: A CIRCLE'S WORDS CHANGE BY CONSENT ─────────────────────────
 *
 * Rye, 2026-10-22: anyone holding a role in the circle may propose new words
 * for it, and so may an admin; everyone else raises a tension with one of its
 * roles. A proposal never writes the circle: it opens a one-change org draft
 * (`update_circle`, server/lib/circleWordsDraft.ts), decided where every org
 * draft is (server/routes/orgDraftDecide.ts), and the card says "Proposed,
 * waiting for consent" beside each word and lists the proposal, with the
 * words it proposes and the doors this reader may adopt it by, until it is
 * decided. Ten in ten minutes is the most anybody may open.
 */
import type { Express } from "express";
import { hasCapability } from "../../shared/capabilities";
import { CIRCLE_WORD_REFUSALS as R } from "../../shared/circleCardWords";
import { parseCircleWords } from "../../shared/circleCharterParse";
import type { ModuleLifecycle } from "../../shared/modules";
import type { AppDeps } from "../lib/appDeps";
import { buildCircleCardFor, type StoredCircle } from "../lib/circleCardData";
import type { LapseContext } from "../lib/orgChart";
import { addChange, createDraft } from "../lib/orgDrafts";
import { mapShowsStructureTo, orgSeatTier, type SeatTier } from "../lib/seatProjection";
import { holdsRoleInCircle } from "../repos/circleCard";

type Deps = Pick<AppDeps, "authedUser" | "isAdmin" | "capabilityCtx" | "getPool" | "overLimit"> & {
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

const PROPOSALS_PER_WINDOW = 10;
const PROPOSAL_WINDOW_MS = 10 * 60 * 1000;

/** A live holder of a role in this circle, or an admin: who may propose its words (Rye, 2026-10-22). */
async function mayPropose(deps: Deps, req: any, viewer: any, circle: StoredCircle): Promise<boolean> {
  if (!viewer || circle.isExample) return false;
  if (await deps.isAdmin(req)) return true;
  return holdsRoleInCircle(deps.getPool(), String(viewer.id), circle.id);
}

export function register(app: Express, deps: Deps): void {
  app.get("/api/org/circles/:id/card", async (req, res) => {
    const circles = deps.circles();
    const circle = circles.find((c) => c.id === String(req.params.id ?? ""));
    if (!circle) return res.status(404).json({ error: "not_found", message: "There is no circle here." });
    const viewer = await deps.authedUser(req);
    const card = await buildCircleCardFor(deps.getPool(), circle, circles, {
      now: deps.now ? deps.now() : new Date(),
      timeZone: deps.seasonState().timezone || "UTC",
      lapse: deps.lapse(),
      tier: await orgTierFor(deps, req),
      frameworkTerms: deps.boolVar("org.ccos_terms"),
    });
    res.json({
      circleId: circle.id,
      card,
      viewer: { signedIn: !!viewer, mayPropose: await mayPropose(deps, req, viewer, circle) },
    });
  });

  app.post("/api/org/circles/:id/card/propose", async (req, res) => {
    const viewer = await deps.authedUser(req);
    if (!viewer) return res.status(401).json({ error: "auth_required", message: R.signIn });
    const userId = String(viewer.id);
    if (await deps.overLimit(`circle-card-propose:${userId}`, PROPOSALS_PER_WINDOW, PROPOSAL_WINDOW_MS)) {
      return res.status(429).json({ error: "too_many_proposals", message: R.tooManyProposals });
    }
    const circle = deps.circles().find((c) => c.id === String(req.params.id ?? ""));
    if (!circle) return res.status(404).json({ error: "not_found", message: "There is no circle here." });
    if (circle.isExample) return res.status(409).json({ error: "example", message: R.example });
    if (!(await mayPropose(deps, req, viewer, circle))) return res.status(403).json({ error: "not_holder", message: R.notAHolder });
    const parsed = parseCircleWords(req.body);
    if (!parsed.ok) return res.status(400).json({ error: "refused", message: parsed.problem });
    const pool = deps.getPool();
    const made = await createDraft(pool, {
      title: `New words for ${circle.name}`.slice(0, 200),
      rationale: "Proposed from the circle card.",
      createdBy: userId,
      sourceKind: "human",
      openCap: null,
    });
    if (!made.ok) return res.status(409).json({ error: "refused", message: made.error });
    const added = await addChange(pool, made.id, { op: "update_circle", orgRoleId: `circle:${circle.id}`, payload: parsed.value });
    if (!added.ok) return res.status(400).json({ error: "refused", message: added.error });
    // The card lists the proposal, with the doors that adopt it, until it is decided.
    res.json({ success: true, draftId: made.id });
  });
}
