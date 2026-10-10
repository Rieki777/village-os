/**
 * THE MEMBER DOOR: APPLY TO HOLD SEATS, ON TERMS (seat settings PR4).
 *
 *   POST /api/governance/role-applications                    apply for 1 to 5 seats
 *   GET  /api/governance/role-applications                    every application (terms.read)
 *   GET  /api/governance/role-applications/:id                one, with what the reader may do (terms.read)
 *   POST /api/governance/role-applications/:id/adopt          a live org.seat holder adopts it for the village
 *   POST /api/governance/role-applications/:id/put-to-village a live org.seat holder sends it to a vote
 *   POST /api/governance/role-applications/:id/withdraw       the candidate takes it back
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
import crypto from "node:crypto";
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
import { civilDateInstant, resolveSeatTerm, type SeatCalendar } from "../../shared/seatTerms";
import { settingsHash, type SeatSettings } from "../../shared/seatSettings";
import { civilDateKey, SYNODIC_MONTH_MS } from "../../shared/lunar";
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
import { carriesMoney, intentSentence, RECONFIRM_FRESH_MS, userParty, ALIGN_WORDS } from "../../shared/alignments";
import {
  prepareSeatTermsText,
  presentView,
  recordAlignment,
  seatTermsWords,
  settleText,
  viewText,
  writePreparedText,
  type PreparedText,
} from "../lib/alignmentSubjects";
import { confirmedWithin } from "../lib/identityConfirm";
import {
  inApplicationTransaction,
  insertApplication,
  listApplications,
  liveSeatingsOf,
  openApplicationsOf,
  readApplication,
  seatsForUpdate,
  setStatus,
  type StoredApplication,
} from "../repos/seatApplications";
import { isLapsed } from "../lib/orgChart";
import { freezeSeatTerm } from "../repos/ballotSeatTerms";

/** Exported for the job that turns the season (season plans): it seats an adopted application on its day. */
export { seatFromApplication } from "../lib/seatApplicationCloser";

/** At most ten asks in ten minutes per member per door, the raised-hand door's numbers. */
const ASKS_PER_WINDOW = 10;
const ASK_WINDOW_MS = 10 * 60 * 1000;

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

const MEMBERS_ONLY = { error: "auth_required", message: "Members read seat applications." };

/** A seat's term as a civil date, from the terms' own length when no date is written. */
function requestedEndsOn(settings: SeatSettings, startsAt: Date, timezone: string): string | null {
  const t = settings.term;
  if (!t) return null;
  if (typeof t.endsOn === "string" && t.endsOn.trim()) return t.endsOn.trim();
  if (typeof t.lengthMoons === "number" && t.lengthMoons > 0) {
    return civilDateKey(new Date(startsAt.getTime() + t.lengthMoons * SYNODIC_MONTH_MS), timezone || "UTC");
  }
  return null;
}

export function register(app: Express, deps: Deps): void {
  const { authedUser, capabilityCtx, guardCapability, getPool, notify, notifyAdmins, overLimit, members, firstName } = deps;
  const { liveHoldersOf, rolesCarrying, loadRoleHolders, roleBallotSetup, seatCalendar, lapse, landingDeps } = deps;

  const closer = seatApplicationCloser({ getPool, notify, notifyAdmins, lapse, calendar: seatCalendar });
  deps.closers[ROLE_APPLICATION] = closer;

  /** Who adopts seats today, and why: the raised-hand door's one rule over `org.seat`. */
  async function adoptionRule(viewer: any) {
    const ctx = await capabilityCtx(viewer);
    return whoMayPutHandToVillage(isVillageHeld(ADOPTING_POWER as Capability, ctx.villageHeld), await liveHoldersOf(ADOPTING_POWER));
  }

  /**
   * The signed-in member holding `terms.read`, or null after answering 401.
   * Asked through the one gate, `guardCapability`, so a visitor and a guest
   * are told the same thing and the governance document reads the door.
   */
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
  async function alignmentOf(a: StoredApplication, viewerId: string | null, seatNames: string[]) {
    if (a.textId) {
      const v = await viewText(getPool(), a.textId, today());
      if (v) return await presentView(v, viewerId, async (id) => nameOf(id), true);
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
      you: isCandidate ? { partyKey: userParty(a.candidateUserId), aligned: false, alignedAt: null, mayAlign: !closed } : null,
      contentHash: null,
      createdAt: null,
      retrofit: true,
    };
  }

  /** An application as a member reads it, with what this reader may do with it. */
  async function served(a: StoredApplication, viewerId: string | null, rule: Awaited<ReturnType<typeof adoptionRule>> | null) {
    const pool = getPool();
    const seats = await seatsForUpdate(pool, a.seatIds);
    const tz = seatCalendar().timezone || "UTC";
    const ballot = a.status === "voting" ? await openBallotFor(pool, ROLE_APPLICATION, a.id) : null;
    const isCandidate = viewerId === a.candidateUserId;
    const awaiting = a.status === "awaiting-holder";
    const seatNames = a.seatIds.map((id) => seats.find((x) => x.id === id)?.name ?? id);
    return {
      id: a.id,
      href: applicationHref(a.id),
      status: a.status,
      statusWords: STATUS_WORDS[a.status],
      candidate: { id: a.candidateUserId, name: await nameOf(a.candidateUserId) },
      seats: a.seatIds.map((id) => {
        const s = seats.find((x) => x.id === id);
        return { id, name: s?.name ?? id, aim: s?.aim ?? null };
      }),
      note: a.note,
      deliverables: a.deliverables,
      settings: a.settings,
      term: { endsOn: civilDateKey(a.termEndsAt, tz), followsSeason: a.termFollowsSeason, seasonId: a.termSeasonId },
      startsOn: a.startsAt ? civilDateKey(a.startsAt, tz) : null,
      adoptedVia: a.adoptedVia,
      adoptedBy: a.adoptedVia === "holder" ? await nameOf(a.adoptedRef) : null,
      ballotId: ballot?.id ?? (a.adoptedVia === "ballot" ? a.adoptedRef : null),
      decidedAt: a.decidedAt ? a.decidedAt.toISOString() : null,
      createdAt: a.createdAt ? a.createdAt.toISOString() : null,
      alignment: await alignmentOf(a, viewerId, seatNames),
      ...(viewerId && rule
        ? {
            you: {
              isCandidate,
              mayAdopt: awaiting && adoptRefusal(rule, viewerId, a.candidateUserId) === null,
              mayPutToVillage: awaiting && putToVillageRefusal(rule, viewerId) === null,
              mayWithdraw: isCandidate && (OPEN_STATUSES.includes(a.status) || a.status === "held-full"),
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
      body: `Voting is open until ${new Date(result.ballot.closesAt).toLocaleDateString()}.`,
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
  app.post("/api/governance/role-applications", async (req, res) => {
    const user = await authedUser(req);
    if (!user) return res.status(401).json({ error: "auth_required", message: "Sign in to apply for a seat." });
    const userId = String(user.id);
    if (!(await guardCapability(req, res, "terms.read", { status: 403, body: { error: "members_only", message: "Applying for a seat opens at the member rung." } }))) return;
    if (await overLimit(`seat-application:${userId}`, ASKS_PER_WINDOW, ASK_WINDOW_MS)) {
      return res.status(429).json({ error: "too_many_asks", message: "That is a lot of applications in a few minutes. Wait a little and try again." });
    }
    const parsed = parseApplicationInput(req.body);
    if (!parsed.ok) return res.status(400).json({ error: parsed.error, field: parsed.field });
    const input = parsed.input;
    const pool = getPool();
    const calendar = seatCalendar();
    const tz = calendar.timezone || "UTC";
    const now = new Date();

    // A season named by the member's season plan: a season still to come sets
    // the first day to its own when the member set none, so the term sits in it.
    let startsOn = input.startsOn;
    if (input.seasonId) {
      const season = calendar.seasons.find((s) => s.id === input.seasonId);
      if (!season) return res.status(400).json({ error: "There is no season by that id.", field: "seasonId" });
      const ends = season.endsOn ? civilDateInstant(season.endsOn, tz) : null;
      if (ends && ends.getTime() <= now.getTime()) return res.status(409).json({ error: "That season has already ended.", field: "seasonId" });
      const begins = civilDateInstant(season.startsOn, tz);
      if (!startsOn && begins && begins.getTime() > now.getTime()) startsOn = season.startsOn;
    }
    const startsAt = startsOn ? civilDateInstant(startsOn, tz) : null;
    if (startsOn && !startsAt) {
      return res.status(400).json({ error: "That first day is not a date the calendar has.", field: "startsNoEarlierThan" });
    }
    const later = !!startsAt && startsAt.getTime() > now.getTime();

    // The seats: real, the village's own, live, and each with a place for this member.
    const seats = await seatsForUpdate(pool, input.seatIds);
    const live = await liveSeatingsOf(pool, input.seatIds);
    const lapseNow = { ...lapse(), now };
    for (const id of input.seatIds) {
      const seat = seats.find((s) => s.id === id);
      if (!seat) return res.status(404).json({ error: "There is no seat by that id.", seatId: id });
      if (seat.isExample) {
        return res.status(409).json({ error: `${seat.name} is one of the platform's example seats. Apply for one of this village's own.`, seatId: id });
      }
      if (!seat.active) return res.status(409).json({ error: `${seat.name} is not a seat the village fills right now.`, seatId: id });
      const here = live.filter((l) => l.orgRoleId === id);
      if (here.some((l) => l.userId === userId)) continue; // already seated: the terms will link to that seating
      // An application for a later day is counted when that day comes.
      if (later) continue;
      const current = here.filter((l) => !isLapsed({ ...l, endedAt: null }, seat, lapseNow).lapsed).length;
      if (current >= seat.seats) {
        return res.status(409).json({ error: `${seat.name} is full: every place in it is held.`, seatId: id, code: "seat_full" });
      }
    }
    const pending = (await openApplicationsOf(pool, userId)).find((a) => a.seatIds.some((s) => input.seatIds.includes(s)));
    if (pending) {
      return res.status(409).json({
        error: "You already have an application waiting on a decision for one of these seats. Withdraw it first, or wait for it.",
        applicationId: pending.id,
      });
    }

    // The road, decided now.
    const rule = await adoptionRule(user);
    const path = adoptionPath(rule, userId);

    // The term, decided now and frozen. Counted from the latest the seats could be
    // taken up, so it stays good if a holder later sends the application to a vote.
    const setup = await roleBallotSetup();
    const landsAt = seatVoteLandsAt(landingDeps(), setup.durationDays, now);
    const startsNoEarlierThan = startsAt && startsAt.getTime() > landsAt.getTime() ? startsAt : landsAt;
    const term = resolveSeatTerm({
      requestedEndsOn: requestedEndsOn(input.settings, startsNoEarlierThan, tz),
      calendar,
      capAtSeasonEnd: false,
      now,
      startsNoEarlierThan,
    });
    if (!term.ok) return res.status(term.code === "unreadable_date" ? 400 : 409).json({ error: term.error, code: term.code, field: "seatSettings" });

    const id = `sa-${crypto.randomBytes(8).toString("hex")}`;
    const row = {
      id,
      candidateUserId: userId,
      proposedBy: userId,
      seatIds: input.seatIds,
      note: input.note,
      deliverables: input.deliverables,
      settings: input.settings,
      settingsHash: await settingsHash(input.settings),
      termEndsAt: term.endsAt,
      termSeasonId: term.seasonId,
      termFollowsSeason: term.followsSeason,
      startsAt,
    };
    const seatNames = input.seatIds.map((sid) => seats.find((s) => s.id === sid)?.name ?? sid);

    /*
     * THE WORDS THE CANDIDATE ALIGNS WITH (PR5). The Review step showed the
     * words the `words` route rendered and hands them back: words that no
     * longer match, because a seat was renamed or the terms moved, are refused
     * before anything is written. Money asks the re-confirm first.
     */
    const prepared: PreparedText = prepareSeatTermsText({ ...row }, seatNames, userId, tz);
    if (req.body?.alignedWords !== undefined && String(req.body.alignedWords) !== prepared.text.body) {
      return res.status(409).json({ error: "words_changed", message: ALIGN_WORDS.wordsChanged, title: prepared.text.title, body: prepared.text.body });
    }
    const money = moneyRefusal(user, input.settings);
    if (money) return res.status(403).json(money);
    const stored = { ...row, textId: prepared.text.id, textHash: prepared.text.contentHash };
    /** The application, its text, its parties and the candidate's alignment: one transaction, so the candidate never clicks twice. */
    const writeAll = async (conn: PoolConnection, status: "awaiting-holder" | "voting") => {
      await insertApplication(conn, { ...stored, status });
      await writePreparedText(conn, prepared);
      await recordAlignment(conn, {
        textId: prepared.text.id,
        partyKey: userParty(userId),
        userId,
        contentHash: prepared.text.contentHash,
        intent: intentSentence(seatNames),
        method: "click",
        authorityRef: null,
      });
    };

    if (path === "holder") {
      await inApplicationTransaction(pool, (conn) => writeAll(conn, "awaiting-holder"));
      for (const holder of rule.holders.filter((h) => h !== userId)) {
        await notify({
          userId: holder,
          type: "governance",
          title: applicationNoticeTitle("waiting", seatNames),
          body: null,
          link: applicationHref(id),
          actorUserId: userId,
          dedupeKey: `sa:${id}:waiting:${holder}`,
        });
      }
      return res.status(201).json({ success: true, id, url: applicationHref(id), status: "awaiting-holder", textId: prepared.text.id, caution: term.caution ?? null });
    }

    const opened = await openVote(row, userId, (conn) => writeAll(conn, "voting"));
    if (!opened.ok) return res.status(opened.status).json({ error: opened.error });
    res.status(201).json({
      success: true,
      id,
      url: applicationHref(id),
      status: "voting",
      textId: prepared.text.id,
      ballot: { id: opened.ballotId, closesAt: opened.closesAt },
      caution: term.caution ?? null,
    });
  });

  // ── Read ──────────────────────────────────────────────────────────────────
  app.get("/api/governance/role-applications", async (req, res) => {
    const viewer = await reader(req, res);
    if (!viewer) return;
    const rule = await adoptionRule(viewer);
    const all = await listApplications(getPool());
    res.json({ applications: await Promise.all(all.map((a) => served(a, String(viewer.id), rule))) });
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
      res.status(409).json({ error: `This application is ${STATUS_WORDS[a.status].toLowerCase()}, so it is not waiting for a seat holder.`, status: a.status });
      return null;
    }
    return { user, a, rule: await adoptionRule(user) };
  }

  // ── Adopt, for the village ────────────────────────────────────────────────
  app.post("/api/governance/role-applications/:id/adopt", async (req, res) => {
    const got = await forHolder(req, res, "seat-application-adopt");
    if (!got) return;
    const { user, a, rule } = got;
    const actorId = String(user.id);
    const refusal = adoptRefusal(rule, actorId, a.candidateUserId);
    if (refusal) return res.status(refusal.status).json({ error: refusal.error, message: refusal.message });
    // The holder aligns for the village: money terms ask them the re-confirm too.
    const money = moneyRefusal(user, a.settings);
    if (money) return res.status(403).json(money);

    const carrying = rolesCarrying(ADOPTING_POWER).map((r) => r.id);
    const seatedIn = loadRoleHolders().find((h) => h.userId === actorId && carrying.includes(h.roleId))?.roleId ?? "badge";
    const { outcome, app: stored, textId } = await adoptApplication(
      getPool(),
      a.id,
      ["awaiting-holder"],
      { via: "holder", ref: actorId, authority: `${ADOPTING_POWER}@${seatedIn}`.slice(0, 64) },
      { now: new Date(), lapse: lapse(), calendar: seatCalendar() },
    );
    if (outcome.kind === "lost" || !stored) {
      return res.status(409).json({ error: "Somebody else decided this application a moment ago.", status: outcome.kind === "lost" ? outcome.status : null });
    }
    await tellOutcome({ getPool, notify, notifyAdmins }, stored, outcome, actorId, actorId);
    if (textId) await settleText(settleDeps, textId);
    const status = outcome.kind === "held-full" ? "held-full" : outcome.kind === "cannot" ? "not-adopted" : "adopted";
    res.json({
      success: outcome.kind === "seated" || outcome.kind === "later",
      status,
      seated: outcome.kind === "seated" ? outcome.seated.length : 0,
      linked: outcome.kind === "seated" ? outcome.linked.length : 0,
      ...(outcome.kind === "held-full" ? { full: outcome.full } : {}),
      ...(outcome.kind === "cannot" ? { message: outcome.why } : {}),
    });
  });

  // ── Put it to the village ─────────────────────────────────────────────────
  app.post("/api/governance/role-applications/:id/put-to-village", async (req, res) => {
    const got = await forHolder(req, res, "seat-application-to-village");
    if (!got) return;
    const { user, a, rule } = got;
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
    if (!OPEN_STATUSES.includes(a.status) && a.status !== "held-full") {
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
    res.json({ success: true, status: "withdrawn" });
  });
}
