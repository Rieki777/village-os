/**
 * The weekly brief's facts (round 4, lane L5b, §9.2 A4): everything the
 * digest says, gathered per recipient, with NO model anywhere near it.
 *
 * THE BUDGET RULE, stated so nobody "improves" it: this module never imports
 * `assistant.ts`, never calls a provider, never writes `assistant_usage`,
 * never touches an `assistant-day:` bucket. The brief is a template over
 * readers the village already has (the one calendar read, the stays picture,
 * the org chart, the quest board), the same posture as `assistantTemplates`:
 * a timer must not spend the interactive assistant budget, and a digest that
 * cost tokens weekly per member would be exactly that (K2's rule, the note in
 * `synthesisBatch.test.ts`: a timer has no actor and does not borrow one).
 *
 * Layer visibility is the recipient's own: every calendar read goes through
 * `listCalendarItems` with the recipient as the viewer, so a private or
 * admin-layer item lands only in the briefs of people who could open it.
 *
 * Opportunities come from L7 when it lands: it wires one line,
 * `setOpportunitiesProvider(opportunitiesForBrief)`, and until then the
 * section is empty and therefore omitted, never filler.
 */
import type { Pool, RowDataPacket } from "mysql2/promise";
import { civilParts, newMoonsBetween, zonedTimeToUtc } from "../../shared/lunar";
import { listCalendarItems } from "./calendar";
import { attachWaitlistInfo, whoIsHere, type WhoIsHere } from "./calendarCommunity";
import { listOrgAssignments, listOrgRoles, peopleOnly } from "./orgChart";

// ── The L7 seam ──────────────────────────────────────────────────────────────

export type OpportunitiesProvider = (pool: Pool, userId: string) => Promise<string[]>;

let opportunitiesProvider: OpportunitiesProvider | null = null;

/**
 * L7 calls this once at boot with `opportunitiesForBrief`. Until it does,
 * every brief's opportunities array is empty and the section is omitted.
 */
export function setOpportunitiesProvider(fn: OpportunitiesProvider | null): void {
  opportunitiesProvider = fn;
}

// ── The canvas moon seam (plan 4.4) ─────────────────────────────────────────

/**
 * The block TITLES a new moon's canvas question names, in canvas order.
 * `server/routes/canvasRevisit.ts` hands this over at boot, built on
 * `canvasMoonQuestion` (./canvasMoon.ts). Titles only: never a level, a
 * reading, a sentence or a name.
 */
export type CanvasMoonProvider = (pool: Pool, newMoonAt: Date) => Promise<string[]>;

let canvasMoonProvider: CanvasMoonProvider | null = null;

/** Hand over the canvas moon's reader once, at boot. Until then no brief or digest names a canvas moon. */
export function setCanvasMoonProvider(fn: CanvasMoonProvider | null): void {
  canvasMoonProvider = fn;
}

/**
 * The titles for one new moon, or null when no reader is registered or it
 * failed. Read by the weekly brief below and by the moon digest
 * (./moonDigest.ts), so the two carry the same moon the same way. Never
 * throws: a brief without its canvas line still says what the week holds.
 */
export async function canvasMoonTitles(pool: Pool, newMoonAt: Date): Promise<string[] | null> {
  if (!canvasMoonProvider) return null;
  try {
    const titles = await canvasMoonProvider(pool, newMoonAt);
    return Array.isArray(titles) ? titles.map((t) => String(t ?? "").trim()).filter((t) => t.length > 0) : null;
  } catch (e) {
    console.error("[brief] canvas moon provider failed", e);
    return null;
  }
}

// ── The gathered shape ───────────────────────────────────────────────────────

export interface BriefGathering {
  title: string;
  startsAt: string;
  allDay: boolean;
  place: string | null;
  spotsLeft: number | null;
  waitlistCount: number | null;
  kind: string;
}

export interface WeeklyBriefData {
  weekKey: string;
  timezone: string;
  projectName: string;
  /** Stays: who is on the land, arriving, and recently gone. Counts or names by tier. */
  people: WhoIsHere | null;
  gatherings: BriefGathering[];
  /** Moon and season marks, written by L5a's providers. No astronomy here. */
  marks: Array<{ title: string; startsAt: string; kind: string }>;
  openSeats: { count: number; names: string[] } | null;
  newQuests: { count: number; titles: string[] } | null;
  opportunities: string[];
  /**
   * The canvas moon, when a new moon falls inside the brief's week: its
   * village date and the block titles its question names. Null otherwise, and
   * null when no reader is registered.
   */
  canvasMoon: { date: string; blocks: string[] } | null;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** The UTC instant a village-date string begins. */
function dayStartUtc(dateKey: string, timeZone: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (!m) return new Date(NaN);
  return zonedTimeToUtc(Number(m[1]), Number(m[2]), Number(m[3]), 0, 0, timeZone);
}

/** A village-date string N days after another. */
function addDaysKey(dateKey: string, days: number): string {
  const d = new Date(`${dateKey}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Today's village date, for callers that need a default week key. */
export function villageDateKey(timeZone: string, now = new Date()): string {
  const p = civilParts(now, timeZone);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/**
 * Gather one member's brief for the week that BEGINS on `weekKey` (the
 * evening it goes out): the coming seven days of the calendar and the stays
 * picture, and the past seven days of new quests. Every section fails soft:
 * a reader that throws leaves its section null and takes nothing else with
 * it, because a brief with no seats list still says what is on.
 */
export async function gatherWeeklyBrief(
  pool: Pool,
  opts: {
    userId: string;
    isAdmin: boolean;
    /** map.viewPeople or admin: names in the stays section; counts otherwise. */
    withNames: boolean;
    timezone: string;
    weekKey: string;
    projectName: string;
  },
): Promise<WeeklyBriefData> {
  const from = dayStartUtc(opts.weekKey, opts.timezone);
  const valid = !Number.isNaN(from.getTime());
  const weekKey = valid ? opts.weekKey : villageDateKey(opts.timezone);
  const start = valid ? from : dayStartUtc(weekKey, opts.timezone);
  const to = new Date(start.getTime() + 8 * 86_400_000);
  const viewer = { userId: opts.userId, isAdmin: opts.isAdmin };

  let gatherings: BriefGathering[] = [];
  let marks: WeeklyBriefData["marks"] = [];
  try {
    const items = await listCalendarItems(pool, {
      from: start,
      to,
      viewer,
      timezone: opts.timezone,
      kinds: ["gathering", "festival", "sky", "season", "cycle-mark"],
      limit: 200,
    });
    await attachWaitlistInfo(pool, items, opts.userId);
    for (const i of items) {
      if (i.status === "cancelled") continue;
      if (i.kind === "gathering" || i.kind === "festival") {
        gatherings.push({
          title: i.title,
          startsAt: i.startsAt,
          allDay: i.allDay,
          place: i.locationText,
          spotsLeft: i.spotsLeft,
          waitlistCount: i.waitlistCount ?? null,
          kind: i.kind,
        });
      } else {
        marks.push({ title: i.title, startsAt: i.startsAt, kind: i.kind });
      }
    }
    gatherings = gatherings.slice(0, 20);
    marks = marks.slice(0, 10);
  } catch (e) {
    console.error("[brief] calendar section failed", e);
  }

  let people: WhoIsHere | null = null;
  try {
    people = await whoIsHere(pool, { from: weekKey, to: addDaysKey(weekKey, 7) }, opts.withNames);
  } catch (e) {
    console.error("[brief] stays section failed", e);
  }

  let openSeats: WeeklyBriefData["openSeats"] = null;
  try {
    const [roles, assignments] = await Promise.all([listOrgRoles(pool), listOrgAssignments(pool)]);
    const held = new Map<string, number>();
    // AGENTS DO NOT COUNT HERE (0142). This is a COVERAGE read: the brief
    // tells the village which seats still need somebody, and a seat carried
    // only by a piece of software still needs somebody. Counting an agent
    // would quietly take that seat off the list the village reads on a
    // Monday, which is the one list this whole section exists to produce.
    for (const a of peopleOnly(assignments)) held.set(a.orgRoleId, (held.get(a.orgRoleId) ?? 0) + 1);
    const open = roles.filter((r) => r.active && !r.isExample && (held.get(r.id) ?? 0) < Math.max(1, r.seats));
    openSeats = { count: open.length, names: open.slice(0, 5).map((r) => r.name) };
  } catch (e) {
    console.error("[brief] seats section failed", e);
  }

  let newQuests: WeeklyBriefData["newQuests"] = null;
  try {
    const [rows] = await pool.query<RowDataPacket[]>(
      "SELECT title FROM quests WHERE created_at IS NOT NULL AND created_at >= ? AND created_at < ? " +
        "AND is_example = 0 AND LOWER(status) = 'open' ORDER BY created_at DESC LIMIT 6",
      [new Date(start.getTime() - 7 * 86_400_000), new Date(start.getTime() + 86_400_000)],
    );
    newQuests = { count: rows.length, titles: rows.slice(0, 5).map((r) => String(r.title)) };
  } catch (e) {
    console.error("[brief] quests section failed", e);
  }

  let opportunities: string[] = [];
  if (opportunitiesProvider) {
    try {
      const given = await opportunitiesProvider(pool, opts.userId);
      opportunities = (Array.isArray(given) ? given : [])
        .map((s) => String(s ?? "").trim())
        .filter((s) => s.length > 0)
        .slice(0, 5);
    } catch (e) {
      console.error("[brief] opportunities provider failed", e);
    }
  }

  // The canvas moon: only in the week a new moon falls in, block titles only.
  let canvasMoon: WeeklyBriefData["canvasMoon"] = null;
  const newMoon = newMoonsBetween(start, to)[0];
  if (newMoon) {
    const blocks = await canvasMoonTitles(pool, newMoon);
    if (blocks && blocks.length) {
      const p = civilParts(newMoon, opts.timezone);
      canvasMoon = { date: `${p.year}-${pad(p.month)}-${pad(p.day)}`, blocks };
    }
  }

  return {
    weekKey,
    timezone: opts.timezone,
    projectName: opts.projectName,
    people,
    gatherings,
    marks,
    openSeats,
    newQuests,
    opportunities,
    canvasMoon,
  };
}
