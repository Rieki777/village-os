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
 * Personal words have no route here. The aim saves through
 * `PUT /api/season-plans/mine`, the goals served, seasonal goals and card
 * words through `PUT /api/season-plans/mine/card`, and this moon's load
 * through `PUT /api/season-plans/mine/load` (#530); the card reads them back
 * here. Terms are never edited on the card: they change through a new role
 * application.
 *
 * The role's handover words ("Bring me", "Not mine to hold", the runbook,
 * #534) are role words like the purpose, and are proposed the same way.
 */
import type { Express } from "express";
import type { Pool } from "mysql2/promise";
import { hasCapability } from "../../shared/capabilities";
import { GAME_CONFIG } from "../../shared/gameConfig";
import { isAdmitted } from "../lib/admission";
import type { ModuleLifecycle } from "../../shared/modules";
import { roleWordPayload } from "../../shared/playerCardEdit";
import type { AppDeps } from "../lib/appDeps";
import { listArchetypes } from "../lib/characters";
import { villageId } from "../lib/economy";
import type { LapseContext } from "../lib/orgChart";
import { addChange, createDraft } from "../lib/orgDrafts";
import { buildPlayerCards, cardSeasons, type CardContext, type CardLevel, type CardTier } from "../lib/playerCardData";
import { userIdForHandle } from "../lib/profile";
import { villageClock } from "../lib/stewardship";
import type { CycleClock } from "../../shared/cycleClock";
import { mapShowsStructureTo, orgSeatTier } from "../lib/seatProjection";
import { hiddenFromStranger } from "../lib/peopleLock";
import { roleHeldBy } from "../repos/playerCard";

export type CardDeps = Pick<AppDeps, "authedUser" | "isAdmin" | "capabilityCtx" | "getPool" | "firstName"> & {
  /** `seasonState()`: every season, the current and upcoming ones, and the village's zone. */
  seasonState(): { current?: any; upcoming?: any; seasons?: any[]; timezone?: string };
  lapse(): LapseContext;
  /** The map module's effective lifecycle, for the structure rule. */
  mapLifecycle(): ModuleLifecycle;
  boolVar(key: string): boolean;
  villageName(): string | null;
  /** Tests hand in a fixed instant. */
  now?: () => Date;
  /** The village clock; the live `cycle.mode` by default, as the season plan routes read it. */
  clock?: () => CycleClock;
};

type Deps = CardDeps & Pick<AppDeps, "overLimit">;

/**
 * What a reader may see of the seat fields on a card: `/api/org`'s tier by
 * the same three functions. Shared with the proposal card on a role
 * application (server/routes/applicationCard.ts).
 */
export async function cardSeatTier(
  deps: CardDeps,
  req: any,
  viewer: any,
  v: { terms: boolean; isSelf: boolean },
): Promise<CardTier["seat"]> {
  const admin = await deps.isAdmin(req);
  const ctx = viewer ? await deps.capabilityCtx(viewer) : null;
  const viewPeople = admin || (ctx ? hasCapability("map.viewPeople", ctx) : false);
  return orgSeatTier({
    editing: false,
    terms: v.terms || v.isSelf,
    viewPeople: viewPeople || v.isSelf,
    peopleArePublic: deps.boolVar("org.public_people"),
    mapStructure: mapShowsStructureTo({
      lifecycle: deps.mapLifecycle(),
      publicStructure: deps.boolVar("map.public_structure"),
      signedIn: !!viewer,
      admin,
    }),
  });
}

/**
 * The card's context for one request: the clock, the seasons, the village and
 * its class names, whether the reader is an admin (for the accomplishments
 * rule), and this moon's id on the village clock (for the load read, the key
 * `PUT /api/season-plans/mine/load` writes under).
 */
export async function cardContext(deps: CardDeps, viewerId: string | null, viewerAdmin = false, viewerMember = false): Promise<CardContext> {
  const now = deps.now ? deps.now() : new Date();
  const state = deps.seasonState();
  const archetypes = await listArchetypes(deps.getPool(), villageId());
  return {
    now,
    timeZone: state.timezone || "UTC",
    viewerUserId: viewerId,
    viewerAdmin,
    viewerMember,
    moonId: (deps.clock ?? villageClock)().idFor(now),
    ...cardSeasons(state, now),
    villageName: deps.villageName(),
    lapse: deps.lapse(),
    archetypeNames: Object.fromEntries(archetypes.map((a) => [a.key, a.name])),
    firstName: deps.firstName,
    // 0274: the role card shows the CCOS terms under the circle card's own switch.
    frameworkTerms: deps.boolVar("org.ccos_terms"),
    // The owner's character portrait in the hero's gold ring.
    villageId: villageId(),
  };
}

/** Ten proposals in ten minutes per member: each one is a draft somebody has to read. */
const PROPOSALS_PER_WINDOW = 10;
const PROPOSAL_WINDOW_MS = 10 * 60 * 1000;

export function register(app: Express, deps: Deps): void {

  async function tierFor(req: any, ownerId: string): Promise<{ tier: CardTier; viewerId: string | null; admin: boolean; member: boolean }> {
    const viewer = await deps.authedUser(req);
    const ctx = viewer ? await deps.capabilityCtx(viewer) : null;
    const terms = ctx ? hasCapability("terms.read", ctx) : false;
    const viewerId = viewer ? String(viewer.id) : null;
    const isSelf = viewerId !== null && viewerId === ownerId;
    const seat = await cardSeatTier(deps, req, viewer, { terms, isSelf });
    const level: CardLevel = isSelf ? "self" : terms ? "member" : "stranger";
    const admin = viewer ? await deps.isAdmin(req) : false;
    // A member for the tensions: admitted, or an admin, the rule the tension doors use.
    const member = !!viewer && (isAdmitted(viewer, GAME_CONFIG.stages) || admin);
    return { tier: { level, seat }, viewerId, admin, member };
  }

  app.get("/api/people/:handle/role-card", async (req, res) => {
    const pool: Pool = deps.getPool();
    const handle = String(req.params.handle ?? "");
    const viewer = await deps.authedUser(req);
    // R097: while the village keeps its people for members, a handle finds
    // nobody for a stranger. Answering at all would confirm the member exists,
    // and the card carries their name and portrait.
    if (handle !== "me" && hiddenFromStranger(viewer, deps.boolVar("org.public_people"))) return res.status(404).json({ error: "Not found" });
    let ownerId = await userIdForHandle(pool, handle);
    if (!ownerId && handle === "me") {
      if (!viewer) return res.status(401).json({ error: "auth_required", message: "Sign in to see your card" });
      ownerId = String(viewer.id);
    }
    if (!ownerId) return res.status(404).json({ error: "Not found" });
    const { tier, viewerId, admin, member } = await tierFor(req, ownerId);
    const cards = await buildPlayerCards(pool, [{ userId: ownerId, tier }], await cardContext(deps, viewerId, admin, member));
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
    // The card lists the proposal on the role's section, with the doors that adopt it.
    res.json({ success: true, draftId: made.id, key: parsed.key });
  });
}
