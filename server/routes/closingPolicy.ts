/**
 * What closing this village means, written.
 *
 *   PUT /api/admin/exit-policy/closing   { policyId, statement, adopt }
 *        -> { success, named, closing }
 *
 * The closing section of the exit policy (Rye, 2026-09-25). Its rules are in
 * server/lib/closingPolicy.ts and shared/closingPolicies.ts; this file is the
 * door and nothing else.
 *
 * READING IT NEEDS NO ROUTE OF ITS OWN. The section lives inside the
 * `exit-policy` document, so `GET /api/exit-policy` already serves it to every
 * reader, signed in or not, the way the dials ruling asks, and
 * `GET /api/admin/exits` already hands it to the editor. Both read through
 * `withPolicyDefaults`, which serves the section without the account that
 * adopted it.
 *
 * IN ITS OWN MODULE because server/index.ts has no route registration to
 * spare, and because the exits routes in that file are being moved to a
 * module of their own by another lane: this door is the one piece of the exit
 * policy that never had to live there.
 *
 * GATED AS THE EXIT POLICY IS: `isAdmin`, the gate its own PUT calls, which
 * also marks the request for the /api/admin default-deny. No transferable
 * power covers the exit policy, so this section has the same writers the rest
 * of the document has, and a change to either is the same kind of act.
 *
 * WRITES THROUGH THE CACHED HANDLE. The exit policy is a `dbDocument` loaded
 * at boot, and a write that went round it would leave the public page serving
 * the old words until the next restart.
 *
 * EVERY WRITE LEAVES A RECORD, AND AN ADOPTION IS TOLD TO THE VILLAGE (Wave 2
 * audit, 2026-09-28). One admin can replace where the treasury and assets go
 * on closing, and the only trace was a changed "Adopted on" date. Each save
 * now writes an admin audit row naming the policy before and after, and each
 * NEW adoption writes a line on the village pulse, which members read. The
 * pulse line names the policy and says an admin did it, never which one:
 * the exit policy page keeps who adopted the words out of every public read
 * (`closingForReaders`), the pulse is public too, and the audit row carries
 * the account. Both go through `recordEvent`, the one door into
 * `health_events`, and are awaited so the answer is sent after the record
 * exists (`recordEvent` never throws).
 * Re-adopting the same words keeps the old stamp in `closingWrite` and is not
 * news.
 *
 * ── AFTER THE BIRTHING, A BALLOT (sweep decision D6, Rye 2026-11-06) ─────
 *
 *   POST /api/governance/closing-policy-changes   { policyId, statement }
 *        -> { success, ballot }
 *
 * Once the Game has started the admin PUT answers 409 naming this vote, and
 * this door opens a `closing_policy` ballot at the structural tier
 * (shared/ballotSubjects.ts), built on the conflict agreement's change vote.
 * Before the Birthing it refuses, because the writers above adopt. The opener
 * holds `proposal.open` as a member, asked through the one gate. The proposed
 * words are checked by `closingStatementProblem` and written under the
 * ballot's own key inside the transaction that opens it; the closer
 * (server/lib/closingPolicyCloser.ts) adopts them stamped `ballot:<id>`.
 * Closing words are public on the exit policy page, so the ballot prints them.
 */
import type { Express } from "express";
import type { AppDeps } from "../lib/appDeps";
import { CLOSING_FOUNDERS_NOW, closingProposalKeyFor, closingWrite } from "../lib/closingPolicy";
import { withExitPolicyLock } from "../lib/exitPolicyWrites";
import { recordEvent } from "../lib/events";
import { readGameStart } from "../lib/gameStart";
import { openBallot } from "../lib/ballots";
import { decisionLink, notifyRollRows } from "../lib/ballotNotices";
import { numberVar, stringVar } from "../lib/variables";
import { writeConfigDocument } from "../repos/appConfigDocs";
import { thresholdSettingsFrom, thresholdsFor } from "../../shared/ballotSubjects";
import { capabilityDecision, hasCapability } from "../../shared/capabilities";
import { villageBallotMethod, type BallotMethod } from "../../shared/governanceEngine";
import { deadlineInVillage } from "../lib/villageReaders";
import {
  CLOSING_POLICY,
  closingForReaders,
  closingNamed,
  closingPolicyDef,
  closingStatementProblem,
} from "../../shared/closingPolicies";

/** The one subject ref, so a second change cannot open while one is running (`open_key` is unique while open). */
export const CLOSING_BALLOT_REF = "closing";

/** The exit policy's own document handle, `exitPolicyRepo` in server/index.ts. */
export interface ExitPolicyHandle {
  get(): any;
  put(doc: any): Promise<unknown>;
}

/** What the change vote needs beyond the admin door. Absent, the vote's door is not mounted (unit suites). */
export interface ClosingBallotDeps {
  authedUser: AppDeps["authedUser"];
  capabilityCtx: AppDeps["capabilityCtx"];
  notify: AppDeps["notify"];
  weightModeNow: AppDeps["weightModeNow"];
  buildElectorate(): Promise<Array<{ userId: string; weight: number }>>;
  addActivity(
    kind: string,
    text: string,
    extra?: { actorUserId?: string | null; entityType?: string | null; entityRef?: string | null },
  ): Promise<unknown>;
}

type Deps = Pick<AppDeps, "isAdmin" | "adminActor" | "getPool"> & { exitPolicy: ExitPolicyHandle; ballot?: ClosingBallotDeps };

/** What `adoptClosing` reads and writes. */
export type ClosingAdoptDeps = Pick<AppDeps, "getPool"> & { exitPolicy: ExitPolicyHandle };

/**
 * THE ONE ADOPTION of closing words by the exit policy's writers: the lock,
 * the write, the audit row and the pulse line. The admin PUT calls it, and so
 * does the canvas `exit:closing` door when an admin adopts a member's
 * suggestion (sweep decision D3), so both answer the same rules, the Birthing
 * refusal among them. The caller has already decided the actor may adopt.
 */
export async function adoptClosing(
  deps: ClosingAdoptDeps,
  body: unknown,
  actorId: string | null,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const gameStarted = (await readGameStart(deps.getPool())).started;
  // Read and written inside the exit policy's one lock, so a terms save that
  // overlaps this one is never erased by it, nor it by the terms save
  // (W2-exit-policy-lost-update, server/lib/exitPolicyWrites.ts).
  const written = await withExitPolicyLock(async () => {
    const stored = deps.exitPolicy.get() ?? {};
    const answer = closingWrite(body, stored.closing, actorId, new Date(), { gameStarted });
    if (!answer.ok) return { answer, stored };
    // Every other key of the document exactly as stored: this door owns one
    // section and must not rewrite the terms beside it.
    await deps.exitPolicy.put({ ...stored, closing: answer.section });
    return { answer, stored };
  });
  const { answer, stored } = written;
  if (!answer.ok) return { status: answer.status, body: { error: answer.error, message: answer.message } };
  const section = answer.section;
  const before = String(stored.closing?.policyId ?? "") || "none";
  const adoptedNow = !!section.adoptedAt && section.adoptedAt !== (stored.closing?.adoptedAt ?? null);
  await recordEvent(deps.getPool(), {
    kind: "audit",
    text: `closing-policy:${section.adoptedAt ? "adopted" : "draft"}:${before}->${section.policyId}`,
    actorUserId: actorId,
    entityType: "exit_policy", entityRef: "closing", audience: "admin",
  });
  if (adoptedNow) {
    await recordEvent(deps.getPool(), {
      kind: "governance",
      text: `An admin adopted what closing this village means: ${closingPolicyDef(section.policyId)?.name ?? section.policyId}. The words are on the exit policy page.`,
      actorUserId: actorId,
      entityType: "exit_policy", entityRef: "closing", audience: "public",
    });
  }
  return { status: 200, body: { success: true, named: closingNamed(section), closing: closingForReaders(section) } };
}

/** The ballot's document: the words proposed and the words standing. Both are public on the exit policy page. */
export function closingBallotDocument(asked: { policyId: string; statement: string }, standing: unknown): string {
  const s = closingNamed(standing) ? (standing as { policyId: string; statement: string }) : null;
  const name = (id: string) => closingPolicyDef(id)?.name ?? id;
  return [
    "# A change to what closing this village means",
    "",
    "If it carries, the exit policy's closing section reads as below, adopted by this vote.",
    "",
    `## Proposed: ${name(asked.policyId)}`,
    "",
    asked.statement,
    "",
    s ? `## Standing today: ${name(s.policyId)}` : "## Standing today",
    "",
    s ? s.statement : "Nothing is adopted yet.",
  ].join("\n");
}

export function register(app: Express, deps: Deps): void {
  app.put("/api/admin/exit-policy/closing", async (req, res) => {
    if (!(await deps.isAdmin(req))) return res.status(401).json({ error: "auth_required" });
    const actor = deps.adminActor(req);
    const r = await adoptClosing(deps, req.body, actor?.id ?? null);
    res.status(r.status).json(r.body);
  });

  const ballot = deps.ballot;
  if (!ballot) return;

  /**
   * THE VILLAGE VOTES TO CHANGE ITS CLOSING WORDS, AFTER THE BIRTHING.
   * `{ policyId, statement }`. Copied from the conflict agreement's change vote
   * (server/routes/conflictAgreement.ts), the template for a consequence-pen
   * ballot.
   */
  app.post("/api/governance/closing-policy-changes", async (req, res) => {
    const user = await ballot.authedUser(req);
    if (!user) return res.status(401).json({ error: "auth_required" });
    const pool = deps.getPool();
    if (!(await readGameStart(pool)).started) return res.status(409).json({ error: CLOSING_FOUNDERS_NOW });

    const ctx = await ballot.capabilityCtx(user);
    if (!capabilityDecision("proposal.open", { ...ctx, isAdmin: false }).allowed) {
      return res.status(403).json({
        error: hasCapability("proposal.open", ctx)
          ? "Changing what closing means is the village's own act. Opening the vote takes somebody who holds proposal.open as a member of this village, and your only path to it today is your administrator account."
          : "Opening a vote for the whole village is for a proposal.open holder",
      });
    }

    const b = req.body && typeof req.body === "object" ? (req.body as Record<string, unknown>) : {};
    const policyId = typeof b.policyId === "string" ? b.policyId.trim() : "";
    const statement = typeof b.statement === "string" ? b.statement.trim() : "";
    const problem = closingStatementProblem(policyId, statement);
    if (problem) return res.status(400).json({ error: "closing_policy_invalid", message: problem });
    const standing = deps.exitPolicy.get()?.closing;
    if (closingNamed(standing) && standing.policyId === policyId && String(standing.statement).trim() === statement) {
      return res.status(409).json({ error: "That is what the closing section already says." });
    }

    const villageMethod = villageBallotMethod(stringVar("governance.default_method"));
    // The village's own settings ride along, so a structural bar the village
    // raised is the bar this vote freezes, as the Decision Matrix prints it.
    const dials = thresholdsFor(
      { subjects: [CLOSING_POLICY] },
      villageMethod === "hypha" ? "custom" : (villageMethod as BallotMethod),
      {
        unityPct: Math.max(0, numberVar("governance.unity_pct")),
        quorumPct: Math.max(0, numberVar("governance.quorum_pct")),
      },
      thresholdSettingsFrom((key) => numberVar(key), (key) => stringVar(key)),
    );
    const conducts: BallotMethod = dials.method ?? (villageMethod === "hypha" ? "custom" : villageMethod);
    const snapshot = ballot.weightModeNow();
    const electorate = await ballot.buildElectorate();
    const now = new Date();
    const purposeAlignment = typeof b.purposeAlignment === "string" ? b.purposeAlignment : null;

    const result = await openBallot(pool, {
      subjectType: CLOSING_POLICY,
      subjectRef: CLOSING_BALLOT_REF,
      title: "The village asks to change what closing it means",
      docMarkdown: closingBallotDocument({ policyId, statement }, standing),
      method: conducts,
      weightMode: snapshot.mode,
      weightToken: snapshot.token,
      unityPct: dials.unityPct,
      quorumPct: dials.quorumPct,
      durationDays: Math.max(1, numberVar(conducts === "consent" ? "governance.consent_window_days" : "governance.vote_days")),
      openedBy: user.id,
      electorate,
      purposeAlignment,
      // One key per ballot, never shared: a carried change waiting for its
      // landing date keeps its own words however many open after it.
      onOpen: (conn, ballotId) =>
        writeConfigDocument(conn, closingProposalKeyFor(ballotId), {
          ballotId,
          policyId,
          statement,
          proposedBy: String(user.id),
          proposedAt: now.toISOString(),
        }),
    });
    if (!result.ok) return res.status(409).json({ error: result.error, ballotId: result.alreadyOpen?.id ?? null });

    await ballot.addActivity("governance", "The village is deciding whether to change what closing it means.", {
      actorUserId: user.id,
      entityType: "ballot",
      entityRef: result.ballot.id,
    });
    void notifyRollRows({ pool, notify: ballot.notify, link: decisionLink }, result.ballot, {
      type: "ballot_opened",
      title: "The village is asked whether to change what closing it means",
      body: `Voting is open until ${deadlineInVillage(result.ballot.closesAt)}.`,
      keySuffix: "open",
      except: [user.id],
      roll: electorate.map((e) => e.userId),
    });
    res.json({
      success: true,
      ballot: {
        id: result.ballot.id,
        subjectType: result.ballot.subjectType,
        title: result.ballot.title,
        unityPct: result.ballot.unityPct,
        quorumPct: result.ballot.quorumPct,
        method: result.ballot.method,
        closesAt: result.ballot.closesAt,
      },
    });
  });
}
