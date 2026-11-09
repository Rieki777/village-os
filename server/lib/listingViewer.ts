/**
 * WHO SEES UNLISTED ROLES (role journey PR-A).
 *
 * Admins and the holders of the power to decide the village's structure
 * (`org.decide`) or to fill its roles (`org.seat`) are the stewards of the
 * chart, so they see every role with a "Not listed" chip. A holder sees their
 * own roles. Everyone else reads listed roles only.
 */
import { hasCapability, type CapabilityCtx } from "../../shared/capabilities";
import { ownRoleIdsOf, type ListingViewer } from "../../shared/roleListing";
import type { OrgAssignment } from "./orgChart";

export function listingViewerFor(args: {
  admin: boolean;
  capCtx: CapabilityCtx | null;
  userId: string | null | undefined;
  assignments: readonly OrgAssignment[];
}): ListingViewer {
  const steward =
    args.admin ||
    (args.capCtx ? hasCapability("org.decide", args.capCtx) || hasCapability("org.seat", args.capCtx) : false);
  return { seesUnlisted: steward, ownRoleIds: ownRoleIdsOf(args.assignments, args.userId ?? null) };
}
