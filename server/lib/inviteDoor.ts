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
 * wait for a retry while the row still reads open. The refusal is the one a
 * withdrawn link gets, and the stranger holding the link never reads the
 * tombstone's name.
 */
import type { Pool } from "mysql2/promise";

import { claimInvite, inviteByHash, releaseInvite } from "../repos/memberInvites";
import { recordVouch, vouchesFor } from "../repos/vouches";
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
}

/** A maker whose link may still open the door: a member row that is not a tombstone. */
function makerStands(maker: InviterFacts | null | undefined): maker is InviterFacts {
  return !!maker && !isTombstone({ email: String(maker.email ?? "") });
}

export interface InviteDoor {
  /** Whether this village joins by invitation. Read per request, so the dial takes effect at once. */
  required(): boolean;
  /** The open link a token names and who made it, or the sentence for why there is none. */
  resolve(token: string | null): Promise<InviteLookup>;
  /** Take the link for this new account. The inviter's id, or null when it is no longer open. */
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
      if (!makerStands(maker)) return { ok: false, error: INVITE_REFUSALS.revoked };
      return { ok: true, id: row.id, inviterName: String(maker.name ?? ""), secondsLeft: row.secondsLeft };
    },

    claim: (inviteId, userId) => claimInvite(host.getPool(), inviteId, userId),

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
     */
    async welcome(inviterUserId, userId) {
      try {
        if (!makerStands(await host.members.byId(inviterUserId))) return;
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
        if (vouchState(await vouchesFor(pool, userId), needed).met) {
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
