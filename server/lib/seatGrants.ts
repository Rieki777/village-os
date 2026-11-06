/**
 * HOLDING A SEAT GRANTS ITS POWER GROUPS (Rye, 2026-11-01; ROLE_POWERS_DESIGN.md §3).
 *
 * The two planes 0049 kept apart are joined here, and only here. A seat on the
 * org chart (`org_roles`) may link to Power groups (`roles`) through
 * `org_role_power_groups` (0322). Whoever is seated there, right now, holds
 * those groups' powers, exactly as if they had a `role_holders` row.
 *
 * ── DERIVED ON READ, NEVER WRITTEN ─────────────────────────────────────────
 *
 * Nothing here writes `role_holders`. Copying a seating into it would make two
 * records of one fact, put the copy at the mercy of the whole-table
 * `replaceAll` snapshot (see `withRoleHolderLock`), and need a sweep to take
 * the power away again. Derived on every read, a power ends the moment the
 * seating ends, lapses, or the person leaves, with nothing to clean up.
 *
 * ── WHO A SEATING NEVER EMPOWERS ───────────────────────────────────────────
 *
 *   - a documented holder (no account) or a seating with no user id;
 *   - an agent (0142 `is_agent`, and Rye's Q8: seated agents get no linked
 *     powers), whatever else the row says;
 *   - a standing-example seating, or a seat that is inactive or an example;
 *   - a LAPSED seating: the permission plane's rule ("they expire when they
 *     expire", 0171) reaches bridged powers too, by the org plane's own lapse
 *     test (`isLapsed`: a term, or the season turning) — Rye's Q6;
 *   - a former member (`isFormerMember`). Exit already ends their seatings
 *     (`releaseSeatingsForUser`); this is the second lock on the same door,
 *     because a hand-written row is invisible to review.
 *
 * ── ONE ANSWER FOR EVERY READER ────────────────────────────────────────────
 *
 * `effectiveHoldings` is what the gate (`roleCapabilitiesFor`), the live
 * holder counters (`liveHoldersOfCapability`, `liveHolderCount`), group admin
 * access (server/lib/groupAdmin.ts) and the hand-over signer counts read. A
 * counter that read `role_holders` alone would say "nobody holds org.seat, so
 * it goes to a ballot" while a seated Ops lead holds it. WRITERS keep reading
 * `role_holders` directly: a bridged row is not a row anybody may delete.
 *
 * ── THE CACHE, AND WHY IT IS ONE ───────────────────────────────────────────
 *
 * Every reader above is synchronous and reads in-memory caches; seatings are
 * rows. `SeatGrantCache` holds a snapshot, refreshed at boot, before each API
 * request when older than `maxAgeMs` or marked stale by a seating writer
 * (`onSeatingsChanged`, server/lib/orgChart.ts), on a timer for the jobs that
 * run outside a request, and immediately after a link is written. Lapse is decided at READ
 * time from the raw rows, so a term running out needs no refresh at all. With
 * no links at all (every village until somebody links a seat) a refresh is one
 * small query and the bridge adds nothing.
 */
import type { Pool } from "mysql2/promise";
import { isLapsed, rowToAssignment, ASSIGN_COLS, type LapseContext, type OrgAssignment } from "./orgChart";
import { resolvedExitUserIds } from "../repos/formerMembers";
import { isFormerMember, type FormerMemberFacts } from "./formerMember";

/** One seat-to-group link (0322). */
export interface SeatGroupLink {
  orgRoleId: string;
  roleId: string;
  createdBy?: string | null;
  createdAt?: Date | string | null;
}

/** The org-seat facts the bridge reads. */
export interface SeatFacts {
  id: string;
  active: boolean;
  isExample: boolean;
  expiresEachSeason: boolean | null;
}

/** What one refresh reads, as data, so the decision below stays pure. */
export interface SeatGrantSnapshot {
  links: readonly SeatGroupLink[];
  seatings: readonly OrgAssignment[];
  seats: ReadonlyMap<string, SeatFacts>;
  /**
   * Seated accounts that are former members right now (`isFormerMember`: a
   * resolved exit, not a tombstone, not admitted again), decided at read time.
   */
  formerUserIds: ReadonlySet<string>;
}

/** A holding the bridge derives. Shaped like a `role_holders` row so every reader takes it as one. */
export interface BridgedHolding {
  id: string;
  roleId: string;
  userId: string;
  grantedAt: string;
  termEndsAt: string | null;
  /** The seat this power comes through, so a card and the explainer can say so. */
  viaOrgRoleId: string;
}

export const EMPTY_SNAPSHOT: SeatGrantSnapshot = {
  links: [],
  seatings: [],
  seats: new Map(),
  formerUserIds: new Set(),
};

/** Every holding the seats grant right now. Pure. */
export function bridgedHoldings(snap: SeatGrantSnapshot, ctx: LapseContext): BridgedHolding[] {
  if (snap.links.length === 0) return [];
  const groupsBySeat = new Map<string, string[]>();
  for (const l of snap.links) {
    const list = groupsBySeat.get(l.orgRoleId) ?? [];
    if (!list.includes(l.roleId)) list.push(l.roleId);
    groupsBySeat.set(l.orgRoleId, list);
  }
  const out: BridgedHolding[] = [];
  for (const a of snap.seatings) {
    const groups = groupsBySeat.get(a.orgRoleId);
    if (!groups) continue;
    if (a.endedAt) continue;
    if (a.holderKind !== "member" || !a.userId) continue;
    if (a.isAgent || a.isExample) continue;
    const seat = snap.seats.get(a.orgRoleId);
    if (!seat || !seat.active || seat.isExample) continue;
    if (isLapsed(a, { expiresEachSeason: seat.expiresEachSeason }, ctx).lapsed) continue;
    if (snap.formerUserIds.has(a.userId)) continue;
    for (const roleId of groups) {
      out.push({
        id: `seat:${a.id}:${roleId}`,
        roleId,
        userId: a.userId,
        grantedAt: new Date(a.startedAt).toISOString(),
        termEndsAt: a.termEndsAt ? new Date(a.termEndsAt).toISOString() : null,
        viaOrgRoleId: a.orgRoleId,
      });
    }
  }
  return out;
}

/**
 * The holdings every power READER sees: the direct rows, then each bridged one
 * that is not already a direct row for the same person and group. Deduplicated
 * so `liveHolderCount`, which counts rows, counts a person once.
 */
export function effectiveHoldings<T extends { roleId: string; userId: string }>(
  direct: readonly T[],
  bridged: readonly BridgedHolding[],
): Array<T | BridgedHolding> {
  if (bridged.length === 0) return direct as T[];
  const seen = new Set(direct.map((h) => `${h.roleId}\u0000${h.userId}`));
  const out: Array<T | BridgedHolding> = [...direct];
  for (const b of bridged) {
    const k = `${b.roleId}\u0000${b.userId}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(b);
  }
  return out;
}

/** Whether a holding came through a seat rather than a `role_holders` row. */
export function isBridged(h: { id?: unknown; viaOrgRoleId?: unknown }): h is BridgedHolding {
  return typeof h.viaOrgRoleId === "string";
}

/** Read the links. Raw SQL on purpose, like the org plane (0049): no `replaceAll`. */
export async function listSeatGroupLinks(pool: Pool): Promise<SeatGroupLink[]> {
  const [rows]: any = await pool.query(
    "SELECT org_role_id, role_id, created_by, created_at FROM org_role_power_groups ORDER BY org_role_id, role_id",
  );
  return (rows as any[]).map((r) => ({
    orgRoleId: String(r.org_role_id),
    roleId: String(r.role_id),
    createdBy: r.created_by ?? null,
    createdAt: r.created_at ?? null,
  }));
}

/**
 * Read everything one refresh needs. Only the linked seats' seatings are read.
 * `memberById` supplies the record the former-member test needs; an account
 * with a resolved exit whose record cannot be read counts as former, which is
 * the safe direction.
 */
export async function readSeatGrantSnapshot(
  pool: Pool,
  memberById: (id: string) => Promise<FormerMemberFacts | null | undefined>,
): Promise<SeatGrantSnapshot> {
  const links = await listSeatGroupLinks(pool);
  if (links.length === 0) return EMPTY_SNAPSHOT;
  const seatIds = Array.from(new Set(links.map((l) => l.orgRoleId)));
  const [seatRows]: any = await pool.query(
    "SELECT id, active, is_example, expires_each_season FROM org_roles WHERE id IN (?)",
    [seatIds],
  );
  const [assignRows]: any = await pool.query(
    `SELECT ${ASSIGN_COLS} FROM org_role_assignments WHERE ended_at IS NULL AND org_role_id IN (?)`,
    [seatIds],
  );
  const seats = new Map<string, SeatFacts>();
  for (const r of seatRows as any[]) {
    seats.set(String(r.id), {
      id: String(r.id),
      active: !!r.active,
      isExample: !!r.is_example,
      expiresEachSeason: r.expires_each_season === null || r.expires_each_season === undefined ? null : !!r.expires_each_season,
    });
  }
  const seatings = (assignRows as any[]).map(rowToAssignment);
  const exited = await resolvedExitUserIds(pool);
  const formerUserIds = new Set<string>();
  for (const id of Array.from(new Set(seatings.map((a) => a.userId).filter((u): u is string => !!u && exited.has(u))))) {
    const m = await memberById(id);
    if (!m || isFormerMember(m, true)) formerUserIds.add(id);
  }
  return { links, seatings, seats, formerUserIds };
}

/** The in-process snapshot every synchronous reader shares. */
export class SeatGrantCache {
  private snap: SeatGrantSnapshot = EMPTY_SNAPSHOT;
  private readAt = 0;
  private inFlight: Promise<void> | null = null;

  constructor(
    private readonly read: () => Promise<SeatGrantSnapshot>,
    private readonly maxAgeMs = 1000,
  ) {}

  snapshot(): SeatGrantSnapshot {
    return this.snap;
  }

  /** Read now, sharing one read between concurrent callers. A failed read keeps the last snapshot. */
  refresh(): Promise<void> {
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.read()
      .then((s) => {
        this.snap = s;
        this.readAt = Date.now();
      })
      .catch((err) => {
        console.warn("[seatGrants] refresh failed; keeping the last snapshot", err?.message ?? err);
      })
      .finally(() => {
        this.inFlight = null;
      });
    return this.inFlight;
  }

  /** Mark the snapshot stale, so the next `ensureFresh` reads again. A seating writer calls this. */
  invalidate(): void {
    this.readAt = 0;
  }

  /** Refresh if the snapshot is older than `maxAgeMs`. */
  async ensureFresh(): Promise<void> {
    if (Date.now() - this.readAt < this.maxAgeMs) return;
    await this.refresh();
  }
}
