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
 * ── ZERO TURNS IT OFF ───────────────────────────────────────────────────────
 *
 * A village may set `membership.vouches_required` to 0, and then no number of
 * vouches admits anybody: admission is in the hands of whoever holds the super
 * vouch, the steward circle by default. That is how a village centralises its
 * door, and main's own `membership.vouch_threshold` documented the same
 * contract ("0 keeps vouching off") before this dial replaced it.
 *
 * It needs saying because this file used to floor the bar at one. The floor
 * was written as a safety rule, "somebody always has to say they know you",
 * and did the opposite of what it said: in the one village that had asked for
 * vouches to admit nobody, a single vouch let somebody in. `vouchBar` is now
 * the only reading of the dial, and it has no floor.
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
 * outright. In a village that has turned vouching off, it is the ordinary way
 * in.
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
 * `member.vouch`, which opens at the Contributor rung: the village has paid the
 * voucher for something they brought it, so they have done something here
 * before speaking for somebody else. A steward carries it regardless, because
 * `member.superVouch` carries `member.vouch` in the gate. The capability check
 * belongs to the ONE gate and is made by the route; this file decides only
 * what a set of vouches MEANS.
 */
import { SUBJECT_THRESHOLDS, VILLAGE_LAUNCH } from "../../shared/ballotSubjects";

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
 * READ FROM THE LAUNCH RULE, NOT TYPED, and the derivation is the point.
 *
 * The number is tied to the launch bar rather than free: a village launches
 * with three people so that a fourth can be admitted. That sentence was true
 * and it was written in three places, here and in this dial's description and
 * in the launch threshold itself, with nothing comparing them. Two of those
 * three were prose. A later lane moving the launch bar to four would have left
 * two files quietly claiming an arithmetic that no longer held, and nothing
 * anywhere would have gone red, because a village that cannot admit its fourth
 * member does not fail: it just never grows, months later, for no visible
 * reason.
 *
 * So there is one home now and it is the one the ballot actually enforces.
 * Move `minElectorate` and this follows.
 */
export const DEFAULT_VOUCHES_FOR_MEMBERSHIP =
  SUBJECT_THRESHOLDS[VILLAGE_LAUNCH].minElectorate;

/**
 * The bar a village's dial means. The ONLY reading of it: the count below, the
 * refusals and the route all go through here.
 *
 * ZERO IS OFF, and so is anything that is not a bar at all. A negative or a
 * non-number is not a number anybody set, and off is the closed direction: it
 * admits nobody by count and leaves the steward's door working. The variables
 * layer already reads an integer it cannot parse as 0, so this agrees with it
 * instead of inventing a third answer. A fraction rounds down, so 0.5 is off.
 */
export function vouchBar(raw: number): number {
  return Number.isFinite(raw) && raw >= 1 ? Math.floor(raw) : 0;
}

export interface VouchState {
  /** Distinct people who have vouched. */
  count: number;
  /** How many this village asks for. 0 when vouching is off. */
  needed: number;
  /** Whether the village's half is satisfied, by count or by a steward. */
  met: boolean;
  /** True when a steward admitted them outright. */
  bySuper: boolean;
  /**
   * True when the village has turned vouching off. `met` can then only come
   * from a super vouch, and `needed` is 0, which a page must never print as a
   * count to reach.
   */
  off: boolean;
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
 * vouch would leave a stuck village exactly as stuck. It is also sufficient
 * when vouching is off, where nothing else is.
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
  const bar = vouchBar(needed);
  const off = bar === 0;
  return {
    count: vouchers.length,
    needed: bar,
    met: bySuper || (!off && vouchers.length >= bar),
    bySuper,
    off,
    vouchers,
  };
}

/** Why a vouch is refused, in the words the person pressing the button reads. */
export type VouchRefusal = { error: string } | null;

/**
 * What a village with vouching off says, both to a member about their own
 * standing and to anybody who tries to vouch there. One sentence, so the two
 * cannot drift apart.
 */
const VOUCHING_OFF = "This village has turned vouching off. Its stewards admit new members.";

/**
 * The refusal an ordinary vouch meets in a village that has turned vouching off.
 *
 * Only `member` is refused. A super vouch is the door off leaves open, and a
 * kind added later is not refused here by default, because refusing a kind is
 * a decision that should be made on purpose.
 *
 * Its own function because the route asks it BEFORE the capability gate: in a
 * village with vouching off, the gate's "this opens at Contributor" would send
 * somebody up the ladder toward a door that stays shut.
 */
export function vouchingOffRefusal(kind: string, needed: number): VouchRefusal {
  if (kind !== "member") return null;
  return vouchBar(needed) === 0 ? { error: VOUCHING_OFF } : null;
}

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
  /** 'member' when absent. A super vouch passes a village with vouching off. */
  kind?: string;
  /** The village's bar. Absent reads as the launch bar, which is on. */
  needed?: number;
}): VouchRefusal {
  if (!input.voucherUserId || !input.vouchedUserId) {
    return { error: "A vouch needs somebody giving it and somebody receiving it." };
  }
  const closed = vouchingOffRefusal(input.kind ?? "member", input.needed ?? DEFAULT_VOUCHES_FOR_MEMBERSHIP);
  if (closed) return closed;
  if (input.voucherUserId === input.vouchedUserId) {
    // The whole mechanism is other people saying they know you.
    return { error: "You cannot vouch for yourself." };
  }
  if (input.vouchedIsMember) {
    return { error: "They are already a member of this village." };
  }
  const mine = input.existing.find((v) => String(v.voucherUserId) === input.voucherUserId);
  if (mine) {
    /*
     * A SUPER VOUCH MAY RAISE THE SAME PERSON'S ORDINARY ONE. The stuck village
     * the override exists for is exactly the one where the steward was among
     * those who had already vouched, and "already vouched" would leave it stuck
     * by that earlier vouch. Raising is the only change a vouch can undergo: it
     * never falls back to ordinary and it is never removed.
     */
    const raising = (input.kind ?? "member") === "super" && String(mine.kind) !== "super";
    // Three vouches has to mean three people, so the second press says so
    // rather than quietly doing nothing.
    if (!raising) return { error: "You have already vouched for them. A vouch is given once." };
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
  if (state.off) return VOUCHING_OFF;
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
