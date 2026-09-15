/**
 * EVERY MEMBER ARRIVES BECAUSE SOMEBODY ALREADY HERE KNEW THEM.
 *
 * Rye's ruling, 2026-09-09: "invite members (all members are by invitation)
 * at the top of the profile that creates a special link that lets that new
 * user sign up." Anybody else can look around at everything, and joining is a
 * request that lands in the admin queue for the team to talk to them.
 *
 * ── WHAT A LINK IS ──────────────────────────────────────────────────────────
 *
 * One use, fourteen days, one inviter. The link carries a random token and the
 * table keeps only its SHA-256, so reading the table cannot sign anybody up.
 * The link is shown once, to the person who made it. Somebody who lost it
 * withdraws it and makes another.
 *
 * ── WHO MAY MAKE ONE ────────────────────────────────────────────────────────
 *
 * Whoever may vouch (`member.vouch`). The ruling of 2026-09-08 counts the
 * inviter's vouch as the first of the three, so an invitation IS a vouch, and
 * somebody who may not vouch has no vouch to give.
 *
 * ── WHAT USING ONE DOES ─────────────────────────────────────────────────────
 *
 * It opens sign-up for exactly one new account, by either door, and records
 * the inviter's vouch for that account as kind `arrival`
 * (`server/lib/inviteDoor.ts`). It admits nobody on its own, unless the village
 * has set its bar at one.
 *
 * Pure: the token, the words, and the one decision about where a link stands.
 */
import crypto from "node:crypto";

/** How long a link stays good. */
export const INVITE_DAYS = 14;

/** How many unused, unexpired links one person may hold at once. */
export const OPEN_INVITES_CAP = 20;

/** A fresh token: 32 random bytes, URL-safe. Shown once, and stored never. */
export function mintInviteToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

/** What the table keeps instead of the token. */
export function hashInviteToken(token: string): string {
  return crypto.createHash("sha256").update(String(token ?? "")).digest("hex");
}

/**
 * A token as somebody could have pasted it, or null when it cannot be one of
 * ours. Checked before any read, so junk costs no query.
 */
export function readInviteToken(raw: unknown): string | null {
  const token = String(raw ?? "").trim();
  return /^[A-Za-z0-9_-]{32,64}$/.test(token) ? token : null;
}

/** The link somebody sends. Relative, so the page puts the village's own address in front. */
export function invitePath(token: string): string {
  return `/register?invite=${encodeURIComponent(token)}`;
}

export type InviteStanding = "open" | "used" | "expired" | "revoked";

/**
 * Where a link stands. `expired` is the database's own answer, read in the
 * same query, and never this process's clock.
 *
 * Used outranks everything, because a link that made an account is best
 * described by that. Revoked outranks expired, because a person who withdrew a
 * link wants to see that they did.
 */
export function inviteStanding(row: { usedAt: unknown; revokedAt: unknown; expired: boolean }): InviteStanding {
  if (row.usedAt) return "used";
  if (row.revokedAt) return "revoked";
  if (row.expired) return "expired";
  return "open";
}

/** Whole days left on a link, from the database's seconds. Never below zero. */
export function daysLeft(secondsLeft: number): number {
  return Math.max(0, Math.ceil((Number(secondsLeft) || 0) / 86_400));
}

/** What somebody holding a link that no longer works reads, by why. */
export const INVITE_REFUSALS: Record<Exclude<InviteStanding, "open"> | "unknown", string> = {
  used: "This invitation has already been used. Ask the person who sent it for a new one.",
  expired: "This invitation has expired. Ask the person who sent it for a new one.",
  revoked: "This invitation was withdrawn. Ask the person who sent it for a new one.",
  unknown: "This invitation link was not made by this village. Check the link, or ask for a new one.",
};

/** What somebody with no invitation reads at either door. */
export const INVITATION_NEEDED =
  "Joining this village is by invitation. Ask a member for an invitation link, or send a request to join and someone will be in touch.";
