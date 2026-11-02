/**
 * ROLE PROPOSALS: THE CIRCLE, THE ADOPTION AND THE NUDGES (role proposals PR B).
 *
 * The contract and every sentence is shared/roleProposalConsent.ts (and, for
 * the draft itself, shared/roleProposals.ts); the statements are
 * server/repos/roleProposals.ts. The doors are server/routes/roleProposals.ts
 * and, for adoption, the member door's own adopt route
 * (server/routes/seatApplications.ts), so a proposal is adopted through the
 * one door every application uses.
 *
 *   circleAsksFor         who the circle asks: every live holder of a role in
 *                         the circles the proposed roles sit in, the candidate
 *                         excluded, each asked once
 *   consentView           where a proposal's consent stands, for one reader
 *   answerConsent         a holder consents or objects; an objection writes a
 *                         tension into the circle's backlog
 *   applyProposalChanges  the role changes a proposal carries, applied as ONE
 *                         org draft (create_seat, update_seat), published,
 *                         and read back so a word the draft path cannot write
 *                         refuses the adoption instead of vanishing
 *   runProposalNudges     the sweep: window open, review due, window closing
 *
 * ── THE BACKLOG PATH #538 USES ─────────────────────────────────────────────
 *
 * An objection reaches the circle's next meeting the way a tension brought to
 * the circle does (server/lib/roleTensions.ts): one `tension` entry, open,
 * written into the circle's last session (`lastTimeInCircle`), which its next
 * session offers as "From last time". The entry names the roles and the
 * reason, never the candidate and never the member who objected. A circle that
 * has not met, or a village with Live Sessions off, has no backlog to carry it:
 * the objection is recorded all the same, still blocks the circle's path, and
 * the answer says where it waits.
 *
 * No `recordEvent` and no `addActivity`: the rows are the record.
 */
import type { Pool, PoolConnection } from "mysql2/promise";
import {
  CONSENT_WORDS,
  consentState,
  consentStateWords,
  decisionWords,
  dueNudges,
  NUDGE_WORDS,
  objectionTension,
  parseConsentAnswer,
  PROPOSE_ENTRY_HREF,
  type ConsentState,
  type DueNudge,
  type NudgeReason,
} from "../../shared/roleProposalConsent";
import { changesRoles, wordFieldsOf, type ProposalBody, type WordFieldsContext } from "../../shared/roleProposals";
import { applicationHref, seatList } from "../../shared/seatApplications";
import type { WaitingConsent } from "../../shared/waitingOnYou";
import { civilDateKey } from "../../shared/lunar";
import { parseSeatSettings } from "../../shared/seatSettings";
import { planTargetAt, type PlanSeason } from "../../shared/seasonPlans";
import type { CycleClock } from "../../shared/cycleClock";
import type { SeatCalendar } from "../../shared/seatTerms";
import { addChange, createDraft, publishDraft, revertDraft, withdrawDraft } from "./orgDrafts";
import { listOrgAssignments, listOrgRoles, ROLE_COLS, rowToRole, type LapseContext, type OrgRole } from "./orgChart";
import { ensureMemberNo } from "./liveSessions";
import type { NotifyInput } from "./notify";
import { inTransaction, insertEntry, lastTimeInCircle } from "../repos/liveSessions";
import * as store from "../repos/roleProposals";
import { readApplications, seatsWithCircles } from "../repos/seatApplications";

/**
 * THE WORD FIELDS OF THIS PLATFORM'S ROLES, read off the role reader itself.
 * `rowToRole` names every field a role carries, so a field a later release
 * adds there is a word a proposal can change with no edit in this file.
 *
 * WHICH ONES ARE LISTS, FOUND THE SAME WAY. Every column the reader selects
 * (`ROLE_COLS`) is handed the same one-item JSON list: a field read through a
 * list reader comes back as a list, and a text field comes back as text. So a
 * list field a later release adds is a list here too, with no list of names
 * to keep in step.
 */
const PROBE_ROW = Object.fromEntries(ROLE_COLS.split(",").map((c) => [c.trim(), '["x"]']));
export const ROLE_WORD_FIELDS: WordFieldsContext = wordFieldsOf(rowToRole(PROBE_ROW) as unknown as Record<string, unknown>);

// ── Who the circle asks ─────────────────────────────────────────────────────

/** The circles a proposal's roles sit in, in the order the proposal names them. */
export function circlesOf(body: ProposalBody, roleCircle: (roleId: string) => string | null): string[] {
  const out: string[] = [];
  for (const id of [...body.roles.map((r) => roleCircle(r.roleId)), ...body.newRoles.map((r) => r.circleId)]) {
    if (id && !out.includes(id)) out.push(id);
  }
  return out;
}

/**
 * Every live holder of a role in the proposal's circles, the candidate
 * excluded, once each, with the first of the proposal's circles they hold in.
 */
export async function circleAsksFor(db: Pool | PoolConnection, body: ProposalBody, candidateId: string, roleCircle: (roleId: string) => string | null): Promise<Array<{ userId: string; circleId: string }>> {
  const circles = circlesOf(body, roleCircle);
  const holders = await store.holdersInCircles(db, circles);
  const out: Array<{ userId: string; circleId: string }> = [];
  for (const circleId of circles) {
    for (const h of holders) {
      if (h.circleId !== circleId || h.userId === candidateId || out.some((o) => o.userId === h.userId)) continue;
      out.push({ userId: h.userId, circleId });
    }
  }
  return out;
}

// ── Where consent stands ────────────────────────────────────────────────────

export interface ConsentView {
  state: ConsentState;
  words: string;
  /** The window's last instant, and its last day in the village's zone. Null when nobody was asked. */
  closesAt: string | null;
  closesOn: string | null;
  asked: number;
  consented: number;
  objected: number;
  /** The reasons given, naming nobody. They are in the circle's backlog for every member already. */
  objections: string[];
  /**
   * The titles of the roles the asked holders hold in the circle they were
   * asked for, each once (role proposals PR D), so the tally says who in
   * roles and never in names. A holder who has since left a role is counted
   * and carries no title.
   *
   * WHO OBJECTED IS NEVER SAID OUTSIDE THE CIRCLE (part B's rule): `objected`
   * carries titles only for a reader the circle asked, and only the titles of
   * objections from the circle that reader was asked for. The candidate, a
   * holder of the power and every other member read the count alone.
   */
  roles: { asked: string[]; consented: string[]; objected: string[] };
  /** "Record the adoption", once the circle has consented. */
  record: string | null;
  /** The reader's own ask, when they were asked. */
  you: { asked: boolean; answer: string | null; mayAnswer: boolean };
}

/** The titles of the roles each asked holder holds in the circle they were asked for. */
export type AskRoles = (userId: string, circleId: string) => readonly string[];
const NO_ROLES: AskRoles = () => [];

/** Each asked holder's roles in their circle, by title, read live. One read however many asks. */
export async function askRolesFor(db: Pool | PoolConnection, asks: readonly store.StoredAsk[]): Promise<AskRoles> {
  const circles = Array.from(new Set(asks.map((a) => a.circleId)));
  if (!circles.length) return NO_ROLES;
  const held = new Map<string, string[]>();
  for (const h of await store.holdersInCircles(db, circles)) {
    const key = `${h.userId}\u0000${h.circleId}`;
    const titles = held.get(key) ?? [];
    if (h.roleName && !titles.includes(h.roleName)) titles.push(h.roleName);
    held.set(key, titles);
  }
  return (userId, circleId) => held.get(`${userId}\u0000${circleId}`) ?? [];
}

/** The role titles a set of asks holds, each once, in the order the asks were made. PURE. */
function titlesOf(asks: readonly store.StoredAsk[], rolesOf: AskRoles): string[] {
  const out: string[] = [];
  for (const a of asks) for (const t of rolesOf(a.userId, a.circleId)) if (!out.includes(t)) out.push(t);
  return out;
}

/** Where a proposal's consent stands, for one reader. PURE over the asks and the role titles it is handed. */
export function consentView(asks: readonly store.StoredAsk[], now: Date, timeZone: string, viewerId: string | null, rolesOf: AskRoles = NO_ROLES): ConsentView {
  const state = consentState(asks, now);
  const closes = asks.length ? new Date(Math.max(...asks.map((a) => a.closesAt.getTime()))) : null;
  // The last day inside the window: the instant before it closes.
  const closesOn = closes ? civilDateKey(new Date(closes.getTime() - 1), timeZone || "UTC") : null;
  const mine = viewerId ? asks.find((a) => a.userId === viewerId) ?? null : null;
  return {
    state,
    words: consentStateWords(state, closesOn),
    closesAt: closes ? closes.toISOString() : null,
    closesOn,
    asked: asks.length,
    consented: asks.filter((a) => a.answer === "consent").length,
    objected: asks.filter((a) => a.answer === "object").length,
    objections: asks.filter((a) => a.answer === "object" && a.reason).map((a) => a.reason as string),
    roles: {
      asked: titlesOf(asks, rolesOf),
      consented: titlesOf(asks.filter((a) => a.answer === "consent"), rolesOf),
      // Titles for a reader asked in that circle, and a count alone for everybody else.
      objected: mine ? titlesOf(asks.filter((a) => a.answer === "object" && a.circleId === mine.circleId), rolesOf) : [],
    },
    record: state === "consented" ? CONSENT_WORDS.record : null,
    you: { asked: !!mine, answer: mine?.answer ?? null, mayAnswer: !!mine && !mine.answer && state === "open" },
  };
}

/**
 * WAITING ON YOU: the proposals the reader's circle is asked about, still
 * inside the window, that they have not answered, oldest first. A fixed number
 * of reads however many rows: the asks, their proposals, the applications,
 * the roles, the circles, the members.
 */
export async function consentAsksWaitingOn(
  deps: { pool: Pool; allMembers(): Promise<Array<{ id: string; name?: string | null }>>; firstName(name: string): string; timezone: string; now: Date },
  viewerId: string,
): Promise<WaitingConsent[]> {
  const open = (await store.openAsksOf(deps.pool, viewerId)).filter((a) => a.closesAt.getTime() > deps.now.getTime());
  if (!open.length) return [];
  const proposals = new Map((await store.proposalsByIds(deps.pool, open.map((a) => a.proposalId))).map((p) => [p.id, p]));
  const appIds = Array.from(new Set(Array.from(proposals.values()).map((p) => p.applicationId).filter((x): x is string => !!x)));
  const apps = new Map((await readApplications(deps.pool, appIds)).map((a) => [a.id, a]));
  const roleIds = Array.from(new Set(Array.from(apps.values()).flatMap((a) => a.seatIds)));
  const [roles, circles, people] = await Promise.all([
    seatsWithCircles(deps.pool, roleIds),
    store.villageCircles(deps.pool),
    deps.allMembers(),
  ]);
  const roleName = new Map(roles.map((r) => [r.id, r.name]));
  const circleName = new Map(circles.map((c) => [c.id, c.name]));
  const personName = new Map(people.map((m) => [String(m.id), String(m.name ?? "")]));
  const out: WaitingConsent[] = [];
  for (const ask of open) {
    const p = proposals.get(ask.proposalId);
    const a = p?.applicationId ? apps.get(p.applicationId) : undefined;
    // Only a proposal still waiting on a decision asks anybody anything.
    if (!p || !a || a.status !== "awaiting-holder") continue;
    const proposed = new Map(p.body.newRoles.map((r) => [r.id, typeof r.words.name === "string" ? r.words.name : r.id]));
    out.push({
      proposalId: p.id,
      applicationId: a.id,
      href: applicationHref(a.id),
      roles: a.seatIds.map((id) => roleName.get(id) ?? proposed.get(id) ?? id),
      circle: circleName.get(ask.circleId) ?? "",
      applicant: deps.firstName(personName.get(p.userId) ?? ""),
      closesOn: civilDateKey(new Date(ask.closesAt.getTime() - 1), deps.timezone || "UTC"),
    });
  }
  return out;
}

// ── An answer ───────────────────────────────────────────────────────────────

export interface AnswerDeps {
  pool: Pool;
  notify(input: NotifyInput): Promise<unknown>;
  timeZone: string;
  /** Whether Live Sessions is on, so a circle backlog has a reader. */
  sessionsOn: boolean;
  now: Date;
}

export type AnswerOutcome =
  | { ok: true; answer: "consent" | "object"; carried: boolean; carriedWords: string | null }
  | { ok: false; status: number; error: string; field?: string };

/**
 * A holder the circle asked consents or objects, once, inside the window,
 * while the application still waits on a decision (withdrawn or decided, the
 * answers are closed: 409 with the sentence). An objection's tension entry
 * and the answer are one transaction, so a backlog never carries an objection
 * the ask does not record.
 */
export async function answerConsent(
  deps: AnswerDeps,
  p: store.StoredProposal,
  userId: string,
  roleNames: readonly string[],
  body: unknown,
): Promise<AnswerOutcome> {
  // Answers close with the application (PR D): a withdrawn or decided proposal takes no answer,
  // so nothing reaches the circle's backlog for a proposal nobody is deciding any more.
  const [a] = p.applicationId ? await readApplications(deps.pool, [p.applicationId]) : [];
  const standing: AskStanding = !a || a.status === "withdrawn" ? "withdrawn" : a.status !== "awaiting-holder" ? "decided" : "open";
  const out = await answerAsk(deps, p.id, standing, userId, roleNames, body);
  if (out.ok && out.answer === "object") {
    // The candidate hears that their proposal goes to the circle. Who objected is never said.
    await deps.notify({
      userId: p.userId,
      type: "role_proposal_objection",
      title: `A member of the circle objected to your role proposal: ${seatList(roleNames)}`,
      body: out.carried ? "It goes to the circle's next meeting." : null,
      link: p.applicationId ? `/role-applications/${encodeURIComponent(p.applicationId)}` : null,
      actorUserId: null,
      dedupeKey: `rp:${p.id}:objection:${userId}`,
    });
  }
  return out;
}

/** Whether the proposal an ask is about still waits on a decision, and why not when it does not. */
export type AskStanding = "open" | "withdrawn" | "decided";

/**
 * THE ANSWER ITSELF, for any proposal the circle was asked about: a member's
 * (`answerConsent` above) or one from somebody with no account yet (open
 * proposals part B, server/lib/openProposalDecide.ts). The caller says whether
 * the proposal still waits on a decision; everything else is the ask's own.
 * Tells nobody: the caller decides who hears.
 */
export async function answerAsk(
  deps: AnswerDeps,
  proposalId: string,
  standing: AskStanding,
  userId: string,
  roleNames: readonly string[],
  body: unknown,
): Promise<AnswerOutcome> {
  const parsed = parseConsentAnswer(body);
  const ask = await store.readAsk(deps.pool, proposalId, userId);
  if (!ask) return { ok: false, status: 404, error: CONSENT_WORDS.notAsked };
  if (standing === "withdrawn") return { ok: false, status: 409, error: CONSENT_WORDS.withdrawn };
  if (standing === "decided") return { ok: false, status: 409, error: CONSENT_WORDS.decided };
  if (!parsed.ok) return { ok: false, status: 400, error: parsed.error, field: parsed.field };
  if (ask.answer) return { ok: false, status: 409, error: CONSENT_WORDS.answered };
  if (deps.now.getTime() >= ask.closesAt.getTime()) return { ok: false, status: 409, error: CONSENT_WORDS.windowClosed };

  const objecting = parsed.answer === "object";
  const authorNo = objecting && deps.sessionsOn ? await ensureMemberNo(deps.pool, userId, deps.now) : 0;
  const out = await inTransaction(deps.pool, async (conn): Promise<{ written: boolean; entryId: number | null }> => {
    let entryId: number | null = null;
    if (objecting && deps.sessionsOn && parsed.reason) {
      const [last] = await lastTimeInCircle(conn, ask.circleId, 0);
      if (last) {
        entryId = await insertEntry(conn, {
          sessionId: Number(last.id),
          itemId: null,
          kind: "tension",
          text: objectionTension(roleNames, parsed.reason),
          authorNo,
          ownerSeatId: null,
          dueOn: null,
          now: deps.now,
        });
      }
    }
    const written = await store.writeAnswer(conn, { proposalId, userId, answer: parsed.answer, reason: parsed.reason, circleEntryId: entryId, now: deps.now });
    // Answered a moment ago by another tab: the entry this transaction wrote goes back with it.
    if (!written) throw Object.assign(new Error("answered already"), { code: "RP_ANSWERED" });
    return { written, entryId };
  }).catch((e) => {
    if (e?.code === "RP_ANSWERED") return null;
    throw e;
  });
  if (!out) return { ok: false, status: 409, error: CONSENT_WORDS.answered };
  return {
    ok: true,
    answer: parsed.answer,
    carried: !!out.entryId,
    carriedWords: objecting && !out.entryId ? (deps.sessionsOn ? CONSENT_WORDS.notCarried : CONSENT_WORDS.sessionsOff) : null,
  };
}

// ── Applying a proposal's role changes ──────────────────────────────────────

const normal = (v: unknown, list: boolean): string => {
  if (v === null || v === undefined) return list ? "[]" : "null";
  if (Array.isArray(v)) return JSON.stringify(v.map((x) => String(x).trim()).filter(Boolean));
  return JSON.stringify(String(v).trim());
};

/**
 * Every proposed word that is not on the role as it now reads, as
 * "Role: field". Empty when the publish wrote all of them.
 */
export function wordsNotWritten(body: ProposalBody, roles: ReadonlyMap<string, OrgRole>, ctx: WordFieldsContext = ROLE_WORD_FIELDS): string[] {
  const out: string[] = [];
  const check = (roleId: string, words: Record<string, unknown>, label: string) => {
    const role = roles.get(roleId) as unknown as Record<string, unknown> | undefined;
    for (const [field, value] of Object.entries(words)) {
      const list = ctx.lists.has(field);
      if (!role || normal(role[field], list) !== normal(value, list)) out.push(`${label}: ${field}`);
    }
  };
  for (const r of body.roles) check(r.roleId, r.words, roles.get(r.roleId)?.name ?? r.roleId);
  for (const r of body.newRoles) check(r.id, r.words, typeof r.words.name === "string" ? r.words.name : r.id);
  return out;
}

/** A list field the proposal clears goes to the draft as an empty list, which is how the draft path clears one. */
function payloadOf(words: Record<string, unknown>, ctx: WordFieldsContext): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(words)) out[k] = v === null && ctx.lists.has(k) ? [] : v;
  return out;
}

export type ApplyOutcome = { ok: true; draftId: string | null } | { ok: false; error: string };

/**
 * THE ROLE CHANGES, AS ONE ORG DRAFT, PUBLISHED. A proposal that changes no
 * role writes nothing. Otherwise every new role is a `create_seat` under the
 * id the draft gave it, and every changed role an `update_seat` naming only
 * the changed fields; the draft is published by the adopting holder, through
 * `publishDraft`'s own preview and refusals; and the roles are read back. A
 * word the publish did not write (a field roles carry that no draft writes
 * yet) reverts the publish and refuses, so adoption never reports words it
 * never wrote.
 */
export async function applyProposalChanges(pool: Pool, p: store.StoredProposal, actorId: string, calendar: SeatCalendar, roleNames: readonly string[]): Promise<ApplyOutcome> {
  const body = p.body;
  if (!changesRoles(body)) return { ok: true, draftId: null };
  const made = await createDraft(pool, {
    title: `Role proposal: ${seatList(roleNames)}`.slice(0, 200),
    rationale: "Adopted from a member's role proposal for next season.",
    createdBy: actorId,
    sourceKind: "human",
    openCap: null,
  });
  if (!made.ok) return { ok: false, error: made.error };
  const add = async (op: "create_seat" | "update_seat", orgRoleId: string, payload: Record<string, unknown>) => addChange(pool, made.id, { op, orgRoleId, payload });
  for (const r of body.newRoles) {
    const added = await add("create_seat", r.id, { ...payloadOf(r.words, ROLE_WORD_FIELDS), circleId: r.circleId, seats: r.seats });
    if (!added.ok) {
      await withdrawDraft(pool, made.id);
      return { ok: false, error: added.error };
    }
  }
  for (const r of body.roles) {
    if (!Object.keys(r.words).length) continue;
    const added = await add("update_seat", r.roleId, payloadOf(r.words, ROLE_WORD_FIELDS));
    if (!added.ok) {
      await withdrawDraft(pool, made.id);
      return { ok: false, error: added.error };
    }
  }
  const published = await publishDraft(pool, made.id, actorId, null, calendar);
  if (!published.ok) {
    await withdrawDraft(pool, made.id);
    return { ok: false, error: `The role changes could not be made, so nothing was adopted. ${published.error}` };
  }
  const roles = new Map((await listOrgRoles(pool)).map((r) => [r.id, r]));
  const missing = wordsNotWritten(body, roles);
  if (missing.length) {
    await revertDraft(pool, made.id);
    return { ok: false, error: `These words could not be written, so nothing was adopted: ${missing.join(", ")}.` };
  }
  return { ok: true, draftId: made.id };
}

/** The decision record, from where consent stood when the holder clicked. */
export function decisionFor(state: ConsentState, at: Date, timeZone: string, roleName: string | null): string {
  return decisionWords(state === "consented" ? "circle" : "power", at, timeZone, roleName);
}

// ── The nudges ──────────────────────────────────────────────────────────────

/**
 * The notification kind each nudge is sent as. Declared beside the one call
 * that sends them, so the notification catalogue's scan
 * (shared/notificationKinds.test.ts) reads every kind with its producer.
 */
const NUDGE_KINDS: Record<NudgeReason, string> = {
  "window-closing": "role_proposal_window_closing",
  "review-due": "role_proposal_review_due",
  "window-open": "role_proposal_window_open",
};

export const NUDGE_JOB = "role-proposal-nudges";
/** Four times a day, so a 2 business day mark is met within six hours. */
export const NUDGE_EVERY_MS = 6 * 60 * 60 * 1000;

export interface NudgeDeps {
  pool: Pool;
  now: Date;
  timeZone: string;
  clock: CycleClock;
  seasons: readonly PlanSeason[];
  lapse: LapseContext;
  members: ReadonlyArray<Record<string, any>>;
  isPresent(member: any): boolean;
  notify(input: NotifyInput): Promise<{ fresh?: boolean } | unknown>;
}

/** What the sweep and the banner both read, once for every member. */
async function nudgeFacts(deps: Pick<NudgeDeps, "pool" | "now" | "timeZone" | "clock" | "seasons" | "lapse">) {
  const target = planTargetAt(deps.seasons, deps.clock, deps.timeZone, deps.now);
  const [proposals, live] = await Promise.all([store.proposalSeasons(deps.pool), listOrgAssignments(deps.pool, { ...deps.lapse, now: deps.now })]);
  const seated = live.filter((a) => a.holderKind === "member" && a.userId && !a.isExample);
  const appIds = Array.from(new Set(seated.map((a) => a.applicationId).filter((x): x is string => !!x)));
  const apps = new Map((appIds.length ? await readApplications(deps.pool, appIds) : []).map((a) => [a.id, a]));
  const fromProposal = new Map(proposals.filter((p) => p.applicationId).map((p) => [p.applicationId as string, p.body]));
  /** A live role's review day: the adopted proposal's for that role, else the terms it was seated on. */
  const reviewOf = (applicationId: string | undefined, roleId: string): string | null => {
    if (!applicationId) return null;
    const body = fromProposal.get(applicationId);
    const own = body?.roles.find((r) => r.roleId === roleId)?.reviewOn ?? body?.newRoles.find((r) => r.id === roleId)?.reviewOn;
    if (own) return own;
    const app = apps.get(applicationId);
    const parsed = app ? parseSeatSettings(app.settings) : null;
    const day = parsed && parsed.ok ? parsed.settings?.term?.reviewOn : null;
    return typeof day === "string" ? day : null;
  };
  return {
    window: target ? { seasonId: target.season.id, opensAt: target.window.opensAt, closesAt: target.window.closesAt } : null,
    proposalsOf: (userId: string) => proposals.filter((p) => p.userId === userId).map((p) => ({ status: p.status, targetSeasonId: p.targetSeasonId })),
    reviewDaysOf: (userId: string) =>
      seated
        .filter((a) => a.userId === userId)
        .map((a) => ({ roleId: a.orgRoleId, reviewOn: reviewOf(a.applicationId, a.orgRoleId) }))
        .filter((r): r is { roleId: string; reviewOn: string } => !!r.reviewOn),
  };
}

/** The nudges due for one member now, most pressing first. */
export async function nudgesFor(deps: Pick<NudgeDeps, "pool" | "now" | "timeZone" | "clock" | "seasons" | "lapse">, userId: string): Promise<DueNudge[]> {
  const facts = await nudgeFacts(deps);
  return dueNudges({ now: deps.now, timeZone: deps.timeZone, window: facts.window, proposals: facts.proposalsOf(userId), reviewDays: facts.reviewDaysOf(userId) });
}

/** `notifications.dedupe_key` is varchar(191): one stable key per trigger and member. */
export function nudgeKey(n: DueNudge, userId: string): string {
  return `rp-nudge:${n.reason}:${n.trigger}:${userId}`.slice(0, 191);
}

/**
 * THE SWEEP. Every present member, every nudge due, each sent once: the key
 * names the reason, the trigger and the member, so a sweep run as often as it
 * likes writes one row per trigger (server/lib/notify.ts). One member's
 * failure never stops the rest hearing.
 */
export async function runProposalNudges(deps: NudgeDeps): Promise<{ sent: number }> {
  const facts = await nudgeFacts(deps);
  let sent = 0;
  for (const m of deps.members) {
    if (!deps.isPresent(m)) continue;
    const userId = String(m.id);
    const due = dueNudges({ now: deps.now, timeZone: deps.timeZone, window: facts.window, proposals: facts.proposalsOf(userId), reviewDays: facts.reviewDaysOf(userId) });
    for (const n of due) {
      try {
        const r = (await deps.notify({
          userId,
          type: NUDGE_KINDS[n.reason],
          title: NUDGE_WORDS.heading,
          body: NUDGE_WORDS.body[n.reason],
          link: PROPOSE_ENTRY_HREF,
          actorUserId: null,
          dedupeKey: nudgeKey(n, userId),
        })) as { fresh?: boolean } | undefined;
        if (r?.fresh !== false) sent += 1;
      } catch (e) {
        console.error(`[role-proposals] nudging ${userId} failed (the rest continue)`, e);
      }
    }
  }
  return { sent };
}
