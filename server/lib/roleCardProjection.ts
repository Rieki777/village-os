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
import { invitesApplications, isListed } from "../../shared/roleListing";
import { roleCardGate } from "../../shared/roleParams";
import { payStatesRange, publicPayOf } from "../../shared/rolePublicPay";
import { readTermsOffer } from "../../shared/seatTermsOffer";
import type { OrgRole } from "./orgChart";

export interface RoleCardTier {
  terms: boolean;
  editing: boolean;
}

/** The completeness gate for one role, read from the same offer the card shows. */
export function gateOf(role: OrgRole) {
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
      track: role.track ?? null,
      payKind: pay?.kind ?? null,
      hasRange: payStatesRange(pay),
      hasTerm,
      villageGoals: role.villageGoals,
      selectionCriteria: role.selectionCriteria,
      interviewerRoles: role.interviewerRoles,
    }),
  };
}

export function roleCard(
  role: OrgRole,
  held: number,
  state: string,
  tier: RoleCardTier,
  opts: { roleNames?: ReadonlyMap<string, string>; gated?: boolean },
): Record<string, unknown> {
  const { pay, gate } = gateOf(role);
  const open = invitesApplications({ seats: role.seats, held, state, recruiting: role.recruiting });
  return {
    complete: gate.complete,
    missing: gate.missing,
    written: gate.written,
    of: gate.of,
    gated: opts.gated === true,
    track: role.track ?? null,
    villageGoals: role.villageGoals ?? null,
    selectionCriteria: role.selectionCriteria ?? null,
    interviews: (role.interviewerRoles ?? []).map((s) => ({ ...s, roleName: opts.roleNames?.get(s.roleId) ?? null })),
    whereWorked: role.whereWorked ?? null,
    languages: role.languages ?? null,
    reviewAfterDays: role.reviewAfterDays ?? null,
    ...(pay && open && isListed(role) ? { publicPay: pay } : {}),
    ...(tier.terms ? { budgetLine: role.budgetLine ?? null, fundedFrom: role.fundedFrom ?? null } : {}),
    ...(tier.editing ? { accessBundle: role.accessBundle ?? null, bookingUrl: role.bookingUrl ?? null } : {}),
  };
}
