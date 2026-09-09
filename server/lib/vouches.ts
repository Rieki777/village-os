/**
 * WHO IS VOUCHED IN, AND BY WHOM.
 *
 * ── THE RULING THIS IMPLEMENTS (Rye, 2026-09-08) ────────────────────────────
 *
 * Every member arrives because somebody already here knew them, and whoever
 * invites is vouching. Signing the membership agreement is the member's own
 * half. The village's half is THREE vouches from three different people, the
 * inviter's counting as the first.
 *
 * A village therefore cannot begin with fewer than three people, and that is
 * the design rather than a limitation: it launches when a founder brings two
 * more and all three carry the launch, which leaves exactly the three vouchers
 * the next member needs.
 *
 * ── WHY A VOUCH CANNOT BE WITHDRAWN ─────────────────────────────────────────
 *
 * There is no revoke here and no delete route, and that is a governance
 * decision. Withdrawal would drop somebody back below the threshold and out of
 * a membership they already hold, which hands every member a demotion button
 * over a neighbour. The consequence of a vouch that went badly belongs on the
 * VOUCHER, which is where a later reputation mechanic will read it from.
 *
 * This is the one place on the ladder where a position does NOT fall when the
 * facts move, and it is deliberate. Everywhere else, ending a fact lowers the
 * answer with nothing written; here the fact cannot end.
 *
 * ── THE SUPER VOUCH ─────────────────────────────────────────────────────────
 *
 * A village that loses one of its three before a fourth reaches Contributor
 * cannot admit anybody, and would be stuck. A steward may then admit somebody
 * outright.
 *
 * It has its OWN key, `member.superVouch`, seeded onto the steward circle. The
 * first version of this rode on `steward.veto` and the governance engine ruled
 * against it: that seat moves between roles by ballot, so a shared key would
 * mean a village voting "the Elders hold the veto" had also voted "the Elders
 * may admit members outright" without being asked. Which guards it joins, and
 * the one it deliberately does not, are set out in SUPER_VOUCH_PLACEMENT at
 * the foot of this file.
 *
 * ── WHO MAY VOUCH AT ALL ────────────────────────────────────────────────────
 *
 * `member.vouch`, which opens at the Contributor rung: a voucher has finished
 * at least one quest for this village, so they have done something here before
 * speaking for somebody else. The capability check belongs to the ONE gate and
 * is made by the route; this file decides only what a set of vouches MEANS.
 */

/** A stored vouch, in the shape this file needs. */
export interface Vouch {
  voucherUserId: string;
  vouchedUserId: string;
  /** 'arrival' | 'member' | 'super'. Unknown values still count as a vouch. */
  kind: string;
  createdAt?: unknown;
}

/**
 * How many vouches admit a member.
 *
 * Three, and the number is tied to the launch rule rather than free: a village
 * launches with three people so that a fourth can be admitted. Changing it
 * changes what a village needs before it can grow, which is why it is a
 * village variable and not a constant hidden in here.
 */
export const DEFAULT_VOUCHES_FOR_MEMBERSHIP = 3;

export interface VouchState {
  /** Distinct people who have vouched. */
  count: number;
  /** How many this village asks for. */
  needed: number;
  /** Whether the village's half is satisfied, by count or by a steward. */
  met: boolean;
  /** True when a steward admitted them outright. */
  bySuper: boolean;
  /** Who vouched, in the order they did, for a profile to name them. */
  vouchers: string[];
}

/**
 * What a set of vouches means for one member.
 *
 * COUNTS DISTINCT PEOPLE, never rows. The unique key on the table already
 * refuses a second vouch from the same person, and this refuses it again,
 * because a rule this load-bearing should not depend on an index staying put.
 *
 * A SUPER VOUCH IS SUFFICIENT ON ITS OWN. It is a steward saying the village
 * would have reached three if it could, and treating it as merely one more
 * vouch would leave a stuck village exactly as stuck.
 */
export function vouchState(
  vouches: readonly Vouch[],
  needed: number = DEFAULT_VOUCHES_FOR_MEMBERSHIP,
): VouchState {
  const seen = new Set<string>();
  const vouchers: string[] = [];
  let bySuper = false;
  for (const v of vouches) {
    const who = String(v.voucherUserId ?? "");
    if (!who || seen.has(who)) continue;
    seen.add(who);
    vouchers.push(who);
    if (String(v.kind ?? "") === "super") bySuper = true;
  }
  // A village that asks for none would admit everybody the moment they signed,
  // so the floor is one: somebody always has to say they know you.
  const bar = Math.max(1, Math.floor(Number.isFinite(needed) ? needed : DEFAULT_VOUCHES_FOR_MEMBERSHIP));
  return { count: vouchers.length, needed: bar, met: bySuper || vouchers.length >= bar, bySuper, vouchers };
}

/** Why a vouch is refused, in the words the person pressing the button reads. */
export type VouchRefusal = { error: string } | null;

/**
 * Everything that makes one vouch invalid, in one place.
 *
 * The capability check is NOT here: that belongs to the one gate and the route
 * makes it. These are the rules about the ACT itself, and they are the ones a
 * route would otherwise re-derive slightly differently each time.
 */
export function refuseVouch(input: {
  voucherUserId: string;
  vouchedUserId: string;
  existing: readonly Vouch[];
  vouchedIsMember: boolean;
}): VouchRefusal {
  if (!input.voucherUserId || !input.vouchedUserId) {
    return { error: "A vouch needs somebody giving it and somebody receiving it." };
  }
  if (input.voucherUserId === input.vouchedUserId) {
    // The whole mechanism is other people saying they know you.
    return { error: "You cannot vouch for yourself." };
  }
  if (input.vouchedIsMember) {
    return { error: "They are already a member of this village." };
  }
  if (input.existing.some((v) => String(v.voucherUserId) === input.voucherUserId)) {
    // Three vouches has to mean three people, so the second press says so
    // rather than quietly doing nothing.
    return { error: "You have already vouched for them. A vouch is given once." };
  }
  return null;
}

/**
 * The sentence a member reads about their own standing at the membrane.
 *
 * Written here so the profile and any notification cannot drift apart on the
 * one number that decides whether somebody is in.
 */
export function vouchSentence(state: VouchState): string {
  if (state.bySuper) return "A steward vouched you in.";
  if (state.met) return "You have the vouches you need.";
  const left = state.needed - state.count;
  const people = left === 1 ? "one more person" : `${left} more people`;
  return `${state.count} of ${state.needed} vouches. ${people} to go.`;
}

/**
 * SUPER_VOUCH_PLACEMENT: which guards `member.superVouch` joins, and the one
 * it must not.
 *
 * The governance engine ruled on 2026-09-08 that the override needs its own
 * key rather than riding on `steward.veto`, and the reason is that the steward
 * seat MOVES: `server/lib/roleGrants.ts` says it "is filled and emptied by the
 * `role_seat` and `role_unseat` ballots and by nothing else". A shared key
 * would mean a village voting "the Elders hold the veto" had also voted "the
 * Elders may admit members outright" without ever being asked.
 *
 * IT JOINS the badge-grant refusal in `server/lib/proposalDrafts.ts`, beside
 * `ballot.vote` and `member.vouch`, so no badge can hand it to chosen people.
 * It is `false` in both the village-held and the agent-voice maps in
 * `shared/capabilities.ts`: admitting somebody outright is a voice in the
 * village's decision about who joins, and software speaking as a seat may not
 * have one.
 *
 * IT DOES NOT JOIN the refusal on `POST /api/governance/role-seats`, and that
 * is the important half. The two keys listed there come from the STAGE ladder,
 * so seating must not hand them out. The override is an APPOINTED power by
 * Rye's ruling, and that route is how a village seats the steward who holds
 * it. Listing it there would make any role carrying it permanently unseatable,
 * which is not a guard but a brick: the power would exist, be seeded onto the
 * steward circle, and be reachable by nobody, forever.
 *
 * The distinction is worth holding onto because both lists look alike from a
 * distance. One asks "may seating grant this?" and the other asks "may a badge
 * grant this?", and the override answers no to the second and yes to the first
 * by design.
 */
export const SUPER_VOUCH_PLACEMENT = "member.superVouch" as const;
