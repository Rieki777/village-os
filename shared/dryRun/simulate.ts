/**
 * THE ENGINE: run the village forward twice, once with the decision and once
 * without it, and say where the two end up different.
 *
 * ── THE CARDINAL RULE, STATED AS AN IMPORT GRAPH ───────────────────────────
 *
 * `simulate` takes plain data and has no path to a connection. That is not a
 * promise in this comment. `simulate.test.ts` walks this module's import graph
 * from disk and fails if anything under `server/db`, `server/repos` or the
 * `mysql2` package is reachable from here. A preview that could write would be
 * a way to change the world by asking a question.
 *
 * The only import with any weight is `shared/cycleClock.ts`, and it is here so
 * the instants a preview shows are the village's real cycle boundaries. It
 * carries a checked-in table of new moons and touches nothing else.
 *
 * ── THE TWO PASSES ─────────────────────────────────────────────────────────
 *
 * BASELINE runs the same snapshot forward with no changes at all. PROPOSED
 * runs it forward with the change set applied at its stated timing. The diff
 * is between the two final states, so what a member reads is the difference
 * this decision makes and never the difference a cycle makes.
 *
 * Both passes start their own generator from the same seed, so the randomness
 * is identical between them and any difference in the answer belongs to the
 * decision.
 *
 * ── WHEN A CHANGE LANDS, AND WHEN IT GOES AWAY ─────────────────────────────
 *
 * `at_acceptance` is applied to the initial state, before cycle 1 steps.
 * `next_moon` is applied at the start of cycle 1, which is the village's next
 * boundary from the snapshot instant. Both are therefore in force for the
 * whole of cycle 1, and the landing cycle recorded for each says which door
 * it came through.
 *
 * `expiresAfterCycles: N` schedules a reversion at the start of cycle 1 + N,
 * counting the term from the first cycle the change is in force. The
 * reversion restores the captured previous value ONLY while the current value
 * still equals what the change wrote. A later decision on the same key
 * therefore stands, and the run says out loud that the reversion was declined
 * instead of quietly undoing somebody else's vote.
 *
 * ── ORDER, AND WHY IT IS FIXED ─────────────────────────────────────────────
 *
 * Per cycle: the governance model steps first, then every other model in the
 * order the caller gave, then flags from every model, then invariants from
 * every model. Governance goes first because a landing changes the dials the
 * economics of that same cycle runs under, and a cycle that paid out under
 * last cycle's rules and then applied this cycle's vote would preview a
 * village nobody is living in.
 *
 * The proposed pass STOPS at the first cycle any model reports a violation
 * in, and the violation carries that cycle. A run that carried on past a
 * broken invariant would be reporting numbers derived from a state the build
 * has already said cannot exist.
 *
 * ── THE ENGINE OWNS THE CLOCK ──────────────────────────────────────────────
 *
 * `state.atIso` is stamped by `runPass` at the top of every cycle and stamped
 * again once every model has stepped, so a recorded cycle's instant is always
 * that cycle's START and a model cannot advance the run. Two models each
 * advancing the clock would advance it twice, and the fallback that computes
 * the instant after the LAST cycle takes the cycle's own start as an argument
 * and never reads it back off the state, so it cannot compound a write
 * either. The clock belongs to the engine and to nothing else.
 *
 * ── ASSUMPTIONS PASS THROUGH, AND THE ENGINE READS NONE OF THEM ────────────
 *
 * `input.assumptions` is the one place an assumption about activity lives
 * (see the header of `types.ts`). This file carries it onto every state so a
 * model's `step` and `flags` can reach it, and echoes it on the result beside
 * the seed. It never reads a key, never copies the object and never invents a
 * default: both passes are handed the same object the caller wrote, so the
 * baseline and the proposed run under identical assumptions and the only
 * difference between them is still the decision.
 */
import { clockFor, type ClockMode } from "../cycleClock";
import { makeRng } from "./rng";
import type {
  CycleResult,
  Diff,
  DomainModel,
  Flag,
  MemberSpec,
  MintRuleSpec,
  ProposedChange,
  SimInput,
  SimResult,
  SimState,
  VillageSnapshot,
  Violation,
} from "./types";

/** Where a change writes, and where the diff reads. One spelling for both. */
const ROOTS = ["variables", "modules", "mintRules", "members", "balances"] as const;
type PathRoot = (typeof ROOTS)[number];

interface ParsedPath {
  root: PathRoot;
  /** The key, the module id, the rule id, the member id or the account id. */
  a: string;
  /** The field, the token slug, or empty where the root takes only one part. */
  b: string;
}

/** What a change did when it landed, and what it would take back. */
interface Landing {
  path: string;
  /** What stood there before, `undefined` when nothing stood there at all. */
  previous: unknown;
  /**
   * The text as it stood before, for a landing on one of the two mint rule
   * fields the ledger stores as `decimal(18,4)`, and undefined for every
   * other path. A reversion that restored the rounded bigint alone would hand
   * back a rule whose text had lost the four places the column keeps, so the
   * term would silently edit the rule it was supposed to put back.
   */
  previousRaw?: string;
  /** What this change wrote, already coerced to the shape the path holds. */
  wrote: unknown;
  /** 0 for `at_acceptance`, 1 for `next_moon`. */
  landedAtCycle: number;
  /** The cycle the term runs out at the start of, or null for no term. */
  revertAtCycle: number | null;
}

interface PassOutcome {
  results: CycleResult[];
  flags: Flag[];
  violations: Violation[];
  final: SimState;
}

/**
 * Run the change set forward against a baseline of the same snapshot.
 *
 * Pure. It writes nothing, reads nothing outside its arguments, and mutates
 * neither the snapshot nor the change set it is handed.
 */
export function simulate(input: SimInput, models: DomainModel[]): SimResult {
  const seed = Number(input.seed) || 0;
  const cycles = Math.max(0, Math.trunc(Number(input.cycles) || 0));
  const order = orderedModels(models);
  const starts = cycleStarts(input.snapshot, cycles);
  if (!starts) {
    return {
      baseline: [],
      proposed: [],
      diff: [],
      flags: [
        {
          code: "snapshot_unreadable",
          severity: "danger",
          cycle: 0,
          sentence: `This village's snapshot is stamped ${String(input.snapshot.atIso)}, which is not an instant this build can read.`,
          actionable: "Take the snapshot again. Nothing was simulated.",
        },
      ],
      violations: [
        {
          invariant: "snapshot.readable",
          cycle: 0,
          detail: `atIso was ${JSON.stringify(input.snapshot.atIso)} and did not parse as a date.`,
        },
      ],
      seed,
      // Echoed even here. A result that cannot say what it assumed is not a
      // result somebody can check, and a refusal is still an answer.
      assumptions: input.assumptions,
    };
  }

  const assumptions = input.assumptions;
  const baseline = runPass(input.snapshot, [], cycles, starts, order, seed, assumptions);
  const proposed = runPass(input.snapshot, input.changes ?? [], cycles, starts, order, seed, assumptions);
  return {
    baseline: baseline.results,
    proposed: proposed.results,
    diff: diffOf(baseline.final, proposed.final, cycles),
    flags: proposed.flags,
    violations: proposed.violations,
    seed,
    assumptions,
  };
}

/** Governance first, then everybody else in the order the caller gave. */
export function orderedModels(models: DomainModel[]): DomainModel[] {
  const list = Array.isArray(models) ? models.slice() : [];
  const governance = list.filter((m) => m && m.name === "governance");
  const rest = list.filter((m) => m && m.name !== "governance");
  return governance.concat(rest);
}

/**
 * The instant each cycle begins. Cycle 1 begins at the snapshot instant, which
 * is usually inside a cycle already, and every cycle after it begins at the
 * village's own next boundary. Null means the snapshot instant did not parse.
 */
function cycleStarts(snapshot: VillageSnapshot, cycles: number): string[] | null {
  const first = new Date(String(snapshot.atIso));
  if (Number.isNaN(first.getTime())) return null;
  const clock = clockFor(snapshot.clock ? snapshot.clock.mode : "lunar");
  const out: string[] = [];
  let at = first;
  for (let i = 0; i < cycles; i += 1) {
    out.push(at.toISOString());
    at = clock.nextBoundaryAfter(at);
  }
  return out;
}

function runPass(
  snapshot: VillageSnapshot,
  changes: readonly ProposedChange[],
  cycles: number,
  starts: readonly string[],
  order: readonly DomainModel[],
  seed: number,
  assumptions: Readonly<Record<string, unknown>> | undefined,
): PassOutcome {
  const rng = makeRng(seed);
  const flags: Flag[] = [];
  const violations: Violation[] = [];
  const results: CycleResult[] = [];
  const landings: Landing[] = [];
  let state = initialState(snapshot, assumptions);

  const land = (change: ProposedChange, cycle: number): void => {
    const path = pathOf(change);
    if (!path) {
      flags.push({
        code: "change_not_previewed",
        severity: "warning",
        cycle,
        sentence: `One element of this set changes ${describeKind(change)}, and the preview holds no copy of that to run forward.`,
        actionable: "Read this element on the proposal itself. Everything else in the set is previewed below.",
      });
      return;
    }
    const wrote = coerce(path, change.to);
    if (wrote === REFUSED) {
      flags.push({
        code: "change_not_previewed",
        severity: "warning",
        cycle,
        sentence: `One element of this set writes ${path.root}/${path.a}${path.b ? `/${path.b}` : ""}, which the preview holds no copy of.`,
        actionable: "Read this element on the proposal itself. Everything else in the set is previewed below.",
      });
      return;
    }
    const previous = readPath(state, path);
    const previousRaw = rawBefore(state, path);
    state = writePath(state, path, wrote, rawTextOf(path, change.to));
    const term = termOf(change.expiresAfterCycles);
    landings.push({
      path: spell(path),
      previous,
      previousRaw,
      wrote,
      landedAtCycle: cycle,
      // The term counts from the first cycle the change is in force, which is
      // cycle 1 whichever door it came through, so two elements of one set
      // with the same term expire together.
      revertAtCycle: term === null ? null : 1 + term,
    });
    state = {
      ...state,
      governance: { ...state.governance, landedPaths: state.governance.landedPaths.concat(spell(path)) },
    };
  };

  for (const change of changes) {
    if (change && change.timing === "at_acceptance") land(change, 0);
  }

  for (let cycle = 1; cycle <= cycles; cycle += 1) {
    const atIso = starts[cycle - 1];
    state = { ...state, cycle, atIso };

    if (cycle === 1) {
      for (const change of changes) {
        if (change && change.timing !== "at_acceptance") land(change, 1);
      }
    }

    for (const landing of landings) {
      if (landing.revertAtCycle !== cycle) continue;
      const path = parsePath(landing.path);
      if (!path) continue;
      const standing = readPath(state, path);
      if (!sameValue(standing, landing.wrote)) {
        flags.push({
          code: "term_reversion_declined",
          severity: "notice",
          cycle,
          sentence: `The term on ${landing.path} ran out this cycle and it was left where it stands, because something else has changed it since.`,
          actionable: "Nothing to do. A later decision on the same setting stands.",
        });
        continue;
      }
      state = writePath(state, path, landing.previous, landing.previousRaw);
      state = {
        ...state,
        governance: { ...state.governance, revertedPaths: state.governance.revertedPaths.concat(landing.path) },
      };
      flags.push({
        code: "term_reverted",
        severity: "notice",
        cycle,
        sentence: `The term on ${landing.path} ran out this cycle and it went back to ${show(landing.previous)}.`,
        actionable: "Propose it again if the village wants to keep it.",
      });
    }

    for (const model of order) state = model.step(state, cycle, rng);

    // THE ENGINE OWNS THE CLOCK. A model may return any state it likes, and
    // one that advanced `atIso` itself would advance the run twice: once here
    // and once at the bottom of the loop. So the cycle's own start is stamped
    // back on before anything is recorded, and a model's write is discarded
    // and never compounded. `cycle` is re-stamped for the same reason.
    state = { ...state, cycle, atIso };

    const cycleFlags: Flag[] = [];
    for (const model of order) {
      for (const flag of model.flags(state, cycle) ?? []) cycleFlags.push({ ...flag, cycle });
    }
    const cycleViolations: Violation[] = [];
    for (const model of order) {
      for (const v of model.invariants(state) ?? []) cycleViolations.push({ ...v, cycle });
    }

    for (const f of cycleFlags) flags.push(f);
    for (const v of cycleViolations) violations.push(v);
    results.push({ cycle, atIso, state: cloneState(state), flags: cycleFlags, violations: cycleViolations });
    if (cycleViolations.length > 0) break;

    state = { ...state, atIso: nextStart(starts, cycle, atIso, state.clock ? state.clock.mode : "lunar") };
  }

  return { results, flags, violations, final: state };
}

/**
 * Where cycle `cycle + 1` begins.
 *
 * The last cycle has no entry in `starts`, so its successor is computed from
 * the clock. It is computed from `thisCycleStart`, which the caller holds,
 * and NOT from `state.atIso`: a model that wrote `atIso` would otherwise be
 * advancing the run a second time through this fallback, and the final state
 * would sit one whole cycle past where the run ended. The re-stamp above
 * already discards such a write; taking the instant as an argument means this
 * function cannot be wrong even if that re-stamp is ever moved.
 */
function nextStart(starts: readonly string[], cycle: number, thisCycleStart: string, mode: ClockMode): string {
  const known = starts[cycle];
  if (known) return known;
  const clock = clockFor(mode);
  return clock.nextBoundaryAfter(new Date(thisCycleStart)).toISOString();
}

/**
 * THE TWO MINT RULE FIELDS THE LEDGER STORES AS `decimal(18,4)`, each named
 * beside the text twin that carries what the rounding drops.
 *
 * Declared as one table so the two are handled identically and a third
 * decimal field is one line. Handling them case by case is how they drift:
 * the amount would keep its text while a cap typed below the token's own
 * resolution reached a model as a flat zero, with nothing to tell it from a
 * cap of nothing.
 */
const RAW_TWIN: Readonly<Record<string, "amountRaw" | "ceilingRaw">> = {
  amount: "amountRaw",
  ceiling: "ceilingRaw",
};

/** The twin a path writes to, or null when the path has none. */
function twinOf(path: ParsedPath): "amountRaw" | "ceilingRaw" | null {
  if (path.root !== "mintRules") return null;
  return RAW_TWIN[path.b] ?? null;
}

/**
 * The text as it stands right now, for a landing to hand back when its term
 * runs out. Undefined for every path with no text twin, which is how
 * `writePath` knows to leave both twins alone.
 */
function rawBefore(state: SimState, path: ParsedPath): string | undefined {
  const twin = twinOf(path);
  if (!twin) return undefined;
  const rule = state.mintRules.find((r) => r.id === path.a);
  return rule ? rule[twin] : undefined;
}

/**
 * A change's `to` as the `decimal(18,4)` column would hold it, unrounded.
 *
 * This is the one place the four decimal places survive. `coerce` truncates
 * to minor units because that is what a balance is, and the truncation is why
 * the text has to be kept beside the number instead of derived back from it.
 */
function rawTextOf(path: ParsedPath, to: unknown): string | undefined {
  if (!twinOf(path)) return undefined;
  if (to === undefined || to === null) return "";
  const text = String(to).trim();
  return text === "from-source" ? "" : text;
}

/** The whole positive term a change asks for, or null when it asks for none. */
function termOf(raw: unknown): number | null {
  const n = Math.trunc(Number(raw));
  return Number.isFinite(n) && n > 0 ? n : null;
}

// ── State ───────────────────────────────────────────────────────────────────

/**
 * The snapshot as a state, deep copied, so the caller's data is never moved.
 *
 * `assumptions` is the one thing NOT copied. It is carried by reference, on
 * purpose: what a model reads and what the result echoes have to be the same
 * object, or the echo is a claim about a copy and a reader checking the
 * answer against it is checking the wrong thing.
 */
export function initialState(
  snapshot: VillageSnapshot,
  assumptions?: Readonly<Record<string, unknown>>,
): SimState {
  const quests = snapshot.quests;
  return {
    atIso: String(snapshot.atIso),
    cycle: 0,
    launched: snapshot.launched === true,
    quests: {
      open: Number(quests ? quests.open : 0) || 0,
      confirmedPerCycle: Number(quests ? quests.confirmedPerCycle : 0) || 0,
      gratitudePerConfirmation: quests && typeof quests.gratitudePerConfirmation === "bigint" ? quests.gratitudePerConfirmation : BigInt(0),
    },
    clock: { mode: snapshot.clock ? snapshot.clock.mode : "lunar", timezone: snapshot.clock ? snapshot.clock.timezone : "UTC" },
    tokens: (snapshot.tokens ?? []).map((t) => ({ ...t, sinks: (t.sinks ?? []).slice() })),
    balances: cloneBalances(snapshot.balances ?? {}),
    mintRules: (snapshot.mintRules ?? []).map((r) => ({ ...r })),
    variables: { ...(snapshot.variables ?? {}) },
    members: (snapshot.members ?? []).map((m) => ({ ...m, seats: (m.seats ?? []).slice() })),
    modules: { ...(snapshot.modules ?? {}) },
    governance: { cyclesElapsed: 0, landedPaths: [], revertedPaths: [] },
    models: {},
    assumptions,
  };
}

/** A whole copy, so a recorded cycle cannot be rewritten by a later one. */
export function cloneState(state: SimState): SimState {
  return {
    atIso: state.atIso,
    cycle: state.cycle,
    launched: state.launched,
    quests: { ...state.quests },
    clock: { ...state.clock },
    tokens: state.tokens.map((t) => ({ ...t, sinks: t.sinks.slice() })),
    balances: cloneBalances(state.balances),
    mintRules: state.mintRules.map((r) => ({ ...r })),
    variables: { ...state.variables },
    members: state.members.map((m) => ({ ...m, seats: m.seats.slice() })),
    modules: { ...state.modules },
    governance: {
      cyclesElapsed: state.governance.cyclesElapsed,
      landedPaths: state.governance.landedPaths.slice(),
      revertedPaths: state.governance.revertedPaths.slice(),
    },
    // Shallow, because the values are `unknown` and cannot be copied without
    // knowing their shape. The bag itself IS copied, so a key a later cycle
    // adds cannot appear in a cycle already recorded.
    models: { ...state.models },
    // Carried, not copied, for the reason `initialState` gives: every
    // recorded cycle holds the same assumptions object the caller wrote.
    assumptions: state.assumptions,
  };
}

function cloneBalances(source: Record<string, Record<string, bigint>>): Record<string, Record<string, bigint>> {
  const out: Record<string, Record<string, bigint>> = {};
  for (const account of Object.keys(source)) {
    const inner: Record<string, bigint> = {};
    const from = source[account] ?? {};
    for (const slug of Object.keys(from)) inner[slug] = from[slug];
    out[account] = inner;
  }
  return out;
}

// ── Paths ───────────────────────────────────────────────────────────────────

/** The path a change writes, or null when the preview holds no copy of it. */
export function pathOf(change: ProposedChange): ParsedPath | null {
  const key = String(change.key ?? "").trim();
  if (!key) return null;
  switch (change.kind) {
    case "dial":
    case "mode_switch":
      return { root: "variables", a: key, b: "" };
    case "module_lifecycle":
      return { root: "modules", a: key, b: "" };
    case "weight_allocation":
      return { root: "members", a: key, b: "weight" };
    case "mint_rule": {
      // `mint:<ruleId>:<field>`, the spelling `shared/mintRuleKeys.ts` fixed.
      const parts = key.split(":");
      if (parts.length !== 3 || parts[0] !== "mint") return null;
      return { root: "mintRules", a: parts[1], b: parts[2] };
    }
    default:
      // `brand_field` and `role` change things the snapshot holds no copy of.
      // Saying so is the honest answer; running them forward as nothing would
      // preview a decision as having no effect.
      return null;
  }
}

/** A path as one string, which is the spelling a Diff and a Flag carry. */
export function spell(path: ParsedPath): string {
  return path.b ? `${path.root}/${path.a}/${path.b}` : `${path.root}/${path.a}`;
}

function parsePath(path: string): ParsedPath | null {
  const parts = String(path).split("/");
  const root = parts[0] as PathRoot;
  if ((ROOTS as readonly string[]).indexOf(root) < 0) return null;
  if (parts.length === 2) return { root, a: parts[1], b: "" };
  if (parts.length === 3) return { root, a: parts[1], b: parts[2] };
  return null;
}

function readPath(state: SimState, path: ParsedPath): unknown {
  switch (path.root) {
    case "variables":
      return state.variables[path.a];
    case "modules":
      return state.modules[path.a];
    case "mintRules": {
      const rule = state.mintRules.find((r) => r.id === path.a);
      return rule ? (rule as unknown as Record<string, unknown>)[path.b] : undefined;
    }
    case "members": {
      const member = state.members.find((m) => m.id === path.a);
      return member ? member.weight : undefined;
    }
    default: {
      const account = state.balances[path.a];
      return account ? account[path.b] : undefined;
    }
  }
}

/**
 * Write one path, returning a new state.
 *
 * `raw` is the change's own text for the value, carried for the two mint rule
 * fields the ledger stores as `decimal(18,4)` and the simulation holds twice.
 * See the `mintRules` case below.
 */
function writePath(state: SimState, path: ParsedPath, value: unknown, raw?: string): SimState {
  const next: SimState = { ...state };
  switch (path.root) {
    case "variables": {
      next.variables = { ...state.variables };
      if (value === undefined) delete next.variables[path.a];
      else next.variables[path.a] = String(value);
      return next;
    }
    case "modules": {
      next.modules = { ...state.modules };
      if (value === undefined) delete next.modules[path.a];
      else next.modules[path.a] = value as SimState["modules"][string];
      return next;
    }
    case "mintRules": {
      // A number and its text twin are two spellings of one fact and they
      // move TOGETHER or the rounds-away flag lies: a rule retuned to 0.0004
      // would otherwise keep the snapshot's old text beside a fresh 0, and a
      // model comparing them would report a rounding that belongs to a value
      // nobody proposed. The caller hands the text; where it hands none, the
      // written number is its own text.
      const twin = twinOf(path);
      const pair: Partial<MintRuleSpec> = twin
        ? ({ [path.b]: value, [twin]: raw ?? (value === undefined ? "" : String(value)) } as Partial<MintRuleSpec>)
        : ({ [path.b]: value } as Partial<MintRuleSpec>);
      next.mintRules = state.mintRules.map((r) => (r.id === path.a ? ({ ...r, ...pair } as MintRuleSpec) : r));
      return next;
    }
    case "members": {
      next.members = state.members.map((m) =>
        m.id === path.a ? ({ ...m, weight: value === undefined ? undefined : Number(value) } as MemberSpec) : m,
      );
      return next;
    }
    default: {
      next.balances = cloneBalances(state.balances);
      const account = next.balances[path.a] ?? {};
      if (value === undefined) delete account[path.b];
      else account[path.b] = value as bigint;
      next.balances[path.a] = account;
      return next;
    }
  }
}

/** The answer `coerce` gives for a field the preview holds no copy of. */
const REFUSED = Symbol("refused");

/** A change's `to`, in the shape the path it writes actually holds. */
function coerce(path: ParsedPath, to: unknown): unknown {
  if (to === undefined || to === null) return undefined;
  switch (path.root) {
    case "variables":
    case "modules":
      return String(to);
    case "members":
      return Number(to);
    case "balances":
      return typeof to === "bigint" ? to : BigInt(Math.trunc(Number(to) || 0));
    default: {
      if (path.b === "enabled") return to === true || String(to) === "true" || String(to) === "1";
      if (path.b === "amount" || path.b === "ceiling") {
        if (typeof to === "bigint") return to;
        const text = String(to).trim();
        if (text === "from-source") return undefined;
        const n = Math.trunc(Number(text));
        return Number.isFinite(n) ? BigInt(n) : REFUSED;
      }
      return REFUSED;
    }
  }
}

/** Whether two values at a path are the same value, bigints included. */
function sameValue(a: unknown, b: unknown): boolean {
  if (typeof a === "bigint" || typeof b === "bigint") {
    if (a === undefined || b === undefined) return a === b;
    return String(a) === String(b);
  }
  if (a === undefined || b === undefined) return a === b;
  return String(a) === String(b);
}

/** A value as a member reads it. */
function show(value: unknown): string {
  return value === undefined || value === null ? "nothing" : String(value);
}

function describeKind(change: ProposedChange): string {
  const key = String(change.key ?? "").trim();
  const kind = String(change.kind ?? "something");
  return key ? `${kind} ${key}` : kind;
}

// ── The diff ────────────────────────────────────────────────────────────────

/**
 * Where the two final states differ, over the variables and the balances.
 *
 * Sorted by path, so the same input answers the same list in the same order.
 * A surface that reordered between two runs of one preview would read as a
 * change nobody made.
 */
export function diffOf(baseline: SimState, proposed: SimState, cycles: number): Diff[] {
  const out: Diff[] = [];
  const span = cycles === 1 ? "1 cycle" : `${cycles} cycles`;

  for (const key of unionKeys(baseline.variables, proposed.variables)) {
    const was = baseline.variables[key];
    const now = proposed.variables[key];
    if (sameValue(was, now)) continue;
    out.push({
      path: `variables/${key}`,
      baseline: show(was),
      proposed: show(now),
      sentence: `After ${span}, ${key} would read ${show(now)}. With nothing decided it would read ${show(was)}.`,
    });
  }

  for (const account of unionKeys(baseline.balances, proposed.balances)) {
    const was = baseline.balances[account] ?? {};
    const now = proposed.balances[account] ?? {};
    for (const slug of unionKeys(was, now)) {
      const before = was[slug];
      const after = now[slug];
      if (sameValue(before, after)) continue;
      out.push({
        path: `balances/${account}/${slug}`,
        baseline: show(before),
        proposed: show(after),
        sentence: `After ${span}, ${account} would hold ${show(after)} ${slug} in minor units. With nothing decided it would hold ${show(before)}.`,
      });
    }
  }

  out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return out;
}

function unionKeys(a: Record<string, unknown>, b: Record<string, unknown>): string[] {
  const seen: Record<string, true> = {};
  for (const k of Object.keys(a ?? {})) seen[k] = true;
  for (const k of Object.keys(b ?? {})) seen[k] = true;
  return Object.keys(seen).sort();
}
