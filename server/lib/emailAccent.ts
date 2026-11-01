/**
 * THE ONE COLOUR AN EMAIL OUTSIDE COMMS WEARS.
 *
 * The comms emails take the village's whole look from its brand seed
 * (shared/comms/letterHtml.ts). The older frames (notices, digests, form
 * receipts, housing, the session task emails) are hand-written HTML, and every
 * one of them typed one village's teal, #2D5A5A, into its header band, its
 * buttons and its links, so every village emailed its people in somebody
 * else's colour (audit, 2026-10-22).
 *
 * They now wear the village's brand colour, derived exactly as the site's
 * `--tone-brand` (`brandColour` in server/lib/themeCss.ts, which also feeds the
 * install manifest), and the platform's neutral when the village has set no
 * seed. White text on it clears AA by the derivation. Anything that is not a
 * plain hex colour is refused here, because the value is written into a
 * style attribute.
 */

/** The platform's neutral: what a village with no brand seed shows, and the site's own default. */
export const NEUTRAL_ACCENT = "#404040";

/** A hex colour fit for an email's style attribute, or the neutral. */
export function emailAccent(colour: unknown): string {
  const s = String(colour ?? "").trim();
  return /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(s) ? s : NEUTRAL_ACCENT;
}
