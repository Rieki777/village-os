/**
 * THE FULL CARD'S PARAMETERS, as one `card` object on the seat (role journey
 * PR-C). One new key on the projection keeps every other key where it was.
 *
 *   Everyone     track, village goals, selection criteria, the ordered
 *                interviews, where, languages, the review length, the
 *                completeness gate, and, for a LISTED OPEN role, the pay
 *                group's kind, range, currency, period and note (`publicPay`).
 *   terms.read   the budget line and the funding start.
 *   Editing      the access bundle and the booking link.
 *
 * Nothing else from the terms on offer leaves through here
 * (shared/rolePublicPay.ts copies five named keys). The gate is computed from
 * the same offer, so a visitor learns which parts are unwritten and nothing
 * about their content.
 */
import { PAID_TRACKS, readTrack, trackOf } from "../../shared/roleTracks";
import { invitesApplications, isListed } from "../../shared/roleListing";
import { conversationModeOf } from "../../shared/interviewerRoles";
import { roleCardGate } from "../../shared/roleParams";
import { payStatesRange, publicPayOf } from "../../shared/rolePublicPay";
import { publicTermsOf, readTermsOffer } from "../../shared/seatTermsOffer";
import type { OrgRole } from "./orgChart";
import { mayHold, readHeldBy } from "../../shared/agentHolders";
import { boolVar } from "./variables";

export interface RoleCardTier {
  terms: boolean;
  editing: boolean;
}

function isPaid(role: OrgRole, payKind: string | undefined, defaultTrack?: string | null): boolean {
  const track = trackOf(role.track, defaultTrack);
  return (!!track && PAID_TRACKS.includes(track)) || payKind === "fixed" || payKind === "range";
}

/** The completeness gate for one role, read from the same offer the card shows. */
/** `defaultTrack`: the village's track for a role with none (`org.default_track`, guide v2). */
export function gateOf(role: OrgRole, defaultTrack?: string | null) {
  const offer = readTermsOffer(role.termsOffer);
  const settings = offer.ok ? offer.settings : null;
  const pay = publicPayOf(settings);
  const termGroup = settings?.term;
  const hasTerm =
    role.reviewAfterDays != null || (!!termGroup && (termGroup.endsOn !== undefined || termGroup.lengthMoons !== undefined));
  return {
    pay,
    gate: roleCardGate({
      aim: role.aim,
      domain: role.domain,
      accountabilities: role.accountabilities,
      timeCommitment: role.timeCommitment,
      commitmentPct: settings?.clocks?.commitmentPct ?? null,
      track: trackOf(role.track, defaultTrack),
      payKind: pay?.kind ?? null,
      hasRange: payStatesRange(pay),
      hasTerm,
      villageGoals: role.villageGoals,
      selectionCriteria: role.selectionCriteria,
      conversations: role.conversations,
    }),
  };
}

/**
 * What the village says about how a role is filled: the role that holds first conversations
 * and the circle that consents paid roles (village settings, role journey v3). Both are
 * names already resolved by the route, so the card carries words and no ids.
 */
export interface CardVillageWords {
  firstConversationRole?: string | null;
  paidConsentCircle?: string | null;
  /** The track a role without one reads as (`org.default_track`, guide v2), or null for none. */
  defaultTrack?: string | null;
  /**
   * Whether a card shows its pay range to everyone (`org.show_pay_ranges`, phase A). Absent reads
   * the village's setting, so every host that builds a card (the org, the map, a circle's card)
   * hides the range the moment the village turns it off.
   */
  showPayRanges?: boolean;
}

export function roleCard(
  role: OrgRole,
  held: number,
  state: string,
  tier: RoleCardTier,
  opts: { roleNames?: ReadonlyMap<string, string>; gated?: boolean; words?: CardVillageWords },
): Record<string, unknown> {
  const { pay, gate } = gateOf(role, opts.words?.defaultTrack);
  const open = invitesApplications({ seats: role.seats, held, state, recruiting: role.recruiting });
  return {
    complete: gate.complete,
    missing: gate.missing,
    written: gate.written,
    of: gate.of,
    gated: opts.gated === true,
    track: trackOf(role.track, opts.words?.defaultTrack),
    villageGoals: role.villageGoals ?? null,
    selectionCriteria: role.selectionCriteria ?? null,
    conversations: (role.conversations ?? []).map((s) => ({ ...s, roleName: opts.roleNames?.get(s.roleId) ?? null })),
    conversationMode: conversationModeOf(role.conversationMode),
    whereWorked: role.whereWorked ?? null,
    languages: role.languages ?? null,
    reviewAfterDays: role.reviewAfterDays ?? null,
    // The commitment the role asks (joining lane PR 3): energy and attention, never hours. A planning signal read by no pay code.
    commitmentPct: publicTermsOf(role.termsOffer).commitmentPct,
    // Joining lane PR 2 (0370): a check happens for this role whatever the references say; the forms tell the applicant.
    alwaysChecked: role.alwaysChecked === true,
    // 0374: who the card says may hold it (null: not said), and whether an agent may, the unsaid read as either.
    heldBy: readHeldBy(role.heldBy),
    agentMayHold: mayHold(role.heldBy, "agent"),
    firstConversation: opts.words?.firstConversationRole ?? null,
    ...(isPaid(role, pay?.kind, opts.words?.defaultTrack) && opts.words?.paidConsentCircle ? { consentCircle: opts.words.paidConsentCircle } : {}),
    ...(pay && open && isListed(role) && (opts.words?.showPayRanges ?? boolVar("org.show_pay_ranges")) ? { publicPay: pay } : {}),
    ...(tier.terms ? { budgetLine: role.budgetLine ?? null, fundedFrom: role.fundedFrom ?? null } : {}),
    ...(tier.editing ? { accessBundle: role.accessBundle ?? null, bookingUrl: role.bookingUrl ?? null } : {}),
  };
}

/** The village's two card settings as names: the role that holds first conversations, the circle that consents paid roles. */
export function cardWordsFrom(
  roles: ReadonlyArray<{ id: string; name: string }>,
  circles: ReadonlyArray<{ id: string; name: string }>,
  settings: { firstConversationRole: string; paidConsentCircle: string; defaultTrack?: string },
): CardVillageWords {
  const roleId = settings.firstConversationRole.trim();
  const circleId = settings.paidConsentCircle.trim();
  return {
    firstConversationRole: roleId ? (roles.find((r) => r.id === roleId)?.name ?? null) : null,
    paidConsentCircle: circleId ? (circles.find((c) => c.id === circleId)?.name ?? null) : null,
    defaultTrack: readTrack(settings.defaultTrack ?? ""),
  };
}
