/**
 * Proving an address (R104): the two routes behind the letter sign-up sends.
 *
 *   POST /api/auth/verify-email        { token, password? }   redeem a link
 *   POST /api/auth/verify-email/send                           ask for a new one
 *
 * The link and the rule live in server/lib/emailVerification.ts; read its
 * header for why redeeming needs the account's own credential as well as the
 * link. In short: the owner of a mailbox somebody else signed up with gets
 * the letter too, and one click from them must not prove a password they
 * never set.
 *
 * NEITHER ROUTE EVER RETURNS A LINK. The link is worth something only because
 * it reaches the mailbox and nowhere else.
 */
import type { Express, Request, Response } from "express";
import {
  EMAIL_VERIFY_REFUSAL,
  emailVerifyRefusal,
  proveAddress,
  readEmailVerifyToken,
  sendVerifyLetter,
  type LetterDeps,
} from "../lib/emailVerification";
import { isUnclaimable } from "../lib/oauthAccounts";

/** What this module reaches. The complete list. */
export interface VerifyEmailDeps extends LetterDeps {
  members: {
    byId(id: string): Promise<any | null>;
    update(id: string, mutate: (m: any) => void): Promise<any | null>;
  };
  /** The signed-in member behind a bearer token, or null. */
  authedUser(req: Request): Promise<any | null>;
  verifyPassword(password: string, storedHash: string): Promise<boolean>;
  overLimit(bucket: string, max: number, windowMs: number): Promise<boolean>;
  clientIp(req: Request): string;
  recordAudit(text: string, userId: string): void;
}

const HOUR = 60 * 60 * 1000;

/** A spent link is a 409 (there is nothing left to do); a bad or dead one is a 400. */
function refuse(res: Response, refusal: string): Response {
  const used = refusal === EMAIL_VERIFY_REFUSAL.used;
  return res.status(used ? 409 : 400).json({ error: refusal, code: used ? "used" : "invalid" });
}

export function register(app: Express, deps: VerifyEmailDeps): void {
  app.post("/api/auth/verify-email", async (req: Request, res: Response) => {
    if (await deps.overLimit(`verify-email:${deps.clientIp(req)}`, 30, HOUR)) {
      return res.status(429).json({ error: "Too many attempts. Try again in a few minutes." });
    }
    const claim = readEmailVerifyToken(deps.authSecret, String(req.body?.token ?? ""));
    if (!claim) return refuse(res, EMAIL_VERIFY_REFUSAL.invalid);
    const row = await deps.members.byId(claim.userId);
    const refusal = emailVerifyRefusal(claim, row);
    if (refusal) return refuse(res, refusal);

    // THE ACCOUNT'S OWN CREDENTIAL, beside the link. A session for this very
    // member, or this account's password. Anything else, including a session
    // for a different member, proves nothing about who set the password.
    const viewer = await deps.authedUser(req);
    if (viewer?.id !== row.id) {
      const password = typeof req.body?.password === "string" ? req.body.password : "";
      if (!password) return res.status(403).json({ error: EMAIL_VERIFY_REFUSAL.credential, code: "credential_required" });
      // Per account, because this is a password check: the link bounds who
      // can reach it, and this bounds what they can try once they have.
      if (await deps.overLimit(`verify-email-acct:${row.id}`, 10, HOUR)) {
        return res.status(429).json({ error: "Too many attempts. Try again in a few minutes." });
      }
      if (!row.passwordHash || !(await deps.verifyPassword(password, row.passwordHash))) {
        return res.status(403).json({ error: EMAIL_VERIFY_REFUSAL.password, code: "wrong_password" });
      }
    }

    // Asked again under the row lock: two clicks racing on one link record
    // one proof, and the instant never moves once it is set.
    const lost = { refusal: null as string | null };
    const saved = await deps.members.update(row.id, (u: any) => {
      if ((lost.refusal = emailVerifyRefusal(claim, u))) return;
      proveAddress(u, claim.email);
    });
    if (!saved) return refuse(res, EMAIL_VERIFY_REFUSAL.invalid);
    if (lost.refusal) return refuse(res, lost.refusal);
    deps.recordAudit("auth:email-verified", row.id);
    res.json({ success: true, emailVerifiedAt: saved.emailVerifiedAt });
  });

  app.post("/api/auth/verify-email/send", async (req: Request, res: Response) => {
    const viewer = await deps.authedUser(req);
    if (!viewer) return res.status(401).json({ error: "auth_required" });
    if (isUnclaimable(viewer)) return res.status(409).json({ error: "That account cannot be confirmed." });
    if (viewer.emailVerifiedAt) return res.json({ success: true, already: true });
    // A letter is a send on the village's account with its provider, so it is
    // bounded per member and per address of origin, like forgot-password.
    if (
      (await deps.overLimit(`verify-email-send:${deps.clientIp(req)}`, 10, HOUR)) ||
      (await deps.overLimit(`verify-email-send-acct:${viewer.id}`, 3, HOUR))
    ) {
      return res.status(429).json({ error: "Too many letters asked for. Try again in an hour." });
    }
    const mail = await sendVerifyLetter(deps, viewer);
    res.json({ success: true, emailed: mail.sent });
  });
}
