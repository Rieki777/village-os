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
 * `unlimited` puts no ceiling on the grant, and a badge lift there still stops at
 * the top the quest advertises (the economics lane's reading of ruling 8,
 * 2026-09-14). Quest recognition posts from a faucet the issuance cap does not
 * count, and recognition is the default voting-weight token, so a lift bounded
 * only by the 3x clamp could triple the voting weight a steward granted. A grant
 * already at or above the advertised top gets no lift, and a quest naming no
 * readable top gets none.
 */
import type { ConsentBounds, ConsentCapMode } from "../../shared/questConsentBounds";
import { describeRange, type RewardRange } from "../../shared/questRewards";

// The bounds shape and the mode union live in shared/, so a steward's screen and
// this module read one definition.
export type { ConsentBounds, ConsentCapMode };

/**
 * Read a stored cap mode. Anything unrecognised is `posted`.
 *
 * Caps fail closed in this platform. The route used to compare the raw string,
 * so a value that was neither `posted` nor `capped` applied no cap at all.
 */
export function consentCapMode(raw: unknown): ConsentCapMode {
  return raw === "capped" || raw === "unlimited" ? raw : "posted";
}

/**
 * The most a consent may grant on a quest. Null under `unlimited`, which bounds
 * no grant. A ceiling multiplier that is not a number, or is below 1, reads as
 * 1, so the bonus ceiling fails closed to the top of the advertised range.
 */
function capFor(mode: ConsentCapMode, range: RewardRange, capMultiplier: number): number | null {
  if (mode === "unlimited") return null;
  if (mode === "posted") return range.max;
  const multiplier = Number.isFinite(capMultiplier) && capMultiplier >= 1 ? capMultiplier : 1;
  return Math.round(range.max * multiplier);
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
      /**
       * The most a badge may lift this consent to: the ceiling under `posted` and
       * `capped`, the advertised top under `unlimited`. Null means no lift at all,
       * which is `unlimited` on a quest naming no readable top.
       */
      liftTop: number | null;
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

  const ceiling = capFor(mode, range, input.capMultiplier);
  // Where a badge lift stops. Under a cap it is the ceiling; under `unlimited`
  // it is the advertised top, and a quest naming no readable top gets no lift.
  const liftTop = ceiling !== null ? ceiling : range.valid ? range.max : null;

  // A zero that got this far was allowed on purpose: it moves no recognition,
  // so it cannot break a ceiling, and the village or the quest chose it.
  if (requested <= 0) return { ok: true, granted: 0, liftTop };

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
  if (mode === "capped" && ceiling !== null) {
    if (requested > ceiling) {
      return {
        ok: false,
        status: 409,
        body: {
          error: `${requested} is above the ceiling for this quest. It advertises ${describeRange(range)} and the bonus ceiling is ${ceiling}.`,
          max: range.max,
          ceiling,
        },
      };
    }
    if (requested < range.min) {
      return {
        ok: false,
        status: 409,
        body: {
          error: `${requested} is below what this quest advertises (${describeRange(range)}). A bonus can reach ${ceiling}, and the floor still holds.`,
          min: range.min,
          ceiling,
        },
      };
    }
  }
  return { ok: true, granted: requested, liftTop };
}

/**
 * What the ledger moves for a grant: the grant lifted by a standing badge, and
 * never past `liftTop` (see `ConsentAmountVerdict`).
 *
 * A badge at or above the top therefore adds nothing, and a null top means no
 * lift at all. A multiplier below 1 never cuts the grant: badge validation
 * refuses one, and this holds the line for a row that predates that validation.
 */
export function payoutFor(input: { granted: number; multiplier: number; liftTop: number | null }): number {
  const { granted, liftTop } = input;
  if (!(granted > 0)) return 0;
  if (liftTop === null) return granted;
  const multiplier = Number.isFinite(input.multiplier) && input.multiplier > 1 ? input.multiplier : 1;
  const lifted = multiplier === 1 ? granted : Math.floor(granted * multiplier);
  return Math.max(granted, Math.min(lifted, liftTop));
}

/**
 * The bounds `checkConsentAmount` enforces, stated ahead of time.
 *
 * The consent queue's amount box opened at a hardcoded 50 and showed nothing
 * from the quest, so under `posted` the first press on any quest whose range
 * left out 50 was a guaranteed refusal. A surface that shows these bounds and
 * the route that enforces them read one definition, and a test holds the two to
 * the same answer for every combination, so what the screen promises and what
 * consent refuses cannot drift apart.
 */
export function consentBounds(input: Omit<ConsentAmountInput, "requested">): ConsentBounds {
  const mode = consentCapMode(input.capMode);
  const { range } = input;
  const capped = mode !== "unlimited";
  const unreadableUnderCap = capped && !range.valid;
  return {
    label: range.label,
    readable: range.valid,
    floor: !capped || unreadableUnderCap ? null : range.min,
    ceiling: unreadableUnderCap ? null : capFor(mode, range, input.capMultiplier),
    zeroAllowed: !unreadableUnderCap && (input.allowZero || (range.valid && range.min === 0)),
    mode,
  };
}
