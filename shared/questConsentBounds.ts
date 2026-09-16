/**
 * What a consent may grant on one quest, as the consent queue states it, and the
 * one check a screen runs against it before anybody presses.
 *
 * SHARED ON PURPOSE. The server computes these bounds from the consent dials
 * (`consentBounds` in server/lib/questConsent.ts) and enforces the same rule in
 * `checkConsentAmount`. A steward's screen reads the bounds and asks `canGrant`
 * before it lets them press. `server/lib/questConsent.test.ts` holds `canGrant`
 * to exactly what the route enforces, for every whole-token amount across every
 * mode, label shape and zero dial, so the screen cannot offer an amount the
 * route refuses or hold back one it accepts.
 */

/** The cap modes a village can run. */
export type ConsentCapMode = "posted" | "capped" | "unlimited";

export interface ConsentBounds {
  /** The quest's advertised label, verbatim. */
  label: string;
  /** Whether the label names a number. Under a cap, a quest naming none refuses every consent. */
  readable: boolean;
  /** The lowest grant above zero. Null when nothing bounds it: `unlimited`, or an unreadable label. */
  floor: number | null;
  /** The highest grant. Null under the same conditions, since `unlimited` bounds no grant. */
  ceiling: number | null;
  /** Whether a consent of exactly 0 passes. */
  zeroAllowed: boolean;
  mode: ConsentCapMode;
}

/**
 * Would the consent route accept this amount, given these bounds?
 *
 * Whole tokens only. The ledger posts integers, so a fraction or a negative is
 * never offered, and nothing here rounds one into range.
 */
export function canGrant(amount: number, bounds: ConsentBounds): boolean {
  if (!Number.isInteger(amount) || amount < 0) return false;
  if (amount === 0) return bounds.zeroAllowed;
  if (bounds.mode !== "unlimited" && !bounds.readable) return false;
  if (bounds.floor !== null && amount < bounds.floor) return false;
  if (bounds.ceiling !== null && amount > bounds.ceiling) return false;
  return true;
}
