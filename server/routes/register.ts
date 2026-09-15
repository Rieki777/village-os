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
 */
import type { Express, Request } from "express";

import { claimPaths } from "../../shared/gameConfig";
import type { InviteDoor } from "../lib/inviteDoor";
import { INVITE_REFUSALS, readInviteToken } from "../lib/invites";
import { numberVar } from "../lib/variables";

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
    const userId = `user-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const inviter = inviteId ? await deps.invites.claim(inviteId, userId) : null;
    if (inviteId && !inviter) {
      // Taken by somebody else between the check above and now.
      return res.status(409).json({ error: INVITE_REFUSALS.used, code: "invitation_used" });
    }
    const user = {
      id: userId,
      name,
      email,
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
    if (inviter) await deps.invites.welcome(inviter, userId);
    res.json({ success: true, token: deps.encodeToken(userId, email), user: deps.publicUser(user) });
  });
}
