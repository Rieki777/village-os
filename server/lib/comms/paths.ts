/**
 * PEOPLE ON PATHS: who joins which path, how, and what that starts (the comms
 * build spec 5.11).
 *
 * ── WHAT WRITES A PATH ROW ─────────────────────────────────────────────────
 *
 *   path_joined     a member chose a path at sign-up or in their profile
 *   path_left       a member dropped one in their profile
 *   form_submitted  a public form that feeds a path (`pathForForm`), with its
 *                   "walk me through the next steps" box ticked
 *   housing_status  a new housing request with the box ticked (resident)
 *
 * A path row is the fact (`path_enrollments`, server/repos/pathEnrollments.ts).
 * The journey is what that fact starts: the person is enrolled on
 * `path.<id>` with subject `path:<id>` (5.6). A request to join a village
 * that admits by invitation is not a path; it starts `joining.request` with
 * subject `form:<submissionId>`, and a new member starts `member.welcome` on
 * `account`.
 *
 * ── PERMISSION ─────────────────────────────────────────────────────────────
 *
 * A member who chose a path has said yes to path emails through their account
 * (server/lib/comms/permissions.ts derives it from `users.paths`), so nothing
 * is written for them. Somebody who ticked a form's box said yes in words:
 * that is written as a `paths` permission, basis `asked`, with the form and
 * the words they were shown as its evidence. An unticked box writes nothing
 * and starts nothing: the form's own acknowledgement is all they get.
 *
 * Enrolling ignores whether the journey is on: a journey that is off holds
 * its people, and turning it on sends what is still worth sending (5.6). The
 * post office checks permission again before anything leaves.
 *
 * ── THE GOALS, ON TRIGGERS ─────────────────────────────────────────────────
 *
 * A goal stops the journey and marks the path row done. The tick finds every
 * goal through its stop rules (./pathConditions.ts); the triggers that report
 * one directly (a reservation reserved, a proposal or a call accepted, an
 * admission, a declined request) stop it at once as well, so nobody gets one
 * more email in the minutes between.
 *
 * No raw SQL: the statements are in server/repos/.
 */
import crypto from "node:crypto";
import type { Pool } from "mysql2/promise";
import { emailKeyOf } from "../../../shared/comms/address";
import { subjectRef, type CommsTrigger, type JourneyDefinition } from "../../../shared/comms/contracts";
import { pathJourneyKey } from "../../../shared/comms/defaults/journeys";
import { guestPersonKey } from "../../../shared/comms/kinds";
import { contactByEmailKey } from "../../repos/commsContacts";
import { saveJourneyVersion } from "../../repos/commsJourneys";
import { submissionPerson } from "../../repos/commsPathFacts";
import { activePathRows, joinPathRow, leavePathRow, markPathDone, type PathEnrollmentRow } from "../../repos/pathEnrollments";
import { usersRepo } from "../../repos/users";
import { isExampleUser } from "../examples";
import { isTombstone } from "../oauthAccounts";
import { ensureContact } from "./contacts";
import { journeyStatus, platformDefinition, type DefinitionDeps, type JourneyStatus } from "./journeyDefinitions";
import { enroll, stop } from "./journeys";
import { FORM_TYPE_TO_PATHWAY } from "./mailer";
import { setPermission, suppressionsPortFor, type MembersPort } from "./permissions";
import { readCommsSettings } from "./settings";

// ── Which form feeds which path ─────────────────────────────────────────────

/** The email-config inbox a path's mail is routed to, and back. */
export const PATHWAY_OF_PATH: Readonly<Record<string, "investor" | "steward" | "resident" | "prosperity">> = {
  investor: "investor",
  steward: "steward",
  resident: "resident",
  "prosperity-creator": "prosperity",
};

const PATH_OF_PATHWAY: Readonly<Record<string, string>> = {
  investor: "investor",
  steward: "steward",
  resident: "resident",
  prosperity: "prosperity-creator",
};

/**
 * Form types `FORM_TYPE_TO_PATHWAY` routes to an inbox that are NOT somebody
 * choosing a path: a general note to the team, and a quest somebody would
 * like to see. They go to an inbox because of who reads them, and saying yes
 * to their box would put a stranger on a path they never asked about.
 */
const INBOX_ONLY_FORMS: ReadonlySet<string> = new Set(["contact", "quest-proposal"]);

/** Forms that feed a path and are not in the inbox map: steward interest. */
const EXTRA_PATH_FORMS: Readonly<Record<string, string>> = { "steward-interest": "steward" };

/** The form that asks to join a village that admits by invitation (5.6 `membership_requested`). */
export const JOINING_FORM_TYPE = "membership-request";

/** The journey keys this file starts besides the paths. */
export const MEMBER_WELCOME = "member.welcome";
export const JOINING_REQUEST = "joining.request";

/** The path a submitted form puts somebody on when its box is ticked, or null. */
export function pathForForm(formType: string): string | null {
  if (INBOX_ONLY_FORMS.has(formType)) return null;
  if (EXTRA_PATH_FORMS[formType]) return EXTRA_PATH_FORMS[formType];
  const pathway = FORM_TYPE_TO_PATHWAY[formType];
  return pathway ? (PATH_OF_PATHWAY[pathway] ?? null) : null;
}

/** The path a journey key names (`path.<id>`), or null. */
export function pathIdOfJourney(journeyKey: string): string | null {
  return journeyKey.match(/^path\.([a-z0-9][a-z0-9-]{0,62})$/)?.[1] ?? null;
}

// ── What this file is handed ────────────────────────────────────────────────

export interface PathDeps {
  getPool(): Pool;
  /** The members repository. Absent: read straight from the users table. */
  members?: Pick<MembersPort, "byId" | "byEmail"> & Partial<Pick<MembersPort, "update">>;
}

const membersOf = (deps: PathDeps): Pick<MembersPort, "byId" | "byEmail"> => deps.members ?? usersRepo(deps.getPool());

/** A member record that is a real, present person, or null. */
function realMember(m: any): any | null {
  if (!m || isExampleUser(m) || isTombstone({ email: String(m.email ?? "") })) return null;
  return m;
}

const newPathRowId = (): string => `pe_${crypto.randomBytes(12).toString("hex")}`;

/** Somebody a trigger names, made concrete: their contact, their key on the path, their account. */
export interface PathPersonRef {
  contactId: string | null;
  /** A user id, or `guest:<contactId>`. Null when neither can be known (no account and no usable address). */
  personKey: string | null;
  userId: string | null;
  email: string | null;
  name: string | null;
}

/**
 * Who a trigger is about. An account named by id wins; else an address that
 * belongs to an account answers as that account, so one person never walks
 * the same path twice under two keys; else they are a guest of the address
 * book.
 */
export async function resolvePerson(
  deps: PathDeps,
  input: { userId?: string | null; email?: string | null; name?: string | null; source: string },
): Promise<PathPersonRef> {
  const members = membersOf(deps);
  let member = input.userId ? realMember(await members.byId(input.userId)) : null;
  if (!member && input.email) member = realMember(await members.byEmail(input.email));
  const email = (input.email && input.email.trim()) || (member?.email ? String(member.email) : null);
  const name = (input.name && input.name.trim()) || (member?.name ? String(member.name) : null);
  const userId = member ? String(member.id) : null;
  const contact = email
    ? await ensureContact(deps, { email, name, userId, source: member && !input.email ? "account" : input.source })
    : null;
  const personKey = userId ?? (contact ? guestPersonKey(contact.id) : null);
  return { contactId: contact?.id ?? null, personKey, userId, email, name };
}

// ── Joining, leaving, done ──────────────────────────────────────────────────

/** The journey a path starts, when the village has one for it. */
const hasPathJourney = (pathId: string): boolean => platformDefinition(pathJourneyKey(pathId)) !== null;

/**
 * Put a person on a path and on its journey. `walk: false` records the path
 * and starts nothing, which is what the backfill does.
 */
export async function joinPath(
  deps: PathDeps,
  person: PathPersonRef,
  pathId: string,
  source: string,
  opts: { walk?: boolean } = {},
): Promise<{ row: PathEnrollmentRow; outcome: "created" | "reactivated" | "already"; enrollmentId: string | null } | null> {
  if (!person.personKey) return null;
  const pool = deps.getPool();
  const { row, outcome } = await joinPathRow(pool, {
    id: newPathRowId(),
    personKey: person.personKey,
    userId: person.userId,
    contactId: person.contactId,
    pathId,
    source,
  });
  let enrollmentId: string | null = null;
  if (opts.walk !== false && person.contactId && hasPathJourney(pathId)) {
    const done = await enroll(deps, {
      journeyKey: pathJourneyKey(pathId),
      contactId: person.contactId,
      subjectRef: subjectRef.path(pathId),
      facts: { personKey: person.personKey, pathId, pathEnrollmentId: row.id, source, ...(person.userId ? { userId: person.userId } : {}) },
    });
    enrollmentId = done.enrollmentId;
  }
  return { row, outcome, enrollmentId };
}

/** A person left a path: the row says so and its journey stops. */
export async function leavePath(deps: PathDeps, person: PathPersonRef, pathId: string): Promise<{ left: boolean; stopped: number }> {
  const left = person.personKey ? await leavePathRow(deps.getPool(), person.personKey, pathId) : false;
  const stopped = person.contactId ? await stop(deps, { journeyKey: pathJourneyKey(pathId), contactId: person.contactId }, "left_path") : 0;
  return { left, stopped };
}

/** A person reached a path's goal: the row is done and the journey stops with the goal as its reason. */
export async function reachPathGoal(deps: PathDeps, person: PathPersonRef, pathId: string, reason: string): Promise<number> {
  await markPathDone(deps.getPool(), { personKey: person.personKey, contactId: person.contactId }, pathId);
  return person.contactId ? stop(deps, { journeyKey: pathJourneyKey(pathId), contactId: person.contactId }, reason) : 0;
}

/**
 * The yes a ticked box is. Basis `asked`, with the form and the words the
 * form showed (the comms settings' consent words, which are the only words
 * the box is ever drawn with).
 */
export async function recordPathConsent(deps: PathDeps, contactId: string, form: string, submissionId: string | null): Promise<void> {
  const pool = deps.getPool();
  const { consentText } = await readCommsSettings(pool);
  const members = membersOf(deps);
  await setPermission(
    {
      getPool: deps.getPool,
      members: { byId: members.byId, byEmail: members.byEmail, update: deps.members?.update ?? (async () => null) },
      suppressions: suppressionsPortFor(deps.getPool),
    },
    {
      contactId,
      kind: "paths",
      state: "yes",
      basis: "asked",
      source: form.slice(0, 64),
      evidence: { form, ...(submissionId ? { submissionId } : {}), words: consentText },
    },
  );
}

// ── The triggers ────────────────────────────────────────────────────────────

export type PathTrigger = Extract<
  CommsTrigger,
  { type: "path_joined" | "path_left" | "form_submitted" | "submission_status" | "housing_status" | "member_joined" | "member_admitted" }
>;

const PATH_TRIGGER_TYPES: ReadonlySet<string> = new Set([
  "path_joined",
  "path_left",
  "form_submitted",
  "submission_status",
  "housing_status",
  "member_joined",
  "member_admitted",
]);

export function isPathTrigger(t: CommsTrigger): t is PathTrigger {
  return PATH_TRIGGER_TYPES.has(t.type);
}

/** A submission accepted that is a path's goal, until those goals have writers of their own (5.11). */
const GOAL_ON_ACCEPT: Readonly<Record<string, { pathId: string; reason: string }>> = {
  "investor-call": { pathId: "investor", reason: "investor_committed" },
  "work-with-us": { pathId: "prosperity-creator", reason: "prosperity_venture_listed" },
};

/** A ticked public form: the yes, then the path or the joining journey. */
async function formTicked(deps: PathDeps, input: { form: string; submissionId: string | null; email: string; name: string | null; pathId: string | null; joining: boolean }) {
  const person = await resolvePerson(deps, { email: input.email, name: input.name, source: input.form });
  if (!person.contactId) return;
  await recordPathConsent(deps, person.contactId, input.form, input.submissionId);
  if (input.joining && input.submissionId) {
    await enroll(deps, {
      journeyKey: JOINING_REQUEST,
      contactId: person.contactId,
      subjectRef: subjectRef.form(input.submissionId),
      facts: { submissionId: input.submissionId, ...(person.userId ? { userId: person.userId } : {}) },
    });
    return;
  }
  if (input.pathId) await joinPath(deps, person, input.pathId, input.form);
}

/** Act on one trigger this file owns. Never throws past a log line in the dispatcher. */
export async function handlePathTrigger(deps: PathDeps, t: PathTrigger): Promise<void> {
  switch (t.type) {
    case "path_joined": {
      const person = await resolvePerson(deps, { userId: t.userId ?? null, email: t.email ?? null, name: t.name ?? null, source: t.source });
      // A member's yes is their account (permissions.ts); a stranger's is the box.
      if (!person.userId && t.consent === true && person.contactId) await recordPathConsent(deps, person.contactId, t.source, null);
      if (!person.userId && t.consent !== true) return;
      await joinPath(deps, person, t.pathId, t.source);
      return;
    }
    case "path_left": {
      const person = await resolvePerson(deps, { userId: t.userId ?? null, email: t.email ?? null, name: t.name ?? null, source: t.source });
      await leavePath(deps, person, t.pathId);
      return;
    }
    case "form_submitted": {
      if (!t.consentPaths || !t.email) return;
      const joining = t.formType === JOINING_FORM_TYPE;
      const pathId = joining ? null : pathForForm(t.formType);
      if (!joining && !pathId) return;
      await formTicked(deps, { form: t.formType, submissionId: t.submissionId, email: t.email, name: t.name, pathId, joining });
      return;
    }
    case "housing_status": {
      if (t.status === "new") {
        if (t.consentPaths === true && t.email) {
          await formTicked(deps, { form: "housing", submissionId: null, email: t.email, name: t.name ?? null, pathId: "resident", joining: false });
        }
        return;
      }
      if (t.status === "reserved" && t.email) {
        const contact = await contactByEmailKey(deps.getPool(), emailKeyOf(t.email));
        const member = realMember(await membersOf(deps).byEmail(t.email));
        const person: PathPersonRef = {
          contactId: contact?.id ?? null,
          personKey: member ? String(member.id) : contact ? guestPersonKey(contact.id) : null,
          userId: member ? String(member.id) : null,
          email: t.email,
          name: null,
        };
        await reachPathGoal(deps, person, "resident", "resident_reserved");
      }
      return;
    }
    case "submission_status": {
      if (t.formType === JOINING_FORM_TYPE && t.status === "declined") {
        await stop(deps, { journeyKey: JOINING_REQUEST, subjectRef: subjectRef.form(t.submissionId) }, "joining_declined");
        return;
      }
      const goal = GOAL_ON_ACCEPT[t.formType];
      if (!goal || t.status !== "accepted") return;
      const s = await submissionPerson(deps.getPool(), t.submissionId);
      if (!s || (!s.email && !s.userId)) return;
      const person = await resolvePerson(deps, { userId: s.userId, email: s.email, name: s.name, source: t.formType });
      await reachPathGoal(deps, person, goal.pathId, goal.reason);
      return;
    }
    case "member_joined": {
      const person = await resolvePerson(deps, { userId: t.userId, source: "account" });
      if (!person.userId || !person.contactId) return;
      await enroll(deps, { journeyKey: MEMBER_WELCOME, contactId: person.contactId, subjectRef: subjectRef.account(), facts: { userId: person.userId } });
      return;
    }
    case "member_admitted": {
      const person = await resolvePerson(deps, { userId: t.userId, source: "account" });
      if (person.contactId) await stop(deps, { journeyKey: JOINING_REQUEST, contactId: person.contactId }, "joining_admitted");
      return;
    }
  }
}

// ── Members already on a path ───────────────────────────────────────────────

/** How many each source wrote. */
export interface PathBackfillCounts {
  members: number;
  recorded: number;
  already: number;
}

/**
 * Record every member's current paths (`users.paths`) as path rows with
 * source `backfill`, once, at boot. IT STARTS NO JOURNEY: these people chose
 * their paths before any email walked anybody through one, and they get
 * nothing unless an admin chooses "include people already on this path" on
 * the journey (`includeExisting`).
 */
export async function backfillPathEnrollments(
  deps: PathDeps & { members: { all(): Promise<any[]> } & Pick<MembersPort, "byId" | "byEmail"> },
  log: (line: string) => void = (line) => console.log(line),
): Promise<PathBackfillCounts> {
  const counts: PathBackfillCounts = { members: 0, recorded: 0, already: 0 };
  for (const raw of await deps.members.all()) {
    const m = realMember(raw);
    const paths: string[] = Array.isArray(m?.paths) ? m.paths.map(String) : [];
    if (!m || !paths.length) continue;
    counts.members += 1;
    const contact = m.email ? await ensureContact(deps, { email: String(m.email), name: m.name ? String(m.name) : null, userId: String(m.id), source: "account" }) : null;
    const person: PathPersonRef = { contactId: contact?.id ?? null, personKey: String(m.id), userId: String(m.id), email: m.email ?? null, name: m.name ?? null };
    for (const pathId of paths) {
      const done = await joinPath(deps, person, pathId, "backfill", { walk: false });
      if (done?.outcome === "created") counts.recorded += 1;
      else counts.already += 1;
    }
  }
  log(`[comms] path backfill: ${counts.members} member(s) on a path, ${counts.recorded} path row(s) recorded, ${counts.already} already there; no email sent`);
  return counts;
}

/**
 * Walk the backfilled members of one path through its journey, from now.
 * Enrolling is once per person, so pressing it twice starts nobody twice.
 */
export async function includeExistingOnPath(deps: PathDeps, pathId: string): Promise<number> {
  let started = 0;
  for (const row of await activePathRows(deps.getPool(), pathId, { source: "backfill", limit: 5000 })) {
    if (!row.contactId) continue;
    const done = await enroll(deps, {
      journeyKey: pathJourneyKey(pathId),
      contactId: row.contactId,
      subjectRef: subjectRef.path(pathId),
      facts: { personKey: row.personKey, pathId, pathEnrollmentId: row.id, source: "backfill", ...(row.userId ? { userId: row.userId } : {}) },
    });
    if (done.created) started += 1;
  }
  return started;
}

// ── The two path options on the Journeys screen ─────────────────────────────

export interface PathJourneyOptions {
  includeExisting: boolean;
  rungEmails: boolean;
}

export const optionsOf = (def: Pick<JourneyDefinition, "includeExisting" | "rungEmails">): PathJourneyOptions => ({
  includeExisting: def.includeExisting === true,
  rungEmails: def.rungEmails === true,
});

/**
 * Change a path journey's two options. Saved as the journey's next version,
 * the way a step edit is (server/lib/comms/journeyDefinitions.ts), so the
 * change is on the record with who made it. Turning `includeExisting` on
 * walks the backfilled members through the journey at once.
 */
export async function setPathJourneyOptions(
  deps: PathDeps & DefinitionDeps,
  key: string,
  patch: Partial<PathJourneyOptions>,
  by: string | null,
): Promise<{ status: JourneyStatus; started: number } | null> {
  const pathId = pathIdOfJourney(key);
  const before = pathId ? await journeyStatus(deps, key) : null;
  if (!pathId || !before) return null;
  const now = optionsOf(before.definition);
  const next: PathJourneyOptions = {
    includeExisting: typeof patch.includeExisting === "boolean" ? patch.includeExisting : now.includeExisting,
    rungEmails: typeof patch.rungEmails === "boolean" ? patch.rungEmails : now.rungEmails,
  };
  if (next.includeExisting !== now.includeExisting || next.rungEmails !== now.rungEmails) {
    await saveJourneyVersion(deps.getPool(), {
      journeyKey: key,
      platformVersion: before.platform?.version ?? before.definition.version,
      leaving: { version: before.version, definition: before.definition },
      definition: (v) => ({ ...before.definition, ...next, version: v }),
      by,
    });
  }
  const started = next.includeExisting && !now.includeExisting ? await includeExistingOnPath(deps, pathId) : 0;
  const status = await journeyStatus(deps, key);
  return status ? { status, started } : null;
}
