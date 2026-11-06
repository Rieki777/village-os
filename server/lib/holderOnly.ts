/**
 * A POWER ONLY ITS HOLDERS MAY USE (ROLE_POWERS_DESIGN.md §6; Rye, Q2 and Q7).
 *
 * The one gate lets an admin through on every key the village has not taken
 * (step 1 of `capabilityDecision`). For most keys that is the point. For
 * `power.assign` it would make "only the holders of the org power may hand
 * out powers" a sentence and nothing more, because every admin would pass. So
 * the routes that hand out powers ask THIS instead, which is the gate with the
 * admin short-circuit taken out, the way `liveHoldersOfCapability` counts.
 *
 * ── THE THREE ANSWERS ──────────────────────────────────────────────────────
 *
 *   holder    the actor holds the key through a role, a seat or a badge, as the
 *             gate decides it for a non-admin. They act.
 *   fallback  NOBODY holds the key and the village has not taken it, and the
 *             actor is an admin. They act as the operator, which is how a fresh
 *             village sets itself up, and the record says so. The shape
 *             `redemption.confirm` set: a key given to nobody falls to admin.
 *   refused   anything else. A plain admin while somebody holds the key is
 *             refused here, by name, with who holds it.
 *
 * A key the village HOLDS has no fallback: an admin outside the looking-after
 * role is refused, as the gate refuses them, and the change goes to the village.
 *
 * ── GIVE ONLY WHAT YOU HOLD (Q7) ───────────────────────────────────────────
 *
 * Discord's rule and GitHub's: you cannot hand somebody a permission you do
 * not have. `mayGive` answers it per key for a holder. The operator fallback is
 * exempt, because the operator can already reach every unheld key.
 */
import { hasCapability, isVillageHeld, type Capability, type CapabilityCtx } from "../../shared/capabilities";

export type HolderOnlyAnswer =
  | { ok: true; via: "holder" | "fallback"; mayGive: (cap: string) => boolean }
  | { ok: false; status: 401 | 403 | 409; body: { error: string; code: string; capability: string; holders?: string[] } };

export interface HolderOnlyInput {
  capability: Capability;
  /** The actor's gate context, or null when nobody is signed in. */
  ctx: CapabilityCtx | null;
  /** Who holds the key right now, the admin short-circuit excluded (`liveHoldersOf`). */
  liveHolders: readonly string[];
  /** Plain words for the key, for the refusal. */
  label: string;
}

export function holderOnlyDecision({ capability, ctx, liveHolders, label }: HolderOnlyInput): HolderOnlyAnswer {
  if (!ctx) {
    return { ok: false, status: 401, body: { error: "Sign in first", code: "auth_required", capability } };
  }
  const asHolder: CapabilityCtx = { ...ctx, isAdmin: false };
  if (hasCapability(capability, asHolder)) {
    return { ok: true, via: "holder", mayGive: (cap) => hasCapability(cap as Capability, asHolder) };
  }
  const villageHolds = isVillageHeld(capability, ctx.villageHeld);
  if (villageHolds) {
    return {
      ok: false,
      status: 409,
      body: {
        error: `The village holds "${label}". A change goes to the village, or to the role that looks after it for the village.`,
        code: "village_holds_it",
        capability,
      },
    };
  }
  if (ctx.isAdmin && liveHolders.length === 0) {
    return { ok: true, via: "fallback", mayGive: () => true };
  }
  return {
    ok: false,
    status: 403,
    body: {
      error: `Only the people who hold "${label}" may do this, and an admin who does not hold it is no exception.`,
      code: "holders_only",
      capability,
      holders: [...liveHolders],
    },
  };
}
