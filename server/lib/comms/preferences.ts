/**
 * ONE PERSON'S EMAIL CHOICES, as a page shows them and as a press changes
 * them (the comms build spec 5.3 and 5.4).
 *
 * Three doors read and write through here, and they must agree, so they share
 * this file: the preferences page reached by a signed link (no sign-in), the
 * one-click unsubscribe, and the "Email from the village" section of a
 * member's own notification settings.
 *
 * LETTERS NEED TWO STEPS FROM SOMEBODY WITH NO ACCOUNT. Turning letters on
 * from a link writes nothing: it sends a confirmation email to the address,
 * and only the press in THAT email says yes (the `letters_confirm` action,
 * server/lib/comms/actions.ts). A link can be forwarded, and a forwarded link
 * must not be able to sign somebody else up to a newsletter. A member turning
 * letters on in their own account needs no second step: the account is the
 * proof.
 *
 * WHAT A STOPPED ADDRESS MAY DO. Stopping everything leaves exactly one door
 * open on the page: start again. A bounce, a complaint, or a stop a person at
 * the village made is lifted by a person at the village, on the People
 * screen, and the page says so in plain words.
 */
import type { OutgoingEmail, PostResult } from "../../../shared/comms/contracts";
import { defaultTemplate } from "../../../shared/comms/defaults/templates";
import type { PermissionBasis, PermissionKind, SuppressionReason } from "../../../shared/comms/kinds";
import { SUPPRESSION_REASONS } from "../../../shared/comms/kinds";
import {
  addressHint,
  BLOCKED_WORDS,
  CHOOSABLE_KINDS,
  KIND_WORDS,
  PAUSE_DAYS,
  type KindView,
  type PreferencesChange,
  type PreferencesView,
} from "../../../shared/comms/preferences";
import { contactById, type ContactRow } from "../../repos/commsContacts";
import { suppressionOf } from "../../repos/commsPeople";
import { signLink } from "./links";
import { escapeHtml } from "./mailer";
import {
  answersFor,
  memberOf,
  setPause,
  startAgain,
  stopEverything,
  subscribe,
  unsubscribe,
  type ChangeResult,
  type PeopleDeps,
} from "./permissions";

/** How long a letters confirmation link stays good. */
export const LETTERS_CONFIRM_DAYS = 7;
/** How long a preferences link handed to a page stays good. */
export const PREFERENCES_LINK_DAYS = 365;

/** What a confirmation email needs to be written and sent. */
export interface LettersMailDeps {
  /** The post office (server/lib/comms/postOffice.ts), bound to its dependencies. */
  post(email: OutgoingEmail): Promise<PostResult>;
  /** This village's absolute origin, for the link in the email. */
  origin(): string;
  /** The village's own name. */
  projectName(): string;
  /**
   * The words of the confirmation. The words lane's renderer replaces the
   * default below at merge; it receives the confirm link as
   * `links.lettersConfirm`.
   */
  render?: (vars: { "village.name": string; "person.firstName": string; "links.lettersConfirm": string }) => {
    subject: string;
    html: string;
    text: string;
    preheader?: string | null;
  };
}

export interface PreferencesDeps extends PeopleDeps {
  projectName(): string;
  letters: LettersMailDeps;
}

const isReason = (r: string): r is SuppressionReason => (SUPPRESSION_REASONS as readonly string[]).includes(r);

/** The village's name, never empty. */
const villageOf = (deps: { projectName(): string }): string => String(deps.projectName() ?? "").trim() || "the village";

// ── The view ────────────────────────────────────────────────────────────────

/**
 * Everything the preferences page shows for one contact, or null when the
 * contact is gone (erased, or swept by retention).
 */
export async function preferencesView(deps: PreferencesDeps, contactId: string): Promise<PreferencesView | null> {
  const pool = deps.getPool();
  const contact = await contactById(pool, contactId);
  if (!contact) return null;
  return viewOf(deps, contact);
}

async function viewOf(deps: PreferencesDeps, contact: ContactRow): Promise<PreferencesView> {
  const member = await memberOf(deps, contact);
  const answers = await answersFor(deps, contact, member);
  const held = await suppressionOf(deps.getPool(), contact.emailKey);
  const reason = held && isReason(held.reason) ? held.reason : null;
  const stopped = reason === "unsubscribed_all";
  const blocked = reason && !stopped ? { reason, sentence: BLOCKED_WORDS[reason] } : null;
  const pauses = CHOOSABLE_KINDS.map((k) => answers[k].pausedUntil ?? 0);
  const pausedUntil = Math.max(0, ...pauses);
  const kinds: KindView[] = CHOOSABLE_KINDS.filter((k) => k !== "notices" || member !== null).map((k) => {
    const a = answers[k];
    const on = a.state === "yes";
    let note: string | null = null;
    if (k === "letters" && !on && !member) note = "We send you an email to confirm first.";
    if (k === "notices") note = "Which notifications come by email is set in your account.";
    return { kind: k, on, basis: a.basis, source: a.source, changeable: !stopped && !blocked, note };
  });
  return {
    village: villageOf(deps),
    addressHint: addressHint(contact.email),
    member: member !== null,
    kinds,
    pausedUntil: pausedUntil > 0 ? new Date(pausedUntil).toISOString() : null,
    stopped,
    blocked,
  };
}

// ── Changes ─────────────────────────────────────────────────────────────────

/** Where a change came from, which decides the basis an answer is recorded on. */
export type ChangeVia = "link" | "account";

export type PreferencesOutcome =
  | { ok: true; view: PreferencesView; notice: string | null }
  | { ok: false; status: number; error: string };

const fail = (r: ChangeResult & { ok: false }): PreferencesOutcome => ({ ok: false, status: r.status, error: r.error });

/**
 * Apply one change from the page or the account panel, and answer the page
 * as it now stands.
 */
export async function applyPreferencesChange(
  deps: PreferencesDeps,
  contactId: string,
  change: PreferencesChange,
  via: ChangeVia,
): Promise<PreferencesOutcome> {
  const pool = deps.getPool();
  const contact = await contactById(pool, contactId);
  if (!contact) return { ok: false, status: 404, error: "We no longer hold this address." };
  const before = await viewOf(deps, contact);
  const source = via === "account" ? "profile" : "preferences";
  const basis: PermissionBasis = via === "account" ? "account" : "asked";
  let notice: string | null = null;

  if (change.type === "start_again") {
    const r = await startAgain(deps, { contactId });
    if (!r.ok) return fail(r);
    notice = "Email from the village can reach you again.";
  } else if (change.type === "stop_everything") {
    const r = await stopEverything(deps, { contactId, by: via === "account" ? contact.userId : null });
    if (!r.ok) return fail(r);
    notice = "Done. The only email that still comes is the kind you ask for, like a password link.";
  } else if (before.stopped || before.blocked) {
    // A stopped address takes one press, start again; a blocked one, none.
    // Turning a switch here would record an answer the person cannot see work.
    return {
      ok: false,
      status: 409,
      error: before.blocked ? before.blocked.sentence : "You asked us to stop every email. Press Start again first.",
    };
  } else if (change.type === "pause") {
    const until = change.on ? new Date((deps.now ? deps.now() : Date.now()) + PAUSE_DAYS * 86_400_000) : null;
    const r = await setPause(deps, { contactId, until });
    if (!r.ok) return fail(r);
    notice = change.on ? `Paused for ${PAUSE_DAYS} days. It starts again by itself.` : "Your email has started again.";
  } else if (!change.on) {
    const r = await unsubscribe(deps, { contactId, kind: change.kind, basis, source });
    if (!r.ok) return fail(r);
  } else if (change.kind === "letters" && !before.member && via === "link") {
    const sent = await askToConfirmLetters(deps, contact);
    if (!sent.ok) return { ok: false, status: 503, error: sent.error };
    notice = "We sent you an email. Press the button in it and your letters start.";
  } else {
    const r = await subscribe(deps, {
      contactId,
      kind: change.kind,
      basis,
      source,
      evidence: { words: KIND_WORDS[change.kind].description },
    });
    if (!r.ok) return fail(r);
  }
  return { ok: true, view: await viewOf(deps, contact), notice };
}

// ── Letters, confirmed by email ─────────────────────────────────────────────

/** The day an idempotency key is stamped with, so a page pressed twice in a day sends one email. */
const dayOf = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/** The confirmation's words with no words lane in the build: the platform default, filled in plainly. */
function defaultLettersWords(vars: { "village.name": string; "person.firstName": string; "links.lettersConfirm": string }) {
  const t = defaultTemplate("letters.confirm");
  const fill = (s: string, html: boolean) =>
    s.replace(/\{\{\s*([a-zA-Z.]+)\s*\}\}/g, (_m, field: string) => {
      const value = String((vars as Record<string, string>)[field] ?? "");
      return html ? escapeHtml(value) : value;
    });
  const subject = fill(t?.subject ?? "Confirm your letters from {{village.name}}", false);
  const body = fill(t?.bodyMd ?? "Press the link below to start getting letters from {{village.name}}.", false);
  const link = vars["links.lettersConfirm"];
  const html =
    `<!doctype html><html><body style="font-family:system-ui,-apple-system,sans-serif;color:#1f2937;padding:24px">` +
    `<p style="font-size:16px;line-height:1.5">${escapeHtml(body)}</p>` +
    `<p><a href="${escapeHtml(link)}" style="display:inline-block;background:#1f2937;color:#fff;padding:10px 20px;` +
    `border-radius:8px;text-decoration:none;font-weight:600">Yes, send me letters</a></p></body></html>`;
  return { subject, html, text: `${body}\n\nYes, send me letters: ${link}\n`, preheader: null };
}

/**
 * Send the email that asks a person with no account to confirm letters.
 * Essential and urgent: they just asked for it, so it goes now and goes even
 * to an address that stopped everything else.
 */
export async function askToConfirmLetters(
  deps: { letters: LettersMailDeps; projectName(): string; now?: () => number },
  contact: ContactRow,
): Promise<{ ok: true; status: PostResult["status"] } | { ok: false; error: string }> {
  const token = signLink("letters_confirm", { c: contact.id }, LETTERS_CONFIRM_DAYS);
  const link = `${deps.letters.origin().replace(/\/$/, "")}/email/a?t=${encodeURIComponent(token)}`;
  const vars = {
    "village.name": villageOf(deps),
    "person.firstName": String(contact.name ?? "").trim().split(/\s+/)[0] || "there",
    "links.lettersConfirm": link,
  };
  const words = (deps.letters.render ?? defaultLettersWords)(vars);
  const result = await deps.letters.post({
    idempotencyKey: `letters-confirm:${contact.id}:${dayOf(deps.now ? deps.now() : Date.now())}`,
    kind: "essential",
    origin: "comms.letters_confirm",
    to: { email: contact.email, name: contact.name, userId: contact.userId, contactId: contact.id },
    subject: words.subject,
    html: words.html,
    text: words.text,
    preheader: words.preheader ?? null,
    source: { templateKey: "letters.confirm" },
    urgent: true,
  });
  // A second press the same day is the same email: it already went.
  if (result.status === "sent" || result.status === "duplicate" || result.status === "queued") {
    return { ok: true, status: result.status };
  }
  return { ok: false, error: "The confirmation email could not be sent just now. Try again in a little while." };
}

/** A fresh preferences link for one contact, for a page or an email to hand on. */
export function preferencesToken(contactId: string): string {
  return signLink("preferences", { c: contactId }, PREFERENCES_LINK_DAYS);
}

/** A fresh one-click unsubscribe link's token for one kind, in the shape the post office signs. */
export function unsubscribeToken(contactId: string, kind: PermissionKind): string {
  return signLink("unsubscribe", { c: contactId, k: kind }, PREFERENCES_LINK_DAYS);
}
