/**
 * OPEN ROLE PROPOSALS, THE DECISION (part B): the members-only page's doors.
 * Registered by part A's module (server/routes/openProposals.ts), so
 * server/index.ts keeps one line for the whole feature. The words are
 * shared/openProposalDecide.ts and the work is server/lib/openProposalDecide.ts.
 *
 *   GET  /api/governance/open-proposals/:id              one confirmed proposal, with what the reader may do
 *   POST /api/governance/open-proposals/:id/consent      an asked holder consents or objects
 *   POST /api/governance/open-proposals/:id/adopt        a live holder of org.seat adopts it for the village
 *   POST /api/governance/open-proposals/:id/decline      the same holder declines it, kindly
 *   POST /api/governance/open-proposals/:id/invitation   a new invitation for an adopted one nobody used
 *   POST /api/governance/open-proposals/:id/invite       our review: invite to the conversations (Phase A)
 *   POST /api/governance/open-proposals/:id/not-invited  our review: the warm not-invited letter (Phase A)
 *
 * Mounted under /api/governance, so behind `requireModule("governance")`, and
 * every door asks the gate on `terms.read` first: the page is for members, as
 * an application's page is (`/role-applications/:id`). A proposal still
 * unconfirmed answers 404 everywhere: nothing unconfirmed reaches a person.
 *
 * ── WHAT A MEMBER READS ─────────────────────────────────────────────────────
 *
 * The roles, what the person wrote, where the circle's consent stands, and the
 * proposer's first name. Never their address, which only the desk reads
 * (`intake.moderate`, server/routes/openProposals.ts).
 *
 * ── WHO DECIDES (Rye, 2026-10-31, sheet 24a; coordinator's call 1) ──────────
 *
 * "The circle consents and a power holder records the adoption; nobody adopts
 * their own." The rule is `adoptRefusal` over `org.seat` read through
 * `whoMayPutHandToVillage`, the member door's own: a live holder of a role
 * carrying it adopts or declines, at any time or once the circle has consented
 * ("Record the adoption"); an admin with no such role does not; nobody acts on
 * a proposal from their own address. A proposal from a former member's address
 * is never adopted here (Rye, 2026-10-31: former members never invite), and
 * may still be declined. Once the village holds `org.seat`, or
 * nobody holds it live, nobody decides at the door: the page says so plainly,
 * and no other path is invented here (an open question for the pull request).
 *
 * ── NEVER A SILENT SUCCESS ──────────────────────────────────────────────────
 *
 * An adoption for an address with no account ALWAYS answers with the
 * invitation's link and whether the email went. Email not set up yet, an
 * address the provider refused: the proposal is still adopted, the link is
 * right there, and the sentence says to send it by hand. Each letter carries a
 * stable idempotency key, so the post office never sends one answer twice.
 *
 * ── THE INVITATION IS NAMED AFTER THE PROPOSAL ──────────────────────────────
 *
 * `inv-open-<proposal id>`, made under the adopting holder's row lock while
 * their session holds, in the same transaction that marks the proposal
 * adopted, so neither is ever written without the other. It is theirs, as a
 * link they made by hand is, and it does not count against their own cap. The
 * account it makes finishes the adoption at the welcome step
 * (server/lib/inviteDoor.ts).
 */
import { publicTermsOf } from "../../shared/seatTermsOffer";
import { listOrgRoles } from "../lib/orgChart";
import { membershipAlignedFor } from "../lib/applicationMembership";
import { identityKey } from "../../shared/openProposals";
import type { Express } from "express";
import type { Pool } from "mysql2/promise";
import type { OutgoingEmail, PostResult } from "../../shared/comms/contracts";
import { civilDateKey } from "../../shared/lunar";
import { type OpenProposalStatus } from "../../shared/openProposals";
import {
  adoptedAccountLetter,
  adoptedInviteLetter,
  declinedLetter,
  declinedWords,
  invitedLetter,
  notInvitedLetter,
  notInvitedWords,
  DECIDE_WORDS,
  greetingName,
  openInviteId,
  openProposalHref,
  OPEN_PROPOSAL_ID,
  roleStartsOn,
  whyNotSent,
  type NotSentWhy,
} from "../../shared/openProposalDecide";
import { consentState, shortDay } from "../../shared/roleProposalConsent";
import { ADOPTING_POWER, adoptRefusal, applicationHref } from "../../shared/seatApplications";
import { cleanNote, wordsIn } from "../../shared/applicantWords";
import { languageOf } from "../lib/applicantLanguage";
import type { SeatCalendar } from "../../shared/seatTerms";
import type { AppDeps } from "../lib/appDeps";
import { makeApplicantTeller } from "../lib/applicantUpdates";
import { hashInviteToken, INVITE_DAYS, invitePath, mintInviteToken } from "../lib/invites";
import { conversationsLeft, decideRule, isFormerMemberAccount, ownAccountOf, placeOnRoles, roomFor, type DecideDeps } from "../lib/openProposalDecide";
import type { LapseContext } from "../lib/orgChart";
import { answerAsk, askRolesFor, consentView, decisionFor, type AskStanding } from "../lib/roleProposals";
import { whileSessionHolds } from "../lib/sessionHold";
import { effectiveLifecycle } from "../lib/modules";
import { answerNotInvited, conversationsOf, hasRecused, interviewsAreIn, inviteToConversations, reviewWaits, stampDecided, stayCloseProgram } from "../lib/applicationReview";
import { currentMoonTerm, moonEnded, REVIEW_WORDS, reviewStageOf } from "../../shared/applicationReview";
import { statusLinkFor } from "../lib/applicantUpdates";
import { stepsOf } from "../repos/applicationReview";
import { activeClock } from "../lib/gratitude-cycles";
import { createInviteOn, inviteById, reissueInviteOn, revokeInvite } from "../repos/memberInvites";
import * as store from "../repos/openProposals";
import { asksFor, type StoredAsk } from "../repos/roleProposals";
import { PROPOSAL_FILE_ID, PROPOSAL_FILE_TYPES, proposalFileHref } from "../../shared/proposalAttachments";
import { readProposalFile } from "../lib/proposalFiles";
import { seatsWithCircles } from "../repos/seatApplications";
import { baseOf, deciderOffer, loadSubject, saveOffer } from "../lib/counterOffer";
import { OFFER_WORDS, openTalks, OFFER_LABELS } from "../../shared/counterOffer";
import { AGENT_PROPOSAL_WORDS, scopeWords } from "../../shared/agentHolders";
import { seatAdoptedAgent } from "../lib/agentRoleProposals";
import { agentsWithReach, isAgentAccount } from "../repos/agentAccounts";

export type DecideRouteDeps = Pick<
  AppDeps,
  "authedUser" | "guardCapability" | "getPool" | "notify" | "notifyAdmins" | "overLimit" | "members" | "stageOf" | "recordStageEvent" | "deploymentOrigin" | "projectName" | "escapeHtml" | "seasonState"
> & {
  liveHoldersOf(capability: string): Promise<string[]>;
  /** The permission roles carrying a power, for the authority a holder adopts under. */
  rolesCarrying(capability: string): Array<{ id: string; name: string }>;
  loadRoleHolders(): Array<{ roleId: string; userId: string }>;
  seatCalendar(): SeatCalendar;
  lapse(): LapseContext;
  /** The one mail door, as part A's module holds it. */
  postEmail(email: OutgoingEmail): Promise<PostResult>;
  /** Whether Live Sessions is on, so an objection has a circle backlog to go to. Defaults to the live lifecycle. */
  sessionsOn?: () => boolean;
  now?: () => Date;
  /** Where a proposal's attached files live (server/lib/proposalFiles.ts). Absent: no file is served. */
  proposalFileDir?: string;
};

const BASE = "/api/governance/open-proposals";
const MEMBERS_ONLY = { error: "auth_required", message: DECIDE_WORDS.membersOnly };
const MISSING = { error: "not_found", message: DECIDE_WORDS.missing };
/** Answers and decisions: ten of each in ten minutes per member, as the member door counts them. */
const ACTS_PER_WINDOW = 10;
const WINDOW_MS = 10 * 60 * 1000;

/** A send the provider took, or one already taken under the same key. */
const WENT: ReadonlySet<PostResult["status"]> = new Set<PostResult["status"]>(["sending", "sent", "delivered", "duplicate"]);

/** The status a member reads, for every status the page can show. */
const STATUS_WORDS = DECIDE_WORDS.status satisfies Record<Exclude<OpenProposalStatus, "unconfirmed">, string>;

export function registerOpenProposalDecide(app: Express, deps: DecideRouteDeps): void {
  const { authedUser, guardCapability, getPool, overLimit, members, deploymentOrigin, projectName, escapeHtml, postEmail } = deps;
  const now = () => (deps.now ? deps.now() : new Date());
  const tz = () => deps.seatCalendar().timezone || "UTC";
  const site = () => deploymentOrigin().replace(/\/+$/, "");
  const work: DecideDeps = {
    getPool,
    notify: deps.notify,
    notifyAdmins: deps.notifyAdmins,
    members,
    stageOf: deps.stageOf,
    recordStageEvent: deps.recordStageEvent,
    liveHoldersOf: deps.liveHoldersOf,
    calendar: deps.seatCalendar,
    lapse: deps.lapse,
    now,
  };

  /** Whether our review came first on this application: its yes is then said as the circle's welcome. */
  const reviewedOf = async (id: string): Promise<boolean> => reviewStageOf(await stepsOf(getPool(), id)) !== null;

  /** Updates to the person who proposed: their bell, once they have an account (the email already has its own letter). */
  const tell = makeApplicantTeller({ getPool, members, notify: deps.notify, postEmail, projectName, siteUrl: site });

  /** The signed-in member holding `terms.read`, or null after answering 401. */
  async function reader(req: any, res: any): Promise<any | null> {
    if (!(await guardCapability(req, res, "terms.read", { status: 401, body: MEMBERS_ONLY }))) return null;
    const viewer = await authedUser(req);
    if (!viewer) {
      res.status(401).json(MEMBERS_ONLY);
      return null;
    }
    return viewer;
  }

  /** Over the member's count of decisions, answered, or false. */
  async function limited(res: any, bucket: string): Promise<boolean> {
    if (!(await overLimit(bucket, ACTS_PER_WINDOW, WINDOW_MS))) return false;
    res.status(429).json({ error: DECIDE_WORDS.tooMany });
    return true;
  }

  /** The proposal by id once its address confirmed it, or null after answering 404. */
  async function found(req: any, res: any): Promise<store.StoredOpenProposal | null> {
    const id = String(req.params.id ?? "");
    const p = OPEN_PROPOSAL_ID.test(id) ? await store.readOpenProposal(getPool(), id) : null;
    if (!p || p.status === "unconfirmed") {
      res.status(404).json(MISSING);
      return null;
    }
    return p;
  }

  /** The season a proposal is for, by the village's calendar, with its name. */
  const seasonOf = (p: store.StoredOpenProposal): { id: string; name?: unknown; startsOn: string } | null =>
    (deps.seasonState().seasons ?? []).find((s: any) => s && String(s.id) === p.targetSeasonId) ?? null;

  /** The roles by name and circle, as they read now. A role retired since keeps its place in the list. */
  async function rolesOf(pool: Pool, p: store.StoredOpenProposal) {
    const named = new Map((await seatsWithCircles(pool, p.body.roles.map((r) => r.roleId))).map((r) => [r.id, r]));
    // The open card's outcomes and time, read live, so the decider sees what the role asks beside what was offered.
    const live = new Map((await listOrgRoles(pool)).map((r) => [r.id, r]));
    return p.body.roles.map((r) => {
      const role: any = live.get(r.roleId);
      return {
        id: r.roleId,
        name: named.get(r.roleId)?.name ?? null,
        circle: named.get(r.roleId)?.circle ?? null,
        note: r.note,
        accountabilities: Array.isArray(role?.accountabilities) ? role.accountabilities.map((a: unknown) => String(a ?? "").trim()).filter(Boolean) : [],
        commitmentPct: publicTermsOf(role?.termsOffer ?? null).commitmentPct,
      };
    });
  }
  const namesOf = (roles: Array<{ id: string; name: string | null }>) => roles.map((r) => r.name ?? r.id);

  /**
   * Whether this member may adopt or decline this proposal at the door, and
   * the proposer's own account here, if any. Refused, with the sentence.
   */
  async function deciding(p: store.StoredOpenProposal, actorId: string) {
    const rule = await decideRule(work);
    // An agent's keeper is its own (0374): they proposed it, so they never decide it.
    const own = await ownAccountOf(members, p);
    // Nobody adopts their own, matched by account AND by the person behind the
    // address: the actor's own address with a +tag, another case or Gmail's dots
    // is still the applicant (coordinator, 9 Nov 2026). A proposal from an
    // address nobody here holds, in any dress, is nobody's own.
    const actor: any = await members.byId(actorId);
    const actorIdentity = actor?.email ? identityKey(String(actor.email)) : null;
    const sameperson = !!actorIdentity && !!p.email && identityKey(p.email) === actorIdentity;
    const refusal = adoptRefusal(rule, actorId, sameperson ? actorId : (own ?? `open:${p.id}`));
    if (!refusal) return { ok: true as const, rule, own };
    const body =
      refusal.error === "own_terms"
        ? { error: "own_proposal", message: DECIDE_WORDS.ownProposal }
        : rule.who !== "live-holders"
          ? { error: "not_at_the_door", message: DECIDE_WORDS.door[rule.because] }
          : { error: "not_a_holder", message: DECIDE_WORDS.notAHolder };
    return { ok: false as const, status: refusal.status, body, rule, own };
  }

  /**
   * WHO SEES THE LINKS AND FILES (Rye, 10 Nov 2026: "deciders only"): the live
   * holders of the power that seats people, and the circle's holders asked to
   * consent or object. Never the applicant, never another member who can read
   * the page, never an admin for being one.
   */
  function decidesIt(may: Awaited<ReturnType<typeof deciding>>, asks: readonly StoredAsk[], viewerId: string): boolean {
    if (may.own === viewerId || (!may.ok && may.body.error === "own_proposal")) return false;
    const holds = may.rule.who === "live-holders" && may.rule.holders.includes(viewerId);
    return holds || asks.some((a) => a.userId === viewerId);
  }

  /** A letter as an essential email: the person asked for this answer. */
  function letter(key: string, origin: string, to: { email: string; name: string | null }, words: { subject: string; text: string; button?: { label: string; url: string } }): OutgoingEmail {
    const button = words.button
      ? `<p><a href="${escapeHtml(words.button.url)}" style="display:inline-block;padding:12px 22px;background:#1f6f5c;color:#ffffff;border-radius:8px;text-decoration:none;font-weight:600">${escapeHtml(words.button.label)}</a></p>`
      : "";
    const paras = words.text.split("\n\n").map((para) => `<p>${escapeHtml(para).replace(/\n/g, "<br>")}</p>`);
    // The button sits under the paragraph that carries the invitation's link.
    const at = words.button ? paras.findIndex((para) => para.includes(escapeHtml(words.button!.url))) : -1;
    if (at >= 0) paras.splice(at + 1, 0, button);
    const body = paras.join("");
    return {
      idempotencyKey: key,
      kind: "essential",
      origin,
      to: { email: to.email, ...(to.name ? { name: to.name } : {}) },
      subject: words.subject,
      html: `<!doctype html><html><body style="font-family:system-ui,sans-serif;color:#1f2937">${body}</body></html>`,
      text: words.text,
    };
  }

  /** Send, and say why not when it did not go. */
  async function sent(email: OutgoingEmail | null): Promise<NotSentWhy | null> {
    if (!email) return "no_address";
    const r = await postEmail(email);
    return WENT.has(r.status) ? null : whyNotSent(r);
  }

  /** What the letters say about the season the roles start in. */
  /** The letter's days. A moon role starts on the day it is adopted, never before the moon's first day (audit: "from 9 November" for a role adopted on the 11th). */
  const seasonWords = (p: store.StoredOpenProposal, adoptedAt: Date) => {
    const s = seasonOf(p);
    const t = p.body.term;
    const lang = languageOf(p);
    const w = wordsIn(lang);
    const civilDayWords = w.day;
    const from = t ? roleStartsOn(t.startsOn, civilDateKey(adoptedAt, tz())) : null;
    return {
      season: s?.name ? String(s.name) : null,
      startsOn: t && from ? civilDayWords(from) : s?.startsOn ? civilDayWords(String(s.startsOn)) : w.adopt.firstDay,
      moon: t && from ? { from: civilDayWords(from), to: civilDayWords(t.endsOn) } : null,
      lang,
    };
  };

  // ── Read ──────────────────────────────────────────────────────────────────

  app.get(`${BASE}/:id`, async (req, res) => {
    const viewer = await reader(req, res);
    if (!viewer) return;
    const p = await found(req, res);
    if (!p) return;
    const pool = getPool();
    const viewerId = String(viewer.id);
    const at = now();
    const roles = await rolesOf(pool, p);
    const asks = (await asksFor(pool, [p.id])).get(p.id) ?? [];
    const open = p.status === "confirmed";
    const view = consentView(asks, at, tz(), viewerId, await askRolesFor(pool, asks));
    const may = await deciding(p, viewerId);
    const holdsThePower = may.rule.who === "live-holders" && may.rule.holders.includes(viewerId);
    // The invitation's standing, for the holders of the power, on an adoption that made one.
    let invitation: { state: "open" | "used" | "closed"; sentAt: string | null; emailed: boolean | null } | null = null;
    if (p.status === "adopted" && holdsThePower && !may.own) {
      const inv = await inviteById(pool, openInviteId(p.id));
      const sentNote = await store.invitationSentOf(pool, p.id);
      invitation = { state: !inv ? "closed" : inv.usedByUserId ? "used" : inv.revokedAt || inv.expired ? "closed" : "open", sentAt: sentNote ? sentNote.at.toISOString() : null, emailed: sentNote ? sentNote.emailed : null };
    }
    // A former member's address, told only to those who decide it (coordinator, 2026-10-31).
    const former = open && may.ok && !!may.own && (await isFormerMemberAccount(work, may.own));
    const season = seasonOf(p);
    // Links and files, for the deciders only (Rye, 10 Nov 2026). Gone once the proposal is anonymised.
    const attached = decidesIt(may, asks, viewerId)
      ? { links: p.body.links ?? [], files: (p.body.files ?? []).map((f) => ({ id: f.id, kind: f.kind, name: f.name, size: f.size, href: proposalFileHref(p.id, f.id) })) }
      : null;
    // About you (joining lane PR 2): the references, the check and its consent are third-party data. Same gate as the links and files, nobody else, gone once anonymised.
    const aboutYou = decidesIt(may, asks, viewerId)
      ? { references: p.body.references ?? [], about: p.body.about ?? {}, backgroundCheck: p.body.backgroundCheck ?? null }
      : null;
    // The founding application's own answers (Phase A): the ways they got to know us and whether they asked for a ramp-up.
    // Deciders only. Human Design or Gene Keys (`selfKnowledge`) is the applicant's own and never reaches a decider.
    const founding = decidesIt(may, asks, viewerId) && !p.body.agent
      ? { knowUs: p.body.knowUs ?? [], rampUp: p.body.rampUp === true }
      : null;
    // The terms we offer, with the history: for the deciders only (joining lane PR 4). The applicant reads the current offer at their status page, never the log.
    // An agent is never offered a person's pay, allowance or commitment (audit B8a), so its page carries no terms.
    const subject = !p.body.agent && decidesIt(may, asks, viewerId) ? await loadSubject(pool, p.id) : null;
    const offer = subject ? deciderOffer(subject, await baseOf(pool, subject.roleIds)) : null;
    // What is left before Adopt (audit M10, B3): the conversations not written up, and the roles with every seat taken. Deciders only.
    const deciderHere = open && may.ok && !former && holdsThePower;
    const left = deciderHere ? await conversationsLeft(pool, p.id) : [];
    const full = deciderHere ? await roomFor(work, p, may.own ?? null) : [];
    const beforeAdopt = deciderHere
      ? {
          conversations: left.map((c) => ({ roleId: c.roleId, role: c.role, unheld: c.unheld, words: c.unheld ? DECIDE_WORDS.conversationUnheld(c.role) : DECIDE_WORDS.conversationMissing(c.role) })),
          seatsFull: full.map((f) => ({ name: f.name, seats: f.seats, taken: f.taken })),
          seatsWords: full.length ? DECIDE_WORDS.seatsFull(full) : null,
        }
      : null;
    // Our review (Phase A): where it stands, and the conversations an invitation opens, in order. Deciders read the conversations.
    const stage = reviewStageOf(await stepsOf(pool, p.id));
    const review = stage
      ? { stage, conversations: decidesIt(may, asks, viewerId) ? (await conversationsOf(pool, p.id)).map((c) => ({ role: c.role, minutes: c.minutes })) : [] }
      : null;
    const reviewing = open && stage === "review";
    // An agent's proposal (0374): what it is, who keeps it, what it can reach (read live from its tokens) and how to switch it off.
    let agent: Record<string, unknown> | null = null;
    if (p.body.agent) {
      const a = p.body.agent;
      const keeperRow: any = await members.byId(a.keeperUserId);
      const [live] = await agentsWithReach(pool, a.agentUserId);
      agent = {
        name: a.name,
        what: a.what,
        keeper: String(keeperRow?.name ?? "").trim() || null,
        reach: live ? live.scopes.map((sc) => ({ scope: sc, words: scopeWords(sc) })) : [],
        stillAnAgent: !!live,
        switchOff: a.switchOff,
        switchOffPlatform: AGENT_PROPOSAL_WORDS.switchOffPlatform,
      };
    }
    res.set("Cache-Control", "no-store").json({
      proposal: {
        id: p.id,
        href: openProposalHref(p.id),
        status: p.status,
        statusWords: p.decision.words ?? (stage === "review" && open ? DECIDE_WORDS.review.inReview : stage === "invited" && open ? DECIDE_WORDS.review.invited : STATUS_WORDS[p.status as keyof typeof STATUS_WORDS] ?? ""),
        proposer: greetingName(p.name),
        season: season ? { id: String(season.id), name: String(season.name ?? "") || null, startsOn: String(season.startsOn) } : null,
        term: p.body.term ?? null,
        card: p.body.card ?? null,
        // The membership letter, aligned with at application or from their account (Rye's answer 8): a yes or a no.
        membership: agent ? null : { aligned: await membershipAlignedFor(pool, p.email, may.own ?? null) },
        agent,
        roles,
        why: p.body.why,
        aim: p.body.aim,
        confirmedOn: p.confirmedAt ? civilDateKey(p.confirmedAt, tz()) : null,
        decidedOn: p.decidedAt ? civilDateKey(p.decidedAt, tz()) : null,
        decided: p.decision.words,
        // Answers close with the decision, so nobody reads that they may still give one.
        consent: open ? view : { ...view, record: null, you: { ...view.you, mayAnswer: false } },
        door: { because: may.rule.because, words: DECIDE_WORDS.door[may.rule.because] },
        invitation,
        attached,
        aboutYou: agent ? null : aboutYou,
        founding,
        offer,
        beforeAdopt,
        review,
        you: {
          mayEditTerms: open && may.ok && !p.body.agent,
          holdsThePower,
          own: !!may.own && may.own === viewerId,
          // While our review waits, its two answers stand in place of adopt and decline.
          mayAdopt: open && may.ok && !former && !reviewing,
          mayDecline: open && may.ok && !reviewing,
          mayReview: reviewing && may.ok,
          formerMember: former,
          mayReissue: !!invitation && invitation.state !== "used",
        },
      },
    });
  });

  /*
   * ONE ATTACHED FILE, to a decider and nobody else. Read from the private
   * folder, checked against the fingerprint kept when it was sent, kept out of
   * every cache and every index, and always downloaded rather than opened in
   * the page, so a file can never run as this site. Anybody else is answered
   * as if there were no such file.
   */
  app.get(`${BASE}/:id/files/:fileId`, async (req, res) => {
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("X-Robots-Tag", "noindex, nofollow");
    const viewer = await reader(req, res);
    if (!viewer) return;
    const viewerId = String(viewer.id);
    if (await overLimit(`open-proposal-file:${viewerId}`, 60, 60 * 60 * 1000)) {
      return res.status(429).json({ error: "too_many_asks", message: "That is a lot of files in an hour. Try again in a little while." });
    }
    const p = await found(req, res);
    if (!p) return;
    const fileId = String(req.params.fileId ?? "");
    const file = PROPOSAL_FILE_ID.test(fileId) ? (p.body.files ?? []).find((f) => f.id === fileId) : undefined;
    const asks = (await asksFor(getPool(), [p.id])).get(p.id) ?? [];
    if (!file || !deps.proposalFileDir || !decidesIt(await deciding(p, viewerId), asks, viewerId)) return res.status(404).json(MISSING);
    const bytes = await readProposalFile(deps.proposalFileDir, p.id, file);
    if (!bytes) return res.status(404).json(MISSING);
    res.setHeader("Content-Type", PROPOSAL_FILE_TYPES[file.kind]);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
    res.setHeader("Content-Disposition", `attachment; filename="${file.name.replace(/[^ -~]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(file.name)}`);
    res.send(bytes);
  });

  // ── The terms we offer: a counter-offer, one revision per save ─────────────
  /*
   * WHO MAY EDIT is whoever may adopt: the same `deciding` the adopt door asks, so no new power.
   * A visitor is answered 401 by the reader, a member who holds no seating power 403, the applicant
   * (by account or by address) 403. Each save appends one revision and tells the applicant once:
   * the update's key carries the revision number, and a retried save is refused by its stale
   * `expectedRevision`, so nothing is sent twice.
   */
  app.post(`${BASE}/:id/terms`, async (req, res) => {
    const viewer = await reader(req, res);
    if (!viewer) return;
    const actorId = String(viewer.id);
    if (await limited(res, `open-proposal-terms:${actorId}`)) return;
    const p = await found(req, res);
    if (!p) return;
    if (p.status !== "confirmed") return res.status(409).json({ error: DECIDE_WORDS.decided, status: p.status });
    const may = await deciding(p, actorId);
    if (!may.ok) return res.status(may.status).json(may.body);
    // An agent's proposal has no terms to offer: no pay, allowance or commitment (audit B8a).
    if (p.body.agent) return res.status(409).json({ error: "no_terms_for_an_agent", message: DECIDE_WORDS.noTermsForAnAgent });
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const out = await saveOffer(getPool(), p.id, {
      edit: { words: body.words && typeof body.words === "object" && !Array.isArray(body.words) ? body.words : undefined, commitmentPct: body.commitmentPct },
      expectedRevision: body.expectedRevision,
      by: { id: actorId, name: String(viewer.name ?? "").trim() || "A holder" },
      now: now(),
    });
    if (!out.ok) return res.status(out.status).json({ error: "terms_not_saved", message: out.error, ...(out.key ? { field: out.key } : {}) });
    await tell(p.id, "terms", { part: String(out.revision.n) });
    res.json({ success: true, offer: deciderOffer(out.subject, await baseOf(getPool(), out.subject.roleIds)) });
  });

  // ── The circle answers ────────────────────────────────────────────────────

  app.post(`${BASE}/:id/consent`, async (req, res) => {
    const viewer = await reader(req, res);
    if (!viewer) return;
    const userId = String(viewer.id);
    if (await limited(res, `open-proposal-consent:${userId}`)) return;
    const p = await found(req, res);
    if (!p) return;
    const pool = getPool();
    const standing: AskStanding = p.status === "confirmed" ? "open" : p.status === "withdrawn" ? "withdrawn" : "decided";
    const sessionsOn = (deps.sessionsOn ?? (() => effectiveLifecycle("sessions") !== "off"))();
    const out = await answerAsk({ pool, notify: deps.notify, timeZone: tz(), sessionsOn, now: now() }, p.id, standing, userId, namesOf(await rolesOf(pool, p)), req.body);
    if (!out.ok) return res.status(out.status).json({ error: out.error, ...(out.field ? { field: out.field } : {}) });
    const asks = (await asksFor(pool, [p.id])).get(p.id) ?? [];
    res.json({ answer: out.answer, carried: out.carried, carriedWords: out.carriedWords, consent: consentView(asks, now(), tz(), userId, await askRolesFor(pool, asks)) });
  });

  // ── Adopt ─────────────────────────────────────────────────────────────────

  app.post(`${BASE}/:id/adopt`, async (req, res) => {
    const viewer = await reader(req, res);
    if (!viewer) return;
    const actorId = String(viewer.id);
    if (await limited(res, `open-proposal-decide:${actorId}`)) return;
    let p = await found(req, res);
    if (!p) return;
    if (p.status !== "confirmed") return res.status(409).json({ error: DECIDE_WORDS.decided, status: p.status });
    const may = await deciding(p, actorId);
    if (!may.ok) return res.status(may.status).json(may.body);
    /*
     * AN AGENT'S PROPOSAL (0374): deciding stays human, and seating an agent is
     * its own power. An agent account never adopts, and the adopter needs
     * `org.seatAgent` on top of the raised-hand rule over `org.seat`, as the
     * admin's agent seating asks both. Checked before anything is written.
     */
    if (p.body.agent) {
      if (await isAgentAccount(getPool(), actorId)) return res.status(403).json({ error: "person_only", message: AGENT_PROPOSAL_WORDS.agentNeverDecides });
      if (!(await guardCapability(req, res, "org.seatAgent"))) return;
    }
    // Role journey L5: nobody who stepped out adopts, and nothing is adopted while a conversation is still to be written up.
    if (await hasRecused({ getPool }, p.id, actorId)) return res.status(403).json({ error: "recused", message: REVIEW_WORDS.recused });
    // Phase A: our review answers first, so nobody is adopted who was never invited.
    if (await reviewWaits({ getPool }, p.id)) return res.status(409).json({ error: "review_first", message: DECIDE_WORDS.review.first });
    if (!(await interviewsAreIn({ getPool }, p.id))) {
      // Name whose conversation is missing, and say when nobody can hold it (audit M10).
      const left = await conversationsLeft(getPool(), p.id);
      const named = left.map((c) => (c.unheld ? DECIDE_WORDS.conversationUnheld(c.role) : DECIDE_WORDS.conversationMissing(c.role))).join(" ");
      return res.status(409).json({ error: "interviews_not_done", message: named || REVIEW_WORDS.interviewsNotDone, conversations: left });
    }

    const pool = getPool();
    const at = now();
    // Terms still being talked about: say so before adopting, and adopt on a second, deliberate click (joining lane PR 4).
    // An agent has no terms (audit B8a), so nothing about terms holds its adoption back.
    if (!p.body.agent) {
      const subject = await loadSubject(pool, p.id);
      const talks = subject ? openTalks({ answers: subject.answers, co: subject.co }) : [];
      if (talks.length && req.body?.confirmOpenTalks !== true) {
        return res.status(409).json({ error: "terms_open", message: OFFER_WORDS.stillTalking(talks.map((k) => OFFER_LABELS[k])), settings: talks.map((k) => OFFER_LABELS[k]) });
      }
    }
    // The moon this was proposed for has ended before the decision: the holder may adopt for the moon running now (Rye, role journey 4a).
    let theMoonNow = false;
    let moonNow: ReturnType<typeof currentMoonTerm> | null = null;
    if (moonEnded(p.body.term, at, tz())) {
      if (req.body?.forCurrentMoon !== true) {
        return res.status(409).json({ error: "moon_ended", message: DECIDE_WORDS.moonEnded, canAdoptForThisMoon: true });
      }
      moonNow = currentMoonTerm(at, activeClock(), tz());
    }
    // Every seat taken (audit B3, 11 Nov 2026): refused, unless the holder chose to adopt for when a seat opens.
    // Counted for the term it would start on, before anything is written.
    const full = await roomFor(work, moonNow ? { ...p, body: { ...p.body, term: moonNow } } : p, may.own ?? null);
    const waitsForSeat = full.length > 0;
    if (waitsForSeat && req.body?.whenASeatOpens !== true) {
      return res.status(409).json({ error: "seats_full", message: DECIDE_WORDS.seatsFull(full), seatsFull: full.map((f) => ({ name: f.name, seats: f.seats, taken: f.taken })), canAdoptForWhenASeatOpens: true });
    }
    if (moonNow) {
      if (!(await store.rewriteTerm(pool, p.id, moonNow))) return res.status(409).json({ error: DECIDE_WORDS.raced });
      p = { ...p, body: { ...p.body, term: moonNow } };
      theMoonNow = true;
    }
    const carrying = deps.rolesCarrying(ADOPTING_POWER);
    const seatedIn = deps.loadRoleHolders().find((h) => h.userId === actorId && carrying.some((r) => r.id === h.roleId))?.roleId ?? "badge";
    const asks = (await asksFor(pool, [p.id])).get(p.id) ?? [];
    // The record names a role, never a person: "after the circle consented", or "by the founder's power".
    const decidedBase = decisionFor(consentState(asks, at), at, tz(), carrying.find((r) => r.id === seatedIn)?.name ?? null);
    const decided = `${decidedBase}${theMoonNow ? ", for the moon running now" : ""}${waitsForSeat ? `, ${DECIDE_WORDS.forWhenASeatOpens}` : ""}`;
    const decision = { words: decided, authority: `${ADOPTING_POWER}@${seatedIn}`.slice(0, 64) };
    // A note for the applicant, when the decider wrote one: kept on the proposal, shown on their status page, in the letter.
    const note = cleanNote(req.body?.note);
    const roles = await rolesOf(pool, p);
    const firstName = greetingName(p.name);
    const village = projectName();
    // The Love Letter line only for somebody not aligned yet: an applicant who aligned on the form is not asked again (Rye's answer 8).
    const letterLine = await loveLetterLine(p, may.own ?? null);

    // An agent's proposal: adopted and the agent seated, together, through the one agent seating path.
    if (p.body.agent) {
      const agent = p.body.agent;
      if (!(await isAgentAccount(pool, agent.agentUserId))) return res.status(409).json({ error: "not_an_agent", message: AGENT_PROPOSAL_WORDS.noLongerAnAgent });
      if (!(await store.decideOpenProposal(pool, p.id, "adopted", decision, at, note))) return res.status(409).json({ error: DECIDE_WORDS.raced });
      let seated: Awaited<ReturnType<typeof seatAdoptedAgent>>;
      try {
        seated = await seatAdoptedAgent(pool, { proposal: p, adopterId: actorId, calendar: deps.seatCalendar(), now: at });
      } catch (e) {
        await store.undoAdoption(pool, p.id);
        throw e;
      }
      if (!seated.ok) {
        // Nothing stays seated, so the proposal waits on the village again.
        await store.undoAdoption(pool, p.id);
        return res.status(409).json({ error: seated.error });
      }
      await stampDecided(work, p.id, "adopted");
      await deps.notify({
        userId: agent.keeperUserId,
        type: "open_role_proposal_decided",
        title: AGENT_PROPOSAL_WORDS.keeperTold(agent.name, namesOf(roles)),
        body: decided,
        link: openProposalHref(p.id),
        actorUserId: actorId,
        dedupeKey: `op:${p.id}:adopted:keeper`,
      });
      return res.json({ success: true, status: "adopted", decided, account: false, agent: true, seated: seated.seated, invitation: null, application: null, message: AGENT_PROPOSAL_WORDS.adoptedSeated(seated.seated) });
    }

    // An address with an account here: the place is made now, and no invitation is needed.
    if (may.own) {
      // Somebody who left the village: welcoming them back is its own act. Nothing is granted, seated or sent.
      if (await isFormerMemberAccount(work, may.own)) return res.status(409).json({ error: "former_member", message: DECIDE_WORDS.formerMember });
      if (!(await store.decideOpenProposal(pool, p.id, "adopted", decision, at, note))) return res.status(409).json({ error: DECIDE_WORDS.raced });
      await stampDecided(work, p.id, "adopted");
      let placed: Awaited<ReturnType<typeof placeOnRoles>>;
      try {
        placed = await placeOnRoles(work, { account: may.own, proposal: p, adopterId: actorId, authority: decision.authority });
      } catch (e) {
        await store.undoAdoption(pool, p.id);
        throw e;
      }
      if (!placed.ok) {
        // Nothing was written for the account, so the proposal waits on the village again.
        await store.undoAdoption(pool, p.id);
        return res.status(409).json({ error: placed.code === "pending" ? DECIDE_WORDS.pending : placed.error, ...(placed.code === "pending" ? { applicationId: placed.applicationId } : {}) });
      }
      const why = await sent(
        p.email
          ? letter(`open-proposal:${p.id}:adopted`, "open_proposal.adopted", { email: p.email, name: firstName }, adoptedAccountLetter({ firstName, village, roleNames: namesOf(roles), reviewed: await reviewedOf(p.id), ...seasonWords(p, at), signIn: `${site()}/profile`, loveLetter: letterLine, note, waitsForSeat }))
          : null,
      );
      await tell(p.id, "adopted");
      return res.json({
        success: true,
        status: "adopted",
        decided,
        account: true,
        invitation: null,
        application: { id: placed.applicationId, href: applicationHref(placed.applicationId) },
        message: `${waitsForSeat ? DECIDE_WORDS.adoptedAccountWaits : DECIDE_WORDS.adoptedAccount} ${why === null ? DECIDE_WORDS.accountTold : DECIDE_WORDS.accountNotTold(why)}`,
      });
    }

    // No account: the invitation and the decision, one transaction under the holder's row lock.
    const token = mintInviteToken();
    const input = { id: openInviteId(p.id), tokenHash: hashInviteToken(token), inviterUserId: actorId, days: INVITE_DAYS };
    const RACED = "OPEN_PROPOSAL_RACED";
    let held: { ok: boolean };
    try {
      held = await whileSessionHolds(pool, actorId, Number(viewer.tokenVersion ?? 0), async (conn) => {
        if (!(await store.decideOpenProposal(conn, p.id, "adopted", decision, at, note))) throw Object.assign(new Error("decided a moment ago"), { code: RACED });
        try {
          await createInviteOn(conn, input);
        } catch (e: any) {
          if (e?.code !== "ER_DUP_ENTRY") throw e;
          // An invitation by this name from an adoption put back: given a new token, never a second row.
          if (!(await reissueInviteOn(conn, input))) throw Object.assign(new Error("its invitation is still out"), { code: RACED });
        }
      });
    } catch (e: any) {
      if (e?.code === RACED) return res.status(409).json({ error: DECIDE_WORDS.raced });
      throw e;
    }
    if (!held.ok) return res.status(401).json({ error: "auth_required" });
    await stampDecided(work, p.id, "adopted");

    const link = `${site()}${invitePath(token)}`;
    // Keyed by the link, so a new invitation goes out again, and one link never goes twice.
    const why = await sent(
      p.email
        ? letter(`open-proposal:${p.id}:adopted:${input.tokenHash.slice(0, 16)}`, "open_proposal.adopted", { email: p.email, name: firstName }, adoptedInviteLetter({ firstName, village, roleNames: namesOf(roles), reviewed: await reviewedOf(p.id), ...seasonWords(p, at), link, days: INVITE_DAYS, loveLetter: letterLine, note, waitsForSeat }))
        : null,
    );
    await store.noteInvitationSent(pool, p.id, at, why === null);
    res.json({
      success: true,
      status: "adopted",
      decided,
      account: false,
      invitation: { link, emailed: why === null },
      application: null,
      message: why === null ? DECIDE_WORDS.adoptedEmailed(INVITE_DAYS) : DECIDE_WORDS.adoptedNotEmailed(why),
    });
  });

  // ── Decline ───────────────────────────────────────────────────────────────

  app.post(`${BASE}/:id/decline`, async (req, res) => {
    const viewer = await reader(req, res);
    if (!viewer) return;
    const actorId = String(viewer.id);
    if (await limited(res, `open-proposal-decide:${actorId}`)) return;
    const p = await found(req, res);
    if (!p) return;
    if (p.status !== "confirmed") return res.status(409).json({ error: DECIDE_WORDS.decided, status: p.status });
    const may = await deciding(p, actorId);
    if (!may.ok) return res.status(may.status).json(may.body);
    // While our review waits, its answer is the not-invited letter, never the older no.
    if (await reviewWaits({ getPool }, p.id)) return res.status(409).json({ error: "review_first", message: DECIDE_WORDS.review.first });
    const pool = getPool();
    const at = now();
    const decided = declinedWords(shortDay(at, tz()));
    const note = cleanNote(req.body?.note);
    // decided_at is set here, so the tidy job takes the name and address off after 90 days.
    if (!(await store.decideOpenProposal(pool, p.id, "declined", { words: decided, authority: null }, at, note))) return res.status(409).json({ error: DECIDE_WORDS.raced });
    await stampDecided(work, p.id, "declined");
    if (p.body.agent) {
      // An agent's proposal has no address: its keeper hears it in the bell.
      await deps.notify({
        userId: p.body.agent.keeperUserId,
        type: "open_role_proposal_decided",
        title: AGENT_PROPOSAL_WORDS.keeperDeclined(p.body.agent.name, namesOf(await rolesOf(pool, p))),
        body: decided,
        link: openProposalHref(p.id),
        actorUserId: actorId,
        dedupeKey: `op:${p.id}:declined:keeper`,
      });
      return res.json({ success: true, status: "declined", decided, emailed: false, message: AGENT_PROPOSAL_WORDS.declined });
    }
    const firstName = greetingName(p.name);
    const why = await sent(
      p.email
        ? letter(`open-proposal:${p.id}:declined`, "open_proposal.declined", { email: p.email, name: firstName }, declinedLetter({ firstName, village: projectName(), roleNames: namesOf(await rolesOf(pool, p)), site: site(), lang: languageOf(p), note }))
        : null,
    );
    await tell(p.id, "declined");
    res.json({ success: true, status: "declined", decided, emailed: why === null, message: why === null ? DECIDE_WORDS.declinedEmailed : DECIDE_WORDS.declinedNotEmailed(why) });
  });

  /**
   * THE LETTER'S LOVE LETTER LINE: the link to the membership door, or nothing
   * for somebody already aligned with the letter, on the form or from their
   * account. The door is served to anybody signed in (shared/brochure.ts,
   * MEMBER_DOORS), so the link never lands on not-found.
   */
  async function loveLetterLine(p: { email: string | null }, account: string | null): Promise<string | null> {
    return (await membershipAlignedFor(getPool(), p.email, account)) ? null : `${site()}/love-letter`;
  }

  // ── A new invitation ──────────────────────────────────────────────────────
  /*
   * For an adopted proposal whose invitation nobody used: lost, run out, or
   * never received (Amora has no mail provider yet, so the decider's copy may
   * be the only one). The old link is withdrawn and the same invitation is
   * given a new token, by a holder of the power, who becomes its maker.
   */
  // ── Our review (Phase A) ──────────────────────────────────────────────────
  /*
   * The same people who adopt and decline answer our review, by the same rule
   * (`deciding`), and nobody who stepped out. ONE answer per application: the
   * review step's unique key decides a race. Each answer sends its own letter,
   * keyed by the proposal, so a retry never sends it twice.
   */
  const reviewWork = {
    getPool,
    notify: deps.notify,
    notifyAdmins: deps.notifyAdmins,
    liveHoldersOf: deps.liveHoldersOf,
    calendar: deps.seatCalendar,
    now,
    members,
    tellApplicant: tell,
  };

  async function reviewer(req: any, res: any): Promise<{ p: store.StoredOpenProposal; actorId: string } | null> {
    const viewer = await reader(req, res);
    if (!viewer) return null;
    const actorId = String(viewer.id);
    if (await limited(res, `open-proposal-decide:${actorId}`)) return null;
    const p = await found(req, res);
    if (!p) return null;
    if (p.status !== "confirmed") {
      res.status(409).json({ error: DECIDE_WORDS.decided, status: p.status });
      return null;
    }
    const may = await deciding(p, actorId);
    if (!may.ok) {
      res.status(may.status).json(may.body);
      return null;
    }
    if (await hasRecused({ getPool }, p.id, actorId)) {
      res.status(403).json({ error: "recused", message: REVIEW_WORDS.recused });
      return null;
    }
    return { p, actorId };
  }

  app.post(`${BASE}/:id/invite`, async (req, res) => {
    const who = await reviewer(req, res);
    if (!who) return;
    const { p, actorId } = who;
    const pool = getPool();
    const out = await inviteToConversations(reviewWork, p.id, actorId);
    if (!out.ok) return res.status(out.status).json({ error: out.code === "done" ? "already_answered" : out.code === "gone" ? "decided" : "no_review", message: out.error });
    const note = cleanNote(req.body?.note);
    const firstName = greetingName(p.name);
    const why = await sent(
      p.email
        ? letter(`open-proposal:${p.id}:invited`, "open_proposal.invited", { email: p.email, name: firstName }, invitedLetter({
            firstName,
            village: projectName(),
            roleNames: namesOf(await rolesOf(pool, p)),
            conversations: out.conversations.map((c) => ({ role: c.role, minutes: c.minutes, bookingUrl: c.bookingUrl })),
            statusLink: statusLinkFor({ siteUrl: site }, p.id),
            lang: languageOf(p),
            note,
          }))
        : null,
    );
    await tell(p.id, "invited");
    res.json({ success: true, stage: "invited", emailed: why === null, message: why === null ? DECIDE_WORDS.review.invitedEmailed : DECIDE_WORDS.review.invitedNotEmailed(why) });
  });

  app.post(`${BASE}/:id/not-invited`, async (req, res) => {
    const who = await reviewer(req, res);
    if (!who) return;
    const { p, actorId } = who;
    const pool = getPool();
    const at = now();
    const out = await answerNotInvited(reviewWork, p.id, actorId);
    if (!out.ok) return res.status(out.status).json({ error: out.code === "done" ? "already_answered" : out.code === "gone" ? "decided" : "no_review", message: out.error });
    const note = cleanNote(req.body?.note);
    const decided = notInvitedWords(shortDay(at, tz()));
    // decided_at is set here, so the tidy job takes the name and address off after 90 days, as for any no.
    if (!(await store.decideOpenProposal(pool, p.id, "declined", { words: decided, authority: null }, at, note))) return res.status(409).json({ error: DECIDE_WORDS.raced });
    await stampDecided(work, p.id, "declined");
    const firstName = greetingName(p.name);
    const why = await sent(
      p.email
        ? letter(`open-proposal:${p.id}:not-invited`, "open_proposal.not_invited", { email: p.email, name: firstName }, notInvitedLetter({
            firstName,
            village: projectName(),
            roleNames: namesOf(await rolesOf(pool, p)),
            site: site(),
            stayClose: { program: stayCloseProgram(), quests: true, events: effectiveLifecycle("events") === "public" },
            lang: languageOf(p),
            note,
          }))
        : null,
    );
    await tell(p.id, "not_invited");
    res.json({ success: true, status: "declined", stage: "not_invited", decided, emailed: why === null, message: why === null ? DECIDE_WORDS.review.notInvitedEmailed : DECIDE_WORDS.review.notInvitedNotEmailed(why) });
  });

  app.post(`${BASE}/:id/invitation`, async (req, res) => {
    const viewer = await reader(req, res);
    if (!viewer) return;
    const actorId = String(viewer.id);
    if (await limited(res, `open-proposal-decide:${actorId}`)) return;
    const p = await found(req, res);
    if (!p) return;
    const letterLine = await loveLetterLine(p, null);
    const rule = await decideRule(work);
    if (rule.who !== "live-holders" || !rule.holders.includes(actorId)) {
      return res.status(403).json({ error: "not_a_holder", message: rule.who === "live-holders" ? DECIDE_WORDS.notAHolder : DECIDE_WORDS.door[rule.because] });
    }
    const pool = getPool();
    const inv = p.status === "adopted" ? await inviteById(pool, openInviteId(p.id)) : null;
    if (!inv || inv.usedByUserId) return res.status(409).json({ error: DECIDE_WORDS.noInvitation });
    // Still open: withdrawn first. A link used a moment ago is read back as used.
    if (!inv.revokedAt && !inv.expired && !(await revokeInvite(pool, inv.id, inv.inviterUserId))) return res.status(409).json({ error: DECIDE_WORDS.noInvitation });
    const token = mintInviteToken();
    const input = { id: inv.id, tokenHash: hashInviteToken(token), inviterUserId: actorId, days: INVITE_DAYS };
    const held = await whileSessionHolds(pool, actorId, Number(viewer.tokenVersion ?? 0), (conn) => reissueInviteOn(conn, input));
    if (!held.ok) return res.status(401).json({ error: "auth_required" });
    if (!held.value) return res.status(409).json({ error: DECIDE_WORDS.noInvitation });
    const link = `${site()}${invitePath(token)}`;
    const firstName = greetingName(p.name);
    const why = await sent(
      p.email
        ? letter(`open-proposal:${p.id}:adopted:${input.tokenHash.slice(0, 16)}`, "open_proposal.adopted", { email: p.email, name: firstName }, adoptedInviteLetter({ firstName, village: projectName(), roleNames: namesOf(await rolesOf(pool, p)), reviewed: await reviewedOf(p.id), ...seasonWords(p, p.decidedAt ?? now()), link, days: INVITE_DAYS, loveLetter: letterLine, note: p.body.note ?? null, waitsForSeat: (await roomFor(work, p, null)).length > 0 }))
        : null,
    );
    await store.noteInvitationSent(pool, p.id, now(), why === null);
    res.json({
      success: true,
      link,
      emailed: why === null,
      message: `${DECIDE_WORDS.reissued(INVITE_DAYS)} ${why === null ? DECIDE_WORDS.reissuedEmailed : DECIDE_WORDS.reissuedNotEmailed(why)}`,
    });
  });
}
