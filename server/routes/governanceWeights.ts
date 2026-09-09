/**
 * Voting weight: who holds how much, who changed it, and why.
 *
 * Five routes, lifted out of server/index.ts unchanged:
 *
 *   GET /api/governance/weights                  the member-visible record
 *   GET /api/admin/governance/weights            the allocation surface
 *   PUT /api/admin/governance/weights/:userId    one member
 *   POST /api/admin/governance/weights/bulk      a whole pass, one reason
 *   GET /api/admin/governance/weights/history    the append-only trail
 *
 * The routes for a member's own standing and the proposal wizard were the
 * next block down in server/index.ts and went to server/routes/governanceWizard.ts.
 * They read weights too; they write none.
 *
 * ALL FIVE MOUNT BEHIND requireModule("governance"), which server/index.ts
 * installs on the /api/governance and /api/admin/governance prefixes before
 * this module's register() is called. The module ships OFF, and while it is
 * off every path here is a 404. Nothing in this file re-checks that, and
 * nothing in this file should: one place decides, and it is upstream.
 *
 * `weightModeNow` COMES IN THROUGH deps AND IS NOT REBUILT HERE. It is a
 * six-line reader over two game variables, and copying it would be the second
 * place that decides what a village's weight mode is. Thirteen call sites
 * read it; twelve are still in server/index.ts.
 *
 * WEIGHTS ARE POWER, AND THIS GAME HOLDS NO HIDDEN POWER. That promise is
 * server/lib/governanceWeights.ts's, and the reason the trail is append-only
 * and the reason both write routes tell the member affected. The long comment
 * on `tellMemberTheirWeightChanged` below carries the three judgements inside
 * that, and travels with the code that makes them.
 *
 * REGISTERED WHERE IT WAS, because Express matches in registration order.
 */
import type { Express } from "express";
import type { AppDeps } from "../lib/appDeps";
import { sortMembersByName } from "../../shared/memberOrder";
import { EXAMPLE_REFUSAL_BODY, isExampleUser } from "../lib/examples";
import { allWeights, setWeight, weightChangeProblem, weightHistory } from "../lib/governanceWeights";
import { readGameStart } from "../lib/gameStart";

type Deps = Pick<
  AppDeps,
  | "isAdmin"
  | "authedUser"
  | "adminActor"
  | "getPool"
  | "members"
  | "firstName"
  | "notify"
  | "weightModeNow"
>;

export function register(app: Express, deps: Deps): void {
  const { isAdmin, authedUser, adminActor, getPool, members, firstName, notify, weightModeNow } = deps;

  /**
   * AFTER THE BIRTHING, EVERY MEMBER'S WEIGHT IS THE VILLAGE'S TO SET.
   *
   * Dispatcher lane. These two routes rewrite what every future vote weighs, on
   * `isAdmin` alone, from the one plane a steward's veto does not reach. While
   * the Game has not started that is how a village is built and it stays. Once
   * it has started, an allocation is a `weight_allocation` element in a proposal
   * like any other change, and this door answers with the door.
   */
  async function weightWritesAreTheVillages(res: any): Promise<boolean> {
    if (!(await readGameStart(getPool())).started) return false;
    res.status(409).json({
      error: "The village started its Game, so what a member's vote weighs is the village's to decide. Raise it as a proposal.",
      proposeInstead: "weight_allocation",
    });
    return true;
  }

  /**
   * The member-visible weight record: how weight is assigned right now, the
   * custom allocations, and the append-only history. Weights are power;
   * hidden power ends here.
   */
  app.get("/api/governance/weights", async (req, res) => {
    const user = await authedUser(req);
    if (!user) return res.status(401).json({ error: "auth_required" });
    const snapshot = weightModeNow();
    const allocations = await allWeights(getPool());
    const history = await weightHistory(getPool());
    const nameOf = async (id: string) => {
      const u = await members.byId(id);
      return u ? firstName(u.name) : "A departed member";
    };
    res.json({
      mode: snapshot.mode,
      token: snapshot.token,
      allocations: await Promise.all(
        Array.from(allocations.entries()).map(async ([userId, weight]) => ({ member: await nameOf(userId), weight })),
      ),
      history: await Promise.all(
        history.map(async (h) => ({
          member: await nameOf(h.userId),
          oldWeight: h.oldWeight,
          newWeight: h.newWeight,
          by: await nameOf(h.actorUserId),
          note: h.note,
          at: h.at,
        })),
      ),
    });
  });

  /** The allocation surface: every real member with their current weight. */
  app.get("/api/admin/governance/weights", async (req, res) => {
    if (!(await isAdmin(req))) return res.status(401).json({ error: "auth_required" });
    const snapshot = weightModeNow();
    const allocations = await allWeights(getPool());
    // SORTED BY NAME here, where the allocation table can trust it. An admin
    // works down this table row by row, so the order has to be the same on the
    // read after a save as it was on the read before it.
    const rows = sortMembersByName(
      ((await members.all()) as any[])
        .filter((u) => !isExampleUser(u) && u.passwordHash)
        .map((u) => ({
          id: String(u.id),
          name: String(u.name),
          weight: allocations.get(String(u.id)) ?? 0,
        })),
    );
    res.json({
      mode: snapshot.mode,
      token: snapshot.token,
      members: rows,
      // The standing warning: a half-allocated village is visible before it
      // fails a quorum, never after.
      membersWithNoWeight: rows.filter((r) => r.weight === 0).length,
    });
  });

  /**
   * TELL THE MEMBER WHOSE VOTE JUST CHANGED WEIGHT.
   *
   * `server/lib/governanceWeights.ts` opens with the village's own promise:
   * weight is power, and this game holds no hidden power. The append-only
   * trail kept the first half of that and both write routes sent the person
   * affected nothing, so the reason the route DEMANDS at the point of the
   * change reached the record and never reached the one person it was
   * written for. A trail you have to already suspect something to go and read
   * is not the same as being told.
   *
   * Three judgments in here, each one deliberate:
   *
   *  - SILENCE WHEN NOTHING MOVED. Re-saving the same number appends a trail
   *    row, because the act happened, and moves no power. A notice saying a
   *    weight went from 5 to 5 is noise with a false shape.
   *  - SILENCE TOWARD YOURSELF. An admin allocating their own weight already
   *    knows; the open-ballot route excepts its own actor the same way.
   *  - THE MODE IS PART OF THE TRUTH. `governance_weights` only weighs votes
   *    while the mode is `custom`. Under equal or token the row is a real
   *    record of a real decision that weighs nothing today, and a notice that
   *    left that out would tell a member their vote counts for five when it
   *    counts for one.
   *
   * Fire-and-forget on purpose: a bulk pass is one of these per member, and
   * the admin's request must not hang on the bell.
   */
  async function tellMemberTheirWeightChanged(
    target: { id: string; name?: string | null },
    outcome: { changeId: string; oldWeight: number | null; moved: boolean },
    weight: number,
    note: string,
    actorId: string,
  ): Promise<void> {
    if (!outcome.moved || actorId === target.id) return;
    const snapshot = weightModeNow();
    const actorUser = await members.byId(actorId);
    const actorName = actorUser ? firstName(actorUser.name) : "A steward";
    const was = outcome.oldWeight === null ? "no allocation" : String(outcome.oldWeight);
    const modeLine =
      snapshot.mode === "custom"
        ? ""
        : snapshot.mode === "equal"
          ? " This village weighs every eligible vote the same today, so the allocation is on the record and is not what your vote weighs right now."
          : " This village weighs votes by token balance today, so the allocation is on the record and is not what your vote weighs right now.";
    /*
     * The operator's reason is quoted rather than run on. `modeLine` opens
     * with a space and a capital, so a reason typed without a full stop
     * produced one sentence out of two, verbatim: "The reason they gave:
     * probe allocation This village weighs every eligible vote the same
     * today...". A member had to read it three times.
     *
     * Their words are not edited. The closing stop is added only when the
     * reason has not ended itself, which is punctuation and not content.
     */
    const reason = note.trim();
    const reasonSentence = /[.!?…]$/.test(reason) ? reason : `${reason}.`;
    await notify({
      userId: target.id,
      type: "weight_changed",
      title: `Your voting weight allocation is now ${weight}`,
      body: `${actorName} changed it from ${was}. The reason they gave: ${reasonSentence}${modeLine}`,
      link: "/decisions",
      actorUserId: actorId,
      dedupeKey: `gw:${outcome.changeId}`,
    });
  }

  app.put("/api/admin/governance/weights/:userId", async (req, res) => {
    if (!(await isAdmin(req))) return res.status(401).json({ error: "auth_required" });
    if (await weightWritesAreTheVillages(res)) return;
    const problem = weightChangeProblem({ weight: req.body?.weight, note: req.body?.note });
    if (problem) return res.status(400).json({ error: problem });
    const target = await members.byId(req.params.userId);
    if (!target) return res.status(404).json({ error: "Not found" });
    if (isExampleUser(target)) return res.status(409).json(EXAMPLE_REFUSAL_BODY);
    const actor = (await authedUser(req))?.id ?? adminActor(req)?.id ?? "admin";
    const outcome = await setWeight(getPool(), {
      userId: target.id,
      weight: Number(req.body.weight),
      actorUserId: actor,
      note: String(req.body.note),
    });
    void tellMemberTheirWeightChanged(target, outcome, Number(req.body.weight), String(req.body.note), actor);
    res.json({ success: true });
  });

  /** Bulk allocation: one note explains the whole pass, one row per member. */
  app.post("/api/admin/governance/weights/bulk", async (req, res) => {
    if (!(await isAdmin(req))) return res.status(401).json({ error: "auth_required" });
    if (await weightWritesAreTheVillages(res)) return;
    const changes = Array.isArray(req.body?.changes) ? req.body.changes : [];
    const note = String(req.body?.note ?? "");
    if (changes.length === 0) return res.status(400).json({ error: "Nothing to change" });
    for (const c of changes) {
      const problem = weightChangeProblem({ weight: c?.weight, note });
      if (problem) return res.status(400).json({ error: problem });
      const target = await members.byId(String(c?.userId ?? ""));
      if (!target) return res.status(404).json({ error: `No member ${String(c?.userId ?? "")}` });
      if (isExampleUser(target)) return res.status(409).json(EXAMPLE_REFUSAL_BODY);
    }
    const actor = (await authedUser(req))?.id ?? adminActor(req)?.id ?? "admin";
    for (const c of changes) {
      const outcome = await setWeight(getPool(), {
        userId: String(c.userId),
        weight: Number(c.weight),
        actorUserId: actor,
        note,
      });
      // One note explains the whole pass, and each member hears about their
      // own row. A member has no way to see the other rows, so a shared note
      // is the only context the notice can carry, which is why the route
      // asks for one that reads as a reason and not as a label.
      const who = await members.byId(String(c.userId));
      if (who) void tellMemberTheirWeightChanged(who, outcome, Number(c.weight), note, actor);
    }
    res.json({ success: true, changed: changes.length });
  });

  app.get("/api/admin/governance/weights/history", async (req, res) => {
    if (!(await isAdmin(req))) return res.status(401).json({ error: "auth_required" });
    const userId = String(req.query.userId ?? "").trim() || undefined;
    res.json(await weightHistory(getPool(), userId));
  });
}
