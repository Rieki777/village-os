/**
 * ADOPTING A SEAT APPLICATION, AND SEATING IT (seat settings PR4).
 *
 * Two doors adopt an application and both come through `adoptApplication`
 * here: a live holder of `org.seat` clicking "Align for the village"
 * (server/routes/seatApplications.ts), and a `role_application` ballot landing
 * (`seatApplicationCloser` below, in the shape `SUBJECT_CLOSERS` wants, on the
 * agreementCloser model). So the re-checks, the seating and the term are one
 * copy whichever door the village used.
 *
 * ── IT READS THE STORED ROW, NEVER THE BALLOT ──────────────────────────────
 *
 * The seats, the terms and the term's end are what was written into
 * `seat_applications` when the application was made. The ballot's document is
 * copy, and carries none of them on purpose (shared/seatApplications.ts).
 *
 * ── THE SEATS ARE COUNTED AGAIN AT LANDING ─────────────────────────────────
 *
 * A vote runs for days, and a seat that had a free place when the member
 * applied can be filled by another door before it lands. So the closer locks
 * the seats and their live seatings in one transaction and counts again. A
 * seat with no free place HOLDS the whole application (`held-full`): nobody is
 * seated in any of its seats, because the terms were offered as one package
 * and half a package is not what anybody adopted. A lapsed seating is waiting
 * to be reassigned and does not count against the place, the rule
 * `seatState` already reads.
 *
 * A CANDIDATE ALREADY SEATED in one of the seats is RENEWED (red team G1): the
 * existing seating ends, and a new one starts on this application's terms,
 * season and term end, keeping the old seating's focus and note. The old row
 * keeps the application id it held, so the earlier terms read as ended and
 * the record of who held what on which terms stays whole. Writing the new id
 * over the old row lost that record and left the season and the end as they
 * were, so a lapsed seating stayed lapsed under terms reading in force.
 *
 * ── AN APPLICATION FOR LATER IS ADOPTED AND SEATS NOBODY ───────────────────
 *
 * `starts_at` in the future means next season's seats. A seating made today
 * would carry next season's id and read as lapsed in this one (`isLapsed`), so
 * adoption records `adopted` and stops. `seatFromApplication`, run by the
 * hourly `season-plan-turn` job (server/lib/seasonTurn.ts), seats it on the
 * day through the same count. An application whose term sits in a season that
 * has not begun is later in the same way, whatever its `starts_at` says (red
 * team G4): a holder adopting it near a season's end would otherwise seat it
 * now with next season's id, lapsed from the moment it was made.
 *
 * NO PUBLIC EVENT AND NO ACTIVITY LINE. Neither `recordEvent` nor
 * `addActivity` is called anywhere in this feature: the row is the record, and
 * a member hears through a notification that names the seats and links the
 * page, nothing more.
 */
import type { Pool, PoolConnection } from "mysql2/promise";
import { civilDateInstant, RECORD_LIMIT, type SeatCalendar } from "../../shared/seatTerms";
import { applicationHref, applicationNoticeTitle, type ApplicationStatus } from "../../shared/seatApplications";
import type { CloseRouting, SubjectCloser } from "./applyDue";
import type { BallotRow } from "./ballots";
import { isLapsed, seatHolder, type LapseContext } from "./orgChart";
import { ensureApplicationText, recordVillageAlignment, settleText } from "./alignmentSubjects";
import { civilDateKey } from "../../shared/lunar";
import {
  endSeatingForRenewal,
  inApplicationTransaction,
  liveSeatingsOf,
  readApplication,
  seatingsEverHolding,
  seatsForUpdate,
  setStatus,
  type StoredApplication,
} from "../repos/seatApplications";

export interface SeatingContext {
  now: Date;
  lapse: LapseContext;
  calendar: SeatCalendar;
}

export interface Adoption {
  via: "holder" | "ballot";
  /** The ballot id, or the adopting holder's user id. */
  ref: string;
  /** 'org.seat@<role id>' for a holder, the ballot id for a vote. */
  authority: string;
}

export type SeatingOutcome =
  /** Seated now. `seated` are the new seatings; `linked` names the seats where an existing seating was renewed. */
  | { kind: "seated"; seated: Array<{ assignmentId: string; seatId: string; renewed: boolean }>; linked: string[] }
  /** Adopted, and the seats wait for `starts_at`. */
  | { kind: "later" }
  /** A seat had no free place. Nobody was seated. */
  | { kind: "held-full"; full: string[] }
  /** A seat is gone, retired or an example, or the term ended before it could start. */
  | { kind: "cannot"; why: string }
  /** The application was not where this door expected it. Another door got there first. */
  | { kind: "lost"; status: ApplicationStatus | null };

/**
 * The first instant an application's seats may be taken up: its own
 * `starts_at`, or, when its term sits in a season that begins later, that
 * season's first day (red team G4). Null means now.
 */
export function firstDayOf(app: Pick<StoredApplication, "startsAt" | "termSeasonId">, calendar: SeatCalendar): Date | null {
  const tz = calendar.timezone || "UTC";
  const season = app.termSeasonId ? calendar.seasons.find((s) => s.id === app.termSeasonId) : null;
  const begins = season?.startsOn ? civilDateInstant(season.startsOn, tz) : null;
  if (app.startsAt && begins) return app.startsAt.getTime() > begins.getTime() ? app.startsAt : begins;
  return app.startsAt ?? begins ?? null;
}

const notYet = (app: Pick<StoredApplication, "startsAt" | "termSeasonId">, ctx: SeatingContext) => {
  const first = firstDayOf(app, ctx.calendar);
  return !!first && first.getTime() > ctx.now.getTime();
};

/** The term a seating takes, following the season's end when the application said it would. */
function termAtSeating(app: StoredApplication, calendar: SeatCalendar, now: Date): { ok: true; endsAt: Date } | { ok: false; why: string } {
  const tz = calendar.timezone || "UTC";
  let endsAt = app.termEndsAt;
  if (app.termFollowsSeason && app.termSeasonId) {
    const season = calendar.seasons.find((s) => s.id === app.termSeasonId);
    const seasonEnd = season?.endsOn ? civilDateInstant(season.endsOn, tz) : null;
    if (seasonEnd && seasonEnd.getTime() <= RECORD_LIMIT.getTime()) endsAt = seasonEnd;
  }
  if (endsAt.getTime() <= now.getTime()) {
    return { ok: false, why: "The term this application set ended before its seats could be taken up, so nobody was seated. Apply again with a later end." };
  }
  return { ok: true, endsAt };
}

/**
 * Count, then seat, inside the caller's transaction. Writes no status: the
 * caller decides what the outcome means for the row.
 */
async function seatInTransaction(conn: PoolConnection, app: StoredApplication, ctx: SeatingContext, grantedBy: string): Promise<SeatingOutcome> {
  const term = termAtSeating(app, ctx.calendar, ctx.now);
  if (!term.ok) return { kind: "cannot", why: term.why };

  const seats = await seatsForUpdate(conn, app.seatIds, true);
  const live = await liveSeatingsOf(conn, app.seatIds, true);
  const lapse = { ...ctx.lapse, now: ctx.now };

  const full: string[] = [];
  const toRenew: Array<{ seatId: string; old: (typeof live)[number] }> = [];
  const toSeat: string[] = [];
  for (const seatId of app.seatIds) {
    const seat = seats.find((s) => s.id === seatId);
    if (!seat || !seat.active || seat.isExample) {
      return { kind: "cannot", why: `A seat this application names (${seat?.name ?? seatId}) is no longer one the village seats people in, so nobody was seated.` };
    }
    const here = live.filter((l) => l.orgRoleId === seatId);
    const mine = here.find((l) => l.userId === app.candidateUserId);
    if (mine) {
      // Already on this application's terms: nothing to do for this seat.
      if (mine.applicationId !== app.id) toRenew.push({ seatId, old: mine });
      continue;
    }
    const current = here.filter((l) => !isLapsed({ ...l, endedAt: null }, seat, lapse).lapsed).length;
    if (current >= seat.seats) full.push(seat.name);
    else toSeat.push(seatId);
  }
  if (full.length > 0) return { kind: "held-full", full };

  const seated: Array<{ assignmentId: string; seatId: string; renewed: boolean }> = [];
  const seatOne = async (seatId: string, renewed: (typeof toRenew)[number] | null) => {
    if (renewed && !(await endSeatingForRenewal(conn, renewed.old.id, app.id))) {
      throw new Error(`the seating ${renewed.old.id} renewed by ${app.id} ended under this transaction`);
    }
    const r = await seatHolder(conn, seatId, {
      userId: app.candidateUserId,
      seasonId: app.termSeasonId,
      termEndsAt: term.endsAt,
      termFollowsSeason: app.termFollowsSeason,
      grantedBy,
      applicationId: app.id,
      focus: renewed?.old.focus ?? null,
      note: renewed?.old.note ?? null,
    });
    // The seats and their seatings are locked above, so a refusal here is a
    // write this transaction cannot explain. Throwing rolls back every seat.
    if (!r.ok || !r.assignmentId) throw new Error(`seating ${seatId} for ${app.id} was refused: ${r.reason ?? "no reason"}`);
    seated.push({ assignmentId: r.assignmentId, seatId, renewed: !!renewed });
  };
  for (const r of toRenew) await seatOne(r.seatId, r);
  for (const seatId of toSeat) await seatOne(seatId, null);
  return { kind: "seated", seated, linked: toRenew.map((r) => r.seatId) };
}

/**
 * Adopt an application for the village, by a holder or by a landed vote.
 *
 * `from` is the status this door expects to find. A row in any other status
 * is left alone and answered `lost`, which is how a holder's click and a
 * landing vote cannot both adopt one application.
 */
export async function adoptApplication(
  pool: Pool,
  id: string,
  from: readonly ApplicationStatus[],
  how: Adoption,
  ctx: SeatingContext,
): Promise<{ outcome: SeatingOutcome; app: StoredApplication | null; textId: string | null }> {
  return inApplicationTransaction(pool, async (conn) => {
    const app = await readApplication(conn, id, true);
    if (!app || !from.includes(app.status)) return { outcome: { kind: "lost", status: app?.status ?? null }, app, textId: null };
    const adopted = { adoptedVia: how.via, adoptedRef: how.ref, authorityRef: how.authority, decided: true };
    const tz = ctx.calendar.timezone || "UTC";

    /*
     * THE VILLAGE ALIGNS WITH THE WORDS IT WAS ASKED ABOUT (PR5). The text's
     * hash must be the one the application recorded when it was written; an
     * application from before PR5 gains its text here, rendered from its
     * stored terms. A mismatch adopts nothing.
     */
    const text = await ensureApplicationText(conn, app, how.via === "holder" ? how.ref : app.candidateUserId, tz);
    if (app.textHash && text.contentHash !== app.textHash) {
      await setStatus(conn, id, from, "not-adopted", { decided: true });
      return {
        outcome: { kind: "cannot", why: "The words this adoption would align with are not the words the application recorded, so nothing was changed." },
        app,
        textId: text.id,
      };
    }
    const villageAligns = () =>
      recordVillageAlignment(
        conn,
        { ...app, textId: text.id, textHash: text.contentHash },
        { method: how.via, authorityRef: how.authority, actorId: how.ref },
        tz,
      );

    if (notYet(app, ctx)) {
      await setStatus(conn, id, from, "adopted", adopted);
      await villageAligns();
      return { outcome: { kind: "later" }, app, textId: text.id };
    }
    const outcome = await seatInTransaction(conn, app, ctx, how.ref);
    if (outcome.kind === "seated") await setStatus(conn, id, from, "adopted", adopted);
    else if (outcome.kind === "held-full") await setStatus(conn, id, from, "held-full", adopted);
    else if (outcome.kind === "cannot") await setStatus(conn, id, from, "not-adopted", { decided: true });
    // The village decided to adopt, whether or not a place was free today: it aligns.
    if (outcome.kind === "seated" || outcome.kind === "held-full") await villageAligns();
    return { outcome, app, textId: text.id };
  });
}

/**
 * Seat an application the village already adopted, now that its day has come.
 *
 * For the job that turns the season (season plans), and for an application
 * held because a seat was full once a place frees. Takes `adopted` (with
 * `starts_at` reached and nothing seated yet) or `held-full`. Counts the seats
 * again exactly as adoption does. Seating twice is impossible: an application
 * whose terms a seating already holds answers `lost`.
 */
export async function seatFromApplication(pool: Pool, id: string, ctx: SeatingContext): Promise<{ outcome: SeatingOutcome; app: StoredApplication | null }> {
  return inApplicationTransaction(pool, async (conn) => {
    const app = await readApplication(conn, id, true);
    if (!app || (app.status !== "adopted" && app.status !== "held-full")) return { outcome: { kind: "lost", status: app?.status ?? null }, app };
    if (notYet(app, ctx)) return { outcome: { kind: "later" }, app };
    // Seated once is seated: a seating that has since ENDED (an unseat, an
    // erasure) is not re-made by the turn. Only a seating ever made counts.
    if ((await seatingsEverHolding(conn, id)) > 0) return { outcome: { kind: "lost", status: app.status }, app };
    const outcome = await seatInTransaction(conn, app, ctx, app.adoptedRef ?? app.id);
    if (outcome.kind === "seated" && app.status === "held-full") await setStatus(conn, id, ["held-full"], "adopted");
    if (outcome.kind === "held-full" && app.status === "adopted") await setStatus(conn, id, ["adopted"], "held-full");
    // A term that ran out before its seats could be taken up closes the
    // application, so the turn does not try it again every hour.
    if (outcome.kind === "cannot") await setStatus(conn, id, [app.status], "not-adopted", { decided: true });
    return { outcome, app };
  });
}

// ── Telling people ──────────────────────────────────────────────────────────

export interface NoticeDeps {
  getPool: () => Pool;
  notify: (input: {
    userId: string;
    type: string;
    title: string;
    body?: string | null;
    link?: string | null;
    actorUserId?: string | null;
    dedupeKey: string;
  }) => Promise<unknown>;
  notifyAdmins: (type: string, title: string, dedupeKey: string, link?: string) => Promise<unknown>;
}

/** The names of an application's seats, in the order it named them. */
export async function seatNamesOf(pool: Pool, app: Pick<StoredApplication, "seatIds">): Promise<string[]> {
  const seats = await seatsForUpdate(pool, app.seatIds);
  return app.seatIds.map((id) => seats.find((s) => s.id === id)?.name ?? id);
}

/**
 * Tell the candidate how an adoption came out, and each new seating its own
 * appointment. Seat names and a link only.
 */
export async function tellOutcome(deps: NoticeDeps, app: StoredApplication, outcome: SeatingOutcome, key: string, actorId: string | null): Promise<void> {
  const pool = deps.getPool();
  const names = await seatNamesOf(pool, app);
  const link = applicationHref(app.id);
  if (outcome.kind === "seated" || outcome.kind === "later") {
    await deps.notify({ userId: app.candidateUserId, type: "governance", title: applicationNoticeTitle("adopted", names), body: null, link, actorUserId: actorId, dedupeKey: `sa:${app.id}:adopted:${key}` });
  }
  if (outcome.kind === "seated") {
    for (const s of outcome.seated) {
      const name = names[app.seatIds.indexOf(s.seatId)] ?? s.seatId;
      // The same type and key grammar every seating door uses, keyed on this seating.
      const title = s.renewed ? `Your seat as ${name} was renewed on your new terms` : `You were seated as ${name}`;
      await deps.notify({ userId: app.candidateUserId, type: "role_appointed", title, body: null, link, actorUserId: actorId, dedupeKey: `org-seat:${s.assignmentId}` });
    }
  }
  if (outcome.kind === "held-full") {
    await deps.notify({ userId: app.candidateUserId, type: "governance", title: applicationNoticeTitle("held-full", names), body: null, link, actorUserId: actorId, dedupeKey: `sa:${app.id}:held-full:${key}` });
    await deps.notifyAdmins("governance", applicationNoticeTitle("held-full", names), `sa:${app.id}:held-full:admins:${key}`, link);
  }
  if (outcome.kind === "cannot") {
    await deps.notify({ userId: app.candidateUserId, type: "governance", title: applicationNoticeTitle("not-adopted", names), body: null, link, actorUserId: actorId, dedupeKey: `sa:${app.id}:cannot:${key}` });
    await deps.notifyAdmins("governance", applicationNoticeTitle("not-adopted", names), `sa:${app.id}:cannot:admins:${key}`, link);
  }
}

// ── The closer ──────────────────────────────────────────────────────────────

export interface SeatApplicationCloserDeps extends NoticeDeps {
  lapse: () => LapseContext;
  calendar: () => SeatCalendar;
  now?: () => Date;
}

const nothing = (): CloseRouting => ({ applied: [], held: null, proposerTold: null });

/** What `settleText` needs, from the notice deps and the village's calendar. */
export function settleDepsOf(deps: NoticeDeps & { calendar: () => SeatCalendar }, now: () => Date = () => new Date()) {
  return {
    getPool: deps.getPool,
    notify: deps.notify,
    notifyAdmins: deps.notifyAdmins,
    today: () => civilDateKey(now(), deps.calendar().timezone || "UTC"),
  };
}

/**
 * What a `role_application` ballot does when it closes, lands, is withdrawn
 * or is stopped. A game change: it waits its window like any other.
 */
export function seatApplicationCloser(deps: SeatApplicationCloserDeps): SubjectCloser {
  const now = () => deps.now?.() ?? new Date();

  return {
    settle: async (b: BallotRow, outcome, _note, actorId) => {
      // A carried vote changes nothing at the close: the landing does it.
      if (outcome === "passed") return nothing();
      const pool = deps.getPool();
      const moved = await setStatus(pool, b.subjectRef, ["voting"], "not-adopted", { decided: true });
      const app = await readApplication(pool, b.subjectRef);
      if (moved && app) {
        await deps.notify({
          userId: app.candidateUserId,
          type: "governance",
          title: applicationNoticeTitle("not-adopted", await seatNamesOf(pool, app)),
          body: null,
          link: applicationHref(app.id),
          actorUserId: actorId,
          dedupeKey: `bal:${b.id}:sa-not-adopted`,
        });
      }
      return { applied: [], held: null, proposerTold: app?.candidateUserId ?? null };
    },

    execute: async (b: BallotRow, actorId) => {
      const { outcome, app, textId } = await adoptApplication(
        deps.getPool(),
        b.subjectRef,
        ["voting"],
        { via: "ballot", ref: b.id, authority: b.id },
        { now: now(), lapse: deps.lapse(), calendar: deps.calendar() },
      );
      if (outcome.kind === "lost" || !app) {
        return {
          applied: [],
          held: "The application this vote would adopt is no longer waiting on a vote, so nothing was changed.",
          proposerTold: null,
        };
      }
      await tellOutcome(deps, app, outcome, b.id, actorId);
      if (textId) await settleText(settleDepsOf(deps, now), textId);
      if (outcome.kind === "held-full") {
        return {
          applied: [],
          held: "A seat this application names had no free place when the vote landed, so nobody was seated and the application is held.",
          proposerTold: app.candidateUserId,
        };
      }
      if (outcome.kind === "cannot") return { applied: [], held: outcome.why, proposerTold: app.candidateUserId };
      return { applied: [`seat_application:${app.id}`], held: null, proposerTold: app.candidateUserId };
    },

    onWithdraw: async (b: BallotRow) => {
      await setStatus(deps.getPool(), b.subjectRef, ["voting"], "withdrawn", { decided: true });
    },

    onUnlanded: async (b: BallotRow) => {
      await setStatus(deps.getPool(), b.subjectRef, ["voting"], "not-adopted", { decided: true });
    },
  };
}
