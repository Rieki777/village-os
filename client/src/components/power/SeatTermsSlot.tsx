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
  /*
   * THE TERMS THE SEAT IS HELD ON come first (red team U2): a member seated on
   * adopted terms shows those terms, the adoption and where the parties stand,
   * never "No terms on offer yet". One drawer per holder on terms.
   */
  const held: any[] = Array.isArray(seat.heldTerms) ? seat.heldTerms : [];
  if (held.length > 0) {
    return (
      <div className="space-y-2">
        {held.map((h) => {
          const parsed = parseSeatSettings(h.settings);
          return (
            <div key={String(h.applicationId)}>
              {held.length > 1 && h.holderName && <p className="text-xs font-semibold text-muted-foreground">{String(h.holderName)}</p>}
              <SeatTermsDrawer
                settings={parsed.ok ? parsed.settings : null}
                unreadable={!parsed.ok}
                villagePresets={presets}
                adopted={h.decidedOn ? { how: h.adoptedVia === "holder" ? "holder" : "vote", on: String(h.decidedOn), href: h.href ?? null } : null}
                alignment={h.alignment ?? null}
              />
            </div>
          );
        })}
      </div>
    );
  }
  const raw = seat.termsOffer;
  if (raw === null || raw === undefined) {
    if (seat.termsOfferUnreadable) return <SeatTermsDrawer unreadable />;
    // Proposing terms is an application to hold the seat, so it is offered only on a seat nobody holds:
    // changing a held seat's terms comes later, with the seat-proposal kind (red team U4).
    const held = Number(seat.holderCount ?? 0) > 0;
    return <SeatTermsDrawer empty={{ href: seat.isExample || held ? null : proposeTermsHref(String(seat.id)), heldLine: held }} />;
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

/**
 * Where a raised hand on this seat goes for a reader who reads terms: the
 * "Apply for a seat" wizard with this seat picked (seat settings PR4). Null for
 * everyone else, who keep the inbox hand, and on a standing example, which
 * nobody holds. The same presence test as the drawer, so the two never disagree.
 */
export function applyHrefFor(seat: Record<string, any> | null | undefined): string | null {
  if (!seat || typeof seat !== "object" || !("termsOffer" in seat) || seat.isExample) return null;
  // A full seat has no place to apply for (red team U4).
  if (seat.state === "filled") return null;
  const id = String(seat.id ?? "").trim();
  return id ? proposeTermsHref(id) : null;
}

/** The `settings` slot for a live seat card, or undefined when this reader may not read terms. */
export function termsSlotFor(seat: Record<string, any> | null | undefined): ReactNode | undefined {
  if (!seat || typeof seat !== "object" || !("termsOffer" in seat)) return undefined;
  return <SeatTermsSlot seat={seat} />;
}
