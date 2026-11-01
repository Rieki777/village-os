/**
 * THE INVITATION, AS BOTH SIGN-UP DOORS ASK FOR IT.
 *
 * Email sign-up (`server/routes/register.ts`) and Google sign-up
 * (`server/routes/authGoogle.ts`) each make accounts, and the Google door was
 * once added with half of what the email door did: it recorded the join and
 * greeted nobody. So the whole invitation lives here, once, and both doors
 * hold the same object. A third door would take this object too, or be
 * visibly missing it.
 *
 * WHAT A DOOR DOES WITH IT, in order:
 *   1. `required()` and `resolve(token)`: refuse before anything is written.
 *   2. `claim(id, userId)`: take the link for the account about to be made.
 *   3. make the account, and `release` the link if that write fails.
 *   4. `welcome(inviter, userId)`: record the inviter's vouch.
 *
 * A LINK IS ONLY AS GOOD AS ITS MAKER. A link is the maker's vouch, so one whose
 * maker has no member row, or is a tombstone (a member who asked to be
 * forgotten), opens nothing. The erasure withdraws those links outright
 * (`invites-after-tombstone`, server/lib/erasure.ts), and this door refuses
 * them on its own as well, because a sweep can stop after the tombstone and
 * wait for a retry while the row still reads open. It asks at every step that
 * reads the maker: `resolve`, `claim` (the Google door resolves at /start and
 * claims at the callback, minutes apart) and `welcome`. `resolve` refuses with
 * the sentence a withdrawn link gets; a `claim` refused this way reads to the
 * doors as a link already taken. Either way the stranger holding the link never
 * reads the tombstone's name.
 *
 * A FORMER MEMBER'S LINKS OPEN NOTHING EITHER (round 6). A resolve that keeps a
 * leaver as a former member withdraws their open links (the 'invitations' step,
 * server/lib/exitResolve.ts), but it cannot see a link a sign-up had already
 * taken, and that sign-up can give it back open, or welcome its newcomer, after
 * membership ended. So the door also refuses a former member (`leftTheVillage`:
 * a resolved departure and not admitted again), at the same three steps.
 */
import type { Pool } from "mysql2/promise";

import { leftTheVillage } from "./formerMember";
import { founderPowerStands } from "./gameStart";
import { claimInvite, inviteByHash, releaseInvite, revokeInvite } from "../repos/memberInvites";
import { livingVouchesFor, recordVouch } from "../repos/vouches";
import { INVITATION_NEEDED, INVITE_REFUSALS, hashInviteToken, inviteStanding } from "./invites";
import { isTombstone } from "./oauthAccounts";
import { boolVar, numberVar } from "./variables";
import { refuseVouch, vouchBar, vouchState } from "./vouches";
// Village Comms: the one door to the email system (server/lib/commsSink.ts).
import { commsSink } from "./commsSink";

/**
 * An open link: its id, the full name of the member who made it, and the
 * seconds it has left by the database's clock. A reader showing the name to a
 * stranger cuts it to a first name (server/routes/invites.ts).
 */
export type InviteLookup =
  | { ok: true; id: string; inviterName: string; secondsLeft: number }
  | { ok: false; error: string };

/** The fields of a member this door reads. Any member record satisfies it. */
interface InviterFacts {
  name?: unknown;
  email?: unknown;
  membershipGranted?: unknown;
  stageGranted?: unknown;
  /** The account's role: a `founder`'s invitation admits before launch (R068). */
  role?: unknown;
}

/** A maker whose link may still open the door: a member row that is not a tombstone. */
function makerStands(maker: InviterFacts | null | undefined): maker is InviterFacts {
  return !!maker && !isTombstone({ email: String(maker.email ?? "") });
}

/** `makerStands`, and not a former member (`leftTheVillage`, server/lib/formerMember.ts). */
async function makerStill(pool: Pool, makerId: string, maker: InviterFacts | null | undefined): Promise<boolean> {
  if (!makerStands(maker)) return false;
  return !(await leftTheVillage(pool, { ...maker, id: makerId }));
}

export interface InviteDoor {
  /** Whether this village joins by invitation. Read per request, so the dial takes effect at once. */
  required(): boolean;
  /** The open link a token names and who made it, or the sentence for why there is none. */
  resolve(token: string | null): Promise<InviteLookup>;
  /** Take the link for this new account. The inviter's id, or null when it is no longer open or its maker has left. */
  claim(inviteId: string, userId: string): Promise<string | null>;
  /** Give the link back when the account was never made. */
  release(inviteId: string, userId: string): Promise<void>;
  /** Record the inviter's vouch for the account their link made. Never throws. */
  welcome(inviterUserId: string, userId: string): Promise<void>;
}

/** What the door needs from the host, so this file opens no connections. */
export interface InviteDoorHost {
  getPool(): Pool;
  members: {
    byId(id: string): Promise<InviterFacts | null>;
    update(id: string, mutate: (m: any) => void): Promise<unknown>;
  };
}

export function makeInviteDoor(host: InviteDoorHost): InviteDoor {
  return {
    required: () => boolVar("membership.invite_only"),

    async resolve(token) {
      if (!token) return { ok: false, error: INVITATION_NEEDED };
      const row = await inviteByHash(host.getPool(), hashInviteToken(token));
      if (!row) return { ok: false, error: INVITE_REFUSALS.unknown };
      const standing = inviteStanding(row);
      if (standing !== "open") return { ok: false, error: INVITE_REFUSALS[standing] };
      const maker = await host.members.byId(row.inviterUserId);
      if (!maker || !(await makerStill(host.getPool(), row.inviterUserId, maker))) return { ok: false, error: INVITE_REFUSALS.revoked };
      return { ok: true, id: row.id, inviterName: String(maker.name ?? ""), secondsLeft: row.secondsLeft };
    },

    /*
     * THE MAKER IS ASKED AGAIN, after the take. The Google door resolves the
     * link at /start and carries only its id to the callback, up to fifteen
     * minutes later (OAUTH_STATE_TTL_MS), and the maker can be erased in
     * between while the sweep stops before `invites-after-tombstone`. Asking
     * after the take leaves no moment between the check and the use.
     *
     * A link whose maker has left is given back and withdrawn, as the sweep's
     * own step would withdraw it, so a sweep that resumes later finds it shut.
     * A maker who cannot be read gives the link back open and the error goes
     * on up, so no account that was never made holds it.
     */
    async claim(inviteId, userId) {
      const pool = host.getPool();
      const inviter = await claimInvite(pool, inviteId, userId);
      if (!inviter) return null;
      let stands: boolean;
      try {
        stands = await makerStill(pool, inviter, await host.members.byId(inviter));
      } catch (err) {
        await releaseInvite(pool, inviteId, userId).catch(() => undefined);
        throw err;
      }
      if (stands) return inviter;
      await releaseInvite(pool, inviteId, userId);
      await revokeInvite(pool, inviteId, inviter);
      return null;
    },

    release: (inviteId, userId) => releaseInvite(host.getPool(), inviteId, userId),

    /*
     * THE INVITER'S VOUCH, kind `arrival`, which is the kind 0198 named for it
     * and nothing wrote until now. It is recorded after the account exists, so
     * it must never cost anybody the account: a failure is logged and the
     * person still arrives, one vouch short, which a member can see and give.
     *
     * The same rules as any vouch, from the one function that holds them, and
     * the same consequence: a village whose bar is one admits on this vouch.
     * A village that turned vouching off records it and admits nobody on it.
     *
     * A maker who left between the door's check and this line gives no vouch:
     * the link was taken before the erasure withdrew it, and a tombstone has
     * nobody behind it to vouch.
     *
     * BEFORE LAUNCH A FOUNDER'S INVITATION ADMITS (readiness R068). On a fresh
     * village the bar is the launch vote's electorate, 3, an invitation is one
     * vouch, and before launch nobody but an admin can vouch, so a founder's
     * first invitees arrived as guests and the launch roll could never pass 1.
     * While `founderPowerStands` (the Game has not started), the invitee of a
     * founder account is admitted on arrival, the vouch still recorded. After
     * launch it is one vouch like anybody's. A village that switched vouching
     * off (a bar of 0) admits nobody on any vouch, this one included.
     */
    async welcome(inviterUserId, userId) {
      try {
        const maker = await host.members.byId(inviterUserId);
        if (!(await makerStill(host.getPool(), inviterUserId, maker))) return;
        const needed = vouchBar(numberVar("membership.vouches_required"));
        const refusal = refuseVouch({
          voucherUserId: inviterUserId,
          vouchedUserId: userId,
          existing: [],
          vouchedIsMember: false,
          // The account was made a moment ago by this same sign-up, so it is never a tombstone.
          vouchedIsGone: false,
          kind: "arrival",
          needed,
        });
        if (refusal) return;
        const pool = host.getPool();
        await recordVouch(pool, {
          id: `vch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          voucherUserId: inviterUserId,
          vouchedUserId: userId,
          kind: "arrival",
          note: null,
        });
        // The count of people still here, the one the vouch route admits on:
        // a vouch a departed member gave before they left admits nobody.
        const foundersDoor = needed > 0 && String(maker?.role ?? "") === "founder" && (await founderPowerStands(pool));
        if (foundersDoor || vouchState(await livingVouchesFor(pool, userId), needed).met) {
          await host.members.update(userId, (m: any) => {
            m.membershipGranted = true;
          });
          commsSink.fire({ type: "member_admitted", userId });
        }
      } catch (err) {
        console.warn(`[invites] the arrival vouch for ${userId} was not recorded: ${String((err as Error)?.message ?? err)}`);
      }
    },
  };
}
