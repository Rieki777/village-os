/**
 * Invitations: the link a member sends, which is how an account is made in a
 * village that joins by invitation.
 *
 *   POST /api/invites                make a link (whoever may vouch)
 *   GET  /api/me/invites             the links you made, and what became of them
 *   POST /api/invites/:id/revoke     withdraw one nobody has used
 *   GET  /api/invites/check?token=   what somebody holding a link is told first
 *
 * The rules are `server/lib/invites.ts`, the table is
 * `server/repos/memberInvites.ts`, and what USING a link does is
 * `server/lib/inviteDoor.ts`, because two sign-up doors use it.
 *
 * ── THE LINK IS IN ONE RESPONSE, ONCE ───────────────────────────────────────
 *
 * `POST /api/invites` is the only answer that ever carries a token. The list
 * says what became of each link and never the link itself, because the table
 * cannot say it: only the hash is kept.
 *
 * ── A LINK IS WRITTEN ONLY WHILE THE SESSION HOLDS ──────────────────────────
 *
 * A link admits a stranger on the member's vouch, so a new password and an
 * admin's revoke sessions withdraw every open one (`endAgentReach`). The make
 * writes under the member's row lock, so a session that change ended makes
 * none (`makeInvite`).
 */
import type { Express } from "express";
import type { Pool } from "mysql2/promise";

import type { AppDeps } from "../lib/appDeps";
import type { InviteDoor } from "../lib/inviteDoor";
import {
  INVITE_DAYS,
  INVITE_REFUSALS,
  OPEN_INVITES_CAP,
  daysLeft,
  hashInviteToken,
  invitePath,
  inviteStanding,
  mintInviteToken,
  readInviteToken,
} from "../lib/invites";
import { whileSessionHolds } from "../lib/agentTokens";
import { createInviteOn, invitesBy, openInviteCount, revokeInvite } from "../repos/memberInvites";

type Deps = Pick<AppDeps, "authedUser" | "getPool" | "members" | "guardCapability" | "mayAct" | "overLimit" | "clientIp"> & {
  invites: InviteDoor;
};

/** A first name, for a line a stranger holding a link reads. Never a full name, never an address. */
const firstName = (name: unknown): string => String(name ?? "").trim().split(/\s+/)[0] || "A member";

/** What somebody who may not invite yet reads, from the refusal and from their own list alike. */
const NOT_YET =
  "Inviting somebody opens at Contributor: once you are a member and the village has paid you for something you brought it. An invitation is your vouch for the person you send it to.";

/** What a member at the cap reads. */
const AT_THE_CAP = `You have ${OPEN_INVITES_CAP} invitations nobody has used yet. Withdraw one you no longer need, and then make another.`;

export type MakeInviteResult = { ok: true; id: string; token: string } | { ok: false; status: 401 | 409; error: string };

/**
 * Make one link for `inviterUserId`, the write behind `POST /api/invites`.
 * The token is in the result and nowhere else.
 *
 * `sessionVersion` is the tokenVersion the request's session was checked at
 * (adversarial round 3, the window round 2 finding 15 closed for the inbox).
 * A new password or an admin's revoke sessions that lands after that check
 * ends the open links on both sides of the bump, and a link written after
 * that would admit a stranger on the member's vouch for fourteen days. So
 * the row goes in under the member's row lock, and only while the row still
 * carries that version (`whileSessionHolds`): a change that committed first
 * is refused with 401 and nothing written, and one that comes later waits
 * for the commit, and the end after the bump withdraws the link. An
 * erasure's tombstone is refused the same way.
 */
export async function makeInvite(pool: Pool, inviterUserId: string, sessionVersion: number): Promise<MakeInviteResult> {
  if ((await openInviteCount(pool, inviterUserId)) >= OPEN_INVITES_CAP) return { ok: false, status: 409, error: AT_THE_CAP };
  const token = mintInviteToken();
  const id = `inv-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const held = await whileSessionHolds(pool, inviterUserId, sessionVersion, (conn) =>
    createInviteOn(conn, { id, tokenHash: hashInviteToken(token), inviterUserId, days: INVITE_DAYS }),
  );
  if (!held.ok) return { ok: false, status: 401, error: "auth_required" };
  return { ok: true, id, token };
}

export function register(app: Express, deps: Deps): void {
  const { authedUser, getPool, members, guardCapability, mayAct, overLimit, clientIp, invites } = deps;

  app.post("/api/invites", async (req, res) => {
    const user = await authedUser(req);
    if (!user) return res.status(401).json({ error: "auth_required" });
    if (!(await guardCapability(req, res, "member.vouch", { status: 403, body: { error: NOT_YET } }))) {
      return;
    }
    const made = await makeInvite(getPool(), String(user.id), Number(user.tokenVersion ?? 0));
    if (!made.ok) return res.status(made.status).json({ error: made.error });
    res.json({ id: made.id, path: invitePath(made.token), expiresInDays: INVITE_DAYS });
  });

  app.get("/api/me/invites", async (req, res) => {
    const user = await authedUser(req);
    if (!user) return res.status(401).json({ error: "auth_required" });
    const pool = getPool();
    const rows = await invitesBy(pool, String(user.id));
    // Who each used link let in. The list is capped at fifty, so this is at
    // most fifty reads of a cached member, and usually a handful.
    const arrivals = new Map<string, any>();
    for (const r of rows) {
      if (r.usedByUserId && !arrivals.has(r.usedByUserId)) arrivals.set(r.usedByUserId, await members.byId(r.usedByUserId));
    }
    /*
     * THE GATE'S OWN ANSWER, asked without answering the request. A profile
     * offers the button only to somebody the write would let through, and it
     * cannot read that off the power catalogue: the catalogue leaves out a
     * switched-off module's keys, and `member.vouch` is the Governance
     * module's, while the gate never looks at a module's switch at all.
     */
    const mayInvite = (await mayAct(req, "member.vouch")).ok;
    res.json({
      mayInvite,
      closed: mayInvite ? null : NOT_YET,
      // How long a new link lasts, so a sentence about it reads the rule and never a copy of it.
      days: INVITE_DAYS,
      cap: OPEN_INVITES_CAP,
      open: await openInviteCount(pool, String(user.id)),
      invites: rows.map((r) => {
        const standing = inviteStanding(r);
        const who = r.usedByUserId ? arrivals.get(r.usedByUserId) : null;
        return {
          id: r.id,
          standing,
          createdAt: r.createdAt,
          daysLeft: standing === "open" ? daysLeft(r.secondsLeft) : 0,
          usedBy: who ? { name: firstName(who.name), handle: who.handle ?? null } : null,
        };
      }),
    });
  });

  app.post("/api/invites/:id/revoke", async (req, res) => {
    const user = await authedUser(req);
    if (!user) return res.status(401).json({ error: "auth_required" });
    const revoked = await revokeInvite(getPool(), String(req.params.id ?? ""), String(user.id));
    if (!revoked) {
      return res.status(409).json({ error: "That invitation has already been used or withdrawn, or somebody else made it." });
    }
    res.json({ revoked: true });
  });

  /*
   * PUBLIC, because the person asking has no account yet: that is the whole
   * situation. BOUNDED, because an unbounded yes-or-no about a token is a
   * guessing oracle, however long the token. It names the inviter by first
   * name only, which is what makes a link feel like a person and says nothing
   * a stranger could use.
   *
   * THE SAME ANSWER THE SIGN-UP DOORS GET, from the same `resolve`, so a link
   * this page calls good is one sign-up takes. A link whose maker left is
   * refused as withdrawn, and the maker is never named.
   */
  app.get("/api/invites/check", async (req, res) => {
    if (await overLimit(`invite-check:${clientIp(req)}`, 60, 60 * 60 * 1000)) {
      return res.status(429).json({ error: "Too many attempts. Try again in a few minutes." });
    }
    const inviteOnly = invites.required();
    const token = readInviteToken(req.query.token);
    if (!token) return res.json({ inviteOnly, valid: false, error: INVITE_REFUSALS.unknown });
    const found = await invites.resolve(token);
    if (!found.ok) return res.json({ inviteOnly, valid: false, error: found.error });
    res.json({
      inviteOnly,
      valid: true,
      invitedBy: firstName(found.inviterName),
      daysLeft: daysLeft(found.secondsLeft),
    });
  });
}
