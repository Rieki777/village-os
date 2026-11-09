/**
 * The investor path's rules (S1 of the investor path; spec v0.3, approved 2026-11-09).
 *
 * PURE. No database, no clock but the one handed in, no money moved and no amount stored.
 * Routes gather facts (role holders, holdings, donation months) and hand them here; this
 * file decides. Every way that earns equity earns it through the economics lane's
 * `money_in` investment, confirmed by the investor and signed off by a sign-off role
 * holder (R2). This file never mints and never reads the ledger.
 *
 * Every refusal names the vote that can change it (Article 0.4). `REFUSALS` is the single
 * table; a refusal is built only from it, so a new code without a vote path does not
 * compile.
 */

// ── The ways in ─────────────────────────────────────────────────────────────

export const WAY_KEYS = [
  "direct", "founding", "backing", "steward", "venture",
  "business", "home", "parcel", "sponsor", "inkind",
] as const;
export type WayKey = (typeof WAY_KEYS)[number];

export type WayGroupKey = "stake" | "build" | "home" | "give";

/**
 * How a way relates to equity. `earns`: the way itself is an investment. `alongside`:
 * the way earns none, the person may invest alongside. `none`: a purchase, no equity by
 * itself. `gift`: a donation, Voice and no equity.
 */
export type WayEquity = "earns" | "alongside" | "none" | "gift";

/** The record each way's commitment links to (spec US4.1). */
export type OwnerKind = "money_in" | "funding_pledge" | "place_claim" | "housing_reservation" | "parcel_invitation";

export interface WayDef {
  key: WayKey;
  group: WayGroupKey;
  membersOnly: boolean;
  equity: WayEquity;
  owner: OwnerKind;
  /** The org role that answers by default; Admin maps the real one (spec US2.5). */
  defaultRole: string;
  /** R3: the home way states, and the lease check enforces, the shares a land lease needs. */
  leaseNeedsShares: boolean;
}

const way = (key: WayKey, group: WayGroupKey, equity: WayEquity, owner: OwnerKind, defaultRole: string, extra: Partial<WayDef> = {}): WayDef => ({
  key, group, equity, owner, defaultRole, membersOnly: false, leaseNeedsShares: false, ...extra,
});

export const WAYS: Record<WayKey, WayDef> = {
  direct: way("direct", "stake", "earns", "money_in", "Lead Financial Steward"),
  founding: way("founding", "stake", "earns", "money_in", "Lead Financial Steward", { membersOnly: true }),
  venture: way("venture", "stake", "earns", "money_in", "Regenerative Business Steward"),
  backing: way("backing", "build", "earns", "funding_pledge", "Funding rounds"),
  steward: way("steward", "build", "alongside", "place_claim", "Build & Project Steward"),
  business: way("business", "build", "alongside", "place_claim", "Regenerative Business Steward"),
  inkind: way("inkind", "build", "earns", "money_in", "Lead Financial Steward"),
  home: way("home", "home", "none", "housing_reservation", "Land & Home Sales Steward", { leaseNeedsShares: true }),
  parcel: way("parcel", "home", "none", "parcel_invitation", "Land & Home Sales Steward"),
  sponsor: way("sponsor", "give", "gift", "money_in", "Lead Financial Steward"),
};

export const WAY_GROUPS: ReadonlyArray<{ key: WayGroupKey; ways: readonly WayKey[] }> = [
  { key: "stake", ways: ["direct", "founding", "venture"] },
  { key: "build", ways: ["backing", "steward", "business", "inkind"] },
  { key: "home", ways: ["home", "parcel"] },
  { key: "give", ways: ["sponsor"] },
];

// ── Refusals and their vote paths (Article 0.4) ─────────────────────────────

export interface VotePath {
  /** `highest`: the village's highest-tier vote. `village`: an ordinary village vote. */
  tier: "highest" | "village";
  /** The dial, rule or record the vote changes. */
  subject: string;
  /** Where the change is made once the vote passes. */
  where: string;
}

export const REFUSALS = {
  WAY_HIDDEN: { tier: "highest", subject: "investor.hidden_ways", where: "Admin, Pages, Investor journey" },
  WAY_MEMBERS_ONLY: { tier: "highest", subject: "investor.founding_members_only", where: "Admin, Pages, Investor journey" },
  HAND_ALREADY_OPEN: { tier: "highest", subject: "investor.one_open_hand_per_way", where: "Admin, Settings, Investor path" },
  HAND_LIMIT_REACHED: { tier: "highest", subject: "investor.hand_limit", where: "Admin, Settings, Investor path" },
  SIGNOFF_SELF: { tier: "highest", subject: "investor.signoff_roles", where: "Admin, Roles, Sign-off roles" },
  SIGNOFF_NOT_ROLE: { tier: "highest", subject: "investor.signoff_roles", where: "Admin, Roles, Sign-off roles" },
  SIGNOFF_RECORDER: { tier: "highest", subject: "investor.signoff_roles", where: "Admin, Roles, Sign-off roles" },
  HOME_SHARES_UNSET: { tier: "highest", subject: "investor.home_lease_min_shares", where: "Admin, Settings, Investor path" },
  HOME_SHARES_SHORT: { tier: "highest", subject: "investor.home_lease_min_shares", where: "Admin, Settings, Investor path" },
  INKIND_NO_CAMPAIGN: { tier: "village", subject: "a crowd-pooling campaign for the need", where: "Funding rounds" },
} as const satisfies Record<string, VotePath>;

export type RefusalCode = keyof typeof REFUSALS;

export interface Refusal {
  ok: false;
  code: RefusalCode;
  votePath: VotePath;
}
export type Verdict = { ok: true } | Refusal;

const refuse = (code: RefusalCode): Refusal => ({ ok: false, code, votePath: { ...REFUSALS[code] } });
const OK: { ok: true } = { ok: true };

// ── Showing a way (US1.1b) ──────────────────────────────────────────────────

export function wayVisibility(key: WayKey, ctx: { hidden: readonly WayKey[]; member: boolean }): Verdict {
  if (ctx.hidden.includes(key)) return refuse("WAY_HIDDEN");
  if (WAYS[key].membersOnly && !ctx.member) return refuse("WAY_MEMBERS_ONLY");
  return { ...OK };
}

// ── Routing a raised hand (US3.3) ───────────────────────────────────────────

export type IntentRoute = { to: "role" | "anchor"; recipients: string[] } | { to: "notice"; recipients: [] };

/**
 * The answering role's other holders; else the Anchor Circle's members; else a village
 * notice any member may answer. The raiser is never a recipient.
 */
export function routeIntent(input: { raiserId: string; roleHolders: readonly string[]; anchorCircle: readonly string[] }): IntentRoute {
  const others = (ids: readonly string[]) => Array.from(new Set(ids)).filter((id) => id !== input.raiserId);
  const role = others(input.roleHolders);
  if (role.length > 0) return { to: "role", recipients: role };
  const anchor = others(input.anchorCircle);
  if (anchor.length > 0) return { to: "anchor", recipients: anchor };
  return { to: "notice", recipients: [] };
}

// ── The Concept label (US1.4) ───────────────────────────────────────────────

/** The places spec's stage ladder, in order. Land, the preserve and natural features have none. */
export const PLACE_STAGES = ["idea", "sited", "designed", "permitted", "funded", "building", "built", "in_use", "needs_care"] as const;
export type PlaceStage = (typeof PLACE_STAGES)[number];

/** A place is Concept before it is permitted, while unconfirmed, or stageless and unconfirmed. */
export function isConcept(place: { stage: PlaceStage | null; confirmed: boolean }): boolean {
  if (!place.confirmed) return true;
  if (place.stage === null) return false;
  return PLACE_STAGES.indexOf(place.stage) < PLACE_STAGES.indexOf("permitted");
}

// ── Hand limits (US3.4a) ────────────────────────────────────────────────────

/** `raisedThisMoon` counts withdrawn intents too, so withdrawing never refills the allowance. */
export function handVerdict(input: { openOnWay: number; raisedThisMoon: number; limit: number }): Verdict {
  if (input.openOnWay > 0) return refuse("HAND_ALREADY_OPEN");
  if (!(input.raisedThisMoon < input.limit)) return refuse("HAND_LIMIT_REACHED");
  return { ...OK };
}

// ── Concentration (US7) ─────────────────────────────────────────────────────

export interface Holding {
  equity: number;
  voice: number;
}

export interface ConcentrationResult {
  applies: boolean;
  crosses: Array<"equity" | "voice">;
  needsNotice: boolean;
}

/**
 * Checked on every `money_in`, donation or investment. `group` is the combined holding of
 * every member named on the same agreement, as it stands before `incoming`. A donation
 * carries Voice and no equity, and is checked on Voice. Below 3 holders the line does not
 * apply and every investment takes the member notice instead.
 */
export function concentrationCheck(input: {
  linePct: number;
  holders: number;
  totals: Holding;
  group: Holding;
  incoming: Holding;
}): ConcentrationResult {
  if (input.holders < 3) return { applies: false, crosses: [], needsNotice: true };
  const crosses: Array<"equity" | "voice"> = [];
  for (const k of ["equity", "voice"] as const) {
    if (input.incoming[k] <= 0) continue;
    const after = input.group[k] + input.incoming[k];
    const total = input.totals[k] + input.incoming[k];
    if (total > 0 && (after * 100) / total > input.linePct) crosses.push(k);
  }
  return { applies: true, crosses, needsNotice: crosses.length > 0 };
}

export type ConcentrationBand = "under_10" | "10_20" | "over_20";

/** Members see the top holder only as a band, and only once `floor` members hold. */
export function concentrationBand(input: { topPct: number; holders: number; floor: number }): ConcentrationBand | null {
  if (input.holders < input.floor) return null;
  if (input.topPct < 10) return "under_10";
  if (input.topPct <= 20) return "10_20";
  return "over_20";
}

/** The vote that may refuse a concentrating record counts work-only Voice, without the investor. */
export function concentrationVoteRule(investorId: string): { voiceCount: "work_only"; excludeUserIds: string[] } {
  return { voiceCount: "work_only", excludeUserIds: [investorId] };
}

// ── Sign-off by the finance lead or Treasurer (R2) ──────────────────────────

/** Days a recorded investment waits for a sign-off before the member notice opens. */
export const SIGNOFF_WAIT_DAYS = 7;

/**
 * A sign-off role holder (Admin maps the roles: the finance lead and the Treasurer) signs
 * every investment. Never the investor. Not the recorder while another eligible holder
 * exists.
 */
export function signoffVerdict(input: { investorId: string; recorderId: string; signerId: string; signoffHolders: readonly string[] }): Verdict {
  if (input.signerId === input.investorId) return refuse("SIGNOFF_SELF");
  if (!input.signoffHolders.includes(input.signerId)) return refuse("SIGNOFF_NOT_ROLE");
  if (input.signerId === input.recorderId) {
    const another = input.signoffHolders.some((h) => h !== input.recorderId && h !== input.investorId);
    if (another) return refuse("SIGNOFF_RECORDER");
  }
  return { ...OK };
}

/**
 * Who may sign now, or `notice` when nobody eligible exists or 7 days have passed: a
 * 7-day member notice opens, and a village vote can stop the record (Article 0.4).
 */
export function signoffRoute(input: { investorId: string; signoffHolders: readonly string[]; recordedAt: Date; now: Date }):
  { state: "awaiting_signoff" | "notice"; eligible: string[] } {
  const eligible = Array.from(new Set(input.signoffHolders)).filter((h) => h !== input.investorId);
  if (eligible.length === 0) return { state: "notice", eligible: [] };
  const waited = input.now.getTime() - input.recordedAt.getTime();
  if (waited >= SIGNOFF_WAIT_DAYS * 86_400_000) return { state: "notice", eligible };
  return { state: "awaiting_signoff", eligible };
}

// ── A home's land lease needs N shares (R3) ─────────────────────────────────

/**
 * To hold the 99-year lease on the land under a home, the member holds at least N whole
 * units of the village's equity: invested equity and Earned Equity together. N is a village
 * setting; blank fails closed. The answer is yes or no only: the steward recording the
 * lease never sees the holding.
 */
export function homeLeaseCheck(input: { minShares: number | null; investedUnits: number; earnedUnits: number }): Verdict {
  const n = input.minShares;
  if (n === null || !Number.isFinite(n) || n < 0) return refuse("HOME_SHARES_UNSET");
  const held = Math.floor(Math.max(0, input.investedUnits)) + Math.floor(Math.max(0, input.earnedUnits));
  if (held < Math.ceil(n)) return refuse("HOME_SHARES_SHORT");
  return { ...OK };
}

// ── In-kind goods (R4) ──────────────────────────────────────────────────────

/** The material library's token today (`server/lib/library.ts`, LIBRARY_CREDIT). */
export const LIBRARY_TOKEN = "library-credit";
/** The economics lane's invested-equity token (voice-from-money). */
export const INVESTED_EQUITY_TOKEN = "invested-equity";

export type InKindRoute =
  | { token: typeof LIBRARY_TOKEN; via: "library.recordIntake"; equity: false; voice: false }
  | { token: typeof INVESTED_EQUITY_TOKEN; via: "money_in"; channel: "other"; earmark: string; equity: true; voice: true };

/**
 * Goods for the material library (things residents borrow) earn library credits through
 * the library's own intake, with its caps and dual sign-off. Goods for a village need in a
 * crowd-pooling campaign (tractors, lumber, tools) earn invested equity through a `money_in`
 * investment earmarked to the campaign.
 */
export function inKindRoute(input: { destination: "library" } | { destination: "campaign"; campaignId: string }): InKindRoute | Refusal {
  if (input.destination === "library") return { token: LIBRARY_TOKEN, via: "library.recordIntake", equity: false, voice: false };
  const id = input.campaignId.trim();
  if (id === "") return refuse("INKIND_NO_CAMPAIGN");
  return { token: INVESTED_EQUITY_TOKEN, via: "money_in", channel: "other", earmark: `campaign:${id}`, equity: true, voice: true };
}

// ── The founding member badge, "Founding Cedars" in its first village (R7) ──

const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;

/** "YYYY-MM" of an instant in the village's own time zone. */
export function villageMonth(at: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit" }).formatToParts(at);
  const y = parts.find((p) => p.type === "year")?.value ?? "";
  const m = parts.find((p) => p.type === "month")?.value ?? "";
  return `${y}-${m}`;
}

export function previousMonth(month: string): string {
  const m = MONTH.exec(month);
  if (!m) throw new Error(`not a YYYY-MM month: ${month}`);
  const y = Number(m[1]);
  const mo = Number(m[2]);
  return mo === 1 ? `${y - 1}-12` : `${y}-${String(mo - 1).padStart(2, "0")}`;
}

export type FoundingStanding =
  | { earned: false }
  | { earned: true; earnedMonth: string; currentThrough: string; current: boolean; monthsKept: number };

/**
 * `donationMonths`: the village-local months in which a donation to the church fund issued
 * the member's Voice (economics' read, no amounts). The badge is earned on the first such
 * month and kept for good, with its date. The title is current while the latest donation
 * month is this month or last month, so a monthly donor never falls between titles.
 */
export function foundingStanding(input: { donationMonths: readonly string[]; currentMonth: string }): FoundingStanding {
  const months = Array.from(new Set(input.donationMonths.filter((m) => MONTH.test(m)))).sort();
  if (months.length === 0) return { earned: false };
  const earnedMonth = months[0]!;
  const currentThrough = months[months.length - 1]!;
  const current = currentThrough === input.currentMonth || currentThrough === previousMonth(input.currentMonth);
  return { earned: true, earnedMonth, currentThrough, current, monthsKept: months.length };
}

/** A benefit or reward a vote attaches to the founding standing later. */
export interface FoundingBenefit {
  key: string;
  eligible: (standing: FoundingStanding) => boolean;
}

/** Empty in v1: the hook exists so benefits can be attached without reshaping the standing. */
export const FOUNDING_BENEFITS: readonly FoundingBenefit[] = [];

export function foundingBenefitsFor(standing: FoundingStanding, benefits: readonly FoundingBenefit[] = FOUNDING_BENEFITS): string[] {
  return benefits.filter((b) => b.eligible(standing)).map((b) => b.key);
}
