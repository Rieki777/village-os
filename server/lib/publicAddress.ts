/**
 * ONE ADDRESS, FROM A STRANGER.
 *
 * A public form that emails the person who filled it in must email exactly one
 * person. `sendResendEmail` splits every entry it is handed on commas, because
 * a village's own inbox settings are allowed to hold a list, and it sends one
 * essential email per address. So a typed `email` of
 * `a@x.example,b@y.example,...` used to be a single request that made the
 * village send its investor packet, or its proposal acknowledgement, to as
 * many strangers as fit in the request body, from the village's own sending
 * domain, and file every one of them in its address book. A per-IP limit
 * counts requests, and this was one request.
 *
 * The rule here is the address book's own (`addressProblem`, one `@`, a dot
 * after it, no spaces, a key the index can hold), plus two things a list
 * needs and a single address never has: a comma or a semicolon. Only a string
 * counts, because an array becomes a comma-joined list on its way through
 * `String()`.
 */
import { addressProblem } from "../../shared/comms/address";

/** The one address a public form may write to, trimmed, or null when it names none or several. */
export function singlePublicAddress(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (/[,;]/.test(trimmed)) return null;
  return addressProblem(trimmed) === null ? trimmed : null;
}
