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
 */
import type { Pool } from "mysql2/promise";

import { claimInvite, inviteByHash, releaseInvite } from "../repos/memberInvites";
import { recordVouch, vouchesFor } from "../repos/vouches";
import { INVITATION_NEEDED, INVITE_REFUSALS, hashInviteToken, inviteStanding } from "./invites";
import { boolVar, numberVar } from "./variables";
import { refuseVouch, vouchBar, vouchState } from "./vouches";

export type InviteLookup = { ok: true; id: string } | { ok: false; error: string };

export interface InviteDoor {
  /** Whether this village joins by invitation. Read per request, so the dial takes effect at once. */
  required(): boolean;
  /** The open link a token names, or the sentence for why there is none. */
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
  members: { update(id: string, mutate: (m: any) => void): Promise<unknown> };
}

export function makeInviteDoor(host: InviteDoorHost): InviteDoor {
  return {
    required: () => boolVar("membership.invite_only"),

    async resolve(token) {
      if (!token) return { ok: false, error: INVITATION_NEEDED };
      const row = await inviteByHash(host.getPool(), hashInviteToken(token));
      if (!row) return { ok: false, error: INVITE_REFUSALS.unknown };
      const standing = inviteStanding(row);
      return standing === "open" ? { ok: true, id: row.id } : { ok: false, error: INVITE_REFUSALS[standing] };
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
     */
    async welcome(inviterUserId, userId) {
      try {
        const needed = vouchBar(numberVar("membership.vouches_required"));
        const refusal = refuseVouch({
          voucherUserId: inviterUserId,
          vouchedUserId: userId,
          existing: [],
          vouchedIsMember: false,
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
        }
      } catch (err) {
        console.warn(`[invites] the arrival vouch for ${userId} was not recorded: ${String((err as Error)?.message ?? err)}`);
      }
    },
  };
}
