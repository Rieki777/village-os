/**
 * Funding rounds routes: `/api/funding-rounds/**`, behind
 * `requireModule("funding-rounds")`.
 *
 *   GET   /api/funding-rounds                       pots and rounds, for members, and whether the asker holds pot.steward
 *   GET   /api/funding-rounds/rounds/:id            one round, its pot and its ideas
 *   POST  /api/funding-rounds/rounds/:id/ideas      share an idea while the round takes them
 *   POST  /api/funding-rounds/pots                  open a pot (pot.steward)
 *   POST  /api/funding-rounds/pots/:id/rounds       open a round on a pot (pot.steward)
 *   PATCH /api/funding-rounds/rounds/:id/dates      set or clear the grow, choose and harvest dates (pot.steward)
 *   PATCH /api/funding-rounds/ideas/:id             the author shapes their idea, in seed or grow (S3)
 *   POST  /api/funding-rounds/ideas/:id/withdraw    the author withdraws it, before choosing opens (S3)
 *   PUT   /api/funding-rounds/rounds/:id/marks      a member's ticks, replaced whole, while choosing (S3)
 *   POST  /api/funding-rounds/ideas/:id/pledges     back a quest with a pledge, at any stage (S3b)
 *   DELETE /api/funding-rounds/pledges/:id          the backer withdraws it, until choosing closes (S3b)
 *
 * Harvest has no door of its own: the first read of a round past its harvest
 * date runs the count, once (`harvestIfDue`), so no job and no person has to
 * remember to close it, and nobody can close it early.
 *
 * Every door needs a signed-in member. Steward doors ask the ONE gate with
 * `guardCapability`, so a village that holds pot.steward decides by its vote
 * path and the gate's record is written. No anonymous idea's author leaves the
 * server: every idea goes out through `ideaView` (server/lib/fundingRounds.ts).
 */
import type { Express } from "express";
import type { AppDeps } from "../lib/appDeps";
import {
  createPot, growIdea, ideaView, openRound, overview, pledgeToIdea, roundDetail, roundView, seedIdea, setMarks, setRoundDates, withdrawIdea, withdrawPledge, MODULE_ID,
  type HarvestDeps,
} from "../lib/fundingRounds";
import { requireModule } from "../lib/modules";

export { exportMemberFundingRounds, forgetMemberFundingRounds, fundingRoundsOpenState } from "../lib/fundingRounds";

type Deps = Pick<AppDeps, "authedUser" | "getPool" | "guardCapability" | "mayAct" | "overLimit" | "members" | "questsRepo"> & {
  /**
   * The village's voting roll with counted Voice: `buildElectorate` in
   * server/index.ts, the one every village vote opens with. Until S4 this is
   * the village's own ballot weight, so a round never weighs a member
   * differently from a vote; S4 swaps in the work-only read.
   */
  electorate: HarvestDeps["electorate"];
};

const HOUR_MS = 60 * 60 * 1000;
/** Ideas one member may post in an hour, across rounds. The round's own allowance is the real limit. */
const IDEAS_PER_HOUR = 10;
/** Edits and tick changes one member may send in an hour. Generous: a person changing their mind is the point. */
const CHANGES_PER_HOUR = 120;

export function register(app: Express, deps: Deps): void {
  const { authedUser, getPool, guardCapability, mayAct, overLimit, members, questsRepo } = deps;
  const harvest: HarvestDeps = { electorate: deps.electorate, questsRepo };

  /** Names by id for bylines, read once per request. */
  const namesNow = async (): Promise<(id: string) => string | null> => {
    const all = await members.all();
    const byId = new Map(all.map((m: any) => [String(m.id), m.name == null ? null : String(m.name)]));
    return (id: string) => byId.get(id) ?? null;
  };

  app.use("/api/funding-rounds", requireModule(MODULE_ID));

  app.get("/api/funding-rounds", async (req, res) => {
    if (!(await authedUser(req))) return res.status(401).json({ error: "auth_required" });
    // Whether to show the pot holder's controls. The doors still ask the gate themselves.
    const canSteward = (await mayAct(req, "pot.steward")).ok;
    res.json({ ...(await overview(getPool(), new Date(), await members.count())), canSteward });
  });

  app.get("/api/funding-rounds/rounds/:id", async (req, res) => {
    const me = await authedUser(req);
    if (!me) return res.status(401).json({ error: "auth_required" });
    const out = await roundDetail(getPool(), String(req.params.id), String(me.id), new Date(), await members.count(), await namesNow(), harvest);
    if (!out) return res.status(404).json({ error: "No such round." });
    res.json(out);
  });

  app.patch("/api/funding-rounds/ideas/:id", async (req, res) => {
    const me = await authedUser(req);
    if (!me) return res.status(401).json({ error: "auth_required" });
    const uid = String(me.id);
    if (await overLimit(`funding-change:${uid}`, CHANGES_PER_HOUR, HOUR_MS)) {
      return res.status(429).json({ error: "That is a lot of changes for one hour. Try again a little later." });
    }
    const out = await growIdea(getPool(), uid, String(req.params.id), req.body, new Date(), await namesNow());
    if (!out.ok) return res.status(out.status).json({ error: out.problem });
    res.json({ idea: out.idea });
  });

  app.post("/api/funding-rounds/ideas/:id/withdraw", async (req, res) => {
    const me = await authedUser(req);
    if (!me) return res.status(401).json({ error: "auth_required" });
    const out = await withdrawIdea(getPool(), String(me.id), String(req.params.id), new Date(), await namesNow());
    if (!out.ok) return res.status(out.status).json({ error: out.problem });
    res.json({ idea: out.idea });
  });

  app.put("/api/funding-rounds/rounds/:id/marks", async (req, res) => {
    const me = await authedUser(req);
    if (!me) return res.status(401).json({ error: "auth_required" });
    const uid = String(me.id);
    if (await overLimit(`funding-change:${uid}`, CHANGES_PER_HOUR, HOUR_MS)) {
      return res.status(429).json({ error: "That is a lot of changes for one hour. Try again a little later." });
    }
    const out = await setMarks(getPool(), uid, String(req.params.id), req.body, new Date());
    if (!out.ok) return res.status(out.status).json({ error: out.problem });
    res.json({ myMarks: out.myMarks });
  });

  app.post("/api/funding-rounds/ideas/:id/pledges", async (req, res) => {
    const me = await authedUser(req);
    if (!me) return res.status(401).json({ error: "auth_required" });
    const uid = String(me.id);
    if (await overLimit(`funding-change:${uid}`, CHANGES_PER_HOUR, HOUR_MS)) {
      return res.status(429).json({ error: "That is a lot of changes for one hour. Try again a little later." });
    }
    const out = await pledgeToIdea(getPool(), uid, String(req.params.id), req.body, new Date());
    if (!out.ok) return res.status(out.status).json({ error: out.problem });
    res.status(201).json({ pledge: out.pledge });
  });

  app.delete("/api/funding-rounds/pledges/:id", async (req, res) => {
    const me = await authedUser(req);
    if (!me) return res.status(401).json({ error: "auth_required" });
    const out = await withdrawPledge(getPool(), String(me.id), String(req.params.id), new Date());
    if (!out.ok) return res.status(out.status).json({ error: out.problem });
    res.json({ pledge: out.pledge });
  });

  app.post("/api/funding-rounds/rounds/:id/ideas", async (req, res) => {
    const me = await authedUser(req);
    if (!me) return res.status(401).json({ error: "auth_required" });
    const uid = String(me.id);
    if (await overLimit(`funding-idea:${uid}`, IDEAS_PER_HOUR, HOUR_MS)) {
      return res.status(429).json({ error: "That is a lot of ideas for one hour. Try again a little later." });
    }
    const nameOf = await namesNow();
    const out = await seedIdea(getPool(), { memberCount: () => members.count(), nameOf }, uid, String(req.params.id), req.body, new Date());
    if (!out.ok) return res.status(out.status).json({ error: out.problem });
    res.status(201).json({ idea: out.idea });
  });

  app.post("/api/funding-rounds/pots", async (req, res) => {
    const me = await authedUser(req);
    if (!me) return res.status(401).json({ error: "auth_required" });
    if (!(await guardCapability(req, res, "pot.steward"))) return;
    const out = await createPot(getPool(), String(me.id), req.body);
    if (!out.ok) return res.status(400).json({ error: out.problem });
    res.status(201).json({ pot: out.pot });
  });

  app.post("/api/funding-rounds/pots/:id/rounds", async (req, res) => {
    const me = await authedUser(req);
    if (!me) return res.status(401).json({ error: "auth_required" });
    if (!(await guardCapability(req, res, "pot.steward"))) return;
    const out = await openRound(getPool(), String(me.id), String(req.params.id), req.body);
    if (!out.ok) return res.status(out.status).json({ error: out.problem });
    res.status(201).json({ round: roundView(out.round, new Date(), await members.count(), 0) });
  });

  app.patch("/api/funding-rounds/rounds/:id/dates", async (req, res) => {
    const me = await authedUser(req);
    if (!me) return res.status(401).json({ error: "auth_required" });
    if (!(await guardCapability(req, res, "pot.steward"))) return;
    const out = await setRoundDates(getPool(), String(req.params.id), req.body, new Date());
    if (!out.ok) return res.status(out.status).json({ error: out.problem });
    res.json({ round: roundView(out.round, new Date(), await members.count(), 0) });
  });
}

/** Re-exported for tests that build an idea view without the routes. */
export { ideaView };
