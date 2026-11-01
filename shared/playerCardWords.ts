/**
 * THE PLAYER CARD'S WORDS: every fixed string the person-level card prints.
 *
 * Kept apart from `shared/playerCard.ts` so the model keeps room under the
 * 1000-line gate and the voice gate reads all of the copy in one file.
 *
 * Five rules this copy keeps, each one a ruling:
 *   - "role" is the noun for a sociocratic role everywhere a member reads it.
 *     Stored identifiers keep "seat" (2026-10-21).
 *   - A role's work is "tasks" and "accomplishments". "Quests" are community
 *     work only.
 *   - Time promises are "2 business days", never a count of hours.
 *   - No copy names a person. A role is named by its full title, a power by
 *     its own name, and the only person on a card is its owner, in the header.
 *   - Section headings speak in the first person: "My roles".
 *
 * Reference design: https://claude.ai/artifact/49Fh3tdkSoNYTmNDFv24D1 (version 12).
 * The CCOS sections and their hover terms follow the approved CCOS version
 * (https://claude.ai/artifact/XGP6VP5WFU1T6ti7RD482P, Rye 2026-10-22).
 */
import type { ApplicationStatus } from "./seatApplications";
import type { PayKind } from "./seatSettings";
import { CCOS_TERMS as CIRCLE_CCOS_TERMS, CIRCLE_CARD_WORDS } from "./circleCardWords";

export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export const CARD_WORDS = {
  // Header
  holdsNoRoles: "Holds no roles yet",
  rolesLine: (n: number, names: string) => `${plural(n, "role", "roles")}: ${names}`,
  dayOfSeason: (day: number, of: number) => `Day ${day} of ${of}`,
  seasonNotRead: "No season set",
  appliesFor: (names: string) => `Applies for ${names}`,

  // The hero, in the approved design (Rye 2026-10-22): the moon pill, the
  // tagline and the span. Moons are named by the month their new moon falls in.
  moonName: (month: string) => `${month} Moon`,
  moonPill: (moon: string, day: number, of: number) => `${moon} · Day ${day} of ${of}`,
  moonLine: (moon: string, from: string, to: string) => `${moon}, ${from} to ${to}`,
  heroSpan: (from: string, to: string) => `${from} to ${to}`,
  tagline: (count: string, n: number, circles: string | null, time: string | null, applying: boolean) =>
    `${applying ? `Applying for ${count}` : count} ${n === 1 ? "role" : "roles"}${circles ? ` in ${circles}` : ""}${time ? ` · ${time}` : ""}`,
  fullTime: "Full-time",
  aboutHours: (n: number) => `About ${n} hours a week`,
  portraitAlt: (name: string) => `${name}'s character portrait`,

  // Doors
  applyDoor: "Apply for a role",
  planDoor: "Plan my season",

  // Tiles
  myRoles: "My roles",
  proposedRoles: "The roles I am applying for",

  // Across
  acrossOne: "Across my role",
  acrossMany: (n: number) => `Across all ${n} roles`,
  myNRoles: (n: number) => (n === 1 ? "My role" : `My ${n} roles`),
  eachInFull: (n: number) => (n === 1 ? "My role in full" : "Each role in full"),
  aim: "My aim this season",
  noAim: "No aim written yet",
  noPlan: "No season plan filed yet",
  seasonalGoals: (n: number) => (n === 1 ? "My seasonal goal" : "My seasonal goals"),
  seasonalGoalsLede: "One to three bigger goals for the whole season. Each moon's tasks build toward them.",
  noSeasonalGoals: "No seasonal goals set yet",
  goalDoneBy: (day: string, w: string) => `Done by ${day} when ${w}`,
  goals: "Village goals it serves",
  noGoals: "No village goals named yet",
  howItHelps: "How it helps",
  howItHelpsMissing: "How it helps is not written yet",
  tasks: "This moon's tasks",
  noTasks: "No tasks this moon yet",
  taskOpen: "In progress",
  taskDone: "Done",
  doneWhen: (w: string) => `Done when ${w}`,
  signs: "How we'll know it's working",
  signsLede: (village: string | null) =>
    `Only signs ${village ?? "the village"} can count by itself, from the game and the site, updated as things happen.`,
  signFrom: (countedFrom: string, role: string) => `${countedFrom} · ${role}`,
  nOf: (n: number, of: number) => `${n} of ${of}`,
  noSigns: "No signs named yet",
  load: "Load this moon",
  loadRoles: (n: number) => plural(n, "role", "roles"),
  loadTasks: (n: number) => `${plural(n, "open task", "open tasks")} this moon`,
  loadCaption: "My own read, set each moon.",
  loadNotSet: "Not set this moon",
  loadSlider: "How this moon feels, from Healthy to Heavy",
  loadEnds: ["Healthy", "Heavy"] as const,
  loadStep: { 1: "Healthy", 2: "Leaning healthy", 3: "Balanced", 4: "Leaning heavy", 5: "Heavy" } as Record<1 | 2 | 3 | 4 | 5, string>,
  trend: { up: "Up on last moon", down: "Down on last moon", same: "Same as last moon" } as Record<"up" | "down" | "same", string>,
  trendLater: "Trend from next moon",
  openSheet: (sign: string) => `See what makes up: ${sign}`,
  wallet: "My wallet",
  pendingRoleWords: "Proposed, waiting for consent",
  growingEdge: "Growing edge",
  whoCouldHoldNext: "Who could hold this next",

  // One role in full
  keyRole: "Key role",
  heldUntil: (day: string) => `Held until ${day}`,
  reviewWeekOf: (day: string) => `Review week of ${day}`,
  purpose: "Purpose",
  noPurpose: "No purpose written yet",
  existsWhile: "This role exists while",
  decide: "What I look after",
  authorities: "What I can decide on my own",
  bringMe: "Bring me",
  countOnMe: "What you can count on me for",
  responsibilities: "What I do regularly",
  holdingWell: "Holding this role well",
  signsStretched: "Signs I'm stretched",
  flowsBack: "What flows back",
  stepBack: "How I can step back",
  timeCommitment: "Time",
  // The circle card's own sentence, so the two cards say it once.
  termsKey: CIRCLE_CARD_WORDS.termsKey,
  working: "How we'll know it's working",
  worksWith: "Works closely with",
  notMine: "Not mine to hold",
  runbook: "Runbook",
  // A10 (2026-10-31): a role holds a power only when the village has handed it
  // over, so the heading says where the power came from.
  powers: "Powers handed to this role",
  powersShared: "Powers handed to this role, shared",
  // Information only: nothing here asks anybody to hand a power over.
  suitedTo: "Suited to",
  suitedNote: "The village has not handed these over.",
  sharedWith: (label: string, roles: string) => `${label}, with ${roles}`,
  worksWithLine: (role: string, about: string) => `${role}: ${about}`,
  noPowers: "No powers held",
  notWritten: "Not written yet",
  playsAs: "Plays as",
  notCountedYet: "Not counted yet",
  ofTarget: (n: number) => `target ${n}`,
  tensions: "Tensions raised to this role",
  tensionsAnswered: (n: number) => `${plural(n, "tension", "tensions")} answered`,
  noTensions: "No tensions raised",
  tensionsOpen: (n: number) => plural(n, "open tension", "open tensions"),
  /** Some or all of the open words are kept for the role's holders and the raiser. */
  tensionsOpenPrivate: (n: number, withheld: number) =>
    withheld >= n
      ? `${plural(n, "open tension", "open tensions")}, private to the role's holders`
      : `${plural(n, "open tension", "open tensions")}, ${withheld} private to the role's holders`,
  tensionsAnsweredThisMoon: (n: number) => `${n} answered this moon`,
  noOpenTensions: "No open tensions",
  tensionsBrought: "Brought to the circle",
  tensionsWaiting: "Answer them in Waiting on you",

  // Timeline
  timeline: "My moon cycle",
  timelineEyebrow: "The season, new moon to new moon",
  invoiceDue: "Invoice due",
  today: "Today",
  timelineLede: "Work is planned a moon at a time, from one new moon to the next.",
  gettingStarted: "Getting started",
  newMoon: "New moon",
  fullMoon: "Full moon",
  tasksAgreed: "This moon's tasks agreed",
  signedOff: "Last moon's work signed off and its bonus set",
  reviewOn: (role: string) => `Check in on how ${role} is going`,
  renewalOn: (role: string) => `Talk about next season for ${role}`,
  termEnds: (role: string) => `${role} ends for the season`,
  invoice: (role: string) => `Send the invoice for ${role}`,
  moonDates: (from: string, to: string) => `${from} to ${to}`,
  gathering: (label: string, weekday: number, time: string, fortnightly: boolean, role: string) =>
    `${label}, every ${fortnightly ? "other week" : "week"} on ${WEEKDAYS[weekday] ?? "a set day"} at ${time}, for ${role}`,

  // Accomplished: tasks whose work was accepted, by moon
  accomplished: "Accomplished",
  noAccomplished: "Nothing accepted as accomplished yet",
  acceptedOn: (day: string) => `Accepted on ${day}`,

  // How I hold my roles
  howIHold: "How I hold my roles",

  // Applications
  applications: "My applications",
  historyEyebrow: "My role history",
  past: "Past seasons",
  thisSeason: "This season",
  nextSeason: "Next season",
  noPast: "No past seasons yet",
  noThisSeason: "No applications this season",
  noNextSeason: "Nothing filed for next season yet",
  startsOnceAdopted: "Starts once adopted",
  filedOn: (day: string) => `Filed ${day}`,

  // Agreements
  agreements: "My agreements",
  agreementsEyebrow: "Agreements",
  termsOnce: (count: string) => `Terms for all ${count} roles, recorded once`,
  noTerms: "No terms written yet",
  clocks: "Clocks",
  payByMonth: "Paid by the calendar month",
  payByMoon: "Paid by the moon",
  workByMoon: "The work runs by moons",
  workByWeek: "The work runs by weeks",
  term: "Term",
  endsOn: (day: string) => `Ends ${day}`,
  endsWithSeason: "Ends with the season",
  lengthMoons: (n: number) => `${plural(n, "moon", "moons")} from the day of seating`,
  reviewDate: (day: string) => `Review on ${day}`,
  noReviewDate: "No review date set",
  renewalDate: (day: string) => `Renewal on ${day}`,
  notice: (n: number) => `${plural(n, "day", "days")} of notice`,
  rhythm: "Rhythm",
  tasksPerMoon: (min: number | null, max: number | null) =>
    min !== null && max !== null && min !== max
      ? `${min} to ${max} tasks a moon`
      : `${plural((min ?? max)!, "task", "tasks")} a moon`,
  ending: "Ending",
  payThroughNotice: "Paid through the notice",
  pay: "Pay",
  allowance: "Allowance",
  bonus: "Bonus",
  bonusEquity: (village: string, token: string) => `Paid in ${village} as ${token}, then claimed off the platform.`,
  bonusEquityNoToken: "Paid as an equity bonus, then claimed off the platform.",
  bonusCap: (w: string) => `Cap: ${w}`,
  bonusRatedBy: (w: string) => `Rated by ${w}`,
  bonusCadence: (w: string) => `Cadence: ${w}`,
} as const;

/**
 * THE CCOS TERM BEHIND EACH PLAIN HEADING of a role in full, shown as
 * "CCOS: <term>" on hover or tap (Rye, 2026-10-22), the same pattern the
 * circle card keeps. The five headings the CCOS Role Card and Circle Charter
 * share are read from the circle card's own map, so the two cards cannot
 * drift; the rest belong to the role card alone. A later change may move the
 * shared five into one map in `shared/` once the circle cards lane has landed
 * its parts (the merge session's call, 2026-10-22).
 */
export const ROLE_CCOS_TERMS = {
  purpose: CIRCLE_CCOS_TERMS.purpose,
  existsWhile: "Purpose, when the role should evolve or dissolve",
  decide: CIRCLE_CCOS_TERMS.domains,
  authorities: CIRCLE_CCOS_TERMS.authorities,
  countOnMe: CIRCLE_CCOS_TERMS.accountabilities,
  responsibilities: CIRCLE_CCOS_TERMS.responsibilities,
  working: "Measurable Indicators (KPIs)",
  signsStretched: "ARC Awareness, and the Energy & Sustainability Check",
  flowsBack: "ARC Reciprocity",
  stepBack: "ARC Choice",
  notMine: "the edges of Domains and Authorities",
  timeCommitment: "Time Commitment",
} as const;
export type RoleTermKey = keyof typeof ROLE_CCOS_TERMS;

/** Pay in words only. A figure is never typed on this card. */
export const PAY_WORDS: Record<PayKind, string> = {
  none: "No pay",
  fixed: "Fixed pay",
  range: "Pay within a range",
  honorary: "Honorary",
  "in-kind": "Paid in kind",
  deferred: "Deferred pay",
};

export const ALLOWANCE_WORDS: Record<"none" | "flat" | "reimbursed", string> = {
  none: "No allowance",
  flat: "A flat allowance",
  reimbursed: "Costs reimbursed",
};

export const PER_WORDS: Record<"month" | "moon", string> = { month: "per month", moon: "per moon" };

/** An application's status in plain words, keyed by the stored union so a new status cannot print blank. */
export const APPLICATION_STATUS_WORDS: Record<ApplicationStatus, string> = {
  "awaiting-holder": "Waiting on the role's holder",
  voting: "Being voted on",
  adopted: "Adopted",
  "not-adopted": "Not adopted",
  withdrawn: "Withdrawn",
  "held-full": "The role was already full",
};
