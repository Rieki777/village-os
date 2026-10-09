/**
 * THE VILLAGE'S AGREEMENTS: writing one, and reading them (defect 9; Wave 4).
 *
 *   POST /api/governance/agreements   a `proposal.open` holder puts an agreement
 *                                     to the village's vote
 *   GET  /api/governance/agreements   members: every agreement, its standing
 *                                     and its review date
 *
 * The proposal wizard's "Write an agreement" has posted to the first path
 * since it was ported, and nothing answered: the type sat among the practice
 * votes (`ADVISORY_TYPES`) because nothing could carry one out. This file and
 * server/lib/agreementCloser.ts are that something, and `agreement` now sits
 * in `CONDUCTABLE_TYPES` (server/lib/proposalDrafts.ts).
 *
 * ── THE VOTE IS THE VILLAGE'S OWN ──────────────────────────────────────────
 *
 * Opening follows the advisory route's door, `proposal.open` asked of the one
 * gate, because until today a member who wanted an agreement put it to the
 * village as a practice vote through exactly that door. The vote is conducted
 * the way `POST /api/governance/purpose-changes` conducts one: the village's
 * own method and dials through `thresholdsFor`, its own weights, its own
 * electorate, frozen at the open. An agreement asks nothing of its own above
 * the village's bar, so it carries no floor in `SUBJECT_THRESHOLDS`.
 *
 * ── ONE AGREEMENT, ONE VOTE ────────────────────────────────────────────────
 *
 * Each agreement is its own subject (`agreement:<id>`), so the village can
 * weigh two agreements at once. The words go beside the ballot in their own
 * document (server/lib/agreements.ts) and never back out of the markdown. If
 * that write fails the vote is called off before anybody casts one, the way
 * the purpose change does it.
 *
 * MOUNTED BEHIND requireModule("governance") for the /api/governance prefix,
 * which server/index.ts installs before this module's register() is called.
 */
import crypto from "node:crypto";
import type { Express } from "express";
import type { AppDeps } from "../lib/appDeps";
import { numberVar, stringVar } from "../lib/variables";
import { openBallot, withdrawBallot } from "../lib/ballots";
import { decisionLink, notifyRollRows } from "../lib/ballotNotices";
import { listAgreements, recordAgreement } from "../lib/agreements";
import { hasCapability } from "../../shared/capabilities";
import { AGREEMENT, agreementDoc, parseAgreement, type StoredAgreement } from "../../shared/agreements";
import { thresholdSettingsFrom, thresholdsFor } from "../../shared/ballotSubjects";
import { villageBallotMethod, type BallotMethod } from "../../shared/governanceEngine";
import { civilParts } from "../../shared/lunar";
import { CANVAS_MEMBERS_ONLY, mayReadCanvas } from "./canvas";

type Deps = Pick<
  AppDeps,
  "authedUser" | "isAdmin" | "hasMembership" | "getPool" | "capabilityCtx" | "firstName" | "weightModeNow" | "circlesRepo" | "notify"
> & {
  buildElectorate: () => Promise<Array<{ userId: string; weight: number }>>;
  addActivity: (
    kind: string,
    text: string,
    extra?: { actorUserId?: string | null; entityType?: string | null; entityRef?: string | null },
  ) => Promise<unknown>;
  villageTimezone: () => string;
};

/**
 * What a member without `proposal.open` is told, from their side of the
 * screen and with a next step (audit of Wave 4): it named a capability id and
 * stopped there. The wizard locks the card for such a member
 * (client/src/components/governance/TypeCards.tsx); this is what a draft
 * written before that, or any other caller, still meets.
 */
export const AGREEMENT_OPEN_REFUSAL =
  "Putting an agreement to the whole village takes the power to open votes, and your account does not hold it yet. A member who holds that power can carry this agreement to the village for you.";

/** The village's own date, `YYYY-MM-DD`, for the review date's floor. */
function todayIn(timeZone: string, now = new Date()): string {
  let p: ReturnType<typeof civilParts>;
  try {
    p = civilParts(now, timeZone);
  } catch {
    p = civilParts(now, "UTC");
  }
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/** An agreement as a member reads it: the words and the scope, never who proposed it. */
function served(a: StoredAgreement, circleName: (id: string | null) => string | null) {
  return {
    id: a.id,
    title: a.title,
    body: a.body,
    domain: a.domain,
    circleId: a.circleId,
    circleName: circleName(a.circleId),
    reviewAt: a.reviewAt,
    status: a.status,
    ballotId: a.ballotId,
    decidedAt: a.decidedAt,
  };
}

export function register(app: Express, deps: Deps): void {
  const { authedUser, getPool, capabilityCtx, firstName, weightModeNow, buildElectorate, addActivity, circlesRepo } = deps;
  const circleName = (id: string | null): string | null => {
    if (!id) return null;
    const c = circlesRepo.all().find((x: any) => x.id === id) as any;
    return c ? String(c.name ?? c.id) : null;
  };

  app.get("/api/governance/agreements", async (req, res) => {
    const user = await authedUser(req);
    if (!user) return res.status(401).json({ error: "auth_required" });
    if (!(await mayReadCanvas(deps, req, user))) return res.status(403).json({ error: CANVAS_MEMBERS_ONLY });
    res.json({ agreements: (await listAgreements(getPool())).map((a) => served(a, circleName)) });
  });

  app.post("/api/governance/agreements", async (req, res) => {
    const user = await authedUser(req);
    if (!user) return res.status(401).json({ error: "auth_required" });
    const ctx = await capabilityCtx(user);
    if (!hasCapability("proposal.open", ctx)) return res.status(403).json({ error: AGREEMENT_OPEN_REFUSAL });

    const parsed = parseAgreement(req.body, {
      today: todayIn(deps.villageTimezone()),
      circleIds: circlesRepo.all().map((c: any) => String(c.id)),
    });
    if (!parsed.ok) return res.status(400).json({ error: parsed.error });
    const a = parsed.agreement;
    const pool = getPool();

    const villageMethod = villageBallotMethod(stringVar("governance.default_method"));
    const dials = thresholdsFor(
      { subjects: [AGREEMENT] },
      villageMethod === "hypha" ? "custom" : (villageMethod as BallotMethod),
      {
        unityPct: Math.max(0, numberVar("governance.unity_pct")),
        quorumPct: Math.max(0, numberVar("governance.quorum_pct")),
      },
      thresholdSettingsFrom((key) => numberVar(key), (key) => stringVar(key)),
    );
    const conducts: BallotMethod = dials.method ?? (villageMethod === "hypha" ? "custom" : villageMethod);
    const snapshot = weightModeNow();
    const id = `agr-${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
    const on = todayIn(deps.villageTimezone());

    const result = await openBallot(pool, {
      subjectType: AGREEMENT,
      subjectRef: id,
      title: `Agreement: ${a.title}`.slice(0, 200),
      docMarkdown: agreementDoc(a, { askedBy: firstName(String(user.name ?? "")), on, circleName: circleName(a.circleId) }),
      method: conducts,
      weightMode: snapshot.mode,
      weightToken: snapshot.token,
      unityPct: dials.unityPct,
      quorumPct: dials.quorumPct,
      durationDays: Math.max(
        1,
        numberVar(conducts === "consent" ? "governance.consent_window_days" : "governance.vote_days"),
      ),
      openedBy: String(user.id),
      electorate: await buildElectorate(),
    });
    if (!result.ok) return res.status(409).json({ error: result.error, ballotId: result.alreadyOpen?.id ?? null });

    const stored: StoredAgreement = {
      ...a,
      id,
      status: "voting",
      ballotId: result.ballot.id,
      proposedBy: String(user.id),
      proposedAt: new Date().toISOString(),
      decidedAt: null,
    };
    try {
      await recordAgreement(pool, stored);
    } catch (e) {
      console.error("[agreements] could not record the words the ballot would adopt", e);
      await withdrawBallot(pool, {
        ballotId: result.ballot.id,
        withdrawnBy: String(user.id),
        reason: "This build could not record the agreement the village would adopt, so the vote was called off before anybody cast one.",
        withdrawerMayDiscardVotes: true,
      });
      return res.status(500).json({
        error: "The agreement could not be recorded and its vote has been called off. Nothing was changed. Try again, and tell an administrator if it happens twice.",
      });
    }

    await addActivity("governance", `The village is deciding whether to adopt an agreement: ${a.title}`, {
      actorUserId: String(user.id),
      entityType: "ballot",
      entityRef: result.ballot.id,
    });
    // The roll is told, the way every village-wide vote tells it: a vote nobody
    // hears about is a quorum rule and no way to meet it. Not awaited.
    void notifyRollRows({ pool, notify: deps.notify, link: decisionLink }, result.ballot, {
      type: "ballot_opened",
      title: `The village is deciding on an agreement: ${a.title}`,
      body: `Voting is open until ${new Date(result.ballot.closesAt).toLocaleDateString()}. If it carries, it binds exactly as written.`,
      keySuffix: "open",
      except: [String(user.id)],
    });

    res.status(201).json({
      success: true,
      id,
      agreement: served(stored, circleName),
      ballot: {
        id: result.ballot.id,
        subjectType: result.ballot.subjectType,
        subjectRef: result.ballot.subjectRef,
        title: result.ballot.title,
        method: result.ballot.method,
        unityPct: result.ballot.unityPct,
        quorumPct: result.ballot.quorumPct,
        closesAt: result.ballot.closesAt,
      },
    });
  });
}
