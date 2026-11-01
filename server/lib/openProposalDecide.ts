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
import type { Pool, PoolConnection } from "mysql2/promise";
import { isVillageHeld, type Capability } from "../../shared/capabilities";
import { civilDateKey } from "../../shared/lunar";
import { greetingName, OPEN_NOTICE_WORDS, openProposalHref, proposalOfInvite } from "../../shared/openProposalDecide";
import { whoMayPutHandToVillage, type HandOpenerRule } from "../../shared/powerHands";
import { CONSENT_WORDS, consentClosesAt } from "../../shared/roleProposalConsent";
import { ADOPTING_POWER, parseApplicationInput } from "../../shared/seatApplications";
import { civilDateInstant, type SeatCalendar } from "../../shared/seatTerms";
import { emailKeyOf } from "../../shared/comms/address";
import type { WaitingOpenProposal } from "../../shared/waitingOnYou";
import type { AppDeps } from "./appDeps";
import { settleText } from "./alignmentSubjects";
import { villageHeldCapabilities } from "./capabilityHolding";
import { isExampleUser } from "./examples";
import type { InvitedArrival } from "./inviteDoor";
import type { NotifyInput } from "./notify";
import { isTombstone } from "./oauthAccounts";
import { listOrgRoles, type LapseContext } from "./orgChart";
import { adoptApplication, settleDepsOf, tellOutcome } from "./seatApplicationCloser";
import { prepareApplication, writeApplicationOn } from "./seatApplicationWrite";
import { grantStage } from "./stageGrant";
import { inTransaction } from "../repos/liveSessions";
import * as store from "../repos/openProposals";
import { asksFor, holdersInCircles, insertAsks } from "../repos/roleProposals";
import { inApplicationTransaction, seatsForUpdate, seatsWithCircles } from "../repos/seatApplications";

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
}

/**
 * THE ADDRESS CONFIRMS, AND THE CIRCLE IS ASKED, in one transaction, so a
 * proposal is never confirmed half asked. Asked: every live holder of a role in
 * the circles the proposed roles sit in, in the order the proposal names them,
 * once each, the proposer's own account excluded. Their 2 business days run
 * from now. Null when the token confirms nothing: used, run out, or unknown.
 */
export async function confirmAndAsk(
  deps: Pick<DecideDeps, "getPool" | "members" | "calendar">,
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
    await insertAsks(conn, asked.map((a) => ({ proposalId: proposal.id, userId: a.userId, circleId: a.circleId, askedAt: at, closesAt })));
    return { proposal, asked, closesAt, own };
  });
}

/**
 * Each asked holder hears once, by the roles' names, in the bell and under
 * Tasks; each live holder of the power that seats people who was not asked
 * hears it waits on them. The proposer's own account hears nothing. Keys are
 * per proposal and person, so a retry writes nothing twice.
 */
export async function tellTheCircle(deps: Pick<DecideDeps, "getPool" | "notify" | "liveHoldersOf" | "calendar">, c: Confirmed): Promise<void> {
  const pool = deps.getPool();
  const names = await roleNames(pool, c.proposal);
  const link = openProposalHref(c.proposal.id);
  const closesOn = civilDateKey(new Date(c.closesAt.getTime() - 1), deps.calendar().timezone || "UTC");
  for (const a of c.asked) {
    await deps.notify({
      userId: a.userId,
      type: "open_role_proposal_consent_ask",
      title: CONSENT_WORDS.askTitle(names),
      body: CONSENT_WORDS.askBody(closesOn),
      link,
      actorUserId: null,
      dedupeKey: `op:${c.proposal.id}:ask:${a.userId}`,
    });
  }
  const rule = await decideRule(deps);
  const deciders = rule.who === "live-holders" ? rule.holders : [];
  for (const userId of deciders) {
    if (userId === c.own || c.asked.some((a) => a.userId === userId)) continue;
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
export async function placeOnRoles(
  deps: DecideDeps,
  p: { account: string; proposal: store.StoredOpenProposal; adopterId: string; authority: string },
): Promise<Placed> {
  const pool = deps.getPool();
  const calendar = deps.calendar();
  const tz = calendar.timezone || "UTC";
  const now = deps.now();
  const season = calendar.seasons.find((s) => s.id === p.proposal.targetSeasonId);
  const startsAt = season ? civilDateInstant(season.startsOn, tz) : null;
  if (!season || !startsAt) return { ok: false, code: "cannot", error: "The season this proposal was for is no longer on the village's calendar, so nothing was changed." };
  const seatIds = p.proposal.body.roles.map((r) => r.roleId);
  const parsed = parseApplicationInput({ seatIds, note: p.proposal.body.why || null, deliverables: p.proposal.body.aim || null });
  if (!parsed.ok) return { ok: false, code: "cannot", error: parsed.error };
  const seats = await seatsForUpdate(pool, seatIds);
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
  const { outcome, app, textId } = await adoptApplication(
    pool,
    id,
    ["awaiting-holder"],
    { via: "holder", ref: p.adopterId, authority: p.authority.slice(0, 64) },
    { now, lapse: { ...deps.lapse(), now }, calendar },
  );
  if (app) await tellOutcome(deps, app, outcome, "open", p.adopterId);
  if (textId) await settleText(settleDepsOf(deps, deps.now), textId);
  await grantStage(deps, p.account, "member", "a role proposal was adopted", { raiseOnly: true });
  return { ok: true, applicationId: id, outcome: outcome.kind };
}

/**
 * WHAT A SIGN-UP THROUGH AN ADOPTED PROPOSAL'S INVITATION DOES, run by the
 * welcome step both sign-up doors share (`whenInvitedArrives`,
 * server/lib/inviteDoor.ts). The invitation's maker is the holder who adopted
 * it, and the authority is the one the adoption recorded. A place that cannot
 * be made never costs the person their account: the admins are told, once,
 * with the proposal's page.
 */
export function arrivalFor(deps: DecideDeps): InvitedArrival {
  return async ({ inviteId, inviterUserId, userId }) => {
    const id = proposalOfInvite(inviteId);
    if (!id) return;
    const proposal = await store.readOpenProposal(deps.getPool(), id);
    if (!proposal || proposal.status !== "adopted") return;
    let failed = false;
    try {
      const out = await placeOnRoles(deps, {
        account: userId,
        proposal,
        adopterId: inviterUserId,
        authority: proposal.decision.authority ?? `${ADOPTING_POWER}@badge`,
      });
      failed = !out.ok && out.code === "cannot";
    } catch (err) {
      failed = true;
      console.warn(`[open-proposals] the place for ${userId} was not made: ${String((err as Error)?.message ?? err)}`);
    }
    if (failed) {
      await deps.notifyAdmins("governance", OPEN_NOTICE_WORDS.arrivalFailedTitle(await roleNames(deps.getPool(), proposal)), `op:${id}:arrival-failed`, openProposalHref(id));
    }
  };
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
