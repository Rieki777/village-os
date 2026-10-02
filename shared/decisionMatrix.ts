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
 * ── A VOTE IS NOT ALWAYS THE ONLY DOOR (review of 2026-09-27) ──────────────
 *
 * Some decisions the village votes on can also be made from the admin panel
 * with no vote, and a matrix that named only the vote would say the village
 * decides alone where it does not. Each such door is named in the Approval
 * column beside the vote, from the route that opens it:
 *
 *   a moon's settlement   POST /api/admin/cycles/close settles every moon that
 *                         has ended, one the village voted down included, and
 *                         on cycle.settlement_mode "manual" it is the only way
 *   a minting rule        PATCH /api/admin/economy/rules/:id, until the Game
 *                         starts (`readGameStart`)
 *   giving a role a power PUT /api/admin/roles/:id/capabilities, any time,
 *                         every power but the steward's veto
 *   seating, unseating    POST /api/admin/roles/:id/holders, for whoever acts
 *                         on `proposal.decide`, outside the steward's seat
 *
 * `approval.who` names who decides the vote itself; `approval.text` names the
 * vote and then every door beside it.
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
import { ringOf, VARIABLES, VARIABLES_BY_KEY } from "./gameVariables";
import { GPS_CHANGE } from "./governingPurpose";
import { CONFLICT_AGREEMENT } from "./conflictAgreement";
import { CYCLE_SETTLEMENT, type SettlementMode } from "./moonSettlement";

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
 *   not-yet      no vote, because the vote cannot be held yet
 *   nobody       nobody can act on it today (the steward's veto with no steward seated)
 *
 * It names who decides the vote or holds the power. A door beside the vote,
 * such as the admin panel's, is named in the approval's text.
 */
export type ApprovalWho = "roll" | "hypha" | "holder" | "admin-panel" | "founder" | "not-yet" | "nobody";

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
    /**
     * The bar a vote freezes, or null where no vote is held on this platform.
     * Unity is also null under majority, consensus and consent, which decide
     * agreement by their own rule and never read the number.
     */
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
  /** cycle.settlement_mode, through `settlementModeFrom`: whether a moon's end opens a vote at all. */
  settlementMode: SettlementMode;
  /** The Game has started (`readGameStart`). Until it does, the admin panel edits minting rules directly. */
  gameStarted: boolean;
  /** governance.auto_apply_enabled: the founder-held switch that lands carried decisions. */
  autoApplyEnabled: boolean;
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
  [CONFLICT_AGREEMENT]: "Changing the conflict agreement",
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

/**
 * THE DOORS BESIDE A VOTE, as the page says them. Each names a route that
 * makes the same decision with no vote; the header above lists them.
 */
export const MOON_CLOSE_DOOR =
  "An administrator can also settle every moon that has ended from the Cycles desk, with no vote: one whose vote is still open, one the village voted down and one a steward stopped included. When a moon the village refused is paid this way, the admin trail records it.";
export const MINT_EDITOR_DOOR =
  "Until the Game starts, an administrator can also change a minting rule directly from the admin panel, with no vote. The admin trail records each change.";
export const GRANT_DOOR =
  "An administrator can also give a role a power directly from the admin panel, with no vote, and the village's pulse says so. The steward's veto, and the role that carries it, are the only ones that door cannot touch.";

/** The power that seats people from the admin panel's holders route, in the label the Powers page uses. */
const DECIDE: Capability = "proposal.decide";
const decidePower = (): string => {
  const label = CAPABILITY_LABELS[DECIDE];
  return `the power to ${label.charAt(0).toLowerCase()}${label.slice(1)}`;
};

/**
 * Who can seat or unseat with no vote, as POST /api/admin/roles/:id/holders
 * answers: whoever acts on `proposal.decide` (the admin panel until the village
 * takes that on), outside the steward's seat. A person who is not an
 * administrator may not seat themselves, may not seat somebody above their own
 * powers, and may not unseat anybody.
 */
export function seatDoor(subject: "role_seat" | "role_unseat", decideHeldByVillage: boolean): string {
  const power = decidePower();
  if (subject === "role_seat") {
    return decideHeldByVillage
      ? `Whoever holds ${power} can also seat somebody in any role but the steward's, with no vote: never themselves, and only in a role whose powers they hold, unless they are also an administrator.`
      : `An administrator can also seat anybody in any role but the steward's, with no vote, themselves included. So can anyone else who holds ${power}: never themselves, and only in a role whose powers they hold.`;
  }
  return decideHeldByVillage
    ? `An administrator who also holds ${power} can take somebody out of any seat but the steward's, with no vote.`
    : "An administrator can also take somebody out of any seat but the steward's, with no vote.";
}

/**
 * Votes whose opener sends the roll no notice when it opens
 * (server/routes/governanceMode.ts and server/routes/governingPurpose.ts call
 * no `notifyRoll`). A test reads both files, so the day either starts sending
 * one, this list has to lose it.
 */
export const OPENED_WITHOUT_NOTICE: Readonly<Record<string, string>> = {
  [GOVERNANCE_MODE]: "Nobody is sent a notice when it opens.",
  [GPS_CHANGE]: "Nobody is sent a notice when it opens. The village's pulse says that it has.",
};

/** The founder-held switch that lands carried decisions, by the name the settings page gives it. */
export function applySwitchNote(on: boolean): string {
  const name = VARIABLES_BY_KEY["governance.auto_apply_enabled"]?.label ?? "Apply verified proposals automatically";
  return on
    ? `The founder-held setting "${name}" is on. While it is off, every carried decision that waits for its window is held, and each window opens again when it comes back on.`
    : `The founder-held setting "${name}" is off, so every carried decision that waits for its window is held until it is switched back on.`;
}

function supporters(n: number): string {
  return `${n} ${n === 1 ? "supporter" : "supporters"}`;
}

function quorumWords(q: number): string {
  return q > 0 ? `quorum ${q}` : "no quorum";
}

function sameDials(a: MethodDials, b: MethodDials): boolean {
  return a.unityPct === b.unityPct && a.quorumPct === b.quorumPct;
}

/**
 * The bar a ballot of this method freezes, in one sentence. Mirrors
 * `evaluateBallot`. "The village's own dials" is said only when the numbers
 * ARE the village's governance.unity_pct and governance.quorum_pct; a bar a
 * floor raised is called what it is, the numbers the vote freezes.
 */
function barLine(method: BallotMethod, bar: MethodDials, village: MethodDials): string {
  switch (method) {
    case "consent":
      return `Consent, with ${quorumWords(bar.quorumPct)}: it carries while no objection is standing.`;
    case "majority":
      return `Majority, with ${quorumWords(bar.quorumPct)}: more than half of the votes cast say yes.`;
    case "consensus":
      return `Consensus, with ${quorumWords(bar.quorumPct)}: nobody votes no, and somebody votes yes.`;
    default:
      return sameDials(bar, village)
        ? `The village's own dials: ${quorumWords(bar.quorumPct)} and unity ${bar.unityPct}.`
        : `Counted on the numbers this vote freezes: ${quorumWords(bar.quorumPct)} and unity ${bar.unityPct}.`;
  }
}

/**
 * What the floor did to this bar. `evaluateBallot` reads the unity number only
 * under the village's own dials (`custom`); majority, consensus and consent
 * decide agreement by their own rule, so under them a floor can raise the
 * quorum and nothing else.
 */
function floorLine(floor: TierFloor, method: BallotMethod, bar: MethodDials, village: MethodDials): string {
  const custom = method === "custom";
  if (floor === "none") {
    return custom
      ? "No tier floor: the village's own dials set the bar."
      : "No tier floor: the village's own quorum applies, and the method decides agreement.";
  }
  const what = floor === "subject" ? "This decision's own floor" : `The ${floor} tier's floor`;
  if (!custom) {
    const quorum =
      bar.quorumPct > village.quorumPct
        ? `${what} raises the quorum above the village's own ${village.quorumPct}.`
        : `${what} asks no more quorum than the village's own.`;
    return `${quorum} Under this method it sets no unity number, because the method decides agreement.`;
  }
  if (sameDials(bar, village)) return `${what} asks nothing above the village's own dials.`;
  return `${what} raises it above the village's own dials, which are ${quorumWords(village.quorumPct)} and unity ${village.unityPct}. The village cannot lower that floor.`;
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
      lines: ["This village has not put this kind of decision in a steward's reach, so no steward can stop it once it carries."],
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
    return { stop: "out-of-reach", lines: [`${covers} ${why} No steward can stop it once it carries.`] };
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

/** The routes that make this decision with no vote, in the words the page uses. */
function doorsBeside(subject: string, inp: DecisionMatrixInputs): string[] {
  if (subject === CYCLE_SETTLEMENT) return [MOON_CLOSE_DOOR];
  if (subject === MINT_RULE && !inp.gameStarted) return [MINT_EDITOR_DOOR];
  if (subject === "power_grant") return [GRANT_DOOR];
  if (subject === "role_seat" || subject === "role_unseat") {
    return [seatDoor(subject, inp.powers.some((p) => p.capability === DECIDE && p.villageHolds))];
  }
  return [];
}

const withDoors = (text: string, doors: readonly string[]): string => [text, ...doors].join(" ");

// ── The rows ───────────────────────────────────────────────────────────────

/** What a member who received recognition is told when a moon settles (server/lib/cycleSettlement.ts). */
export const MOON_SETTLED_NOTICE = "Each member who received recognition that moon is told when it settles.";

/**
 * A moon no vote decides: the village settles by hand, or the governance
 * module is not on for members, so the Cycles desk's Close is the one way
 * (`settlementProposalDecision` in shared/moonSettlement.ts opens no ballot on
 * "manual" and none with governance off).
 */
function handSettledRow(
  key: string,
  decision: string,
  detail: string | null,
  inp: DecisionMatrixInputs,
): DecisionMatrixRow {
  const why =
    inp.settlementMode !== "proposal"
      ? "This village settles its moons by hand, so no vote is opened."
      : "The governance module is not on for members, so no member votes on a moon.";
  return {
    key,
    group: "votes",
    decision,
    detail,
    approval: { who: "admin-panel", text: `The admin panel: an administrator settles each moon that has ended from the Cycles desk. ${why}` },
    consultation: ["Nobody has to be asked first."],
    information: [MOON_SETTLED_NOTICE],
    method: {
      kind: "held",
      unityPct: null,
      quorumPct: null,
      tierFloor: null,
      lines: ["No vote: an administrator presses Close on the Cycles desk."],
    },
    stewardStop: "not-applicable",
    riskTags: riskTagsFor(key, inp),
  };
}

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
  if (subject === CYCLE_SETTLEMENT && (inp.settlementMode !== "proposal" || !inp.governanceOnForMembers)) {
    return handSettledRow(key, decision, detail, inp);
  }
  const doors = doorsBeside(subject, inp);
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
      approval: { who: "hypha", text: withDoors(`The vote in the village's Hypha space. ${why}`, doors) },
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

  const methodLines = [barLine(conducts, bar, inp.village), floorLine(floor, conducts, bar, inp.village)];
  if (bar.method) methodLines.push("It always runs on these numbers, whatever method the village uses for its other votes.");
  if (changeSet && tier) methodLines.push("A change that moves a voting bar also costs at least the bar it moves.");
  if (villageMethod === "hypha" && !bar.method) {
    methodLines.push("This village takes its rule changes to Hypha. This one has no Hypha leg, so it is decided here, on the numbers above.");
  }
  if (bar.warning) methodLines.push(bar.warning);

  let approval: DecisionMatrixRow["approval"];
  if (subject === GPS_CHANGE && !inp.handoverComplete) {
    approval = {
      who: "founder",
      text: "The founder, who writes the statement until every transferable power has left the founding seat. Until then this vote cannot be opened.",
    };
  } else if (subject === CONFLICT_AGREEMENT && !inp.gameStarted) {
    // The consequence pen (plan 2.3): the founders write it until the Birthing.
    approval = {
      who: "founder",
      text: "The founders, who write the conflict agreement until the Game starts. Until then this vote cannot be opened.",
    };
  } else if (!inp.governanceOnForMembers) {
    approval = {
      who: "not-yet",
      text: withDoors("No vote can be held yet: the governance module is not on for members.", doors),
    };
  } else {
    approval = { who: "roll", text: withDoors(rollText(subject), doors) };
  }

  const information: string[] = [];
  if (approval.who !== "roll") {
    information.push("Nothing is announced until the vote can be held.");
  } else {
    const unannounced = OPENED_WITHOUT_NOTICE[subject];
    information.push(
      unannounced
        ? `Everyone on the roll is told when it is closing with their vote still owed, and how it closed. ${unannounced}`
        : "Everyone on the roll is told when it opens, when it is closing with their vote still owed, and how it closed.",
    );
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
    method: {
      kind: conducts,
      // Only the village's own dials read a unity number (`evaluateBallot`); under any other method it decides nothing.
      unityPct: conducts === "custom" ? bar.unityPct : null,
      quorumPct: bar.quorumPct,
      tierFloor: floor,
      lines: methodLines,
    },
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

const STEWARD_VETO_CAP: Capability = "steward.veto";

/**
 * WHO CAN STOP A CARRIED DECISION: the seated stewards, and nobody else.
 *
 * The gate lets an administrator record a veto while the village has not
 * taken this power on, and `stewardVetoStands` (server/lib/stewardship.ts)
 * counts only vetoes from people who have sat in a seat carrying it. So an
 * administrator's objection is written down and stops nothing, and with no
 * steward seated nothing can be stopped at all. The admin-panel sentence every
 * other power gets would say the opposite.
 */
function stewardVetoApproval(h: PowerHolding, role: string, governanceOnForMembers: boolean): DecisionMatrixRow["approval"] {
  const held = h.villageHolds ? `The village holds it, with ${role}. ` : "";
  const admin = h.villageHolds
    ? "An administrator who is not seated there cannot use it."
    : "An administrator who has never sat there can record an objection, and it stops nothing.";
  if (h.liveHolders > 0) {
    const where = h.rolesCarrying.length ? listWords(h.rolesCarrying) : "a role that carries it";
    return { who: "holder", text: `${held}The stewards: whoever is seated in ${where} acts on it. ${admin}` };
  }
  const seat = governanceOnForMembers
    ? "The village seats one by vote."
    : "A vote seats one, once the governance module is on for members.";
  return {
    who: "nobody",
    text: `${held}Nobody today: no steward is seated, so no carried decision can be stopped. ${seat} ${admin}`,
  };
}

/**
 * The dial proposal sentence, read off the registry the proposal path reads.
 * `validateChangeSet` (server/lib/mechanics.ts) refuses every dial whose ring
 * is not "open", so while any such dial exists, "any dial" would be untrue.
 */
export function dialProposalLine(): string {
  return VARIABLES.some((v) => ringOf(v) !== "open")
    ? "Any member can propose a change to a dial the village governs, whoever holds this. A dial marked founder-held cannot be moved by a proposal."
    : "Any member can propose a change to any dial, whoever holds this.";
}

/** One transferable power, as the gate answers for it today. */
function powerRow(cap: Capability, p: PowerHolding | undefined, inp: DecisionMatrixInputs): DecisionMatrixRow {
  const key = `power:${cap}`;
  const holding: PowerHolding = p ?? { capability: cap, villageHolds: false, holderRoleName: null, liveHolders: 0, rolesCarrying: [] };
  const role = holding.holderRoleName ? holding.holderRoleName : "a role that no longer exists";

  let approval: DecisionMatrixRow["approval"];
  if (cap === STEWARD_VETO_CAP) {
    approval = stewardVetoApproval(holding, role, inp.governanceOnForMembers);
  } else if (!holding.villageHolds) {
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
  if (cap === "dial.set") consultation.push(dialProposalLine());
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
  if (cap === STEWARD_VETO_CAP) {
    // THE THIRD WAY IT EMPTIES (Wave 2 audit, 2026-09-28). This line said the
    // seat empties "by a vote or when its term ends" and that "no admin route
    // moves it". A steward who leaves the village loses every holding they have
    // (server/lib/erasure.ts, the role-holdings step), and an administrator can
    // bring that about alone: removing the member (DELETE
    // /api/admin/players/:id) or resolving an exit (server/routes/exits.ts),
    // neither of which is a vote. What stays true is that no admin route SEATS
    // anybody there (`stewardSeatRefusal` in server/lib/roleGrants.ts).
    lines.push(
      "The steward's seat is filled only by a village vote, and no admin route seats anybody in it. " +
        "It empties by a vote, when its term ends, or when the steward leaves the village, " +
        "and an administrator can remove them from the village without a vote.",
    );
  } else {
    lines.push("An administrator can also give it to another role directly from the admin panel, with no vote, and the village's pulse says so.");
  }

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

  const notes = [
    GENERATED_NOTE,
    DIALS_NOTE,
    sensingNote(inp.sensingDays, inp.supportThreshold),
    VETO_OVERRIDE_NOTE,
    applySwitchNote(inp.autoApplyEnabled),
  ];
  if (groups.some((g) => g.rows.some((r) => r.riskTags.length > 0))) notes.push(RISK_TAG_NOTE);

  return {
    groups,
    notes,
    sensing: { days: inp.sensingDays, enforced: false, supportThreshold: inp.supportThreshold },
    vetoOverrideAvailable: false,
  };
}
