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
 * a proposal from their own address. Once the village holds `org.seat`, or
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
  DECIDE_WORDS,
  greetingName,
  openInviteId,
  openProposalHref,
  OPEN_PROPOSAL_ID,
  whyNotSent,
  type NotSentWhy,
} from "../../shared/openProposalDecide";
import { consentState, shortDay } from "../../shared/roleProposalConsent";
import { ADOPTING_POWER, adoptRefusal, applicationHref } from "../../shared/seatApplications";
import { civilDayWords } from "../../shared/seasonPlans";
import type { SeatCalendar } from "../../shared/seatTerms";
import type { AppDeps } from "../lib/appDeps";
import { hashInviteToken, INVITE_DAYS, invitePath, mintInviteToken } from "../lib/invites";
import { accountFor, decideRule, placeOnRoles, type DecideDeps } from "../lib/openProposalDecide";
import type { LapseContext } from "../lib/orgChart";
import { answerAsk, askRolesFor, consentView, decisionFor, type AskStanding } from "../lib/roleProposals";
import { whileSessionHolds } from "../lib/sessionHold";
import { effectiveLifecycle } from "../lib/modules";
import { createInviteOn, inviteById, reissueInviteOn, revokeInvite } from "../repos/memberInvites";
import * as store from "../repos/openProposals";
import { asksFor } from "../repos/roleProposals";
import { seatsWithCircles } from "../repos/seatApplications";

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
    return p.body.roles.map((r) => ({ id: r.roleId, name: named.get(r.roleId)?.name ?? null, circle: named.get(r.roleId)?.circle ?? null, note: r.note }));
  }
  const namesOf = (roles: Array<{ id: string; name: string | null }>) => roles.map((r) => r.name ?? r.id);

  /**
   * Whether this member may adopt or decline this proposal at the door, and
   * the proposer's own account here, if any. Refused, with the sentence.
   */
  async function deciding(p: store.StoredOpenProposal, actorId: string) {
    const rule = await decideRule(work);
    const own = await accountFor(members, p.email);
    // Nobody adopts their own: a proposal from an address with no account is nobody's own here.
    const refusal = adoptRefusal(rule, actorId, own ?? `open:${p.id}`);
    if (!refusal) return { ok: true as const, rule, own };
    const body =
      refusal.error === "own_terms"
        ? { error: "own_proposal", message: DECIDE_WORDS.ownProposal }
        : rule.who !== "live-holders"
          ? { error: "not_at_the_door", message: DECIDE_WORDS.door[rule.because] }
          : { error: "not_a_holder", message: DECIDE_WORDS.notAHolder };
    return { ok: false as const, status: refusal.status, body, rule, own };
  }

  /** A letter as an essential email: the person asked for this answer. */
  function letter(key: string, origin: string, to: { email: string; name: string | null }, words: { subject: string; text: string }): OutgoingEmail {
    const body = words.text
      .split("\n\n")
      .map((para) => `<p>${escapeHtml(para).replace(/\n/g, "<br>")}</p>`)
      .join("");
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
  const seasonWords = (p: store.StoredOpenProposal) => {
    const s = seasonOf(p);
    return { season: s?.name ? String(s.name) : null, startsOn: s?.startsOn ? civilDayWords(String(s.startsOn)) : "the season's first day" };
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
    let invitation: { state: "open" | "used" | "closed" } | null = null;
    if (p.status === "adopted" && holdsThePower && !may.own) {
      const inv = await inviteById(pool, openInviteId(p.id));
      invitation = { state: !inv ? "closed" : inv.usedByUserId ? "used" : inv.revokedAt || inv.expired ? "closed" : "open" };
    }
    const season = seasonOf(p);
    res.set("Cache-Control", "no-store").json({
      proposal: {
        id: p.id,
        href: openProposalHref(p.id),
        status: p.status,
        statusWords: p.decision.words ?? STATUS_WORDS[p.status as keyof typeof STATUS_WORDS] ?? "",
        proposer: greetingName(p.name),
        season: season ? { id: String(season.id), name: String(season.name ?? "") || null, startsOn: String(season.startsOn) } : null,
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
        you: {
          holdsThePower,
          own: !!may.own && may.own === viewerId,
          mayAdopt: open && may.ok,
          mayDecline: open && may.ok,
          mayReissue: !!invitation && invitation.state !== "used",
        },
      },
    });
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
    const p = await found(req, res);
    if (!p) return;
    if (p.status !== "confirmed") return res.status(409).json({ error: DECIDE_WORDS.decided, status: p.status });
    const may = await deciding(p, actorId);
    if (!may.ok) return res.status(may.status).json(may.body);

    const pool = getPool();
    const at = now();
    const carrying = deps.rolesCarrying(ADOPTING_POWER);
    const seatedIn = deps.loadRoleHolders().find((h) => h.userId === actorId && carrying.some((r) => r.id === h.roleId))?.roleId ?? "badge";
    const asks = (await asksFor(pool, [p.id])).get(p.id) ?? [];
    // The record names a role, never a person: "after the circle consented", or "by the founder's power".
    const decided = decisionFor(consentState(asks, at), at, tz(), carrying.find((r) => r.id === seatedIn)?.name ?? null);
    const decision = { words: decided, authority: `${ADOPTING_POWER}@${seatedIn}`.slice(0, 64) };
    const roles = await rolesOf(pool, p);
    const firstName = greetingName(p.name);
    const village = projectName();

    // An address with an account here: the place is made now, and no invitation is needed.
    if (may.own) {
      if (!(await store.decideOpenProposal(pool, p.id, "adopted", decision, at))) return res.status(409).json({ error: DECIDE_WORDS.raced });
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
          ? letter(`open-proposal:${p.id}:adopted`, "open_proposal.adopted", { email: p.email, name: firstName }, adoptedAccountLetter({ firstName, village, roleNames: namesOf(roles), ...seasonWords(p), signIn: `${site()}/profile` }))
          : null,
      );
      return res.json({
        success: true,
        status: "adopted",
        decided,
        account: true,
        invitation: null,
        application: { id: placed.applicationId, href: applicationHref(placed.applicationId) },
        message: `${DECIDE_WORDS.adoptedAccount} ${why === null ? DECIDE_WORDS.accountTold : DECIDE_WORDS.accountNotTold(why)}`,
      });
    }

    // No account: the invitation and the decision, one transaction under the holder's row lock.
    const token = mintInviteToken();
    const input = { id: openInviteId(p.id), tokenHash: hashInviteToken(token), inviterUserId: actorId, days: INVITE_DAYS };
    const RACED = "OPEN_PROPOSAL_RACED";
    let held: { ok: boolean };
    try {
      held = await whileSessionHolds(pool, actorId, Number(viewer.tokenVersion ?? 0), async (conn) => {
        if (!(await store.decideOpenProposal(conn, p.id, "adopted", decision, at))) throw Object.assign(new Error("decided a moment ago"), { code: RACED });
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

    const link = `${site()}${invitePath(token)}`;
    // Keyed by the link, so a new invitation goes out again, and one link never goes twice.
    const why = await sent(
      p.email
        ? letter(`open-proposal:${p.id}:adopted:${input.tokenHash.slice(0, 16)}`, "open_proposal.adopted", { email: p.email, name: firstName }, adoptedInviteLetter({ firstName, village, roleNames: namesOf(roles), ...seasonWords(p), link, days: INVITE_DAYS }))
        : null,
    );
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
    const pool = getPool();
    const at = now();
    const decided = declinedWords(shortDay(at, tz()));
    // decided_at is set here, so the tidy job takes the name and address off after 90 days.
    if (!(await store.decideOpenProposal(pool, p.id, "declined", { words: decided, authority: null }, at))) return res.status(409).json({ error: DECIDE_WORDS.raced });
    const firstName = greetingName(p.name);
    const why = await sent(
      p.email
        ? letter(`open-proposal:${p.id}:declined`, "open_proposal.declined", { email: p.email, name: firstName }, declinedLetter({ firstName, village: projectName(), roleNames: namesOf(await rolesOf(pool, p)) }))
        : null,
    );
    res.json({ success: true, status: "declined", decided, emailed: why === null, message: why === null ? DECIDE_WORDS.declinedEmailed : DECIDE_WORDS.declinedNotEmailed(why) });
  });

  // ── A new invitation ──────────────────────────────────────────────────────
  /*
   * For an adopted proposal whose invitation nobody used: lost, run out, or
   * never received (Amora has no mail provider yet, so the decider's copy may
   * be the only one). The old link is withdrawn and the same invitation is
   * given a new token, by a holder of the power, who becomes its maker.
   */
  app.post(`${BASE}/:id/invitation`, async (req, res) => {
    const viewer = await reader(req, res);
    if (!viewer) return;
    const actorId = String(viewer.id);
    if (await limited(res, `open-proposal-decide:${actorId}`)) return;
    const p = await found(req, res);
    if (!p) return;
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
        ? letter(`open-proposal:${p.id}:adopted:${input.tokenHash.slice(0, 16)}`, "open_proposal.adopted", { email: p.email, name: firstName }, adoptedInviteLetter({ firstName, village: projectName(), roleNames: namesOf(await rolesOf(pool, p)), ...seasonWords(p), link, days: INVITE_DAYS }))
        : null,
    );
    res.json({
      success: true,
      link,
      emailed: why === null,
      message: `${DECIDE_WORDS.reissued(INVITE_DAYS)} ${why === null ? DECIDE_WORDS.reissuedEmailed : DECIDE_WORDS.reissuedNotEmailed(why)}`,
    });
  });
}
