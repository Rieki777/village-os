/**
 * THE SHARED DRY RUN'S CONTRACT: plain data, and nothing that can reach a
 * database.
 *
 * ── WHY THIS FILE LIVES IN shared/ ─────────────────────────────────────────
 *
 * Section 22 of the governance prompt made the dry run shared between two
 * builds. The governance session owns the engine and the model of what a
 * ballot does to power; the economics session owns the model of what a cycle
 * does to balances. Both import these types, the client imports them to
 * render a preview, and the server imports them to take the snapshot. A type
 * that four callers share has to sit where all four can reach it, and
 * `shared/` is that place.
 *
 * ── THE CARDINAL RULE, AND WHY IT IS STRUCTURAL ────────────────────────────
 *
 * A preview that can write is a way to change the world by asking a question.
 * The rule that stops it is not a promise in a comment, it is the import
 * graph: nothing in `shared/dryRun/` imports anything under `server/`, and
 * `shared/dryRun/simulate.test.ts` walks the graph and fails if that ever
 * stops being true. Every type here is therefore plain data. The snapshot is
 * read ONCE by a governance-owned reader that opens a read-only connection,
 * and from that instant on the simulation holds objects and never a handle.
 *
 * ── MINOR UNITS, AND WHY BALANCES ARE bigint ───────────────────────────────
 *
 * `TokenDef.decimals` says how many places a token DISPLAYS, and the ledger
 * stores integers only. So every amount in here is in minor units, and every
 * amount is a `bigint`: a simulation that runs twenty cycles of compounding
 * mint rules through IEEE doubles produces a number that is close, and a
 * preview of somebody's money that is close is worse than no preview. Use
 * `BigInt("...")` to write one, never a `123n` literal, because the build
 * target refuses those (CLAUDE.md, House traps).
 *
 * ── WHAT THIS FILE MAY IMPORT, AND WHY IT IS ALMOST NOTHING ────────────────
 *
 * The economics session builds its model on a branch cut from `main`, and the
 * governance vocabulary this file used to borrow does not exist there yet.
 * A contract that only compiles beside its author is not a shared contract.
 * So `types.ts` names ONE other file, `shared/cycleClock.ts`, and every other
 * vocabulary it needs is declared here as a `const` list with the type read
 * off it. `rng.ts` and `simulate.ts` hold to the same rule.
 *
 * A copied list can drift from the list it copied, so neither copy is left to
 * a comment: `types.test.ts` imports the engine's own arrays and fails the
 * moment the members stop matching, and the same test reads every file in
 * this directory off disk and fails if one of them starts naming the engine.
 *
 * ── WHERE ACTIVITY ASSUMPTIONS LIVE ────────────────────────────────────────
 *
 * `SimInput.assumptions` is the ONE place an assumption about activity lives.
 * How many quests a cycle completes, how many members show up, what an
 * average payout looks like: every number a model invents about how busy the
 * village will be is a key under here and is nowhere else in the build.
 *
 * It is keyed by model name, so `assumptions.economics` is the economics
 * model's to define and `assumptions.governance` is the governance model's,
 * and neither reads the other's. The engine itself reads none of it. It
 * carries the object onto `SimState` so `step` and `flags` can reach it, and
 * echoes it on `SimResult` beside the seed.
 *
 * That echo is the point. The seed makes a run repeatable; the assumptions
 * make it legible. A preview that says a village runs out of Voice in cycle
 * nine is worth nothing unless the reader can see the activity that answer
 * assumed, and a number buried in a model's own constants can be neither read
 * back nor argued with. Same object in, same object out: the engine never
 * copies it, never edits it, and never invents a default for it.
 */
import type { ClockMode, ProposalTiming } from "../cycleClock";

/**
 * The vocabularies a change set is written in. This file declares them and
 * imports none of them, so it compiles against a branch that has no
 * governance engine on it. `types.test.ts` proves these members equal
 * `CHANGE_ITEM_KINDS` in `shared/ballotSubjects.ts`.
 */
export const CHANGE_ITEM_KINDS = [
  "dial",
  "mint_rule",
  "weight_allocation",
  "mode_switch",
  "module_lifecycle",
  "brand_field",
  "role",
] as const;

/** Which vocabulary one element of a change set is written in. */
export type ChangeItemKind = (typeof CHANGE_ITEM_KINDS)[number];

/**
 * A module's openness, spelled the one way `shared/modules.ts` spells it and
 * declared here for the same reason as the kinds above. `types.test.ts`
 * proves these members equal the keys of `LIFECYCLE_RANK`.
 */
export const LIFECYCLES = ["off", "preview", "members", "public"] as const;

/** How open one module is. */
export type Lifecycle = (typeof LIFECYCLES)[number];

/** Which clock the village keeps time by, and the zone its dates render in. */
export interface CycleClockSpec {
  /** `lunar` or `calendar`, read from `cycle.mode`. */
  mode: ClockMode;
  /** The village's IANA zone. The arithmetic is UTC; this is for rendering. */
  timezone: string;
}

/**
 * Who mints a token. `platform` means this ledger issues and moves it;
 * `hypha` means the village holds a read-only mirror of a token governed
 * somewhere else. Declared here and imported from nowhere: nothing
 * in this directory may name anything under `server/`, and `types.test.ts`
 * proves that from disk.
 */
export const TOKEN_GOVERNANCES = ["platform", "hypha"] as const;

/** Where a token is governed. */
export type TokenGovernance = (typeof TOKEN_GOVERNANCES)[number];

/**
 * One token as the simulation needs it, copied from the ledger's registry.
 *
 * `governance`, `active` and `faucet` are the three facts behind three of the
 * four refusals `ruleCannotPay` makes in `server/lib/economy.ts`, and the
 * fourth is a slug that is not in `tokens` at all. They are here so a model
 * can mirror all four and a preview never promises a payout the engine would
 * refuse. A preview that multiplies an unpayable rule by the seat count and
 * prints the total is the exact defect `ruleCannotPay` was written to end.
 */
export interface TokenSpec {
  /** The ledger's identifier for this token. */
  slug: string;
  /** The levers taxonomy: recognition, equity, voice or credit. */
  kind: string;
  /** How many places it displays. Every amount here is in minor units. */
  decimals: number;
  /** The account this token is issued from, when it has one. */
  faucet: string | null;
  /** The accounts this token drains into, such as dues and burns. */
  sinks: string[];
  /** `platform` if this village issues it, `hypha` if it only mirrors it. */
  governance: TokenGovernance;
  /** False when the token has been retired from the registry. */
  active: boolean;
}

/**
 * One minting rule as the simulation needs it, copied from `mint_rules`.
 *
 * ── WHY BOTH NUMBERS ARE HERE TWICE ────────────────────────────────────────
 *
 * `mint_rules.amount` and `mint_rules.ceiling` are both `decimal(18,4)`
 * (drizzle/0071), and a token with `decimals: 0` turns 0.0004 into 0 minor
 * units. So the rounded number alone cannot tell a field that was SET to
 * nothing from a field that ROUNDED AWAY to nothing, and those are different
 * facts about a village.
 *
 * For the amount, one is a decision and the other is a rule that quietly pays
 * nobody. For the ceiling it is worse: a cap typed below the token's own
 * resolution arrives as 0 and reads as refuse everything, where the engine
 * would clamp. A preview that turned a fat-fingered cap into a total stop
 * would be reporting a village nobody voted for.
 *
 * `amountRaw` and `ceilingRaw` are the columns' own text, unrounded and
 * unparsed. A model that wants to say "this rounds away to nothing" compares
 * the pair and is exact, instead of inferring from a zero that has two
 * causes. `simulate.ts` writes each pair atomically, so a change set can
 * never leave one of them stale beside the other.
 */
export interface MintRuleSpec {
  /** The row's id, which is what a `mint:<id>:<field>` change key names. */
  id: string;
  /** What fires it, such as `quest.completed`, in the dotted spelling. */
  trigger: string;
  /** Which token it mints. */
  tokenSlug: string;
  /** Who receives the mint. */
  recipient: string;
  /** How much, in minor units, or null when the amount rides on the source. */
  amount: bigint | null;
  /**
   * The `decimal(18,4)` text exactly as the column holds it, such as
   * `"0.0004"`. Empty string when the column is NULL, which is the same fact
   * `amount: null` states and is spelled this way so the field is never
   * absent. This is the ONLY unrounded copy of the amount in the simulation.
   */
  amountRaw: string;
  /** The most it may mint in one cycle, in minor units, or null for no cap. */
  ceiling: bigint | null;
  /**
   * The ceiling's `decimal(18,4)` text, on the same terms as `amountRaw` and
   * empty string for no cap. It carries more weight than its twin: a cap of
   * `"0.0004"` on a token with no decimals reaches a model as `BigInt(0)`,
   * which is the same value a cap of "let nothing through" carries. The text
   * is what tells those two apart, and it is the ONLY unrounded copy of the
   * ceiling in the simulation.
   */
  ceilingRaw: string;
  /** Whether it fires at all. */
  enabled: boolean;
}

/** One member of the roll, as the governance model counts them. */
export interface MemberSpec {
  /** The member's user id. */
  id: string;
  /** The ledger account their balances are keyed by, which is `mem:<id>`. */
  accountId: string;
  /**
   * How far along the member's journey is, as a `GAME_CONFIG.stages` id such
   * as `member` or `contributor`. It is a plain string and not a union
   * because a fork edits that list, so a closed union here would refuse a
   * village its own stages.
   */
  stage: string;
  /** The seat ids this member holds. */
  seats: string[];
  /** True when this member votes on somebody else's behalf. */
  isRepresentative?: boolean;
  /** The seat they represent, when they represent one. */
  representsSeatId?: string;
  /**
   * The custom-mode allocation, read only when `governance.weight_mode` is
   * `custom`. Absent is zero, which is how `weightsFor` already fails closed:
   * nobody holds power an admin never assigned.
   */
  weight?: number;
  /**
   * True when this member cannot answer a ballot opened today, because they
   * have died, left or simply stopped playing. The reachability flag counts
   * these out of the weight that can vote, which is the arithmetic behind the
   * stalemate the founder stopped at 97 to avoid.
   */
  absent?: boolean;
}

/**
 * WHAT THE VILLAGE'S QUESTS ARE DOING, in the three numbers a model needs.
 *
 * Recognition is minted when a quest is confirmed, so a model that projects
 * recognition forward has to know how often that happens and how much it
 * pays. This is the minimal shape that answers both, and it holds three
 * numbers and no list of quests, because a preview is arithmetic on a rate
 * and never a re-simulation of somebody's to-do list.
 *
 * All three are OBSERVED, read off the tables at the snapshot instant. They
 * are not assumptions and they do not belong in `SimInput.assumptions`. A
 * model that wants to project a DIFFERENT rate multiplies these by something
 * out of `assumptions`, and the result then says both the observation it
 * started from and the assumption it applied.
 */
export interface QuestsSummary {
  /** How many quests stand open at the snapshot instant. */
  open: number;
  /**
   * How many quests the village confirmed in the cycle before the snapshot.
   * The observed rate, which is what a flat projection repeats.
   */
  confirmedPerCycle: number;
  /**
   * What one confirmation paid on average, in minor units of the recognition
   * token. Zero when nothing was confirmed to average over.
   */
  gratitudePerConfirmation: bigint;
}

/** The village, read once and then held as plain data for the whole run. */
export interface VillageSnapshot {
  /** The instant the snapshot was taken, which is where cycle 1 begins. */
  atIso: string;
  /**
   * Whether the village's launch vote has carried. FALSE REFUSES EVERY
   * FAUCET POSTING, Voice included: `issuanceRefusal` in
   * `server/lib/gameStart.ts` turns every mint away until the Game starts
   * (R67, R74). A model that mints into a village whose `launched` is false
   * is previewing a village that cannot exist.
   */
  launched: boolean;
  /** What the village's quests are doing, observed at the snapshot instant. */
  quests: QuestsSummary;
  /** The clock the village keeps time by. */
  clock: CycleClockSpec;
  /** Every token in the village's registry. */
  tokens: TokenSpec[];
  /** Every balance, in minor units: account id, then token slug. */
  balances: Record<string, Record<string, bigint>>;
  /** Every minting rule, enabled or not. */
  mintRules: MintRuleSpec[];
  /** Every game variable that has a value, as the text the registry stores. */
  variables: Record<string, string>;
  /** Everybody who holds a voice today. */
  members: MemberSpec[];
  /** Each module's openness, keyed by module id. */
  modules: Record<string, Lifecycle>;
}

/** One element of a change set, as the preview reads it. */
export interface ProposedChange {
  /** Which vocabulary the key belongs to. */
  kind: ChangeItemKind;
  /** What it addresses: a variable key, a `mint:<id>:<field>`, a module id. */
  key?: string;
  /** What it holds today, for the sentence a member reads. */
  from?: unknown;
  /** What it would hold. */
  to?: unknown;
  /** `at_acceptance` lands before cycle 1; `next_moon` lands at cycle 1. */
  timing: ProposalTiming;
  /**
   * How many cycles the change stands for before it reverts. Absent means it
   * stands until something else changes it. A reversion restores the captured
   * previous value ONLY while the current value still equals what this change
   * wrote, so a later decision on the same key is never quietly undone.
   */
  expiresAfterCycles?: number;
}

/** Everything `simulate` needs, and it needs nothing else. */
export interface SimInput {
  /** The village, already read. */
  snapshot: VillageSnapshot;
  /** The change set being previewed. Empty is the baseline. */
  changes: ProposedChange[];
  /** How many cycles to run. */
  cycles: number;
  /** The seed, which is part of the input and is printed in the output. */
  seed: number;
  /** How many proposals a model should assume run beside this one. */
  concurrency?: number;
  /**
   * THE ONE PLACE ACTIVITY ASSUMPTIONS LIVE. See the header of this file.
   *
   * Keyed by model name: `assumptions.economics` belongs to the economics
   * model, `assumptions.governance` to the governance one. The engine reads
   * none of it, carries it onto every `SimState`, and echoes it on
   * `SimResult` beside the seed so a reader can see what the answer assumed.
   *
   * A model that wants a number about how busy the village is takes it from
   * here. It does not hold a constant of its own, because a constant cannot
   * be read back off a result and cannot be argued with.
   */
  assumptions?: Record<string, unknown>;
}

/** What the governance model keeps between cycles. */
export interface GovernanceState {
  /** How many cycles the governance model has stepped through. */
  cyclesElapsed: number;
  /** The paths a change has written, in the order they landed. */
  landedPaths: string[];
  /** The paths a term ran out on and the engine restored. */
  revertedPaths: string[];
}

/**
 * THE STATE EVERY MODEL READS AND RETURNS.
 *
 * It is the snapshot's own fields plus the two things a run accumulates: the
 * instant, which advances one cycle boundary per cycle, and the governance
 * sub-state. A model returns a NEW state and mutates nothing it was handed,
 * which is what makes the baseline pass and the proposed pass comparable.
 */
export interface SimState {
  /**
   * The instant this cycle begins.
   *
   * THE ENGINE OWNS THIS FIELD. `runPass` stamps it at the top of every cycle
   * and re-stamps it after every model has stepped, so a model that writes it
   * cannot move the clock. Advancing it is not a model's job: two models each
   * advancing by a cycle would advance the run by two, and a recorded cycle
   * would carry an instant no cycle ever began at.
   */
  atIso: string;
  /** Which cycle the state is at. Zero is before the first step. */
  cycle: number;
  /** Whether the launch vote has carried. Nothing mints while this is false. */
  launched: boolean;
  /** What the village's quests are doing, carried from the snapshot. */
  quests: QuestsSummary;
  /** The clock, carried so a model can ask what a boundary means. */
  clock: CycleClockSpec;
  /** The token registry, unchanged by any model in this build. */
  tokens: TokenSpec[];
  /** Every balance in minor units. The economics model owns every change. */
  balances: Record<string, Record<string, bigint>>;
  /** The minting rules, which a change set may retune. */
  mintRules: MintRuleSpec[];
  /** The game variables, as text. */
  variables: Record<string, string>;
  /** The roll. */
  members: MemberSpec[];
  /** Each module's openness. */
  modules: Record<string, Lifecycle>;
  /** What the governance model keeps between cycles. */
  governance: GovernanceState;
  /**
   * WHAT EACH MODEL REMEMBERS BETWEEN CYCLES, keyed by model name.
   *
   * `governance` above is the governance model's memo and predates this bag.
   * Every other model keeps its own under its own name, so the economics
   * model writes `models.economics` and reads nothing else, and two models
   * can never collide over a field name.
   *
   * The value is `unknown` on purpose: the engine does not know what a model
   * remembers and must not have an opinion about it. A model casts its own
   * entry, which is the one place the shape is known.
   *
   * `cloneState` carries this into every recorded `CycleResult.state`, so the
   * memo is readable off the result and nothing may drop it on the way. The
   * bag itself is shallow copied per record. What is inside it cannot be,
   * because `unknown` cannot be copied without knowing its shape, so a model
   * that wants its memo readable per cycle replaces its entry each cycle and
   * never edits one in place.
   */
  models: Record<string, unknown>;
  /**
   * The assumptions the run was given, carried here so `step` and `flags` can
   * read them. Read only, and the engine hands every state the SAME object it
   * was given, so a model reading `state.assumptions.economics` reads exactly
   * what the caller wrote and exactly what the result echoes. Absent when the
   * caller gave none; a model that needs one supplies its own fallback, and
   * the engine never invents a default.
   */
  readonly assumptions?: Readonly<Record<string, unknown>>;
}

/** How loud a flag is. */
export type FlagSeverity = "notice" | "warning" | "danger";

/** Something the run noticed, said in the words a member reads. */
export interface Flag {
  /** A stable identifier, so a surface can key off it without parsing prose. */
  code: string;
  /** How loud it is. */
  severity: FlagSeverity;
  /** Which cycle it was raised in. Zero means before the first step. */
  cycle: number;
  /** What happened, in one plain sentence. */
  sentence: string;
  /** What the village could do about it, or null when it is only news. */
  actionable: string | null;
}

/** A rule the run broke. The proposed pass stops at the first one. */
export interface Violation {
  /** Which rule broke, named the way the build names it. */
  invariant: string;
  /** The cycle it broke in. The engine stamps this; a model may leave it 0. */
  cycle: number;
  /** The numbers behind it, so a reader can check the arithmetic. */
  detail: string;
}

/** One difference between the baseline's final state and the proposed one. */
export interface Diff {
  /** Where it is, such as `variables/governance.quorum_pct`. */
  path: string;
  /** What the value would be if nothing were decided. */
  baseline: string;
  /** What it would be if this change set carried. */
  proposed: string;
  /** The difference in one plain sentence. */
  sentence: string;
}

/** One cycle of a pass, kept whole so a surface can scrub through the run. */
export interface CycleResult {
  /** Which cycle this is, counting from one. */
  cycle: number;
  /** The instant it began. */
  atIso: string;
  /** The state at the end of it. */
  state: SimState;
  /** What the models said about it. */
  flags: Flag[];
  /** What the models found broken at the end of it. */
  violations: Violation[];
}

/**
 * The seeded generator. Two methods only, because a model that reaches for a
 * distribution the engine does not supply is a model whose randomness the
 * engine cannot reproduce.
 */
export interface Rng {
  /** The next value in [0, 1). */
  next(): number;
  /** The next whole number in [0, n). Zero when n is zero or less. */
  int(n: number): number;
}

/**
 * WHAT A DOMAIN MODEL IS. The economics session implements one of these and
 * the governance build implements the other.
 *
 * `step` is pure: it reads the state it is handed, mutates nothing, and
 * returns a new state. `flags` says what a member should know about the cycle
 * that just ran. `invariants` says what is broken, and one non-empty answer
 * stops the proposed pass at that cycle.
 */
export interface DomainModel {
  /** Which half of the village this model speaks for. */
  name: "governance" | "economics";
  /** One cycle. Pure, and it returns a new state. */
  step(state: SimState, cycle: number, rng: Rng): SimState;
  /** What is worth saying about this cycle, in plain language. */
  flags(state: SimState, cycle: number): Flag[];
  /** What is broken. Empty means the state holds together. */
  invariants(state: SimState): Violation[];
}

/** What a run answers with. */
export interface SimResult {
  /** The same snapshot run forward with nothing decided. */
  baseline: CycleResult[];
  /** The same snapshot run forward with the change set applied. */
  proposed: CycleResult[];
  /** Where the two final states differ. */
  diff: Diff[];
  /** Every flag from the proposed pass, in the order they were raised. */
  flags: Flag[];
  /** Every violation from the proposed pass. The first one stopped it. */
  violations: Violation[];
  /** The seed this run used, so anybody can run it again and get this. */
  seed: number;
  /**
   * The assumptions this run was given, echoed verbatim. The seed says the
   * run can be repeated; this says what it assumed while it ran. It is the
   * same object `SimInput.assumptions` held, never a copy and never edited,
   * and absent when the caller gave none.
   */
  assumptions?: Readonly<Record<string, unknown>>;
}
