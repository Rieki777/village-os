/**
 * A PROPOSED SEAT, AS THE CARD IT WOULD BECOME: the /review preview.
 *
 * An outside service proposes a seat as JSON, and the steward edits that
 * JSON before accepting it: the textarea on /review is the redaction path,
 * and this reads it and changes nothing. It reads the text the way accepting
 * reads it, through `readProposedSeats` (shared/proposedSeats.ts), the
 * function the accept route runs on the same text, so a vendor's spellings
 * (`role_name`, `seat_count`, `why_it_matters`, `circle_id`) preview exactly
 * as they would publish, and a key nothing reads is named out loud.
 *
 * Each seat it finds is drawn as the role card in proposal mode with both
 * faces stacked, because a steward reading a draft wants all of it at once.
 * Nothing is seated and nothing is decided yet, so the card prints no holders,
 * no state, no clock and no door.
 *
 * TERMS ON OFFER (seat settings PR3). A draft a MEMBER wrote may carry the
 * terms a seat offers, and `terms` shows them in the Settings drawer, open,
 * with each group that differs from the offer standing today lit as changed.
 * The host passes it only to a reader holding `terms.read`. A vendor's
 * proposal never carries terms (they never cross the bridge, and the draft
 * path refuses them), so the review queue's own proposals pass nothing.
 *
 * It fetches nothing and imports nothing from `@/lib/gameApi`: the two /review
 * test files mock that module down to `authToken`, and this has to render
 * under them. Typing re-reads the text on a deferred value, so a long payload
 * never makes the textarea lag.
 */
import { useDeferredValue, useMemo } from "react";
import { SHEET_WORDS, notReadLine, type SheetContext } from "@shared/roleSheet";
import { fromProposedSeat } from "@shared/roleSheetInputs";
import { readProposedSeats, type NormalisedSeat } from "@shared/proposedSeats";
import { parseSeatSettings } from "@shared/seatSettings";
import { changedGroups } from "@shared/seatTermsOffer";
import SeatTermsDrawer from "./SeatTermsDrawer";
import SeatTradingCard from "./SeatTradingCard";

type Reading = { ok: false } | { ok: true; seats: NormalisedSeat[]; notRead: string | null };

/**
 * The text as accepting this one item reads it. Accepting a single proposal
 * takes the draft's title and rationale from it, so those two keys are read
 * and never reported.
 */
function readProposalText(text: string): Reading {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false };
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false };
  const read = readProposedSeats(raw as Record<string, unknown>, [], { readsTitle: true, readsRationale: true });
  return { ok: true, seats: read.seats, notRead: notReadLine(read.ignored) };
}

/** No clock and no class names: a proposal has neither a term nor a tag yet. */
const PROPOSAL_CTX: Omit<SheetContext, "now"> = { season: null, classNames: null };

/** The proposed offer in the drawer, changed rows lit against the offer standing now. */
function termsDrawer(terms: { offer: unknown; base?: unknown }) {
  const next = parseSeatSettings(terms.offer);
  const base = parseSeatSettings(terms.base);
  const settings = next.ok ? next.settings : null;
  return (
    <SeatTermsDrawer
      settings={settings}
      unreadable={!next.ok}
      changedGroups={settings && base.ok ? changedGroups(base.settings, settings) : []}
      defaultOpen
    />
  );
}

export default function ProposedSeatPreview({
  text,
  terms,
}: {
  text: string;
  /** A member-written offer for the seat, and the offer it would replace. */
  terms?: { offer: unknown; base?: unknown } | null;
}) {
  const deferred = useDeferredValue(text);
  const reading = useMemo(() => readProposalText(deferred), [deferred]);

  if (!reading.ok) {
    return <p className="mt-3 text-xs text-muted-foreground">{SHEET_WORDS.proposalInvalid}</p>;
  }
  return (
    <div className="mt-3 space-y-2">
      {reading.seats.length > 0 && <p className="text-xs text-muted-foreground">{SHEET_WORDS.proposalLead}</p>}
      {reading.seats.map((seat, i) => (
        <SeatTradingCard
          key={i}
          input={fromProposedSeat(seat)}
          ctx={{ ...PROPOSAL_CTX, now: new Date() }}
          faces="stacked"
          settings={terms && terms.offer !== undefined ? termsDrawer(terms) : undefined}
        />
      ))}
      {reading.notRead && <p className="text-xs text-muted-foreground">{reading.notRead}</p>}
    </div>
  );
}
