/**
 * THE VILLAGE'S LIVE ORGANISATION, AS THE LIVING MAP DRAWS IT (Rye, D3).
 *
 * "We need to wire it up so the map can realtime update to new seats, and
 * circle structures, etc." The map draws seats on the land, and until now the
 * seats it drew were the published scene's own `org_roles`: sixteen names a
 * person typed into the map, which on 2026-10-01 matched none of the
 * village's twenty-five roles (F03). The village keeps its real circles and
 * roles in `circles`, `org_roles` and `org_role_assignments`, and changes them
 * through the org tools. This is the one projection of those three tables the
 * map reads, so a seat created elsewhere reaches an open map without a reload.
 *
 * ── WHY A PROJECTION OF ITS OWN, AND NOT `/api/map` ────────────────────────
 *
 * The map asks this question every few seconds while it is open, and most of
 * the time the answer is "nothing changed". `/api/map` is the org chart's
 * whole payload (quests, relations, the power glossary, the season ring, a
 * viewer's declare rights) and costs a query for each. This carries exactly
 * what the land draws, so a poll is three small reads and a hash, and an
 * unchanged answer is a 304 with no body.
 *
 * IT CANNOT DISAGREE WITH THE ORG CHART about what a seat IS, because it asks
 * the same questions the same way: `seatState` for open, partial, filled,
 * forming and expired, active seats only, example rows left out, and holder
 * names only on the `viewPeople` tier.
 *
 * ── THE VERSION IS THE ANSWER ITSELF ───────────────────────────────────────
 *
 * The version is a hash of the projected body, never a counter or a
 * timestamp. A counter has to be bumped by every writer and the first one
 * that forgets ships a map that never updates; a `MAX(updated_at)` misses a
 * delete and a lapse. A hash of what the map would draw changes exactly when
 * what the map would draw changes, including a term running out at midnight
 * with no write anywhere. It also differs by tier on purpose: a reader who
 * sees names and one who does not are handed different bodies.
 *
 * NO RAW SQL HERE. The reads are `orgChart.ts`'s and the circles come from the
 * collection the org tools write through, so nothing in this file can drift
 * from what the rest of the platform reads.
 */
import crypto from "node:crypto";
import { colourForCircle } from "../../shared/circleView";
import { seatState, type OrgAssignment, type OrgRole, type SeatState } from "./orgChart";

/** One circle, with the colour the circles view already draws it in. */
export interface MapOrgCircle {
  id: string;
  name: string;
  parentCircleId: string | null;
  /** active, forming or dormant (shared/draftKinds.ts CIRCLE_STATUSES). */
  status: string;
  order: number;
  /** A hex from the map's own palette, so a circle is the same hue on both views. */
  colour: string;
}

/** Who sits in a seat. Only ever sent on the viewPeople tier. */
export interface MapOrgHolder {
  name: string;
  lapsed: boolean;
  isAgent: boolean;
}

export interface MapOrgRole {
  id: string;
  name: string;
  circleId: string | null;
  seats: number;
  holderCount: number;
  state: SeatState;
  /** Class tags: a suggestion of what to show first, never a permission. */
  archetypes: string[];
  /** The seat's aim, in the village's own words. */
  description: string;
  holders: MapOrgHolder[];
}

export interface MapOrgSnapshot {
  /** A hash of everything below it. Equal versions draw identically. */
  version: string;
  viewPeople: boolean;
  circles: MapOrgCircle[];
  roles: MapOrgRole[];
}

export interface MapOrgInput {
  circles: readonly any[];
  roles: readonly OrgRole[];
  assignments: readonly OrgAssignment[];
  viewPeople: boolean;
  /** A member holder's display name, as the org chart prints it (a first name). */
  memberName(userId: string): string;
  now?: Date;
}

const str = (v: unknown): string => (v == null ? "" : String(v));
const strOrNull = (v: unknown): string | null => {
  const s = str(v).trim();
  return s ? s : null;
};

/**
 * The snapshot, ordered the way the org tools order it so two reads of an
 * unchanged village hash the same: circles by their sort order then id, roles
 * as `listOrgRoles` returns them (sort order, then name), holders by the order
 * they were seated.
 */
export function projectMapOrg(input: MapOrgInput): MapOrgSnapshot {
  const circles: MapOrgCircle[] = (Array.isArray(input.circles) ? input.circles : [])
    .filter((c) => c && !c.isExample && strOrNull(c.id) && strOrNull(c.name))
    .map((c) => ({
      id: str(c.id),
      name: str(c.name).trim(),
      parentCircleId: strOrNull(c.parentCircleId),
      status: strOrNull(c.status) ?? "active",
      order: Number(c.order) || 0,
      colour: colourForCircle({ id: str(c.id), color: c.color ?? null }),
    }))
    .sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const heldBySeat = new Map<string, OrgAssignment[]>();
  for (const a of input.assignments) {
    const list = heldBySeat.get(a.orgRoleId) ?? [];
    list.push(a);
    heldBySeat.set(a.orgRoleId, list);
  }

  const roles: MapOrgRole[] = input.roles
    .filter((r) => r.active && !r.isExample)
    .map((r) => {
      const held = heldBySeat.get(r.id) ?? [];
      return {
        id: r.id,
        name: r.name,
        circleId: r.circleId ?? null,
        seats: r.seats,
        holderCount: held.length,
        state: seatState(r, held, input.now),
        archetypes: Array.isArray(r.archetypes) ? r.archetypes.map(String) : [],
        description: r.aim ?? "",
        holders: input.viewPeople
          ? held.map((h) => ({
              // A documented holder is a real person with no account yet, so
              // there is a name to show and no profile behind it.
              name: h.holderKind === "member" && h.userId ? input.memberName(h.userId) : str(h.displayName),
              lapsed: !!h.lapsed,
              isAgent: !!h.isAgent,
            }))
          : [],
      };
    });

  const body = { viewPeople: input.viewPeople, circles, roles };
  return { version: mapOrgVersion(body), ...body };
}

/** Sixteen hex characters of SHA-1 over the body's JSON: a fingerprint, not a secret. */
export function mapOrgVersion(body: Omit<MapOrgSnapshot, "version">): string {
  return crypto.createHash("sha1").update(JSON.stringify(body)).digest("hex").slice(0, 16);
}

/** The ETag header for a version. Strong, because the body is byte-for-byte determined by it. */
export function mapOrgEtag(version: string): string {
  return `"org-${version}"`;
}

/**
 * Does an If-None-Match header name this version?
 *
 * A proxy that compresses the body is allowed to weaken a strong tag to
 * `W/"..."` on the way out, and the browser then sends the weak form back. The
 * comparison for a GET is the weak one (RFC 9110 13.1.2), so both forms
 * match, and so does a list and the `*` wildcard.
 */
export function etagHits(header: string | string[] | undefined, version: string): boolean {
  if (!header || !version) return false;
  const raw = Array.isArray(header) ? header.join(",") : header;
  const want = mapOrgEtag(version);
  return raw
    .split(",")
    .map((t) => t.trim().replace(/^W\//, ""))
    .some((t) => t === "*" || t === want);
}
