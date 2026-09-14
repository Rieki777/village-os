/**
 * What a quest consent may grant, and what it pays.
 *
 * PURE ON PURPOSE. Three dials meet here (`quest.consent_cap_mode`,
 * `quest.consent_cap_multiplier`, `quest.allow_zero_consent`) plus a standing
 * badge's multiplier, and the defect class this module exists to close is a
 * dial whose number and behaviour are different quantities. So a combination of
 * dials is a row in `server/lib/questConsent.test.ts`, never a village somebody
 * has to set up, and the route in `server/routes/questClaims.ts` only reads the
 * dials and passes them in.
 *
 * THREE RULINGS LIVE HERE (Rye, 2026-09-14):
 *
 *  - THE FLOOR HOLDS IN BOTH CAPPING MODES. `capped` used to test only its
 *    ceiling, so a village raising the ceiling to allow a bonus also, in the
 *    same edit, allowed a consent of 1 on a quest advertising 200. It now
 *    refuses below the advertised floor exactly as `posted` does.
 *
 *  - A BADGE LIFTS A CONSENT TOWARD THE CAP AND NEVER PAST IT. In the founder's
 *    words: "Badges are what help get to the upper range/ all the way to a cap -
 *    Never past the cap." The multiplier used to be applied after the cap and
 *    bounded only by MAX_REWARD_MULTIPLIER, so a quest advertising 100 could post
 *    300 under the very mode whose hint says the board is the contract.
 *
 *  - ZERO IS AN ACKNOWLEDGEMENT, AND IT HAS TWO DOORS. A village that turns
 *    `quest.allow_zero_consent` on may consent any claim at 0, in any mode; the
 *    dial used to be inert under the shipped `posted` mode, because 0 then
 *    failed the floor. And a quest that itself advertises 0, such as one that
 *    pays in stay credits alone, can always be consented at 0: under the default
 *    dials it could not be consented at any amount, since 0 was refused as "at
 *    least 1" and 1 as outside 0 to 0.
 *
 * `unlimited` has no cap, so there the multiplier keeps only the clamp inside
 * `rewardMultiplierFor` (server/lib/seasonPatterns.ts).
 */
import { describeRange, type RewardRange } from "../../shared/questRewards";

/** The cap modes this module knows. */
export type ConsentCapMode = "posted" | "capped" | "unlimited";

/**
 * Read a stored cap mode. Anything unrecognised is `posted`.
 *
 * Caps fail closed in this platform. The route used to compare the raw string,
 * so a value that was neither `posted` nor `capped` applied no cap at all.
 */
export function consentCapMode(raw: unknown): ConsentCapMode {
  return raw === "capped" || raw === "unlimited" ? raw : "posted";
}

export interface ConsentAmountInput {
  /** The amount in the request body, already clamped at zero. Whole tokens. */
  requested: number;
  /** `parseRewardRange` of the quest's label, read fresh at consent. */
  range: RewardRange;
  /** `quest.consent_cap_mode` as stored. See `consentCapMode`. */
  capMode: unknown;
  /** `quest.consent_cap_multiplier`. Read only under `capped`. */
  capMultiplier: number;
  /** `quest.allow_zero_consent`. */
  allowZero: boolean;
}

/** A refusal carries the status and the body the route sends, word for word. */
export type ConsentAmountVerdict =
  | {
      ok: true;
      /** What the witness decided, in whole tokens. The claim stores this as `amount`. */
      granted: number;
      /** The most this consent may pay after a badge lift. Null under `unlimited`. */
      cap: number | null;
    }
  | { ok: false; status: 400 | 409; body: { error: string } & Record<string, unknown> };

/**
 * May a steward grant `requested` on this quest, under these dials?
 *
 * The order is load-bearing and matches the route's documented order of checks:
 * the zero rule, then the readable-label rule, then the range.
 */
export function checkConsentAmount(input: ConsentAmountInput): ConsentAmountVerdict {
  const mode = consentCapMode(input.capMode);
  const { requested, range } = input;
  const advertisesZero = range.valid && range.min === 0;

  // Consent at 0 once "succeeded" while the failed ledger post zeroed the
  // member's cached balance. Zero is therefore refused unless the village opted
  // into acknowledging without recognition, or the quest itself advertises 0.
  if (requested <= 0 && !input.allowZero && !advertisesZero) {
    return {
      ok: false,
      status: 400,
      body: {
        error:
          "Consent releases value: the amount must be at least 1. To allow consenting at zero (acknowledged, no recognition), enable 'Allow consenting at zero' in Admin → Variables → Quests.",
      },
    };
  }

  // A cap needs a number to cap, so both capping modes refuse a label naming
  // none. Only `unlimited` is exempt, because that village asked for no ceiling.
  if (mode !== "unlimited" && !range.valid) {
    return {
      ok: false,
      status: 409,
      body: {
        error:
          "This quest does not advertise a readable amount, so it cannot be consented while a cap is set. Give the quest a number on the board first.",
      },
    };
  }

  // A ceiling multiplier that is not a number, or below 1, is read as 1: the
  // bonus ceiling fails closed to the top of the advertised range.
  const ceilingMultiplier =
    Number.isFinite(input.capMultiplier) && input.capMultiplier >= 1 ? input.capMultiplier : 1;
  const cap =
    mode === "posted" ? range.max : mode === "capped" ? Math.round(range.max * ceilingMultiplier) : null;

  // A zero that got this far was allowed on purpose: it moves no recognition,
  // so it cannot break a ceiling, and the village or the quest chose it.
  if (requested <= 0) return { ok: true, granted: 0, cap };

  if (mode === "posted" && (requested < range.min || requested > range.max)) {
    return {
      ok: false,
      status: 409,
      body: {
        error: `${requested} is outside what this quest advertises (${describeRange(range)}). The board is the contract.`,
        min: range.min,
        max: range.max,
      },
    };
  }
  if (mode === "capped" && cap !== null) {
    if (requested > cap) {
      return {
        ok: false,
        status: 409,
        body: {
          error: `${requested} is above the ceiling for this quest. It advertises ${describeRange(range)} and the bonus ceiling is ${cap}.`,
          max: range.max,
          ceiling: cap,
        },
      };
    }
    if (requested < range.min) {
      return {
        ok: false,
        status: 409,
        body: {
          error: `${requested} is below what this quest advertises (${describeRange(range)}). A bonus can reach ${cap}, and the floor still holds.`,
          min: range.min,
          ceiling: cap,
        },
      };
    }
  }
  return { ok: true, granted: requested, cap };
}

/**
 * What the ledger moves for a grant: the grant lifted by a standing badge, and
 * never past the cap.
 *
 * A badge at the top of the range therefore adds nothing. A multiplier below 1
 * never cuts the grant: badge validation refuses one, and this holds the line
 * for a row that predates that validation.
 */
export function payoutFor(input: { granted: number; multiplier: number; cap: number | null }): number {
  const { granted, cap } = input;
  if (!(granted > 0)) return 0;
  const multiplier = Number.isFinite(input.multiplier) && input.multiplier > 1 ? input.multiplier : 1;
  const lifted = multiplier === 1 ? granted : Math.floor(granted * multiplier);
  const bounded = cap === null ? lifted : Math.min(lifted, cap);
  return Math.max(granted, bounded);
}
