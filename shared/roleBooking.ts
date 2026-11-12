/**
 * Booking links for roles (role journey L6).
 *
 * Booking stays outside the platform in v1: a role's holder keeps a Google
 * appointment schedule and records its link on the role (`org_roles.booking_url`).
 * These pure helpers decide what is shown where a person is to be booked, so
 * the interview screens, the confirmation page and the access session all
 * read one rule.
 */

export const BOOKING_URL_MAX = 300;

/** Shown wherever a role has no usable link. */
export const NO_BOOKING_COPY = "We'll write to you with times";

/**
 * The link as stored, or null. Only https links with a host are accepted:
 * no http, javascript:, data:, mailto:, or credentials inside the address.
 */
export function parseBookingUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const text = raw.trim();
  if (!text || text.length > BOOKING_URL_MAX) return null;
  let url: URL;
  try { url = new URL(text); } catch { return null; }
  if (url.protocol !== "https:") return null;
  if (!url.hostname || url.username || url.password) return null;
  return url.toString();
}

/** What a booking spot shows: a link to follow, or the plain fallback. */
export type BookingOffer =
  | { kind: "link"; url: string; label: string }
  | { kind: "write"; text: string };

/** What to show to book `what` ("a time for your first conversation") with a role. */
export function bookingOffer(bookingUrl: unknown, what = "a time"): BookingOffer {
  const url = parseBookingUrl(bookingUrl);
  if (url) return { kind: "link", url, label: `Pick ${what}` };
  return { kind: "write", text: NO_BOOKING_COPY };
}

/** The steps of one journey, each with the role to be booked. */
export interface BookingStepInput {
  step: "first_conversation" | "interview" | "access_session";
  roleName: string;
  bookingUrl?: string | null;
}

export interface BookingStep extends BookingStepInput {
  /** 1-based place among the interviews, for step "interview" only. */
  order: number | null;
  offer: BookingOffer;
}

const STEP_WORDS: Record<BookingStepInput["step"], string> = {
  first_conversation: "a time for your first conversation",
  interview: "a time for this interview",
  access_session: "a time for your access session",
};

/**
 * Lay out the booking steps: the first conversation first, then each
 * interview in the order given, then the access session.
 */
export function bookingSteps(inputs: BookingStepInput[]): BookingStep[] {
  const rank = { first_conversation: 0, interview: 1, access_session: 2 } as const;
  const sorted = inputs.map((s, i) => ({ s, i })).sort((a, b) => rank[a.s.step] - rank[b.s.step] || a.i - b.i);
  let n = 0;
  return sorted.map(({ s }) => ({
    ...s,
    order: s.step === "interview" ? ++n : null,
    offer: bookingOffer(s.bookingUrl, STEP_WORDS[s.step]),
  }));
}
