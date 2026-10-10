/**
 * THE SETTINGS DRAWER ON A LIVE SEAT CARD, for a reader allowed to read terms.
 *
 * Every host of the live card (/roles, /circles, the map) reads its seat from
 * a payload the server tiered: `termsOffer` is ON the seat only for a reader
 * holding `terms.read`, and ABSENT for everyone else (server/lib/seatProjection.ts).
 * So the presence of the key is the whole decision, made by the server's one
 * gate and never re-asked here. A host calls `termsSlotFor(seat)`:
 *
 *   key absent         undefined, so the card draws no tray at all
 *   offer present      the drawer, shut, with the village's preset names
 *   offer null         the empty state, "No terms on offer yet." and a way to
 *                      propose some, except on a standing example
 *   offer unreadable   the drawer saying so, never half the terms
 *
 * The client parses again with the one parser, so a payload from an older
 * server reads the same way it would have been served.
 */
import type { ReactNode } from "react";
import { parseSeatSettings } from "@shared/seatSettings";
import { proposeTermsHref } from "@shared/seatTermsOffer";
import { useVillagePresets } from "@/lib/seatPresetsRead";
import SeatTermsDrawer from "./SeatTermsDrawer";

function SeatTermsSlot({ seat }: { seat: Record<string, any> }) {
  const presets = useVillagePresets();
  const raw = seat.termsOffer;
  if (raw === null || raw === undefined) {
    if (seat.termsOfferUnreadable) return <SeatTermsDrawer unreadable />;
    return <SeatTermsDrawer empty={{ href: seat.isExample ? null : proposeTermsHref(String(seat.id)) }} />;
  }
  const parsed = parseSeatSettings(raw);
  return (
    <SeatTermsDrawer
      settings={parsed.ok ? parsed.settings : null}
      unreadable={!parsed.ok}
      villagePresets={presets}
    />
  );
}

/** The `settings` slot for a live seat card, or undefined when this reader may not read terms. */
export function termsSlotFor(seat: Record<string, any> | null | undefined): ReactNode | undefined {
  if (!seat || typeof seat !== "object" || !("termsOffer" in seat)) return undefined;
  return <SeatTermsSlot seat={seat} />;
}
