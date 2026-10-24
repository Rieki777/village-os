/**
 * A DEPARTED MEMBER'S SUBMISSIONS, for the erasure's
 * "submission-words-after-tombstone" step (server/lib/erasure.ts).
 *
 * WHAT THE FIRST PASS MISSED. The "submissions" step, before the tombstone,
 * matched a row only by its `userId` and cleared seven contact keys. So three
 * things outlived the member in the admin inbox (`GET /api/admin/submissions`
 * serves whole rows):
 *
 *   - Everything they sent SIGNED OUT. `/api/forms/submit` stamps a member
 *     only when a session came with the form, and the membership request is
 *     the form a person sends before they have an account at all: their name,
 *     their address, why they wanted to join and how they heard of the village.
 *   - Their own WORDS on the rows that were matched: the note on a raised hand
 *     (up to 2000 characters), the name a seat claim recorded, the why and
 *     the paths of a signing, a visit's message, a steward's gifts and
 *     questions. The newer seat-application flow already takes the same kind
 *     of words (server/repos/seatApplications.ts), so the two flows disagreed.
 *   - The TEAM ALERT each public form sends, whose subject carries the name
 *     as typed: server/repos/commsPeople.ts, `forgetTeamAlerts`.
 *
 * WHOSE ROWS. Every row on their account, and every row with no account on it
 * sent under their own address, which is the rule the housing scrub follows
 * for a request made the same way. A row another member sent stays theirs.
 *
 * WHAT A ROW KEEPS, which is the inverse of what it used to say. The row
 * stays, with its type, status, time and account link, because the inbox is
 * the village's record of what was asked and what it decided. Inside `data`,
 * every value goes except the ones `KEPT_BY_TYPE` lists, each of which names
 * something of the village's own or a decision somebody else relies on, and
 * the reason for each is beside it. A list of what to KEEP is what holds when
 * a form grows a field: a list of what to clear missed every word above.
 *
 * ORDER INSIDE THE STEP IS LOAD-BEARING. The files only their rows name come
 * off the uploads volume first, while the rows still say which files those
 * are (`attachmentFilesOnlyTheyName`). The alerts go next, while the rows
 * still carry the names their subjects were built from. A death between any
 * two is resumed by a read that still finds all three; a death after the rows
 * are written leaves nothing that needs a name.
 */
import path from "node:path";
import type { Pool } from "mysql2/promise";
import { COMMS_CHANGE } from "../../shared/comms/memberView";
import { POWER_APPLICATION } from "../../shared/powerHands";
import { QUEST_IDEA_FORM } from "../../shared/questIdeas";
import { emailKeyOf } from "../../shared/comms/address";
import { forgetTeamAlerts, type TeamAlertOf } from "../repos/commsPeople";
import { isProposalAttachment } from "./uploadsSweep";

/** What a removed value reads as, the same words the first pass always wrote. */
export const REMOVED_WORDS = "[removed at member's request]";

/** The name a kept row carries for its departed member. */
const ANON = "A departed member";

/** The seat-claim type, written by server/routes/org.ts. */
const SEAT_CLAIM = "seat-claim";

/**
 * The `data` keys each submission type keeps after its member is erased.
 * Everything not listed goes. Each entry says why it stays.
 */
export const KEPT_BY_TYPE: Readonly<Record<string, readonly string[]>> = {
  // A raised hand names the village's own seat and the term the hand asked for
  // (server/lib/raisedHandTerm.ts). The term and its caution are the village's
  // words, and the inbox reads them to say what was asked.
  "role-application": ["roleId", "roleName", "termEndsOn", "followsSeason", "caution"],
  // A seat claim names the village's seating. The steward's queue finds an
  // open claim by `assignmentId`; the recorded name was theirs and goes.
  [SEAT_CLAIM]: ["assignmentId", "roleId", "roleName"],
  // A hand for a power names the village's power and the roles it suits; the
  // list of hands members read is built from them (shared/powerHands.ts).
  [POWER_APPLICATION]: ["capability", "powerLabel", "suits"],
  // A proposed change to the village's email names which of its journeys,
  // emails or dials it was about. The words of the change were theirs.
  [COMMS_CHANGE]: ["target", "key", "step", "about"],
  // A signing of the letter: which version was signed, when, and the two
  // acknowledgements. A steward's admission stands on that record.
  "membership-508": ["letterVersion", "signedAt", "acknowledgedGoodNeighbor", "acknowledgedCommitments"],
  // A quest idea keeps its words, the rule the "quest-proposals" step already
  // follows: the idea in review is the village's, and only its author goes.
  // These six are the fields the review queue's copy is built from
  // (server/lib/publicForms.ts).
  [QUEST_IDEA_FORM]: ["title", "whatYouWantToDo", "resourcesBringing", "resourcesNeeded", "compensation", "timelineMilestones"],
  // An investor packet request keeps which of the village's documents were
  // released and whether they were posted, and the accreditation declared,
  // the facts the investor path keeps de-attributed for the reason the
  // erasure header gives under INVESTOR PATH FACTS.
  "investor-doc-request": ["documentsSent", "emailed", "accredited"],
};

/** Whether this row is the member's: on their account, or sent signed out under their address. */
export function isTheirSubmission(row: any, who: { userId: string; emailKey: string }): boolean {
  if (!row || typeof row !== "object") return false;
  if (row.userId === who.userId) return true;
  if (row.userId) return false;
  if (!who.emailKey) return false;
  const email = row.data && typeof row.data === "object" ? row.data.email : null;
  return typeof email === "string" && emailKeyOf(email) === who.emailKey;
}

/** Nothing to take: a value that was never filled in reads the same afterwards. */
const blank = (v: unknown): boolean =>
  v == null || (typeof v === "string" && !v.trim()) || (Array.isArray(v) && v.length === 0);

/**
 * Take the member's words and name off one row, in place. Answers whether
 * anything changed. Idempotent: a second call finds every value already
 * removed or kept, and changes nothing.
 */
export function scrubSubmissionWords(row: any, opts: { onTheirAccount: boolean }): boolean {
  let changed = false;
  if (opts.onTheirAccount && row.userName !== ANON) {
    row.userName = ANON;
    changed = true;
  }
  const data = row.data;
  if (data == null) return changed;
  if (typeof data !== "object" || Array.isArray(data)) {
    if (!blank(data) && data !== REMOVED_WORDS) {
      row.data = REMOVED_WORDS;
      changed = true;
    }
    return changed;
  }
  const kept = new Set(KEPT_BY_TYPE[String(row.type ?? "")] ?? []);
  for (const k of Object.keys(data)) {
    if (kept.has(k) || blank(data[k]) || data[k] === REMOVED_WORDS) continue;
    data[k] = REMOVED_WORDS;
    changed = true;
  }
  return changed;
}

/** A value read as the route that sent the alert read it. */
const said = (v: unknown): string => (v == null ? "" : String(v));

/**
 * The team alerts this row set off, with each subject's ending exactly as
 * the route built it. Read before the row is scrubbed.
 *
 *   /api/forms/submit (server/index.ts): "[<village>] New <type> submission
 *   from <name, else first name, else address>", origin forms.team_alert.
 *   The investor packet: "New investor doc request from <name>", or "Investor
 *   doc request from <name>, no documents in the packet", origin
 *   investor.team_alert.
 *
 * A row whose alert named nobody ("Anonymous", or nothing at all) yields none.
 *
 * `knownAs` is the member's own name and address, for a row an older sweep
 * already scrubbed. Before this step existed the first pass cleared the name
 * keys and left the alert, so on a record that stopped past the tombstone the
 * row no longer says what its alert said, and the member's name is the best
 * reading of it left. A name they typed that was not their account's is the
 * one such an alert keeps.
 */
export function teamAlertsOf(row: any, knownAs: readonly string[] = []): TeamAlertOf[] {
  const data = row?.data && typeof row.data === "object" && !Array.isArray(row.data) ? row.data : null;
  const around = Math.floor(Date.parse(String(row?.submittedAt ?? "")) / 1000);
  if (!data || !Number.isFinite(around)) return [];
  const type = String(row.type ?? "");
  const readAs = (typed: string): string[] =>
    (typed === REMOVED_WORDS ? [...knownAs] : [typed]).filter((n) => n.trim() && n !== "Anonymous" && n !== REMOVED_WORDS);
  if (type === "investor-doc-request") {
    return readAs(said(data.name)).flatMap((name) => [
      { origin: "investor.team_alert", subjectEndsWith: ` New investor doc request from ${name}`, around },
      { origin: "investor.team_alert", subjectEndsWith: ` Investor doc request from ${name}, no documents in the packet`, around },
    ]);
  }
  return readAs(said(data.name ?? data.firstName ?? data.email ?? "Anonymous")).map((applicant) => ({
    origin: "forms.team_alert",
    subjectEndsWith: ` New ${type} submission from ${applicant}`,
    around,
  }));
}

/** The file a row's `attachment` names, basenamed as the retention sweep reads it (server/index.ts). */
const attachmentOf = (row: any): string => path.basename(String(row?.data?.attachment ?? "").trim());

/**
 * The files on the uploads volume that only the member's rows name.
 *
 * THE FILE, NOT ONLY ITS NAME (adversarial round 3, finding 10). A Work With
 * Us proposal's attachment, a CV or a portfolio, is stored as
 * `proposal-<stamp>-<rand>.<ext>` and served at `/api/uploads/<name>` with no
 * sign-in to anybody holding the name, and the team alert mailed every
 * recipient that name. The row's `attachment` is the only record of which
 * file is whose, and the retention sweep deletes a file by it. Scrubbing the
 * pointer and leaving the file kept the bytes readable and put them beyond
 * the sweep for good.
 *
 * THE RETENTION SWEEP'S OWN GUARD, because the name came from a stranger:
 * `POST /api/forms/submit` is public and stores `data` as sent, so a row can
 * name any file. A name is taken only when it is one the proposal door
 * minted (`isProposalAttachment`) and no row that is not the member's names
 * it, both sides basenamed into one namespace. So a row sent under their
 * address naming somebody else's file cannot take it, and another door's
 * files are out of reach.
 */
export function attachmentFilesOnlyTheyName(rows: readonly any[], theirs: readonly any[]): string[] {
  const mine = new Set(theirs);
  const kept = new Set(rows.filter((r) => !mine.has(r)).map(attachmentOf).filter(Boolean));
  const out = new Set<string>();
  for (const s of theirs) {
    const name = attachmentOf(s);
    if (name && !kept.has(name) && isProposalAttachment(name)) out.add(name);
  }
  return [...out];
}

/**
 * The step: their rows found, the files only they name taken off the volume,
 * their alerts blanked, then their words taken. `submissionsRepo` is the
 * server's one repository over the table, handed in for the reason the
 * erasure header gives. `knownAs` is their own name and address
 * (`teamAlertsOf` says what it is for).
 *
 * `takeFile` is the erasure's own unlink (server/lib/erasure.ts, `unlink`),
 * bound to the uploads volume: ENOENT passes, and any other failure THROWS.
 * The files go FIRST, the rule the portraits step keeps, so a file that will
 * not come off stops the step with every row still naming it and a resume
 * finds it again; a death after an unlink and before the rows are written
 * resumes into ENOENT, which passes.
 */
export async function forgetSubmissionWords(
  pool: Pool,
  submissionsRepo: { all(): unknown[]; replaceAll(rows: unknown[]): Promise<unknown> },
  who: { userId: string; emailKey: string; knownAs?: readonly string[] },
  takeFile: (fileName: string) => void,
): Promise<{ rows: number; alerts: number; files: number }> {
  const rows = submissionsRepo.all() as any[];
  const theirs = rows.filter((s) => isTheirSubmission(s, who));
  if (!theirs.length) return { rows: 0, alerts: 0, files: 0 };
  const files = attachmentFilesOnlyTheyName(rows, theirs);
  for (const name of files) takeFile(name);
  const alerts = await forgetTeamAlerts(pool, theirs.flatMap((s) => teamAlertsOf(s, who.knownAs ?? [])));
  let changed = 0;
  for (const s of theirs) if (scrubSubmissionWords(s, { onTheirAccount: s.userId === who.userId })) changed += 1;
  if (changed) await submissionsRepo.replaceAll(rows);
  return { rows: changed, alerts, files: files.length };
}
