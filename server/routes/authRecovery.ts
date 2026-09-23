/**
 * Account recovery: the one route that can put a member back into a village
 * they are locked out of.
 *
 * MOVED OUT OF server/index.ts BY THIS LANE, unchanged in shape and registered
 * at exactly the point it used to sit, because Express matches in registration
 * order. Two things came with the move:
 *
 *  1. The eligibility rule is now `maySendSetPasswordLink` in
 *     server/lib/oauthAccounts.ts, which is a unit test instead of a truthiness
 *     check on a password hash. That check was the bug: an account that never
 *     set a password got the success message and no email, on every attempt,
 *     forever. Read the reasoning there.
 *  2. A send that did not send is now logged. `sendResendEmail` RETURNS a
 *     result and only throws on an unexpected fault, so the try/catch this
 *     route already had could never see the ordinary failure: no provider
 *     configured, no sender address, an address the provider would not take.
 *     Every one of those left a member waiting for a letter that was never
 *     posted, with nothing in the log to find. The response is unchanged.
 *
 * WHAT DID NOT CHANGE, and must not. Every caller gets one identical 200:
 * unknown address, example identity, tombstone, claim-pending account and
 * ordinary reset are indistinguishable from outside. That is the
 * account-enumeration defence, and it survives the fix because the fix changes
 * which letter is SENT and never what is ANSWERED.
 */
import type { Express, Request, Response } from "express";
import { makeSetPasswordToken } from "../lib/memberTokens";
import { maySendSetPasswordLink } from "../lib/oauthAccounts";

/** What this module reaches. The complete list. */
export interface RecoveryDeps {
  authSecret: string;
  members: { byEmail(email: string): Promise<any | null> };
  /** True when the caller has already spent its budget. */
  overLimit(bucket: string, max: number, windowMs: number): Promise<boolean>;
  clientIp(req: Request): string;
  /** The live game variable for the per-IP hourly ceiling. */
  resetPerIpHourly(): number;
  sendEmail(opts: {
    to: string[];
    subject: string;
    html: string;
  }): Promise<{ sent: boolean; reason?: string }>;
  escapeHtml(s: string): string;
  /** Where this village lives, for the absolute link in the letter. */
  origin(): string;
  projectName(): string;
  recordAudit(text: string, userId: string): void;
}

export function register(app: Express, deps: RecoveryDeps): void {
  app.post("/api/auth/forgot-password", async (req: Request, res: Response) => {
    const sameAnswer = {
      success: true,
      message: "If an account exists for that address, a link to set a new password is on its way.",
    };
    if (await deps.overLimit(`forgot:${deps.clientIp(req)}`, Math.max(1, deps.resetPerIpHourly()), 60 * 60 * 1000)) {
      return res.status(429).json({ error: "Too many attempts. Try again in a few minutes." });
    }
    const email = String(req.body?.email ?? "").trim();
    if (!email) return res.status(400).json({ error: "An email address is required" });
    // Per-address bucket too: without it, one address can be mail-bombed
    // from a pool of IPs.
    if (await deps.overLimit(`forgot-acct:${email.toLowerCase()}`, 5, 60 * 60 * 1000)) {
      return res.json(sameAnswer);
    }
    const user = await deps.members.byEmail(email);
    const verdict = maySendSetPasswordLink(user);
    if (verdict.send) {
      // The token is bound to the member's tokenVersion, which setting a
      // password bumps, so it works once, for the claim case as much as the
      // reset. Nothing derived from the password rides in it.
      const claim = makeSetPasswordToken(deps.authSecret, user.id, user.tokenVersion ?? 0);
      const claimUrl = `${deps.origin()}/set-password?token=${encodeURIComponent(claim)}`;
      const village = deps.escapeHtml(deps.projectName());
      const safeUrl = deps.escapeHtml(claimUrl);
      // Two letters, because the two states are different facts and a member
      // who never had a password should not be told somebody asked to change
      // it. Which one arrives is visible only inside the mailbox, so this
      // says nothing to an anonymous caller.
      const letter =
        verdict.kind === "reset"
          ? {
              subject: "Set a new password",
              html: `<p>Someone asked to set a new password for your account on ${village}.</p>
<p><a href="${safeUrl}">Set a new password</a> (link expires in 60 minutes, and works once).</p>
<p>If the button does nothing, paste this into your browser:<br>${safeUrl}</p>
<p>If this wasn't you, nothing has changed. You can ignore this message.</p>`,
            }
          : {
              subject: "Set your password",
              html: `<p>Your account on ${village} does not have a password yet, so there is nothing to reset. This link sets your first one.</p>
<p><a href="${safeUrl}">Set your password</a> (link expires in 60 minutes, and works once).</p>
<p>If the button does nothing, paste this into your browser:<br>${safeUrl}</p>
<p>If this wasn't you, nothing has changed. You can ignore this message.</p>`,
            };
      try {
        const mail = await deps.sendEmail({ to: [user.email], subject: letter.subject, html: letter.html });
        if (!mail.sent) {
          // The member has a 200 in their browser and no letter on the way.
          // Somebody has to be able to find that, and the reason names the
          // setting to fix.
          console.error(
            `[auth] recovery email NOT SENT for ${user.id} (${verdict.kind}): reason=${mail.reason ?? "unknown"}. ` +
              "The member got a success message and no link.",
          );
        }
      } catch (e) {
        console.error(`[auth] recovery email FAILED for ${user.id}: the member got a 200 and no link`, e);
      }
      deps.recordAudit(
        verdict.kind === "reset" ? "auth:password-reset-requested" : "auth:claim-link-requested",
        user.id,
      );
    }
    res.json(sameAnswer);
  });
}
