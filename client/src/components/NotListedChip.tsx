/**
 * The "Not listed" chip: shown on a role that is off every discovery surface,
 * to the readers the server still sends it to (admins, stewards, holders).
 * The server sends `listed: false` only on such a role, so the chip needs no
 * check of who is looking (shared/roleListing.ts).
 */
import { LISTING_WORDS } from "@shared/roleListing";

export default function NotListedChip({ role }: { role: { listed?: boolean | null } | null | undefined }) {
  if (!role || role.listed !== false) return null;
  return (
    <span
      className="text-xs px-2 py-0.5 rounded-full font-medium bg-muted text-muted-foreground border border-border"
      title={LISTING_WORDS.chipHint}
      data-testid="not-listed-chip"
    >
      {LISTING_WORDS.chip}
    </span>
  );
}
