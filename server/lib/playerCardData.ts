/**
 * THE PLAYER CARD, BUILT FROM THE DATABASE FOR ANY NUMBER OF PEOPLE AT ONCE.
 *
 * `buildPlayerCards(pool, owners, ctx)` reads every table once
 * (server/repos/playerCard.ts), applies each reader's tier, and hands the rows
 * to the pure model (`buildPlayerCard`, shared/playerCard.ts). No read runs
 * once per role or once per person: `playerCardData.queries.test.ts` holds a
 * card with one role and a card with six to the same query count.
 *
 * ── ONE SEAT OBJECT, SO IT CANNOT DRIFT FROM /api/org ──────────────────────
 *
 * Every role goes through `projectSeat` (server/lib/seatProjection.ts) at the
 * tier `/api/org` would give this reader, and the card reads its fields off
 * that projection. A field the projection withholds from this reader is unread
 * on the card, never guessed. Holders are never copied: the only person on the
 * card is its owner.
 *
 * ── THE THREE TIERS ────────────────────────────────────────────────────────
 *
 *   stranger  public structure only: the roles' own words, the term date where
 *             the map shows structure to strangers, the holder count. No
 *             terms, no plans, no tasks, no tensions, no applications, no
 *             signs. Where the village keeps its people for members
 *             (`org.public_people` off), a stranger is not told which roles a
 *             person holds at all.
 *   member    (`terms.read`) also the terms, with pay small at the bottom, the
 *             season plan as filed, this moon's tasks, the applications and
 *             the signs, each with its sheet of rows, first names only; the
 *             owner's own words (card words, seasonal goals, this moon's load)
 *             and their accomplishments, kept to the tasks this reader may
 *             read as cards (`accomplishmentsOfMany`, the rule of
 *             `accomplishmentsOf`).
 *   self      also their newest plan
 *             even before it is filed, the role words waiting on consent, and a
 *             link to their wallet.
 *
 * ── TENSIONS: ONE READ FOR THE WHOLE BATCH (PR 9) ────────────────────────
 *
 * `tensionsForRoles` (server/lib/roleTensions.ts) is asked once, over every
 * role any live card in the batch carries, for this reader. It decides who
 * reads the words: the raiser and the role's holders while a tension is open,
 * every member once a holder brought it to the circle. Anywhere else the
 * words arrive blank and the card counts them ("1 open tension, private to
 * the role's holders"). A reader who is not a signed-in member gets an empty
 * map, and a role missing from it is unread. The raise control is offered to
 * a member who does not hold the role; the holder's own card links to
 * Waiting on you instead.
 *
 * ── PROPOSAL MODE: THE CARD A ROLE APPLICATION ASKS FOR (PR 3) ───────────
 *
 * An owner handed with a `proposal` gets the card their application asks
 * for: the roles come from the application's `seat_ids` (one card for up to
 * five roles), the terms from its `settings_json`, and every live section
 * (tasks, signs, tensions) reads "Starts once adopted". The roles are read by
 * `readProposalRows`, five reads for every role every application in the
 * batch names. No sign is counted for a proposal.
 *
 * A role proposal's DRAFT (role proposals PR A) is drawn the same way, with
 * `proposal.draft` laid over it: the words it proposes over the posted ones,
 * field by field (`proposedRole`), the new roles it asks for made from their
 * words alone, and the draft's own season words in place of the plan. Nothing
 * extra is read for it.
 *
 * ── MY APPLICATIONS ────────────────────────────────────────────────────────
 *
 * Read by `applicationsOfCandidates`, the same statement the `?candidate=`
 * list runs, and grouped by shared/applicationGroups.ts. Old seatings that
 * came through no application join "Past" on the owner's own card only.
 *
 * ── SIGNS ARE COUNTED ONCE PER CYCLE, NEVER ONCE PER ROLE ─────────────────
 *
 * A sign is a village-wide count. Its reading and its sheet are memoised by
 * (sign key, cycle id), plus the circle for "circle met", for a short time, so
 * six roles naming the same sign cost one count, and the second card in a
 * minute costs none. A table is read only when a sign that needs it is not in
 * the memo.
 */
import type { Pool } from "mysql2/promise";
import { CAPABILITY_LABELS, type Capability } from "../../shared/capabilities";
import { LUNAR_CLOCK } from "../../shared/cycleClock";
import {
  buildPlayerCard,
  LOAD_STEPS,
  type ApplicationIn,
  type LoadStep,
  type PlayerCard,
  type PlayerCardInput,
  type PlayerRoleIn,
  type SeasonalGoalIn,
  type TaskIn,
  type WorksWithIn,
} from "../../shared/playerCard";
import { roleWordsIn, type RoleEditKey } from "../../shared/playerCardEdit";
import { cycleWindows, readSign, SIGNS, isSignKey, type SignKey, type SignReading, type SignRows } from "../../shared/roleSigns";
import { signSheetRows, type SignSheetRow } from "../../shared/roleSignRows";
import { parseSeatSettings, type SeatSettings } from "../../shared/seatSettings";
import { readTermsOffer } from "../../shared/seatTermsOffer";
import { civilDateInstant } from "../../shared/seatTerms";
import { endedSeasons } from "../../shared/applicationGroups";
import { isLapsed, rowToAssignment, rowToRole, type LapseContext, type OrgAssignment, type OrgRole } from "./orgChart";
import { coveredSeatIds, type Relation, type RelationType } from "./orgRelations";
import { projectSeat, type SeatTier } from "./seatProjection";
import { readCardRows, readCharacters, readProposalRows, readSignTables, type SignTable } from "../repos/playerCard";
import { portraitsVisibleTo } from "../repos/characterPortraits";
import { avatarFor } from "./characters";
import { portraitUrl } from "./characterPortraits";
import { applicationsOfCandidates, pastSeatingsWithoutApplication } from "../repos/seatApplications";
import { latestCardWordsFor, moonLoadsFor } from "../repos/seasonPlans";
import { accomplishmentsOfMany } from "./sessionTasks";
import { tensionsForRoles } from "./roleTensions";
import { powersByClass } from "./powerAffinity";
import { villageHeldCapabilities } from "./capabilityHolding";
import { CARD_WORD_LABELS, servedGoalsOf, type CardWordKey, type CardWords, type SeasonalGoal, type ServedGoal } from "../../shared/seasonPlanWords";

import type { CardLevel, PlayerCardPayload, SignSheetOut } from "../../shared/playerCardPayload";

export type { CardLevel, PlayerCardPayload };

/** What one reader may read about one owner's card. */
export interface CardTier {
  level: CardLevel;
  /** `/api/org`'s tier for this reader (`orgSeatTier`). */
  seat: SeatTier;
}

export interface CardSeason {
  id: string;
  name: string | null;
  startsOn: string | null;
  endsOn: string | null;
}

export interface CardContext {
  now: Date;
  timeZone: string;
  viewerUserId: string | null;
  season: CardSeason | null;
  nextSeasonId: string | null;
  villageName: string | null;
  lapse: LapseContext;
  /** The village's class names, read once (`listArchetypes`). */
  archetypeNames: Record<string, string>;
  firstName: (name: string) => string;
  /** Seasons whose end has passed, for the "Past" applications. */
  endedSeasonIds?: readonly string[];
  /** The reader is an admin: they read every accomplishment, by `accomplishmentsOf`'s rule. */
  viewerAdmin?: boolean;
  /** This moon's id on the village clock, the key a moon load is stored under. No id, no load read. */
  moonId?: string | null;
  /**
   * The reader is a signed-in member: admitted, or an admin, the rule the
   * tension doors use (server/routes/roleTensions.ts). Absent is not a member,
   * so a host that never says reads no tensions.
   */
  viewerMember?: boolean;
  /**
   * Show the CCOS term on each heading of a role in full (`org.ccos_terms`,
   * the variable the circle card reads). Absent is off: plain headings.
   */
  frameworkTerms?: boolean;
  /**
   * The village the characters are read in, for the portrait in the card's
   * gold ring. Absent reads no portrait, and the card draws the initial.
   */
  villageId?: string;
}

/**
 * THE PORTRAIT IN THE GOLD RING: each owner's character that fronts their
 * sheet (the primary, else the first they walked), as this reader may see it.
 * Their own portrait where they have one this reader may see, by the
 * portrait's own visibility rule (`portraitsVisibleTo`), and the stock art
 * for that class and look otherwise: the same picture `partyFor` puts on
 * their profile, for the whole batch in three statements. Null when the owner
 * has walked no path, and the card draws their initial.
 */
async function ownerAvatars(pool: Pool, villageId: string | undefined, ownerIds: string[], viewerId: string | null): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  if (!villageId || !ownerIds.length) return out;
  const [{ primary, characters }, portraits] = await Promise.all([
    readCharacters(pool, villageId, ownerIds),
    portraitsVisibleTo(pool, villageId, ownerIds, viewerId),
  ]);
  for (const id of ownerIds) {
    const mine = characters.filter((c) => c.userId === id);
    const front = mine.find((c) => c.id === primary.get(id)) ?? mine[0];
    if (!front) continue;
    const own = portraits.find((p) => p.userId === id && p.archetypeKey === front.archetypeKey);
    out.set(id, portraitUrl(own?.fileName) ?? avatarFor(front.archetypeKey, front.presentation, front.tone));
  }
  return out;
}

/** The four card words drawn under "How I hold my roles". The other two have their own boxes. */
const HOLD_KEYS: readonly CardWordKey[] = ["howIHold", "findMe", "decisions", "feedback"];

const isLoadStep = (n: unknown): n is LoadStep => (LOAD_STEPS as readonly number[]).includes(Number(n)) && Number.isInteger(Number(n));

/** The application a proposal card is drawn for. */
export interface CardProposal {
  applicationId: string;
  /** `seat_applications.seat_ids`, 1 to 5 roles. */
  seatIds: string[];
  /** `seat_applications.settings_json`, as stored. */
  settings: unknown;
  /** `seat_applications.term_ends_at`. */
  termEndsAt: string | null;
  /**
   * The season the proposal is for (E9): the card's eyebrow, its span and its
   * moon cycle are drawn in it, never in the running season. Null is a
   * proposal with no season to be for, which draws none. Left out, the card
   * keeps the running season, as it did before.
   */
  season?: CardSeason | null;
  /**
   * A role proposal's draft (role proposals PR A): the words it proposes,
   * drawn over the posted ones by field name, so a field a later release adds
   * to roles is drawn with no edit here; roles the village has not created
   * yet; and the member's own season words in place of their filed plan.
   */
  draft?: {
    words: Record<string, Record<string, unknown>>;
    newRoles: Array<{ id: string; circleId: string | null; circleName: string | null; seats: number; words: Record<string, unknown> }>;
    season: { aim: string | null; servesGoals: ServedGoal[]; seasonalGoals: SeasonalGoal[] } | null;
  };
}

/**
 * A role as a draft proposes it: the posted role with the proposed words laid
 * over it, or a new role made from its words alone. A list field the draft
 * clears reads as an empty list, never null, so the projection reads it as it
 * reads any role.
 */
function proposedRole(base: (OrgRole & { archetypesSuggested: boolean }) | undefined, made: { id: string; circleId: string | null; seats: number; words: Record<string, unknown> } | undefined, words: Record<string, unknown> | undefined) {
  const role = base ?? (made ? { ...rowToRole({ id: made.id, name: made.words.name ?? made.id, circle_id: made.circleId, seats: made.seats, active: 1 }), archetypesSuggested: false } : undefined);
  const over = words ?? made?.words;
  if (!role || !over) return role;
  const out: Record<string, unknown> = { ...role };
  for (const [k, v] of Object.entries(over)) out[k] = v === null && Array.isArray((role as unknown as Record<string, unknown>)[k]) ? [] : v;
  return out as unknown as OrgRole & { archetypesSuggested: boolean };
}

/** One owner in a batch: who, at what tier, and the application when the card is a proposal. */
export interface CardOwner {
  userId: string;
  tier: CardTier;
  proposal?: CardProposal;
}

// ── The sign memo ──────────────────────────────────────────────────────────

const SIGN_TTL_MS = 60_000;

interface MemoEntry {
  at: number;
  reading: SignReading;
  /** The sheet, people as ids; named per request at the reader's tier. */
  sheet: SignSheetRow[] | null;
  names: Map<string, string>;
}

const memo = new Map<string, MemoEntry>();

/** For tests: forget every memoised sign. */
export function clearSignMemo(): void {
  memo.clear();
}

const memoKey = (key: string, cycleId: string, circleId: string | null) =>
  `${key}|${cycleId}|${key === "circle-met" ? circleId ?? "" : ""}`;

/**
 * Read and memoise every sign these roles name, counting each table once.
 * Answers a reader the model can call per measure without touching a table.
 */
export async function signReaderFor(
  pool: Pool,
  wanted: Array<{ key: SignKey; circleId: string | null }>,
  ctx: Pick<CardContext, "now" | "timeZone"> & { season: { id: string } | null },
): Promise<(key: string | null, circleId: string | null) => MemoEntry | null> {
  const windows = cycleWindows(ctx.now, LUNAR_CLOCK, ctx.timeZone);
  const cycleId = windows.current.from.toISOString();
  const fresh = (e: MemoEntry | undefined) => !!e && ctx.now.getTime() - e.at < SIGN_TTL_MS && e.at <= ctx.now.getTime();
  const missing = wanted.filter((w) => !fresh(memo.get(memoKey(w.key, cycleId, w.circleId))));
  if (missing.length) {
    const tables = new Set<SignTable>();
    for (const w of missing) {
      for (const t of SIGNS[w.key].reads) if (t !== "season_id" && t !== "circle_id") tables.add(t as SignTable);
    }
    const { rows, names } = await readSignTables(pool, tables, windows.previous.from, ctx.season?.id ?? null);
    for (const w of missing) {
      const scoped: SignRows = w.key === "circle-met" && w.circleId ? { ...rows, circle_id: w.circleId } : rows;
      memo.set(memoKey(w.key, cycleId, w.circleId), {
        at: ctx.now.getTime(),
        reading: readSign(w.key, scoped, windows),
        sheet: signSheetRows(w.key, scoped, windows.current),
        names,
      });
    }
  }
  return (key, circleId) => (key && isSignKey(key) ? memo.get(memoKey(key, cycleId, circleId)) ?? null : null);
}

// ── Row readers ────────────────────────────────────────────────────────────

const json = <T>(v: unknown, fallback: T): T => {
  if (v === null || v === undefined) return fallback;
  if (typeof v === "string") {
    try {
      return JSON.parse(v) as T;
    } catch {
      return fallback;
    }
  }
  return v as T;
};

const iso = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

function settingsOf(raw: unknown): SeatSettings | null {
  const parsed = parseSeatSettings(json<unknown>(raw, null));
  return parsed.ok ? parsed.settings : null;
}

function relationOf(r: any): Relation {
  return {
    id: String(r.id),
    typeId: String(r.type_id),
    fromKind: r.from_kind === "circle" ? "circle" : "org_role",
    fromId: String(r.from_id),
    toKind: r.to_kind === "circle" ? "circle" : "org_role",
    toId: String(r.to_id),
    note: r.note ?? null,
    isExample: !!r.is_example,
  };
}

function relationTypeOf(r: any): RelationType {
  return {
    id: String(r.id),
    label: String(r.label),
    inverseLabel: String(r.inverse_label),
    symmetric: !!r.symmetric,
    isCover: !!r.is_cover,
    order: Number(r.sort_order ?? 0),
    isExample: !!r.is_example,
  };
}

const groupBy = <T, K>(list: readonly T[], key: (t: T) => K): Map<K, T[]> => {
  const out = new Map<K, T[]>();
  for (const t of list) {
    const k = key(t);
    const l = out.get(k) ?? [];
    l.push(t);
    out.set(k, l);
  }
  return out;
};

/** The start of the moon `back` moons before the one `now` sits in. */
function moonStart(now: Date, back: number): Date {
  let b = LUNAR_CLOCK.boundsFor(now);
  for (let i = 0; i < back; i++) b = LUNAR_CLOCK.boundsFor(new Date(b.startsAt.getTime() - 1));
  return b.startsAt;
}

// ── The builder ────────────────────────────────────────────────────────────

/**
 * Cards for these owners, each at its own reader's tier. Owners with no user
 * row are left out of the answer.
 */
export async function buildPlayerCards(
  pool: Pool,
  owners: ReadonlyArray<CardOwner>,
  ctx: CardContext,
): Promise<Map<string, PlayerCardPayload>> {
  const out = new Map<string, PlayerCardPayload>();
  if (!owners.length) return out;
  const moonFrom = moonStart(ctx.now, 0);
  const memberIds = owners.filter((o) => o.tier.level !== "stranger").map((o) => o.userId);
  const selfIds = owners.filter((o) => o.tier.level === "self").map((o) => o.userId);
  // Accomplishments are a live card's: a proposal card reads none.
  const liveMemberIds = owners.filter((o) => o.tier.level !== "stranger" && !o.proposal).map((o) => o.userId);
  const [rows, prop, ownApps, pastHeld, accomplished, cardWords, loads, avatars, suitedByClass, heldAnywhere] = await Promise.all([
    readCardRows(pool, owners.map((o) => o.userId), { moonFrom, threeMoonsFrom: moonStart(ctx.now, 2) }),
    readProposalRows(pool, owners.flatMap((o) => o.proposal?.seatIds ?? [])),
    applicationsOfCandidates(pool, memberIds),
    pastSeatingsWithoutApplication(pool, selfIds),
    // One batch, by accomplishmentsOf's viewer rule: the owner and an admin read every one.
    accomplishmentsOfMany(pool, liveMemberIds, { lapseContext: () => ctx.lapse }, {
      viewer: { userId: ctx.viewerUserId, admin: !!ctx.viewerAdmin },
    }),
    latestCardWordsFor(pool, memberIds),
    ctx.moonId ? moonLoadsFor(pool, memberIds, ctx.moonId) : Promise.resolve(new Map<string, { level: number }>()),
    ownerAvatars(pool, ctx.villageId, owners.map((o) => o.userId), ctx.viewerUserId),
    // A10: what each class suits, and every power the village has handed to any
    // role. A power held anywhere is never listed as "suited" on a card.
    ctx.villageId ? powersByClass(pool, ctx.villageId) : Promise.resolve(null),
    villageHeldCapabilities(pool),
  ]);
  const held = new Set(heldAnywhere);
  const suitedFor = (classes: readonly string[]) =>
    suitedByClass ? classes.flatMap((k) => suitedByClass.get(k) ?? []).filter((p) => !held.has(p.key)) : undefined;

  const roles = new Map<string, OrgRole & { archetypesSuggested: boolean }>(
    [...rows.roles, ...prop.roles].map((r) => [String(r.id), { ...rowToRole(r), archetypesSuggested: !!r.archetypes_suggested }]),
  );
  const roleName = new Map(rows.roleNames.map((r) => [String(r.id), String(r.name)]));
  const circleName = new Map([...rows.circles, ...prop.circles].map((c) => [String(c.id), String(c.name)]));
  const lapseCtx = { ...ctx.lapse, now: ctx.now };
  const seatingRows = Array.from(new Map([...rows.seatings, ...prop.seatings].map((r) => [String(r.id), r])).values());
  const seatings: OrgAssignment[] = seatingRows.map((r) => {
    const a = rowToAssignment(r);
    const v = isLapsed(a, { expiresEachSeason: roles.get(a.orgRoleId)?.expiresEachSeason ?? null }, lapseCtx);
    return { ...a, lapsed: v.lapsed, lapsedReason: v.reason };
  });
  const seatingsByRole = groupBy(seatings, (s) => s.orgRoleId);
  const relations = Array.from(new Map([...rows.relations, ...prop.relations].map((r) => [String(r.id), r])).values()).map(relationOf);
  const types = new Map(rows.relationTypes.map(relationTypeOf).map((t) => [t.id, t]));
  const covered = coveredSeatIds(relations, types);
  const grantRows = Array.from(new Map([...rows.grants, ...prop.grants].map((g) => [`${g.holder_role_id}|${g.capability}`, g])).values());
  const grantsByRole = groupBy(grantRows, (g) => String(g.holder_role_id));
  const appsById = new Map(rows.applications.map((a) => [String(a.id), a]));
  const decisionsByCircle = new Map(rows.circleDecisions.map((d) => [String(d.circle_id), Number(d.n)]));
  const pendingByRole = new Map<string, Set<RoleEditKey>>();
  const proposalsByRole = new Map<string, { draftId: string; proposedAt: string; payload: unknown }[]>();
  for (const p of rows.pending) {
    const set = pendingByRole.get(String(p.org_role_id)) ?? new Set<RoleEditKey>();
    const payload = json<unknown>(p.payload, {});
    for (const k of roleWordsIn(payload)) set.add(k);
    pendingByRole.set(String(p.org_role_id), set);
    const list = proposalsByRole.get(String(p.org_role_id)) ?? [];
    list.push({ draftId: String(p.draft_id), proposedAt: new Date(Number(p.created_at) * 1000).toISOString(), payload });
    proposalsByRole.set(String(p.org_role_id), list);
  }
  // Every role a live card in the batch carries, the tensions read once for all of them.
  const liveOwnerIds = new Set(owners.filter((o) => !o.proposal && o.tier.level !== "stranger").map((o) => o.userId));
  const tensionRoleIds = Array.from(
    new Set(seatings.filter((s) => s.userId && liveOwnerIds.has(String(s.userId)) && s.holderKind === "member" && !s.isExample).map((s) => s.orgRoleId)),
  );
  const tensionsByRole = await tensionsForRoles(pool, tensionRoleIds, { userId: ctx.viewerUserId, member: ctx.viewerMember === true });
  const viewerHolds = (roleId: string): boolean =>
    ctx.viewerUserId !== null &&
    (seatingsByRole.get(roleId) ?? []).some((s) => s.userId === ctx.viewerUserId && s.holderKind === "member" && !s.isExample);
  const doneThisMoon = new Set(rows.taskEvents.filter((e) => e.status === "done").map((e) => String(e.entry_id)));
  const tasksByRole = groupBy(rows.tasks, (t) => String(t.owner_seat_id));

  // Every sign any owner's roles name, read once for the whole batch.
  const wanted: Array<{ key: SignKey; circleId: string | null }> = [];
  for (const o of owners) {
    if (o.tier.level === "stranger" || o.proposal) continue;
    for (const s of seatings) {
      if (s.userId !== o.userId || s.holderKind !== "member" || s.isExample) continue;
      const role = roles.get(s.orgRoleId);
      if (!role) continue;
      const settings = (s.applicationId && settingsOf(appsById.get(s.applicationId)?.settings_json)) || readOffer(role);
      for (const m of settings?.scoreboard?.measures ?? []) {
        if (m.countedBy && isSignKey(m.countedBy)) wanted.push({ key: m.countedBy, circleId: role.circleId });
      }
    }
  }
  const signs = await signReaderFor(pool, wanted, ctx);

  for (const owner of owners) {
    const user = rows.users.find((u) => String(u.id) === owner.userId);
    if (!user) continue;
    const { level, seat } = owner.tier;
    const isSelf = level === "self";
    const memberUp = level !== "stranger";
    const proposal = owner.proposal ?? null;
    const mine = seatings.filter((s) => s.userId === owner.userId && s.holderKind === "member" && !s.isExample);
    // A draft's new roles have no row yet: they are drawn from the draft's own words.
    const made = new Map((proposal?.draft?.newRoles ?? []).map((r) => [r.id, r]));
    const roleOf = (id: string) => (proposal?.draft ? proposedRole(roles.get(id), made.get(id), proposal.draft.words[id]) : roles.get(id));
    // A proposal's roles are the ones it names, in its order; a live card's are the ones held.
    const heldIds = proposal
      ? Array.from(new Set(proposal.seatIds)).filter((id) => roles.has(id) || made.has(id))
      : Array.from(new Set(mine.map((s) => s.orgRoleId))).filter((id) => roles.has(id));
    // An application names its roles to every member who may read it.
    const rolesVisible = isSelf || !!proposal || seat.people !== "none";
    const proposalSettings = proposal ? settingsOf(proposal.settings) : null;

    const roleIns: PlayerRoleIn[] = heldIds.map((id) => {
      const role = roleOf(id)!;
      const held = seatingsByRole.get(id) ?? [];
      const own = proposal ? null : mine.find((s) => s.orgRoleId === id)!;
      // The /api/org seat object, at this reader's tier, holders never read.
      const p = projectSeat(role, held, { ...seat, people: "none", editing: false }, {
        route: "org",
        now: ctx.now,
        nameOf: () => "",
        firstName: ctx.firstName,
      });
      const ownSettings = proposal ? proposalSettings : own?.applicationId ? settingsOf(appsById.get(own.applicationId)?.settings_json) : null;
      const offer = seat.terms && p.termsOffer ? (p.termsOffer as SeatSettings) : null;
      const worksWith: WorksWithIn[] = [];
      for (const r of relations) {
        if (r.isExample || r.typeId !== "works-with") continue;
        const other = r.fromKind === "org_role" && r.fromId === id ? r.toId : r.toKind === "org_role" && r.toId === id ? r.fromId : null;
        if (!other || other === id) continue;
        worksWith.push({ roleId: other, roleName: roleName.get(other) ?? other, about: r.note });
      }
      return {
        id,
        name: String(p.name),
        aim: (p.aim as string | null) ?? null,
        whyItMatters: (p.whyItMatters as string | null) ?? null,
        domain: (p.domain as string | null) ?? null,
        accountabilities: (p.accountabilities as string[]) ?? [],
        criticality: p.criticality as "normal" | "high",
        circle: role.circleId ? { id: role.circleId, name: circleName.get(role.circleId) ?? made.get(id)?.circleName ?? "" } : null,
        termEndsAt: proposal
          ? iso(proposal.termEndsAt)
          : memberUp
            ? iso(own!.termEndsAt)
            : seat.structure
              ? ((p.termEnds as string | null) ?? null)
              : undefined,
        archetypes: seat.structure ? ((p.archetypes as string[]) ?? []) : undefined,
        archetypesSuggested: role.archetypesSuggested,
        // The role's own handover words (#534), off the same seat object /api/org sends.
        bringMe: (p.bringMe as string[] | null) ?? null,
        notMine: (p.notMine as string[] | null) ?? null,
        runbook: (p.runbook as string | null) ?? null,
        // The role's CCOS words (0274), off the same seat object, at the domain's tier.
        existsWhile: (p.existsWhile as string | null) ?? null,
        authorities: (p.authorities as string[] | null) ?? null,
        responsibilities: (p.responsibilities as string[] | null) ?? null,
        signsStretched: (p.signsStretched as string | null) ?? null,
        flowsBack: (p.flowsBack as string | null) ?? null,
        stepBack: (p.stepBack as string | null) ?? null,
        timeCommitment: (p.timeCommitment as string | null) ?? null,
        worksWith: seat.structure ? worksWith : undefined,
        powers: seat.structure
          ? (grantsByRole.get(id) ?? []).map((g) => ({
              key: String(g.capability),
              label: CAPABILITY_LABELS[g.capability as Capability] ?? String(g.capability),
            }))
          : undefined,
        // Unread wherever the structure is, or when the map could not be read.
        suited: seat.structure ? suitedFor((p.archetypes as string[]) ?? []) : undefined,
        // A role missing from the map (a reader who is not a member) is unread, never empty.
        tensions: memberUp ? (proposal ? [] : tensionsByRole.get(id)?.tensions) : undefined,
        viewerHolds: viewerHolds(id),
        // A proposal is drawn on its own terms, never the offer on the role.
        settings: seat.terms ? (proposal ? proposalSettings : ownSettings ?? offer) : undefined,
        holderCount: Number(p.holderCount ?? held.length),
        covered: seat.structure ? covered.has(id) : undefined,
        // The decisions read counts only the circles of held roles, so a proposal leaves it uncounted.
        circleDecisions: proposal ? undefined : memberUp && role.circleId ? decisionsByCircle.get(role.circleId) ?? 0 : memberUp ? 0 : undefined,
        pendingWords: isSelf && !proposal ? Array.from(pendingByRole.get(id) ?? []) : [],
        // The proposals themselves, with the words they would put live, for whoever decides them.
        proposals: memberUp && !proposal ? (proposalsByRole.get(id) ?? []) : undefined,
      };
    });

    const tasks: TaskIn[] = proposal ? [] : heldIds.flatMap((id) =>
      (tasksByRole.get(id) ?? [])
        // Open, or done this moon: by its own stamp, or by a "done" answer this moon.
        .filter((t) => t.status === "open" || (t.status === "done" && (t.done_at !== null || doneThisMoon.has(String(t.entry_id)))))
        .map((t) => ({
          id: String(t.entry_id),
          title: String(t.text ?? ""),
          roleId: id,
          status: t.status === "done" ? ("done" as const) : ("open" as const),
        })),
    );

    const words: CardWords | null = cardWords.get(owner.userId) ?? null;
    const load = loads.get(owner.userId);
    const plans = rows.plans.filter((p) => String(p.user_id) === owner.userId);
    const plan = isSelf ? plans[plans.length - 1] : [...plans].reverse().find((p) => p.filed_at);
    const draftSeason = proposal?.draft?.season ?? null;
    const applications: ApplicationIn[] = ownApps
      .filter((a) => a.candidateUserId === owner.userId)
      .map((a) => ({
        id: a.id,
        candidate_user_id: a.candidateUserId,
        seat_ids: a.seatIds,
        status: a.status,
        created_at: iso(a.createdAt) ?? "",
        decided_at: iso(a.decidedAt),
        term_season_id: a.termSeasonId ?? null,
        starts_at: iso(a.startsAt),
        term_ends_at: iso(a.termEndsAt),
      }));
    const pastSeatings = pastHeld
      .filter((p) => p.userId === owner.userId)
      .map((p) => ({ roleId: p.roleId, startedAt: iso(p.startedAt), endedAt: iso(p.endedAt) }));

    const input: PlayerCardInput = {
      now: ctx.now,
      timeZone: ctx.timeZone,
      owner: { userId: owner.userId, displayName: String(user.name ?? ""), avatar: avatars.get(owner.userId) ?? null },
      viewerUserId: ctx.viewerUserId,
      viewerMember: ctx.viewerMember === true,
      villageName: ctx.villageName,
      season: ctx.season,
      // A proposal card is drawn in the season it is for (E9); "My applications" still reads the running one.
      proposalSeason: proposal ? proposal.season : undefined,
      nextSeasonId: ctx.nextSeasonId,
      archetypeNames: ctx.archetypeNames,
      roles: rolesVisible ? roleIns : undefined,
      // A draft card shows the season the draft proposes, never the filed plan.
      plan: memberUp
        ? draftSeason
          ? { aim: draftSeason.aim, goals: draftSeason.servesGoals }
          : plan
            ? {
                aim: plan.aim ?? null,
                goals: servedGoalsOf(json<ServedGoal[] | null>(plan.serves_goals_json, null), plan.serves_goal ?? null),
              }
            : null
        : undefined,
      seasonalGoals: memberUp ? (draftSeason ? (draftSeason.seasonalGoals.length ? draftSeason.seasonalGoals : null) : seasonalGoalsOf(plan?.seasonal_goals_json)) : undefined,
      tasks: memberUp && rolesVisible ? tasks : undefined,
      signRows: memberUp ? {} : undefined,
      howIHold: memberUp ? holdWords(words) : undefined,
      accomplished: memberUp && !proposal ? accomplished.get(owner.userId) ?? [] : undefined,
      applications: memberUp ? applications : undefined,
      pastSeatings: isSelf ? pastSeatings : undefined,
      endedSeasonIds: ctx.endedSeasonIds ?? [],
      mode: proposal ? "proposal" : "live",
      roleNames: Object.fromEntries(roleName),
      bonusTokenName: null,
      // The owner's own words and this moon's read (PR 6, #530), whatever the season.
      loadRead: memberUp ? (isLoadStep(load?.level) ? (Number(load!.level) as LoadStep) : null) : undefined,
      growingEdge: memberUp ? words?.growingEdge ?? null : undefined,
      whoCouldHoldNext: memberUp ? words?.nextHolder ?? null : undefined,
      signReader: (key, circleId) =>
        signs(key, circleId)?.reading ?? { kind: "not-counted", key: key ?? null, words: "Not counted yet" },
      // 0274: the CCOS term on each heading, by the village's `org.ccos_terms`.
      frameworkTerms: ctx.frameworkTerms === true,
    };
    const card = buildPlayerCard(input);

    const sheets: Record<string, SignSheetOut> = {};
    if (memberUp) {
      for (const r of card.roles) {
        if (r.working.items.kind !== "shown") continue;
        for (const s of r.working.items.value) {
          if (!s.sheetKey || sheets[s.sheetKey] || s.reading.kind !== "counted") continue;
          const entry = signs(s.reading.key, roles.get(r.id)?.circleId ?? null);
          if (!entry?.sheet) continue;
          sheets[s.sheetKey] = {
            title: s.reading.label,
            countedFrom: s.reading.countedFrom,
            rows: entry.sheet.map((row) => ({
              at: row.at,
              words: row.words,
              who: row.personId ? ctx.firstName(entry.names.get(row.personId) ?? "") || null : null,
            })),
            note: "First names only. Listed in the order it happened.",
          };
        }
      }
    }

    out.set(owner.userId, {
      card,
      viewer: { level, isSelf },
      timeZone: ctx.timeZone,
      sheets,
      links: {
        apply: "/roles",
        plan: "/season-plans/mine",
        ...(isSelf ? { wallet: "/wallet", newApplication: "/propose?type=role_application" } : {}),
      },
    });
  }
  return out;
}

/** A plan's stored seasonal goals, as the model reads them. Null when none are written. */
function seasonalGoalsOf(raw: unknown): SeasonalGoalIn[] | null {
  const list = json<SeasonalGoal[] | null>(raw, null);
  if (!Array.isArray(list)) return null;
  const goals = list
    .filter((g) => g && typeof g.title === "string")
    .map((g) => ({ title: g.title, doneWhen: typeof g.doneWhen === "string" ? g.doneWhen : null }));
  return goals.length ? goals : null;
}

/** "How I hold my roles": the card words that have an answer, labelled as the plan form labels them. */
function holdWords(words: CardWords | null): { label: string; text: string }[] | null {
  if (!words) return null;
  const items = HOLD_KEYS.flatMap((k) => {
    const text = typeof words[k] === "string" ? words[k]!.trim() : "";
    return text ? [{ label: CARD_WORD_LABELS[k], text }] : [];
  });
  return items.length ? items : null;
}

/** A role's terms on offer, parsed by the one parser, or null. */
function readOffer(role: OrgRole): SeatSettings | null {
  const r = readTermsOffer(role.termsOffer);
  return r.ok ? r.settings ?? null : null;
}

/** For the route: the season, the next one and the ended ones, out of `seasonState()`. */
export function cardSeasons(
  state: {
    current?: { id: string; name?: string | null; startsOn?: string | null; endsOn?: string | null } | null;
    upcoming?: { id: string } | null;
    seasons?: ReadonlyArray<{ id: string; endsOn?: string | null }>;
    timezone?: string;
  },
  now: Date = new Date(),
): { season: CardSeason | null; nextSeasonId: string | null; endedSeasonIds: string[] } {
  const c = state.current ?? null;
  const tz = state.timezone || "UTC";
  return {
    season: c ? { id: String(c.id), name: c.name ?? null, startsOn: c.startsOn ?? null, endsOn: c.endsOn ?? null } : null,
    nextSeasonId: state.upcoming?.id ? String(state.upcoming.id) : null,
    endedSeasonIds: Array.from(endedSeasons(state.seasons ?? [], (d) => civilDateInstant(d, tz), now)),
  };
}
