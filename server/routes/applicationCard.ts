/**
 * THE PLAYER CARD ON A ROLE APPLICATION (PR 3 of 7).
 *
 *   GET /api/governance/role-applications/:id/card   the card the application asks for
 *
 * ── THE SAME CARD, IN PROPOSAL MODE ────────────────────────────────────────
 *
 * `/role-applications/:id` draws the candidate's player card in proposal mode
 * instead of a stack of role cards: one card for one person applying for up
 * to five roles. It is the batched builder the profile uses
 * (server/lib/playerCardData.ts), handed the application:
 *
 *   roles   the application's `seat_ids`
 *   terms   its `settings_json`, never the offer on the role
 *   live    tasks, signs and tensions read "Starts once adopted"
 *
 * ── TIERED EXACTLY LIKE THE APPLICATION PAGE ───────────────────────────────
 *
 * `GET /api/governance/role-applications/:id` answers 401 to a visitor and to
 * a signed-in guest: the gate is `terms.read`, asked through `guardCapability`
 * with the same body. This route asks the same question the same way, so a
 * reader who cannot read the application cannot read its card. Past the gate
 * the candidate reads their own card at the self tier and every other member
 * at the member tier. Holder names never reach the card at either.
 *
 * MOUNTED BELOW `requireModule("governance")`, like every route under the
 * /api/governance prefix, so the module's gate stays in front of it.
 *
 * ── `/api/org`'s HEALTH ────────────────────────────────────────────────────
 *
 * `orgRoleExtras` (server/lib/orgRoleHealth.ts) is re-exported here so
 * server/index.ts reaches it through this module's one import line, which the
 * size ratchet on that file exempts.
 */
import type { Express } from "express";
import { APPLICATION_ID } from "../../shared/seatApplications";
import type { AppDeps } from "../lib/appDeps";
import { buildPlayerCards } from "../lib/playerCardData";
import { readApplication } from "../repos/seatApplications";
import { cardContext, cardSeatTier, type CardDeps } from "./playerCard";

export { orgRoleExtras } from "../lib/orgRoleHealth";

type Deps = CardDeps & Pick<AppDeps, "guardCapability">;

/** The body the application read answers a visitor and a guest with, word for word. */
export const MEMBERS_ONLY = { error: "auth_required", message: "Members read role applications." };

export function register(app: Express, deps: Deps): void {
  app.get("/api/governance/role-applications/:id/card", async (req, res) => {
    if (!(await deps.guardCapability(req, res, "terms.read", { status: 401, body: MEMBERS_ONLY }))) return;
    const viewer = await deps.authedUser(req);
    if (!viewer) return res.status(401).json(MEMBERS_ONLY);
    const pool = deps.getPool();
    const id = String(req.params.id ?? "");
    const a = APPLICATION_ID.test(id) ? await readApplication(pool, id) : null;
    if (!a) return res.status(404).json({ error: "There is no application by that id." });
    const viewerId = String(viewer.id);
    const isSelf = viewerId === a.candidateUserId;
    const seat = await cardSeatTier(deps, req, viewer, { terms: true, isSelf });
    /*
     * THE SEASON THE APPLICATION IS FOR (E9): the one its term sits in, read
     * by id now, so a renamed season reads by its new name. One taken off the
     * calendar draws no season; an application with no season keeps the
     * running one, as it always did.
     */
    const s = a.termSeasonId ? (deps.seasonState().seasons ?? []).find((x: any) => x && String(x.id) === a.termSeasonId) : undefined;
    const season = a.termSeasonId
      ? s
        ? { id: String(s.id), name: s.name ? String(s.name) : null, startsOn: s.startsOn ? String(s.startsOn) : null, endsOn: s.endsOn ? String(s.endsOn) : null }
        : null
      : undefined;
    const cards = await buildPlayerCards(
      pool,
      [
        {
          userId: a.candidateUserId,
          tier: { level: isSelf ? "self" : "member", seat },
          proposal: {
            applicationId: a.id,
            seatIds: a.seatIds,
            settings: a.settings,
            termEndsAt: a.termEndsAt ? a.termEndsAt.toISOString() : null,
            season,
          },
        },
      ],
      await cardContext(deps, viewerId),
    );
    const card = cards.get(a.candidateUserId);
    // A candidate whose account is gone has no card; the page keeps its own list.
    if (!card) return res.status(404).json({ error: "This application has no card to show." });
    res.set("Cache-Control", "no-store").json(card);
  });
}
