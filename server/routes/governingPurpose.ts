/**
 * THE GOVERNING PURPOSE STATEMENT: reading it, writing it, and changing it.
 *
 *   GET  /api/governance/purpose           what this village says it is for
 *   PUT  /api/admin/purpose                the founder writes it
 *   POST /api/governance/purpose-changes   the village votes to change it
 *
 * ── TWO DOORS, AND ONLY ONE OF THEM IS EVER OPEN ───────────────────────────
 *
 * Rye, 2026-09-23, verbatim: "Founder keeps the pen until they give over all
 * steward powers to the village."
 *
 * So the founder's write is open while the handover is incomplete and refuses
 * once it is done, and the change ballot is the mirror image. Both ask
 * `founderPenRefusal`, which asks `villageHandoverState`, which reads the same
 * table and the same map the capability gate reads. One fact, one read, two
 * routes that cannot disagree about it.
 *
 * ── THE BALLOT HALF IS DORMANT, AND IT IS BUILT ANYWAY ─────────────────────
 *
 * No village on this platform has completed a handover. Amora holds zero of
 * its nineteen transferable powers: `capability_holding` is created empty and
 * nothing seeds it. So `POST /api/governance/purpose-changes` refuses on every
 * deployment alive today, and the founder path is the one that matters first.
 * It is built because a rule with one half built is a rule nobody can rely on,
 * and because the day the pen moves is not a day anybody wants to be shipping
 * the machinery that moves it.
 *
 * Everything green about the ballot path is green against a SEEDED FIXTURE.
 * That is worth saying in the file and not only in a report, because a green
 * suite against a fixture has already been read in this repository as evidence
 * about a production state that did not exist.
 *
 * MOUNTED BEHIND requireModule("governance") for the /api/governance prefix,
 * which server/index.ts installs before this module's register() is called.
 * The /api/admin route is outside that prefix, as every admin route is.
 */
import type { Express } from "express";
import type { AppDeps } from "../lib/appDeps";
import { numberVar, stringVar } from "../lib/variables";
import { openBallot, withdrawBallot } from "../lib/ballots";
import { recordGpsChangeProposal } from "../repos/gpsChangeProposals";
import { capabilityDecision, hasCapability } from "../../shared/capabilities";
import { GPS_CHANGE, purposeStatementProblem } from "../../shared/governingPurpose";
import { thresholdsFor } from "../../shared/ballotSubjects";
import { villageBallotMethod, type BallotMethod } from "../../shared/governanceEngine";
import {
  founderPenRefusal,
  governingPurpose,
  purposePenState,
  writeGoverningPurpose,
} from "../lib/governingPurpose";

type Deps = Pick<
  AppDeps,
  "authedUser" | "isAdmin" | "adminActor" | "getPool" | "capabilityCtx" | "firstName" | "weightModeNow"
> & {
  buildElectorate: () => Promise<Array<{ userId: string; weight: number }>>;
  /**
   * The public pulse. Typed structurally, the way `JoinHost` in
   * server/lib/arrival.ts types the same function, because it is declared
   * inside `startServer` and there is no exported type to point at.
   */
  addActivity: (
    kind: string,
    text: string,
    extra?: { actorUserId?: string | null; entityType?: string | null; entityRef?: string | null },
  ) => Promise<unknown>;
};

export function register(app: Express, deps: Deps): void {
  const { authedUser, isAdmin, adminActor, getPool, capabilityCtx, firstName, weightModeNow, buildElectorate, addActivity } = deps;

  /**
   * WHAT THIS VILLAGE SAYS IT IS FOR, plus who holds the pen over it.
   *
   * Signed in and nothing more, because the statement is the village's own
   * sentence about itself and every member is judged against it whenever they
   * vote on anything. The handover counts travel with it so a surface can say
   * WHY the pen is where it is instead of asserting it.
   */
  app.get("/api/governance/purpose", async (req, res) => {
    const user = await authedUser(req);
    if (!user) return res.status(401).json({ error: "auth_required" });
    const state = await purposePenState(getPool());
    res.json({
      statement: state.doc.statement,
      writtenAt: state.doc.writtenAt || null,
      founderHoldsPen: state.founderHoldsPen,
      handover: state.handover,
    });
  });

  /**
   * THE SAME ANSWER FOR THE SETUP WIZARD, WHICH HAS NO MEMBER TOKEN.
   *
   * The admin panel authenticates with the admin password and the route above
   * asks `authedUser`, so a setup screen calling it would be refused. It also
   * sits behind the `/api/governance` prefix, which `requireModule` can close,
   * and a founder writes this statement before they have decided which
   * modules the village runs.
   *
   * One shape, one reader, two doors. The payload is assembled by the same
   * `purposePenState` call, so the wizard and the members' page cannot be
   * told different things about who holds the pen.
   */
  app.get("/api/admin/purpose", async (req, res) => {
    if (!(await isAdmin(req))) return res.status(401).json({ error: "auth_required" });
    const state = await purposePenState(getPool());
    res.json({
      statement: state.doc.statement,
      writtenAt: state.doc.writtenAt || null,
      founderHoldsPen: state.founderHoldsPen,
      handover: state.handover,
    });
  });

  /**
   * THE FOUNDER WRITES IT, AND REWRITES IT, DIRECTLY.
   *
   * This is the door the setup wizard's step posts to, and it stays open for
   * as long as the founder holds the pen, which on every village running today
   * is indefinitely.
   *
   * The refusal once the handover completes is a SENTENCE AND NOT A 403 WITH
   * A CODE, because the person reading it needs to know where the pen went and
   * what to do instead. It names the ballot.
   */
  app.put("/api/admin/purpose", async (req, res) => {
    if (!(await isAdmin(req))) return res.status(401).json({ error: "auth_required" });
    const pool = getPool();
    const penGone = await founderPenRefusal(pool);
    if (penGone) return res.status(409).json({ error: penGone });

    const statement = String(req.body?.statement ?? "");
    const written = await writeGoverningPurpose(pool, {
      statement,
      writtenBy: adminActor(req)?.id ?? "",
    });
    if (!written.ok) return res.status(400).json({ error: written.error });

    await addActivity("governance", "This village wrote down what it is for.", {
      actorUserId: adminActor(req)?.id ?? null,
      entityType: "app_config",
      entityRef: "gps",
    });
    res.json({ success: true, statement: written.doc.statement, writtenAt: written.doc.writtenAt });
  });

  /**
   * THE VILLAGE VOTES TO CHANGE IT.
   *
   * Shaped on `power_return`, which is the closest analogue this codebase has:
   * a member opens it, the whole roll votes, and the closer in
   * server/index.ts writes the one thing that changes.
   *
   * THE STATEMENT IS VALIDATED HERE, at the open, and again by the closer that
   * lands it. Not because the second check is likely to fire, but because the
   * two paths are the two ends of a rule that has to be one rule: a statement
   * the founder could not save is a statement the village cannot vote in
   * either, and the only way to be sure of that is for both to call
   * `purposeStatementProblem`.
   */
  app.post("/api/governance/purpose-changes", async (req, res) => {
    const user = await authedUser(req);
    if (!user) return res.status(401).json({ error: "auth_required" });
    const pool = getPool();

    /*
     * DORMANT UNTIL THE HANDOVER COMPLETES, and the refusal counts out loud
     * how far off that is. A door that says "not yet, and here is how far" is
     * a different thing from a door that 409s.
     */
    const handover = (await purposePenState(pool)).handover;
    if (!handover.complete) {
      return res.status(409).json({
        error:
          `The founder writes this village's governing purpose statement until every power has been handed over. ` +
          `${handover.remaining.length} of ${handover.total} are still on the admin panel, so this one goes to them and not to a vote.`,
        handover,
      });
    }

    const ctx = await capabilityCtx(user);
    /*
     * A MEMBER OPENS THIS, NOT AN ADMINISTRATOR. The same gate every other
     * ceremony takes, with `isAdmin: false`, so an account whose only path to
     * `proposal.open` is the admin plane is refused and told why.
     */
    if (!capabilityDecision("proposal.open", { ...ctx, isAdmin: false }).allowed) {
      return res.status(403).json({
        error: hasCapability("proposal.open", ctx)
          ? "Changing what this village is for is the village's own act. Opening one takes somebody who holds proposal.open as a member of this village, and your only path to it today is your administrator account."
          : "Opening a vote for the whole village is for a proposal.open holder",
      });
    }

    const statement = String(req.body?.statement ?? "").trim();
    const problem = purposeStatementProblem(statement);
    if (problem) return res.status(400).json({ error: problem });

    const standing = await governingPurpose(pool);
    if (standing.statement.trim() === statement) {
      return res.status(409).json({ error: "That is what the statement already says." });
    }

    const villageMethod = villageBallotMethod(stringVar("governance.default_method"));
    const dials = thresholdsFor(
      { subjects: [GPS_CHANGE] },
      villageMethod === "hypha" ? "custom" : (villageMethod as BallotMethod),
      {
        unityPct: Math.max(0, numberVar("governance.unity_pct")),
        quorumPct: Math.max(0, numberVar("governance.quorum_pct")),
      },
    );
    const conducts: BallotMethod = dials.method ?? (villageMethod === "hypha" ? "custom" : villageMethod);
    const snapshot = weightModeNow();

    const title = "The village asks to change what it is for";
    const doc = [
      `# ${title}`,
      "",
      "## What it says today",
      "",
      standing.statement || "Nothing is written down yet.",
      "",
      "## What it would say",
      "",
      statement,
      "",
      "## What changes if this carries",
      "",
      "Every proposal opened after this lands is judged against the new sentence, and the line each proposer writes answers to it. Nothing already decided is reopened.",
      "",
      `Asked by ${firstName(user.name)} on ${new Date().toISOString().slice(0, 10)}.`,
      "",
    ].join("\n");

    const result = await openBallot(pool, {
      subjectType: GPS_CHANGE,
      /*
       * ONE SUBJECT REF, THE WAY THE BIRTHING HAS ONE. `open_key` is
       * `${subject_type}:${subject_ref}` and UNIQUE while open, so a constant
       * ref means a second change cannot open while one is running, race-free
       * on the index instead of on an application check. The statement being
       * proposed lives in the document, where the village reads it.
       */
      subjectRef: "statement",
      title,
      docMarkdown: doc,
      method: conducts,
      weightMode: snapshot.mode,
      weightToken: snapshot.token,
      unityPct: dials.unityPct,
      quorumPct: dials.quorumPct,
      durationDays: Math.max(
        1,
        numberVar(conducts === "consent" ? "governance.consent_window_days" : "governance.vote_days"),
      ),
      openedBy: user.id,
      electorate: await buildElectorate(),
      purposeAlignment: req.body?.purposeAlignment,
    });
    if (!result.ok) return res.status(409).json({ error: result.error, ballotId: result.alreadyOpen?.id ?? null });

    /*
     * WHAT THE BALLOT IS ASKING FOR GOES TO ITS OWN ROW, never back out of
     * the document. The reasoning is in server/repos/gpsChangeProposals.ts.
     *
     * A ballot with no payload is a question the village can answer and this
     * build cannot carry out, so the open is called off before anybody votes,
     * the same way a role declaration is. The closer still holds with its own
     * sentence for a row that goes missing some other way.
     */
    try {
      await recordGpsChangeProposal(pool, {
        ballotId: result.ballot.id,
        statement,
        proposedBy: user.id,
      });
    } catch (e) {
      console.error("[purpose-changes] could not record the statement the ballot would adopt", e);
      await withdrawBallot(pool, {
        ballotId: result.ballot.id,
        withdrawnBy: user.id,
        reason:
          "This build could not record the statement the village would adopt, so the question was called off before anybody voted.",
        withdrawerMayDiscardVotes: true,
      });
      return res.status(500).json({
        error: "The vote could not be recorded and has been called off. Nothing was changed. Try again, and tell an administrator if it happens twice.",
      });
    }

    await addActivity("governance", "The village is deciding whether to change what it is for.", {
      actorUserId: user.id,
      entityType: "ballot",
      entityRef: result.ballot.id,
    });
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
        purposeAlignment: result.ballot.purposeAlignment,
      },
    });
  });
}
