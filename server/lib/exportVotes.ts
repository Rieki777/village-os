/**
 * ONE EXPORT OF THE VILLAGE'S DATABASE, AUTHORISED BY THE VILLAGE (Rye,
 * 2026-11-06: "A highest-tier vote authorises ONE export, delivered once to a
 * named steward and announced to all members; the password route stays too").
 *
 * The rules, in the order a request meets them:
 *
 *   ASKED     any member who may open a vote names one steward whose seat is
 *             live, and says why. One such vote per steward at a time (the
 *             subject ref is the steward's id).
 *   PRICED    at the constitutional floors and the village's own highest tier
 *             when it is higher, conducted `custom` so that unity is counted.
 *   CARRIED   the closer records ONE grant for that ballot, naming that
 *             steward, and tells them. It goes through the ordinary landing
 *             path, so the steward window applies as to any Game change.
 *   DELIVERED only to that steward, only while their seat is live, only once:
 *             the claim is an INSERT IGNORE on the ballot's key, made before
 *             the first byte (server/repos/exportGrants.ts). A download that
 *             fails before any byte leaves gives the claim back; one that
 *             fails after does not, because part of the data has left.
 *   ANNOUNCED every member is told when it goes, by the route that serves it
 *             (server/routes/exportVotes.ts).
 */
import type { Pool } from "mysql2/promise";
import {
  DATABASE_EXPORT,
  dialsForSubject,
  overrideDials as highestTierDials,
  thresholdSettingsFrom,
  thresholdsForSubject,
} from "../../shared/ballotSubjects";
import type { CloseRouting, SubjectCloser } from "./applyDue";
import { decisionLink } from "./ballotNotices";
import { openBallot, openBallotFor, type BallotRow } from "./ballots";
import type { BallotSetup } from "./ballotSetup";
import { STEWARD_ROLE_ID } from "./capabilityHolding";
import { holdingHasLapsed } from "./stewardship";
import { numberVar, stringVar } from "./variables";
import { holdingsForRoles } from "../repos/permissionHoldings";
import {
  claimExportDelivery,
  readExportDelivery,
  readExportGrant,
  recordExportGrant,
  releaseExportDelivery,
  type ExportDelivery,
} from "../repos/exportGrants";

export { DATABASE_EXPORT };

export interface ExportVoteDeps {
  pool: Pool;
  members: { byId(id: string): Promise<any | null> };
  notify(input: { userId: string; type: string; title: string; body: string; link?: string; actorUserId?: string | null; dedupeKey: string }): Promise<unknown>;
}

export type PutExportToVillage =
  | { ok: true; ballot: BallotRow; electorate: string[] }
  | { ok: false; status: number; body: Record<string, unknown> };

const firstNameOf = (m: any): string => String(m?.name ?? "").trim().split(/\s+/)[0] || "a member";
/** "Steward (Ada)": the role first, the holder in brackets (Rye, 2026-10-30). */
export const stewardLabel = (m: any): string => `Steward (${firstNameOf(m)})`;

/** Whether this member sits in a live steward seat right now. */
export async function isLiveSteward(pool: Pool, userId: string, now: Date = new Date()): Promise<boolean> {
  return (await holdingsForRoles(pool, [STEWARD_ROLE_ID])).some((h) => h.userId === userId && !holdingHasLapsed(h, now));
}

/** The dials this vote is asked at: the subject's, raised to the village's highest tier where that is higher. */
export function exportVoteDials(setup: BallotSetup): { method: string; unityPct: number; quorumPct: number } {
  const settings = thresholdSettingsFrom((key) => Number(numberVar(key)), (key) => stringVar(key));
  const method = thresholdsForSubject(DATABASE_EXPORT)?.method ?? setup.method;
  const subject = dialsForSubject(DATABASE_EXPORT, method as any, setup.dials, settings);
  const top = highestTierDials(settings);
  return { method, unityPct: Math.max(subject.unityPct, top.unityPct), quorumPct: Math.max(subject.quorumPct, top.quorumPct) };
}

export async function putExportToVillage(
  deps: ExportVoteDeps,
  input: { stewardUserId: string; openedBy: string; reason: string; setup: BallotSetup; at?: Date },
): Promise<PutExportToVillage> {
  const fail = (status: number, error: string, extra: Record<string, unknown> = {}): PutExportToVillage => ({ ok: false, status, body: { error, ...extra } });
  const { pool } = deps;
  const reason = String(input.reason ?? "").trim();
  if (reason.length < 10) return fail(400, "Say why the village needs a copy of its database, in a sentence the village will read.");
  if (reason.length > 2000) return fail(400, "Keep the reason under 2000 characters.");
  const steward = await deps.members.byId(input.stewardUserId);
  if (!steward || steward.isExample) return fail(404, "No such member.");
  if (!(await isLiveSteward(pool, String(steward.id)))) {
    return fail(409, "An export can only go to a member who holds the steward role now. Name a sitting steward.");
  }
  const running = await openBallotFor(pool, DATABASE_EXPORT, String(steward.id));
  if (running) return fail(409, "The village is already voting on an export to this steward.", { ballotId: running.id });

  const { setup } = input;
  const dials = exportVoteDials(setup);
  const label = stewardLabel(steward);
  const asker = await deps.members.byId(input.openedBy);
  const title = `One copy of the village's database, to ${label}: the village decides`;
  const doc = [
    `# ${title}`,
    "",
    "## What is asked",
    "",
    `${firstNameOf(asker)} asks the village to let ${label} download one copy of the whole village's database. It holds every member's data: names, addresses, messages, balances and votes.`,
    "",
    "## Why, in the words of the person who asked",
    "",
    reason,
    "",
    "## If this carries",
    "",
    `${label} may download it once, while they hold the steward role. Every member is told when it is downloaded. Nobody else can use this vote to get a copy, and a second download needs a second vote.`,
    "",
    "## If it does not carry",
    "",
    "Nothing leaves. The deployment's own export, behind its admin password, is unchanged either way.",
    "",
    `Put to the village on ${(input.at ?? new Date()).toISOString().slice(0, 10)}.`,
    "",
  ].join("\n");
  const opened = await openBallot(pool, {
    subjectType: DATABASE_EXPORT,
    subjectRef: String(steward.id),
    title,
    docMarkdown: doc,
    method: dials.method as any,
    weightMode: setup.snapshot.mode,
    weightToken: setup.snapshot.token,
    unityPct: dials.unityPct,
    quorumPct: dials.quorumPct,
    durationDays: setup.durationDays,
    openedBy: input.openedBy,
    electorate: setup.electorate,
  });
  if (!opened.ok) return fail(409, opened.error, { ballotId: opened.alreadyOpen?.id ?? null });
  return { ok: true, ballot: opened.ballot, electorate: setup.electorate.map((e) => e.userId) };
}

/**
 * WHAT CLOSING THE VOTE DOES, written into `SUBJECT_CLOSERS` by
 * server/routes/exportVotes.ts.
 *
 *   carried        `execute` records the one grant and tells the steward.
 *   not carried    nothing leaves; the opener is told.
 *   too few voted  the same.
 *
 * IDEMPOTENT: a second `execute` finds the grant already recorded.
 */
export function exportVoteCloser(deps: ExportVoteDeps): SubjectCloser {
  const tell = async (userId: string, b: BallotRow, title: string, body: string, key: string, actorId: string | null) => {
    try {
      await deps.notify({ userId, type: "governance", title, body, link: decisionLink(b), actorUserId: actorId, dedupeKey: `bal:${b.id}:${key}` });
    } catch (e) {
      console.error("[export vote] could not tell", userId, "how an export vote ended:", b.id, e);
    }
  };
  return {
    settle: async (b, outcome, _note, actorId) => {
      const out: CloseRouting = { applied: [], held: null, proposerTold: null };
      if (outcome === "passed") return out;
      out.proposerTold = b.openedBy;
      await tell(b.openedBy, b, `The village did not authorise this export: ${b.title}`, "Nothing leaves.", "export-not-carried", actorId);
      return out;
    },
    execute: async (b, actorId) => {
      const out: CloseRouting = { applied: [`${DATABASE_EXPORT}:${b.id}`], held: null, proposerTold: b.openedBy };
      const wrote = await recordExportGrant(deps.pool, { ballotId: b.id, stewardUserId: b.subjectRef, grantedAt: new Date().toISOString() });
      if (!wrote) return out;
      await tell(
        b.subjectRef,
        b,
        "The village has authorised one copy of its database, for you to download",
        "Download it from the decision page, once, while you hold the steward role. Every member is told when it goes.",
        "export-granted",
        actorId,
      );
      await tell(b.openedBy, b, `The village carried this: ${b.title}`, "The steward it names may now download one copy.", "export-carried", actorId);
      return out;
    },
  };
}

/** What a member sees about the export a decision authorised. */
export interface ExportStanding {
  granted: boolean;
  forYou: boolean;
  delivered: ExportDelivery | null;
  stewardLive: boolean;
}

export async function exportStanding(pool: Pool, ballotId: string, userId: string): Promise<ExportStanding> {
  const grant = await readExportGrant(pool, ballotId);
  if (!grant) return { granted: false, forYou: false, delivered: null, stewardLive: false };
  return {
    granted: true,
    forYou: grant.stewardUserId === userId,
    delivered: await readExportDelivery(pool, ballotId),
    stewardLive: await isLiveSteward(pool, grant.stewardUserId),
  };
}

/** Claim the one delivery for this member, or say why not. The caller streams only on ok. */
export async function claimVotedExport(
  pool: Pool,
  ballotId: string,
  userId: string,
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const grant = await readExportGrant(pool, ballotId);
  if (!grant) return { ok: false, status: 404, error: "The village has not authorised an export on this decision." };
  if (grant.stewardUserId !== userId) return { ok: false, status: 403, error: "This export is for the steward the village named, and only them." };
  if (!(await isLiveSteward(pool, userId))) {
    return { ok: false, status: 403, error: "You do not hold the steward role now, so this export cannot be delivered. It stays unused." };
  }
  if (!(await claimExportDelivery(pool, ballotId, { at: new Date().toISOString(), byUserId: userId }))) {
    return { ok: false, status: 410, error: "This export was already delivered, once, as the vote allowed. Another copy needs another vote." };
  }
  return { ok: true };
}

/** Give a claim back, for a download that failed before a single byte left. */
export async function releaseVotedExport(pool: Pool, ballotId: string): Promise<void> {
  await releaseExportDelivery(pool, ballotId);
}
