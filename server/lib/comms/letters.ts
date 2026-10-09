/**
 * LETTERS: village news, written in Admin and sent to the people who said
 * yes to it (the comms build spec 5.12).
 *
 * PORTED FROM ReGen Civics' Outbound safe send (`server/lib/newsletter-issue-
 * email.ts` and `server/lib/outboundAudience.ts` there). The shape is theirs:
 *
 *   1. PREVIEW. The audience is resolved now, written as the letter's
 *      snapshot (`comms_letter_recipients`, one row per address, pending),
 *      and the preview answers a CONFIRMATION TOKEN bound to the words, the
 *      audience and the count (one SHA-256 over all three, `letterCanonical`
 *      in shared/comms/letters.ts) that lasts fifteen minutes.
 *   2. CONFIRM. The token is checked against the letter as it stands NOW, so a
 *      stale token, an edit after the preview, or a second preview that found
 *      a different count each refuse it. The caller's IDEMPOTENCY KEY rides on
 *      the letter row under a unique index, and THE STATUS CLAIM is one
 *      conditional UPDATE from `draft` or `cancelled`, so the same letter
 *      confirmed twice is claimed once and the second answer says duplicate.
 *   3. SEND. One `post()` per snapshot row, kind `letters`, keyed
 *      `letter:<letterId>:<emailKey>`. The post office asks the permission
 *      question again for every one (5.1), so somebody who said no between
 *      the preview and the send is skipped, and the snapshot row records why.
 *      The post office queues each email; its drain sends them.
 *   4. OR SCHEDULE. The same check and the same claim, to `scheduled`. The
 *      letters job (`runLettersJob`) claims it once its moment comes and sends
 *      it the same way.
 *
 * What changed from the original:
 *   - the audience is the village's address book: members who said yes to
 *     letters, people on a path, a gathering's attendees, or every contact who
 *     said yes. Every one of them is filtered by the people lane's
 *     `permissionFor`, because letters go only on an explicit yes (5.3).
 *   - the daily limit is the village's dial, `comms.letters_per_day`, with the
 *     ten-minute gap kept.
 *   - each letter is rendered by the words lane's renderer through the
 *     village's own "Every letter" frame, per person, so the footer carries
 *     that reader's own preferences link.
 *
 * A SEND THAT STOPS PART WAY RESUMES. The claim stamps the letter and every
 * twenty recipients renew the stamp; a letter left `sending` with a stamp ten
 * minutes old is taken again by the job, which posts only the rows still
 * pending. A row already handed over answers `duplicate` from the post office
 * if it is posted twice, so a resume never sends anybody a second copy.
 *
 * SQL lives in server/repos/commsLetters.ts.
 */
import crypto from "node:crypto";
import type { Pool } from "mysql2/promise";
import type { PostResult } from "../../../shared/comms/contracts";
import {
  audienceLabel,
  capProblem,
  CONFIRM_MINUTES,
  DEFAULT_LETTERS_PER_DAY,
  EDITABLE_LETTER_STATES,
  LETTER_RESUME_MINUTES,
  letterCanonical,
  PREVIEW_NAMES,
  scheduleProblem,
  type LetterAudience,
  type LetterDraft,
  type LetterState,
} from "../../../shared/comms/letters";
import type { ModuleLifecycle } from "../../../shared/modules";
import { voiceLintWords, type VoiceFinding } from "../../../shared/comms/voiceLint";
import {
  attendeesOf,
  cancelScheduledLetter,
  claimDueLetter,
  claimLetter,
  contactsByEmailKeys,
  contactsByIds,
  contactsByUserIds,
  contactsWithLettersYes,
  dueLetterIds,
  gatheringTitle,
  heartbeatLetter,
  insertLetter,
  letterById,
  letterByIdempotencyKey,
  letterNumbers,
  lettersWindow,
  listLetters,
  markRecipient,
  recipientsOf,
  reclaimStaleLetter,
  recordPreview,
  replaceRecipients,
  rescheduleLetter,
  settleLetter,
  snapshotSkips,
  staleSendingIds,
  updateLetterWords,
  walkersOfPath,
  type AudienceContact,
  type LetterNumbers,
  type LetterRow,
} from "../../repos/commsLetters";
import type { ContactRow } from "../../repos/commsContacts";
import { GAME_CONFIG } from "../../../shared/gameConfig";
import { emailKeyOf } from "../../../shared/comms/address";
import { contactIdOfGuestKey } from "../../../shared/comms/kinds";
import { numberVar } from "../variables";
import { linkKey } from "./links";
import { memberOf, permissionFor, type PeopleDeps } from "./permissions";
import { post, type PostOfficeDeps } from "./postOffice";
import { loadEmailVillage, renderLetter, type EmailVillage, type RenderedEmail } from "./render";

// ── What a letter is handed ─────────────────────────────────────────────────

export interface LettersDeps {
  getPool(): Pool;
  /** The running server's post office. */
  postOffice: PostOfficeDeps;
  /** The people lane's address book, for `permissionFor` and who is a member. */
  people: PeopleDeps;
  /** The comms module's lifecycle. Absent: `off`, and the job sends nothing. */
  lifecycle?(): ModuleLifecycle;
  /** `comms.letters_per_day`. Absent: the game variable. */
  lettersPerDay?(): number;
  /** Epoch milliseconds now, for the confirmation's clock and a schedule's. Tests pin it. */
  now?(): number;
  /** The confirmation's signing key. Absent: the link key (server/lib/comms/links.ts). */
  key?: Buffer;
}

export type Refusal = { ok: false; status: number; error: string };

const nowMs = (deps: Pick<LettersDeps, "now">): number => (deps.now ? deps.now() : Date.now());

function perDay(deps: LettersDeps): number {
  try {
    const v = deps.lettersPerDay ? deps.lettersPerDay() : numberVar("comms.letters_per_day");
    return Number.isFinite(v) && v > 0 ? v : DEFAULT_LETTERS_PER_DAY;
  } catch {
    return DEFAULT_LETTERS_PER_DAY;
  }
}

const refuse = (status: number, error: string): Refusal => ({ ok: false, status, error });

const NOT_FOUND = refuse(404, "There is no such letter.");

/** Why this village cannot send at all, as the sentence the screen shows, or null. */
function unconfigured(deps: LettersDeps): string | null {
  if (!deps.postOffice.hasApiKey()) return "No provider key is set, so nothing can be sent. Finish the setup in Comms Settings first.";
  if (!deps.postOffice.sender()) return "No sender address is set, so nothing can be sent. Finish the setup in Comms Settings first.";
  return null;
}

// ── The confirmation token ──────────────────────────────────────────────────

/** What a confirmation carries: the letter, the hash it approved, the count, and when it runs out (epoch seconds). */
export interface ConfirmPayload {
  l: string;
  h: string;
  n: number;
  x: number;
}

/** Signed under the link key with its own label, so no signed email link can ever pass for one. */
const TOKEN_LABEL = "letter-confirm-v1.";

function tokenSig(key: Buffer, body: string): string {
  return crypto.createHmac("sha256", key).update(TOKEN_LABEL + body).digest("base64url");
}

/** The SHA-256 a confirmation is bound to: the words, the frame and the audience. */
export function letterHash(d: LetterDraft): string {
  return crypto.createHash("sha256").update(letterCanonical(d), "utf8").digest("hex");
}

export function signConfirm(payload: ConfirmPayload, key: Buffer = linkKey()): string {
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${body}.${tokenSig(key, body)}`;
}

/**
 * A confirmation's payload, `stale` when it ran out, or `invalid` for anything
 * else. The signature is checked in constant time before the body is parsed.
 */
export function verifyConfirm(token: string, now: number, key: Buffer = linkKey()): ConfirmPayload | "stale" | "invalid" {
  try {
    if (typeof token !== "string" || token.length > 2048) return "invalid";
    const [body, sig, extra] = token.split(".");
    if (!body || !sig || extra !== undefined) return "invalid";
    const expected = Buffer.from(tokenSig(key, body));
    const given = Buffer.from(sig);
    if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return "invalid";
    const p = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Partial<ConfirmPayload>;
    if (typeof p.l !== "string" || typeof p.h !== "string" || typeof p.n !== "number" || typeof p.x !== "number") return "invalid";
    if (Math.floor(now / 1000) >= p.x) return "stale";
    return { l: p.l, h: p.h, n: p.n, x: p.x };
  } catch {
    return "invalid";
  }
}

// ── Writing a letter ────────────────────────────────────────────────────────

const draftOf = (l: LetterRow): LetterDraft | null =>
  l.audience ? { subject: l.subject, preheader: l.preheader, bodyMd: l.bodyMd, layout: l.layout, audience: l.audience } : null;

export async function createLetter(deps: Pick<LettersDeps, "getPool">, draft: LetterDraft, by: string): Promise<LetterRow> {
  const id = `ltr_${crypto.randomBytes(12).toString("hex")}`;
  await insertLetter(deps.getPool(), { id, ...draft, idempotencyKey: `draft:${id}`, createdBy: by });
  return (await letterById(deps.getPool(), id)) as LetterRow;
}

export async function saveLetter(deps: Pick<LettersDeps, "getPool">, id: string, draft: LetterDraft): Promise<{ ok: true; letter: LetterRow } | Refusal> {
  const pool = deps.getPool();
  const letter = await letterById(pool, id);
  if (!letter) return NOT_FOUND;
  if (!(EDITABLE_LETTER_STATES as readonly LetterState[]).includes(letter.state)) {
    return refuse(409, letter.state === "scheduled" ? "This letter is scheduled. Cancel it before changing its words." : "This letter has gone out. Its words stay as they were sent.");
  }
  if (!(await updateLetterWords(pool, id, draft))) return refuse(409, "This letter could not be changed just now. Open it again.");
  return { ok: true, letter: (await letterById(pool, id)) as LetterRow };
}

// ── Who it goes to ──────────────────────────────────────────────────────────

export interface ResolvedAudience {
  /** Everyone it would reach now, one per address, in a stable order. */
  recipients: AudienceContact[];
  /** How many people the group holds. */
  inGroup: number;
  /** How many of them are left out: no yes to letters, a pause, a stopped address, or no address on record. */
  leftOut: number;
  /** A line for the preview when the group's rule needs saying. */
  note: string | null;
}

/** Contacts for a set of person keys: guests by their contact, members by their account. */
async function contactsOfPeople(deps: LettersDeps, people: Array<{ userId: string | null; contactId: string | null }>): Promise<AudienceContact[]> {
  const pool = deps.getPool();
  const contactIds = Array.from(new Set(people.map((p) => p.contactId).filter((v): v is string => Boolean(v))));
  const userIds = Array.from(new Set(people.filter((p) => !p.contactId && p.userId).map((p) => p.userId as string)));
  const byId = await contactsByIds(pool, contactIds);
  const byUser = await contactsByUserIds(pool, userIds);
  const linked = new Set(byUser.map((c) => c.userId));
  // A member whose contact was made before they had an account is found by address.
  const unlinked: string[] = [];
  for (const uid of userIds) {
    if (linked.has(uid)) continue;
    const m = await deps.people.members.byId(uid).catch(() => null);
    const key = m?.email ? emailKeyOf(String(m.email)) : "";
    if (key) unlinked.push(key);
  }
  return [...byId, ...byUser, ...(await contactsByEmailKeys(pool, unlinked))];
}

/** The people the audience names, before anybody is left out. */
async function groupOf(deps: LettersDeps, a: LetterAudience): Promise<{ contacts: AudienceContact[]; size: number; note: string | null }> {
  const pool = deps.getPool();
  switch (a.kind) {
    case "everyone": {
      const all = await contactsWithLettersYes(pool);
      return { contacts: all, size: all.length, note: null };
    }
    case "members": {
      const yes = await contactsWithLettersYes(pool);
      const members: AudienceContact[] = [];
      for (const c of yes) if (await memberOf(deps.people, c as unknown as ContactRow)) members.push(c);
      return { contacts: members, size: members.length, note: null };
    }
    case "path": {
      const walkers = await walkersOfPath(pool, a.pathId);
      const people = walkers.map((w) => ({ userId: w.userId, contactId: w.contactId ?? contactIdOfGuestKey(w.personKey) }));
      return { contacts: await contactsOfPeople(deps, people), size: walkers.length, note: null };
    }
    case "gathering": {
      const { personKeys, marked } = await attendeesOf(pool, a.eventId);
      const people = personKeys.map((k) => {
        const contactId = contactIdOfGuestKey(k);
        return contactId ? { userId: null, contactId } : { userId: k, contactId: null };
      });
      return {
        contacts: await contactsOfPeople(deps, people),
        size: personKeys.length,
        note: marked ? null : "Nobody was marked as having come, so this is everyone who said yes to it.",
      };
    }
  }
}

/**
 * Who a letter to this audience reaches now: the group, one per address,
 * each asked the post office's own question (`permissionFor`, kind letters).
 */
export async function resolveAudience(deps: LettersDeps, a: LetterAudience): Promise<ResolvedAudience> {
  const group = await groupOf(deps, a);
  const seen = new Set<string>();
  const recipients: AudienceContact[] = [];
  for (const c of group.contacts) {
    if (seen.has(c.emailKey)) continue;
    seen.add(c.emailKey);
    const verdict = await permissionFor(deps.people, c.emailKey, "letters", c.id);
    if (verdict.allowed) recipients.push(c);
  }
  recipients.sort((x, y) => (x.name ?? x.email).localeCompare(y.name ?? y.email) || x.emailKey.localeCompare(y.emailKey));
  return { recipients, inGroup: group.size, leftOut: Math.max(0, group.size - recipients.length), note: group.note };
}

/** The audience in one line, with its path or gathering named. */
export async function labelOf(deps: Pick<LettersDeps, "getPool">, a: LetterAudience | null): Promise<string> {
  if (!a) return "An audience this village no longer has";
  if (a.kind === "path") return audienceLabel(a, { path: GAME_CONFIG.paths.find((p) => p.id === a.pathId)?.label ?? null });
  if (a.kind === "gathering") return audienceLabel(a, { gathering: await gatheringTitle(deps.getPool(), a.eventId) });
  return audienceLabel(a);
}

// ── Rendering ───────────────────────────────────────────────────────────────

const firstWord = (name: string | null | undefined): string => String(name ?? "").trim().split(/\s+/)[0] ?? "";

/** One letter for one reader, through the village's "Every letter" frame. */
function renderFor(
  deps: Pick<LettersDeps, "getPool">,
  letter: Pick<LetterRow, "subject" | "preheader" | "bodyMd">,
  village: EmailVillage,
  reader: { name: string | null; contactId: string | null },
): Promise<RenderedEmail> {
  const name = String(reader.name ?? "").trim();
  return renderLetter(
    letter.bodyMd,
    {
      "letter.subject": letter.subject,
      ...(letter.preheader ? { "letter.preheader": letter.preheader } : {}),
      ...(name ? { "person.name": name, "person.firstName": firstWord(name) } : {}),
    },
    { getPool: deps.getPool, village, contactId: reader.contactId },
  );
}

// ── Preview ─────────────────────────────────────────────────────────────────

export interface PreviewAnswer {
  ok: true;
  count: number;
  /** The first few, by name, or by address when there is no name. */
  names: string[];
  inGroup: number;
  leftOut: number;
  note: string | null;
  /** Who the sample below is rendered for. */
  sampleFor: string;
  subject: string;
  preheader: string;
  html: string;
  text: string;
  voice: VoiceFinding[];
  /** Null when nobody would receive it: there is nothing to confirm. */
  confirmToken: string | null;
  /** Epoch milliseconds the confirmation runs out. */
  expiresAt: number | null;
}

/**
 * Resolve the audience, write the snapshot, and answer the letter as its first
 * reader will see it with a confirmation bound to what was shown. `viewer` is
 * whoever is previewing, the sample's reader when the audience is empty.
 */
export async function previewLetter(deps: LettersDeps, id: string, viewer: { name: string | null }): Promise<PreviewAnswer | Refusal> {
  const pool = deps.getPool();
  const letter = await letterById(pool, id);
  if (!letter) return NOT_FOUND;
  if (letter.state === "scheduled") return refuse(409, "This letter is scheduled. Cancel it to change it, or reschedule it from History.");
  if (letter.state === "sending" || letter.state === "sent") return refuse(409, "This letter has gone out. History has its numbers.");
  const draft = draftOf(letter);
  if (!draft) return refuse(409, "Choose who this letter is for, then preview it again.");

  const audience = await resolveAudience(deps, draft.audience);
  const hash = letterHash(draft);
  await replaceRecipients(pool, id, audience.recipients.map((c) => ({ emailKey: c.emailKey, contactId: c.id })));
  await recordPreview(pool, id, hash, audience.recipients.length);

  const village = await loadEmailVillage(pool, deps.postOffice.origin());
  const first = audience.recipients[0];
  const email = await renderFor(deps, letter, village, first ? { name: first.name, contactId: first.id } : { name: viewer.name, contactId: null });
  const count = audience.recipients.length;
  const now = nowMs(deps);
  const exp = Math.floor(now / 1000) + CONFIRM_MINUTES * 60;
  return {
    ok: true,
    count,
    names: audience.recipients.slice(0, PREVIEW_NAMES).map((c) => c.name?.trim() || c.email),
    inGroup: audience.inGroup,
    leftOut: audience.leftOut,
    note: audience.note,
    sampleFor: first ? first.name?.trim() || first.email : "you",
    subject: email.subject,
    preheader: email.preheader,
    html: email.html,
    text: email.text,
    voice: voiceLintWords({ subject: letter.subject, preheader: letter.preheader, bodyMd: letter.bodyMd }),
    confirmToken: count > 0 ? signConfirm({ l: id, h: hash, n: count, x: exp }, deps.key) : null,
    expiresAt: count > 0 ? exp * 1000 : null,
  };
}

// ── Send me a test ──────────────────────────────────────────────────────────

/**
 * The letter as it stands, to the person asking. Posted `essential` (they just
 * asked for it), origin `letter.test`, so it reaches them while the village
 * rehearses and never counts against anybody's letters.
 */
export async function testLetter(
  deps: LettersDeps,
  id: string,
  me: { email: string; name: string | null; userId: string | null },
): Promise<{ ok: true; result: PostResult; sentTo: string } | Refusal> {
  const pool = deps.getPool();
  const letter = await letterById(pool, id);
  if (!letter) return NOT_FOUND;
  const to = me.email.trim();
  if (!to) return refuse(400, "Your account has no email address to send a test to.");
  const village = await loadEmailVillage(pool, deps.postOffice.origin());
  const email = await renderFor(deps, letter, village, { name: me.name, contactId: null });
  const result = await post(deps.postOffice, {
    idempotencyKey: `letter.test:${id}:${crypto.randomUUID()}`,
    kind: "essential",
    origin: "letter.test",
    to: { email: to, name: me.name, userId: me.userId },
    subject: email.subject,
    html: email.html,
    text: email.text,
    preheader: email.preheader,
    // No letter id: a test is not one of the letter's sends, and History counts only those.
    source: { templateKey: email.templateKey, ...(email.version !== null ? { templateVersion: email.version } : {}) },
    urgent: true,
  });
  return { ok: true, result, sentTo: to };
}

// ── Handing a letter to the post office ─────────────────────────────────────

/** Renew the claim this often while handing over. */
const HEARTBEAT_EVERY = 20;

export interface DispatchCounts {
  posted: number;
  skipped: number;
  pending: number;
}

/**
 * One `post()` per pending snapshot row. A row the post office refused is
 * skipped with its reason; a row it could not even record stays pending, for
 * the job to try again.
 */
async function dispatch(deps: LettersDeps, letter: LetterRow): Promise<DispatchCounts> {
  const pool = deps.getPool();
  const village = await loadEmailVillage(pool, deps.postOffice.origin());
  const pending = await recipientsOf(pool, letter.id, "pending");
  const contacts = new Map((await contactsByIds(pool, pending.map((r) => r.contactId))).map((c) => [c.id, c]));
  let n = 0;
  for (const row of pending) {
    n += 1;
    if (n % HEARTBEAT_EVERY === 0) await heartbeatLetter(pool, letter.id);
    const c = contacts.get(row.contactId);
    if (!c) {
      await markRecipient(pool, letter.id, row.emailKey, { status: "skipped", skipReason: "contact_gone" });
      continue;
    }
    try {
      const email = await renderFor(deps, letter, village, { name: c.name, contactId: c.id });
      const result = await post(deps.postOffice, {
        idempotencyKey: `letter:${letter.id}:${row.emailKey}`,
        kind: "letters",
        origin: "letter",
        to: { email: c.email, name: c.name, userId: c.userId, contactId: c.id },
        subject: email.subject,
        html: email.html,
        text: email.text,
        preheader: email.preheader,
        source: { templateKey: email.templateKey, ...(email.version !== null ? { templateVersion: email.version } : {}), letterId: letter.id },
      });
      if (result.status === "failed" && !result.messageId) continue; // not recorded: it stays pending
      if (result.status === "skipped" || result.status === "expired") {
        await markRecipient(pool, letter.id, row.emailKey, { status: "skipped", skipReason: result.reason ?? result.status, messageId: result.messageId });
      } else {
        await markRecipient(pool, letter.id, row.emailKey, { status: "posted", messageId: result.messageId });
      }
    } catch (err) {
      console.error(`[comms] letter ${letter.id}: one recipient could not be handed over, so it waits for the letters job`, err);
    }
  }
  return settleLetter(pool, letter.id);
}

// ── Confirm: send now, or schedule ──────────────────────────────────────────

export type SendAnswer =
  | { ok: true; state: LetterState; duplicate: boolean; counts: DispatchCounts | null; scheduledFor: number | null }
  | Refusal;

/** An idempotency key the caller made: letters, digits and `:` `_` `.` `-`. */
const KEY_SHAPE = /^[A-Za-z0-9:_.-]{8,150}$/;

const duplicateOf = (l: LetterRow): SendAnswer => ({
  ok: true,
  state: l.state,
  duplicate: true,
  counts: { posted: l.postedCount, skipped: l.skippedCount, pending: Math.max(0, l.recipientCount - l.postedCount - l.skippedCount) },
  scheduledFor: l.scheduledFor,
});

/**
 * Check a confirmation against the letter as it stands now, then send it or
 * schedule it (`scheduledFor`, an ISO instant). See the header for the order
 * of the checks; every refusal is a sentence.
 */
export async function sendLetter(
  deps: LettersDeps,
  id: string,
  input: { confirmToken: unknown; idempotencyKey: unknown; scheduledFor?: unknown },
): Promise<SendAnswer> {
  const pool = deps.getPool();
  const key = typeof input.idempotencyKey === "string" ? input.idempotencyKey.trim() : "";
  if (!KEY_SHAPE.test(key)) return refuse(400, "The send carried no key. Preview again and confirm from there.");
  const letter = await letterById(pool, id);
  if (!letter) return NOT_FOUND;

  // A key already used answers what it did, before anything else is checked,
  // so a confirmation pressed twice is one send however long the second took.
  const holder = await letterByIdempotencyKey(pool, key);
  if (holder && holder.id !== id) return refuse(409, "That confirmation was already used for another letter. Preview again.");
  if (holder && (holder.state === "sending" || holder.state === "sent" || holder.state === "scheduled")) return duplicateOf(holder);
  if (letter.state === "sending" || letter.state === "sent") return duplicateOf(letter);
  if (letter.state === "scheduled") return refuse(409, "This letter is already scheduled. Cancel or reschedule it from History.");

  const verdict = verifyConfirm(typeof input.confirmToken === "string" ? input.confirmToken : "", nowMs(deps), deps.key);
  if (verdict === "stale") return refuse(409, `This confirmation ran out: it lasts ${CONFIRM_MINUTES} minutes. Preview again, then confirm.`);
  if (verdict === "invalid" || verdict.l !== id) return refuse(400, "That confirmation is not one this village gave for this letter. Preview again.");
  const draft = draftOf(letter);
  if (!draft) return refuse(409, "Choose who this letter is for, then preview it again.");
  const hash = letterHash(draft);
  if (hash !== verdict.h || letter.bodyHash !== verdict.h) {
    return refuse(409, "The letter changed since the preview. Preview again, so you approve exactly what goes out.");
  }
  if (letter.recipientCount !== verdict.n) return refuse(409, "Who it goes to changed since this preview. Preview again.");
  if (verdict.n === 0) return refuse(409, "Nobody in this audience has said yes to letters, so there is nobody to send it to.");
  const gap = unconfigured(deps);
  if (gap) return refuse(409, gap);

  const when = input.scheduledFor == null || input.scheduledFor === "" ? null : Date.parse(String(input.scheduledFor));
  if (when !== null) {
    const problem = scheduleProblem(when, nowMs(deps));
    if (problem) return refuse(400, problem);
    const claim = await claimLetter(pool, id, { from: EDITABLE_LETTER_STATES, to: "scheduled", idempotencyKey: key, bodyHash: hash, count: verdict.n, scheduledFor: Math.floor(when / 1000) });
    if (claim !== "claimed") return afterLostClaim(pool, id, claim);
    return { ok: true, state: "scheduled", duplicate: false, counts: null, scheduledFor: Math.floor(when / 1000) };
  }

  const window = await lettersWindow(pool);
  const cap = capProblem(window.today, window.minutesSinceLast, perDay(deps));
  if (cap) {
    // The same confirmation pressed twice at once: the first press's claim is
    // what filled the window, so this one answers it rather than the limit.
    const now = await letterById(pool, id);
    if (now && now.idempotencyKey === key && !(EDITABLE_LETTER_STATES as readonly LetterState[]).includes(now.state)) return duplicateOf(now);
    return refuse(409, cap);
  }
  const claim = await claimLetter(pool, id, { from: EDITABLE_LETTER_STATES, to: "sending", idempotencyKey: key, bodyHash: hash, count: verdict.n });
  if (claim !== "claimed") return afterLostClaim(pool, id, claim);
  const claimed = (await letterById(pool, id)) as LetterRow;
  const counts = await dispatch(deps, claimed);
  return { ok: true, state: counts.pending === 0 ? "sent" : "sending", duplicate: false, counts, scheduledFor: null };
}

/** Somebody else's claim won: say what they did, or why this one cannot go. */
async function afterLostClaim(pool: Pool, id: string, claim: "lost" | "key_taken"): Promise<SendAnswer> {
  const again = await letterById(pool, id);
  if (again && (again.state === "sending" || again.state === "sent" || again.state === "scheduled")) return duplicateOf(again);
  if (claim === "key_taken") return refuse(409, "That confirmation was already used. Preview again.");
  return refuse(409, "This letter is no longer waiting to be sent. Open it again.");
}

// ── Cancel and reschedule ───────────────────────────────────────────────────

export async function cancelLetter(deps: Pick<LettersDeps, "getPool">, id: string): Promise<{ ok: true } | Refusal> {
  const pool = deps.getPool();
  if (!(await letterById(pool, id))) return NOT_FOUND;
  if (!(await cancelScheduledLetter(pool, id))) return refuse(409, "Only a letter waiting for its time can be cancelled.");
  return { ok: true };
}

export async function moveLetter(deps: Pick<LettersDeps, "getPool" | "now">, id: string, at: unknown): Promise<{ ok: true; scheduledFor: number } | Refusal> {
  const pool = deps.getPool();
  if (!(await letterById(pool, id))) return NOT_FOUND;
  const when = Date.parse(String(at ?? ""));
  const problem = scheduleProblem(when, nowMs(deps));
  if (problem) return refuse(400, problem);
  const secs = Math.floor(when / 1000);
  if (!(await rescheduleLetter(pool, id, secs))) return refuse(409, "Only a letter waiting for its time can be moved.");
  return { ok: true, scheduledFor: secs };
}

// ── The letters job ─────────────────────────────────────────────────────────

/** What one run of the letters job did. A type, so "run now" reads it as numbers. */
export type LettersJobSummary = {
  /** Scheduled letters whose time came and were handed over. */
  sent: number;
  /** Letters left part way by a send that stopped, picked up again. */
  resumed: number;
  /** Due letters waiting: the daily limit, the gap, or no provider yet. */
  waiting: number;
  /** Scheduled letters whose words no longer matched what was confirmed, set back to be looked at. */
  returned: number;
};

/**
 * Pick up any send that stopped, then send the scheduled letters whose time
 * came. Nothing while the comms module is off.
 */
export async function runLettersJob(deps: LettersDeps): Promise<LettersJobSummary> {
  const summary: LettersJobSummary = { sent: 0, resumed: 0, waiting: 0, returned: 0 };
  const lifecycle = deps.lifecycle ? deps.lifecycle() : "off";
  if (lifecycle === "off") return summary;
  const pool = deps.getPool();

  for (const id of await staleSendingIds(pool, LETTER_RESUME_MINUTES)) {
    if (!(await reclaimStaleLetter(pool, id, LETTER_RESUME_MINUTES))) continue;
    const letter = await letterById(pool, id);
    if (!letter) continue;
    await dispatch(deps, letter);
    summary.resumed += 1;
  }

  for (const id of await dueLetterIds(pool)) {
    const letter = await letterById(pool, id);
    if (!letter) continue;
    const draft = draftOf(letter);
    if (!draft || letterHash(draft) !== letter.bodyHash) {
      console.error(`[comms] scheduled letter ${id} no longer matches what was confirmed, so it was set back to be looked at`);
      if (await cancelScheduledLetter(pool, id)) summary.returned += 1;
      continue;
    }
    const window = await lettersWindow(pool);
    if (unconfigured(deps) || capProblem(window.today, window.minutesSinceLast, perDay(deps))) {
      summary.waiting += 1;
      continue;
    }
    if (!(await claimDueLetter(pool, id))) continue;
    await dispatch(deps, (await letterById(pool, id)) as LetterRow);
    summary.sent += 1;
  }
  return summary;
}

/** The job's line for the scheduler's log. */
export async function lettersJobLine(deps: LettersDeps): Promise<string> {
  const s = await runLettersJob(deps);
  return `letters: sent ${s.sent}, resumed ${s.resumed}, waiting ${s.waiting}, returned ${s.returned}`;
}

// ── History ─────────────────────────────────────────────────────────────────

export interface LetterView {
  id: string;
  subject: string;
  preheader: string | null;
  bodyMd: string;
  layout: string;
  audience: LetterAudience | null;
  audienceLabel: string;
  state: LetterState;
  /** ISO instants, or null. */
  createdAt: string;
  scheduledFor: string | null;
  sentAt: string | null;
  recipientCount: number;
  numbers: LetterNumbers;
}

const iso = (secs: number | null): string | null => (secs == null ? null : new Date(secs * 1000).toISOString());

/** Every letter, newest first, with what the post office did with each. */
export async function letterHistory(deps: Pick<LettersDeps, "getPool">): Promise<LetterView[]> {
  const pool = deps.getPool();
  const letters = await listLetters(pool);
  const ids = letters.map((l) => l.id);
  const [numbers, skips] = await Promise.all([letterNumbers(pool, ids), snapshotSkips(pool, ids)]);
  const out: LetterView[] = [];
  for (const l of letters) {
    const n = numbers.get(l.id) as LetterNumbers;
    out.push({
      id: l.id,
      subject: l.subject,
      preheader: l.preheader,
      bodyMd: l.bodyMd,
      layout: l.layout,
      audience: l.audience,
      audienceLabel: await labelOf(deps, l.audience),
      state: l.state,
      createdAt: iso(l.createdAt) as string,
      scheduledFor: iso(l.scheduledFor),
      sentAt: iso(l.sentAt),
      recipientCount: l.recipientCount,
      // A snapshot row skipped before it reached the post office has no ledger row to count.
      numbers: { ...n, skipped: n.skipped + (skips.get(l.id) ?? 0) },
    });
  }
  return out;
}
