/**
 * ONE RULE FOR WHAT AN ADDRESS IS, read by the post office, the address book
 * and any form that wants to say "that does not look right" before sending.
 *
 * Pure and isomorphic.
 */

/**
 * The key an address is filed under: trimmed and lowercased, and nothing else
 * folded (docs/comms/BUILD_SPEC.md 5.3). Dots and plus tags are left alone,
 * because a provider that treats them as meaningful is entitled to, and
 * merging two people into one row is worse than keeping one person twice.
 */
export function emailKeyOf(email: string): string {
  return String(email ?? "").trim().toLowerCase();
}

/** The widest address a column holds (`comms_messages.to_email`). */
export const MAX_ADDRESS_LENGTH = 320;

/** The widest key the unique indexes can hold. */
export const MAX_EMAIL_KEY_LENGTH = 191;

/**
 * Why an address cannot be written to, or null when it can.
 *
 * Deliberately permissive in shape, the same pattern the mailer has always
 * used (one `@`, a dot after it, no spaces), because the delivery attempt is
 * the real test and a strict pattern refuses real addresses for nothing. The
 * lengths are hard, because a key longer than the index cannot be stored.
 */
export function addressProblem(email: string): string | null {
  const trimmed = String(email ?? "").trim();
  if (!trimmed) return "There is no address.";
  if (trimmed.length > MAX_EMAIL_KEY_LENGTH) return "That address is too long to keep.";
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(trimmed)) return "That does not look like an email address.";
  return null;
}

/**
 * The bare address inside a From: line. `Name <addr@dom.tld>` and
 * `addr@dom.tld` both answer `addr@dom.tld`, and anything else answers the
 * empty string, so a header built from it is left out instead of malformed.
 */
export function addressOfSender(sender: string): string {
  const s = String(sender ?? "").trim();
  const angled = s.match(/<([^<>\s]+@[^<>\s]+)>\s*$/);
  if (angled) return angled[1];
  return /^[^@\s<>]+@[^@\s<>]+\.[^@\s<>]+$/.test(s) ? s : "";
}
