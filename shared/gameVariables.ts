/**
 * THE VARIABLES REGISTRY: the foundation every other system reads from.
 *
 * Every tunable number, toggle, threshold and address in the game lives here as
 * data, editable from Admin, so a village customizes its game without a
 * developer and without a deploy. This is the layer that makes the platform
 * genuinely re-usable: two land projects running the same code can play very
 * different games purely by editing these values.
 *
 * The rule going forward: if a rule of the game is expressed as a literal in
 * code, it belongs here instead. `shared/gameConfig.ts` keeps IDENTITY (names,
 * paths, stage ladder, images); this file keeps BEHAVIOUR (how much, how often,
 * which mode).
 *
 * Values are stored as strings and parsed by `type`, so one table holds numbers,
 * booleans, choices and contract addresses without a column per kind. Regen
 * civics' equivalent table is numeric-only (`decimal(20,6)`), which cannot
 * express "equal voice or mirror Hypha" or an ERC-20 address; this shape can.
 */

import { GAME_CONFIG } from "./gameConfig";
import { STAGE_UNLOCKS } from "./capabilities";
import { TIER_FLOORS, type Criticality } from "./governanceEngine";
import { MINT_RULE, SUBJECT_THRESHOLDS } from "./ballotSubjects";

export type VariableType = "integer" | "decimal" | "percentage" | "boolean" | "choice" | "text";

/**
 * THE THREE RINGS (Game Mechanics initiative, decided 2026-07-31).
 *
 * Ring 0 — constitutional — is not in this file at all: conservation, the one
 * capability gate, fiat-in-only and their siblings live in code and are
 * PUBLISHED (shared/constitution.ts) but never tunable. This registry holds
 * the other two rings:
 *
 *   "open"    — Ring 2: community-governable dials. These appear as editable
 *               mechanics on the public Game Mechanics page and are the
 *               domain of the Hypha proposal loop. The platform's min/max
 *               BOUNDS stay Ring 0: governance moves a value within its
 *               bounds, never the bounds.
 *   "founder" — Ring 1: tunable, but by the founder/admin only — legal
 *               posture, infrastructure, privacy windows, abuse guards.
 *               Shown on the public page (everything is visible) but marked
 *               founder-held and never proposable.
 *
 * The ring on a def is the PLATFORM CEILING. A founder can close an "open"
 * variable to their community; nothing can open a "founder" one to it.
 */
export type VariableRing = "open" | "founder";

/**
 * When a governance-passed change takes effect. "instant" is the default;
 * "cycle-close" marks variables whose mid-cycle change corrupts a settlement
 * basis (budgets, pools, multipliers — the sticky-split lesson): a passed
 * proposal for one of these applies at the next cycle close, giving humans
 * the window between passage and effect the governance design calls for.
 */
export type VariableApplyTiming = "instant" | "cycle-close";

export interface VariableDef {
  key: string;
  category: string;
  label: string;
  /** Plain language, shown in Admin. Written for a founder, not a developer. */
  description: string;
  type: VariableType;
  default: string;
  min?: number;
  max?: number;
  /** For `choice`: the allowed values and how to label them. */
  choices?: Array<{ value: string; label: string; hint?: string }>;
  unit?: string;
  /** Ring override. Absent = derived by ringOf() from category/key rules. */
  ring?: VariableRing;
  /** Apply-timing override. Absent = derived by applyTimingOf(). */
  applyTiming?: VariableApplyTiming;
  /**
   * HOW CRITICAL THIS DIAL IS, and therefore how much of the village has to
   * show up and agree before it moves (the founder's ruling of 2026-09-02,
   * Q11: nothing is un-votable, and the more critical it is the higher the
   * bar). Absent = `routine`, which asks for nothing beyond the village's own
   * unity and quorum, so a dial that says nothing behaves exactly as every
   * dial behaved before this field existed.
   *
   * The tiers and their floors live in `shared/governanceEngine.ts`, because
   * they are governance arithmetic and this registry is one of two readers.
   */
  criticality?: Criticality;
}

/**
 * Voice weighting is decision 5, and the distinction matters: this app is the
 * INFORMAL sense-making step, Hypha is where formal decisions bind. So the app
 * never computes binding vote weight. It only chooses how to DISPLAY and tally
 * informal sensing, and the village picks which feels true to them.
 */
export const VOICE_WEIGHTING_CHOICES = [
  {
    value: "equal",
    label: "One person, one voice",
    hint: "Everyone's sensing counts the same, regardless of what they hold. Simplest and most equal.",
  },
  {
    value: "hypha-mirror",
    label: "Mirror Hypha Voice holdings",
    hint: "Sensing is weighted by each member's Voice token balance, so the informal step previews how a formal Hypha decision would land.",
  },
] as const;

export const VARIABLES: VariableDef[] = [
  // ── Gratitude: the in-site recognition economy ────────────────────────────
  {
    key: "gratitude.base_budget",
    category: "Gratitude",
    label: "Base sending allowance per cycle",
    description:
      "THE allowance behind every way of giving in this village: written acknowledgments on the Gratitude page, and taps of appreciation on the feed. A member's own figure is this number times their stage multiplier under Progression, so the stock ladder runs from 100 a cycle at Guest to 500 at Sage. Set it to 0 and nobody gives anything at any stage. Raise it and every stage rises with it, and so does the amount any one person may receive, because that ceiling is a share of this. Unused allowance does not roll over. Giving mints fresh Gratitude for the person being thanked and takes nothing from the giver's own balance, so this allowance is what bounds it. Works with: 'Share of an allowance any one person can receive', 'Gratitude each heart sends', 'Hearts one member can tap for another per cycle', and 'Sending-budget multiplier' under Progression.",
    type: "integer",
    default: "100",
    min: 0,
    max: 100000,
    unit: "Gratitude",
  },
  {
    key: "gratitude.pool_per_cycle",
    category: "Gratitude",
    label: "Value pool distributed at each cycle close",
    description:
      "How many tokens the village shares out when a lunar cycle closes. The pool is split among everyone in proportion to the recognition they received that cycle, so you decide how much there is and the community's appreciation decides where it goes. Set it to 0 to turn distribution off and let gratitude stay a signal on its own.",
    type: "integer",
    default: "1000",
    min: 0,
    max: 1000000,
    unit: "tokens",
  },
  {
    key: "gratitude.pool_token",
    category: "Gratitude",
    label: "Which token the pool pays",
    description:
      "The token the cycle pool pays out, for example your village's credits. The list holds the tokens this village issues itself, and it leaves out the recognition token on purpose: recognition is the signal, this is the value, and keeping them apart is what stops appreciation from becoming a price. Rename your tokens in the token registry and they change here too.",
    // Kept as text in the registry so validation stays permissive: the
    // fail-loud refusal at cycle close is the real guard, and it must keep
    // catching a value set by any other route. Admin decorates this key with
    // the deployment's own tokens (server/index.ts, GET /api/admin/variables),
    // so the ordinary path cannot reach the misconfiguration at all.
    type: "text",
    default: "credits",
  },
  {
    key: "ledger.admin_mint_cycle_cap",
    category: "Ledger",
    label: "Admin mint cap per cycle",
    description:
      "The most any admins can mint by hand, in total, per token, per cycle (S9's mint endpoint enforces it as an aggregate, not per call). A cap on manual issuance is what makes 'the numbers mean something' a property of the system instead of a promise from whoever holds admin. 0 disables manual minting entirely.",
    type: "integer",
    default: "10000",
    min: 0,
    max: 10000000,
    unit: "tokens",
  },
  {
    key: "ledger.admin_mint_cosign_over",
    category: "Ledger",
    label: "Second steward needed above",
    description:
      "A hand-mint larger than this waits for a SECOND steward to agree before any tokens move. The record keeps who asked, who agreed, when, and the exact amount and token, so nobody can change what was signed for afterwards. 0 turns the second signature off. Minting to your own account is refused at any amount and this dial does not reach that rule.",
    type: "integer",
    default: "100",
    min: 0,
    max: 10000000,
    unit: "tokens",
  },
  // ── R73, 2026-08-29: one allowance, one per-recipient rule ────────────────
  //
  // Three dials used to live here and just above. The economy engine carried
  // its own flat `economy.giving_allowance_per_moon` (30) beside the
  // acknowledgement flow's stage-scaled `gratitude.base_budget` (100), and
  // each channel carried its own per-recipient cap:
  // `economy.hearts_per_recipient_per_moon` counted GRATITUDE (10) and
  // `gratitude.max_per_recipient_per_cycle` counted SENDS (1).
  //
  // The sends cap is the one that had to go, and the reason is not tidiness.
  // A cap on the COUNT never bounds the SIZE, so a member at the top of the
  // ladder could hand one person 500 Gratitude in a single send and break no
  // rule. Gratitude is `governance.weight_token` by default, so that was a
  // limit on how much voice one member can concentrate in another, and it did
  // not exist. `gratitude.max_share_per_recipient` replaces both caps with a
  // share of the giver's own allowance, which means the same thing at 100 and
  // at 500: doubling the base budget cannot silently double how much of one
  // person's standing may come from one relationship.
  //
  // The retired keys are dropped from the registry by 0110. An override row
  // for a key the registry no longer holds is never read (`variable()` throws
  // on an unknown key and `allVariables()` iterates the registry), so a
  // leftover row would be invisible instead of wrong. It is still deleted, so
  // a founder reading the table sees what the game reads.
  // ── The voice claim ───────────────────────────────────────────────────────
  {
    key: "economy.voice_claim_threshold",
    category: "The Mint",
    label: "Voice needed before a member can claim",
    description:
      "How much voice someone gathers before their chip turns claimable. What this really sets is how much attention your governance spends: every claim becomes a real proposal in your Hypha space, so a low number fills that space with small ones and a high number leaves people waiting a year for a loop that never visibly closes. At the seeded rates, 100 is ten confirmed quests, or two seasons holding a seat, or a mix of both. A good way to pick it: decide how many claim proposals your circle can genuinely consider in one Claims Week, then set this so about that many members qualify.",
    type: "integer",
    default: "100",
    min: 1,
    max: 100000,
    unit: "voice",
  },
  {
    key: "economy.claims_week_days",
    category: "The Mint",
    label: "How many days Claims Week stays open",
    description:
      "Claims open for one window each season, so a whole season of contribution formalises in one governance pass instead of a drip of separate proposals. Outside the window a member's chip reads how much they have gathered and when it next opens. Worth lining the window up so it CLOSES just before your governance actually meets: if it shuts six weeks before anyone votes, claims simply sit and wait.",
    type: "integer",
    default: "7",
    min: 1,
    max: 90,
    unit: "days",
  },
  {
    key: "economy.claims_week_starts",
    category: "The Mint",
    label: "When each Claims Week begins",
    description:
      "Four dates a year, one per season, as MM-DD separated by commas. The default follows the solstices and equinoxes, which is the sun's rhythm and a different clock from the cycle the settlement keeps: a season turn and a cycle boundary fall on different days, and the window opens at midnight in the village timezone. Leave it blank to keep claims open all year, which suits a village that would rather not batch.",
    type: "text",
    default: "03-21,06-21,09-23,12-21",
  },
  {
    key: "economy.hypha_space",
    category: "The Mint",
    // FOUNDER ring, explicitly. This names where value is sent, so it is legal
    // and infrastructural posture rather than a community-tunable rule. A
    // governance proposal that could redirect claims would be a way to move the
    // village's voice somewhere the village did not choose.
    ring: "founder",
    label: "Your Hypha space",
    description:
      "The DHO slug that voice claims are raised into, from app.hypha.earth. Until this is set, voice gathers correctly and cannot be claimed, and members are told exactly that. Nobody is shown a button that would fail. Set it ONLY to a space your village controls: a claim is a proposal to move real value, and an intent aimed somewhere else is value leaving through a door you did not open.",
    type: "text",
    default: "",
  },
  {
    key: "gratitude.max_share_per_recipient",
    category: "Gratitude",
    label: "Share of an allowance any one person can receive",
    description:
      "The most of a giver's cycle allowance that any one other member can receive. At the default of 25 a member can give any one person a quarter of what they have, across as many sends as they like, so it takes at least four people to spend an allowance. Set it to 100 and one person can receive somebody's whole allowance. Set it to 1 and it takes a hundred people to spend one. It counts written acknowledgments and feed hearts TOGETHER, so neither channel can carry what the other refuses. The figure it is a share of is the base sending allowance times the giver's stage multiplier, so at the stock ladder 25 means 25 Gratitude to one person at Guest and 125 at Sage. The ceiling never falls below 1 Gratitude, so a small allowance and a small share cannot combine into a village where nobody can give anything at all. This is also the dial that bounds concentrated VOICE while Gratitude is the weight token under Governance: it decides how much of one member's standing may come from a single relationship. Works with: 'Base sending allowance per cycle', 'Gratitude each heart sends', 'Hearts one member can tap for another per cycle', and 'Sending-budget multiplier' under Progression.",
    type: "percentage",
    default: "25",
    min: 1,
    max: 100,
    // Short on purpose. Game Mechanics renders a value as `${raw} ${unit}` in
    // a chip, and three of those sit on one line ("25 % of the allowance",
    // "village-tuned · default 25 % of the allowance", and a staged arrow), so
    // a longer unit wraps the row. The full sentence is in the description.
    unit: "% of the allowance",
  },
  {
    key: "gratitude.require_message",
    category: "Gratitude",
    label: "Require a message with every acknowledgment",
    description:
      "When on, Gratitude cannot be sent silently. The message is what makes recognition mean something to the person receiving it.",
    type: "boolean",
    default: "true",
  },
  /*
   * THE RHYTHM DIAL, AND WHY IT IS BACK.
   *
   * `gratitude.cycle_mode` used to sit here offering "lunar" or "month". It
   * was live in the admin panel and reported to every client, and one branch
   * inside `currentCycleId()` was the only code that ever read it, so a
   * founder could switch the village's whole gratitude rhythm to calendar
   * months and nothing changed anywhere.
   *
   * Rye retired it rather than wiring it, 2026-08-29: "let's just stick with
   * lunar months all around, it's good to be on our own rhythm." Migration
   * `0108` cleared the rows.
   *
   * He reopened it on 2026-09-02: "Yes the cycle structure can be changed."
   * So `cycle.mode` below is the dial, and it is a different object from the
   * one that was retired. The old one was a value with no reader. This one is
   * read through `shared/cycleClock.ts`, which every consumer of village time
   * now calls, and `assertCycleSettingsRead` refuses to boot a build where a
   * rhythm setting is shown and nothing reads it. The defect `0108` retired
   * the old dial for cannot come back silently.
   */
  {
    key: "cycle.mode",
    category: "Gratitude",
    // Constitutional. A village's rhythm is the frame every other number sits
    // in: budgets, caps, mint rules, seat terms, the veto window and the
    // instant a passed proposal lands are all counted in cycles. Changing it
    // re-times all of them at once, so it asks for the same bar as the
    // decisions that change who decides.
    criticality: "constitutional",
    label: "The rhythm the village keeps time by",
    description:
      "Whether a cycle is a moon or a calendar month. The moon is the default and is what every village has run on: budgets refill, caps reset and the settlement lands at the new moon, so the village keeps its own rhythm instead of the one on an office wall. Calendar months suit a village whose money and reporting already run that way. The switch is a constitutional change and lands only where a cycle ends, with every finished cycle settled first, so no cycle is ever cut in half or settled against a clock it was not played on. Every cycle already closed keeps the name and the dates it closed under, whichever rhythm the village moves to.",
    type: "choice",
    default: "lunar",
    choices: [
      {
        value: "lunar",
        label: "The moon",
        hint: "New moon to new moon, about 29.5 days. Boundaries come from a checked-in table of true new moons.",
      },
      {
        value: "calendar",
        label: "The calendar month",
        hint: "First of the month to first of the month, UTC. Cycles carry ids like month-2026-09.",
      },
    ],
  },

  // ── The org chart and its seasons ─────────────────────────────────────────
  {
    key: "org.reassignment_cadence",
    category: "Progression",
    label: "How often every seat reopens",
    description:
      "A season can end with every seat vacated and offered again. Reopening on a rhythm is how a village keeps seats from calcifying, because correcting a bad fit stops needing a confrontation and becomes a date everyone already knew about. A seat can opt out on its own card, and a term can always end sooner.",
    type: "choice",
    default: "season_turn",
    choices: [
      {
        value: "season_turn",
        label: "Every season turn",
        hint: "Recommended while a village is young: three months is short enough to learn fast and change what is not working.",
      },
      {
        value: "pattern_change",
        label: "When the season's shape changes",
        hint: "A founding season can run across several turns without reopening every seat each time.",
      },
      { value: "annual", label: "Once a year", hint: "One reopening a year, whatever the seasons did." },
      { value: "never", label: "Never", hint: "Seats end only on their own term date, or when somebody steps down." },
    ],
  },

  // ── Quests: how work becomes recognition ──────────────────────────────────
  {
    key: "quest.consent_cap_mode",
    category: "Quests",
    label: "How much can be released at consent",
    description:
      "Controls what an admin may award when consenting to finished work. Capping it at the posted amount keeps the quest board honest: what a quest advertises is what it pays.",
    type: "choice",
    default: "posted",
    choices: [
      { value: "posted", label: "Exactly the posted amount", hint: "Safest. The board is the contract." },
      { value: "capped", label: "Up to a multiple of the posted amount", hint: "Allows a bonus for exceptional work, within a ceiling." },
      { value: "unlimited", label: "Any amount", hint: "No ceiling. Only sensible with a very small, very trusted admin group." },
    ],
  },
  {
    key: "quest.consent_cap_multiplier",
    category: "Quests",
    label: "Bonus ceiling multiplier",
    description:
      "When the cap mode is 'up to a multiple', this is the most that can be awarded as a multiple of the posted amount. 2 means a quest posted at 100 can pay at most 200.",
    type: "decimal",
    default: "2",
    min: 1,
    max: 100,
    unit: "x posted",
  },
  {
    key: "quest.require_submission_before_consent",
    category: "Quests",
    label: "Require submitted work before consent",
    description:
      "When on, value can only be released for work that was actually filed. Turning this off lets an admin credit a quest nobody submitted, which breaks the promise that credit follows shown work.",
    type: "boolean",
    default: "true",
  },
  {
    key: "quest.allow_zero_consent",
    category: "Quests",
    label: "Allow consenting at zero",
    description:
      "When on, a claim can be consented with an amount of 0, meaning 'acknowledged, no recognition'. The claim completes and any stay-credit reward still releases, but no recognition moves. When off, consent must release at least 1.",
    type: "boolean",
    default: "false",
  },
  {
    key: "quest.self_consent_until_members",
    category: "Quests",
    label: "Founder may self-consent below this many members",
    description:
      "Consent normally needs a second person to witness the work: nobody may consent to their own claim. A founder building alone has nobody to ask, so while the village has FEWER than this many members, an admin or founder may consent to their own claims. Once the village reaches this size, the witness rule applies to everyone, admins included. 0 means self-consent is never allowed, even for a founder alone.",
    type: "integer",
    default: "6",
    min: 0,
    max: 1000,
    unit: "members",
  },

  // ── Governance: sensing, which runs before a ballot wherever the vote binds ─
  {
    key: "governance.voice_weighting",
    category: "Governance",
    label: "How sensing is weighted",
    description:
      "Sensing gathers support before a ballot opens. Choose whether it gives everyone an equal voice, or mirrors Voice holdings so you can see how a weighted vote would land. Where the binding vote itself happens, here or on your DAO, is decided by the governance module and its own weight setting.",
    type: "choice",
    default: "equal",
    choices: VOICE_WEIGHTING_CHOICES.map((c) => ({ ...c })),
  },
  {
    // The KEY is forever; the label moved to "proposer bar" language when the
    // on-site engine landed, because the bar gates proposing wherever the
    // binding vote happens, on-site or on Hypha.
    key: "governance.hypha_threshold",
    category: "Governance",
    label: "The proposer bar: earned recognition to propose",
    description:
      "Earned recognition a member needs before they can OPEN mechanics proposals and sponsor others' drafts (below it, they can still draft; a qualified member's sponsorship opens a draft). The base posture is 0: any member may propose. Raise it to ask for earned standing first. Admins and founders always qualify.",
    type: "integer",
    default: "0",
    min: 0,
    max: 10000000,
    unit: "Gratitude",
  },
  {
    key: "governance.sensing_days",
    category: "Governance",
    label: "How long a topic stays open for sensing",
    description:
      "Days a proposal collects perspectives before it can move to a decision. Long enough that quiet people get heard, short enough that momentum survives.",
    type: "integer",
    default: "7",
    min: 1,
    max: 90,
    unit: "days",
  },
  {
    key: "governance.proposals_per_member_per_cycle",
    category: "Governance",
    label: "Mechanics proposals per member per cycle",
    description:
      "How many game-rule change proposals one member may open per cycle. A ceiling on flooding, not on participation: supporting and sponsoring other proposals is never limited.",
    type: "integer",
    default: "5",
    min: 1,
    max: 100,
    unit: "per cycle",
  },
  {
    // The KEY is forever; the label named Hypha as the only destination and
    // stopped being true when the on-site engine landed, the same way
    // governance.hypha_threshold's did. This gate stands in front of the
    // binding vote wherever the binding vote happens, so it says that.
    key: "governance.proposal_support_threshold",
    category: "Governance",
    label: "Supporters before a proposal can go to the vote",
    description:
      "How many members must support a mechanics proposal in-game before it can be taken to the binding vote. The sensing step: proposals gather perspectives here first, and only what the village actually wants reaches a ballot. Where that ballot happens is set by how village-wide ballots decide, on this village's own dials or in your Hypha space. 0 turns the gate off, and any open proposal can go straight to the vote.",
    type: "integer",
    default: "0",
    min: 0,
    max: 10000,
    unit: "supporters",
  },
  {
    key: "governance.hub_url",
    category: "Governance",
    label: "Governance hub URL",
    description:
      "Base URL of the hub that listens to the chain for this village. When a proposal's Hypha URL is pasted in, the platform registers the on-chain proposal id with this hub (signed with the shared governance secret) so the verified outcome can find its way home. Empty means this village has no hub: nothing is registered and nothing is sent anywhere. Fill it in only if you run a hub or have been given one to point at.",
    type: "text",
    /*
     * SHIPS BLANK, the way `FEEDBACK_HUB_URL` was blanked once a fork could
     * inherit it. This repository is public and every village that forks it
     * gets these defaults as its constitution, so a default naming one
     * organisation's hub would quietly point every new village's governance
     * relay at that organisation. Empty is the honest default: it means no
     * hub, and every reader already treats empty as off.
     */
    default: "",
    ring: "founder",
  },
  {
    key: "governance.auto_apply_enabled",
    category: "Governance",
    label: "Apply verified proposals automatically",
    criticality: "structural",
    description:
      "When on, a proposal verified as passed on-chain applies itself: instantly for instant dials, at the next cycle close when the set touches any cycle-timed dial (the whole set waits together; a set applies atomically or not at all). Turning this OFF is the founder's emergency brake: verified proposals hold, stewards are notified, and applying becomes a human act until it is turned back on. Founder-held on purpose.",
    type: "boolean",
    default: "true",
    ring: "founder",
  },
  // The steward's reach, as one list. It was two lists while the steward
  // approved things, one for what waited and one for what carried itself.
  // Nothing waits any more: a decision the village carried lands at its
  // landing time whether or not anybody holds the seat, so the second list
  // said nothing the first one did not, and it is gone.
  // `governance.auto_apply_enabled` is untouched and still means exactly what
  // it always meant: the mechanics brake.
  {
    key: "governance.steward_subjects",
    category: "Governance",
    label: "Which decisions a steward can stop",
    criticality: "constitutional",
    description:
      "A steward can stop a decision the village has already carried, inside the window before it lands, and has to say why. This names which kinds of decision are inside that reach. Leave it as all while the village is young; name a shorter list, or none, as it learns to trust its own agreements. A village with no steward and self-executing agreements is a healthy village, not a broken one. Advisory votes are never in reach, because they change nothing. Neither is the ballot that seats or unseats a steward, so the seat can never stop its own removal.",
    type: "text",
    default: "all",
  },
  /*
   * THE SECOND HALF OF THE REACH, AND IT IS THE ONE THAT NARROWS BY DEFAULT.
   *
   * Rye, 2026-09-04: "for now as the default let's have constitutional able to
   * be vetoed but let it be a setting in admin for which of these 3 categories
   * a steward can veto".
   *
   * `steward_subjects` above names WHICH KINDS of decision are in reach. This
   * names WHICH SIZES. A veto needs both: the subject in the first list and the
   * tier in this one, so a village can say "the seat may pause a constitutional
   * mechanics change and nothing else" without writing two half-rules that
   * disagree.
   *
   * The default is deliberately narrower than the code shipped with. Every tier
   * was stoppable before this; now the seat reaches the changes that reshape the
   * village and stays out of the way of the rest, which is the founder's own
   * framing that power sits with the community and the community governs the
   * seat.
   */
  {
    key: "governance.steward_veto_tiers",
    category: "Governance",
    label: "Which sizes of decision a steward can stop",
    criticality: "constitutional",
    description:
      "Every decision carries a size: routine, structural, or constitutional. This names the sizes a steward may stop inside the window before a decision lands, and a veto needs the decision to be in reach on both this list and the one above. The default is constitutional on its own, so the seat can pause the changes that reshape the village and leaves the smaller ones alone. Write them separated by commas, or write all. Leave it empty and no steward can stop anything, which is a healthy village and not a broken one. Changing this is priced at the top tier and no steward can stop the change, because a seat that could veto an edit to its own limits would have none.",
    type: "text",
    default: "constitutional",
  },
  /*
   * A PAYOUT GOES THE MOMENT IT PASSES, UNLESS IT IS BIG (Rye, 2026-09-04).
   *
   * Asked whether token sends should take the three-day window: "No, they go
   * the moment they pass all conditions (minimum time set by the whole system
   * for a proposal duration) quorum and unity) And then also another settings
   * where you can say which payouts require a 3 day delay to confirm and set it
   * above $1000 as a default."
   *
   * So the small payout keeps its speed, which is what makes a quest loop feel
   * like a quest loop, and the size of payout that would hurt to get wrong
   * waits where somebody can catch it. Zero delays every payout, which is the
   * fail-closed direction this codebase already uses for every cap: zero means
   * zero and never unlimited.
   */
  {
    key: "governance.payout_delay_over",
    category: "Governance",
    label: "Payouts above this wait three days before they are sent",
    criticality: "structural",
    description:
      "A payout the village votes through is sent the moment it passes. Above this amount it waits the steward window first, so somebody can catch a send that would empty a purse or reward the wrong work. The amount is counted in whole tokens of whatever token is being sent, so a village holding several tokens with very different sizes should set this against the one it actually pays people in. Zero makes every payout wait.",
    type: "integer",
    default: "1000",
  },
  {
    key: "governance.steward_council",
    category: "Governance",
    label: "A veto needs a majority of the stewards",
    criticality: "constitutional",
    description:
      "Off by default, and off means any one seated steward can stop a decision on their own. Turn it on and a village with several stewards runs them as a council: stopping a decision then takes a majority of the seated seats, so one seat alone cannot hold the village up. Changing this is priced at the top tier, and no steward can stop the change, because a seat that could veto an edit to its own limits would have none.",
    type: "boolean",
    default: "false",
  },
  // The veto window. The other two settings the 2026-09-03 rulings need are
  // `governance.steward_council` above and `governance.highest_tier` further
  // down: three lanes wrote those two keys between them, and the duplicate
  // definitions came out at the merge rather than shipping a registry that
  // throws on its own duplicate check at boot.
  {
    key: "governance.veto_hours",
    category: "Governance",
    label: "How long a steward has to stop a change",
    criticality: "constitutional",
    description:
      "A change to the Game that the village has passed does not take effect straight away. It is stamped with a landing instant and a steward may stop it until then, with a reason that goes on the record. This is the least notice a steward gets, counted from the moment the vote closes. 72 hours is the floor and cannot be lowered; a village may give its stewards longer. A decision that sends tokens is not held by this: a steward stops one of those by voting no while the ballot is still open.",
    type: "integer",
    default: "72",
    min: 72,
    max: 720,
    unit: "hours",
  },
  // A decision that carried and then never landed. It happens: the auto-apply
  // brake sits off for a season, a village goes quiet, a landing keeps throwing.
  // Without a limit the row waits forever and a member reads a countdown that
  // never reaches zero, which is the one outcome nobody can act on.
  {
    key: "governance.landing_expiry_cycles",
    category: "Governance",
    label: "Cycles a passed decision waits before it is written off",
    criticality: "structural",
    description:
      "A decision the village passed is stamped with the instant it takes effect. If it is still sitting there this many cycles after that instant, it is closed and the village is told. The door back is to withdraw and rewrite it, which keeps everybody who backed it. Set it higher for a village that turns the automatic landing off for long stretches.",
    type: "integer",
    default: "3",
    min: 1,
    max: 12,
    unit: "cycles",
  },
  {
    key: "governance.change_cooldown_days",
    category: "Governance",
    label: "Cooldown after a governed rule change",
    description:
      "After a dial is changed by a passed proposal, this many days must pass before a new proposal may move that same dial again. Prevents rule-thrash and vote fatigue. 0 turns the cooldown off.",
    type: "integer",
    default: "0",
    min: 0,
    max: 365,
    unit: "days",
  },

  // ── Governance windows, per proposal kind (19E, 19F, 20.11) ──────────────
  //
  // "we can also block all proposals from not happening within defined
  // governance windows. Some can be 'always open' but some can have set
  // windows (like the last week of every month or last 2 weeks of every
  // season or whatever) but those two are the default choices we offer to
  // guide." A governance month is a lunar month (19F), so "the last week of
  // every month" is the last seven days of the ACTIVE clock's cycle.
  //
  // Every one of these ships ALWAYS OPEN, so a village that never touches
  // them behaves exactly as every village behaved before windows existed.
  // The grammar, the arithmetic and the refusals live in
  // `server/lib/governanceWindows.ts`; `WINDOW_KINDS` there holds the same
  // ten keys and `governanceWindows.test.ts` pins the two lists equal.
  //
  // The tier is structural: a window decides when the village may open a
  // proposal at all, which is a rule about how the village decides. 20.11
  // classes the window settings with the other dials that price proposals,
  // so none of them may be trialled at a discount.
  {
    key: "governance.window_changeset",
    category: "Governance",
    label: "When a change to the Game Mechanics can go to the vote",
    criticality: "structural",
    description:
      "always_open lets anyone take a change set to the vote on any day. last_days_of_cycle:7 opens it in the last seven days before the moon turns, so the village reads its changes together. last_days_of_season:14 opens it in the last two weeks of the season that is running. custom:1-7 names your own days of the cycle, counted from the moon. A window decides when a vote may OPEN: a vote already running is never closed by a window shutting, and a proposal coming back after a veto or an objection opens outside its window for the grace named below.",
    type: "text",
    default: "always_open",
  },
  {
    key: "governance.window_mint_rule",
    category: "Governance",
    label: "When a change to what the village mints can go to the vote",
    criticality: "structural",
    description:
      "The window a minting change opens in, in the same words as the change set window above. This one is separate because a village that wants its minting read together can hold minting to a window while everything else stays open. A change set carrying a minting element is held to the stricter of the two.",
    type: "text",
    default: "always_open",
  },
  {
    key: "governance.window_governance_mode",
    category: "Governance",
    label: "When a change to how votes are counted can go to the vote",
    criticality: "structural",
    description:
      "The window a vote-mode switch opens in, in the same words as the change set window above. A change set carrying a mode switch is held to this window as well as its own, so the biggest change in a bundle cannot ride into an open week under a small one.",
    type: "text",
    default: "always_open",
  },
  {
    key: "governance.window_role_declare",
    category: "Governance",
    label: "When declaring a role can go to the vote",
    criticality: "structural",
    description:
      "The window a proposal that declares a new role opens in, in the same words as the change set window above.",
    type: "text",
    default: "always_open",
  },
  {
    key: "governance.window_role_seat",
    category: "Governance",
    label: "When seating a role can go to the vote",
    criticality: "structural",
    description:
      "The window a proposal that asks somebody to sit in a role opens in, in the same words as the change set window above. Hold this one open while a village is young: a seat nobody can be asked to fill is a seat that stays empty until the calendar allows it.",
    type: "text",
    default: "always_open",
  },
  {
    key: "governance.window_role_unseat",
    category: "Governance",
    label: "When taking a seat back can go to the vote",
    criticality: "structural",
    description:
      "The window a proposal that takes a seat back opens in, in the same words as the change set window above. A village that windows this one is choosing to wait before it can remove somebody, so leave it always open unless you have a reason you can say out loud.",
    type: "text",
    default: "always_open",
  },
  {
    key: "governance.window_power_transfer",
    category: "Governance",
    label: "When moving a power to a role can go to the vote",
    criticality: "structural",
    description:
      "The window a proposal that moves a power from the admin panel to a role opens in, in the same words as the change set window above.",
    type: "text",
    default: "always_open",
  },
  {
    key: "governance.window_power_grant",
    category: "Governance",
    label: "When granting a power can go to the vote",
    criticality: "structural",
    description:
      "The window a proposal that grants a power to a role opens in, in the same words as the change set window above.",
    type: "text",
    default: "always_open",
  },
  {
    key: "governance.window_power_return",
    category: "Governance",
    label: "When handing a power back can go to the vote",
    criticality: "structural",
    description:
      "The window a proposal that hands a power back to the admin panel opens in, in the same words as the change set window above.",
    type: "text",
    default: "always_open",
  },
  {
    key: "governance.window_grace_days",
    category: "Governance",
    label: "How long a proposal coming back may open outside its window",
    criticality: "structural",
    description:
      "A resubmission after objections, a veto override and a renewal of a trial are all proposals coming back, and the village has already been asked once. Each of them may open outside its kind's window for this many days after the decision it comes back from closed. Set this to 0 and a single steward's veto becomes unanswerable until the next window opens.",
    type: "integer",
    default: "7",
    min: 0,
    max: 90,
    unit: "days",
  },

  // ── Governance: the on-site decision engine (round 5, lane G1) ────────────
  //
  // Ring placement per GOV_DESIGN section 7. The weight dials are FOUNDER
  // ring: how voting power is assigned is constitutional in spirit, a founder
  // decision, never a dial a majority flips mid-game to entrench itself. The
  // conduct dials (unity, quorum, durations, default method) are Ring 2, and
  // every one of them is protected mid-vote by the ballot snapshot rule
  // instead of cycle timing.
  {
    key: "governance.weight_mode",
    category: "Governance",
    label: "How voting weight is assigned",
    ring: "founder",
    // What one vote MEANS. Changing it changes every decision the village
    // ever makes after it, in both directions (Q8), so it carries the
    // constitutional bar and travels only as a mode_switch item.
    criticality: "constitutional",
    description:
      "What one member's vote weighs on an on-site ballot. Equal gives every eligible member the same single vote. Token weighs votes by each member's balance of the weight token at the moment a ballot opens. Custom weighs votes by the allocation table you keep under Voting weights, where a member with no allocation weighs zero. Whatever you choose, each ballot freezes the weights when it opens, and every allocation change is on a permanent record any member can read.",
    type: "choice",
    default: "equal",
    choices: [
      { value: "equal", label: "One person, one vote", hint: "Every eligible member weighs the same." },
      { value: "token", label: "Token balance", hint: "Weight is each member's balance of the weight token when the ballot opens." },
      { value: "custom", label: "Custom allocation", hint: "Weight comes from the allocation table. No allocation means no weight." },
    ],
  },
  {
    key: "governance.weight_token",
    category: "Governance",
    label: "The weight token",
    ring: "founder",
    criticality: "constitutional",
    description:
      "Which token weighs votes when the weight mode is token. Only tokens this platform itself governs can be chosen: a token governed on Hypha is a display-only mirror here, and a ballot may never make this platform a second source of truth for it. The default is the recognition token, which nobody can buy, so weight in the default posture is earned appreciation.",
    type: "text",
    default: "gratitude",
  },
  {
    key: "governance.unity_pct",
    category: "Governance",
    label: "Unity needed to pass",
    criticality: "structural",
    description:
      "Of the votes cast for or against, the share that must be in favor for a ballot run on the village's own dials to pass. Abstentions help a ballot reach quorum and take no side here. 100 asks for consensus in effect; the Hypha surface this inherits from runs at 80.",
    type: "percentage",
    default: "80",
    min: 50,
    max: 100,
    unit: "%",
  },
  {
    key: "governance.quorum_pct",
    category: "Governance",
    label: "Quorum needed to count",
    criticality: "structural",
    description:
      "The share of the electorate's total voting weight that must show up, counting abstentions, before a ballot's outcome counts at all. Below this the ballot closes as no quorum, whatever the votes said. Each ballot freezes this number when it opens.",
    type: "percentage",
    default: "20",
    min: 1,
    max: 100,
    unit: "%",
  },
  {
    key: "governance.vote_days",
    category: "Governance",
    label: "How long a ballot stays open",
    description:
      "Days between a ballot opening and its votes locking. Votes can be changed freely until then. The clock closes the ballot when the window ends and the village's own engine reads the result, so nobody chooses the moment. A change to the Game then waits again, for the window a steward can stop it in.",
    type: "integer",
    default: "7",
    min: 1,
    max: 30,
    unit: "days",
  },
  {
    key: "governance.consent_window_days",
    category: "Governance",
    label: "How long a consent window stays open",
    description:
      "Days an objection window runs on a consent ballot. A consent decision passes when the window has ended, participation met quorum, and no objection still stands open. Objections are ruled by a facilitator, and every ruling is attributed and explained on the record.",
    type: "integer",
    default: "7",
    min: 1,
    max: 30,
    unit: "days",
  },
  {
    key: "governance.default_method",
    category: "Governance",
    label: "How village-wide ballots decide",
    criticality: "structural",
    description:
      "The method a village-wide ballot uses when nothing more specific applies. Your own dials use the unity and quorum settings above. Majority means more than half of the votes cast carries it. Consensus means everyone who takes a side agrees. Consent means a decision passes when nobody sustains a reasoned objection. Hypha keeps the shipped loop: proposals go to your Hypha space for the binding vote.",
    type: "choice",
    default: "custom",
    choices: [
      { value: "custom", label: "This village's own dials", hint: "Uses the unity and quorum settings above." },
      { value: "majority", label: "Majority", hint: "More than half of the votes cast carries it." },
      { value: "consensus", label: "Consensus", hint: "Everyone who takes a side agrees." },
      { value: "consent", label: "Consent", hint: "Passes when no reasoned objection stands." },
      { value: "hypha", label: "Decide on Hypha", hint: "The shipped loop: the binding vote happens in your Hypha space." },
    ],
  },
  // -- Governance: what each tier of change costs (Q11, 2026-09-02) ---------
  //
  // Every setting carries a criticality tier and the tier names the least
  // unity and quorum a change to it may be decided on. These eight dials are
  // where a village raises its own bars. They can only be raised: `min` on
  // each one is the platform floor from `TIER_FLOORS`, so nothing here can
  // walk a bar downwards, and `thresholdSettingsFrom` in
  // `shared/ballotSubjects.ts` applies the same floor again on read so a
  // value written by anything other than this validator cannot lower it
  // either. One source for the number, two layers that refuse to go under it.
  //
  // They are constitutional themselves, because a village that can lower the
  // bar for changing the bar has no bar.
  {
    key: "governance.tier_routine_quorum_pct",
    category: "Governance",
    label: "Routine changes: quorum floor",
    description:
      "The least share of the village's voting weight that must turn up before an ordinary change to the Game can be decided. Ordinary means a number the village tunes while it plays. 0 leaves it entirely to your own quorum setting above, which is the shipped posture. Raise it to ask for more attention on every change, however small.",
    type: "percentage",
    default: String(TIER_FLOORS.routine.quorumPct),
    min: TIER_FLOORS.routine.quorumPct,
    max: 100,
    unit: "%",
    criticality: "constitutional",
  },
  {
    key: "governance.tier_routine_unity_pct",
    category: "Governance",
    label: "Routine changes: unity floor",
    description:
      "The least share of the votes cast for or against that must be in favour before an ordinary change to the Game carries. 0 leaves it entirely to your own unity setting above, which is the shipped posture.",
    type: "percentage",
    default: String(TIER_FLOORS.routine.unityPct),
    min: TIER_FLOORS.routine.unityPct,
    max: 100,
    unit: "%",
    criticality: "constitutional",
  },
  {
    key: "governance.tier_structural_quorum_pct",
    category: "Governance",
    label: "Structural changes: quorum floor",
    description:
      "The least share of the village's voting weight that must turn up before a structural change can be decided. Structural means it changes how the village decides or who belongs to it: the unity and quorum settings themselves, how ballots decide, who may be admitted, what the village mints, and turning a part of the Game on or off. The shipped 50 is this platform's starting number and your village may raise it. It cannot go below the platform floor.",
    type: "percentage",
    default: String(TIER_FLOORS.structural.quorumPct),
    min: TIER_FLOORS.structural.quorumPct,
    max: 100,
    unit: "%",
    criticality: "constitutional",
  },
  {
    key: "governance.tier_structural_unity_pct",
    category: "Governance",
    label: "Structural changes: unity floor",
    description:
      "The least share of the votes cast for or against that must be in favour before a structural change carries. The shipped 80 is the number this platform inherited from Hypha, and it is a starting point your village may raise. It cannot go below the platform floor.",
    type: "percentage",
    default: String(TIER_FLOORS.structural.unityPct),
    min: TIER_FLOORS.structural.unityPct,
    max: 100,
    unit: "%",
    criticality: "constitutional",
  },
  {
    key: "governance.tier_constitutional_quorum_pct",
    category: "Governance",
    label: "Constitutional changes: quorum floor",
    description:
      "The least share of the village's voting weight that must turn up before a constitutional change can be decided. Constitutional means it changes the rules for changing the rules: how voting weight is assigned, which token carries weight, and these bars themselves. The shipped number is 97, which leaves room for 3 in 100 to be unreachable on the day. Going higher is allowed and the Game will warn you why it is risky.",
    type: "percentage",
    default: String(TIER_FLOORS.constitutional.quorumPct),
    min: TIER_FLOORS.constitutional.quorumPct,
    max: 100,
    unit: "%",
    criticality: "constitutional",
  },
  {
    key: "governance.tier_constitutional_unity_pct",
    category: "Governance",
    label: "Constitutional changes: unity floor",
    description:
      "The least share of the votes cast for or against that must be in favour before a constitutional change carries. The shipped number is 97. Going higher is allowed and the Game will warn you why it is risky.",
    type: "percentage",
    default: String(TIER_FLOORS.constitutional.unityPct),
    min: TIER_FLOORS.constitutional.unityPct,
    max: 100,
    unit: "%",
    criticality: "constitutional",
  },
  {
    /*
     * THE HIGHEST TIER THIS VILLAGE HAS SET, and the bar a veto override
     * clears (19E). The founder's words of 2026-09-03: "We can have a veto
     * override if it goes up to the highest tier they have set as a village
     * (this is also a setting that can change at the highest tier set)."
     *
     * The registry tier below is the FLOOR on what it costs to move this.
     * The live price is the tier this setting itself names, worked out by
     * `thresholdChangePrice` in `shared/ballotSubjects.ts`, which is the
     * "priced at itself" half of his sentence. Without that, a village could
     * name the routine tier here on a quiet week and hand every future veto
     * an override that costs nothing.
     */
    // The literal, because the generated governance document reads this
    // registry as source text. `HIGHEST_TIER_KEY` in `shared/ballotSubjects.ts`
    // holds the same string and `gameVariables.test.ts` pins the pair equal.
    key: "governance.highest_tier",
    category: "Governance",
    label: "The tier a veto override is passed at",
    description:
      "A steward can veto a change the village passed. The village can bring the same proposal back and pass it again at this tier, and then it lands whatever any steward says. This names which tier that is: the highest one your village works at. Moving this setting costs whatever the tier it currently names costs, so lowering it is as hard as the bar you are lowering.",
    type: "choice",
    default: "constitutional",
    choices: [
      { value: "routine", label: "Routine", hint: "Your own unity and quorum settings decide an override." },
      { value: "structural", label: "Structural", hint: "An override asks the structural bar: how the village decides." },
      { value: "constitutional", label: "Constitutional", hint: "An override asks the highest bar this platform ships." },
    ],
    criticality: "constitutional",
  },
  {
    key: "governance.subject_mint_rule_quorum_pct",
    category: "Governance",
    label: "Minting rule changes: quorum floor",
    description:
      "The least share of the village's voting weight that must turn up before a change to what the village mints can be decided. This one sits on top of the structural tier, so raising it asks for more attention on minting alone without moving every other structural change with it. Cannot be set below the platform floor.",
    type: "percentage",
    default: String(SUBJECT_THRESHOLDS[MINT_RULE].minQuorumPct),
    min: SUBJECT_THRESHOLDS[MINT_RULE].minQuorumPct,
    max: 100,
    unit: "%",
    criticality: "constitutional",
  },
  {
    key: "governance.subject_mint_rule_unity_pct",
    category: "Governance",
    label: "Minting rule changes: unity floor",
    description:
      "The least share of the votes cast for or against that must be in favour before a change to what the village mints carries. 0 leaves it to the structural tier and your own unity setting.",
    type: "percentage",
    default: String(SUBJECT_THRESHOLDS[MINT_RULE].minUnityPct),
    min: SUBJECT_THRESHOLDS[MINT_RULE].minUnityPct,
    max: 100,
    unit: "%",
    criticality: "constitutional",
  },
  /*
   * ── WHOSE WEIGHT THE QUORUM COUNTS (19G, 2026-09-03) ──────────────────────
   *
   * The founder brought voice for other beings from the first day of a village,
   * and 19F made quorum pure token weight. Put together with no third rule, a
   * river holding a share of the Voice sits in every quorum denominator whether
   * or not anybody ever speaks for it, and a handful of quiet seats puts the
   * top tier permanently out of reach with no door.
   *
   * These two dials are the door, and they are arithmetic telling the truth
   * about a bar. No threshold moves, and a village that misses quorum still
   * misses it. Both carry the constitutional tier, because a dial that moves
   * the denominator has the same power over an outcome as one that moves the
   * bar, and `isMetaSetting` in shared/ballotSubjects.ts names both so neither
   * can be tried for a moon at a lower price.
   */
  {
    key: "governance.nonhuman_in_quorum",
    category: "Governance",
    label: "Seats speaking for other beings count toward quorum",
    criticality: "constitutional",
    description:
      "Your village can seat a voice for a being that is not a person: a mountain, a river, the trees, the wolves. A member or a bot holds that seat and casts its vote. This says whether the weight on such a seat is part of the count that decides whether enough of the village turned up. Off, which is how it ships, leaves that weight out of the count on both sides of the sum, and a vote cast from the seat still counts toward agreement. On counts it like any member's, and weight that provably cannot answer drops out of the count instead.",
    type: "boolean",
    default: "false",
  },
  {
    key: "governance.absent_cycles",
    category: "Governance",
    label: "Cycles of silence before a seat leaves the count",
    criticality: "constitutional",
    description:
      "When seats speaking for other beings do count toward quorum, this is how many cycles of casting nothing it takes before such a seat's weight drops out of the count. A seat nobody holds drops out straight away. The weight is always shown beside the people count, so the village can see how much of its Voice is silent. Nothing here changes a threshold: it changes what the threshold is measured against.",
    type: "integer",
    default: "3",
    min: 1,
    max: 24,
    unit: "cycles",
  },
  {
    key: "membership.vouch_threshold",
    category: "Governance",
    label: "Vouches to admit a member",
    criticality: "structural",
    description:
      "How many standing members must vouch for an applicant before membership completes on its own. 0 keeps vouching off and admission stays whatever your current process is. Vouching comes from contributors and up, a member may never vouch for themself, and every vouch is on the record.",
    type: "integer",
    default: "0",
    min: 0,
    max: 20,
    unit: "vouches",
  },

  // ── Tokens: read from Base, governed on Hypha ──────────────────────────────
  {
    key: "tokens.equity_address",
    category: "Tokens",
    label: "Equity token contract address on Base",
    description:
      "The ERC-20 address for the project's equity token. The platform only ever READS this balance to display it: minting, pricing and governance all happen on Hypha. Leave blank until the token is deployed and nothing is shown.",
    type: "text",
    default: "",
  },
  {
    key: "tokens.voice_address",
    category: "Tokens",
    label: "Governance token contract address on Base",
    description:
      "The ERC-20 address for the governance-weight token. Read-only here, exactly like the equity token.",
    type: "text",
    default: "",
  },
  {
    key: "tokens.show_economics_section",
    category: "Tokens",
    label: "Show the economics section",
    description:
      "Displays token balances and Gratitude flows on member profiles. Turn off while the tokens are still being designed so members are not shown empty charts.",
    type: "boolean",
    default: "false",
  },
  {
    key: "tokens.base_rpc_url",
    category: "Tokens",
    label: "Base RPC endpoint",
    description:
      "Where balances are read from. A public endpoint is fine to start; a dedicated one is more reliable under load. If this fails, the platform shows nothing, never a wrong number.",
    type: "text",
    default: "https://mainnet.base.org",
  },

  // ── Hypha (S13): the SINGLE home for the DHO URL. Everything share-like —
  //    governance, voting, equity — happens on Hypha; the platform deep-links
  //    and never rebuilds it. Blank = every Hypha surface hides. ─────────────
  {
    key: "hypha.org_url",
    category: "Hypha",
    label: "Your Hypha DHO address",
    description:
      "The one place this platform sends people for governance, proposals, treasury and membership on Hypha. Every module derives its deep links from this single value; leaving it blank hides every Hypha button, so nobody meets a dead link.",
    type: "text",
    default: "",
  },
  {
    key: "hypha.space_id",
    category: "Hypha",
    label: "Hypha space id (on-chain)",
    description:
      "The numeric id of your DAO's space on Hypha's Base contracts. Every on-chain proposal your DAO creates is stamped with it. Found in your Hypha space's URL or from any of its proposals on Basescan. Fill this in and the governance webhook checks it: a delivery that names a different space is refused, even when its signature is good, because one hub watches Base for many villages off one listener and a routing mistake there arrives correctly signed. A delivery that names no space at all is still accepted and an operator is told, so an idle check is never read as a passing one. Blank checks nothing.",
    type: "text",
    default: "",
    ring: "founder",
  },
  {
    key: "hypha.treasury_address",
    category: "Hypha",
    label: "DAO treasury address on Base",
    description:
      "The 0x address holding your DAO's treasury on Base. The Hypha Bridge module reads what this address holds of each confirmed token and shows it as a fact about the village. Leave it blank and only total supply is shown. Reading it never moves anything: the platform displays what Base says and links you out to Hypha to act.",
    type: "text",
    default: "",
    ring: "founder",
  },
  {
    key: "hypha.founder_base_address",
    category: "Hypha",
    label: "Founder Base account address",
    description:
      "The 0x address that created your DAO and issued its first tokens on Base. Used by Integrate DAO to discover your token contracts automatically: issue yourself even a tiny amount of each token, and the lookup finds the contract by the token's exact name in this account's transfer history.",
    type: "text",
    default: "",
    ring: "founder",
  },
  {
    key: "hypha.link_governance",
    category: "Hypha",
    label: "Override: governance link",
    description: "Only if your DHO's governance page is not at the org root. Blank derives from the DHO address.",
    type: "text",
    default: "",
  },
  {
    key: "hypha.link_proposals",
    category: "Hypha",
    label: "Override: proposals link",
    description: "Only if your DHO's proposals page is not at /agreements. Blank derives from the DHO address.",
    type: "text",
    default: "",
  },
  {
    key: "hypha.link_treasury",
    category: "Hypha",
    label: "Override: treasury link",
    description: "Only if your DHO's treasury page is not at /treasury. Blank derives from the DHO address.",
    type: "text",
    default: "",
  },
  {
    key: "hypha.link_members",
    category: "Hypha",
    label: "Override: members link",
    description: "Only if your DHO's members page is not at /members. Blank derives from the DHO address.",
    type: "text",
    default: "",
  },

  // ── Tools hub (S15; visible in Admin only while the module is non-off) ────
  {
    key: "tools.click_tracking",
    category: "Tools",
    label: "Count tool opens",
    description:
      "When on, opening a tool records an anonymous-friendly click row (member id attached only for signed-in members) so admins can see which tools the village actually uses. Turning it off records nothing, a village-level privacy choice.",
    type: "boolean",
    default: "true",
  },
  {
    key: "tools.link_check_days",
    category: "Tools",
    label: "Days between automatic link checks",
    description:
      "0 means manual-only: admins run 'Check links now' from the Tools tab. A cadence takes effect once the platform scheduler ships (v3 S16); setting it earlier is harmless and remembered.",
    type: "integer",
    default: "0",
    min: 0,
    max: 90,
    unit: "days",
  },

  // ── Data lifecycle (S18). Every fork inherits this posture — Gate F's
  //    legal scope includes data protection (Costa Rica Law 8968). ──────────
  // ── Sessions & email delivery ─────────────────────────────────────────────
  {
    key: "auth.session_days",
    category: "Accounts & sessions",
    label: "Signed-in session length",
    description:
      "How long a sign-in lasts before the member has to sign in again. Applies to sessions started AFTER a change: existing sessions keep the length they were minted with. Shorter is safer on shared devices; longer is kinder on personal phones.",
    type: "integer",
    default: "30",
    min: 1,
    max: 365,
    unit: "days",
  },
  {
    key: "notify.daily_email_cap",
    category: "Accounts & sessions",
    label: "Most emails one member receives per day",
    description:
      "Over this many notification emails in a rolling 24 hours, further ones stay in-app only (the notification itself is never lost; only the email is skipped). A ceiling on noisy days, not a quota: raise it for a large, busy village.",
    type: "integer",
    default: "20",
    min: 1,
    max: 200,
    unit: "per day",
  },

  // ── Abuse guards: throttles on the public writers ─────────────────────────
  // Per-IP unless stated. These are ceilings on ABUSE, not on members: keep
  // them generous — a whole village behind one NAT shares each IP bucket.
  {
    key: "abuse.register_per_ip_hourly",
    category: "Abuse guards",
    label: "Registrations per IP per hour",
    description:
      "How many account registrations one IP address may attempt per hour. Also bounds how fast an outsider can probe which email addresses belong to members. An onboarding gathering behind one shared connection counts as one IP, so keep this comfortably above the size of a signup circle.",
    type: "integer",
    default: "30",
    min: 1,
    max: 1000,
    unit: "per hour",
  },
  {
    key: "abuse.login_ip_per_quarter_hour",
    category: "Abuse guards",
    label: "Failed logins per IP per 15 minutes",
    description:
      "How many FAILED sign-in attempts one IP address may make per 15 minutes. Successful sign-ins never count. The per-account limit below is the real brute-force bound; this one only caps bulk abuse from a single address, so it can stay loose.",
    type: "integer",
    default: "30",
    min: 1,
    max: 1000,
    unit: "per 15 min",
  },
  {
    key: "abuse.login_account_per_quarter_hour",
    category: "Abuse guards",
    label: "Failed logins per account per 15 minutes",
    description:
      "How many FAILED sign-in attempts any one account may receive per 15 minutes, from all addresses combined: the bound an attacker with many IPs cannot dodge. Successful sign-ins never count. Anyone who knows an address can briefly lock that account out by failing on purpose, so do not set this too low.",
    type: "integer",
    default: "10",
    min: 1,
    max: 100,
    unit: "per 15 min",
  },
  {
    key: "abuse.password_reset_per_ip_hourly",
    category: "Abuse guards",
    label: "Password-reset requests per IP per hour",
    description:
      "How many 'forgot password' requests one IP address may make per hour. Each one can send an email, so this bounds using the village as a mail cannon. A separate per-address limit always applies as well, so one member cannot be mail-bombed from many addresses.",
    type: "integer",
    default: "10",
    min: 1,
    max: 200,
    unit: "per hour",
  },
  {
    key: "abuse.investor_docs_per_ip_hourly",
    category: "Abuse guards",
    label: "Investor-packet requests per IP per hour",
    description:
      "How many investor document requests one IP address may make per hour. Each request stores a lead and emails the packet to the address given, so unthrottled it doubles as a spam cannon. Several genuine investors behind one corporate network share a bucket, so keep this above 1.",
    type: "integer",
    default: "3",
    min: 1,
    max: 100,
    unit: "per hour",
  },

  {
    key: "retention.submissions_days",
    category: "Data lifecycle",
    label: "Keep handled form submissions for",
    description:
      "Form submissions carry personal details (names, emails, phone numbers). Once a submission has been handled (any status other than new), it is deleted this many days after it arrived. Unhandled submissions are never swept: an unread message is a commitment, not clutter. 0 keeps everything forever.",
    type: "integer",
    default: "365",
    min: 0,
    max: 3650,
    unit: "days",
  },
  {
    key: "retention.notifications_days",
    category: "Data lifecycle",
    label: "Keep read notifications for",
    description:
      "Read notifications older than this are deleted by the daily sweep. Unread ones stay: they have not done their job yet. 0 keeps everything forever.",
    type: "integer",
    default: "90",
    min: 0,
    max: 3650,
    unit: "days",
  },
  {
    key: "uploads.orphan_grace_days",
    category: "Data lifecycle",
    label: "Leave an unreferenced upload alone for",
    description:
      "The uploads volume holds files from five doors: proposal attachments, brand images, village fonts, investor documents and members' photographs. Admin > Uploaded Files lists the ones no row in the database points at, and this is how long a file is left alone before it can appear on that list. The window protects a picture you have just replaced: swapping an image mints a new address by design, so the old file goes unreferenced the moment the new one lands while every browser and every email already sent still points at it. Nothing is ever removed without somebody pressing the button.",
    type: "integer",
    default: "30",
    min: 1,
    max: 3650,
    unit: "days",
    ring: "founder",
  },

  // ── Call automation ──────────────────────────────────────────────────────
  {
    key: "assistant.synthesis_batch",
    category: "Automation",
    label: "Draft call syntheses in the background at half price",
    description:
      "Recordings that have a transcript and no synthesis are sent to the model in one batch instead of one call at a time. Every token in a batch costs half. Results usually arrive within an hour and can take up to a day, so this suits the recordings nobody is waiting on. The Synthesize button in Admin is unaffected: it still answers straight away at full price, because a person is watching it. Off keeps every synthesis something a person asks for.",
    type: "boolean",
    default: "false",
    ring: "founder",
  },

  // ── Village map (S19-S23; visible in Admin only while the module is non-off) ──
  {
    key: "map.public_structure",
    category: "Village map",
    label: "Show the map's structure to visitors",
    description:
      "When the map module is public, anonymous visitors see circles, role titles and seat counts, never names or faces. Off hides the map from visitors entirely, even at public lifecycle.",
    type: "boolean",
    default: "true",
  },
  {
    key: "map.concierge_enabled",
    category: "Village map",
    label: "Show the coordination concierge",
    description:
      "The 'what do you want to do?' bar that routes a member to the right circle, role or quest. Deterministic matching always runs first; the assistant is only consulted for ambiguous asks, and only when an API key is configured.",
    type: "boolean",
    default: "true",
  },
  {
    key: "map.contact_daily_cap",
    category: "Village map",
    label: "Contact requests a member may send per day",
    description: "The relay's outbound brake. 0 disables the contact relay entirely.",
    type: "integer",
    default: "5",
    min: 0,
    max: 50,
    unit: "messages",
  },
  {
    key: "map.contact_recipient_daily_cap",
    category: "Village map",
    label: "Contact requests one person receives per day",
    description:
      "Protects busy role holders. Once someone's day is full, would-be senders are pointed at the circle's open quests instead.",
    type: "integer",
    default: "3",
    min: 1,
    max: 20,
    unit: "messages",
  },
  {
    key: "map.show_quests",
    category: "Village map",
    label: "Show open quests on the map",
    description: "Open quests orbit their circle as small satellites, capped for legibility.",
    type: "boolean",
    default: "true",
  },
  {
    key: "map.vacant_highlight",
    category: "Village map",
    label: "Highlight vacant seats",
    description: "Vacant roles pulse gently as an open call. Off renders them as plain grey rings.",
    type: "boolean",
    default: "true",
  },
  {
    key: "map.contact_retention_days",
    category: "Village map",
    label: "Keep contact message bodies for",
    description:
      "Relay message bodies are personal correspondence: the daily sweep clears bodies older than this while keeping the contact event itself (who reached whom, when). 0 keeps bodies forever.",
    type: "integer",
    default: "180",
    min: 0,
    max: 3650,
    unit: "days",
  },

  // ── Photographs of a place (0093) ────────────────────────────────────────
  //
  // Five dials, all of them read. A village decides how many pictures its map
  // holds, how big each one may be, how fast one member may fill it, when the
  // village's own reports take a picture down on their own, and how long a
  // removed photograph's record is kept before it is forgotten.
  {
    key: "map.photo_max_mb",
    category: "Village map",
    label: "Largest photograph a member may upload",
    description:
      "Measured on the file that arrives. The browser shrinks a picture to WebP before it is sent, so a phone photo usually lands far under this; the ceiling is what stops an untouched original from spending the whole volume. At 1 the pipeline still accepts a prepared phone photo. At 25 one picture can cost 25 MB of the uploads volume, and /health reports what the photographs are using.",
    type: "integer",
    default: "8",
    min: 1,
    max: 25,
    unit: "MB",
    ring: "founder",
  },
  {
    key: "map.photos_per_place",
    category: "Village map",
    label: "Photographs one place may hold",
    description:
      "Counts the pictures currently on a place, so a takedown frees a slot. 0 means no place accepts a photograph and the upload control is gone from every gallery. At 500 one place can hold five hundred pictures and its gallery pages through them.",
    type: "integer",
    default: "60",
    min: 0,
    max: 500,
    unit: "photos",
  },
  {
    key: "map.photos_per_member_daily",
    category: "Village map",
    label: "Photographs one member may add per day",
    description:
      "Counted across every place over the last 24 hours. 0 closes contribution for everyone, whatever their stage or role. At 200 one member can add two hundred pictures in a day.",
    type: "integer",
    default: "12",
    min: 0,
    max: 200,
    unit: "photos",
  },
  {
    key: "map.photo_report_hide_threshold",
    category: "Village map",
    label: "Reports that hide a photograph on their own",
    description:
      "Distinct members flagging one picture. Once this many have, it leaves the gallery and waits for a curator, who can put it back. 0 means the village's reports never hide anything by themselves and a curator acts on every one. A person asking for a photograph OF THEMSELVES to come down is a different act and never waits for this number: one is always enough.",
    type: "integer",
    default: "3",
    min: 0,
    max: 50,
    unit: "reports",
  },
  {
    key: "map.photo_tombstone_days",
    category: "Village map",
    label: "Keep the record of a removed photograph for",
    description:
      "A photograph taken down loses its file immediately. What stays is the record of the takedown, so a curator can still see what they decided and which report it answered. The daily sweep forgets that record after this many days. 0 keeps it forever.",
    type: "integer",
    default: "180",
    min: 0,
    max: 3650,
    unit: "days",
    ring: "founder",
  },

  /*
   * ── The village's people (R57) ─────────────────────────────────────────
   *
   * Deliberately NOT in the map module's `variableKeys`. The pages this
   * governs are `/team`, `/roles` and `/circles`, which are plain routes with
   * no module gate, and `/api/org` answers with the map module OFF (there is
   * a test for exactly that). A dial hidden behind a module the village never
   * enabled would be a dial they could not find.
   *
   * FOUNDER-HELD, unlike its sibling `map.public_structure`, which is Ring 2.
   * That one publishes STRUCTURE and says in its own description that it
   * never publishes names or faces. This one publishes the names of real
   * people who did not vote on the question, which is the same reason EXIF
   * stripping and a subject's right to remove their photo sit outside the
   * village's dials. A founder can be asked; a proposal cannot be un-passed
   * for the person it named.
   */
  {
    key: "org.public_people",
    category: "The village's people",
    label: "Show who holds each seat to visitors",
    description:
      "On, anyone can read the first names of the people holding each seat on the Team, Roles and Circles pages. Off keeps those names for signed-in members whose role or badge grants map.viewPeople, and a visitor still sees every circle, every seat, and how many of them are filled. This is the secret society setting. It moves names only: the shape of the village stays public at both settings.",
    type: "boolean",
    default: "true",
    ring: "founder",
  },

  // ── Events (0059; visible in Admin only while the module is non-off) ─────
  //
  // Three knobs, and all three are READ. A registered variable nothing reads
  // is a lie with a save button: an admin changes it, believes the village
  // behaves differently, and says so out loud. rsvp_enabled gates the RSVP
  // route, and the two windows bound the list query.
  {
    key: "events.rsvp_enabled",
    category: "Events",
    label: "Let members RSVP",
    description:
      "Members can say they are coming, and a gathering with a capacity counts them against it. Off leaves the calendar readable and takes no answers, which suits a village that handles attendance elsewhere.",
    type: "boolean",
    default: "true",
  },
  {
    key: "events.upcoming_days",
    category: "Events",
    label: "Show gatherings this far ahead",
    description:
      "How far into the future the calendar looks. Anything starting beyond this is stored and stays hidden until it comes into range.",
    type: "integer",
    default: "90",
    min: 1,
    max: 730,
    unit: "days",
  },
  {
    key: "events.past_visible_days",
    category: "Events",
    label: "Keep finished gatherings listed for",
    description:
      "A gathering that has ended stays on the calendar this long. Dropping one the moment it starts tells somebody standing at the door that nothing is happening.",
    type: "integer",
    default: "30",
    min: 0,
    max: 365,
    unit: "days",
  },

  // ── Forum (S24-S26; visible in Admin only while the module is non-off) ────
  {
    key: "forum.report_hide_threshold",
    category: "Forum",
    label: "Soft reports that auto-hide a post",
    description:
      "When this many DIFFERENT members soft-report the same thread or reply, it hides automatically pending moderation, so the community can act before a moderator wakes up. Hard reports always go straight to the queue without hiding.",
    type: "integer",
    default: "3",
    min: 2,
    max: 10,
    unit: "reports",
  },

  // ── Messaging (visible in Admin only while the module is non-off) ─────────
  {
    key: "messaging.sends_per_minute",
    category: "Messages",
    label: "Messages one member may send per minute",
    description:
      "The send limit, counted per member across every conversation they are in. High enough that a fast typer in a live conversation never feels it, low enough that a stolen token cannot spray the village. Members who hit it are told to slow down and can send again the next minute.",
    type: "integer",
    default: "20",
    min: 1,
    max: 120,
    unit: "messages",
  },
  {
    key: "messaging.max_members",
    category: "Messages",
    label: "Largest group conversation",
    description:
      "How many people one group thread may hold, the creator included. Every message notifies everyone in the thread who has not muted it, so this number is also the size of the loudest single send anyone can make.",
    type: "integer",
    default: "50",
    min: 2,
    max: 500,
    unit: "people",
  },

  // ── Gratitude feed (S27-S29; visible while the feed module is non-off) ────
  {
    key: "feed.category_slug",
    category: "Feed",
    label: "Which forum category the feed shows",
    description:
      "The feed is a LENS over one forum category plus the village's system events. It is not a second content store. Point it at the category where everyday village life gets posted.",
    type: "text",
    default: "village-life",
  },
  {
    key: "feed.show_system_events",
    category: "Feed",
    label: "Weave the village's own milestones into the feed",
    description:
      "On, the feed mixes what the village DID (quests consented, seasons turning, people arriving) " +
      "in among what people wrote. Off, it is only posts. A young village usually wants this on, because " +
      "a feed with three posts and no events reads as abandoned.",
    type: "boolean",
    default: "true",
  },
  {
    key: "feed.max_post_length",
    category: "Feed",
    label: "How much of a long post the feed shows",
    description:
      "Posts longer than this are cut off in the feed with the rest behind the post itself. Nothing is " +
      "deleted; this only decides how much of a long piece takes over the page.",
    type: "integer",
    default: "600",
    min: 120,
    max: 4000,
    unit: "characters",
  },
  {
    // CATEGORY "Gratitude", DELIBERATELY, THOUGH THE KEY IS `feed.*`.
    //
    // Game Mechanics groups by this string and every group starts collapsed
    // with only its name and a count showing, so a label in an unopened group
    // is a label nobody can read and Ctrl+F cannot reach. These two dials and
    // the two gratitude ones answer ONE question ("how much recognition can
    // one member give another"), and a founder who has to guess two category
    // names to see the whole answer has not been given the dial.
    //
    // Nothing branches on the category string: `ringOf` tests only
    // FOUNDER_CATEGORIES, which holds neither name, and module visibility is
    // keyed on `variableKeys` in shared/modules.ts, never on this. So a
    // village running without the feed still never sees these two, and a
    // founder switching the Feed module on still finds them named on its card.
    key: "feed.heart_amount",
    category: "Gratitude",
    label: "Gratitude each heart sends",
    description:
      "What one tap of appreciation on the feed is worth. A heart is a real send: it comes out of the tapper's own cycle allowance the same way a written acknowledgment does, so a larger heart empties an allowance faster and reaches the per-person share sooner. It will not go above 5, which keeps a tap a small and frequent gesture. Raising it makes every heart heavier and changes nothing about how many a member can leave. Works with: 'Base sending allowance per cycle', 'Share of an allowance any one person can receive', 'Hearts one member can tap for another per cycle', and 'Sending-budget multiplier' under Progression.",
    type: "integer",
    default: "1",
    min: 1,
    max: 5,
    unit: "Gratitude",
  },
  {
    // Category "Gratitude" for the reason spelled out on `feed.heart_amount`.
    key: "feed.max_hearts_per_recipient_per_cycle",
    category: "Gratitude",
    label: "Hearts one member can tap for another per cycle",
    description:
      "How many separate taps of appreciation one member can leave for another in a cycle. THE ONLY LIMIT IN THE VILLAGE THAT COUNTS TAPS: every other limit on giving counts Gratitude. Each tap spends the tapper's own cycle allowance, so the real ceiling is whichever runs out first, this count or the share of the allowance any one person can receive. At the stock dials a member can leave 5 hearts worth 1 each, well inside a share of 25. Set it to 1 to make a heart a once-per-cycle gesture; set it high and the share becomes the only thing holding the channel. Works with: 'Base sending allowance per cycle', 'Share of an allowance any one person can receive', 'Gratitude each heart sends', and 'Sending-budget multiplier' under Progression.",
    type: "integer",
    default: "5",
    min: 1,
    max: 20,
    unit: "hearts",
  },

  // ── Stays: accommodation on stay credits (funds-bearing module) ───────────
  {
    key: "stay.guest_booking_enabled",
    category: "Stays",
    label: "Guests can request stays",
    description:
      "When off, only members can request a stay; visitors see the catalog but must join (or write in) first.",
    type: "boolean",
    default: "true",
  },
  {
    key: "stay.autopay_default",
    category: "Stays",
    label: "New stays autopay by default",
    description:
      "Whether a newly activated stay burns one credit per night automatically. A guest can have autopay turned off per-stay by an admin (e.g. billing disputes).",
    type: "boolean",
    default: "true",
  },
  {
    key: "stay.autopay_post_hour",
    category: "Stays",
    label: "Hour nightly credits post (UTC)",
    description:
      "The scheduler posts each active stay's nightly credit once per day at (or after) this hour, UTC. Catch-up is automatic and idempotent if the server slept through a night.",
    type: "integer",
    default: "10",
    min: 0,
    max: 23,
    unit: "h UTC",
  },
  {
    key: "stay.low_balance_warn_nights",
    category: "Stays",
    label: "Low-balance warning threshold",
    description:
      "Notify a guest when their remaining credits cover this many nights or fewer at their current rate.",
    type: "integer",
    default: "2",
    min: 0,
    max: 30,
    unit: "nights",
  },
  {
    key: "stay.grace_nights",
    category: "Stays",
    label: "Grace nights below zero",
    description:
      "How many nights a stay may keep posting after the balance hits zero before autopay refuses and admins are alerted. The debt is real and visible: a negative balance, not a hidden tab.",
    type: "integer",
    default: "2",
    min: 0,
    max: 14,
    unit: "nights",
  },
  {
    key: "stay.max_purchase_nights",
    category: "Stays",
    label: "Most nights purchasable at once",
    description: "Ceiling on a single credit purchase, counted in nights at the room's posted rate.",
    type: "integer",
    default: "60",
    min: 1,
    max: 365,
    unit: "nights",
  },
  {
    key: "stay.credit_expiry_days",
    category: "Stays",
    label: "Credit expiry (0 = never)",
    description:
      "Days until unspent stay credits expire. 0 means they never expire. Expiry is a policy contract shipped ahead of enforcement: v1 does not yet sweep expired credits.",
    type: "integer",
    default: "0",
    min: 0,
    max: 3650,
    unit: "days",
  },
  {
    key: "stay.credits_transferable",
    category: "Stays",
    label: "Members can gift credits to each other",
    description:
      "Off by default: credits are personal. Turning this on lets a member transfer credits to another member (a future surface; the token stays non-transferable until then).",
    type: "boolean",
    default: "false",
  },
  {
    key: "stay.work_exchange_tag",
    category: "Stays",
    label: "Work-exchange quest tag",
    description:
      "Quests carrying this tag appear on the Stay page as ways to EARN credits. The reward itself lives on each quest (stay-credit reward field).",
    type: "text",
    default: "work-exchange",
  },

  // ── Exchange: the buy-only token market ──────────────────────────────────
  {
    key: "exchange.price_change_max_pct",
    category: "Exchange",
    label: "Largest single price change",
    description:
      "How far one posted price may move from the previous one, in percent. Big moves happen in bounded steps, each with its own note, so the price history stays a story, not a cliff. 0 removes the bound.",
    type: "integer",
    default: "20",
    min: 0,
    max: 1000,
    unit: "%",
  },

  // ── Library: the material library's credit economy ───────────────────────
  {
    key: "library.intake_award_pct",
    category: "Library",
    label: "Intake award, % of appraisal",
    description:
      "What a donor earns, as a share of the item's appraised replacement value. Never above 100: the mint's front door pays at most what the shelf gained.",
    type: "integer",
    default: "75",
    min: 0,
    max: 100,
    unit: "%",
  },
  {
    key: "library.intake_member_cycle_cap",
    category: "Library",
    label: "Intake credits per member per cycle",
    description:
      "The most one member can earn from donations in one lunation. Intake is a mint; this is its per-person throttle. 0 disables the cap.",
    type: "integer",
    default: "500",
    min: 0,
    max: 100000,
    unit: "credits",
  },
  {
    key: "library.intake_dual_signoff_over",
    category: "Library",
    label: "Dual sign-off above (appraisal)",
    description:
      "An item appraised above this needs a SECOND steward's approval before any credits mint. 0 turns the second signature off.",
    type: "integer",
    default: "200",
    min: 0,
    max: 100000,
    unit: "credits",
  },
  {
    key: "library.escrow_pct",
    category: "Library",
    label: "Borrowing escrow, % of value",
    description:
      "The deposit locked while an item is out, as a share of its appraised value. Returned at settle, minus wear and damage.",
    type: "integer",
    default: "25",
    min: 0,
    max: 200,
    unit: "%",
  },
  {
    key: "library.usage_fee_pct",
    category: "Library",
    label: "Usage fee per loan, % of value",
    description:
      "The default wear fee a normal return pays into the library pool, and what a dispute resolves to after its deadline (computed wear, zero damage).",
    type: "integer",
    default: "5",
    min: 0,
    max: 100,
    unit: "%",
  },
  {
    key: "library.loan_days_default",
    category: "Library",
    label: "Loan length",
    description: "Days from pickup to due date.",
    type: "integer",
    default: "14",
    min: 1,
    max: 365,
    unit: "days",
  },
  {
    key: "library.dispute_deadline_days",
    category: "Library",
    label: "Dispute deadline",
    description:
      "How long a disputed return may sit before stewards settle it with the default outcome (computed wear, zero damage). A policy contract surfaced in the admin panel; v1 does not auto-settle.",
    type: "integer",
    default: "14",
    min: 1,
    max: 90,
    unit: "days",
  },

  {
    key: "exchange.swap_spread_bps",
    category: "Exchange",
    label: "The village's share of each swap",
    description:
      "In basis points, so half a percent is expressible (50 = 0.50%). This is a POLICY dial, not the safety mechanism: a swap can never profit the member even at 0, because the amount they hand over always rounds up. At 0 the confirm card reads 'the village keeps nothing on this swap'.",
    type: "integer",
    default: "0",
    min: 0,
    max: 2000,
    unit: "bps",
  },
  {
    key: "exchange.order_expiry_hours",
    category: "Exchange",
    label: "Abandoned card checkouts are released after",
    description:
      "A card purchase reserves an order the moment checkout opens, before the member has paid. If they close the tab, that order stays pending forever, and a pending order blocks BOTH turning the exchange off and letting that member leave the village. This is how long to wait before releasing one. Keep it comfortably above 24 hours: a Stripe checkout session stays payable that long, and releasing an order someone is still paying for would strand their money. 0 disables the release.",
    type: "integer",
    default: "48",
    min: 0,
    max: 720,
    unit: "hours",
  },
  {
    key: "exchange.swap_fiat_hold_days",
    category: "Exchange",
    label: "Card-bought tokens settle before they can be swapped",
    description:
      "Tokens bought with a card are frozen from swapping for this many days, long enough that a chargeback still finds them in the wallet instead of already converted. 0 disables the hold.",
    type: "integer",
    default: "45",
    min: 0,
    max: 180,
    unit: "days",
  },
  {
    key: "exchange.swap_max_receive_per_order",
    category: "Exchange",
    label: "Most a member can receive in one swap",
    description: "A ceiling on any single swap, whatever the caps allow across the cycle.",
    type: "integer",
    default: "500",
    min: 1,
    max: 1000000,
    unit: "tokens",
  },

  // ── Payments: platform-wide fiat guardrails (all fiat modules share) ──────
  {
    key: "payments.purchase_limit_per_order_usd",
    category: "Payments",
    label: "Largest single purchase (USD)",
    description:
      "Per-order ceiling across ALL fiat modules: stays, exchange, and anything after them. 0 disables the check.",
    type: "integer",
    default: "1000",
    min: 0,
    max: 100000,
    unit: "USD",
  },
  {
    key: "payments.purchase_limit_30d_usd",
    category: "Payments",
    label: "30-day purchase limit per member (USD)",
    description:
      "Rolling 30-day ceiling on one member's total fiat purchases, summed across every module. 0 disables the check.",
    type: "integer",
    default: "3000",
    min: 0,
    max: 1000000,
    unit: "USD",
  },
  {
    key: "payments.purchase_limit_annual_usd",
    category: "Payments",
    label: "Annual purchase limit per member (USD)",
    description:
      "Rolling 365-day ceiling on one member's total fiat purchases, summed across every module. 0 disables the check.",
    type: "integer",
    default: "10000",
    min: 0,
    max: 10000000,
    unit: "USD",
  },

  // ── Village rhythm ────────────────────────────────────────────────────────
  {
    key: "village.pulse_max_entries",
    category: "Village",
    label: "Village Pulse length",
    description:
      "How many recent happenings the public activity feed shows. Nothing is deleted; this is " +
      "how far back the page reaches, not how much the village keeps.",
    type: "integer",
    // Was 500, described as a retention limit, and read by nothing: the route
    // served a hard-coded 30 however the knob was set. Now the route reads it,
    // so the default is the number that was actually being served — turning a
    // dead setting on must not silently change what every village sees.
    default: "30",
    min: 10,
    max: 200,
    unit: "entries",
  },

  // ── Health (H7) ───────────────────────────────────────────────────────────
  {
    key: "health.alert_change_pct",
    category: "Health",
    label: "Alert when a metric moves this much",
    description:
      "After a lunation closes, any tracked metric that moved more than this against the previous lunation is flagged to the stewards, in either direction, without judging which is good. 0 turns alerts off.",
    type: "integer",
    default: "40",
    min: 0,
    max: 500,
    unit: "%",
  },

  // ── Library (L19) ─────────────────────────────────────────────────────────
  {
    key: "library.intake_stall_days",
    category: "Library",
    label: "Intake stall alarm",
    description:
      "An item awaiting its second sign-off longer than this many days appears in the stewards' daily digest: the donor already handed it over and is owed credits.",
    type: "integer",
    default: "7",
    min: 1,
    max: 60,
    unit: "days",
  },

  // ── Badges (B10) ──────────────────────────────────────────────────────────
  {
    key: "badges.max_featured",
    category: "Badges",
    label: "Featured badges per member",
    description:
      "How many badges a member may pin to their byline (forum posts, map chips). 0 turns featured chips off everywhere.",
    type: "integer",
    default: "3",
    min: 0,
    max: 10,
    unit: "badges",
  },

  // ── Platform feedback (S66) ───────────────────────────────────────────────
  /*
   * R79: A DIAL SAYS WHAT IT DOES, AND NEVER WHAT ITS NUMBER MEANS.
   *
   * This one was `integer`, range 0 to 1, unit "on/off". Admin drew it as a
   * number box, a founder read a bare "0", and the description then spent its
   * first two sentences translating that number back into English. Both
   * readers already treated it as a switch, so the type was the only part of
   * it that was lying about what this dial is.
   *
   * NO MIGRATION IS NEEDED FOR CORRECTNESS, AND BOTH DEPLOY ORDERS ARE SAFE.
   * The boolean parser reads the strings the integer form wrote ("1" is true,
   * "0" is false) and `validateVariable` accepts all four spellings, so the
   * live village that stores "0" here stays off through the flip. The other
   * order is safe too: an integer parse of "false" is `Number("false") || 0`,
   * which is 0, which is also off. `gameVariables.test.ts` pins the first
   * half. `drizzle/0113` then rewrites the stored spelling, so the Admin
   * switch has an option to land on and the amendment ledger reads in words.
   */
  {
    key: "platform.feedback_relay",
    category: "Platform",
    label: "Share bug reports and ideas with the platform team",
    description:
      "A copy of each bug report and idea submitted here reaches the platform team who maintain this software, so fixes and features can ship to every village. Content only, never who said it. Turn it off to keep feedback entirely local. Your admins see all of it in Admin → Feedback either way, and the submission form discloses which is happening. Sharing also needs a hub address in the FEEDBACK_HUB_URL setting on the server. Without one this dial changes nothing, feedback stays local, and the form says so.",
    type: "boolean",
    default: "true",
  },

  // ── Recognition issuance that used to hide in a content document ──────────
  {
    key: "gratitude.proposal_accept_award",
    category: "Gratitude",
    label: "Recognition for an accepted Work With Us proposal",
    description:
      "How much recognition is minted for a member whose Work With Us proposal is accepted. This used to live inside the Work With Us content settings with no bounds; it is issuance, so it belongs here with the other Gratitude dials.",
    type: "integer",
    default: "100",
    min: 0,
    max: 100000,
    unit: "Gratitude",
  },

  // ── Per-member daily activity caps that were hardcoded ────────────────────
  {
    key: "stay.request_daily_cap",
    category: "Stays",
    label: "Stay requests per member per day",
    description:
      "How many stay requests one member may open in 24 hours. A cap on requests, not on stays: stewards still decide every activation.",
    type: "integer",
    default: "5",
    min: 1,
    max: 100,
    unit: "per day",
  },
  {
    key: "library.reserve_daily_cap",
    category: "Library",
    label: "Library reservations per member per day",
    description:
      "How many items one member may reserve in 24 hours. Bounds how fast one person can lock shelf items and escrow credits.",
    type: "integer",
    default: "10",
    min: 1,
    max: 100,
    unit: "per day",
  },
  {
    key: "payments.donation_max_usd",
    category: "Payments",
    label: "Largest checkout donation",
    description:
      "The ceiling on a single choose-your-amount donation checkout. Anything above it gets a personal conversation instead of a card form.",
    type: "integer",
    default: "50000",
    min: 1,
    max: 1000000,
    unit: "USD",
  },

  // ── Calendar (0085; the village's one calendar, twelve months and thirteen moons) ──
  //
  // Three knobs, all three READ: the sky rows and the Moons view take the
  // year anchor and the hemisphere, and the sky job writes cross-quarters
  // only when asked. A white-label platform cannot hard-code the north.
  {
    key: "calendar.year_anchor",
    category: "Calendar",
    label: "The solar event that opens the village year",
    description:
      "Moon 1 begins at the first new moon after this event. Twelve or thirteen moons follow, as the sky gives them, until the first new moon after the next one. Villages in the south often choose the June solstice.",
    type: "choice",
    default: "december_solstice",
    choices: [
      { value: "december_solstice", label: "December solstice" },
      { value: "march_equinox", label: "March equinox" },
      { value: "june_solstice", label: "June solstice" },
      { value: "september_equinox", label: "September equinox" },
    ],
  },
  {
    key: "calendar.hemisphere",
    category: "Calendar",
    label: "Hemisphere",
    description:
      "Which way the seasons turn. Sets which solstice is the longest day and which the shortest, and rotates the example moon names by six months for a village south of the equator.",
    type: "choice",
    default: "north",
    choices: [
      { value: "north", label: "Northern" },
      { value: "south", label: "Southern" },
    ],
  },
  {
    key: "calendar.cross_quarters",
    category: "Calendar",
    label: "Mark the cross-quarter days",
    description:
      "Also put the four midpoints between the solstices and equinoxes on the calendar. Off by default; the quarter days themselves are always shown.",
    type: "boolean",
    default: "false",
  },

  // ── Introductions (0086; visible in Admin only while the module is non-off) ──
  //
  // Four knobs, all four READ: the recipient cap and the floor gate every
  // surfacing decision, the window bounds how long a proposal waits, and the
  // retention day drives the sweep's blanking.
  {
    key: "introductions.recipient_daily_cap",
    category: "Introductions",
    label: "Introductions one person receives per day",
    description:
      "Protects busy people, the map relay's per-recipient brake extended to introductions: the relay's received count and the day's surfaced introductions share one day. A match over the cap is held for the sweep, never dropped.",
    type: "integer",
    default: "3",
    min: 1,
    max: 20,
    unit: "introductions",
  },
  {
    key: "introductions.match_floor",
    category: "Introductions",
    label: "Match score floor",
    description:
      "Nothing scoring under this is ever shown. Few good introductions beat many okay ones; raise it when matches feel thin, lower it for a small village where any bridge helps.",
    type: "integer",
    default: "3",
    min: 1,
    max: 20,
    unit: "points",
  },
  {
    key: "introductions.opportunity_days",
    category: "Introductions",
    label: "Days an introduction stays open",
    description:
      "How long both people have to say yes. One gentle reminder after three days; past the window the proposal expires and both intents return to the pool.",
    type: "integer",
    default: "10",
    min: 3,
    max: 60,
    unit: "days",
  },
  {
    key: "introductions.retention_days",
    category: "Introductions",
    label: "Keep match reasoning for",
    description:
      "The sweep blanks an introduction's reasoning sentences, and the words of expired intents, once they are older than this. The record that an introduction happened stays. 0 keeps everything forever.",
    type: "integer",
    default: "90",
    min: 0,
    max: 3650,
    unit: "days",
  },
];

// ── Progression: the ladder's economics and thresholds, GENERATED per stage ──
//
// These defs are derived from GAME_CONFIG.stages at module load, so a fork
// that edits its ladder (the identity plane) automatically gets matching,
// correctly-defaulted variables — the registry stays the single source of
// truth for BEHAVIOUR while the ladder's SHAPE stays identity. Defaults come
// from the config values that were previously hardcoded, so registering these
// changes nothing until a village edits them (the wire-a-knob-at-birth rule).

const STAGE_CHOICES = GAME_CONFIG.stages.map((s) => ({ value: s.id, label: s.name }));

const STAGE_MULTIPLIER_DEFS: VariableDef[] = GAME_CONFIG.stages.map((s) => ({
  key: `progression.multiplier.${s.id}`,
  category: "Progression",
  label: `Sending-budget multiplier: ${s.name}`,
  description: `Multiplies the base Gratitude sending allowance for members at the ${s.name} stage, so a member here gives this many times 'Base sending allowance per cycle' each cycle. Set it to 0 and members at this stage cannot send yet. It moves the per-person ceiling too, because that is a share of the allowance this produces. Works with: 'Base sending allowance per cycle' and 'Share of an allowance any one person can receive', both under Gratitude.`,
  type: "decimal",
  default: String(s.gratitudeMultiplier),
  min: 0,
  max: 100,
  unit: "x base budget",
  applyTiming: "cycle-close",
}));

const STAGE_QUEST_DEFS: VariableDef[] = GAME_CONFIG.stages
  .filter((s) => s.rule.type === "quests")
  .map((s) => ({
    key: `progression.quests_for.${s.id}`,
    category: "Progression",
    label: `Consented quests to reach ${s.name}`,
    description: `How many consented quests advance a member to the ${s.name} stage. Raising it never demotes anyone retroactively on its own: stages are recomputed from live counts.`,
    type: "integer",
    default: String((s.rule as { type: "quests"; min: number }).min),
    min: 1,
    max: 1000,
    unit: "consented quests",
  }));

const UNLOCK_DEFS: VariableDef[] = (Object.entries(STAGE_UNLOCKS) as Array<[string, string]>).map(
  ([cap, stage]) => ({
    key: `progression.unlock.${cap}`,
    category: "Progression",
    label: `Stage that unlocks: ${cap}`,
    description: `Which rung of the ladder grants "${cap}" by progression alone. Roles and badges can still grant it at any stage; "never by stage" makes it role/badge-only. This is the constitution's parameter table, so move rungs deliberately.`,
    type: "choice",
    default: stage,
    choices: [
      ...STAGE_CHOICES,
      { value: "none", label: "Never by stage (role or badge only)" },
    ],
  }),
);

VARIABLES.push(...STAGE_MULTIPLIER_DEFS, ...STAGE_QUEST_DEFS, ...UNLOCK_DEFS);

/** Lookup by key, for validation and defaults. */
export const VARIABLES_BY_KEY: Record<string, VariableDef> = Object.fromEntries(
  VARIABLES.map((v) => [v.key, v]),
);

// A duplicated key would make VARIABLES_BY_KEY silently keep the last def and
// the admin list show two rows editing one value. With generated defs in the
// registry this is now reachable by a careless fork edit, so it fails LOUD at
// import — on the server at boot, in the client at bundle evaluation.
if (Object.keys(VARIABLES_BY_KEY).length !== VARIABLES.length) {
  const seen = new Set<string>();
  const dupes = VARIABLES.filter((v) => (seen.has(v.key) ? true : (seen.add(v.key), false)));
  throw new Error(`Duplicate game variable key(s): ${dupes.map((d) => d.key).join(", ")}`);
}

// ── Ring + apply-timing resolution ───────────────────────────────────────────

/** Categories whose variables default to founder-held (Ring 1). */
const FOUNDER_CATEGORIES = new Set(["Abuse guards", "Accounts & sessions", "Data lifecycle", "Platform"]);

/** Individual founder-held keys outside those categories: infrastructure,
 *  contract wiring, and privacy windows — not game rules. */
const FOUNDER_KEYS = new Set([
  "tokens.base_rpc_url",
  "tokens.equity_address",
  "tokens.voice_address",
  "governance.hub_url",
  "hypha.org_url",
  "hypha.link_governance",
  "hypha.link_proposals",
  "hypha.link_treasury",
  "hypha.link_members",
  "map.contact_retention_days",
]);

/** The platform ceiling for who may govern this dial. */
export function ringOf(def: VariableDef): VariableRing {
  if (def.ring) return def.ring;
  if (FOUNDER_KEYS.has(def.key)) return "founder";
  if (FOUNDER_CATEGORIES.has(def.category)) return "founder";
  return "open";
}

/** Keys whose mid-cycle change would corrupt a settlement basis. */
const CYCLE_APPLY_KEYS = new Set([
  // The rhythm itself, and it is the strictest case in this set: a mid-cycle
  // change of clock resets every per-cycle budget and cap and can leave the
  // running lunation with no clock able to settle it. Cycle timing is the
  // floor here; `cycleModeSwitchProblem` in shared/cycleClock.ts is the real
  // guard, and it refuses any landing instant that is not a boundary of the
  // outgoing clock with every finished cycle already settled.
  "cycle.mode",
  // The claim dials shape what a member is told they can do THIS season, so a
  // mid-season change would move the goalposts under somebody already counting.
  "economy.voice_claim_threshold",
  "economy.claims_week_days",
  "economy.claims_week_starts",
  "gratitude.base_budget",
  "gratitude.pool_per_cycle",
  "gratitude.pool_token",
  // The share is measured against an allowance a member is already spending
  // against, so moving it mid-cycle would move a ceiling under somebody who
  // has already given up to the old one.
  "gratitude.max_share_per_recipient",
  "feed.heart_amount",
  "feed.max_hearts_per_recipient_per_cycle",
  "ledger.admin_mint_cycle_cap",
]);

export function applyTimingOf(def: VariableDef): VariableApplyTiming {
  if (def.applyTiming) return def.applyTiming;
  return CYCLE_APPLY_KEYS.has(def.key) ? "cycle-close" : "instant";
}

/**
 * How critical this dial is. Absent means routine, which is the whole reason
 * the field is optional: 149 dials are ordinary numbers a village tunes while
 * it plays, and marking each of them "routine" by hand would be 149 chances
 * to mark one of them wrong.
 */
export function criticalityOf(def: VariableDef): Criticality {
  return def.criticality ?? "routine";
}

/** Parse a stored string into the type the caller expects. */
export function parseVariable(def: VariableDef, raw: string | undefined | null): number | boolean | string {
  const value = raw ?? def.default;
  switch (def.type) {
    case "boolean":
      return value === "true" || value === "1";
    case "integer":
      return Math.trunc(Number(value) || 0);
    case "decimal":
    case "percentage":
      return Number(value) || 0;
    default:
      return String(value);
  }
}

/**
 * THE GRAMMAR OF A GOVERNANCE WINDOW, and the one place it is written down.
 *
 * `server/lib/governanceWindows.ts` parses the same four shapes into the type
 * the arithmetic uses and re-exports this refusal, so a village can never
 * store a shape the engine cannot read. The ordering check is here as well as
 * the syntax, because `custom:20-5` parses cleanly and names no days at all.
 */
export const GOVERNANCE_WINDOW_SHAPES =
  "always_open, last_days_of_cycle:N, last_days_of_season:N, or custom:FROM-TO counting days from the start of the cycle";

export function governanceWindowSyntaxProblem(raw: string): string | null {
  const text = String(raw ?? "").trim();
  const bad = `A governance window is one of ${GOVERNANCE_WINDOW_SHAPES}.`;
  if (text === "always_open") return null;
  const last = /^last_days_of_(cycle|season):(\d{1,3})$/.exec(text);
  if (last) return Number(last[2]) >= 1 ? null : bad;
  const custom = /^custom:(\d{1,3})-(\d{1,3})$/.exec(text);
  if (custom) return Number(custom[1]) >= 1 && Number(custom[2]) >= Number(custom[1]) ? null : bad;
  return bad;
}

/**
 * Validate a proposed value. Returns an error message, or null when acceptable.
 * Runs on the server before any write, and is exported so Admin can show the
 * same message without a round trip.
 */
export function validateVariable(def: VariableDef, raw: string): string | null {
  if (def.type === "boolean") {
    return ["true", "false", "1", "0"].includes(raw) ? null : "Must be true or false.";
  }
  if (def.type === "choice") {
    const allowed = (def.choices ?? []).map((c) => c.value);
    return allowed.includes(raw) ? null : `Must be one of: ${allowed.join(", ")}.`;
  }
  if (def.type === "text") {
    if (raw.length > 255) return "Too long (255 characters maximum).";
    /*
     * A governance window is a grammar, and a typo in it would close a whole
     * kind of proposal with nothing saying why. The SYNTAX is checked here so
     * every write path gets it; the cross-key rule (a window has to be longer
     * than `governance.vote_days`, or no vote could ever fit inside it) needs
     * a second value and lives in `windowShapeProblem`,
     * server/lib/governanceWindows.ts, called from `validateChangeSet`.
     */
    if (def.key.startsWith("governance.window_") && governanceWindowSyntaxProblem(raw)) {
      return governanceWindowSyntaxProblem(raw);
    }
    // Contract addresses must look like addresses, or a typo silently reads a
    // balance from nowhere and the member sees zero holdings.
    if (def.key.endsWith("_address") && raw !== "" && !/^0x[a-fA-F0-9]{40}$/.test(raw)) {
      return "Must be a valid contract address (0x followed by 40 hex characters), or blank.";
    }
    // governance.hub_url carries the shared governance secret on every
    // request that uses it (server/index.ts's link-hypha route sets the
    // header `x-governance-hub-secret` to `secretValue("governance_hub_secret")`
    // on every POST to this URL). The generic `_url` loopback exemption two
    // lines below exists for a local RPC node (anvil, hardhat), which is
    // http by nature and never carries a credential - that reasoning does
    // not hold here, and letting it apply here would let a founder-ring
    // value point a real secret at 127.0.0.1/localhost in the clear. This
    // key gets NO loopback exemption: https, unconditionally, or blank.
    if (def.key === "governance.hub_url" && raw !== "" && !/^https:\/\/\S+$/.test(raw)) {
      return "Must be an https URL, or blank. This value is sent alongside the shared governance secret on every request, so plain http (including a loopback address) is never allowed here.";
    }
    if (def.key.endsWith("_url") && raw !== "" && !/^https:\/\/\S+$/.test(raw)) {
      // Loopback is exempt: a local RPC node (anvil, hardhat, a test stub)
      // is http by nature and never crosses a network boundary.
      if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?(\/\S*)?$/.test(raw)) {
        return "Must be an https URL (plain http is allowed only for 127.0.0.1/localhost).";
      }
    }
    return null;
  }
  const n = Number(raw);
  if (!Number.isFinite(n)) return "Must be a number.";
  if (def.type === "integer" && !Number.isInteger(n)) return "Must be a whole number.";
  if (def.min !== undefined && n < def.min) return `Must be at least ${def.min}.`;
  if (def.max !== undefined && n > def.max) return `Must be at most ${def.max}.`;
  return null;
}
