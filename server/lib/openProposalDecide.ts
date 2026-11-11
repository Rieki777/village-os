/**
 * OPEN ROLE PROPOSALS, THE DECISION (part B): the work, with no request in it.
 * The words and shapes are shared/openProposalDecide.ts; the doors are
 * server/routes/openProposalDecide.ts and, for the confirm step, part A's
 * server/routes/openProposals.ts.
 *
 *   confirmAndAsk          the address confirms, and in the same transaction
 *                          the circle is asked (`role_proposal_asks`, whose
 *                          `proposal_id` carries no key, so an `op-` id fits)
 *   tellTheCircle          the asked holders, and the holders of the power
 *                          that seats people, each hear it once
 *   decideRule             who may adopt or decline at the door today
 *   placeOnRoles           an adoption's place for one account: the roles, as
 *                          an application adopted for the target season, and
 *                          the Member stage
 *   arrivalFor             what a sign-up through an adopted proposal's
 *                          invitation does (server/lib/inviteDoor.ts)
 *   openProposalsWaitingOn the task board's rows
 *
 * ── NOTHING UNCONFIRMED REACHES A PERSON ────────────────────────────────────
 *
 * Every ask and every notice here goes out from the confirm step and never from
 * the submit (master coordinator, 2026-10-31). A proposal still unconfirmed is
 * on no list and its page answers 404.
 *
 * ── THE ROLES, THE WAY A MEMBER'S ADOPTED PROPOSAL GETS THEM ────────────────
 *
 * An adoption writes an ordinary seat application through the member door's
 * own writer (server/lib/seatApplicationWrite.ts): the proposed roles, the
 * proposal's words as the note and the season aim, no terms, its first day the
 * target season's first day. The adopting holder then adopts it through
 * `adoptApplication`, as their click on a member's application does, so it
 * reads `adopted` and the hourly `season-plan-turn` job seats it on that day
 * through the same locked count (server/lib/seasonTurn.ts). Nobody aligns with
 * the terms' words on the person's behalf: they have not read them.
 *
 * ── THE MEMBER STAGE (coordinator's call 2) ─────────────────────────────────
 *
 * Granted through the admin roster's one path (server/lib/stageGrant.ts), as a
 * raise only: a floor already above Member stays where it is. Adoption needs no
 * vouch; the invitation's own arrival vouch is recorded as any invitation's is.
 *
 * No `recordEvent` and no `addActivity`: the rows are the record.
 */
import { cardSummary } from "../../shared/openProposalCard";
import { isCommitment, notesAsText, overallChoice } from "../../shared/termsWords";
import { baseOf } from "./counterOffer";
import type { Pool, PoolConnection } from "mysql2/promise";
import { isVillageHeld, type Capability } from "../../shared/capabilities";
import { civilDateKey } from "../../shared/lunar";
import { agreedTerms, greetingName, OPEN_NOTICE_WORDS, openInviteId, openProposalHref, proposalOfInvite } from "../../shared/openProposalDecide";
import { whoMayPutHandToVillage, type HandOpenerRule } from "../../shared/powerHands";
import { CONSENT_WORDS, consentClosesAt } from "../../shared/roleProposalConsent";
import { ADOPTING_POWER, parseApplicationInput } from "../../shared/seatApplications";
import type { ProposalGoal } from "../../shared/proposalGoals";
import { civilDateInstant, type SeatCalendar } from "../../shared/seatTerms";
import { emailKeyOf } from "../../shared/comms/address";
import type { WaitingOpenProposal } from "../../shared/waitingOnYou";
import type { AppDeps } from "./appDeps";
import { settleText } from "./alignmentSubjects";
import { villageHeldCapabilities } from "./capabilityHolding";
import { isExampleUser } from "./examples";
import { leftTheVillage } from "./formerMember";
import type { InvitedArrival } from "./inviteDoor";
import type { NotifyInput } from "./notify";
import { isTombstone } from "./oauthAccounts";
import { listOrgRoles, type LapseContext } from "./orgChart";
import { adoptApplication, seatsWithoutRoom, settleDepsOf, tellOutcome, wholeSecond, type FullSeat } from "./seatApplicationCloser";
import { prepareApplication, writeApplicationOn } from "./seatApplicationWrite";
import { inTransaction } from "../repos/liveSessions";
import { inviteById, revokeInvite } from "../repos/memberInvites";
import * as store from "../repos/openProposals";
import { asksFor, holdersInCircles, insertAsks } from "../repos/roleProposals";
import { inApplicationTransaction, seatsForUpdate, seatsWithCircles } from "../repos/seatApplications";
import { carryUpdatesToAccount } from "./applicantUpdates";
import { announceReview, beginReview, type ReviewDeps, type ReviewStart } from "./applicationReview";
import { agentRoleNamesInCircles, stampStep } from "../repos/applicationReview";
import * as review from "../repos/applicationReview";
import { REVIEW_WORDS } from "../../shared/applicationReview";

type Db = Pool | PoolConnection;

export interface DecideDeps extends Pick<AppDeps, "members" | "stageOf" | "recordStageEvent"> {
  getPool(): Pool;
  notify(input: NotifyInput): Promise<unknown>;
  notifyAdmins(type: string, title: string, dedupeKey: string, link?: string): Promise<unknown>;
  /** Who holds a power live, counted the way the gate counts. `liveHoldersOf` in server/index.ts. */
  liveHoldersOf(capability: string): Promise<string[]>;
  calendar(): SeatCalendar;
  lapse(): LapseContext;
  now(): Date;
  /** The village's name, for the updates an arrival carries onto the new profile. Absent skips them. */
  projectName?(): string;
}

/** The address's account here, when it is a real, present person: never an example, never a tombstone. */
export async function accountFor(members: Pick<AppDeps["members"], "byEmail">, email: string | null): Promise<string | null> {
  if (!email) return null;
  const m: any = await members.byEmail(email);
  return m && !isExampleUser(m) && !isTombstone({ email: String(m.email ?? "") }) ? String(m.id) : null;
}

/**
 * WHO MAY ADOPT OR DECLINE AT THE DOOR TODAY (Rye, 2026-10-31, sheet 24a): the
 * raised-hand rule over `org.seat`, read the way the member door reads it. A
 * role holds it and somebody sits in it live: those holders. The village holds
 * it, or nobody holds it live: nobody, at the door (`adoptRefusal`).
 */
export async function decideRule(deps: Pick<DecideDeps, "getPool" | "liveHoldersOf">): Promise<HandOpenerRule> {
  const held = await villageHeldCapabilities(deps.getPool());
  return whoMayPutHandToVillage(isVillageHeld(ADOPTING_POWER as Capability, held), await deps.liveHoldersOf(ADOPTING_POWER));
}

/** The proposal's roles by id, with their names and circles, as they read now. */
async function rolesNamed(db: Db, roleIds: readonly string[]) {
  const rows = await seatsWithCircles(db, roleIds);
  return new Map(rows.map((r) => [r.id, r]));
}

/** "Gate Keeper", "Well Keeper": a role gone since reads as its id, so a notice is never blank. */
async function roleNames(db: Db, p: store.StoredOpenProposal): Promise<string[]> {
  const named = await rolesNamed(db, p.body.roles.map((r) => r.roleId));
  return p.body.roles.map((r) => named.get(r.roleId)?.name ?? r.roleId);
}

// ── Confirming asks the circle ──────────────────────────────────────────────

export interface Confirmed {
  proposal: store.StoredOpenProposal;
  asked: Array<{ userId: string; circleId: string }>;
  closesAt: Date;
  /** The proposer's own account here, if their address has one. Never asked, never told. */
  own: string | null;
  /** The review begun at confirm: the role's interviewers, in order (role journey L5). */
  review?: ReviewStart;
  /** Roles in the circles held by an AI agent: never asked, and the round says so (D31). */
  skippedAgents?: string[];
}

/**
 * THE ADDRESS CONFIRMS, AND THE CIRCLE IS ASKED, in one transaction, so a
 * proposal is never confirmed half asked. Asked: every live holder of a role in
 * the circles the proposed roles sit in, in the order the proposal names them,
 * once each, the proposer's own account excluded. Their 2 business days run
 * from now. Null when the token confirms nothing: used, run out, or unknown.
 */
export async function confirmAndAsk(
  deps: Pick<DecideDeps, "getPool" | "members" | "calendar"> & Pick<ReviewDeps, "consentAfterInterviews">,
  confirmHash: string,
  notBefore: Date,
  at: Date,
): Promise<Confirmed | null> {
  const pool = deps.getPool();
  const circleOf = new Map((await listOrgRoles(pool)).map((r) => [r.id, r.circleId]));
  const closesAt = consentClosesAt(at, deps.calendar().timezone || "UTC");
  return inTransaction(pool, async (conn) => {
    const proposal = await store.confirmOpenProposal(conn, confirmHash, notBefore, at);
    if (!proposal) return null;
    const own = await accountFor(deps.members, proposal.email);
    const circles: string[] = [];
    for (const r of proposal.body.roles) {
      const c = circleOf.get(r.roleId);
      if (c && !circles.includes(c)) circles.push(c);
    }
    const holders = await holdersInCircles(conn, circles);
    const asked: Array<{ userId: string; circleId: string }> = [];
    for (const circleId of circles) {
      for (const h of holders) {
        if (h.circleId !== circleId || h.userId === own || asked.some((a) => a.userId === h.userId)) continue;
        asked.push({ userId: h.userId, circleId });
      }
    }
    // The review begins in this same transaction, so a proposal is never confirmed with half a review.
    const review = await beginReview(conn, deps, { ref: proposal.id, roleIds: proposal.body.roles.map((r) => r.roleId), applicantUserId: own, at });
    // Where the village asked for it, the circle is asked once the interviews are scored (shared/applicationReview.ts).
    if (!review.holdConsent) {
      await insertAsks(conn, asked.map((a) => ({ proposalId: proposal.id, userId: a.userId, circleId: a.circleId, askedAt: at, closesAt })));
      await stampStep(conn, { ref: proposal.id, kind: "consent", at });
    }
    const skippedAgents = await agentRoleNamesInCircles(conn, circles);
    return { proposal, asked, closesAt, own, review, skippedAgents };
  });
}

/**
 * Each asked holder hears once, by the roles' names, in the bell and under
 * Tasks; each live holder of the power that seats people who was not asked
 * hears it waits on them. The proposer's own account hears nothing. When
 * nobody can adopt it at the door, the admins hear it once instead. Keys are
 * per proposal and person, so a retry writes nothing twice.
 */
export async function tellTheCircle(deps: Pick<DecideDeps, "getPool" | "notify" | "notifyAdmins" | "liveHoldersOf" | "calendar">, c: Confirmed): Promise<void> {
  if (c.review) await announceReview(deps, c.review, greetingName(c.proposal.name));
  const pool = deps.getPool();
  const names = await roleNames(pool, c.proposal);
  const link = openProposalHref(c.proposal.id);
  const closesOn = civilDateKey(new Date(c.closesAt.getTime() - 1), deps.calendar().timezone || "UTC");
  for (const a of c.asked) {
    if (c.review?.holdConsent) {
      // Told it arrived; the ask itself waits for the interviews.
      await deps.notify({
        userId: a.userId,
        type: "application_arrived",
        title: REVIEW_WORDS.arrived(names),
        body: REVIEW_WORDS.consentWaitsForInterviews,
        link,
        actorUserId: null,
        dedupeKey: `op:${c.proposal.id}:arrived:${a.userId}`,
      });
      continue;
    }
    await deps.notify({
      userId: a.userId,
      type: "open_role_proposal_consent_ask",
      title: CONSENT_WORDS.askTitle(names),
      body: `${CONSENT_WORDS.askBody(closesOn)}${c.skippedAgents?.length ? ` ${REVIEW_WORDS.agentsSkipped(c.skippedAgents)}` : ""}`,
      link,
      actorUserId: null,
      dedupeKey: `op:${c.proposal.id}:ask:${a.userId}`,
    });
  }
  const rule = await decideRule(deps);
  // Nobody can adopt it at the door: nobody holds the power live, the village holds it, or its only holder is the proposer.
  const deciders = (rule.who === "live-holders" ? rule.holders : []).filter((h) => h !== c.own);
  if (deciders.length === 0) {
    // The admins hear it, once, so it does not wait unseen. No vote is opened (Rye's sheet, 24d).
    await deps.notifyAdmins("governance", OPEN_NOTICE_WORDS.nobodyToDecideTitle(names), `op:${c.proposal.id}:waiting:admins`, link);
  }
  for (const userId of deciders) {
    if (c.asked.some((a) => a.userId === userId)) continue;
    await deps.notify({
      userId,
      type: "open_role_proposal_waiting",
      title: OPEN_NOTICE_WORDS.waitingTitle(names),
      body: OPEN_NOTICE_WORDS.waitingBody,
      link,
      actorUserId: null,
      dedupeKey: `op:${c.proposal.id}:waiting:${userId}`,
    });
  }
}

// ── The place an adoption makes ─────────────────────────────────────────────

export type Placed =
  | { ok: true; applicationId: string; outcome: string }
  | { ok: false; code: "pending"; applicationId: string }
  | { ok: false; code: "cannot"; error: string };

/**
 * THE PLACE, FOR ONE ACCOUNT: the proposed roles as an application for the
 * target season, adopted by the holder who adopted the proposal under the
 * authority they adopted it by, and the Member stage. The roles are checked
 * before anything is written, so a role gone since refuses here and never on
 * the season's first day. An application already waiting for one of the roles
 * is answered `pending`, with its id, and nothing is written.
 */
/**
 * What the role application says the person will deliver: their aim, then
 * their own role card (shared/openProposalCard.ts) in plain words, within the
 * application's 2000 characters.
 */
function deliverablesOf(body: store.StoredOpenProposal["body"], seats: Array<{ id: string; name?: string }>, agreed?: Agreed | null): string {
  const aim = String(body.aim ?? "").trim();
  if (!body.card) return aim;
  const name = (id: string) => seats.find((s) => s.id === id)?.name ?? id;
  const goal = (id: string) => body.card?.serves.find((s) => s.goalId === id)?.goal || id;
  // The terms line and the commitment from the FINAL answers (audit B2): a "let's talk" settled since reads as agreed.
  const card = agreed && body.card.terms
    ? {
        ...body.card,
        ...(agreed.commitmentPct != null ? { commitmentPct: agreed.commitmentPct } : {}),
        terms: { ...body.card.terms, choice: overallChoice(agreed.answers), note: notesAsText(agreed.answers), answers: agreed.answers },
      }
    : body.card;
  const text = [aim, cardSummary(card, name, goal)].filter(Boolean).join("\n\n");
  return text.length > 2000 ? `${text.slice(0, 1997)}...` : text;
}

type Agreed = ReturnType<typeof agreedTerms>;

/**
 * WHAT WAS AGREED, FOR ONE PROPOSAL (audit B2): the roles' suggested words, every
 * counter-offer revision, and the applicant's last answer to each. Read from the
 * proposal's own body and the roles' offers.
 */
export async function agreedOf(db: Db, proposal: store.StoredOpenProposal): Promise<Agreed> {
  const base = await baseOf(db, proposal.body.roles.map((r) => r.roleId));
  return agreedTerms({ base: base.words, answers: proposal.body.card?.terms?.answers ?? {}, theirs: proposal.body.card?.commitmentPct ?? null, co: proposal.body.counterOffer ?? null });
}

/**
 * The application's settings: the moon's end when it is a moon proposal, the agreed
 * words for each setting, and the agreed commitment under Clocks. These are what the
 * holder aligns with (shared/alignments.ts renders the words).
 */
export function settingsOfAgreed(agreed: Agreed, term: { endsOn: string } | null | undefined): Record<string, unknown> {
  const words = Object.fromEntries(Object.entries(agreed.words).filter(([, w]) => typeof w === "string" && w.trim()));
  return {
    v: 1,
    ...(term ? { term: { endsOn: term.endsOn } } : {}),
    ...(isCommitment(agreed.commitmentPct) ? { clocks: { commitmentPct: agreed.commitmentPct } } : {}),
    ...(Object.keys(words).length ? { words } : {}),
  };
}

/** The card's goals for the first moon as the application's list holds them. */
function goalsOfCard(body: store.StoredOpenProposal["body"]): ProposalGoal[] {
  const card = body.card;
  if (!card) return [];
  return card.roles.flatMap((r) =>
    r.firstMoon.map((q) => ({
      title: q.quest,
      doneWhen: q.doneWhen,
      moves: q.moves ?? "",
      serves: (q.serves && card.serves.find((s) => s.goalId === q.serves)?.goal) || "",
      date: q.date ?? "",
      roleId: r.roleId,
    })),
  );
}

/**
 * THE CONVERSATIONS STILL TO BE WRITTEN UP, by role (audit M10), the same rule
 * `interviewsAreIn` holds Adopt to: a proposal with no review has none. Each
 * says whether anybody holds its role right now: a conversation whose role
 * nobody holds can never be written up until somebody is seated in it.
 */
export async function conversationsLeft(db: Db, ref: string): Promise<Array<{ roleId: string; role: string; unheld: boolean }>> {
  if (!(await review.stepsOf(db, ref)).some((s) => s.kind === "confirmed")) return [];
  const left = (await review.interviewsOf(db, ref)).filter((i) => i.state !== "scored" && i.state !== "skipped");
  if (!left.length) return [];
  const names = await review.roleNamesById(db, left.map((i) => i.roleId));
  const out: Array<{ roleId: string; role: string; unheld: boolean }> = [];
  for (const i of left) out.push({ roleId: i.roleId, role: names.get(i.roleId) ?? i.roleId, unheld: (await review.liveHoldersOfRole(db, i.roleId)).length === 0 });
  return out;
}

/** When a proposal's roles would start if adopted now: a moon proposal at adoption (never before its first day), a season one on the season's first day. */
export function startOf(deps: Pick<DecideDeps, "calendar" | "now">, proposal: store.StoredOpenProposal): Date | null {
  const calendar = deps.calendar();
  const tz = calendar.timezone || "UTC";
  const now = deps.now();
  const term = proposal.body.term;
  if (term) {
    const moonStart = civilDateInstant(term.startsOn, tz);
    return moonStart && moonStart.getTime() > now.getTime() ? moonStart : wholeSecond(now);
  }
  const season = calendar.seasons.find((s) => s.id === proposal.targetSeasonId);
  return season ? civilDateInstant(season.startsOn, tz) : null;
}

/**
 * WHETHER EVERY SEAT OF A PROPOSED ROLE IS TAKEN when it would start (audit B3).
 * Counted by `seatsWithoutRoom`, plus the places promised to other adopted
 * proposals whose invitation is still out: those people have been told yes and
 * have no application yet. The proposer's own account and address never count
 * against them.
 */
export async function roomFor(deps: Pick<DecideDeps, "getPool" | "calendar" | "lapse" | "now">, proposal: store.StoredOpenProposal, own: string | null): Promise<FullSeat[]> {
  const pool = deps.getPool();
  const at = startOf(deps, proposal);
  if (!at) return [];
  const seatIds = proposal.body.roles.map((r) => r.roleId);
  const promised = new Map<string, number>();
  const mine = proposal.email ? emailKeyOf(proposal.email) : null;
  for (const other of await store.listOpenProposals(pool, ["adopted"], 5000)) {
    if (other.id === proposal.id || (mine && other.email && emailKeyOf(other.email) === mine)) continue;
    const roles = other.body.roles.map((r) => r.roleId).filter((id) => seatIds.includes(id));
    if (!roles.length) continue;
    const inv = await inviteById(pool, openInviteId(other.id));
    if (!inv || inv.usedByUserId || inv.revokedAt || inv.expired) continue;
    for (const id of roles) promised.set(id, (promised.get(id) ?? 0) + 1);
  }
  return seatsWithoutRoom(pool, { seatIds, candidateUserId: own, at, calendar: deps.calendar(), lapse: { ...deps.lapse(), now: deps.now() }, seasonId: proposal.body.term ? null : proposal.targetSeasonId, promised });
}

export async function placeOnRoles(
  deps: DecideDeps,
  p: { account: string; proposal: store.StoredOpenProposal; adopterId: string; authority: string; /** False writes the application and stops: it waits for a vote (role journey L5, the ballot fallback). */ adopt?: boolean },
): Promise<Placed> {
  const pool = deps.getPool();
  const calendar = deps.calendar();
  const tz = calendar.timezone || "UTC";
  const now = deps.now();
  const season = calendar.seasons.find((s) => s.id === p.proposal.targetSeasonId);
  const term = p.proposal.body.term;
  // A season proposal starts on the season's first day. A moon proposal starts
  // at adoption, never before the moon's first day, and ends on its last day
  // (shared/openProposalTerm.ts, Rye 9 Nov 2026).
  const moonStart = term ? civilDateInstant(term.startsOn, tz) : null;
  // "Now" in whole seconds, the precision `starts_at` keeps (see startReached in seatApplicationCloser.ts).
  const nowSecond = wholeSecond(now);
  const startsAt = term ? (moonStart && moonStart.getTime() > now.getTime() ? moonStart : nowSecond) : season ? civilDateInstant(season.startsOn, tz) : null;
  if (!season || !startsAt) return { ok: false, code: "cannot", error: "The season this proposal was for is no longer on the village's calendar, so nothing was changed." };
  if (term && civilDateKey(now, tz) > term.endsOn) {
    return { ok: false, code: "cannot", error: "The moon this proposal was for has ended, so nothing was changed. Ask them to propose again for this moon." };
  }
  const seatIds = p.proposal.body.roles.map((r) => r.roleId);
  const seats = await seatsForUpdate(pool, seatIds);
  // What was agreed is what is signed (audit B2): the offer, the latest revision, their answers and the commitment.
  const agreed = await agreedOf(pool, p.proposal);
  const goals = goalsOfCard(p.proposal.body);
  const cardTerms = p.proposal.body.card?.terms ?? null;
  const answers = {
    ...(goals.length ? { goals } : {}),
    ...(cardTerms || agreed.commitmentPct != null
      ? {
          terms: {
            choice: overallChoice(agreed.answers),
            note: notesAsText(agreed.answers),
            // The per-setting answers ride with a commitment only: the parser asks for both together.
            ...(isCommitment(agreed.commitmentPct) ? { answers: agreed.answers, commitmentPct: agreed.commitmentPct } : {}),
          },
        }
      : {}),
  };
  const parsed = parseApplicationInput({
    seatIds,
    note: p.proposal.body.why || null,
    deliverables: deliverablesOf(p.proposal.body, seats, agreed) || null,
    // The goals as a list, so the proposal's page draws them as one (joining lane PR 1), and the terms as agreed.
    ...(Object.keys(answers).length ? { answers } : {}),
    settings: settingsOfAgreed(agreed, term),
  });
  if (!parsed.ok) return { ok: false, code: "cannot", error: parsed.error };
  for (const id of seatIds) {
    const seat = seats.find((s) => s.id === id);
    if (!seat || !seat.active || seat.isExample) {
      return { ok: false, code: "cannot", error: `${seat?.name ?? "A role it names"} is no longer a role the village fills, so nothing was changed.` };
    }
  }
  const made = await prepareApplication({
    candidateUserId: p.account,
    proposedBy: p.account,
    input: parsed.input,
    startsAt,
    startsNoEarlierThan: startsAt,
    seatNames: seatIds.map((id) => seats.find((s) => s.id === id)?.name ?? id),
    calendar,
    now,
    supersedes: null,
  });
  if (!made.ok) return { ok: false, code: "cannot", error: String(made.body.error ?? "The roles could not be set up.") };
  try {
    await inApplicationTransaction(pool, (conn) => writeApplicationOn(conn, made.app, "awaiting-holder", { candidateAligns: false }));
  } catch (e: any) {
    if (e?.code === "SA_PENDING") return { ok: false, code: "pending", applicationId: String(e.applicationId) };
    throw e;
  }
  const id = made.app.row.id;
  if (p.adopt === false) return { ok: true, applicationId: id, outcome: "awaiting-holder" };
  const { outcome, app, textId } = await adoptApplication(
    pool,
    id,
    ["awaiting-holder"],
    { via: "holder", ref: p.adopterId, authority: p.authority.slice(0, 64) },
    { now, lapse: { ...deps.lapse(), now }, calendar },
  );
  if (app) await tellOutcome(deps, app, outcome, "open", p.adopterId);
  if (textId) await settleText(settleDepsOf(deps, deps.now), textId);
  // NO STAGE GRANT HERE (Rye's ruling: Voice is only for people who signed the
  // membership agreement). A stage grant at Member is an admission
  // (server/lib/admission.ts), and it opened ballots to somebody who had signed
  // nothing. The seat is placed; Member comes when their signed Love Letter is
  // accepted, which the adoption letter asks for.
  return { ok: true, applicationId: id, outcome: outcome.kind };
}

/**
 * WHAT A SIGN-UP THROUGH AN ADOPTED PROPOSAL'S INVITATION DOES, run by the
 * welcome step both sign-up doors share (`whenInvitedArrives`,
 * server/lib/inviteDoor.ts). The invitation's maker is the holder who adopted
 * it, and the authority is the one the adoption recorded. A place that cannot
 * be made never costs the person their account: the admins are told, once,
 * with the proposal's page.
 *
 * EVERY ADOPTED PROPOSAL FOR THAT ADDRESS IS PLACED (coordinator, 2026-10-31),
 * not only the one whose link was used: once the address has an account, no
 * other invitation for it can ever make one. Each other proposal whose link
 * nobody used has that link withdrawn first, and only a withdrawal that this
 * arrival made places it, so a second arrival places nothing twice. A proposal
 * adopted onto an account already here made no invitation and was placed then.
 */
/**
 * WHAT AN ADOPTED PROPOSAL'S LINK SAYS ON THE SIGN-UP PAGE (role audit, 10 Nov
 * 2026): the roles it places the person on, and the name and address they sent,
 * so the account step finishes the application instead of starting over. Only
 * an adopted proposal answers; anything else reads as an ordinary invitation.
 */
export function describeFor(deps: Pick<DecideDeps, "getPool">): (inviteId: string) => Promise<{ roles: string[]; name: string | null; email: string | null } | null> {
  return async (inviteId) => {
    const id = proposalOfInvite(inviteId);
    if (!id) return null;
    const pool = deps.getPool();
    const proposal = await store.readOpenProposal(pool, id);
    if (!proposal || proposal.status !== "adopted") return null;
    return { roles: await roleNames(pool, proposal), name: proposal.name ?? null, email: proposal.email ?? null };
  };
}

export function arrivalFor(deps: DecideDeps): InvitedArrival {
  return async ({ inviteId, inviterUserId, userId }) => {
    const id = proposalOfInvite(inviteId);
    if (!id) return;
    const pool = deps.getPool();
    const proposal = await store.readOpenProposal(pool, id);
    if (!proposal || proposal.status !== "adopted") return;
    const places: Array<{ proposal: store.StoredOpenProposal; adopterId: string }> = [{ proposal, adopterId: inviterUserId }];
    if (proposal.email) {
      for (const other of await store.adoptedForAddress(pool, emailKeyOf(proposal.email))) {
        if (other.id === proposal.id) continue;
        const link = await inviteById(pool, openInviteId(other.id));
        if (!link || link.usedByUserId) continue;
        if (!(await revokeInvite(pool, link.id, link.inviterUserId))) continue;
        places.push({ proposal: other, adopterId: link.inviterUserId });
      }
    }
    for (const place of places) {
      let failed = false;
      try {
        const out = await placeOnRoles(deps, {
          account: userId,
          proposal: place.proposal,
          adopterId: place.adopterId,
          authority: place.proposal.decision.authority ?? `${ADOPTING_POWER}@badge`,
        });
        failed = !out.ok && out.code === "cannot";
        // The updates already sent about it are there to read on the new profile.
        if (deps.projectName) await carryUpdatesToAccount({ getPool: deps.getPool, notify: deps.notify, projectName: deps.projectName }, place.proposal, userId);
      } catch (err) {
        failed = true;
        console.warn(`[open-proposals] the place for ${userId} was not made: ${String((err as Error)?.message ?? err)}`);
      }
      if (failed) {
        const pid = place.proposal.id;
        await deps.notifyAdmins("governance", OPEN_NOTICE_WORDS.arrivalFailedTitle(await roleNames(pool, place.proposal)), `op:${pid}:arrival-failed`, openProposalHref(pid));
      }
    }
  };
}

/**
 * Whether an account left the village and was not admitted again (Rye,
 * 2026-10-31: former members never invite). Adopting their proposal would
 * re-admit them; that is its own act, so adoption refuses it.
 */
export async function isFormerMemberAccount(deps: Pick<DecideDeps, "getPool" | "members">, accountId: string): Promise<boolean> {
  return leftTheVillage(deps.getPool(), (await deps.members.byId(accountId)) as any);
}

// ── Waiting on you ──────────────────────────────────────────────────────────

/**
 * THE TASK BOARD'S ROWS: every confirmed proposal the reader's circle asks
 * them about, inside the window and unanswered (`consent`), and otherwise every
 * one they may adopt or decline (`adopt`), never their own address's. Oldest
 * first. A fixed number of reads however many rows.
 */
export async function openProposalsWaitingOn(
  deps: { pool: Pool; timezone: string; now: Date },
  rule: HandOpenerRule,
  viewerId: string,
  viewerEmail: string | null = null,
): Promise<WaitingOpenProposal[]> {
  const waiting = await store.listOpenProposals(deps.pool, ["confirmed"]);
  if (!waiting.length) return [];
  const asks = await asksFor(deps.pool, waiting.map((p) => p.id));
  const mayDecide = rule.who === "live-holders" && rule.holders.includes(viewerId);
  const named = await rolesNamed(deps.pool, Array.from(new Set(waiting.flatMap((p) => p.body.roles.map((r) => r.roleId)))));
  const mine = viewerEmail ? emailKeyOf(viewerEmail) : null;
  const tz = deps.timezone || "UTC";
  const out: WaitingOpenProposal[] = [];
  for (const p of waiting) {
    const ask = (asks.get(p.id) ?? []).find((a) => a.userId === viewerId) ?? null;
    const asking = !!ask && !ask.answer && ask.closesAt.getTime() > deps.now.getTime();
    const own = !!mine && !!p.email && emailKeyOf(p.email) === mine;
    if (!asking && (!mayDecide || own)) continue;
    const roles = p.body.roles.map((r) => named.get(r.roleId));
    const circles: string[] = [];
    for (const r of roles) if (r?.circle && !circles.includes(r.circle)) circles.push(r.circle);
    out.push({
      id: p.id,
      href: openProposalHref(p.id),
      roles: p.body.roles.map((r, i) => roles[i]?.name ?? r.roleId),
      circles,
      // A first name only, never the address (shared/waitingOnYou.ts).
      proposer: greetingName(p.name) ?? "",
      ask: asking ? "consent" : "adopt",
      closesOn: asking && ask ? civilDateKey(new Date(ask.closesAt.getTime() - 1), tz) : null,
      confirmedOn: civilDateKey(p.confirmedAt ?? p.createdAt, tz),
    });
  }
  return out;
}
