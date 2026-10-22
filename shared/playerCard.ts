/**
 * THE PLAYER CARD'S VIEW MODEL: one person-level card that every player gets,
 * on their profile and on their role application.
 *
 * Reference design: https://claude.ai/artifact/49Fh3tdkSoNYTmNDFv24D1
 * (version 12). Its order is this file's order: the header; one tile per
 * role; what runs across every role; each role in full, title first and its
 * purpose straight after; the moon timeline; how I hold my roles; my
 * applications; my agreements, with pay small at the bottom.
 *
 * Pure and node-tested (`playerCard.test.ts`), the same pattern as
 * `shared/roleSheet.ts`, whose rules it keeps:
 *
 *   1. UNREAD IS ABSENT, NEVER 0. Every input that a host may not have read
 *      is a `Read<T>`: `undefined` is "not read" and comes out as a slot of
 *      kind "unread", which draws nothing. `null` or an empty list is "read,
 *      and empty", and comes out with its own empty-state words.
 *   2. EVERY NUMBER CARRIES ITS SOURCE, as a `Figure`, so a test can trace it.
 *   3. A ROLE IS NAMED BY ITS FULL TITLE, `org_roles.name` verbatim, on its
 *      tile and its heading, and wherever another role refers to it. No
 *      short form and no letter label.
 *   4. NO PERSON IS NAMED. The only person on the card is its owner, by
 *      display name, in the header. A holder, a raiser or a candidate is
 *      never copied from any input into the card.
 *   5. LOAD IS FACTS: counts, never an adjective.
 *   6. MOONS ARE DATED, NEVER NAMED (the CycleClock ruling).
 *   7. PAY IS WORDS. No figure is ever typed on the card.
 *
 * An archetype chip row appears only when the role's own `archetypes` list
 * names a class the village has named (from /api/archetypes). Tags the seed
 * only suggested are left out, the seed's built-in class names are never
 * read, and the owner's own profile classes never appear. With no tag there
 * is no row and no "Plays as" label, which is the reference design's case.
 */
import { LUNAR_CLOCK } from "./cycleClock";
import { civilDaysBetween, fullMoonsBetween, zonedTimeToUtc } from "./lunar";
import { CARD_WORDS as W, ALLOWANCE_WORDS, APPLICATION_STATUS_WORDS, PAY_WORDS, PER_WORDS } from "./playerCardWords";
import { formatDay, joinList, type Read } from "./roleSheet";
import { cycleWindows, readSign, type SignReading, type SignRows } from "./roleSigns";
import { roleHandover, roleHealth, type HandoverOut, type HealthOut } from "./playerCardHealth";
import type { RoleEditKey } from "./playerCardEdit";
import { APPLICATION_STATUSES, OPEN_STATUSES, applicationHref, type ApplicationStatus } from "./seatApplications";
import { MONEY_LINE, type SeatSettings } from "./seatSettings";

export * from "./playerCardWords";
export type { Read } from "./roleSheet";

// ── Shared output shapes ────────────────────────────────────────────────────

/** A number, and the input field it was read from. */
export interface Figure {
  n: number;
  source: string;
}

/** unread draws nothing; empty draws its words; shown draws the value. */
export type Slot<T> = { kind: "unread" } | { kind: "empty"; words: string } | { kind: "shown"; value: T };

const UNREAD = { kind: "unread" } as const;
const empty = (words: string) => ({ kind: "empty", words }) as const;
const shown = <T>(value: T): Slot<T> => ({ kind: "shown", value });

const clean = (v: string | null | undefined): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const cleanList = (v: readonly (string | null | undefined)[]): string[] =>
  v.map(clean).filter((s): s is string => s !== null);

/** A read list of words: unread, empty with its words, or the clean list. */
function wordsSlot(v: Read<readonly (string | null)[] | null>, emptyWords: string): Slot<string[]> {
  if (v === undefined) return UNREAD;
  const list = v ? cleanList(v) : [];
  return list.length ? shown(list) : empty(emptyWords);
}
function textSlot(v: Read<string | null>, emptyWords: string): Slot<string> {
  if (v === undefined) return UNREAD;
  const t = clean(v);
  return t ? shown(t) : empty(emptyWords);
}

// ── Inputs ──────────────────────────────────────────────────────────────────

export interface RoleRef {
  /** `org_roles.id`. */
  roleId: string;
  /** `org_roles.name`, verbatim. */
  roleName: string;
}

/** Another role this one works closely with, and what for. */
export interface WorksWithIn extends RoleRef {
  about: string | null;
}

export interface PowerIn {
  key: string;
  /** The power's own name, from the capability catalog. */
  label: string;
  /** The other roles that hold it too, by full title. */
  sharedWith?: string[];
}

/**
 * A tension raised to the role. While it is open only the holder and the
 * raiser may read its words; once answered the card shows a count only, and
 * the words go public only when the holder brought it to the circle.
 */
export interface TensionIn {
  id: string;
  status: "open" | "answered";
  /** The raiser's user id. Read to decide who may see it, never printed. */
  raisedBy: string;
  text: string;
  broughtToCircle?: boolean;
}

export interface PlayerRoleIn {
  /** `org_roles.id`. */
  id: string;
  /** `org_roles.name`, printed verbatim. */
  name: string;
  /** `org_roles.aim`. */
  aim: string | null;
  /** `org_roles.why_it_matters`. */
  whyItMatters: string | null;
  /** `org_roles.domain`. */
  domain: string | null;
  /** `org_roles.accountabilities`. */
  accountabilities: string[];
  /** `org_roles.criticality`. */
  criticality: Read<"normal" | "high">;
  circle: Read<{ id: string; name: string } | null>;
  /** This holding's `term_ends_at`. */
  termEndsAt: Read<string | null>;
  /** `org_roles.archetypes`. */
  archetypes: Read<string[] | null>;
  /** `org_roles.archetypes_suggested`: the seed guessed these tags. */
  archetypesSuggested: Read<boolean>;
  /** Role fields that do not exist yet (Rye, 2026-10-21): unread until they do. */
  bringMe: Read<string[] | null>;
  notMine: Read<string[] | null>;
  runbook: Read<string | null>;
  worksWith: Read<WorksWithIn[]>;
  powers: Read<PowerIn[]>;
  tensions: Read<TensionIn[]>;
  /** The role's terms (`shared/seatSettings.ts`); null when none were written. */
  settings: Read<SeatSettings | null>;
  /**
   * Invoice dates the role's settings set. The settings carry none today, so
   * a host passes nothing and no invoice marker is drawn.
   */
  invoiceOn?: string[];
  /** Live holders of the role, the owner included (`holderCount` on `/api/org`). */
  holderCount?: Read<number>;
  /** A deputy or successor relation covers the role (`coveredSeatIds`). */
  covered?: Read<boolean>;
  /** Decisions recorded in the role's circle over the last three moons. */
  circleDecisions?: Read<number>;
  /** Role words an open org draft would change: "Proposed, waiting for consent". */
  pendingWords?: Read<RoleEditKey[]>;
}

export interface TaskIn {
  id: string;
  title: string;
  /** The role it is for, `org_roles.id`. */
  roleId: string | null;
  status: "open" | "done";
  doneWhen?: string | null;
}

/** One of a player's 1 to 3 bigger goals for the whole season. */
export interface SeasonalGoalIn {
  title: string;
  doneWhen: string | null;
  /** A civil date the goal is due, when one is set. */
  doneBy?: string | null;
}

/** The most seasonal goals a season holds. */
export const SEASONAL_GOALS_MAX = 3;

export interface GoalIn {
  goal: string;
  howItHelps: string | null;
}

/** A `seat_applications` row, as stored. */
export interface ApplicationIn {
  id: string;
  candidate_user_id: string;
  seat_ids: string[];
  status: string;
  created_at: string;
  decided_at: string | null;
  term_season_id: string | null;
  starts_at: string | null;
  term_ends_at: string | null;
}

export interface PlayerCardInput {
  now: Date;
  /** The village's IANA zone. */
  timeZone: string;
  /** The card's owner. The only person the card names. */
  owner: { userId: string; displayName: string; avatar: string | null };
  /** Who is looking, for the tensions only. */
  viewerUserId: Read<string | null>;
  /** The village's own name, from the brand overlay. */
  villageName: Read<string | null>;
  season: Read<{ id: string; name: string | null; startsOn: string | null; endsOn: string | null } | null>;
  nextSeasonId: Read<string | null>;
  /** The village's class names from /api/archetypes, keyed by class key. */
  archetypeNames: Read<Record<string, string> | null>;
  roles: Read<PlayerRoleIn[]>;
  /** The owner's filed season plan; null when none is filed. */
  plan: Read<{ aim: string | null; goals: GoalIn[] } | null>;
  /**
   * The owner's seasonal goals, 0 to 3. Input only for now: their storage
   * arrives with the season plan migration (PR 6, `seasonal_goals_json`
   * beside `serves_goals_json` and `card_words_json`).
   */
  seasonalGoals: Read<SeasonalGoalIn[] | null>;
  /** This moon's tasks. Never capped. */
  tasks: Read<TaskIn[]>;
  /** Rows for the sign counters. Unread tables read "Not counted yet". */
  signRows: Read<SignRows>;
  howIHold: Read<{ label: string; text: string }[] | null>;
  applications: Read<ApplicationIn[]>;
  /** `org_roles.id` to `org_roles.name`, for any role an application names. */
  roleNames: Read<Record<string, string>>;
  /** The equity token's name, for the bonus words. */
  bonusTokenName: Read<string | null>;
  /**
   * The owner's own read of this moon's load, 1 (Healthy) to 5 (Heavy).
   * Self-reported, never computed. Null is "Not set this moon"; its storage
   * arrives with the season plan migration (PR 6).
   */
  loadRead?: Read<LoadStep | null>;
  growingEdge?: Read<string | null>;
  whoCouldHoldNext?: Read<string | null>;
  /**
   * Reads one sign. A host passes a memoised reader so a sign is counted once
   * per cycle for the whole village, never once per role. Without one the
   * model reads `signRows` itself.
   */
  signReader?: (key: string | null, circleId: string | null) => SignReading;
}

/** The five steps of the owner's own load read. */
export const LOAD_STEPS = [1, 2, 3, 4, 5] as const;
export type LoadStep = (typeof LOAD_STEPS)[number];

// ── Output ──────────────────────────────────────────────────────────────────

export type PortraitOut = { kind: "photo"; src: string } | { kind: "sigil"; letter: string };

export interface HeaderOut {
  portrait: PortraitOut;
  /** The owner's display name: the one person the card names. */
  name: string;
  rolesLine: string;
  day: Slot<{ words: string; day: Figure; of: Figure }>;
}

export interface TileOut {
  roleId: string;
  title: string;
  /** The role's section on this card. */
  anchor: string;
  /** Three facts and a dot, never a score. Null when nothing could be read. */
  health: HealthOut | null;
}

export interface SignOut {
  roleId: string;
  roleTitle: string;
  measure: string;
  /** "5 of 6", "12", or "Not counted yet". */
  value: string;
  from: string | null;
  reading: SignReading;
  target: Figure | null;
  /** Which sheet of rows stands behind this sign: its key, and the circle for a circle sign. */
  sheetKey: string | null;
}

export interface AcrossOut {
  heading: string;
  doors: { label: string; href: string }[];
  aim: Slot<string>;
  seasonalGoals: { heading: string; lede: string; items: Slot<{ title: string; doneWhen: string | null }[]> };
  goals: Slot<{ goal: string; howItHelps: string }[]>;
  tasks: Slot<{ id: string; title: string; roleTitle: string | null; state: string; doneWhen: string | null }[]>;
  signs: Slot<SignOut[]>;
  load: {
    heading: string;
    words: string;
    roles: Figure;
    openTasks: Figure | null;
    /** The owner's own read, self-reported. */
    own: Slot<{ step: LoadStep; words: string }>;
    caption: string;
  };
  growingEdge: { heading: string; text: Slot<string> };
  whoCouldHoldNext: { heading: string; text: Slot<string> };
}

export interface RoleOut {
  id: string;
  anchor: string;
  title: string;
  purpose: { heading: string; text: Slot<string>; why: string | null; source: string };
  chips: string[];
  plays: { label: string; chips: { key: string; name: string }[] } | null;
  decide: { heading: string; text: Slot<string> };
  bringMe: { heading: string; items: Slot<string[]> };
  countOnMe: { heading: string; items: Slot<string[]> };
  working: { heading: string; items: Slot<SignOut[]> };
  worksWith: { heading: string; items: Slot<string[]> };
  notMine: { heading: string; items: Slot<string[]> };
  runbook: { heading: string; text: Slot<string> };
  powers: { heading: string; items: Slot<string[]> };
  tensions: Slot<{ heading: string; open: string[]; answered: Figure; public: string[] }>;
  handover: HandoverOut;
  /** Role words a proposed change is waiting on consent for. */
  pending: RoleEditKey[];
}

export type MarkerKind = "new-moon" | "full-moon" | "review" | "renewal" | "ends" | "invoice";

export interface MarkerOut {
  kind: MarkerKind;
  at: string;
  day: string;
  words: string;
}

export interface MoonOut {
  label: string;
  /** "Getting started" for the days before the season's first new moon. */
  title: string | null;
  startsAt: string;
  endsAt: string;
  now: boolean;
  markers: MarkerOut[];
}

export interface TimelineOut {
  heading: string;
  lede: string;
  moons: MoonOut[];
  rhythm: string[];
}

export interface ApplicationOut {
  id: string;
  href: string;
  title: string;
  status: string;
  filed: string | null;
  starts: string | null;
}

export interface ApplicationsOut {
  heading: string;
  past: Slot<ApplicationOut[]>;
  thisSeason: Slot<ApplicationOut[]>;
  nextSeason: Slot<ApplicationOut[]>;
}

export interface AgreementRow {
  label: string;
  lines: string[];
  /** Money rows print small, last. */
  small: boolean;
}

export interface AgreementsOut {
  heading: string;
  roles: { roleId: string; title: string; rows: Slot<AgreementRow[]> }[];
}

export interface PlayerCard {
  header: HeaderOut;
  tiles: { heading: string; items: Slot<TileOut[]> };
  across: AcrossOut;
  roles: RoleOut[];
  timeline: TimelineOut;
  howIHold: { heading: string; items: Slot<{ label: string; text: string }[]> };
  applications: ApplicationsOut;
  agreements: AgreementsOut;
}

// ── Pieces ──────────────────────────────────────────────────────────────────

export const ROLE_ANCHOR = (id: string) => `role-${id}`;
export const APPLY_HREF = "/roles";
export const PLAN_HREF = "/season-plans/mine";

/** A civil date ("2026-12-31") or an instant, as the instant it names in the zone. */
function instantOf(iso: string | null | undefined, timeZone: string): Date | null {
  const s = clean(iso);
  if (!s) return null;
  const civil = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (civil) return zonedTimeToUtc(Number(civil[1]), Number(civil[2]), Number(civil[3]), 0, 0, timeZone);
  const t = new Date(s);
  return Number.isNaN(t.getTime()) ? null : t;
}

function portraitOf(owner: PlayerCardInput["owner"]): PortraitOut {
  const src = clean(owner.avatar);
  if (src) return { kind: "photo", src };
  return { kind: "sigil", letter: (Array.from(owner.displayName.trim())[0] ?? "").toUpperCase() };
}

function header(input: PlayerCardInput, roles: PlayerRoleIn[] | undefined): HeaderOut {
  const rolesLine =
    roles === undefined
      ? ""
      : roles.length === 0
        ? W.holdsNoRoles
        : W.rolesLine(roles.length, joinList(roles.map((r) => r.name)));
  let day: HeaderOut["day"] = UNREAD;
  if (input.season === null) day = empty(W.seasonNotRead);
  else if (input.season) {
    const start = instantOf(input.season.startsOn, input.timeZone);
    const end = instantOf(input.season.endsOn, input.timeZone);
    if (!start || !end) day = empty(W.seasonNotRead);
    else {
      const of = civilDaysBetween(start, end, input.timeZone) + 1;
      const d = Math.min(of, Math.max(1, civilDaysBetween(start, input.now, input.timeZone) + 1));
      day = shown({
        words: W.dayOfSeason(d, of),
        day: { n: d, source: "season.startsOn" },
        of: { n: of, source: "season.startsOn, season.endsOn" },
      });
    }
  }
  return { portrait: portraitOf(input.owner), name: input.owner.displayName, rolesLine, day };
}

/** The class chips a role's own tags earn, named by the village. */
function playsAs(role: PlayerRoleIn, names: Read<Record<string, string> | null>): RoleOut["plays"] {
  if (role.archetypesSuggested === true) return null;
  if (!names || !role.archetypes?.length) return null;
  const chips = role.archetypes.flatMap((key) => {
    const name = Object.prototype.hasOwnProperty.call(names, key) ? clean(names[key]) : null;
    return name ? [{ key, name }] : [];
  });
  return chips.length ? { label: W.playsAs, chips } : null;
}

function signsFor(role: PlayerRoleIn, input: PlayerCardInput): Slot<SignOut[]> {
  if (role.settings === undefined) return UNREAD;
  const measures = role.settings?.scoreboard?.measures ?? [];
  if (!measures.length) return empty(W.noSigns);
  const windows = cycleWindows(input.now, LUNAR_CLOCK, input.timeZone);
  const rows: SignRows = input.signRows
    ? { ...input.signRows, ...(role.circle ? { circle_id: role.circle.id } : {}) }
    : {};
  return shown(
    measures.map((m) => {
      const circleId = role.circle ? role.circle.id : null;
      const reading = input.signReader
        ? input.signReader(m.countedBy ?? null, circleId)
        : readSign(m.countedBy ?? null, rows, windows);
      const value =
        reading.kind === "counted"
          ? reading.now.of === undefined
            ? String(reading.now.n)
            : W.nOf(reading.now.n, reading.now.of)
          : W.notCountedYet;
      return {
        roleId: role.id,
        roleTitle: role.name,
        measure: m.measure,
        value,
        from: reading.kind === "counted" ? W.signFrom(reading.countedFrom, role.name) : null,
        reading,
        target:
          reading.kind === "counted" && m.targetCount !== undefined
            ? { n: m.targetCount, source: "settings.scoreboard.measures.targetCount" }
            : null,
        sheetKey: reading.kind === "counted" ? signSheetKey(reading.key, circleId) : null,
      };
    }),
  );
}

/** The key a sign's sheet of rows is filed under: a circle sign is per circle. */
export function signSheetKey(key: string, circleId: string | null): string {
  return key === "circle-met" && circleId ? `${key}:${circleId}` : key;
}

function tensionsFor(role: PlayerRoleIn, input: PlayerCardInput): RoleOut["tensions"] {
  if (role.tensions === undefined) return UNREAD;
  const viewer = input.viewerUserId ?? null;
  const isHolder = viewer !== null && viewer === input.owner.userId;
  const open = role.tensions
    .filter((t) => t.status === "open" && viewer !== null && (isHolder || t.raisedBy === viewer))
    .map((t) => clean(t.text))
    .filter((s): s is string => s !== null);
  const answered = role.tensions.filter((t) => t.status === "answered");
  const pub = answered
    .filter((t) => t.broughtToCircle === true)
    .map((t) => clean(t.text))
    .filter((s): s is string => s !== null);
  if (!open.length && !answered.length) return empty(W.noTensions);
  return shown({
    heading: W.tensions,
    open,
    answered: { n: answered.length, source: "tensions.status" },
    public: pub,
  });
}

function roleOut(role: PlayerRoleIn, input: PlayerCardInput): RoleOut {
  const chips: string[] = [];
  if (role.criticality === "high") chips.push(W.keyRole);
  if (role.circle) chips.push(role.circle.name);
  const held = formatDay(role.termEndsAt ?? null, true, input.timeZone);
  if (held) chips.push(W.heldUntil(held));

  const powers =
    role.powers === undefined
      ? UNREAD
      : role.powers.length
        ? shown(
            role.powers.map((p) =>
              p.sharedWith?.length ? W.sharedWith(p.label, joinList(cleanList(p.sharedWith))) : p.label,
            ),
          )
        : empty(W.noPowers);
  const anyShared = !!role.powers?.some((p) => p.sharedWith?.length);

  return {
    id: role.id,
    anchor: ROLE_ANCHOR(role.id),
    title: role.name,
    purpose: {
      heading: W.purpose,
      text: textSlot(clean(role.aim) ?? role.whyItMatters, W.noPurpose),
      why: clean(role.aim) ? clean(role.whyItMatters) : null,
      source: "org_roles.aim, org_roles.why_it_matters",
    },
    chips,
    plays: playsAs(role, input.archetypeNames),
    decide: { heading: W.decide, text: textSlot(role.domain, W.notWritten) },
    bringMe: { heading: W.bringMe, items: wordsSlot(role.bringMe, W.notWritten) },
    countOnMe: { heading: W.countOnMe, items: wordsSlot(role.accountabilities, W.notWritten) },
    working: { heading: W.working, items: signsFor(role, input) },
    worksWith: {
      heading: W.worksWith,
      items:
        role.worksWith === undefined
          ? UNREAD
          : role.worksWith.length
            ? shown(role.worksWith.map((w) => (clean(w.about) ? W.worksWithLine(w.roleName, clean(w.about)!) : w.roleName)))
            : empty(W.notWritten),
    },
    notMine: { heading: W.notMine, items: wordsSlot(role.notMine, W.notWritten) },
    runbook: { heading: W.runbook, text: textSlot(role.runbook, W.notWritten) },
    powers: { heading: anyShared ? W.powersShared : W.powers, items: powers },
    tensions: tensionsFor(role, input),
    handover: roleHandover(role),
    pending: role.pendingWords ?? [],
  };
}

function across(input: PlayerCardInput, roles: PlayerRoleIn[] | undefined, roleOuts: RoleOut[]): AcrossOut {
  const n = roles?.length ?? 0;
  const heading = roles === undefined ? "" : n === 0 ? W.holdsNoRoles : n === 1 ? W.acrossOne : W.acrossMany(n);
  const doors =
    roles !== undefined && n === 0
      ? [
          { label: W.applyDoor, href: APPLY_HREF },
          { label: W.planDoor, href: PLAN_HREF },
        ]
      : [];

  const plan = input.plan;
  const aim: Slot<string> = plan === undefined ? UNREAD : plan === null ? empty(W.noPlan) : textSlot(plan.aim, W.noAim);
  const sg = input.seasonalGoals;
  const sgList = (sg ?? [])
    .filter((g) => clean(g.title))
    .slice(0, SEASONAL_GOALS_MAX)
    .map((g) => {
      const when = clean(g.doneWhen);
      const by = formatDay(g.doneBy ?? null, false, input.timeZone);
      return { title: clean(g.title)!, doneWhen: when ? (by ? W.goalDoneBy(by, when) : W.doneWhen(when)) : null };
    });
  const seasonalGoals: AcrossOut["seasonalGoals"] = {
    heading: W.seasonalGoals(sgList.length),
    lede: W.seasonalGoalsLede,
    items: sg === undefined ? UNREAD : sgList.length ? shown(sgList) : empty(W.noSeasonalGoals),
  };
  const goals: AcrossOut["goals"] =
    plan === undefined
      ? UNREAD
      : !plan || !plan.goals.length
        ? empty(W.noGoals)
        : shown(
            plan.goals
              .filter((g) => clean(g.goal))
              .map((g) => ({ goal: clean(g.goal)!, howItHelps: clean(g.howItHelps) ?? W.howItHelpsMissing })),
          );

  const titleOf = new Map((roles ?? []).map((r) => [r.id, r.name]));
  const tasks: AcrossOut["tasks"] =
    input.tasks === undefined
      ? UNREAD
      : input.tasks.length === 0
        ? empty(W.noTasks)
        : shown(
            input.tasks.map((t) => ({
              id: t.id,
              title: t.title,
              roleTitle: t.roleId ? titleOf.get(t.roleId) ?? null : null,
              state: t.status === "done" ? W.taskDone : W.taskOpen,
              doneWhen: clean(t.doneWhen) ? W.doneWhen(clean(t.doneWhen)!) : null,
            })),
          );

  const signLists = roleOuts.map((r) => r.working.items);
  const allSigns = signLists.flatMap((s) => (s.kind === "shown" ? s.value : []));
  const signs: AcrossOut["signs"] =
    roles === undefined || (signLists.length > 0 && signLists.every((s) => s.kind === "unread"))
      ? UNREAD
      : allSigns.length
        ? shown(allSigns)
        : empty(W.noSigns);

  const rolesFig: Figure = { n, source: "roles.length" };
  const openTasks: Figure | null =
    input.tasks === undefined ? null : { n: input.tasks.filter((t) => t.status === "open").length, source: "tasks.status" };
  const words = [W.loadRoles(n), ...(openTasks ? [W.loadTasks(openTasks.n)] : [])].join(" · ");
  const lr = input.loadRead;
  const own: AcrossOut["load"]["own"] =
    lr === undefined ? UNREAD : lr === null ? empty(W.loadNotSet) : shown({ step: lr, words: W.loadStep[lr] });
  return {
    heading,
    doors,
    aim,
    seasonalGoals,
    goals,
    tasks,
    signs,
    load: { heading: W.load, words, roles: rolesFig, openTasks, own, caption: W.loadCaption },
    growingEdge: { heading: W.growingEdge, text: input.growingEdge === undefined ? UNREAD : textSlot(input.growingEdge, W.notWritten) },
    whoCouldHoldNext: {
      heading: W.whoCouldHoldNext,
      text: input.whoCouldHoldNext === undefined ? UNREAD : textSlot(input.whoCouldHoldNext, W.notWritten),
    },
  };
}

// ── The timeline ───────────────────────────────────────────────────────────

function timeline(input: PlayerCardInput, roles: PlayerRoleIn[]): TimelineOut {
  const tz = input.timeZone;
  const seasonStart = input.season ? instantOf(input.season.startsOn, tz) : null;
  const seasonEnd = input.season ? instantOf(input.season.endsOn, tz) : null;
  const from = seasonStart ?? LUNAR_CLOCK.boundsFor(input.now).startsAt;
  const to = seasonEnd ?? LUNAR_CLOCK.boundsFor(new Date(LUNAR_CLOCK.boundsFor(input.now).endsAt.getTime() + 1)).endsAt;

  // Moon spans: [from, first new moon) is "Getting started" when the season
  // opens between new moons; then one span per moon until the season ends.
  const spans: { start: Date; end: Date; title: string | null }[] = [];
  const first = LUNAR_CLOCK.boundsFor(from);
  let cursor = first.startsAt.getTime() === from.getTime() ? first.startsAt : first.endsAt;
  if (cursor.getTime() > from.getTime()) spans.push({ start: from, end: cursor, title: W.gettingStarted });
  let guard = 0;
  while (cursor.getTime() <= to.getTime() && guard++ < 24) {
    const b = LUNAR_CLOCK.boundsFor(cursor);
    spans.push({ start: b.startsAt, end: b.endsAt, title: null });
    cursor = b.endsAt;
  }

  const anyEquity = roles.some((r) => r.settings?.bonus?.kind === "equity");
  const markers: (MarkerOut & { t: number })[] = [];
  const mark = (kind: MarkerKind, at: Date | null, words: string) => {
    if (!at) return;
    const t = at.getTime();
    if (t < from.getTime() || t > to.getTime()) return;
    markers.push({ kind, at: at.toISOString(), day: formatDay(at.toISOString(), false, tz) ?? "", words, t });
  };
  spans.forEach((s, i) => {
    if (s.title !== null) return;
    const firstMoon = i === 0 || spans[i - 1].title !== null;
    const words = [W.newMoon, W.tasksAgreed, ...(anyEquity && !firstMoon ? [W.signedOff] : [])].join(". ");
    mark("new-moon", s.start, words);
  });
  for (const f of fullMoonsBetween(from, to)) mark("full-moon", f, W.fullMoon);
  const rhythm: string[] = [];
  for (const r of roles) {
    const term = r.settings?.term;
    mark("review", instantOf(term?.reviewOn, tz), W.reviewOn(r.name));
    mark("renewal", instantOf(term?.renewalOn, tz), W.renewalOn(r.name));
    mark("ends", instantOf(term?.endsOn ?? r.termEndsAt ?? null, tz), W.termEnds(r.name));
    for (const d of r.invoiceOn ?? []) mark("invoice", instantOf(d, tz), W.invoice(r.name));
    for (const g of r.settings?.rhythm?.gatherings ?? []) {
      rhythm.push(W.gathering(g.label, g.weekday, g.time, g.every === "fortnight", r.name));
    }
  }
  markers.sort((a, b) => a.t - b.t);

  const nowMs = input.now.getTime();
  const moons: MoonOut[] = spans.map((s) => {
    const lastDay = new Date(s.end.getTime() - 1);
    return {
      label: W.moonDates(formatDay(s.start.toISOString(), false, tz) ?? "", formatDay(lastDay.toISOString(), false, tz) ?? ""),
      title: s.title,
      startsAt: s.start.toISOString(),
      endsAt: s.end.toISOString(),
      now: nowMs >= s.start.getTime() && nowMs < s.end.getTime(),
      markers: markers
        .filter((m) => m.t >= s.start.getTime() && m.t < s.end.getTime())
        .map(({ t: _t, ...m }) => m),
    };
  });
  return { heading: W.timeline, lede: W.timelineLede, moons, rhythm };
}

// ── Applications ───────────────────────────────────────────────────────────

const isStatus = (s: string): s is ApplicationStatus => (APPLICATION_STATUSES as readonly string[]).includes(s);

function applications(input: PlayerCardInput): ApplicationsOut {
  const heading = W.applications;
  if (input.applications === undefined) return { heading, past: UNREAD, thisSeason: UNREAD, nextSeason: UNREAD };
  const names = input.roleNames ?? {};
  const seasonId = input.season?.id ?? null;
  const seasonEnd = input.season ? instantOf(input.season.endsOn, input.timeZone) : null;
  const next = input.nextSeasonId ?? null;
  const groups: Record<"past" | "thisSeason" | "nextSeason", ApplicationOut[]> = { past: [], thisSeason: [], nextSeason: [] };

  for (const a of input.applications) {
    if (a.candidate_user_id !== input.owner.userId) continue;
    const titles = a.seat_ids.map((id) => names[id]).filter((s): s is string => !!clean(s));
    const status = isStatus(a.status) ? APPLICATION_STATUS_WORDS[a.status] : "";
    const starts = instantOf(a.starts_at, input.timeZone);
    const pending = isStatus(a.status) && OPEN_STATUSES.includes(a.status);
    const out: ApplicationOut = {
      id: a.id,
      href: applicationHref(a.id),
      title: joinList(titles),
      status,
      filed: formatDay(a.created_at, true, input.timeZone) ? W.filedOn(formatDay(a.created_at, true, input.timeZone)!) : null,
      starts: pending ? W.startsOnceAdopted : null,
    };
    if (seasonId !== null && a.term_season_id === seasonId) groups.thisSeason.push(out);
    else if ((next !== null && a.term_season_id === next) || (starts && seasonEnd && starts.getTime() >= seasonEnd.getTime()))
      groups.nextSeason.push(out);
    else groups.past.push(out);
  }
  const slot = (list: ApplicationOut[], words: string): Slot<ApplicationOut[]> => (list.length ? shown(list) : empty(words));
  return {
    heading,
    past: slot(groups.past, W.noPast),
    thisSeason: slot(groups.thisSeason, W.noThisSeason),
    nextSeason: slot(groups.nextSeason, W.noNextSeason),
  };
}

// ── Agreements ─────────────────────────────────────────────────────────────

function agreementRows(s: SeatSettings, input: PlayerCardInput): AgreementRow[] {
  const tz = input.timeZone;
  const rows: AgreementRow[] = [];
  const day = (iso: string | null | undefined) => formatDay(iso ?? null, true, tz);

  const term: string[] = [];
  if (s.term) {
    if (s.term.endsOn) term.push(W.endsOn(day(s.term.endsOn) ?? s.term.endsOn));
    else if (s.term.lengthMoons) term.push(W.lengthMoons(s.term.lengthMoons));
    else if (s.term.endsOn === null) term.push(W.endsWithSeason);
    term.push(s.term.reviewOn ? W.reviewDate(day(s.term.reviewOn) ?? s.term.reviewOn) : W.noReviewDate);
    if (s.term.renewalOn) term.push(W.renewalDate(day(s.term.renewalOn) ?? s.term.renewalOn));
    if (s.term.noticeDays !== undefined) term.push(W.notice(s.term.noticeDays));
  } else term.push(W.noReviewDate);
  rows.push({ label: W.term, lines: term, small: false });

  const clocks: string[] = [];
  if (s.clocks?.pay) clocks.push(s.clocks.pay === "moon" ? W.payByMoon : W.payByMonth);
  if (s.clocks?.work) clocks.push(s.clocks.work === "week" ? W.workByWeek : W.workByMoon);
  if (s.quests && (s.quests.perMoonMin !== undefined || s.quests.perMoonMax !== undefined)) {
    clocks.push(W.tasksPerMoon(s.quests.perMoonMin ?? null, s.quests.perMoonMax ?? null));
  }
  if (clocks.length) rows.push({ label: W.clocks, lines: clocks, small: false });

  const rhythm = (s.rhythm?.gatherings ?? []).map((g) => `${g.label}, ${g.every === "fortnight" ? "every other week" : "every week"}`);
  if (rhythm.length) rows.push({ label: W.rhythm, lines: rhythm, small: false });

  if (s.ending && (s.ending.noticeDays !== undefined || s.ending.payThroughNotice)) {
    const ending: string[] = [];
    if (s.ending.noticeDays !== undefined) ending.push(W.notice(s.ending.noticeDays));
    if (s.ending.payThroughNotice) ending.push(W.payThroughNotice);
    rows.push({ label: W.ending, lines: ending, small: false });
  }

  // Money last and small. Words only: no figure is ever typed here.
  if (s.pay) {
    const per = s.pay.per ? ` ${PER_WORDS[s.pay.per]}` : "";
    rows.push({ label: W.pay, lines: [`${PAY_WORDS[s.pay.kind]}${s.pay.kind === "none" ? "" : per}`, MONEY_LINE], small: true });
  }
  if (s.allowance) {
    const per = s.allowance.per && s.allowance.kind === "flat" ? ` ${PER_WORDS[s.allowance.per]}` : "";
    rows.push({ label: W.allowance, lines: [`${ALLOWANCE_WORDS[s.allowance.kind]}${per}`, MONEY_LINE], small: true });
  }
  if (s.bonus && s.bonus.kind === "equity") {
    const village = clean(input.villageName ?? null);
    const token = clean(input.bonusTokenName ?? null);
    const lines = [village && token ? W.bonusEquity(village, token) : W.bonusEquityNoToken];
    if (clean(s.bonus.capWords)) lines.push(W.bonusCap(clean(s.bonus.capWords)!));
    if (clean(s.bonus.ratedBy)) lines.push(W.bonusRatedBy(clean(s.bonus.ratedBy)!));
    if (clean(s.bonus.cadence)) lines.push(W.bonusCadence(clean(s.bonus.cadence)!));
    rows.push({ label: W.bonus, lines, small: true });
  }
  return rows;
}

function agreements(input: PlayerCardInput, roles: PlayerRoleIn[]): AgreementsOut {
  return {
    heading: W.agreements,
    roles: roles.map((r) => ({
      roleId: r.id,
      title: r.name,
      rows: r.settings === undefined ? UNREAD : r.settings === null ? empty(W.noTerms) : shown(agreementRows(r.settings, input)),
    })),
  };
}

// ── The card ───────────────────────────────────────────────────────────────

export function buildPlayerCard(input: PlayerCardInput): PlayerCard {
  const roles = input.roles;
  const list = roles ?? [];
  const roleOuts = list.map((r) => roleOut(r, input));
  const tiles: PlayerCard["tiles"] = {
    heading: W.myRoles,
    items:
      roles === undefined
        ? UNREAD
        : list.length
          ? shown(
              list.map((r, i) => ({
                roleId: r.id,
                title: r.name,
                anchor: ROLE_ANCHOR(r.id),
                health: roleHealth(r, roleOuts[i].working.items, input.now, input.timeZone),
              })),
            )
          : empty(W.holdsNoRoles),
  };
  return {
    header: header(input, roles),
    tiles,
    across: across(input, roles, roleOuts),
    roles: roleOuts,
    timeline: timeline(input, list),
    howIHold: {
      heading: W.howIHold,
      items:
        input.howIHold === undefined
          ? UNREAD
          : input.howIHold && input.howIHold.some((h) => clean(h.text))
            ? shown(input.howIHold.filter((h) => clean(h.text)).map((h) => ({ label: h.label, text: clean(h.text)! })))
            : empty(W.notWritten),
    },
    applications: applications(input),
    agreements: agreements(input, list),
  };
}
