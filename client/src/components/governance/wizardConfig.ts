/**
 * THE PROPOSAL WIZARD, AS ONE DECLARATIVE CONFIG.
 *
 * Ported from Hypha 2.0's `src/pages/proposals/create/config.js` (dho-web-client,
 * Apache 2.0, founder-owned; harvest section 1, verdict COPY). Their crown jewel
 * is that the whole wizard is data: five canonical steps in a fixed order, a
 * table of proposal types, and per-type overrides saying which steps to skip and
 * which fields render inside the ones that remain. Adding a proposal type is an
 * entry in this file. It is never a new component and never a new route.
 *
 * The three moving parts:
 *
 *   STEPS      The canonical walk, in order, for every type. A type prunes it
 *              with `skip`, and the walker (wizardWalk.ts) steps over the gaps
 *              in both directions, so nobody hand-maintains an index.
 *   FIELDS     Per type, per step, a list of FieldSpecs. One generic renderer
 *              serves all of them, exactly as Hypha's StepPayout serves payout,
 *              assignment, archetype and badge flavours from `fields.X`.
 *   PUBLISH    What the finished payload becomes. `body` maps the wizard's flat
 *              answers onto the subject route's own shape, so the wizard never
 *              constrains the API it feeds.
 *
 * WHAT THIS FILE IS NOT ALLOWED TO DECIDE: whether a type can be published.
 * That comes from the server (`GET /api/governance/wizard`), because the
 * executors land lane by lane and a config that guessed would be a wizard
 * walking members toward a route nobody mounted.
 *
 * VALIDATION lives beside the fields as `problem(value, answers)`, returning a
 * sentence or null. The review step collects every problem across every visible
 * step, so nothing is discovered on submit that could have been said on the
 * step it belongs to.
 */
import {
  Award,
  Coins,
  FileText,
  Handshake,
  KeyRound,
  Scale,
  Undo2,
  UserPlus,
  type LucideIcon,
} from "lucide-react";

/**
 * The proposal types (GOV_DESIGN section 4).
 *
 * The SERVER holds the same ids in `server/lib/proposalDrafts.ts` for draft
 * validation, and `wizardConfig.test.ts` fails if the two lists drift. Two
 * files because that module must not import React, and this one does.
 */
export const WIZARD_TYPES = [
  "role_application",
  "mechanics",
  "agreement",
  "badge_grant",
  "quest_payout",
  "power_transfer",
  "power_grant",
  "power_return",
] as const;
export type WizardType = (typeof WIZARD_TYPES)[number];

/**
 * The canonical steps, in order, shared by every type.
 *
 * Five rather than Hypha's six: their `icon` step picks proposal artwork,
 * which this platform does not have, and their `date` step is folded into
 * `terms` because every date this wizard asks for is a term of the thing being
 * proposed rather than a schedule for the vote (the vote's own clock is a
 * village dial, not an author's choice).
 */
export const WIZARD_STEPS = [
  { key: "type", label: "Kind" },
  { key: "subject", label: "Subject" },
  { key: "details", label: "In your words" },
  { key: "terms", label: "Terms" },
  { key: "review", label: "Review" },
] as const;
export type StepKey = (typeof WIZARD_STEPS)[number]["key"];

/** How a field renders. One vocabulary, one generic renderer. */
export type FieldKind =
  | "text"
  | "textarea"
  | "percent"
  | "number"
  | "date"
  | "choice"
  | "pick"
  | "changeSet";

/** Where a `pick` field's options come from, fetched by the renderer. */
export type PickSource =
  | "seats"
  | "badges"
  | "members"
  | "quests"
  | "circles"
  | "tokens"
  /*
   * The powers this village could take on, and the roles that could hold one.
   *
   * Both are SERVED rather than typed here, and that matters for the transfer
   * ceremony specifically. A hand-kept list of powers in this file would go
   * stale the day a key is added, and the wizard would walk a member toward a
   * power the platform refuses to move. `/api/village/powers` already answers
   * with the movable ones and the sentence each one means, so the picker
   * cannot offer a door that is not there.
   */
  | "powers"
  /*
   * The powers the village could vote ONTO a role, and the ones it is holding
   * right now. Two more served lists, for the same reason `powers` is served:
   * the platform's own answer to what can move is the only one that cannot go
   * stale, and a picker built on a typed list walks members toward a refusal.
   *
   * `grantablePowers` is deliberately NOT the same list as `powers`. That one
   * hides a power the village already holds, because asking to hold it again
   * is a ceremony about nothing. The runway wants the opposite: a power the
   * village holds can still be voted onto a second role, and a power no role
   * carries is exactly the one the runway exists for. What it hides instead
   * is a power the CHOSEN role already carries, which the route refuses.
   */
  | "grantablePowers"
  | "heldPowers"
  | "roles";

export interface FieldSpec {
  key: string;
  kind: FieldKind;
  label: string;
  /** The plain mechanics, shown through InfoTip. One or two sentences. */
  tip?: string;
  placeholder?: string;
  /** Under the input, always visible. Use for the thing a member must know. */
  help?: string;
  required?: boolean;
  min?: number;
  max?: number;
  rows?: number;
  maxLength?: number;
  options?: ReadonlyArray<{ value: string; label: string }>;
  source?: PickSource;
  /** A sentence naming what is wrong, or null. Runs on every keystroke. */
  problem?: (value: unknown, answers: Record<string, unknown>) => string | null;
}

export interface TypeStepOverride {
  /** Prune this step from this type's walk. */
  skip?: boolean;
  /** Replaces the canonical label in the stepper for this type. */
  label?: string;
  /** One sentence at the top of the step, in the member's register. */
  intro?: string;
  fields?: readonly FieldSpec[];
}

export interface WizardTypeConfig {
  id: WizardType;
  /** The heading its card sits under on the type step. */
  group: "Rules" | "People" | "Recurring" | "One-time" | "The village's own powers";
  icon: LucideIcon;
  title: string;
  description: string;
  /** The sentence the review step ends on: what publishing actually does. */
  consequence: string;
  /** Where a finished proposal goes, and in what shape. */
  publish: {
    path: string;
    body: (answers: Record<string, any>) => Record<string, unknown>;
  };
  steps: Partial<Record<StepKey, TypeStepOverride>>;
}

// ── Shared validators ────────────────────────────────────────────────────────

const required = (what: string) => (v: unknown) =>
  String(v ?? "").trim() ? null : `${what} is the part only you can write. It cannot be blank`;

const atLeast = (n: number, what: string) => (v: unknown) =>
  String(v ?? "").trim().length >= n ? null : `${what} needs at least ${n} characters so the village can weigh it`;

const pct = (v: unknown) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return "That needs to be a number between 0 and 100";
  if (n < 0 || n > 100) return "A percentage runs from 0 to 100";
  return null;
};

const positive = (what: string) => (v: unknown) => {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return `${what} has to be more than zero`;
  return null;
};

const changesPresent = (v: unknown) =>
  Array.isArray(v) && v.length > 0 ? null : "Pick at least one dial to change, and say what it becomes";

// ── The types ────────────────────────────────────────────────────────────────

export const WIZARD_TYPE_CONFIGS: readonly WizardTypeConfig[] = [
  {
    id: "role_application",
    group: "Recurring",
    icon: UserPlus,
    title: "Apply for a seat",
    description: "Raise your hand for a role, with what you will have done by the end of the season.",
    consequence:
      "Publishing sends this to the seat's circle. They see your deliverables, your terms and your fit statement before anyone votes.",
    publish: {
      path: "/api/governance/role-applications",
      body: (a) => ({
        orgRoleId: a.seatId,
        deliverables: a.deliverables,
        fitStatement: a.fitStatement,
        commitmentPct: Number(a.commitmentPct ?? 100),
        deferredPct: Number(a.deferredPct ?? 0),
        tokenSlug: a.tokenSlug || null,
        tokenPerCycle: a.tokenPerCycle ? Number(a.tokenPerCycle) : null,
        cashNote: a.cashNote || null,
      }),
    },
    steps: {
      subject: {
        label: "The seat",
        intro: "Which seat you are raising your hand for.",
        fields: [
          {
            key: "seatId",
            kind: "pick",
            source: "seats",
            label: "Seat",
            required: true,
            problem: required("A seat"),
            tip: "Seats come from the village's org chart. A seat that is recruiting shows first.",
          },
        ],
      },
      details: {
        label: "Your season",
        intro: "What you will have done by the end of the season, and why you.",
        fields: [
          {
            key: "deliverables",
            kind: "textarea",
            rows: 6,
            maxLength: 2000,
            label: "Deliverables for the season",
            placeholder: "By the end of the season, the spring runs clear and two people besides me know how to keep it that way.",
            help: "Write what will be TRUE at season's end, so anyone can check it without asking you.",
            required: true,
            problem: atLeast(40, "Your deliverables"),
          },
          {
            key: "fitStatement",
            kind: "textarea",
            rows: 4,
            maxLength: 1500,
            label: "Why you",
            placeholder: "I have kept the north line running for two seasons and I already know where it silts up.",
            required: true,
            problem: atLeast(30, "Your fit statement"),
          },
        ],
      },
      terms: {
        label: "Your terms",
        intro: "What you are taking on and what the village owes you for it.",
        fields: [
          {
            key: "commitmentPct",
            kind: "percent",
            label: "Commitment",
            help: "A partial seat is a real seat. 40% means you hold two fifths of the role and are paid for two fifths.",
            tip: "Commitment scales both the pay and the voice this seat carries. You can lower it later without a vote; raising it takes a new one.",
            problem: pct,
          },
          {
            key: "deferredPct",
            kind: "percent",
            label: "Deferred",
            help: "The share you let the village hold back and owe you. Deferring changes your pay. It never changes your voice.",
            tip: "Voice accrues on the full amount whatever you defer, so choosing to wait for value never costs you a say.",
            problem: pct,
          },
          {
            key: "tokenSlug",
            kind: "pick",
            source: "tokens",
            label: "Paid in",
          },
          {
            key: "tokenPerCycle",
            kind: "number",
            min: 0,
            label: "Per cycle, at full commitment",
            help: "The whole-seat figure. What you actually receive is this times your commitment, less what you defer.",
          },
          {
            key: "cashNote",
            kind: "text",
            maxLength: 500,
            label: "Cash expectation",
            help: "Recorded here and settled off the platform. Money never flows out of this village through this software.",
          },
        ],
      },
    },
  },
  {
    id: "mechanics",
    group: "Rules",
    icon: Scale,
    title: "Change a rule",
    description: "Move one of the village's dials, with the reasoning that goes with it.",
    consequence:
      "Publishing puts this in front of the village for sensing. Once enough members support it, it can go to a vote, and a passed vote changes the dial through the one amendment ledger.",
    publish: {
      path: "/api/game/mechanics/proposals",
      body: (a) => ({
        title: a.title,
        rationale: a.rationale,
        changes: (a.changes ?? []).map((c: any) => ({ key: c.key, to: c.to })),
      }),
    },
    steps: {
      subject: {
        label: "The dials",
        intro: "Which rules move, and what they become.",
        fields: [
          {
            key: "changes",
            kind: "changeSet",
            label: "Changes",
            required: true,
            problem: changesPresent,
            tip: "Only dials the village governs appear here. Founder-held dials and the constitution are not on this list.",
          },
        ],
      },
      details: {
        label: "In your words",
        intro: "What you are asking for, and why it is worth the village's attention.",
        fields: [
          {
            key: "title",
            kind: "text",
            maxLength: 200,
            label: "Title",
            placeholder: "More time to weigh in before a vote",
            required: true,
            problem: atLeast(8, "A title"),
          },
          {
            key: "rationale",
            kind: "textarea",
            rows: 7,
            maxLength: 4000,
            label: "Reasoning",
            placeholder: "Three proposals in a row closed before the people they affected had read them.",
            help: "Say what you have seen, not what you fear. Evidence carries a vote further than warning does.",
            required: true,
            problem: atLeast(40, "Your reasoning"),
          },
        ],
      },
      terms: { skip: true },
    },
  },
  {
    id: "agreement",
    group: "Rules",
    icon: FileText,
    title: "Write an agreement",
    description: "Put a shared understanding into words the village can adopt, review and amend.",
    consequence:
      "Publishing enters this into sensing. Adopted by consent, it becomes an active agreement with its own review date.",
    publish: {
      path: "/api/governance/agreements",
      body: (a) => ({
        title: a.title,
        body: a.body,
        domain: a.domain || null,
        circleId: a.circleId || null,
        reviewAt: a.reviewAt || null,
      }),
    },
    steps: {
      // An agreement is its own subject: there is nothing to pick before you
      // write it, so this type starts on the words.
      subject: { skip: true },
      details: {
        label: "The agreement",
        intro: "The words themselves. This is what the village adopts, exactly as written.",
        fields: [
          {
            key: "title",
            kind: "text",
            maxLength: 200,
            label: "Title",
            placeholder: "Quiet hours in the common house",
            required: true,
            problem: atLeast(8, "A title"),
          },
          {
            key: "body",
            kind: "textarea",
            rows: 12,
            maxLength: 20000,
            label: "The agreement",
            placeholder: "Between 10pm and 7am the common house is quiet. Anyone can name a night as an exception at the weekly circle.",
            help: "Write it as the rule it will be. What is adopted is what is on this page.",
            required: true,
            problem: atLeast(60, "An agreement"),
          },
        ],
      },
      terms: {
        label: "Scope and review",
        intro: "Who it binds, and when the village looks at it again.",
        fields: [
          {
            key: "domain",
            kind: "choice",
            label: "Domain",
            options: [
              { value: "", label: "Not tied to one domain" },
              { value: "money", label: "Money" },
              { value: "people", label: "People" },
              { value: "space_land", label: "Space and land" },
              { value: "rules", label: "Rules" },
            ],
            tip: "The domain decides where this agreement shows up on the power map.",
          },
          { key: "circleId", kind: "pick", source: "circles", label: "Circle" },
          {
            key: "reviewAt",
            kind: "date",
            label: "Review on",
            help: "Good enough for now, safe enough to try, until this date. Leaving it blank makes it open-ended.",
            tip: "A review date is how an agreement stays a living decision instead of becoming furniture.",
          },
        ],
      },
    },
  },
  {
    id: "badge_grant",
    group: "People",
    icon: Award,
    title: "Grant a badge",
    description: "Ask the village to recognise someone with a badge, on the record and with a term.",
    consequence: "Publishing puts the grant to the village. A passed vote awards the badge and the award carries this vote's id.",
    publish: {
      path: "/api/governance/badge-grants",
      body: (a) => ({
        badgeId: a.badgeId,
        userId: a.granteeId,
        reason: a.reason,
        seasons: a.seasons ? Number(a.seasons) : null,
      }),
    },
    steps: {
      subject: {
        label: "Badge and holder",
        intro: "Which badge, and who would wear it.",
        fields: [
          { key: "badgeId", kind: "pick", source: "badges", label: "Badge", required: true, problem: required("A badge") },
          { key: "granteeId", kind: "pick", source: "members", label: "Member", required: true, problem: required("A member") },
        ],
      },
      details: {
        label: "The case",
        intro: "Why this badge, for this person, now.",
        fields: [
          {
            key: "reason",
            kind: "textarea",
            rows: 6,
            maxLength: 2000,
            label: "Why",
            placeholder: "She has run the repair bench every week since spring and taught four people to use it.",
            required: true,
            problem: atLeast(40, "The case"),
          },
        ],
      },
      terms: {
        label: "For how long",
        intro: "A badge with a term is a badge the village revisits.",
        fields: [
          {
            key: "seasons",
            kind: "number",
            min: 0,
            max: 40,
            label: "Seasons",
            help: "Leave blank for no end date.",
            tip: "A badge can carry capabilities, so a term is how a grant stays a decision. Without one it becomes permanent by default.",
          },
        ],
      },
    },
  },
  {
    id: "quest_payout",
    group: "One-time",
    icon: Coins,
    title: "Pay out a quest",
    description: "Put a finished quest's payout to the village, so releasing it is the village's act.",
    consequence: "Publishing puts the payout to the village. A passed vote releases it through the settlement the quest already uses.",
    publish: {
      path: "/api/governance/quest-payouts",
      body: (a) => ({
        questId: a.questId,
        amount: Number(a.amount),
        tokenSlug: a.tokenSlug || null,
        reason: a.reason,
      }),
    },
    steps: {
      subject: {
        label: "The quest",
        intro: "Which finished quest this pays for.",
        fields: [
          { key: "questId", kind: "pick", source: "quests", label: "Quest", required: true, problem: required("A quest") },
        ],
      },
      details: {
        label: "What was done",
        intro: "What the village got, in the words of someone who saw it.",
        fields: [
          {
            key: "reason",
            kind: "textarea",
            rows: 5,
            maxLength: 2000,
            label: "What was done",
            required: true,
            problem: atLeast(30, "The account"),
          },
        ],
      },
      terms: {
        label: "The amount",
        intro: "What is released, and from which token.",
        fields: [
          {
            key: "amount",
            kind: "number",
            min: 0,
            label: "Amount",
            required: true,
            problem: positive("An amount"),
          },
          { key: "tokenSlug", kind: "pick", source: "tokens", label: "Token" },
        ],
      },
    },
  },
  /*
   * THE VILLAGE ASKS TO HOLD THIS.
   *
   * Every other type in this table asks the village to decide something. This
   * one asks the village to decide who decides, which is the act the whole
   * platform is pointed at: "these villages are meant to be taken over by the
   * electorate to run the game and put the admins out of a full time job."
   * Admin is scaffolding, and this is the ceremony that takes a piece of it
   * down.
   *
   * IT IS DELIBERATELY NOT AN ADMIN'S BUTTON. The route refuses an actor
   * whose only path to `proposal.open` is being an admin, because a design
   * test that reads "does this move a power toward the village" fails on its
   * own instrument the moment the scaffolding can hand itself a ceremony. An
   * admin who wants this to happen opens an advisory vote and lets a member
   * carry it.
   *
   * IT NAMES A POWER AND NEVER A PERSON. That is what separates it from a
   * badge grant and it is the entire safety argument for letting it move the
   * governance keys a badge may not (`TYPE_CAPABILITY_REFUSALS`,
   * server/lib/proposalDrafts.ts).
   */
  {
    id: "power_transfer",
    group: "The village's own powers",
    icon: Handshake,
    title: "Take a power on",
    description: "Ask the village to hold one of the powers the admin panel is carrying.",
    consequence:
      "The village asks to hold this. Publishing opens the vote to the whole roll, and if it carries, the power crosses over that day: the role you named looks after it, and an admin who is not seated there has to reach past the village in the open to act on it.",
    publish: {
      path: "/api/governance/power-transfers",
      body: (a) => ({
        capability: a.capability,
        roleId: a.roleId,
        reason: a.reason,
      }),
    },
    steps: {
      subject: {
        label: "The power",
        intro: "Which power the village is asking to hold, and who would look after it.",
        fields: [
          {
            key: "capability",
            kind: "pick",
            source: "powers",
            label: "The power",
            required: true,
            problem: required("A power"),
            help: "These are the powers that can move. Some of what the admin panel does is plumbing the deployment has to keep reachable, and those are not on this list.",
            tip: "A power that has crossed is one an admin no longer passes by being an admin. They can still act on it, and the village sees when they do.",
          },
          {
            key: "roleId",
            kind: "pick",
            source: "roles",
            label: "Who looks after it",
            required: true,
            problem: required("A role"),
            help: "The role has to already carry this power, so that somebody can act the moment it crosses. Give the role the power first, watch someone use it, then hand it over.",
            tip: "A power held by a role that cannot use it belongs to nobody: the admin stops passing the gate and the named holder never passed it either.",
          },
        ],
      },
      details: {
        label: "Why now",
        intro: "What the village has been doing that makes this the right moment.",
        fields: [
          {
            key: "reason",
            kind: "textarea",
            rows: 6,
            maxLength: 2000,
            label: "Why the village is ready for this one",
            placeholder:
              "The stewards have been putting every gathering on the calendar for three seasons, and the last four times an admin touched it was to fix a typo.",
            help: "This is the part the roll reads before it votes, and the part somebody quotes in five years when they ask how this village came to look after its own calendar.",
            required: true,
            problem: atLeast(40, "The case for it"),
          },
        ],
      },
      terms: { skip: true },
    },
  },
  /*
   * THE RUNWAY.
   *
   * A power cannot cross to a village unless a role already carries it: a
   * holder that cannot act is not a holder. Until this type existed the only
   * writer of a role's capability list was an admin route, so the handover's
   * first step belonged to the scaffolding, and five of the eight movable
   * powers are carried by no seeded role at all. This is that step, held by
   * the village.
   *
   * IT IS THE SMALLER ASK ON PURPOSE, and it sits above the handover here for
   * that reason. Saying the stewards should be able to work the queues is a
   * different question from saying the admin panel should stop carrying them,
   * and a village can answer the first and never be asked the second.
   */
  {
    id: "power_grant",
    group: "The village's own powers",
    icon: KeyRound,
    title: "Give a role a power",
    description: "Ask the village to let a role do something it cannot do yet.",
    consequence:
      "Publishing opens the vote to the whole roll. If it carries, anybody seated in the role you named can do this from that day. Nothing moves off the admin panel: this is the step that lets somebody act, and taking a power on is a separate ask the village makes later, or never.",
    publish: {
      path: "/api/governance/power-grants",
      body: (a) => ({
        capability: a.capability,
        roleId: a.roleId,
        reason: a.reason,
      }),
    },
    steps: {
      subject: {
        label: "The power",
        intro: "What the village would be letting a role do, and which role.",
        fields: [
          {
            key: "capability",
            kind: "pick",
            source: "grantablePowers",
            label: "The power",
            required: true,
            problem: required("A power"),
            help: "These are the powers a village can go on to hold. A power that could never leave the admin panel is not on this list, because giving a role one would be a job description and never a step toward anything.",
            tip: "Who votes here is a rule of the game, so it is changed by a rule change and never by giving a role the key.",
          },
          {
            key: "roleId",
            kind: "pick",
            source: "roles",
            label: "Who would do it",
            required: true,
            problem: required("A role"),
            help: "Anybody seated in this role can do it the day the vote carries.",
            tip: "This adds one power to a role. Taking one off a role is not something a vote does, so a role the village armed cannot be quietly disarmed by another one.",
          },
        ],
      },
      details: {
        label: "Why this role",
        intro: "What makes this the right group of people to look after it.",
        fields: [
          {
            key: "reason",
            kind: "textarea",
            rows: 6,
            maxLength: 2000,
            label: "Why this role",
            placeholder:
              "The stewards already answer most of what comes through the submissions box, and they have been forwarding it to an admin to action for two seasons.",
            help: "This is the part the roll reads before it votes.",
            required: true,
            problem: atLeast(40, "The case for it"),
          },
        ],
      },
      terms: { skip: true },
    },
  },
  /*
   * THE WAY BACK.
   *
   * R55: the handover is a journey, and a journey with no way back is a trap.
   * A village could vote a power across and then had one exit, an admin
   * route, so a village that found it was not ready had to ask the
   * scaffolding to take the power back. That is the one sentence this whole
   * round exists to stop a village having to say.
   *
   * THE COPY HERE IS THE DESIGN. Handing a power back is an ordinary act of a
   * village being honest about its capacity. Nothing on this card frames it
   * as failing, as being behind, or as a thing to try again later, and it
   * carries no celebration either way: the crossing claimed the one moment
   * this surface rations.
   */
  {
    id: "power_return",
    group: "The village's own powers",
    icon: Undo2,
    title: "Hand a power back",
    description: "Ask the village to give one of the powers it holds back to the admin panel.",
    consequence:
      "Publishing opens the vote to the whole roll. If it carries, the admin panel carries this one again from that day. The role keeps the power itself, so the same people can still do it; what ends is the village holding it. The village can ask for it again whenever it wants to.",
    publish: {
      path: "/api/governance/power-returns",
      body: (a) => ({
        capability: a.capability,
        reason: a.reason,
      }),
    },
    steps: {
      subject: {
        label: "The power",
        intro: "Which of the powers this village holds would go back.",
        fields: [
          {
            key: "capability",
            kind: "pick",
            source: "heldPowers",
            label: "The power",
            required: true,
            problem: required("A power"),
            help: "These are the powers this village is holding right now.",
            tip: "Handing one back is one of the ordinary things a village does with a power.",
          },
        ],
      },
      details: {
        label: "Why now",
        intro: "What the village wants the record to say about this.",
        fields: [
          {
            key: "reason",
            kind: "textarea",
            rows: 6,
            maxLength: 2000,
            label: "Why now",
            placeholder:
              "The two people who were working the queue have both moved on, and the village would rather hand this back than leave it with nobody answering it.",
            help: "This is the part the roll reads before it votes, and the part somebody reads years later to understand what happened.",
            required: true,
            problem: atLeast(40, "The reason"),
          },
        ],
      },
      terms: { skip: true },
    },
  },
];

/** By id, for the walker and the renderer. */
export const typeConfig = (id: string): WizardTypeConfig | null =>
  WIZARD_TYPE_CONFIGS.find((t) => t.id === id) ?? null;

/**
 * The type groups in the order they render on the first step.
 *
 * "The village's own powers" is last on purpose and not first. A village
 * opening this wizard is usually here to change a dial or put somebody in a
 * seat, and the ordinary work belongs at the top. Nothing about the position
 * says the group is further away: it is one heading among five, always
 * visible, and it reads the same on a village's first day as on its tenth
 * year.
 */
export const TYPE_GROUPS = [
  "Rules",
  "People",
  "Recurring",
  "One-time",
  "The village's own powers",
] as const;

/**
 * What a decision ON this subject is called, as a noun.
 *
 * The wizard cards are verbs, because there a member is choosing an action
 * ("Change a rule"). A decision card is a thing the village is looking at, so
 * it takes the noun. `ballots.subject_type` uses these same ids, which is why
 * one map serves both sides.
 */
export const SUBJECT_NOUN: Record<string, string> = {
  mechanics: "Rule change",
  role_application: "Seat application",
  agreement: "Agreement",
  badge_grant: "Badge grant",
  quest_payout: "Quest payout",
  /*
   * A NOUN FOR THE THING, NOT FOR THE MACHINERY. "Capability transfer" is
   * what the table is called; a handover is what happened. The chip sits
   * above the title on the decision page and is the first thing a member
   * reads about a vote they were asked to cast.
   */
  power_transfer: "Power handover",
  /*
   * The two halves of the journey either side of a handover, and both take a
   * noun for the THING rather than for the machinery. "Capability grant" is
   * what the table would call it; what happened is that a village decided who
   * can do something.
   */
  power_grant: "Power given to a role",
  power_return: "Power handed back",
  /*
   * NOT a wizard type, and here because `ballots.subject_type` carries it.
   * Without this entry an advisory vote fell through to "Decision", which is
   * the one word it must never be called: the whole point of an advisory vote
   * is that it decides nothing. The village's own vocabulary for it, on the
   * document the server freezes and in the bell that announces it, is
   * "advisory vote", so the card says the same words.
   */
  advisory: "Advisory vote",
  /*
   * ALSO NOT A WIZARD TYPE. A launch vote is opened from the journey to
   * launch, once in a village's life, and `ballots.subject_type` carries it
   * here like every other. The noun is the THING and not the machinery: the
   * table would call it a village launch, and what happened is that a village
   * decided to start playing.
   */
  village_launch: "Starting the Game",
  /*
   * ALSO NOT A WIZARD TYPE. A proposal whose change set names a minting rule
   * opens under `mint_rule` instead of `mechanics` (R81, R84), because the
   * subject type is what carries the threshold. Everything else about it is a
   * mechanics proposal, so without an entry here it fell through to
   * "Decision" while the ordinary rule change beside it read "Rule change".
   *
   * The village's own words for the thing are "minting rule": that is what
   * the frozen document calls it, what the refusals call it, and what the
   * amendment ledger records. So the noun says the same, and it stays in the
   * same register as `mechanics` above it, one word narrower.
   */
  mint_rule: "Minting rule change",
  /*
   * ALSO NOT WIZARD TYPES. The three verbs R90 hands a village over its own
   * roles: declare one, seat somebody in it, take the seat back. Each opens
   * from its own route rather than from the wizard, and `ballots.subject_type`
   * carries them here like every other.
   *
   * The noun is the THING and not the machinery, the way every entry above
   * decides it. The table would call these a role insert and two role-holder
   * writes. What is being decided is whether the village has a role, who sits
   * in it, and whether that seat goes back.
   *
   * THE CHIP SITS ABOVE THE TITLE ON A VOTE THAT IS STILL OPEN, so none of
   * these may read as though it already happened. "A role the village
   * declared" was the first draft of the first one and it does exactly that.
   */
  role_declare: "A new role",
  role_seat: "Who sits in a role",
  role_unseat: "A seat handed back",
  /*
   * The vote mode became something the village decides on 2026-09-02 (Q8),
   * with its own subject type so it can carry the constitutional bar. The
   * noun is what is being decided, which is how every vote after it will be
   * counted, and not the name of the setting that stores it.
   */
  governance_mode: "How votes are counted",
};

export const subjectNoun = (subjectType: string): string => SUBJECT_NOUN[subjectType] ?? "Decision";
