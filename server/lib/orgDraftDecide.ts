/**
 * WHO ADOPTS A REORGANISATION, AND WHAT ADOPTING IT DOES.
 *
 * ── THE RULINGS ────────────────────────────────────────────────────────────
 *
 * Rye, 2026-09-14: "a person holding the power (in this case by default
 * Stewards, but an Operations or COO type role could be formed to hold this
 * power) can publish live OR send it to be a ballot (the role holder gets to
 * choose, if this role doesn't exist or this power isn't given, then it's a
 * ballot by default)." And: "No when a holder publishes live it goes live!"
 *
 * Rye, 2026-09-24: anything may PROPOSE, and adopting "follows who holds the
 * power". Structure is proposed freely through the drafts in ./orgDrafts; this
 * file is the adoption half.
 *
 * Rye, 2026-09-23, read for the same predicate: a role holding the approving
 * power means only its holder puts the thing to the village, and the village
 * holding it means any member may, because then the vote is the decision.
 * That rule is `whoMayPutHandToVillage` in shared/powerHands.ts and it is read
 * here as it stands, so a raised hand and a reorganisation answer one question
 * one way.
 *
 * ── THE KEY, AND WHO HOLDS IT BY DEFAULT ───────────────────────────────────
 *
 * `org.decide`, TRANSFERABLE. That is what makes "by default Stewards" true
 * without a migration: HANDOVER_SET is derived from TRANSFERABLE, and the
 * launch seats the founding stewards with every power in it and hands those to
 * the village (server/lib/stewardship.ts). Moving it to an Operations circle
 * later is the ordinary power vote. A village that has not launched by vote
 * has no holder at all, so a member's door is the ballot and the admin panel's
 * door is the one it always had.
 *
 * ── THREE DOORS ONTO ONE PUBLISH ───────────────────────────────────────────
 *
 *   the admin panel        POST /api/admin/org/drafts/:id/publish  (server/routes/org.ts)
 *   a holder of the power  POST /api/org/drafts/:id/publish-by-power
 *   a vote that carried    the `org_draft` closer below
 *
 * All three call `publishOrgDraft`, which is `publishDraft` plus the steps
 * that run after its commit. They were written once, inside the admin route,
 * and a second door that skipped them would leave the map drawing the old
 * shape and twelve people not told they were seated. `visionNeverApplies.test.ts`
 * holds the doors to exactly these three.
 *
 * ── WHAT THE VILLAGE READS ON THE BALLOT ───────────────────────────────────
 *
 * Circles and seats, by name, and nothing else. Structure is public on the map
 * already. A draft's title and rationale are free text somebody typed, and a
 * `seat_holder` change names a person, so neither reaches the ballot: the
 * title is composed from the count, and a seating reads "Seat somebody in" the
 * seat. `docMarkdown` is shown as written inside a <pre>, so the document is
 * plain lines with bare uppercase labels.
 *
 * ── WHAT THIS RECORDS ──────────────────────────────────────────────────────
 *
 * Nothing beyond what publishing already records: the journal line per seat
 * the draft touched. Opening a vote writes the ballot, and the ballot is the
 * record.
 */
import type { Pool } from "mysql2/promise";
import { dialsForSubject, ORG_DRAFT, thresholdSettingsFrom } from "../../shared/ballotSubjects";
import { isVillageHeld, type Capability, type CapabilityCtx } from "../../shared/capabilities";
import type { BallotMethod } from "../../shared/governanceEngine";
import { whoMayPutHandToVillage, type HandOpenerRule } from "../../shared/powerHands";
import type { CloseRouting, SubjectCloser } from "./applyDue";
import { decisionLink } from "./ballotNotices";
import { ballotsFor, openBallot, openBallotFor, withdrawBallot, type BallotRow } from "./ballots";
import { applyCircleStatusChanges } from "./circleTreasury";
import { recordEvent } from "./events";
import { launchedByBallotIdOf } from "./launch";
import type { WeightModeSnapshot } from "./governanceWeights";
import {
  blockedLinesOf,
  draftChangeCap,
  getDraft,
  loadPreviewContext,
  previewLoadedDraft,
  publishDraft,
  type BlockedLine,
  type Draft,
  type PreviewContext,
} from "./orgDrafts";
import { listBudgets } from "./resources";
import { numberVar, stringVar } from "./variables";

export const ORG_DECIDE: Capability = "org.decide";
export { ORG_DRAFT };

// ── Who holds it, read once ─────────────────────────────────────────────────

/** How the power stands for a draft, and for the member asking. */
export interface DecideStanding {
  /** Rye's 2026-09-23 predicate: who may put a draft to the village. */
  rule: HandOpenerRule;
  /** Who holds `org.decide` live, the way the gate counts them. */
  holders: readonly string[];
  villageHolds: boolean;
}

export function decideStanding(ctx: Pick<CapabilityCtx, "villageHeld">, liveHolders: readonly string[]): DecideStanding {
  const villageHolds = isVillageHeld(ORG_DECIDE, ctx.villageHeld);
  const rule = whoMayPutHandToVillage(villageHolds, liveHolders);
  return { rule, holders: liveHolders.filter((h) => h !== ""), villageHolds };
}

export interface DecideRefusal {
  status: 403 | 404 | 409;
  error: string;
  message: string;
}

/** Why this member may not put a draft to the village, or null when they may. */
export function putToVillageRefusal(standing: DecideStanding, userId: string): DecideRefusal | null {
  if (standing.rule.who === "any-member") return null;
  if (userId && standing.rule.holders.includes(userId)) return null;
  return {
    status: 403,
    error: "not_a_holder",
    message:
      "A role holds the power to adopt a change to the structure, so putting one to the village is for whoever holds it. " +
      "Ask one of them, or ask the village to take the power on, and then anybody can.",
  };
}

/** The refusal a direct publish gives somebody who does not hold the power. */
export function notAHolderBody(standing: Pick<DecideStanding, "holders">): Record<string, unknown> {
  const nobody = standing.holders.length === 0;
  return {
    error: "not_a_holder",
    message: nobody
      ? "Nobody holds the power to publish a change to the structure, so a change goes to the village. Put it to the village instead."
      : "Publishing a change to the structure straight onto the chart is for whoever holds the power. Ask one of them, or put it to the village.",
    ballotNeeded: nobody,
  };
}

/**
 * MAY THIS PERSON PUBLISH STRAIGHT ONTO THE CHART. Answers the request when
 * the answer is no, the way `guardCapability` does, and the caller returns.
 *
 * The gate is asked first, so a village-held key refuses an admin with the 409
 * that names the holder and offers the break-glass, and anybody else meets the
 * refusal written here. Passing the gate is not enough on its own, because an
 * admin passes every key the village has not taken on: the ruling's word is
 * HOLDER, so the person has to be one of the live holders. The one exception
 * is the break-glass itself, which is the only way through a village-held key
 * for somebody not seated there, and which `mayAct` records in public.
 */
export interface HolderGate {
  authedUser(req: any): Promise<any | null>;
  guardCapability(req: any, res: any, cap: Capability, refusal?: { status: number; body: Record<string, unknown> }): Promise<boolean>;
  capabilityCtx(user: any): Promise<CapabilityCtx>;
  liveHoldersOf(capability: string): Promise<string[]>;
}

export async function holderMayPublish(req: any, res: any, gate: HolderGate): Promise<boolean> {
  const user = await gate.authedUser(req);
  if (!user) {
    res.status(401).json({ error: "auth_required" });
    return false;
  }
  const standing = decideStanding(await gate.capabilityCtx(user), await gate.liveHoldersOf(ORG_DECIDE));
  if (!(await gate.guardCapability(req, res, ORG_DECIDE, { status: 403, body: notAHolderBody(standing) }))) return false;
  if (standing.holders.includes(String(user.id)) || standing.villageHolds) return true;
  res.status(403).json(notAHolderBody(standing));
  return false;
}

/**
 * HAS THIS VILLAGE LAUNCHED, for the admin panel's direct publish.
 *
 * The launch BALLOT carrying, read off `launch-state.launchedByBallotId`, which
 * only the launch vote's closer writes (`recordLaunchCarried`), and never the
 * `game-start` row or `founderPowerStands()`. The game-start row is not enough:
 * the test harness provisions every village with one (`bal-fixture`), and that
 * read turned the admin door off in every e2e village with no vote held. That is Rye's
 * ruling of 2026-10-14 for the module switch, and the reason carries over
 * whole: migration 0112 recorded villages that were issuing before the vote
 * existed as started with no ballot, and a village in that state has had no
 * launch vote and no founding stewards, so nobody holds this power and its
 * admins keep the panel's door until a real launch vote.
 */
export async function launchedByVote(pool: Pool): Promise<boolean> {
  return (await launchedByBallotIdOf(pool)) !== null;
}

/** The door a person publishes an open draft through: the holder's, or the admin panel's. */
export type PublishDoor = "power" | "admin";

/**
 * WHICH DOOR THIS PERSON MAY PUBLISH A DRAFT THROUGH, or null for neither.
 * The question both publish routes ask, read without answering a request, for
 * the reads that offer the button (the structure review page, and the drafts
 * on the task board's "Waiting on you").
 *
 *   power  a live holder of `org.decide`, which is `publish-by-power`'s door;
 *   admin  an admin, until a launch vote has carried, which is the admin
 *          panel's door as it stands before launch (`launchedByVote`).
 *
 * The break-glass where the village holds the power is left out on purpose.
 * It is a door through the gate for an emergency, written into the public
 * record, and nobody should find it offered as a chore. Whether the draft is
 * frozen under a vote is the caller's to ask, per draft.
 */
export async function publishDoorFor(
  pool: Pool,
  viewer: { userId: string | null; isAdmin: boolean },
  liveDeciders: readonly string[],
): Promise<PublishDoor | null> {
  if (viewer.userId && liveDeciders.includes(viewer.userId)) return "power";
  if (viewer.isAdmin && !(await launchedByVote(pool))) return "admin";
  return null;
}

// ── The ballot a draft is put to ────────────────────────────────────────────

/** The open vote on this draft, if one is running. */
export function openDraftBallot(pool: Pool, draftId: string): Promise<BallotRow | null> {
  return openBallotFor(pool, ORG_DRAFT, draftId);
}

/** The newest vote ever held on this draft, open or not. */
export async function latestDraftBallot(pool: Pool, draftId: string): Promise<BallotRow | null> {
  return (await ballotsFor(pool, ORG_DRAFT, draftId))[0] ?? null;
}

export const BALLOT_OPEN_REFUSAL =
  "The village is voting on this draft, so it cannot be changed or published until the vote closes. Withdraw the draft to stop the vote.";

/** A JSON primitive as text, or null. A payload carries whatever was sent. */
function text(v: unknown): string | null {
  const s = typeof v === "string" || typeof v === "number" ? String(v).trim() : "";
  return s ? s.slice(0, 120) : null;
}

const bare = (id: string): string => (id.startsWith("circle:") ? id.slice("circle:".length) : id);

/**
 * One line per change, naming circles and seats and never a person.
 *
 * Built from the change and the chart, never from the preview's own sentence,
 * because the preview names whoever a `seat_holder` change would seat.
 */
export function publicDraftLines(draft: Pick<Draft, "changes">, context: Pick<PreviewContext, "roles" | "circles">): string[] {
  const seats = new Map(context.roles.map((r: any) => [String(r.id), text(r.name)]));
  const circles = new Map(context.circles.map((c) => [c.id, text(c.name)]));
  for (const c of draft.changes) {
    if (c.op === "create_circle") circles.set(bare(c.orgRoleId), text(c.payload?.name));
    if (c.op === "create_seat") seats.set(c.orgRoleId, text(c.payload?.name));
  }
  const seat = (id: string) => `"${seats.get(id) ?? "a role"}"`;
  const circle = (id: string | null) => `"${(id && circles.get(id)) ?? "a circle"}"`;
  return draft.changes.map((c) => {
    const circleId = text(Array.isArray(c.payload?.circleId) ? c.payload.circleId[0] : c.payload?.circleId);
    switch (c.op) {
      case "create_circle": {
        const parent = text(c.payload?.parentCircleId);
        return `Create the circle ${circle(bare(c.orgRoleId))}${parent ? ` inside ${circle(parent)}` : ""}`;
      }
      case "create_seat":
        return `Create the role ${seat(c.orgRoleId)}${circleId ? ` in ${circle(circleId)}` : ""}`;
      case "update_seat": {
        const renamed = text(c.payload?.name);
        const was = seats.get(c.orgRoleId);
        return (
          `Change the role ${seat(c.orgRoleId)}` +
          (renamed && renamed !== was ? `, renaming it "${renamed}"` : "") +
          (circleId ? `, in ${circle(circleId)}` : "")
        );
      }
      case "rest_seat":
        return `Retire the role ${seat(c.orgRoleId)}`;
      case "seat_holder":
        return `Seat somebody in ${seat(c.orgRoleId)}`;
      case "end_holding":
        return `End a holding on ${seat(c.orgRoleId)}`;
      case "move_circle": {
        const parent = text(c.payload?.parentCircleId);
        return parent
          ? `Move the circle ${circle(bare(c.orgRoleId))} inside ${circle(parent)}`
          : `Move the circle ${circle(bare(c.orgRoleId))} to the top of the village`;
      }
      case "rest_circle":
        return `Retire the circle ${circle(bare(c.orgRoleId))}, so it rests as dormant`;
      default:
        return "A change to the structure";
    }
  });
}

/** The ballot's title and document. No person, no holder, no free text. */
export function orgDraftBallotText(
  draft: Pick<Draft, "changes">,
  context: Pick<PreviewContext, "roles" | "circles">,
  why: "nobody-holds-it" | "village-holds-it" | "a-role-holds-it",
  on: Date,
): { title: string; doc: string } {
  const lines = publicDraftLines(draft, context);
  const n = lines.length;
  const title = `A change to the village's structure: ${n} change${n === 1 ? "" : "s"} to its circles and roles`;
  const because =
    why === "a-role-holds-it"
      ? "A holder of the power to adopt a change to the structure chose to put this one to the village."
      : why === "village-holds-it"
        ? "The village holds the power to adopt a change to the structure, so the village decides it."
        : "Nobody holds the power to adopt a change to the structure, so the village decides it.";
  const doc = [
    "WHAT THE VILLAGE IS ASKED",
    "",
    "Whether to publish this change to the village's circles and roles. If it carries, it is on the chart the moment the vote closes.",
    "",
    "THE CHANGES",
    "",
    ...lines.map((l, i) => `  ${i + 1}. ${l}`),
    "",
    "WHY A VOTE",
    "",
    because,
    "",
    "TAKING IT BACK",
    "",
    "A published change can be reverted, and the circles and roles go back to how they stood before it.",
    "",
    `Opened on ${on.toISOString().slice(0, 10)}.`,
    "",
  ].join("\n");
  return { title, doc };
}

/** What the vote needs that only server/index.ts has. */
export interface BallotSetup {
  method: BallotMethod;
  dials: { unityPct: number; quorumPct: number };
  snapshot: WeightModeSnapshot;
  tokenProblem: string | null;
  electorate: Array<{ userId: string; weight: number }>;
  durationDays: number;
}

export type PutToVillage =
  | { ok: true; ballot: BallotRow; electorate: string[] }
  | { ok: false; status: number; body: Record<string, unknown> };

/**
 * Open the vote. The caller has already decided this member may.
 *
 * Refuses a draft that cannot publish, because a vote that carries onto a
 * blocked line would carry nothing, and the village is owed a question that
 * can be answered by voting yes.
 */
export async function putDraftToVillage(
  pool: Pool,
  input: { draftId: string; openedBy: string; why: DecideStanding["rule"]["because"]; setup: BallotSetup },
): Promise<PutToVillage> {
  const no = (status: number, body: Record<string, unknown>): PutToVillage => ({ ok: false, status, body });
  const draft = await getDraft(pool, input.draftId);
  if (!draft) return no(404, { error: "no_such_draft", message: "There is no draft by that id." });
  if (draft.status !== "open") {
    return no(409, { error: "draft_not_open", message: `This draft is ${draft.status}, so there is nothing to put to the village.` });
  }
  const running = await openDraftBallot(pool, draft.id);
  if (running) return no(409, { error: "ballot_open", message: "The village is already voting on this draft.", ballotId: running.id });
  const context = await loadPreviewContext(pool);
  const preview = previewLoadedDraft(draft, context, draftChangeCap());
  if (!preview.lines.length) return no(409, { error: "draft_empty", message: "This draft has no changes in it." });
  if (preview.blocked > 0) {
    return no(409, {
      error: "draft_blocked",
      message: `${preview.blocked} change(s) in this draft cannot be applied, so a vote on it could carry nothing. Fix or withdraw the draft first.`,
      blockedLines: blockedLinesOf(preview.lines),
    });
  }
  const { setup } = input;
  if (setup.tokenProblem) return no(409, { error: "weight_problem", message: setup.tokenProblem });
  const dials = dialsForSubject(
    ORG_DRAFT,
    setup.method,
    setup.dials,
    thresholdSettingsFrom((key) => Number(numberVar(key)), (key) => stringVar(key)),
  );
  const { title, doc } = orgDraftBallotText(draft, context, input.why, new Date());
  const opened = await openBallot(pool, {
    subjectType: ORG_DRAFT,
    subjectRef: draft.id,
    title,
    docMarkdown: doc,
    method: setup.method,
    weightMode: setup.snapshot.mode,
    weightToken: setup.snapshot.token,
    unityPct: dials.unityPct,
    quorumPct: dials.quorumPct,
    durationDays: setup.durationDays,
    openedBy: input.openedBy,
    electorate: setup.electorate,
  });
  if (!opened.ok) return no(409, { error: "ballot_refused", message: opened.error, ballotId: opened.alreadyOpen?.id ?? null });
  return { ok: true, ballot: opened.ballot, electorate: setup.electorate.map((e) => e.userId) };
}

/**
 * Withdrawing a draft withdraws the vote on it. Called BEFORE the draft is
 * withdrawn, so a vote that cannot be called off (votes are cast and the
 * person may not discard them) leaves the draft as it was.
 */
export async function withdrawDraftBallot(
  pool: Pool,
  draftId: string,
  withdrawnBy: string,
  mayDiscardVotes: boolean,
): Promise<{ ok: true; ballotId: string | null; votesDiscarded: number } | { ok: false; error: string; ballotId: string }> {
  const running = await openDraftBallot(pool, draftId);
  if (!running) return { ok: true, ballotId: null, votesDiscarded: 0 };
  const r = await withdrawBallot(pool, {
    ballotId: running.id,
    withdrawnBy,
    reason: "The draft this vote was about was withdrawn, so there is nothing left to decide.",
    withdrawerMayDiscardVotes: mayDiscardVotes,
  });
  if (!r.ok) return { ok: false, error: r.error, ballotId: running.id };
  return { ok: true, ballotId: running.id, votesDiscarded: r.votesDiscarded };
}

// ── The publish, and what runs after its commit ─────────────────────────────

export interface PublishDeps {
  pool: Pool;
  /** Re-read the circles cache. Raw SQL inside the publish moves circles under it. */
  reloadCircles(): Promise<void>;
  notify(input: {
    userId: string;
    type: string;
    title: string;
    body?: string | null;
    link?: string | null;
    actorUserId?: string | null;
    dedupeKey: string;
  }): Promise<unknown>;
  seasonState(): { current: any; seasons: any[]; timezone: string };
}

export type Published =
  | { ok: true; applied: number; reloaded: boolean; treasury: Awaited<ReturnType<typeof applyCircleStatusChanges>> }
  | { ok: false; error: string };

/**
 * Publish, then do what a publish owes the village once it has committed.
 *
 * `publishedBy` is who the record says published it: a member for the two
 * direct doors, and the BALLOT for a vote, because the village published it.
 * `actorUserId` is who pressed something, for the notices and the journal.
 *
 * EVERYTHING AFTER THE COMMIT IS NEVER "NOT PUBLISHED". A failure there is
 * logged and carried on the answer, because the chart already changed.
 */
export async function publishOrgDraft(
  deps: PublishDeps,
  draftId: string,
  publishedBy: string | null,
  actorUserId: string | null,
): Promise<Published> {
  const season = deps.seasonState();
  const r = await publishDraft(deps.pool, draftId, publishedBy, draftChangeCap(), {
    seasons: season.seasons,
    currentSeasonId: season.current?.id ?? null,
    timezone: season.timezone,
  });
  if (!r.ok) return { ok: false, error: r.error };
  /*
   * A draft can move circles (0208), written by raw SQL inside the
   * transaction, and the circles cache never re-reads the table, so without
   * the reload the map would keep drawing the old shape until a restart.
   */
  let reloaded = false;
  for (let attempt = 1; attempt <= 2 && !reloaded; attempt++) {
    try {
      await deps.reloadCircles();
      reloaded = true;
    } catch (e) {
      console.error(`[org] reloading the circles after an org draft failed, attempt ${attempt} of 2:`, e);
    }
  }
  /*
   * A CIRCLE THE DRAFT RETIRED (0243) went dormant inside the transaction,
   * and a dormant circle holds no treasury. Same hook, same order as every
   * other writer of a circle's status.
   */
  let treasury: Awaited<ReturnType<typeof applyCircleStatusChanges>> = [];
  try {
    treasury = await applyCircleStatusChanges(deps.pool, r.circleMoves, actorUserId, listBudgets);
  } catch (e) {
    console.error("[org] a published draft could not run the dormancy hook:", draftId, e);
  }
  /*
   * TELL THE PEOPLE THE DRAFT SEATED, after the commit and never inside it.
   * Same type, words and `org-seat:` key as the direct seating route, because
   * it is the same act by another door.
   */
  for (const st of r.seated) {
    try {
      await deps.notify({
        userId: st.userId,
        type: "role_appointed",
        title: `You were seated as ${st.seatName}`,
        body: st.seatAim ? st.seatAim.slice(0, 140) : null,
        link: "/map/circles",
        actorUserId,
        dedupeKey: `org-seat:${st.assignmentId}`,
      });
    } catch (e) {
      console.error("[org] a published draft could not tell a member about their role:", draftId, st.userId, st.seatName, e);
    }
  }
  // One journal line per seat the draft touched, so a reorganisation shows up
  // in the history of every node it moved.
  try {
    const draft = await getDraft(deps.pool, draftId);
    for (const seatId of Array.from(new Set((draft?.changes ?? []).map((c) => c.orgRoleId)))) {
      void recordEvent(deps.pool, {
        kind: "org",
        text: `reorganised: ${draft?.title ?? "a draft"}`,
        actorUserId,
        entityType: seatId.startsWith("circle:") ? "circle" : "org_role",
        entityRef: seatId.startsWith("circle:") ? seatId.slice("circle:".length) : seatId,
        audience: "admin",
      });
    }
  } catch (e) {
    console.error("[org] a published draft could not write its journal lines:", draftId, e);
  }
  return { ok: true, applied: r.applied, reloaded, treasury };
}

// ── The closer ──────────────────────────────────────────────────────────────

/**
 * WHAT CLOSING AN `org_draft` BALLOT DOES.
 *
 * `settle` tells the opener when it did not carry, and the draft stays open
 * and unpublished, so it can go to the village again. `execute` publishes it,
 * and `org_draft` is a no-window subject (shared/governanceKinds.ts), so that
 * happens at the close.
 *
 * IDEMPOTENT. A second `execute` (a retry, a person finishing a stalled
 * landing) finds the draft already published and does nothing at all: the
 * notices are keyed and would not repeat, the journal lines would. A draft
 * withdrawn, reverted or gone is held with the reason, never thrown.
 */
export function orgDraftCloser(deps: PublishDeps): SubjectCloser {
  const told = async (b: BallotRow, title: string, body: string, key: string, actorId: string) => {
    try {
      await deps.notify({ userId: b.openedBy, type: "governance", title, body, link: decisionLink(b), actorUserId: actorId, dedupeKey: `bal:${b.id}:${key}` });
    } catch (e) {
      console.error("[org] could not tell the opener how an org draft vote ended:", b.id, e);
    }
  };
  return {
    settle: async (b, outcome, _note, actorId) => {
      const out: CloseRouting = { applied: [], held: null, proposerTold: null };
      if (outcome === "passed") return out;
      out.proposerTold = b.openedBy;
      await told(
        b,
        outcome === "no_quorum" ? `Too few of the village voted: ${b.title}` : `The village did not carry this one: ${b.title}`,
        "Nothing on the chart changed. The draft is still open, and it can go to the village again.",
        "org-draft-not-carried",
        actorId,
      );
      return out;
    },
    execute: async (b, actorId) => {
      const out: CloseRouting = { applied: [], held: null, proposerTold: null };
      const draft = await getDraft(deps.pool, b.subjectRef);
      if (!draft) {
        out.held = "The draft this vote was about no longer exists, so nothing was published.";
        return out;
      }
      if (draft.status === "published") return out;
      if (draft.status !== "open") {
        out.held = `The draft this vote was about is ${draft.status}, so nothing was published.`;
        return out;
      }
      const r = await publishOrgDraft(deps, draft.id, b.id, actorId);
      out.proposerTold = b.openedBy;
      if (!r.ok) {
        out.held = `The village carried this and the chart could not take it: ${r.error}`;
        await told(b, `A carried change to the structure could not land: ${b.title}`, out.held, "org-draft-held", actorId);
        return out;
      }
      out.applied = [`org_draft:${draft.id}`];
      await told(b, `The village carried this: ${b.title}`, "The change is on the chart now.", "org-draft-published", actorId);
      return out;
    },
  };
}

/** For the decide read: the blocked lines of an open draft, or none. */
export async function draftReadiness(pool: Pool, draft: Draft): Promise<{ blocked: number; blockedLines: BlockedLine[]; changes: number }> {
  const preview = previewLoadedDraft(draft, await loadPreviewContext(pool), draftChangeCap());
  return { blocked: preview.blocked, blockedLines: blockedLinesOf(preview.lines), changes: preview.lines.length };
}
