/**
 * THE ROLES BAND: your roles, the player card, My moon and the season plan,
 * across the profile (the Roles tab on a phone).
 *
 * ON A PHONE, MY MOON SITS ABOVE THE PLAYER CARD (batch 157, C2 Q1). The moon
 * is the thing a member acts on this week, and the card is the long read under
 * it. The document keeps the desktop order, the way every other section on the
 * sheet does (ProfileTabs.tsx), and only the phone draws the card and the
 * season plan after the moon: both take `max-sm:order-1`, so the roles line and
 * My moon (order 0) come first. A desktop reader sees nothing move.
 *
 * `empty:hidden` keeps a slot that draws nothing (a card with no role yet, My
 * moon with the module off) from leaving a gap in the column.
 */
import type { ReactNode } from "react";

/** The phone-only class that draws a slot after My moon. */
export const AFTER_MOON_ON_PHONE = "max-sm:order-1";

export interface RolesBandProps {
  id?: string;
  className?: string;
  roles: ReactNode;
  card: ReactNode;
  moon: ReactNode;
  /** The season plan, or nothing while the first days hold it back. */
  season?: ReactNode;
}

export default function RolesBand({ id, className = "", roles, card, moon, season }: RolesBandProps) {
  return (
    <div id={id} className={`flex flex-col gap-6 ${className}`}>
      <div data-roles-slot="roles" className="flex flex-col gap-6 empty:hidden">
        {roles}
      </div>
      <div data-roles-slot="card" className={`flex flex-col gap-6 empty:hidden ${AFTER_MOON_ON_PHONE}`}>
        {card}
      </div>
      <div data-roles-slot="moon" className="flex flex-col gap-6 empty:hidden">
        {moon}
      </div>
      {season ? (
        <div data-roles-slot="season" className={`flex flex-col gap-6 ${AFTER_MOON_ON_PHONE}`}>
          {season}
        </div>
      ) : null}
    </div>
  );
}
