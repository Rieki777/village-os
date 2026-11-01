/**
 * Sign-up by email and password, and the invitation that opens it.
 *
 *   POST /api/auth/register
 *
 * ── WHY IT LEFT server/index.ts ─────────────────────────────────────────────
 *
 * The invitation had to sit beside the Google door, which already lived in a
 * route module, and `server/index.ts` is ratcheted on lines. Moving the route
 * put both sign-up doors on the same `InviteDoor` (`server/lib/inviteDoor.ts`)
 * and gave the ratchet back more lines than the invitation added.
 *
 * ── THE ORDER OF THE REFUSALS IS A PRIVACY DECISION ─────────────────────────
 *
 * The throttle first, as before, because it bounds everything below it,
 * including the address check. Then the invitation, BEFORE the address check:
 * "that address already has an account" is an answer about a member, and in a
 * village that joins by invitation a stranger with no link gets no answer about
 * anybody.
 *
 * ── A LINK IS TAKEN BEFORE THE ACCOUNT IS MADE ──────────────────────────────
 *
 * Two people racing one link leave exactly one account holding it: the take is
 * a conditional UPDATE, and the loser is refused before anything is written. If
 * the account write then fails, the link is given back.
 *
 * ── AN INVITATION COUNTS IN AN OPEN VILLAGE TOO ─────────────────────────────
 *
 * With `membership.invite_only` off, nobody needs a link. A good link that
 * arrives anyway is still used, because it is still somebody's vouch. A bad
 * one is ignored there, because refusing an account the village would have let
 * in without any link would be a refusal with no reason behind it.
 *
 * ── THE ADDRESS IS UNPROVED UNTIL ITS OWNER SAYS SO (R104) ──────────────────
 *
 * Nothing here can tell whether the person typing an address reads it, so the
 * account is made with `emailVerifiedAt` null and the address is mailed a link
 * that proves it (server/lib/emailVerification.ts). Signing in by password
 * never waits on that, so a village with no email provider loses nothing. What
 * waits is trust in this password as the mailbox owner's: until the address is
 * proved, a Google sign-in at it ends the password, and no founder grant or
 * bootstrap raises the row while the password stands.
 */
import { randomBytes } from "node:crypto";
import type { Express, Request } from "express";

import { claimPaths } from "../../shared/gameConfig";
import type { InviteDoor } from "../lib/inviteDoor";
import { INVITE_REFUSALS, readInviteToken } from "../lib/invites";
import { isTombstone } from "../lib/oauthAccounts";
import { numberVar } from "../lib/variables";
// Village Comms: the one door to the email system (server/lib/commsSink.ts).
import { commsSink } from "../lib/commsSink";

export interface RegisterDeps {
  overLimit(bucket: string, max: number, windowMs: number): Promise<boolean>;
  clientIp(req: Request): string;
  members: {
    existsByEmail(email: string): Promise<boolean>;
    add(member: any): Promise<unknown>;
  };
  hashPassword(password: string): Promise<string>;
  makeHandle(name: string): Promise<string>;
  /** Every door in records the join and greets: `memberJoined` in server/lib/arrival.ts. */
  joined(member: { id: string; name: string; handle: string }): Promise<unknown>;
  encodeToken(userId: string, email: string): string;
  publicUser(member: any): any;
  invites: InviteDoor;
  /**
   * Mail the new account's address a link that proves it (R104,
   * `sendVerifyLetter` in server/lib/emailVerification.ts). Must never
   * reject: a village with no email provider still makes the account.
   */
  sendVerification(member: { id: string; email: string; name: string }): Promise<unknown>;
}

export function register(app: Express, deps: RegisterDeps): void {
  app.post("/api/auth/register", async (req, res) => {
    // FIRST statement, before the exists-by-email check, so the throttle also
    // bounds the account-enumeration oracle (409 vs 200 answers "is this
    // address a member?"). Per-IP and admin-tunable: a village onboarding
    // gathering behind one NAT shares a bucket, so the default is above
    // login's. overLimit fails open on DB trouble — an outage never blocks
    // registration.
    if (await deps.overLimit(`register:${deps.clientIp(req)}`, Math.max(1, numberVar("abuse.register_per_ip_hourly")), 60 * 60 * 1000)) {
      return res.status(429).json({ error: "Too many attempts. Try again in a few minutes." });
    }
    const { name, email, password, paths } = req.body ?? {};
    if (!name || !email || !password || !paths || !Array.isArray(paths)) {
      return res.status(400).json({ error: "Missing required fields" });
    }
    // The domain closed accounts are written at. An account here would read as
    // closed everywhere, and one at a departing member's tombstone address
    // used to block that member's erasure for good (round 2, finding 5). No
    // answer about anybody: the refusal is about the address alone.
    if (isTombstone({ email: String(email).trim() })) {
      return res.status(400).json({ error: "That address cannot hold an account. Sign up with the address you read your mail at." });
    }
    // The other door onto a member's paths, and the one a stranger can open.
    const chosen = claimPaths(paths);
    if (!chosen.ok) return res.status(400).json({ error: chosen.error });

    const token = readInviteToken(req.body?.invite);
    const required = deps.invites.required();
    let inviteId: string | null = null;
    if (token || required) {
      const found = await deps.invites.resolve(token);
      if (found.ok) inviteId = found.id;
      else if (required) return res.status(403).json({ error: found.error, code: "invitation_required" });
    }

    if (await deps.members.existsByEmail(email)) {
      return res.status(409).json({ error: "Email already exists" });
    }
    // The suffix comes from crypto. This id is signed into the member's session token, and code
    // scanning holds every value that reaches a token to that standard (js/insecure-randomness).
    const userId = `user-${Date.now()}-${randomBytes(4).toString("hex")}`;
    const inviter = inviteId ? await deps.invites.claim(inviteId, userId) : null;
    if (inviteId && !inviter) {
      // Taken by somebody else between the check above and now.
      return res.status(409).json({ error: INVITE_REFUSALS.used, code: "invitation_used" });
    }
    const user = {
      id: userId,
      name,
      email,
      // Whoever typed this address has not shown they read it, so the account
      // starts unproved (R104). Until the letter below is redeemed, this
      // password is never trusted as the mailbox owner's: a Google sign-in at
      // this address ends it, and no founder grant lands on this row.
      emailVerifiedAt: null,
      passwordHash: await deps.hashPassword(password),
      handle: await deps.makeHandle(name),
      paths: chosen.paths ?? [],
      contributions: [],
      quests: [],
      recognitionBalance: 0,
      joinedAt: new Date().toISOString(),
      bio: "",
      avatar: null,
    };
    try {
      await deps.members.add(user);
    } catch (err) {
      if (inviteId) await deps.invites.release(inviteId, userId).catch(() => undefined);
      throw err;
    }
    await deps.joined({ id: userId, name, handle: user.handle });
    // Not awaited: a slow provider must not hold the sign-up, and the letter
    // carries the only copy of the link. It is never put in the response.
    void deps.sendVerification({ id: userId, email, name }).catch(() => undefined);
    for (const pathId of user.paths) commsSink.fire({ type: "path_joined", personKey: userId, userId, email, name, pathId, source: "signup" });
    if (inviter) await deps.invites.welcome(inviter, userId);
    res.json({ success: true, token: deps.encodeToken(userId, email), user: deps.publicUser(user) });
  });
}
