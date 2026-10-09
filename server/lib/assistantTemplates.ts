/**
 * Saying what a reader found, without a model (S78, Lane K1).
 *
 * A live measurement of the organize assistant found that seven of its ten
 * demo questions were structured lookups: the model opened one reader, read a
 * list of rows, and wrote a sentence saying how many there were and what they
 * were called. That sentence costs two upstream POSTs and about 7,400 input
 * tokens, and this file writes the same sentence for nothing.
 *
 * Each renderer takes ONE reader's data, already through `capTokens`, and
 * returns the organize route's own response shape so the transparency line in
 * the client renders exactly as it did. A reader key still goes into
 * `consulted.readers`, because the village record really was read and the
 * person asking is entitled to know which shelf the answer came off.
 *
 * THE RULE THAT MAKES THIS SAFE: a renderer never throws and never guesses. It
 * returns null the moment the data is not the shape it expected, and the route
 * falls through to a road that involves the model. Every branch below that
 * returns null is a case where a template COULD have written a confident
 * sentence and the sentence might have been wrong, which is the one failure
 * worse than an expensive answer. Truncation is the live example: `capTokens`
 * sheds rows from the end, so a template that counted what survived would
 * quietly under-report a village big enough to hit the cap.
 *
 * These strings are shipped copy. They are held to the house writing rules by
 * `scripts/check-voice.mjs`, which reads string literals in this directory.
 */

import { villageTimezone } from "./villageReaders";
import { renderCanvasAnswers, renderCanvasLibrary, renderMatrixRows } from "./companionCanvas";
import { canvasMoonLine } from "../../shared/canvasRevisit";

/** The organize route's response shape, so the client renders it unchanged. */
export interface Rendered {
  reply: string;
  consulted: { ownRecord: string[]; references: string[]; readers: string[] };
}

export type Renderer = (data: unknown) => Rendered | null;

/**
 * How many names one sentence will carry before it rolls the tail into a
 * count. A reader's own `maxTokens` already caps the payload, and 120 quest
 * titles inside one paragraph is still unreadable at the cap.
 */
const MAX_NAMED = 20;

function out(key: string, reply: string): Rendered {
  return { reply, consulted: { ownRecord: [], references: [], readers: [key] } };
}

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

/**
 * The rows a reader returned, and how many it dropped.
 *
 * `capTokens` returns the array untouched when it fits, `{items, truncated}`
 * when an array had to shed its tail, and `{truncated: true, note}` when a
 * non-array was too big at all. The third shape carries no rows, so it reads
 * as null here and the caller falls through.
 */
function asRows(data: unknown): { rows: Record<string, unknown>[]; more: number } | null {
  if (Array.isArray(data)) return { rows: data as Record<string, unknown>[], more: 0 };
  if (data && typeof data === "object") {
    const o = data as Record<string, unknown>;
    if (Array.isArray(o.items)) {
      const more = Number(o.truncated ?? 0);
      return { rows: o.items as Record<string, unknown>[], more: Number.isFinite(more) && more > 0 ? more : 0 };
    }
  }
  return null;
}

/** Non-empty strings under one field, in the reader's own order. */
function field(rows: Record<string, unknown>[], key: string): string[] {
  return rows.map((r) => String(r[key] ?? "").trim()).filter((s) => s.length > 0);
}

function named(values: string[], dropped: number): string {
  const shown = values.slice(0, MAX_NAMED);
  const hidden = dropped + (values.length - shown.length);
  const list = shown.join(", ");
  return hidden > 0 ? `${list}, and ${hidden} more` : list;
}

/**
 * "Tue 18:00" in the village's own zone (round 4, lane L6). Falls back to UTC
 * when the zone name is bad, because a template that throws takes the answer
 * with it and a wrong-zone time is at least a time.
 */
export function clockIn(iso: string, timeZone: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const fmt = (tz: string) =>
    new Intl.DateTimeFormat("en-GB", { timeZone: tz, weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
  try {
    return fmt(timeZone).replace(",", "");
  } catch {
    return fmt("UTC").replace(",", "");
  }
}

/** The one renderer that reads a clock. Kept out of the table so it can be given the zone. */
export function renderWeek(data: unknown, timeZone: string): Rendered | null {
  const r = asRows(data);
  if (!r) return null;
  const total = r.rows.length + r.more;
  if (total === 0) return out("events.week", "Nothing is on the calendar for the next seven days.");
  const named = r.rows
    .map((x) => {
      const title = String(x.title ?? "").trim();
      const when = clockIn(String(x.startsAt ?? ""), timeZone);
      if (!title || !when) return "";
      return `${title} (${when})`;
    })
    .filter((s) => s.length > 0);
  if (named.length === 0) return null;
  const shown = named.slice(0, MAX_NAMED);
  const hidden = r.more + (named.length - shown.length);
  const list = hidden > 0 ? `${shown.join(", ")}, and ${hidden} more` : shown.join(", ");
  return out("events.week", `This week: ${total} ${plural(total, "gathering", "gatherings")}: ${list}.`);
}

// ── The weekly brief (round 4, lane L5b) ────────────────────────────────────

/**
 * What `renderWeeklyBrief` says, in three forms: an email subject, a one-line
 * body for the in-app notification, and the full text and HTML.
 */
export interface RenderedBrief {
  subject: string;
  line: string;
  text: string;
  html: string;
}

/** "Mon 25 Aug" from a village-date key. UTC noon dodges every boundary. */
function briefDay(dateKey: unknown): string {
  const d = new Date(`${String(dateKey ?? "")}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return String(dateKey ?? "");
  return new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" }).format(d);
}

const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * The zero-token weekly digest (§9.2 A4). Deliberately a STANDALONE export
 * and not a `RENDERERS` entry: that table is keyed by reader for the organize
 * route, and this renders a gathered document, on a timer, for delivery.
 *
 * Same rule as every renderer in this file: never throws, and a section whose
 * data is not the shape it expects is DROPPED, never guessed at. An empty
 * section is omitted; a wholly quiet week still sends one honest line.
 */
export function renderWeeklyBrief(input: unknown): RenderedBrief | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const d = input as Record<string, any>;
  const projectName = String(d.projectName ?? "").trim() || "the village";
  const timeZone = typeof d.timezone === "string" && d.timezone ? d.timezone : "UTC";
  if (typeof d.weekKey !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(d.weekKey)) return null;

  interface Section { heading: string; lines: string[] }
  const sections: Section[] = [];
  const push = (heading: string, lines: string[]) => {
    const kept = lines.map((l) => l.trim()).filter((l) => l.length > 0);
    if (kept.length) sections.push({ heading, lines: kept });
  };

  // Coming and going: counts or names, exactly as gathered. Tier is decided
  // upstream; this function adds nobody.
  try {
    const p = d.people;
    if (p && typeof p === "object") {
      const lines: string[] = [];
      const here = p.here;
      if (here && Number.isFinite(Number(here.count)) && Number(here.count) > 0) {
        const names = Array.isArray(here.names) ? here.names.filter((n: unknown) => typeof n === "string") : null;
        lines.push(
          names && names.length
            ? `Staying now: ${names.slice(0, MAX_NAMED).join(", ")}.`
            : `Staying now: ${Number(here.count)} ${plural(Number(here.count), "person", "people")}.`,
        );
      }
      for (const a of Array.isArray(p.arrivals) ? p.arrivals.slice(0, 10) : []) {
        if (!a || !Number.isFinite(Number(a.count))) continue;
        const names = Array.isArray(a.names) ? a.names.filter((n: unknown) => typeof n === "string") : null;
        lines.push(
          names && names.length
            ? `${briefDay(a.date)}: ${names.slice(0, MAX_NAMED).join(", ")} arriving.`
            : `${briefDay(a.date)}: ${Number(a.count)} arriving.`,
        );
      }
      for (const a of Array.isArray(p.departures) ? p.departures.slice(0, 10) : []) {
        if (!a || !Number.isFinite(Number(a.count))) continue;
        const names = Array.isArray(a.names) ? a.names.filter((n: unknown) => typeof n === "string") : null;
        lines.push(
          names && names.length
            ? `${briefDay(a.date)}: ${names.slice(0, MAX_NAMED).join(", ")} moved on.`
            : `${briefDay(a.date)}: ${Number(a.count)} moved on.`,
        );
      }
      push("Coming and going", lines);
    }
  } catch { /* the section drops, the brief survives */ }

  try {
    const list = Array.isArray(d.gatherings) ? d.gatherings : [];
    push(
      "On the calendar",
      list.slice(0, 20).map((g: any) => {
        const title = String(g?.title ?? "").trim();
        if (!title) return "";
        const when = g?.allDay ? briefDay(String(g?.startsAt ?? "").slice(0, 10)) : clockIn(String(g?.startsAt ?? ""), timeZone);
        if (!when) return "";
        const place = String(g?.place ?? "").trim();
        const seats =
          Number.isFinite(Number(g?.spotsLeft)) && g?.spotsLeft !== null
            ? Number(g.spotsLeft) === 0
              ? Number.isFinite(Number(g?.waitlistCount)) && Number(g.waitlistCount) > 0
                ? `full, ${Number(g.waitlistCount)} waiting`
                : "full"
              : `${Number(g.spotsLeft)} ${plural(Number(g.spotsLeft), "seat", "seats")} open`
            : "";
        return `${title}, ${when}${place ? `, ${place}` : ""}${seats ? ` (${seats})` : ""}.`;
      }),
    );
  } catch { /* dropped */ }

  try {
    const list = Array.isArray(d.marks) ? d.marks : [];
    push(
      "The sky and the season",
      list.slice(0, 10).map((m: any) => {
        const title = String(m?.title ?? "").trim();
        if (!title) return "";
        const day = briefDay(String(m?.startsAt ?? "").slice(0, 10));
        return day ? `${title}, ${day}.` : "";
      }),
    );
  } catch { /* dropped */ }

  // The canvas moon (plan 4.4): one line in the week a new moon falls in,
  // block titles only, in the same words the moon digest uses.
  try {
    const m = d.canvasMoon;
    if (m && typeof m === "object" && typeof m.date === "string" && Array.isArray(m.blocks)) {
      const line = canvasMoonLine(m.blocks.filter((b: unknown) => typeof b === "string"));
      const day = briefDay(m.date);
      if (line && day) push("The canvas moon", [`New moon, ${day}. ${line}`]);
    }
  } catch { /* dropped */ }

  try {
    const seats = d.openSeats;
    if (seats && Number.isFinite(Number(seats.count)) && Number(seats.count) > 0) {
      const names = Array.isArray(seats.names) ? seats.names.filter((n: unknown) => typeof n === "string") : [];
      const total = Number(seats.count);
      const listed = names.slice(0, 5).join(", ");
      push("Open roles", [
        listed
          ? `${total} ${plural(total, "role needs", "roles need")} someone: ${listed}${total > names.length ? `, and ${total - names.length} more` : ""}.`
          : `${total} ${plural(total, "role needs", "roles need")} someone.`,
      ]);
    }
  } catch { /* dropped */ }

  try {
    const q = d.newQuests;
    if (q && Number.isFinite(Number(q.count)) && Number(q.count) > 0) {
      const titles = Array.isArray(q.titles) ? q.titles.filter((t: unknown) => typeof t === "string") : [];
      const total = Number(q.count);
      push("New quests", [
        titles.length
          ? `${total} new ${plural(total, "quest", "quests")} this week: ${titles.slice(0, 5).join(", ")}${total > titles.length ? `, and ${total - titles.length} more` : ""}.`
          : `${total} new ${plural(total, "quest", "quests")} this week.`,
      ]);
    }
  } catch { /* dropped */ }

  try {
    const ops = Array.isArray(d.opportunities)
      ? d.opportunities.filter((o: unknown) => typeof o === "string" && (o as string).trim().length > 0)
      : [];
    push("Openings for you", ops.slice(0, 5).map((o: string) => o.trim()));
  } catch { /* dropped */ }

  const subject = `Your week at ${projectName}`;
  const line = sections.length
    ? sections.map((s) => s.heading.toLowerCase()).slice(0, 3).join(", ")
    : "a quiet week";
  const text = sections.length
    ? sections.map((s) => `${s.heading}\n${s.lines.map((l) => `- ${l}`).join("\n")}`).join("\n\n")
    : "Nothing is on the calendar for the coming week.";
  const html = sections.length
    ? sections
        .map(
          (s) =>
            `<h3 style="margin:14px 0 4px;font-size:14px">${esc(s.heading)}</h3>` +
            `<ul style="margin:0;padding-left:18px">${s.lines.map((l) => `<li style="margin:3px 0">${esc(l)}</li>`).join("")}</ul>`,
        )
        .join("")
    : `<p style="margin:0">Nothing is on the calendar for the coming week.</p>`;

  return { subject, line: `This week: ${line}.`, text, html };
}

export const RENDERERS: Record<string, Renderer> = {
  // Reads `villageTimezone()` at render time, so the table stays a table of
  // (data) => Rendered and the route needs no special case for this key.
  "events.week": (data) => renderWeek(data, villageTimezone()),

  "roles.all": (data) => {
    const r = asRows(data);
    if (!r) return null;
    const total = r.rows.length + r.more;
    if (total === 0) return out("roles.all", "No roles are defined in this village yet.");
    const names = field(r.rows, "name");
    if (names.length === 0) return null;
    return out(
      "roles.all",
      `This village has ${total} ${plural(total, "role", "roles")} defined: ${named(names, r.more)}.`,
    );
  },

  "seats.vacant": (data) => {
    const r = asRows(data);
    if (!r) return null;
    const total = r.rows.length + r.more;
    if (total === 0) {
      return out("seats.vacant", "No roles are defined in this village yet, so none are waiting.");
    }
    const empty = r.rows.filter((x) => Number(x.holders ?? 0) === 0);
    const names = field(empty, "role");
    if (names.length === 0) {
      // The dropped tail could hold vacancies. Saying every seat is filled
      // would be a confident sentence about rows this process never saw.
      if (r.more > 0) return null;
      return out("seats.vacant", "Every role in this village has someone holding it.");
    }
    return out(
      "seats.vacant",
      `${names.length} ${plural(names.length, "role has", "roles have")} nobody holding ` +
        `${plural(names.length, "it", "them")} right now: ${named(names, 0)}.`,
    );
  },

  "circles.all": (data) => {
    const r = asRows(data);
    if (!r) return null;
    const total = r.rows.length + r.more;
    if (total === 0) return out("circles.all", "No circles are defined in this village yet.");
    const names = field(r.rows, "name");
    if (names.length === 0) return null;
    return out(
      "circles.all",
      `This village has ${total} ${plural(total, "circle", "circles")}: ${named(names, r.more)}.`,
    );
  },

  "members.summary": (data) => {
    if (!data || typeof data !== "object" || Array.isArray(data)) return null;
    const o = data as Record<string, unknown>;
    // The over-budget shape for a non-array. Nothing countable survived it.
    if (o.truncated) return null;
    const members = Number(o.members);
    const holding = Number(o.holdingARole);
    if (!Number.isFinite(members) || !Number.isFinite(holding)) return null;
    if (members === 0) return out("members.summary", "No members have joined this village yet.");
    return out(
      "members.summary",
      `This village has ${members} ${plural(members, "member", "members")}, and ${holding} of them ` +
        `${plural(holding, "holds", "hold")} at least one role.`,
    );
  },

  "quests.library": (data) => {
    const r = asRows(data);
    if (!r) return null;
    const total = r.rows.length + r.more;
    if (total === 0) return out("quests.library", "The quest library is empty.");
    const titles = field(r.rows, "title");
    if (titles.length === 0) return null;
    return out(
      "quests.library",
      `There ${plural(total, "is", "are")} ${total} ${plural(total, "quest", "quests")} in the library: ` +
        `${named(titles, r.more)}.`,
    );
  },

  "badges.all": (data) => {
    const r = asRows(data);
    if (!r) return null;
    const total = r.rows.length + r.more;
    if (total === 0) return out("badges.all", "This village issues no badges yet.");
    const names = field(r.rows, "name");
    if (names.length === 0) return null;
    return out(
      "badges.all",
      `This village issues ${total} ${plural(total, "badge", "badges")}: ${named(names, r.more)}.`,
    );
  },

  "record.decisions": (data) => {
    const r = asRows(data);
    if (!r) return null;
    const total = r.rows.length + r.more;
    // The sentence the model itself wrote against this empty corpus. A
    // template that answered an empty log with an apology would be a
    // downgrade, so it says the same plain thing.
    if (total === 0) return out("record.decisions", "Your decision log is empty.");
    const titles = r.rows
      .map((x) => {
        const title = String(x.title ?? "").trim();
        if (!title) return "";
        const on = String(x.decidedOn ?? "").trim();
        return on ? `${title} (${on})` : title;
      })
      .filter((s) => s.length > 0);
    if (titles.length === 0) return null;
    return out(
      "record.decisions",
      `The record holds ${total} ${plural(total, "decision", "decisions")}, newest first: ` +
        `${named(titles, r.more)}.`,
    );
  },

  "concierge.gaps": (data) => {
    const r = asRows(data);
    if (!r) return null;
    const total = r.rows.length + r.more;
    if (total === 0) {
      return out("concierge.gaps", "Nobody has asked the concierge a question it could not answer.");
    }
    const asked = field(r.rows, "asked");
    if (asked.length === 0) return null;
    return out(
      "concierge.gaps",
      `${total} ${plural(total, "question", "questions")} came in that nothing in the village ` +
        `could answer: ${named(asked, r.more)}.`,
    );
  },

  // The canvas's three (Wave 4, the companion). Written beside the readers in
  // server/lib/companionCanvas.ts, which also writes the no-model answer, so
  // the two ways of saying the canvas cannot drift apart.
  "canvas.answers": renderCanvasAnswers,
  "canvas.library": renderCanvasLibrary,
  "matrix.rows": renderMatrixRows,
};

/** Reader keys a template can answer. Derived, so a test can hold it to the registry. */
export const RENDERED_READERS = Object.keys(RENDERERS);
