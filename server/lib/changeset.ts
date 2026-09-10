/**
 * EXECUTING A TYPED CHANGE SET, IN TWO PHASES, THROUGH THE EXISTING WRITERS.
 *
 * ── WHAT THIS REPLACES ─────────────────────────────────────────────────────
 *
 * `applyMechanicsProposal` lived inside `server/index.ts` and walked a change
 * set writing as it went: refuse this key, set that one, refuse the next,
 * stamp `applied` if anything at all went through. An element it could not
 * type was SKIPPED, the proposal was still marked applied, the proposer was
 * still told it went through, and the admin route answered 207 partial. So a
 * village could pass six changes, have four land, and read a page that said
 * yes.
 *
 * ── TWO PHASES, AND WHY NOT A TRANSACTION ──────────────────────────────────
 *
 * The obvious fix is one transaction. It is unimplementable through the writers
 * this platform actually has, and pretending otherwise would be worse than the
 * bug:
 *
 *   setVariable          mutates a module-level overrides object
 *   setWeight            opens its own connection and commits
 *   setModuleLifecycle   mutates a settings map and reconciles a graph
 *   the collection writers write through a cache
 *
 * A rollback would leave the process serving values the database denies until
 * somebody restarts it. So atomicity comes from PRE-VALIDATION:
 *
 *   Phase 1  Validate every element. Every existing refusal runs here. Nothing
 *            is written. One failure and the whole set is refused, naming the
 *            element by its index and its own words.
 *   Phase 2  Apply, irreversible writes LAST, one `governance_element_ledger`
 *            row per write, then reload every written-through cache from the
 *            database so no cache is serving a value the tables disagree with.
 *
 * `docs/GOVERNANCE.md` says this out loud, because a member reading "applied
 * atomically" and a contributor reading this file have to be told the same
 * thing.
 *
 * ── WHAT ORDERING "IRREVERSIBLE LAST" MEANS HERE ───────────────────────────
 *
 * A dial can be set back by another vote. A weight allocation can be set back.
 * A module lifecycle can be moved back. A queued minting rule can be re-queued.
 * None of those are irreversible in the strong sense, and this platform's one
 * genuinely irreversible act (posting to the ledger) is not reachable from a
 * change set at all today. So the ordering rule is honoured by RANK and the
 * ranks are written down: the further down `WRITE_ORDER`, the harder the write
 * is to undo, and a set applies in that order so a failure halfway leaves the
 * cheapest half standing rather than the dearest.
 *
 * ── WHAT A CHANGE SET MAY NEVER DO ─────────────────────────────────────────
 *
 * Switch the governance module off. A change set that turned governance off
 * would strand every open ballot behind a 404 while the landing job kept
 * running, and the vote that turned it back on could not be held. The module id
 * is on `NEVER_BY_CHANGESET` and the refusal names it.
 *
 * ── WHERE THE STATEMENTS LIVE, AND WHY IN FIVE FILES ───────────────────────
 *
 * This file touches five tables and each has its own module under
 * `server/repos`:
 *
 *   `gameVariableRows.ts`          what a dial held BEFORE, read past the cache
 *   `governanceWeightRows.ts`      what a member was allocated BEFORE
 *   `governanceElementLedger.ts`   one row per write, the trail
 *   `mechanicsChanges.ts`          the amendment ledger's one INSERT
 *   `mechanicsProposals.ts`        stamping the proposal applied
 *
 * Five and not one, because a module named for THIS FILE would be a home for a
 * job rather than for a table, and the question worth being able to answer is
 * "who else reads this table". Two of the five already have a second reader in
 * the repository — the element ledger is read by the moon digest as well as by
 * the decision page — and that is only visible because the readers sit
 * together.
 *
 * WHAT STAYS HERE IS EVERY DECISION. The order the writes go in, what NULL
 * means in the amendment ledger, that a trail's failure may never fail the deed
 * it is a trail of, and the two-phase validation the whole file is built
 * around. None of those is a query, and none of them belongs anywhere a
 * reviewer would have to go looking for it.
 */
import type { Pool } from "mysql2/promise";
import { storedVariableValue } from "../repos/gameVariableRows";
import { allocatedWeight } from "../repos/governanceWeightRows";
import { elementRowsForBallot, upsertElementRow } from "../repos/governanceElementLedger";
import { insertMechanicsChange } from "../repos/mechanicsChanges";
import { markProposalApplied } from "../repos/mechanicsProposals";
import { VARIABLES_BY_KEY, applyTimingOf, ringOf } from "../../shared/gameVariables";
import { isMintRuleKey } from "../../shared/mintRuleKeys";
import { asChangeItem, type ChangeInput, type ChangeItem } from "./mechanics";
import { kindOfItem, kindOfSet, type GovernanceKind } from "../../shared/governanceKinds";
import { keyIsVetoLocked } from "./stewardship";
import { setVariable, type SetResult } from "./variables";
import { applyMintRuleChanges } from "./economy";
import { setWeight, weightChangeProblem, weightTokenProblem } from "./governanceWeights";
import { effectiveLifecycle, setModuleLifecycle } from "./modules";
import { MODULES_BY_ID, type ModuleLifecycle } from "../../shared/modules";

/**
 * Modules whose lifecycle a change set may never move, whatever the vote said.
 * One entry, and it is the module the vote itself runs on.
 */
export const NEVER_BY_CHANGESET: ReadonlySet<string> = new Set(["governance"]);

/**
 * The kinds this build can actually carry out, in the order they are applied.
 * Earlier is cheaper to undo. This list and `EXECUTABLE_ITEM_KINDS` in
 * `server/lib/mechanics.ts` hold the same set: that one is what the validator
 * refuses at proposal time, this one is the ORDER, which is a property of the
 * executor and belongs beside it. A kind absent from here throws before the
 * first write rather than being skipped.
 */
export const WRITE_ORDER: readonly string[] = [
  "dial",
  "module_lifecycle",
  "mint_rule",
  "weight_allocation",
  "mode_switch",
];

const rankOf = (kind: string): number => {
  const i = WRITE_ORDER.indexOf(kind);
  return i === -1 ? WRITE_ORDER.length : i;
};

/** Thrown before any write when a set holds an element this build cannot type. */
export class UntypedElementError extends Error {
  constructor(
    readonly index: number,
    readonly kind: string,
    message: string,
  ) {
    super(message);
    this.name = "UntypedElementError";
  }
}

export interface ChangesetDeps {
  pool: Pool;
  /** The amendment ledger writer. Never throws into its caller, by contract. */
  recordMechanicsChange: (
    key: string,
    result: { value?: string; previous?: string | null },
    actor: string | null,
    source: string,
    proposalRef: string,
    note: string | null,
  ) => Promise<void>;
  /** Reload every written-through cache from the database. */
  reloadCaches: () => Promise<void>;
  /** The lifecycle guard `setModuleLifecycle` asks for. */
  sharedPasswordPosture: () => boolean;
}

export interface ValidatedElement {
  index: number;
  item: ChangeItem;
  kind: GovernanceKind;
  /** The value in force right now, for the ledger's `old_value`. */
  oldValue: string | null;
  /** What the element would write. */
  newValue: string;
  /** The human sentence the ledger row carries. */
  sentence: string;
}

export type ValidationResult =
  | { ok: true; elements: ValidatedElement[]; kind: GovernanceKind }
  | { ok: false; index: number; itemKind: string; problem: string; sentence: string };

/**
 * PHASE 1. Every refusal this platform already has, run against every element,
 * writing nothing.
 *
 * The index is part of the answer and not a nicety: a member told "item four of
 * seven could not be applied and here is why" can fix it, and a member told
 * "the proposal could not be applied" cannot.
 */
export async function validateElements(
  deps: ChangesetDeps,
  changes: readonly ChangeInput[],
): Promise<ValidationResult> {
  const elements: ValidatedElement[] = [];
  const refuse = (index: number, itemKind: string, problem: string): ValidationResult => ({
    ok: false,
    index,
    itemKind,
    problem,
    sentence: `Item ${index + 1} of ${changes.length} (${itemKind}) could not be applied: ${problem}`,
  });

  for (let index = 0; index < changes.length; index += 1) {
    const raw = changes[index];
    let item: ChangeItem;
    try {
      item = asChangeItem(raw);
    } catch {
      return refuse(index, "unknown", "this build cannot read that as a change");
    }
    const kind = kindOfItem(item.kind);

    if (item.kind === "dial") {
      const def = VARIABLES_BY_KEY[item.key];
      if (!def) return refuse(index, item.kind, "this dial no longer exists in the registry");
      if (ringOf(def) !== "open") return refuse(index, item.kind, "this dial is no longer community-governable");
      const previous = await currentDialValue(deps, item.key);
      elements.push({
        index,
        item,
        kind,
        oldValue: previous,
        newValue: String(item.to),
        sentence: `${item.key} moves from ${previous ?? "its default"} to ${item.to}`,
      });
      continue;
    }

    if (item.kind === "mint_rule") {
      if (!isMintRuleKey(item.key)) {
        return refuse(index, item.kind, "this build cannot read that as one of the village's minting rules");
      }
      elements.push({
        index,
        item,
        kind,
        oldValue: (raw as { from?: string }).from ?? null,
        newValue: String(item.to),
        sentence: `${item.key} is queued to become ${item.to} at the next moon`,
      });
      continue;
    }

    if (item.kind === "weight_allocation") {
      const problem = weightChangeProblem({ weight: item.to, note: item.note });
      if (problem) return refuse(index, item.kind, problem.toLowerCase());
      const before = await currentWeight(deps, item.userId);
      elements.push({
        index,
        item,
        kind,
        oldValue: before === null ? null : String(before),
        newValue: String(item.to),
        sentence: `the allocation for ${item.userId} moves from ${before ?? "nothing"} to ${item.to}`,
      });
      continue;
    }

    if (item.kind === "mode_switch") {
      const def = VARIABLES_BY_KEY["governance.weight_mode"];
      const choices = (def?.choices ?? []).map((c) => c.value);
      if (!choices.includes(String(item.to))) {
        return refuse(index, item.kind, `${item.to} is not one of the ways this platform assigns weight`);
      }
      /*
       * A TOKEN MONEY CAN BUY IS NOT WHAT WEIGHS A VOTE, and this is the one
       * door that could have walked past that rule. `weightTokenProblem`
       * refuses at every ballot open, so a village that switched into token
       * mode on a purchasable token would find no ballot would open at all and
       * nothing would say why until somebody read the source.
       */
      if (String(item.to) === "token") {
        const token = String(item.weightToken ?? "").trim() || (await currentDialValue(deps, "governance.weight_token")) || "";
        const problem = weightTokenProblem(token);
        if (problem) return refuse(index, item.kind, problem.toLowerCase());
      }
      const previous = await currentDialValue(deps, "governance.weight_mode");
      elements.push({
        index,
        item,
        kind,
        oldValue: previous,
        newValue: String(item.to),
        sentence: `how voting weight is assigned moves from ${previous ?? "equal"} to ${item.to}`,
      });
      continue;
    }

    if (item.kind === "module_lifecycle") {
      const def = MODULES_BY_ID[item.moduleId];
      if (!def) return refuse(index, item.kind, `there is no part of the Game called ${item.moduleId}`);
      if (NEVER_BY_CHANGESET.has(item.moduleId)) {
        return refuse(
          index,
          item.kind,
          "the part of the Game that holds the vote cannot be switched by a vote. Open ballots would have nowhere to live and the vote to switch it back could not be held",
        );
      }
      const before = effectiveLifecycle(item.moduleId);
      elements.push({
        index,
        item,
        kind,
        oldValue: before,
        newValue: String(item.to),
        sentence: `${def.name} moves from ${before} to ${item.to}`,
      });
      continue;
    }

    return refuse(index, item.kind, "this build cannot carry out a change of that kind yet");
  }

  const mixed = notVetoableMixRefusal(elements);
  if (mixed) return refuse(mixed.index, mixed.itemKind, mixed.problem);

  elements.sort((a, b) => rankOf(a.item.kind) - rankOf(b.item.kind) || a.index - b.index);
  return { ok: true, elements, kind: kindOfSet(elements.map((e) => e.item.kind)) };
}

/**
 * IS THIS ELEMENT ONE NO STEWARD MAY STOP?
 *
 * `server/lib/stewardship.ts` owns the list of keys that make up the reach of
 * the seat, and `keyIsVetoLocked` is its answer. Asked per element, here,
 * because the change set is the dispatcher's and the key list is the seat's.
 *
 * A `role` element with `seat` or `unseat` is the same class: those acts are
 * about the seat itself. This build refuses `role` inside a change set at
 * validation anyway (`EXECUTABLE_ITEM_KINDS` in `server/lib/mechanics.ts`), and
 * the branch is here so the day a lane widens that set the mixing rule already
 * covers it rather than being remembered.
 */
export function elementIsNotVetoable(item: ChangeItem): boolean {
  if (item.kind === "role") return item.act === "seat" || item.act === "unseat";
  const key = (item as { key?: unknown }).key;
  return key !== undefined && keyIsVetoLocked(String(key));
}

/**
 * A SET MAY NOT MIX AN UNSTOPPABLE ELEMENT WITH ANY OTHER KIND.
 *
 * Three rules collided on one row and nothing said which won. A bundle waits as
 * a whole under one instant and one window (19F); a set holding any Game change
 * is wholly a Game change; and an act about the seat itself is not vetoable.
 * Read one way, a faction publishes one proposal that edits the veto map and
 * reallocates forty percent of the voting weight, and the whole thing lands
 * with nobody able to stop the half that was meant to be stoppable. Read the
 * other way, a steward gets a veto over the edit to their own reach whenever it
 * travels with anything else.
 *
 * Both readings are the failure the rule exists to prevent, so the mix is
 * refused at validation, before a vote is ever held on it, and the refusal
 * NAMES BOTH ELEMENTS: the unstoppable one and the one it may not travel with.
 * A set made only of unstoppable elements is fine, and so is a set with none.
 */
export function notVetoableMixRefusal(
  elements: readonly ValidatedElement[],
): { index: number; itemKind: string; problem: string } | null {
  const locked = elements.filter((e) => elementIsNotVetoable(e.item));
  if (locked.length === 0 || locked.length === elements.length) return null;
  const other = elements.find((e) => !elementIsNotVetoable(e.item));
  if (!other) return null;
  const nameOf = (e: ValidatedElement): string => {
    const key = (e.item as { key?: unknown }).key;
    return key === undefined ? e.item.kind : String(key);
  };
  return {
    index: locked[0].index,
    itemKind: locked[0].item.kind,
    problem:
      `${nameOf(locked[0])} decides what a steward may stop, so nobody may stop a change to it, and it cannot travel ` +
      `with item ${other.index + 1} (${nameOf(other)}), which a steward may stop. Split them into two proposals: ` +
      "one proposal, one answer to the question of who can stop it",
  };
}

/** The value in force for a dial right now, or null when it sits at its default. */
async function currentDialValue(deps: ChangesetDeps, key: string): Promise<string | null> {
  const stored = await storedVariableValue(deps.pool, key);
  if (stored !== null) return stored;
  return VARIABLES_BY_KEY[key]?.default ?? null;
}

async function currentWeight(deps: ChangesetDeps, userId: string): Promise<number | null> {
  return allocatedWeight(deps.pool, userId);
}

export interface ElementLedgerInput {
  ballotId: string;
  /** The proposal the ballot was held on, so a reversion can join the trail. */
  proposalId?: string | null;
  elementIndex: number;
  /**
   * Where this write fell in the WRITE_ORDER sequence, so the trail can be
   * read back in the order the writes actually happened.
   *
   * `element_index` is the order a MEMBER read ("item 2 of 4") and the key the
   * row is stored under; the two are different facts and the ledger carries
   * both. Before the key moved to (ballot, element index) this was the
   * autoincrement id doing double duty, which is why re-keying the table would
   * otherwise have quietly lost the harder-to-undo-last property the executor
   * is built around.
   */
  writeSeq?: number;
  elementKind: string;
  sentence: string;
  wroteTable: string | null;
  wroteId: string | null;
  oldValue: string | null;
  newValue: string | null;
}

/**
 * One row per write. Never throws into the caller: a trail that failed must not
 * fail the deed it is a trail OF, and this one is written between two writes
 * that have already happened.
 */
export async function recordElement(pool: Pool, input: ElementLedgerInput): Promise<void> {
  try {
    /*
     * KEYED ON (ballot, element index), SO A RETRY OVERWRITES ITS OWN ROW.
     *
     * A landing that throws halfway is tried again on the next tick, and the
     * elements that succeeded the first time write again. With an autoincrement
     * key that produced two rows for one element and a trail saying the dial
     * moved twice, which is the one thing a ledger must never say.
     *
     * The statement is in `server/repos/governanceElementLedger.ts`. The three
     * defaults below stay here, with the caller that knows what they mean: a
     * write with no proposal behind it, a write whose sequence is its own
     * index, and a sentence clipped to the column's 1000 characters BEFORE it
     * travels, so a long one is shortened rather than refused by strict mode.
     */
    await upsertElementRow(pool, {
      ballotId: input.ballotId,
      proposalId: input.proposalId ?? null,
      elementIndex: input.elementIndex,
      writeSeq: input.writeSeq ?? input.elementIndex,
      elementKind: input.elementKind,
      sentence: input.sentence.slice(0, 1000),
      wroteTable: input.wroteTable,
      wroteId: input.wroteId,
      oldValue: input.oldValue,
      newValue: input.newValue,
    });
  } catch (e) {
    // The id is an ARGUMENT and never part of the format string. `console.error`
    // reads %s and %j in its first argument, so an id carrying one would consume
    // the error object and the line would report a failure with no failure in it.
    console.error("[governance] the element ledger refused a row (the change stands)", { ballotId: input.ballotId }, e);
  }
}

/** Every element ledger row for one decision, in the order the writes happened. */
export async function elementsFor(pool: Pool, ballotId: string): Promise<
  Array<{ index: number; kind: string; sentence: string; oldValue: string | null; newValue: string | null; appliedAt: string }>
> {
  return elementRowsForBallot(pool, ballotId);
}

export interface ApplySetInput {
  /** The ballot the ledger rows are keyed on. */
  ballotId: string;
  /** The amendment ledger's proposal marker. */
  proposalRef: string;
  actor: string | null;
  changes: readonly ChangeInput[];
}

export interface ApplySetResult {
  ok: boolean;
  /** Dial and mode keys that now hold their new value. */
  applied: string[];
  /** Minting keys queued onto a rule for a future cycle. */
  queued: string[];
  /** The cycle a queued minting change lands on, or null. */
  landsAtCycle: number | null;
  /** Set when phase 1 refused the set. Nothing was written. */
  refusal: { index: number; itemKind: string; problem: string; sentence: string } | null;
  /** Anything phase 2 could not do despite validating. Should be empty. */
  failed: Array<{ key: string; problem: string }>;
}

/**
 * PHASE 1 THEN PHASE 2. The one door a change set goes through.
 *
 * `landsAtCycle` is passed INTO the minting writer rather than recomputed
 * there, because `queueRuleChange` used to work out its own landing cycle from
 * `new Date()` at the moment of apply. A change set that validated on the 3rd
 * and landed on the 5th promised the village one moon and queued another.
 */
export async function applyChangeSet(deps: ChangesetDeps, input: ApplySetInput): Promise<ApplySetResult> {
  const validated = await validateElements(deps, input.changes);
  if (!validated.ok) {
    return {
      ok: false,
      applied: [],
      queued: [],
      landsAtCycle: null,
      refusal: { index: validated.index, itemKind: validated.itemKind, problem: validated.problem, sentence: validated.sentence },
      failed: [],
    };
  }

  const applied: string[] = [];
  const queued: string[] = [];
  const failed: Array<{ key: string; problem: string }> = [];
  let landsAtCycle: number | null = null;
  let touchedCaches = false;

  /*
   * The position in the applied sequence, which is `WRITE_ORDER`'s and not the
   * proposal's. `validated.elements` is already sorted into it, so this counter
   * IS the order the writes happen in.
   */
  let writeSeq = 0;
  for (const el of validated.elements) {
    const item = el.item;
    writeSeq += 1;

    if (item.kind === "dial" || item.kind === "mode_switch") {
      const key = item.kind === "dial" ? item.key : "governance.weight_mode";
      const r: SetResult = await setVariable(deps.pool, key, String(item.to));
      if (!r.ok) {
        failed.push({ key, problem: r.error ?? "refused" });
        continue;
      }
      await deps.recordMechanicsChange(
        key,
        r,
        input.actor,
        "governance",
        input.proposalRef,
        el.oldValue !== null && el.oldValue !== (r as { previous?: string | null }).previous
          ? `Baseline moved between proposal (${el.oldValue}) and apply (${(r as { previous?: string | null }).previous})`
          : null,
      );
      await recordElement(deps.pool, {
        ballotId: input.ballotId,
        proposalId: input.proposalRef,
        elementIndex: el.index,
        writeSeq,
        elementKind: item.kind,
        sentence: el.sentence,
        wroteTable: "game_variables",
        wroteId: key,
        oldValue: el.oldValue,
        newValue: el.newValue,
      });
      applied.push(key);
      touchedCaches = true;
      // The weight token rides with the mode when the vote named one, because
      // switching into token mode without naming a token is a village that
      // weighs nothing.
      if (item.kind === "mode_switch" && item.weightToken) {
        const t = await setVariable(deps.pool, "governance.weight_token", String(item.weightToken));
        if (t.ok) {
          await deps.recordMechanicsChange("governance.weight_token", t, input.actor, "governance", input.proposalRef, null);
          applied.push("governance.weight_token");
        } else {
          failed.push({ key: "governance.weight_token", problem: t.error ?? "refused" });
        }
      }
      continue;
    }

    if (item.kind === "module_lifecycle") {
      const out = await setModuleLifecycle(item.moduleId, item.to as ModuleLifecycle, input.actor, {
        sharedPasswordPosture: deps.sharedPasswordPosture,
      });
      if (!out.ok) {
        failed.push({ key: `module:${item.moduleId}`, problem: out.error });
        continue;
      }
      await recordElement(deps.pool, {
        ballotId: input.ballotId,
        proposalId: input.proposalRef,
        elementIndex: el.index,
        writeSeq,
        elementKind: item.kind,
        sentence: el.sentence,
        wroteTable: "module_settings",
        wroteId: item.moduleId,
        oldValue: el.oldValue,
        newValue: el.newValue,
      });
      applied.push(`module:${item.moduleId}`);
      touchedCaches = true;
      continue;
    }

    if (item.kind === "weight_allocation") {
      try {
        const out = await setWeight(deps.pool, {
          userId: item.userId,
          weight: Number(item.to),
          actorUserId: input.actor ?? "governance",
          note: item.note,
        });
        await recordElement(deps.pool, {
          ballotId: input.ballotId,
          proposalId: input.proposalRef,
          elementIndex: el.index,
          writeSeq,
          elementKind: item.kind,
          sentence: el.sentence,
          wroteTable: "governance_weights",
          wroteId: out.changeId || item.userId,
          oldValue: el.oldValue,
          newValue: el.newValue,
        });
        applied.push(`weight:${item.userId}`);
      } catch (e) {
        failed.push({ key: `weight:${item.userId}`, problem: e instanceof Error ? e.message : "refused" });
      }
      continue;
    }
  }

  const mintItems = validated.elements.filter((e) => e.item.kind === "mint_rule");
  if (mintItems.length > 0) {
    const out = await applyMintRuleChanges(
      deps.pool,
      mintItems.map((e) => ({ key: (e.item as { key: string }).key, from: e.oldValue ?? "", to: e.newValue })),
      input.actor ?? "governance",
    );
    failed.push(...out.failed);
    for (const q of out.queued) {
      queued.push(q.key);
      landsAtCycle = q.fromCycle;
      const el = mintItems.find((e) => (e.item as { key: string }).key === q.key);
      await deps.recordMechanicsChange(
        q.key,
        { value: q.to, previous: q.from },
        input.actor,
        "governance",
        input.proposalRef,
        `Carried by the village and queued on the rule. It takes effect at cycle ${q.fromCycle}.`,
      );
      await recordElement(deps.pool, {
        ballotId: input.ballotId,
        proposalId: input.proposalRef,
        elementIndex: el?.index ?? 0,
        elementKind: "mint_rule",
        sentence: `${q.key} is queued to become ${q.to} at cycle ${q.fromCycle}`,
        wroteTable: "mint_rules",
        wroteId: q.key,
        oldValue: q.from,
        newValue: q.to,
      });
    }
  }

  /*
   * THE CACHES COME BACK FROM THE DATABASE, ALWAYS, and never from what this
   * routine believes it just wrote. A module lifecycle change reconciles a
   * graph, a dial writes through a delta store, and a role write goes through a
   * repository cache. Re-deriving the in-process state from the tables is the
   * only way "the page and the database agree" survives a half-applied set.
   */
  if (touchedCaches || applied.length > 0) await deps.reloadCaches();

  return { ok: failed.length === 0, applied, queued, landsAtCycle, refusal: null, failed };
}

export interface LegacyProposal {
  id: string;
  title: string;
  changeSet: ChangeInput[];
  proposerUserId: string;
  hyphaRef: string | null;
  status: string;
  ballotId?: string | null;
}

/**
 * THE ONE APPLY, for a mechanics or minting proposal.
 *
 * Moved here from `server/index.ts` unchanged in what it means and changed in
 * two ways that matter:
 *
 *  1. It THROWS BEFORE ITS FIRST WRITE on any element it cannot type. It used
 *     to skip such an element and stamp the proposal applied anyway. The admin
 *     apply route turns the throw into a 409 naming the element; nothing
 *     answers 207 any more, because a partly-applied decision is a state the
 *     village cannot read.
 *  2. It goes through `applyChangeSet`, so validation happens before any write
 *     and every write leaves an element-ledger row.
 *
 * Idempotent: an already-applied proposal returns cleanly.
 */
export async function applyMechanicsProposal(
  deps: ChangesetDeps,
  p: LegacyProposal,
  actor: string | null,
  hooks: {
    onApplied: (p: LegacyProposal, result: ApplySetResult) => Promise<void>;
  },
): Promise<ApplySetResult> {
  if (p.status === "applied") {
    return { ok: true, applied: [], queued: [], landsAtCycle: null, refusal: null, failed: [] };
  }

  // Typed before anything is touched. `EXECUTABLE_ITEM_KINDS` lives in
  // shared/ballotSubjects.ts and is widened as each executor lands; an element
  // outside it is a decision this build cannot carry out, and saying so loudly
  // is the only honest answer.
  for (let i = 0; i < p.changeSet.length; i += 1) {
    let kind: string;
    try {
      kind = asChangeItem(p.changeSet[i]).kind;
    } catch {
      throw new UntypedElementError(i, "unknown", `Item ${i + 1} of ${p.changeSet.length} is not a change this build can read.`);
    }
    if (!WRITE_ORDER.includes(kind)) {
      throw new UntypedElementError(
        i,
        kind,
        `Item ${i + 1} of ${p.changeSet.length} is a ${kind} change, and this build has no executor for it. Nothing was applied.`,
      );
    }
  }

  const proposalRef = `gm:${p.id}${p.hyphaRef ? ` ${p.hyphaRef}` : ""}${p.ballotId ? ` bal:${p.ballotId}` : ""}`.slice(0, 255);
  const result = await applyChangeSet(deps, {
    ballotId: p.ballotId ?? `gmp:${p.id}`,
    proposalRef,
    actor,
    changes: p.changeSet,
  });

  if (result.applied.length > 0 || result.queued.length > 0) {
    await markProposalApplied(deps.pool, p.id);
    await hooks.onApplied(p, result);
  }
  return result;
}

/**
 * THE AMENDMENT LEDGER'S ONE WRITER.
 *
 * Every mechanics change lands here or it did not happen: an admin edit, a
 * routed legacy field, a platform migration, a passed proposal. Moved out of
 * `server/index.ts` by the dispatcher lane, unchanged, because it belongs
 * beside the executor that calls it and the file it left is the one the ratchet
 * exists to shrink.
 *
 * A no-op (the value did not move) writes nothing. It never throws into its
 * caller: like `recordEvent`, this is a trace of a change that already
 * happened, and a trace that failed must not fail the deed it is a trace OF.
 */
export async function recordMechanicsChangeRow(
  pool: Pool,
  key: string,
  result: { value?: string; previous?: string | null },
  actorUserId: string | null,
  source: "admin" | "governance" | "platform",
  proposalRef?: string | null,
  note?: string | null,
): Promise<void> {
  if (result.value === result.previous) return;
  try {
    const def = VARIABLES_BY_KEY[key];
    await insertMechanicsChange(pool, {
      id: `mech-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      configKey: key,
      // NULL means "the platform default at the time": the row records the
      // village's act, and not a snapshot of the platform's defaults.
      oldValue: result.previous === def?.default ? null : result.previous ?? null,
      newValue: result.value === def?.default ? null : result.value ?? null,
      actorUserId,
      source,
      proposalRef: proposalRef ?? null,
      note: note ?? null,
    });
  } catch (e) {
    // Same shape, and this is the one CodeQL named: `key` arrives from a change
    // set, so it is a user-provided value in a format string. Passed as data.
    console.error("[mechanics] amendment ledger write failed (change stands)", { key }, e);
  }
}

/**
 * A SET HOLDING ANY CYCLE-TIMED DIAL WAITS FOR THE BOUNDARY AS A WHOLE.
 *
 * Atomicity beats promptness: half a set landing now and half at the moon is a
 * decision the village never made. Moved out of `server/index.ts` beside the
 * executor that reads it.
 */
export const changeSetWaitsForCycleClose = (changeSet: readonly { key?: string }[]): boolean =>
  changeSet.some((c) => {
    const def = VARIABLES_BY_KEY[String(c?.key ?? "")];
    return def ? applyTimingOf(def) === "cycle-close" : false;
  });

/**
 * A SET THAT MAY ONLY LAND ON A BOUNDARY.
 *
 * Wider than `changeSetWaitsForCycleClose` above, and the two answer different
 * questions. That one asks whether a set must wait for an ENDED cycle to be
 * settled before it lands, which is about a moon nobody has paid yet. This one
 * asks whether the set moves a number the RUNNING cycle is being settled
 * against, which is about a member already spending against a ceiling. A dial
 * whose apply timing is `cycle-close` (the claim window, the gratitude budgets,
 * every stage multiplier) and every minting rule are both.
 *
 * A set answering yes here snaps its landing instant forward to the next
 * boundary of the active clock on EVERY path, `at_acceptance` included.
 */
export const changeSetSnapsToBoundary = (changeSet: readonly { key?: string; kind?: string }[]): boolean =>
  changeSet.some((c) => {
    if (String(c?.kind ?? "") === "mint_rule") return true;
    const key = String(c?.key ?? "");
    if (isMintRuleKey(key)) return true;
    const def = VARIABLES_BY_KEY[key];
    return def ? applyTimingOf(def) === "cycle-close" : false;
  });
