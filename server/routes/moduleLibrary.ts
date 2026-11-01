/**
 * THE MODULE LIBRARY, ONE PAGE FOR EVERYONE (Rye, 2026-10-09).
 *
 *   GET /api/modules/catalog                every module, and how this reader sees the page
 *   PUT /api/admin/modules/:id/lifecycle    switch a module (who may, decided below)
 *   GET /api/modules/:id/history            when it went on, by whom, by which vote
 *
 * The first two moved here from `server/index.ts`, whose line ratchet only
 * turns down; the reasoning that came with them lives in this header now.
 *
 * ── THE CATALOG, AND THE VIEWER IT CARRIES ────────────────────────────────
 *
 * The platform's own "what a village can be" page: every module with its
 * platform copy, rendered server-side from shared/moduleCatalog.ts the same
 * way `priceLine` is, so the registry and the copy stay out of the client
 * bundle and check-voice keeps holding every sentence.
 *
 * State rides the `/api/modules` viewer filter: signed-in members get `on`
 * (true at members or public) and `lifecycle` where it is members or public,
 * stewards get `lifecycle` always, and an anonymous
 * reader gets no state key at all, so what a village is trying out never leaks.
 *
 * NEW: `viewer` says how this reader sees the page, decided HERE, so the client
 * never decides from `user.role`: visitor, member or steward, whether the
 * village has launched, whether this reader may turn a module on with one
 * press, and whether they may pause one. `shared/moduleSwitch.ts` holds the
 * rule; the switch route below asks the same function.
 *
 * `demotedBecause` travels to a signed-in reader only where the module was
 * configured for members or wider: telling a member "this is resting because
 * the Forum is off" reveals nothing a member could not already see, while a
 * preview's dependencies would whisper what a village is trying out.
 *
 * ── THE SWITCH ────────────────────────────────────────────────────────────
 *
 * Before launch, admins and founders switch freely, as they always have.
 * "Launch" is the launch ballot carrying, read off `launch-state`'s
 * `launchedByBallotId` (`launchBallotCarried` in server/lib/launch.ts). It is
 * deliberately NOT `founderPowerStands`: migration 0112 marked villages that
 * were issuing before the vote existed as started with no ballot behind them,
 * and on those (and on the test harness's mid-life fixture) no founder was ever
 * seated as a steward holding `module.switch`, so nobody could turn anything
 * on. A village that holds the vote seats its founders as stewards with every
 * handover power, this one included, so they keep switching directly.
 *
 * After launch:
 *
 *   - a live holder of `module.switch` may switch freely;
 *   - an admin who is not a holder may only narrow (pause, members-only, off),
 *     as a safety valve, and the change is announced on the village pulse;
 *   - turning ON is refused to everyone else with `proposeInstead`, because the
 *     village decides it by vote (a `module_lifecycle` change set on
 *     `POST /api/game/mechanics/proposals`, applied by server/lib/changeset.ts).
 *
 * Every switch lands in `module_events` through `setModuleLifecycle`, which is
 * the module's own history; the announcement is the second record, for people.
 *
 * ── THE HISTORY ───────────────────────────────────────────────────────────
 *
 * Readable to signed-in members. A member sees switches that crossed into or
 * out of what members can see; a preview is shown to stewards only, the same
 * line the catalog draws. A first name rides with each switch for a member,
 * because "who turned this on" is the question the strip exists to answer, and
 * nothing at all rides for a visitor, who is refused.
 */
import type { Express, Request } from "express";
import type { AppDeps } from "../lib/appDeps";
import {
  LIFECYCLE_RANK,
  MODULES,
  MODULES_BY_ID,
  modulesOwning,
  priceLine,
  supportRoute,
  type ModuleLifecycle,
} from "../../shared/modules";
import { VARIABLES, ringOf } from "../../shared/gameVariables";
import { BUILD_A_MODULE_URL, BUILDERS_POOL_URL, MODULE_CATALOG, MODULE_GROUPS } from "../../shared/moduleCatalog";
import { poolStatus } from "../../shared/modulePool";
import {
  MODULE_SWITCH_KEY,
  isLifecycle,
  libraryViewer,
  lifecycleWords,
  switchVerdict,
  type LibraryViewer,
} from "../../shared/moduleSwitch";
import type { ValidateChangeSetOptions } from "../lib/mechanics";
import { effectiveLifecycle, moduleConfig, moduleDemotions, setModuleLifecycle, storedLifecycle } from "../lib/modules";
import { launchBallotCarried } from "../lib/launch";
import { founderPowerStands } from "../lib/gameStart";
// Re-exported so server/index.ts takes them on its route-module import line (the ratchet exempts that line).
export { founderAdoptable, founderHeldVoteProblem } from "../lib/founderDials";
import { recordEvent } from "../lib/events";
import { getPool } from "../db/pool";
import { register as registerSetupGame } from "./setupGame";
import { liveModuleProposal, moduleLifecycleRows, moduleVoteWrites } from "../repos/moduleHistory";
import { moduleNeeds } from "../../shared/moduleNeeds";

/**
 * What the change-set validator needs to take a module switch to a vote.
 * Exported so `server/index.ts` passes it on the proposals route without a
 * second import line.
 */
export const moduleChangeReaders: ValidateChangeSetOptions = {
  moduleLifecycleOf: (id) => effectiveLifecycle(id),
  openModuleProposal: async (id) => (await liveModuleProposal(getPool(), id))?.id ?? null,
  foundersHold: () => founderPowerStands(getPool()),
};

type Deps = Pick<AppDeps, "isAdmin" | "authedUser" | "firstName" | "projectName"> & {
  buildMarker: string;
  /** Every live holder of a capability, counted without the admin short-circuit. */
  liveHoldersOf: (capability: string) => Promise<string[]>;
  /** True while a shared password is the only admin credential (funds modules refuse to enable). */
  sharedPasswordPosture: () => Promise<boolean>;
  /** Reveal a module's standing examples the first time it turns on. A courtesy; never throws. */
  seedExamplesOnEnable: (moduleId: string) => Promise<void>;
};

const OPEN_DIALS = VARIABLES.filter((v) => ringOf(v) === "open").map((v) => v.key);

const visibleToMembers = (lc: string | null | undefined) =>
  isLifecycle(lc) && LIFECYCLE_RANK[lc] >= LIFECYCLE_RANK.members;

export function register(app: Express, deps: Deps): void {
  const { isAdmin, authedUser, firstName } = deps;

  // The setup game's map reads the same registry this page does, so it rides
  // this module's registration and server/index.ts does not grow.
  registerSetupGame(app, { isAdmin, projectName: deps.projectName });

  /** Who is asking, in the three facts every route here reads. */
  const whoIs = async (req: Request) => {
    const admin = await isAdmin(req);
    const user = await authedUser(req);
    const holder = user ? (await deps.liveHoldersOf(MODULE_SWITCH_KEY)).includes(String(user.id)) : false;
    const launched = await launchBallotCarried(getPool());
    return { admin, user, holder, launched };
  };

  app.get("/api/modules/catalog", async (req, res) => {
    const { admin, user, holder, launched } = await whoIs(req);
    const authed = admin || !!user;
    const viewer: LibraryViewer = libraryViewer({ signedIn: authed, admin, holder, launched });
    // A holder who is not an admin switches modules too, so they need the
    // state a switch reads. Everyone else gets what they had.
    const seesState = admin || (launched && holder);
    const demotions = new Map(moduleDemotions().map((d) => [d.id, d.missing]));
    res.json({
      platform: { name: deps.projectName(), build: deps.buildMarker },
      groups: MODULE_GROUPS,
      // The last card on the shelf: build one, get paid in $ReGen (R20).
      builder: { guideUrl: BUILD_A_MODULE_URL, poolUrl: BUILDERS_POOL_URL },
      viewer,
      modules: MODULES.map((m) => {
        const lc = effectiveLifecycle(m.id);
        const cfg = moduleConfig<any>(m.id);
        // Validated on the way OUT as well as in: a hand-edited config row must
        // not point the public catalog at an offsite image. A village's own art
        // only shows once the module serves members or wider (admins always see
        // it), because custom art on an off module would whisper what a village
        // is trying out.
        const imageUrl =
          typeof cfg?.imageUrl === "string" &&
          cfg.imageUrl.startsWith("/api/uploads/") &&
          (admin || !!m.core || LIFECYCLE_RANK[lc] >= LIFECYCLE_RANK.members)
            ? cfg.imageUrl
            : null;
        const missing = demotions.get(m.id) ?? null;
        const demotedBecause =
          missing && (seesState || (authed && visibleToMembers(storedLifecycle(m.id))))
            ? missing.map((id) => MODULES_BY_ID[id]?.name ?? id)
            : null;
        return {
          id: m.id,
          name: m.name,
          description: m.description,
          core: !!m.core,
          tier: m.tier,
          dataClass: m.dataClass,
          provides: m.provides ?? null,
          support: supportRoute(m),
          pool: poolStatus(m),
          group: m.group ?? null,
          setup: m.setup ?? "none",
          requires: m.requires,
          recommends: m.recommends,
          legalReview: !!m.legalReview,
          withdrawn: m.withdrawn ?? null,
          priceLine: m.pricing ? priceLine(m.pricing) : null,
          card: MODULE_CATALOG[m.id] ?? null,
          // What has to be planted before it runs: its guild, in the seed
          // catalog's own words. Public, because it describes keys and never
          // holds one, and a visitor deciding about a village reads it too.
          needs: moduleNeeds(m.guild),
          imageUrl,
          // The dials this module owns that the village may propose changes
          // to (the open ring). A member suggests a change beside the dial
          // through the ordinary mechanics proposal (Rye, 2026-09-25).
          dialKeys: OPEN_DIALS.filter((key) => modulesOwning(key).includes(m.id)),
          ...(authed ? { on: m.core || lc === "members" || lc === "public", demotedBecause } : {}),
          // A member is told how wide a module they can already see stands
          // (members or everyone), so a proposal never asks for what is there.
          // Preview and off stay unsaid below steward.
          ...(seesState
            ? { lifecycle: m.core ? "public" : lc }
            : authed && (m.core || visibleToMembers(lc))
              ? { lifecycle: m.core ? "public" : lc }
              : {}),
        };
      }),
    });
  });

  app.put("/api/admin/modules/:id/lifecycle", async (req, res) => {
    const { admin, user, holder, launched } = await whoIs(req);
    if (!admin && !holder) return res.status(401).json({ error: "auth_required" });
    const id = req.params.id;
    const def = MODULES_BY_ID[id];
    // `examples: false` skips the seed-on-enable below for THIS request only
    // (the library's Turn on offers "start with example content" as a choice).
    const { lifecycle, examples } = req.body ?? {};
    const to = String(lifecycle);
    const from: ModuleLifecycle = def && !def.core ? storedLifecycle(id) : "public";
    if (def && !def.core && isLifecycle(to)) {
      const verdict = switchVerdict({ launched, admin, holder, from, to });
      if (!verdict.ok) return res.status(verdict.status).json(verdict);
    }
    const actorId = user?.id ? String(user.id) : null;
    // Funds-bearing modules refuse to enable while no per-admin identity with a
    // real credential exists (invariants #11-#12).
    const posture = await deps.sharedPasswordPosture();
    const result = await setModuleLifecycle(id, to as ModuleLifecycle, actorId, { sharedPasswordPosture: () => posture });
    if (!result.ok) {
      const { status, ...body } = result as any;
      return res.status(status).json(body);
    }
    // Turning a module on for the first time reveals its standing examples, so
    // the founder meets a worked module rather than "No items yet." A no-op if
    // it was ever seeded or retired, or already holds real content.
    if (result.lifecycle !== "off" && examples !== false) await deps.seedExamplesOnEnable(id);
    // After launch, a change members could see is said out loud on the pulse.
    // Before launch nothing is public yet, and a preview stays quiet always.
    const announce = launched && (visibleToMembers(from) || visibleToMembers(result.lifecycle));
    if (announce && def) {
      const who = user?.name ? firstName(String(user.name)) : "A steward";
      await recordEvent(getPool(), {
        kind: "governance",
        text: `${who} set ${def.name} to ${lifecycleWords(result.lifecycle).toLowerCase()} (it was ${lifecycleWords(from).toLowerCase()})`,
        actorUserId: actorId,
        entityType: "module",
        entityRef: id,
      });
    }
    res.json({ success: true, lifecycle: result.lifecycle, served: effectiveLifecycle(id), announced: announce });
  });

  app.get("/api/modules/:id/history", async (req, res) => {
    const { admin, user, holder, launched } = await whoIs(req);
    if (!user && !admin) return res.status(401).json({ error: "auth_required" });
    const def = MODULES_BY_ID[req.params.id];
    if (!def) return res.status(404).json({ error: "No such module" });
    const steward = admin || (launched && holder);
    const pool = getPool();
    const [rows, votes, proposal] = await Promise.all([
      moduleLifecycleRows(pool, def.id),
      moduleVoteWrites(pool, def.id),
      liveModuleProposal(pool, def.id),
    ]);
    res.json({
      events: composeModuleHistory(rows, votes, { steward }).map((e) => ({
        ...e,
        by: e.by ? firstName(e.by) : null,
      })),
      openProposal: proposal
        ? {
            id: proposal.id,
            title: proposal.title,
            status: proposal.status,
            ballotId: proposal.ballotId,
            closesAt: proposal.closesAt ? proposal.closesAt.toISOString() : null,
            to: proposal.to,
          }
        : null,
    });
  });
}

export interface HistoryEntry {
  from: string;
  to: string;
  at: string;
  /** The account's full name; the route trims it to a first name. Null for a vote or the system. */
  by: string | null;
  /** The vote that wrote this switch, when one did. */
  ballot: { id: string; title: string | null } | null;
}

/**
 * The strip a module page shows, from the two records.
 *
 * A vote's write and the `module_events` row it caused are written moments
 * apart by one call, so a switch is matched to the vote that wrote the same
 * value within five minutes. Below steward, preview reads as off, and a switch
 * that only moved between those two (off and preview) is left out, so a member
 * never learns what a village tried in private.
 */
export function composeModuleHistory(
  rows: ReadonlyArray<{ from: string | null; to: string | null; at: Date; byName: string | null }>,
  votes: ReadonlyArray<{ ballotId: string; title: string | null; newValue: string | null; appliedAt: Date }>,
  opts: { steward: boolean },
): HistoryEntry[] {
  const seen = (lc: string | null) => {
    const v = lc ?? "off";
    return !opts.steward && v === "preview" ? "off" : v;
  };
  const out: HistoryEntry[] = [];
  for (const r of rows) {
    const from = seen(r.from);
    const to = seen(r.to);
    if (from === to) continue;
    const vote = votes.find(
      (v) => v.newValue === r.to && Math.abs(v.appliedAt.getTime() - r.at.getTime()) <= 5 * 60 * 1000,
    );
    out.push({
      from,
      to,
      at: r.at.toISOString(),
      by: vote ? null : r.byName,
      ballot: vote ? { id: vote.ballotId, title: vote.title } : null,
    });
  }
  return out;
}
