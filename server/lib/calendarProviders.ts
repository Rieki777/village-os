/**
 * The providers: how every dated fact the village already keeps reaches the
 * one calendar (0085, §9.3, §10.5).
 *
 * Two shapes, and the difference is who holds the pen:
 *
 *   ON SAVE     A module that this lane owns the write path of calls
 *               calendarUpsert from its own save (quests: repos/quests.ts).
 *   MIRRORED    Facts saved outside this zone (gratitude cycles, seasons,
 *               seat terms, loans due, exit notices, milestones, health
 *               snapshots) are reconciled in by the hourly `calendar-mirror`
 *               job below, source named. The fact stays authoritative on its
 *               own row: a settlement timestamp is a legal fact and this
 *               module never writes one, it only draws it. The coordinator
 *               queues "call calendarUpsert on save" with each owner so the
 *               mirror becomes a safety net rather than the only path.
 *
 * The sky is generated, not mirrored: `ensureSky` writes new moons, full
 * moons, the four season instants, the year anchor and (when the village
 * turns them on) the cross-quarters as rows once per year, idempotently, so
 * they are subscribable in the .ics feed and queryable like everything else.
 *
 * WHAT NEVER FIRES FROM HERE. Cycle close and season roll. Both stay human
 * or compute-on-read (scheduler.ts). This file reads their timestamps and
 * writes marks; it moves no value and turns no season.
 */
import type { Pool, RowDataPacket } from "mysql2/promise";
import {
  calendarRemoveMissing,
  calendarUpsert,
  type CalendarUpsertInput,
} from "./calendar";
import {
  cycleBoundsFor,
  cycleBoundsByNumber,
  fullMoonsBetween,
  lunarYearOf,
  newMoonsBetween,
  seasonInstants,
  zonedTimeToUtc,
  type YearAnchor,
} from "../../shared/lunar";
import { formatCycleId } from "./gratitude-cycles";
import { recognitionName } from "./economy";

// ── The sky ─────────────────────────────────────────────────────────────────

export interface SkyOptions {
  /** Which solar event opens the village's lunar year (calendar.year_anchor). */
  anchor: YearAnchor;
  hemisphere: "north" | "south";
  /** Write the four cross-quarter midpoints too (calendar.cross_quarters). */
  crossQuarters: boolean;
  /** Gregorian years to cover, inclusive. */
  years: number[];
}

const SKY = "sky";
const iso = (d: Date) => d.toISOString().slice(0, 16) + "Z";

/** Neutral names: astronomy, nobody's liturgy. */
function seasonTitle(which: "mar" | "jun" | "sep" | "dec"): string {
  return { mar: "March equinox", jun: "June solstice", sep: "September equinox", dec: "December solstice" }[which];
}
function seasonNote(which: "mar" | "jun" | "sep" | "dec", hemisphere: "north" | "south"): string {
  if (which === "mar" || which === "sep") return "Equal day and night.";
  const longest = (which === "jun") === (hemisphere === "north");
  return longest ? "The longest day of the year." : "The shortest day of the year.";
}

/**
 * The sky's rows for the years given, and no others: every sky row whose
 * source id is not among them is marked removed, so turning cross-quarters
 * off or moving the year anchor clears the old marks on the next run.
 * Returns how many rows were written and how many retired.
 */
export async function ensureSky(pool: Pool, opts: SkyOptions): Promise<{ written: number; retired: number }> {
  const keep: string[] = [];
  const write = async (input: Omit<CalendarUpsertInput, "sourceModule" | "kind" | "layer">) => {
    keep.push(input.sourceId);
    await calendarUpsert(pool, { ...input, sourceModule: SKY, kind: "sky", layer: "village" });
  };

  const years = Array.from(new Set(opts.years)).sort();
  for (const year of years) {
    const from = new Date(Date.UTC(year, 0, 1));
    const to = new Date(Date.UTC(year + 1, 0, 1));
    for (const d of newMoonsBetween(from, to)) {
      await write({ sourceId: `sky:new-moon:${iso(d)}`, title: "New moon", startsAt: d, colour: "#1f2937" });
    }
    for (const d of fullMoonsBetween(from, to)) {
      await write({ sourceId: `sky:full-moon:${iso(d)}`, title: "Full moon", startsAt: d, colour: "#d6b25e" });
    }
    const s = seasonInstants(year);
    if (s) {
      const four: Array<["mar" | "jun" | "sep" | "dec", Date]> = [
        ["mar", s.marEquinox], ["jun", s.junSolstice], ["sep", s.sepEquinox], ["dec", s.decSolstice],
      ];
      for (const [which, d] of four) {
        await write({
          sourceId: `sky:${which === "mar" || which === "sep" ? "equinox" : "solstice"}:${iso(d)}`,
          title: seasonTitle(which),
          description: seasonNote(which, opts.hemisphere),
          startsAt: d,
          colour: "#c2410c",
        });
      }
      if (opts.crossQuarters) {
        // The midpoint in time between neighbouring quarter days. The
        // traditional dates sit a day or two off this; the midpoint is what
        // the sky itself offers without anybody's calendar.
        const next = seasonInstants(year + 1);
        const points = [s.marEquinox, s.junSolstice, s.sepEquinox, s.decSolstice, next?.marEquinox].filter((x): x is Date => !!x);
        for (let i = 0; i + 1 < points.length; i++) {
          const mid = new Date((points[i].getTime() + points[i + 1].getTime()) / 2);
          await write({ sourceId: `sky:cross-quarter:${iso(mid)}`, title: "Cross-quarter", description: "Halfway between the quarter days.", startsAt: mid, colour: "#9a3412" });
        }
      }
    }
    // The year anchor: the lunar year opens at the first new moon after the
    // anchor event of this Gregorian year.
    //
    // THE TITLE NO LONGER SAYS "Moon 1", and the reason is the village moon
    // count. This row lands on the calendar once a year, so a member reading
    // "Moon 1 begins" every January would be reading a number that contradicts
    // every other moon label on the same page: those count from the village's
    // founding and never reset. The year still has a first moon and this row
    // still marks it; what it no longer does is give that moon a number.
    const ly = lunarYearOf(year, opts.anchor);
    if (ly) {
      await write({
        sourceId: `sky:year-anchor:${iso(ly.startsAt)}`,
        title: `The village year begins: ${ly.months.length} moons`,
        description: `The first new moon after the ${opts.anchor.replace("_", " ")} opens the village year.`,
        startsAt: ly.startsAt,
        colour: "#0f766e",
      });
    }
  }

  const retired = await calendarRemoveMissing(pool, SKY, keep);
  return { written: keep.length, retired };
}

// ── The mirror ──────────────────────────────────────────────────────────────

export interface MirrorContext {
  /** The village's IANA zone: all-day rows begin at its midnight. */
  timezone: string;
  /** SeasonConfig.seasons as configured; startsOn / endsOn are YYYY-MM-DD. */
  seasons: Array<{ id: string; name: string; startsOn: string; endsOn?: string }>;
  /** Whether a module is served at all. Off modules mirror nothing. */
  moduleOn: (id: string) => boolean;
  now?: Date;
}

const midnightIn = (ymd: string, timeZone: string): Date | null => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return null;
  return zonedTimeToUtc(Number(m[1]), Number(m[2]), Number(m[3]), 0, 0, timeZone);
};

async function tableExists(pool: Pool, name: string): Promise<boolean> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT 1 AS ok FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ? LIMIT 1",
    [name],
  );
  return rows.length > 0;
}

export interface MirrorReport {
  written: Record<string, number>;
  retired: Record<string, number>;
}

/**
 * One pass of the mirror. Each source is reconciled on its own: rows are
 * upserted for every fact that exists now, and rows of that source whose
 * fact is gone are retired. Idempotent, and safe to run every hour.
 */
export async function mirrorCalendarSources(pool: Pool, ctx: MirrorContext): Promise<MirrorReport> {
  const now = ctx.now ?? new Date();
  const report: MirrorReport = { written: {}, retired: {} };
  const runSource = async (sourceModule: string, fill: (write: (i: Omit<CalendarUpsertInput, "sourceModule">) => Promise<void>) => Promise<void>) => {
    const keep: string[] = [];
    await fill(async (i) => {
      keep.push(i.sourceId);
      await calendarUpsert(pool, { ...i, sourceModule });
    });
    report.written[sourceModule] = keep.length;
    report.retired[sourceModule] = await calendarRemoveMissing(pool, sourceModule, keep);
  };

  // Gratitude cycles: the settlement clock's marks. Stored rows carry their
  // own timestamps (legal facts, drawn as saved); the current cycle and the
  // next come from the clock so the close-due mark is always on the calendar.
  await runSource("gratitude", async (write) => {
    const seen = new Set<number>();
    const [rows] = await pool.query<RowDataPacket[]>(
      "SELECT cycle_number, starts_at, ends_at, status FROM gratitude_cycles ORDER BY cycle_number",
    );
    const mark = async (n: number, startsAt: Date, endsAt: Date, status: string) => {
      seen.add(n);
      const id = formatCycleId(n);
      await write({ kind: "cycle-mark", sourceId: `cycle:${n}:open`, title: `Cycle ${n} opens`, description: `${recognitionName()} cycle ${id} begins.`, startsAt, link: "/gratitude", colour: "#0f766e" });
      await write({
        kind: "cycle-mark", sourceId: `cycle:${n}:close`,
        title: status === "closed" ? `Cycle ${n} closed` : `Cycle ${n} closes`,
        description: status === "closed" ? `${recognitionName()} cycle ${id} was settled.` : `${recognitionName()} cycle ${id} ends; settlement is a human act after this.`,
        startsAt: endsAt, link: "/gratitude", colour: "#0f766e",
      });
    };
    for (const r of rows) {
      const n = Number(r.cycle_number);
      const s = r.starts_at instanceof Date ? r.starts_at : new Date(r.starts_at);
      const e = r.ends_at instanceof Date ? r.ends_at : new Date(r.ends_at);
      if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) continue;
      await mark(n, s, e, String(r.status));
    }
    const current = cycleBoundsFor(now);
    for (const n of [current.cycleNumber, current.cycleNumber + 1]) {
      if (seen.has(n)) continue;
      const b = cycleBoundsByNumber(n);
      await mark(n, b.startsAt, b.endsAt, "open");
    }
  });

  // Seasons: one all-day row per dated season, spanning its start to its end.
  await runSource("seasons", async (write) => {
    for (const s of ctx.seasons) {
      const start = s.startsOn ? midnightIn(s.startsOn, ctx.timezone) : null;
      if (!start) continue;
      const end = s.endsOn ? midnightIn(s.endsOn, ctx.timezone) : null;
      await write({ kind: "season", sourceId: `season:${s.id}`, title: s.name || "Season", startsAt: start, endsAt: end, allDay: true, colour: "#65a30d" });
    }
  });

  // Seat terms: a live seating with a term end.
  if (await tableExists(pool, "org_role_assignments")) {
    await runSource("org", async (write) => {
      // AGENTS ARE EXCLUDED (0142). A term end is a date the village agreed
      // to revisit an arrangement with a person, and the whole value of the
      // column is that it turns removal into non-renewal. An agent's seating
      // has nobody to have that conversation with, so a calendar entry saying
      // one is due would put a meeting on the village's calendar that cannot
      // happen. The term-watch notification job filters the same way, for the
      // same reason, and this is its calendar twin.
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT a.id, a.term_ends_at, a.is_example, r.name AS role_name
           FROM org_role_assignments a
           LEFT JOIN org_roles r ON r.id = a.org_role_id
          WHERE a.ended_at IS NULL AND a.term_ends_at IS NOT NULL AND a.is_agent = 0`,
      );
      for (const r of rows) {
        const at = r.term_ends_at instanceof Date ? r.term_ends_at : new Date(r.term_ends_at);
        if (Number.isNaN(at.getTime())) continue;
        await write({
          kind: "seat-term", sourceId: `seat:${r.id}`,
          title: `${r.role_name ?? "A seat"}: term ends`, startsAt: at, link: "/roles", colour: "#7c3aed",
          isExample: Boolean(r.is_example),
        });
      }
    });
  }

  // Loans due: the borrower's own layer.
  if (ctx.moduleOn("library") && (await tableExists(pool, "library_loans"))) {
    await runSource("library", async (write) => {
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT l.id, l.user_id, l.due_on, i.name AS item_name
           FROM library_loans l
           LEFT JOIN library_items i ON i.id = l.item_id
          WHERE l.due_on IS NOT NULL AND l.status IN ('reserved','pickup_pending','active','return_pending')`,
      );
      for (const r of rows) {
        const ymd = r.due_on instanceof Date ? r.due_on.toISOString().slice(0, 10) : String(r.due_on).slice(0, 10);
        const at = midnightIn(ymd, ctx.timezone);
        if (!at) continue;
        await write({
          kind: "loan-due", sourceId: `loan:${r.id}`, layer: "private", ownerUserId: String(r.user_id),
          title: `${r.item_name ?? "A library item"} due back`, startsAt: at, allDay: true, link: "/library", colour: "#b45309",
        });
      }
    });
  } else {
    report.retired.library = await calendarRemoveMissing(pool, "library", []);
  }

  // Exit notices: the leaver and the admins.
  if (await tableExists(pool, "exits")) {
    await runSource("exits", async (write) => {
      const [rows] = await pool.query<RowDataPacket[]>(
        "SELECT id, user_id, notice_ends_at FROM exits WHERE notice_ends_at IS NOT NULL AND status IN ('open','settling')",
      );
      for (const r of rows) {
        const at = r.notice_ends_at instanceof Date ? r.notice_ends_at : new Date(r.notice_ends_at);
        if (Number.isNaN(at.getTime())) continue;
        await write({
          kind: "notice-end", sourceId: `exit:${r.id}`, layer: "admin", ownerUserId: String(r.user_id),
          title: "Notice period ends", startsAt: at, colour: "#be123c",
        });
      }
    });
  }

  // Launch milestones with a date, on the founders' desk.
  if (await tableExists(pool, "milestones")) {
    await runSource("milestones", async (write) => {
      const [rows] = await pool.query<RowDataPacket[]>("SELECT id, title, completed_date, status FROM milestones");
      for (const r of rows) {
        const raw = String(r.completed_date ?? "").trim();
        const at = /^\d{4}-\d{2}-\d{2}/.test(raw) ? midnightIn(raw.slice(0, 10), ctx.timezone) : null;
        if (!at) continue;
        await write({
          kind: "milestone", sourceId: `milestone:${r.id}`, layer: "admin",
          title: String(r.title ?? "Milestone"), description: r.status ? `Status: ${r.status}` : null,
          startsAt: at, allDay: true, colour: "#4338ca",
        });
      }
    });
  }

  // Health snapshots: one mark per lunation snapshotted, admin layer.
  if (ctx.moduleOn("health") && (await tableExists(pool, "health_snapshots"))) {
    await runSource("health", async (write) => {
      const [rows] = await pool.query<RowDataPacket[]>(
        "SELECT cycle_number, MIN(created_at) AS at, COUNT(*) AS n FROM health_snapshots GROUP BY cycle_number",
      );
      for (const r of rows) {
        const n = Number(r.cycle_number);
        const at = r.at instanceof Date ? r.at : new Date(r.at);
        if (!Number.isFinite(n) || Number.isNaN(at.getTime())) continue;
        await write({
          kind: "cycle-mark", sourceId: `snapshot:${n}`, layer: "admin",
          title: `Health snapshot, cycle ${n}`, description: `${Number(r.n)} metric(s) recorded.`,
          startsAt: at, link: "/health", colour: "#0369a1",
        });
      }
    });
  } else {
    report.retired.health = await calendarRemoveMissing(pool, "health", []);
  }

  // Quests: the save path writes on save; this is the safety net for rows
  // edited by an older build or deleted outright.
  await runSource("quests", async (write) => {
    const [rows] = await pool.query<RowDataPacket[]>(
      "SELECT id, title, starts_at, ends_at, due_at, status, is_example FROM quests WHERE starts_at IS NOT NULL OR ends_at IS NOT NULL OR due_at IS NOT NULL",
    );
    for (const r of rows) {
      const q = questCalendarInput({
        id: String(r.id), title: String(r.title ?? ""), status: String(r.status ?? "open"),
        startsAt: r.starts_at, endsAt: r.ends_at, dueAt: r.due_at, isExample: Boolean(r.is_example),
      });
      if (q) await write(q);
    }
  });

  return report;
}

// ── Quests: the on-save shape ───────────────────────────────────────────────

export interface QuestDates {
  id: string;
  title: string;
  status: string;
  startsAt?: unknown;
  endsAt?: unknown;
  dueAt?: unknown;
  isExample?: boolean;
}

const asDate = (v: unknown): Date | null => {
  if (v == null || v === "") return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d;
};

/**
 * A quest's calendar row, or null when it carries no date. A window
 * (starts, ends) is one row spanning it; a bare deadline is a row at the
 * deadline; both together keep the window and put the deadline in the text.
 * A closed or archived quest cancels its mark rather than deleting it.
 */
export function questCalendarInput(q: QuestDates): Omit<CalendarUpsertInput, "sourceModule"> | null {
  const starts = asDate(q.startsAt);
  const ends = asDate(q.endsAt);
  const due = asDate(q.dueAt);
  const startsAt = starts ?? due ?? ends;
  if (!startsAt) return null;
  const endsAt = starts ? (ends ?? null) : null;
  const dueLine = due && starts ? ` Due ${due.toISOString().slice(0, 10)}.` : "";
  const closed = ["closed", "archived", "done", "complete", "completed"].includes(String(q.status).toLowerCase());
  return {
    kind: "quest-window",
    sourceId: `quest:${q.id}`,
    title: q.title || "A quest",
    description: (starts ? "A quest with a window." : "A quest deadline.") + dueLine,
    startsAt,
    endsAt,
    link: `/quests/${q.id}`,
    colour: "#15803d",
    status: closed ? "cancelled" : "scheduled",
    isExample: Boolean(q.isExample),
  };
}
