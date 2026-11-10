/**
 * Where a person is to be booked (role journey L6): the role's https link, or
 * the plain "We'll write to you to find a time". One component for the first
 * conversation, each interview and the access session. Booking happens outside
 * the platform in v1, so the link opens in a new tab.
 */
import { bookingOffer } from "@shared/roleBooking";

export default function BookingOffer({ bookingUrl, what }: { bookingUrl: unknown; what?: string }) {
  const offer = bookingOffer(bookingUrl, what);
  if (offer.kind === "write") return <p data-testid="booking-write">{offer.text}</p>;
  return (
    <p>
      <a data-testid="booking-link" href={offer.url} target="_blank" rel="noopener noreferrer" className="underline">{offer.label}</a>
    </p>
  );
}
