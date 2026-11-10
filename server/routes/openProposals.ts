/**
 * OPEN ROLE PROPOSALS, THE INTAKE: somebody with no account proposes to hold
 * roles next season (Rye, 2026-10-30; master coordinator's calls 1 to 3 of
 * 2026-10-31, sheet 19i). The words and the shape are shared/openProposals.ts,
 * the SQL is server/repos/openProposals.ts.
 *
 *   GET  /api/open-proposals/form?link=   next season's roles, when the page is open
 *   POST /api/open-proposals              the proposal; emails a confirmation link
 *   POST /api/open-proposals/confirm      the address answers; the proposal is confirmed
 *
 *   GET  /api/admin/open-proposals                    the switch, the links, the confirmed proposals
 *   PUT  /api/admin/open-proposals/settings           the public link on or off
 *   POST /api/admin/open-proposals/links              a link for one person, shown once
 *   POST /api/admin/open-proposals/links/:id/revoke   switch one off
 *
 * ── WHO CAN OPEN THE FORM ───────────────────────────────────────────────────
 *
 * The public link (`/propose-a-role`) is ON unless an admin switches it off
 * (sheet 19i). A link made for one person opens it whatever the switch says,
 * until it is switched off itself. Either way the governance module has to be
 * on, because the roles are its own.
 *
 * ── NOTHING UNCONFIRMED REACHES A PERSON ────────────────────────────────────
 *
 * A proposal is written UNCONFIRMED and the address is sent a link, as an
 * essential email through the one mail door. Until that link is opened the
 * proposal is visible to nobody, notifies nobody, and is deleted after 48
 * hours by the tidy job. A send that does not go deletes the row at once and
 * says so: a proposal nobody can confirm is not kept. The gates on the way in
 * are the honeypot field, a cap per connection and a cap per address; there is
 * no CAPTCHA (sheet 19i).
 *
 * The tidy job also takes the name and address off a declined or withdrawn
 * proposal 90 days after it was decided, and off an adopted one whose
 * invitation nobody used in those 90 days (part B, coordinator 2026-10-31).
 *
 * Confirmed proposals wait on the admin's list here.
 *
 * ── CONFIRMING ASKS THE CIRCLE (part B) ─────────────────────────────────────
 *
 * The confirm step, and only the confirm step, asks every live holder of a
 * role in the proposed roles' circles to consent or object within 2 business
 * days, and tells the holders of the power that seats people it waits on them
 * (server/lib/openProposalDecide.ts). The members-only page where it is read,
 * answered, adopted or declined, and the account an adoption makes, are
 * server/routes/openProposalDecide.ts, registered from here.
 *
 * The desk side asks the gate on `intake.moderate`, as the other public queues do.
 */
import crypto from "node:crypto";
import type { Express, Request, Response } from "express";
import multer from "multer";
import type { Pool } from "mysql2/promise";

import type { OutgoingEmail, PostResult } from "../../shared/comms/contracts";
import { emailKeyOf } from "../../shared/comms/address";
import { civilDateKey } from "../../shared/lunar";
import {
  confirmLetter,
  OPEN_ANONYMISE_DAYS,
  OPEN_CONFIRM_HOURS,
  OPEN_NAME_MAX,
  OPEN_WORDS,
  parseOpenProposal,
  membershipOf,
  OPEN_GLOBAL_HOURLY,
  ipBucket,
  limiterAddressKey,
  safeGreeting,
} from "../../shared/openProposals";
import type { AppDeps } from "../lib/appDeps";
import { post } from "../lib/comms/postOffice";
import { effectiveLifecycle } from "../lib/modules";
import { listOrgRoles } from "../lib/orgChart";
import { singlePublicAddress } from "../lib/publicAddress";
import { registerJob } from "../lib/scheduler";
import { accountFor, arrivalFor, confirmAndAsk, describeFor, tellTheCircle } from "../lib/openProposalDecide";
import { whenInviteDescribed, whenInvitedArrives } from "../lib/inviteDoor";
import { alignAtApplication, carryToAccount, type SigningDoor } from "../lib/applicationMembership";
import { currentLetter } from "../lib/membershipLetter";
import { LETTER_WORDS, type LetterSource } from "../../shared/membershipLetter";
import { inApplicationTransaction } from "../repos/seatApplications";
import { OPEN_INVITE_PREFIX, openInviteId, replyPromise } from "../../shared/openProposalDecide";
import { inviteById } from "../repos/memberInvites";
import { dbDocument } from "../repos/store-db";
import { registerOpenProposalDecide, type DecideRouteDeps } from "./openProposalDecide";
import { registerApplicationReview } from "./applicationReview";
import { clearReviewOf, refsDueForClearing } from "../repos/applicationReview";
import { boolVar, numberVar } from "../lib/variables";
import { makeApplicantTeller } from "../lib/applicantUpdates";
import * as store from "../repos/openProposals";
import { villageCircles } from "../repos/roleProposals";
import { activeClock } from "../lib/gratitude-cycles";
import { isTermMode, moonTermFor, moonTermWords, type OpenProposalTerm, type OpenProposalTermMode } from "../../shared/openProposalTerm";
import { isListed } from "../../shared/roleListing";
import { gateOf } from "../lib/roleCardProjection";
import { ATTACHMENT_WORDS, PROPOSAL_FILES_MAX, PROPOSAL_FILE_MAX_BYTES } from "../../shared/proposalAttachments";
import { checkProposalFiles, removeProposalFiles, sweepProposalFiles, writeProposalFiles, type UploadedFile } from "../lib/proposalFiles";

type Deps = Pick<
  AppDeps,
  "getPool" | "overLimit" | "clientIp" | "guardCapability" | "authedUser" | "commsPostOffice" | "deploymentOrigin" | "projectName" | "escapeHtml" | "seasonState"
> &
  Omit<DecideRouteDeps, "postEmail" | "now"> & {
  /** The one mail door. A suite hands in a fake to watch what would go out. */
  postEmail?: (email: OutgoingEmail) => Promise<PostResult>;
  /** The governance module's lifecycle; the roles are its own. */
  governanceLifecycle?: () => string;
  /**
   * The membership letter's inputs now (`letterSourceFrom`), so an applicant
   * aligns on the form with the words they read (Rye's answer 8). Absent: the
   * form's alignment is refused as unreadable and nothing is recorded.
   */
  letterSource?: () => LetterSource;
  /** The submissions collection's insert: an address that already has an account gets its signing request at confirm. */
  signings?: SigningDoor;
  now?: () => Date;
  /** A village variable read as a flag. Absent reads as off. */
  boolVar?: (key: string) => boolean;
  /** A text setting: the village's default track (`org.default_track`) for the card gate. */
  stringVar?: (key: string) => string;
};

/** The admin's switch for the public link (sheet 19i: on unless switched off). */
export interface OpenProposalSettings {
  publicLink: boolean;
  /** What public proposals are for: next season (the default) or the moon (shared/openProposalTerm.ts). */
  term: OpenProposalTermMode;
}

export const OPEN_SETTINGS_KEY = "open-proposals";
export const TIDY_JOB = "open-proposals-tidy";
const TIDY_EVERY_MS = 60 * 60_000;

/** A send the provider took, or one already taken under the same key. */
const WENT: ReadonlySet<PostResult["status"]> = new Set<PostResult["status"]>(["sending", "sent", "delivered", "duplicate"]);

const hashOf = (token: string): string => crypto.createHash("sha256").update(token).digest("hex");
const newToken = (): string => crypto.randomBytes(24).toString("base64url");
/** The greeting's name: a stranger typed it, so only a plain name is repeated (shared/openProposals.ts, safeGreeting). */
const firstNameOf = (name: string): string | null => safeGreeting(name);

export function register(app: Express, deps: Deps): void {
  const { getPool, overLimit, clientIp, guardCapability, authedUser, deploymentOrigin, projectName, escapeHtml } = deps;
  const postEmail = deps.postEmail ?? ((email: OutgoingEmail) => post(deps.commsPostOffice, email));
  const governance = deps.governanceLifecycle ?? (() => effectiveLifecycle("governance"));
  const now = () => (deps.now ? deps.now() : new Date());
  const site = () => deploymentOrigin().replace(/\/+$/, "");
  /** What the decision's work reads (server/lib/openProposalDecide.ts). */
  const decide = {
    getPool,
    notify: deps.notify,
    notifyAdmins: deps.notifyAdmins,
    members: deps.members,
    stageOf: deps.stageOf,
    recordStageEvent: deps.recordStageEvent,
    liveHoldersOf: deps.liveHoldersOf,
    calendar: deps.seatCalendar,
    lapse: deps.lapse,
    now,
    projectName,
    /** The village setting `org.consent_after_interviews` (role journey L5), off unless the village turned it on. */
    consentAfterInterviews: () => boolVar("org.consent_after_interviews"),
  };

  const tellApplicant = makeApplicantTeller({ getPool, members: deps.members, notify: deps.notify, postEmail, projectName });

  /** The switch, read fresh: one small row, and an admin who just flipped it sees it at once. */
  async function settings(): Promise<OpenProposalSettings> {
    const doc = dbDocument(getPool(), OPEN_SETTINGS_KEY, { publicLink: true } as any);
    await doc.load();
    const term = (doc.get() as any).term;
    return { publicLink: doc.get().publicLink !== false, term: isTermMode(term) ? term : "season" };
  }

  /**
   * What a proposal sent now is for. "season": next season, as before. "moon":
   * the moon (from its new moon to the next) inside the season running now,
   * whose id the proposal carries so adoption finds the calendar it was made on.
   */
  type Target = { season: { id: string; name: string | null; startsOn: string; endsOn: string | null }; term: OpenProposalTerm | null; goals: Array<{ id: string; text: string }> };
  /** A season's goals for the village, as the Season tab writes them; done ones drop off. */
  const goalsOf = (s: any): Array<{ id: string; text: string }> =>
    (Array.isArray(s?.goals) ? s.goals : [])
      .filter((g: any) => g && g.id && typeof g.text === "string" && g.text.trim() && !g.done)
      .map((g: any) => ({ id: String(g.id), text: String(g.text).trim() }));
  function target(mode: OpenProposalTermMode): Target | null {
    if (mode !== "moon") {
      const s = nextSeason();
      const full = s ? (deps.seasonState().seasons ?? []).find((x: any) => x && String(x.id) === s.id) : null;
      return s ? { season: s, term: null, goals: goalsOf(full) } : null;
    }
    const state = deps.seasonState();
    const cur = state.current;
    if (!cur || !cur.id || !cur.startsOn) return null;
    return {
      season: { id: String(cur.id), name: String(cur.name ?? "").trim() || null, startsOn: String(cur.startsOn), endsOn: cur.endsOn ? String(cur.endsOn) : null },
      term: moonTermFor(now(), activeClock(), state.timezone || "UTC"),
      goals: goalsOf(cur),
    };
  }

  /** Next season by the village's calendar: the first that starts after today, or null. */
  function nextSeason() {
    const state = deps.seasonState();
    const today = civilDateKey(now(), state.timezone || "UTC");
    const next = (state.seasons ?? [])
      .filter((s: any) => s && s.id && s.startsOn)
      .sort((a: any, b: any) => String(a.startsOn).localeCompare(String(b.startsOn)))
      .find((s: any) => String(s.startsOn) > today);
    return next ? { id: String(next.id), name: String(next.name ?? "").trim() || null, startsOn: String(next.startsOn), endsOn: next.endsOn ? String(next.endsOn) : null } : null;
  }

  /** The roles a stranger may propose for: live, listed, not an example, in a live circle. */
  async function offered() {
    const pool = getPool();
    const [roles, circles] = await Promise.all([listOrgRoles(pool), villageCircles(pool)]);
    const live = new Map(circles.filter((c) => c.live).map((c) => [c.id, c.name]));
    // Role journey PR-C: with the village setting on, a card that is not complete offers nothing to apply for.
    const needsCard = deps.boolVar?.("org.apply_needs_complete_card") === true;
    const nameOf = new Map(roles.map((r) => [r.id, r.name]));
    return roles
      .filter((r) => r.active && !r.isExample && isListed(r) && r.circleId && live.has(r.circleId))
      .filter((r) => !needsCard || gateOf(r, deps.stringVar?.("org.default_track") ?? null).gate.complete)
      .map((r) => ({
        id: r.id,
        name: r.name,
        circle: live.get(r.circleId as string) as string,
        aim: r.aim ?? null,
        // The open card's own sections, for the applicant to answer (shared/openProposalCard.ts).
        accountabilities: Array.isArray(r.accountabilities) ? r.accountabilities.map((a: unknown) => String(a ?? "").trim()).filter(Boolean) : [],
        whyItMatters: r.whyItMatters ?? null,
        timeCommitment: (r as any).timeCommitment ?? null,
        // A role always background-checked (0370): the form says a check happens whatever the references say.
        alwaysChecked: r.alwaysChecked === true,
        // The conversations in the role's order, as its public card shows them (role journey L5), so the
        // form and the board can say what happens next (role audit, 10 Nov 2026). The booking link is
        // not here: it is offered once the address is confirmed (L6).
        conversations: (Array.isArray(r.conversations) ? r.conversations : []).map((s) => ({
          role: nameOf.get(s.roleId) ?? s.roleId,
          minutes: s.minutes,
          ...(s.final ? { finalApproval: true } : {}),
        })),
      }));
  }

  /** Whether the form opens for this request, and through which link. */
  async function door(rawLink: unknown): Promise<{ open: false } | { open: true; linkId: string | null }> {
    if (governance() === "off") return { open: false };
    const token = typeof rawLink === "string" ? rawLink.trim() : "";
    if (token) {
      const link = token.length <= 100 ? await store.openLinkByHash(getPool(), hashOf(token)) : null;
      return link ? { open: true, linkId: link.id } : { open: false };
    }
    return (await settings()).publicLink ? { open: true, linkId: null } : { open: false };
  }

  // ── The public side ───────────────────────────────────────────────────────

  app.get("/api/open-proposals/form", async (req, res) => {
    const d = await door(req.query.link);
    if (!d.open) return res.json({ open: false, message: OPEN_WORDS.closed });
    const mode = (await settings()).term;
    const t = target(mode);
    res.json({
      open: true,
      village: projectName(),
      season: t?.season ?? null,
      term: t?.term ?? null,
      goals: t?.goals ?? [],
      ...(t ? {} : { message: mode === "moon" ? OPEN_WORDS.noCurrentSeason : OPEN_WORDS.noSeason }),
      roles: t ? await offered() : [],
    });
  });

  /*
   * FILES COME AS multipart/form-data: the proposal as JSON in one field,
   * `proposal`, and up to three files in `files`. Held in memory, capped by
   * size and count before a byte reaches disk, and checked by their own
   * first bytes (shared/proposalAttachments.ts). A plain JSON post still works.
   */
  const upload = multer({
    storage: multer.memoryStorage(),
    defParamCharset: "utf8",
    limits: { fileSize: PROPOSAL_FILE_MAX_BYTES, files: PROPOSAL_FILES_MAX, fields: 1, fieldSize: 512 * 1024 },
  }).array("files", PROPOSAL_FILES_MAX);

  app.post("/api/open-proposals", async (req, res) => {
    if (!req.is("multipart/form-data")) return intake(req, res, req.body ?? {}, []);
    // Before any file is read: the per-connection cap on posts that carry files.
    if (await overLimit(`open-proposal:upload:ip:${ipBucket(clientIp(req))}`, 5, 60 * 60_000)) return res.status(429).json({ error: OPEN_WORDS.tooMany });
    upload(req, res, (err: any) => {
      if (err) {
        const code = String(err?.code ?? "");
        const error = code === "LIMIT_FILE_SIZE" ? ATTACHMENT_WORDS.fileTooBig : code === "LIMIT_FILE_COUNT" || code === "LIMIT_UNEXPECTED_FILE" ? ATTACHMENT_WORDS.tooManyFiles : ATTACHMENT_WORDS.fileUnreadable;
        return void res.status(code === "LIMIT_FILE_SIZE" ? 413 : 400).json({ error, field: "files" });
      }
      let body: unknown;
      try {
        body = JSON.parse(String((req.body as Record<string, unknown> | undefined)?.proposal ?? ""));
      } catch {
        return void res.status(400).json({ error: OPEN_WORDS.notSent });
      }
      const files = ((req as Request & { files?: Express.Multer.File[] }).files ?? []).map((f) => ({ originalname: f.originalname, buffer: f.buffer }));
      void intake(req, res, body && typeof body === "object" ? (body as Record<string, any>) : {}, files).catch((e) => {
        console.error("[open-proposals] a proposal with files was not taken", e);
        if (!res.headersSent) res.status(500).json({ error: OPEN_WORDS.notSent });
      });
    });
  });

  async function intake(req: Request, res: Response, body: Record<string, any>, files: UploadedFile[]) {
    // Honeypot: a hidden field only a bot fills. Pretend it went, keep nothing.
    if (body.hp) return res.json({ sent: true });
    if (await overLimit(`open-proposal:ip:${ipBucket(clientIp(req))}`, 5, 60 * 60_000)) return res.status(429).json({ error: OPEN_WORDS.tooMany });
    const d = await door(body.link);
    if (!d.open) return res.status(403).json({ error: OPEN_WORDS.closed });
    const mode = (await settings()).term;
    const t = target(mode);
    if (!t) return res.status(409).json({ error: mode === "moon" ? OPEN_WORDS.noCurrentSeason : OPEN_WORDS.noSeason });
    const season = t.season;
    const roles = await offered();
    const outcomes = new Map(roles.map((r) => [r.id, r.accountabilities]));
    const alwaysChecked = new Set(roles.filter((r) => r.alwaysChecked).map((r) => r.id));
    const parsed = parseOpenProposal(body, {
      roleIds: new Set(roles.map((r) => r.id)),
      address: singlePublicAddress,
      accountabilitiesOf: (id) => outcomes.get(id) ?? [],
      goalIds: new Set(t.goals.map((g) => g.id)),
      // A goal's date must fall in this moon (shared/proposalGoals.ts).
      today: new Date().toISOString().slice(0, 10),
      alwaysChecked: (id) => alwaysChecked.has(id),
      now: now(),
    });
    if (!parsed.ok) return res.status(400).json({ error: parsed.error, field: parsed.field });
    // The files, every one checked before any is kept (Rye, 10 Nov 2026).
    if (files.length && !deps.proposalFileDir) return res.status(400).json({ error: ATTACHMENT_WORDS.fileUnreadable, field: "files" });
    const checked = checkProposalFiles(files);
    if (!checked.ok) return res.status(400).json({ error: checked.error, field: "files" });
    const { name, email } = parsed.value;
    // The term is the village's, set here and never taken from the form.
    // The goals' words are kept with the card as they read when it was sent, never taken from the form.
    const goalText = new Map(t.goals.map((g) => [g.id, g.text]));
    const card = parsed.value.body.card ? { ...parsed.value.body.card, serves: parsed.value.body.card.serves.map((x) => ({ ...x, goal: goalText.get(x.goalId) ?? "" })) } : undefined;
    /*
     * MEMBERSHIP AT APPLICATION (Rye's answer 8). The form names the letter
     * version it drew; it must be the letter as the village renders it now,
     * or nothing is sent and the form shows the letter again. Recorded only
     * once the address confirms. No payment is asked here or anywhere after.
     */
    let membership: { letterVersion: string } | null = null;
    if (body.membership !== undefined && body.membership !== null) {
      const asked = membershipOf(body.membership);
      const letter = deps.letterSource ? currentLetter(deps.letterSource()) : null;
      if (!letter) return res.status(409).json({ error: LETTER_WORDS.unreadable, field: "membership" });
      if (!asked || asked.letterVersion !== letter.version) return res.status(409).json({ error: LETTER_WORDS.changed, field: "membership", letter });
      membership = asked;
    }
    const proposal = { ...parsed.value.body, ...(card ? { card } : {}), ...(t.term ? { term: t.term } : {}), ...(membership ? { membership } : {}) };
    const emailKey = emailKeyOf(email);
    if (await overLimit(`open-proposal:email:${limiterAddressKey(emailKey)}`, 3, 24 * 60 * 60_000)) return res.status(429).json({ error: OPEN_WORDS.tooMany });
    // The last gate before an email goes: the village's overall hourly cap on confirmations.
    if (await overLimit("open-proposal:global", OPEN_GLOBAL_HOURLY, 60 * 60_000)) return res.status(429).json({ error: OPEN_WORDS.tooMany });

    const pool = getPool();
    const id = `op-${crypto.randomBytes(10).toString("hex")}`;
    const token = newToken();
    // The files go on disk BEFORE the row, so a row never names a file that is not there.
    const fileDir = deps.proposalFileDir;
    const kept = files.length && fileDir ? await writeProposalFiles(fileDir, id, files) : [];
    try {
      await store.insertOpenProposal(pool, { id, name: name.slice(0, OPEN_NAME_MAX), email, emailKey, targetSeasonId: season.id, body: { ...proposal, ...(kept.length ? { files: kept } : {}) }, confirmHash: hashOf(token), linkId: d.linkId, now: now() });
    } catch (e) {
      if (fileDir) await removeProposalFiles(fileDir, id);
      throw e;
    }

    const byId = new Map(roles.map((r) => [r.id, r.name]));
    const words = confirmLetter({
      firstName: firstNameOf(name),
      village: projectName(),
      roleNames: proposal.roles.map((r) => byId.get(r.roleId) ?? "").filter(Boolean),
      link: `${site()}/propose-a-role/confirm?token=${encodeURIComponent(token)}`,
      ...(t.term ? { when: moonTermWords(t.term) } : {}),
    });
    const sent = await postEmail({
      idempotencyKey: `open-proposal:${id}:confirm`,
      kind: "essential",
      origin: "open_proposal.confirm",
      to: { email, ...(firstNameOf(name) ? { name: firstNameOf(name) as string } : {}) },
      subject: words.subject,
      html: `<!doctype html><html><body style="font-family:system-ui,sans-serif;color:#1f2937">${words.text
        .split("\n\n")
        .map((p) => `<p>${escapeHtml(p).replace(/\n/g, "<br>")}</p>`)
        .join("")}</body></html>`,
      text: words.text,
    });
    if (!WENT.has(sent.status)) {
      // Nobody can confirm a proposal whose link never went, so it is not kept.
      await store.deleteOpenProposal(pool, id);
      if (fileDir) await removeProposalFiles(fileDir, id);
      return res.status(503).json({ error: OPEN_WORDS.notSent });
    }
    res.json({ sent: true, email, message: OPEN_WORDS.sent(email) });
  }

  /**
   * The applicant's alignment with the letter, against the address that just
   * confirmed, when the form carried one and the letter still reads as it did.
   * Changed words since: nothing is recorded, and the role start gate asks
   * them to align from their account. A failure is logged, never the person's.
   */
  async function alignedAtApplication(p: { id: string; email: string | null; body: { membership?: { letterVersion: string } } }, at: Date): Promise<void> {
    const asked = p.body.membership;
    if (!asked || !p.email || !deps.letterSource) return;
    try {
      const letter = currentLetter(deps.letterSource());
      if (letter.version !== asked.letterVersion) return;
      await inApplicationTransaction(getPool(), (conn) => alignAtApplication(conn, { letter, email: p.email as string, proposalId: p.id, now: at }));
      // An account already here with this address: carried now, with the signing request a steward accepts.
      const account = await accountFor(deps.members, p.email);
      if (account && deps.signings) {
        const m: any = await deps.members.byId(account);
        await carryToAccount(getPool(), deps.signings, { userId: account, name: String(m?.name ?? ""), email: p.email, now: at });
      }
    } catch (e) {
      console.error("[open-proposals] the membership alignment at application was not recorded", e);
    }
  }

  app.post("/api/open-proposals/confirm", async (req, res) => {
    if (await overLimit(`open-proposal:confirm:${clientIp(req)}`, 30, 60 * 60_000)) return res.status(429).json({ error: OPEN_WORDS.tooMany });
    const token = typeof req.body?.token === "string" ? req.body.token.trim() : "";
    const at = now();
    // Confirmed, and the circle asked, in one transaction (part B). A used, old or unknown token asks nobody.
    const confirmed = token && token.length <= 100 ? await confirmAndAsk(decide, hashOf(token), new Date(at.getTime() - OPEN_CONFIRM_HOURS * 60 * 60_000), at) : null;
    if (!confirmed) return res.status(410).json({ error: OPEN_WORDS.confirmGone });
    await alignedAtApplication(confirmed.proposal, at);
    try {
      await tellTheCircle(decide, confirmed);
    } catch (e) {
      // The asks are written and wait under Tasks; a notice that did not go is not the person's problem.
      console.error("[open-proposals] the circle could not all be told", e);
    }
    // The applicant's own page: the step, who acts next, by when. The link is shown once and mailed; only its hash is kept.
    let statusPath: string | null = null;
    if (confirmed.review?.statusToken) {
      statusPath = `/application-status/${encodeURIComponent(confirmed.proposal.id)}?token=${encodeURIComponent(confirmed.review.statusToken)}`;
      if (confirmed.proposal.email) {
        const text = `Your proposal is with the village. Follow where it is, who acts next and by when:

${site()}${statusPath}

${replyPromise(numberVar("org.applicant_reply_days"))} Keep this link to yourself: it is how we know it is you.`;
        try {
          await postEmail({
            idempotencyKey: `open-proposal:${confirmed.proposal.id}:status`,
            kind: "essential",
            origin: "open_proposal.status",
            to: { email: confirmed.proposal.email },
            subject: "Where your proposal is",
            html: `<!doctype html><html><body style="font-family:system-ui,sans-serif;color:#1f2937">${text
              .split("\n\n")
              .map((para) => `<p>${escapeHtml(para).replace(/\n/g, "<br>")}</p>`)
              .join("")}</body></html>`,
            text,
          });
        } catch (e) {
          console.error("[open-proposals] the status link could not be mailed", e);
        }
      }
    }
    // Somebody who already has an account reads it on their profile too; the email above is theirs either way.
    await tellApplicant(confirmed.proposal.id, "confirmed");
    res.json({ confirmed: true, message: OPEN_WORDS.confirmed, statusPath });
  });

  // ── The desk ──────────────────────────────────────────────────────────────

  app.get("/api/admin/open-proposals", async (req, res) => {
    if (!(await guardCapability(req, res, "intake.moderate"))) return;
    const pool = getPool();
    const [s, links, waiting, roles] = await Promise.all([settings(), store.listOpenLinks(pool), store.listOpenProposals(pool, ["confirmed"]), offered()]);
    const roleName = new Map(roles.map((r) => [r.id, `${r.name} (${r.circle})`]));
    const linkLabel = new Map(links.map((l) => [l.id, l.label]));
    res.json({
      publicLink: s.publicLink,
      term: s.term,
      publicPath: "/propose-a-role",
      links: links.map((l) => ({ id: l.id, label: l.label, createdAt: l.createdAt, on: !l.revokedAt })),
      proposals: waiting.map((p) => ({
        id: p.id,
        name: p.name,
        email: p.email,
        seasonId: p.targetSeasonId,
        via: p.linkId ? (linkLabel.get(p.linkId) ?? null) : null,
        roles: p.body.roles.map((r) => ({ roleId: r.roleId, name: roleName.get(r.roleId) ?? null, note: r.note })),
        why: p.body.why,
        aim: p.body.aim,
        term: p.body.term ?? null,
        createdAt: p.createdAt,
        confirmedAt: p.confirmedAt,
      })),
    });
  });

  app.put("/api/admin/open-proposals/settings", async (req, res) => {
    if (!(await guardCapability(req, res, "intake.moderate"))) return;
    const hasLink = req.body?.publicLink !== undefined;
    const hasTerm = req.body?.term !== undefined;
    if (!hasLink && !hasTerm) return res.status(400).json({ error: "Say whether the public link is on." });
    if (hasLink && typeof req.body.publicLink !== "boolean") return res.status(400).json({ error: "Say whether the public link is on." });
    if (hasTerm && !isTermMode(req.body.term)) return res.status(400).json({ error: "Proposals are for next season or this moon.", field: "term" });
    const standing = await settings();
    const next = { publicLink: hasLink ? req.body.publicLink : standing.publicLink, term: hasTerm ? req.body.term : standing.term };
    const doc = dbDocument(getPool(), OPEN_SETTINGS_KEY, { publicLink: true } as any);
    await doc.put(next as any);
    const message = hasTerm
      ? next.term === "moon" ? "Public proposals are now for this moon, from its new moon to the next." : "Public proposals are now for next season."
      : next.publicLink ? OPEN_WORDS.publicOn : OPEN_WORDS.publicOff;
    res.json({ ...next, message });
  });

  app.post("/api/admin/open-proposals/links", async (req, res) => {
    if (!(await guardCapability(req, res, "intake.moderate"))) return;
    const user = await authedUser(req);
    if (!user) return res.status(401).json({ error: "auth_required" });
    const label = typeof req.body?.label === "string" ? req.body.label.trim().slice(0, OPEN_NAME_MAX) : "";
    if (!label) return res.status(400).json({ error: "Say who the link is for, so you can tell your links apart." });
    const id = `opl-${crypto.randomBytes(8).toString("hex")}`;
    const token = newToken();
    await store.insertOpenLink(getPool(), { id, tokenHash: hashOf(token), label, createdBy: String(user.id), now: now() });
    // The only answer that ever carries the token: only its hash is kept.
    res.json({ id, label, url: `${site()}/propose-a-role/${encodeURIComponent(token)}`, message: OPEN_WORDS.linkMade });
  });

  app.post("/api/admin/open-proposals/links/:id/revoke", async (req, res) => {
    if (!(await guardCapability(req, res, "intake.moderate"))) return;
    const off = await store.revokeOpenLink(getPool(), String(req.params.id ?? ""), now());
    if (!off) return res.status(404).json({ error: "There is no link by that id that is still on." });
    res.json({ success: true, message: OPEN_WORDS.linkOff });
  });

  // ── The tidy job (sheet 19i) ──────────────────────────────────────────────

  registerJob(TIDY_JOB, TIDY_EVERY_MS, async () => tidyOpenProposals(getPool(), now(), deps.proposalFileDir));

  // ── The decision (part B) ─────────────────────────────────────────────────

  registerOpenProposalDecide(app, { ...deps, postEmail, now });
  /*
   * FIRST, THE MEMBERSHIP MADE AT APPLICATION (Rye's answer 8). An account made
   * through the invitation carries it, and queues the signing a steward accepts.
   * Registered before the placement below, because the hooks run in order and
   * the role start gate then reads the letter on the account.
   */
  if (deps.signings) {
    const signings = deps.signings;
    whenInvitedArrives(OPEN_INVITE_PREFIX, async ({ userId }) => {
      const m: any = await deps.members.byId(userId);
      if (!m?.email) return;
      await carryToAccount(getPool(), signings, { userId, name: String(m.name ?? ""), email: String(m.email), now: now() });
    });
  }
  // Review, interviews and selection (role journey L5): scorecards, recusal, the applicant's page and the ballot fallback.
  registerApplicationReview(app, { ...deps, postEmail, now });
  // A sign-up through an adopted proposal's invitation finishes the adoption, whichever door it came by.
  whenInvitedArrives(OPEN_INVITE_PREFIX, arrivalFor(decide));
  // The sign-up page names the roles and gives back the name and address sent (role audit, 10 Nov 2026).
  whenInviteDescribed(OPEN_INVITE_PREFIX, describeFor(decide));
}

/**
 * Delete what was never confirmed after 48 hours; take the name and address
 * off what was declined or withdrawn after 90 days, and off what was adopted 90
 * days ago when nobody arrived through its invitation. An adoption onto an
 * account already here made no invitation: that person is a member, and keeps
 * theirs.
 */
export async function tidyOpenProposals(pool: Pool, at: Date, fileDir?: string): Promise<string> {
  const deleted = await store.deleteUnconfirmedBefore(pool, new Date(at.getTime() - OPEN_CONFIRM_HOURS * 60 * 60_000));
  const cutoff = new Date(at.getTime() - OPEN_ANONYMISE_DAYS * 24 * 60 * 60_000);
  // Confirmed, and nobody decided it in 90 days: closed as withdrawn, and the name and address go now (red team, 9 Nov).
  const expired = await store.expireUndecidedBefore(pool, cutoff, at);
  let anonymised = await store.anonymiseDecidedBefore(pool, cutoff, at);
  for (const p of await store.adoptedDecidedBefore(pool, cutoff)) {
    const invite = await inviteById(pool, openInviteId(p.id));
    if (!invite || invite.usedByUserId) continue;
    if (await store.anonymiseOpenProposal(pool, p.id, at)) anonymised += 1;
  }
  // Scores and conversation notes follow the application's retention (role journey L5): cleared with the name and address.
  const cleared = await clearReviewOf(pool, await refsDueForClearing(pool, cutoff), at);
  if (cleared > 0) console.log(`[open-proposals] ${cleared} reviews cleared with their anonymised applications`);
  // Files follow the row (Rye, 10 Nov 2026): a deleted or anonymised proposal keeps none.
  const files = fileDir ? await sweepProposalFiles(fileDir, (ids) => store.proposalsKeepingFiles(pool, ids)) : 0;
  return `${deleted} unconfirmed deleted, ${expired} undecided closed, ${anonymised} anonymised${files ? `, ${files} file folders removed` : ""}`;
}
