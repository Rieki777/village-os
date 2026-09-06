/**
 * THE TEST RUN (R86): watch a whole cycle turn before you bet a village on it.
 *
 * Rye: "we also need a 'test the village' option where all the cycles can run
 * rapidly so we can test how they are all working ... so we can see how
 * everything runs, which we should do anyway before going live. So the 'journey
 * to launch' has this as the second to last button to run a quick test over all
 * settings to see if they would work in production or break in some way."
 *
 * The button after this one opens the launch ballot, which needs every member
 * to agree and turns on token issuance for good. This is the last moment
 * anybody can find out that a setting breaks.
 *
 * ── WHY THIS COMPUTES INSTEAD OF RUNNING ────────────────────────────────────
 *
 * R81 puts all minting behind governance. R67 says a village that has not
 * started its Game issues nothing at all, and `server/lib/gameStart.ts` enforces
 * that inside `postTransfer`, on `ledger_accounts.faucet`, under the lock. A
 * test run that minted into real balances would be the platform issuing value
 * with no vote behind it, which is the exact act those rulings exist to prevent.
 *
 * Two facts settle the design between them:
 *
 *  1. Before launch, every faucet posting is already refused. Driving the real
 *     write paths on a village that has not started would exercise the gate and
 *     tell the founder nothing about their economy. Turning the gate off to
 *     learn something would remove the gate.
 *
 *  2. `give` in `server/lib/economy.ts` commits its `gratitude_log` row and
 *     THEN posts to the ledger, on purpose, so the allowance is spent before
 *     the mint is attempted. On a village that has not started, calling it
 *     leaves a permanent recognition row, spends a real allowance, and mints
 *     nothing. That row is history a later reader would count.
 *
 * So this module takes no pool, opens no connection and writes no row. It reads
 * the village's own dials through the synchronous variables cache, takes a
 * snapshot of the few facts that live in tables, and computes what each moon
 * would do. `mintView`'s `settlementPreview` and `/api/admin/cycles/pending`
 * already work this way for one cycle each; this is the same idea walked
 * forward over many.
 *
 * WHAT IT COSTS, stated here and repeated to the founder in `notCovered`: a
 * computation cannot catch a bug that only appears when the real write path
 * runs. It catches a setting that cannot work, which is what the founder asked
 * to see.
 *
 * ── THE CLOCK ───────────────────────────────────────────────────────────────
 *
 * Nothing here speeds a timer up. The lunar math in `shared/lunar.ts` is pure
 * and takes an instant, so a compressed run is a walk over cycle numbers with
 * the instant supplied, one turn per lunation. That is why the answers are the
 * ones production would give: the same functions, the same table of true new
 * moons, a different argument.
 */
import { GAME_CONFIG } from "../../shared/gameConfig";
import { activeClock, boundsForNumber, formatCycleId } from "./gratitude-cycles";
import type { VillageMoon } from "../../shared/villageMoon";
import { villageMoonForCycle } from "./villageMoon";
import { cyclePoolProblem } from "./cyclePool";
import { faucetFor, toLedgerUnits, VILLAGE_VOICE } from "./economy";
import { shareCapFor } from "./gratitude";
import { tokenDef } from "./ledger";
import { numberVar, stringVar } from "./variables";
import { claimsWindow } from "./voiceClaim";

/** The longest run the page offers. Three lunar years of turns. */
export const MAX_MOONS = 40;

/**
 * One mint rule as the run needs it, including whatever is queued against it.
 *
 * `pending` mirrors the four `pending_*` columns `applyPendingRules` promotes,
 * because a founder who has queued a change wants to see the moon it lands in.
 */
export interface DryRunRule {
  id: string;
  trigger: string;
  tokenSlug: string;
  amount: number | null;
  ceiling: number;
  enabled: boolean;
  effectiveFromCycle: number;
  pending: null | { amount: number | null; ceiling: number; enabled: boolean; fromCycle: number };
}

/**
 * A registered scheduler job, exactly as `registeredJobs()` reports it.
 *
 * There is deliberately no job-to-module map here. Several jobs open with
 * `if (effectiveLifecycle("x") === "off") return`, and that check lives inside
 * the job's own function where nothing can read it. A hand-kept map naming
 * which job belongs to which module would be right on the day it was written
 * and wrong the first time somebody added a job, so the report names the
 * modules that are off as its own fact and leaves the founder to join them.
 */
export interface DryRunJob {
  name: string;
  everyMs: number;
}

/**
 * The handful of facts that live in tables. Everything else the run needs is a
 * dial, and dials are read through the in-memory variables cache.
 */
export interface DryRunSnapshot {
  gameStarted: boolean;
  startedAt: string | null;
  /** Live member seatings: what the moon settlement would thank. */
  seatCount: number;
  rules: DryRunRule[];
  jobs: DryRunJob[];
  /**
   * Modules this village has switched off, id and catalog name.
   *
   * The id is here so a check can join on it without a hand-kept map. The feed
   * is the one that matters to the arithmetic below: `/api/feed` mounts behind
   * `requireModule("feed")`, so a village with the feed off is sending no
   * hearts at all, and a note about what a heart costs would be describing a
   * channel nobody can reach. Giving is NOT gated this way:
   * `/api/game/gratitude/send` mounts with no module guard, so the written
   * allowance holds whatever the catalog says.
   */
  modulesOff: Array<{ id: string; name: string }>;
}

export type Outcome = "issued" | "refused" | "idle";

export interface Finding {
  /** settlement, rules, claims, pool, issuance. */
  area: string;
  outcome: Outcome;
  /** What happened, in the words the report shows. */
  sentence: string;
}

export interface DryRunTurn {
  cycleNumber: number;
  cycleKey: string;
  startsAt: string;
  endsAt: string;
  /** The village's own moon, which is what the report prints. */
  moon: VillageMoon;
  findings: Finding[];
}

export interface DryRunAllowance {
  stageId: string;
  stageName: string;
  multiplier: number;
  allowance: number;
  shareCap: number;
  /** How many different people it takes to spend a whole allowance. */
  spreadsAcross: number;
  heartsSendable: boolean;
  note: string;
}

export interface DryRunJobLine {
  name: string;
  /** How often it asks, in the units a person would say it in. */
  cadence: string;
  /** About how many times across the span, rounded to something readable. */
  runsInSpan: string;
  note: string;
}

export interface DryRunReport {
  ranAt: string;
  moons: number;
  spanDays: number;
  firstCycle: number;
  lastCycle: number;
  gameStarted: boolean;
  /** What this run touched, said before anything else. */
  isolation: string;
  turns: DryRunTurn[];
  /**
   * The facts that hold across the whole run instead of belonging to one moon:
   * the value pool, the claim threshold, the modules that are off, the
   * issuance gate. These used to ride on the first turn, which made moon one
   * look busy and every other moon look empty.
   */
  runFindings: Finding[];
  allowances: DryRunAllowance[];
  jobs: DryRunJobLine[];
  /** Every refusal from every turn, gathered once, deduplicated by sentence. */
  refusals: Finding[];
  covered: string[];
  notCovered: string[];
}

export interface DryRunOptions {
  moons: number;
  /** The instant the first simulated moon contains. Injected for the suite. */
  from?: Date;
  /**
   * The lunation this village calls Moon 1, resolved by the caller (the route
   * reads it; this function stays pure and clockless). Null on a village that
   * is not counting yet, which is most villages reading this report: the whole
   * point of a launch dry run is that the launch has not happened.
   */
  moonOneCycle?: number | null;
}

const DAY_MS = 86_400_000;

/** "1 seat holder" and "3 seat holders", never "1 seat holder(s)". */
function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * A cadence in the units somebody would say it in.
 *
 * The first draft printed every job as a number of hours to one decimal, so a
 * job that asks every five minutes read "every 0.1 hour(s)". A figure nobody
 * would say out loud is a figure nobody checks.
 */
function cadenceOf(everyMs: number): string {
  const minutes = Math.round(everyMs / 60_000);
  if (minutes < 60) return `every ${minutes} minutes`;
  const hours = Math.round(minutes / 60);
  if (hours === 1) return "every hour";
  if (hours === 24) return "once a day";
  if (hours % 24 === 0) return `every ${hours / 24} days`;
  return `every ${hours} hours`;
}

/**
 * A count at the precision it deserves.
 *
 * A background job asking every five minutes for a lunar year comes to 101,980,
 * and the last four digits of that are noise dressed as measurement.
 */
function roughly(n: number): string {
  if (n < 1000) return String(n);
  if (n < 10_000) return `${Math.round(n / 100) / 10} thousand`;
  return `${Math.round(n / 1000)} thousand`;
}

/**
 * Which rules are in force at a cycle, as `runSettlement` would see them.
 *
 * The order matters and it is the order settlement uses: promote every queued
 * change whose moon has come, THEN read the rules. A change stamped for this
 * cycle governs this settlement. Reading first would pay the old rate and apply
 * the new one a moon late, which is the deferral working backwards.
 */
function rulesInForce(rules: readonly DryRunRule[], cycle: number): DryRunRule[] {
  const promoted = rules.map((r) => {
    if (r.pending && r.pending.fromCycle <= cycle) {
      return {
        ...r,
        amount: r.pending.amount,
        ceiling: r.pending.ceiling,
        enabled: r.pending.enabled,
        effectiveFromCycle: r.pending.fromCycle,
        pending: null,
      };
    }
    return r;
  });
  return promoted.filter((r) => r.enabled && r.effectiveFromCycle <= cycle);
}

/** Whether any claims window opens inside a lunation. */
function claimsOpenInside(startsAt: Date, endsAt: Date): { open: boolean; opensAt: Date | null } {
  const atStart = claimsWindow(startsAt);
  if (atStart.open) return { open: true, opensAt: startsAt };
  const next = atStart.nextOpens;
  if (next && next < endsAt) return { open: true, opensAt: next };
  return { open: false, opensAt: null };
}

/**
 * The allowance table, one row per stage of the ladder.
 *
 * R73 made a member's per-cycle budget `gratitude.base_budget` times their
 * stage multiplier, with a per-recipient ceiling that is a SHARE of that
 * budget, counted across written acknowledgments and feed hearts together. A
 * compressed run turns cycles over quickly and exercises that ceiling far
 * harder than a real month would, so the refusals it produces belong on the
 * report where a founder can read them before launch.
 *
 * The four failures this catches, all reachable with dials that each read as a
 * sane number on their own:
 *
 *   a multiplier of 0, or a base budget of 0, so members at that stage cannot
 *   give anything and the page never says why;
 *
 *   a heart worth more than the whole per-person share, so every tap on the
 *   feed is refused while the acknowledgment page still works;
 *
 *   a share that rounds below one Gratitude, where `shareCapFor` floors at 1
 *   and the dial then means something other than what it reads;
 *
 *   a heart tap cap that allows more taps than the share leaves room for, so
 *   the number on the feed dial is never the number that bites.
 */
function allowanceTable(feedOff: boolean): DryRunAllowance[] {
  const base = numberVar("gratitude.base_budget");
  const heart = numberVar("feed.heart_amount");
  const sharePct = numberVar("gratitude.max_share_per_recipient");
  const tapCap = numberVar("feed.max_hearts_per_recipient_per_cycle");
  return GAME_CONFIG.stages.map((s) => {
    const multiplier = Math.max(0, numberVar(`progression.multiplier.${s.id}`));
    const allowance = Math.round(base * multiplier);
    const cap = shareCapFor(allowance);
    const spreadsAcross = cap > 0 ? Math.ceil(allowance / cap) : 0;
    const heartsSendable = allowance > 0 && heart <= cap;
    // The share the dial asks for, before the floor of 1 is applied.
    const asked = Math.floor((allowance * sharePct) / 100);
    // How many taps the share leaves room for, against how many the feed dial
    // says a member gets. Whichever is smaller is the one a member meets.
    const tapsTheShareAllows = heart > 0 ? Math.floor(cap / heart) : 0;
    let note: string;
    if (allowance <= 0) {
      note = `Members at ${s.name} can give nothing. Their sending budget is ${base} times ${multiplier}, which comes to zero.`;
    } else if (!heartsSendable && !feedOff) {
      note =
        `A heart is worth ${heart} and one person may receive ${cap} from a member at ${s.name}, ` +
        `so every tap on the feed would be refused. Raise the share, or lower what a heart is worth.`;
    } else if (asked < 1) {
      note =
        `A member at ${s.name} gives ${allowance} a moon. ${sharePct}% of that is under one Gratitude, ` +
        `so the ceiling holds at 1 and the share dial is doing nothing here.`;
    } else if (tapsTheShareAllows < tapCap && !feedOff) {
      note =
        `A member at ${s.name} gives ${allowance} a moon and up to ${cap} of it to any one person. ` +
        `That is ${tapsTheShareAllows} hearts to one person, and the feed dial says ${tapCap}, ` +
        `so the share is the one they meet.`;
    } else {
      note =
        `A member at ${s.name} gives ${allowance} a moon and up to ${cap} of it to any one person, ` +
        `so it takes ${spreadsAcross} people to spend a whole allowance.`;
    }
    return {
      stageId: s.id,
      stageName: s.name,
      multiplier,
      allowance,
      shareCap: cap,
      spreadsAcross,
      // A channel a member cannot reach is not a channel they can send on.
      heartsSendable: heartsSendable && !feedOff,
      note,
    };
  });
}

/**
 * What the moon settlement would do in one cycle.
 *
 * This mirrors `runSettlement` exactly, guard for guard, and each guard that
 * fires becomes a sentence. The three silent ones are the reason the function
 * exists: a `role.cycle` rule whose amount is null reads its amount from a
 * source a seat does not have, so it pays nothing forever; a rule for a token
 * with no faucet can never pay; and a rule whose amount rounds to zero ledger
 * units pays nothing while showing a number on the dial.
 */
function settlementFindings(
  snapshot: DryRunSnapshot,
  rules: readonly DryRunRule[],
  everyRule: readonly DryRunRule[],
): Finding[] {
  const out: Finding[] = [];
  const cycleRules = rules.filter((r) => r.trigger === "role.cycle");

  /*
   * THREE DIFFERENT EMPTINESSES, and saying the wrong one is a fallback that
   * lies. `rules` here has already been filtered to what is enabled AND in
   * force this moon, so an empty list can mean the village has no rules, or
   * that it has them and they start later. The first draft said "no mint rule
   * is switched on" for both, which would have told a founder their rules were
   * off while they sat in the table waiting for their moon.
   */
  if (everyRule.filter((r) => r.enabled).length === 0) {
    out.push({
      area: "settlement",
      outcome: "refused",
      sentence: "No mint rule is switched on for this village, so a moon settlement would pay nobody.",
    });
    return out;
  }
  if (rules.length === 0) {
    out.push({
      area: "settlement",
      outcome: "idle",
      sentence: "Every rule this village has starts from a later moon, so this one settles nothing.",
    });
    return out;
  }
  if (cycleRules.length === 0) {
    out.push({
      area: "settlement",
      outcome: "refused",
      sentence: "No rule is set for holding a seat through a moon, so the settlement has nothing to pay.",
    });
    return out;
  }
  if (snapshot.seatCount === 0) {
    out.push({
      area: "settlement",
      outcome: "idle",
      sentence: "Nobody holds a seat this moon, so the settlement thanks nobody. It has a rule ready when somebody does.",
    });
    return out;
  }

  for (const r of cycleRules) {
    const token = tokenDef(r.tokenSlug);
    const tokenName = token?.name ?? r.tokenSlug;
    if (r.amount === null) {
      out.push({
        area: "settlement",
        outcome: "refused",
        sentence: `The ${tokenName} rule for holding a seat reads its amount from the work, and a seat has no amount to read, so it pays nothing.`,
      });
      continue;
    }
    if (r.amount <= 0) {
      out.push({
        area: "settlement",
        outcome: "refused",
        sentence: `The ${tokenName} rule for holding a seat is set to ${r.amount}, so it pays nothing.`,
      });
      continue;
    }
    const faucet = faucetFor(r.tokenSlug);
    if (!faucet) {
      out.push({
        area: "settlement",
        outcome: "refused",
        sentence: `${tokenName} has no faucet, so the seat rule can never issue it. A token the ledger cannot mint needs a different rule.`,
      });
      continue;
    }
    if (!token) {
      out.push({
        area: "settlement",
        outcome: "refused",
        sentence: `The seat rule pays "${r.tokenSlug}", which is not a registered token here.`,
      });
      continue;
    }
    if (token.governance !== "platform") {
      out.push({
        area: "settlement",
        outcome: "refused",
        sentence: `${tokenName} is ${token.governance}-governed and is mirrored here, so this village cannot issue it.`,
      });
      continue;
    }
    const units = toLedgerUnits(r.tokenSlug, r.amount);
    if (units <= 0) {
      out.push({
        area: "settlement",
        outcome: "refused",
        sentence: `The ${tokenName} seat rule is set to ${r.amount}, which rounds to nothing at this token's precision, so it pays nothing.`,
      });
      continue;
    }
    out.push({
      area: "settlement",
      outcome: "issued",
      sentence:
        `${plural(snapshot.seatCount, "seat holder", "seat holders")} each thanked ` +
        `${r.amount} ${tokenName}, which comes to ${snapshot.seatCount * r.amount} for the moon.`,
    });
  }
  return out;
}

/**
 * Queued dial changes that land in this cycle, named one by one.
 *
 * Two things here are the audit's, not the first draft's.
 *
 * A change stamped for a moon BEFORE the run starts is already due, and the
 * first draft matched on equality alone, so it went unmentioned while the
 * settlement quietly paid the new number from turn one. It is announced on the
 * first turn instead, as what it is.
 *
 * And a queued change is four columns, not one. A pending `enabled: false`
 * used to render as "20 becomes 20" while silently stopping the payments, which
 * is the loudest possible thing said in the quietest possible way.
 */
function promotionFindings(
  rules: readonly DryRunRule[],
  cycle: number,
  firstCycle: number,
): Finding[] {
  const out: Finding[] = [];
  for (const r of rules) {
    if (!r.pending) continue;
    const due = r.pending.fromCycle;
    const landsNow = due === cycle || (due < firstCycle && cycle === firstCycle);
    if (!landsNow) continue;

    const tokenName = tokenDef(r.tokenSlug)?.name ?? r.tokenSlug;
    const parts: string[] = [];
    if (r.pending.amount !== r.amount) {
      const from = r.amount === null ? "read from the work" : String(r.amount);
      const to = r.pending.amount === null ? "read from the work" : String(r.pending.amount);
      parts.push(`${from} becomes ${to}`);
    }
    if (r.pending.ceiling !== r.ceiling) {
      parts.push(`its ceiling goes from ${r.ceiling} to ${r.pending.ceiling}`);
    }
    if (r.pending.enabled !== r.enabled) {
      parts.push(r.pending.enabled ? "it switches on" : "it switches off");
    }
    const what = parts.length > 0 ? parts.join(", ") : "nothing about it changes";
    const when = due < firstCycle
      ? `was queued for an earlier moon and is already due, so it applies from the first moon of this run: ${what}`
      : `lands this moon: ${what}`;
    out.push({
      area: "rules",
      // A change that switches a rule OFF is a payment stopping. It belongs
      // with the refusals, where a founder reads it before the vote.
      outcome: r.pending.enabled === false && r.enabled ? "refused" : "issued",
      sentence: `The queued change to the ${tokenName} rule for ${r.trigger} ${when}.`,
    });
  }
  return out;
}

/**
 * The whole run.
 *
 * Takes a snapshot and returns a report. No pool, no connection, no write. A
 * reader who wants to be sure of that can check the imports at the top of this
 * file: none of them can reach a database.
 */
export function dryRun(snapshot: DryRunSnapshot, options: DryRunOptions): DryRunReport {
  const from = options.from ?? new Date();
  // NaN survives Math.min and Math.max, and a NaN moon count runs zero turns
  // while the report still says how many moons it covered. The route validates
  // before it gets here; this is so the function is safe on its own terms.
  const asked = Math.trunc(Number(options.moons));
  const moons = Number.isFinite(asked) ? Math.max(1, Math.min(MAX_MOONS, asked)) : 1;
  // The village's own clock, so a projection over "moons" counts whatever a
  // cycle is here: lunations by default, calendar months where a village voted
  // for them.
  const firstCycle = activeClock().cycleNumberAt(from);

  const turns: DryRunTurn[] = [];
  for (let i = 0; i < moons; i++) {
    const cycle = firstCycle + i;
    const bounds = boundsForNumber(cycle);
    const inForce = rulesInForce(snapshot.rules, cycle);
    const findings: Finding[] = [
      ...promotionFindings(snapshot.rules, cycle, firstCycle),
      ...settlementFindings(snapshot, inForce, snapshot.rules),
    ];

    const claims = claimsOpenInside(bounds.startsAt, bounds.endsAt);
    findings.push(
      claims.open
        ? {
            area: "claims",
            outcome: "issued",
            sentence: `Claims Week opens on ${claims.opensAt!.toISOString().slice(0, 10)}, so voice gathered by then can be carried to Hypha.`,
          }
        : {
            area: "claims",
            outcome: "idle",
            sentence: "No Claims Week falls in this moon, so voice keeps gathering.",
          },
    );

    turns.push({
      cycleNumber: cycle,
      // The id stays in the payload as the key these turns are filed under.
      // The page prints `moon` and no longer prints this.
      cycleKey: formatCycleId(cycle),
      startsAt: bounds.startsAt.toISOString(),
      endsAt: bounds.endsAt.toISOString(),
      moon: villageMoonForCycle(cycle, options.moonOneCycle ?? null),
      findings,
    });
  }

  // ── Run-level findings, appended to the first turn's neighbours ───────────
  const runFindings: Finding[] = [];

  const poolSize = numberVar("gratitude.pool_per_cycle");
  const poolToken = stringVar("gratitude.pool_token");
  const poolProblem = cyclePoolProblem(poolSize, poolToken);
  if (poolProblem) {
    runFindings.push({ area: "pool", outcome: "refused", sentence: poolProblem });
  } else if (poolSize > 0) {
    const name = tokenDef(poolToken)?.name ?? poolToken;
    runFindings.push({
      area: "pool",
      outcome: "issued",
      sentence: `Each close would share ${poolSize} ${name} among the people recognised that moon, in proportion to what they received.`,
    });
  } else {
    runFindings.push({
      area: "pool",
      outcome: "idle",
      sentence: "No value pool is set for a cycle close, so closing a moon records the totals and releases nothing.",
    });
  }

  /*
   * A CLAIMS WEEK THAT NEVER ARRIVES, which the per-moon lines cannot show.
   *
   * "No Claims Week falls in this moon" is true on every turn in two very
   * different villages: one whose window is a few moons away, and one whose
   * dates were typed wrong. `claimsWindow` refuses a value it cannot parse and
   * shuts the window rather than reading a typo as permission, so a village
   * that set "2026-06-21" instead of "06-21" has claims closed forever and
   * every turn says something reassuring about gathering.
   */
  const claimsWeekDates = stringVar("economy.claims_week_starts").trim();
  const claimsEverOpen = turns.some((t) =>
    t.findings.some((f) => f.area === "claims" && f.outcome === "issued"),
  );
  if (claimsWeekDates && !claimsEverOpen) {
    runFindings.push({
      area: "claims",
      outcome: "refused",
      sentence:
        `No Claims Week opens in the ${moons} moons this run covers. The dates set are ` +
        `"${claimsWeekDates}", and each one is a month and a day like 06-21. A date this ` +
        "cannot read closes claims for good, so a full year in one of them shuts the window.",
    });
  }

  const hyphaSpace = stringVar("economy.hypha_space").trim();
  if (!hyphaSpace) {
    runFindings.push({
      area: "claims",
      outcome: "refused",
      sentence:
        "No Hypha space is set, so voice gathers correctly and nobody can claim it. Members are told exactly that.",
    });
  }

  // How long a seat holder waits for their voice to reach the claim threshold,
  // at the rates the seat rules actually carry. A threshold nobody reaches in
  // three lunar years is a loop that never visibly closes.
  const threshold = numberVar("economy.voice_claim_threshold");
  const voicePerMoon = rulesInForce(snapshot.rules, firstCycle)
    .filter((r) => r.trigger === "role.cycle" && r.tokenSlug === VILLAGE_VOICE)
    .reduce((n, r) => n + (r.amount ?? 0), 0);
  if (voicePerMoon > 0) {
    const moonsToClaim = Math.ceil(threshold / voicePerMoon);
    runFindings.push({
      area: "claims",
      outcome: moonsToClaim <= moons ? "issued" : "refused",
      sentence:
        moonsToClaim <= moons
          ? `A seat holder gathers ${voicePerMoon} voice a moon and reaches the claim threshold of ${threshold} after ${moonsToClaim} moons, inside this run.`
          : `A seat holder gathers ${voicePerMoon} voice a moon, so reaching the claim threshold of ${threshold} takes ${moonsToClaim} moons. This run covers ${moons}.`,
    });
  } else {
    runFindings.push({
      area: "claims",
      outcome: "refused",
      sentence: `No rule issues voice for holding a seat, so a seat holder never reaches the claim threshold of ${threshold}.`,
    });
  }

  const feedOff = snapshot.modulesOff.some((m) => m.id === "feed");
  if (snapshot.modulesOff.length > 0) {
    runFindings.push({
      area: "jobs",
      outcome: "idle",
      sentence:
        `${plural(snapshot.modulesOff.length, "module is", "modules are")} off in this village: ` +
        `${snapshot.modulesOff.map((m) => m.name).join(", ")}. ` +
        "The background jobs that belong to them ask on their usual cadence and then sit out.",
    });
  }
  if (feedOff) {
    runFindings.push({
      area: "gratitude",
      outcome: "idle",
      sentence:
        "The feed is off, so nobody is tapping hearts. The allowance below is what a member can " +
        "give through written acknowledgments alone.",
    });
  }

  runFindings.push(
    snapshot.gameStarted
      ? {
          area: "issuance",
          outcome: "idle",
          sentence: `This village started its Game on ${String(snapshot.startedAt ?? "").slice(0, 10)}. This run still wrote nothing: every figure above is what the rules would pay.`,
        }
      : {
          area: "issuance",
          outcome: "idle",
          sentence:
            "This village has not started its Game, so nothing above was issued. Every figure is what the rules would pay once the launch vote carries.",
        },
  );


  // ── The jobs, counted and never run ──────────────────────────────────────
  const spanDays = moons > 0
    ? (boundsForNumber(firstCycle + moons - 1).endsAt.getTime() - boundsForNumber(firstCycle).startsAt.getTime()) / DAY_MS
    : 0;
  const jobs: DryRunJobLine[] = snapshot.jobs
    .map((j) => {
      const cadence = cadenceOf(j.everyMs);
      const times = j.everyMs > 0 ? Math.floor((spanDays * DAY_MS) / j.everyMs) : 0;
      const runsInSpan = roughly(times);
      return {
        name: j.name,
        cadence,
        runsInSpan,
        note: `Asks ${cadence}, so about ${runsInSpan} times across this span.`,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  // Every refusal, once each, in the order they first appeared.
  const seen = new Set<string>();
  const refusals: Finding[] = [];
  for (const f of [...runFindings, ...turns.flatMap((t) => t.findings)]) {
    if (f.outcome !== "refused" || seen.has(f.sentence)) continue;
    seen.add(f.sentence);
    refusals.push(f);
  }

  return {
    ranAt: new Date().toISOString(),
    moons,
    spanDays: Math.round(spanDays),
    firstCycle,
    lastCycle: firstCycle + moons - 1,
    gameStarted: snapshot.gameStarted,
    isolation:
      "This run wrote nothing. It read your settings and worked out what each moon would do, " +
      "so no balance moved, no recognition was recorded, and nothing was issued.",
    turns,
    runFindings,
    allowances: allowanceTable(feedOff),
    jobs,
    refusals,
    covered: [
      "The moon settlement: which rules pay, to how many seat holders, and how much.",
      "Queued dial changes, and the moon each one lands in.",
      "Claims Week, and whether one opens inside the span you ran.",
      "The giving allowance and the per-person share, at every stage of the path.",
      "The value pool a cycle close would release.",
      "The background jobs, their cadence, and which ones sit out while a module is off.",
    ],
    notCovered: [
      "Real sending. Nothing was given, so this cannot tell you what a specific member would meet on a specific day.",
      "The ledger itself. This works out what the rules would pay, and it does not post to the ledger or read balances back.",
      "Quests, gatherings, badges and seasons. Their timing is driven by what people do, and a run with nobody in it has nothing to drive.",
      "Anything a background job does. The jobs are listed and counted here, and none of them was run.",
      "Third party services. Nothing was sent to Hypha, Resend, or any other outside service.",
    ],
  };
}
