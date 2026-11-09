/**
 * LIVING PLACES (S2): the place registry's reads and its seed import.
 *
 * Every place on the land is a row in `places` (drizzle/0346), keyed on the
 * map's own `structure_key`. This file turns those rows, the published scene's
 * anchors and the org chart into the two answers the living map and the
 * Places page read: the INDEX (every place, two tiers) and the CARD (one
 * place). It also holds `getPlaceStewardship`, which the build days lane
 * reads, and the orphan report.
 *
 * ── WHAT THIS FILE NEVER DOES ─────────────────────────────────────────────
 *
 * - It never stores or invents a coordinate. An anchor is read from the
 *   published scene's `map_structures`, and a place the scene does not draw
 *   has `anchor: null` (listed, never drawn).
 * - It never copies the org chart. Roles, their seat state and holders come
 *   from `projectMapOrg`, the same projection the map draws, so a place can
 *   never disagree with the org chart about a seat.
 * - It never sends a holder's name below the map's `viewPeople` tier, and a
 *   visitor's index carries no roles, claims, events, holders or the flag that
 *   says where children may be.
 * - It never writes a stage. Stage changes are S3's, by proposal.
 *
 * The rules themselves (keys, stages, the building gate, the seed's problems)
 * are pure and live in shared/places.ts.
 */
import crypto from "node:crypto";
import type { Pool } from "mysql2/promise";
import {
  homesProgress, isPlaceKey, KINDS_WITHOUT_LIFECYCLE, placeInDoubt, permitsComplete, seedProblems, stewardState,
  type HomeUnits, type PlaceKind, type PlacesSeed, type PlaceStage, type StewardState,
} from "../../shared/places";
import type { MapOrgRole } from "./mapOrg";
import {
  countOpenClaims, countPhotosByPlace, countQueuedStageChanges, insertSeed, listEventsBetween, listLinkRows,
  listOpenQuestsAtPlaces, listPermitRows, listPlaceRows, listZoneRows,
  type LinkRow, type PermitRow, type PlaceEventRow, type PlaceInsert, type PlaceQuestRow, type PlaceRow, type ZoneRow,
} from "../repos/places";
import { dbDocument } from "../repos/store-db";

export const MODULE_ID = "places";

/** How far ahead the members' index looks for events at a place. */
export const EVENTS_SOON_DAYS = 14;

/** Where a member applies for a role (the governance module's door). */
export const ROLE_APPLY_PATH = "/api/governance/role-applications";

/** The registry's own settings, kept beside its rows: the homes target. */
export interface RegistryMeta { homesTarget: HomeUnits | null; importedAt: string | null; importedBy: string | null }
const META_KEY = "place-registry";
const META_FALLBACK: RegistryMeta = { homesTarget: null, importedAt: null, importedBy: null };

export async function readRegistryMeta(pool: Pool): Promise<RegistryMeta> {
  const doc = dbDocument<RegistryMeta & Record<string, unknown>>(pool, META_KEY, { ...META_FALLBACK });
  await doc.load();
  const v = doc.get();
  return { homesTarget: unitsOrNull(v.homesTarget), importedAt: v.importedAt ?? null, importedBy: v.importedBy ?? null };
}

function unitsOrNull(v: unknown): HomeUnits | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const n = (k: string) => (Number.isSafeInteger(o[k]) && (o[k] as number) >= 0 ? (o[k] as number) : 0);
  return { homes: n("homes"), apartments: n("apartments"), selfBuildLots: n("selfBuildLots"), casitas: n("casitas") };
}

// ── The published scene's anchors ────────────────────────────────────────────

export interface Anchor { x: number; y: number }

/**
 * Each structure the published scene draws, by key, with its anchor. A scene
 * that cannot be read yields an empty map: the registry then lists every place
 * and draws none, which is honest, where a guess would invent geography.
 */
export function anchorsFromScene(scene: string | null | undefined): Map<string, Anchor> {
  const out = new Map<string, Anchor>();
  if (!scene) return out;
  let parsed: any;
  try {
    parsed = JSON.parse(scene);
  } catch {
    return out;
  }
  const list = Array.isArray(parsed?.map_structures) ? parsed.map_structures : [];
  for (const s of list) {
    const key = typeof s?.key === "string" ? s.key : null;
    const x = Number(s?.anchor?.x);
    const y = Number(s?.anchor?.y);
    if (key && Number.isFinite(x) && Number.isFinite(y)) out.set(key, { x, y });
  }
  return out;
}

// ── The index ────────────────────────────────────────────────────────────────

export type Tier = "public" | "members";

export interface PublicPlace {
  key: string;
  name: string;
  zone: string | null;
  kind: PlaceKind;
  stage: PlaceStage | null;
  confirmed: boolean;
  readinessPct: number | null;
  temporary: boolean;
  successorKey: string | null;
  setAsideReason: string | null;
  isHome: boolean;
  anchor: Anchor | null;
  openQuests: number;
}

export interface MemberPlace extends PublicPlace {
  childSafeZone: boolean;
  showcase: boolean;
  steward: StewardState | null;
  invitationOpen: boolean;
  openRoles: Array<{ roleId: string; title: string; state: string; seats: number; holderCount: number }>;
  openClaims: number;
  openStageProposals: number;
  eventsSoon: { count: number; nextStartsAt: string | null };
  photos: number;
}

export interface PlaceIndex {
  version: string;
  tier: Tier;
  zones: Array<{ key: string; name: string; positionText: string }>;
  homes: ReturnType<typeof homesProgress>;
  places: Array<PublicPlace | MemberPlace>;
}

export interface IndexInput {
  tier: Tier;
  places: readonly PlaceRow[];
  zones: readonly ZoneRow[];
  anchors: ReadonlyMap<string, Anchor>;
  roles: readonly MapOrgRole[];
  quests: readonly PlaceQuestRow[];
  events: readonly PlaceEventRow[];
  queued: ReadonlyMap<string, number>;
  claims: ReadonlyMap<string, number>;
  photos: ReadonlyMap<string, number>;
  homesTarget: HomeUnits | null;
  /** The day, so the version changes at midnight with no write anywhere. */
  day: string;
}

/** Folded for comparison: the database compares keys without case. */
const fold = (k: string) => k.toLowerCase();

function countBy<T>(list: readonly T[], keys: (t: T) => readonly string[]): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const t of list) {
    for (const k of Array.from(new Set(keys(t).map(fold)))) {
      const l = out.get(k) ?? [];
      l.push(t);
      out.set(k, l);
    }
  }
  return out;
}

/** The steward position's state, from the linked role's seat and the place's hold. */
export function placeStewardState(place: PlaceRow, roles: readonly MapOrgRole[]): StewardState | null {
  if (KINDS_WITHOUT_LIFECYCLE.includes(place.kind)) return null;
  const role = place.stewardRoleId ? roles.find((r) => r.id === place.stewardRoleId) ?? null : null;
  return stewardState({
    roleId: role ? role.id : null,
    seat: role ? role.state : null,
    held: place.stewardHold?.state === "held",
    paused: place.stewardHold?.state === "paused",
  });
}

/** A steward is wanted: the position is open or has run out, and the place is neither retired nor set aside. */
function invitationOpen(place: PlaceRow, state: StewardState | null): boolean {
  if (state === null || place.retiredAt || place.setAsideReason) return false;
  return state === "open" || state === "expired";
}

/**
 * The index, for one tier. Pure: every read is handed in, so the tier rules
 * are tested without a database.
 *
 * A visitor's tier is structure only. It carries no roles, no claims, no
 * events (so no time a place is busy is ever public, at a home or anywhere),
 * no stewardship state and no flag that says where children may be.
 */
export function buildPlaceIndex(input: IndexInput): PlaceIndex {
  const live = input.places.filter((p) => !p.retiredAt);
  const questsAt = countBy(input.quests, (q) => [q.structureKey]);
  const eventsAt = countBy(input.events, (e) => e.structureKeys);
  const rolesAt = countBy(input.roles, (r) => (r.structureKey ? [r.structureKey] : []));
  const anchors = new Map(Array.from(input.anchors.entries()).map(([k, v]) => [fold(k), v] as const));

  const places = live.map((p): PublicPlace | MemberPlace => {
    const k = fold(p.key);
    const base: PublicPlace = {
      key: p.key,
      name: p.name,
      zone: p.zone,
      kind: p.kind,
      stage: p.stage,
      confirmed: p.confirmed && !placeInDoubt(p.disputes),
      readinessPct: p.readinessPct,
      temporary: p.isTemporary,
      successorKey: p.temporarySuccessor,
      setAsideReason: p.setAsideReason,
      isHome: p.isHome,
      anchor: anchors.get(k) ?? null,
      openQuests: questsAt.get(k)?.length ?? 0,
    };
    if (input.tier === "public") return base;
    const steward = placeStewardState(p, input.roles);
    const events = eventsAt.get(k) ?? [];
    return {
      ...base,
      childSafeZone: p.childSafe,
      showcase: p.showcase,
      steward,
      invitationOpen: invitationOpen(p, steward),
      openRoles: (rolesAt.get(k) ?? [])
        .filter((r) => r.state !== "filled")
        .map((r) => ({ roleId: r.id, title: r.name, state: r.state, seats: r.seats, holderCount: r.holderCount })),
      openClaims: input.claims.get(p.key) ?? 0,
      openStageProposals: input.queued.get(p.key) ?? 0,
      eventsSoon: { count: events.length, nextStartsAt: events[0]?.startsAt ?? null },
      photos: input.photos.get(p.key) ?? 0,
    };
  });

  const zones = input.zones.map((z) => ({ key: z.key, name: z.name, positionText: z.positionText }));
  const homes = homesProgress(
    live.map((p) => ({ stage: p.stage, confirmed: p.confirmed && !placeInDoubt(p.disputes), units: p.units ?? undefined })),
    input.homesTarget,
  );
  const body = { tier: input.tier, zones, homes, places };
  return { version: indexVersion(body, input.day), ...body };
}

/** Sixteen hex characters over the body and the day: a fingerprint, never a secret. */
export function indexVersion(body: unknown, day: string): string {
  return crypto.createHash("sha256").update(day).update("\n").update(JSON.stringify(body)).digest("hex").slice(0, 16);
}

export function indexEtag(version: string): string {
  return `"places-${version}"`;
}

// ── Reading it all ───────────────────────────────────────────────────────────

export interface ReadCtx {
  pool: Pool;
  villageId: string;
  /** The published scene's text, or null when the village has never published. */
  scene: () => Promise<string | null>;
  /** The org chart as the map projects it, for this reader's tier. */
  roles: () => Promise<readonly MapOrgRole[]>;
  now: Date;
}

export async function placeIndex(ctx: ReadCtx, tier: Tier): Promise<PlaceIndex> {
  const { pool, villageId, now } = ctx;
  const later = new Date(now.getTime() + EVENTS_SOON_DAYS * 86_400_000);
  const members = tier === "members";
  const [places, zones, scene, quests, meta] = await Promise.all([
    listPlaceRows(pool, villageId),
    listZoneRows(pool, villageId),
    ctx.scene(),
    listOpenQuestsAtPlaces(pool),
    readRegistryMeta(pool),
  ]);
  const empty = new Map<string, number>();
  const [roles, events, queued, claims, photos] = members
    ? await Promise.all([
        ctx.roles(),
        listEventsBetween(pool, now, later),
        countQueuedStageChanges(pool, villageId),
        countOpenClaims(pool, villageId),
        countPhotosByPlace(pool, villageId),
      ])
    : [[], [], empty, empty, empty];
  return buildPlaceIndex({
    tier,
    places,
    zones,
    anchors: anchorsFromScene(scene),
    roles,
    quests,
    events,
    queued,
    claims,
    photos,
    homesTarget: meta.homesTarget,
    day: now.toISOString().slice(0, 10),
  });
}

/** A place by its key or one of its aliases, case folded as the database folds it. */
export function findPlace(places: readonly PlaceRow[], key: string): PlaceRow | null {
  const k = fold(key);
  return places.find((p) => fold(p.key) === k) ?? places.find((p) => p.aliases.some((a) => fold(a) === k)) ?? null;
}

export interface PlaceStewardship {
  steward: {
    state: StewardState | null;
    roleId: string | null;
    roleTitle: string | null;
    /** Where a member steps forward. Null until claims open (S5). */
    claimPath: string | null;
    claimWindowEndsAt: string | null;
  };
  roles: Array<{ roleId: string; title: string; circleId: string | null; state: string; applyPath: string }>;
}

/** The stewardship of one place from rows already read. Role titles only, never a holder. */
export function stewardshipOf(place: PlaceRow, roles: readonly MapOrgRole[]): PlaceStewardship {
  const role = place.stewardRoleId ? roles.find((r) => r.id === place.stewardRoleId) ?? null : null;
  const k = fold(place.key);
  return {
    steward: {
      state: placeStewardState(place, roles),
      roleId: role?.id ?? null,
      roleTitle: role?.name ?? null,
      claimPath: null,
      claimWindowEndsAt: place.claimWindowEndsAt,
    },
    roles: roles
      .filter((r) => r.structureKey && fold(r.structureKey) === k)
      .map((r) => ({ roleId: r.id, title: r.name, circleId: r.circleId, state: r.state, applyPath: ROLE_APPLY_PATH })),
  };
}

/**
 * For the build days lane: who stewards a place, and the roles that sit
 * there. Null for a key the registry does not hold, so a caller says "not
 * known yet" and never guesses.
 */
export async function getPlaceStewardship(
  pool: Pool,
  villageId: string,
  key: string,
  roles: () => Promise<readonly MapOrgRole[]>,
): Promise<PlaceStewardship | null> {
  const place = findPlace(await listPlaceRows(pool, villageId), key);
  if (!place) return null;
  return stewardshipOf(place, await roles());
}

/** Is a place child-safe? Null for a key the registry does not hold. */
export async function getPlaceFlags(
  pool: Pool,
  villageId: string,
  key: string,
): Promise<{ key: string; childSafeZone: boolean; isHome: boolean } | null> {
  const place = findPlace(await listPlaceRows(pool, villageId), key);
  return place ? { key: place.key, childSafeZone: place.childSafe, isHome: place.isHome } : null;
}

export interface PlaceCard {
  place: MemberPlace & {
    positionText: string;
    description: string | null;
    phase: string | null;
    aliases: string[];
    disputes: PlaceRow["disputes"];
    inPreserve: PlaceRow["inPreserve"];
    inRiparian: PlaceRow["inRiparian"];
    targetDate: string | null;
  };
  stewardship: PlaceStewardship;
  /** Holder first names by role id, only on the map's viewPeople tier. */
  holders: Record<string, string[]> | null;
  quests: Array<{ id: string; title: string }>;
  events: Array<{ id: string; title: string; startsAt: string }>;
  permits: { items: Array<Pick<PermitRow, "id" | "title" | "state" | "waitsOn">>; complete: boolean; done: number; total: number };
  links: { serves: string[]; servedBy: string[]; partOf: string | null; parts: string[] };
}

/** One place's card, for a signed-in member. Null for an unknown or retired key. */
export async function placeCard(ctx: ReadCtx, key: string, viewPeople: boolean): Promise<PlaceCard | null> {
  const { pool, villageId } = ctx;
  const rows = await listPlaceRows(pool, villageId);
  const place = findPlace(rows, key);
  if (!place || place.retiredAt) return null;
  const index = await placeIndex(ctx, "members");
  const entry = index.places.find((p) => p.key === place.key) as MemberPlace | undefined;
  if (!entry) return null;
  const [roles, permits, links, quests, events] = await Promise.all([
    ctx.roles(),
    listPermitRows(pool, villageId),
    listLinkRows(pool, villageId),
    listOpenQuestsAtPlaces(pool),
    listEventsBetween(pool, ctx.now, new Date(ctx.now.getTime() + EVENTS_SOON_DAYS * 86_400_000)),
  ]);
  const k = fold(place.key);
  const own = permits.filter((i) => fold(i.place) === k);
  const stewardship = stewardshipOf(place, roles);
  const atPlace = new Set(stewardship.roles.map((r) => r.roleId));
  if (place.stewardRoleId) atPlace.add(place.stewardRoleId);
  const holders = viewPeople
    ? Object.fromEntries(roles.filter((r) => atPlace.has(r.id)).map((r) => [r.id, r.holders.map((h) => h.name)]))
    : null;
  const linkKeys = (pick: (l: LinkRow) => boolean, side: (l: LinkRow) => string) => links.filter(pick).map(side);
  return {
    place: {
      ...entry,
      positionText: place.positionText,
      description: place.description,
      phase: place.phase,
      aliases: place.aliases,
      disputes: place.disputes,
      inPreserve: place.inPreserve,
      inRiparian: place.inRiparian,
      targetDate: place.targetDate,
    },
    stewardship,
    holders,
    quests: quests.filter((q) => fold(q.structureKey) === k).map((q) => ({ id: q.id, title: q.title })),
    events: events.filter((e) => e.structureKeys.some((s) => fold(s) === k)).map((e) => ({ id: e.id, title: e.title, startsAt: e.startsAt })),
    permits: {
      items: own.map((i) => ({ id: i.id, title: i.title, state: i.state, waitsOn: i.waitsOn })),
      complete: permitsComplete(place.key, permits).complete,
      done: own.filter((i) => i.state === "granted" || i.state === "not_needed").length,
      total: own.length,
    },
    links: {
      serves: linkKeys((l) => l.kind === "serves" && fold(l.fromKey) === k, (l) => l.toKey),
      servedBy: linkKeys((l) => l.kind === "serves" && fold(l.toKey) === k, (l) => l.fromKey),
      partOf: linkKeys((l) => l.kind === "part_of" && fold(l.fromKey) === k, (l) => l.toKey)[0] ?? null,
      parts: linkKeys((l) => l.kind === "part_of" && fold(l.toKey) === k, (l) => l.fromKey),
    },
  };
}

// ── The seed import ──────────────────────────────────────────────────────────

export type ImportResult =
  | {
      ok: true;
      addedPlaces: string[];
      keptPlaces: number;
      addedZones: number;
      addedPermits: number;
      addedLinks: number;
      unlinkedStewardTitles: string[];
      /** False when the village has never published a map, so no key could be checked against one. */
      checkedAgainstMap: boolean;
    }
  | { ok: false; problems: string[] };

/**
 * Write a village's place seed. A `place.tend` holder's act, pressed from the
 * admin (the route asks the gate). Never at boot, never in a migration.
 *
 * Refused whole, with every problem named, when `seedProblems` finds any: a
 * seed that drops a key on the live map, confirms a place in doubt or claims a
 * standing stage for an unconfirmed place never writes a row. A steward role
 * is linked by its exact title; a title that matches no live role leaves the
 * place a virtual invitation and is reported, never guessed.
 *
 * Existing rows are kept as they are, so a second import adds what is new and
 * undoes no edit.
 */
export async function importPlacesSeed(
  pool: Pool,
  input: {
    villageId: string;
    by: string;
    seed: unknown;
    /** The published map's keys, or null when the village has never published one. */
    liveKeys: readonly string[] | null;
    roles: readonly { id: string; name: string }[];
    now: Date;
  },
): Promise<ImportResult> {
  const shape = seedShapeProblem(input.seed);
  if (shape) return { ok: false, problems: [shape] };
  const seed = input.seed as PlacesSeed;
  // With no published map there is nothing to check the seed's own map keys
  // against, so they are taken as the seed states them, and the answer says so.
  const liveKeys = input.liveKeys ?? seed.places.filter((p) => p.onMap).map((p) => p.key);
  const problems = seedProblems(seed, liveKeys);
  if (problems.length) return { ok: false, problems };

  const byTitle = new Map(input.roles.map((r) => [r.name.trim().toLowerCase(), r.id]));
  const unlinked: string[] = [];
  const places: PlaceInsert[] = seed.places.map((p) => {
    let stewardRoleId: string | null = null;
    if (p.stewardRoleTitle) {
      stewardRoleId = byTitle.get(p.stewardRoleTitle.trim().toLowerCase()) ?? null;
      if (!stewardRoleId) unlinked.push(`${p.key}: ${p.stewardRoleTitle}`);
    }
    return {
      key: p.key,
      name: p.name,
      zone: p.zone,
      kind: p.kind,
      stage: p.stage,
      confirmed: p.confirmed,
      disputes: p.disputes ?? [],
      aliases: p.aliases ?? [],
      units: p.units ?? null,
      positionText: p.positionText ?? "",
      description: p.description ?? "",
      phase: p.phase ?? null,
      isTemporary: Boolean(p.temporary),
      temporarySuccessor: p.temporary?.successor ?? null,
      setAsideReason: p.setAside?.reason ?? null,
      childSafe: Boolean(p.childSafeZone),
      isHome: Boolean(p.isHome) || Boolean(p.units),
      showcase: Boolean(p.showcase),
      stewardRoleId,
      targetDate: p.targetDate ?? null,
    };
  });
  const links: LinkRow[] = [];
  for (const p of seed.places) {
    if (p.partOf) links.push({ fromKey: p.key, toKey: p.partOf, kind: "part_of" });
    for (const s of p.serves ?? []) links.push({ fromKey: p.key, toKey: s, kind: "serves" });
  }
  const zones = seed.zones.map((z) => ({ key: z.key, name: z.name, sort: z.order, positionText: z.positionText ?? "" }));
  const out = await insertSeed(pool, input.villageId, input.by, { zones, places, permits: seed.permits ?? [], links });

  const meta = dbDocument<RegistryMeta & Record<string, unknown>>(pool, META_KEY, { ...META_FALLBACK });
  await meta.load();
  const was = meta.get();
  await meta.put({
    ...was,
    homesTarget: unitsOrNull(was.homesTarget) ?? unitsOrNull(seed.homesTarget),
    importedAt: input.now.toISOString(),
    importedBy: input.by,
  });
  return {
    ok: true,
    addedPlaces: out.addedPlaces,
    keptPlaces: places.length - out.addedPlaces.length,
    addedZones: out.addedZones,
    addedPermits: out.addedPermits,
    addedLinks: out.addedLinks,
    unlinkedStewardTitles: unlinked,
    checkedAgainstMap: input.liveKeys !== null,
  };
}

/** The envelope a seed must have before its rows are read at all. */
export function seedShapeProblem(seed: unknown): string | null {
  if (!seed || typeof seed !== "object") return "A seed is a JSON object.";
  const s = seed as Record<string, unknown>;
  if (!Array.isArray(s.places) || s.places.length === 0) return "A seed lists its places.";
  if (!Array.isArray(s.zones)) return "A seed lists its zones.";
  if (s.permits !== undefined && !Array.isArray(s.permits)) return "A seed's permits are a list.";
  for (const p of s.places as unknown[]) {
    const r = p as Record<string, unknown> | null;
    if (!r || typeof r.key !== "string" || typeof r.name !== "string" || typeof r.kind !== "string") {
      return "Every place in a seed has a key, a name and a kind.";
    }
  }
  return null;
}

// ── The orphan report ────────────────────────────────────────────────────────

export interface OrphanReport {
  /** Keys the published map draws that the registry does not hold. */
  mapKeysNotRegistered: string[];
  /** Registered places the published map does not draw (listed, never drawn). */
  registeredNotOnMap: string[];
  /** Roles, quests and events that name a place the registry does not hold. */
  rolesAtUnknownPlaces: Array<{ roleId: string; title: string; key: string }>;
  questsAtUnknownPlaces: Array<{ questId: string; key: string }>;
  eventsAtUnknownPlaces: Array<{ eventId: string; key: string }>;
}

/** Pure: what names a place the registry does not hold, and the reverse. */
export function buildOrphanReport(input: {
  places: readonly PlaceRow[];
  anchors: ReadonlyMap<string, Anchor>;
  roles: readonly MapOrgRole[];
  quests: readonly PlaceQuestRow[];
  events: readonly PlaceEventRow[];
}): OrphanReport {
  const known = new Set<string>();
  for (const p of input.places) {
    known.add(fold(p.key));
    for (const a of p.aliases) known.add(fold(a));
  }
  const drawn = new Set(Array.from(input.anchors.keys()).map(fold));
  return {
    mapKeysNotRegistered: Array.from(input.anchors.keys()).filter((k) => !known.has(fold(k))).sort(),
    registeredNotOnMap: input.places
      .filter((p) => !p.retiredAt && !drawn.has(fold(p.key)) && !p.aliases.some((a) => drawn.has(fold(a))))
      .map((p) => p.key)
      .sort(),
    rolesAtUnknownPlaces: input.roles
      .filter((r) => r.structureKey && !known.has(fold(r.structureKey)))
      .map((r) => ({ roleId: r.id, title: r.name, key: r.structureKey as string })),
    questsAtUnknownPlaces: input.quests.filter((q) => !known.has(fold(q.structureKey))).map((q) => ({ questId: q.id, key: q.structureKey })),
    eventsAtUnknownPlaces: input.events.flatMap((e) =>
      e.structureKeys.filter((k) => !known.has(fold(k))).map((k) => ({ eventId: e.id, key: k })),
    ),
  };
}

export async function orphanReport(ctx: ReadCtx): Promise<OrphanReport> {
  const { pool, villageId, now } = ctx;
  const [places, scene, roles, quests, events] = await Promise.all([
    listPlaceRows(pool, villageId),
    ctx.scene(),
    ctx.roles(),
    listOpenQuestsAtPlaces(pool),
    listEventsBetween(pool, now, new Date(now.getTime() + 365 * 86_400_000)),
  ]);
  return buildOrphanReport({ places, anchors: anchorsFromScene(scene), roles, quests, events });
}

/** Re-exported for the route: whether a key a caller sends could be a place key at all. */
export const looksLikeKey = (k: unknown): k is string => typeof k === "string" && k.length > 0 && k.length <= 64 && (isPlaceKey(k) || /^[A-Za-z0-9-]+$/.test(k));
