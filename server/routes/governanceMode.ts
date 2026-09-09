/**
 * HOW A VILLAGE CHANGES THE WAY IT WEIGHS A VOTE.
 *
 *   POST /api/governance/mode-switches   open the ballot that changes it
 *
 * ── WHY THIS ROUTE EXISTS ──────────────────────────────────────────────────
 *
 * `governance_mode` has had a closer in the subject table and a constitutional
 * price in `shared/ballotSubjects.ts` for a while, and until now nothing could
 * OPEN one. The admin dial route refuses `governance.weight_mode` and
 * `governance.weight_token` once the Game has started and says "raise it as a
 * proposal", and there was no proposal to raise: the subject was reachable
 * from a test fixture and from nowhere a member could stand. A door that only a
 * test can open is a promise the product does not keep.
 *
 * ── WHAT IT ASKS ───────────────────────────────────────────────────────────
 *
 * The constitutional bar, from `thresholdsFor`, because the subject table
 * prices it there: this changes how every vote in the village is counted, and
 * a village that could move it at the ordinary bar could move everything else
 * through the new one. The bar is never computed here; the subject table is
 * asked, so the price a member is shown and the price the close enforces are
 * the same number.
 *
 * ── WHAT IT DOES NOT DO ────────────────────────────────────────────────────
 *
 * It does not switch anything. The ballot's subject ref is `<mode>@<token>`
 * and the executor in `server/index.ts` runs the same `mode_switch` change-set
 * element a proposal would, through the same validator, which is where the
 * refusal for a purchasable weight token lives. This route asks the question.
 *
 * MOUNTED BEHIND requireModule("governance") for the /api/governance prefix,
 * which server/index.ts installs before this module's register() is called.
 */
import type { Express } from "express";
import type { AppDeps } from "../lib/appDeps";
import { numberVar, stringVar } from "../lib/variables";
import { openBallot } from "../lib/ballots";
import { capabilityDecision, hasCapability } from "../../shared/capabilities";
import { GOVERNANCE_MODE, thresholdsFor } from "../../shared/ballotSubjects";
import { villageBallotMethod, type BallotMethod } from "../../shared/governanceEngine";
import { VARIABLES_BY_KEY } from "../../shared/gameVariables";

type Deps = Pick<AppDeps, "authedUser" | "getPool" | "capabilityCtx" | "firstName" | "weightModeNow"> & {
  buildElectorate: () => Promise<Array<{ userId: string; weight: number }>>;
};

export function register(app: Express, deps: Deps): void {
  const { authedUser, getPool, capabilityCtx, firstName, weightModeNow, buildElectorate } = deps;

  app.post("/api/governance/mode-switches", async (req, res) => {
    const user = await authedUser(req);
    if (!user) return res.status(401).json({ error: "auth_required" });
    const ctx = await capabilityCtx(user);
    /*
     * A MEMBER OPENS THIS, NOT AN ADMINISTRATOR. The same gate every other
     * ceremony takes: `capabilityDecision` with `isAdmin: false`, so an
     * account whose only path to `proposal.open` is the admin plane is
     * refused and told to ask a member to carry it.
     */
    if (!capabilityDecision("proposal.open", { ...ctx, isAdmin: false }).allowed) {
      return res.status(403).json({
        error: hasCapability("proposal.open", ctx)
          ? "Changing how a vote is weighed is the village's own act. Opening one takes somebody who holds proposal.open as a member of this village, and your only path to it today is your administrator account."
          : "Opening a vote for the whole village is for a proposal.open holder",
      });
    }

    const to = String(req.body?.mode ?? "").trim().toLowerCase();
    const choices = (VARIABLES_BY_KEY["governance.weight_mode"]?.choices ?? []).map((c) => c.value);
    if (!choices.includes(to)) {
      return res.status(400).json({
        error: `This platform assigns weight in these ways: ${choices.join(", ")}. Name one of them.`,
      });
    }
    const token = String(req.body?.weightToken ?? "").trim();
    if (to === "token" && !token) {
      return res.status(400).json({ error: "Weighing a vote by a token means naming the token. Say which one." });
    }
    const reason = String(req.body?.reason ?? "").trim();
    if (reason.length < 40) {
      return res.status(400).json({
        error: "Say why, in at least forty characters. This changes how every vote in the village is counted, and the village reads the reason before it answers.",
      });
    }

    const snapshot = weightModeNow();
    if (to === snapshot.mode && (to !== "token" || token === (snapshot.token ?? ""))) {
      return res.status(409).json({ error: "That is already how this village weighs a vote." });
    }

    const villageMethod = villageBallotMethod(stringVar("governance.default_method"));
    const dials = thresholdsFor(
      { subjects: [GOVERNANCE_MODE] },
      villageMethod === "hypha" ? "custom" : (villageMethod as BallotMethod),
      { unityPct: Math.max(0, numberVar("governance.unity_pct")), quorumPct: Math.max(0, numberVar("governance.quorum_pct")) },
    );
    const conducts: BallotMethod = dials.method ?? (villageMethod === "hypha" ? "custom" : villageMethod);
    const title = `How this village weighs a vote: ${snapshot.mode} to ${to}`;
    const doc = [
      `# ${title}`,
      "",
      reason,
      "",
      "## What this changes",
      "",
      `Every vote held after this lands is weighed the new way. Votes already open keep the weights frozen onto them when they opened, so nothing that is running changes under anybody.`,
      "",
      `This is asked at the constitutional bar: ${dials.quorumPct}% of the village's voting weight has to take part and ${dials.unityPct}% of what is cast has to agree. People counts are shown beside the weight on the ballot.`,
      "",
      `Asked by ${firstName(user.name)} on ${new Date().toISOString().slice(0, 10)}.`,
      "",
    ].join("\n");

    const result = await openBallot(getPool(), {
      subjectType: GOVERNANCE_MODE,
      subjectRef: to === "token" ? `${to}@${token}` : to,
      title,
      docMarkdown: doc,
      method: conducts,
      weightMode: snapshot.mode,
      weightToken: snapshot.token,
      unityPct: dials.unityPct,
      quorumPct: dials.quorumPct,
      durationDays: Math.max(1, numberVar(conducts === "consent" ? "governance.consent_window_days" : "governance.vote_days")),
      openedBy: user.id,
      electorate: await buildElectorate(),
    });
    if (!result.ok) return res.status(409).json({ error: result.error, ballotId: result.alreadyOpen?.id ?? null });
    res.json({
      success: true,
      ballot: {
        id: result.ballot.id,
        subjectType: result.ballot.subjectType,
        subjectRef: result.ballot.subjectRef,
        title: result.ballot.title,
        unityPct: result.ballot.unityPct,
        quorumPct: result.ballot.quorumPct,
        closesAt: result.ballot.closesAt,
      },
    });
  });
}
