/**
 * A ROLE STARTS ONLY AFTER ITS AGREEMENTS (role journey L7, PR-E).
 *
 * A village may ask that an adopted role does not start until its holder has
 * aligned with:
 *
 *   confidentiality   the village's confidentiality agreement AS IT READS NOW
 *                     (server/lib/confidentiality.ts);
 *   membership        the membership letter in force on the account (aligned
 *                     there, or carried from the application at account
 *                     creation, server/lib/applicationMembership.ts), or a
 *                     membership the village already granted;
 *   terms             for a PAID role, the role's own terms with the agreed
 *                     rate (the application's `seat_terms` text).
 *
 * Each is its own switch (shared/gameVariables.ts, `org.start_after_*`), every
 * one OFF by default, and with all three off this file asks nothing: the gate
 * answers no steps and the seating path is exactly as it was.
 *
 * ── WHERE IT SITS: THE SEATING PATH ────────────────────────────────────────
 *
 * Every door that seats an adopted application goes through two functions in
 * server/lib/seatApplicationCloser.ts: `adoptApplication` (a holder's click, a
 * landed vote, and an open proposal's `placeOnRoles`, which in moon mode seats a
 * visitor at sign-up) and `seatFromApplication` (the hourly `season-plan-turn`).
 * Both ask this gate before they seat. A step left holds the application
 * `adopted` with nobody seated, exactly as an application for later waits, and
 * the hourly turn tries it again, so the role starts within the hour after the
 * last alignment. The confidentiality door also runs the turn at once.
 *
 * The holder hears "Two steps before your role starts" (or one, or three),
 * once per set of steps, with a link to where the first one is done.
 *
 * NO PAYMENT IS EVER A STEP. Nothing here reads dues, contributions or the
 * ledger.
 */
import type { PoolConnection } from "mysql2/promise";
import { carriesMoney, userParty } from "../../shared/alignments";
import { civilDateKey } from "../../shared/lunar";
import { MEMBERSHIP } from "../../shared/membershipLetter";
import type { ServedAgreement } from "../../shared/confidentiality";
import { alignmentsOf, textsForParty } from "../repos/alignments";
import type { StoredApplication } from "../repos/seatApplications";
import { viewTexts } from "./alignmentSubjects";
import { holdsCurrentAgreement } from "./confidentiality";

import { START_STEPS, type StartStep } from "../../shared/roleStartWords";
export { START_STEPS, type StartStep };

export interface RoleStartDials {
  confidentiality: boolean;
  membership: boolean;
  paidTerms: boolean;
}

export const NO_DIALS: RoleStartDials = { confidentiality: false, membership: false, paidTerms: false };

/** The three switches, read through whatever reads a boolean dial. */
export function roleStartDials(boolVar: (key: string) => boolean): RoleStartDials {
  return {
    confidentiality: boolVar("org.start_after_confidentiality"),
    membership: boolVar("org.start_after_membership"),
    paidTerms: boolVar("org.start_after_paid_terms"),
  };
}

export const anyDialOn = (d: RoleStartDials): boolean => d.confidentiality || d.membership || d.paidTerms;

export interface RoleStartDeps {
  dials: () => RoleStartDials;
  /** The village's agreement now, or null when it has written none. */
  agreement: () => ServedAgreement | null | Promise<ServedAgreement | null>;
  /** A membership the village already granted (a signing accepted before alignments existed). */
  membershipGranted: (userId: string) => Promise<boolean>;
}

/** What the gate answers for one application. Empty: nothing stands between the holder and the start. */
export type RoleStartGate = (conn: PoolConnection, app: StoredApplication, now: Date) => Promise<StartStep[]>;

/** Whether the candidate has aligned with the words their application's text carries. */
async function alignedWithTerms(conn: PoolConnection, app: StoredApplication): Promise<boolean> {
  if (!app.textId || !app.textHash) return false;
  const rows = await alignmentsOf(conn, [app.textId]);
  return rows.some((a) => a.partyKey === userParty(app.candidateUserId) && a.contentHash === app.textHash);
}

/** Whether the account holds a membership letter in force. The gate writes nothing: carrying happens at account creation. */
async function holdsMembership(conn: PoolConnection, deps: RoleStartDeps, userId: string, now: Date): Promise<boolean> {
  const mine = (await textsForParty(conn, userId)).filter((t) => t.subjectType === MEMBERSHIP);
  if (mine.length) {
    const views = await viewTexts(conn, mine, civilDateKey(now, "UTC"), "UTC", now);
    if (views.some((v) => v.derived.state === "in-force")) return true;
  }
  return deps.membershipGranted(userId);
}

export function makeRoleStartGate(deps: RoleStartDeps): RoleStartGate {
  return async (conn, app, now) => {
    const dials = deps.dials();
    if (!anyDialOn(dials)) return [];
    const steps: StartStep[] = [];
    if (dials.confidentiality && !(await holdsCurrentAgreement(conn, app.candidateUserId, await deps.agreement(), now))) steps.push("confidentiality");
    if (dials.membership && !(await holdsMembership(conn, deps, app.candidateUserId, now))) steps.push("membership");
    if (dials.paidTerms && carriesMoney(app.settings) && !(await alignedWithTerms(conn, app))) steps.push("terms");
    return steps;
  };
}

/*
 * THE GATE THE SEATING PATH ASKS. Installed once at boot by the
 * confidentiality routes (server/routes/confidentiality.ts), which hold the
 * village's content and its members; never installed, it asks nothing. The
 * season turn's sweep keeps a list the same way (`whenSeasonsSaved`).
 */
let installed: RoleStartGate | null = null;
let written: () => boolean = () => true;

export function installRoleStartGate(gate: RoleStartGate | null, agreementWritten: () => boolean = () => true): void {
  installed = gate;
  written = agreementWritten;
}

/** Whether the village has written the confidentiality agreement a waiting role asks for. */
export const agreementWritten = (): boolean => written();

export async function stepsBeforeStart(conn: PoolConnection, app: StoredApplication, now: Date): Promise<StartStep[]> {
  return installed ? installed(conn, app, now) : [];
}

// ── Telling the holder: the words live in shared/roleStartWords.ts, read by the profile too ──
export { START_WORDS, stepHref, stepsBody } from "../../shared/roleStartWords";
