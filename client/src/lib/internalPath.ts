/**
 * The one client rule for "is this a path inside this village", used wherever
 * a destination arrives from a URL (`?next=`) or from the app's own location
 * and is about to become a link, a router push or a page load.
 *
 * WHY THIS REPLACES THE INLINE CHECK. Five files carried
 * `startsWith("/") && !startsWith("//") && !startsWith("/\\")`, and it can be
 * walked straight past: the URL parser strips ASCII tab and newline before it
 * parses, so "/<tab>/evil.example" passes all three tests and resolves to
 * https://evil.example/. Measured with `new URL` on 2026-10-02, and CodeQL
 * alert #33 sits on the one copy that loads a page with it
 * (useGoogleSignInReturn.ts). The server's `normalizeNext`
 * (server/lib/oauthGoogle.ts) already refused tab and newline; the client
 * never did.
 *
 * WHAT IT ACCEPTS. A string that starts with exactly one "/", carries no
 * backslash and no control character, and still resolves to this site once a
 * real URL parser has read it. It returns the parsed path, search and hash, so
 * the value a caller navigates to is the value that was checked, never a
 * second reading of the raw text.
 *
 * A dot segment can turn "/./" into a path that begins "//", which is harmless
 * inside a full URL and protocol-relative the moment it is used on its own, so
 * a parsed path that begins "//" is refused too.
 */

/** C0 controls and DEL. Tab, CR and LF are the ones a URL parser silently drops. */
const CONTROL = /[\u0000-\u001F\u007F]/;

/** A fixed stand-in origin, so the answer never depends on where the page is served. */
const PROBE = "https://village.invalid";

/** The destination as a path inside this village, or null when it is not one. */
export function internalPath(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  if (!raw.startsWith("/") || raw.startsWith("//")) return null;
  if (raw.includes("\\") || CONTROL.test(raw)) return null;
  let parsed: URL;
  try {
    parsed = new URL(raw, PROBE);
  } catch {
    return null;
  }
  if (parsed.origin !== PROBE || parsed.pathname.startsWith("//")) return null;
  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}
