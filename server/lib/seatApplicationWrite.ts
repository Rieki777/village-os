/**
 * WRITING ONE SEAT APPLICATION, past every check its door makes.
 *
 * Lifted out of the member door (`applyFor`, server/routes/seatApplications.ts)
 * so a second writer takes the same term, the same row and the same words:
 * an adopted role proposal from somebody who had no account (open proposals
 * part B, server/lib/openProposalDecide.ts) is written as an application
 * exactly as a member's own would be, and the hourly `season-plan-turn` job
 * seats it on its first day like any other (server/lib/seasonTurn.ts).
 *
 *   prepareApplication  the term, frozen now, the row and the words every
 *                       party aligns with. Writes nothing.
 *   writeApplicationOn  inside the caller's transaction: one application per
 *                       seat at a time, under the lock (red team G6); the
 *                       row; its text and parties; and the candidate's own
 *                       alignment when the candidate is the one asking.
 *
 * WHO ALIGNS WHEN. A member applying aligns with the words their Review step
 * showed them (PR5). A person whose proposal the village adopted before they
 * had an account never saw these words, so nobody aligns on their behalf: the
 * village aligns when it adopts, and they align themselves from the
 * application's page once they are signed in. Seating does not wait on it.
 */
import crypto from "node:crypto";
import type { PoolConnection } from "mysql2/promise";
import { intentSentence, userParty } from "../../shared/alignments";
import type { ApplicationInput } from "../../shared/seatApplications";
import { civilDateKey, SYNODIC_MONTH_MS } from "../../shared/lunar";
import { resolveSeatTerm, type SeatCalendar } from "../../shared/seatTerms";
import { settingsHash, type SeatSettings } from "../../shared/seatSettings";
import { holdingApplicationsLocked, insertApplication, type NewApplication } from "../repos/seatApplications";
import { prepareSeatTermsText, recordAlignment, writePreparedText, type PreparedText } from "./alignmentSubjects";

/** A seat's term as a civil date, from the terms' own length when no date is written. */
export function requestedEndsOn(settings: SeatSettings, startsAt: Date, timezone: string): string | null {
  const t = settings.term;
  if (!t) return null;
  if (typeof t.endsOn === "string" && t.endsOn.trim()) return t.endsOn.trim();
  if (typeof t.lengthMoons === "number" && t.lengthMoons > 0) {
    return civilDateKey(new Date(startsAt.getTime() + t.lengthMoons * SYNODIC_MONTH_MS), timezone || "UTC");
  }
  return null;
}

/** An application ready to write: the row, its words and the seat names they name. */
export interface PreparedApplication {
  row: Omit<NewApplication, "status"> & { textId: string; textHash: string };
  prepared: PreparedText;
  seatNames: string[];
  /** The term resolver's caution, when it had one. */
  caution: string | null;
}

export type Prepared = { ok: true; app: PreparedApplication } | { ok: false; status: number; body: Record<string, unknown> };

/**
 * The term, decided now and frozen, counted from `startsNoEarlierThan`; the
 * row; and the words. Writes nothing.
 */
export async function prepareApplication(p: {
  candidateUserId: string;
  proposedBy: string;
  input: Pick<ApplicationInput, "seatIds" | "note" | "deliverables" | "settings" | "supersedesId">;
  startsAt: Date | null;
  startsNoEarlierThan: Date;
  seatNames: string[];
  calendar: SeatCalendar;
  now: Date;
  /** The text this one amends (PR8), or null. */
  supersedes: { id: string; version: number } | null;
}): Promise<Prepared> {
  const tz = p.calendar.timezone || "UTC";
  const term = resolveSeatTerm({
    requestedEndsOn: requestedEndsOn(p.input.settings, p.startsNoEarlierThan, tz),
    calendar: p.calendar,
    capAtSeasonEnd: false,
    now: p.now,
    startsNoEarlierThan: p.startsNoEarlierThan,
  });
  if (!term.ok) return { ok: false, status: term.code === "unreadable_date" ? 400 : 409, body: { error: term.error, code: term.code, field: "seatSettings" } };
  const row = {
    id: `sa-${crypto.randomBytes(8).toString("hex")}`,
    candidateUserId: p.candidateUserId,
    proposedBy: p.proposedBy,
    seatIds: p.input.seatIds,
    note: p.input.note,
    deliverables: p.input.deliverables,
    settings: p.input.settings,
    settingsHash: await settingsHash(p.input.settings),
    termEndsAt: term.endsAt,
    termSeasonId: term.seasonId,
    termFollowsSeason: term.followsSeason,
    startsAt: p.startsAt,
    supersedesId: p.input.supersedesId,
  };
  const prepared = prepareSeatTermsText({ ...row }, p.seatNames, p.candidateUserId, tz, p.supersedes);
  return {
    ok: true,
    app: { row: { ...row, textId: prepared.text.id, textHash: prepared.text.contentHash }, prepared, seatNames: p.seatNames, caution: term.caution ?? null },
  };
}

/**
 * The application, its text, its parties and, when the candidate is asking,
 * their alignment: inside the caller's transaction, so the candidate never
 * clicks twice and nothing is half written.
 *
 * ONE APPLICATION PER SEAT AT A TIME, UNDER THE LOCK (red team G6). The seat
 * rows are locked and the candidate's applications holding any of them
 * (held-full and adopted-not-yet-seated included) are read with a locking
 * read; one found throws `SA_PENDING` with its id, and the caller answers it.
 */
export async function writeApplicationOn(
  conn: PoolConnection,
  app: PreparedApplication,
  status: "awaiting-holder" | "voting",
  opts: { candidateAligns: boolean },
): Promise<void> {
  const holding = await holdingApplicationsLocked(conn, app.row.candidateUserId, app.row.seatIds);
  if (holding.length > 0) throw Object.assign(new Error("an application for one of these roles is already waiting"), { code: "SA_PENDING", applicationId: holding[0].id });
  await insertApplication(conn, { ...app.row, status });
  await writePreparedText(conn, app.prepared);
  if (!opts.candidateAligns) return;
  await recordAlignment(conn, {
    textId: app.prepared.text.id,
    partyKey: userParty(app.row.candidateUserId),
    userId: app.row.candidateUserId,
    contentHash: app.prepared.text.contentHash,
    intent: intentSentence(app.seatNames),
    method: "click",
    authorityRef: null,
  });
}
