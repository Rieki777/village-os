/**
 * GENE KEYS: the rules between the routes and the table.
 *
 * A member's browser reads the sky from their birth details and sends only the
 * resulting chart (26 activations). This file checks that chart against the
 * sky's own rules, derives the profile and the Human Design type HERE (a client
 * never tells the server its type), and shapes what each reader may see:
 *
 *   - the member themselves: everything, their settings included;
 *   - another signed-in member: the Activation Sequence, the profile, type,
 *     strategy and authority, and only when the owner shows their lines;
 *   - Maia: a short paragraph, and only when the owner said yes to it.
 *
 * AT LAUNCH ONLY THE ACTIVATION SEQUENCE IS SHOWN (Rye, 2026-10-22). The
 * stored chart already holds the Venus and Pearl spheres; `SHOWN_SPHERES` is
 * the one line that opens them later, after their own live test (the Venus
 * sequence leans on the Moon, which changes line every couple of hours).
 *
 * Contract: shared/geneKeys.ts. Table: drizzle/0272. Statements: server/repos/geneKeys.ts.
 */
import type { Pool } from "mysql2/promise";
import { effectiveLifecycle } from "./modules";
import {
  AUTHORITY_WORDS, BODIES, GENE_KEYS_CALC_VERSION, LINE_WORDS, SPHERE_WORDS, STRATEGY_WORDS,
  analyse, chartProblems, lineWord, profileOf, sphereOf, withArticle,
  type Authority, type Chart, type HdType, type Sphere,
} from "../../shared/geneKeys";
import {
  deleteGeneKeys, readGeneKeys, shownGeneKeysByHandle, shownGeneKeysFor, updateGeneKeysSettings, writeGeneKeys,
  type GeneKeysRow, type GeneKeysSource, type GeneKeysVisibility,
} from "../repos/geneKeys";

/** The spheres any reader is shown today. */
export const SHOWN_SPHERES: readonly Sphere[] = ["lifesWork", "evolution", "radiance", "purpose"];

/** At most this many members in one batched read: a circle, a roster page. */
export const PEOPLE_READ_MAX = 60;

export interface SphereView {
  sphere: Sphere;
  name: string;
  tagline: string | null;
  /** "12.2" */
  keyLine: string;
  gate: number;
  line: number;
  /** The word genekeys.com shows for this line in this sphere. */
  word: string;
}

export interface GeneKeysView {
  profile: string;
  /** The two profile lines as one word each, "Dancer · Fixer". */
  names: string;
  lines: [number, number];
  spheres: SphereView[];
  type: HdType;
  strategy: string;
  strategyLine: string;
  authority: Authority;
  authorityName: string;
  authorityLine: string;
}

export interface OwnGeneKeysView extends GeneKeysView {
  visibility: GeneKeysVisibility;
  maia: boolean;
  source: GeneKeysSource;
  /** Computed by an older calculator than this release runs: ask the member to read the sky again. */
  stale: boolean;
}

function wordFor(sphere: Sphere, line: number): string {
  const set = (LINE_WORDS as Record<string, readonly string[]>)[sphere];
  return set ? set[line - 1] ?? "" : "";
}

/** The stored chart, trusted only after the same checks a save runs. */
function chartOf(row: GeneKeysRow): Chart | null {
  return chartProblems(row.chart).length === 0 ? (row.chart as Chart) : null;
}

export function viewOf(chart: Chart): GeneKeysView {
  const design = analyse(chart);
  const p = chart.personality.Sun.line, d = chart.design.Sun.line;
  const s = STRATEGY_WORDS[design.type], a = AUTHORITY_WORDS[design.authority];
  return {
    profile: profileOf(chart),
    names: `${lineWord(p)} · ${lineWord(d)}`,
    lines: [p, d],
    spheres: SHOWN_SPHERES.map((sphere) => {
      const act = sphereOf(chart, sphere);
      return {
        sphere,
        name: SPHERE_WORDS[sphere].name,
        tagline: SPHERE_WORDS[sphere].tagline,
        keyLine: `${act.gate}.${act.line}`,
        gate: act.gate,
        line: act.line,
        word: wordFor(sphere, act.line),
      };
    }),
    type: design.type,
    strategy: s.strategy,
    strategyLine: s.line,
    authority: design.authority,
    authorityName: a.name,
    authorityLine: a.line,
  };
}

function ownViewOf(row: GeneKeysRow): OwnGeneKeysView | null {
  const chart = chartOf(row);
  if (!chart) return null;
  return {
    ...viewOf(chart),
    visibility: row.visibility,
    maia: row.maia,
    source: row.source,
    stale: row.calcVersion < GENE_KEYS_CALC_VERSION,
  };
}

// ── A save, checked ─────────────────────────────────────────────────────────

const SOURCES: readonly GeneKeysSource[] = ["exact", "chosen"];

export type SaveParse =
  | { ok: true; chart: Chart; source: GeneKeysSource; visibility: GeneKeysVisibility; maia: boolean }
  | { ok: false; problem: string };

/**
 * A save body: `{ chart, source, visibility?, maia? }`. The chart is rebuilt
 * from its 26 activations so nothing else a client sent is ever stored.
 * `typed` is not accepted yet: a profile typed from memory has no chart behind it.
 */
export function parseSave(body: unknown): SaveParse {
  const b = (body ?? {}) as Record<string, unknown>;
  const problems = chartProblems(b.chart);
  if (problems.length) return { ok: false, problem: `That chart does not add up: ${problems[0]}` };
  const raw = b.chart as Chart;
  const chart = {
    personality: Object.fromEntries(BODIES.map((x) => [x, { gate: raw.personality[x].gate, line: raw.personality[x].line }])),
    design: Object.fromEntries(BODIES.map((x) => [x, { gate: raw.design[x].gate, line: raw.design[x].line }])),
  } as Chart;
  if (!SOURCES.includes(b.source as GeneKeysSource)) return { ok: false, problem: "Say whether the birth time was exact or chosen." };
  if (b.visibility !== undefined && b.visibility !== "show" && b.visibility !== "hide") {
    return { ok: false, problem: "Lines are shown or hidden." };
  }
  if (b.maia !== undefined && typeof b.maia !== "boolean") return { ok: false, problem: "Maia's permission is a yes or a no." };
  return {
    ok: true,
    chart,
    source: b.source as GeneKeysSource,
    visibility: (b.visibility as GeneKeysVisibility | undefined) ?? "show",
    maia: (b.maia as boolean | undefined) ?? false,
  };
}

export type SettingsParse = { ok: true; visibility?: GeneKeysVisibility; maia?: boolean } | { ok: false; problem: string };

export function parseSettings(body: unknown): SettingsParse {
  const b = (body ?? {}) as Record<string, unknown>;
  if (b.visibility !== undefined && b.visibility !== "show" && b.visibility !== "hide") return { ok: false, problem: "Lines are shown or hidden." };
  if (b.maia !== undefined && typeof b.maia !== "boolean") return { ok: false, problem: "Maia's permission is a yes or a no." };
  if (b.visibility === undefined && b.maia === undefined) return { ok: false, problem: "Nothing to change." };
  return { ok: true, visibility: b.visibility as GeneKeysVisibility | undefined, maia: b.maia as boolean | undefined };
}

// ── The doors the routes call ───────────────────────────────────────────────

export async function ownGeneKeys(pool: Pool, userId: string): Promise<OwnGeneKeysView | null> {
  const row = await readGeneKeys(pool, userId);
  return row ? ownViewOf(row) : null;
}

export async function saveGeneKeys(pool: Pool, userId: string, save: Extract<SaveParse, { ok: true }>): Promise<OwnGeneKeysView | null> {
  const design = analyse(save.chart);
  await writeGeneKeys(pool, {
    userId,
    chart: save.chart,
    profile: profileOf(save.chart),
    hdType: design.type,
    hdAuthority: design.authority,
    visibility: save.visibility,
    maia: save.maia,
    source: save.source,
    calcVersion: GENE_KEYS_CALC_VERSION,
  });
  return ownGeneKeys(pool, userId);
}

export async function changeGeneKeysSettings(
  pool: Pool,
  userId: string,
  patch: { visibility?: GeneKeysVisibility; maia?: boolean },
): Promise<OwnGeneKeysView | null> {
  const found = await updateGeneKeysSettings(pool, userId, patch);
  return found ? ownGeneKeys(pool, userId) : null;
}

export async function removeGeneKeys(pool: Pool, userId: string): Promise<boolean> {
  return (await deleteGeneKeys(pool, userId)) > 0;
}

/** Other members' lines by id, shown ones only, keyed by user id. */
export async function geneKeysOfPeople(pool: Pool, ids: string[]): Promise<Record<string, GeneKeysView>> {
  const unique = Array.from(new Set(ids.map((x) => String(x).trim()).filter(Boolean))).slice(0, PEOPLE_READ_MAX);
  const out: Record<string, GeneKeysView> = {};
  for (const row of await shownGeneKeysFor(pool, unique)) {
    const chart = chartOf(row);
    if (chart) out[row.userId] = viewOf(chart);
  }
  return out;
}

export async function geneKeysOfHandle(pool: Pool, handle: string): Promise<GeneKeysView | null> {
  const row = await shownGeneKeysByHandle(pool, handle);
  const chart = row ? chartOf(row) : null;
  return chart ? viewOf(chart) : null;
}

// ── Maia ────────────────────────────────────────────────────────────────────

/**
 * What Maia may know, in her own register, or null. Null unless the member
 * said yes, whatever their visibility: showing lines to the circle and letting
 * the guide shape suggestions by them are two different permissions. Null
 * while the module is off, too, because off means the village is not using it.
 */
export async function geneKeysForAssistant(pool: Pool, userId: string): Promise<string | null> {
  if (effectiveLifecycle("gene_keys") === "off") return null;
  const row = await readGeneKeys(pool, userId);
  if (!row?.maia) return null;
  const chart = chartOf(row);
  if (!chart) return null;
  const v = viewOf(chart);
  return (
    `Their Gene Keys profile is ${v.profile} (${v.names}). In Human Design they are ${withArticle(v.type)}. ` +
    `Strategy: ${v.strategy}. ${v.strategyLine} Authority: ${v.authorityName}. ${v.authorityLine} ` +
    "Let this shape how you offer things: options to respond to for Generators, a named invitation for Projectors, " +
    "room to start plus a nudge to tell their circle for Manifestors, and time to sleep on it for emotional authority. " +
    "Never tell them what they are able to do, and never steer them away from a role because of their lines."
  );
}

// ── Erasure and export ──────────────────────────────────────────────────────

/** The `gene-keys-after-tombstone` step of the erasure sweep (server/lib/erasure.ts). */
export async function forgetMemberGeneKeys(pool: Pool, userId: string): Promise<number> {
  const uid = String(userId ?? "").trim();
  return uid ? deleteGeneKeys(pool, uid) : 0;
}

/** Everything held about this member, for `GET /api/profile/export`: the stored row, chart included. */
export async function exportMemberGeneKeys(pool: Pool, userId: string): Promise<GeneKeysRow | null> {
  return readGeneKeys(pool, userId);
}
