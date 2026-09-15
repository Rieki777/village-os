/**
 * WHAT THE ECONOMICS MODEL HAD TO ASSUME, WRITTEN DOWN WHERE A FOUNDER CAN
 * READ IT.
 *
 * ── WHAT IS OBSERVED AND WHAT IS ASSUMED ───────────────────────────────────
 *
 * The contract now carries three facts this file used to guess at.
 * `VillageSnapshot.launched` says whether the village may issue at all, and
 * `VillageSnapshot.quests` says how many quests the village confirmed in the
 * cycle before the snapshot and what one confirmation paid. Those are
 * MEASUREMENTS, they are read off the tables, and an assumption standing
 * where a measurement exists is a guess dressed as a fact. So all three are
 * gone from this file.
 *
 * What is left is what the snapshot still cannot say, and each one is a
 * behaviour of PEOPLE:
 *
 *   - whether the observed quest rate holds, rises or falls;
 *   - how much of an allowance anybody actually gives away;
 *   - whether the credits people hold get spent on anything;
 *   - whether an administrator presses the button that releases the pool.
 *
 * ── WHY THE DEFAULTS ARE THE CAUTIOUS ONES ─────────────────────────────────
 *
 * The quest rate defaults to the observed one, unchanged, because a flat
 * projection of a measurement is the only projection nobody has to defend.
 * Giving and spending default to zero, because a model that invented a lively
 * village would produce a preview that looks healthy because the model decided
 * it should.
 *
 * ── WHERE THIS PLUGS INTO THE ENGINE ───────────────────────────────────────
 *
 * `SimInput.assumptions` is the one place an activity assumption lives, keyed
 * by model name, and the engine carries it onto every `SimState` and echoes it
 * on `SimResult`. So the model reads `state.assumptions.economics` through
 * `parseEconomicsAssumptions`, and the assumptions its constructor was given
 * are the per-field fallback. Nothing in the model holds a constant of its
 * own, because a constant cannot be read back off a result.
 */
import type { QuestsSummary } from "./types";

/** How the economics model fills in what the snapshot cannot tell it. */
export interface EconomicsAssumptions {
  /**
   * What the OBSERVED confirmation rate is multiplied by.
   *
   * `QuestsSummary.confirmedPerCycle` is the measurement. 1 repeats it, 2
   * previews a village that doubles its output, 0 previews one where the work
   * stops. The result says both the observation and the multiple, so a reader
   * can argue with the multiple and check the observation.
   */
  questRateMultiplier: number;
  /**
   * How much of a member's cycle allowance actually gets given away, from 0
   * for a silent village to 1 for one that spends every point of it.
   */
  gratitudeAllowanceGivenShare: number;
  /**
   * What one member spends into a sink each cycle, in minor units of the pool
   * token. Bounded by what they hold, the way the ledger bounds it.
   */
  sinkSpendPerMemberPerCycle: bigint;
  /**
   * Whether an administrator closes the gratitude cycle each cycle, which is
   * what releases the value pool. Nothing in this build does it on a timer:
   * `POST /api/admin/cycles/close` is a human act, and a village that never
   * presses it never distributes a single token of its pool.
   */
  poolClosedEachCycle: boolean;
}

/** The cautious village. See the header for why each default is what it is. */
export const DEFAULT_ECONOMICS_ASSUMPTIONS: EconomicsAssumptions = {
  questRateMultiplier: 1,
  gratitudeAllowanceGivenShare: 0,
  sinkSpendPerMemberPerCycle: BigInt(0),
  poolClosedEachCycle: true,
};

function asNumber(raw: unknown, fallback: number, min: number, max: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function asBigInt(raw: unknown, fallback: bigint): bigint {
  if (typeof raw === "bigint") return raw < BigInt(0) ? BigInt(0) : raw;
  if (typeof raw === "number") {
    if (!Number.isFinite(raw)) return fallback;
    const whole = Math.trunc(raw);
    return BigInt(whole < 0 ? 0 : whole);
  }
  if (typeof raw === "string") {
    const text = raw.trim();
    if (!/^-?[0-9]+$/.test(text)) return fallback;
    const value = BigInt(text);
    return value < BigInt(0) ? BigInt(0) : value;
  }
  return fallback;
}

function asBoolean(raw: unknown, fallback: boolean): boolean {
  if (typeof raw === "boolean") return raw;
  if (raw === "true" || raw === 1 || raw === "1") return true;
  if (raw === "false" || raw === 0 || raw === "0") return false;
  return fallback;
}

/**
 * Read assumptions out of whatever the engine was handed.
 *
 * Total over every input. A missing field, a string where a number belongs,
 * `null`, or a whole payload that is not an object all give the fallback,
 * because a preview that threw on a malformed assumption would be a preview a
 * village cannot open. Values are clamped to the range each one can mean.
 *
 * `fallback` is the per-field default, and it is a parameter so the model can
 * pass the assumptions its constructor was given. A caller that supplies half
 * an object therefore gets the model's own numbers for the other half, and a
 * caller that supplies none gets them for all of it.
 */
export function parseEconomicsAssumptions(
  raw: unknown,
  fallback: EconomicsAssumptions = DEFAULT_ECONOMICS_ASSUMPTIONS,
): EconomicsAssumptions {
  if (!raw || typeof raw !== "object") return { ...fallback };
  const o = raw as Record<string, unknown>;
  return {
    questRateMultiplier: asNumber(o.questRateMultiplier, fallback.questRateMultiplier, 0, 1000),
    gratitudeAllowanceGivenShare: asNumber(
      o.gratitudeAllowanceGivenShare,
      fallback.gratitudeAllowanceGivenShare,
      0,
      1,
    ),
    sinkSpendPerMemberPerCycle: asBigInt(o.sinkSpendPerMemberPerCycle, fallback.sinkSpendPerMemberPerCycle),
    poolClosedEachCycle: asBoolean(o.poolClosedEachCycle, fallback.poolClosedEachCycle),
  };
}

/**
 * The assumptions as sentences, for printing beside the seed.
 *
 * One sentence per assumption, every time, including the ones that are set to
 * zero. A list that hid its zeroes would let the most consequential assumption
 * in the set (nobody gives anything) go unread.
 *
 * `quests` and `launched` are OBSERVATIONS and never assumptions, and they are
 * printed here anyway, last, labelled as what the village was measured doing.
 * A reader checking an answer needs both halves in one place, and the label is
 * what keeps the two apart.
 */
export function describeAssumptions(
  a: EconomicsAssumptions,
  quests?: QuestsSummary,
  launched?: boolean,
): string[] {
  const share = Math.round(a.gratitudeAllowanceGivenShare * 100);
  const out = [
    a.questRateMultiplier === 1
      ? "This run repeats the quest rate the village was measured at, unchanged."
      : a.questRateMultiplier === 0
        ? "No quest is confirmed in any cycle of this run, whatever the village was measured doing."
        : `This run projects the measured quest rate multiplied by ${a.questRateMultiplier}.`,
    share === 0
      ? "Nobody gives any recognition in this run, so the whole allowance expires unused every cycle."
      : `Members give away ${share}% of their cycle allowance, spread across the people they can reach within the per-person share.`,
    a.sinkSpendPerMemberPerCycle === BigInt(0)
      ? "Nobody spends anything, so every token issued in this run stays in a member's hands."
      : `Each member spends ${String(a.sinkSpendPerMemberPerCycle)} minor units of the pool token each cycle, or as much of it as they hold.`,
    a.poolClosedEachCycle
      ? "An administrator closes the gratitude cycle every cycle, which is what releases the value pool. Nothing in this build does it on a timer."
      : "Nobody closes the gratitude cycle in this run, so the value pool releases nothing at all.",
  ];
  if (quests) {
    out.push(
      `Measured, never assumed: the village confirmed ${quests.confirmedPerCycle} quest(s) in the cycle before this snapshot, ${quests.open} quest(s) stand open, and one confirmation paid ${String(quests.gratitudePerConfirmation)} minor units of recognition on average.`,
    );
  }
  if (launched !== undefined) {
    out.push(
      launched
        ? "Measured, never assumed: this village has started its Game, so its faucets may issue."
        : "Measured, never assumed: this village has not started its Game, so every posting out of a faucet is refused and nothing is issued.",
    );
  }
  return out;
}
