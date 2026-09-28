/**
 * THE DECISION MATRIX, THE PLATFORM'S HALF (plan 2.3 and 7 item 3; 2026-09-27).
 *
 * The Governance Canvas asks a village to write down, for each kind of
 * decision, who approves it, who is consulted, who is told and by what method
 * it is made. For the decisions this platform itself conducts, the honest
 * answer already exists: it is the code that conducts them. So this file does
 * not ask anybody. It reads the same constants and the same functions the
 * routes read when they open, price, time and land a decision, and writes
 * each answer down as the canvas's five columns.
 *
 * ── REUSED, NEVER RESTATED ─────────────────────────────────────────────────
 *
 * Every number here comes from a function a route already calls:
 *
 *   the bar a vote clears   `thresholdsFor` (shared/ballotSubjects.ts), the
 *                           helper its own header says the preview, the route
 *                           that stamps and the page that explains must share.
 *                           It reads SUBJECT_THRESHOLDS, then TIER_FLOORS
 *                           (shared/governanceEngine.ts) through the village's
 *                           raise-only tier settings.
 *   the method              `villageBallotMethod` over governance.default_method,
 *                           and a subject's own fixed method over that.
 *   the window and the stop `executesAtPassWithNoWindow`, `isSeatSubject`,
 *                           `kindOfSubject`, `vetoHoursFrom` and
 *                           `carriesChangeSet` (shared/governanceKinds.ts). The
 *                           steward's reach itself is parsed on the server
 *                           (server/lib/stewardship.ts) and handed in, so this
 *                           file holds no second reading of those settings.
 *   the powers              HANDOVER_SET and CAPABILITY_LABELS
 *                           (shared/capabilities.ts), and whoever holds each
 *                           one, counted by the server the way the gate counts.
 *
 * The governance document generator (scripts/generate-governance-doc.mjs)
 * derives some of the same tables. It reads the sources as text at build time
 * and prints Markdown, so nothing in it can run here; what this file shares
 * with it is the source it reads, which is the point.
 *
 * ── THE HONESTY RULES (plan 2.3), EACH HELD BY A TEST ──────────────────────
 *
 *  1. `governance.sensing_days` is shown as NOT ENFORCED. Nothing reads it but
 *     a display. The gate a proposal actually meets is its supporter count,
 *     `governance.proposal_support_threshold`, which ships at 0.
 *  2. The votes that move a power or a seat are shown with NO TIER FLOOR,
 *     because none is applied: those routes price on the village's own dials.
 *  3. THE VETO OVERRIDE IS NEVER SHOWN AS AVAILABLE. The landing loop has a
 *     rule for one, and nothing in this build writes the link it reads
 *     (`isOverride` in server/lib/applyDue.ts), so it is unreachable.
 *  4. RISK TAGS ARE INFORMATION, NEVER LAW. A row may carry them, and no tag
 *     changes an approval, a consultation or a method.
 *
 * ── NO PERSON'S NAME, NO SCORE ─────────────────────────────────────────────
 *
 * The inputs carry role names and head counts, never a member's name, so no
 * row can name one. And nothing here is combined across rows: no count of
 * powers handed over, no share of anything. The matrix says who decides; it
 * does not grade the village.
 */
import {
  GOVERNANCE_MODE,
  MINT_RULE,
  SUBJECT_THRESHOLDS,
  thresholdsFor,
  thresholdsForSubject,
  VILLAGE_LAUNCH,
  type ThresholdSettings,
} from "./ballotSubjects";
import { CAPABILITY_LABELS, HANDOVER_SET, type Capability } from "./capabilities";
import {
  CRITICALITIES,
  villageBallotMethod,
  type BallotMethod,
  type Criticality,
  type MethodDials,
} from "./governanceEngine";
import {
  carriesChangeSet,
  executesAtPassWithNoWindow,
  isSeatSubject,
  kindOfSubject,
  vetoHoursFrom,
} from "./governanceKinds";
import { GPS_CHANGE } from "./governingPurpose";
import { CYCLE_SETTLEMENT } from "./moonSettlement";

// ── The shape ──────────────────────────────────────────────────────────────

/** The three groups the rows come in, in the order the page shows them. */
export const DECISION_MATRIX_GROUPS = ["votes", "moving-power", "powers"] as const;
export type DecisionMatrixGroupId = (typeof DECISION_MATRIX_GROUPS)[number];

/** The canvas's six risks. A row may carry any of them, as information only. */
export const RISK_TAGS = ["impact", "budget", "hiring", "partners", "reputation", "strategy"] as const;
export type RiskTag = (typeof RISK_TAGS)[number];

/**
 * Who approves, as one of the answers the code can give.
 *
 *   roll         the members frozen onto the ballot when it opens
 *   hypha        the village's Hypha space, off this platform
 *   holder       whoever is seated in a role that carries the power
 *   admin-panel  admins and founders, before the village takes the power on
 *   founder      the founder, who keeps the purpose statement's pen
 *   not-yet      nobody can, because the vote cannot be held yet
 */
export type ApprovalWho = "roll" | "hypha" | "holder" | "admin-panel" | "founder" | "not-yet";

/** How a decision is made: a ballot method, a Hypha vote, or a power someone holds. */
export type MethodKind = BallotMethod | "hypha" | "held";

/**
 * What raised a vote's bar above the village's own dials. `subject` is a floor
 * the decision carries itself; a tier names the criticality floor; `none` is
 * the village's dials and nothing else.
 */
export type TierFloor = Criticality | "subject" | "none";

/**
 * Whether a steward can stop this once the village has carried it.
 *
 *   in-reach        yes, inside the window before it lands
 *   nobody-seated   it is in reach, and no steward is seated to use it
 *   out-of-reach    the village has not put it in a steward's reach
 *   no-window       it takes effect the moment it carries
 *   seat            a seating or unseating, which no steward may stop
 *   while-open      a token send: a steward's no while it is open stops it
 *   not-applicable  held powers, and votes decided off this platform
 */
export type StewardStop =
  | "in-reach"
  | "nobody-seated"
  | "out-of-reach"
  | "no-window"
  | "seat"
  | "while-open"
  | "not-applicable";

export interface DecisionMatrixRow {
  /** Stable across reads: `vote:<subject>`, `vote:mechanics:<tier>`, `move:<subject>`, `power:<capability>`. */
  key: string;
  group: DecisionMatrixGroupId;
  /** The canvas's first column. */
  decision: string;
  /** One line under the decision, where the platform has one. */
  detail: string | null;
  approval: { who: ApprovalWho; text: string };
  consultation: string[];
  information: string[];
  method: {
    kind: MethodKind;
    /** The bar a vote freezes, or null where no vote is held on this platform. */
    unityPct: number | null;
    quorumPct: number | null;
    tierFloor: TierFloor | null;
    lines: string[];
  };
  stewardStop: StewardStop;
  /** Information the village attached. Never read by anything above. */
  riskTags: RiskTag[];
}

export interface DecisionMatrixGroup {
  id: DecisionMatrixGroupId;
  title: string;
  intro: string;
  rows: DecisionMatrixRow[];
}

export interface DecisionMatrix {
  groups: DecisionMatrixGroup[];
  /** Sentences the page shows under the matrix, the honesty rules among them. */
  notes: string[];
  /** Rule 1, as data: the window's number, and that nothing enforces it. */
  sensing: { days: number; enforced: false; supportThreshold: number };
  /** Rule 3, as data. There is no input that makes this true. */
  vetoOverrideAvailable: false;
}

// ── What the caller hands in ───────────────────────────────────────────────

/** One transferable power, as the server reads it today. */
export interface PowerHolding {
  capability: Capability;
  /** Whether `capability_holding` has a row for it: the village has taken it on. */
  villageHolds: boolean;
  /** The role named on that row, or null (none, or the role was deleted). */
  holderRoleName: string | null;
  /** People who can act on it today, counted the gate's way, leaving the admin short-circuit out. */
  liveHolders: number;
  /** The roles whose capability list carries it, by name. */
  rolesCarrying: readonly string[];
  /** The power's heading on the Powers page, where the platform has one. */
  title?: string;
}

/**
 * The steward's reach, read by the server through server/lib/stewardship.ts
 * (`mayVeto` over governance.steward_subjects, `stewardVetoTiersFrom` over
 * governance.steward_veto_tiers) and handed in as answers.
 */
export interface StewardReach {
  /** How many are seated in a live seat carrying `steward.veto`. */
  seated: number;
  /** governance.steward_council: a stop takes a majority of the seated stewards. */
  council: boolean;
  /** governance.veto_hours, raw. `vetoHoursFrom` floors it the way the landing loop does. */
  vetoHoursRaw: unknown;
  subjectInReach(subjectType: string): boolean;
  tiersInReach: ReadonlySet<Criticality>;
}

export interface DecisionMatrixInputs {
  /** governance.default_method, raw. */
  defaultMethod: string;
  /** governance.unity_pct and governance.quorum_pct. */
  village: MethodDials;
  /** `thresholdSettingsFrom(...)` over the village's settings. Absent means the registry's floors. */
  settings?: ThresholdSettings;
  /** The governance module is at `members` or above, which is what lets a member vote at all. */
  governanceOnForMembers: boolean;
  /** governance.proposal_support_threshold, already floored at 0. */
  supportThreshold: number;
  /** governance.sensing_days. */
  sensingDays: number;
  steward: StewardReach;
  /** Every transferable power has left the founding seat (`villageHandoverState`). */
  handoverComplete: boolean;
  powers: readonly PowerHolding[];
  /** Risk tags by row key. Information only; see rule 4. */
  riskTags?: Readonly<Record<string, readonly string[]>>;
}

// ── The words ──────────────────────────────────────────────────────────────

/**
 * What each subject the platform prices is, in a member's words. Keyed by the
 * same constants SUBJECT_THRESHOLDS is keyed by, and a test fails when a
 * subject there has no line here, so a new subject cannot arrive as its key.
 */
export const SUBJECT_DECISIONS: Readonly<Record<string, string>> = {
  [VILLAGE_LAUNCH]: "Starting the Game: the Birthing",
  [MINT_RULE]: "Changing what the village mints",
  [GOVERNANCE_MODE]: "Changing how votes are weighed",
  [CYCLE_SETTLEMENT]: "Settling a moon and releasing its pool",
  [GPS_CHANGE]: "Changing the governing purpose statement",
};

/** The votes that move a power or a seat, which carry no floor of their own. */
export const MOVING_DECISIONS: Readonly<Record<string, string>> = {
  power_transfer: "Handing a power from the admin panel to a role",
  power_grant: "Giving a role a power it does not carry yet",
  power_return: "Handing a power back to the admin panel",
  role_seat: "Seating somebody in a role",
  role_unseat: "Taking somebody out of a seat",
};

/** The three power votes. Every ceremony among them refuses an opener whose only path is an admin account. */
const POWER_MOVES: readonly string[] = ["power_transfer", "power_grant", "power_return"];

/** The size of a change to the Game's rules, in the engine's own words (governanceEngine.ts, above CRITICALITIES). */
const TIER_WORDS: Readonly<Record<Criticality, { decision: string; detail: string }>> = {
  routine: {
    decision: "A routine change to the Game's rules",
    detail: "A number the village tunes while it plays.",
  },
  structural: {
    decision: "A structural change to the Game's rules",
    detail: "It changes how the village decides or who belongs.",
  },
  constitutional: {
    decision: "A constitutional change to the Game's rules",
    detail: "It changes the rules for changing the rules.",
  },
};

const GROUP_WORDS: Readonly<Record<DecisionMatrixGroupId, { title: string; intro: string }>> = {
  votes: {
    title: "What the village decides by vote",
    intro: "Each of these is a vote, and the platform sets the least it has to clear.",
  },
  "moving-power": {
    title: "Moving a power or a seat",
    intro: "The votes that hand a power to a role, take it back, or change who sits where.",
  },
  powers: {
    title: "Powers a person holds for the village",
    intro: "Whoever holds one of these acts on it directly, with no vote.",
  },
};

/** Why a stop cannot be overridden, as the page says it. Rule 3. */
export const VETO_OVERRIDE_NOTE =
  "A steward's stop cannot be overturned by a later vote in this build. The rules describe a way to do it, and nothing here can reach it yet.";

/** Rule 4, as the page says it, whenever a row carries a tag. */
export const RISK_TAG_NOTE =
  "A risk tag is information for the village. It never changes who decides, who is asked or what a vote needs.";

/** What the page says about where this half comes from. */
export const GENERATED_NOTE =
  "The platform fills in this half from the rules it enforces, as this village has them set today. It cannot be edited here.";

/** The two words every vote row uses. */
export const DIALS_NOTE =
  "Quorum is how much of the roll's voting weight has to take part. Unity is how much of what is cast has to say yes. Both count out of 100.";

/** Rule 1, as the page says it. */
export function sensingNote(days: number, supportThreshold: number): string {
  const gate =
    supportThreshold > 0
      ? `The gate a proposal meets is its supporter count, which is ${supporters(supportThreshold)} here.`
      : "The gate a proposal meets is its supporter count, which is 0 here, and 0 turns that gate off.";
  return `The sensing window (${days} ${days === 1 ? "day" : "days"}) is shown on proposals and enforced nowhere. ${gate}`;
}

function supporters(n: number): string {
  return `${n} ${n === 1 ? "supporter" : "supporters"}`;
}

function quorumWords(q: number): string {
  return q > 0 ? `quorum ${q}` : "no quorum";
}

/** The bar a ballot of this method freezes, in one sentence. Mirrors `evaluateBallot`. */
function barLine(method: BallotMethod, d: MethodDials): string {
  switch (method) {
    case "consent":
      return `Consent, with ${quorumWords(d.quorumPct)}: it carries while no objection is standing.`;
    case "majority":
      return `Majority, with ${quorumWords(d.quorumPct)}: more than half of the votes cast say yes.`;
    case "consensus":
      return `Consensus, with ${quorumWords(d.quorumPct)}: nobody votes no, and somebody votes yes.`;
    default:
      return `The village's own dials: ${quorumWords(d.quorumPct)} and unity ${d.unityPct}.`;
  }
}

function floorLine(floor: TierFloor): string {
  if (floor === "none") return "No tier floor: the village's own dials set the bar.";
  if (floor === "subject") return "This decision carries a floor of its own. The village can raise it and never lower it.";
  if (floor === "routine") return "The routine tier asks nothing above the village's own dials.";
  return `The ${floor} tier's floor applies. The village can raise it and never lower it.`;
}

function listWords(items: readonly string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

// ── The rules the rows are built from ──────────────────────────────────────

/** What raised this subject's bar: its own floor, its tier's, or nothing. */
export function tierFloorOf(subject: string, tier?: Criticality): TierFloor {
  if (tier) return tier;
  const t = thresholdsForSubject(subject);
  if (!t) return "none";
  if (t.criticality) return t.criticality;
  return t.minUnityPct > 0 || t.minQuorumPct > 0 ? "subject" : "none";
}

/**
 * The size a steward's reach judges this decision at, read the way
 * `outOfStewardTierReach` in server/lib/applyDue.ts reads it: from the
 * elements of the change set, each priced by `pricingOf` in
 * server/lib/mechanics.ts, and `routine` for a subject with no change set.
 *
 * So a vote-mode switch, priced at the constitutional bar to pass, counts as
 * routine here, because it reaches the landing loop with no elements. That is
 * the code as it stands, and the matrix shows it.
 */
export function stewardReachTierOf(subject: string, tier?: Criticality): Criticality {
  if (!carriesChangeSet(subject)) return "routine";
  return tier ?? thresholdsForSubject(subject)?.criticality ?? "routine";
}

/**
 * Where a change-set proposal is decided, as `mechanicsGovernanceFacts` in
 * server/index.ts decides it: on this platform only while the governance
 * module is on for members AND the village does not take its rule changes to
 * Hypha. A subject with no change set has no Hypha leg, and is held here.
 */
function decidedOnHypha(subject: string, inp: DecisionMatrixInputs): boolean {
  if (!carriesChangeSet(subject)) return false;
  return !inp.governanceOnForMembers || villageBallotMethod(inp.defaultMethod) === "hypha";
}

function stewardStopOf(
  subject: string,
  inp: DecisionMatrixInputs,
  tier?: Criticality,
): { stop: StewardStop; lines: string[] } {
  const hours = vetoHoursFrom(inp.steward.vetoHoursRaw);
  if (executesAtPassWithNoWindow(subject)) {
    return { stop: "no-window", lines: ["No steward can stop it: it takes effect the moment it carries."] };
  }
  if (isSeatSubject(subject)) {
    return {
      stop: "seat",
      lines: [`It waits at least ${hours} hours before it lands, and no steward can stop a seating or an unseating.`],
    };
  }
  if (kindOfSubject(subject) === "token_send") {
    return { stop: "while-open", lines: ["A seated steward stops it by voting no while it is open."] };
  }
  const reachTier = stewardReachTierOf(subject, tier);
  if (!inp.steward.subjectInReach(subject)) {
    return {
      stop: "out-of-reach",
      lines: ["This village has not put this kind of decision in a steward's reach, so nobody can stop it once it carries."],
    };
  }
  if (!inp.steward.tiersInReach.has(reachTier)) {
    const reach = CRITICALITIES.filter((c) => inp.steward.tiersInReach.has(c));
    const why = carriesChangeSet(subject)
      ? `This one counts as ${reachTier}.`
      : `Only a change to the Game's rules carries a size for this check, so this one counts as routine.`;
    const covers = reach.length
      ? `A steward's reach covers ${listWords(reach)} decisions.`
      : "This village lets no steward stop anything.";
    return { stop: "out-of-reach", lines: [`${covers} ${why} Nobody can stop it once it carries.`] };
  }
  const council = inp.steward.council ? " With the council switch on, a stop takes a majority of the seated stewards." : "";
  if (inp.steward.seated === 0) {
    return {
      stop: "nobody-seated",
      lines: [`A steward could stop it inside the window before it lands, and no steward is seated today.${council}`],
    };
  }
  return {
    stop: "in-reach",
    lines: [
      `A seated steward can stop it inside the window before it lands, at least ${hours} hours after the vote closes, and has to say why.${council}`,
    ],
  };
}

function riskTagsFor(key: string, inp: DecisionMatrixInputs): RiskTag[] {
  const given = inp.riskTags?.[key] ?? [];
  return RISK_TAGS.filter((t) => given.includes(t));
}

// ── The rows ───────────────────────────────────────────────────────────────

/** One vote the platform conducts, or sends to Hypha. */
function voteRow(
  key: string,
  group: DecisionMatrixGroupId,
  subject: string,
  decision: string,
  detail: string | null,
  inp: DecisionMatrixInputs,
  tier?: Criticality,
): DecisionMatrixRow {
  const changeSet = carriesChangeSet(subject);
  const consultation: string[] = [];
  if (changeSet) {
    consultation.push(
      inp.supportThreshold > 0
        ? `A proposal needs ${supporters(inp.supportThreshold)} before it can go to the vote.`
        : "A proposal needs no supporters before it goes to the vote: the supporter count is 0, which turns that gate off.",
    );
    consultation.push(
      `The sensing window says ${inp.sensingDays} ${inp.sensingDays === 1 ? "day" : "days"}, and nothing enforces it.`,
    );
  }
  if (POWER_MOVES.includes(subject)) {
    consultation.push("A member opens it. An administrator account on its own cannot.");
  }

  if (decidedOnHypha(subject, inp)) {
    const why = inp.governanceOnForMembers
      ? "This village takes its rule changes to Hypha."
      : "The governance module is not on for members, so rule changes go to Hypha.";
    return {
      key,
      group,
      decision,
      detail,
      approval: { who: "hypha", text: `The vote in the village's Hypha space. ${why}` },
      consultation,
      information: ["Once it passes there and is applied here, each change is written on the village's public amendment ledger."],
      method: { kind: "hypha", unityPct: null, quorumPct: null, tierFloor: null, lines: ["Hypha's own vote, off this platform."] },
      stewardStop: "not-applicable",
      riskTags: riskTagsFor(key, inp),
    };
  }

  const villageMethod = villageBallotMethod(inp.defaultMethod);
  const base: BallotMethod = villageMethod === "hypha" ? "custom" : villageMethod;
  const bar = thresholdsFor({ subjects: [subject], criticality: tier }, base, inp.village, inp.settings);
  const conducts: BallotMethod = bar.method ?? base;
  const floor = tierFloorOf(subject, tier);

  if (conducts === "consent") {
    consultation.push(
      "Anyone on the roll can raise an objection while the vote is open, and it carries only if none is still standing when it closes.",
    );
  }
  const stop = stewardStopOf(subject, inp, tier);
  consultation.push(...stop.lines);
  if (changeSet && tier) consultation.push("A change to a steward's own limits can never be stopped by a steward.");

  const methodLines = [barLine(conducts, bar), floorLine(floor)];
  if (bar.method) methodLines.push("It always runs on these numbers, whatever method the village uses for its other votes.");
  if (changeSet && tier) methodLines.push("A change that moves a voting bar also costs at least the bar it moves.");
  if (villageMethod === "hypha" && !bar.method) {
    methodLines.push("This village takes its rule changes to Hypha. This one has no Hypha leg, so it is decided here on the village's own dials.");
  }
  if (bar.warning) methodLines.push(bar.warning);

  let approval: DecisionMatrixRow["approval"];
  if (subject === GPS_CHANGE && !inp.handoverComplete) {
    approval = {
      who: "founder",
      text: "The founder, who writes the statement until every transferable power has left the founding seat. Until then this vote cannot be opened.",
    };
  } else if (!inp.governanceOnForMembers) {
    approval = { who: "not-yet", text: "Nobody yet. The governance module is not on for members, so this vote cannot be held." };
  } else {
    approval = { who: "roll", text: rollText(subject) };
  }

  const information: string[] = [];
  if (approval.who !== "roll") {
    information.push("Nothing is announced until the vote can be held.");
  } else {
    information.push("Everyone on the roll is told when it opens, when it is closing with their vote still owed, and how it closed.");
    if (stop.stop !== "no-window" && stop.stop !== "while-open") {
      information.push(
        inp.steward.seated > 0
          ? "The seated stewards are told when it carries, halfway through the window, and two hours before it lands."
          : "Stewards are told when it carries, halfway through the window and two hours before it lands. No steward is seated today, so nobody gets these.",
      );
    }
    information.push(
      changeSet
        ? "The new-moon digest lists each change that landed, in the words it was applied with, and anything a steward stopped."
        : "The new-moon digest counts it with the moon's other votes, and lists it if a steward stopped it.",
    );
    if (changeSet) information.push("Each change is written on the village's public amendment ledger with the proposal's reference.");
  }

  return {
    key,
    group,
    decision,
    detail,
    approval,
    consultation,
    information,
    method: { kind: conducts, unityPct: bar.unityPct, quorumPct: bar.quorumPct, tierFloor: floor, lines: methodLines },
    stewardStop: stop.stop,
    riskTags: riskTagsFor(key, inp),
  };
}

/** Who a subject's roll is, with the extra floors the registry puts on it. */
function rollText(subject: string): string {
  const t = thresholdsForSubject(subject);
  const extra: string[] = [];
  if (t && t.minElectorate > 0) extra.push(`at least ${t.minElectorate} people on it`);
  if (t?.everySeatWeighs) extra.push("every seat carrying weight");
  if (t?.minYesHeads === "all") extra.push("every one of them voting yes");
  else if (typeof t?.minYesHeads === "number" && t.minYesHeads > 0) extra.push(`at least ${t.minYesHeads} of them voting yes`);
  const base = "The roll: the members frozen onto the ballot when it opens";
  return extra.length ? `${base}, with ${listWords(extra)}.` : `${base}.`;
}

/** One transferable power, as the gate answers for it today. */
function powerRow(cap: Capability, p: PowerHolding | undefined, inp: DecisionMatrixInputs): DecisionMatrixRow {
  const key = `power:${cap}`;
  const holding: PowerHolding = p ?? { capability: cap, villageHolds: false, holderRoleName: null, liveHolders: 0, rolesCarrying: [] };
  const role = holding.holderRoleName ? holding.holderRoleName : "a role that no longer exists";

  let approval: DecisionMatrixRow["approval"];
  if (!holding.villageHolds) {
    const alsoRoles = holding.rolesCarrying.length ? ` So does anyone seated in ${listWords(holding.rolesCarrying)}.` : "";
    approval = {
      who: "admin-panel",
      text: `The admin panel: admins and founders act on it, because the village has not taken it on.${alsoRoles}`,
    };
  } else if (holding.liveHolders > 0) {
    approval = {
      who: "holder",
      text: `The village holds it, with ${role}. Whoever is seated in a role that carries it acts on it, and an admin who is not seated there cannot.`,
    };
  } else {
    approval = {
      who: "roll",
      text: `The village holds it, with ${role}, and nobody is seated there today. So the village decides by vote: it seats somebody, or it moves the power.`,
    };
  }

  const consultation = ["Nobody has to be asked first. Whoever holds it acts on their own judgement."];
  if (cap === "dial.set") consultation.push("Any member can propose a change to any dial, whoever holds this.");
  if (cap === "redemption.confirm" && holding.liveHolders === 0) {
    consultation.push("With nobody holding it, each redemption goes to a village vote.");
  }

  const information = ["Every member can see who looks after it on the Powers page."];
  if (holding.villageHolds) {
    information.push("If a founder seated as a steward acts past the holder, the village gets a public record of it.");
  }

  const lines = [
    "Held: whoever holds it acts, with no vote.",
    "Moving it is a village vote, to a role or back to the admin panel, on the village's own dials with no tier floor.",
  ];
  if (cap === "steward.veto") lines.push("The steward's seat is filled and emptied only by a village vote. No admin route moves it.");

  return {
    key,
    group: "powers",
    decision: CAPABILITY_LABELS[cap],
    detail: holding.title ?? null,
    approval,
    consultation,
    information,
    method: { kind: "held", unityPct: null, quorumPct: null, tierFloor: null, lines },
    stewardStop: "not-applicable",
    riskTags: riskTagsFor(key, inp),
  };
}

// ── The generator ──────────────────────────────────────────────────────────

/**
 * THE PLATFORM'S HALF OF THE DECISION MATRIX, from the village's live
 * settings. Pure: the server reads the settings and the holdings and hands
 * them in; a test hands in its own.
 */
export function generateDecisionMatrix(inp: DecisionMatrixInputs): DecisionMatrix {
  const votes: DecisionMatrixRow[] = [];
  for (const tier of CRITICALITIES) {
    votes.push(voteRow(`vote:mechanics:${tier}`, "votes", "mechanics", TIER_WORDS[tier].decision, TIER_WORDS[tier].detail, inp, tier));
  }
  for (const subject of Object.keys(SUBJECT_THRESHOLDS)) {
    votes.push(
      voteRow(
        `vote:${subject}`,
        "votes",
        subject,
        SUBJECT_DECISIONS[subject] ?? subject,
        SUBJECT_THRESHOLDS[subject].why,
        inp,
      ),
    );
  }

  const moving: DecisionMatrixRow[] = Object.keys(MOVING_DECISIONS).map((subject) =>
    voteRow(`move:${subject}`, "moving-power", subject, MOVING_DECISIONS[subject], null, inp),
  );

  const byCap = new Map(inp.powers.map((p) => [p.capability, p]));
  const powers = HANDOVER_SET.map((cap) => powerRow(cap, byCap.get(cap), inp));

  const groups: DecisionMatrixGroup[] = [
    { id: "votes", ...GROUP_WORDS.votes, rows: votes },
    { id: "moving-power", ...GROUP_WORDS["moving-power"], rows: moving },
    { id: "powers", ...GROUP_WORDS.powers, rows: powers },
  ];

  const notes = [GENERATED_NOTE, DIALS_NOTE, sensingNote(inp.sensingDays, inp.supportThreshold), VETO_OVERRIDE_NOTE];
  if (groups.some((g) => g.rows.some((r) => r.riskTags.length > 0))) notes.push(RISK_TAG_NOTE);

  return {
    groups,
    notes,
    sensing: { days: inp.sensingDays, enforced: false, supportThreshold: inp.supportThreshold },
    vetoOverrideAvailable: false,
  };
}
