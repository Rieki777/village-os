/**
 * THE PLAYER ROLE CARD, live on the profile and the public profile (PR 2 of 7).
 *
 *   GET  /api/people/:handle/role-card                    the card, at the reader's tier
 *   POST /api/people/me/role-card/roles/:roleId/propose   the holder proposes new words for a role
 *
 * ── THE READ ───────────────────────────────────────────────────────────────
 *
 * One batched builder (server/lib/playerCardData.ts) over every table once,
 * then the pure model (shared/playerCard.ts). The tier is `/api/org`'s, by the
 * same three functions: `orgSeatTier`, `mapShowsStructureTo` and the
 * `terms.read` key. `me` is the reader's own card when no member has that
 * handle.
 *
 * ── THE WRITE: ROLE WORDS CHANGE BY CONSENT ────────────────────────────────
 *
 * A role's purpose, what it decides and what it answers for belong to the
 * role, and Rye ruled they change by consent (2026-10-22). So the card never
 * writes `org_roles`: the holder's edit opens a one-change org draft
 * (`update_seat`), the same path every reorganisation takes, and the draft is
 * decided where every org draft is (server/routes/orgDraftDecide.ts). The card
 * reads the open draft back and says "Proposed, waiting for consent" until it
 * is adopted. Only a live holder of the role may open one from here, and ten
 * in ten minutes is the most anybody may.
 *
 * Personal words have no route here. The two with a home today, the season
 * aim and the village goal it serves, save through `PUT /api/season-plans/mine`;
 * the rest arrive with the season plan migration (PR 6). Terms are never
 * edited on the card: they change through a new role application.
 */
import type { Express } from "express";
import type { Pool } from "mysql2/promise";
import { hasCapability } from "../../shared/capabilities";
import type { ModuleLifecycle } from "../../shared/modules";
import { roleWordPayload } from "../../shared/playerCardEdit";
import type { AppDeps } from "../lib/appDeps";
import { listArchetypes } from "../lib/characters";
import { villageId } from "../lib/economy";
import type { LapseContext } from "../lib/orgChart";
import { addChange, createDraft } from "../lib/orgDrafts";
import { buildPlayerCards, cardSeasons, type CardLevel, type CardTier } from "../lib/playerCardData";
import { userIdForHandle } from "../lib/profile";
import { mapShowsStructureTo, orgSeatTier } from "../lib/seatProjection";
import { roleHeldBy } from "../repos/playerCard";

type Deps = Pick<AppDeps, "authedUser" | "isAdmin" | "capabilityCtx" | "getPool" | "firstName" | "overLimit"> & {
  /** `seasonState()`: the current and upcoming seasons and the village's zone. */
  seasonState(): { current?: any; upcoming?: any; timezone?: string };
  lapse(): LapseContext;
  /** The map module's effective lifecycle, for the structure rule. */
  mapLifecycle(): ModuleLifecycle;
  boolVar(key: string): boolean;
  villageName(): string | null;
  /** Tests hand in a fixed instant. */
  now?: () => Date;
};

/** Ten proposals in ten minutes per member: each one is a draft somebody has to read. */
const PROPOSALS_PER_WINDOW = 10;
const PROPOSAL_WINDOW_MS = 10 * 60 * 1000;

export function register(app: Express, deps: Deps): void {
  const now = () => (deps.now ? deps.now() : new Date());

  async function tierFor(req: any, ownerId: string): Promise<{ tier: CardTier; viewerId: string | null }> {
    const viewer = await deps.authedUser(req);
    const admin = await deps.isAdmin(req);
    const ctx = viewer ? await deps.capabilityCtx(viewer) : null;
    const viewPeople = admin || (ctx ? hasCapability("map.viewPeople", ctx) : false);
    const terms = ctx ? hasCapability("terms.read", ctx) : false;
    const viewerId = viewer ? String(viewer.id) : null;
    const isSelf = viewerId !== null && viewerId === ownerId;
    const seat = orgSeatTier({
      editing: false,
      terms: terms || isSelf,
      viewPeople: viewPeople || isSelf,
      peopleArePublic: deps.boolVar("org.public_people"),
      mapStructure: mapShowsStructureTo({
        lifecycle: deps.mapLifecycle(),
        publicStructure: deps.boolVar("map.public_structure"),
        signedIn: !!viewer,
        admin,
      }),
    });
    const level: CardLevel = isSelf ? "self" : terms ? "member" : "stranger";
    return { tier: { level, seat }, viewerId };
  }

  app.get("/api/people/:handle/role-card", async (req, res) => {
    const pool: Pool = deps.getPool();
    const handle = String(req.params.handle ?? "");
    let ownerId = await userIdForHandle(pool, handle);
    if (!ownerId && handle === "me") {
      const viewer = await deps.authedUser(req);
      if (!viewer) return res.status(401).json({ error: "auth_required", message: "Sign in to see your card" });
      ownerId = String(viewer.id);
    }
    if (!ownerId) return res.status(404).json({ error: "Not found" });
    const { tier, viewerId } = await tierFor(req, ownerId);
    const state = deps.seasonState();
    const archetypes = await listArchetypes(pool, villageId());
    const cards = await buildPlayerCards(pool, [{ userId: ownerId, tier }], {
      now: now(),
      timeZone: state.timezone || "UTC",
      viewerUserId: viewerId,
      ...cardSeasons(state),
      villageName: deps.villageName(),
      lapse: deps.lapse(),
      archetypeNames: Object.fromEntries(archetypes.map((a) => [a.key, a.name])),
      firstName: deps.firstName,
    });
    const card = cards.get(ownerId);
    if (!card) return res.status(404).json({ error: "Not found" });
    res.json(card);
  });

  app.post("/api/people/me/role-card/roles/:roleId/propose", async (req, res) => {
    const viewer = await deps.authedUser(req);
    if (!viewer) return res.status(401).json({ error: "auth_required", message: "Sign in to propose a change" });
    const userId = String(viewer.id);
    if (await deps.overLimit(`role-card-propose:${userId}`, PROPOSALS_PER_WINDOW, PROPOSAL_WINDOW_MS)) {
      return res.status(429).json({ error: "too_many_proposals", message: "That is a lot of proposals in a few minutes. Wait a little and try again." });
    }
    const pool = deps.getPool();
    const roleId = String(req.params.roleId ?? "");
    const role = await roleHeldBy(pool, userId, roleId);
    if (!role) return res.status(403).json({ error: "not_holder", message: "Only someone who holds this role can propose its words from the card." });
    const parsed = roleWordPayload(req.body);
    if (!parsed.ok) return res.status(400).json({ error: parsed.error });
    const made = await createDraft(pool, {
      title: `New words for ${role.name}`.slice(0, 200),
      rationale: "Proposed from the role card by the role's holder.",
      createdBy: userId,
      sourceKind: "human",
      openCap: null,
    });
    if (!made.ok) return res.status(409).json({ error: made.error });
    const added = await addChange(pool, made.id, { op: "update_seat", orgRoleId: roleId, payload: parsed.payload });
    if (!added.ok) return res.status(400).json({ error: added.error });
    res.json({ success: true, draftId: made.id, key: parsed.key, review: "/review" });
  });
}
