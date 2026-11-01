/**
 * THE MEMBER DOOR: APPLY TO HOLD SEATS, ON TERMS (seat settings PR4).
 *
 *   POST /api/governance/role-applications                    apply for 1 to 5 seats
 *   GET  /api/governance/role-applications                    every application (terms.read); ?candidate= one member's, grouped
 *   GET  /api/governance/role-applications/:id                one, with what the reader may do (terms.read)
 *   POST /api/governance/role-applications/:id/adopt          a live org.seat holder adopts it for the village
 *   POST /api/governance/role-applications/:id/put-to-village a live org.seat holder sends it to a vote
 *   POST /api/governance/role-applications/:id/withdraw       the candidate takes it back
 *   GET  /api/governance/waiting-on-me                        what waits on the reader's decision (task board)
 *
 * ── ONE FORMAL PROPOSAL, WHOEVER HOLDS THE POWER ───────────────────────────
 *
 * Every application is one row and one decision, whatever road it takes.
 * Adoption follows `org.seat` (Rye, 2026-09-23 and 2026-09-24), read through
 * `whoMayPutHandToVillage` like the raised-hand door reads it:
 *
 *   the village holds it, or nobody holds it live   a `role_application` ballot
 *   a role holds it, with a live holder who is      the holder adopts ("Align for
 *   not the candidate                               the village"), or sends it to
 *                                                   the village
 *   a role holds it, and the candidate is the       a ballot: nobody adopts their
 *   only live holder                                own terms
 *
 * The rule is `adoptionPath` in shared/seatApplications.ts, and it is decided
 * when the application is written. At the adopt click it is asked again, so a
 * holder who has since left the seat cannot adopt.
 *
 * ── THE OPEN BOOK, AND THE PUBLIC BALLOT ───────────────────────────────────
 *
 * Every read here answers 401 to a visitor and to a signed-in guest: the gate
 * is `terms.read`, which opens at the member rung. A ballot is as public as the
 * governance module, so its title and document carry the seats and their aims
 * and nothing the member wrote, nothing naming them, and no money
 * (`applicationBallotTitle`, `applicationBallotDoc`).
 *
 * ── NO PUBLIC EVENT ────────────────────────────────────────────────────────
 *
 * No `recordEvent` and no `addActivity` anywhere in this door: both reach the
 * village's public record by default. The row is the record. A member hears
 * through a notification naming the seats and linking the page.
 *
 * ── THE CANDIDATE ALIGNS WHEN THEY PROPOSE (PR5) ───────────────────────────
 *
 *   POST /api/governance/role-applications/words               the exact words a Review step shows
 *
 * The create route writes, in ONE transaction, the application, version 1 of
 * its alignment text (server/lib/alignmentSubjects.ts), the two parties and
 * the candidate's own alignment. The wizard's Review step shows the words the
 * `words` route rendered and sends them back as `alignedWords`; words that no
 * longer match are refused, so nobody aligns with words they did not see.
 * Terms carrying money ask the identity re-confirm first (decision 3). The
 * holder's adopt click, or the landed ballot, is the village's alignment
 * (server/lib/seatApplicationCloser.ts).
 *
 * ── THE CLOSER RIDES THE REGISTER LINE ─────────────────────────────────────
 *
 * `register` writes the `role_application` closer into the table it is handed,
 * so server/index.ts adds one exempt line for this whole feature and the
 * ratchet on that file holds. MOUNTED BELOW requireModule("governance") for the
 * /api/governance prefix, which is what keeps the module's gate in front of it.
 */
import type { Express } from "express";
import type { PoolConnection } from "mysql2/promise";
import { isVillageHeld, type Capability } from "../../shared/capabilities";
import { whoMayPutHandToVillage } from "../../shared/powerHands";
import {
  ADOPTING_POWER,
  adoptionPath,
  adoptRefusal,
  applicationBallotDoc,
  applicationBallotTitle,
  applicationHref,
  applicationNoticeTitle,
  APPLICATION_BALLOT_ACTOR,
  APPLICATION_ID,
  APPLICATION_WITHDRAWN_NOTE,
  OPEN_STATUSES,
  parseApplicationInput,
  putToVillageRefusal,
  ROLE_APPLICATION,
  STATUS_WORDS,
} from "../../shared/seatApplications";
import { civilDateInstant, type SeatCalendar } from "../../shared/seatTerms";
import type { SeatSettings } from "../../shared/seatSettings";
import { civilDateKey } from "../../shared/lunar";
import type { BallotMethod } from "../../shared/governanceEngine";
import type { AppDeps } from "../lib/appDeps";
import type { LandingDeps, SubjectCloser } from "../lib/applyDue";
import { markNotApplicable } from "../lib/applyDue";
import { decisionLink, notifyRollRows } from "../lib/ballotNotices";
import { openBallot, openBallotFor, withdrawBallot } from "../lib/ballots";
import type { WeightModeSnapshot } from "../lib/governanceWeights";
import type { LapseContext } from "../lib/orgChart";
import { seatVoteLandsAt } from "../lib/seatTermLanding";
import { adoptApplication, seatApplicationCloser, settleDepsOf, tellOutcome } from "../lib/seatApplicationCloser";
import { prepareApplication, writeApplicationOn } from "../lib/seatApplicationWrite";
import { openProposalsWaitingOn } from "../lib/openProposalDecide";
import { carriesMoney, intentSentence, noticeDaysOf, RECONFIRM_FRESH_MS, userParty, ALIGN_WORDS } from "../../shared/alignments";
import {
  presentView,
  seatTermsWords,
  settleText,
  viewText,
  viewTexts,
  type TextView,
} from "../lib/alignmentSubjects";
import { confirmedWithin } from "../lib/identityConfirm";
import {
  applicationsOfCandidates,
  inApplicationTransaction,
  latestBallotsFor,
  listApplications,
  liveSeatingsOf,
  openApplicationsOf,
  pastSeatingsWithoutApplication,
  readApplication,
  seatingsEverHolding,
  seatsForUpdate,
  setStatus,
  type ApplicationBallot,
  type SeatForCapacity,
  type StoredApplication,
} from "../repos/seatApplications";
import { readTexts } from "../repos/alignments";
import { asksFor, proposalsForApplications, setDecidedWords, type StoredAsk, type StoredProposal } from "../repos/roleProposals";
import { changesRoles } from "../../shared/roleProposals";
import { CONSENT_WORDS, consentState } from "../../shared/roleProposalConsent";
import { applyProposalChanges, askRolesFor, consentAsksWaitingOn, consentView, decisionFor, type AskRoles } from "../lib/roleProposals";
import { revertDraft } from "../lib/orgDrafts";
import { groupApplications, groupingContext, PAST_SEATING_WORDS } from "../../shared/applicationGroups";
import { registerJob } from "../lib/scheduler";
import { applicationsWaitingOn, draftsWaiting, remindWaitingHolders } from "../lib/seatApplicationWaiting";
import { openDraftBallot, ORG_DECIDE, publishDoorFor } from "../lib/orgDraftDecide";
import { WAITING_COPY, WAITING_URL, type WaitingPayload } from "../../shared/waitingOnYou";
import { ACCEPTING_POWER } from "../../shared/sessionTasks";
import { effectiveLifecycle } from "../lib/modules";
import { tasksToAccept } from "../lib/sessionTasks";
import { heldTensionsFor } from "../lib/roleTensions";
import { runSeasonTurn, SEASON_TURN_EVERY_MS, SEASON_TURN_JOB, whenSeasonsSaved } from "../lib/seasonTurn";
import { civilDayWords } from "../../shared/seasonPlans";
import { isLapsed } from "../lib/orgChart";
import { freezeSeatTerm } from "../repos/ballotSeatTerms";

/** Exported for the job that turns the season (season plans): it seats an adopted application on its day. */
export { seatFromApplication } from "../lib/seatApplicationCloser";
// Read by server/index.ts through this route module's one import line, so the ballot and seat routes there add no counted lines.
export { ballotNamesItsCloser, closeNoteFor } from "../../shared/seatApplications";
export { heldTermsFor } from "../lib/heldTerms";

/** At most ten asks in ten minutes per member per door, the raised-hand door's numbers. */
const ASKS_PER_WINDOW = 10;
const ASK_WINDOW_MS = 10 * 60 * 1000;
/** At most three applications a day that open a village vote, per member (red team S6). */
const BALLOTS_PER_DAY = 3;
const DAY_MS = 24 * 60 * 60 * 1000;
/** The reminder job's name and beat: hourly, so a reminder lands within an hour of the 48th. */
export const REMIND_JOB = "seat-application-reminders";
const REMIND_EVERY_MS = 60 * 60 * 1000;

type Deps = Pick<
  AppDeps,
  "authedUser" | "capabilityCtx" | "guardCapability" | "getPool" | "notify" | "notifyAdmins" | "overLimit" | "members" | "firstName"
> & {
  /** Who holds a power live, counted the way the gate counts. `liveHoldersOf` in server/index.ts. */
  liveHoldersOf(capability: string): Promise<string[]>;
  /** The permission roles carrying a power, for the authority a holder adopts under. */
  rolesCarrying(capability: string): Array<{ id: string; name: string }>;
  loadRoleHolders(): Array<{ roleId: string; userId: string }>;
  /** The village's method, dials, weights, roll and window, as every role vote gathers them. */
  roleBallotSetup(): Promise<{
    method: BallotMethod;
    dials: { unityPct: number; quorumPct: number };
    snapshot: WeightModeSnapshot;
    tokenProblem: string | null;
    electorate: Array<{ userId: string; weight: number }>;
    durationDays: number;
  }>;
  seatCalendar(): SeatCalendar;
  lapse(): LapseContext;
  landingDeps(): LandingDeps;
  /** The close dispatcher's table. `register` writes the `role_application` closer into it. */
  closers: Record<string, SubjectCloser>;
};

const MEMBERS_ONLY = { error: "auth_required", message: "Members read role applications." };
/** A text not written yet has nothing to end (PR8). */
const NO_ACTS = { mayGiveNotice: false, notice: null, mayEndByAgreement: false, ask: null };
const PENDING_MESSAGE = "You already have an application waiting on a decision for one of these roles. Withdraw it first, or wait for it.";

/** What the member door answers: a status and the JSON body the route would send. */
export interface DoorAnswer {
  status: number;
  body: Record<string, unknown>;
}

/** How a role proposal's submit asks the door for more than a plain application (role proposals PR A). */
export interface ApplyOptions {
  /** Roles the application names that the village has not created yet: a proposal's new roles, by id and name. */
  pendingRoles?: ReadonlyArray<{ id: string; name: string }>;
  /** Wait on a holder whatever the power's rule says, and never open a vote. */
  holderOnly?: boolean;
  /**
   * Written inside the application's own transaction, after it. Throw an error
   * with `code: "DOOR_REFUSED"`, a `status` and a `body` to refuse, and the
   * whole application rolls back with it.
   */
  alsoWrite?: (conn: PoolConnection, applicationId: string) => Promise<void>;
}

export type ApplyDoor = (user: any, body: unknown, opts?: ApplyOptions) => Promise<DoorAnswer>;

let door: ApplyDoor | null = null;

/**
 * The member door, as `register` built it, for a role proposal's submit
 * (server/routes/roleProposals.ts). Null until this route module is
 * registered, which server/index.ts does before the proposal routes.
 */
export function roleApplicationDoor(): ApplyDoor | null {
  return door;
}

export function register(app: Express, deps: Deps): void {
  const { authedUser, capabilityCtx, guardCapability, getPool, notify, notifyAdmins, overLimit, members, firstName } = deps;
  const { liveHoldersOf, rolesCarrying, loadRoleHolders, roleBallotSetup, seatCalendar, lapse, landingDeps } = deps;

  const closer = seatApplicationCloser({ getPool, notify, notifyAdmins, lapse, calendar: seatCalendar });
  deps.closers[ROLE_APPLICATION] = closer;

  // The season turn (RC2, red team G2 and D4): hourly, and on every Season tab
  // save. The pool is read when it runs, never at registration.
  const turn = () => runSeasonTurn({ getPool, notify, notifyAdmins, closer, lapse, calendar: seatCalendar });
  registerJob(SEASON_TURN_JOB, SEASON_TURN_EVERY_MS, turn);
  whenSeasonsSaved(turn);

  // One gentle reminder to a holder an application still waits on after 48 hours (server/lib/seatApplicationWaiting.ts).
  registerJob(REMIND_JOB, REMIND_EVERY_MS, async () => `${await remindWaitingHolders({ pool: getPool(), notify, liveHoldersOf })} reminder(s) asked`);

  /** Who adopts seats today, and why: the raised-hand door's one rule over `org.seat`. */
  async function adoptionRule(viewer: any, known?: Awaited<ReturnType<typeof capabilityCtx>>) {
    const ctx = known ?? (await capabilityCtx(viewer));
    return whoMayPutHandToVillage(isVillageHeld(ADOPTING_POWER as Capability, ctx.villageHeld), await liveHoldersOf(ADOPTING_POWER));
  }

  /**
   * The signed-in member holding `terms.read`, or null after answering 401.
   * Asked through the one gate, `guardCapability`, so a visitor and a guest
   * are told the same thing and the governance document reads the door.
   */
  /** The drafts no vote has frozen: a draft the village is voting on cannot be published by anybody until it closes. */
  async function unfrozen<T extends { id: string }>(pool: ReturnType<typeof getPool>, drafts: T[]): Promise<T[]> {
    const open = await Promise.all(drafts.map((d) => openDraftBallot(pool, d.id)));
    return drafts.filter((_, i) => !open[i]);
  }

  async function reader(req: any, res: any): Promise<any | null> {
    if (!(await guardCapability(req, res, "terms.read", { status: 401, body: MEMBERS_ONLY }))) return null;
    const viewer = await authedUser(req);
    if (!viewer) {
      res.status(401).json(MEMBERS_ONLY);
      return null;
    }
    return viewer;
  }

  const nameOf = async (id: string | null): Promise<string | null> => {
    if (!id) return null;
    const m = await members.byId(id);
    return m ? String(m.name ?? "") : null;
  };
  const today = () => civilDateKey(new Date(), seatCalendar().timezone || "UTC");
  const settleDeps = settleDepsOf({ getPool, notify, notifyAdmins, calendar: seatCalendar });

  /** Terms carrying money ask the identity re-confirm when the last one is stale (decision 3), or null. */
  const moneyRefusal = (user: any, settings: SeatSettings) =>
    carriesMoney(settings) && !confirmedWithin(user, RECONFIRM_FRESH_MS)
      ? { error: "reconfirm_required", message: ALIGN_WORDS.reconfirmLine }
      : null;

  /**
   * The application's alignment as a member reads it. An application from
   * before PR5 has no text yet: its words render from the stored terms, and
   * the candidate's Align writes the text (POST /api/profile/alignments).
   */
  async function alignmentOf(a: StoredApplication, viewerId: string | null, seatNames: string[], known?: TextView | null, actsForVillage = false) {
    if (a.textId) {
      const v = known !== undefined ? known : await viewText(getPool(), a.textId, today(), seatCalendar().timezone || "UTC");
      // The hash is for a party (red team S5): the candidate reads it, other members do not.
      // A live holder of org.seat who is not the candidate may end the terms for the village (PR8).
      if (v) return await presentView(v, viewerId, async (id) => nameOf(id), viewerId === a.candidateUserId, { actsForVillage });
    }
    const words = seatTermsWords(seatNames, a.settings);
    const closed = a.status === "withdrawn" || a.status === "not-adopted";
    const isCandidate = viewerId === a.candidateUserId;
    return {
      textId: null,
      title: words.title,
      body: words.body,
      version: 1,
      seatNames,
      href: applicationHref(a.id),
      state: closed ? ("ended" as const) : ("pending" as const),
      why: closed ? `${STATUS_WORDS[a.status]}.` : "Waiting for every party to align.",
      sealed: false,
      money: carriesMoney(a.settings),
      parties: [
        { partyKey: userParty(a.candidateUserId), label: (await nameOf(a.candidateUserId)) || "A former member", capacity: "individually", required: true, aligned: false, at: null, method: null },
        { partyKey: "village", label: "The village", capacity: "for the village", required: true, aligned: false, at: null, method: null },
      ],
      you: isCandidate ? { partyKey: userParty(a.candidateUserId), aligned: false, alignedAt: null, mayAlign: !closed, acts: NO_ACTS } : null,
      village: null,
      contentHash: null,
      createdAt: null,
      endingLine: null,
      noticeDays: noticeDaysOf(a.settings),
      retrofit: true,
    };
  }

  /**
   * May the candidate still take this application back? While it waits on a
   * holder, while its vote is OPEN, while it is held for a full seat, and
   * while it is adopted for a later day and no seating has taken it up (red
   * team G2). Never once its vote has CARRIED (red team U1): the village
   * decided, and withdrawing then would silently undo a carried vote.
   */
  async function withdrawable(a: StoredApplication, ballot: ApplicationBallot | null): Promise<boolean> {
    if (a.status === "awaiting-holder" || a.status === "held-full") return true;
    if (a.status === "voting") return !ballot || ballot.status === "open";
    if (a.status === "adopted") return (await seatingsEverHolding(getPool(), a.id)) === 0;
    return false;
  }

  /** "Carried, lands on 12 November 2026" for a vote that carried and has not landed yet (red team U1). */
  function statusWordsOf(a: StoredApplication, ballot: ApplicationBallot | null, tz: string): string {
    if (a.status === "voting" && ballot && ballot.status === "passed") {
      return ballot.landsAt ? `Carried, lands on ${civilDayWords(civilDateKey(ballot.landsAt, tz))}` : "Carried, and waiting to land";
    }
    return STATUS_WORDS[a.status];
  }

  /** A withdrawn or decided application takes no answer from the circle, so nobody reads that they may give one (PR D). */
  const answersCloseWith = (view: ReturnType<typeof consentView>, awaiting: boolean) =>
    awaiting ? view : { ...view, you: { ...view.you, mayAnswer: false } };

  /** An application as a member reads it, with what this reader may do with it. */
  async function served(
    a: StoredApplication,
    viewerId: string | null,
    rule: Awaited<ReturnType<typeof adoptionRule>> | null,
    known?: { ballot: ApplicationBallot | null; seats: SeatForCapacity[]; view: TextView | null; proposal: StoredProposal | null; asks: StoredAsk[]; askRoles: AskRoles },
  ) {
    const pool = getPool();
    const seats = known ? known.seats : await seatsForUpdate(pool, a.seatIds);
    const tz = seatCalendar().timezone || "UTC";
    // The newest ballot in ANY state (red team U1): a carried vote keeps its link.
    const ballot = known ? known.ballot : ((await latestBallotsFor(pool, [a.id])).get(a.id) ?? null);
    const isCandidate = viewerId === a.candidateUserId;
    // The role proposal this came from, if any (role proposals PR A): its new roles have no row yet, so they are named from it.
    const proposal = known ? known.proposal : ((await proposalsForApplications(pool, [a.id])).get(a.id) ?? null);
    const proposed = new Map((proposal?.body.newRoles ?? []).map((r) => [r.id, typeof r.words.name === "string" ? r.words.name : r.id]));
    // A proposal that changes roles is decided by its circle or the power, never by a village vote (PR B).
    const changes = !!proposal && changesRoles(proposal.body);
    const asks = proposal ? (known ? known.asks : ((await asksFor(pool, [proposal.id])).get(proposal.id) ?? [])) : [];
    // The roles the asked hold, by title, for the tally (role proposals PR D). The list reads them once for every row.
    const askRoles = known ? known.askRoles : await askRolesFor(pool, asks);
    const awaiting = a.status === "awaiting-holder";
    const seatNames = a.seatIds.map((id) => seats.find((x) => x.id === id)?.name ?? proposed.get(id) ?? id);
    return {
      id: a.id,
      href: applicationHref(a.id),
      status: a.status,
      statusWords: statusWordsOf(a, ballot, tz),
      carried: a.status === "voting" && ballot?.status === "passed",
      candidate: { id: a.candidateUserId, name: await nameOf(a.candidateUserId) },
      seats: a.seatIds.map((id) => {
        const s = seats.find((x) => x.id === id);
        return { id, name: s?.name ?? proposed.get(id) ?? id, aim: s?.aim ?? null, ...(s ? {} : proposed.has(id) ? { proposedNew: true } : {}) };
      }),
      // The role proposal it came from: whether it changes roles, where the circle's consent stands, and the decision in words.
      proposal: proposal
        ? { id: proposal.id, changesRoles: changes, consent: answersCloseWith(consentView(asks, new Date(), tz, viewerId, askRoles), awaiting), decided: proposal.decidedWords }
        : null,
      note: a.note,
      deliverables: a.deliverables,
      settings: a.settings,
      term: { endsOn: civilDateKey(a.termEndsAt, tz), followsSeason: a.termFollowsSeason, seasonId: a.termSeasonId },
      startsOn: a.startsAt ? civilDateKey(a.startsAt, tz) : null,
      adoptedVia: a.adoptedVia,
      adoptedBy: a.adoptedVia === "holder" ? await nameOf(a.adoptedRef) : null,
      ballotId: ballot?.id ?? (a.adoptedVia === "ballot" ? a.adoptedRef : null),
      decidedOn: a.decidedAt ? civilDateKey(a.decidedAt, tz) : null,
      decidedAt: a.decidedAt ? a.decidedAt.toISOString() : null,
      createdAt: a.createdAt ? a.createdAt.toISOString() : null,
      // The application this one amends, and the version its text is (PR8).
      supersedesId: a.supersedesId,
      alignment: await alignmentOf(
        a,
        viewerId,
        seatNames,
        known ? known.view : undefined,
        !!viewerId && !!rule && adoptRefusal(rule, viewerId, a.candidateUserId) === null,
      ),
      ...(viewerId && rule
        ? {
            you: {
              isCandidate,
              mayAdopt: awaiting && adoptRefusal(rule, viewerId, a.candidateUserId) === null,
              mayPutToVillage: awaiting && !changes && putToVillageRefusal(rule, viewerId) === null,
              mayWithdraw: isCandidate && (await withdrawable(a, ballot)),
              holdsThePower: rule.who === "live-holders" && rule.holders.includes(viewerId),
            },
          }
        : {}),
    };
  }

  /** Open the vote on an application. `onOpen` writes the application's own row in the ballot's transaction. */
  async function openVote(
    a: Pick<StoredApplication, "id" | "seatIds" | "termEndsAt" | "termSeasonId" | "termFollowsSeason">,
    openedBy: string,
    onOpen: (conn: PoolConnection) => Promise<void>,
  ): Promise<{ ok: true; ballotId: string; closesAt: string } | { ok: false; status: number; error: string }> {
    const pool = getPool();
    const setup = await roleBallotSetup();
    if (setup.tokenProblem) return { ok: false, status: 409, error: setup.tokenProblem };
    const seats = await seatsForUpdate(pool, a.seatIds);
    const ballotSeats = a.seatIds.map((id) => {
      const s = seats.find((x) => x.id === id);
      return { name: s?.name ?? id, aim: s?.aim ?? null };
    });
    const result = await openBallot(pool, {
      subjectType: ROLE_APPLICATION,
      subjectRef: a.id,
      title: applicationBallotTitle(ballotSeats),
      docMarkdown: applicationBallotDoc(ballotSeats, a.id),
      method: setup.method,
      weightMode: setup.snapshot.mode,
      weightToken: setup.snapshot.token,
      unityPct: setup.dials.unityPct,
      quorumPct: setup.dials.quorumPct,
      durationDays: setup.durationDays,
      openedBy,
      electorate: setup.electorate,
      onOpen: async (conn, ballotId) => {
        // The term the vote seats on, frozen beside the ballot (0199) exactly as a seat vote's is.
        await freezeSeatTerm(conn, ballotId, { endsAt: a.termEndsAt, seasonId: a.termSeasonId, followsSeason: a.termFollowsSeason });
        await onOpen(conn);
      },
    });
    if (!result.ok) return { ok: false, status: 409, error: result.error };
    void notifyRollRows({ pool, notify, link: decisionLink }, result.ballot, {
      type: "ballot_opened",
      title: applicationNoticeTitle("opened", ballotSeats.map((s) => s.name)),
      // The day in the village's calendar, never the server's locale (red team U6).
      body: `Voting is open until ${civilDayWords(civilDateKey(new Date(result.ballot.closesAt), seatCalendar().timezone || "UTC"))}.`,
      keySuffix: "open",
      except: [openedBy],
      roll: setup.electorate.map((e) => e.userId),
    });
    return { ok: true, ballotId: result.ballot.id, closesAt: result.ballot.closesAt };
  }

  // ── The words, for the Review step ────────────────────────────────────────
  app.post("/api/governance/role-applications/words", async (req, res) => {
    const viewer = await reader(req, res);
    if (!viewer) return;
    if (await overLimit(`seat-application-words:${String(viewer.id)}`, 120, ASK_WINDOW_MS)) {
      return res.status(429).json({ error: "too_many_asks", message: "Wait a little and try again." });
    }
    const parsed = parseApplicationInput(req.body);
    if (!parsed.ok) return res.status(400).json({ error: parsed.error, field: parsed.field });
    const seats = await seatsForUpdate(getPool(), parsed.input.seatIds);
    const names = parsed.input.seatIds.map((id) => seats.find((s) => s.id === id)?.name ?? id);
    const words = seatTermsWords(names, parsed.input.settings);
    res.json({ title: words.title, body: words.body, money: carriesMoney(parsed.input.settings), intent: intentSentence(names) });
  });

  // ── Apply ─────────────────────────────────────────────────────────────────
  /*
   * THE DOOR ITSELF, past the sign-in, the rung and the rate: everything that
   * reads the body and writes the application. The POST below calls it, and
   * so does submitting a role proposal (server/routes/roleProposals.ts,
   * through `roleApplicationDoor`), so an application written from a
   * proposal passes every check one written here does.
   */
  async function applyFor(user: any, body: unknown, opts: ApplyOptions = {}): Promise<DoorAnswer> {
    const userId = String(user.id);
    const answer = (status: number, out: Record<string, unknown>): DoorAnswer => ({ status, body: out });
    const parsed = parseApplicationInput(body);
    if (!parsed.ok) return answer(400, { error: parsed.error, field: parsed.field });
    const input = parsed.input;
    const pool = getPool();
    const calendar = seatCalendar();
    const tz = calendar.timezone || "UTC";
    const now = new Date();
    // Roles a proposal asks the village to create: named by the proposal, with no row yet.
    const pending = new Map((opts.pendingRoles ?? []).map((r) => [r.id, r.name]));

    // A season named by the member's season plan: a season still to come sets
    // the first day to its own when the member set none, so the term sits in it.
    let startsOn = input.startsOn;
    if (input.seasonId) {
      const season = calendar.seasons.find((s) => s.id === input.seasonId);
      if (!season) return answer(400, { error: "There is no season by that id.", field: "seasonId" });
      const ends = season.endsOn ? civilDateInstant(season.endsOn, tz) : null;
      if (ends && ends.getTime() <= now.getTime()) return answer(409, { error: "That season has already ended.", field: "seasonId" });
      const begins = civilDateInstant(season.startsOn, tz);
      if (!startsOn && begins && begins.getTime() > now.getTime()) startsOn = season.startsOn;
    }
    const startsAt = startsOn ? civilDateInstant(startsOn, tz) : null;
    if (startsOn && !startsAt) {
      return answer(400, { error: "That first day is not a date the calendar has.", field: "startsNoEarlierThan" });
    }
    const later = !!startsAt && startsAt.getTime() > now.getTime();

    /*
     * AN AMENDMENT (PR8). `supersedesId` names the application whose terms
     * this one replaces: the member's own, adopted, its terms in force, for
     * the same seats. It takes the same road as any application, so the same
     * power adopts it; adopted, its text is version n+1, and version n stays in
     * force until n+1 is, then reads as superseded. Renewing on the same terms
     * is an amendment too.
     */
    let supersedes: { id: string; version: number } | null = null;
    if (input.supersedesId) {
      const old = await readApplication(pool, input.supersedesId);
      if (!old) return answer(404, { error: "There is no application by that id to amend.", field: "supersedesId" });
      if (old.candidateUserId !== userId) return answer(403, { error: "Only the member who holds these terms can propose to amend them.", field: "supersedesId" });
      const sameSeats = old.seatIds.length === input.seatIds.length && old.seatIds.every((s) => input.seatIds.includes(s));
      if (!sameSeats) {
        return answer(409, { error: "An amendment names the same roles as the terms it replaces. Apply for other roles in an application of their own.", field: "seatIds" });
      }
      const oldView = old.textId ? await viewText(pool, old.textId, today(), tz) : null;
      if (old.status !== "adopted" || !oldView || oldView.derived.state !== "in-force") {
        return answer(409, { error: "Only terms in force can be amended. These are not in force now.", field: "supersedesId" });
      }
      supersedes = { id: oldView.text.id, version: oldView.text.version };
    }

    // The seats: real, the village's own, live, and each with a place for this member.
    const seats = await seatsForUpdate(pool, input.seatIds);
    const live = await liveSeatingsOf(pool, input.seatIds);
    const lapseNow = { ...lapse(), now };
    for (const id of input.seatIds) {
      // A role the proposal asks the village to create has no row and every place free.
      if (pending.has(id)) {
        if (seats.some((s) => s.id === id)) return answer(409, { error: "A role by that id already exists. Save the draft again to give the new role an id of its own.", seatId: id });
        continue;
      }
      const seat = seats.find((s) => s.id === id);
      if (!seat) return answer(404, { error: "There is no role by that id.", seatId: id });
      if (seat.isExample) {
        return answer(409, { error: `${seat.name} is one of the platform's example roles. Apply for one of this village's own.`, seatId: id });
      }
      if (!seat.active) return answer(409, { error: `${seat.name} is not a role the village fills right now.`, seatId: id });
      const here = live.filter((l) => l.orgRoleId === id);
      if (here.some((l) => l.userId === userId)) continue; // already seated: the terms will link to that seating
      // An application for a later day is counted when that day comes.
      if (later) continue;
      const current = here.filter((l) => !isLapsed({ ...l, endedAt: null }, seat, lapseNow).lapsed).length;
      if (current >= seat.seats) {
        return answer(409, { error: `${seat.name} is full: every place in it is held.`, seatId: id, code: "seat_full" });
      }
    }
    const pendingApp = (await openApplicationsOf(pool, userId)).find((a) => a.seatIds.some((s) => input.seatIds.includes(s)));
    if (pendingApp) return answer(409, { error: PENDING_MESSAGE, applicationId: pendingApp.id });

    // The road, decided now. A proposal that changes roles always waits on a holder (role proposals PR A).
    const rule = await adoptionRule(user);
    const path = opts.holderOnly ? "holder" : adoptionPath(rule, userId);

    // The term, decided now and frozen. Counted from the latest the seats could be
    // taken up, so it stays good if a holder later sends the application to a vote.
    // The term, the row and the words are server/lib/seatApplicationWrite.ts, which an adopted open proposal writes through too.
    const setup = await roleBallotSetup();
    const landsAt = seatVoteLandsAt(landingDeps(), setup.durationDays, now);
    const startsNoEarlierThan = startsAt && startsAt.getTime() > landsAt.getTime() ? startsAt : landsAt;
    const seatNames = input.seatIds.map((sid) => seats.find((s) => s.id === sid)?.name ?? pending.get(sid) ?? sid);
    const made = await prepareApplication({ candidateUserId: userId, proposedBy: userId, input, startsAt, startsNoEarlierThan, seatNames, calendar, now, supersedes });
    if (!made.ok) return answer(made.status, made.body);
    const { row, prepared } = made.app;
    const id = row.id;

    /*
     * THE WORDS THE CANDIDATE ALIGNS WITH (PR5). The Review step showed the
     * words the `words` route rendered and hands them back: words that no
     * longer match, because a seat was renamed or the terms moved, are refused
     * before anything is written. Money asks the re-confirm first.
     */
    const aligned = (body as { alignedWords?: unknown } | null)?.alignedWords;
    if (aligned !== undefined && String(aligned) !== prepared.text.body) {
      return answer(409, { error: "words_changed", message: ALIGN_WORDS.wordsChanged, title: prepared.text.title, body: prepared.text.body });
    }
    const money = moneyRefusal(user, input.settings);
    if (money) return answer(403, money);
    /**
     * The application, its text, its parties and the candidate's alignment: one
     * transaction, so the candidate never clicks twice. The check above reads
     * without a lock; `writeApplicationOn` asks again under it (red team G6).
     */
    const writeAll = async (conn: PoolConnection, status: "awaiting-holder" | "voting") => {
      await writeApplicationOn(conn, made.app, status, { candidateAligns: true });
      // A proposal stamps itself submitted in the same transaction, so the two never disagree.
      if (opts.alsoWrite) await opts.alsoWrite(conn, id);
    };

    /** A refusal the locked check threw, or a write that lost a race with a twin, answered as a 409. */
    const raced = (e: any): DoorAnswer | null => {
      if (e?.code === "SA_PENDING") return answer(409, { error: PENDING_MESSAGE, applicationId: e.applicationId });
      if (e?.code === "DOOR_REFUSED") return answer(Number(e.status) || 409, e.body ?? { error: String(e.message) });
      if (e?.code === "ER_LOCK_DEADLOCK" || e?.errno === 1213 || e?.errno === 1020) {
        return answer(409, { error: "Another application for these roles was written at the same moment. Read your applications, then try again." });
      }
      return null;
    };

    if (path === "holder") {
      try {
        await inApplicationTransaction(pool, (conn) => writeAll(conn, "awaiting-holder"));
      } catch (e) {
        const r = raced(e);
        if (r) return r;
        throw e;
      }
      for (const holder of (rule.who === "live-holders" ? rule.holders : []).filter((h) => h !== userId)) {
        await notify({
          userId: holder,
          type: "governance",
          title: applicationNoticeTitle("waiting", seatNames),
          // The link opens the application; the body says where it waits after the bell is cleared.
          body: WAITING_COPY.holderNoticeBody,
          link: applicationHref(id),
          actorUserId: userId,
          dedupeKey: `sa:${id}:waiting:${holder}`,
        });
      }
      return answer(201, { success: true, id, url: applicationHref(id), status: "awaiting-holder", textId: prepared.text.id, caution: made.app.caution });
    }

    /*
     * A DAILY CAP ON THE VOTES ONE MEMBER OPENS (red team S6). Every ballot
     * notifies the whole roll, and withdraw-and-apply-again opens a fresh one
     * each time, so a member could fill everybody's inbox. Three a day is more
     * than a season plan's seats need.
     */
    if (await overLimit(`seat-application-ballot:${userId}`, BALLOTS_PER_DAY, DAY_MS)) {
      return answer(429, {
        error: "too_many_votes",
        message: `You have opened ${BALLOTS_PER_DAY} votes on applications today, which is the most one day holds. Apply again tomorrow.`,
      });
    }
    let opened: Awaited<ReturnType<typeof openVote>>;
    try {
      opened = await openVote(row, userId, (conn) => writeAll(conn, "voting"));
    } catch (e) {
      const r = raced(e);
      if (r) return r;
      throw e;
    }
    if (!opened.ok) return answer(opened.status, { error: opened.error });
    return answer(201, {
      success: true,
      id,
      url: applicationHref(id),
      status: "voting",
      textId: prepared.text.id,
      ballot: { id: opened.ballotId, closesAt: opened.closesAt },
      caution: made.app.caution,
    });
  }
  door = applyFor;

  app.post("/api/governance/role-applications", async (req, res) => {
    const user = await authedUser(req);
    if (!user) return res.status(401).json({ error: "auth_required", message: "Sign in to apply for a role." });
    const userId = String(user.id);
    if (!(await guardCapability(req, res, "terms.read", { status: 403, body: { error: "members_only", message: "Applying for a role opens at the member rung." } }))) return;
    if (await overLimit(`seat-application:${userId}`, ASKS_PER_WINDOW, ASK_WINDOW_MS)) {
      return res.status(429).json({ error: "too_many_asks", message: "That is a lot of applications in a few minutes. Wait a little and try again." });
    }
    const out = await applyFor(user, req.body);
    res.status(out.status).json(out.body);
  });

  // ── Read ──────────────────────────────────────────────────────────────────
  /*
   * `?candidate=<userId>` (player card PR 3): one member's applications only,
   * filtered in SQL on `candidate_user_id` (seat_applications_candidate_idx),
   * with `groups` naming which are past, this season and next season by the
   * rule the player card reads (shared/applicationGroups.ts). The list is the
   * open book at `terms.read` either way, so the filter narrows and never
   * widens. Old seatings with no application ride along for the reader's own
   * id only: they are a person's history, and the card shows them to its owner.
   */
  app.get("/api/governance/role-applications", async (req, res) => {
    const viewer = await reader(req, res);
    if (!viewer) return;
    const rawCandidate = req.query.candidate;
    if (rawCandidate !== undefined && (typeof rawCandidate !== "string" || !rawCandidate.trim() || rawCandidate.length > 64)) {
      return res.status(400).json({ error: "That is not a member id.", field: "candidate" });
    }
    const candidate = typeof rawCandidate === "string" ? rawCandidate.trim() : null;
    const rule = await adoptionRule(viewer);
    const pool = getPool();
    const all = candidate ? await applicationsOfCandidates(pool, [candidate]) : await listApplications(pool);
    const isSelf = candidate !== null && candidate === String(viewer.id);
    const held = isSelf ? await pastSeatingsWithoutApplication(pool, [candidate]) : [];
    // A fixed number of reads for the whole list (red team D8): ballots, seats and texts once each.
    const ballots = await latestBallotsFor(pool, all.map((a) => a.id));
    const seats = await seatsForUpdate(pool, Array.from(new Set([...all.flatMap((a) => a.seatIds), ...held.map((h) => h.roleId)])));
    const texts = await readTexts(pool, all.map((a) => a.textId).filter((t): t is string => !!t));
    const tz = seatCalendar().timezone || "UTC";
    const views = await viewTexts(pool, texts, today(), tz);
    const proposals = await proposalsForApplications(pool, all.map((a) => a.id));
    const asks = await asksFor(pool, Array.from(proposals.values()).map((p) => p.id));
    const askRoles = await askRolesFor(pool, Array.from(asks.values()).flat());
    const applications = await Promise.all(
      all.map((a) =>
        served(a, String(viewer.id), rule, {
          ballot: ballots.get(a.id) ?? null,
          seats,
          view: (a.textId && views.find((v) => v.text.id === a.textId)) || null,
          proposal: proposals.get(a.id) ?? null,
          asks: asks.get(proposals.get(a.id)?.id ?? "") ?? [],
          askRoles,
        }),
      ),
    );
    if (candidate === null) return res.json({ applications });
    const grouped = groupApplications(all, candidate, groupingContext(seatCalendar(), (d) => civilDateInstant(d, tz), new Date()));
    res.set("Cache-Control", "no-store").json({
      applications,
      groups: {
        past: grouped.past.map((a) => a.id),
        thisSeason: grouped.thisSeason.map((a) => a.id),
        nextSeason: grouped.nextSeason.map((a) => a.id),
      },
      ...(isSelf
        ? {
            pastSeatings: held.map((h) => ({
              roleId: h.roleId,
              roleName: seats.find((s) => s.id === h.roleId)?.name ?? h.roleId,
              startedOn: h.startedAt ? civilDateKey(h.startedAt, tz) : null,
              endedOn: h.endedAt ? civilDateKey(h.endedAt, tz) : null,
              words: PAST_SEATING_WORDS.status,
              href: `/roles?seat=${encodeURIComponent(h.roleId)}`,
            })),
          }
        : {}),
    });
  });

  /*
   * ── WAITING ON YOU, for the profile's task board ───────────────────────
   *
   * The reader's own rows and nobody else's: applications they may adopt, and
   * open drafts a proposal made when they may publish them. Members only, by
   * the same `terms.read` door as every read here.
   *
   * A draft row asks the question the publish routes ask (`publishDoorFor`,
   * server/lib/orgDraftDecide.ts): a live holder of `org.decide` sees it, and
   * so does an admin until a launch vote has carried, which is when the admin
   * panel's door stops being the decider's. Rye, 2026-10-20: "Immediate, and
   * yes this is a power under any org and founder roles." A draft the village
   * is voting on is frozen, so nobody is asked to publish it and it is left
   * off. Each row links its batch's structure page, which offers the same
   * door (server/routes/structureReview.ts).
   *
   * `toAccept` is the done tasks the reader may accept as accomplished
   * (`tasksToAccept`, server/lib/sessionTasks.ts): a live holder of
   * `org.seat`, never for their own work. Nothing is read while Live Sessions
   * is off, and a task layer that cannot be read leaves the group empty
   * rather than failing the applications beside it.
   */
  /** The done tasks waiting on this reader to accept them, or none. */
  const acceptsWaitingOn = async (viewerId: string) => {
    if (effectiveLifecycle("sessions") === "off") return [];
    try {
      return await tasksToAccept(getPool(), viewerId, { acceptors: await liveHoldersOf(ACCEPTING_POWER), lapseContext: lapse });
    } catch (e) {
      console.error("[waiting] the tasks to accept could not be read", e);
      return [];
    }
  };

  /**
   * `raisedWithYou` is the tensions raised with a role the reader holds live
   * and nobody has answered (`heldTensionsFor`, server/lib/roleTensions.ts).
   * A tension store that cannot be read leaves the group empty rather than
   * failing the rows beside it, as the task layer does above.
   */
  const tensionsWaitingOn = async (viewerId: string) => {
    try {
      return await heldTensionsFor(getPool(), viewerId, { timeZone: seatCalendar().timezone || "UTC" });
    } catch (e) {
      console.error("[waiting] the tensions raised with the reader's roles could not be read", e);
      return [];
    }
  };

  app.get(WAITING_URL, async (req, res) => {
    const viewer = await reader(req, res);
    if (!viewer) return;
    const viewerId = String(viewer.id);
    const ctx = await capabilityCtx(viewer);
    const pool = getPool();
    const rule = await adoptionRule(viewer, ctx);
    const payload: WaitingPayload = {
      applications: await applicationsWaitingOn(
        { pool, allMembers: () => members.all(), firstName, timezone: seatCalendar().timezone || "UTC" },
        rule,
        viewerId,
      ),
      drafts: (await publishDoorFor(pool, { userId: viewerId, isAdmin: ctx.isAdmin === true }, await liveHoldersOf(ORG_DECIDE)))
        ? await unfrozen(pool, await draftsWaiting(pool))
        : [],
      toAccept: await acceptsWaitingOn(viewerId),
      raisedWithYou: await tensionsWaitingOn(viewerId),
      // Role proposals the reader's circle is asked about and they have not answered (role proposals PR B).
      toConsent: await consentAsksWaitingOn(
        { pool, allMembers: () => members.all(), firstName, timezone: seatCalendar().timezone || "UTC", now: new Date() },
        viewerId,
      ),
      // Proposals from somebody with no account yet: asked of the reader's circle, or the reader's to decide (open proposals part B).
      openProposals: await openProposalsWaitingOn(
        { pool, timezone: seatCalendar().timezone || "UTC", now: new Date() },
        rule,
        viewerId,
        typeof viewer.email === "string" ? viewer.email : null,
      ),
    };
    res.set("Cache-Control", "no-store").json(payload);
  });

  app.get("/api/governance/role-applications/:id", async (req, res) => {
    const viewer = await reader(req, res);
    if (!viewer) return;
    const id = String(req.params.id ?? "");
    const a = APPLICATION_ID.test(id) ? await readApplication(getPool(), id) : null;
    if (!a) return res.status(404).json({ error: "There is no application by that id." });
    res.json({ application: await served(a, String(viewer.id), await adoptionRule(viewer)) });
  });

  /** The application a holder door acts on, or null after answering. */
  async function forHolder(req: any, res: any, bucket: string) {
    const user = await authedUser(req);
    if (!user) {
      res.status(401).json({ error: "auth_required" });
      return null;
    }
    if (await overLimit(`${bucket}:${String(user.id)}`, ASKS_PER_WINDOW, ASK_WINDOW_MS)) {
      res.status(429).json({ error: "too_many_asks", message: "That is a lot of decisions in a few minutes. Wait a little and try again." });
      return null;
    }
    const id = String(req.params.id ?? "");
    const a = APPLICATION_ID.test(id) ? await readApplication(getPool(), id) : null;
    if (!a) {
      res.status(404).json({ error: "There is no application by that id." });
      return null;
    }
    if (a.status !== "awaiting-holder") {
      res.status(409).json({ error: `This application is ${STATUS_WORDS[a.status].toLowerCase()}, so it is not waiting for a role holder.`, status: a.status });
      return null;
    }
    // The role proposal it came from, if any (role proposals PR B): adopting it applies the proposal's role changes.
    const proposal = (await proposalsForApplications(getPool(), [a.id])).get(a.id) ?? null;
    return { user, a, rule: await adoptionRule(user), proposal };
  }

  // ── Adopt, for the village ────────────────────────────────────────────────
  /*
   * A ROLE PROPOSAL IS ADOPTED HERE TOO (role proposals PR B). Path (a) is a
   * live holder of `org.seat` who is not the candidate, whenever they like;
   * path (b) is the same click once the circle has consented ("Record the
   * adoption"). Either way the holder's click first applies the proposal's
   * role changes as one published org draft (`applyProposalChanges`), then
   * adopts the application the ordinary way. An adoption that then cannot go
   * through (somebody else decided it, or a role is gone) reverts that draft,
   * so the chart never changes for a proposal nobody adopted. The decision is
   * recorded on the proposal in words naming a role, never a person.
   */
  app.post("/api/governance/role-applications/:id/adopt", async (req, res) => {
    const got = await forHolder(req, res, "seat-application-adopt");
    if (!got) return;
    const { user, a, rule, proposal } = got;
    const actorId = String(user.id);
    const refusal = adoptRefusal(rule, actorId, a.candidateUserId);
    if (refusal) return res.status(refusal.status).json({ error: refusal.error, message: refusal.message });
    // The holder aligns for the village: money terms ask them the re-confirm too.
    const money = moneyRefusal(user, a.settings);
    if (money) return res.status(403).json(money);

    const carrying = rolesCarrying(ADOPTING_POWER);
    const seatedIn = loadRoleHolders().find((h) => h.userId === actorId && carrying.some((r) => r.id === h.roleId))?.roleId ?? "badge";
    const pool = getPool();
    const now = new Date();
    const tz = seatCalendar().timezone || "UTC";
    let draftId: string | null = null;
    if (proposal) {
      const seats = await seatsForUpdate(pool, a.seatIds);
      const proposed = new Map(proposal.body.newRoles.map((r) => [r.id, typeof r.words.name === "string" ? r.words.name : r.id]));
      const names = a.seatIds.map((id) => seats.find((s) => s.id === id)?.name ?? proposed.get(id) ?? id);
      const applied = await applyProposalChanges(pool, proposal, actorId, seatCalendar(), names);
      if (!applied.ok) return res.status(409).json({ error: "proposal_changes_failed", message: applied.error });
      draftId = applied.draftId;
    }
    const { outcome, app: stored, textId } = await adoptApplication(
      pool,
      a.id,
      ["awaiting-holder"],
      { via: "holder", ref: actorId, authority: `${ADOPTING_POWER}@${seatedIn}`.slice(0, 64) },
      { now, lapse: lapse(), calendar: seatCalendar() },
    );
    // Nothing adopted: the role changes made for it are put back.
    if (draftId && (outcome.kind === "lost" || outcome.kind === "cannot" || !stored)) await revertDraft(pool, draftId);
    if (outcome.kind === "lost" || !stored) {
      return res.status(409).json({ error: "Somebody else decided this application a moment ago.", status: outcome.kind === "lost" ? outcome.status : null });
    }
    await tellOutcome({ getPool, notify, notifyAdmins }, stored, outcome, actorId, actorId);
    if (textId) await settleText(settleDeps, textId);
    let decided: string | null = null;
    if (proposal && outcome.kind !== "cannot") {
      const state = consentState((await asksFor(pool, [proposal.id])).get(proposal.id) ?? [], now);
      decided = decisionFor(state, now, tz, carrying.find((r) => r.id === seatedIn)?.name ?? null);
      await setDecidedWords(pool, proposal.id, decided);
    }
    const status = outcome.kind === "held-full" ? "held-full" : outcome.kind === "cannot" ? "not-adopted" : "adopted";
    res.json({
      success: outcome.kind === "seated" || outcome.kind === "later",
      status,
      seated: outcome.kind === "seated" ? outcome.seated.length : 0,
      linked: outcome.kind === "seated" ? outcome.linked.length : 0,
      ...(outcome.kind === "held-full" ? { full: outcome.full } : {}),
      ...(outcome.kind === "cannot" ? { message: outcome.why } : {}),
      ...(decided ? { decided } : {}),
    });
  });

  // ── Put it to the village ─────────────────────────────────────────────────
  app.post("/api/governance/role-applications/:id/put-to-village", async (req, res) => {
    const got = await forHolder(req, res, "seat-application-to-village");
    if (!got) return;
    const { user, a, rule, proposal } = got;
    // A proposal that changes roles is decided by its circle or by the power (Rye, 2026-10-22), never by a vote.
    if (proposal && changesRoles(proposal.body)) return res.status(409).json({ error: "proposal_changes_roles", message: CONSENT_WORDS.noVote });
    const refusal = putToVillageRefusal(rule, String(user.id));
    if (refusal) return res.status(refusal.status).json({ error: refusal.error, message: refusal.message });
    let moved = false;
    const opened = await openVote(a, String(user.id), async (conn) => {
      moved = await setStatus(conn, a.id, ["awaiting-holder"], "voting");
      // Thrown, so the ballot this transaction opened rolls back with it.
      if (!moved) throw Object.assign(new Error("the application moved before its vote opened"), { code: "SA_MOVED" });
    }).catch((e) => {
      if (e?.code === "SA_MOVED") return { ok: false as const, status: 409, error: "Somebody else decided this application a moment ago." };
      throw e;
    });
    if (!opened.ok) return res.status(opened.status).json({ error: opened.error });
    res.json({ success: true, status: "voting", ballot: { id: opened.ballotId, closesAt: opened.closesAt } });
  });

  // ── Withdraw ──────────────────────────────────────────────────────────────
  app.post("/api/governance/role-applications/:id/withdraw", async (req, res) => {
    const user = await authedUser(req);
    if (!user) return res.status(401).json({ error: "auth_required" });
    const userId = String(user.id);
    if (await overLimit(`seat-application-withdraw:${userId}`, ASKS_PER_WINDOW, ASK_WINDOW_MS)) {
      return res.status(429).json({ error: "too_many_asks", message: "Wait a little and try again." });
    }
    const id = String(req.params.id ?? "");
    const pool = getPool();
    const a = APPLICATION_ID.test(id) ? await readApplication(pool, id) : null;
    if (!a) return res.status(404).json({ error: "There is no application by that id." });
    if (a.candidateUserId !== userId) return res.status(403).json({ error: "Only the member who applied can withdraw an application." });
    const latest = (await latestBallotsFor(pool, [a.id])).get(a.id) ?? null;
    if (a.status === "voting" && latest && latest.status === "passed") {
      // The village carried it (red team U1). Withdrawing now would undo a carried vote with nobody told.
      return res.status(409).json({ error: "The village carried this application, so it can no longer be withdrawn. It lands when its window ends.", status: a.status, carried: true });
    }
    if (!(await withdrawable(a, latest))) {
      return res.status(409).json({ error: `This application is ${STATUS_WORDS[a.status].toLowerCase()}, so there is nothing to withdraw.`, status: a.status });
    }
    if (a.status === "voting") {
      /*
       * THE VOTE GOES WITH THE APPLICATION. A member may always take their own
       * application back, so votes already cast are set aside: nobody is held
       * to a seat they no longer ask for. The ballot's own withdraw rule
       * (`withdrawBallot`) is asked, never bypassed.
       */
      const ballot = await openBallotFor(pool, ROLE_APPLICATION, a.id);
      if (ballot) {
        const out = await withdrawBallot(pool, {
          ballotId: ballot.id,
          // The public ballot names nobody (red team S1): the system withdraws it, in neutral words.
          withdrawnBy: APPLICATION_BALLOT_ACTOR,
          reason: APPLICATION_WITHDRAWN_NOTE,
          withdrawerMayDiscardVotes: true,
        });
        if (!out.ok) return res.status(409).json({ error: out.error });
        await markNotApplicable(pool, ballot.id);
      }
    }
    const moved = await setStatus(pool, a.id, [a.status], "withdrawn", { decided: true });
    if (!moved) return res.status(409).json({ error: "This application moved a moment ago. Read it again." });
    // An adopted application's terms were aligned by both parties; withdrawn, they read as ended.
    if (a.textId) await settleText(settleDeps, a.textId);
    res.json({ success: true, status: "withdrawn" });
  });
}
