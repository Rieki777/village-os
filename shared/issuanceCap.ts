/**
 * THE VILLAGE-WIDE ISSUANCE CAP, AS A DECISION A FOUNDER MAKES AT LAUNCH.
 *
 * Rye: "the initial village wide issuance needs to be added to the flow
 * founders are going through, and they can opt to not set a cap at that
 * moment. So, It's critical this is added to the Journey to launch process."
 *
 * So the cap is not only a dial in an admin tab any more. It is a question the
 * launch journey PUTS, once, with a real second answer.
 *
 * ── DECLINING IS NOT A HOLE IN THE CAP, AND THIS IS THE LOAD BEARING PART ──
 *
 * Rye settled separately that the village-wide cap binds every door as it does
 * today and is not to be weakened. Those two rulings only fit together one
 * way: declining means the founder chose to name no number OF THEIR OWN, and
 * the platform default keeps binding every door underneath them. A decline
 * that switched the cap off would be an uncapped village created by pressing a
 * button labelled "not now", so it does not exist here and no state below can
 * express it.
 *
 * ── THREE ANSWERS, AND TWO OF THEM LOOK IDENTICAL IN THE DATABASE ──────────
 *
 * `server/lib/variables.ts` stores CHANGED values only, and it goes further
 * than that: `setVariable` DELETES the override row when the value written
 * equals the platform default. So the game_variables table cannot tell these
 * apart on its own:
 *
 *   a founder who read the default, agreed with it, and typed it back;
 *   a founder who never opened the page.
 *
 * Both leave no row. That is the exact conflation this codebase has paid for
 * repeatedly, and it is why the ANSWER is recorded in the launch-state
 * document and never inferred from the absence of a row. An override row is
 * corroboration; the decision is a decision, and it is written down.
 *
 * A founder who agrees with the platform default therefore DECLINES, and the
 * words on the surface say exactly that: naming no number of your own is a
 * decline, and it is a real answer with your name and the instant on it.
 *
 * ── NOTHING HERE READS A DATABASE ──────────────────────────────────────────
 *
 * This file is isomorphic, like every other `shared/` module. The two facts it
 * judges are read by server/lib/launch.ts and handed in.
 */

/**
 * The dial this decision is about.
 *
 * `server/lib/mintCap.ts` exports the same string as `MINT_CAP_KEY` and cannot
 * import it from here without a cycle: launch.ts would then reach mintCap.ts,
 * which reaches economy.ts, which reaches villageMoon.ts, which imports
 * launch.ts. Held to one value by `shared/issuanceCap.test.ts`, which asserts
 * the two constants are the same string and that the registry knows it, so the
 * duplication cannot drift in silence.
 */
export const ISSUANCE_CAP_KEY = "ledger.admin_mint_cycle_cap";

/** The launch requirement id, so the check and the door spell it once. */
export const ISSUANCE_CAP_REQUIREMENT = "issuance-cap";

export type IssuanceCapAnswer =
  /**
   * The founder named a number of their own. An override row stands.
   */
  | "set"
  /**
   * The founder was asked and chose to name no number of their own.
   *
   * A DECISION, with a person and an instant attached. The platform default
   * keeps binding every door, so this is a choice about who sets the number
   * and never a choice about whether one binds.
   */
  | "declined"
  /**
   * Nobody has answered. An OMISSION, and the only one of the three that is
   * an absence.
   */
  | "unset";

export interface IssuanceCapDecision {
  answer: IssuanceCapAnswer;
  /**
   * The number binding today, in whole tokens, from the override when there is
   * one and from the platform default otherwise. Never null: a cap always
   * binds, which is the point of the ruling this file serves.
   */
  capTokens: number;
  /** True when a village override row stands behind `capTokens`. */
  overridden: boolean;
  /** Who answered, for `set` and `declined`. Null when nobody has. */
  by: string | null;
  /** When they answered, ISO. Null when nobody has. */
  at: string | null;
}

/**
 * WHICH OF THE THREE, FROM THE TWO FACTS THAT DECIDE IT.
 *
 * The recorded answer wins wherever it exists, because it is the only one of
 * the two inputs that is a decision. The override row is read afterwards, and
 * only to promote an `unset` village that has a number anyway: a founder who
 * typed a cap into the admin tab before this question existed has plainly set
 * one, and asking them again would be the checklist failing to see work that
 * was already done.
 *
 * A RECORDED DECLINE IS NEVER PROMOTED BY A LATER OVERRIDE. Somebody set a
 * number afterwards, which is a good thing and a different act, and rewriting
 * the launch answer to `set` would erase the record that the founder was asked
 * at launch and said no. The two facts ride side by side: `answer` stays
 * `declined`, `overridden` says a number was set later.
 */
export function issuanceCapDecision(input: {
  /**
   * The recorded DECLINE, when the founder made one, and null otherwise.
   *
   * Only a decline is ever written down, because it is the only one of the
   * three answers that leaves no trace anywhere else. A cap somebody set is
   * visible as an override row, and a village nobody has asked is visible as
   * the absence of both.
   */
  declined: { by: string | null; at: string | null } | null;
  /** The raw override value from game_variables, or null when there is no row. */
  overrideValue: string | null;
  /** The platform default for the dial, as the registry spells it. */
  platformDefault: string;
}): IssuanceCapDecision {
  const overridden = input.overrideValue !== null && input.overrideValue !== undefined;
  const raw = overridden ? String(input.overrideValue) : String(input.platformDefault);
  const parsed = Number.parseInt(raw, 10);
  /*
   * A CAP THIS CANNOT PARSE READS AS ZERO, WHICH IS THE TIGHTEST ANSWER.
   *
   * "Caps fail closed: 0 means zero, never unlimited" is the ledger's own
   * rule. A junk row in game_variables is the one case where this function has
   * to guess, and guessing loose would be guessing that a village may issue
   * without limit. It guesses tight instead.
   */
  const capTokens = Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;

  if (input.declined) {
    return {
      answer: "declined",
      capTokens,
      overridden,
      by: input.declined.by ?? null,
      at: input.declined.at ?? null,
    };
  }
  if (overridden) {
    return { answer: "set", capTokens, overridden, by: null, at: null };
  }
  /*
   * ONE WRINKLE, WRITTEN DOWN INSTEAD OF HIDDEN. A founder who sets a cap and
   * later sets it back to the platform's number has no override row again,
   * because `setVariable` deletes the row when the value equals the default.
   * This reads that village as `unset`, and that is the true answer: it holds
   * no number of its own and it has recorded no decision. One click on the
   * decline turns it into a decision again, which is what it actually is.
   */
  return { answer: "unset", capTokens, overridden, by: null, at: null };
}

/**
 * The compile-time gate this codebase uses on every union it branches on. A
 * fourth answer arrives as a type error at the sentence that would otherwise
 * have rendered it through somebody else's branch.
 */
export function assertNoOtherAnswer(a: never): never {
  throw new Error(`unhandled issuance cap answer: ${JSON.stringify(a)}`);
}

/**
 * ONE SENTENCE PER ANSWER, AND THE THREE MUST NEVER MATCH.
 *
 * A founder who set a cap, a founder who was asked and declined, and a village
 * where nobody has been asked are three different facts about a village. The
 * middle one is a decision and the last one is an omission, and a surface that
 * printed the same words for both would be telling a founder they had decided
 * something they never saw.
 */
export function issuanceCapSentence(d: IssuanceCapDecision): string {
  const cap = `${d.capTokens} whole tokens of any one token in a lunar cycle`;
  switch (d.answer) {
    case "set":
      return (
        `This village set its own issuance cap: ${cap}. Every door that brings tokens into ` +
        "existence spends that number, and a cap of 0 means zero."
      );
    case "declined": {
      const who = d.by ? ` by ${d.by}` : "";
      const when = d.at ? ` on ${d.at.slice(0, 10)}` : "";
      const later = d.overridden
        ? " A number has been set since, and the launch answer stands as the record of what was decided at launch."
        : "";
      return (
        `This village was asked for an issuance cap at launch and chose to name no number of ` +
        `its own${who}${when}. The platform's cap still binds every door, at ${cap}, and it ` +
        `can be set at any time from the game variables.${later}`
      );
    }
    case "unset":
      return (
        "Nobody has answered what this village's issuance cap should be. The platform's cap " +
        `binds every door meanwhile, at ${cap}, so tokens are capped. What is missing is a ` +
        "decision, and the journey asks for one before the village votes to launch."
      );
    default:
      return assertNoOtherAnswer(d.answer);
  }
}

/**
 * The short detail line the launch checklist prints beside the item.
 *
 * `declined` reads `ok` on the checklist and says so in words, because the
 * founder answered. That is the whole shape of the ruling: declining is an
 * answer, and a checklist that kept the item red after one would be telling a
 * founder their decision did not count.
 */
export function issuanceCapDetail(d: IssuanceCapDecision): { state: "ok" | "missing"; detail: string } {
  switch (d.answer) {
    case "set":
      return { state: "ok", detail: `This village issues at most ${d.capTokens} of a token in a lunar cycle` };
    case "declined":
      return {
        state: "ok",
        detail:
          `Asked at launch and declined${d.by ? ` by ${d.by}` : ""}. The platform's cap of ` +
          `${d.capTokens} still binds every door`,
      };
    case "unset":
      return {
        state: "missing",
        detail:
          `Nobody has answered. The platform's cap of ${d.capTokens} binds meanwhile, and this ` +
          "village has made no decision about it",
      };
    default:
      return assertNoOtherAnswer(d.answer);
  }
}
