/**
 * Proving an address: the link mailed at sign-up, and the two row writes the
 * R104 fix rests on.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 *
 * Email sign-up stored whatever address it was handed and never asked whether
 * the person typing it reads that mailbox. Google's sign-in later trusted the
 * address as identity: a verified Google address matching a password account
 * was linked to it, and the password and every session stayed live. So anybody
 * could plant a password account at the address a future member, or the
 * founder, would bring to Google, and keep the account after they arrived
 * (readiness finding R104, the account pre-hijack).
 *
 * `users.email_verified_at` (0304) is the record that the address's owner
 * proved it. It is written by exactly three things, each of which reaches the
 * mailbox and nothing else:
 *
 *   1. Redeeming the link below, together with the account's own credential.
 *   2. Redeeming a set-password link (`POST /api/auth/set-password`), which is
 *      mailed to the address and REPLACES the password, so the person holding
 *      the password afterwards is the person who read the letter.
 *   3. A Google sign-in whose verified address is the account's address.
 *
 * A village with no email provider still lets people sign up with a password:
 * they stay unproved, which costs them nothing until they bring the same
 * address to Google (their password then ends, see oauthAccounts.ts) or the
 * village tries to make them a founder (refused, see founderGrant.ts).
 *
 * ── WHY THE LINK NEEDS THE ACCOUNT'S CREDENTIAL AS WELL ─────────────────────
 *
 * A planted account mails its letter to the real owner of the address, who
 * never made it. If one click on that letter proved the address, a curious
 * click would mark the planter's password as the owner's own, and the owner's
 * later Google sign-in would link without ending it: the pre-hijack, one click
 * away. So the redemption route also asks for a live session for that member
 * or the account's password. Then the person holding the password and the
 * person reading the mailbox are shown to be one person, which is what the
 * proof is supposed to mean. The owner of a planted account cannot redeem it
 * (they hold neither), and the planter cannot either (they never see the link).
 *
 * ── THE LINK ITSELF ─────────────────────────────────────────────────────────
 *
 * Same signer as every member token (`signTokenPayload`), a purpose of its own
 * so it can never be read as a set-password link or the other way round, the
 * member id and the address it was sent to (case folded), and an expiry. It is
 * NOT bound to tokenVersion, on purpose: a member who signs out on another
 * device before opening the letter should still be able to use it. It is
 * spent by the proof itself: once `emailVerifiedAt` is set every link is
 * refused, and an address the account no longer holds refuses its links too.
 */
import crypto from "node:crypto";
import { signTokenPayload } from "./memberTokens";
import { holdsUnprovenPassword, isUnclaimable } from "./oauthAccounts";

/** A day. A letter is often opened the next morning, and asking again costs one press. */
export const EMAIL_VERIFY_TTL_MS = 24 * 60 * 60 * 1000;

const PURPOSE = "verify-email-1";

/** Whether two addresses are one mailbox, as `users.email`'s collation compares them. */
export function sameAddress(a: unknown, b: unknown): boolean {
  const x = String(a ?? "").trim().toLowerCase();
  return !!x && x === String(b ?? "").trim().toLowerCase();
}

export function makeEmailVerifyToken(secret: string, userId: string, email: string, now: number = Date.now()): string {
  const payload = Buffer.from(
    JSON.stringify({ purpose: PURPOSE, userId, email: String(email).trim().toLowerCase(), exp: now + EMAIL_VERIFY_TTL_MS }),
  ).toString("base64url");
  return `${payload}.${signTokenPayload(secret, payload)}`;
}

export interface EmailVerifyClaim {
  userId: string;
  email: string;
}

/** The claim in a genuine, unexpired address-proof link, or null for anything else. */
export function readEmailVerifyToken(secret: string, token: string, now: number = Date.now()): EmailVerifyClaim | null {
  try {
    const dot = token.lastIndexOf(".");
    if (dot < 1 || dot === token.length - 1) return null;
    const payload = token.slice(0, dot);
    const provided = Buffer.from(token.slice(dot + 1));
    const expected = Buffer.from(signTokenPayload(secret, payload));
    if (provided.length !== expected.length) return null;
    if (!crypto.timingSafeEqual(provided, expected)) return null;
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf-8"));
    if (decoded.purpose !== PURPOSE || !decoded.userId || !decoded.email) return null;
    if (typeof decoded.exp !== "number" || now > decoded.exp) return null;
    return { userId: String(decoded.userId), email: String(decoded.email) };
  } catch {
    return null;
  }
}

/** What the member reads when a link cannot prove the address. */
export const EMAIL_VERIFY_REFUSAL = {
  invalid: "This link is invalid or has expired. Sign in and ask for a new one.",
  used: "This address is already confirmed. There is nothing more to do.",
  credential: "Sign in to this account first, or enter its password, to confirm the address is yours.",
  password: "That password does not match this account.",
} as const;

/**
 * Null when this link may prove this row's address now. Asked twice by the
 * route: on a plain read, and again under the row lock.
 */
export function emailVerifyRefusal(
  claim: EmailVerifyClaim,
  row: { id: string; email: string; emailVerifiedAt?: string | null; isExample?: boolean } | null,
): string | null {
  if (!row || row.id !== claim.userId || isUnclaimable(row)) return EMAIL_VERIFY_REFUSAL.invalid;
  if (!sameAddress(row.email, claim.email)) return EMAIL_VERIFY_REFUSAL.invalid;
  if (row.emailVerifiedAt) return EMAIL_VERIFY_REFUSAL.used;
  return null;
}

/**
 * Record that `provedEmail` was proved, when it is this row's address and no
 * proof is recorded yet. A mutator, for inside `members.update`. The first
 * proof stands: a later one never moves the instant.
 */
export function proveAddress(u: any, provedEmail: string, at: string = new Date().toISOString()): boolean {
  if (u.emailVerifiedAt || !sameAddress(u.email, provedEmail)) return false;
  u.emailVerifiedAt = at;
  return true;
}

/**
 * End a password nobody proved belongs to the address: the hash goes and
 * tokenVersion moves, so every session and set-password link minted before
 * this write dies with it. A mutator, for inside `members.update`, and only
 * half of the job: the caller ends the agent reach around the write
 * (`withAgentReachEnded`), because an agent token is not a session.
 */
export function endUnprovenPassword(u: any): boolean {
  if (!holdsUnprovenPassword(u)) return false;
  u.passwordHash = "";
  u.tokenVersion = (Number(u.tokenVersion) || 0) + 1;
  return true;
}

/**
 * Raise an existing row to founder, the way `POST /api/admin/bootstrap` does,
 * never leaving a password nobody proved standing on it (R104).
 *
 * Bootstrap is the deployment owner's door (ADMIN_PASSWORD), and it names the
 * founder by address. A stranger may have signed up at that address first, so
 * a password the address never proved is ended in the same locked write that
 * raises the role, with the agent reach ended around it. The bootstrap then
 * finds a row with no password and mails its claim link to the address, which
 * is the founder's way in. A PROVED password is the founder's own and stays.
 */
export async function raiseToFounder<R extends { id: string }>(
  members: { update(id: string, mutate: (u: any) => void): Promise<R | null> },
  row: R & { passwordHash?: string; emailVerifiedAt?: string | null },
  endReachAround: <T>(userId: string, change: () => Promise<T>) => Promise<T>,
): Promise<R | null> {
  const raise = () =>
    members.update(row.id, (u: any) => {
      endUnprovenPassword(u);
      u.role = "founder";
    });
  return holdsUnprovenPassword(row) ? endReachAround(row.id, raise) : raise();
}

/** What a letter needs. The same five things the recovery letter takes. */
export interface LetterDeps {
  authSecret: string;
  sendEmail(opts: { to: string[]; subject: string; html: string; origin?: string }): Promise<{ sent: boolean; reason?: string }>;
  escapeHtml(s: string): string;
  /** Where this village lives, for the absolute link. */
  origin(): string;
  projectName(): string;
}

async function post(deps: LetterDeps, to: string, letter: { origin: string; subject: string; html: string }, what: string) {
  try {
    const mail = await deps.sendEmail({ to: [to], ...letter });
    if (!mail.sent) console.error(`[auth] ${what} NOT SENT: reason=${mail.reason ?? "unknown"}`);
    return mail.sent ? { sent: true } : { sent: false, reason: mail.reason ?? "unknown" };
  } catch (e) {
    console.error(`[auth] ${what} FAILED to send`, e);
    return { sent: false, reason: "failed" };
  }
}

/**
 * Mail the account's address a link that proves it. Never throws: a sign-up
 * on a village with no email provider still makes the account, which stays
 * unproved. The link is never returned to the caller, because the caller is
 * the one party who must not be able to prove an address by asking.
 */
export async function sendVerifyLetter(deps: LetterDeps, member: { id: string; email: string }): Promise<{ sent: boolean; reason?: string }> {
  const url = `${deps.origin()}/verify-email?token=${encodeURIComponent(makeEmailVerifyToken(deps.authSecret, member.id, member.email))}`;
  const safe = deps.escapeHtml(url);
  const village = deps.escapeHtml(deps.projectName());
  return post(
    deps,
    member.email,
    {
      origin: "auth.verify_email",
      subject: "Confirm your email address",
      html: `<p>An account on ${village} was made with this address.</p>
<p>If you made it, <a href="${safe}">confirm this address</a> (the link works for a day). You will be asked to sign in, or for the account's password, so a link opened by somebody else confirms nothing.</p>
<p>If the button does nothing, paste this into your browser:<br>${safe}</p>
<p>If you did not make this account, do not use the link. Nothing has changed, and you can ignore this message.</p>`,
    },
    `address-proof letter for ${member.id}`,
  );
}

/**
 * Tell the member a Google sign-in ended the password their account held,
 * so a password that stops working is never a mystery. Sent to the account's
 * address, which on that path is the one Google just verified or the one the
 * account was linked under.
 */
export async function sendPasswordEndedLetter(deps: Omit<LetterDeps, "authSecret">, member: { id: string; email: string }): Promise<{ sent: boolean; reason?: string }> {
  const village = deps.escapeHtml(deps.projectName());
  const forgot = deps.escapeHtml(`${deps.origin()}/forgot-password`);
  return post(
    deps as LetterDeps,
    member.email,
    {
      origin: "auth.google_ended_password",
      subject: "You signed in with Google",
      html: `<p>You signed in to ${village} with Google.</p>
<p>This account also had a password, and nobody had ever confirmed this email address for it. So that password has been removed and every other device signed out, because whoever set it might not have been you.</p>
<p>If you set that password yourself, you can choose a new one here: <a href="${forgot}">${forgot}</a></p>`,
    },
    `password-ended letter for ${member.id}`,
  );
}
