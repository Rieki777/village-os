/**
 * WHAT EACH PERSON AGREED TO RECEIVE, and the one question the post office
 * asks before every email: `permissionFor` (the comms build spec 5.3).
 *
 * ── THE RULES, KIND BY KIND ────────────────────────────────────────────────
 *
 *   essential  always yes. The person just asked for it: a password link, a
 *              confirmation. Never stored, never refused, not even for a
 *              suppressed address.
 *   events     yes for a gathering the person said yes to. The yes to the
 *              gathering IS the permission (basis `implied`), and only the
 *              people who said yes are ever on a gathering's journey, so a
 *              person with no answer stored is allowed and a stored `no`
 *              (an unsubscribe) refuses.
 *   paths      a member who chose a path in their account: yes, basis
 *              `account`. Anybody else: only an explicit yes on record (a
 *              ticked box, with the words they saw as evidence).
 *   letters    only an explicit yes. A person with no account confirms it by
 *              email first (double opt-in, server/lib/comms/preferences.ts).
 *   notices    a member's own notification emails. They follow `users.prefs`
 *              exactly as they did before comms existed, and the spine
 *              (server/lib/notify.ts) is where those preferences are applied,
 *              type by type. This file does not apply them a second time, and
 *              that is deliberate: the three steward window notices are pinned
 *              ABOVE the member's `emailsOff` switch, and a second check here
 *              that read `emailsOff` would silently drop the one warning a
 *              seated steward gets before a carried decision lands. So a
 *              notice to a member is allowed here, and a notice to somebody
 *              with no account is refused, because the spine has no business
 *              writing to one.
 *
 * A stored answer always beats a derived one. A suppressed address receives
 * nothing but essential mail, whatever it agreed to.
 *
 * ── THE PAUSE ──────────────────────────────────────────────────────────────
 *
 * "Pause for 30 days" holds gathering reminders, path emails and letters
 * without changing what the person agreed to, so the hold is written into the
 * evidence of each answer as `pausedUntil` and lapses by itself: nothing has
 * to run when it ends. A kind the person never answered gets a row that
 * carries only the hold (`holdOnly`), whose state is a placeholder `no` that
 * every reader here ignores. That placeholder is why NOTHING OUTSIDE THIS FILE
 * SHOULD READ `comms_permissions.state` RAW: read `answerFor` or
 * `permissionFor`, which know which rows are holds.
 *
 * ── STOPPING ───────────────────────────────────────────────────────────────
 *
 * Saying no to a kind writes `no` and stops the person's active journeys of
 * that kind. "Stop everything" suppresses the address (`unsubscribed_all`),
 * turns a member's notification emails off, and stops every active journey.
 * Turning a member's mail quiet goes through the same steward check the
 * account's own preference route uses (`stewardMailRefusal`): a seated
 * steward's governance mail stays on while they hold the seat.
 *
 * ── SUPPRESSIONS ARE A PORT ────────────────────────────────────────────────
 *
 * The post office lane owns `comms_suppressions` and its module. Everything
 * here reaches it through `SuppressionsPort`, and `suppressionsPortFor` is
 * the one place a running server builds that port, so the merge that brings
 * the real module in changes one function body.
 */
import type { Pool } from "mysql2/promise";
import { emailKeyOf } from "../../../shared/comms/address";
import { defaultJourney } from "../../../shared/comms/defaults/journeys";
import type {
  EmailKind,
  PermissionBasis,
  PermissionKind,
  PermissionState,
  SkipReason,
  SuppressionReason,
} from "../../../shared/comms/kinds";
import { PAUSABLE_KINDS } from "../../../shared/comms/preferences";
import { contactByEmailKey, contactById, type ContactRow } from "../../repos/commsContacts";
import {
  enrollmentsForContact,
  interimAddSuppression,
  interimIsSuppressed,
  interimListSuppressions,
  interimRemoveSuppression,
  suppressionOf,
} from "../../repos/commsPeople";
import { deletePermission, permissionRow, permissionsForContact, upsertPermission, type PermissionRow } from "../../repos/commsPermissions";
import { isExampleUser } from "../examples";
import { isTombstone } from "../oauthAccounts";
import { stewardMailRefusal } from "../stewardship";
import { stop as stopJourney } from "./journeys";

// ── The ports ───────────────────────────────────────────────────────────────

/** The post office lane's suppressions module, as this file calls it. */
export interface SuppressionsPort {
  isSuppressed(emailKey: string): Promise<boolean>;
  addSuppression(emailKey: string, reason: SuppressionReason, detail?: string | null, createdBy?: string | null): Promise<void>;
  removeSuppression(emailKey: string): Promise<void>;
  listSuppressions(opts: { emailKey?: string; limit?: number; offset?: number }): Promise<
    Array<{ emailKey: string; reason: string; detail?: string | null; createdBy?: string | null; createdAt?: number }>
  >;
}

/**
 * The port a running server uses. INTERIM: backed by the writers at the foot
 * of server/repos/commsPeople.ts until the post office lane's module
 * (server/lib/comms/suppressions.ts) is wired in at merge, which replaces
 * this body and nothing else.
 */
export function suppressionsPortFor(getPool: () => Pool): SuppressionsPort {
  return {
    isSuppressed: (emailKey) => interimIsSuppressed(getPool(), emailKey),
    addSuppression: (emailKey, reason, detail, createdBy) =>
      interimAddSuppression(getPool(), { emailKey, reason, detail: detail ?? null, createdBy: createdBy ?? null }),
    removeSuppression: (emailKey) => interimRemoveSuppression(getPool(), emailKey),
    listSuppressions: (opts) => interimListSuppressions(getPool(), opts),
  };
}

/** The members repository, as far as this file reaches into it. */
export interface MembersPort {
  byId(id: string): Promise<any | null>;
  byEmail(email: string): Promise<any | null>;
  update(id: string, mutate: (member: any) => void): Promise<any | null>;
}

export interface PeopleDeps {
  getPool(): Pool;
  members: MembersPort;
  suppressions: SuppressionsPort;
  /**
   * The sentence that refuses turning a member's mail quiet, or null to carry
   * on. Defaults to the steward check the account's preference route uses.
   */
  mailRefusal?: (userId: string, incoming: Record<string, unknown>) => Promise<string | null>;
  /** Epoch milliseconds now, for tests. */
  now?: () => number;
}

const nowOf = (deps: PeopleDeps): number => (deps.now ? deps.now() : Date.now());

const refusalOf = (deps: PeopleDeps, userId: string, incoming: Record<string, unknown>): Promise<string | null> =>
  deps.mailRefusal ? deps.mailRefusal(userId, incoming) : stewardMailRefusal(deps.getPool(), userId, incoming);

// ── Who a contact is ────────────────────────────────────────────────────────

/**
 * The member account behind a contact, or null. Found by the linked user id,
 * then by the address, so a member whose contact was made before they had an
 * account is still recognised. An example identity and a tombstone are
 * nobody's account.
 */
export async function memberOf(deps: PeopleDeps, contact: ContactRow): Promise<any | null> {
  const linked = contact.userId ? await deps.members.byId(contact.userId) : null;
  const m = linked ?? (await deps.members.byEmail(contact.email));
  if (!m || isExampleUser(m) || isTombstone({ email: String(m.email ?? "") })) return null;
  return m;
}

/** The contact a call names, by id first and by address second, or null. */
export async function findContact(deps: PeopleDeps, ref: { contactId?: string | null; emailKey?: string | null }): Promise<ContactRow | null> {
  const pool = deps.getPool();
  const byId = ref.contactId ? await contactById(pool, ref.contactId) : null;
  if (byId) return byId;
  return ref.emailKey ? contactByEmailKey(pool, emailKeyOf(ref.emailKey)) : null;
}

// ── Reading an answer ───────────────────────────────────────────────────────

/** A hold that has not yet lapsed, in epoch ms, or null. */
function heldUntil(row: PermissionRow | null, now: number): number | null {
  const raw = row?.evidence?.pausedUntil;
  if (typeof raw !== "string") return null;
  const t = Date.parse(raw);
  return Number.isFinite(t) && t > now ? t : null;
}

const isHoldOnly = (row: PermissionRow | null): boolean => row?.evidence?.holdOnly === true;

/** One kind's answer as this file reads it, holds and derivations included. */
export interface Answer {
  kind: PermissionKind;
  /** The person's answer, stored or derived. */
  state: PermissionState;
  /** True when no stored answer decided it. */
  derived: boolean;
  basis: PermissionBasis | null;
  source: string | null;
  /** Epoch ms the person's pause ends, while one holds this kind. */
  pausedUntil: number | null;
}

/**
 * What one contact's answer about one kind comes to. `member` is passed when
 * the caller already looked it up, and read here when it is `undefined`.
 */
export async function answerFor(
  deps: PeopleDeps,
  contact: ContactRow,
  kind: PermissionKind,
  member?: any | null,
  stored?: PermissionRow | null,
): Promise<Answer> {
  const row = stored === undefined ? await permissionRow(deps.getPool(), contact.id, kind) : stored;
  const pausedUntil = heldUntil(row, nowOf(deps));
  if (row && !isHoldOnly(row)) {
    return { kind, state: row.state, derived: false, basis: row.basis, source: row.source, pausedUntil };
  }
  const who = member === undefined ? await memberOf(deps, contact) : member;
  const derived = (state: PermissionState, basis: PermissionBasis | null, source: string | null): Answer => ({
    kind,
    state,
    derived: true,
    basis,
    source,
    pausedUntil,
  });
  switch (kind) {
    case "events":
      return derived("yes", "implied", "a yes to a gathering");
    case "paths": {
      const paths = Array.isArray(who?.paths) ? who.paths : [];
      return paths.length > 0 ? derived("yes", "account", "a path chosen in their account") : derived("no", null, null);
    }
    case "letters":
      return derived("no", null, null);
    case "notices":
      return who
        ? derived(who.prefs?.notify?.emailsOff === true ? "no" : "yes", "account", "their notification settings")
        : derived("no", null, null);
  }
}

/** Every kind's answer for one contact, with one read of the stored rows and the member. */
export async function answersFor(deps: PeopleDeps, contact: ContactRow, member?: any | null): Promise<Record<PermissionKind, Answer>> {
  const rows = await permissionsForContact(deps.getPool(), contact.id);
  const who = member === undefined ? await memberOf(deps, contact) : member;
  const stored = (k: PermissionKind) => rows.find((r) => r.kind === k) ?? null;
  return {
    events: await answerFor(deps, contact, "events", who, stored("events")),
    paths: await answerFor(deps, contact, "paths", who, stored("paths")),
    letters: await answerFor(deps, contact, "letters", who, stored("letters")),
    notices: await answerFor(deps, contact, "notices", who, stored("notices")),
  };
}

// ── The post office's question ──────────────────────────────────────────────

export interface PermissionVerdict {
  allowed: boolean;
  /** The skip reason a refusal records. */
  reason?: Extract<SkipReason, "no_permission" | "suppressed">;
  /** A few words on why, for a log line or the Sent mail screen. */
  why?: string;
}

/**
 * May an email of this kind go to this address now. Asked by the post office
 * when a row is written and again when it is sent (5.1).
 */
export async function permissionFor(
  deps: PeopleDeps,
  emailKey: string,
  kind: EmailKind,
  contactId?: string | null,
): Promise<PermissionVerdict> {
  if (kind === "essential") return { allowed: true };
  const contact = await findContact(deps, { contactId, emailKey });
  const key = contact?.emailKey ?? emailKeyOf(emailKey);
  if (key && (await deps.suppressions.isSuppressed(key))) {
    return { allowed: false, reason: "suppressed", why: "this address receives only essential mail" };
  }
  if (!contact) {
    // Nobody by this address has said anything. Only a gathering's own
    // reminders follow from something done elsewhere (the yes itself).
    return kind === "events" ? { allowed: true } : { allowed: false, reason: "no_permission", why: "no answer on record" };
  }
  if (kind === "notices") {
    // See the header: the spine applied the member's settings already.
    return (await memberOf(deps, contact)) ? { allowed: true } : { allowed: false, reason: "no_permission", why: "notices are for members" };
  }
  const answer = await answerFor(deps, contact, kind);
  if (answer.state !== "yes") return { allowed: false, reason: "no_permission", why: `no yes to ${kind}` };
  if (answer.pausedUntil) return { allowed: false, reason: "no_permission", why: "paused by the person" };
  return { allowed: true };
}

/** `permissionFor` in the shape the post office's dependencies take. */
export function createPermissionFor(
  deps: PeopleDeps,
): (emailKey: string, kind: EmailKind, contactId: string | null) => Promise<{ allowed: boolean; reason?: string }> {
  return (emailKey, kind, contactId) => permissionFor(deps, emailKey, kind, contactId);
}

// ── Writing an answer ───────────────────────────────────────────────────────

export interface SetPermissionInput {
  contactId: string;
  kind: PermissionKind;
  state: PermissionState;
  basis: PermissionBasis;
  /** Where the answer was given: `preferences`, `unsubscribe`, `profile`, a form type. */
  source: string;
  /** The form id, and the words the person saw when they said yes. */
  evidence?: Record<string, unknown> | null;
}

/**
 * Record one answer. A pause the person placed on this kind is carried over,
 * so changing a switch while paused does not quietly lift the pause.
 */
export async function setPermission(deps: PeopleDeps, input: SetPermissionInput): Promise<void> {
  const pool = deps.getPool();
  const prior = await permissionRow(pool, input.contactId, input.kind);
  const until = heldUntil(prior, nowOf(deps));
  const evidence: Record<string, unknown> = { ...(input.evidence ?? {}) };
  delete evidence.holdOnly;
  delete evidence.pausedUntil;
  if (until) evidence.pausedUntil = new Date(until).toISOString();
  await upsertPermission(pool, {
    contactId: input.contactId,
    kind: input.kind,
    state: input.state,
    basis: input.basis,
    source: input.source,
    evidence: Object.keys(evidence).length ? evidence : null,
  });
}

/** Which kind of email a journey sends, or null when the platform does not know the journey. */
export function journeyEmailKind(journeyKey: string): EmailKind | null {
  return defaultJourney(journeyKey)?.emailKind ?? (journeyKey.startsWith("path.") ? "paths" : null);
}

/**
 * Stop a contact's active journeys of one kind, or of every kind, and say how
 * many stopped. A journey the platform cannot name a kind for is stopped only
 * by "every kind".
 */
export async function stopJourneysOf(
  deps: PeopleDeps,
  contactId: string,
  kind: PermissionKind | "all",
  reason: "unsubscribed" | "suppressed",
): Promise<number> {
  const active = (await enrollmentsForContact(deps.getPool(), contactId)).filter((e) => e.state === "active");
  const keys = Array.from(
    new Set(active.filter((e) => kind === "all" || journeyEmailKind(e.journeyKey) === kind).map((e) => e.journeyKey)),
  );
  let stopped = 0;
  for (const journeyKey of keys) stopped += await stopJourney({ getPool: deps.getPool }, { journeyKey, contactId }, reason);
  return stopped;
}

export type ChangeResult = { ok: true; stopped?: number } | { ok: false; status: number; error: string };

/** Turn a member's notification emails on or off, through the steward check when it turns them off. */
async function setMemberNotices(deps: PeopleDeps, member: any, on: boolean): Promise<ChangeResult> {
  if (!on) {
    const refusal = await refusalOf(deps, String(member.id), { emailsOff: true });
    if (refusal) return { ok: false, status: 409, error: refusal };
  }
  const updated = await deps.members.update(String(member.id), (u: any) => {
    u.prefs = { ...(u.prefs ?? {}), notify: { ...(u.prefs?.notify ?? {}), emailsOff: !on } };
  });
  return updated ? { ok: true } : { ok: false, status: 404, error: "That account is not here any more." };
}

/**
 * Say no to one kind: write `no`, and stop the person's journeys of that kind
 * (5.3). For a member's notification emails, `no` is their own `emailsOff`
 * switch, which the spine reads.
 */
export async function unsubscribe(
  deps: PeopleDeps,
  input: { contactId: string; kind: PermissionKind; basis: PermissionBasis; source: string },
): Promise<ChangeResult> {
  const contact = await contactById(deps.getPool(), input.contactId);
  if (!contact) return { ok: false, status: 404, error: "We no longer hold this address, so there is nothing to stop." };
  if (input.kind === "notices") {
    const member = await memberOf(deps, contact);
    if (member) return setMemberNotices(deps, member, false);
  }
  await setPermission(deps, {
    contactId: contact.id,
    kind: input.kind,
    state: "no",
    basis: input.basis,
    source: input.source,
    evidence: { at: new Date(nowOf(deps)).toISOString() },
  });
  return { ok: true, stopped: await stopJourneysOf(deps, contact.id, input.kind, "unsubscribed") };
}

/** Say yes to one kind. Letters from somebody with no account go through confirmation instead (preferences.ts). */
export async function subscribe(
  deps: PeopleDeps,
  input: { contactId: string; kind: PermissionKind; basis: PermissionBasis; source: string; evidence?: Record<string, unknown> | null },
): Promise<ChangeResult> {
  const contact = await contactById(deps.getPool(), input.contactId);
  if (!contact) return { ok: false, status: 404, error: "We no longer hold this address." };
  if (input.kind === "notices") {
    const member = await memberOf(deps, contact);
    if (!member) return { ok: false, status: 400, error: "Notification emails are for members, from their account." };
    return setMemberNotices(deps, member, true);
  }
  await setPermission(deps, {
    contactId: contact.id,
    kind: input.kind,
    state: "yes",
    basis: input.basis,
    source: input.source,
    evidence: { at: new Date(nowOf(deps)).toISOString(), ...(input.evidence ?? {}) },
  });
  return { ok: true };
}

/**
 * Stop everything: the address is suppressed (`unsubscribed_all`), a
 * member's notification emails go off, and every active journey stops. An
 * address already suppressed for another reason keeps that reason.
 */
export async function stopEverything(deps: PeopleDeps, input: { contactId: string; by?: string | null }): Promise<ChangeResult> {
  const contact = await contactById(deps.getPool(), input.contactId);
  if (!contact) return { ok: false, status: 404, error: "We no longer hold this address, so there is nothing to stop." };
  const member = await memberOf(deps, contact);
  if (member) {
    const refusal = await refusalOf(deps, String(member.id), { emailsOff: true });
    if (refusal) return { ok: false, status: 409, error: refusal };
  }
  await deps.suppressions.addSuppression(contact.emailKey, "unsubscribed_all", null, input.by ?? null);
  if (member) {
    const quiet = await setMemberNotices(deps, member, false);
    if (!quiet.ok) return quiet;
  }
  return { ok: true, stopped: await stopJourneysOf(deps, contact.id, "all", "suppressed") };
}

/**
 * Start again after stopping everything. Lifts ONLY a suppression the person
 * placed themselves: a bounce, a complaint and a stop a person at the village
 * made are lifted by that person, on the People screen.
 */
export async function startAgain(deps: PeopleDeps, input: { contactId: string }): Promise<ChangeResult> {
  const pool = deps.getPool();
  const contact = await contactById(pool, input.contactId);
  if (!contact) return { ok: false, status: 404, error: "We no longer hold this address." };
  const held = await suppressionOf(pool, contact.emailKey);
  if (!held) return { ok: true };
  if (held.reason !== "unsubscribed_all") {
    return { ok: false, status: 409, error: "Email to this address was stopped by the village. Ask a person there to start it again." };
  }
  await deps.suppressions.removeSuppression(contact.emailKey);
  return { ok: true };
}

/**
 * Pause gathering reminders, path emails and letters until `until`, or lift
 * the pause when `until` is null. What the person agreed to is untouched.
 */
export async function setPause(deps: PeopleDeps, input: { contactId: string; until: Date | null }): Promise<ChangeResult> {
  const pool = deps.getPool();
  const contact = await contactById(pool, input.contactId);
  if (!contact) return { ok: false, status: 404, error: "We no longer hold this address." };
  const rows = await permissionsForContact(pool, contact.id);
  for (const kind of PAUSABLE_KINDS) {
    const row = rows.find((r) => r.kind === kind) ?? null;
    const evidence: Record<string, unknown> = { ...(row?.evidence ?? {}) };
    delete evidence.pausedUntil;
    if (input.until === null) {
      if (!row) continue;
      if (isHoldOnly(row)) {
        await deletePermission(pool, contact.id, kind);
        continue;
      }
      await upsertPermission(pool, { ...row, evidence: Object.keys(evidence).length ? evidence : null });
      continue;
    }
    evidence.pausedUntil = input.until.toISOString();
    if (row) {
      await upsertPermission(pool, { ...row, evidence });
    } else {
      // A kind never answered gets a row that only carries the hold. Its
      // state is a placeholder every reader above ignores.
      evidence.holdOnly = true;
      await upsertPermission(pool, { contactId: contact.id, kind, state: "no", basis: "asked", source: "preferences.pause", evidence });
    }
  }
  return { ok: true };
}
