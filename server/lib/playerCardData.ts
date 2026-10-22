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
 *             the signs, each with its sheet of rows, first names only.
 *   self      also the full text of their own open tensions, their newest plan
 *             even before it is filed, the role words waiting on consent, and a
 *             link to their wallet.
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
  type ApplicationIn,
  type PlayerCard,
  type PlayerCardInput,
  type PlayerRoleIn,
  type TaskIn,
  type TensionIn,
  type WorksWithIn,
} from "../../shared/playerCard";
import { roleWordsIn, type RoleEditKey } from "../../shared/playerCardEdit";
import { cycleWindows, readSign, SIGNS, isSignKey, type SignKey, type SignReading, type SignRows } from "../../shared/roleSigns";
import { signSheetRows, type SignSheetRow } from "../../shared/roleSignRows";
import { parseSeatSettings, type SeatSettings } from "../../shared/seatSettings";
import { readTermsOffer } from "../../shared/seatTermsOffer";
import { isLapsed, rowToAssignment, rowToRole, type LapseContext, type OrgAssignment, type OrgRole } from "./orgChart";
import { coveredSeatIds, type Relation, type RelationType } from "./orgRelations";
import { projectSeat, type SeatTier } from "./seatProjection";
import { readCardRows, readSignTables, type SignTable } from "../repos/playerCard";

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
async function signReaderFor(
  pool: Pool,
  wanted: Array<{ key: SignKey; circleId: string | null }>,
  ctx: CardContext,
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
  owners: ReadonlyArray<{ userId: string; tier: CardTier }>,
  ctx: CardContext,
): Promise<Map<string, PlayerCardPayload>> {
  const out = new Map<string, PlayerCardPayload>();
  if (!owners.length) return out;
  const moonFrom = moonStart(ctx.now, 0);
  const rows = await readCardRows(pool, owners.map((o) => o.userId), { moonFrom, threeMoonsFrom: moonStart(ctx.now, 2) });

  const roles = new Map<string, OrgRole & { archetypesSuggested: boolean }>(
    rows.roles.map((r) => [String(r.id), { ...rowToRole(r), archetypesSuggested: !!r.archetypes_suggested }]),
  );
  const roleName = new Map(rows.roleNames.map((r) => [String(r.id), String(r.name)]));
  const circleName = new Map(rows.circles.map((c) => [String(c.id), String(c.name)]));
  const lapseCtx = { ...ctx.lapse, now: ctx.now };
  const seatings: OrgAssignment[] = rows.seatings.map((r) => {
    const a = rowToAssignment(r);
    const v = isLapsed(a, { expiresEachSeason: roles.get(a.orgRoleId)?.expiresEachSeason ?? null }, lapseCtx);
    return { ...a, lapsed: v.lapsed, lapsedReason: v.reason };
  });
  const seatingsByRole = groupBy(seatings, (s) => s.orgRoleId);
  const relations = rows.relations.map(relationOf);
  const types = new Map(rows.relationTypes.map(relationTypeOf).map((t) => [t.id, t]));
  const covered = coveredSeatIds(relations, types);
  const grantsByRole = groupBy(rows.grants, (g) => String(g.holder_role_id));
  const appsById = new Map(rows.applications.map((a) => [String(a.id), a]));
  const decisionsByCircle = new Map(rows.circleDecisions.map((d) => [String(d.circle_id), Number(d.n)]));
  const pendingByRole = new Map<string, Set<RoleEditKey>>();
  for (const p of rows.pending) {
    const set = pendingByRole.get(String(p.org_role_id)) ?? new Set<RoleEditKey>();
    for (const k of roleWordsIn(json<unknown>(p.payload, {}))) set.add(k);
    pendingByRole.set(String(p.org_role_id), set);
  }
  const tensionsByRole = groupBy(rows.tensions, (t) => String(t.owner_seat_id));
  const doneThisMoon = new Set(rows.taskEvents.filter((e) => e.status === "done").map((e) => String(e.entry_id)));
  const tasksByRole = groupBy(rows.tasks, (t) => String(t.owner_seat_id));

  // Every sign any owner's roles name, read once for the whole batch.
  const wanted: Array<{ key: SignKey; circleId: string | null }> = [];
  for (const o of owners) {
    if (o.tier.level === "stranger") continue;
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
    const mine = seatings.filter((s) => s.userId === owner.userId && s.holderKind === "member" && !s.isExample);
    const heldIds = Array.from(new Set(mine.map((s) => s.orgRoleId))).filter((id) => roles.has(id));
    const rolesVisible = isSelf || seat.people !== "none";

    const roleIns: PlayerRoleIn[] = heldIds.map((id) => {
      const role = roles.get(id)!;
      const held = seatingsByRole.get(id) ?? [];
      const own = mine.find((s) => s.orgRoleId === id)!;
      // The /api/org seat object, at this reader's tier, holders never read.
      const p = projectSeat(role, held, { ...seat, people: "none", editing: false }, {
        route: "org",
        now: ctx.now,
        nameOf: () => "",
        firstName: ctx.firstName,
      });
      const ownSettings = own.applicationId ? settingsOf(appsById.get(own.applicationId)?.settings_json) : null;
      const offer = seat.terms && p.termsOffer ? (p.termsOffer as SeatSettings) : null;
      const worksWith: WorksWithIn[] = [];
      for (const r of relations) {
        if (r.isExample || r.typeId !== "works-with") continue;
        const other = r.fromKind === "org_role" && r.fromId === id ? r.toId : r.toKind === "org_role" && r.toId === id ? r.fromId : null;
        if (!other || other === id) continue;
        worksWith.push({ roleId: other, roleName: roleName.get(other) ?? other, about: r.note });
      }
      const tensions: TensionIn[] = (tensionsByRole.get(id) ?? []).map((t) => ({
        id: String(t.id),
        status: t.status === "done" ? "answered" : "open",
        raisedBy: String(t.raised_by ?? ""),
        text: String(t.text ?? ""),
      }));
      return {
        id,
        name: String(p.name),
        aim: (p.aim as string | null) ?? null,
        whyItMatters: (p.whyItMatters as string | null) ?? null,
        domain: (p.domain as string | null) ?? null,
        accountabilities: (p.accountabilities as string[]) ?? [],
        criticality: p.criticality as "normal" | "high",
        circle: role.circleId ? { id: role.circleId, name: circleName.get(role.circleId) ?? "" } : null,
        termEndsAt: memberUp ? iso(own.termEndsAt) : seat.structure ? ((p.termEnds as string | null) ?? null) : undefined,
        archetypes: seat.structure ? ((p.archetypes as string[]) ?? []) : undefined,
        archetypesSuggested: role.archetypesSuggested,
        bringMe: null,
        notMine: null,
        runbook: null,
        worksWith: seat.structure ? worksWith : undefined,
        powers: seat.structure
          ? (grantsByRole.get(id) ?? []).map((g) => ({
              key: String(g.capability),
              label: CAPABILITY_LABELS[g.capability as Capability] ?? String(g.capability),
            }))
          : undefined,
        tensions: memberUp ? tensions : undefined,
        settings: seat.terms ? ownSettings ?? offer : undefined,
        holderCount: Number(p.holderCount ?? held.length),
        covered: seat.structure ? covered.has(id) : undefined,
        circleDecisions: memberUp && role.circleId ? decisionsByCircle.get(role.circleId) ?? 0 : memberUp ? 0 : undefined,
        pendingWords: isSelf ? Array.from(pendingByRole.get(id) ?? []) : [],
      };
    });

    const tasks: TaskIn[] = heldIds.flatMap((id) =>
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

    const plans = rows.plans.filter((p) => String(p.user_id) === owner.userId);
    const plan = isSelf ? plans[plans.length - 1] : [...plans].reverse().find((p) => p.filed_at);
    const applications: ApplicationIn[] = rows.applications
      .filter((a) => String(a.candidate_user_id) === owner.userId)
      .map((a) => ({
        id: String(a.id),
        candidate_user_id: String(a.candidate_user_id),
        seat_ids: json<unknown[]>(a.seat_ids, []).map(String),
        status: String(a.status),
        created_at: iso(a.created_at) ?? "",
        decided_at: iso(a.decided_at),
        term_season_id: a.term_season_id ?? null,
        starts_at: iso(a.starts_at),
        term_ends_at: iso(a.term_ends_at),
      }));

    const input: PlayerCardInput = {
      now: ctx.now,
      timeZone: ctx.timeZone,
      owner: { userId: owner.userId, displayName: String(user.name ?? ""), avatar: null },
      viewerUserId: ctx.viewerUserId,
      villageName: ctx.villageName,
      season: ctx.season,
      nextSeasonId: ctx.nextSeasonId,
      archetypeNames: ctx.archetypeNames,
      roles: rolesVisible ? roleIns : undefined,
      plan: memberUp ? (plan ? { aim: plan.aim ?? null, goals: plan.serves_goal ? [{ goal: String(plan.serves_goal), howItHelps: null }] : [] } : null) : undefined,
      // Stored from the season plan migration (PR 6). Read and empty until then.
      seasonalGoals: memberUp ? null : undefined,
      tasks: memberUp && rolesVisible ? tasks : undefined,
      signRows: memberUp ? {} : undefined,
      howIHold: memberUp ? null : undefined,
      applications: memberUp ? applications : undefined,
      roleNames: Object.fromEntries(roleName),
      bonusTokenName: null,
      loadRead: memberUp ? null : undefined,
      growingEdge: memberUp ? null : undefined,
      whoCouldHoldNext: memberUp ? null : undefined,
      signReader: (key, circleId) =>
        signs(key, circleId)?.reading ?? { kind: "not-counted", key: key ?? null, words: "Not counted yet" },
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
        ...(isSelf ? { wallet: "/wallet", newApplication: "/propose?type=role_application", review: "/review" } : {}),
      },
    });
  }
  return out;
}

/** A role's terms on offer, parsed by the one parser, or null. */
function readOffer(role: OrgRole): SeatSettings | null {
  const r = readTermsOffer(role.termsOffer);
  return r.ok ? r.settings ?? null : null;
}

/** For the route: the season and the next one, out of `seasonState()`. */
export function cardSeasons(state: {
  current?: { id: string; name?: string | null; startsOn?: string | null; endsOn?: string | null } | null;
  upcoming?: { id: string } | null;
}): { season: CardSeason | null; nextSeasonId: string | null } {
  const c = state.current ?? null;
  return {
    season: c ? { id: String(c.id), name: c.name ?? null, startsOn: c.startsOn ?? null, endsOn: c.endsOn ?? null } : null,
    nextSeasonId: state.upcoming?.id ? String(state.upcoming.id) : null,
  };
}
