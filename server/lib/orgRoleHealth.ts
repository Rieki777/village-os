/**
 * EVERY ROLE'S HEALTH ON `/api/org`, IN A FIXED NUMBER OF READS (PR 3 of 7).
 *
 * `/roles` shows each holder a "See their card" link and each role the same
 * three facts and a dot the player card's tile shows (shared/playerCardHealth.ts):
 * the term, the review, the signs on track, plus how many tensions raised to
 * the role are still open. The full card loads only when somebody taps the
 * link, so the page never asks the card endpoint once per holder.
 *
 * ── ONE READ PER TABLE, HOWEVER MANY HOLDERS ───────────────────────────────
 *
 * The seatings and the roles arrive already read by the route. Beside them
 * this reads, each once, with `IN (...)` over every id the page needs:
 *
 *   users                   the holders' handles, for the link (member tier)
 *   seat_applications       the terms each live holding was adopted on
 *   role_tensions           open tensions per role (`openTensionCountsFor`,
 *                           the statement the player card counts by)
 *   the sign tables         through the card's memo, each table once
 *
 * `orgRoleHealth.queries.test.ts` holds a page of 40 holders to the count a
 * page of one costs.
 *
 * ── THE TIERS ARE `/api/org`'S ─────────────────────────────────────────────
 *
 *   structure   the term fact (the seat's earliest live term is structure)
 *   terms.read  the review and signs facts, and the open tension count
 *   member      the handle on each holder row, the tier names ride at
 *
 * A fact whose tier the reader lacks is left out, never guessed, exactly as
 * `roleHealth` leaves out a fact whose input was not read. A role nobody holds
 * has no health: there is no holding to be healthy.
 */
import type { Pool } from "mysql2/promise";
import { applicationSettingsOf, handlesOf } from "../repos/orgRoleHealth";
import { openTensionCountsFor } from "./roleTensions";
import { roleHealth, type HealthOut } from "../../shared/playerCardHealth";
import type { SignOut, Slot } from "../../shared/playerCard";
import { isSignKey, type SignKey } from "../../shared/roleSigns";
import { parseSeatSettings, type SeatSettings } from "../../shared/seatSettings";
import { readTermsOffer } from "../../shared/seatTermsOffer";
import type { OrgAssignment, OrgRole } from "./orgChart";
import { signReaderFor } from "./playerCardData";
import { earliestLiveTerm, type SeatTier } from "./seatProjection";

/** One role's health on `/api/org`: the card tile's facts and dot, and its open tensions. */
export interface OrgRoleHealth extends HealthOut {
  /** Tensions raised to the role and not yet answered. Absent below `terms.read`; null when not counted. */
  openTensions?: number | null;
}

export interface OrgRoleExtras {
  /** By role id. Null for a role nobody holds. */
  health?: ReadonlyMap<string, OrgRoleHealth | null>;
  /** A member holder's handle, for "See their card". Member tier only. */
  handleOf?: (userId: string) => string | null;
}

function settingsOf(raw: unknown): SeatSettings | null {
  let v = raw;
  if (typeof v === "string") {
    try {
      v = JSON.parse(v);
    } catch {
      return null;
    }
  }
  const parsed = parseSeatSettings(v ?? null);
  return parsed.ok ? parsed.settings : null;
}

function offerOf(role: OrgRole): SeatSettings | null {
  const r = readTermsOffer(role.termsOffer);
  return r.ok ? r.settings ?? null : null;
}

/**
 * The health of every active role and the holders' handles, at this reader's
 * tier, for `/api/org` to hand to `projectSeats`.
 */
export async function orgRoleExtras(
  pool: Pool,
  roles: readonly OrgRole[],
  assignments: readonly OrgAssignment[],
  tier: SeatTier,
  ctx: { now: Date; timeZone: string; seasonId: string | null },
): Promise<OrgRoleExtras> {
  const active = roles.filter((r) => r.active);
  const live = assignments.filter((a) => !a.endedAt && !a.isExample);
  const byRole = new Map<string, OrgAssignment[]>();
  for (const a of live) {
    const list = byRole.get(a.orgRoleId) ?? [];
    list.push(a);
    byRole.set(a.orgRoleId, list);
  }
  const memberIds = Array.from(new Set(live.filter((a) => a.holderKind === "member" && a.userId).map((a) => String(a.userId))));
  const heldRoles = active.filter((r) => (byRole.get(r.id) ?? []).length > 0);
  const appIds = Array.from(new Set(live.map((a) => a.applicationId).filter((x): x is string => !!x)));

  const none = new Map<string, never>();
  const [handles, apps, tensions] = await Promise.all([
    tier.people === "member" ? handlesOf(pool, memberIds) : Promise.resolve(none),
    tier.terms ? applicationSettingsOf(pool, appIds) : Promise.resolve(none),
    tier.terms ? openTensionCountsFor(pool, heldRoles.map((r) => r.id)) : Promise.resolve(null),
  ]);

  const out: OrgRoleExtras = {};
  if (tier.people === "member") out.handleOf = (userId) => handles.get(String(userId)) ?? null;
  if (!tier.structure) return out;

  // The terms each role is held on: the earliest holding's adopted terms, else the offer.
  const appSettings = new Map(Array.from(apps, ([id, raw]) => [id, settingsOf(raw)] as const));
  const settingsFor = (role: OrgRole): SeatSettings | null => {
    for (const h of byRole.get(role.id) ?? []) {
      const s = h.applicationId ? appSettings.get(h.applicationId) : null;
      if (s) return s;
    }
    return offerOf(role);
  };

  // Every sign any role names with a target, counted once for the page.
  const wanted: Array<{ key: SignKey; circleId: string | null }> = [];
  const settingsByRole = new Map<string, SeatSettings | null>();
  if (tier.terms) {
    for (const r of heldRoles) {
      const s = settingsFor(r);
      settingsByRole.set(r.id, s);
      for (const m of s?.scoreboard?.measures ?? []) {
        if (m.countedBy && m.targetCount !== undefined && isSignKey(m.countedBy)) wanted.push({ key: m.countedBy, circleId: r.circleId ?? null });
      }
    }
  }
  const signs = wanted.length
    ? await signReaderFor(pool, wanted, { now: ctx.now, timeZone: ctx.timeZone, season: ctx.seasonId ? { id: ctx.seasonId } : null })
    : null;

  const health = new Map<string, OrgRoleHealth | null>();
  for (const r of active) {
    const held = byRole.get(r.id) ?? [];
    if (!held.length) {
      health.set(r.id, null);
      continue;
    }
    const settings = tier.terms ? settingsByRole.get(r.id) ?? null : undefined;
    const measures = (settings?.scoreboard?.measures ?? []).filter((m) => m.countedBy && m.targetCount !== undefined);
    const signSlot: Slot<SignOut[]> = {
      kind: "shown",
      value: measures.map((m) => {
        const reading = signs?.(m.countedBy ?? null, r.circleId ?? null)?.reading ?? { kind: "not-counted", key: m.countedBy ?? null, words: "Not counted yet" };
        return {
          roleId: r.id,
          roleTitle: r.name,
          measure: m.measure,
          value: "",
          from: null,
          reading,
          target: { n: m.targetCount!, source: "settings.scoreboard.measures.targetCount" },
          sheetKey: null,
        } as SignOut;
      }),
    };
    const base = roleHealth({ termEndsAt: earliestLiveTerm(held), settings }, signSlot, ctx.now, ctx.timeZone);
    if (!base) {
      health.set(r.id, null);
      continue;
    }
    health.set(r.id, tier.terms ? { ...base, openTensions: tensions ? tensions.get(r.id) ?? 0 : null } : base);
  }
  out.health = health;
  return out;
}
