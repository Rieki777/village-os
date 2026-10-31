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
 *   - Maia: a short paragraph, and only when the owner said yes to it;
 *   - "Who complements me": other members who opted in and show their lines,
 *     and only to a member who opted in and shows theirs (0287).
 *
 * LAUNCH SHOWED ONLY THE ACTIVATION SEQUENCE (Rye, 2026-10-22). Love and
 * Prosperity (the Venus and Pearl spheres) opened once their live test passed,
 * 77 of 77 against genekeys.com (2026-10-30); `viewOf` (shared) builds all three.
 *
 * Contract: shared/geneKeys.ts. Table: drizzle/0272. Statements: server/repos/geneKeys.ts.
 */
import type { Pool } from "mysql2/promise";
import { effectiveLifecycle } from "./modules";
import { awardFirstTierNow } from "./badges";
import {
  BODIES, GENE_KEYS_CALC_VERSION, analyse, chartProblems, profileOf, viewOf, withArticle,
  type Chart, type Complement, type ComplementsAnswer, type GeneKeysView, type OwnGeneKeysView,
} from "../../shared/geneKeys";
import {
  cardReadableGeneKeys, complementCandidates, deleteGeneKeys, readGeneKeys, shownGeneKeysByHandle, shownGeneKeysFor, updateGeneKeysSettings, writeGeneKeys,
  type GeneKeysRow, type GeneKeysSettingsPatch,
} from "../repos/geneKeys";
import type { GeneKeysSource, GeneKeysVisibility } from "../../shared/geneKeys";

/** At most this many members in one batched read: a circle, a roster page. */
export const PEOPLE_READ_MAX = 60;

/** The stored chart, trusted only after the same checks a save runs. */
function chartOf(row: GeneKeysRow): Chart | null {
  return chartProblems(row.chart).length === 0 ? (row.chart as Chart) : null;
}

function ownViewOf(row: GeneKeysRow): OwnGeneKeysView | null {
  const chart = chartOf(row);
  if (!chart) return null;
  return {
    ...viewOf(chart),
    visibility: row.visibility,
    maia: row.maia,
    complement: row.complement,
    maiaPlain: row.maiaPlain,
    cardOut: row.cardOut,
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

export type SettingsParse = ({ ok: true } & GeneKeysSettingsPatch) | { ok: false; problem: string };

export function parseSettings(body: unknown): SettingsParse {
  const b = (body ?? {}) as Record<string, unknown>;
  if (b.visibility !== undefined && b.visibility !== "show" && b.visibility !== "hide") return { ok: false, problem: "Lines are shown or hidden." };
  if (b.maia !== undefined && typeof b.maia !== "boolean") return { ok: false, problem: "Maia's permission is a yes or a no." };
  if (b.complement !== undefined && typeof b.complement !== "boolean") return { ok: false, problem: "Who complements me is a yes or a no." };
  if (b.maiaPlain !== undefined && typeof b.maiaPlain !== "boolean") return { ok: false, problem: "Talking plainly is a yes or a no." };
  if (b.cardOut !== undefined && typeof b.cardOut !== "boolean") return { ok: false, problem: "Session cards are a yes or a no." };
  if (b.visibility === undefined && b.maia === undefined && b.complement === undefined && b.maiaPlain === undefined && b.cardOut === undefined) {
    return { ok: false, problem: "Nothing to change." };
  }
  return {
    ok: true,
    visibility: b.visibility as GeneKeysVisibility | undefined,
    maia: b.maia as boolean | undefined,
    complement: b.complement as boolean | undefined,
    maiaPlain: b.maiaPlain as boolean | undefined,
    cardOut: b.cardOut as boolean | undefined,
  };
}

// ── The doors the routes call ───────────────────────────────────────────────

export async function ownGeneKeys(pool: Pool, userId: string): Promise<OwnGeneKeysView | null> {
  const row = await readGeneKeys(pool, userId);
  return row ? ownViewOf(row) : null;
}

// ── The badge ───────────────────────────────────────────────────────────────

/** Seeded by drizzle/0287. Earned, no multiplier (Rye, 2026-10-30), never Gratitude. */
export const LINES_FOUND_BADGE = "lines-found";

/**
 * "Lines found", the moment the member's lines are saved AND shown. A hidden
 * member is never marked by a public badge; showing later earns it then. True
 * only when this call awarded it, so the route sends one notice. A failure
 * here never fails the save: the engine awards the same tier at cycle close.
 */
export async function earnLinesFound(pool: Pool, userId: string, visibility: GeneKeysVisibility): Promise<boolean> {
  if (visibility !== "show" || effectiveLifecycle("badges") === "off") return false;
  try {
    return await awardFirstTierNow(pool, LINES_FOUND_BADGE, userId);
  } catch (e) {
    console.error("[gene-keys] the Lines found badge did not award; cycle close will", e);
    return false;
  }
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

export async function changeGeneKeysSettings(pool: Pool, userId: string, patch: GeneKeysSettingsPatch): Promise<OwnGeneKeysView | null> {
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

// ── Who complements me ──────────────────────────────────────────────────────

/** At most this many people in the list: enough to start a team, few enough to read. */
export const COMPLEMENTS_MAX = 12;

/**
 * The people whose lines fill this member's gaps. OPT-IN ON BOTH SIDES (Rye,
 * 2026-10-23): the member must have said yes and show their own lines before
 * they see anybody, and they see only others who did the same. Ranked by how
 * many of the member's missing lines a person brings, then by a Human Design
 * type the member does not have, then by name.
 */
export async function complementsFor(pool: Pool, userId: string): Promise<ComplementsAnswer> {
  const mine = await readGeneKeys(pool, userId);
  const myChart = mine ? chartOf(mine) : null;
  if (!mine || !myChart) return { state: "no-lines" };
  if (mine.visibility !== "show") return { state: "hidden" };
  if (!mine.complement) return { state: "not-joined" };
  const me = viewOf(myChart);
  const people: Array<Complement & { otherType: boolean }> = [];
  for (const row of await complementCandidates(pool, userId)) {
    const chart = chartOf(row);
    if (!chart) continue;
    const view = viewOf(chart);
    const fills = Array.from(new Set(view.lines)).filter((l) => !me.lines.includes(l)).sort((a, b) => a - b);
    if (!fills.length) continue;
    people.push({ name: row.name, handle: row.handle, view, fills, otherType: view.type !== me.type });
  }
  people.sort((a, b) => b.fills.length - a.fills.length || Number(b.otherType) - Number(a.otherType) || a.name.localeCompare(b.name));
  return { state: "joined", people: people.slice(0, COMPLEMENTS_MAX).map(({ otherType: _o, ...p }) => p) };
}

// ── Maia ────────────────────────────────────────────────────────────────────

/**
 * What Maia may know, in her own register, or null. Null unless the member
 * said yes, whatever their visibility: showing lines to the circle and letting
 * the guide shape suggestions by them are two different permissions. Null
 * while the module is off, too, because off means the village is not using it.
 */
export async function geneKeysForAssistant(pool: Pool, userId: string): Promise<string | null> {
  if (effectiveLifecycle("gene-keys") === "off") return null;
  const row = await readGeneKeys(pool, userId);
  if (!row?.maia) return null;
  const chart = chartOf(row);
  if (!chart) return null;
  return assistantNoteFor(viewOf(chart), row.maiaPlain);
}

/**
 * The paragraph itself, apart from the read so it can be pinned by a test.
 *
 * Rye asked to talk "Maia speaks your type" through before building it, then
 * said build all of it (2026-10-30), so it follows the lean put to him on
 * 2026-10-23: VISIBLE (she says when she is shaping something, in a few
 * words), LIGHT (her wording changes, what is on offer does not), she NUDGES
 * THE CIRCLE rather than inviting on its behalf, and a member can ask her to
 * talk plainly, which keeps the lines for choosing what to suggest and drops
 * every trace of them from her wording.
 */
export function assistantNoteFor(v: GeneKeysView, plain: boolean): string {
  const facts =
    `Their Gene Keys profile is ${v.profile} (${v.names}). In Human Design they are ${withArticle(v.type)}, ` +
    `with ${withArticle(v.authorityName)} authority. `;
  const never = "Never tell them what they are able to do, and never steer them away from a role because of their lines.";
  if (plain) {
    return (
      facts +
      "They asked you to talk to them plainly. Let this shape only which things you suggest, never your wording: " +
      "do not mention their profile, type or authority, and do not adapt your tone to them, unless they ask. " +
      never
    );
  }
  return (
    facts +
    `Strategy: ${v.strategy}. ${v.strategyLine} Authority: ${v.authorityName}. ${v.authorityLine} ` +
    "Let this shape how you put things, lightly: the same options everyone gets, worded the way they decide best. " +
    "When you shape something to how they work, say so in a few plain words the first time it matters, " +
    "for example \"no rush on this one, you decide best after a night\". " +
    "Never send an invitation on a circle's behalf. When a Projector would suit some work, suggest they tell the circle " +
    "which work they would welcome an invitation to, or suggest a circle member invite them by name. " +
    never
  );
}

// ── The Trail ───────────────────────────────────────────────────────────────

/** For the next-step rule `no-gene-keys`: the module is on and this member has nothing saved. */
export async function geneKeysMissing(pool: Pool, userId: string): Promise<boolean> {
  if (effectiveLifecycle("gene-keys") === "off") return false;
  return (await readGeneKeys(pool, String(userId))) === null;
}

// ── Session cards ───────────────────────────────────────────────────────────

/**
 * The charts a session card may read, by member, for the people present: shown,
 * Maia allowed, not left out of cards (the SQL holds all three), and a chart
 * that still passes the save's checks.
 */
export async function cardChartsFor(pool: Pool, ids: string[]): Promise<Map<string, Chart>> {
  const out = new Map<string, Chart>();
  for (const row of await cardReadableGeneKeys(pool, ids.slice(0, PEOPLE_READ_MAX))) {
    const chart = chartOf(row);
    if (chart) out.set(row.userId, chart);
  }
  return out;
}

/** Why a card does not read this member, in the order they would fix it, or null when it does. */
export async function cardStandingOf(pool: Pool, userId: string): Promise<"no-lines" | "hidden" | "no-maia" | "left-out" | null> {
  const row = await readGeneKeys(pool, userId);
  if (!row || !chartOf(row)) return "no-lines";
  if (row.visibility !== "show") return "hidden";
  if (!row.maia) return "no-maia";
  if (row.cardOut) return "left-out";
  return null;
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
