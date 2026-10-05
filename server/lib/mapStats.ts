/**
 * Counting what the crown bar's chips read (shared/mapStatChips.ts).
 *
 * One function per source, each reading rows the village already keeps and
 * most of them reusing a read that already exists, so the bar and the page
 * the number comes from cannot drift: the gratitude given is the snapshot's
 * own arithmetic, the open seats are `seatState`'s, the gatherings are the
 * calendar's own read, and the land's numbers are `regenTotals`.
 *
 * WHO MAY SEE A READING. A source that reads a module's data is drawn only
 * for a viewer who could open that module, by the rule `/api/modules` applies
 * (server/index.ts): public for anyone, members for anyone signed in, preview
 * for an admin, off for nobody. A source on core data needs nothing more than
 * the map itself, whose own gate (`requireModule("map")`) already stands in
 * front of every route that serves these. ONE EXCEPTION, read first: a source
 * marked `membersOnly` (the treasury, Rye 2026-10-05: "Treasury balance shown
 * to members only") is drawn only for a member the village has let in, or an
 * admin. A visitor, and a guest with an account the village has not admitted,
 * get the chip withheld exactly as a closed module's chip is withheld.
 *
 * WHAT IT COSTS. The map refreshes its chips every minute, so every open map
 * asks. Each reading is held for MAP_STATS_TTL_MS and concurrent asks share
 * one count, so a busy evening costs one query per source per half minute,
 * however many people are looking. Visibility is decided per request and
 * never cached, because it is the one part that depends on who is asking.
 */
import type { Pool } from "mysql2/promise";
import {
  MAP_STATS_TTL_MS,
  REGEN_SOURCE_METRIC,
  STAT_SOURCES,
  type StatReading,
  type StatSourceKey,
} from "../../shared/mapStatChips";
import { MODULES } from "../../shared/modules";
import { zonedTimeToUtc } from "../../shared/lunar";
import { effectiveLifecycle } from "./modules";
import { currentCycle } from "./gratitude-cycles";
import { fromLedgerUnits, villageId } from "./economy";
import { TREASURY, balanceOf, tokenDef } from "./ledger";
import { stringVar } from "./variables";
import { listOrgAssignments, listOrgRoles, seatState, type LapseContext } from "./orgChart";
import { listGatherings } from "./gatherings";
import { regenTotals } from "./health";
import { givenByRealMembersInWindow, reversedFromRealMembersInWindow } from "../repos/gratitude";
import { realMemberIdRows } from "../repos/users";
import { questClosed } from "../repos/quests";
import { countActiveMembers, countConsentedClaims, countLiveCircles, realQuestStatuses } from "../repos/mapStats";

export interface MapStatsDeps {
  getPool(): Pool;
  seasonState(): { current: any; timezone: string };
  lapseContext(): LapseContext;
  /** Tests pass a clock; routes leave it. */
  now?(): Date;
}

/** Who is asking, as far as a module's lifecycle and a members-only source care. */
export interface StatViewer {
  /** Signed in, with any account. What a module at `members` asks for. */
  authed: boolean;
  admin: boolean;
  /**
   * Signed in AND let in by the village: `isAdmitted` (server/lib/admission.ts),
   * the house's one answer to "is this person a member", which is a steward's
   * grant or a rung placed by hand at Member or above. A guest has an account
   * and is not a member. What a `membersOnly` source asks for.
   */
  member: boolean;
}

const moduleName = (id: string) => MODULES.find((m) => m.id === id)?.name ?? id;

/**
 * Why this viewer may not see a source's reading, or null when they may.
 * The sentence is for the founder's editor; the public read never sends it.
 */
export function sourceHiddenFrom(key: StatSourceKey, viewer: StatViewer): string | null {
  const def = STAT_SOURCES[key];
  if (def.membersOnly && !viewer.member && !viewer.admin) {
    return `${def.label} is for members only, so a visitor or a guest does not see this chip.`;
  }
  const id = def.module;
  if (!id) return null;
  const lc = effectiveLifecycle(id);
  if (lc === "public") return null;
  if (lc === "members") {
    return viewer.authed || viewer.admin
      ? null
      : `${moduleName(id)} is open to members only, so a visitor does not see this chip.`;
  }
  if (lc === "preview") {
    return viewer.admin ? null : `${moduleName(id)} is in preview, so only an admin sees this chip.`;
  }
  return `${moduleName(id)} is switched off, so this chip is not drawn.`;
}

/** The day a season starts, as the instant the village's own clock reads midnight. */
function seasonStart(startsOn: unknown, timeZone: string): Date | null {
  const m = typeof startsOn === "string" ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(startsOn) : null;
  if (!m) return null;
  return zonedTimeToUtc(Number(m[1]), Number(m[2]), Number(m[3]), 0, 0, timeZone || "UTC");
}

/**
 * The places a live seat has for somebody. A seat the village has marked
 * filled or still forming has none. One that is open, partly held, or held by
 * somebody whose term ran out has at least one, which is what its own state
 * already says.
 */
export function openPlaces(
  role: { seats?: number | null },
  state: string,
  holders: Array<{ lapsed?: boolean }>,
): number {
  if (state === "filled" || state === "forming") return 0;
  const seats = Math.max(1, Math.floor(Number(role.seats) || 1));
  const current = holders.filter((h) => !h.lapsed).length;
  return Math.max(1, seats - current);
}

/**
 * What the village treasury holds of the village's value token, in WHOLE tokens.
 *
 * ONE ACCOUNT, ONE TOKEN, never a sum. The account is `sys:treasury`
 * (`TREASURY`), the one the exchange sells from and seat fees settle into. The
 * token is the one `gratitude.pool_token` names, the same rule the cycle
 * close, `/api/game/config` (`currency.value`) and the launch check
 * `pool-token-spendable` read for "the value token". The health snapshot's
 * `treasury_balance` is not reused: it adds every token in this account
 * together, kinds and scales mixed.
 *
 * READ THROUGH THE LEDGER. `balanceOf` is the ledger's own read of the
 * `token_balances` cache, which postings recompute and nothing here writes.
 * It answers MINOR units; `fromLedgerUnits` scales them by the registry's
 * `decimals` for this token, so no number of places is assumed here. The
 * fraction is then left off (truncated toward zero), so the chip shows whole
 * tokens and never more than the account holds.
 *
 * A dial pointed at something that is not a platform token this ledger
 * moves, or at recognition, has no treasury balance a chip could honestly
 * show, and says why for the founder's editor.
 */
export async function treasuryReading(pool: Pool): Promise<{ n: number; sub: string } | { why: string }> {
  const slug = String(stringVar("gratitude.pool_token") ?? "").trim();
  const def = slug ? tokenDef(slug) : undefined;
  if (!def) {
    return { why: `The cycle pool is set to pay "${slug}", which is not a token this village issues, so there is no treasury balance to show.` };
  }
  if (def.governance !== "platform") {
    return { why: `${def.name} is kept on another ledger, so this village's treasury holds none of it here.` };
  }
  if (def.kind === "recognition") {
    return { why: `${def.name} is recognition, which carries no value of its own, so there is no treasury balance to show.` };
  }
  const units = await balanceOf(pool, TREASURY, def.slug);
  const whole = Math.trunc(fromLedgerUnits(def.slug, units)) || 0;
  return { n: whole, sub: `${def.name} held in the treasury` };
}

/** Count one source. Throws when the data cannot be read; the cache turns that into a reason. */
export async function countSource(
  key: StatSourceKey,
  deps: MapStatsDeps,
): Promise<number | { n: number; sub: string } | { why: string }> {
  const pool = deps.getPool();
  const now = deps.now?.() ?? new Date();
  const cycle = () => {
    const c = currentCycle(now);
    return { start: new Date(c.startsAt), end: new Date(c.endsAt) };
  };
  switch (key) {
    case "members":
      return (await realMemberIdRows(pool)).length;
    case "members_active": {
      const { start, end } = cycle();
      return countActiveMembers(pool, start, end);
    }
    case "quests_open":
      return (await realQuestStatuses(pool)).filter((s) => !questClosed(s)).length;
    case "quests_done_cycle": {
      const { start, end } = cycle();
      return countConsentedClaims(pool, start, end);
    }
    case "quests_done_season": {
      const season = deps.seasonState();
      const start = seasonStart(season?.current?.startsOn, season?.timezone);
      if (!start) return { why: "No season is running, so there is no season to count from." };
      // Consent is stamped when it happens, so nothing lies past now. A day of
      // slack keeps a clock a little ahead of the database's from losing one.
      return countConsentedClaims(pool, start, new Date(now.getTime() + 86_400_000));
    }
    case "gratitude_cycle": {
      const { start, end } = cycle();
      // The snapshot's own arithmetic (`snapshotAllowance`, server/lib/health.ts):
      // what real members gave, less what was reversed, floored at zero.
      const [given] = await givenByRealMembersInWindow(pool, villageId(), start, end);
      const [back] = await reversedFromRealMembersInWindow(pool, villageId(), start, end);
      return Math.max(0, Number(given?.given ?? 0) - Number(back?.back ?? 0));
    }
    case "seats_open": {
      const [roles, live] = await Promise.all([
        listOrgRoles(pool),
        listOrgAssignments(pool, deps.lapseContext()),
      ]);
      let open = 0;
      for (const role of roles) {
        if (!role.active || role.isExample) continue;
        const held = live.filter((a) => a.orgRoleId === role.id);
        open += openPlaces(role, seatState(role, held, now), held);
      }
      return open;
    }
    case "circles":
      return countLiveCircles(pool);
    case "gatherings_ahead": {
      // As a visitor reads the calendar: no viewer, no drafts. The bar is the
      // same answer for everyone, so it counts what everyone may see.
      const items = await listGatherings(pool, {
        userId: null,
        isAdmin: false,
        upcomingDays: 30,
        pastVisibleDays: 0,
        timezone: deps.seasonState()?.timezone || "UTC",
        limit: 2000,
      });
      return items.filter((i) => !i.isExample).length;
    }
    case "trees_planted":
    case "food_produced":
    case "water_protected":
    case "hectares_restored":
    case "carbon_sequestered": {
      const totals = await regenTotals(pool);
      return Number(totals[REGEN_SOURCE_METRIC[key]]?.total ?? 0);
    }
    case "treasury":
      return treasuryReading(pool);
  }
}

/**
 * The readings, held for a short while and shared between everyone asking.
 *
 * A failed count is held too, for the same short while: a table that is
 * missing on this deployment would otherwise be asked again by every open map
 * every minute. It is logged once per failure, never per request.
 */
export function createStatReader(deps: MapStatsDeps, ttlMs = MAP_STATS_TTL_MS) {
  const held = new Map<StatSourceKey, { at: number; reading: StatReading }>();
  const inflight = new Map<StatSourceKey, Promise<StatReading>>();
  const clock = () => (deps.now?.() ?? new Date()).getTime();

  async function fresh(key: StatSourceKey): Promise<StatReading> {
    const kept = held.get(key);
    if (kept && clock() - kept.at < ttlMs) return kept.reading;
    const running = inflight.get(key);
    if (running) return running;
    const job = (async (): Promise<StatReading> => {
      let reading: StatReading;
      try {
        const n = await countSource(key, deps);
        const countedAt = new Date(clock()).toISOString();
        reading = typeof n === "number"
          ? { ok: true, n, countedAt }
          : "why" in n
            ? { ok: false, why: n.why }
            : { ok: true, n: n.n, sub: n.sub, countedAt };
      } catch (e) {
        console.error(`[map chips] could not count ${key}:`, e);
        reading = { ok: false, why: "This could not be counted just now." };
      }
      held.set(key, { at: clock(), reading });
      return reading;
    })();
    inflight.set(key, job);
    try {
      return await job;
    } finally {
      inflight.delete(key);
    }
  }

  return {
    /** What this viewer may see of each source asked for. Hidden sources are never counted. */
    async readings(keys: readonly StatSourceKey[], viewer: StatViewer): Promise<Partial<Record<StatSourceKey, StatReading>>> {
      const out: Partial<Record<StatSourceKey, StatReading>> = {};
      await Promise.all(
        keys.map(async (key) => {
          const hidden = sourceHiddenFrom(key, viewer);
          out[key] = hidden ? { ok: false, why: hidden } : await fresh(key);
        }),
      );
      return out;
    },
    /** Forget every held reading. A founder's save calls it, so the preview is now. */
    forget(): void {
      held.clear();
    },
  };
}
