/**
 * THE CIRCLE HEARTH, as numbers and plain data (Phase D, lane D1; the
 * sitewide plan's section J). Pure: no React, no DOM, no fetch, so every
 * shape and every choice the hearth makes is tested as data
 * (`hearthModel.test.ts`).
 *
 * What it decides, and nothing more:
 *
 *   THE STONES. Each role in the circle is a stone on a ring around the
 *   hearth, in the card's own order (the roles' sort order), evenly spaced
 *   from the top, clockwise. A held stone is solid, an open one is a dotted
 *   ring waiting for hands. A stone carries the ROLE's first letter: the card
 *   names no person (shared/circleCard.ts, rule 3), and the hearth keeps that.
 *
 *   THE THREADS. The circles this one is linked to (the circle it sits in and
 *   the circles that sit in it) hang off the ring between the stones, joined
 *   by a seeded mycelial thread, so a circle draws the same threads on every
 *   render. Ordered by name, never by anything that measures a circle.
 *
 *   THE PLANTS. What we tend is the circle's work (its quests): a seed waits
 *   for hands, a bud is being carried, a flower has flowered. Growth describes
 *   the work and never a person: nothing here reads who carried it.
 *
 *   THE NEXT GATHERING. The circle's rhythm is mirrored onto the village
 *   calendar as one gathering (server/lib/sessionCalendar.ts: source
 *   `sessions`, the circle's id), so the next meeting is one evening of it and
 *   "I'll be there" is the gatherings' own `going` answer, with its capacity,
 *   its waitlist and any seat fee untouched. The Seed fills one circle per
 *   person coming, seven at most.
 */
import type { CircleCard, CircleSection, FactsOut, RoleRowOut, AdoptionOut } from "@shared/circleCard";
import { fx, seeded, type Point } from "@/components/journey/nature/geometry";

// ── The card's own parts ────────────────────────────────────────────────────

/** The roles the card read, or why there are none to draw. */
export type HearthRoles =
  | { kind: "shown"; roles: RoleRowOut[] }
  /** Read, and the circle has no roles yet: the quiet hearth with one door. */
  | { kind: "none" }
  /** Not read at this reader's tier: the hearth draws no stones and says nothing. */
  | { kind: "unread" };

export function hearthRoles(card: CircleCard): HearthRoles {
  const s = card.sections.find((x): x is Extract<CircleSection, { kind: "roles" }> => x.kind === "roles");
  if (!s || s.slot.kind === "unread") return { kind: "unread" };
  if (s.slot.kind === "empty" || !s.slot.value.length) return { kind: "none" };
  return { kind: "shown", roles: s.slot.value };
}

/** "How we meet", as the card read it, or null where Live Sessions draws nothing. */
export function meetFacts(card: CircleCard): FactsOut | null {
  const s = card.sections.find((x) => x.key === "meet");
  return s && s.kind === "facts" && s.slot.kind === "shown" ? s.slot.value : null;
}

/** The adoption record (how the circle's words were decided), or null. */
export function adoptionOf(card: CircleCard): AdoptionOut | null {
  const s = card.sections.find((x) => x.kind === "adoption");
  return s && s.kind === "adoption" && s.slot.kind === "shown" ? s.slot.value : null;
}

// ── The stones ──────────────────────────────────────────────────────────────

/** The drawing's field: a square of this side, the hearth at its centre. */
export const HEARTH_VIEW = 400;
export const HEARTH_CENTRE = HEARTH_VIEW / 2;
/** The ring the stones sit on. */
export const STONE_RING = 112;
/** Where the linked circles hang, past the stones. */
export const THREAD_RING = 172;
/** The most stones drawn around one hearth; a larger circle's roles are all still listed in "Who holds what". */
export const STONES_MAX = 12;
/** The most linked circles drawn as threads. */
export const LINKS_MAX = 6;

export interface Stone extends Point {
  id: string;
  name: string;
  /** The role's first letter, upper case. Never a person's. */
  initial: string;
  held: boolean;
  /** Angle on the ring, degrees, 0 at the top, clockwise. */
  angle: number;
  /** The stone's radius: smaller when many share the ring. */
  r: number;
  /** Where the role's name sits: under the stone, or above it near the top. */
  labelY: number;
}

const rad = (deg: number) => ((deg - 90) * Math.PI) / 180;
const onRing = (deg: number, radius: number): Point => ({
  x: HEARTH_CENTRE + radius * Math.cos(rad(deg)),
  y: HEARTH_CENTRE + radius * Math.sin(rad(deg)),
});

/** The first letter of a role's name, for its stone. */
export function initialOf(name: string): string {
  // The first mark that is neither space nor punctuation (no unicode flag: the base config targets ES5).
  const m = /[^\s.,;:!?'"()[\]{}\-·_/]/.exec(name.trim());
  return m ? m[0].toLocaleUpperCase() : "·";
}

/** The roles as stones on the ring, evenly from the top, clockwise, in the card's order. */
export function stonesOf(roles: readonly RoleRowOut[]): Stone[] {
  const drawn = roles.slice(0, STONES_MAX);
  const n = drawn.length;
  if (!n) return [];
  const r = n <= 6 ? 20 : n <= 9 ? 17 : 14;
  return drawn.map((role, i) => {
    const angle = (360 * i) / n;
    const p = onRing(angle, STONE_RING);
    // The top half's names sit above their stone, the rest below, so no name crosses the hearth.
    const above = p.y < HEARTH_CENTRE - STONE_RING * 0.5;
    return {
      id: role.id,
      name: role.name,
      initial: initialOf(role.name),
      held: role.filled,
      angle,
      r,
      x: p.x,
      y: p.y,
      labelY: above ? p.y - r - 7 : p.y + r + 15,
    };
  });
}

// ── The threads to linked circles ───────────────────────────────────────────

export interface LinkedCircle {
  id: string;
  name: string;
  href: string;
  /** The circle this one sits in, or one that sits in this one. */
  how: "parent" | "child";
}

export interface ThreadDrawing extends LinkedCircle {
  /** The node where the linked circle hangs. */
  end: Point;
  /** The thread, from the ring to the node. */
  path: string;
  /** One side hypha, forking off the thread. */
  hypha: string;
  /** Text anchor for the circle's name beside its node. */
  anchor: "start" | "middle" | "end";
  label: Point;
}

/** The circles linked to this one: the one it sits in first, then the ones in it, by name. Never itself, never twice. */
export function linkedCircles(
  circleId: string,
  parent: { name: string; href: string } | null,
  parentId: string | null,
  all: readonly { id: string; name: string; parentCircleId?: string | null; isExample?: boolean }[],
): LinkedCircle[] {
  const out: LinkedCircle[] = [];
  const seen = new Set<string>([circleId]);
  if (parent) {
    const id = parentId ?? parent.href;
    seen.add(id);
    out.push({ id, name: parent.name, href: parent.href, how: "parent" });
  }
  const children = all
    .filter((c) => c.parentCircleId === circleId && !seen.has(c.id) && c.name.trim())
    .sort((a, b) => a.name.localeCompare(b.name));
  for (const c of children) {
    seen.add(c.id);
    out.push({ id: c.id, name: c.name.trim(), href: `/circles/${encodeURIComponent(c.id)}`, how: "child" });
  }
  return out.slice(0, LINKS_MAX);
}

/**
 * Each linked circle hangs between two stones (or evenly, with no stones), on
 * the outer ring, joined by a seeded thread with one side hypha.
 */
export function threadsOf(links: readonly LinkedCircle[], stoneCount: number, seed = 11): ThreadDrawing[] {
  const n = links.length;
  if (!n) return [];
  const rnd = seeded(seed + n * 7 + stoneCount);
  const step = stoneCount > 0 ? 360 / stoneCount : 360 / n;
  return links.map((link, i) => {
    // Between stones: a half step past a stone, spread round the ring; with no stones, evenly.
    const slot = stoneCount > 0 ? Math.round((i * stoneCount) / n) : i;
    const angle = stoneCount > 0 ? slot * step + step / 2 : (360 * i) / n + 30;
    const start = onRing(angle, STONE_RING);
    const end = onRing(angle, THREAD_RING);
    const bend = (rnd() - 0.5) * 34;
    const mid = onRing(angle + bend * 0.5, (STONE_RING + THREAD_RING) / 2);
    const path = `M${fx(start.x)} ${fx(start.y)} Q${fx(mid.x)} ${fx(mid.y)} ${fx(end.x)} ${fx(end.y)}`;
    const fork = onRing(angle + (rnd() > 0.5 ? 9 : -9), (STONE_RING + THREAD_RING) / 2 + 14);
    const hypha = `M${fx(mid.x)} ${fx(mid.y)} L${fx(fork.x)} ${fx(fork.y)}`;
    const dx = end.x - HEARTH_CENTRE;
    const anchor: ThreadDrawing["anchor"] = Math.abs(dx) < 30 ? "middle" : dx > 0 ? "end" : "start";
    const below = end.y > HEARTH_CENTRE;
    const label = { x: anchor === "middle" ? end.x : end.x + (dx > 0 ? 8 : -8), y: below ? end.y + 18 : end.y - 10 };
    return { ...link, end, path, hypha, anchor: anchor === "middle" ? "middle" : dx > 0 ? "end" : "start", label: clampLabel(label) };
  });
}

/** A name never leaves the field. */
function clampLabel(p: Point): Point {
  return { x: Math.min(HEARTH_VIEW - 4, Math.max(4, p.x)), y: Math.min(HEARTH_VIEW - 4, Math.max(12, p.y)) };
}

/** The Seed of Life the embers burn in: seven circles of radius r around the centre. */
export function emberSeed(r = 22): Point[] {
  const out: Point[] = [{ x: HEARTH_CENTRE, y: HEARTH_CENTRE }];
  for (let k = 0; k < 6; k++) out.push(onRing(k * 60, r));
  return out;
}

/** A few still embers, on the golden angle, inside the seed. Seeded: the same embers every time. */
export function embers(count = 7, reach = 30): Point[] {
  const golden = Math.PI * (3 - Math.sqrt(5));
  return Array.from({ length: count }, (_, i) => {
    const radius = reach * Math.sqrt((i + 0.5) / count);
    return { x: HEARTH_CENTRE + radius * Math.cos(i * golden), y: HEARTH_CENTRE + radius * Math.sin(i * golden) };
  });
}

// ── What we tend ────────────────────────────────────────────────────────────

export type PlantState = "seed" | "bud" | "flower";

export interface QuestIn {
  id: string;
  title: string;
  circle?: string | null;
  status: string;
  order?: number;
  isExample?: boolean;
}

export interface TendRow {
  id: string;
  title: string;
  href: string;
  plant: PlantState;
}

/** The most plants shown here; the rest are a link away on the quest board. */
export const TEND_MAX = 6;

const OPEN_STATUSES = new Set(["open", "active", "available"]);
const norm = (s: string | null | undefined) => String(s ?? "").trim().toLocaleLowerCase();

/**
 * A piece of work's plant: being carried now is a bud, flowered before is a
 * flower, and otherwise a seed waiting for hands. Read off the work's own
 * counts, never off who did it.
 */
export function plantOf(signs: { active: number; done: number } | undefined): PlantState {
  if (signs && signs.active > 0) return "bud";
  if (signs && signs.done > 0) return "flower";
  return "seed";
}

/**
 * The circle's open work, matched by the circle's id or name (a quest names
 * its circle in words), in the board's own order and then by title. An
 * example circle tends example work, and a real circle real work.
 */
export function tendOf(
  quests: readonly QuestIn[],
  perQuest: Readonly<Record<string, { active: number; done: number }>>,
  circle: { id: string; name: string; isExample?: boolean },
): { rows: TendRow[]; more: number } {
  const keys = new Set([norm(circle.id), norm(circle.name)].filter(Boolean));
  const mine = quests
    .filter((q) => keys.has(norm(q.circle)) && OPEN_STATUSES.has(norm(q.status)) && Boolean(q.isExample) === Boolean(circle.isExample))
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.title.localeCompare(b.title));
  const rows = mine.slice(0, TEND_MAX).map((q) => ({ id: q.id, title: q.title, href: `/quests/${encodeURIComponent(q.id)}`, plant: plantOf(perQuest[q.id]) }));
  return { rows, more: Math.max(0, mine.length - rows.length) };
}

// ── The next gathering ──────────────────────────────────────────────────────

/** The calendar's source for a circle's mirrored rhythm (shared/sessionCalendar.ts `MIRROR_SOURCE`). */
export const RHYTHM_SOURCE = "sessions";

export interface CalendarItemIn {
  id: string;
  title?: string;
  startsAt: string;
  endsAt?: string | null;
  status?: string;
  sourceModule?: string | null;
  sourceId?: string | null;
  occurrenceKey?: string;
  goingCount?: number;
  myRsvp?: string | null;
  seatPrice?: number;
  capacity?: number | null;
  spotsLeft?: number | null;
}

export interface NextGathering {
  eventId: string;
  occurrenceKey: string;
  startsAt: string;
  going: number;
  /** This reader said they will be there. */
  mine: boolean;
  /** Answering here only for a free gathering with room: a priced or full one is answered on the calendar, where its terms are shown. */
  answerHere: boolean;
}

/** The Seed of Life has seven circles: one per person coming, seven at most. */
export const SEED_CIRCLES = 7;
export const seedFill = (going: number): number => Math.max(0, Math.min(SEED_CIRCLES, Math.floor(going)));

/** The circle's next meeting on the village calendar, from now: the earliest evening still to come. */
export function nextGathering(items: readonly CalendarItemIn[], circleId: string, now: Date): NextGathering | null {
  const t0 = now.getTime();
  const next = items
    .filter((e) => e.sourceModule === RHYTHM_SOURCE && e.sourceId === circleId)
    .filter((e) => e.status !== "cancelled" && e.status !== "draft")
    .filter((e) => {
      const end = Date.parse(e.endsAt ?? e.startsAt);
      return !Number.isNaN(end) && end > t0;
    })
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))[0];
  if (!next) return null;
  const free = !next.seatPrice;
  const room = next.spotsLeft == null || next.spotsLeft > 0 || next.myRsvp === "going";
  return {
    eventId: next.id,
    occurrenceKey: next.occurrenceKey ?? next.startsAt.slice(0, 10),
    startsAt: next.startsAt,
    going: Math.max(0, Number(next.goingCount ?? 0)),
    mine: next.myRsvp === "going",
    answerHere: free && room,
  };
}
