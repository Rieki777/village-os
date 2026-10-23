/**
 * PROPOSE MY ROLES FOR NEXT SEASON: the contract (role proposals PR A).
 *
 * A member drafts the roles they will hold next season as ONE proposal: the
 * roles they keep or take up, new roles they would like the village to make,
 * the words they would change on each, the terms they would hold them on, a
 * review date per role, and their own season (an aim, 1 to 3 seasonal goals,
 * how each helps, and which of the village's goals for THAT season each
 * serves). Rye, 2026-10-22. This file is the part with no database and no
 * request in it: what a draft may hold, the limits, the diff a page draws in
 * gold, and every sentence a member reads. The route
 * (server/routes/roleProposals.ts) and the store (server/repos/roleProposals.ts)
 * read these, so a rule has one spelling.
 *
 * ── A DRAFT IS THE MEMBER'S OWN UNTIL THEY SUBMIT IT ──────────────────────
 *
 * Only its owner reads a draft by id. Nobody who adopts applications sees it,
 * and it is on no list. The owner may share a link for feedback (below).
 * SUBMITTING writes an ordinary seat application for the target season
 * through the member door (shared/seatApplications.ts), and from then on it
 * is decided the way every application is.
 *
 * ── ROLE WORDS PASS THROUGH BY FIELD NAME ─────────────────────────────────
 *
 * The words a member changes on a role are kept as a map from the field name
 * an `update_seat` draft takes (`aim`, `domain`, `accountabilities`, ...) to
 * the proposed value, and ONLY the fields they changed are stored. Which
 * fields a role has is not listed here: the route reads it off the role the
 * platform reads (`rowToRole`), minus `NOT_ROLE_WORDS`, so a field a later
 * release adds to roles (the CCOS words) passes through with no edit here. A
 * new role holds the words a `create_seat` draft takes, the same way.
 *
 * ── THE DIFF IS AGAINST THE ROLE AS POSTED NOW ────────────────────────────
 *
 * `wordFields` answers, for every word field of a role, the posted value, the
 * proposed value and whether they differ, so the page can draw changed words
 * in gold. "Posted" is the role as it stands when the draft is read, so a
 * change somebody else had adopted since reads as no change.
 *
 * ── THE SHARE LINK ─────────────────────────────────────────────────────────
 *
 * Off until the owner turns it on. Members of the village with the link read
 * the draft as a member reads an application (terms included) and may leave a
 * comment. With "anyone with the link" on, a reader who is not a member reads
 * it at the public tier: the roles and their words, never the terms, and no
 * comments. Turning the link off, or making a new one, kills the old link.
 *
 * Money in a draft is a RECORD, as in an application. Nothing here pays.
 */
import { MAX_SEATS } from "./seatApplications";
import { looksLikePaymentDetails, parseSeatSettings, type SeatSettings } from "./seatSettings";
import { AIM_MAX } from "./seasonPlans";
import { parseSeasonalGoals, parseServesGoals, type SeasonalGoal, type ServedGoal } from "./seasonPlanWords";
import { ROLE_HANDOVER_FIELDS, type RoleHandoverField } from "./roleHandover";
import { parseRoleHandoverField } from "./roleHandoverParse";

/** One proposal holds at most as many roles as one application does. */
export const MAX_PROPOSAL_ROLES = MAX_SEATS;

/** A proposal id: `rp-` and sixteen hex characters. */
export const PROPOSAL_ID = /^rp-[0-9a-f]{16}$/;

/** The id a new role is given in a draft, and keeps when the village creates it. */
export const NEW_ROLE_ID = /^role-[0-9a-f]{12}$/;

/** A share token: 32 url-safe characters, 192 random bits. */
export const SHARE_TOKEN = /^[A-Za-z0-9_-]{32}$/;

export const PROPOSAL_STATUSES = ["draft", "submitted"] as const;
export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number];

export const SHARE_AUDIENCES = ["members", "anyone"] as const;
export type ShareAudience = (typeof SHARE_AUDIENCES)[number];

/** Longest a comment may run. */
export const COMMENT_MAX = 1000;
/** Longest a text word may run: a runbook's room. */
export const WORD_TEXT_MAX = 2000;
/** A list word: at most this many items, each at most `WORD_ITEM_MAX` characters. */
export const WORD_LIST_MAX = 20;
export const WORD_ITEM_MAX = 300;
/** A role's name, as the draft preview allows it. */
export const ROLE_NAME_MAX = 120;

/** Where the member's own proposal is read and edited. PR C builds the page. */
export function proposalHref(id: string): string {
  return `/role-proposals/${encodeURIComponent(id)}`;
}

/** The page a share link opens. PR C builds the page. */
export function sharedProposalHref(token: string): string {
  return `/role-proposals/shared/${encodeURIComponent(token)}`;
}

/** Where a new proposal starts. PR C builds the page. */
export const NEW_PROPOSAL_HREF = "/role-proposals/new";

/**
 * Fields a role carries that are never its WORDS: structure, flags, money and
 * provenance. A proposal never changes these through the words map. A new
 * role's circle and how many people it holds are fields of their own.
 */
export const NOT_ROLE_WORDS: ReadonlySet<string> = new Set([
  "id",
  "circleId",
  "circleName",
  "circleMatches",
  "circleUnread",
  "seats",
  "criticality",
  "recruiting",
  "active",
  "expiresEachSeason",
  "statusOverride",
  "statusOverrideExpiresAt",
  "icon",
  "color",
  "order",
  "isExample",
  "representsCircle",
  "howChosen",
  "howChosenGloss",
  "archetypes",
  "archetypesSuggested",
  // The recruitment pack is admin only on /api/org, and no draft writes it.
  "authority",
  "firstYearOutcomes",
  "first90DayOutcomes",
  "locationExpectations",
  "compensationReality",
  "evidenceRequired",
  // Terms live in the proposal's own terms, never on the role through its words.
  "termsOffer",
  "termsOfferAt",
  "termsOfferBy",
  "valueMinor",
  "valueCurrency",
  "valueTokens",
]);

/** What the route knows about a village's roles: which fields are words, and which of those are lists. */
export interface WordFieldsContext {
  /** Every word field a role carries, in the order a page shows them. */
  fields: readonly string[];
  /** The fields whose value is a list. A text sent for one is read one item per line. */
  lists: ReadonlySet<string>;
}

/**
 * The word fields of a role the platform reads. PURE.
 *
 * `template` is a role as the server reads one (`rowToRole({})`), so every
 * field it carries is offered, minus `NOT_ROLE_WORDS`. A field whose value is
 * a list there is a list here. The handover lists are lists whatever the
 * template says, since an absent one reads as null.
 */
export function wordFieldsOf(template: Record<string, unknown>): WordFieldsContext {
  const fields = Object.keys(template).filter((k) => !NOT_ROLE_WORDS.has(k));
  const lists = new Set(fields.filter((k) => Array.isArray(template[k])));
  for (const f of ["bringMe", "notMine"]) if (fields.includes(f)) lists.add(f);
  return { fields, lists };
}

export type WordValue = string | string[] | null;
export type RoleWords = Record<string, WordValue>;

/** A value as the diff compares it: trimmed text, a list of trimmed items, or null for nothing written. */
export function normalWord(v: unknown, list: boolean): WordValue {
  if (v === undefined || v === null) return null;
  if (Array.isArray(v)) {
    const items = v.map((x) => String(x ?? "").trim()).filter(Boolean);
    return items.length ? items : null;
  }
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!s) return null;
  if (list) {
    const items = s.split(/\r?\n/).map((x) => x.replace(/^\s*[-*•]\s+/, "").trim()).filter(Boolean);
    return items.length ? items : null;
  }
  return s;
}

const same = (a: WordValue, b: WordValue): boolean => JSON.stringify(a) === JSON.stringify(b);

export type Parsed<T> = { ok: true; value: T } | { ok: false; field: string; error: string };

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/**
 * One role's words, read field by field. PURE.
 *
 * Every key must be a word field of this village's roles. A text is at most
 * `WORD_TEXT_MAX` characters; a list at most `WORD_LIST_MAX` items of
 * `WORD_ITEM_MAX`; the handover words pass the one parser the draft preview
 * and the publish run (shared/roleHandoverParse.ts). Nothing that looks like
 * payment details is kept. `posted` is the role as it stands: a value equal to
 * it is no change, so it is not stored.
 */
export function parseRoleWords(v: unknown, at: string, ctx: WordFieldsContext, posted: Record<string, unknown> | null): Parsed<RoleWords> {
  if (v === undefined || v === null) return { ok: true, value: {} };
  if (!isObject(v)) return { ok: false, field: at, error: "A role's words arrive as a set of fields." };
  const out: RoleWords = {};
  for (const key of Object.keys(v)) {
    const field = `${at}.${key}`;
    if (!ctx.fields.includes(key)) {
      return { ok: false, field, error: NOT_ROLE_WORDS.has(key) ? PROPOSAL_WORDS.notAWord : PROPOSAL_WORDS.unknownField };
    }
    const raw = v[key];
    if (raw !== null && typeof raw !== "string" && !(Array.isArray(raw) && raw.every((x) => typeof x === "string"))) {
      return { ok: false, field, error: "This needs to be words." };
    }
    let value: WordValue;
    if ((ROLE_HANDOVER_FIELDS as readonly string[]).includes(key)) {
      const r = parseRoleHandoverField(key as RoleHandoverField, raw);
      if (!r.ok) return { ok: false, field, error: r.problem };
      value = normalWord(r.value, ctx.lists.has(key));
    } else {
      value = normalWord(raw, ctx.lists.has(key));
      if (typeof value === "string") {
        const max = key === "name" ? ROLE_NAME_MAX : WORD_TEXT_MAX;
        if (value.length > max) return { ok: false, field, error: `Keep this to ${max} characters.` };
      } else if (Array.isArray(value)) {
        if (value.length > WORD_LIST_MAX) return { ok: false, field, error: `Up to ${WORD_LIST_MAX} lines.` };
        if (value.some((s) => s.length > WORD_ITEM_MAX)) return { ok: false, field, error: `Keep each line to ${WORD_ITEM_MAX} characters.` };
      }
    }
    const text = Array.isArray(value) ? value.join("\n") : value ?? "";
    if (text && looksLikePaymentDetails(text)) return { ok: false, field, error: PROPOSAL_WORDS.paymentInWords };
    if (posted && same(value, normalWord(posted[key], ctx.lists.has(key)))) continue;
    out[key] = value;
  }
  return { ok: true, value: out };
}

/** One word field as a page draws it: what is posted, what is proposed, and whether they differ. */
export interface WordField {
  field: string;
  posted: WordValue;
  proposed: WordValue;
  changed: boolean;
}

/**
 * EVERY WORD FIELD OF A ROLE, POSTED AGAINST PROPOSED. PURE.
 *
 * A field the member did not change reads its posted value as proposed. A
 * new role has nothing posted, so every field it writes is changed.
 */
export function wordFields(posted: Record<string, unknown> | null, words: RoleWords, ctx: WordFieldsContext): WordField[] {
  const keys = [...ctx.fields, ...Object.keys(words).filter((k) => !ctx.fields.includes(k))];
  return keys.map((field) => {
    const list = ctx.lists.has(field);
    const was = posted ? normalWord(posted[field], list) : null;
    const now = Object.prototype.hasOwnProperty.call(words, field) ? normalWord(words[field], list) : was;
    return { field, posted: was, proposed: now, changed: !same(was, now) };
  });
}

/** True when a proposal changes any posted words or names a new role, which is what PR B's adoption must apply. */
export function changesRoles(body: Pick<ProposalBody, "roles" | "newRoles">): boolean {
  return body.newRoles.length > 0 || body.roles.some((r) => Object.keys(r.words).length > 0);
}

// ── What a draft holds ──────────────────────────────────────────────────────

/** A role the village already has, as the draft names it. */
export interface ProposalRole {
  roleId: string;
  /** Only the fields the member changed, by `update_seat` field name. */
  words: RoleWords;
  /** YYYY-MM-DD, the day this role is reviewed, or null. */
  reviewOn: string | null;
}

/** A role the member would like the village to make. */
export interface NewRole {
  /** `role-` and twelve hex characters, given by the server and kept when the role is created. */
  id: string;
  /** The circle it would sit in. A new role always sits in a circle, since the circle consents to it. */
  circleId: string;
  /** How many people it holds, 1 to 50. */
  seats: number;
  /** The words a `create_seat` draft takes. `name` is required. */
  words: RoleWords;
  reviewOn: string | null;
}

/** The member's own season, for the season the draft is for. */
export interface SeasonWords {
  aim: string | null;
  seasonalGoals: SeasonalGoal[];
  /** Which of the village's goals for that season each serves, and how it helps. */
  servesGoals: ServedGoal[];
}

export interface ProposalBody {
  roles: ProposalRole[];
  newRoles: NewRole[];
  /** The terms, one set for every role, as an application holds them. */
  settings: SeatSettings;
  season: SeasonWords;
}

export function emptyBody(): ProposalBody {
  return { roles: [], newRoles: [], settings: { v: 1 }, season: { aim: null, seasonalGoals: [], servesGoals: [] } };
}

/** Read a stored body, filling anything a row written by an earlier shape lacks. PURE. */
export function bodyOf(raw: unknown): ProposalBody {
  const b = isObject(raw) ? raw : {};
  const e = emptyBody();
  const season = isObject(b.season) ? b.season : {};
  return {
    roles: Array.isArray(b.roles) ? (b.roles as ProposalRole[]).filter((r) => isObject(r) && typeof r.roleId === "string").map((r) => ({ roleId: r.roleId, words: isObject(r.words) ? (r.words as RoleWords) : {}, reviewOn: typeof r.reviewOn === "string" ? r.reviewOn : null })) : e.roles,
    newRoles: Array.isArray(b.newRoles)
      ? (b.newRoles as NewRole[])
          .filter((r) => isObject(r) && typeof r.id === "string")
          .map((r) => ({ id: r.id, circleId: String(r.circleId ?? ""), seats: Number(r.seats ?? 1) || 1, words: isObject(r.words) ? (r.words as RoleWords) : {}, reviewOn: typeof r.reviewOn === "string" ? r.reviewOn : null }))
      : e.newRoles,
    settings: isObject(b.settings) ? (b.settings as unknown as SeatSettings) : e.settings,
    season: {
      aim: typeof season.aim === "string" ? season.aim : null,
      seasonalGoals: Array.isArray(season.seasonalGoals) ? (season.seasonalGoals as SeasonalGoal[]) : [],
      servesGoals: Array.isArray(season.servesGoals) ? (season.servesGoals as ServedGoal[]) : [],
    },
  };
}

/** What the route knows when it reads a body: the roles as posted, and the target season's goals. */
export interface BodyContext {
  words: WordFieldsContext;
  /** Each existing role a draft may name, as posted now. A role id missing here is refused. */
  postedRoles: ReadonlyMap<string, Record<string, unknown>>;
  /** The village's circles, by id. */
  circles: ReadonlySet<string>;
  /** The goals of the season the draft is for, as written. Empty when there is no target season. */
  orgGoals: readonly string[];
  /** Makes a fresh new-role id. */
  newRoleId(): string;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

function reviewDay(v: unknown, field: string): Parsed<string | null> {
  if (v === undefined || v === null || v === "") return { ok: true, value: null };
  if (typeof v !== "string" || !DAY.test(v.trim())) return { ok: false, field, error: "Write the review day as a date like 2026-11-09, or leave it empty." };
  return { ok: true, value: v.trim() };
}

/**
 * READ AN UPDATE INTO THE NEXT BODY, or the first reason it cannot be. PURE.
 *
 * Each group (`roles`, `newRoles`, `settings`, `season`) the update leaves out
 * keeps what `current` holds, so the page can save one step at a time. A
 * group sent replaces that group whole. The roles together are at most
 * `MAX_PROPOSAL_ROLES`.
 */
export function parseBodyUpdate(update: unknown, current: ProposalBody, ctx: BodyContext): Parsed<ProposalBody> {
  const u = isObject(update) ? update : {};
  const next: ProposalBody = { ...current, season: { ...current.season } };

  if (u.roles !== undefined) {
    if (!Array.isArray(u.roles)) return { ok: false, field: "roles", error: "The roles arrive as a list." };
    const roles: ProposalRole[] = [];
    for (let i = 0; i < u.roles.length; i += 1) {
      const at = `roles.${i}`;
      const item = u.roles[i];
      if (!isObject(item)) return { ok: false, field: at, error: "Pick a role from the village's list." };
      const roleId = typeof item.roleId === "string" ? item.roleId.trim() : "";
      const posted = ctx.postedRoles.get(roleId);
      if (!roleId || !posted) return { ok: false, field: `${at}.roleId`, error: PROPOSAL_WORDS.noSuchRole };
      if (roles.some((r) => r.roleId === roleId)) return { ok: false, field: `${at}.roleId`, error: "Each role appears once in a proposal." };
      const words = parseRoleWords(item.words, `${at}.words`, ctx.words, posted);
      if (!words.ok) return words;
      const review = reviewDay(item.reviewOn, `${at}.reviewOn`);
      if (!review.ok) return review;
      roles.push({ roleId, words: words.value, reviewOn: review.value });
    }
    next.roles = roles;
  }

  if (u.newRoles !== undefined) {
    if (!Array.isArray(u.newRoles)) return { ok: false, field: "newRoles", error: "New roles arrive as a list." };
    const kept = new Map(current.newRoles.map((r) => [r.id, r]));
    const roles: NewRole[] = [];
    for (let i = 0; i < u.newRoles.length; i += 1) {
      const at = `newRoles.${i}`;
      const item = u.newRoles[i];
      if (!isObject(item)) return { ok: false, field: at, error: "A new role is its circle and its words." };
      // An id the draft gave earlier is kept, so the role keeps its name in links; anything else gets a fresh one.
      const sent = typeof item.id === "string" ? item.id.trim() : "";
      if (sent && !kept.has(sent)) return { ok: false, field: `${at}.id`, error: "That new role is not in this draft. Leave the id out to add one." };
      const id = sent || ctx.newRoleId();
      if (roles.some((r) => r.id === id)) return { ok: false, field: `${at}.id`, error: "Each new role appears once." };
      const circleId = typeof item.circleId === "string" ? item.circleId.trim() : "";
      if (!circleId || !ctx.circles.has(circleId)) return { ok: false, field: `${at}.circleId`, error: PROPOSAL_WORDS.newRoleCircle };
      const seats = item.seats === undefined || item.seats === null ? 1 : Number(item.seats);
      if (!Number.isInteger(seats) || seats < 1 || seats > 50) return { ok: false, field: `${at}.seats`, error: "A role holds between 1 and 50 people." };
      const words = parseRoleWords(item.words, `${at}.words`, ctx.words, null);
      if (!words.ok) return words;
      const name = words.value.name;
      if (typeof name !== "string" || !name.trim()) return { ok: false, field: `${at}.words.name`, error: PROPOSAL_WORDS.newRoleName };
      const review = reviewDay(item.reviewOn, `${at}.reviewOn`);
      if (!review.ok) return review;
      roles.push({ id, circleId, seats, words: words.value, reviewOn: review.value });
    }
    next.newRoles = roles;
  }

  if (next.roles.length + next.newRoles.length > MAX_PROPOSAL_ROLES) {
    return { ok: false, field: u.newRoles !== undefined ? "newRoles" : "roles", error: PROPOSAL_WORDS.tooManyRoles };
  }

  if (u.settings !== undefined) {
    const parsed = parseSeatSettings(u.settings);
    if (!parsed.ok || !parsed.settings) return { ok: false, field: "settings", error: parsed.problems[0]?.message ?? "These terms could not be read." };
    next.settings = parsed.settings;
  }

  if (u.season !== undefined) {
    if (!isObject(u.season)) return { ok: false, field: "season", error: "Your season arrives as its aim and goals." };
    const s = u.season;
    if (s.aim !== undefined) {
      if (s.aim !== null && typeof s.aim !== "string") return { ok: false, field: "season.aim", error: "Your aim needs to be words." };
      const aim = typeof s.aim === "string" ? s.aim.trim() || null : null;
      if (aim && aim.length > AIM_MAX) return { ok: false, field: "season.aim", error: `Keep your aim to ${AIM_MAX} characters.` };
      if (aim && looksLikePaymentDetails(aim)) return { ok: false, field: "season.aim", error: PROPOSAL_WORDS.paymentInWords };
      next.season.aim = aim;
    }
    if (s.seasonalGoals !== undefined) {
      const g = parseSeasonalGoals(s.seasonalGoals);
      if (!g.ok) return { ok: false, field: `season.${g.field}`, error: g.error };
      next.season.seasonalGoals = g.value ?? [];
    }
    if (s.servesGoals !== undefined) {
      const g = parseServesGoals(s.servesGoals, ctx.orgGoals);
      if (!g.ok) return { ok: false, field: `season.${g.field}`, error: g.error };
      next.season.servesGoals = g.value ?? [];
    }
  }
  return { ok: true, value: next };
}

/** Why a draft cannot be submitted yet, or null. PURE. */
export function submitRefusal(body: ProposalBody, hasTarget: boolean): string | null {
  if (!hasTarget) return PROPOSAL_WORDS.noTargetSubmit;
  if (body.roles.length + body.newRoles.length === 0) return PROPOSAL_WORDS.noRoles;
  if (body.roles.length + body.newRoles.length > MAX_PROPOSAL_ROLES) return PROPOSAL_WORDS.tooManyRoles;
  if (!body.season.aim) return PROPOSAL_WORDS.noAim;
  if (body.season.seasonalGoals.length === 0) return PROPOSAL_WORDS.noSeasonalGoal;
  return null;
}

/**
 * The application's own words from the member's season. PURE.
 *
 * `note` is the aim, and `deliverables` is the seasonal goals, each with when
 * it is done: what will be true at the season's end, which is the question an
 * application's deliverables answer.
 */
export function applicationWordsOf(season: SeasonWords): { note: string | null; deliverables: string | null } {
  const lines = season.seasonalGoals.map((g) => (g.doneWhen ? `${g.title}: ${g.doneWhen}` : g.title));
  return { note: season.aim, deliverables: lines.length ? lines.join("\n").slice(0, 2000) : null };
}

// ── Comments ────────────────────────────────────────────────────────────────

/** A comment, trimmed, or the reason it cannot be kept. PURE. */
export function parseComment(v: unknown): Parsed<string> {
  if (typeof v !== "string" || !v.trim()) return { ok: false, field: "text", error: "Write your feedback first." };
  const s = v.trim();
  if (s.length > COMMENT_MAX) return { ok: false, field: "text", error: `Keep your feedback to ${COMMENT_MAX} characters.` };
  if (looksLikePaymentDetails(s)) return { ok: false, field: "text", error: PROPOSAL_WORDS.paymentInComment };
  return { ok: true, value: s };
}

export function isShareAudience(v: unknown): v is ShareAudience {
  return typeof v === "string" && (SHARE_AUDIENCES as readonly string[]).includes(v);
}

// ── The words ───────────────────────────────────────────────────────────────

export const PROPOSAL_WORDS = {
  /** Rye's words for a village whose next season has no dates yet. */
  noTarget: "Next season's dates aren't set yet",
  noTargetSubmit: "Next season's dates aren't set yet. Submit once they are.",
  targetEnded: "The season this draft is for has already ended. Start a new draft for the next one.",
  noRoles: "Pick at least one role, one the village has or a new one.",
  tooManyRoles: `One proposal holds at most ${MAX_PROPOSAL_ROLES} roles. Propose the rest in a second one.`,
  noAim: "Write your aim for the season, then submit.",
  noSeasonalGoal: "Write at least one seasonal goal, then submit.",
  noSuchRole: "There is no role by that id that the village fills right now.",
  newRoleName: "Give the new role a name.",
  newRoleCircle: "A new role sits in a circle. Pick the circle it belongs to.",
  unknownField: "Roles in this village have no field by that name.",
  notAWord: "That is part of how the role is set up, so a proposal does not change it.",
  paymentInWords: "This looks like a bank or card number. Payment details are never stored in a proposal.",
  paymentInComment: "This looks like a bank or card number. Payment details are never stored in feedback.",
  notYours: "There is no proposal by that id.",
  notDraft: "This proposal is submitted, so it can no longer be changed. Its application page says where it stands.",
  draftExists: "You already have a draft for next season. Open it, or delete it to start again.",
  linkOff: "This link is no longer shared.",
  membersOnly: "Sign in as a member of the village to read this proposal.",
  commentMembersOnly: "Only members of the village can leave feedback.",
  /** The candidate's notice that a member left feedback. */
  commentNoticeTitle: "A member left feedback on your role proposal",
  anyoneNeedsPublicGovernance: "Anyone with the link can read it once the village shows its governance to the public.",
} as const;
