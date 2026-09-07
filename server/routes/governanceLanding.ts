/**
 * THE COUNTDOWN, AND THE DRY RUN.
 *
 *   GET  /api/governance/ballots/:id/landing     when it lands, and what it will write
 *   POST /api/game/mechanics/proposals/dry-run   what a change set would do
 *
 * ── WHERE THE VETO ITSELF LIVES ───────────────────────────────────────────
 *
 * `server/routes/governanceVetoes.ts`, and there is exactly one of them. This
 * module shipped a second veto route, written before the steward-veto lane
 * landed, and two routes on one path means the second one never runs and the
 * record it would have written never appears. What survived the merge is the
 * one that keeps the per-steward record, the reason, the redaction and the
 * council count. It asks this file's neighbour `vetoWindowOn` for the instant
 * and calls `recordVeto` to stop the landing, so the arithmetic stays in
 * `server/lib/applyDue.ts` and the record stays in `server/lib/stewardship.ts`.
 *
 * ── THE DRY RUN SHARES THE EXECUTOR'S VALIDATOR ────────────────────────────
 *
 * `dryRunProposal` calls the same phase 1 `applyChangeSet` calls. A preview
 * with its own reading of the rules would let a village vote on a yes and get a
 * no three days later with the vote already spent. Nothing here writes: the
 * ledger writer and the cache reload handed to the validator are no-ops,
 * because phase 1 never calls them and a dry run that could is a way to change
 * the world by asking a question.
 *
 * MOUNTED BEHIND requireModule("governance") for the /api/governance prefix,
 * which server/index.ts installs before this module's register() is called.
 */
import type { Express } from "express";
import type { AppDeps } from "../lib/appDeps";
import { numberVar, boolVar } from "../lib/variables";
import { landingRow } from "../lib/applyDue";
import { activeClock } from "../lib/gratitude-cycles";
import { dryRunProposal } from "../lib/proposalDryRun";
import { changeSetSnapsToBoundary, elementsFor, type ChangesetDeps } from "../lib/changeset";
import { CHANGE_SET_CAP } from "../lib/mechanics";
import { stewardsSeated } from "../lib/stewardship";
import { vetoHoursFrom } from "../../shared/governanceKinds";

type Deps = Pick<AppDeps, "authedUser" | "mayAct" | "getPool" | "members" | "firstName" | "notify">;

export function register(app: Express, deps: Deps): void {
  const { authedUser, getPool } = deps;

  /** Phase 1 needs a pool and nothing else. The rest are honestly inert here. */
  const previewDeps = (): ChangesetDeps => ({
    pool: getPool(),
    recordMechanicsChange: async () => {},
    reloadCaches: async () => {},
    sharedPasswordPosture: () => false,
  });

  /**
   * The countdown, and the trail. One read, so a page never has to ask four
   * tables what one decision did.
   */
  app.get("/api/governance/ballots/:id/landing", async (req, res) => {
    const row = await landingRow(getPool(), req.params.id);
    if (!row) return res.status(404).json({ error: "Not found" });
    const seated = (await stewardsSeated(getPool())).filter((h) => !h.lapsed);
    res.json({
      landsAt: row.landsAt ? row.landsAt.toISOString() : null,
      vetoClosesAt: row.landsAt ? row.landsAt.toISOString() : null,
      landingStatus: row.landingStatus,
      timing: row.timing,
      vetoedAt: row.vetoedAt ? row.vetoedAt.toISOString() : null,
      vetoedBy: row.vetoedBy,
      vetoReason: row.vetoReason,
      /** People and weight are shown together everywhere; here it is people. */
      stewardsSeated: seated.length,
      vetoHours: vetoHoursFrom(numberVar("governance.veto_hours")),
      stewardCouncil: boolVar("governance.steward_council"),
      elements: await elementsFor(getPool(), req.params.id),
    });
  });

  app.post("/api/game/mechanics/proposals/dry-run", async (req, res) => {
    const user = await authedUser(req);
    if (!user) return res.status(401).json({ error: "auth_required" });
    const changes = Array.isArray(req.body?.changeSet) ? req.body.changeSet : [];
    if (changes.length === 0) return res.status(400).json({ error: "A dry run needs at least one change to read" });
    if (changes.length > CHANGE_SET_CAP) {
      return res.status(400).json({ error: `A proposal carries at most ${CHANGE_SET_CAP} changes` });
    }
    const days = Math.max(1, Math.min(90, Number(numberVar("governance.vote_days")) || 7));
    const closesAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
    const out = await dryRunProposal(previewDeps(), {
      changes,
      timing: req.body?.timing,
      closesAt,
      vetoHours: vetoHoursFrom(numberVar("governance.veto_hours")),
      nextBoundaryAfter: (after: Date) => activeClock().nextBoundaryAfter(after),
      snapsToBoundary: (set) => changeSetSnapsToBoundary(set as any[]),
    });
    res.json({ ...out, closesAt: closesAt.toISOString(), preview: true });
  });
}
