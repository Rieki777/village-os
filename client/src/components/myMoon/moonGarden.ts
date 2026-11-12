/**
 * THE MOON GARDEN, as maths and words (Phase C, lane C2; sitewide plan E).
 *
 * Two drawings live on My moon, and this file is everything they compute:
 *
 *   THE MOON ON A GOLDEN SPIRAL. This moon's days placed along a golden
 *   spiral, the new moon at the centre and the closing day at the edge. The
 *   radius grows by the golden ratio every quarter turn, and the days sit at
 *   equal steps of arc length along the curve, so they read as one even walk
 *   outward. The moon is told in four chapters: we sow (the first week), we
 *   tend, the full moon (a short pause halfway) and we harvest (the week of
 *   the end-of-moon walkthrough).
 *
 *   ONE GARDEN BED PER ROLE. Each kept piece of work on a role is a plant,
 *   placed by Vogel's sunflower model (`vogel` in the nature kit), the first
 *   at the centre: flowered when done, in bud when partly done, a seed kept
 *   when carried, and sprouting while it has no ending yet. Let go and
 *   Redirect leave the bed: they were never this role's to grow.
 *
 * Growth here always describes WORK and TIME, never a person. Nothing in this
 * file counts a person against anyone, and none of it is ever sent to the
 * people approving pay (decision 2).
 */
import {
  addDays,
  dayWords,
  type MoonRef,
  type RecapItem,
} from "@shared/moonRecap";
import { PHI, vogel } from "@/components/journey/nature/geometry";

// ── Words ────────────────────────────────────────────────────────────────────

export const CHAPTERS = ["sow", "tend", "full", "harvest"] as const;
export type Chapter = (typeof CHAPTERS)[number];

export const MOON_GARDEN_WORDS = {
  chapterKicker: (n: number) =>
    `Chapter ${["one", "two", "three", "four"][n] ?? n + 1}`,
  chapters: {
    sow: {
      name: "We sow",
      line: "The new moon. We choose what we will tend this moon and bring our work in as it starts.",
    },
    tend: {
      name: "We tend",
      line: "Mondays we plant, Fridays we gather. Each piece of work grows in its role's bed.",
    },
    full: {
      name: "Full moon",
      line: "A short pause halfway. We look at what is growing and what can rest.",
    },
    harvest: {
      name: "We harvest",
      line: "We tell this moon in our own words and send it to the circle.",
    },
  } satisfies Record<Chapter, { name: string; line: string }>,
  chaptersHeading: "The four chapters",
  now: "Now",
  dayOf: (day: number, of: number) => `Day ${day} of ${of}`,
  closed: "This moon has closed",
  notYet: "This moon has not begun",
  spiralLabel: (of: number) =>
    `This moon as a golden spiral of ${of} days, the new moon at the centre`,
  today: "Today",
  newMoon: "New moon",
  fullMoon: "Full moon",
  harvest: "Harvest",
  actGather: "Bring in this moon's work",
  actWords: "Tell this moon in my own words",
  bedLabel: (role: string) => `The ${role} bed`,
  flowered: "flowered",
  bud: "in bud",
  sprout: "sprouting",
  seed: "seed kept",
  emptyBed: "Resting soil this moon",
  lookAfter: "What I look after",
  growing: (n: number) =>
    n === 1
      ? "One piece of work growing here"
      : `${n} pieces of work growing here`,
  resting: "Resting soil this moon",
  restingNote:
    "Resting soil is part of the cycle. If part of a role is no longer yours to hold, we can say so at the harvest.",
} as const;

// ── Days and chapters ────────────────────────────────────────────────────────

type MoonDates = Pick<
  MoonRef,
  "firstDay" | "lastDay" | "halfwayDay" | "endOfMoonFriday"
>;

/** Every civil day of the moon, first to last. */
export function moonDays(
  moon: Pick<MoonRef, "firstDay" | "lastDay">
): string[] {
  const out: string[] = [];
  for (
    let d = moon.firstDay;
    d <= moon.lastDay && out.length < 40;
    d = addDays(d, 1)
  )
    out.push(d);
  return out;
}

/** The first day of the harvest: the week that ends on the walkthrough day, never before the moon starts. */
export function harvestFrom(moon: MoonDates): string {
  const from = addDays(moon.endOfMoonFriday, -6);
  return from < moon.firstDay ? moon.firstDay : from;
}

/** The first day of each chapter, in order. The full moon falls back to the middle day when the table has none. */
export function chapterStarts(moon: MoonDates): Record<Chapter, string> {
  const days = moonDays(moon);
  const full =
    moon.halfwayDay ?? days[Math.floor(days.length / 2)] ?? moon.firstDay;
  return {
    sow: moon.firstDay,
    tend: addDays(moon.firstDay, 7),
    full,
    harvest: harvestFrom(moon),
  };
}

/**
 * The chapter a day belongs to. The harvest week wins, then the full moon and
 * the two days after it, then the first week's sowing; every other day is
 * tending. A day after the moon is its harvest; a day before it, its sowing.
 */
export function chapterOf(day: string, moon: MoonDates): Chapter {
  const s = chapterStarts(moon);
  if (day >= s.harvest) return "harvest";
  if (day >= s.full && day <= addDays(s.full, 2)) return "full";
  if (day < s.tend) return "sow";
  return "tend";
}

/** Where today stands in this moon: before it, in it (with its day number), or after it. */
export function standing(
  today: string,
  moon: Pick<MoonRef, "firstDay" | "lastDay">
): { kind: "before" | "after" } | { kind: "in"; day: number; of: number } {
  const days = moonDays(moon);
  if (today < moon.firstDay) return { kind: "before" };
  if (today > moon.lastDay) return { kind: "after" };
  return { kind: "in", day: days.indexOf(today) + 1, of: days.length };
}

/** The member's own civil date, as the browser reads it. */
export function localToday(now: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

/** The one next act for the header, or null when the recap is no longer the member's to edit. */
export function nextAct(
  chapter: Chapter,
  editable: boolean
): { label: string; href: string } | null {
  if (!editable) return null;
  return chapter === "harvest"
    ? { label: MOON_GARDEN_WORDS.actWords, href: "#moon-own-words" }
    : { label: MOON_GARDEN_WORDS.actGather, href: "#moon-gather" };
}

/** A chapter's line in the list: its first day in words, without the year the header already names. */
export function chapterWhen(chapter: Chapter, moon: MoonDates): string {
  return dayWords(chapterStarts(moon)[chapter]).replace(/ \d{4}$/, "");
}

// ── The golden spiral ────────────────────────────────────────────────────────

export interface SpiralPoint {
  x: number;
  y: number;
}

/** The spiral's radius at angle t: a golden spiral grows by phi each quarter turn. */
export const radiusAt = (t: number) => Math.pow(PHI, (2 * t) / Math.PI);

/**
 * `n` points at equal arc length along a golden spiral of `turns` turns,
 * from near the centre outward, scaled so the outermost point sits on a
 * circle of radius `size` around (0, 0). Deterministic: the same moon draws
 * the same spiral on every render and in every test.
 */
export function spiralDays(
  n: number,
  size = 100,
  turns = 1.75,
  samples = 1200
): SpiralPoint[] {
  if (n <= 0) return [];
  const t0 = Math.PI * 0.5;
  const t1 = t0 + turns * Math.PI * 2;
  const pts: Array<SpiralPoint & { s: number }> = [];
  let s = 0;
  for (let i = 0; i <= samples; i++) {
    const t = t0 + ((t1 - t0) * i) / samples;
    const r = radiusAt(t);
    const p = { x: r * Math.cos(t), y: -r * Math.sin(t) };
    if (i > 0) s += Math.hypot(p.x - pts[i - 1].x, p.y - pts[i - 1].y);
    pts.push({ ...p, s });
  }
  const scale = size / radiusAt(t1);
  const out: SpiralPoint[] = [];
  let j = 0;
  for (let k = 0; k < n; k++) {
    const want = n === 1 ? s : (s * k) / (n - 1);
    while (j < pts.length - 1 && pts[j + 1].s < want) j++;
    const a = pts[j];
    const b = pts[Math.min(j + 1, pts.length - 1)];
    const f = b.s > a.s ? (want - a.s) / (b.s - a.s) : 0;
    out.push({
      x: (a.x + (b.x - a.x) * f) * scale,
      y: (a.y + (b.y - a.y) * f) * scale,
    });
  }
  return out;
}

/** The spiral itself as an SVG path, through the same curve the days sit on. */
export function spiralPath(size = 100, turns = 1.75, steps = 240): string {
  const t0 = Math.PI * 0.5;
  const t1 = t0 + turns * Math.PI * 2;
  const scale = size / radiusAt(t1);
  const parts: string[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = t0 + ((t1 - t0) * i) / steps;
    const r = radiusAt(t) * scale;
    parts.push(
      `${i === 0 ? "M" : "L"}${(r * Math.cos(t)).toFixed(2)} ${(-r * Math.sin(t)).toFixed(2)}`
    );
  }
  return parts.join(" ");
}

// ── The beds ─────────────────────────────────────────────────────────────────

export type BedPlant = "flowered" | "bud" | "sprout" | "seed";

/** The plant a kept piece of work grows as, or null when it leaves the bed (let go, redirect, not kept). */
export function plantOf(
  item: Pick<RecapItem, "state" | "taskStatus">
): BedPlant | null {
  if (item.state !== "kept") return null;
  switch (item.taskStatus) {
    case "done":
      return "flowered";
    case "partly":
      return "bud";
    case "carry":
      return "seed";
    case "let_go":
    case "redirect":
      return null;
    default:
      return "sprout";
  }
}

/** One role's bed: its plants in the order the work was kept (first at the centre). */
export function bedFor(
  roleId: string,
  items: readonly Pick<
    RecapItem,
    "roleId" | "state" | "taskStatus" | "position"
  >[]
): BedPlant[] {
  return [...items]
    .filter(i => i.roleId === roleId)
    .sort((a, b) => a.position - b.position)
    .map(plantOf)
    .filter((p): p is BedPlant => p !== null);
}

/** Plant i of n inside a bed of radius `size`, on the sunflower's spiral; the bed never overflows. */
export function bedSpots(n: number, size = 100): SpiralPoint[] {
  if (n <= 0) return [];
  const c = (size * 0.8) / Math.sqrt(Math.max(n, 6));
  return Array.from({ length: n }, (_, i) => {
    const p = i === 0 ? { x: 0, y: 0 } : vogel(i, c);
    return { x: p.x, y: p.y };
  });
}

/** The bed in words, for a screen reader and the legend: "2 flowered, 1 in bud". */
export function bedWords(plants: readonly BedPlant[]): string {
  const order: BedPlant[] = ["flowered", "bud", "sprout", "seed"];
  return order
    .map(k => [k, plants.filter(p => p === k).length] as const)
    .filter(([, n]) => n > 0)
    .map(([k, n]) => `${n} ${MOON_GARDEN_WORDS[k]}`)
    .join(", ");
}
