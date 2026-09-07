/**
 * Mechanics proposals: the domain logic for propose-on-the-page.
 *
 * Three responsibilities, all pure enough to unit-test without a server:
 *
 *  - QUALIFICATION. Who may propose is itself part of the game, resolved
 *    through the ONE gate plus earned standing: `mechanics.propose` (stage
 *    unlock tunable via progression.unlock.mechanics.propose, grantable by
 *    role or badge, deniable by a warning badge) AND
 *    governance.hypha_threshold of earned recognition. A member who clears
 *    the deny but not the bar can still DRAFT — a qualified member's
 *    sponsorship opens the draft, so proposing is an on-ramp, not a wall.
 *
 *  - CHANGE-SET VALIDATION. A proposal may only touch Ring-2 ("open")
 *    variables, every value must pass the same validation the admin write
 *    path runs, every change must actually change something, and a dial
 *    recently moved by governance may be under a cooldown. Validated as a
 *    WHOLE at creation: a set with one bad change is refused entirely,
 *    because what goes to the vote must be exactly what was checked.
 *
 *  - THE PROPOSAL DOCUMENT. One canonical markdown rendering, generated
 *    server-side so the page, the clipboard copy and (next phase) the Hypha
 *    bridge all carry the same text. It embeds the `[gm:<id>]` marker the
 *    bridge will match on-chain events against — the same title-marker
 *    pattern regen-civics' bridge already proved — and a machine-readable
 *    change-set block so apply-on-pass never re-parses prose.
 */
import type { Pool, RowDataPacket } from "mysql2/promise";
// Windows lane: the cross-key rule a window shape has to clear when it is set.
import { windowSettingProblem } from "./governanceWindows";
import {
  criticalityOf,
  ringOf,
  applyTimingOf,
  validateVariable,
  VARIABLES_BY_KEY,
} from "../../shared/gameVariables";
import {
  criticalityOfItems,
  dialsForSubject,
  floorForCriticality,
  metaSettingTrialRefusal,
  methodForSubjects,
  thresholdChangePrice,
  thresholdsForSubject,
  CRITICALITY_FOR_ITEM_KIND,
  SUBJECT_FOR_ITEM_KIND,
  type ChangeItemKind,
  type ThresholdSettings,
} from "../../shared/ballotSubjects";
import { raiseDials, type BallotMethod, type Criticality, type MethodDials } from "../../shared/governanceEngine";
import {
  AMOUNT_FROM_SOURCE,
  MINT_RULE_FIELD_LABEL,
  displayMintRuleValue,
  isMintRuleKey,
  mintRuleValueNumber,
  mintRuleValueProblem,
  normalizeMintRuleValue,
  parseMintRuleKey,
  type MintRuleField,
} from "../../shared/mintRuleKeys";

/**
 * -- WHAT A CHANGE SET IS MADE OF, AFTER Q9 ----------------------------------
 *
 * A change was a `{ key, to }` pair and the kind of thing it changed was read
 * back off a prefix on the key. The founder's ruling of 2026-09-02 makes a
 * proposal a LIST of connected changes that may be of different kinds, priced
 * at the highest floor among them, so the kind is a field now.
 *
 * Every item carries `kind`, and every item that names a value carries `to`.
 * The shapes are deliberately close to what each kind's existing writer
 * already takes, so the dispatcher lane's executors are a switch and not a
 * translation layer.
 */
export interface DialItem {
  kind: "dial";
  /** A registry key from `shared/gameVariables.ts`. */
  key: string;
  to: string;
}

export interface MintRuleItem {
  kind: "mint_rule";
  /** A `mint:<ruleId>:<field>` key from `shared/mintRuleKeys.ts`. */
  key: string;
  to: string;
}

export interface WeightAllocationItem {
  kind: "weight_allocation";
  /** Who the allocation is for. */
  userId: string;
  /** The weight they would carry, in the custom allocation table's units. */
  to: string;
  /** The note the allocation trail requires of every writer. */
  note: string;
}

export interface ModeSwitchItem {
  kind: "mode_switch";
  /** A `governance.weight_mode` value. This is its only door. */
  to: string;
  /** Optional: the weight token to use, when switching into token mode. */
  weightToken?: string;
}

export interface ModuleLifecycleItem {
  kind: "module_lifecycle";
  /** The module id from `shared/modules.ts`. */
  moduleId: string;
  /** The lifecycle it would move to. */
  to: string;
}

export interface BrandFieldItem {
  kind: "brand_field";
  /** The brand field's path, as the brand writer already names it. */
  field: string;
  to: string;
}

export interface RoleItem {
  kind: "role";
  /** What the village would do to the role. */
  act: "declare" | "seat" | "unseat";
  /** The role, by id for a seat or unseat and by name for a declaration. */
  role: string;
  /** Who sits, for a seat or an unseat. */
  userId?: string;
}

export type ChangeItem =
  | DialItem
  | MintRuleItem
  | WeightAllocationItem
  | ModeSwitchItem
  | ModuleLifecycleItem
  | BrandFieldItem
  | RoleItem;

/**
 * What a caller may hand `validateChangeSet`: a typed item, or the untyped
 * `{ key, to }` pair every existing caller and every stored change set uses.
 *
 * The untyped form is not deprecated and is not going away. It is the shape
 * on disk in `mechanics_proposals.change_set` for every proposal ever made,
 * and a validator that could not read it would refuse the village's own
 * history. `asChangeItem` reads one into the union, which is the ONE place
 * that decides what an untyped pair is.
 */
export type ChangeInput = ChangeItem | { key: string; to: string };

/**
 * Read an untyped pair into the union. A key with the minting prefix is a
 * minting rule and everything else is a dial, which is exactly the rule the
 * open-ballot route already applied inline to pick a subject type.
 */
export function asChangeItem(input: ChangeInput): ChangeItem {
  if (input && typeof (input as any).kind === "string") return input as ChangeItem;
  const key = String((input as any)?.key ?? "");
  const to = String((input as any)?.to ?? "");
  return isMintRuleKey(key) ? { kind: "mint_rule", key, to } : { kind: "dial", key, to };
}

/**
 * The subject that prices this item, and the tier it carries.
 *
 * THE SUBJECT WINS WHEREVER IT HAS SPOKEN. A subject that declares its own
 * floor has already said what it costs, in numbers somebody wrote a reason
 * for: `mint_rule` asks 50 of quorum and deliberately nothing of unity,
 * because R68's stated reason is awareness and awareness is quorum. Laying
 * the structural tier over the top of that would raise its unity to 80 and
 * quietly overrule the reason. So a named subject contributes the tier IT
 * declared, and the kind's tier is the fallback for a kind whose subject sets
 * no floor of its own.
 */
export function pricingOf(item: ChangeItem): { subject: string; criticality: Criticality } {
  const subject = SUBJECT_FOR_ITEM_KIND[item.kind];
  if (item.kind === "dial") {
    const def = VARIABLES_BY_KEY[item.key];
    return { subject, criticality: def ? criticalityOf(def) : "routine" };
  }
  const named = thresholdsForSubject(subject);
  if (named) return { subject, criticality: named.criticality ?? "routine" };
  return { subject, criticality: CRITICALITY_FOR_ITEM_KIND[item.kind] };
}

/**
 * ── THE NATURAL TIER, AND WHY A TRIAL CANNOT DISCOUNT IT ────────────────────
 *
 * Section 21.2 lets a village try a setting for one moon at one tier below its
 * own. The second audit's first risk is what happens when the setting being
 * tried is one of the dials that price everything else: a cheap proposal opens
 * a moon in which permanent changes are bought at a bar nobody agreed to, and
 * the trial's own reversion tidies away the evidence.
 *
 * Two functions close it, and they are here because pricing lives here.
 *
 *  - `metaSettingTrialRefusal` (shared/ballotSubjects.ts) refuses the trial
 *    outright for every dial in the META_SETTING class.
 *  - `naturalTierFor` answers "what does this setting cost with no discount",
 *    so any pricing done while a trial is in force can be forced back to it.
 *    Phase 2's trial path calls it for the story requirement of 21.1 as well,
 *    which is priced at the natural tier even when the ballot is priced one
 *    step down.
 *
 * A key the registry does not know answers `routine`, which is what
 * `pricingOf` already answers for an unknown dial. The trial path refuses an
 * unknown key on its own grounds before pricing it.
 */
export function naturalTierFor(key: string): Criticality {
  const def = VARIABLES_BY_KEY[String(key)];
  return def ? criticalityOf(def) : "routine";
}

/**
 * The bar this setting costs to move with no discount: its own tier's floor,
 * raised by the thresholds-for-thresholds rule (19B) when the setting IS a
 * bar. One function, because a trial that priced the tier correctly and
 * skipped the self-price would still hand a village a cheap constitutional
 * dial.
 */
export function naturalPriceFor(key: string, settings?: ThresholdSettings): MethodDials {
  const floor = floorForCriticality(naturalTierFor(key), settings);
  const own = thresholdChangePrice(key, settings);
  return own ? raiseDials(floor, own) : floor;
}

/**
 * The refusal a proposal marked `trial = true` reads when any element of it
 * moves a dial that prices, gates or counts other decisions, or null when
 * every element may be tried.
 *
 * It answers on the WHOLE set, because a bundle is one proposal and a set
 * holding one meta setting beside four ordinary dials is a discount on the
 * meta setting. The other trial guards of 21.2 (the cooldown, a trial of a
 * token send, a setting already at routine) belong to the lane that builds
 * trials; this one is the class that can never be trialled at all.
 */
export function trialProblem(changes: readonly ChangeInput[]): string | null {
  const keys = changes
    .map(asChangeItem)
    .filter((item): item is DialItem => item.kind === "dial")
    .map((item) => item.key);
  return metaSettingTrialRefusal(keys);
}

/**
 * WHAT THIS WHOLE SET ASKS OF THE VILLAGE.
 *
 * Q9's default in one function: the highest floor among the elements, so a
 * bundle is as hard to pass as its hardest part and nobody can smuggle a big
 * change under a small one. The subject stamped on the ballot is the element
 * that set the bar, because `ballots.subject_type` holds one word and the
 * honest word is the one the price came from.
 */
export interface ChangeSetPrice {
  /** The subject type to stamp on the ballot. */
  subjectType: string;
  /** Every subject in the set, in the order the items name them. */
  subjects: string[];
  /** The tier the set is priced at. */
  criticality: Criticality;
  /** The method the set is conducted by, or null for the village's own. */
  method: BallotMethod | null;
  /** Set when two elements want two different methods. */
  conflict: string | null;
  /** The dials to freeze. */
  dials: MethodDials;
}

export function priceChangeSet(
  changes: readonly ChangeInput[],
  method: BallotMethod,
  village: MethodDials,
  settings?: ThresholdSettings,
): ChangeSetPrice {
  const items = changes.map(asChangeItem);
  const priced = items.map(pricingOf);
  const subjects = priced.map((p) => p.subject);
  const criticality = criticalityOfItems(priced.map((p) => p.criticality));
  const { method: fixed, conflict } = methodForSubjects(subjects);
  const conducts = fixed ?? method;
  /*
   * The criticality tier is asked for as a subject-less target, because a
   * dial's tier belongs to the dial and not to the word "mechanics". Every
   * other floor arrives through the subjects.
   */
  let dials = raiseToTier(
    dialsForSubject(subjects, conducts, village, settings),
    criticality,
    settings,
  );
  /*
   * THRESHOLDS FOR THRESHOLDS (19B). A dial that IS a bar is priced at the
   * bar it currently holds: a setting at 97 and 97 costs 97 and 97 to move,
   * up or down. The tier above is the floor under this, so this call can only
   * ever raise, and a set that moves two bars pays the harder of the two.
   *
   * It lives here and never in `pricingOf` because a tier is a word and a
   * bar is a pair of numbers: 97 and 97 has no name on the ladder once a
   * village has raised its constitutional tier above the platform's, and
   * rounding it to the nearest tier would price the change below the bar it
   * is moving.
   */
  for (const item of items) {
    if (item.kind !== "dial") continue;
    const own = thresholdChangePrice(item.key, settings);
    if (own) dials = raiseDials(dials, own);
  }
  /*
   * WHICH SUBJECT GETS STAMPED. The one whose own floor is the set's floor,
   * preferring the first named, so a set of one behaves exactly as it did.
   * `mechanics` sets no floor, so it only wins a set that is all dials.
   */
  let subjectType = subjects[0] ?? "mechanics";
  let best = -1;
  for (const subject of subjects) {
    const floor = dialsForSubject(subject, conducts, village, settings);
    const score = Math.max(floor.unityPct, floor.quorumPct);
    if (score > best) {
      best = score;
      subjectType = subject;
    }
  }
  return { subjectType, subjects, criticality, method: fixed, conflict, dials };
}

function raiseToTier(base: MethodDials, criticality: Criticality, settings?: ThresholdSettings): MethodDials {
  const floor = floorForCriticality(criticality, settings);
  return {
    unityPct: Math.max(base.unityPct, floor.unityPct),
    quorumPct: Math.max(base.quorumPct, floor.quorumPct),
  };
}

export interface ProposedChange {
  key: string;
  /** Effective value at proposal time: the baseline voters saw. */
  from: string;
  to: string;
}

export interface ChangeSetProblem {
  key: string;
  problem: string;
}

/**
 * The three columns of a minting rule a change set can move, plus the two that
 * say which rule it is. Structural on purpose: `MintRule` in `lib/economy.ts`
 * satisfies this already, and importing that module here would pull the whole
 * token registry into a file whose point is being testable without a server.
 */
export interface MintRuleValues {
  trigger: string;
  tokenSlug: string;
  amount: number | null;
  ceiling: number;
  enabled: boolean;
}

/**
 * Reads the rules a change set names. Injected instead of queried here for the
 * reason above, and because the ONE caller already holds the mint's own
 * village-scoped reader.
 */
export type MintRuleReader = (ruleIds: string[]) => Promise<Map<string, MintRuleValues>>;

/** What a rule's field says today, in the change set's own spelling. */
export function currentMintRuleValue(rule: MintRuleValues, field: MintRuleField): string {
  if (field === "enabled") return rule.enabled ? "true" : "false";
  if (field === "ceiling") return String(rule.ceiling);
  return rule.amount === null ? AMOUNT_FROM_SOURCE : String(rule.amount);
}

/** How a minting rule reads on a document: what it pays for, in which token. */
export function mintRuleLabel(rule: MintRuleValues, field: MintRuleField): string {
  return `${rule.trigger} in ${rule.tokenSlug}: ${MINT_RULE_FIELD_LABEL[field]}`;
}

/**
 * Validate a whole change-set against the CURRENT registry state.
 * Returns problems (empty = valid) and the normalized set with `from`
 * captured from the live effective values.
 *
 * -- TYPED ITEMS, AND WHAT EACH KIND STILL COSTS (Q9, 2026-09-02) ------------
 *
 * A change set used to hold one vocabulary and the refusal to mix two of them
 * was priced: "a ballot carries ONE threshold, and a set that is two subjects
 * has no honest price". That reason is gone. `priceChangeSet` gives a mixed
 * set an honest price, which is the highest floor among its elements, exactly
 * as the founder ruled: a bundle is as hard to pass as its hardest part.
 *
 * What has NOT gone is the second reason, and it is the one that still bites.
 * A dial is written by `setVariable` the moment a proposal applies. A minting
 * rule is queued into its own pending columns and promoted by the next
 * settlement. `applyMechanicsProposal` runs both and reports `applied` and
 * `queued` separately, and the decision page says "nothing has moved yet"
 * over a queued rule. On a set holding both, that sentence would be said over
 * a dial that had already moved, and half a change set is a state nobody
 * voted for. The founder's own ruling on a part-failed set is that nothing
 * applies. So the mix stays refused until the apply is atomic, and the
 * refusal now says the true reason.
 *
 * THE ONE PLACE THAT LIFTS IT is `executableKinds`. Every kind in that set is
 * one this build can apply; every kind outside it is refused with a sentence
 * saying so rather than being voted on and then quietly doing nothing. The
 * dispatcher lane widens the set as it lands each executor, and nothing else
 * has to change here.
 *
 * -- WHY A FOUNDER-RING KEY IS STILL REFUSED INSIDE A DIAL ITEM -------------
 *
 * `governance.weight_mode` is constitutional and it is now votable (Q8), but
 * only as a `mode_switch` item, which is priced at 97 and 97 and conducted by
 * the one method that reads those numbers. If a dial item could carry it, the
 * same change would have two prices depending on which shape somebody typed
 * it in, and the cheaper one would win every time. One door, and it is the
 * expensive one.
 /**
 * The kinds `applyMechanicsProposal` can actually carry out today. The
 * dispatcher lane widens this as it lands each executor; a kind outside it is
 * refused at validation rather than voted on and silently dropped.
 */
// Widened by the dispatcher lane as each executor landed in
// `server/lib/changeset.ts`. `brand_field` and `role` are deliberately still
// outside it: a role act has its own subject types and its own closers, and the
// brand writer has no change-set executor yet. Absence refuses at validation,
// which is the fail-safe direction.
export const EXECUTABLE_ITEM_KINDS: ReadonlySet<ChangeItemKind> = new Set<ChangeItemKind>([
  "dial",
  "mint_rule",
  "weight_allocation",
  "mode_switch",
  "module_lifecycle",
]);

/** The cap a change set may not pass. A proposal is read before it is voted on. */
export const CHANGE_SET_CAP = 12;

export interface ValidateChangeSetOptions {
  /** Override what this build can execute. Defaults to `EXECUTABLE_ITEM_KINDS`. */
  executableKinds?: ReadonlySet<ChangeItemKind>;
}

export async function validateChangeSet(
  pool: Pool,
  changes: readonly ChangeInput[],
  effectiveValueOf: (key: string) => string,
  cooldownDays: number,
  readMintRules?: MintRuleReader,
  options?: ValidateChangeSetOptions,
): Promise<{ problems: ChangeSetProblem[]; normalized: ProposedChange[]; items: ChangeItem[] }> {
  const problems: ChangeSetProblem[] = [];
  const normalized: ProposedChange[] = [];
  if (!Array.isArray(changes) || changes.length === 0) {
    return { problems: [{ key: "*", problem: "A proposal must change at least one dial" }], normalized, items: [] };
  }
  if (changes.length > CHANGE_SET_CAP) {
    return {
      problems: [{ key: "*", problem: `A proposal may move at most ${CHANGE_SET_CAP} dials. Split a larger rebalance into readable steps` }],
      normalized,
      items: [],
    };
  }
  const items = changes.map(asChangeItem);
  const executable = options?.executableKinds ?? EXECUTABLE_ITEM_KINDS;
  const unbuildable = Array.from(new Set(items.map((i) => i.kind).filter((k) => !executable.has(k))));
  if (unbuildable.length > 0) {
    return {
      problems: [{
        key: "*",
        problem: `This build cannot yet carry out a change of this kind (${unbuildable.join(", ")}), so it will not take one to a vote`,
      }],
      normalized,
      items,
    };
  }
  const kinds = new Set(items.map((i) => i.kind));
  if (kinds.has("dial") && kinds.has("mint_rule")) {
    return {
      problems: [{
        key: "*",
        problem:
          "A dial changes the moment a proposal carries. A minting rule changes at the next moon. This build applies them one after the other, and a proposal should apply whole or not at all, so until it can they go up as two proposals",
      }],
      normalized,
      items,
    };
  }
  const mintKeys = items.filter((i) => i.kind === "mint_rule").map((i) => (i as MintRuleItem).key);

  /*
   * The rules this set names, read once. The pool is untouched when no mint
   * key is present, which is what keeps the dial path exactly as costly as it
   * was and lets the unit tests prove it with a throwing stub.
   */
  let mintRules = new Map<string, MintRuleValues>();
  if (mintKeys.length > 0) {
    if (!readMintRules) {
      return {
        problems: [{ key: "*", problem: "This build cannot take a minting rule to a vote from here" }],
        normalized,
        items,
      };
    }
    const ids = mintKeys.map((k) => parseMintRuleKey(k)?.ruleId).filter((id): id is string => !!id);
    mintRules = await readMintRules(Array.from(new Set(ids)));
  }

  const seen = new Set<string>();
  for (const item of items) {
    const key = String((item as DialItem | MintRuleItem).key ?? "");
    const to = String((item as DialItem | MintRuleItem).to ?? "").trim();

    if (item.kind === "mint_rule") {
      const parsed = parseMintRuleKey(key);
      if (!parsed) {
        problems.push({ key, problem: "This build cannot read that as one of the village's minting rules" });
        continue;
      }
      if (seen.has(key)) {
        problems.push({ key, problem: "The same minting rule setting appears twice in this proposal" });
        continue;
      }
      seen.add(key);
      const rule = mintRules.get(parsed.ruleId);
      if (!rule) {
        problems.push({ key, problem: "This village has no minting rule by that name" });
        continue;
      }
      const invalid = mintRuleValueProblem(parsed.field, to);
      if (invalid) {
        problems.push({ key, problem: invalid });
        continue;
      }
      const value = normalizeMintRuleValue(parsed.field, to);
      const from = currentMintRuleValue(rule, parsed.field);
      if (from === value) {
        problems.push({ key, problem: "This change would not change anything. It already has that value" });
        continue;
      }
      const cooling = await cooldownProblem(pool, key, cooldownDays, "This minting rule");
      if (cooling) {
        problems.push({ key, problem: cooling });
        continue;
      }
      normalized.push({ key, from, to: value });
      continue;
    }

    const def = VARIABLES_BY_KEY[key];
    if (!def) {
      problems.push({ key, problem: "No such dial" });
      continue;
    }
    if (seen.has(key)) {
      problems.push({ key, problem: "The same dial appears twice in this proposal" });
      continue;
    }
    seen.add(key);
    if (ringOf(def) !== "open") {
      /*
       * `governance.weight_mode` is votable now (Q8) and this is not its
       * door. Naming the door is the difference between a refusal a member
       * can act on and a wall.
       */
      problems.push({
        key,
        problem:
          key === "governance.weight_mode"
            ? "How votes are counted is not an ordinary dial change. It goes up as a mode switch, which the whole village decides at the constitutional bar"
            : "This dial is founder-held and cannot be moved by proposal",
      });
      continue;
    }
    const invalid = validateVariable(def, to);
    if (invalid) {
      problems.push({ key, problem: invalid });
      continue;
    }
    /*
     * WINDOWS LANE (19E, 20.11). Two settings have to agree with a clock the
     * registry cannot see from one value. A governance window shorter than the
     * days a ballot stays open closes that kind of proposal forever, and a
     * steward window longer than a cycle outruns the landing it counts to.
     * The registry checks the grammar; these are the cross-key rules, refused
     * when the value is SET so no village votes itself into either one.
     */
    const windowProblem = windowSettingProblem(key, to, Number(effectiveValueOf("governance.vote_days")));
    if (windowProblem) {
      problems.push({ key, problem: windowProblem });
      continue;
    }
    const from = effectiveValueOf(key);
    if (from === to) {
      problems.push({ key, problem: "This change would not change anything. It already has that value" });
      continue;
    }
    const cooling = await cooldownProblem(pool, key, cooldownDays, "This dial");
    if (cooling) {
      problems.push({ key, problem: cooling });
      continue;
    }
    normalized.push({ key, from, to });
  }

  problems.push(...mintCeilingProblems(normalized, mintRules));
  return { problems, normalized, items };
}

/** The one cooldown read, shared by both vocabularies so they cool alike. */
async function cooldownProblem(
  pool: Pool,
  key: string,
  cooldownDays: number,
  noun: string,
): Promise<string | null> {
  if (!(cooldownDays > 0)) return null;
  const [[recent]] = await pool.query<any[]>(
    "SELECT at FROM mechanics_changes WHERE config_key = ? AND source = 'governance' " +
      "AND at > (NOW() - INTERVAL ? DAY) ORDER BY at DESC LIMIT 1",
    [key, cooldownDays],
  );
  return recent
    ? `${noun} was changed by a passed proposal within the last ${cooldownDays} day(s) and is cooling down`
    : null;
}

/**
 * A rule that pays more than its own ceiling contradicts itself, and a change
 * set can build one out of two changes that are each fine alone: raise the
 * amount in one line and lower the ceiling in the next. So this runs over the
 * WHOLE normalised set with the rule's current values standing in for whatever
 * the set does not touch. `queueRuleChange` asks the same question again at
 * execution, against the row as it stands then.
 */
export function mintCeilingProblems(
  normalized: ProposedChange[],
  mintRules: Map<string, MintRuleValues>,
): ChangeSetProblem[] {
  const out: ChangeSetProblem[] = [];
  const touched = new Map<string, Partial<Record<MintRuleField, { key: string; to: string }>>>();
  for (const c of normalized) {
    const parsed = parseMintRuleKey(c.key);
    if (!parsed) continue;
    const fields = touched.get(parsed.ruleId) ?? {};
    fields[parsed.field] = { key: c.key, to: c.to };
    touched.set(parsed.ruleId, fields);
  }
  for (const [ruleId, fields] of Array.from(touched.entries())) {
    const rule = mintRules.get(ruleId);
    if (!rule) continue;
    const amountRaw = fields.amount?.to ?? currentMintRuleValue(rule, "amount");
    const ceilingRaw = fields.ceiling?.to ?? currentMintRuleValue(rule, "ceiling");
    const amount = mintRuleValueNumber("amount", amountRaw);
    const ceiling = Number(ceilingRaw);
    if (amount === null || !(ceiling > 0) || amount <= ceiling) continue;
    const at = fields.amount ?? fields.ceiling!;
    out.push({
      key: at.key,
      problem:
        `${displayMintRuleValue("amount", amountRaw)} is above the ${displayMintRuleValue("ceiling", ceilingRaw)} ` +
        "this rule is allowed to pay. Move the ceiling in the same proposal, or ask for less",
    });
  }
  return out;
}

export interface ProposerStanding {
  /** May open proposals directly. */
  qualified: boolean;
  /** May write drafts that a qualified member can sponsor open. */
  mayDraft: boolean;
  /** A warning badge denies the capability outright — no drafts either. */
  denied: boolean;
  /** Earned recognition required (0 = none) and held, for honest UI copy. */
  recognitionRequired: number;
  recognitionHeld: number;
}

/**
 * The proposer model, composed: the one gate answers WHO (stage rung, role,
 * badge — and a badge deny beats all of it), the recognition threshold
 * answers whether they have EARNED STANDING. Failing only the standing (or
 * only the stage rung) leaves the draft path open; a deny closes everything,
 * because the deny is the village's remedy for misuse.
 */
export function proposerStanding(
  hasCap: boolean,
  deniedByBadge: boolean,
  recognitionHeld: number,
  recognitionRequired: number,
  /** Admins pass every gate; that includes the earned-standing bar — a
   *  founder with zero recognition on day one must still be able to
   *  propose and to sponsor. A badge deny still beats even this. */
  isAdmin = false,
): ProposerStanding {
  if (deniedByBadge) {
    return { qualified: false, mayDraft: false, denied: true, recognitionRequired, recognitionHeld };
  }
  const meetsThreshold = isAdmin || recognitionHeld >= recognitionRequired;
  return {
    qualified: hasCap && meetsThreshold,
    mayDraft: true,
    denied: false,
    recognitionRequired,
    recognitionHeld,
  };
}

/** A stored value shown the way a voter should read it. */
export function displayChangeValue(key: string, raw: string): string {
  const parsed = parseMintRuleKey(key);
  if (parsed) return displayMintRuleValue(parsed.field, raw);
  const def = VARIABLES_BY_KEY[key];
  if (!def) return raw;
  if (def.type === "boolean") return raw === "true" || raw === "1" ? "On" : "Off";
  if (def.type === "choice") return def.choices?.find((c) => c.value === raw)?.label ?? raw;
  return def.unit ? `${raw} ${def.unit}` : raw;
}

/**
 * What a change is CALLED on the document the village freezes and reads.
 *
 * A minting rule has no registry entry to carry a label, so the label is built
 * from the rule itself and the caller has to hand the rules over. Without them
 * the key stands in, which is ugly and true. Inventing a friendly name for a
 * rule this build cannot see would be a sentence about a payment nobody
 * checked.
 */
function changeLabel(key: string, mintRules: Map<string, MintRuleValues>): string {
  const parsed = parseMintRuleKey(key);
  if (parsed) {
    const rule = mintRules.get(parsed.ruleId);
    return rule ? mintRuleLabel(rule, parsed.field) : key;
  }
  return VARIABLES_BY_KEY[key]?.label ?? key;
}

/**
 * The canonical proposal document. `[gm:<id>]` in the heading is the marker
 * a founder pastes into the Hypha proposal TITLE: it is how the bridge's
 * webhook will match the on-chain ProposalCreated event back to this row,
 * and how a human can too, today.
 */
export function proposalMarkdown(p: {
  id: string;
  title: string;
  rationale: string;
  changeSet: ProposedChange[];
  villageName: string;
  proposerName: string;
  supports: number;
  createdAt: string;
  /**
   * The minting rules this set names, when it names any. A mint change carries
   * no registry entry, so this is where its label comes from.
   */
  mintRules?: Map<string, MintRuleValues>;
}): string {
  const mintRules = p.mintRules ?? new Map<string, MintRuleValues>();
  const mints = p.changeSet.some((c) => isMintRuleKey(c.key));
  const lines: string[] = [
    `# [gm:${p.id}] ${p.title}`,
    "",
    mints
      ? `A proposal from ${p.villageName} to change what the village mints, prepared on its public Game Mechanics page.`
      : `A game-mechanics change proposal from ${p.villageName}, prepared on its public Game Mechanics page.`,
    `Proposed by ${p.proposerName} on ${p.createdAt.slice(0, 10)}; ${p.supports} member(s) supported it in-game before it came here.`,
    "",
    "## Why",
    "",
    p.rationale,
    "",
    "## The changes",
    "",
    mints ? "| what it pays for | now | proposed |" : "| dial | now | proposed |",
    "|---|---|---|",
  ];
  for (const c of p.changeSet) {
    const label = changeLabel(c.key, mintRules);
    lines.push(`| ${label} (\`${c.key}\`) | ${displayChangeValue(c.key, c.from)} | **${displayChangeValue(c.key, c.to)}** |`);
    const def = VARIABLES_BY_KEY[c.key];
    if (def && applyTimingOf(def) === "cycle-close") {
      lines.push(`| ↳ takes effect at the next cycle close, never mid-cycle | | |`);
    }
  }
  lines.push(
    "",
    mints
      ? "If this proposal passes, every change above is queued on the rule it names and takes effect at the next moon, which is how every change to a minting rule lands. Nothing is paid at a new rate inside the cycle the village is already in. Each one is recorded on the village's public amendment ledger with this proposal's reference."
      : "Every value above sits inside the bounds the platform's constitution fixes for that dial; if this proposal passes, the changes are applied exactly as listed and recorded on the village's public amendment ledger with this proposal's reference.",
    "",
    "```json",
    JSON.stringify({ marker: `gm:${p.id}`, changes: p.changeSet }, null, 2),
    "```",
    "",
  );
  return lines.join("\n");
}

export interface ProposalRow {
  id: string;
  title: string;
  rationale: string;
  changeSet: ProposedChange[];
  proposerUserId: string;
  /** `onsite_vote` and `passed_onsite` are the governance module's on-site
   *  siblings of `to_hypha` and `passed_verified` (GOV_DESIGN 2.6). */
  status:
    | "draft"
    | "open"
    | "withdrawn"
    | "to_hypha"
    | "onsite_vote"
    | "passed_claimed"
    | "passed_verified"
    | "passed_onsite"
    | "failed"
    | "applied";
  /** The conducting on-site ballot, once one opened (0089). */
  ballotId: string | null;
  hyphaRef: string | null;
  /** The numeric on-chain proposal id, linked when the founder pastes the
   *  Hypha proposal URL back. Verified outcomes match by THIS — real chain
   *  events never carry the title marker. */
  hyphaProposalId: string | null;
  hyphaProposalUrl: string | null;
  /** Whether the (marker, proposalId) link has reached the ReGen hub. */
  hubLinkSynced: boolean;
  createdAt: string;
  updatedAt: string;
}

export function rowToProposal(r: RowDataPacket): ProposalRow {
  const raw = typeof r.change_set === "string" ? JSON.parse(r.change_set) : r.change_set;
  return {
    id: String(r.id),
    title: String(r.title),
    rationale: String(r.rationale),
    changeSet: Array.isArray(raw) ? raw : [],
    proposerUserId: String(r.proposer_user_id),
    status: r.status,
    ballotId: r.ballot_id ?? null,
    hyphaRef: r.hypha_ref ?? null,
    hyphaProposalId: r.hypha_proposal_id ?? null,
    hyphaProposalUrl: r.hypha_proposal_url ?? null,
    hubLinkSynced: Boolean(r.hub_link_synced),
    createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
    updatedAt: r.updated_at instanceof Date ? r.updated_at.toISOString() : String(r.updated_at),
  };
}

/**
 * Pull the numeric on-chain proposal id out of whatever the founder pastes:
 * a full Hypha app URL (the id is the last numeric path segment, query and
 * hash tolerated) or the bare number itself. Null when nothing numeric is
 * there — the caller should ask again rather than guess.
 */
export function parseHyphaProposalId(input: string): string | null {
  const s = String(input ?? "").trim();
  if (/^\d{1,40}$/.test(s)) return s;
  try {
    const url = new URL(s);
    const segments = url.pathname.split("/").filter(Boolean);
    for (let i = segments.length - 1; i >= 0; i--) {
      if (/^\d{1,40}$/.test(segments[i])) return segments[i];
    }
  } catch {
    /* not a URL either */
  }
  return null;
}

export async function proposalById(pool: Pool, id: string): Promise<ProposalRow | null> {
  const [rows] = await pool.query<RowDataPacket[]>("SELECT * FROM mechanics_proposals WHERE id = ?", [id]);
  return rows[0] ? rowToProposal(rows[0]) : null;
}

export async function backerCounts(
  pool: Pool,
  proposalIds: string[],
): Promise<Map<string, { supports: number; sponsors: string[] }>> {
  const out = new Map<string, { supports: number; sponsors: string[] }>();
  if (proposalIds.length === 0) return out;
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT proposal_id, user_id, kind FROM mechanics_proposal_backers WHERE proposal_id IN (${proposalIds.map(() => "?").join(",")})`,
    proposalIds,
  );
  for (const r of rows) {
    const id = String(r.proposal_id);
    const entry = out.get(id) ?? { supports: 0, sponsors: [] };
    if (r.kind === "support") entry.supports += 1;
    else entry.sponsors.push(String(r.user_id));
    out.set(id, entry);
  }
  return out;
}

/** Proposals a member opened this cycle, for the per-cycle rate limit. */
export async function proposalsOpenedSince(pool: Pool, userId: string, since: Date): Promise<number> {
  const [[row]] = await pool.query<any[]>(
    "SELECT COUNT(*) AS n FROM mechanics_proposals WHERE proposer_user_id = ? AND created_at > ?",
    [userId, since],
  );
  return Number(row.n);
}
