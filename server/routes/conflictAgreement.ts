/**
 * THE CONFLICT AGREEMENT: reading it, writing it, changing it by vote, and the
 * ombuds door (plan sections 6.2 and 6.3).
 *
 *   GET  /api/conflict-agreement/public            anybody: roles only, no names
 *   GET  /api/conflict-agreement                   members and admins: the whole agreement
 *   PUT  /api/admin/conflict-agreement             the founders, before the Birthing
 *   POST /api/governance/conflict-agreement-changes  a member, after the Birthing: a structural ballot
 *   POST /api/conflict-agreement/ombuds-asks       a member asks an outside contact to talk
 *
 * The rules are in server/lib/conflictAgreement.ts and shared/conflictAgreement.ts;
 * this file is the doors.
 *
 * ── CORE, AND ALWAYS ON ───────────────────────────────────────────────────
 *
 * No `requireModule` stands in front of the reads, the admin write or the
 * ombuds door: a conflict path is part of every village, like leaving is.
 * The change ballot sits under `/api/governance`, which server/index.ts mounts
 * behind the governance module before this register() runs, because a ballot
 * is governance; the launch checklist already blocks the Birthing until that
 * module is open to members.
 *
 * ── THE CONSEQUENCE PEN, TWO DOORS, ONE OPEN AT A TIME ────────────────────
 *
 * Before the Birthing the admin PUT writes and the ballot refuses; after it,
 * the reverse. Both read `readGameStart`, the one answer to "has this village
 * started". The ballot is opened by a member holding `proposal.open` AS A
 * MEMBER, the rule every village ceremony here keeps, and it freezes the
 * structural tier through the subject's own floor in shared/ballotSubjects.ts.
 *
 * ── WHAT THE PUBLIC READS ─────────────────────────────────────────────────
 *
 * Roles, never people. `publicAgreementView` withholds every piece of text
 * that names a member of this village, leaves the safety contacts out, and
 * names outside contacts by organisation or role.
 *
 * ── THE OMBUDS DOOR ───────────────────────────────────────────────────────
 *
 * A member asks one of the agreement's outside contacts to talk. The server
 * keeps who asked, when and which contact (`ombuds-asks`), answers with how to
 * reach them, and sends nothing to anybody. A body carrying anything beyond
 * the contact's id is refused, so no member believes their words went
 * somewhere. The member reads their own asks back on the members' GET, and no
 * route reads anybody else's.
 */
import type { Express } from "express";
import type { AppDeps } from "../lib/appDeps";
import { openBallot, openBallotFor } from "../lib/ballots";
import { decisionLink, notifyRollRows } from "../lib/ballotNotices";
import {
  AGREEMENT_FOUNDERS_NOW,
  AGREEMENT_MEMBERS_ONLY,
  CONFLICT_AGREEMENT_PROPOSAL_KEY,
  OMBUDS_ASKS_KEY,
  agreementForAdoption,
  asksBy,
  conflictAgreementWrite,
  effectiveAgreement,
  memberNameMatcher,
  ombudsAskProblem,
  ombudsPointer,
  proposedAgreement,
  publicAgreementView,
} from "../lib/conflictAgreement";
import { recordEvent } from "../lib/events";
import { DEFAULT_EXIT_POLICY } from "../lib/exitPolicy";
import { readGameStart } from "../lib/gameStart";
import { liveIntakeRecipients, type IntakeHolding } from "../lib/restorativeIntake";
import { numberVar, stringVar } from "../lib/variables";
import { appendToConfigList, readConfigDocument, writeConfigDocument } from "../repos/appConfigDocs";
import { thresholdsFor } from "../../shared/ballotSubjects";
import { capabilityDecision, hasCapability } from "../../shared/capabilities";
import {
  CONFLICT_AGREEMENT,
  LADDER_RUNGS,
  agreementForReaders,
  contactLabel,
  sameContent,
  stepLine,
  type ConflictAgreementContent,
} from "../../shared/conflictAgreement";
import { villageBallotMethod, type BallotMethod } from "../../shared/governanceEngine";

/** The one subject ref, so a second change cannot open while one is running (`open_key` is unique while open). */
export const AGREEMENT_BALLOT_REF = "agreement";

/** The agreement's cached handle, `conflictAgreementRepo` in server/index.ts. */
export interface AgreementHandle {
  get(): unknown;
  put(doc: any): Promise<unknown>;
}

type Deps = Pick<
  AppDeps,
  | "authedUser"
  | "isAdmin"
  | "adminActor"
  | "hasMembership"
  | "getPool"
  | "capabilityCtx"
  | "firstName"
  | "members"
  | "loadRoles"
  | "notify"
  | "overLimit"
  | "weightModeNow"
> & {
  agreement: AgreementHandle;
  /** The exit policy's reader copy. With no stored agreement, its restorative fields are the agreement's defaults. */
  readExitPolicy(): any;
  /** Every role_holders row, for how many people hold each role today. */
  roleHolders(): ReadonlyArray<IntakeHolding>;
  buildElectorate(): Promise<Array<{ userId: string; weight: number }>>;
  addActivity(
    kind: string,
    text: string,
    extra?: { actorUserId?: string | null; entityType?: string | null; entityRef?: string | null },
  ): Promise<unknown>;
};

/** The platform's starting steps, which an adoption may not claim as the village's words. */
const PLATFORM_STEPS = DEFAULT_EXIT_POLICY.restorative.steps;

/** What the ballot document prints where a piece of the proposal names a member. */
export const BALLOT_NAME_WITHHELD = "This part names a person, so members read it on the governance page.";

/**
 * THE BALLOT DOCUMENT: every part of what the vote would adopt.
 *
 * A ballot can be read by more people than the membership (the governance
 * module's lifecycle decides who), so it keeps the public view's rules: text
 * naming a member is withheld, outside contacts are their organisation or
 * role, and the members-only parts (the safety contacts, and who each outside
 * contact is and how to reach them) say only whether the vote changes them.
 * Members read all of it in full on the governance page, beside the vote
 * (`openBallot.proposal` on GET /api/conflict-agreement). Nothing the vote
 * would adopt is left off this page, so no part of it can change unseen.
 */
function ballotDocument(
  c: ConflictAgreementContent,
  standing: ConflictAgreementContent,
  roleName: (id: string) => string | null,
  namesMember: (text: string) => boolean,
  askedBy: string,
): string {
  const g = (text: string) => (namesMember(text) ? BALLOT_NAME_WITHHELD : text);
  const role = (id: string) => g(roleName(id) ?? id);
  const same = (x: unknown, y: unknown) => JSON.stringify(x) === JSON.stringify(y);
  const people = (list: ConflictAgreementContent["outsideContacts"]) => list.map((o) => [o.id, o.name, o.howToReach]);
  const lines: string[] = ["# The village asks to change its conflict agreement", "", "## The steps", ""];
  c.steps.forEach((s, i) => lines.push(`${i + 1}. ${stepLine({ what: g(s.what), whoInRoom: s.whoInRoom ? g(s.whoInRoom) : "" })}`));
  lines.push("", "## Who hears it first", "");
  lines.push(c.careRole ? `The ${role(c.careRole)} role.` : "No care role.");
  if (c.coverRole) lines.push(`Cover: the ${role(c.coverRole)} role.`);
  for (const o of c.outsideContacts) lines.push(`Outside the village: ${g(contactLabel(o))}.`);
  lines.push("", "## The reply time", "", c.replyHours === null ? "Not promised." : `Within ${c.replyHours} hours.`);
  const p = c.whenPowerInvolved;
  const powerContact = c.outsideContacts.find((o) => o.id === p.outsideContactId);
  lines.push("", "## When it involves someone who holds power here", "");
  lines.push(
    p.roleId ? `It goes to the ${role(p.roleId)} role instead.` : powerContact ? `It goes to ${g(contactLabel(powerContact))} instead.` : "Nobody is named to hold it instead.",
  );
  if (p.words) lines.push("", g(p.words));
  if (c.consequencesLadder.rungs.length) {
    lines.push("", "## Consequences and appeal", "");
    for (const r of c.consequencesLadder.rungs) lines.push(`- ${LADDER_RUNGS[r.rung].name}: ${g(r.words)}`);
    if (c.consequencesLadder.appeal) lines.push("", `Appeal: ${g(c.consequencesLadder.appeal)}`);
  }
  if (c.practices.length) {
    lines.push("", "## Practices", "");
    for (const pr of c.practices) lines.push(`- ${g(pr.name)}${pr.when ? `: ${g(pr.when)}` : ""}`);
  }
  lines.push(
    "",
    "## The parts members read in full",
    "",
    "Anyone who can open this vote can read this page, so these parts show here only as changed or the same. Members read them in full on the governance page, beside this vote.",
    "",
    `- The safety contacts: ${same(c.safetyContacts, standing.safetyContacts) ? "the same as today" : "changed"}.`,
    `- Who each outside contact is, and how to reach them: ${same(people(c.outsideContacts), people(standing.outsideContacts)) ? "the same as today" : "changed"}.`,
    "",
    "## What changes if this carries",
    "",
    `The whole agreement above becomes the village's from the day it lands, the parts members read in full included, and the restorative path on the exit policy reads from it. It comes back for review on ${c.reviewDate}.`,
    "",
    `Asked by ${askedBy} on ${new Date().toISOString().slice(0, 10)}.`,
    "",
  );
  return lines.join("\n");
}

export function register(app: Express, deps: Deps): void {
  const { authedUser, isAdmin, getPool } = deps;

  const roleIds = () => deps.loadRoles().map((r) => String(r.id));
  const current = () => effectiveAgreement(deps.agreement.get(), deps.readExitPolicy()?.restorative, roleIds());
  const namesMember = async () => memberNameMatcher((await deps.members.all()).map((m: any) => m?.name));

  /** Members read it whole, and so do admins. */
  const mayRead = async (req: Parameters<Deps["isAdmin"]>[0], user: any) => deps.hasMembership(user) || (await isAdmin(req));

  app.get("/api/conflict-agreement/public", async (_req, res) => {
    const { agreement, stored } = current();
    if (!stored) return res.json({ stored: false, agreement: null });
    res.json({ stored: true, agreement: publicAgreementView(agreement, deps.loadRoles(), await namesMember()) });
  });

  app.get("/api/conflict-agreement", async (req, res) => {
    const user = await authedUser(req);
    if (!user) return res.status(401).json({ error: "auth_required" });
    if (!(await mayRead(req, user))) return res.status(403).json({ error: AGREEMENT_MEMBERS_ONLY });
    const pool = getPool();
    const { agreement, stored } = current();
    const started = (await readGameStart(pool)).started;
    const admin = await isAdmin(req);
    const ctx = await deps.capabilityCtx(user);
    const holders = deps.roleHolders();
    const open = await openBallotFor(pool, CONFLICT_AGREEMENT, AGREEMENT_BALLOT_REF);
    const platformSteps =
      agreement.steps.length === PLATFORM_STEPS.length &&
      agreement.steps.every((s, i) => s.what.replace(/\s+/g, " ").trim().toLowerCase() === PLATFORM_STEPS[i].toLowerCase());
    res.json({
      stored,
      agreement: agreementForReaders(agreement),
      roles: deps.loadRoles().map((r) => ({ id: r.id, name: r.name, liveHolders: liveIntakeRecipients(holders, r.id).length })),
      platformSteps,
      pen: {
        how: started ? "ballot" : "founders",
        mayWrite: !started && admin,
        mayPropose: started && capabilityDecision("proposal.open", { ...ctx, isAdmin: false }).allowed,
      },
      // What the open vote would adopt, whole: the ballot's own page holds back names and the members-only parts.
      openBallot: open
        ? {
            id: open.id,
            title: open.title,
            closesAt: open.closesAt,
            proposal: proposedAgreement(await readConfigDocument(pool, CONFLICT_AGREEMENT_PROPOSAL_KEY), open.id, roleIds()),
          }
        : null,
      yourAsks: asksBy(await readConfigDocument(pool, OMBUDS_ASKS_KEY), String(user.id)),
    });
  });

  /**
   * THE FOUNDERS WRITE IT, BEFORE THE BIRTHING. `{ agreement, adopt }`.
   *
   * Gated `isAdmin`, the gate the exit policy's own PUT calls, because no
   * transferable power covers the exit policy and this document answers its
   * restorative block. WRITES THROUGH THE CACHED HANDLE, so the exit policy's
   * readers see the new words at once.
   */
  app.put("/api/admin/conflict-agreement", async (req, res) => {
    if (!(await isAdmin(req))) return res.status(401).json({ error: "auth_required" });
    const pool = getPool();
    const actor = deps.adminActor(req);
    const before = current().agreement;
    const answer = conflictAgreementWrite(req.body, {
      storedRaw: deps.agreement.get(),
      roleIds: roleIds(),
      platformSteps: PLATFORM_STEPS,
      actorId: actor?.id ?? null,
      now: new Date(),
      gameStarted: (await readGameStart(pool)).started,
    });
    if (!answer.ok) return res.status(answer.status).json({ error: answer.error, frame: answer.frame ?? null });
    if (answer.changed) {
      await deps.agreement.put(answer.doc);
      await recordEvent(pool, {
        kind: "audit",
        text: `conflict-agreement:${answer.doc.adoptedAt ? "adopted" : "draft"}:v${answer.doc.version}`,
        actorUserId: actor?.id ?? null,
        entityType: "app_config",
        entityRef: "conflict-agreement",
        audience: "admin",
      });
      if (answer.doc.adoptedAt && answer.doc.adoptedAt !== before.adoptedAt) {
        await recordEvent(pool, {
          kind: "governance",
          text: "The founders adopted the village's conflict agreement. It is on the governance page.",
          actorUserId: actor?.id ?? null,
          entityType: "app_config",
          entityRef: "conflict-agreement",
          audience: "public",
        });
      }
    }
    res.json({ success: true, changed: answer.changed, stored: true, agreement: agreementForReaders(answer.doc) });
  });

  /**
   * THE VILLAGE VOTES TO CHANGE IT, AFTER THE BIRTHING. `{ agreement }`.
   *
   * The whole of what would be adopted is checked here, by the same
   * `agreementForAdoption` the founders' adoption and the closer call, and
   * written INSIDE the transaction that opens the ballot, so a ballot never
   * exists without the agreement it would adopt.
   */
  app.post("/api/governance/conflict-agreement-changes", async (req, res) => {
    const user = await authedUser(req);
    if (!user) return res.status(401).json({ error: "auth_required" });
    const pool = getPool();
    if (!(await readGameStart(pool)).started) return res.status(409).json({ error: AGREEMENT_FOUNDERS_NOW });

    const ctx = await deps.capabilityCtx(user);
    if (!capabilityDecision("proposal.open", { ...ctx, isAdmin: false }).allowed) {
      return res.status(403).json({
        error: hasCapability("proposal.open", ctx)
          ? "Changing the conflict agreement is the village's own act. Opening the vote takes somebody who holds proposal.open as a member of this village, and your only path to it today is your administrator account."
          : "Opening a vote for the whole village is for a proposal.open holder",
      });
    }

    const now = new Date();
    const checked = agreementForAdoption(req.body?.agreement ?? req.body, { roleIds: roleIds(), platformSteps: PLATFORM_STEPS, now });
    if (!checked.ok) return res.status(400).json({ error: checked.error, frame: checked.frame });
    const standing = current();
    if (standing.stored && sameContent(standing.agreement, checked.content)) {
      return res.status(409).json({ error: "That is what the agreement already says." });
    }

    const villageMethod = villageBallotMethod(stringVar("governance.default_method"));
    const dials = thresholdsFor(
      { subjects: [CONFLICT_AGREEMENT] },
      villageMethod === "hypha" ? "custom" : (villageMethod as BallotMethod),
      {
        unityPct: Math.max(0, numberVar("governance.unity_pct")),
        quorumPct: Math.max(0, numberVar("governance.quorum_pct")),
      },
    );
    const conducts: BallotMethod = dials.method ?? (villageMethod === "hypha" ? "custom" : villageMethod);
    const snapshot = deps.weightModeNow();
    const roleName = (id: string) => deps.loadRoles().find((r) => r.id === id)?.name ?? null;
    const electorate = await deps.buildElectorate();
    const title = "The village asks to change its conflict agreement";

    const result = await openBallot(pool, {
      subjectType: CONFLICT_AGREEMENT,
      subjectRef: AGREEMENT_BALLOT_REF,
      title,
      docMarkdown: ballotDocument(checked.content, standing.agreement, roleName, await namesMember(), deps.firstName(user.name)),
      method: conducts,
      weightMode: snapshot.mode,
      weightToken: snapshot.token,
      unityPct: dials.unityPct,
      quorumPct: dials.quorumPct,
      durationDays: Math.max(1, numberVar(conducts === "consent" ? "governance.consent_window_days" : "governance.vote_days")),
      openedBy: user.id,
      electorate,
      onOpen: (conn, ballotId) =>
        writeConfigDocument(conn, CONFLICT_AGREEMENT_PROPOSAL_KEY, {
          ballotId,
          agreement: checked.content,
          proposedBy: String(user.id),
          proposedAt: now.toISOString(),
        }),
    });
    if (!result.ok) return res.status(409).json({ error: result.error, ballotId: result.alreadyOpen?.id ?? null });

    await deps.addActivity("governance", "The village is deciding whether to change its conflict agreement.", {
      actorUserId: user.id,
      entityType: "ballot",
      entityRef: result.ballot.id,
    });
    void notifyRollRows({ pool, notify: deps.notify, link: decisionLink }, result.ballot, {
      type: "ballot_opened",
      title: "The village is asked whether to change its conflict agreement",
      body: `Voting is open until ${new Date(result.ballot.closesAt).toLocaleDateString()}.`,
      keySuffix: "open",
      except: [user.id],
      roll: electorate.map((e) => e.userId),
    });
    res.json({
      success: true,
      ballot: {
        id: result.ballot.id,
        subjectType: result.ballot.subjectType,
        title: result.ballot.title,
        unityPct: result.ballot.unityPct,
        quorumPct: result.ballot.quorumPct,
        closesAt: result.ballot.closesAt,
      },
    });
  });

  /**
   * THE OMBUDS DOOR. `{ contactId }`, and nothing else.
   *
   * Keeps a pointer (who asked, when, which contact) and answers with how to
   * reach them. Three a day per member, like the restorative intake, counted
   * only for asks that are kept: a refused one records nothing and costs
   * nothing. A contact the member has asked keeps showing how to reach them on
   * the page (from `yourAsks`), so looking again never takes another ask.
   */
  app.post("/api/conflict-agreement/ombuds-asks", async (req, res) => {
    const user = await authedUser(req);
    if (!user) return res.status(401).json({ error: "auth_required" });
    if (!(await mayRead(req, user))) return res.status(403).json({ error: AGREEMENT_MEMBERS_ONLY });
    const { agreement } = current();
    const problem = ombudsAskProblem(req.body, agreement);
    if (problem) return res.status(problem.status).json({ error: problem.error });
    if (await deps.overLimit(`ombuds:${user.id}`, 3, 24 * 60 * 60 * 1000)) {
      return res.status(429).json({
        error: "You have asked three times today, the most for one day. Each ask is recorded, and every contact you asked shows how to reach them on this page.",
      });
    }
    const now = new Date();
    const pointer = ombudsPointer(
      agreement,
      String(req.body.contactId),
      String(user.id),
      now,
      `oa-${now.getTime().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    );
    await appendToConfigList(getPool(), OMBUDS_ASKS_KEY, "asks", { ...pointer });
    const c = agreement.outsideContacts.find((x) => x.id === pointer.contactId)!;
    res.status(201).json({
      recorded: { id: pointer.id, contactId: pointer.contactId, contactLabel: pointer.contactLabel, askedAt: pointer.askedAt },
      contact: { id: c.id, name: c.name, organisation: c.organisation, role: c.role, howToReach: c.howToReach },
    });
  });
}
