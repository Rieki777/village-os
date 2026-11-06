/**
 * A VILLAGE'S OWN WORDS FOR ITS PATHS AND ITS STAGE LADDER.
 *
 * Joining asked every newcomer to pick one of four paths named by the first
 * village, the same names reached the path emails, and the ladder of stages
 * carried that village's names and sentences. None of it could be changed from
 * Admin (customizability audit, FINDINGS item 6). This module holds the rules
 * for a village's own version: what may change, how long each word may be, how
 * a stored document is read, and what a save may hold.
 *
 * ── WHAT STAYS FIXED, AND WHY ─────────────────────────────────────────────
 *
 * PATH IDS. The four journey pages, the join form, a member's stored paths
 * (`claimPaths`), the comms journeys (`path.<id>.*` templates), the email
 * inboxes and the profile's path sections all key on them. A village changes a
 * path's words: its name, the second line under it, and its sentence.
 *
 * STAGE IDS, THEIR ORDER, AND HOW EACH IS EARNED. Quests, roles, library items
 * and shop items name a minimum stage by id; the capability unlock table and
 * the game variables (`progression.multiplier.<id>`,
 * `progression.quests_for.<id>`, `progression.unlock.<cap>`) key on them;
 * vouching reads the `contributor` rung by id and admission reads `member`;
 * and a member's stage is computed by climbing the list in order. Adding,
 * removing or reordering a rung would silently move every one of those. So a
 * village renames and re-describes its stages, and the ladder itself stays the
 * platform's.
 *
 * ── HOW IT IS STORED ──────────────────────────────────────────────────────
 *
 * One `app_config` document, `village-paths`, holding only what the village
 * changed. `app_config` is a key-value table, so there is no migration:
 *
 *   { paths:  { <pathId>:  { label?, role?, description? } },
 *     stages: { <stageId>: { name?, description? } },
 *     ladder: { title? } }
 *
 * ── HOW IT IS READ ────────────────────────────────────────────────────────
 *
 * Every field back-fills from today's words on read, one field at a time
 * (`resolveVillagePathWords`). A stored document is never merged with the
 * defaults by the store (`dbDocument.get()` answers it whole), so a village
 * that never saved reads exactly what it read before this existed, and a
 * village that renamed one path keeps every word it did not touch, including
 * any field a later release adds.
 *
 * The words may carry the same `{village}`-style words a page field may
 * (shared/pageContent/vars.ts). The resident path's sentence does by default.
 */
import { GAME_CONFIG } from "./gameConfig";
import { charCount, fillVars } from "./pageContent/resolve";
import type { PageVars } from "./pageContent/types";

/** The `app_config` key the village's words are stored under. */
export const VILLAGE_PATHS_DOCUMENT = "village-paths";

/** How long each word may be, so the join form and the ladder keep their shape. */
export const PATH_LIMITS = { label: 24, role: 24, description: 100 } as const;
export const STAGE_LIMITS = { name: 20, description: 70 } as const;
export const LADDER_LIMITS = { title: 30 } as const;

export type PathField = keyof typeof PATH_LIMITS;
export type StageField = keyof typeof STAGE_LIMITS;
export type LadderField = keyof typeof LADDER_LIMITS;

export const PATH_FIELDS: readonly PathField[] = ["label", "role", "description"];
export const STAGE_FIELDS: readonly StageField[] = ["name", "description"];
export const LADDER_FIELDS: readonly LadderField[] = ["title"];

/** The ladder's name before a village gives it one. */
export const DEFAULT_LADDER_TITLE = "Path of Growth";

/**
 * Each path's sentence on the join form, as Register.tsx carried it before a
 * village could change it. A path with no entry here has an empty sentence.
 */
const DEFAULT_PATH_DESCRIPTIONS: Readonly<Record<string, string>> = {
  investor: "Plant capital in a project built to last.",
  steward: "Hold a role, join a circle, and keep the whole village running.",
  resident: "Make {village} your home. Find a place to live, join the waitlist, and belong.",
  "prosperity-creator": "Launch or grow your business inside the village, and share in what you build.",
};

export interface PathWords {
  label: string;
  role: string;
  description: string;
}

export interface StageWords {
  name: string;
  description: string;
}

/** Every path's and every stage's words, resolved. Every id in GAME_CONFIG is present. */
export interface VillagePathWords {
  paths: Record<string, PathWords>;
  stages: Record<string, StageWords>;
  ladder: { title: string };
}

/** What a save stores: only what the village changed. */
export interface VillagePathsDocument {
  paths?: Record<string, Partial<PathWords>>;
  stages?: Record<string, Partial<StageWords>>;
  ladder?: Partial<{ title: string }>;
}

/** A path as a page or an email reads it: the fixed id and page, the village's words filled in. */
export interface ServedPath {
  id: string;
  label: string;
  role: string;
  description: string;
  route: string;
}

type Doc = Record<string, unknown>;

const isObject = (v: unknown): v is Doc => v !== null && typeof v === "object" && !Array.isArray(v);

const own = (doc: Doc, key: string): unknown => (Object.prototype.hasOwnProperty.call(doc, key) ? doc[key] : undefined);

export const PATH_IDS: readonly string[] = GAME_CONFIG.paths.map((p) => p.id);
export const STAGE_IDS: readonly string[] = GAME_CONFIG.stages.map((s) => s.id);

/** Today's words for every path and stage: what a village reads until it saves its own. */
export function defaultVillagePathWords(): VillagePathWords {
  return {
    paths: Object.fromEntries(
      GAME_CONFIG.paths.map((p) => [p.id, { label: p.label, role: p.role, description: DEFAULT_PATH_DESCRIPTIONS[p.id] ?? "" }]),
    ),
    stages: Object.fromEntries(GAME_CONFIG.stages.map((s) => [s.id, { name: s.name, description: s.description }])),
    ladder: { title: DEFAULT_LADDER_TITLE },
  };
}

/**
 * A stored word wins when it is text with something in it; anything else
 * (absent, blank, a number, an object) is today's word. Clipped to its limit,
 * so a document written around the editor still fits the layout.
 */
function word(stored: unknown, fallback: string, max: number): string {
  if (typeof stored !== "string") return fallback;
  const text = stored.trim();
  if (!text) return fallback;
  return charCount(text) > max ? Array.from(text).slice(0, max).join("") : text;
}

/**
 * The stored document read over today's words, one field at a time. Ids this
 * build does not know are ignored, so a document saved by another release
 * cannot invent a path or a stage.
 */
export function resolveVillagePathWords(stored: unknown): VillagePathWords {
  const doc = isObject(stored) ? stored : {};
  const paths = isObject(doc.paths) ? doc.paths : {};
  const stages = isObject(doc.stages) ? doc.stages : {};
  const ladder = isObject(doc.ladder) ? doc.ladder : {};
  const base = defaultVillagePathWords();
  const section = (group: Doc, id: string): Doc => {
    const v = own(group, id);
    return isObject(v) ? v : {};
  };
  return {
    paths: Object.fromEntries(
      PATH_IDS.map((id) => {
        const typed = section(paths, id);
        const d = base.paths[id];
        return [id, {
          label: word(typed.label, d.label, PATH_LIMITS.label),
          role: word(typed.role, d.role, PATH_LIMITS.role),
          description: word(typed.description, d.description, PATH_LIMITS.description),
        }];
      }),
    ),
    stages: Object.fromEntries(
      STAGE_IDS.map((id) => {
        const typed = section(stages, id);
        const d = base.stages[id];
        return [id, {
          name: word(typed.name, d.name, STAGE_LIMITS.name),
          description: word(typed.description, d.description, STAGE_LIMITS.description),
        }];
      }),
    ),
    ladder: { title: word(ladder.title, base.ladder.title, LADDER_LIMITS.title) },
  };
}

/** The default label of a path or the default name of a stage, for a sentence that names one. */
function pathName(id: string): string {
  return GAME_CONFIG.paths.find((p) => p.id === id)?.label ?? id;
}
function stageNameOf(id: string): string {
  return GAME_CONFIG.stages.find((s) => s.id === id)?.name ?? id;
}

const PATH_FIELD_WORDS: Record<PathField, string> = { label: "name", role: "second line", description: "sentence" };
const STAGE_FIELD_WORDS: Record<StageField, string> = { name: "name", description: "short line" };

function checkGroup<F extends string>(
  problems: string[],
  group: unknown,
  what: "path" | "stage",
  ids: readonly string[],
  limits: Readonly<Record<F, number>>,
  fieldWords: Record<F, string>,
  nameOf: (id: string) => string,
): void {
  if (group === undefined) return;
  if (!isObject(group)) {
    problems.push(`The ${what}s arrive as one object, keyed by ${what}.`);
    return;
  }
  for (const [id, fields] of Object.entries(group)) {
    if (!ids.includes(id)) {
      problems.push(`There is no ${what} called "${id}". A ${what} keeps its id, and its words are what change here.`);
      continue;
    }
    if (!isObject(fields)) {
      problems.push(`The ${nameOf(id)} ${what} arrives as an object of its words.`);
      continue;
    }
    for (const [field, value] of Object.entries(fields)) {
      if (!Object.prototype.hasOwnProperty.call(limits, field)) {
        problems.push(`A ${what} has no "${field}" to set.`);
        continue;
      }
      const label = `The ${nameOf(id)} ${what}'s ${fieldWords[field as F]}`;
      if (typeof value !== "string") {
        problems.push(`${label} must be text.`);
        continue;
      }
      const max = limits[field as F];
      const n = charCount(value.trim());
      if (n > max) problems.push(`${label} can be up to ${max} characters, and has ${n}.`);
    }
  }
}

/**
 * Everything wrong with a document a founder wants to save, in their words.
 * Empty means it may be stored. The editor asks the same question before Save
 * lights up, and the server asks it again before it writes.
 */
export function villagePathsProblems(body: unknown): string[] {
  if (!isObject(body)) return ["Send the paths and stages as one object."];
  const problems: string[] = [];
  for (const key of Object.keys(body)) {
    if (key !== "paths" && key !== "stages" && key !== "ladder") problems.push(`There is no "${key}" to set here.`);
  }
  checkGroup(problems, body.paths, "path", PATH_IDS, PATH_LIMITS, PATH_FIELD_WORDS, pathName);
  checkGroup(problems, body.stages, "stage", STAGE_IDS, STAGE_LIMITS, STAGE_FIELD_WORDS, stageNameOf);
  if (body.ladder !== undefined) {
    if (!isObject(body.ladder)) problems.push("The ladder arrives as an object of its words.");
    else {
      for (const [field, value] of Object.entries(body.ladder)) {
        if (field !== "title") problems.push(`The ladder has no "${field}" to set.`);
        else if (typeof value !== "string") problems.push("The ladder's name must be text.");
        else if (charCount(value.trim()) > LADDER_LIMITS.title) {
          problems.push(`The ladder's name can be up to ${LADDER_LIMITS.title} characters, and has ${charCount(value.trim())}.`);
        }
      }
    }
  }
  return problems;
}

/**
 * What a valid save stores: each word trimmed, and every blank left out so its
 * field follows today's word again. A group with nothing left is dropped.
 * Call it only on a body `villagePathsProblems` accepted.
 */
export function storableVillagePaths(body: unknown): VillagePathsDocument {
  const doc = isObject(body) ? body : {};
  const keep = (group: unknown, ids: readonly string[], fields: readonly string[]) => {
    if (!isObject(group)) return undefined;
    const out: Record<string, Record<string, string>> = {};
    for (const id of ids) {
      const typed = own(group, id);
      if (!isObject(typed)) continue;
      const row: Record<string, string> = {};
      for (const f of fields) {
        const v = own(typed, f);
        if (typeof v === "string" && v.trim()) row[f] = v.trim();
      }
      if (Object.keys(row).length) out[id] = row;
    }
    return Object.keys(out).length ? out : undefined;
  };
  const out: VillagePathsDocument = {};
  const paths = keep(doc.paths, PATH_IDS, PATH_FIELDS);
  const stages = keep(doc.stages, STAGE_IDS, STAGE_FIELDS);
  const title = isObject(doc.ladder) && typeof doc.ladder.title === "string" ? doc.ladder.title.trim() : "";
  if (paths) out.paths = paths;
  if (stages) out.stages = stages;
  if (title) out.ladder = { title };
  return out;
}

/** Every path in the platform's order, with the village's words and `{words}` filled in. */
export function servedPaths(words: VillagePathWords, vars: PageVars): ServedPath[] {
  return GAME_CONFIG.paths.map((p) => {
    const w = words.paths[p.id];
    return {
      id: p.id,
      label: fillVars(w.label, vars),
      role: fillVars(w.role, vars),
      description: fillVars(w.description, vars),
      route: p.route,
    };
  });
}

/** One stage's words with `{words}` filled in. An id this build does not know reads as the first stage, as `getStage` does. */
export function servedStageWords(words: VillagePathWords, stageId: string, vars: PageVars): StageWords {
  const w = words.stages[stageId] ?? words.stages[STAGE_IDS[0]];
  return { name: fillVars(w.name, vars), description: fillVars(w.description, vars) };
}
