/**
 * WHAT A SEAT CARD HANDS THE ACTION IN ITS SLOT.
 *
 * The card core (`SeatTradingCard`) imports nothing from `@/lib/gameApi`, so
 * the part that posts a raised hand or a message (`SeatAction`) is passed in
 * by the host as a slot. The card still owns three things that part needs,
 * and this context is how they reach it without the host wiring each one:
 *
 *   action      the view model's one action for this seat (`seatSheet()`), so
 *               the rule for which door a seat opens is computed once, in
 *               `shared/roleSheet.ts`, and never again in a component;
 *   openSignal  a counter the back face's shortcut bumps after turning the
 *               card over, so ONE action instance holds the half-written note
 *               whichever face asked for it;
 *   announce    the card's single polite live region. A status written there
 *               is heard once, beside the visible line.
 *
 * Its own file so the action can import it without importing the card.
 */
import { createContext, useContext } from "react";
import type { SeatActionView } from "@shared/roleSheet";

export interface SeatCardSlot {
  seatId: string;
  action: SeatActionView;
  openSignal: number;
  announce: (message: string) => void;
}

export const SeatCardSlotContext = createContext<SeatCardSlot | null>(null);

/** The card's slot, or null outside a card (the action then renders nothing). */
export function useSeatCardSlot(): SeatCardSlot | null {
  return useContext(SeatCardSlotContext);
}
